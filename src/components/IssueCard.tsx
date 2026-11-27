"use client";

import { useState } from "react";
import { CATEGORY_LABELS, type Issue } from "@/lib/types";
import { EffortChip, PlatformChip, SeverityChip } from "./ui";

// The left edge carries information: it is the finding's severity, readable at a
// glance down a long list.
const SEVERITY_ACCENT: Record<Issue["severity"], string> = {
  critical: "before:bg-critical",
  high: "before:bg-high",
  medium: "before:bg-medium",
  low: "before:bg-low",
};

export function IssueCard({ issue, index }: { issue: Issue; index: number }) {
  const [open, setOpen] = useState(index < 3);

  return (
    <article
      className={`panel relative overflow-hidden pl-4 before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${
        SEVERITY_ACCENT[issue.severity]
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-ink-800/40"
      >
        <span className="mt-0.5 w-6 shrink-0 text-xs tabular-nums text-ink-400">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-snug text-ink-100">
            {issue.title}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <SeverityChip severity={issue.severity} />
            <PlatformChip platform={issue.platform} />
            <EffortChip effort={issue.effort} />
            <span className="chip border-ink-700 bg-ink-850 text-ink-300">
              {CATEGORY_LABELS[issue.category]}
            </span>
            {issue.confidence === "low" && (
              <span className="chip border-ink-700 bg-ink-850 text-ink-400">Worth verifying</span>
            )}
          </span>
        </span>
        {issue.points !== undefined && (
          <span className="shrink-0 text-right leading-none">
            {issue.points > 0 ? (
              <>
                <span className="font-display text-lg font-semibold text-good">+{issue.points}</span>
                <span className="mt-1 block text-xs text-ink-400">
                  point{issue.points === 1 ? "" : "s"}
                </span>
              </>
            ) : (
              <span className="text-xs text-ink-400">Under 1 point</span>
            )}
          </span>
        )}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className={`mt-1 size-4 shrink-0 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* Always rendered so it can animate open and closed (keeps the reader's
          place in a long list); `inert` keeps it out of tab order when closed. */}
      <div
        inert={!open}
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
        <div className="space-y-4 border-t border-ink-700/60 px-4 py-4 pl-13 text-sm leading-relaxed">
          {issue.location && <Field label="Where">{issue.location}</Field>}
          <Field label="What is there now">{issue.observation}</Field>
          {issue.whyItMatters && <Field label="Why it costs conversions">{issue.whyItMatters}</Field>}
          <Field label="What to do" emphasis>
            {issue.recommendation}
          </Field>
          {issue.exampleCopy && (
            <div>
              <FieldLabel>Words to use</FieldLabel>
              <blockquote className="mt-1.5 whitespace-pre-line border-l-2 border-brand-500 bg-ink-850 px-4 py-3 text-[15px] leading-relaxed text-ink-100">
                {issue.exampleCopy}
              </blockquote>
            </div>
          )}
          <div className="flex flex-wrap gap-4 pt-1 text-xs text-ink-400">
            <span>
              Expected impact: <span className="text-ink-300">{issue.expectedImpact}</span>
            </span>
            <span>
              Confidence: <span className="text-ink-300">{issue.confidence}</span>
            </span>
            <span>
              Source:{" "}
              <span className="text-ink-300">
                {issue.source === "rule" ? "measured check" : "page analysis"}
              </span>
            </span>
          </div>
        </div>
        </div>
      </div>
    </article>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-ink-400">{children}</span>
  );
}

function Field({
  label,
  children,
  emphasis = false,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <p className={`mt-1 ${emphasis ? "text-ink-100" : "text-ink-300"}`}>{children}</p>
    </div>
  );
}
