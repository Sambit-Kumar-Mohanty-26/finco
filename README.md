# FinCo

Reconciliation and close for Indian merchants on Razorpay.

FinCo matches Razorpay settlement rows to your bank statement and your ERP
invoice register, posts a balanced double-entry journal, and **refuses every
match it cannot close to zero paise**. Anything it cannot prove is emitted as a
typed, evidenced exception with an owner and an age — and its value parks in a
suspense account that has to reach zero before the period can lock.

The product is not the matcher. The product is the verifier.

---

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Requires Node ≥ 22.11 (see `.nvmrc`) and pnpm ≥ 10.

## Scripts

Run from the repository root.

| Command | What it does |
|---|---|
| `pnpm dev` | Marketing site in dev mode |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm typecheck` | `tsc --noEmit` across every workspace |
| `pnpm lint` | ESLint |
| `pnpm check` | **Domain self-checks — see below** |
| `pnpm db:generate` | Generate a migration from the Drizzle schema |
| `pnpm db:migrate` | Apply migrations to Neon |
| `pnpm e2e:shoot -- --url <url>` | Screenshot desktop + mobile, report horizontal overflow |
| `pnpm e2e:arc -- --url <url>` | Verify scroll reveals fire on entry and nothing is left invisible |
| `pnpm logo:cutout` | Re-cut `logo.png` from source art (background removal) |

## `pnpm check` — the gate that matters

Thirteen check files, no test framework, plain `node:assert`. They exist
because the figures on this site are not decorative: they are a ledger, and a ledger that
does not tie is worse than no ledger.

**Money** (`packages/core`) — Indian digit grouping (`2,41,880.00`, never
`241,880.00`), zero rendered as `0.00` and never blank, negatives, the crore
boundary, a value above 2^53 proving the bigint path, and spoken labels for
screen readers (`"two lakh forty-one thousand eight hundred eighty rupees"`).

**Domain** (`packages/core`) — `allocate()` never loses a paisa across 3,000
generated splits, and the T+2 banking window respects weekends and RBI holidays.

**Forecast** (`packages/core`) — the settlement calendar skips weekends and RBI
holidays at T+2 domestic and T+7 international; refund propensity is fitted per
method and cohort age; and the fortnight curve is **backtested against held-out
history** — fit on the first half of a synthetic book, scored on the second.
Money already settled is never forecast again, and money already overdue is
never dropped.

**Recon** (`apps/api`) — the int8 parser is registered; the direct connection URL
derives correctly from `DATABASE_URL`; four bank narration formats parse and an
unreadable one yields `null` rather than an invented UTR; I1 closes only when the
fee is not double-subtracted; and a 500-row seeded scenario yields a **fixed**
match count of 496/505 at precision 1.000 against the truth file. If that number
moves, the engine changed — the fixture is deterministic.

**Policy** (`apps/api`) — a one-row edit breaks the audit chain at the exact
sequence number it was made at, and a deleted entry breaks the links either side;
the kill switch holds a *proven* under-cap link at **every** tier, not just the
model one; observe mode posts nothing; and the webhook HMAC rejects a tampered
body, a truncated digest and the wrong secret. This is the security path, so it
is checked like one.

**Ledger** (`apps/web`) — the trial balance balances, the journal balances, the
9999 suspense balance equals the sum of the open exceptions *and* equals the
run's unproven figure, stage counts are monotonic, the headline auto-match rate
equals matched rows ÷ total rows, and the agent stage moves no counts because
it proposes rather than posts.

If a fixture drifts, CI fails here rather than shipping a page that quietly
contradicts itself.

## Layout

```
finco/
├── apps/
│   ├── api/                 Express 5 → Render (server + worker + cron)
│   │   ├── src/server.ts    entrypoint 1: HTTP
│   │   ├── src/worker.ts    entrypoint 2: queue consumer (P3)
│   │   ├── src/cron.ts      entrypoint 3: scheduled pull (P8)
│   │   ├── src/recon/       engine, narration parsing, seeded scenario
│   │   ├── src/agent/       the T5 proposer, fenced and verifier-gated
│   │   ├── src/routes/      health, datasets, runs, cash, settings, periods…
│   │   ├── src/policy.ts    per-tenant policy, the tenant scope helper, audit
│   │   └── src/db/          drizzle schema, migrations, int8 parser
│   └── web/                 Next.js 15, App Router → Vercel
│       ├── app/(marketing)/ the landing page
│       ├── app/(app)/       the product screens — same app, route group
│       ├── components/
│       │   ├── app/         AppFrame + product screens (the "screenshots")
│       │   ├── hero/        scroll-pinned camera move
│       │   ├── site/        nav, footer, motion primitives
│       │   ├── demos/       animated product surfaces
│       │   └── money/       <Money> — paise in, formatted out
│       ├── lib/fixtures/    the data every screen renders
│       ├── e2e/             Playwright QA + logo cutout tooling
│       └── public/          logo assets
└── packages/
    └── core/                @finco/core — pure domain, zero IO
        ├── src/money.ts     Paise (bigint), formatINR, spokenINR
        └── src/forecast.ts  settlement calendar, propensity, the p10/p50/p90 curve
