import { getSetting, SETTING_GHL_WEBHOOK, type LeadInput } from "./db";

/**
 * Go High Level inbound webhooks accept arbitrary JSON. We send a flat, clearly
 * named payload so it maps cleanly onto GHL contact fields / workflow triggers.
 */
export function ghlPayload(lead: LeadInput) {
  const [firstName, ...rest] = (lead.name ?? "").trim().split(/\s+/);
  return {
    firstName: firstName ?? "",
    lastName: rest.join(" "),
    name: lead.name,
    email: lead.email,
    phone: lead.phone ?? "",
    company: lead.company ?? "",
    message: lead.message ?? "",
    source: lead.source ?? "CRO audit tool",
    auditUrl: lead.auditUrl ?? "",
    auditScore: lead.auditScore ?? null,
    submittedAt: new Date().toISOString(),
  };
}

export function ghlWebhookUrl(): string | null {
  return getSetting(SETTING_GHL_WEBHOOK);
}

export interface ForwardResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Best-effort POST to the configured GHL webhook. Never throws. */
export async function forwardToGhl(
  payload: Record<string, unknown>,
  urlOverride?: string
): Promise<ForwardResult> {
  const url = urlOverride ?? ghlWebhookUrl();
  if (!url) return { ok: false, error: "No webhook URL configured." };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, status: res.status, error: `Webhook returned ${res.status}.` };
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Request failed." };
  }
}
