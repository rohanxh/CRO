import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { extractPageData, vitalsInitScript, type ExtractArgs } from "./extract";
import { challengeMessage, detectChallenge } from "./challenge";
import type { PerfMetrics, ViewportCapture, ViewportName } from "../types";

const VIEWPORTS: Record<
  ViewportName,
  { width: number; height: number; deviceScaleFactor: number; isMobile: boolean; userAgent: string }
> = {
  desktop: {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  },
  mobile: {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
};

const NAV_TIMEOUT = 45_000;

export class CaptureError extends Error {}

/**
 * Optional headers sent with every request, as a JSON object in CRO_AUDIT_HEADERS.
 * Lets you allowlist this auditor in your own WAF/CDN by a shared secret header
 * rather than trying to look like an ordinary visitor.
 */
function auditHeaders(): Record<string, string> | undefined {
  const raw = process.env.CRO_AUDIT_HEADERS;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    console.warn("CRO_AUDIT_HEADERS is not valid JSON; ignoring it.");
    return undefined;
  }
}

export interface CaptureOptions {
  url: string;
  onProgress?: (message: string) => void;
}

export interface CaptureResult {
  desktop: ViewportCapture;
  mobile: ViewportCapture;
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled",
        ],
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  const browser = await browserPromise;
  if (!browser.isConnected()) {
    browserPromise = null;
    return getBrowser();
  }
  return browser;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close().catch(() => {});
  }
}

interface NetworkStats {
  requestCount: number;
  totalTransferBytes: number;
  imageBytes: number;
  scriptBytes: number;
  fontBytes: number;
  thirdPartyRequestCount: number;
  failedRequests: string[];
}

function attachCollectors(page: Page, targetHost: string) {
  const stats: NetworkStats = {
    requestCount: 0,
    totalTransferBytes: 0,
    imageBytes: 0,
    scriptBytes: 0,
    fontBytes: 0,
    thirdPartyRequestCount: 0,
    failedRequests: [],
  };
  const consoleErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error" && consoleErrors.length < 20) {
      consoleErrors.push(msg.text().slice(0, 240));
    }
  });
  page.on("pageerror", (err) => {
    if (consoleErrors.length < 20) consoleErrors.push(`Uncaught: ${err.message.slice(0, 200)}`);
  });
  page.on("requestfailed", (req) => {
    if (stats.failedRequests.length < 20) {
      stats.failedRequests.push(
        `${req.method()} ${req.url().slice(0, 160)} — ${req.failure()?.errorText ?? "failed"}`
      );
    }
  });
  page.on("response", (res) => {
    if (res.status() >= 400 && stats.failedRequests.length < 20) {
      stats.failedRequests.push(`${res.status()} ${res.url().slice(0, 160)}`);
    }
  });
  page.on("requestfinished", async (req) => {
    stats.requestCount++;
    try {
      const host = new URL(req.url()).hostname;
      if (host !== targetHost && !host.endsWith(`.${targetHost}`)) {
        stats.thirdPartyRequestCount++;
      }
    } catch {
      /* data: urls etc */
    }
    try {
      const sizes = await req.sizes();
      const bytes = sizes.responseBodySize + sizes.responseHeadersSize;
      stats.totalTransferBytes += bytes;
      const type = req.resourceType();
      if (type === "image") stats.imageBytes += bytes;
      else if (type === "script") stats.scriptBytes += bytes;
      else if (type === "font") stats.fontBytes += bytes;
    } catch {
      /* request may be gone */
    }
  });

  return { stats, consoleErrors };
}

/**
 * Interstitials clear themselves within a few seconds. Poll until the real page
 * appears; return the blocking vendor if it never does.
 */
async function settleChallenge(
  page: Page,
  onProgress?: (m: string) => void
): Promise<string | null> {
  const deadline = Date.now() + 25_000;
  let announced = false;
  let lastVendor: string | null = null;

  for (;;) {
    let verdict;
    try {
      verdict = await page.evaluate(detectChallenge);
    } catch {
      // Context destroyed mid-navigation: the challenge is resolving.
      await page.waitForTimeout(1000);
      if (Date.now() > deadline) return lastVendor;
      continue;
    }

    if (!verdict.challenged) return null;
    lastVendor = verdict.vendor;

    if (!announced) {
      onProgress?.(`Waiting for ${verdict.vendor ?? "a security check"} to clear…`);
      announced = true;
    }
    if (Date.now() > deadline) return lastVendor;

    await page.waitForTimeout(1500);
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  }
}

async function scrollThroughPage(page: Page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    const max = document.documentElement.scrollHeight;
    for (let y = 0; y < Math.min(max, 40000); y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 150));
  });
}

