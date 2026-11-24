import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";

/**
 * Lead + settings storage with two interchangeable backends:
 *
 * - If DATABASE_URL is set, use Postgres (works with Neon, Supabase, Railway, or
 *   any Postgres) — the right choice for a deployed, shared, persistent store.
 * - Otherwise fall back to Node's built-in SQLite (node:sqlite) in a local file,
 *   so local dev needs zero setup.
 *
 * Same async API either way; callers don't care which is in use. created_at is
 * stored as an ISO string in both, so behaviour is identical.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const usePg = !!DATABASE_URL;

export const SETTING_GHL_WEBHOOK = "ghl_webhook_url";

export interface LeadInput {
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
  auditUrl?: string | null;
  auditScore?: number | null;
  source?: string | null;
  userAgent?: string | null;
}

export interface Lead extends LeadInput {
  id: number;
  forwarded: number;
  forwardError: string | null;
  createdAt: string;
}

// ---- backend singletons, initialised once ----

let sqlite: DatabaseSync | null = null;
let pgPool: Pool | null = null;
let ready: Promise<void> | null = null;

function sqliteDb(): DatabaseSync {
  if (sqlite) return sqlite;
  const dir = process.env.CRO_DATA_DIR ?? path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const conn = new DatabaseSync(path.join(dir, "cro.db"));
  conn.exec("PRAGMA journal_mode = WAL;");
  conn.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, company TEXT, message TEXT,
      audit_url TEXT, audit_score INTEGER, source TEXT, user_agent TEXT,
      forwarded INTEGER NOT NULL DEFAULT 0, forward_error TEXT, created_at TEXT NOT NULL
    );
  `);
  conn.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  sqlite = conn;
  return conn;
}

async function pg(): Promise<Pool> {
  if (pgPool) return pgPool;
  const { Pool } = await import("pg");
  pgPool = new Pool({ connectionString: DATABASE_URL, max: 5 });
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, company TEXT, message TEXT,
      audit_url TEXT, audit_score INTEGER, source TEXT, user_agent TEXT,
      forwarded INTEGER NOT NULL DEFAULT 0, forward_error TEXT, created_at TEXT NOT NULL
    );
  `);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  return pgPool;
}

function ensure(): Promise<void> {
  if (!ready) ready = usePg ? pg().then(() => undefined) : Promise.resolve(sqliteDb() && undefined);
  return ready;
}

// ---- settings ----

export async function getSetting(key: string): Promise<string | null> {
  await ensure();
  if (usePg) {
    const { rows } = await (await pg()).query("SELECT value FROM settings WHERE key = $1", [key]);
    return rows[0]?.value ?? null;
  }
  const row = sqliteDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await ensure();
  const sql =
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value";
  if (usePg) {
    await (await pg()).query(sql, [key, value]);
    return;
  }
  sqliteDb().prepare(sql.replace("$1", "?").replace("$2", "?")).run(key, value);
}

// ---- leads ----

export async function insertLead(input: LeadInput): Promise<number> {
  await ensure();
  const vals = [
    input.name,
    input.email,
    input.phone ?? null,
    input.company ?? null,
    input.message ?? null,
    input.auditUrl ?? null,
    input.auditScore ?? null,
    input.source ?? null,
    input.userAgent ?? null,
    new Date().toISOString(),
  ];
  if (usePg) {
    const { rows } = await (await pg()).query(
      `INSERT INTO leads (name,email,phone,company,message,audit_url,audit_score,source,user_agent,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      vals
    );
    return Number(rows[0].id);
  }
  const info = sqliteDb()
    .prepare(
      `INSERT INTO leads (name,email,phone,company,message,audit_url,audit_score,source,user_agent,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(...vals);
  return Number(info.lastInsertRowid);
}

export async function markLeadForwarded(id: number, ok: boolean, error?: string): Promise<void> {
  await ensure();
  const args = [ok ? 1 : 0, ok ? null : (error ?? "unknown error"), id];
  if (usePg) {
    await (await pg()).query("UPDATE leads SET forwarded = $1, forward_error = $2 WHERE id = $3", args);
    return;
  }
  sqliteDb().prepare("UPDATE leads SET forwarded = ?, forward_error = ? WHERE id = ?").run(...args);
}

interface LeadRow {
  id: number | string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string | null;
  audit_url: string | null;
  audit_score: number | null;
  source: string | null;
  forwarded: number;
  forward_error: string | null;
  created_at: string;
}

function rowToLead(r: LeadRow): Lead {
  return {
    id: Number(r.id),
    name: r.name,
    email: r.email,
    phone: r.phone,
    company: r.company,
    message: r.message,
    auditUrl: r.audit_url,
    auditScore: r.audit_score,
    source: r.source,
    forwarded: Number(r.forwarded),
    forwardError: r.forward_error,
    createdAt: r.created_at,
  };
}

const SELECT_LEADS =
  "SELECT id,name,email,phone,company,message,audit_url,audit_score,source,forwarded,forward_error,created_at FROM leads ORDER BY id DESC LIMIT";

export async function listLeads(limit = 200): Promise<Lead[]> {
  await ensure();
  if (usePg) {
    const { rows } = await (await pg()).query(`${SELECT_LEADS} $1`, [limit]);
    return (rows as LeadRow[]).map(rowToLead);
  }
  const rows = sqliteDb().prepare(`${SELECT_LEADS} ?`).all(limit) as unknown as LeadRow[];
  return rows.map(rowToLead);
}

export async function leadStats(): Promise<{ total: number; last7: number; forwarded: number }> {
  await ensure();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (usePg) {
    const pool = await pg();
    const total = Number((await pool.query("SELECT COUNT(*) c FROM leads")).rows[0].c);
    const last7 = Number(
      (await pool.query("SELECT COUNT(*) c FROM leads WHERE created_at >= $1", [since])).rows[0].c
    );
    const forwarded = Number(
      (await pool.query("SELECT COUNT(*) c FROM leads WHERE forwarded = 1")).rows[0].c
    );
    return { total, last7, forwarded };
  }
  const db = sqliteDb();
  const total = Number((db.prepare("SELECT COUNT(*) c FROM leads").get() as { c: number }).c);
  const last7 = Number(
    (db.prepare("SELECT COUNT(*) c FROM leads WHERE created_at >= ?").get(since) as { c: number }).c
  );
  const forwarded = Number(
    (db.prepare("SELECT COUNT(*) c FROM leads WHERE forwarded = 1").get() as { c: number }).c
  );
  return { total, last7, forwarded };
}
