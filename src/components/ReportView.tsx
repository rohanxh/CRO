"use client";

import { useMemo, useState } from "react";
import {
  CATEGORY_LABELS,
  type AuditReport,
  type Category,
  type Issue,
  type PerfMetrics,
  type Platform,
  type Severity,
} from "@/lib/types";
import { scoreBand } from "@/lib/score";
import { IssueCard } from "./IssueCard";
import { ContactCTA } from "./ContactCTA";
import { DamageBar, DesktopIcon, MetaChip, MobileIcon, ScoreDial } from "./ui";

type PlatformFilter = "all" | "desktop" | "mobile";
type SeverityFilter = "all" | Severity;

export function ReportView({ report, onReset }: { report: AuditReport; onReset: () => void }) {
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [quickWinsOnly, setQuickWinsOnly] = useState(false);

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of report.issues) c[i.severity]++;
    return c;
  }, [report.issues]);

  const filtered = useMemo(
    () =>
      report.issues.filter((i) => {
        if (platformFilter !== "all" && i.platform !== platformFilter && i.platform !== "both")
          return false;
        if (severityFilter !== "all" && i.severity !== severityFilter) return false;
        if (categoryFilter !== "all" && i.category !== categoryFilter) return false;
        if (quickWinsOnly && i.effort !== "quick-win") return false;
        return true;
      }),
    [report.issues, platformFilter, severityFilter, categoryFilter, quickWinsOnly]
  );

  const usedCategories = useMemo(
    () => report.categoryScores.filter((c) => c.issueCount > 0),
    [report.categoryScores]
  );

  const band = scoreBand(report.overallScore);
  const host = safeHost(report.finalUrl || report.url);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-24 pt-8 sm:px-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-400">
            Conversion audit
          </div>
          <h1 className="mt-1 truncate text-2xl font-semibold text-ink-100 sm:text-3xl">{host}</h1>
          <p className="mt-1 truncate text-xs text-ink-500">
            {report.finalUrl} · {new Date(report.generatedAt).toLocaleString()} ·{" "}
            {(report.durationMs / 1000).toFixed(1)}s
            {report.aiEnabled && report.model?.label ? ` · analysed by ${report.model.label}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border border-ink-600 px-3 py-2 text-xs font-medium text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100"
          >
            Export PDF
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-600"
          >
            Audit another page
          </button>
        </div>
      </header>

      {report.aiError && (
        <div className="panel mb-6 border-high/30 bg-high/8 p-4 text-sm text-ink-200">
          <strong className="font-semibold text-high">Limited report.</strong> Page analysis did not
          run, so this covers measured technical and structural checks only. {report.aiError}
        </div>
      )}

      {/* Scores */}
      <section className="panel mb-6 p-6">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center">
          <div className="flex shrink-0 items-center gap-6">
            <ScoreDial score={report.overallScore} label="Overall" sublabel={band.label} />
            <div className="flex flex-col gap-4">
              <ScoreDial score={report.desktopScore} size={76} label="Desktop" />
              <ScoreDial score={report.mobileScore} size={76} label="Mobile" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-relaxed text-ink-200">{report.summary}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <MetaChip label="Critical" value={String(counts.critical)} tone={counts.critical ? "warn" : "good"} />
              <MetaChip label="High" value={String(counts.high)} tone={counts.high ? "warn" : "good"} />
              <MetaChip label="Medium" value={String(counts.medium)} />
              <MetaChip label="Low" value={String(counts.low)} />
              <MetaChip
                label="Quick wins"
                value={String(report.issues.filter((i) => i.effort === "quick-win").length)}
                tone="good"
              />
            </div>
          </div>
        </div>
      </section>

      <div className="mb-6 grid gap-6 lg:grid-cols-5">
        {/* Understanding */}
        {report.understanding && (
          <section className="panel p-6 lg:col-span-3">
            <SectionTitle>What this page is</SectionTitle>
            <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Detail term="Page type" value={report.understanding.pageType} />
              <Detail term="Industry" value={report.understanding.industryGuess} />
              <Detail term="Business model" value={report.understanding.businessModel} />
              <Detail term="Audience" value={report.understanding.targetAudience} />
              <Detail
                term="Primary goal"
                value={report.understanding.primaryConversionGoal}
                highlight
              />
              <Detail
                term="Secondary goals"
                value={report.understanding.secondaryGoals.join(" · ") || "None detected"}
              />
            </dl>
            <div className="mt-5 space-y-4 border-t border-ink-700/60 pt-5">
              <Detail
                term="Value proposition as a visitor reads it"
                value={report.understanding.valuePropositionAsUnderstood}
              />
              <Detail term="Is it clear?" value={report.understanding.clarityVerdict} />
              <Detail term="Five-second test" value={report.understanding.fiveSecondTest} />
            </div>
          </section>
        )}

        {/* Top opportunities */}
        <section
          className={`panel p-6 ${report.understanding ? "lg:col-span-2" : "lg:col-span-5"}`}
        >
          <SectionTitle>Fix these first</SectionTitle>
          {report.topOpportunities.length > 0 ? (
            <ol className="mt-4 space-y-3">
              {report.topOpportunities.map((op, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-200">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-[11px] font-semibold text-brand-400">
                    {i + 1}
                  </span>
                  {op}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 text-sm text-ink-400">
              See the prioritised issue list below — the top items are ordered by expected impact.
            </p>
          )}

          <div className="mt-6 border-t border-ink-700/60 pt-5">
            <SectionTitle>Where the damage is</SectionTitle>
            <div className="mt-3 space-y-2">
              {report.categoryScores
                .slice()
                .sort((a, b) => b.weight - a.weight || b.issueCount - a.issueCount)
                .slice(0, 8)
                .map((c) => (
                  <DamageBar
                    key={c.category}
                    label={CATEGORY_LABELS[c.category]}
                    weight={c.weight}
                    count={c.issueCount}
                    worstSeverity={c.worstSeverity}
                  />
                ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
              Bar length is that area&apos;s share of the total conversion damage; colour is its
              most severe issue.
            </p>
          </div>
        </section>
      </div>

      {/* Screenshots */}
      <section className="panel mb-6 p-6">
        <SectionTitle>What the visitor sees first</SectionTitle>
        <div className="mt-4 grid gap-6 md:grid-cols-[1fr_auto]">
          <figure className="min-w-0">
            <figcaption className="mb-2 flex items-center gap-1.5 text-xs text-ink-400">
              <DesktopIcon className="size-3.5" /> Desktop 1440 × 900
            </figcaption>
            <img
              src={`data:image/jpeg;base64,${report.screenshots.desktopFold}`}
              alt="Desktop above-the-fold screenshot"
              className="w-full rounded-lg border border-ink-700"
            />
          </figure>
          <figure className="mx-auto w-full max-w-[240px]">
            <figcaption className="mb-2 flex items-center gap-1.5 text-xs text-ink-400">
              <MobileIcon className="size-3.5" /> Mobile 390 × 844
            </figcaption>
            <img
              src={`data:image/jpeg;base64,${report.screenshots.mobileFold}`}
              alt="Mobile above-the-fold screenshot"
              className="w-full rounded-lg border border-ink-700"
            />
          </figure>
        </div>
      </section>

      {/* Metrics */}
      <section className="panel mb-6 p-6">
        <SectionTitle>Measured on the live page</SectionTitle>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-left text-[11px] uppercase tracking-wider text-ink-500">
                <th className="pb-2 font-medium">Metric</th>
                <th className="pb-2 font-medium">Desktop</th>
                <th className="pb-2 font-medium">Mobile</th>
                <th className="pb-2 font-medium">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              <MetricRow
                name="Largest Contentful Paint"
                d={report.metrics.desktop.lcp}
                m={report.metrics.mobile.lcp}
                format={(v) => `${(v / 1000).toFixed(2)}s`}
                threshold={2500}
                target="< 2.5s"
              />
              <MetricRow
                name="First Contentful Paint"
                d={report.metrics.desktop.fcp}
                m={report.metrics.mobile.fcp}
                format={(v) => `${(v / 1000).toFixed(2)}s`}
                threshold={1800}
                target="< 1.8s"
              />
              <MetricRow
                name="Cumulative Layout Shift"
                d={report.metrics.desktop.cls}
                m={report.metrics.mobile.cls}
                format={(v) => v.toFixed(3)}
                threshold={0.1}
                target="< 0.1"
              />
              <MetricRow
                name="Time to First Byte"
                d={report.metrics.desktop.ttfb}
                m={report.metrics.mobile.ttfb}
                format={(v) => `${Math.round(v)}ms`}
                threshold={800}
                target="< 800ms"
              />
              <MetricRow
                name="Page weight"
                d={report.metrics.desktop.totalTransferBytes}
                m={report.metrics.mobile.totalTransferBytes}
                format={(v) => `${(v / 1024 / 1024).toFixed(2)} MB`}
                threshold={2 * 1024 * 1024}
                target="< 2 MB"
              />
              <MetricRow
                name="Requests"
                d={report.metrics.desktop.requestCount}
                m={report.metrics.mobile.requestCount}
                format={(v) => String(v)}
                threshold={80}
                target="< 80"
              />
              <MetricRow
                name="Third-party requests"
                d={report.metrics.desktop.thirdPartyRequestCount}
                m={report.metrics.mobile.thirdPartyRequestCount}
                format={(v) => String(v)}
                threshold={30}
                target="< 30"
              />
              <MetricRow
                name="Render-blocking scripts"
                d={report.metrics.desktop.blockingScriptCount}
                m={report.metrics.mobile.blockingScriptCount}
                format={(v) => String(v)}
                threshold={2}
                target="≤ 2"
              />
            </tbody>
          </table>
        </div>
      </section>

      {/* Issues */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <SectionTitle>
              Everything to fix
              <span className="ml-2 text-ink-500">
                ({filtered.length}
                {filtered.length !== report.issues.length && ` of ${report.issues.length}`})
              </span>
            </SectionTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterGroup
              value={platformFilter}
              onChange={setPlatformFilter}
              options={[
                ["all", "All"],
                ["desktop", "Desktop"],
                ["mobile", "Mobile"],
              ]}
            />
            <FilterGroup
              value={severityFilter}
              onChange={setSeverityFilter}
              options={[
                ["all", "Any severity"],
                ["critical", "Critical"],
                ["high", "High"],
                ["medium", "Medium"],
                ["low", "Low"],
              ]}
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as Category | "all")}
              className="rounded-lg border border-ink-600 bg-ink-850 px-2.5 py-1.5 text-xs text-ink-200 outline-none focus:border-brand-500"
            >
              <option value="all">All areas</option>
              {usedCategories.map((c) => (
                <option key={c.category} value={c.category}>
                  {CATEGORY_LABELS[c.category]} ({c.issueCount})
                </option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-850 px-2.5 py-1.5 text-xs text-ink-200">
              <input
                type="checkbox"
                checked={quickWinsOnly}
                onChange={(e) => setQuickWinsOnly(e.target.checked)}
                className="accent-brand-500"
              />
              Quick wins only
            </label>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="panel p-10 text-center text-sm text-ink-400">
            No issues match these filters.
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((issue, i) => (
              <IssueCard key={issue.id + i} issue={issue} index={i} />
            ))}
          </div>
        )}
      </section>

      {/* Lead capture — the point of the tool as a lead magnet. */}
      <div className="print:hidden">
        <ContactCTA report={report} />
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">{children}</h2>
  );
}

function Detail({
  term,
  value,
  highlight = false,
}: {
  term: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">{term}</dt>
      <dd className={`mt-1 text-sm leading-relaxed ${highlight ? "text-brand-400" : "text-ink-200"}`}>
        {value}
      </dd>
    </div>
  );
}

function MetricRow({
  name,
  d,
  m,
  format,
  threshold,
  target,
}: {
  name: string;
  d: number | null;
  m: number | null;
  format: (v: number) => string;
  threshold: number;
  target: string;
}) {
  const cell = (v: number | null) => {
    if (v === null) return <span className="text-ink-600">n/a</span>;
    const bad = v > threshold;
    return (
      <span className={bad ? "text-high" : "text-good"}>
        {format(v)}
      </span>
    );
  };
  return (
    <tr>
      <td className="py-2 text-ink-300">{name}</td>
      <td className="py-2 tabular-nums">{cell(d)}</td>
      <td className="py-2 tabular-nums">{cell(m)}</td>
      <td className="py-2 text-xs text-ink-500">{target}</td>
    </tr>
  );
}

function FilterGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<[T, string]>;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-ink-600">
      {options.map(([val, label]) => (
        <button
          key={val}
          type="button"
          onClick={() => onChange(val)}
          className={`px-2.5 py-1.5 text-xs transition-colors ${
            value === val
              ? "bg-brand-500 font-medium text-white"
              : "bg-ink-850 text-ink-300 hover:bg-ink-800"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export type { AuditReport, Issue, PerfMetrics, Platform };
