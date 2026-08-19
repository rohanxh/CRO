import type { HeuristicSignal, ViewportCapture } from "../types";
import type { CaptureResult } from "../capture";
import type { ModelProfile } from "./models";

const round = (n: number | null, digits = 0) =>
  n === null ? null : Number(n.toFixed(digits));

function ctaDigest(v: ViewportCapture) {
  const seen = new Set<string>();
  return v.ctas
    .filter((c) => {
      const k = c.text.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 28)
    .map((c) => ({
      text: c.text,
      tag: c.tag,
      intent: c.intent,
      aboveFold: c.aboveFold,
      buttonStyled: c.isPrimaryStyled,
      yPx: c.box.y,
      sizePx: `${c.box.width}x${c.box.height}`,
      fontSize: c.fontSize,
      contrast: c.contrastRatio,
      linksTo: c.href ? c.href.slice(0, 120) : null,
    }));
}

function viewportDigest(v: ViewportCapture) {
  return {
    viewport: v.viewport,
    viewportSize: `${v.width}x${v.height}`,
    fullPageHeightPx: v.fullPageHeight,
    screensTall: Number((v.fullPageHeight / v.height).toFixed(1)),
    aboveTheFoldText: v.copy.aboveFoldText,
    headings: v.headings.slice(0, 40).map((h) => ({
      h: h.level,
      text: h.text,
      aboveFold: h.aboveFold,
      px: h.fontSize,
    })),
    ctas: ctaDigest(v),
    forms: v.forms.map((f) => ({
      visibleFields: f.visibleFieldCount,
      required: f.requiredCount,
      submitText: f.submitText,
      aboveFold: f.aboveFold,
      hasPrivacyNote: f.hasPrivacyNote,
      multiStep: f.multiStepHint,
      fields: f.fields.map((x) => ({
        type: x.type,
        name: x.name,
        label: x.label,
        placeholder: x.placeholder,
        required: x.required,
        labelled: x.hasVisibleLabel,
        heightPx: x.boxHeight,
      })),
    })),
    friction: v.friction,
    copy: {
      wordCount: v.copy.wordCount,
      aboveFoldWordCount: v.copy.aboveFoldWordCount,
      avgSentenceWords: v.copy.avgSentenceWords,
      longSentenceCount: v.copy.longSentenceCount,
      jargon: v.copy.jargonHits,
      urgency: v.copy.urgencyHits,
      specificBenefits: v.copy.benefitHits,
      companyVsCustomerWords: v.copy.weWeRatio,
      priceMentions: v.copy.priceMentions,
      textUnder14px: v.copy.smallTextCount,
      hasFaq: v.copy.faqLikely,
    },
    imagesSummary: {
      count: v.images.length,
      missingAlt: v.images.filter((i) => !i.alt).length,
      oversized: v.images.filter((i) => (i.oversizeFactor ?? 0) > 2).length,
      lazyAboveFold: v.images.filter((i) => i.aboveFold && i.loading === "lazy").length,
    },
    tapTargetIssues: v.tapTargetIssues.slice(0, 12),
    contrastIssues: v.contrastIssues.slice(0, 10),
    performance: {
      ttfbMs: v.perf.ttfb,
      fcpMs: v.perf.fcp,
      lcpMs: v.perf.lcp,
      cls: v.perf.cls,
      requests: v.perf.requestCount,
      thirdPartyRequests: v.perf.thirdPartyRequestCount,
      totalKB: round(v.perf.totalTransferBytes / 1024),
      imageKB: round(v.perf.imageBytes / 1024),
      scriptKB: round(v.perf.scriptBytes / 1024),
      renderBlockingScripts: v.perf.blockingScriptCount,
    },
    consoleErrors: v.consoleErrors.slice(0, 6),
    failedRequests: v.failedRequests.slice(0, 6),
  };
}

export function buildEvidenceDigest(cap: CaptureResult, signals: HeuristicSignal[]) {
  return {
    page: {
      url: cap.desktop.meta.finalUrl,
      statusCode: cap.desktop.meta.statusCode,
      title: cap.desktop.meta.title,
      metaDescription: cap.desktop.meta.metaDescription,
      lang: cap.desktop.meta.lang,
      https: cap.desktop.meta.isHttps,
      hasViewportMeta: cap.desktop.meta.hasViewportMeta,
      h1Count: cap.desktop.meta.h1Count,
      links: {
        total: cap.desktop.meta.linkCount,
        internal: cap.desktop.meta.internalLinkCount,
        external: cap.desktop.meta.externalLinkCount,
        deadOrEmpty: cap.desktop.meta.emptyHrefCount,
      },
      redirectChain: cap.desktop.meta.redirectChain,
    },
    trustSignals: cap.desktop.trust,
    trackingAndTools: cap.desktop.tracking,
    desktop: viewportDigest(cap.desktop),
    mobile: viewportDigest(cap.mobile),
    automatedChecksThatFired: signals.map((s) => ({
      id: s.id,
      severity: s.severity,
      platform: s.platform,
      title: s.title,
      measurement: s.evidence,
    })),
  };
}

const ROLE = `You are a senior conversion rate optimisation (CRO) consultant. You audit a single web page and return a prioritised, specific list of things to fix.

You receive:
1. Four screenshots: desktop above-the-fold, desktop full page, mobile above-the-fold, mobile full page.
2. A structured evidence digest measured from the live page on both a 1440x900 desktop viewport and a 390x844 mobile viewport.
3. A list of automated checks that fired, each with the measurement behind it.`;

const HOW_TO_WORK = `HOW TO WORK

First, understand the page on its own terms. Do not assume an industry or a business model. Read the headline, the copy, the navigation, the calls to action, the form fields and the screenshots, then decide: what is this page, who is it for, what is the one action it wants, and what would a first-time visitor conclude in five seconds. Your advice must fit that conclusion. Advice appropriate for a SaaS trial page is wrong for a local trades quote page, and vice versa. Judge the page against what would work for THIS page's goal and audience.

Then produce findings. A finding is only worth reporting if a competent person could act on it and it plausibly changes conversion rate for this page.`;

const rulesFor = (lo: number, hi: number) => `RULES FOR FINDINGS

- Ground every finding in specific evidence: quote the actual headline, button label, field name, or cite the measured number. Never write a finding that could have been written without looking at this page.
- The automated checks are measurements, not conclusions. Adopt the ones that genuinely matter for this page, and rewrite them in the page's own context with the real quoted content. Silently drop any that are technically true but irrelevant or misleading here, and say so in your summary only if it is important. Do not restate a check verbatim.
- Add findings the automated checks cannot see: visual hierarchy, whether the hero image supports or fights the message, whether the offer is believable, whether the page order matches how someone decides, whether the CTA is the obvious next step, message-to-audience fit, missing content that the page's goal requires, and anything visibly broken or awkward in the screenshots.
- Treat desktop and mobile as separate experiences. Set platform to "mobile" or "desktop" when the issue only exists there, and "both" when it exists on both. Never label something mobile-only if the evidence shows it on desktop too.
- Recommendations must be concrete enough to implement without asking a follow-up question. Say what to change, where, and to what. When the fix is wording, put the suggested wording in exampleCopy, written in the page's own voice and using its real details. Never invent facts, numbers, claims, awards or testimonials the page does not support; if a claim needs a real number the business must supply, write it as a clearly-marked placeholder such as [X years].
- severity is about the size of the conversion damage. critical: actively blocks or loses conversions right now. high: material, measurable loss. medium: worth fixing in the next cycle. low: polish.
- Be honest about strengths. If the page already does something well, do not manufacture a problem with it. It is better to return ${lo} real findings than ${hi} padded ones.
- Return between ${lo} and ${hi} findings, ordered most impactful first. Do not report the same underlying problem twice under different categories.

Write in plain, direct British-neutral English. No marketing language, no filler, no praise for the reader.`;

// A single fully-worked finding. Small models produce far more consistent,
// grounded output when they can pattern-match against one concrete example.
const WORKED_EXAMPLE = `EXAMPLE OF ONE GOOD FINDING

For a page whose H1 reads "Welcome to Ace Plumbing" with a "Contact" link in the top corner and no phone number visible, a good finding looks like this (structure and level of specificity — not wording to copy):

- title: "Headline names the company instead of the offer"
- category: "value-proposition"
- severity: "high"
- platform: "both"
- location: "Hero section, H1"
- observation: "The H1 is \\"Welcome to Ace Plumbing\\". It names the business but not what the visitor gets or why to choose them."
- whyItMatters: "A visitor arriving from a search for emergency plumbing has seconds to decide this page is relevant. A welcome message gives them nothing to act on, so they return to the results."
- whyItMatters continues into recommendation: "Replace the welcome headline with the specific promise: the outcome, the area served, and the speed. Keep the company name for the logo, not the headline."
- exampleCopy: "Emergency plumber in [town] — leaks and blockages fixed same day, no call-out fee"
- effort: "quick-win", expectedImpact: "high", confidence: "high"

Notice: it quotes the real headline, explains the mechanism for THIS visitor, gives a concrete replacement, and marks the town as a placeholder rather than inventing one. Do the same for every finding, grounded in the actual page in front of you.`;

const SMALL_MODEL_DISCIPLINE = `IMPORTANT CONSTRAINTS

- Every finding must quote real text from the page or cite a real measured number from the digest. If you cannot ground a finding in something specific on this page, do not include it.
- Never invent a testimonial, statistic, award, price, or claim. Placeholders in square brackets are the only allowed stand-ins for facts you do not have.
- Do not pad. Fewer, sharper, fully-grounded findings are the goal. Stop when you run out of real ones.
- Call the report_cro_findings tool exactly once. Put everything in that single tool call.`;

export function buildSystemPrompt(model: ModelProfile): string {
  const [lo, hi] = model.findingsRange;
  const parts = [ROLE, HOW_TO_WORK, rulesFor(lo, hi)];
  if (model.includeWorkedExample) {
    parts.push(WORKED_EXAMPLE, SMALL_MODEL_DISCIPLINE);
  }
  return parts.join("\n\n");
}

export function buildUserPrompt(digest: unknown, targetUrl: string, model: ModelProfile) {
  const [lo, hi] = model.findingsRange;
  return `Audit this page for conversion rate optimisation: ${targetUrl}

The four images attached, in order, are:
1. Desktop above the fold (1440x900)
2. Desktop full page
3. Mobile above the fold (390x844, 2x)
4. Mobile full page

Measured evidence digest:

\`\`\`json
${JSON.stringify(digest, null, 1)}
\`\`\`

Work through the page as instructed. Understand what the page is first, then produce ${lo}-${hi} grounded findings ordered most impactful first. Call the \`report_cro_findings\` tool exactly once with your complete audit.`;
}
