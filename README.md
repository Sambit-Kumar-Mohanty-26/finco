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
| `pnpm e2e:shoot -- --url <url>` | Screenshot desktop + mobile, report horizontal overflow |
| `pnpm e2e:arc -- --url <url>` | Verify scroll reveals fire on entry and nothing is left invisible |
| `pnpm logo:cutout` | Re-cut `logo.png` from source art (background removal) |

## `pnpm check` — the gate that matters

Two suites, no test framework, plain `node:assert`. They exist because the
figures on this site are not decorative: they are a ledger, and a ledger that
does not tie is worse than no ledger.

**Money** (`packages/core`) — Indian digit grouping (`2,41,880.00`, never
`241,880.00`), zero rendered as `0.00` and never blank, negatives, the crore
boundary, a value above 2^53 proving the bigint path, and spoken labels for
screen readers (`"two lakh forty-one thousand eight hundred eighty rupees"`).

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
│   └── web/                 Next.js 15, App Router — the marketing site
│       ├── app/             routes, layout, globals.css, icons
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
        └── src/money.ts     Paise (bigint), formatINR, spokenINR
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

Vercel, with **Root Directory set to `apps/web`** and *Include files outside the
Root Directory* enabled — this is a pnpm workspace, so the build needs the repo
root to resolve `@finco/core`. No environment variables are required; the route
is fully static.

## Status

Pre-launch. The figures throughout come from a seeded synthetic scenario with a
known answer key, **not** from a live merchant account. The site says so in its
own footer, and that should stay true until it isn't.

## Licence

MIT — see [LICENSE](LICENSE).
