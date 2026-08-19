"use client";

import { Fragment, useEffect, useState } from "react";

interface Lead {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string | null;
  auditUrl: string | null;
  auditScore: number | null;
  source: string | null;
  forwarded: number;
  forwardError: string | null;
  createdAt: string;
}

interface Stats {
  total: number;
  last7: number;
  forwarded: number;
}

export default function Dashboard() {
  const [phase, setPhase] = useState<"loading" | "unconfigured" | "login" | "ready">("loading");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/auth");
        const d = (await res.json()) as { configured: boolean; authed: boolean };
        if (!active) return;
        if (!d.configured) setPhase("unconfigured");
        else if (d.authed) setPhase("ready");
        else setPhase("login");
      } catch {
        if (active) setPhase("login");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (phase === "loading") {
    return <Centered>Loading…</Centered>;
  }
  if (phase === "unconfigured") {
    return (
      <Centered>
        <div className="panel max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-ink-100">Dashboard not configured</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-400">
            Set an <code className="rounded bg-ink-800 px-1.5 py-0.5 text-ink-200">ADMIN_PASSWORD</code>{" "}
            environment variable on the server and restart, then reload this page to log in.
          </p>
        </div>
      </Centered>
    );
  }
  if (phase === "login") {
    return <Login onSuccess={() => setPhase("ready")} />;
  }
  return <DashboardBody onLogout={() => setPhase("login")} />;
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(d?.error ?? "Login failed.");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <form onSubmit={submit} className="panel w-full max-w-sm p-8">
        <h1 className="text-lg font-semibold text-ink-100">Admin dashboard</h1>
        <p className="mt-1 text-sm text-ink-400">Enter the admin password to continue.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          placeholder="Password"
          className="cta-input mt-5"
        />
        {error && <p className="mt-3 text-sm text-critical">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 w-full rounded-lg bg-brand-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-500"
        >
          {busy ? "Checking…" : "Log in"}
        </button>
      </form>
    </Centered>
  );
}

