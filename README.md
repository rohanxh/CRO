# CRO Audit

Paste a URL. A real browser loads the page on desktop and mobile, measures what a visitor
actually experiences, works out what the page is trying to achieve, and returns a prioritised
list of things to fix.

It is deliberately **not niche-specific**. Nothing is hard-coded to SaaS, ecommerce or local
services. The tool reads the page, infers the business model, audience and conversion goal,
then judges the page against what would work for *that* goal.

## How it works

```
URL
 └─ validate + resolve         SSRF guard, blocks private/internal addresses
 └─ warm up                    primes DNS/TLS so the first viewport is not penalised
 └─ capture (Playwright)       desktop 1440x900 and mobile 390x844, run separately
 │    ├─ screenshots           above-the-fold + full page, per viewport
 │    ├─ DOM evidence          CTAs, forms, headings, trust signals, tap targets, contrast
 │    └─ performance           LCP, CLS, FCP, TTFB, payload, blocking resources
 └─ heuristics                 ~60 deterministic conversion checks with measurements
 └─ analysis (Claude)          reads the screenshots + evidence, produces the final findings
 └─ score + prioritise         severity x impact x confidence, with diminishing returns
```

The two layers do different jobs. **Heuristics** measure things precisely and never
hallucinate, but cannot judge whether a headline is persuasive. **Claude** sees the
screenshots and the measurements together, and produces the final report: it adopts the
measured findings that matter for this page, rewrites them in context with the page's real
content, discards the ones that are technically true but irrelevant, and adds the judgement
calls a rule cannot make.

If the AI step is unavailable, the tool still returns the measured findings and labels the
report as limited, rather than failing.

## Running locally

```bash
npm install
npx playwright install chromium
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000.

### Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes, for full reports | Enables the page-analysis step |
| `CRO_MODEL` | no | Defaults to `claude-sonnet-5` |

Without the key the app runs and returns the measured checks only.

## Deploying

The audit runs a real Chromium instance for 20–90 seconds per request, so it needs a
long-lived Node process with enough memory. It is **not** a good fit for short-timeout
serverless functions.

**Container (recommended)** — works on Railway, Render, Fly.io, a VPS, or anywhere else
that runs Docker:

```bash
docker build -t cro-audit .
docker run --shm-size=1g -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... cro-audit
```

`--shm-size=1g` matters: Chromium crashes on Docker's default 64 MB `/dev/shm`.

**Plain Node host** — `npm ci && npx playwright install --with-deps chromium && npm run build && npm start`.

Give the process at least 2 GB of memory and set the platform's request timeout to 300s or
more. The browser instance is reused across requests, so subsequent audits are faster.

## Project layout

```
src/
  app/
    page.tsx                 URL form + live progress, renders the report
    api/audit/route.ts       streams NDJSON progress events, then the report
  components/
    ReportView.tsx           scores, page understanding, metrics, filters
    IssueCard.tsx            one finding, expandable
    ui.tsx                   dials, bars, chips
  lib/
    audit.ts                 orchestrates the whole run
    types.ts                 shared contracts
    score.ts                 scoring and prioritisation
    capture/
      index.ts               Playwright orchestration, both viewports
      extract.ts             runs inside the page; all DOM/style evidence
      url.ts                 URL validation and SSRF protection
    heuristics/index.ts      the deterministic checks
    analyze/
      claude.ts              structured-output call
      prompt.ts              evidence digest + system prompt
```

### Adding a check

Add it to `src/lib/heuristics/index.ts` via `bag.add(...)`. It is picked up automatically:
it appears in the report, is passed to Claude as grounding, and feeds the score. Give it a
real measurement in the `evidence` field — that is what stops findings being generic.

## Notes and limits

- Audits a **single page** at a time, not a whole site crawl.
- Performance figures come from one cold-ish load on a fast connection, so treat them as
  directional rather than as field data. Real-user metrics need CrUX or RUM.
- Sites behind aggressive bot protection may block the browser; the tool reports this
  instead of guessing.
- Rendering is Chromium only.
