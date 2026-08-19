import { requireAdmin } from "@/lib/admin/auth";
import { getSetting, setSetting, SETTING_GHL_WEBHOOK } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json({ ghlWebhookUrl: getSetting(SETTING_GHL_WEBHOOK) ?? "" });
}

export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let webhook = "";
  try {
    const body = (await request.json()) as { ghlWebhookUrl?: unknown };
    if (typeof body.ghlWebhookUrl === "string") webhook = body.ghlWebhookUrl.trim();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (webhook) {
    let parsed: URL;
    try {
      parsed = new URL(webhook);
    } catch {
      return Response.json({ error: "That is not a valid URL." }, { status: 400 });
    }
    const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
      return Response.json({ error: "The webhook URL must use https." }, { status: 400 });
    }
  }

  setSetting(SETTING_GHL_WEBHOOK, webhook);
  return Response.json({ ok: true, ghlWebhookUrl: webhook });
}
