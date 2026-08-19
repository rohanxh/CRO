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
            <path d="m5 13 4 4L19 7" />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-ink-100">Thanks, {name.split(" ")[0] || "there"} — we&apos;ll be in touch.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-400">
          We&apos;ve got your details and a copy of this audit. Someone from our team will reach out
          about turning these fixes into results.
        </p>
      </section>
    );
  }

  return (
    <section className="panel mt-6 overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
        <div className="border-b border-ink-700/60 bg-ink-900/40 p-8 md:border-b-0 md:border-r">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-400">
            Want these fixed?
          </div>
          <h2 className="mt-2 text-xl font-semibold leading-snug text-ink-100">
            We can turn this report into a higher-converting page.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-400">
            You&apos;ve just seen{" "}
            {criticalHigh > 0 ? (
              <>
                <strong className="text-ink-200">{criticalHigh} high-impact issue{criticalHigh === 1 ? "" : "s"}</strong>{" "}
                holding this page back.
              </>
            ) : (
              <>exactly where this page is leaking conversions.</>
            )}{" "}
            Leave your details and we&apos;ll show you how to fix them — no obligation.
          </p>
          <ul className="mt-5 space-y-2 text-sm text-ink-300">
            {["A walkthrough of the priority fixes", "Done-for-you or done-with-you options", "A plain-English plan, not a sales pitch"].map(
              (t) => (
                <li key={t} className="flex items-start gap-2">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand-400" />
                  {t}
                </li>
              )
            )}
          </ul>
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
                  autoComplete="tel"
                  className="cta-input"
                  placeholder="Optional"
                />
              </Field>
              <Field label="Company">
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  autoComplete="organization"
                  className="cta-input"
                  placeholder="Optional"
                />
              </Field>
            </div>
            <Field label="Anything you'd like us to know">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                className="cta-input resize-none"
                placeholder="Optional"
              />
            </Field>
          </div>

          {error && <p className="mt-3 text-sm text-critical">{error}</p>}

          <button
            type="submit"
            disabled={state === "sending"}
            className="mt-4 w-full rounded-lg bg-brand-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-500"
          >
            {state === "sending" ? "Sending…" : "Get help fixing these"}
          </button>
          <p className="mt-2 text-center text-[11px] text-ink-500">
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
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.1em] text-ink-500">
        {label}
        {required && <span className="ml-0.5 text-brand-400">*</span>}
      </span>
      {children}
    </label>
  );
}
