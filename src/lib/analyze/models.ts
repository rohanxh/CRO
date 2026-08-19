/**
 * The models the audit can run its analysis on, and a per-model prompt profile.
 *
 * Smaller models follow a tight, explicit prompt with a worked example far better
 * than a loose one, so each model gets a system prompt tuned to it rather than
 * sharing one. The heuristics layer is model-independent; only the judgement step
 * varies by model.
 */

export type ModelId = "haiku" | "sonnet" | "opus";

export interface ModelProfile {
  id: ModelId;
  /** The exact Anthropic model string. */
  apiModel: string;
  label: string;
  tagline: string;
  /** Rough US$ cost of one audit, for display. */
  approxCostPerAudit: string;
  /** Relative speed/quality hint shown in the picker. */
  speed: "fastest" | "balanced" | "deepest";
  maxTokens: number;
  /** How many findings to ask for; smaller models do better with a tighter cap. */
  findingsRange: [number, number];
  /** Whether to include the fully worked example in the prompt (helps small models). */
  includeWorkedExample: boolean;
}

export const MODELS: Record<ModelId, ModelProfile> = {
  haiku: {
    id: "haiku",
    apiModel: "claude-haiku-4-5",
    label: "Haiku",
    tagline: "Fast and cheap. Great for everyday and bulk audits.",
    approxCostPerAudit: "~$0.03",
    speed: "fastest",
    maxTokens: 12000,
    findingsRange: [10, 16],
    includeWorkedExample: true,
  },
  sonnet: {
    id: "sonnet",
    apiModel: "claude-sonnet-5",
    label: "Sonnet",
    tagline: "Sharper copy critique and prioritisation. For client deliverables.",
    approxCostPerAudit: "~$0.09",
    speed: "balanced",
    maxTokens: 16000,
    findingsRange: [12, 22],
    includeWorkedExample: false,
  },
  opus: {
    id: "opus",
    apiModel: "claude-opus-5",
    label: "Opus",
    tagline: "Deepest reasoning. For the highest-stakes pages.",
    approxCostPerAudit: "~$0.15",
    speed: "deepest",
    maxTokens: 18000,
    findingsRange: [12, 22],
    includeWorkedExample: false,
  },
};

export const DEFAULT_MODEL: ModelId = "haiku";

export function resolveModel(input: string | null | undefined): ModelProfile {
  if (input && input in MODELS) return MODELS[input as ModelId];
  // Allow CRO_MODEL to name either a profile id or a raw model string.
  const env = process.env.CRO_MODEL;
  if (env && env in MODELS) return MODELS[env as ModelId];
  return MODELS[DEFAULT_MODEL];
}

/** For the UI: the selectable options without any server-only detail. */
export function publicModelList() {
  return (Object.values(MODELS) as ModelProfile[]).map((m) => ({
    id: m.id,
    label: m.label,
    tagline: m.tagline,
    approxCostPerAudit: m.approxCostPerAudit,
    speed: m.speed,
  }));
}
