import Anthropic from "@anthropic-ai/sdk";
import { REPORTER } from "./models";
import type { ResearchBrief } from "./research";
import type { CaptureResult } from "../capture";
import type { Issue, SiteUnderstanding } from "../types";

/**
 * Haiku's report step. Sonnet has already done the thinking and written each
 * finding; this turns that assessment into the parts a business owner reads
 * first (executive summary, top priorities) and writes replacement copy for the
 * findings whose fix is new wording.
 */

const REPORT_TOOL: Anthropic.Tool = {
  name: "write_report",
  description: "Write the report wrap-up for a completed CRO assessment.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "Three to five sentences for the business owner: the state of this page as a conversion asset, what already works, and the single biggest thing holding it back. Specific to this page.",
      },
      topOpportunities: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 5,
        description:
          "The three to five highest-leverage changes, each one sentence phrased as an instruction, ordered by expected impact. Drawn from the findings.",
      },
      exampleCopy: {
        type: "array",
        description: "Replacement wording for each finding listed as needing new copy.",
        items: {
          type: "object",
          properties: {
            finding: { type: "integer", description: "The finding number given in the input." },
            copy: { type: "string", description: "Ready-to-use replacement wording." },
          },
          required: ["finding", "copy"],
        },
      },
    },
    required: ["summary", "topOpportunities", "exampleCopy"],
  },
};

const SYSTEM = `You write the client-facing wrap-up of a conversion audit. A senior consultant has already assessed the page and written the findings; do not re-assess, add or contradict them.

- The summary is for a busy business owner: plain English, specific to this page, no jargon, no praise, no filler.
- Top opportunities come from the findings, highest impact first, each a single clear instruction.
- Replacement copy must sound like this business (use the page's own wording below as a guide to its voice) and must not invent facts. Where a fact is needed that you do not have, use a clearly marked placeholder such as [years in business].

Call write_report exactly once.`;

export interface ReportWrapUp {
  summary: string;
  topOpportunities: string[];
  copyByIssue: Map<number, string>;
}

export async function writeReport(
  cap: CaptureResult,
  understanding: SiteUnderstanding,
  issues: Issue[],
  wordingFixes: number[],
  brief: ResearchBrief | null
): Promise<ReportWrapUp> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });

  const findings = issues
    .map(
      (i, n) =>
        `${n + 1}. [${i.severity}, ${i.platform}] ${i.title}\n   Now: ${i.observation}\n   Fix: ${i.recommendation}`
    )
    .join("\n");

  const voice = {
    title: cap.desktop.meta.title,
    headings: cap.desktop.headings.slice(0, 12).map((h) => h.text),
    buttons: [...new Set(cap.desktop.ctas.map((c) => c.text))].slice(0, 12),
    aboveTheFold: cap.desktop.copy.aboveFoldText.slice(0, 1200),
  };

  const text = `PAGE UNDERSTANDING
${JSON.stringify(understanding, null, 1)}
${brief?.businessContext ? `\nBUSINESS RESEARCH\n${brief.businessContext}\n` : ""}
FINDINGS (already final, most impactful first)
${findings}

FINDINGS NEEDING REPLACEMENT COPY: ${
    wordingFixes.length ? wordingFixes.map((i) => i + 1).join(", ") : "none"
  }

THE PAGE'S OWN WORDING (for its voice)
${JSON.stringify(voice, null, 1)}`;

  const response = await client.messages.create({
    model: REPORTER,
    max_tokens: 4000,
    system: SYSTEM,
    tools: [REPORT_TOOL],
    tool_choice: { type: "tool", name: REPORT_TOOL.name },
    messages: [{ role: "user", content: text }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) throw new Error("The report step returned nothing.");

  const raw = toolUse.input as {
    summary?: string;
    topOpportunities?: string[];
    exampleCopy?: Array<{ finding: number; copy: string }>;
  };

  const copyByIssue = new Map<number, string>();
  for (const c of raw.exampleCopy ?? []) {
    const idx = c.finding - 1;
    // Only accept copy for findings that asked for it.
    if (wordingFixes.includes(idx) && c.copy?.trim()) copyByIssue.set(idx, c.copy.trim());
  }

  return {
    summary: raw.summary ?? "",
    topOpportunities: raw.topOpportunities ?? [],
    copyByIssue,
  };
}
