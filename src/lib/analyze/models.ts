/**
 * Three steps, three fixed roles. There is deliberately no user-facing choice.
 *
 * - RESEARCHER (Haiku): web-searches the business (services, reviews, local
 *   presence) while the page is being captured. Fact-gathering, so cheap is fine.
 * - ASSESSOR (Sonnet): the CRO judgement. Follows the SOP in
 *   prompts/cro-assessment-sop.md and writes every finding in full.
 * - REPORTER (Haiku): turns the assessment into the report wrap-up: executive
 *   summary, top priorities, and replacement copy for wording fixes.
 *
 * Each model string can be overridden with an env var without a code change.
 */

export const RESEARCHER = process.env.CRO_RESEARCH_MODEL ?? "claude-haiku-4-5";
export const ASSESSOR = process.env.CRO_ASSESS_MODEL ?? "claude-sonnet-5";
export const REPORTER = process.env.CRO_REPORT_MODEL ?? "claude-haiku-4-5";

/** Shown on the report so people know how it was produced. */
export const PIPELINE_LABEL = "Sonnet assessment, Haiku research and report";
