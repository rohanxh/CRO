import { readFileSync } from "node:fs";
import path from "node:path";
import type { HeuristicSignal, ViewportCapture } from "../types";
import type { CaptureResult } from "../capture";

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

// The assessment SOP lives in a plain markdown file so it can be read and edited
// without touching code. Read once per server process.
let sopCache: string | null = null;

export function assessmentSop(): string {
  sopCache ??= readFileSync(path.join(process.cwd(), "prompts", "cro-assessment-sop.md"), "utf8");
  return sopCache;
}

export function buildUserPrompt(digest: unknown, targetUrl: string) {
  return `Assess this page for conversion rate optimisation: ${targetUrl}

The four images attached, in order, are:
1. Desktop above the fold (1440x900)
2. Desktop full page
3. Mobile above the fold (390x844, 2x)
4. Mobile full page

Measured evidence digest:

\`\`\`json
${JSON.stringify(digest, null, 1)}
\`\`\`

Follow the SOP step by step, run the self-check, then call \`report_cro_findings\` exactly once.`;
}