function DashboardBody({ onLogout }: { onLogout: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  // Bumped to trigger a reload; the fetch lives in the effect so it stays out of
  // synchronous effect execution (React's set-state-in-effect rule).
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/leads");
        if (res.status === 401) {
          if (active) onLogout();
          return;
        }
        const d = (await res.json()) as { stats: Stats; leads: Lead[] };
        if (!active) return;
        setStats(d.stats);
        setLeads(d.leads);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadTick, onLogout]);

  async function logout() {
    await fetch("/api/admin/auth", { method: "DELETE" });
    onLogout();
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-400">
            Admin
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-ink-100">Leads dashboard</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setLoading(true);
              setReloadTick((t) => t + 1);
            }}
            className="rounded-lg border border-ink-600 px-3 py-2 text-xs font-medium text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100"
          >
            Refresh
          </button>
          <button
            onClick={logout}
            className="rounded-lg border border-ink-600 px-3 py-2 text-xs font-medium text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100"
          >
            Log out
          </button>
        </div>
      </header>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <StatCard label="Total leads" value={stats?.total ?? "—"} />
        <StatCard label="Last 7 days" value={stats?.last7 ?? "—"} accent />
        <StatCard label="Sent to Go High Level" value={stats?.forwarded ?? "—"} />
      </div>

      <WebhookSettings />

      <section className="panel mt-8 overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <h2 className="text-sm font-semibold text-ink-100">Leads</h2>
          <span className="text-xs text-ink-500">{leads.length} shown</span>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-ink-400">Loading…</div>
        ) : leads.length === 0 ? (
          <div className="p-10 text-center text-sm text-ink-400">
            No leads yet. They&apos;ll appear here as people submit the contact form at the end of an audit.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-left text-[11px] uppercase tracking-wider text-ink-500">
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Contact</th>
                  <th className="px-5 py-3 font-medium">Audited page</th>
                  <th className="px-5 py-3 font-medium">Score</th>
                  <th className="px-5 py-3 font-medium">GHL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {leads.map((l) => (
                  <Fragment key={l.id}>
                    <tr
                      onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                      className="cursor-pointer transition-colors hover:bg-ink-850/60"
                    >
                      <td className="whitespace-nowrap px-5 py-3 text-ink-400">
                        {new Date(l.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 font-medium text-ink-100">
                        {l.name}
                        {l.company && <span className="block text-xs text-ink-500">{l.company}</span>}
                      </td>
                      <td className="px-5 py-3 text-ink-300">
                        <a
                          href={`mailto:${l.email}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-brand-400 hover:underline"
                        >
                          {l.email}
                        </a>
                        {l.phone && <span className="block text-xs text-ink-500">{l.phone}</span>}
                      </td>
                      <td className="max-w-[220px] truncate px-5 py-3 text-ink-400">
                        {l.auditUrl ? (
                          <a
                            href={l.auditUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-ink-200 hover:underline"
                          >
                            {l.auditUrl}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-3 text-ink-300">{l.auditScore ?? "—"}</td>
                      <td className="px-5 py-3">
                        <ForwardBadge lead={l} />
                      </td>
                    </tr>
                    {expanded === l.id && l.message && (
                      <tr className="bg-ink-900/50">
                        <td colSpan={6} className="px-5 py-3 text-sm text-ink-300">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                            Message:{" "}
                          </span>
                          {l.message}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ForwardBadge({ lead }: { lead: Lead }) {
  if (lead.forwarded)
    return <span className="chip border-good/30 bg-good/10 text-good">Sent</span>;
  if (lead.forwardError)
    return (
      <span className="chip border-critical/30 bg-critical/10 text-critical" title={lead.forwardError}>
        Failed
      </span>
    );
  return <span className="chip border-ink-600 text-ink-500">—</span>;
}

function WebhookSettings() {
  const [url, setUrl] = useState("");
  const [initial, setInitial] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((d: { ghlWebhookUrl?: string }) => {
        setUrl(d.ghlWebhookUrl ?? "");
        setInitial(d.ghlWebhookUrl ?? "");
      })
      .catch(() => {});
  }, []);

  async function save() {
    setState("saving");
    setMsg(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ghlWebhookUrl: url }),
      });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(d?.error ?? "Could not save.");
      setInitial(url);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setState("error");
      setMsg(err instanceof Error ? err.message : "Could not save.");
    }
  }

  async function test() {
    setTestState("testing");
    setMsg(null);
    try {
      const res = await fetch("/api/admin/test-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ghlWebhookUrl: url }),
      });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(d?.error ?? "Test failed.");
      setTestState("ok");
      setMsg("Test lead sent. Check your Go High Level account.");
      setTimeout(() => setTestState("idle"), 3000);
    } catch (err) {
      setTestState("fail");
      setMsg(err instanceof Error ? err.message : "Test failed.");
    }
  }

  return (
    <section className="panel p-6">
      <h2 className="text-sm font-semibold text-ink-100">Go High Level webhook</h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-400">
        Paste an inbound webhook URL from Go High Level (Automation → Workflows → add a{" "}
        <em>Inbound Webhook</em> trigger, then copy its URL). Every new lead is sent there as JSON with
        name, email, phone, company, the audited page and its score.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://services.leadconnectorhq.com/hooks/…"
          className="cta-input flex-1"
        />
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={state === "saving" || url === initial}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-500"
          >
            {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save"}
          </button>
          <button
            onClick={test}
            disabled={testState === "testing" || !url}
            className="rounded-lg border border-ink-600 px-4 py-2.5 text-sm font-medium text-ink-200 transition-colors hover:border-ink-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testState === "testing" ? "Sending…" : "Send test"}
          </button>
        </div>
      </div>
      {msg && (
        <p
          className={`mt-3 text-sm ${
            testState === "fail" || state === "error" ? "text-critical" : "text-good"
          }`}
        >
          {msg}
        </p>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div className="panel p-5">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-500">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${accent ? "text-brand-400" : "text-ink-100"}`}>
        {value}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16 text-sm text-ink-400">
      {children}
    </main>
  );
}
