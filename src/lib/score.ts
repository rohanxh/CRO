import {
  CATEGORY_LABELS,
  type Category,
  type CategoryScore,
  type Issue,
  type Severity,
} from "./types";

const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 20,
  high: 11,
  medium: 5,
  low: 1.5,
};

const IMPACT_MULTIPLIER: Record<Issue["expectedImpact"], number> = {
  high: 1.15,
  medium: 1,
  low: 0.8,
};

const CONFIDENCE_MULTIPLIER: Record<Issue["confidence"], number> = {
  high: 1,
  medium: 0.85,
  low: 0.6,
};

function penalty(issue: Issue) {
  return (
    SEVERITY_PENALTY[issue.severity] *
    (IMPACT_MULTIPLIER[issue.expectedImpact] ?? 1) *
    (CONFIDENCE_MULTIPLIER[issue.confidence] ?? 1)
  );
}

/** Diminishing returns: the tenth medium issue should not cost as much as the first. */
function scoreFrom(issues: Issue[]) {
  const penalties = issues.map(penalty).sort((a, b) => b - a);
  let total = 0;
  penalties.forEach((p, i) => {
    total += p * Math.pow(0.88, i);
  });
  return Math.max(4, Math.min(100, Math.round(100 - total)));
}

export function computeScores(issues: Issue[]) {
  const desktop = issues.filter((i) => i.platform === "desktop" || i.platform === "both");
  const mobile = issues.filter((i) => i.platform === "mobile" || i.platform === "both");

  const severityOrder: Record<Severity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  const rawWeights = new Map<Category, number>();
  for (const category of Object.keys(CATEGORY_LABELS) as Category[]) {
    const inCat = issues.filter((i) => i.category === category);
    rawWeights.set(
      category,
      inCat.reduce((sum, i) => sum + penalty(i), 0)
    );
  }
  const heaviest = Math.max(1, ...rawWeights.values());

  const categoryScores: CategoryScore[] = (
    Object.keys(CATEGORY_LABELS) as Category[]
  ).map((category) => {
    const inCat = issues.filter((i) => i.category === category);
    const worst = inCat
      .slice()
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])[0];
    return {
      category,
      score: inCat.length === 0 ? 100 : scoreFrom(inCat),
      weight: Math.round(((rawWeights.get(category) ?? 0) / heaviest) * 100),
      issueCount: inCat.length,
      worstSeverity: worst?.severity ?? null,
    };
  });

  const desktopScore = scoreFrom(desktop);
  const mobileScore = scoreFrom(mobile);

  return {
    overallScore: Math.round(desktopScore * 0.4 + mobileScore * 0.6),
    desktopScore,
    mobileScore,
    categoryScores,
  };
}

export function scoreBand(score: number): { label: string; tone: "bad" | "warn" | "ok" | "good" } {
  if (score < 40) return { label: "Needs urgent work", tone: "bad" };
  if (score < 60) return { label: "Significant gaps", tone: "warn" };
  if (score < 80) return { label: "Solid, with room to grow", tone: "ok" };
  return { label: "Strong", tone: "good" };
}

export function sortIssues(issues: Issue[]): Issue[] {
  const sev: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const imp: Record<Issue["expectedImpact"], number> = { high: 0, medium: 1, low: 2 };
  const eff: Record<Issue["effort"], number> = { "quick-win": 0, moderate: 1, significant: 2 };
  return [...issues].sort(
    (a, b) =>
      sev[a.severity] - sev[b.severity] ||
      imp[a.expectedImpact] - imp[b.expectedImpact] ||
      eff[a.effort] - eff[b.effort]
  );
}
