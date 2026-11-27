"use client";

import { useEffect, useRef, useState } from "react";
import type { AuditReport, ProgressEvent } from "@/lib/types";
import { ReportView } from "@/components/ReportView";

const STEPS = [
  { key: "validate", label: "Checking the address" },
  { key: "capture", label: "Loading on a desktop and a phone" },
  { key: "heuristics", label: "Running conversion checks" },
  { key: "strategy", label: "Researching the business" },
  { key: "analyze", label: "Assessing conversion issues" },
  { key: "report", label: "Writing your report" },
  { key: "score", label: "Prioritising fixes" },
];

// What the report actually contains; each line maps to a real step of the pipeline.
const DELIVERABLES = [
  {
    title: "Both screens, separately",
    body: "Your page is loaded on a phone and on a desktop in a real browser, and every problem says which one it affects.",
  },
  {
    title: "Your reputation, read first",
    body: "Your reviews and local listings are looked up before anything is judged, so the advice answers what your customers actually say.",
  },
  {
    title: "Problems pinned to the page",
    body: "Each one points to the exact spot, quotes what is there now, and explains how it loses you customers.",
  },
  {
    title: "Fixes you can hand over",
    body: "A specific change for every problem, ranked by impact, with replacement wording wherever the fix is words.",
  },
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ step: string; message: string; pct: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;

    setError(null);
    setReport(null);
    setRunning(true);
    setStartedAt(Date.now());
    setStatus({ step: "validate", message: "Starting…", pct: 2 });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? `Request failed with status ${res.status}.`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: ProgressEvent;
          try {
            event = JSON.parse(line) as ProgressEvent;
          } catch {
            continue;
          }
          if (event.type === "status") {
            setStatus({ step: event.step, message: event.message, pct: event.pct });
          } else if (event.type === "error") {
            setError(event.message);
          } else if (event.type === "report") {
            setReport(event.report);
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setRunning(false);
      setStatus(null);
      abortRef.current = null;
    }
  }

  function reset() {
    abortRef.current?.abort();
    setReport(null);
    setError(null);
    setUrl("");
  }

  if (report) {
    return <ReportView report={report} onReset={reset} />;
  }

  const activeIndex = status ? STEPS.findIndex((s) => s.key === status.step) : -1;

  return (
    <main className="relative isolate flex-1 overflow-hidden px-5 pb-24">
      <div className="relative z-10 mx-auto w-full max-w-2xl pt-20 sm:pt-28">
        <h1 className="text-balance text-center text-[2rem] font-semibold leading-[1.15] text-ink-100 sm:text-5xl">
          See what is stopping visitors from becoming customers
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-center text-base leading-relaxed text-ink-300">
          Paste your page. We load it on a phone and a desktop in a real browser, read your reviews
          and local listings, then tell you exactly what to fix, in order of impact.
        </p>

        <form onSubmit={start} className="panel mt-10 p-3">
          <label htmlFor="audit-url" className="mb-2 block px-1 text-sm text-ink-300">
            Your page address
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="audit-url"
              type="text"
              inputMode="url"
              autoComplete="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="yourwebsite.com/landing-page"
              disabled={running}
              className="cta-input min-h-12 min-w-0 flex-1 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={running || url.trim().length === 0}
              className="btn-primary min-h-12 px-6 text-[15px]"
            >
              {running ? "Auditing…" : "Audit my page"}
            </button>
          </div>
        </form>
        <p className="mt-3 text-center text-sm text-ink-400">
          Free. No sign-up. Takes 2 to 4 minutes.
        </p>

        {error && (
          <div role="alert" className="panel mt-6 border-critical/45 p-4 text-sm leading-relaxed text-ink-100">
            <span className="font-semibold text-critical">The audit could not finish. </span>
            {error}
          </div>
        )}

        {running && status && startedAt !== null && (
          <div className="panel mt-6 p-5" aria-live="polite">
            <div className="mb-4 flex items-baseline justify-between gap-4 text-sm">
              <span className="text-ink-200">Auditing your page</span>
              <span className="text-ink-400">
                Elapsed <Elapsed since={startedAt} />
              </span>
            </div>
            <div className="mb-5 h-1 overflow-hidden rounded-full bg-ink-700">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
                style={{ width: `${Math.max(status.pct, 4)}%` }}
              />
            </div>
            <ol className="space-y-2.5">
              {STEPS.map((step, i) => {
                const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
                return (
                  <li key={step.key} className="flex items-center gap-3 text-sm">
                    <span
                      aria-hidden="true"
                      className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                        state === "done"
                          ? "border-good text-good"
                          : state === "active"
                            ? "border-brand-400"
                            : "border-ink-600"
                      }`}
                    >
                      {state === "done" && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" className="pop size-2.5">
                          <path d="m5 13 4 4L19 7" />
                        </svg>
                      )}
                      {state === "active" && <span className="size-1.5 rounded-full bg-brand-400" />}
                    </span>
                    <span className={state === "pending" ? "text-ink-500" : "text-ink-200"}>
                      {state === "active" ? status.message : step.label}
                      <span className="sr-only">
                        {state === "done" ? " (done)" : state === "active" ? " (in progress)" : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-4 text-sm text-ink-400">Keep this tab open while it runs.</p>
          </div>
        )}

        {/* The horizon: anchored just below the form so it follows the content height. */}
        <div aria-hidden="true" className="planet top-full mt-24" />
      </div>

      {!running && (
        <section className="relative z-10 mx-auto mt-56 grid w-full max-w-4xl gap-10 sm:mt-64 md:grid-cols-[1fr_1.7fr]">
          <div>
            <h2 className="text-2xl font-semibold leading-snug text-ink-100">What you get back</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-400">
              One report you can act on yourself or hand to whoever runs your site.
            </p>
          </div>
          <ul className="divide-y divide-ink-700/70 border-y border-ink-700/70">
            {DELIVERABLES.map((d) => (
              <li key={d.title} className="reveal py-5">
                <h3 className="text-base font-semibold text-ink-100">{d.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-300">{d.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="tabular-nums">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}
