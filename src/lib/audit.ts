import { capture, CaptureError } from "./capture";
import { validateTargetUrl, UrlValidationError } from "./capture/url";
import { runHeuristics } from "./heuristics";
import { analyzeWithClaude, isAiConfigured } from "./analyze/claude";
import { runStrategyPass, type StrategyBrief } from "./analyze/strategy";
import { PIPELINE_LABEL } from "./analyze/models";
import { computeScores, sortIssues } from "./score";
import type { AuditReport, HeuristicSignal, Issue, ProgressEvent } from "./types";

export { CaptureError, UrlValidationError };
export { isAiConfigured } from "./analyze/claude";

const EFFORT_BY_SEVERITY: Record<HeuristicSignal["severity"], Issue["effort"]> = {
  critical: "moderate",
  high: "moderate",
  medium: "quick-win",
  low: "quick-win",
};

const IMPACT_BY_SEVERITY: Record<HeuristicSignal["severity"], Issue["expectedImpact"]> = {
  critical: "high",
  high: "high",
  medium: "medium",
  low: "low",
};

function signalsToIssues(signals: HeuristicSignal[]): Issue[] {
  return signals.map((s) => ({
    id: `rule-${s.id}`,
    title: s.title,
    category: s.category,
    severity: s.severity,
    platform: s.platform,
    location: "",
    observation: s.evidence,
    whyItMatters: "",
    recommendation: s.detail,
    exampleCopy: null,
    effort: EFFORT_BY_SEVERITY[s.severity],
    expectedImpact: IMPACT_BY_SEVERITY[s.severity],
    confidence: "medium",
    source: "rule",
  }));
}

function fallbackSummary(signals: HeuristicSignal[]) {
  const critical = signals.filter((s) => s.severity === "critical").length;
  const high = signals.filter((s) => s.severity === "high").length;
  const parts = [
    `${signals.length} automated conversion checks flagged an issue on this page.`,
  ];
  if (critical) parts.push(`${critical} of them block or actively lose conversions right now.`);
  if (high) parts.push(`${high} represent a material loss worth fixing next.`);
  parts.push(
    "AI analysis was unavailable for this run, so this report covers measurable technical and structural issues only, not messaging or visual judgement."
  );
  return parts.join(" ");
}

export interface RunAuditOptions {
  url: string;
  onProgress?: (event: ProgressEvent) => void;
}

export async function runAudit({ url, onProgress }: RunAuditOptions): Promise<AuditReport> {
  const started = Date.now();
  const emit = (step: string, message: string, pct: number) =>
    onProgress?.({ type: "status", step, message, pct });

  emit("validate", "Checking the URL…", 3);
  const targetUrl = await validateTargetUrl(url);

  const aiEnabled = isAiConfigured();

  // Kick off off-page business research NOW, so it runs concurrently with the
  // (slow) page capture instead of adding to the critical path. Best-effort.
  const researchPromise: Promise<StrategyBrief | null> = aiEnabled
    ? runStrategyPass(targetUrl).catch(() => null)
    : Promise.resolve(null);

  emit("capture", "Opening the page in a real browser…", 8);
  const cap = await capture({
    url: targetUrl,
    onProgress: (m) => emit("capture", m, 10),
  });

  emit("heuristics", "Running conversion checks…", 55);
  const signals = runHeuristics(cap);

  let issues: Issue[];
  let understanding: AuditReport["understanding"] = null;
  let summary: string;
  let topOpportunities: string[] = [];
  let aiError: string | null = null;
  let brief: StrategyBrief | null = null;

  if (aiEnabled) {
    // Research was started before capture; await whatever it produced.
    emit("strategy", "Researching the business…", 58);
    brief = await researchPromise;

    emit("analyze", "Reading the page like a visitor would…", 66);
    try {
      const ai = await analyzeWithClaude(cap, signals, targetUrl, brief);
      issues = ai.issues;
      understanding = ai.understanding;
      summary = ai.summary;
      topOpportunities = ai.topOpportunities;

      // Keep measured critical/high findings the model chose to omit.
      const covered = new Set(
        issues.map((i) => i.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24))
      );
      const missed = signals
        .filter((s) => s.severity === "critical" || s.severity === "high")
        .filter(
          (s) => !covered.has(s.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24))
        );
      if (missed.length) issues = [...issues, ...signalsToIssues(missed)];
    } catch (err) {
      // Visitors see a neutral message; the real cause (billing, rate limit,
      // outage) goes to the server log for us, not into a public report.
      console.error("AI analysis failed:", err);
      aiError = "Please try again in a little while.";
      issues = signalsToIssues(signals);
      summary = fallbackSummary(signals);
    }
  } else {
    issues = signalsToIssues(signals);
    summary = fallbackSummary(signals);
    console.error("AI analysis skipped: ANTHROPIC_API_KEY is not set.");
    aiError = "Please try again in a little while.";
  }

  emit("score", "Scoring and prioritising…", 92);
  const sorted = sortIssues(issues);
  const scores = computeScores(sorted);

  return {
    url: targetUrl,
    finalUrl: cap.desktop.meta.finalUrl,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    ...scores,
    understanding,
    summary,
    topOpportunities,
    issues: sorted,
    metrics: { desktop: cap.desktop.perf, mobile: cap.mobile.perf },
    screenshots: {
      desktopFold: cap.desktop.foldScreenshot,
      mobileFold: cap.mobile.foldScreenshot,
      desktopFull: cap.desktop.fullScreenshot,
      mobileFull: cap.mobile.fullScreenshot,
    },
    meta: cap.desktop.meta,
    aiEnabled,
    aiError,
    model: { id: "haiku-sonnet", label: PIPELINE_LABEL },
    research:
      brief && (brief.businessContext || brief.localPresence)
        ? { businessContext: brief.businessContext, localPresence: brief.localPresence }
        : null,
  };
}
