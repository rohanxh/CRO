/**
 * Everything in this file is serialized and executed inside the page.
 * It must not reference any module-scope value other than its own argument.
 */

export interface ExtractArgs {
  viewport: "desktop" | "mobile";
  foldHeight: number;
  origin: string;
}

export interface ExtractResult {
  meta: Record<string, unknown>;
  headings: unknown[];
  ctas: unknown[];
  forms: unknown[];
  images: unknown[];
  trust: Record<string, unknown>;
  tracking: Record<string, unknown>;
  friction: Record<string, unknown>;
  copy: Record<string, unknown>;
  tapTargetIssues: unknown[];
  contrastIssues: unknown[];
  timings: Record<string, unknown>;
}

export function extractPageData(args: ExtractArgs): ExtractResult {
  const { foldHeight, origin, viewport } = args;
  const isMobile = viewport === "mobile";

  /* ---------------------------------------------------------------- utils */

  type Rgba = { r: number; g: number; b: number; a: number };

  // Modern stylesheets report computed colours as oklch()/lab()/color(), which no
  // hand-written regex covers. Painting one pixel makes the browser resolve any
  // valid CSS colour to sRGB for us.
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = 1;
  colorCanvas.height = 1;
  const colorCtx = colorCanvas.getContext("2d", { willReadFrequently: true });
  if (colorCtx) colorCtx.globalCompositeOperation = "copy";
  const colorCache = new Map<string, Rgba | null>();

  const parseColor = (input: string): Rgba | null => {
    if (!input) return null;
    const s = input.trim().toLowerCase();
    if (!s) return null;

    const cached = colorCache.get(s);
    if (cached !== undefined) return cached;

    let out: Rgba | null = null;

    if (s === "transparent") {
      out = { r: 0, g: 0, b: 0, a: 0 };
    } else {
      const m = s.match(
        /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?\s*\)$/
      );
      if (m) {
        let a = 1;
        if (m[4] !== undefined) {
          a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        }
        out = { r: +m[1], g: +m[2], b: +m[3], a };
      } else {
        const hex = s.match(/^#([0-9a-f]{3,8})$/);
        if (hex) {
          let h = hex[1];
          if (h.length === 3) h = h.split("").map((c) => c + c).join("");
          if (h.length === 6 || h.length === 8) {
            out = {
              r: parseInt(h.slice(0, 2), 16),
              g: parseInt(h.slice(2, 4), 16),
              b: parseInt(h.slice(4, 6), 16),
              a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
            };
          }
        }
      }
    }

    if (!out && colorCtx) {
      const supported = !window.CSS?.supports || CSS.supports("color", s);
      if (supported) {
        try {
          colorCtx.fillStyle = s;
          colorCtx.fillRect(0, 0, 1, 1);
          const d = colorCtx.getImageData(0, 0, 1, 1).data;
          out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
        } catch {
          out = null;
        }
      }
    }

    colorCache.set(s, out);
    return out;
  };

  const toCss = (c: { r: number; g: number; b: number; a: number }) =>
    c.a >= 1
      ? `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`
      : `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${
          Math.round(c.a * 100) / 100
        })`;

  const relLum = (c: { r: number; g: number; b: number }) => {
    const f = (v: number) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };

  const blend = (
    fg: { r: number; g: number; b: number; a: number },
    bg: { r: number; g: number; b: number; a: number }
  ) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  const contrast = (
    a: { r: number; g: number; b: number },
    b: { r: number; g: number; b: number }
  ) => {
    const l1 = relLum(a);
    const l2 = relLum(b);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };

  const effectiveBg = (el: Element) => {
    let node: Element | null = el;
    let acc: { r: number; g: number; b: number; a: number } | null = null;
    while (node) {
      const cs = getComputedStyle(node);
      const c = parseColor(cs.backgroundColor);
      const hasImage = cs.backgroundImage && cs.backgroundImage !== "none";
      if (hasImage) return { color: { r: 128, g: 128, b: 128, a: 1 }, overImage: true };
      if (c && c.a > 0) {
        acc = acc ? blend(acc, c) : c;
        if (acc.a >= 0.99) return { color: acc, overImage: false };
      }
      node = node.parentElement;
    }
    const base = { r: 255, g: 255, b: 255, a: 1 };
    return { color: acc ? blend(acc, base) : base, overImage: false };
  };

  const isVisible = (el: Element) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity || "1") < 0.05) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return true;
  };

  const absTop = (el: Element) => el.getBoundingClientRect().top + window.scrollY;

  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };

  const clean = (s: string | null | undefined) =>
    (s || "").replace(/\s+/g, " ").trim();

  const truncate = (s: string, n: number) =>
    s.length > n ? s.slice(0, n) + "…" : s;

  const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));

  /* ----------------------------------------------------------------- meta */

  const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
  const qa = <T extends Element>(sel: string) =>
    Array.from(document.querySelectorAll<T>(sel));

  const bodyText = clean(document.body?.innerText || "");
  const lowerBody = bodyText.toLowerCase();

  const anchors = qa<HTMLAnchorElement>("a[href]");
  let internal = 0;
  let external = 0;
  let emptyHref = 0;
  for (const a of anchors) {
    const raw = a.getAttribute("href") || "";
    if (raw === "#" || raw === "" || raw.toLowerCase().startsWith("javascript:")) {
      emptyHref++;
      continue;
    }
    if (/^(mailto:|tel:|sms:|whatsapp:)/i.test(raw)) continue;
    try {
      const u = new URL(a.href, location.href);
      if (u.origin === origin) internal++;
      else external++;
    } catch {
      /* ignore */
    }
  }

  const meta = {
    finalUrl: location.href,
    title: document.title || null,
    titleLength: (document.title || "").length,
    metaDescription:
      q<HTMLMetaElement>('meta[name="description"]')?.content?.trim() || null,
    lang: document.documentElement.getAttribute("lang") || null,
    hasViewportMeta: !!q('meta[name="viewport"]'),
    viewportMetaContent:
      q<HTMLMetaElement>('meta[name="viewport"]')?.content || null,
    canonical: q<HTMLLinkElement>('link[rel="canonical"]')?.href || null,
    ogTitle: q<HTMLMetaElement>('meta[property="og:title"]')?.content || null,
    ogImage: q<HTMLMetaElement>('meta[property="og:image"]')?.content || null,
    favicon: !!q('link[rel~="icon"]'),
    isHttps: location.protocol === "https:",
    h1Count: qa("h1").filter(isVisible).length,
    linkCount: anchors.length,
    internalLinkCount: internal,
    externalLinkCount: external,
    emptyHrefCount: emptyHref,
  };

  /* ------------------------------------------------------------- headings */

  const headings = qa<HTMLElement>("h1, h2, h3, h4")
    .filter(isVisible)
    .slice(0, 60)
    .map((h) => ({
      level: +h.tagName.slice(1),
      text: truncate(clean(h.innerText), 180),
      aboveFold: absTop(h) < foldHeight,
      fontSize: Math.round(parseFloat(getComputedStyle(h).fontSize) || 0),
    }))
    .filter((h) => h.text.length > 0);

  /* ----------------------------------------------------------------- ctas */

  const CTA_INTENTS: Array<[string, RegExp]> = [
    ["purchase", /\b(buy|order|checkout|add to (cart|bag)|shop now|purchase|subscribe)\b/i],
    ["lead", /\b(get (a )?(quote|estimate|free)|request|book|schedule|apply|enquir|inquir|contact us|talk to|speak to|consult|get started|claim)\b/i],
    ["trial", /\b(free trial|start free|try (it )?free|sign ?up|create (an )?account|get started free)\b/i],
    ["demo", /\b(demo|watch video|see it in action|walkthrough|tour)\b/i],
    ["call", /\b(call|phone|ring us)\b/i],
    ["download", /\b(download|get the (guide|ebook|pdf|report|checklist)|free guide)\b/i],
    ["newsletter", /\b(subscribe|join (the )?(list|newsletter)|stay updated)\b/i],
    ["auth", /\b(log ?in|sign ?in|my account)\b/i],
    ["info", /\b(learn more|read more|find out more|see more|explore|discover|view details)\b/i],
  ];

  const classifyIntent = (text: string) => {
    for (const [name, re] of CTA_INTENTS) if (re.test(text)) return name;
    return null;
  };

  const ctaNodes = uniq([
    ...qa<HTMLElement>(
      'a[href], button, input[type="submit"], input[type="button"], [role="button"]'
    ),
    ...qa<HTMLElement>(
      '[class*="btn" i], [class*="button" i], [class*="cta" i]'
    ),
  ]).filter(isVisible);

  const looksButtonish = (el: HTMLElement) => {
    const cs = getComputedStyle(el);
    const bg = parseColor(cs.backgroundColor);
    const hasBg = !!bg && bg.a > 0.15;
    const hasPad =
      parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) >= 8 ||
      parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) >= 16;
    const hasRadius = parseFloat(cs.borderTopLeftRadius) > 1;
    const hasBorder = parseFloat(cs.borderTopWidth) > 0.5;
    const hasShadow = cs.boxShadow !== "none" && cs.boxShadow !== "";
    const r = el.getBoundingClientRect();
    if (r.height < 26 || r.width < 52) return false;
    return (
      (hasBg && (hasPad || hasRadius || hasShadow)) ||
      (hasBorder && (hasPad || hasRadius)) ||
      (hasBg && el.tagName === "BUTTON")
    );
  };

  // The visual button treatment is often on a wrapper or an inner span rather
  // than the anchor itself, so check the immediate vicinity too.
  const isPrimaryStyled = (el: HTMLElement) => {
    if (looksButtonish(el)) return true;
    const own = el.getBoundingClientRect();
    const kids = Array.from(el.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement
    );
    for (const kid of kids.slice(0, 3)) {
      const r = kid.getBoundingClientRect();
      if (r.width >= own.width * 0.7 && r.height >= own.height * 0.7 && looksButtonish(kid)) {
        return true;
      }
    }
    const parent = el.parentElement;
    if (parent instanceof HTMLElement && parent.children.length === 1) {
      const r = parent.getBoundingClientRect();
      if (r.width <= own.width * 1.6 && r.height <= own.height * 1.8 && looksButtonish(parent)) {
        return true;
      }
    }
    return false;
  };

  const ctas = ctaNodes
    .map((el) => {
      const text = clean(
        el.tagName === "INPUT"
          ? (el as HTMLInputElement).value
          : el.innerText || el.getAttribute("aria-label") || ""
      );
      return { el, text };
    })
    .filter(({ text }) => text.length > 0 && text.length <= 70)
    .slice(0, 120)
    .map(({ el, text }) => {
      const cs = getComputedStyle(el);
      const fg = parseColor(cs.color);
      const bgInfo = effectiveBg(el);
      const ratio =
        fg && !bgInfo.overImage
          ? Math.round(contrast(blend(fg, bgInfo.color), bgInfo.color) * 100) / 100
          : null;
      const b = box(el);
      return {
        text: truncate(text, 70),
        tag: el.tagName.toLowerCase(),
        href: el.getAttribute("href"),
        box: b,
        aboveFold: b.y < foldHeight,
        fontSize: Math.round(parseFloat(cs.fontSize) || 0),
        color: toCss(fg || { r: 0, g: 0, b: 0, a: 1 }),
        backgroundColor: toCss(bgInfo.color),
        contrastRatio: ratio,
        isPrimaryStyled: isPrimaryStyled(el),
        intent: classifyIntent(text),
      };
    });

  /* ---------------------------------------------------------------- forms */

  const labelFor = (input: HTMLElement) => {
    const id = input.getAttribute("id");
    if (id) {
      const esc = id.replace(/["\\]/g, "\\$&");
      const lab = document.querySelector<HTMLElement>(`label[for="${esc}"]`);
      if (lab && isVisible(lab)) return clean(lab.innerText);
    }
    const wrap = input.closest("label");
    if (wrap && isVisible(wrap)) return clean(wrap.innerText);
    const aria = input.getAttribute("aria-label");
    if (aria) return clean(aria);
    const labelledBy = input.getAttribute("aria-labelledby");
    if (labelledBy) {
      const ref = document.getElementById(labelledBy);
      if (ref) return clean(ref.innerText);
    }
    return null;
  };

  const forms = qa<HTMLFormElement>("form")
    .filter((f) => f.querySelectorAll("input, select, textarea").length > 0)
    .slice(0, 8)
    .map((f) => {
      const inputs = Array.from(
        f.querySelectorAll<HTMLElement>("input, select, textarea")
      ).filter((i) => {
        const t = (i.getAttribute("type") || "").toLowerCase();
        return t !== "hidden" && t !== "submit" && t !== "button";
      });
      const visibleInputs = inputs.filter(isVisible);
      const fields = visibleInputs.slice(0, 30).map((i) => {
        const label = labelFor(i);
        const r = i.getBoundingClientRect();
        return {
          type:
            i.tagName === "INPUT"
              ? (i.getAttribute("type") || "text").toLowerCase()
              : i.tagName.toLowerCase(),
          name: i.getAttribute("name") || i.getAttribute("id") || "",
          label: label ? truncate(label, 60) : null,
          placeholder: i.getAttribute("placeholder"),
          required:
            i.hasAttribute("required") ||
            i.getAttribute("aria-required") === "true",
          autocomplete: i.getAttribute("autocomplete"),
          hasVisibleLabel: !!label,
          boxHeight: Math.round(r.height),
        };
      });
      const submit = f.querySelector<HTMLElement>(
        'button[type="submit"], input[type="submit"], button:not([type="button"])'
      );
      const formText = clean(f.innerText).toLowerCase();
      return {
        action: f.getAttribute("action"),
        method: (f.getAttribute("method") || "get").toLowerCase(),
        fieldCount: inputs.length,
        visibleFieldCount: visibleInputs.length,
        requiredCount: fields.filter((x) => x.required).length,
        fields,
        submitText: submit
          ? truncate(
              clean(
                submit.tagName === "INPUT"
                  ? (submit as HTMLInputElement).value
                  : submit.innerText
              ),
              60
            )
          : null,
        aboveFold: absTop(f) < foldHeight,
        hasPrivacyNote:
          /privacy|we (never|don'?t) (share|sell|spam)|unsubscribe|gdpr|secure/.test(
            formText
          ),
        multiStepHint: /step \d|next step|continue|\d\s*(of|\/)\s*\d/.test(formText),
      };
    });

  /* --------------------------------------------------------------- images */

  const dpr = window.devicePixelRatio || 1;
  const images = qa<HTMLImageElement>("img")
    .filter(isVisible)
    .slice(0, 80)
    .map((img) => {
      const r = img.getBoundingClientRect();
      const dw = Math.round(r.width);
      const dh = Math.round(r.height);
      const nw = img.naturalWidth || 0;
      const nh = img.naturalHeight || 0;
      const oversize =
        dw > 0 && nw > 0 ? Math.round((nw / (dw * dpr)) * 100) / 100 : null;
      return {
        src: truncate(img.currentSrc || img.src || "", 200),
        alt: img.hasAttribute("alt") ? img.getAttribute("alt") : null,
        displayWidth: dw,
        displayHeight: dh,
        naturalWidth: nw,
        naturalHeight: nh,
        oversizeFactor: oversize,
        loading: img.getAttribute("loading"),
        aboveFold: absTop(img) < foldHeight,
        isBackgroundHero: dw >= window.innerWidth * 0.8 && dh >= 200,
      };
    });

  /* ---------------------------------------------------------------- trust */

  const grab = (re: RegExp, limit = 6) =>
    uniq((bodyText.match(re) || []).map((s) => truncate(clean(s), 90))).slice(0, limit);

  const testimonialLike =
    qa('[class*="testimonial" i], [class*="review" i], [class*="quote" i], blockquote')
      .filter(isVisible).length;

  const starish =
    /★|⭐|\b\d(\.\d)?\s*(out of|\/)\s*5\b|\b\d(\.\d)?\s*star/i.test(bodyText) ||
    qa('[class*="star" i], [class*="rating" i]').filter(isVisible).length > 0;

  const logoStripLikely = (() => {
    const containers = qa<HTMLElement>("div, section, ul").slice(0, 4000);
    for (const c of containers) {
      const imgs = Array.from(c.querySelectorAll<HTMLImageElement>("img")).filter(
        isVisible
      );
      if (imgs.length < 3 || imgs.length > 14) continue;
      const rects = imgs.map((i) => i.getBoundingClientRect());
      const heights = rects.map((r) => r.height);
      if (heights.some((h) => h < 16 || h > 130)) continue;
      const ys = rects.map((r) => Math.round(r.top));
      const spread = Math.max(...ys) - Math.min(...ys);
      if (spread <= 80) return true;
    }
    return false;
  })();

  const socialProfileLinks = uniq(
    anchors
      .map((a) => a.href)
      .filter((h) =>
        /(facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|pinterest|trustpilot|yelp|google\.com\/maps|g\.page)/i.test(
          h
        )
      )
  ).slice(0, 12);

  const policyLinks = uniq(
    anchors
      .filter((a) =>
        /(privacy|terms|refund|cookie|disclaimer|gdpr)/i.test(
          a.textContent + " " + a.getAttribute("href")
        )
      )
      .map((a) => truncate(clean(a.textContent || a.href), 50))
  ).slice(0, 10);

  const telLinks = uniq(
    qa<HTMLAnchorElement>('a[href^="tel:"]').map((a) =>
      a.getAttribute("href")!.replace(/^tel:/, "")
    )
  ).slice(0, 5);
  const phoneRegexHits = grab(
    /(\+?\d[\d\s().-]{7,}\d)/g,
    5
  ).filter((s) => s.replace(/\D/g, "").length >= 9);

  const emailLinks = uniq([
    ...qa<HTMLAnchorElement>('a[href^="mailto:"]').map((a) =>
      a.getAttribute("href")!.replace(/^mailto:/, "").split("?")[0]
    ),
    ...(bodyText.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g) || []),
  ]).slice(0, 5);

  const trust = {
    testimonialLike,
    reviewStars: starish,
    ratingMentions: grab(
      /\b\d(\.\d)?\s*(out of|\/)\s*5\b|\b\d{2,}(,\d{3})*\+?\s*(reviews|customers|clients|users|projects|installs|families|homes)\b/gi
    ),
    guaranteeMentions: grab(
      /\b(money[- ]back|satisfaction guarantee(d)?|\d+[- ]day guarantee|risk[- ]free|no obligation|cancel anytime|free cancellation|warranty|lifetime guarantee)\b/gi
    ),
    securityMentions: grab(
      /\b(ssl|secure checkout|256[- ]bit|pci[- ]compliant|encrypted|gdpr|soc ?2|iso ?\d+|hipaa|norton|mcafee|verified)\b/gi
    ),
    certificationMentions: grab(
      /\b(licensed|insured|certified|accredited|award[- ]winning|member of|bbb|checkatrade|trustmark|gas safe|niceic|as seen (in|on))\b/gi
    ),
    clientLogoStripLikely: logoStripLikely,
    caseStudyMentions: (lowerBody.match(/case stud|success stor|portfolio|before (and|&) after/g) || [])
      .length,
    teamOrAboutLink: anchors.some((a) =>
      /\b(about( us)?|our team|meet the team|who we are)\b/i.test(
        clean(a.textContent || "")
      )
    ),
    physicalAddressLikely:
      qa("address").filter(isVisible).length > 0 ||
      /\b\d+\s+[A-Za-z][A-Za-z.\s]{2,30}(street|st\.|road|rd\.|avenue|ave\.|lane|ln\.|drive|dr\.|suite|floor|blvd)\b/i.test(
        bodyText
      ) ||
      /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/.test(bodyText) ||
      /\b\d{5}(-\d{4})?\b/.test(bodyText),
    phoneNumbers: uniq([...telLinks, ...phoneRegexHits]).slice(0, 5),
    emails: emailLinks,
    socialProfileLinks,
    policyLinks,
  };

  /* ------------------------------------------------------------- tracking */

  const scriptSrcs = qa<HTMLScriptElement>("script[src]").map((s) => s.src);
  const inlineScripts = qa<HTMLScriptElement>("script:not([src])")
    .map((s) => s.textContent || "")
    .join("\n")
    .slice(0, 400000);
  const allScriptText = scriptSrcs.join(" ") + " " + inlineScripts;
  const w = window as unknown as Record<string, unknown>;

  const has = (re: RegExp) => re.test(allScriptText);

  const VENDORS: Array<[string, RegExp]> = [
    ["Google Tag Manager", /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/],
    ["Google Analytics 4", /gtag\/js\?id=G-|G-[A-Z0-9]{8,}|gtag\(/],
    ["Universal Analytics", /google-analytics\.com\/analytics\.js|UA-\d{4,}/],
    ["Google Ads", /googleadservices|AW-\d{6,}/],
    ["Meta Pixel", /connect\.facebook\.net|fbq\(/],
    ["LinkedIn Insight", /snap\.licdn\.com|_linkedin_partner_id/],
    ["TikTok Pixel", /analytics\.tiktok\.com|ttq\./],
    ["Microsoft Clarity", /clarity\.ms/],
    ["Hotjar", /static\.hotjar\.com|hjSiteSettings/],
    ["Microsoft Advertising", /bat\.bing\.com|uetq/],
    ["HubSpot", /js\.hs-scripts\.com|hs-analytics/],
    ["Segment", /cdn\.segment\.com/],
    ["Mixpanel", /mixpanel/],
    ["Posthog", /posthog/],
    ["Klaviyo", /klaviyo/],
    ["Mailchimp", /chimpstatic|mailchimp/],
    ["Intercom", /widget\.intercom\.io/],
    ["Crisp", /client\.crisp\.chat/],
    ["Tawk.to", /embed\.tawk\.to/],
    ["Drift", /js\.driftt\.com/],
    ["Zendesk", /static\.zdassets\.com/],
    ["Tidio", /code\.tidio\.co/],
    ["Calendly", /assets\.calendly\.com/],
    ["Typeform", /embed\.typeform\.com/],
    ["Google reCAPTCHA", /google\.com\/recaptcha/],
    ["Cloudflare Turnstile", /challenges\.cloudflare\.com/],
    ["Trustpilot", /widget\.trustpilot\.com/],
    ["Optimizely", /optimizely/],
    ["VWO", /visualwebsiteoptimizer/],
    ["Google Optimize", /optimize\.js/],
  ];

  const detectedVendors = VENDORS.filter(([, re]) => has(re)).map(([n]) => n);

  const chatWidget: string[] = [];
  for (const [name, re] of [
    ["Intercom", /widget\.intercom\.io/],
    ["Crisp", /client\.crisp\.chat/],
    ["Tawk.to", /embed\.tawk\.to/],
    ["Drift", /js\.driftt\.com/],
    ["Zendesk", /static\.zdassets\.com/],
    ["Tidio", /code\.tidio\.co/],
    ["LiveChat", /cdn\.livechatinc\.com/],
    ["Facebook Messenger", /connect\.facebook\.net.*Messenger|fb-customerchat/],
    ["WhatsApp", /wa\.me|api\.whatsapp\.com/],
  ] as Array<[string, RegExp]>) {
    if (re.test(allScriptText) || re.test(document.body?.innerHTML.slice(0, 200000) || ""))
      chatWidget.push(name);
  }

  const consentBanner =
    qa(
      '[class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [aria-label*="cookie" i]'
    ).filter(isVisible).length > 0 ||
    /cookiebot|onetrust|termly|iubenda|cookieyes|complianz/i.test(allScriptText);

  const tracking = {
    ga4: detectedVendors.includes("Google Analytics 4"),
    gtm: detectedVendors.includes("Google Tag Manager"),
    metaPixel: detectedVendors.includes("Meta Pixel"),
    linkedInInsight: detectedVendors.includes("LinkedIn Insight"),
    tiktokPixel: detectedVendors.includes("TikTok Pixel"),
    clarity: detectedVendors.includes("Microsoft Clarity"),
    hotjar: detectedVendors.includes("Hotjar"),
    chatWidget: uniq(chatWidget),
    consentBanner,
    detectedVendors,
    hasDataLayer: Array.isArray(w.dataLayer),
  };

  /* ------------------------------------------------------------- friction */

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const fixedEls = qa<HTMLElement>("body *")
    .slice(0, 6000)
    .filter((el) => {
      const cs = getComputedStyle(el);
      return (
        (cs.position === "fixed" || cs.position === "sticky") && isVisible(el)
      );
    });

  const overlays = fixedEls.filter((el) => {
    const r = el.getBoundingClientRect();
    const coverage = (r.width * r.height) / (vw * vh);
    const cs = getComputedStyle(el);
    const z = parseInt(cs.zIndex || "0", 10) || 0;
    const looksModal =
      el.getAttribute("role") === "dialog" ||
      el.getAttribute("aria-modal") === "true" ||
      /modal|popup|overlay|lightbox|dialog|newsletter|subscribe|cookie|consent|exit/i.test(
        el.className.toString() + " " + el.id
      );
    return coverage > 0.15 && (looksModal || z > 100);
  });

  const stickyHeader = fixedEls.some((el) => {
    const r = el.getBoundingClientRect();
    return (
      r.top <= 4 &&
      r.height < vh * 0.35 &&
      r.width > vw * 0.7 &&
      (el.tagName === "HEADER" ||
        !!el.querySelector("nav") ||
        /header|navbar|topbar/i.test(el.className.toString()))
    );
  });

  const stickyCta = fixedEls.some((el) => {
    const r = el.getBoundingClientRect();
    const nearBottom = r.bottom >= vh - 8 && r.top > vh * 0.5;
    const hasBtn = !!el.querySelector(
      'a[href^="tel:"], a[href], button, [class*="btn" i], [class*="cta" i]'
    );
    return nearBottom && hasBtn && r.height < vh * 0.3;
  });

  const primaryNav =
    q<HTMLElement>("header nav") || q<HTMLElement>("nav") || q<HTMLElement>("header");
  const navItemCount = primaryNav
    ? Array.from(primaryNav.querySelectorAll("a")).filter(isVisible).length
    : 0;

  const footer = q<HTMLElement>("footer");
  const footerLinkCount = footer
    ? Array.from(footer.querySelectorAll("a")).filter(isVisible).length
    : 0;

  const primaryCtas = ctas.filter((c) => c.isPrimaryStyled && c.intent && c.intent !== "auth" && c.intent !== "info");
  const scrollDepthToFirstCta = primaryCtas.length
    ? Math.min(...primaryCtas.map((c) => c.box.y))
    : null;

  const friction = {
    overlayCount: overlays.length,
    overlayTexts: overlays
      .slice(0, 3)
      .map((o) => truncate(clean(o.innerText), 160))
      .filter(Boolean),
    autoplayVideo: qa<HTMLVideoElement>("video[autoplay]").length > 0,
    carouselLikely:
      qa(
        '[class*="carousel" i], [class*="slider" i], [class*="swiper" i], [class*="slick" i], [class*="glide" i]'
      ).filter(isVisible).length > 0,
    horizontalOverflowPx: Math.max(
      0,
      Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth)
    ),
    stickyHeader,
    stickyCta,
    navItemCount,
    footerLinkCount,
    interstitialLikely: overlays.some((o) => {
      const r = o.getBoundingClientRect();
      return (r.width * r.height) / (vw * vh) > 0.6;
    }),
    scrollDepthToFirstCta,
    captchaLikely:
      qa('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"]')
        .length > 0,
  };

  /* ----------------------------------------------------------------- copy */

  const aboveFoldEls = qa<HTMLElement>(
    "h1, h2, h3, p, li, span, div, button, a"
  ).filter((el) => {
    const b = el.getBoundingClientRect();
    const top = b.top + window.scrollY;
    return top < foldHeight && top >= 0 && isVisible(el) && el.children.length === 0;
  });
  const aboveFoldText = truncate(
    clean(uniq(aboveFoldEls.map((e) => clean(e.innerText))).filter(Boolean).join(" · ")),
    2500
  );

  const words = bodyText.split(/\s+/).filter(Boolean);
  const sentences = bodyText.split(/(?<=[.!?])\s+/).filter((s) => s.split(/\s+/).length > 2);
  const sentenceLens = sentences.map((s) => s.split(/\s+/).length);

  const smallTextCount = qa<HTMLElement>("p, li, span, div, label, a")
    .filter((el) => el.children.length === 0 && clean(el.innerText).length > 12)
    .filter((el) => (parseFloat(getComputedStyle(el).fontSize) || 16) < (isMobile ? 14 : 13))
    .length;

  const copy = {
    wordCount: words.length,
    aboveFoldWordCount: aboveFoldText.split(/\s+/).filter(Boolean).length,
    aboveFoldText,
    avgSentenceWords: sentenceLens.length
      ? Math.round((sentenceLens.reduce((a, b) => a + b, 0) / sentenceLens.length) * 10) / 10
      : 0,
    longSentenceCount: sentenceLens.filter((n) => n > 28).length,
    jargonHits: grab(
      /\b(synerg\w+|leverag\w+|holistic|paradigm|best[- ]in[- ]class|world[- ]class|cutting[- ]edge|state[- ]of[- ]the[- ]art|innovative solutions|seamless(ly)?|robust|scalable|turnkey|bespoke|one[- ]stop shop|end[- ]to[- ]end|next[- ]gen\w*|disrupt\w+|revolutioniz\w+)\b/gi,
      12
    ),
    urgencyHits: grab(
      /\b(limited time|ends (today|soon|tonight)|only \d+ left|last chance|today only|hurry|while stocks last|\d+ spots? (left|remaining)|offer expires|book (today|now) and save)\b/gi,
      8
    ),
    benefitHits: grab(
      /\b(save \d+%|save [$£€]\d+|in (as little as )?\d+ (minutes|hours|days|weeks)|free (delivery|shipping|installation|quote|consultation|survey|trial|plan|forever|for \d+ days)|\d+[- ]day (free )?trial|no (fees|hidden (costs|fees)|contracts|credit card|commitment|obligation|setup fee)|cancel anytime|unlimited \w+|same[- ]day|next[- ]day|\d+% (faster|cheaper|more|less)|\d+x (faster|more))\b/gi,
      10
    ),
    weWeRatio: {
      we: (lowerBody.match(/\b(we|our|us|i)\b/g) || []).length,
      you: (lowerBody.match(/\b(you|your|you'?re|yours)\b/g) || []).length,
    },
    priceMentions: grab(
      /(?:[$£€]\s?\d[\d,]*(?:\.\d{2})?|\b\d+\s?(?:USD|GBP|EUR)\b)(?:\s*(?:\/|per)\s*(?:mo|month|year|yr|user|seat|hour|sqft))?/gi,
      10
    ),
    smallTextCount,
    faqLikely:
      /frequently asked|\bfaq\b/i.test(bodyText) ||
      qa("details").filter(isVisible).length >= 3 ||
      qa('[class*="accordion" i]').filter(isVisible).length >= 1,
  };

  /* ---------------------------------------------------------- tap targets */

  const tapTargetIssues = isMobile
    ? qa<HTMLElement>('a[href], button, input[type="submit"], [role="button"]')
        .filter(isVisible)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            text: truncate(clean(el.innerText || el.getAttribute("aria-label") || ""), 40),
            tag: el.tagName.toLowerCase(),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        })
        .filter((t) => t.text.length > 0 && (t.width < 44 || t.height < 44))
        .slice(0, 25)
    : [];

  /* ------------------------------------------------------------- contrast */

  const contrastCandidates = qa<HTMLElement>(
    "h1, h2, h3, h4, p, li, a, button, span, label, strong, em, td, div"
  )
    .filter((el) => el.children.length === 0)
    .filter((el) => clean(el.innerText).length >= 8)
    .filter(isVisible)
    .slice(0, 700);

  const contrastIssues: unknown[] = [];
  const seenContrast = new Set<string>();
  for (const el of contrastCandidates) {
    const cs = getComputedStyle(el);
    const fg = parseColor(cs.color);
    if (!fg) continue;
    const bgInfo = effectiveBg(el);
    if (bgInfo.overImage) continue;
    const size = parseFloat(cs.fontSize) || 16;
    const weight = parseInt(cs.fontWeight || "400", 10) || 400;
    const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = isLarge ? 3 : 4.5;
    const ratio = contrast(blend(fg, bgInfo.color), bgInfo.color);
    if (ratio < required) {
      const key = `${cs.color}|${toCss(bgInfo.color)}|${Math.round(size)}`;
      if (seenContrast.has(key)) continue;
      seenContrast.add(key);
      contrastIssues.push({
        text: truncate(clean(el.innerText), 70),
        tag: el.tagName.toLowerCase(),
        fontSize: Math.round(size),
        color: cs.color,
        backgroundColor: toCss(bgInfo.color),
        ratio: Math.round(ratio * 100) / 100,
        requiredRatio: required,
      });
      if (contrastIssues.length >= 15) break;
    }
  }

  /* -------------------------------------------------------------- timings */

  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  const paints = performance.getEntriesByType("paint");
  const fcpEntry = paints.find((p) => p.name === "first-contentful-paint");
  const wm = window as unknown as { __croVitals?: { lcp?: number; cls?: number } };

  const timings = {
    ttfb: nav ? Math.round(nav.responseStart) : null,
    domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    load: nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : null,
    fcp: fcpEntry ? Math.round(fcpEntry.startTime) : null,
    lcp: wm.__croVitals?.lcp != null ? Math.round(wm.__croVitals.lcp) : null,
    cls:
      wm.__croVitals?.cls != null
        ? Math.round(wm.__croVitals.cls * 1000) / 1000
        : null,
    blockingScriptCount: qa<HTMLScriptElement>("script[src]").filter(
      (s) => !s.async && !s.defer && s.type !== "module"
    ).length,
    blockingStylesheetCount: qa<HTMLLinkElement>('link[rel="stylesheet"]').filter(
      (l) => !l.media || l.media === "all" || l.media === "screen"
    ).length,
    fullPageHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0
    ),
  };

  return {
    meta,
    headings,
    ctas,
    forms,
    images,
    trust,
    tracking,
    friction,
    copy,
    tapTargetIssues,
    contrastIssues,
    timings,
  };
}

/** Injected before navigation so LCP/CLS observers are in place. */
export function vitalsInitScript() {
  const w = window as unknown as { __croVitals: { lcp: number; cls: number } };
  w.__croVitals = { lcp: 0, cls: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        w.__croVitals.lcp = Math.max(w.__croVitals.lcp, e.startTime);
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    /* unsupported */
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const shift = e as unknown as { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) w.__croVitals.cls += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    /* unsupported */
  }
}
