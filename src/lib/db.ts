import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Storage for captured leads and admin settings. Uses Node's built-in SQLite
 * (node:sqlite) so there is no native dependency to compile — it just needs a
 * writable data directory, which suits a container or VPS deploy.
 *
 * The path is configurable via CRO_DATA_DIR so the host can point it at a mounted
 * volume that survives redeploys.
 */

const DATA_DIR = process.env.CRO_DATA_DIR ?? path.join(process.cwd(), "data");

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  const conn = new DatabaseSync(path.join(DATA_DIR, "cro.db"));
  conn.exec("PRAGMA journal_mode = WAL;");
  conn.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL,
      phone        TEXT,
      company      TEXT,
      message      TEXT,
      audit_url    TEXT,
      audit_score  INTEGER,
      source       TEXT,
      user_agent   TEXT,
      forwarded    INTEGER NOT NULL DEFAULT 0,
      forward_error TEXT,
      created_at   TEXT NOT NULL
    );
  `);
  conn.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db = conn;
  return conn;
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

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

export function insertLead(input: LeadInput): number {
  const info = getDb()
    .prepare(
      `INSERT INTO leads
        (name, email, phone, company, message, audit_url, audit_score, source, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.name,
      input.email,
      input.phone ?? null,
      input.company ?? null,
      input.message ?? null,
      input.auditUrl ?? null,
      input.auditScore ?? null,
      input.source ?? null,
      input.userAgent ?? null,
      new Date().toISOString()
    );
  return Number(info.lastInsertRowid);
}

export function markLeadForwarded(id: number, ok: boolean, error?: string): void {
  getDb()
    .prepare("UPDATE leads SET forwarded = ?, forward_error = ? WHERE id = ?")
    .run(ok ? 1 : 0, ok ? null : (error ?? "unknown error"), id);
}

interface LeadRow {
  id: number;
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
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    company: r.company,
    message: r.message,
    auditUrl: r.audit_url,
    auditScore: r.audit_score,
    source: r.source,
    forwarded: r.forwarded,
    forwardError: r.forward_error,
    createdAt: r.created_at,
  };
}

export function listLeads(limit = 200): Lead[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, email, phone, company, message, audit_url, audit_score, source, forwarded, forward_error, created_at
       FROM leads ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as unknown as LeadRow[];
  return rows.map(rowToLead);
}

export function leadStats(): { total: number; last7: number; forwarded: number } {
  const dbc = getDb();
  const total = (dbc.prepare("SELECT COUNT(*) c FROM leads").get() as { c: number }).c;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const last7 = (
    dbc.prepare("SELECT COUNT(*) c FROM leads WHERE created_at >= ?").get(since) as { c: number }
  ).c;
  const forwarded = (
    dbc.prepare("SELECT COUNT(*) c FROM leads WHERE forwarded = 1").get() as { c: number }
  ).c;
  return { total, last7, forwarded };
}

export const SETTING_GHL_WEBHOOK = "ghl_webhook_url";
