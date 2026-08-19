/**
 * Bot-protection interstitials (Cloudflare, SiteGround, Sucuri, …) serve a
 * holding page that is not the site. Auditing one produces a confident,
 * completely wrong report, so we detect it, wait for it to clear on its own,
 * and report honestly if it never does.
 *
 * This is not an attempt to defeat the protection: the only thing we do is wait
 * for the page to finish loading, exactly as a browser would.
 */

export interface ChallengeVerdict {
  challenged: boolean;
  vendor: string | null;
  signal: string;
}

/** Serialized into the page — must not reference module scope. */
export function detectChallenge(): ChallengeVerdict {
  // These paths exist only to gate traffic, so the URL alone is conclusive —
  // no need to inspect content, and it survives the gate's own error pages.
  const href = location.href;
  const gates: Array<[string, RegExp]> = [
    ["SiteGround", /\/\.well-known\/(sg)?captcha\//i],
    ["Cloudflare", /\/cdn-cgi\/l\/chk_jschl|__cf_chl_|\/cdn-cgi\/challenge-platform\//i],
    ["Imperva / Incapsula", /\/_incapsula_resource/i],
    ["Distil", /distil_r_captcha/i],
    ["DDoS-Guard", /\/\.well-known\/ddos-guard/i],
    ["Sucuri", /sucuri_cloudproxy/i],
  ];
  for (const [vendor, re] of gates) {
    if (re.test(href)) {
      let path = href;
      try {
        path = new URL(href).pathname;
      } catch {
        /* keep the full href */
      }
      return { challenged: true, vendor, signal: `redirected to ${path}` };
    }
  }

  const title = (document.title || "").trim();
  const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
  const html = (document.documentElement?.innerHTML || "").slice(0, 250_000);
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

  const vendors: Array<[string, RegExp]> = [
    ["Cloudflare", /cf-browser-verification|challenge-running|__cf_chl|cf_chl_opt|cdn-cgi\/challenge-platform/i],
    ["SiteGround", /sgcaptcha|checking the site connection security/i],
    ["Sucuri", /sucuri website firewall|access denied[^<]{0,40}sucuri/i],
    ["Imperva / Incapsula", /incapsula incident id|_incapsula_resource/i],
    ["DataDome", /datadome|dd_cookie_test/i],
    ["PerimeterX / HUMAN", /px-captcha|_pxhd|perimeterx/i],
    ["AWS WAF", /awswaf|challenge-container/i],
    ["Kasada", /kpsdk|kasada/i],
    ["Generic bot check", /checking your browser|verif(y|ying) (that )?you are (a )?human|ddos protection by|enable (cookies|javascript) to continue|please wait while we check/i],
  ];

  // A page can legitimately embed a CAPTCHA on a form, so vendor markers alone
  // are not enough: a real page has real content. Only a thin page, or one whose
  // title is itself a holding message, counts as an interstitial.
  const interstitialTitle =
    title === "" ||
    /^(just a moment|attention required|please wait|checking|security check|verify|access denied|one moment|redirecting|loading)/i.test(
      title
    );
  const thin = wordCount < 120;

  for (const [vendor, re] of vendors) {
    if (re.test(html) || re.test(bodyText)) {
      if (thin || interstitialTitle) {
        return {
          challenged: true,
          vendor,
          signal: title ? `title "${title}", ${wordCount} words of content` : `${wordCount} words of content`,
        };
      }
    }
  }

  // A near-empty page that only asks for cookies or JavaScript is also a holding page.
  if (
    thin &&
    /requires? cookies|enable (javascript|cookies)|turn on javascript/i.test(bodyText) &&
    wordCount < 60
  ) {
    return {
      challenged: true,
      vendor: "Unknown protection",
      signal: `${wordCount} words, asks for cookies/JavaScript`,
    };
  }

  return { challenged: false, vendor: null, signal: "" };
}

export function challengeMessage(vendor: string | null, url: string) {
  const who = vendor && vendor !== "Unknown protection" ? vendor : "a bot-protection layer";
  return (
    `${url} is behind ${who}, which served a security-check page instead of the site and did not clear on its own. ` +
    `No audit was produced, because auditing the check page would report on the wrong page. ` +
    `If this is your site, allow the auditor through in your host or CDN settings — for SiteGround that is Site Tools > Security > Blocked IPs / bot protection, and for Cloudflare a WAF skip rule. ` +
    `You can also set CRO_AUDIT_HEADERS to send a header your firewall allowlists.`
  );
}
