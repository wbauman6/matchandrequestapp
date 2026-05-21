# Walter Bauman Jewelers — Request Matching App

## What this is
A **private (custom) Shopify app** for Walter Bauman Jewelers, a single jewelry
store. It helps sales staff track customer special-order requests, match those
requests against inventory by keyword, and notify the right salesperson when a
match appears.

This is NOT a public App Store app. It is distributed privately to one store via
a **custom distribution link** from the Shopify Partner dashboard. Do not add
App Store billing, the review-process scaffolding, or multi-tenant complexity.

## Source prototype
`prototype.html` (in this repo) is a working single-file localStorage prototype.
It is the **design spec** — reuse its logic, but do not treat its architecture
as the target.

Reuse nearly as-is (plain JavaScript, move straight into the app):
- `computeMatch()` — keyword overlap scoring
- `wordSim()` / `levenshtein()` — fuzzy keyword similarity
- `checkMatches()` — match generation (rewire to DB + email instead of
  localStorage + fake toast)

Replace entirely:
- `localStorage` Store → the app database
- `notifyMatchByEmail()` — currently a fake toast; make it send a real email
- Manual-only tag entry → keep manual entry as a fallback, add AI suggestion

## Tech stack
- Shopify Remix app template (`shopify app init`, Remix template)
- Prisma ORM
- Database: **Postgres** in production (Neon or Vercel Postgres). The template's
  default SQLite will NOT survive on serverless hosting — switch to Postgres
  early, in phase 1.
- Hosting: Vercel
- Polaris (Shopify's UI library) is encouraged. The prototype's gold/cream
  styling may be adapted, but prioritize a working app over pixel-matching it.

## Inventory source — DECIDED
Inventory is **read live from the store's Shopify product catalog** via the
Admin API. The app does NOT keep its own inventory table and does NOT have
inventory create/edit pages. Products and stock already live in Shopify; the
app's job is the request side and the matching layer on top.
- Keywords for matching come from the products' Shopify tags (both
  auto-applied and staff-added). The full set of distinct product tags is the
  store's vocabulary — feature 1 tags requests by selecting from this same set.
- Matching always runs against currently in-stock products.

## Data model (Prisma)
Two core models beyond the template's `Session`:
- `Request` — customer name, customer email, salesperson name, salesperson
  email, description, keywords, priority, status, pinned, timestamps
- `Match` — requestId, Shopify product id, score, matched keywords, read flag,
  timestamps

(No `InventoryItem` model — inventory is fetched live from Shopify, not stored.)

Scope every record to the installing shop domain so data stays isolated.

## Headline feature 1 — AI keyword tagging from the store's own vocabulary
The AI does NOT invent keywords from scratch. It tags requests using the
**vocabulary the store already uses** — the tags already present on Shopify
products (both Shopify's auto-applied tags and the ones inventory staff add by
hand). This keeps request keywords and product keywords drawn from the same
word pool, so matching lines up reliably.

How it works:
- Before tagging, gather the full set of distinct tags currently in use across
  the store's Shopify products via the Admin API. This is the "controlled
  vocabulary." Read it **live** each time — no model training, no stored model.
  As inventory staff add new tags over time, the AI automatically has them.
- Server route, e.g. `app/routes/api.keywords.tsx`. It receives a request
  description plus the current vocabulary list, calls the Anthropic API, and
  returns the subset of existing tags that genuinely fit the description.
- Instruction to the model: apply **every existing tag that genuinely fits,
  and only those** — do not over-tag, and do not invent new tags. Match
  strength is decided later by the scoring engine, not by tag count.
- `ANTHROPIC_API_KEY` lives in environment variables, never in client code.
- UX is **suggest-then-confirm**: pre-fill the tag input with the AI's chosen
  tags; staff can edit or remove them before saving. Do not silently
  auto-commit tags.
- Allow staff to still add a free-typed tag manually if nothing in the
  vocabulary fits — but the default path is selection from existing tags.

Do NOT train a custom model. "Learning the store's tags" means reading the
live Shopify tag list each time, nothing more.

## No user accounts — DECIDED
The app has **no salesperson logins**. It runs inside the Shopify admin; anyone
with store admin access uses it. A "salesperson" is just a name + email on a
request, not an account. They are reached only by email notification.

To avoid alerts silently failing on a mistyped address, maintain a small
**salesperson list (name + email) in the app's settings**, and have the request
form pick the salesperson from that list rather than free-typing an email.

## Headline feature 2 — Auto-email the salesperson
- Server route, e.g. `app/routes/api.notify.tsx`, called from the
  match-creation flow
- Use **Resend** to send mail; `RESEND_API_KEY` in environment variables
- The sending domain must be verified in Resend (DNS records) before production
- Email goes to the salesperson email on the request (chosen from the settings
  list) and includes: customer name, matched product, match score, and the
  matched keywords

## Build phases — do ONE at a time, commit between each
1. Scaffold with the Shopify CLI, switch Prisma to Postgres, confirm the empty
   app loads inside a development store.
2. Add the `Request` and `Match` models and run migrations.
3. Port the Requests / Matches / History pages wired to the database. Pull
   inventory live from the Shopify product catalog via the Admin API. Port the
   matching engine module.
4. Add the AI keyword route and the suggest-confirm UI. Add the salesperson
   list to the settings page.
5. Add the email route and the match-alert email template.
6. Deploy to Vercel, generate the custom distribution link, install on the live
   store.

## Rules / conventions
- Always develop against a Shopify **development store**, never the live store,
  until phase 6.
- Never commit secrets. All keys go in `.env` (gitignored) and the Vercel
  dashboard.
- Commit after each phase reaches a working state.
- Keep the matching logic in a single module so it stays easy to test.

## Open decisions
None outstanding. Inventory source and the no-login model are both decided
above. If a new decision arises mid-build, ask the human before assuming.
