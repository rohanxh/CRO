/**
 * The pipeline uses two models with fixed roles:
 *
 * - PRIMARY (Haiku) does the bulk of the work — the full structured audit. It is
 *   fast and cheap, which matters because this runs as a public lead magnet.
 * - STRATEGIST (Sonnet) runs one short "thinking" pass in between capture and the
 *   primary analysis: it looks at the page and writes a compact strategic brief
 *   that anchors Haiku's findings. It sees only the two above-the-fold views and
 *   is capped tightly, so it stays cheap.
 *
 * There is deliberately no user-facing model choice.
 */

export interface ModelProfile {
  apiModel: string;
  label: string;
  maxTokens: number;
  findingsRange: [number, number];
  includeWorkedExample: boolean;
}

export const PRIMARY: ModelProfile = {
  apiModel: process.env.CRO_PRIMARY_MODEL ?? "claude-haiku-4-5",
  label: "Haiku",
  maxTokens: 12000,
  findingsRange: [10, 18],
  // The worked example keeps Haiku's output grounded and consistent.
  includeWorkedExample: true,
};

export const STRATEGIST: ModelProfile = {
  apiModel: process.env.CRO_STRATEGIST_MODEL ?? "claude-sonnet-5",
  label: "Sonnet",
  maxTokens: 1500,
  findingsRange: [0, 0],
  includeWorkedExample: false,
};

/** Shown on the report so people know how it was produced. */
export const PIPELINE_LABEL = "Haiku, guided by Sonnet";
