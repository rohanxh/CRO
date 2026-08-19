import { insertLead, markLeadForwarded, type LeadInput } from "@/lib/db";
import { forwardToGhl, ghlPayload, ghlWebhookUrl } from "@/lib/ghl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = clean(body.name, 200);
  const email = clean(body.email, 320);
  if (!name) return Response.json({ error: "Please enter your name." }, { status: 400 });
  if (!email || !EMAIL_RE.test(email)) {
    return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const scoreRaw = body.auditScore;
  const auditScore =
    typeof scoreRaw === "number" && Number.isFinite(scoreRaw)
      ? Math.round(scoreRaw)
      : null;

  const lead: LeadInput = {
    name,
    email,
    phone: clean(body.phone, 60),
    company: clean(body.company, 200),
    message: clean(body.message, 4000),
    auditUrl: clean(body.auditUrl, 2000),
    auditScore,
    source: clean(body.source, 100) ?? "CRO audit tool",
    userAgent: clean(request.headers.get("user-agent"), 500),
  };

  let id: number;
  try {
    id = insertLead(lead);
  } catch {
    return Response.json({ error: "Could not save your details. Please try again." }, { status: 500 });
  }

  // Forward to Go High Level if configured — best-effort, never blocks the reply
  // beyond its own short timeout, never fails the submission.
  if (ghlWebhookUrl()) {
    const result = await forwardToGhl(ghlPayload(lead));
    try {
      markLeadForwarded(id, result.ok, result.error);
    } catch {
      /* forwarding status is non-critical */
    }
  }

  return Response.json({ ok: true });
}