```

**Why `packages/core` exists.** Money is `bigint` paise everywhere;
JavaScript's `number` loses integer precision above 2^53 and the failure is
silent. When `apps/api` lands it must share the *same* `Paise` type — two
implementations across two services is exactly the bug that produces a rounding
difference between server and client, which is nearly impossible to debug from
a screenshot.

## Conventions worth knowing before editing

- **Money is `bigint` paise.** There is no helper that accepts rupees. Conversion
  happens once, at the boundary, in `@finco/core`. Summing money on the client
  is a lint error.
- **Colour is semantic, not decorative.** Green = proven / closes to zero.
  Slate = deterministic arithmetic. Clay = model-generated. Amber = refused.
  These only appear on product surfaces.
- **Motion never hides content.** Every reveal has a no-JS fallback
  (`<noscript>`) and a designed `prefers-reduced-motion` final frame — reduced
  motion shows the finished state, never a degraded one.
- **Nothing on the page is a picture.** The product "screenshots" are the real
  components rendering the checked fixtures, so marketing cannot drift from the
  product.

## Deploying

**Web → Vercel.** Root Directory `apps/web`, *Include files outside the Root
Directory* enabled — this is a pnpm workspace, so the build needs the repo root
to resolve `@finco/core`. Set `NEXT_PUBLIC_API_URL`; it is inlined at build
time, so changing it requires a redeploy.

**API → Render.** Leave Root Directory **empty**: `apps/api` depends on
`packages/core`, and Render only redeploys on changes inside the root directory
you set — so scoping it to `apps/api` would leave production running stale money
code with nothing failing. `render.yaml` declares all three services and every
variable each one needs.

Both services and the database sit in **Singapore**. Neon's free plan has no
India region and Render has none at all, so payment data does not stay in India
under this topology — a documented trade, not a residency guarantee.

**Every credential is optional and fails soft.** No `GEMINI_API_KEY` and the
close runs on the five deterministic tiers. No `RAZORPAY_WEBHOOK_SECRET` and
`POST /webhooks/razorpay` answers 503. No Razorpay API keys and the nightly pull
logs that it is unconfigured and exits **0**, because a nightly red cross
everyone learns to ignore is worse than no alert. No `ALERT_WEBHOOK_URL` and
alerts are still logged. No `SENTRY_DSN` and the SDK never initialises, which is
how CI and local dev stay offline. No `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
and the Google button is not offered — email and password still work, so a
missing key costs one sign-in option rather than locking everybody out.
`apps/api/.env.example` lists all of them with mock values; real ones go in
`.env`, which is gitignored.

**Google sign-in** is the server-side authorization-code flow, hand-rolled, no
OAuth library. It needs two things to line up exactly: `PUBLIC_API_URL`, because
`<PUBLIC_API_URL>/v1/auth/google/callback` must byte-for-byte equal a redirect
URI registered in the Google console, and `ALLOWED_ORIGINS`, whose first entry is
where the browser is sent after a successful sign-in. Deriving the callback from
the `Host` header instead would let a client pick it, which is why it is
configured.

## Going live

1. `pnpm db:migrate` — additive migrations only, so this is safe against a
   running deploy.
2. Sign up at `/signup`. That creates a tenant with you as its **approver** —
   there is no invite flow yet, so a second person signing up gets their own
   workspace, not a seat in yours. Policy is per tenant and
   lives in the database, not in env: autonomy mode, autonomy cap, materiality,
   cash floor and suspense ceiling are all edited at `/settings/policy` and every
   change is written to the hash-chained audit log.
3. Leave autonomy in **observe** for the first period. It reconciles, scores and
   reports end to end and posts nothing at all.
4. Point Razorpay's webhook at `POST /webhooks/razorpay` and paste the same
   secret into `RAZORPAY_WEBHOOK_SECRET`. The signature is verified over the raw
   bytes, so that route is the one place `express.json()` must not run first.
5. Confirm the 06:00 IST cron. The webhook is a latency optimisation; the pull is
   the source of truth, and the two are allowed to disagree — the pull wins.
6. Check `/settings/connections`: every source proves itself with a real row and
   a real timestamp, not a green tick.
7. Watch the agreement report on a few runs (`/runs/<id>`, "Agreement"). It
   counts where the engine and the humans differed and in which direction —
   *timid* is cheap, *wrong* is not. Move to **assist** when that number earns
   it, not when the calendar says so.

**The restore drill.** Neon point-in-time restore is not verified until it has
been done once, and the wrong day to learn the retention window is the day you
need it. Quarterly, roughly ten minutes:

1. Note a known figure — a run's `unprovenPaise`, say — and the UTC time.
2. Neon → Branches → **New branch** → *from a point in time*, an hour earlier.
3. Point a scratch `DATABASE_URL` at the branch and run `pnpm check` plus one
   read of the same figure. It should match the value from an hour ago, not
   today's.
4. Delete the branch. Record the date and the restored figure.

The drill proves three separate things, which is why it beats trusting the
setting: that retention actually covers the window, that the restored branch is
usable by this schema, and that whoever runs it knows the steps.

## Status

Feature-complete through P8; running on synthetic data. The figures throughout
come from a seeded scenario with a known answer key, **not** from a live
merchant account. The site says so in its own footer, and that should stay true
until it isn't.

## Licence

MIT — see [LICENSE](LICENSE).
