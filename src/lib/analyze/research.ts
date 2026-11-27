import Anthropic from "@anthropic-ai/sdk";
import { RESEARCHER } from "./models";

/**
 * Off-page business research, produced by Haiku with web search while the page
 * is still being captured. It is about the BUSINESS — services, reputation,
 * reviews, local presence — not the page's pixels (Sonnet assesses those). Running
 * it in parallel with capture keeps it off the critical path, and it is always
 * best-effort: a null result just means the assessment runs without it.
 */
export interface ResearchBrief {
  businessContext: string;
  localPresence: string;
  priorities: string[];
  watchOuts: string[];
}

const BRIEF_TOOL: Anthropic.Tool = {
  name: "record_research",
  description:
    "Record what you learned about this business from research, to guide a conversion audit of its website.",
  input_schema: {
    type: "object",
    properties: {
      businessContext: {
        type: "string",
        description:
          "What the business actually sells, who it serves, and anything from reviews/reputation that should shape the page's messaging or trust signals (e.g. 'reviews praise same-day service but complain pricing is unclear'). If research found nothing useful, say so plainly.",
      },
      localPresence: {
        type: "string",
        description:
          "For a local or service-area business: its location(s) and local conversion factors — Google Business presence, local reviews, and how many/which locations it has. Write 'Not a local business' if it is purely online/national.",
      },
      priorities: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 5,
        description:
          "The highest-leverage angles the detailed audit should focus on, informed by what research revealed about this business and market. Most impactful first.",
      },
      watchOuts: {
        type: "array",
        items: { type: "string" },
        maxItems: 3,
        description:
          "Generic advice that would be WRONG for this specific business/market, so the detailed pass does not waste a finding on it.",
      },
    },
    required: ["businessContext", "localPresence", "priorities", "watchOuts"],
  },
};

const WEB_SEARCH = {
  type: "web_search_20250305", // basic variant: Haiku 4.5 does not support the 20260209 one
  name: "web_search",
  max_uses: 4,
} as unknown as Anthropic.Tool;

const SYSTEM = `You are a conversion strategist researching a business before its website is audited, so the audit fits the real business and market rather than judging the page in isolation.

Use web search (2–4 focused searches) to learn:
- What the business sells and who it serves.
- Its reputation: find reviews (Google, Trustpilot, industry sites) and note recurring themes — what customers praise and complain about — since those are the objections and proof points the page should address.
- If it is local or service-area, its location(s) and local presence (Google Business Profile, local reviews, how many locations).

Be concise and factual. When done, you MUST call record_research exactly once.`;

/**
 * Runs the Haiku research pass from the URL alone (no screenshots), so it can
 * run concurrently with page capture. Best-effort: returns null on any problem.
 */
export async function runResearch(targetUrl: string): Promise<ResearchBrief | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 120_000 });

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Research the business behind this website: ${targetUrl}\n\nThen call record_research once.`,
    },
  ];

  // web_search is a server tool and may pause between rounds; resubmit to continue.
  let response: Anthropic.Message | null = null;
  for (let i = 0; i < 5; i++) {
    response = await client.messages.create({
      model: RESEARCHER,
      max_tokens: 4000,
      system: SYSTEM,
      tools: [WEB_SEARCH, BRIEF_TOOL],
      messages,
    });
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    break;
  }
  if (!response) return null;

  const toolUse = [...response.content]
    .reverse()
    .find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === BRIEF_TOOL.name
    );
  if (!toolUse) return null;

  const raw = toolUse.input as Partial<ResearchBrief>;
  if (!Array.isArray(raw.priorities)) return null;

  const s = (v: string | undefined) => stripCitations(v ?? "");
  return {
    businessContext: s(raw.businessContext),
    localPresence: s(raw.localPresence),
    priorities: (raw.priorities ?? []).map(s),
    watchOuts: (raw.watchOuts ?? []).map(s),
  };
}

/** Web search leaks citation markup (e.g. `(cite index="2-2">…`) into text; remove it. */
function stripCitations(text: string): string {
  return text
    // Strip citation open tags, including the leading < or ( the model emits.
    .replace(/[<(]?\s*cite\s+index="[^"]*"\s*>/gi, "")
    .replace(/<\/?cite[^>]*>/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Renders the research as a prompt block injected into the primary analysis. */
export function briefToPromptBlock(brief: ResearchBrief): string {
  const lines = [
    "Before you audit the page, here is what a strategist found by researching this business off-page (services, reviews, local presence). Use it to ground your findings — especially trust/social-proof and local angles — but correct it where the on-page evidence disagrees.",
    "",
  ];
  if (brief.businessContext) lines.push(`- Business & reputation: ${brief.businessContext}`);
  if (brief.localPresence) lines.push(`- Local presence: ${brief.localPresence}`);
  if (brief.priorities.length) {
    lines.push("", "Angles research suggests you prioritise:");
    lines.push(...brief.priorities.map((p, i) => `  ${i + 1}. ${p}`));
  }
  if (brief.watchOuts.length) {
    lines.push("", "Do not flag these (wrong for this business):");
    lines.push(...brief.watchOuts.map((w) => `  - ${w}`));
  }
  return lines.join("\n");
}
