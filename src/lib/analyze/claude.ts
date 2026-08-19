import Anthropic from "@anthropic-ai/sdk";
import { buildEvidenceDigest, buildSystemPrompt, buildUserPrompt } from "./prompt";
import { type ModelProfile } from "./models";
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

const REPORT_TOOL: Anthropic.Tool = {
  name: "report_cro_findings",
  description:
    "Submit the complete conversion audit for the page: how you understand the page, an executive summary, the top opportunities, and the prioritised findings.",
  input_schema: {
    type: "object",
    properties: {
      understanding: {
        type: "object",
        description: "Your read of what this page is, before any advice.",
        properties: {
          pageType: {
            type: "string",
            description:
              "What kind of page this is, in your own words, e.g. 'B2B SaaS homepage', 'local service lead-gen landing page', 'ecommerce product page'.",
          },
          businessModel: {
            type: "string",
            description:
              "How the business appears to make money and how a visitor becomes a customer.",
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
            description: "Who this page is written for, and their likely state of mind.",
          },
          valuePropositionAsUnderstood: {
            type: "string",
            description:
              "The value proposition as an outsider would actually understand it from the page, not as the business probably intends it.",
          },
          clarityVerdict: {
            type: "string",
            description:
              "One or two sentences on whether that value proposition comes across clearly, and why.",
          },
          fiveSecondTest: {
            type: "string",
            description:
              "What a first-time visitor would be able to say about this page after five seconds on the mobile above-the-fold view.",
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
      summary: {
        type: "string",
        description:
          "Three to five sentences: the state of this page as a conversion asset, what is working, and the single biggest thing holding it back. Specific to this page.",
      },
      topOpportunities: {
        type: "array",
        description:
          "Three to five highest-leverage changes, each one sentence, phrased as an instruction. Ordered by expected impact.",
        items: { type: "string" },
        minItems: 3,
        maxItems: 5,
      },
      issues: {
        type: "array",
        description: "Between 10 and 22 findings, most impactful first.",
        minItems: 8,
        maxItems: 22,
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description:
                "Short, specific statement of the problem. Not a category name. Max about 80 characters.",
            },
            category: { type: "string", enum: CATEGORIES },
            severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
            platform: {
              type: "string",
              enum: ["desktop", "mobile", "both"],
              description: "Where the issue exists. Use 'both' only if it genuinely affects both.",
            },
            location: {
              type: "string",
              description:
                "Where on the page, in terms a person can find, e.g. 'hero section, primary button', 'contact form, field 4', 'footer'.",
            },
            observation: {
              type: "string",
              description:
                "What is actually there now, with the real quoted content or the measured number.",
            },
            whyItMatters: {
              type: "string",
              description:
                "The conversion mechanism: what the visitor does or fails to do because of this, for this specific page and audience.",
            },
            recommendation: {
              type: "string",
              description:
                "The specific change to make. Concrete enough to implement directly without a follow-up question.",
            },
            exampleCopy: {
              type: ["string", "null"],
              description:
                "Ready-to-use replacement wording in the page's voice, if the fix involves copy. Null otherwise. Use clearly-marked placeholders like [X years] for facts you cannot know.",
            },
            effort: { type: "string", enum: ["quick-win", "moderate", "significant"] },
            expectedImpact: { type: "string", enum: ["high", "medium", "low"] },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "How confident you are that this is a real problem for this page.",
            },
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
            "exampleCopy",
            "effort",
            "expectedImpact",
            "confidence",
          ],
        },
      },
    },
    required: ["understanding", "summary", "topOpportunities", "issues"],
  },
};

export interface AiAnalysis {
  understanding: SiteUnderstanding;
  summary: string;
  topOpportunities: string[];
  issues: Issue[];
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

export async function analyzeWithClaude(
  cap: CaptureResult,
  signals: HeuristicSignal[],
  targetUrl: string,
  model: ModelProfile
): Promise<AiAnalysis> {
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

  const response = await client.messages.create({
    model: model.apiModel,
    max_tokens: model.maxTokens,
    system: buildSystemPrompt(model),
    tools: [REPORT_TOOL],
    tool_choice: { type: "tool", name: REPORT_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          ...images,
          { type: "text", text: buildUserPrompt(digest, targetUrl, model) },
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) {
    throw new Error("The analysis model did not return a structured report.");
  }

  const raw = toolUse.input as {
    understanding: SiteUnderstanding;
    summary: string;
    topOpportunities: string[];
    issues: Array<Omit<Issue, "id" | "source">>;
  };

  const issues: Issue[] = (raw.issues ?? []).map((issue, i) => ({
    ...issue,
    category: CATEGORIES.includes(issue.category) ? issue.category : "content-clarity",
    id: slug(issue.title ?? "", i),
    source: "ai",
  }));

  return {
    understanding: raw.understanding,
    summary: raw.summary ?? "",
    topOpportunities: raw.topOpportunities ?? [],
    issues,
  };
}
