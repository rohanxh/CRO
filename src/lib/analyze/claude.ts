import Anthropic from "@anthropic-ai/sdk";
import { assessmentSop, buildEvidenceDigest, buildUserPrompt } from "./prompt";
import { ASSESSOR } from "./models";
import { briefToPromptBlock, type ResearchBrief } from "./research";
import type { Category, HeuristicSignal, Issue, SiteUnderstanding } from "../types";
import type { CaptureResult } from "../capture";

const CATEGORIES: Category[] = [
  "value-proposition",
  "call-to-action",
  "trust-credibility",
  "forms-friction",
  "navigation-ia",
  "mobile-experience",
  "speed-performance",
  "content-clarity",
  "visual-hierarchy",
  "accessibility",
  "social-proof",
  "measurement",
];

const FINDINGS_TOOL: Anthropic.Tool = {
  name: "report_cro_findings",
  description:
    "Submit the CRO assessment of the page: how you understand it, and the prioritised findings.",
  input_schema: {
    type: "object",
    properties: {
      understanding: {
        type: "object",
        description: "Your read of what this page is, before any advice (SOP steps 1-3).",
        properties: {
          pageType: { type: "string", description: "What kind of page this is, in your own words." },
          businessModel: {
            type: "string",
            description: "How the business makes money and how a visitor becomes a customer.",
          },
          industryGuess: { type: "string", description: "Sector or niche, as inferred." },
          primaryConversionGoal: {
            type: "string",
            description: "The single action this page most wants a visitor to take.",
          },
          secondaryGoals: {
            type: "array",
            items: { type: "string" },
            description: "Other actions the page supports, most important first.",
          },
          targetAudience: {
            type: "string",
            description: "Who this page is for, and their likely state of mind.",
          },
          valuePropositionAsUnderstood: {
            type: "string",
            description: "The value proposition as an outsider actually understands it from the page.",
          },
          clarityVerdict: {
            type: "string",
            description: "One or two sentences on whether that comes across clearly, and why.",
          },
          fiveSecondTest: {
            type: "string",
            description: "What a first-time visitor would conclude from the mobile above-the-fold view.",
          },
        },
        required: [
          "pageType",
          "businessModel",
          "industryGuess",
          "primaryConversionGoal",
          "secondaryGoals",
          "targetAudience",
          "valuePropositionAsUnderstood",
          "clarityVerdict",
          "fiveSecondTest",
        ],
      },
      issues: {
        type: "array",
        description: "The findings, most impactful first.",
        minItems: 5,
        maxItems: 18,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "The specific problem in plain words. Max ~80 chars." },
            category: { type: "string", enum: CATEGORIES },
            severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
            platform: { type: "string", enum: ["desktop", "mobile", "both"] },
            location: { type: "string", description: "Where on the page, in terms a person can find." },
            observation: { type: "string", description: "What is there now, quoted or measured." },
            whyItMatters: { type: "string", description: "The conversion mechanism for this visitor." },
            recommendation: { type: "string", description: "Exactly what to change, where, and to what." },
            wordingFix: {
              type: "boolean",
              description: "True when the fix is rewriting on-page wording (headline, CTA label, form label).",
            },
            effort: { type: "string", enum: ["quick-win", "moderate", "significant"] },
            expectedImpact: { type: "string", enum: ["high", "medium", "low"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: [
            "title",
            "category",
            "severity",
            "platform",
            "location",
            "observation",
            "whyItMatters",
            "recommendation",
            "wordingFix",
            "effort",
            "expectedImpact",
            "confidence",
          ],
        },
      },
    },
    required: ["understanding", "issues"],
  },
};

export interface Assessment {
  understanding: SiteUnderstanding;
  issues: Issue[];
  /** Indexes into `issues` whose fix is new wording, for the report step to write. */
  wordingFixes: number[];
}

export function isAiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function slug(s: string, i: number) {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `ai-${i + 1}-${base || "finding"}`;
}

/** Sonnet's CRO assessment, following prompts/cro-assessment-sop.md. */
export async function assessPage(
  cap: CaptureResult,
  signals: HeuristicSignal[],
  targetUrl: string,
  brief: ResearchBrief | null
): Promise<Assessment> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 240_000 });
  const digest = buildEvidenceDigest(cap, signals);

  const images: Anthropic.ImageBlockParam[] = [
    cap.desktop.foldScreenshot,
    cap.desktop.fullScreenshot,
    cap.mobile.foldScreenshot,
    cap.mobile.fullScreenshot,
  ].map((data) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data },
  }));

  const userText = brief
    ? `${buildUserPrompt(digest, targetUrl)}\n\n---\nOFF-PAGE RESEARCH BRIEF\n\n${briefToPromptBlock(brief)}`
    : buildUserPrompt(digest, targetUrl);

  // Thinking on, so Sonnet actually works through the SOP. Thinking requires
  // tool_choice "auto" (forcing a tool is rejected), so the SOP tells it to call
  // the tool, and a missing call is treated as a failure below.
  const response = await client.messages.create({
    model: ASSESSOR,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: assessmentSop(),
    tools: [FINDINGS_TOOL],
    messages: [{ role: "user", content: [...images, { type: "text", text: userText }] }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === FINDINGS_TOOL.name
  );
  if (!toolUse) {
    throw new Error(`The assessment did not return findings (stop_reason: ${response.stop_reason}).`);
  }

  const raw = toolUse.input as {
    understanding: SiteUnderstanding;
    issues: Array<Omit<Issue, "id" | "source" | "exampleCopy"> & { wordingFix?: boolean }>;
  };

  const wordingFixes: number[] = [];
  const issues: Issue[] = (raw.issues ?? []).map(({ wordingFix, ...issue }, i) => {
    if (wordingFix) wordingFixes.push(i);
    return {
      ...issue,
      category: CATEGORIES.includes(issue.category) ? issue.category : "content-clarity",
      exampleCopy: null,
      id: slug(issue.title ?? "", i),
      source: "ai",
    };
  });

  return { understanding: raw.understanding, issues, wordingFixes };
}
