import type {
  Category,
  HeuristicSignal,
  Platform,
  Severity,
  ViewportCapture,
} from "../types";
import type { CaptureResult } from "../capture";

const GENERIC_CTA = /^(submit|send|click here|here|go|next|continue|learn more|read more|more info|more|ok|yes|enter)$/i;

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;
const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

class SignalBag {
  private items: HeuristicSignal[] = [];
  private seen = new Set<string>();

  add(
    id: string,
    category: Category,
    platform: Platform,
    severity: Severity,
    title: string,
    detail: string,
    evidence: string
  ) {
    const key = `${id}:${platform}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push({ id, category, platform, severity, title, detail, evidence });
  }

  all() {
    const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...this.items].sort((a, b) => order[a.severity] - order[b.severity]);
  }
}

function conversionPaths(v: ViewportCapture) {
  const bookingLink = v.ctas.some(
    (c) =>
      c.href &&
      /calendly|acuity|cal\.com|hubspot\.com\/meetings|savvycal|youcanbook|booksy|setmore|squareup\.com\/appointments/i.test(
        c.href
      )
  );
  const telLink = v.ctas.some((c) => c.href?.startsWith("tel:"));
  const mailLink = v.ctas.some((c) => c.href?.startsWith("mailto:"));
  const waLink = v.ctas.some((c) => /wa\.me|api\.whatsapp\.com/i.test(c.href ?? ""));
  const cartCta = v.ctas.some((c) => c.intent === "purchase");
  return {
    bookingLink,
    telLink,
    mailLink,
    waLink,
    cartCta,
    forms: v.forms.length > 0,
    any:
      bookingLink || telLink || mailLink || waLink || cartCta || v.forms.length > 0,
  };
}

function ctaRules(bag: SignalBag, v: ViewportCapture, platform: Platform) {
  const actionable = v.ctas.filter(
    (c) => c.intent && c.intent !== "auth" && c.intent !== "info"
  );
  const primaryAboveFold = v.ctas.filter((c) => c.aboveFold && c.isPrimaryStyled);
  const actionableAboveFold = actionable.filter((c) => c.aboveFold);

  if (actionableAboveFold.length === 0) {
    bag.add(
      "cta-none-above-fold",
      "call-to-action",
      platform,
      "critical",
      "No clear conversion CTA above the fold",
      "Nothing in the first screen asks the visitor to take the primary action. Visitors who do not scroll have no way to convert.",
      primaryAboveFold.length
        ? `Buttons found above the fold, but none read as a conversion action: ${primaryAboveFold
            .slice(0, 4)
            .map((c) => `"${c.text}"`)
            .join(", ")}`
        : "No button-styled elements detected in the first viewport."
    );
  } else if (primaryAboveFold.length === 0) {
    bag.add(
      "cta-not-button-styled",
      "call-to-action",
      platform,
      "high",
      "Above-the-fold CTA is not visually treated as a button",
      "The main action reads as a plain link, so it competes with body text instead of standing out.",
      `Detected: ${actionableAboveFold.slice(0, 3).map((c) => `"${c.text}" (${c.tag})`).join(", ")}`
    );
  }

  const distinctPrimaryLabels = new Set(
    primaryAboveFold
      .filter((c) => c.intent && c.intent !== "auth")
      .map((c) => c.text.toLowerCase())
  );
  if (distinctPrimaryLabels.size >= 4) {
    bag.add(
      "cta-competing",
      "call-to-action",
      platform,
      "medium",
      "Too many competing calls to action above the fold",
      "Four or more differently-labelled prominent buttons in the first screen split attention and reduce clicks on the one that matters.",
      `Labels: ${[...distinctPrimaryLabels].slice(0, 6).map((t) => `"${t}"`).join(", ")}`
    );
  }

  const generic = actionable.filter((c) => GENERIC_CTA.test(c.text.trim()));
  if (generic.length > 0 && actionable.length > 0) {
    bag.add(
      "cta-generic-copy",
      "call-to-action",
      platform,
      "medium",
      "CTA labels are generic rather than outcome-led",
      "Labels that describe the mechanism instead of the outcome convert worse than value-led wording.",
      `Generic labels: ${generic.slice(0, 5).map((c) => `"${c.text}"`).join(", ")}`
    );
  }

  const lowContrast = v.ctas.filter(
    (c) => c.isPrimaryStyled && c.contrastRatio !== null && c.contrastRatio < 3
  );
  if (lowContrast.length) {
    bag.add(
      "cta-low-contrast",
      "call-to-action",
      platform,
      "high",
      "Button text fails contrast against its background",
      "Low-contrast button labels are harder to read, especially outdoors on mobile or on low-quality screens.",
      lowContrast
        .slice(0, 4)
        .map((c) => `"${c.text}" ${c.contrastRatio}:1 (${c.color} on ${c.backgroundColor})`)
        .join("; ")
    );
  }

  const firstCtaY = v.friction.scrollDepthToFirstCta;
  if (firstCtaY !== null && firstCtaY > v.height * 1.5) {
    bag.add(
      "cta-deep-first",
      "call-to-action",
      platform,
      "high",
      "First real CTA sits well below the fold",
      "Most visitors never scroll far enough to reach it, so the page leaks traffic before offering an action.",
      `First conversion button appears ${Math.round(firstCtaY)}px down (${(
        firstCtaY / v.height
      ).toFixed(1)} screens).`
    );
  }

  if (platform === "mobile") {
    const paths = conversionPaths(v);
    if (v.trust.phoneNumbers.length > 0 && !paths.telLink) {
      bag.add(
        "cta-no-click-to-call",
        "mobile-experience",
        "mobile",
        "medium",
        "Phone number is not tappable on mobile",
        "A number rendered as plain text forces visitors to copy it manually, which loses calls.",
        `Numbers on page: ${v.trust.phoneNumbers.slice(0, 3).join(", ")} — no tel: link found.`
      );
    }
    if (!v.friction.stickyCta && (v.fullPageHeight > v.height * 3)) {
      bag.add(
        "cta-no-sticky-mobile",
        "mobile-experience",
        "mobile",
        "medium",
        "No persistent CTA on a long mobile page",
        "On a page this long, a sticky bottom bar keeps the action reachable at any scroll position.",
        `Page is ${(v.fullPageHeight / v.height).toFixed(1)} screens tall with no fixed bottom CTA.`
      );
    }
  }
}

function valuePropRules(bag: SignalBag, v: ViewportCapture, platform: Platform) {
  const h1s = v.headings.filter((h) => h.level === 1);
  if (v.meta.h1Count === 0) {
    bag.add(
      "vp-no-h1",
      "value-proposition",
      platform,
      "high",
      "Page has no visible H1",
      "Without a single dominant headline, visitors have to work out what the page offers from secondary cues.",
      "No visible <h1> element found."
    );
  } else if (v.meta.h1Count > 2) {
    bag.add(
      "vp-many-h1",
      "value-proposition",
      platform,
      "low",
      "Multiple H1s dilute the headline",
      "More than one top-level headline makes it ambiguous which message is the main promise.",
      `${v.meta.h1Count} H1 elements: ${h1s.slice(0, 3).map((h) => `"${h.text}"`).join(", ")}`
    );
  }

  const h1 = h1s[0];
  if (h1 && h1.text.replace(/\s+/g, "").length < 12) {
    bag.add(
      "vp-thin-h1",
      "value-proposition",
      platform,
      "medium",
      "Headline is too short to communicate a value proposition",
      "A very short headline usually names the brand or category instead of the benefit the visitor gets.",
      `H1: "${h1.text}"`
    );
  }
  if (h1 && h1.text.length > 110) {
    bag.add(
      "vp-long-h1",
      "value-proposition",
      platform,
      "low",
      "Headline is long enough to be skipped",
      "Long headlines are scanned rather than read, so the promise gets lost.",
      `H1 is ${h1.text.length} characters.`
    );
  }
  if (!h1s.some((h) => h.aboveFold) && v.meta.h1Count > 0) {
    bag.add(
      "vp-h1-below-fold",
      "value-proposition",
      platform,
      "high",
      "Main headline is not visible without scrolling",
      "The first screen carries the most attention; if the promise is below it, most visitors never see it.",
      "H1 exists but starts below the first viewport."
    );
  }

  if (v.copy.aboveFoldWordCount < 12) {
    bag.add(
      "vp-sparse-fold",
      "value-proposition",
      platform,
      "high",
      "First screen carries almost no explanatory copy",
      "Visitors decide in a few seconds whether the page is relevant. With this little text there is nothing to decide on.",
      `Only ${v.copy.aboveFoldWordCount} words above the fold.`
    );
  } else if (v.copy.aboveFoldWordCount > 170) {
    bag.add(
      "vp-dense-fold",
      "value-proposition",
      platform,
      "medium",
      "First screen is text-heavy",
      "A wall of copy in the hero slows comprehension and pushes the CTA out of view.",
      `${v.copy.aboveFoldWordCount} words above the fold.`
    );
  }

  if (!v.meta.title) {
    bag.add(
      "vp-no-title",
      "value-proposition",
      "both",
      "medium",
      "Page has no title tag",
      "The title is the first thing seen in search results and browser tabs, and it sets expectations before the click.",
      "Missing <title>."
    );
  } else if (v.meta.titleLength > 65) {
    bag.add(
      "vp-long-title",
      "value-proposition",
      "both",
      "low",
      "Title tag will be truncated in search results",
      "A cut-off title hides the part of the promise that earns the click.",
      `Title is ${v.meta.titleLength} characters: "${v.meta.title}"`
    );
  }
  if (!v.meta.metaDescription) {
    bag.add(
      "vp-no-meta-desc",
      "value-proposition",
      "both",
      "low",
      "No meta description",
      "Search engines and social shares fall back to arbitrary page text, weakening pre-click messaging.",
      "Missing meta description."
    );
  }
}

function trustRules(bag: SignalBag, v: ViewportCapture) {
  const t = v.trust;

  if (!v.meta.isHttps) {
    bag.add(
      "trust-no-https",
      "trust-credibility",
      "both",
      "critical",
      "Site is served over plain HTTP",
      "Browsers label the page as Not Secure, which stops visitors submitting forms or payment details.",
      `Final URL: ${v.meta.finalUrl}`
    );
  }

  const socialProofScore =
    (t.testimonialLike > 0 ? 1 : 0) +
    (t.reviewStars ? 1 : 0) +
    (t.ratingMentions.length ? 1 : 0) +
    (t.clientLogoStripLikely ? 1 : 0) +
    (t.caseStudyMentions > 0 ? 1 : 0);

  if (socialProofScore === 0) {
    bag.add(
      "trust-no-social-proof",
      "social-proof",
      "both",
      "high",
      "No social proof anywhere on the page",
      "Visitors use other people's experience to de-risk a decision. With none, every claim on the page rests on the brand's own word.",
      "No testimonials, star ratings, review counts, client logos or case studies detected."
    );
  } else if (socialProofScore === 1) {
    bag.add(
      "trust-thin-social-proof",
      "social-proof",
      "both",
      "medium",
      "Social proof is present but thin",
      "One type of proof is easy to discount. Layering different kinds (named reviews, counts, logos, results) compounds credibility.",
      `Only one proof type detected. Testimonial blocks: ${t.testimonialLike}, stars: ${t.reviewStars}, ratings: ${t.ratingMentions.length}, logo strip: ${t.clientLogoStripLikely}, case studies: ${t.caseStudyMentions}.`
    );
  }

  if (t.testimonialLike > 0 && !t.reviewStars && t.ratingMentions.length === 0) {
    bag.add(
      "trust-unquantified-proof",
      "social-proof",
      "both",
      "low",
      "Testimonials are not backed by ratings or numbers",
      "Quantified proof (a 4.8 average, a review count, a measurable result) is harder to dismiss than a quote alone.",
      `${t.testimonialLike} testimonial-like blocks, no rating or review-count language found.`
    );
  }

  if (t.guaranteeMentions.length === 0) {
    bag.add(
      "trust-no-risk-reversal",
      "trust-credibility",
      "both",
      "medium",
      "No risk reversal offered",
      "A guarantee, free trial, no-obligation quote or cancel-anytime promise removes the main reason to delay.",
      "No guarantee, warranty, refund or risk-free language detected."
    );
  }

  if (t.certificationMentions.length === 0 && t.securityMentions.length === 0) {
    bag.add(
      "trust-no-credentials",
      "trust-credibility",
      "both",
      "medium",
      "No credentials, accreditations or security signals",
      "Third-party validation substitutes for trust the visitor does not yet have in the brand.",
      "No licence, insurance, certification, award or security language detected."
    );
  }

  if (t.phoneNumbers.length === 0 && t.emails.length === 0) {
    bag.add(
      "trust-no-contact",
      "trust-credibility",
      "both",
      "high",
      "No phone number or email address on the page",
      "Visible contact details are one of the strongest legitimacy signals, and some visitors will only convert by phone.",
      "No tel: link, mailto: link, phone pattern or email address found."
    );
  }

  if (!t.physicalAddressLikely) {
    bag.add(
      "trust-no-address",
      "trust-credibility",
      "both",
      "low",
      "No physical address or location detected",
      "A real address proves the business exists somewhere, which matters more for local and high-ticket purchases.",
      "No <address> element or street/postcode pattern found."
    );
  }

  if (t.policyLinks.length === 0) {
    bag.add(
      "trust-no-policies",
      "trust-credibility",
      "both",
      "medium",
      "No privacy policy or terms links",
      "Missing policy links undermine credibility and cause problems for paid traffic, since ad platforms require them.",
      "No links matching privacy, terms, refund or cookie policy."
    );
  }

  if (t.socialProfileLinks.length === 0) {
    bag.add(
      "trust-no-social-links",
      "trust-credibility",
      "both",
      "low",
      "No links to social or review profiles",
      "Active profiles let sceptical visitors verify the business independently.",
      "No links to social networks or review platforms found."
    );
  }
}

function formRules(bag: SignalBag, v: ViewportCapture, platform: Platform) {
  const paths = conversionPaths(v);

  if (!paths.any) {
    bag.add(
      "form-no-conversion-path",
      "forms-friction",
      platform,
      "critical",
      "Page offers no way to convert",
      "There is no form, no tappable phone number, no booking link and no purchase action, so interested visitors have nowhere to go.",
      "No form, tel:, mailto:, WhatsApp, booking or cart action detected."
    );
    return;
  }

  for (const [idx, f] of v.forms.slice(0, 4).entries()) {
    const n = v.forms.length > 1 ? ` (form ${idx + 1})` : "";

    if (f.visibleFieldCount > 6) {
      bag.add(
        `form-too-many-fields-${idx}`,
        "forms-friction",
        platform,
        f.visibleFieldCount > 10 ? "high" : "medium",
        `Form asks for ${f.visibleFieldCount} fields${n}`,
        "Each extra field costs completions. Ask only for what is needed to make the next contact, and collect the rest later.",
        `Fields: ${f.fields.map((x) => x.name || x.type).slice(0, 12).join(", ")}`
      );
    }

    const unlabelled = f.fields.filter((x) => !x.hasVisibleLabel);
    if (unlabelled.length > 0) {
      bag.add(
        `form-no-labels-${idx}`,
        "forms-friction",
        platform,
        unlabelled.length === f.fields.length ? "medium" : "low",
        `${unlabelled.length} form field${unlabelled.length === 1 ? "" : "s"} have no label${n}`,
        "Placeholder-only fields disappear once typing starts, which causes mistakes and abandoned forms, and they are invisible to screen readers.",
        `Unlabelled: ${unlabelled.map((x) => x.name || x.type).slice(0, 8).join(", ")}`
      );
    }

    const missingAutocomplete = f.fields.filter(
      (x) =>
        !x.autocomplete &&
        ["text", "email", "tel", "number"].includes(x.type) &&
        /name|email|phone|tel|mobile|address|zip|post|city|company/i.test(x.name)
    );
    if (missingAutocomplete.length >= 2) {
      bag.add(
        `form-no-autocomplete-${idx}`,
        "forms-friction",
        platform,
        "low",
        `Form fields do not support browser autofill${n}`,
        "Autofill removes most of the typing on mobile, which is where forms are abandoned most.",
        `Missing autocomplete: ${missingAutocomplete.map((x) => x.name).slice(0, 8).join(", ")}`
      );
    }

    if (!f.hasPrivacyNote) {
      bag.add(
        `form-no-reassurance-${idx}`,
        "forms-friction",
        platform,
        "medium",
        `No reassurance next to the form${n}`,
        "A one-line promise about what happens to the data, and what happens next, reduces hesitation at the point of submission.",
        "No privacy, no-spam, unsubscribe or security wording inside the form."
      );
    }

    if (f.submitText && GENERIC_CTA.test(f.submitText.trim())) {
      bag.add(
        `form-generic-submit-${idx}`,
        "forms-friction",
        platform,
        "medium",
        `Submit button says "${f.submitText}"${n}`,
        "Restating the outcome on the button, such as \"Get my free quote\", converts better than naming the mechanism.",
        `Submit label: "${f.submitText}"`
      );
    }

    if (f.action && f.action.startsWith("http://")) {
      bag.add(
        `form-insecure-action-${idx}`,
        "forms-friction",
        "both",
        "critical",
        `Form submits over unencrypted HTTP${n}`,
        "Browsers warn on insecure form submission and the data is exposed in transit.",
        `Form action: ${f.action}`
      );
    }

    if (platform === "mobile") {
      const short = f.fields.filter((x) => x.boxHeight > 0 && x.boxHeight < 40);
      if (short.length) {
        bag.add(
          `form-small-inputs-${idx}`,
          "mobile-experience",
          "mobile",
          "medium",
          `Form inputs are too small to tap comfortably${n}`,
          "Inputs under roughly 44px tall are fiddly on a phone and increase mis-taps mid-form.",
          `${short.length} inputs under 40px tall (smallest ${Math.min(
            ...short.map((s) => s.boxHeight)
          )}px).`
        );
      }
      const wrongKeyboard = f.fields.filter(
        (x) =>
          x.type === "text" &&
          /email|phone|tel|mobile|zip|post|number|qty/i.test(x.name + " " + (x.label ?? ""))
      );
      if (wrongKeyboard.length) {
        bag.add(
          `form-wrong-input-type-${idx}`,
          "mobile-experience",
          "mobile",
          "medium",
          `Fields use the wrong mobile keyboard${n}`,
          "Using type=email or type=tel brings up the right keyboard and cuts typing errors on phones.",
          `Generic text inputs that should be typed: ${wrongKeyboard
            .map((x) => x.name || x.label)
            .slice(0, 6)
            .join(", ")}`
        );
      }
    }

    if (!f.aboveFold && v.forms.length === 1 && !paths.telLink && !paths.bookingLink) {
      bag.add(
        `form-below-fold-${idx}`,
        "forms-friction",
        platform,
        "low",
        `The only form is below the fold${n}`,
        "For pages whose single job is lead capture, an above-the-fold form or an anchor button that jumps to it lifts submissions.",
        "Form starts below the first viewport and there is no alternative instant action above it."
      );
    }
  }

  if (v.friction.captchaLikely) {
    bag.add(
      "form-captcha",
      "forms-friction",
      platform,
      "low",
      "A visible CAPTCHA guards the form",
      "Interactive CAPTCHAs measurably reduce completions. Invisible alternatives such as reCAPTCHA v3, Turnstile or a honeypot field keep the spam protection without the friction.",
      "reCAPTCHA, hCaptcha or Turnstile iframe present."
    );
  }
}

function navigationRules(bag: SignalBag, v: ViewportCapture, platform: Platform) {
  if (v.friction.navItemCount > 8) {
    bag.add(
      "nav-too-many-items",
      "navigation-ia",
      platform,
      "medium",
      `Primary navigation has ${v.friction.navItemCount} links`,
      "Every navigation link is an exit route. Trimming the top level, or hiding secondary items in a menu, keeps attention on the conversion path.",
      `${v.friction.navItemCount} visible links in the header navigation.`
    );
  }
  if (v.friction.footerLinkCount > 60) {
    bag.add(
      "nav-bloated-footer",
      "navigation-ia",
      platform,
      "low",
      `Footer contains ${v.friction.footerLinkCount} links`,
      "A very large footer buries the things visitors actually look for there: contact details, hours, and policies.",
      `${v.friction.footerLinkCount} visible footer links.`
    );
  }
  if (v.meta.emptyHrefCount > 5) {
    bag.add(
      "nav-dead-links",
      "navigation-ia",
      platform,
      "low",
      `${v.meta.emptyHrefCount} links go nowhere`,
      "Links with href=\"#\" or javascript: look clickable but do nothing, which erodes confidence in the rest of the page.",
      `${v.meta.emptyHrefCount} anchors with empty, "#" or javascript: hrefs.`
    );
  }
  if (!v.friction.stickyHeader && v.fullPageHeight > v.height * 4) {
    bag.add(
      "nav-no-sticky-header",
      "navigation-ia",
      platform,
      "low",
      "Long page with no sticky header",
      "On a page this tall, keeping the logo and main action pinned saves visitors from scrolling back up.",
      `Page is ${(v.fullPageHeight / v.height).toFixed(1)} screens tall.`
    );
  }
}

function mobileRules(bag: SignalBag, v: ViewportCapture) {
  if (!v.meta.hasViewportMeta) {
    bag.add(
      "mob-no-viewport-meta",
      "mobile-experience",
      "mobile",
      "critical",
      "No responsive viewport meta tag",
      "Without it phones render the desktop layout zoomed out, so text is unreadable and buttons are unusable.",
      "Missing <meta name=\"viewport\">."
    );
  } else if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(v.meta.viewportMetaContent ?? "")) {
    bag.add(
      "mob-zoom-disabled",
      "accessibility",
      "mobile",
      "medium",
      "Pinch-to-zoom is disabled",
      "Blocking zoom locks out anyone who needs to enlarge small text or images to complete the task.",
      `viewport: ${v.meta.viewportMetaContent}`
    );
  }

  if (v.friction.horizontalOverflowPx > 5) {
    bag.add(
      "mob-horizontal-scroll",
      "mobile-experience",
      "mobile",
      "high",
      "Page scrolls sideways on mobile",
      "Horizontal overflow makes the layout feel broken and can push CTAs off screen entirely.",
      `Content is ${v.friction.horizontalOverflowPx}px wider than the ${v.width}px viewport.`
    );
  }

  if (v.tapTargetIssues.length >= 3) {
    const worst = v.tapTargetIssues
      .slice()
      .sort((a, b) => a.width * a.height - b.width * b.height)
      .slice(0, 4);
    bag.add(
      "mob-small-tap-targets",
      "mobile-experience",
      "mobile",
      v.tapTargetIssues.length >= 8 ? "high" : "medium",
      `${v.tapTargetIssues.length} tap targets are smaller than 44px`,
      "Undersized controls cause mis-taps, and a mis-tap on a conversion element often ends the visit.",
      worst.map((t) => `"${t.text}" ${t.width}×${t.height}px`).join("; ")
    );
  }

  if (v.copy.smallTextCount >= 8) {
    bag.add(
      "mob-small-text",
      "mobile-experience",
      "mobile",
      "medium",
      "Body text is smaller than 14px in places",
      "Small type on a phone forces zooming, and most visitors will simply skip the copy instead.",
      `${v.copy.smallTextCount} text elements render below 14px.`
    );
  }
}

function perfRules(bag: SignalBag, v: ViewportCapture, platform: Platform) {
  const p = v.perf;

  if (p.lcp !== null) {
    if (p.lcp > 4000) {
      bag.add(
        "perf-lcp-poor",
        "speed-performance",
        platform,
        "critical",
        `Largest Contentful Paint is ${(p.lcp / 1000).toFixed(1)}s`,
        "The main content takes far too long to appear. Bounce rate climbs sharply past about 3 seconds, so this suppresses every downstream metric.",
        `LCP ${p.lcp}ms (good is under 2500ms).`
      );
    } else if (p.lcp > 2500) {
      bag.add(
        "perf-lcp-needs-work",
        "speed-performance",
        platform,
        "high",
        `Largest Contentful Paint is ${(p.lcp / 1000).toFixed(1)}s`,
        "Above the 2.5s threshold, so a measurable share of visitors leave before seeing the offer.",
        `LCP ${p.lcp}ms (good is under 2500ms).`
      );
    }
  }

  if (p.cls !== null) {
    if (p.cls > 0.25) {
      bag.add(
        "perf-cls-poor",
        "speed-performance",
        platform,
        "high",
        `Layout shifts badly while loading (CLS ${p.cls})`,
        "Content jumping under the cursor causes accidental taps on the wrong element, which is especially damaging near buttons and forms.",
        `CLS ${p.cls} (good is under 0.1).`
      );
    } else if (p.cls > 0.1) {
      bag.add(
        "perf-cls-needs-work",
        "speed-performance",
        platform,
        "medium",
        `Some layout shift while loading (CLS ${p.cls})`,
        "Minor jumps still cause mis-taps on mobile. Reserving space for images, ads and embeds fixes most of it.",
        `CLS ${p.cls} (good is under 0.1).`
      );
    }
  }

  if (p.ttfb !== null && p.ttfb > 800) {
    bag.add(
      "perf-slow-ttfb",
      "speed-performance",
      platform,
      p.ttfb > 1800 ? "high" : "medium",
      `Server takes ${p.ttfb}ms to respond`,
      "Everything else waits on the first byte, so this delay is added to every visitor's experience.",
      `TTFB ${p.ttfb}ms (good is under 800ms).`
    );
  }

  if (p.totalTransferBytes > 3 * 1024 * 1024) {
    bag.add(
      "perf-heavy-page",
      "speed-performance",
      platform,
      p.totalTransferBytes > 6 * 1024 * 1024 ? "high" : "medium",
      `Page weighs ${mb(p.totalTransferBytes)}`,
      "Heavy pages punish visitors on mobile data and slow connections, which is a large share of traffic for most sites.",
      `${p.requestCount} requests, ${mb(p.totalTransferBytes)} transferred (images ${kb(
        p.imageBytes
      )}, scripts ${kb(p.scriptBytes)}).`
    );
  }

  if (p.imageBytes > 1.5 * 1024 * 1024) {
    bag.add(
      "perf-heavy-images",
      "speed-performance",
      platform,
      "medium",
      `Images account for ${mb(p.imageBytes)}`,
      "Serving modern formats at the size actually displayed usually cuts this by 60-80% with no visible quality loss.",
      `Image payload ${kb(p.imageBytes)} of ${kb(p.totalTransferBytes)} total.`
    );
  }

  const oversized = v.images.filter((i) => (i.oversizeFactor ?? 0) > 2);
  if (oversized.length >= 3) {
    bag.add(
      "perf-oversized-images",
      "speed-performance",
      platform,
      "medium",
      `${oversized.length} images are served far larger than displayed`,
      "The browser downloads the full file and then throws away most of the pixels, wasting the visitor's bandwidth.",
      oversized
        .slice(0, 4)
        .map(
          (i) =>
            `${i.naturalWidth}px served into a ${i.displayWidth}px slot (${i.oversizeFactor}×)`
        )
        .join("; ")
    );
  }

  const lazyAboveFold = v.images.filter((i) => i.aboveFold && i.loading === "lazy");
  if (lazyAboveFold.length) {
    bag.add(
      "perf-lazy-hero",
      "speed-performance",
      platform,
      "medium",
      "Above-the-fold images are lazy-loaded",
      "Lazy-loading the hero image delays the very thing that defines LCP, making the page feel slower than it is.",
      `${lazyAboveFold.length} image(s) above the fold with loading="lazy".`
    );
  }

  const eagerBelowFold = v.images.filter((i) => !i.aboveFold && i.loading !== "lazy");
  if (eagerBelowFold.length >= 8) {
    bag.add(
      "perf-no-lazy-loading",
      "speed-performance",
      platform,
      "low",
      `${eagerBelowFold.length} below-the-fold images load immediately`,
      "Deferring off-screen images frees bandwidth for the content the visitor is actually looking at.",
      `${eagerBelowFold.length} images below the fold without loading="lazy".`
    );
  }

  if (p.blockingScriptCount >= 3) {
    bag.add(
      "perf-blocking-scripts",
      "speed-performance",
      platform,
      "medium",
      `${p.blockingScriptCount} scripts block rendering`,
      "Each synchronous script pauses page construction. Adding defer or async to non-critical scripts is usually a one-line fix.",
      `${p.blockingScriptCount} <script src> tags without async or defer.`
    );
  }

  if (p.blockingStylesheetCount > 8) {
    bag.add(
      "perf-blocking-stylesheets",
      "speed-performance",
      platform,
      p.blockingStylesheetCount > 25 ? "high" : "medium",
      `${p.blockingStylesheetCount} stylesheets block the first paint`,
      "The browser cannot show anything until every one of these downloads. Bundling them, or inlining the styles the first screen needs, removes the delay before the page appears.",
      `${p.blockingStylesheetCount} render-blocking <link rel="stylesheet"> tags.`
    );
  }

  if (p.thirdPartyRequestCount > 40) {
    bag.add(
      "perf-third-party-bloat",
      "speed-performance",
      platform,
      "medium",
      `${p.thirdPartyRequestCount} requests go to third-party domains`,
      "Third-party tags are the most common cause of slow, unpredictable load times, and each one is a dependency you do not control.",
      `${p.thirdPartyRequestCount} of ${p.requestCount} requests are cross-origin.`
    );
  }

  if (v.failedRequests.length >= 2) {
    bag.add(
      "perf-failed-requests",
      "speed-performance",
      platform,
      "medium",
      `${v.failedRequests.length} requests failed or returned an error`,
      "Broken assets can silently remove images, styling or form handling, and any of those can block a conversion.",
      v.failedRequests.slice(0, 4).join(" | ")
    );
  }

  if (v.consoleErrors.length >= 3) {
    bag.add(
      "perf-js-errors",
      "speed-performance",
      platform,
      "high",
      `${v.consoleErrors.length} JavaScript errors on load`,
      "Script errors frequently break exactly the interactive parts that matter: validation, submit handlers, sliders and modals.",
      v.consoleErrors.slice(0, 3).join(" | ")
    );
  }
}

function contentRules(bag: SignalBag, v: ViewportCapture) {
  const c = v.copy;

  if (c.longSentenceCount >= 5) {
    bag.add(
      "copy-long-sentences",
      "content-clarity",
      "both",
      "medium",
      `${c.longSentenceCount} sentences run past 28 words`,
      "Long sentences slow scanning. Shorter ones let visitors extract the point without reading every word.",
      `Average sentence length ${c.avgSentenceWords} words.`
    );
  }

  if (c.jargonHits.length >= 3) {
    bag.add(
      "copy-jargon",
      "content-clarity",
      "both",
      "medium",
      "Copy leans on filler and jargon",
      "Interchangeable corporate language gives visitors nothing concrete to believe or compare.",
      `Detected: ${c.jargonHits.slice(0, 6).join(", ")}`
    );
  }

  if (c.weWeRatio.you > 0 && c.weWeRatio.we > c.weWeRatio.you * 2) {
    bag.add(
      "copy-inward-facing",
      "content-clarity",
      "both",
      "medium",
      "Copy talks about the company more than the customer",
      "Customer-framed copy (\"you get\") outperforms company-framed copy (\"we provide\") because it makes the benefit concrete.",
      `"we/our/us" appears ${c.weWeRatio.we} times vs "you/your" ${c.weWeRatio.you} times.`
    );
  } else if (c.weWeRatio.you === 0 && c.wordCount > 150) {
    bag.add(
      "copy-no-second-person",
      "content-clarity",
      "both",
      "medium",
      "Copy never addresses the visitor directly",
      "Second-person copy is easier to relate to and consistently outperforms impersonal description.",
      `No occurrences of "you" or "your" in ${c.wordCount} words.`
    );
  }

  if (c.benefitHits.length === 0 && c.wordCount > 120) {
    bag.add(
      "copy-no-specifics",
      "content-clarity",
      "both",
      "medium",
      "No specific, checkable benefits",
      "Numbers, timeframes and inclusions are what make a promise believable. Without them the page reads as generic.",
      "No pricing, timeframe, percentage or \"free x\" specifics detected."
    );
  }

  if (!c.faqLikely && c.wordCount > 250) {
    bag.add(
      "copy-no-objection-handling",
      "content-clarity",
      "both",
      "low",
      "No FAQ or objection handling section",
      "Answering the three or four questions that stop people buying removes the reason to leave and \"think about it\".",
      "No FAQ heading, accordion or details elements found."
    );
  }

  if (c.priceMentions.length === 0 && c.wordCount > 150) {
    bag.add(
      "copy-no-price-signal",
      "content-clarity",
      "both",
      "low",
      "No pricing information or price framing",
      "Even a range, a starting-from figure or an explanation of what drives cost stops visitors leaving to find out elsewhere.",
      "No currency or price pattern found on the page."
    );
  }
}

function frictionRules(bag: SignalBag, v: ViewportCapture, platform: Platform) {
  const f = v.friction;

  if (f.interstitialLikely) {
    bag.add(
      "fric-interstitial",
      "forms-friction",
      platform,
      "high",
      "A full-screen overlay covers the page on arrival",
      "An interstitial before the visitor has seen anything is the highest-friction pattern there is, and on mobile it can also hurt search rankings.",
      f.overlayTexts[0] ? `Overlay content: "${f.overlayTexts[0]}"` : "Overlay covers over 60% of the viewport."
    );
  } else if (f.overlayCount >= 2) {
    bag.add(
      "fric-stacked-overlays",
      "forms-friction",
      platform,
      "medium",
      `${f.overlayCount} overlays compete for attention`,
      "A cookie banner plus a promo popup plus a chat bubble can hide the CTA entirely on a small screen.",
      f.overlayTexts.map((t) => `"${t.slice(0, 80)}"`).join("; ")
    );
  }

  if (f.autoplayVideo) {
    bag.add(
      "fric-autoplay-video",
      "speed-performance",
      platform,
      "medium",
      "Video autoplays on load",
      "Autoplay competes with the headline for attention and consumes bandwidth before the page is usable.",
      "A <video autoplay> element is present."
    );
  }

  if (f.carouselLikely) {
    bag.add(
      "fric-hero-carousel",
      "visual-hierarchy",
      platform,
      "low",
      "Page uses a carousel or slider",
      "Rotating messages get treated as advertising and mostly go unseen past the first slide. A single strongest message usually wins.",
      "Carousel/slider markup detected."
    );
  }
}

function accessibilityRules(bag: SignalBag, v: ViewportCapture) {
  const missingAlt = v.images.filter((i) => i.alt === null || i.alt.trim() === "");
  const meaningful = missingAlt.filter((i) => i.displayWidth > 60 && i.displayHeight > 60);
  if (meaningful.length >= 3) {
    bag.add(
      "a11y-missing-alt",
      "accessibility",
      "both",
      "medium",
      `${meaningful.length} content images have no alt text`,
      "Alt text is what screen-reader users get instead of the image, and it is also the fallback when an image fails to load.",
      `${meaningful.length} of ${v.images.length} images missing meaningful alt attributes.`
    );
  }

  if (v.contrastIssues.length >= 3) {
    bag.add(
      "a11y-contrast",
      "accessibility",
      "both",
      v.contrastIssues.length >= 8 ? "high" : "medium",
      `${v.contrastIssues.length} text styles fail WCAG contrast`,
      "Low-contrast text is skipped rather than read, which quietly removes the arguments that would have persuaded the visitor.",
      v.contrastIssues
        .slice(0, 4)
        .map((c) => `${c.ratio}:1 needs ${c.requiredRatio}:1 — "${c.text.slice(0, 40)}"`)
        .join("; ")
    );
  }

  if (!v.meta.lang) {
    bag.add(
      "a11y-no-lang",
      "accessibility",
      "both",
      "low",
      "No lang attribute on the page",
      "Screen readers use it to choose pronunciation, and browsers use it to offer translation.",
      "Missing lang on <html>."
    );
  }
}

function measurementRules(bag: SignalBag, v: ViewportCapture) {
  const t = v.tracking;

  if (!t.ga4 && !t.gtm && t.detectedVendors.length === 0) {
    bag.add(
      "meas-no-analytics",
      "measurement",
      "both",
      "high",
      "No analytics detected",
      "Without measurement there is no way to know which changes help, so every optimisation becomes guesswork.",
      "No analytics or tag manager script found."
    );
  } else if (!t.ga4 && !t.gtm) {
    bag.add(
      "meas-no-primary-analytics",
      "measurement",
      "both",
      "medium",
      "No GA4 or tag manager found",
      "Third-party tags are present but the core analytics layer is missing, which makes conversion reporting unreliable.",
      `Detected instead: ${t.detectedVendors.slice(0, 6).join(", ")}`
    );
  }

  if (!t.clarity && !t.hotjar) {
    bag.add(
      "meas-no-behaviour-tool",
      "measurement",
      "both",
      "low",
      "No heatmap or session recording tool",
      "Recordings and scroll maps show where visitors actually stall, which is how you find issues analytics cannot explain.",
      "No Clarity, Hotjar or comparable behaviour tool detected."
    );
  }

  if (t.chatWidget.length === 0) {
    bag.add(
      "meas-no-live-contact",
      "trust-credibility",
      "both",
      "low",
      "No chat or instant-contact option",
      "A low-commitment way to ask one question captures visitors who are interested but not ready to fill in a form.",
      "No chat widget or WhatsApp link detected."
    );
  }

  if (t.consentBanner && !t.gtm) {
    bag.add(
      "meas-consent-without-tms",
      "measurement",
      "both",
      "low",
      "Consent banner without a tag manager",
      "Managing consent outside a tag manager usually means tags fire before consent, or analytics data goes missing entirely.",
      "Consent/cookie UI present, no GTM container found."
    );
  }
}

function crossViewportRules(bag: SignalBag, cap: CaptureResult) {
  const d = cap.desktop;
  const m = cap.mobile;

  const dText = d.copy.wordCount;
  const mText = m.copy.wordCount;
  if (dText > 0 && mText < dText * 0.6) {
    bag.add(
      "xv-content-hidden-mobile",
      "mobile-experience",
      "mobile",
      "medium",
      "Mobile shows substantially less content than desktop",
      "Hiding copy on mobile removes the persuasion, not the friction. Mobile visitors usually need more reassurance, not less.",
      `Desktop ${dText} words vs mobile ${mText} words (${Math.round(
        (1 - mText / dText) * 100
      )}% less).`
    );
  }

  const dCtas = new Set(
    d.ctas.filter((c) => c.intent && c.isPrimaryStyled).map((c) => c.text.toLowerCase())
  );
  const mCtas = new Set(
    m.ctas.filter((c) => c.intent && c.isPrimaryStyled).map((c) => c.text.toLowerCase())
  );
  const missingOnMobile = [...dCtas].filter((t) => !mCtas.has(t));
  if (dCtas.size > 0 && missingOnMobile.length >= 2) {
    bag.add(
      "xv-cta-missing-mobile",
      "mobile-experience",
      "mobile",
      "high",
      "Some CTAs present on desktop are missing on mobile",
      "Actions dropped from the mobile layout cannot be taken by the majority of visitors.",
      `Missing on mobile: ${missingOnMobile.slice(0, 4).map((t) => `"${t}"`).join(", ")}`
    );
  }

  const dLcp = d.perf.lcp;
  const mLcp = m.perf.lcp;
  if (dLcp && mLcp && mLcp > dLcp * 1.8 && mLcp > 2500) {
    bag.add(
      "xv-mobile-much-slower",
      "speed-performance",
      "mobile",
      "high",
      "Mobile loads far slower than desktop",
      "The mobile experience is where most traffic lands, so a gap this size costs more conversions than the desktop numbers suggest.",
      `LCP: desktop ${dLcp}ms vs mobile ${mLcp}ms.`
    );
  }

  const dFold = d.ctas.filter((c) => c.aboveFold && c.intent).length;
  const mFold = m.ctas.filter((c) => c.aboveFold && c.intent).length;
  if (dFold > 0 && mFold === 0) {
    bag.add(
      "xv-fold-cta-lost-mobile",
      "mobile-experience",
      "mobile",
      "critical",
      "The above-the-fold CTA disappears on mobile",
      "Stacking pushes the action off the first screen on phones, so the visitors most likely to bounce never see it.",
      `${dFold} conversion CTA(s) above the fold on desktop, none on mobile.`
    );
  }
}

/** A check that fired identically on desktop and mobile is one issue affecting both, not two. */
function mergeAcrossPlatforms(signals: HeuristicSignal[]): HeuristicSignal[] {
  const byId = new Map<string, HeuristicSignal[]>();
  for (const s of signals) {
    const list = byId.get(s.id);
    if (list) list.push(s);
    else byId.set(s.id, [s]);
  }

  const merged: HeuristicSignal[] = [];
  for (const group of byId.values()) {
    const desktop = group.find((s) => s.platform === "desktop");
    const mobile = group.find((s) => s.platform === "mobile");

    if (desktop && mobile) {
      const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      const worst = order[desktop.severity] <= order[mobile.severity] ? desktop : mobile;
      merged.push({
        ...worst,
        platform: "both",
        evidence:
          desktop.evidence === mobile.evidence
            ? desktop.evidence
            : `Desktop: ${desktop.evidence} Mobile: ${mobile.evidence}`,
      });
      merged.push(...group.filter((s) => s !== desktop && s !== mobile));
    } else {
      merged.push(...group);
    }
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return merged.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function runHeuristics(cap: CaptureResult): HeuristicSignal[] {
  const bag = new SignalBag();

  // Shared, viewport-independent checks run once off the desktop capture.
  valuePropRules(bag, cap.desktop, "both");
  trustRules(bag, cap.desktop);
  contentRules(bag, cap.desktop);
  accessibilityRules(bag, cap.desktop);
  measurementRules(bag, cap.desktop);

  ctaRules(bag, cap.desktop, "desktop");
  formRules(bag, cap.desktop, "desktop");
  navigationRules(bag, cap.desktop, "desktop");
  perfRules(bag, cap.desktop, "desktop");
  frictionRules(bag, cap.desktop, "desktop");

  ctaRules(bag, cap.mobile, "mobile");
  formRules(bag, cap.mobile, "mobile");
  navigationRules(bag, cap.mobile, "mobile");
  perfRules(bag, cap.mobile, "mobile");
  frictionRules(bag, cap.mobile, "mobile");
  mobileRules(bag, cap.mobile);

  crossViewportRules(bag, cap);

  return mergeAcrossPlatforms(bag.all());
}
