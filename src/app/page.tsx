"use client";

import { useRef, useState } from "react";
import type { AuditReport, ProgressEvent } from "@/lib/types";
import { ReportView } from "@/components/ReportView";

const STEPS = [
  { key: "validate", label: "Resolving URL" },
  { key: "capture", label: "Loading on desktop and mobile" },
  { key: "heuristics", label: "Running conversion checks" },
  { key: "analyze", label: "Reading the page like a visitor" },
  { key: "score", label: "Prioritising fixes" },
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
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
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-16">
      <div className="w-full max-w-2xl">
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900 px-3 py-1 text-[11px] font-medium text-ink-400">
            <span className="size-1.5 rounded-full bg-good" />
            Real browser · Desktop + mobile · Any industry
          </div>
          <h1 className="text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-ink-100 sm:text-5xl">
            Find what is costing you{" "}
            <span className="bg-gradient-to-r from-brand-400 to-good bg-clip-text text-transparent">
              conversions
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-pretty text-[15px] leading-relaxed text-ink-400">
            Paste any page. It loads in a real browser on desktop and mobile, measures what a visitor
            actually experiences, works out what the page is trying to do, then returns a prioritised
            list of things to fix.
          </p>
        </div>

        <form onSubmit={start} className="panel p-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              inputMode="url"
              autoComplete="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="yourwebsite.com/landing-page"
              disabled={running}
              className="min-w-0 flex-1 rounded-lg bg-transparent px-4 py-3 text-[15px] text-ink-100 outline-none placeholder:text-ink-600 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={running || url.trim().length === 0}
              className="rounded-lg bg-brand-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-500"
            >
              {running ? "Auditing…" : "Run audit"}
            </button>
          </div>
        </form>

        {error && (
          <div className="panel mt-4 border-critical/35 bg-critical/8 p-4 text-sm text-ink-200">
            {error}
          </div>
        )}

        {running && status && (
          <div className="panel mt-4 p-5">
            <div className="relative mb-5 h-1 overflow-hidden rounded-full bg-ink-700 shimmer">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
                style={{ width: `${Math.max(status.pct, 4)}%` }}
              />
            </div>
            <ul className="space-y-2.5">
              {STEPS.map((step, i) => {
                const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
                return (
                  <li key={step.key} className="flex items-center gap-3 text-sm">
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                        state === "done"
                          ? "border-good bg-good/20 text-good"
                          : state === "active"
                            ? "border-brand-400 bg-brand-500/20"
                            : "border-ink-600"
                      }`}
                    >
                      {state === "done" && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" className="size-2.5">
                          <path d="m5 13 4 4L19 7" />
                        </svg>
                      )}
                      {state === "active" && (
                        <span className="size-1.5 animate-pulse rounded-full bg-brand-400" />
                      )}
                    </span>
                    <span className={state === "pending" ? "text-ink-600" : "text-ink-200"}>
                      {state === "active" ? status.message : step.label}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs text-ink-500">
              A full audit takes roughly 40–90 seconds. Keep this tab open.
            </p>
          </div>
        )}

        {!running && !error && (
          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {[
              {
                title: "Understands the page first",
                body: "Works out the business model, audience and goal before judging anything, so the advice fits the page.",
              },
              {
                title: "Desktop and mobile separately",
                body: "Loads both viewports and reports which experience each issue actually affects.",
              },
              {
                title: "Fixes, not a checklist",
                body: "Each finding says where it is, why it costs conversions, and the specific change to make.",
              },
            ].map((f) => (
              <div key={f.title} className="panel p-4">
                <h3 className="text-sm font-medium text-ink-100">{f.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-400">{f.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
