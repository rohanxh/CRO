import { requireAdmin } from "@/lib/admin/auth";
import { getSetting, SETTING_GHL_WEBHOOK } from "@/lib/db";
import { forwardToGhl, ghlPayload } from "@/lib/ghl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sends a clearly-marked sample lead to the configured webhook so the operator
// can confirm it lands in Go High Level. Accepts an optional URL in the body to
// test a URL before saving it.
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let override: string | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as { ghlWebhookUrl?: unknown };
    if (typeof body.ghlWebhookUrl === "string" && body.ghlWebhookUrl.trim()) {
      override = body.ghlWebhookUrl.trim();
    }
  } catch {
    /* body optional */
  }

  const url = override ?? getSetting(SETTING_GHL_WEBHOOK) ?? "";
  if (!url) {
    return Response.json({ error: "No webhook URL to test. Enter or save one first." }, { status: 400 });
  }

  const payload = {
    ...ghlPayload({
      name: "Test Lead",
      email: "test-lead@example.com",
      phone: "+10000000000",
      company: "CRO Audit Tool",
      message: "This is a test submission from the CRO audit dashboard.",
      auditUrl: "https://example.com",
      auditScore: 72,
      source: "CRO audit tool — webhook test",
    }),
    test: true,
  };

  const result = await forwardToGhl(payload, url);
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error ?? "Webhook failed." }, { status: 502 });
  }
  return Response.json({ ok: true, status: result.status });
}
