import { promises as dns } from "node:dns";
import net from "node:net";

export class UrlValidationError extends Error {}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
]);

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/** Normalizes user input into an https/http URL and rejects anything that could reach internal infrastructure. */
export async function validateTargetUrl(input: string): Promise<string> {
  const raw = (input || "").trim();
  if (!raw) throw new UrlValidationError("Enter a website URL.");
  if (raw.length > 2000) throw new UrlValidationError("That URL is too long.");

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UrlValidationError("That does not look like a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UrlValidationError("Only http and https URLs can be audited.");
  }
  if (url.username || url.password) {
    throw new UrlValidationError("URLs with embedded credentials are not allowed.");
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new UrlValidationError("Internal hostnames cannot be audited.");
  }
  if (!host.includes(".") && net.isIP(host) === 0) {
    throw new UrlValidationError("Enter a full domain, for example example.com.");
  }

  if (net.isIPv4(host) && isPrivateIpv4(host)) {
    throw new UrlValidationError("Private network addresses cannot be audited.");
  }
  if (net.isIPv6(host) && isPrivateIpv6(host)) {
    throw new UrlValidationError("Private network addresses cannot be audited.");
  }

  if (net.isIP(host) === 0) {
    let records: string[];
    try {
      const looked = await dns.lookup(host, { all: true, verbatim: true });
      records = looked.map((r) => r.address);
    } catch {
      throw new UrlValidationError(`Could not resolve ${host}. Check the domain and try again.`);
    }
    if (!records.length) {
      throw new UrlValidationError(`Could not resolve ${host}.`);
    }
    for (const addr of records) {
      const bad = net.isIPv4(addr) ? isPrivateIpv4(addr) : isPrivateIpv6(addr);
      if (bad) throw new UrlValidationError("That domain resolves to a private address.");
    }
  }

  return url.toString();
}
