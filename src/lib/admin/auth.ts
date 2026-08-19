import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Minimal single-admin auth for the dashboard, which shows lead PII and so must
 * not be public. Access is gated by ADMIN_PASSWORD (set on the server). A correct
 * login sets an httpOnly cookie holding an HMAC of a fixed marker keyed by the
 * password — proof of knowledge without storing the password in the cookie.
 *
 * This is deliberately simple: one operator, one shared password. It is not a
 * multi-user system.
 */

const COOKIE = "cro_admin";

function password(): string | null {
  const p = process.env.ADMIN_PASSWORD;
  return p && p.length > 0 ? p : null;
}

export function isAdminConfigured(): boolean {
  return password() !== null;
}

function expectedToken(pw: string): string {
  return createHmac("sha256", pw).update("cro-admin-session-v1").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Verifies the password. Returns the session token to store, or null. */
export function login(candidate: string): string | null {
  const pw = password();
  if (!pw) return null;
  if (!safeEqual(candidate, pw)) return null;
  return expectedToken(pw);
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

/** True if the current request carries a valid admin session. */
export async function isAuthed(): Promise<boolean> {
  const pw = password();
  if (!pw) return false;
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return false;
  return safeEqual(token, expectedToken(pw));
}

/** Guard for admin API routes. Returns a 401/403 Response if not allowed, else null. */
export async function requireAdmin(): Promise<Response | null> {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: "Admin is not configured. Set ADMIN_PASSWORD on the server." },
      { status: 403 }
    );
  }
  if (!(await isAuthed())) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }
  return null;
}
