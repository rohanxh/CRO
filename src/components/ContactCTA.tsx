"use client";

import { useState } from "react";
import type { AuditReport } from "@/lib/types";

/**
 * The lead-magnet capture step. Shown at the end of every report: the visitor has
 * just seen a specific, credible list of problems on their own page, which is the
 * moment they are most likely to want help. Submitting stores the lead and (if
 * configured) forwards it to Go High Level.
 */
export function ContactCTA({ report }: { report: AuditReport }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const criticalHigh = report.issues.filter(
    (i) => i.severity === "critical" || i.severity === "high"
  ).length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          company,
          message,
          auditUrl: report.finalUrl || report.url,
          auditScore: report.overallScore,
          source: "CRO audit report",
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Something went wrong. Please try again.");
      setState("done");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (state === "done") {
    return (
      <section className="panel mt-6 border-good/30 bg-good/8 p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-good/15">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="size-6 text-good">
            <path className="draw" d="m5 13 4 4L19 7" />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-ink-100">
          Thanks, {name.split(" ")[0] || "there"}. We&apos;ll be in touch.
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-300">
          We&apos;ve got your details and a copy of this audit. Someone from our team will reach out
          about turning these fixes into results.
        </p>
      </section>
    );
  }

  return (
    <section className="panel mt-6 overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
        <div className="border-b border-ink-700/60 p-8 md:border-b-0 md:border-r">
          <h2 className="text-2xl font-semibold leading-snug text-ink-100">Want these fixed?</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-300">
            You&apos;ve just seen{" "}
            {criticalHigh > 0 ? (
              <>
                <strong className="font-semibold text-ink-100">
                  {criticalHigh} high-impact issue{criticalHigh === 1 ? "" : "s"}
                </strong>{" "}
                holding this page back.
              </>
            ) : (
              <>exactly where this page is losing customers.</>
            )}{" "}
            Leave your details and we&apos;ll reply with how we would fix them. No obligation.
          </p>
        </div>

        <form onSubmit={submit} className="p-8">
          <div className="grid gap-3">
            <Field label="Name" required>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="cta-input"
                placeholder="Your name"
              />
            </Field>
            <Field label="Email" required>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="cta-input"
                placeholder="you@company.com"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  type="tel"
                  autoComplete="tel"
                  className="cta-input"
                  placeholder="Best number to reach you"
                />
              </Field>
              <Field label="Company">
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  autoComplete="organization"
                  className="cta-input"
                  placeholder="Your business name"
                />
              </Field>
            </div>
            <Field label="Anything you'd like us to know">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                className="cta-input resize-none"
                placeholder="Goals for the page, deadlines, anything useful"
              />
            </Field>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-sm text-critical">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={state === "sending"}
            className="btn-primary mt-4 min-h-12 w-full px-5 text-[15px]"
          >
            {state === "sending" ? "Sending…" : "Get help fixing these"}
          </button>
          <p className="mt-2 text-center text-xs text-ink-400">
            We&apos;ll only use your details to talk to you about this audit.
          </p>
        </form>
      </div>
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-ink-300">
        {label}
        {required ? <span className="text-ink-400"> (required)</span> : <span className="text-ink-500"> (optional)</span>}
      </span>
      {children}
    </label>
  );
}
