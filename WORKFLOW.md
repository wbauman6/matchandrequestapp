# Working on this app

There are two copies of this codebase. Confusing them is the one mistake that
can reach customers, so this file exists to make the difference unmissable.

## The two copies

| | **Live store** | **SaaS fork** |
|---|---|---|
| Path | `C:\Users\wbaum\matchandrequestapp` | `C:\Users\wbaum\OneDrive\Bauman Apps LLC\matchandrequestapp` |
| Branch | `main` | `saas` |
| Who uses it | Walter Bauman Jewelers | nobody yet — future customers |
| Database | production Neon | Neon branch `saas-dev` |
| Git remote | `github.com/wbauman6/matchandrequestapp` | **none** |
| Deploys to | Vercel `matchandrequestapp2` + real POS iPads | nowhere |

**Say which one you mean before asking for a change.** "Fix the matching bug"
is ambiguous; "fix the matching bug on the live store" is not.

### How to tell them apart in a terminal

```bash
git remote -v          # live store has a remote; the fork has none
git branch --show-current   # main = live, saas = fork
```

The fork has no `shopify.app.toml` (it is renamed `.bak`, because it holds the
live app's client_id). That is deliberate: it makes the fork impossible to
deploy to the live store by accident.

## Rules that are not negotiable

1. **Never run `shopify app deploy` from the fork.** It would push extensions
   to the real POS iPads. The fork's config is disarmed to prevent this; do
   not re-arm it.
2. **Check `DATABASE_URL` before any migration.** The two copies must never
   share a database. `node scripts/verify-dev-db.mjs` (in the fork) refuses to
   run if it is pointed at production.
3. **`prisma migrate dev` does not work here.** This database's migration
   history is drifted and Prisma will demand a destructive reset. Write an
   additive, idempotent `.sql` file and apply it with:
   ```bash
   node scripts/apply-sql.mjs prisma/migrations/<name>/migration.sql
   ```
4. **Run `node scripts/patch-prisma.cjs` after every `prisma generate`.**
   This machine is Windows ARM64 and there is no native Prisma engine; without
   the patch you get `wasm module undefined`.
5. **Schema first, then code.** Columns must exist in the database before the
   code that reads them deploys, or the app throws on load.

## What ships where

`shopify app deploy` ships **extensions only** — the POS tile and the
storefront form. The backend (everything in `app/`) ships to Vercel on
`git push`. A change to `app/routes/*.jsx` needs a push; a change to
`extensions/**` needs a deploy. A change to both needs both.

## Before saying something is done

```bash
npm run test        # currently 93 passing
npm run build
npx eslint app/     # see baseline note below
```

Lint has a long-standing baseline of `prop-types` errors. Judge a change by
whether it adds a *new kind* of error, not by the total.

For anything touching matching, filtering or classification, verify against
the real database rather than only unit tests — the live data contains
phrasings no fixture would predict ("Van clef", "7 ct ... 5 to 7", "silver e
newton"), and those are exactly the cases that break.

## Things that look like bugs but are not

- **Fork `vite dev` returns 500 `Detected an empty appUrl configuration`.**
  Correct: the fork has no Shopify app config. It cannot be run locally
  without linking it to a *new* dev app.
- **POS UI cannot be previewed on a computer.** POS extensions render only
  inside the Shopify POS iOS app. Changes to `extensions/requests-pos/` must
  be checked on the iPad.
- **`navigation.navigate(...)` with no import.** `navigation` is a POS runtime
  global. The eslint `no-undef` warning on it is a false positive — do not
  "fix" it to `shopify.navigation`, which is wrong and breaks Open product.

## Known state

- Live store: ~5,700 embedded products. Every queued product now has a current
  embedding (a one-off backfill cleared the last 287).
- `ProductQueue` holds ~3,800 products awaiting **matching**, not embedding.
  Measured cost to clear it: ~8,800 (request x product) candidates survive the
  retrieval gate, which is about **220 batched reasoning calls** — comfortably
  under one day's cap. The backlog was never expensive, only starved: one
  90-second window a week cannot get through it.
- `QUEUE_CATCHUP=1` lets the daily cron drain as well as the weekly window,
  which clears that backlog in days instead of months. **Default off**,
  because it changes when money is spent. The AI budget counter remains the
  circuit breaker either way.
- AI call cap is `ANTHROPIC_DAILY_CALL_LIMIT`, currently 1500. It was 500 and
  was being hit, partly by junk: one question generated 113 matches and one
  soldering job 55. Those are now classified out, so re-measure before
  treating 1500 as permanent.
- Requests carry a `requestKind`. Existing rows were backfilled once: 57 item,
  2 buying, 2 service, 2 spam, 1 question, 1 price.
