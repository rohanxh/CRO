import Anthropic from "@anthropic-ai/sdk";
import { buildEvidenceDigest } from "./prompt";
import { STRATEGIST } from "./models";
import type { HeuristicSignal } from "../types";
import type { CaptureResult } from "../capture";

/**
 * The compact strategic brief Sonnet produces before Haiku writes the full audit.
 * It is guidance, not the final report — Haiku still owns the structured output.
 */
export interface StrategyBrief {
  pageType: string;
  audience: string;
  primaryGoal: string;
  biggestBlocker: string;
  priorities: string[];
  watchOuts: string[];
}

const BRIEF_TOOL: Anthropic.Tool = {
  name: "record_strategy_brief",
  description:
    "Record a short strategic brief for a conversion audit of this page: what the page is, who it is for, its one goal, the single biggest thing blocking conversions, the few highest-leverage angles to pursue, and traps to avoid.",
  input_schema: {
    type: "object",
    properties: {
      pageType: { type: "string", description: "What kind of page this is, in a few words." },
      audience: { type: "string", description: "Who it is for and their state of mind." },
      primaryGoal: { type: "string", description: "The single action the page most wants." },
      biggestBlocker: {
        type: "string",
        description: "The one thing most hurting conversion on this specific page, in one sentence.",
      },
      priorities: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 6,
        description:
          "The highest-leverage angles the detailed audit should focus on, most impactful first. Each a short instruction grounded in what is actually on this page.",
      },
      watchOuts: {
        type: "array",
        items: { type: "string" },
        maxItems: 4,
        description:
          "Things NOT to flag or common generic advice that would be wrong for THIS page. Keeps the detailed pass honest.",
      },
    },
    required: ["pageType", "audience", "primaryGoal", "biggestBlocker", "priorities", "watchOuts"],
  },
};

const SYSTEM = `You are a principal conversion strategist doing a fast first read of a web page before a detailed audit.

You see the two above-the-fold views (desktop and mobile) and a digest of measured evidence. Do not write a full audit. Instead, decide what actually matters for THIS page and hand the detailed reviewer a tight brief: what the page is, who it is for, its one goal, the single biggest blocker, the few highest-leverage angles, and what would be a mistake to flag here.

Be specific to this page — quote real text where it helps. Judge the page against its own goal and audience, not a generic checklist. A local service page and a B2B SaaS page need different advice. Then call record_strategy_brief exactly once.`;

/**
 * Runs the Sonnet strategy pass. Best-effort: callers treat a thrown error or a
 * null return as "no brief" and continue with the primary analysis alone.
 */
export async function runStrategyPass(
  cap: CaptureResult,
  signals: HeuristicSignal[],
  targetUrl: string
): Promise<StrategyBrief | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000 });
  const digest = buildEvidenceDigest(cap, signals);

  // Only the two above-the-fold views — the highest-signal, lowest-cost input.
  const images: Anthropic.ImageBlockParam[] = [
    cap.desktop.foldScreenshot,
    cap.mobile.foldScreenshot,
  ].map((data) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data },
  }));

  const response = await client.messages.create({
    model: STRATEGIST.apiModel,
    max_tokens: STRATEGIST.maxTokens,
    system: SYSTEM,
    tools: [BRIEF_TOOL],
    tool_choice: { type: "tool", name: BRIEF_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          ...images,
          {
            type: "text",
            text: `Page: ${targetUrl}\nImage 1 is desktop above the fold, image 2 is mobile above the fold.\n\nMeasured evidence digest:\n\n\`\`\`json\n${JSON.stringify(digest, null, 1)}\n\`\`\`\n\nGive the detailed reviewer their brief. Call record_strategy_brief once.`,
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) return null;

  const raw = toolUse.input as Partial<StrategyBrief>;
  if (!raw.primaryGoal || !Array.isArray(raw.priorities)) return null;

  return {
    pageType: raw.pageType ?? "",
    audience: raw.audience ?? "",
    primaryGoal: raw.primaryGoal,
    biggestBlocker: raw.biggestBlocker ?? "",
    priorities: raw.priorities ?? [],
    watchOuts: raw.watchOuts ?? [],
  };
}

/** Renders the brief as a prompt block injected into the primary analysis. */
export function briefToPromptBlock(brief: StrategyBrief): string {
  const lines = [
    "A senior strategist did a first read of this page and left you this brief. Treat it as strong guidance, but you are looking at the full page — correct it where the evidence disagrees, and ground every finding in what is actually there.",
    "",
    `- Page: ${brief.pageType}`,
    `- Audience: ${brief.audience}`,
    `- Primary goal: ${brief.primaryGoal}`,
    `- Biggest blocker: ${brief.biggestBlocker}`,
    "",
    "Focus your findings on these angles first:",
    ...brief.priorities.map((p, i) => `  ${i + 1}. ${p}`),
  ];
  if (brief.watchOuts.length) {
    lines.push("", "Do not flag these (they would be wrong for this page):");
    lines.push(...brief.watchOuts.map((w) => `  - ${w}`));
  }
  return lines.join("\n");
}
