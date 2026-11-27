// Self-check for pointsPerFix. Run: npx tsx src/lib/score.check.ts
import assert from "node:assert/strict";
import { computeScores, pointsPerFix, sortIssues } from "./score";
import type { Issue } from "./types";

const SEV = ["critical", "high", "medium", "low"] as const;
const PLAT = ["desktop", "mobile", "both"] as const;
const LVL = ["high", "medium", "low"] as const;

function issue(n: number, seed: number): Issue {
  const pick = <T,>(a: readonly T[], k: number) => a[(seed * 7 + n * 13 + k) % a.length];
  return {
    id: `i${n}`,
    title: `Issue ${n}`,
    category: "content-clarity",
    severity: pick(SEV, 1),
    platform: pick(PLAT, 2),
    location: "",
    observation: "",
    whyItMatters: "",
    recommendation: "",
    exampleCopy: null,
    effort: "moderate",
    expectedImpact: pick(LVL, 3),
    confidence: pick(LVL, 5),
    source: "ai",
  };
}

for (let seed = 0; seed < 200; seed++) {
  const count = seed % 25; // 0 to 24 findings, including the empty report
  const issues = sortIssues(Array.from({ length: count }, (_, n) => issue(n, seed)));
  const { overallScore } = computeScores(issues);
  const pts = pointsPerFix(issues, overallScore);

  assert.equal(pts.length, issues.length);
  assert.ok(pts.every((p) => Number.isInteger(p) && p >= 0), `seed ${seed}: bad point value`);
  assert.equal(
    pts.reduce((a, b) => a + b, 0),
    count === 0 ? 0 : 100 - overallScore,
    `seed ${seed}: points must add up to the gap to 100`
  );
}
console.log("pointsPerFix: 200 cases pass (whole, non-negative, sum to the gap to 100)");