async function captureViewport(
  context: BrowserContext,
  url: string,
  viewport: ViewportName,
  onProgress?: (m: string) => void
): Promise<ViewportCapture> {
  const cfg = VIEWPORTS[viewport];
  const page = await context.newPage();
  const targetHost = new URL(url).hostname;
  const { stats, consoleErrors } = attachCollectors(page, targetHost);
  const redirectChain: string[] = [];

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && redirectChain.length < 10) {
      const u = frame.url();
      if (u && u !== "about:blank" && redirectChain[redirectChain.length - 1] !== u) {
        redirectChain.push(u);
      }
    }
  });

  try {
    await page.addInitScript(vitalsInitScript);

    onProgress?.(`Loading page on ${viewport}…`);
    let statusCode: number | null = null;
    let loadErrorText: string | null = null;
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT,
      });
      statusCode = response?.status() ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/net::ERR|Timeout .* exceeded/i.test(msg) && page.url() === "about:blank") {
        throw new CaptureError(
          `Could not load ${url}. The site may be down, blocking automated browsers, or too slow to respond.`
        );
      }
      loadErrorText = msg.slice(0, 300);
    }

    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(900);

    const blockedBy = await settleChallenge(page, onProgress);
    if (blockedBy !== null) {
      throw new CaptureError(challengeMessage(blockedBy, url));
    }

    onProgress?.(`Capturing above-the-fold view (${viewport})…`);
    const foldShot = await page.screenshot({ type: "jpeg", quality: 78 });

    onProgress?.(`Scrolling full page (${viewport})…`);
    await scrollThroughPage(page).catch(() => {});
    await page.waitForTimeout(400);

    // Detection of sticky/fixed chrome is scroll-dependent, so measure mid-page.
    await page
      .evaluate(() => window.scrollTo(0, Math.min(window.innerHeight * 1.2, document.documentElement.scrollHeight)))
      .catch(() => {});
    await page.waitForTimeout(350);

    onProgress?.(`Analysing page structure (${viewport})…`);
    const args: ExtractArgs = {
      viewport,
      foldHeight: cfg.height,
      origin: new URL(page.url()).origin,
    };
    const data = await page.evaluate(extractPageData, args);

    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.waitForTimeout(250);

    const timings = data.timings as Record<string, number | null>;
    const fullPageHeight = Number(timings.fullPageHeight) || cfg.height;
    const clipHeight = Math.min(fullPageHeight, cfg.height * 5);

    const fullShot = await page
      .screenshot({
        type: "jpeg",
        quality: 55,
        clip: { x: 0, y: 0, width: cfg.width, height: clipHeight },
      })
      .catch(() => foldShot);

    const perf: PerfMetrics = {
      ttfb: timings.ttfb ?? null,
      domContentLoaded: timings.domContentLoaded ?? null,
      load: timings.load ?? null,
      fcp: timings.fcp ?? null,
      lcp: timings.lcp ?? null,
      cls: timings.cls ?? null,
      totalTransferBytes: stats.totalTransferBytes,
      requestCount: stats.requestCount,
      imageBytes: stats.imageBytes,
      scriptBytes: stats.scriptBytes,
      fontBytes: stats.fontBytes,
      thirdPartyRequestCount: stats.thirdPartyRequestCount,
      blockingScriptCount: Number(timings.blockingScriptCount) || 0,
      blockingStylesheetCount: Number(timings.blockingStylesheetCount) || 0,
    };

    const rawMeta = data.meta as Record<string, unknown>;

    return {
      viewport,
      width: cfg.width,
      height: cfg.height,
      foldScreenshot: foldShot.toString("base64"),
      fullScreenshot: fullShot.toString("base64"),
      fullPageHeight,
      headings: data.headings as ViewportCapture["headings"],
      ctas: data.ctas as ViewportCapture["ctas"],
      forms: data.forms as ViewportCapture["forms"],
      images: data.images as ViewportCapture["images"],
      trust: data.trust as unknown as ViewportCapture["trust"],
      tracking: data.tracking as unknown as ViewportCapture["tracking"],
      friction: data.friction as unknown as ViewportCapture["friction"],
      copy: data.copy as unknown as ViewportCapture["copy"],
      tapTargetIssues: data.tapTargetIssues as ViewportCapture["tapTargetIssues"],
      contrastIssues: data.contrastIssues as ViewportCapture["contrastIssues"],
      perf,
      consoleErrors,
      failedRequests: stats.failedRequests,
      meta: {
        ...(rawMeta as object),
        statusCode,
        redirectChain,
        loadErrorText,
      } as ViewportCapture["meta"],
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Primes DNS, TLS and any CDN cache so the first measured viewport is not
 * charged for cold-connection latency the next one avoids.
 */
async function warmUp(browser: Browser, url: string) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    userAgent: VIEWPORTS.desktop.userAgent,
    extraHTTPHeaders: auditHeaders(),
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Gives a JS interstitial a chance to run before the measured loads.
    await page.waitForTimeout(2500);
  } catch {
    /* a failed warm-up must not fail the audit */
  } finally {
    await context.close().catch(() => {});
  }
}

export async function capture({ url, onProgress }: CaptureOptions): Promise<CaptureResult> {
  const browser = await getBrowser();
  const results: Partial<Record<ViewportName, ViewportCapture>> = {};

  onProgress?.("Warming up the connection…");
  await warmUp(browser, url);

  for (const viewport of ["desktop", "mobile"] as ViewportName[]) {
    const cfg = VIEWPORTS[viewport];
    const context = await browser.newContext({
      viewport: { width: cfg.width, height: cfg.height },
      deviceScaleFactor: cfg.deviceScaleFactor,
      isMobile: cfg.isMobile,
      hasTouch: cfg.isMobile,
      userAgent: cfg.userAgent,
      locale: "en-US",
      timezoneId: "UTC",
      ignoreHTTPSErrors: true,
      serviceWorkers: "block",
      extraHTTPHeaders: auditHeaders(),
    });
    context.setDefaultTimeout(NAV_TIMEOUT);
    try {
      results[viewport] = await captureViewport(context, url, viewport, onProgress);
    } finally {
      await context.close().catch(() => {});
    }
  }

  return { desktop: results.desktop!, mobile: results.mobile! };
}
