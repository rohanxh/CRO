export type Platform = "desktop" | "mobile" | "both";

export type Severity = "critical" | "high" | "medium" | "low";

export type Category =
  | "value-proposition"
  | "call-to-action"
  | "trust-credibility"
  | "forms-friction"
  | "navigation-ia"
  | "mobile-experience"
  | "speed-performance"
  | "content-clarity"
  | "visual-hierarchy"
  | "accessibility"
  | "social-proof"
  | "measurement";

export const CATEGORY_LABELS: Record<Category, string> = {
  "value-proposition": "Value Proposition",
  "call-to-action": "Calls to Action",
  "trust-credibility": "Trust & Credibility",
  "forms-friction": "Forms & Friction",
  "navigation-ia": "Navigation & IA",
  "mobile-experience": "Mobile Experience",
  "speed-performance": "Speed & Performance",
  "content-clarity": "Content Clarity",
  "visual-hierarchy": "Visual Hierarchy",
  accessibility: "Accessibility",
  "social-proof": "Social Proof",
  measurement: "Tracking & Measurement",
};

export type ViewportName = "desktop" | "mobile";

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CtaCandidate {
  text: string;
  tag: string;
  href: string | null;
  box: ElementBox;
  aboveFold: boolean;
  fontSize: number;
  color: string;
  backgroundColor: string;
  contrastRatio: number | null;
  isPrimaryStyled: boolean;
  intent: string | null;
}

export interface FormField {
  type: string;
  name: string;
  label: string | null;
  placeholder: string | null;
  required: boolean;
  autocomplete: string | null;
  hasVisibleLabel: boolean;
  boxHeight: number;
}

export interface FormInfo {
  action: string | null;
  method: string | null;
  fieldCount: number;
  visibleFieldCount: number;
  requiredCount: number;
  fields: FormField[];
  submitText: string | null;
  aboveFold: boolean;
  hasPrivacyNote: boolean;
  multiStepHint: boolean;
}

export interface ImageInfo {
  src: string;
  alt: string | null;
  displayWidth: number;
  displayHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  oversizeFactor: number | null;
  loading: string | null;
  aboveFold: boolean;
  isBackgroundHero: boolean;
}

export interface HeadingInfo {
  level: number;
  text: string;
  aboveFold: boolean;
  fontSize: number;
}

export interface TapTargetIssue {
  text: string;
  tag: string;
  width: number;
  height: number;
}

export interface ContrastIssue {
  text: string;
  tag: string;
  fontSize: number;
  color: string;
  backgroundColor: string;
  ratio: number;
  requiredRatio: number;
}

export interface PerfMetrics {
  ttfb: number | null;
  domContentLoaded: number | null;
  load: number | null;
  fcp: number | null;
  lcp: number | null;
  cls: number | null;
  totalTransferBytes: number;
  requestCount: number;
  imageBytes: number;
  scriptBytes: number;
  fontBytes: number;
  thirdPartyRequestCount: number;
  blockingScriptCount: number;
  blockingStylesheetCount: number;
}

export interface TrustSignals {
  testimonialLike: number;
  reviewStars: boolean;
  ratingMentions: string[];
  guaranteeMentions: string[];
  securityMentions: string[];
  certificationMentions: string[];
  clientLogoStripLikely: boolean;
  caseStudyMentions: number;
  teamOrAboutLink: boolean;
  physicalAddressLikely: boolean;
  phoneNumbers: string[];
  emails: string[];
  socialProfileLinks: string[];
  policyLinks: string[];
}

export interface TrackingSignals {
  ga4: boolean;
  gtm: boolean;
  metaPixel: boolean;
  linkedInInsight: boolean;
  tiktokPixel: boolean;
  clarity: boolean;
  hotjar: boolean;
  chatWidget: string[];
  consentBanner: boolean;
  detectedVendors: string[];
}

export interface FrictionSignals {
  overlayCount: number;
  overlayTexts: string[];
  autoplayVideo: boolean;
  carouselLikely: boolean;
  horizontalOverflowPx: number;
  stickyHeader: boolean;
  stickyCta: boolean;
  navItemCount: number;
  footerLinkCount: number;
  interstitialLikely: boolean;
  scrollDepthToFirstCta: number | null;
  captchaLikely: boolean;
}

export interface CopySignals {
  wordCount: number;
  aboveFoldWordCount: number;
  aboveFoldText: string;
  avgSentenceWords: number;
  longSentenceCount: number;
  jargonHits: string[];
  urgencyHits: string[];
  benefitHits: string[];
  weWeRatio: { we: number; you: number };
  priceMentions: string[];
  smallTextCount: number;
  faqLikely: boolean;
}

export interface ViewportCapture {
  viewport: ViewportName;
  width: number;
  height: number;
  foldScreenshot: string;
  fullScreenshot: string;
  fullPageHeight: number;
  headings: HeadingInfo[];
  ctas: CtaCandidate[];
  forms: FormInfo[];
  images: ImageInfo[];
  trust: TrustSignals;
  tracking: TrackingSignals;
  friction: FrictionSignals;
  copy: CopySignals;
  tapTargetIssues: TapTargetIssue[];
  contrastIssues: ContrastIssue[];
  perf: PerfMetrics;
  consoleErrors: string[];
  failedRequests: string[];
  meta: PageMeta;
}

export interface PageMeta {
  finalUrl: string;
  statusCode: number | null;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  lang: string | null;
  hasViewportMeta: boolean;
  viewportMetaContent: string | null;
  canonical: string | null;
  ogTitle: string | null;
  ogImage: string | null;
  favicon: boolean;
  isHttps: boolean;
  h1Count: number;
  linkCount: number;
  internalLinkCount: number;
  externalLinkCount: number;
  emptyHrefCount: number;
  redirectChain: string[];
  loadErrorText: string | null;
}

export interface HeuristicSignal {
  id: string;
  category: Category;
  platform: Platform;
  severity: Severity;
  title: string;
  detail: string;
  evidence: string;
}

export interface Issue {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  platform: Platform;
  location: string;
  observation: string;
  whyItMatters: string;
  recommendation: string;
  exampleCopy: string | null;
  effort: "quick-win" | "moderate" | "significant";
  expectedImpact: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  source: "rule" | "ai";
}

export interface SiteUnderstanding {
  pageType: string;
  businessModel: string;
  industryGuess: string;
  primaryConversionGoal: string;
  secondaryGoals: string[];
  targetAudience: string;
  valuePropositionAsUnderstood: string;
  clarityVerdict: string;
  fiveSecondTest: string;
}

export interface CategoryScore {
  category: Category;
  score: number;
  /** Share of the page's total conversion damage sitting in this area, 0-100. */
  weight: number;
  issueCount: number;
  worstSeverity: Severity | null;
}

export interface AuditReport {
  url: string;
  finalUrl: string;
  generatedAt: string;
  durationMs: number;
  overallScore: number;
  desktopScore: number;
  mobileScore: number;
  understanding: SiteUnderstanding | null;
  summary: string;
  topOpportunities: string[];
  categoryScores: CategoryScore[];
  issues: Issue[];
  metrics: {
    desktop: PerfMetrics;
    mobile: PerfMetrics;
  };
  screenshots: {
    desktopFold: string;
    mobileFold: string;
    desktopFull: string;
    mobileFull: string;
  };
  meta: PageMeta;
  aiEnabled: boolean;
  aiError: string | null;
  model: { id: string; label: string };
}

export type ProgressEvent =
  | { type: "status"; step: string; message: string; pct: number }
  | { type: "error"; message: string }
  | { type: "report"; report: AuditReport };
