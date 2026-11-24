# Diagnostics, POS wishlist marking, and a two-codebase workflow

> **For Hermes:** execute task-by-task, in order. Phase 0 before any change.

**Goal:** Prove what is and isn't working in the live store today, then make website-submitted requests obvious in POS, and establish a repeatable way to work across the live store app and the SaaS build.

**Context:** Two codebases now exist. The live store (`C:\Users\wbaum\matchandrequestapp`, branch `main`, deploys to Vercel via `git push`) and the SaaS build (`C:\Users\wbaum\OneDrive\Bauman Apps LLC\matchandrequestapp`, branch `saas`, no remote, never deploys). The jewelry vocabulary backport is committed and merged on live `main` at `180930a` but **not yet pushed or deployed**.

---

## Findings already confirmed (read-only, before this plan)

These are facts from the live database, not guesses:

1. **AI budget was exceeded and silently killed a request.** One active request is stuck in `matchState: "error"`:
   - id `cmun7047l0000xe0jgavtgfkm`, "White gold 22 inch box chain 2.5 mm"
   - error: `AI daily call budget exceeded (511/500) — matching paused until tomorrow`
   - The cap is the default 500/day; `ANTHROPIC_DAILY_CALL_LIMIT` is not set in `.env`.

2. **"silver e newton" returns nothing, and the catalog explains why.** Request `cmw6odyd30003yf0jf79j4845` has `matchState: "ok"` with no error — matching ran fine and found nothing. But:
   - only **2 products** in `ProductEmbedding` mention "newton" at all
   - **zero** products match newton + silver
   - enewton is a real brand the store carries, so 2 embedded products is implausible

   Two candidate causes, and they are not mutually exclusive:
   - **(a) Catalog gap** — enewton products exist in Shopify but were never embedded.
   - **(b) Brand normalization gap** — the brand is styled **"enewton"** (one word). A request for "e newton" (two words) will not match. There is no equivalent rule for this, even in the expanded 927-term vocabulary.

3. **Request volume:** 51 active / 4 fulfilled / 4 archived / 1 errored.

---

## Phase 0 — Diagnostics (do this first, change nothing)

### Task 0.1: Build a read-only diagnostics script

**Objective:** One command that reports system health, so this is repeatable instead of ad-hoc.

**Files:**
- Create: `scripts/diagnose.mjs` (live repo)

Must report, all read-only:
- env keys present/absent (names only, never values): `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `DATABASE_URL`
- today's AI call count vs cap, and whether the cap was hit in the last 7 days
- requests by `status` × `matchState`, listing every `error` row with its `matchError`
- requests stuck `pending` beyond `MATCH_STALL_MS`
- catalog: total embedded, in-stock, products with no embedding, median description length
- matches: total, emailed, `needsReview` backlog
- last `DropRun` rows with status and timing

**Verify:** `node scripts/diagnose.mjs` exits 0 and prints every section.

**Note:** `DailyCounter` has **no `updatedAt` column** — a query assuming one fails with `42703`. Use `key`/`count` only.

### Task 0.2: Confirm the existing digest is actually sending

**Objective:** Keep the current email design exactly as it is. The only question is whether mail is going out.

**Confirmed with William:** alerts go to the salesperson who owns the request, batched into one email. **Do not redesign this.**

**Steps:**
1. Query `Match` for rows with `emailedAt` set, grouped by week. If the most recent is old or absent, mail has silently stopped.
2. `curl "https://matchandrequestapp2.vercel.app/api/digest?dry=1"` with the cron header — confirms recipients and content with no send.
3. Check the Resend dashboard for the last successful send, plus bounces and spam complaints. A delivery failure is invisible from inside the app.
4. Confirm the Vercel cron for `/api/digest` is actually firing — a cron that silently stopped looks identical to "no matches this week".
5. Only if all of the above is inconclusive, send one real digest to William's address.

**Note, do not act on without asking:** `vercel.json` schedules `/api/digest` at `15 14 * * 3,6` — **Wednesday and Saturday**, not weekly. Report it; changing it alters when real staff are contacted.

**Do not send to real salespeople during diagnostics.**

### Task 0.3: Fix how the AI budget fails, before arguing about its number

**Objective:** Answer "do I need the AI budget?" with evidence rather than opinion.

**Short answer: yes, keep a cap — but the current one is broken in how it *fails*, not in that it exists.**

What it genuinely protects against: a retry loop, a webhook storm, or a bug fanning out thousands of Anthropic calls overnight. Anthropic has no spend ceiling of its own here. That is a real risk worth a circuit breaker.

What is actually wrong with it today:
1. **It fails silently.** The request flips to `matchState: "error"` and nobody is told. The store finds out when a customer asks why they never heard back.
2. **Nothing retries.** When the budget resets at midnight, the killed request stays dead forever. Request `cmun7047l0000xe0jgavtgfkm` has been in that state since it tripped.
3. **500 is a guess.** Nobody measured what a normal day costs, so the number protects against nothing in particular.

**Therefore do these in order — the number comes last:**

**Step 1 — measure.** Add per-request call accounting (log calls consumed per `runMatchesForRequest`). Run for one normal week including a Tuesday drop. Produce: calls per request (median/p95), calls per drop day, calls per ordinary day.

**Step 2 — fail loudly.** When the cap trips, email William (not the salesperson — it's an operations problem, not a sales one) and surface a banner in the admin app. A silent circuit breaker is indistinguishable from a broken app.

**Step 3 — retry automatically.** The existing `reapStalledMatches` already re-runs stalled matches; extend the same idea to budget-killed ones once the counter resets. A request should never need a human to notice it died.

**Step 4 — then set the cap** at roughly 3× measured p95 daily usage. High enough never to hit in normal trade, low enough to stop a runaway loop.

**Files:** `app/lib/aiBudget.server.js`, `app/lib/matchRunner.server.js`, `.env` (`ANTHROPIC_DAILY_CALL_LIMIT`)

**Interim:** raise the cap now so matching isn't paused while steps 1–3 are built. This is a spend decision — William sets the number.

### Task 0.4: Fix the enewton spelling gap (cause confirmed)

**Objective:** Make brands that are *written* one way and *said* another resolve correctly.

**Confirmed by William:** the brand is **written `enewton`** but **pronounced "e newton"**. Staff type it the way they say it. Nothing in the 927-term vocabulary bridges that, so the request embeds as the unrelated words "e" and "newton" and retrieval finds nothing. Matching was never broken — it answered a question nobody meant to ask.

**Steps:**
1. Add to `app/lib/jewelryTerms.js`, in the §3 brands block:
   ```js
   { from: /\be[\s-]?newton\b/gi, to: "enewton", scope: "request" },
   ```
   - **`scope: "request"` is mandatory.** Listings already spell it `enewton`; rewriting product text is the exact class of bug that corrupted 95% of the catalog in the SaaS build.
   - Order it **before** any bare `\be\b` handling so the two-word form wins.
2. Add tests in `app/lib/jewelryTerms.test.js`:
   - `"silver e newton"` → contains `enewton`
   - `"E Newton bracelet"` → contains `enewton`
   - `"enewton"` → unchanged (no double-rewrite)
   - product scope: `"enewton classic bracelet"` → **unchanged**
3. Re-run matching for request `cmw6odyd30003yf0jf79j4845` and confirm enewton pieces return.

**Still verify the catalog independently.** Only **2** products in `ProductEmbedding` mention "newton", and **zero** combine newton + silver. If the store carries more enewton than that, there is also a coverage gap and the spelling fix alone will not produce matches. Compare Shopify's real enewton count against the database before declaring this done.

**Generalise it.** enewton will not be the only brand with this problem. While here, audit other written-vs-spoken brand forms the store carries and add them in the same block with the same scope rule.

### Task 0.5: Find every request that should have matched but didn't

**Objective:** "silver e newton" may not be the only one.

**Steps:**
1. List active requests with zero matches and `matchState: "ok"`.
2. For each, run retrieval **only** (embedding similarity, no AI reasoning — cheap, no budget spend) and record the top-5 candidates.
3. Where retrieval surfaces plausible products but the request has no matches, the AI pass rejected them → a reasoning/gating problem.
4. Where retrieval surfaces nothing, it's a catalog or vocabulary problem.

This split matters: the two causes have completely different fixes, and conflating them wastes effort.

**Also:** re-run the budget-killed request `cmun7047l0000xe0jgavtgfkm`.

### Task 0.6: Confirm catalog coverage

**Objective:** Make sure the embedded catalog reflects the real store.

Compare Shopify's active product count against `ProductEmbedding` (currently **5,379**). Any gap means products are invisible to matching. `scripts/backfill-embeddings.mjs` already handles this correctly — it fetches tags from Shopify and skips unchanged hashes.

**Note:** this also covers the re-embed owed from the vocabulary backport (~1,833 products whose normalized text changed).

---

## Phase 1 — Non-item requests (the actual budget leak)

### Task 1.0: What the live data shows

Pulled from all 55 live requests, read-only. These are not vague item requests — they are **not item requests at all**, and every one of them went through full AI matching:

| Request text (truncated) | Matches generated |
|---|---|
| "Wanting to get information on the personalized back chain with the let…" | **113** |
| "2 engagement rings with bands soddered." | **55** |
| "Something special with a nice Ruby in Estate" | 22 |
| "Yurman or Lagos pieces." | 16 |
| "Hi, are you hiring? I have over 20 years of experience…" | 0 (archived) |
| "Instead of sending a generic message, I reviewed your site in detail…" | 0 (archived, cold outreach) |
| "I need to have my fiance's engagement ring resized as it is a little l…" | 0 |
| "Do you buy strands of pearls & black onyx with gold beads?" | 1 |
| "I would be interested in what is the lowest price you would accept on…" | 0 |
| "Custom enagement ring design for purchased center stone…" | 0 |

A **question about personalisation produced 113 matches** and a **soldering job produced 55**. That is hundreds of Anthropic calls spent on things the store cannot match inventory against — a plausible direct cause of the 511/500 budget breach.

Also found: **"TIFFANY SEAGULL BROOCH" submitted twice on 2026-11-07** — duplicate submissions are a separate, smaller leak.

### Task 1.1: Classify intent before matching

**Objective:** Only item requests reach the matcher.

Categories observed in live data:

| Category | Example | What should happen |
|---|---|---|
| `item` | "14k white gold sapphire studs" | Match as today |
| `service` | resize, solder, repair, custom design | Route to staff; never match |
| `buying` | "Do you buy pearls?" | Route to staff; goods flow toward the store |
| `question` | "info on personalized back chain" | Route to staff; never match |
| `price` | "lowest price you would accept" | Route to staff |
| `spam` | hiring enquiries, cold sales outreach | Archive, never notify |

**Approach:** mirror the SaaS build's `leadQuality.js` pattern — deterministic rules first, since these are highly patterned ("do you buy", "resize", "are you hiring", "repair"), with AI only for genuine ambiguity. Classifying with a cheap call to avoid an expensive one is fine; classifying with no call at all is better.

**Where it goes:** the same intake seam as the lead-quality gate — `app/lib/customerRequestIntake.server.js`, immediately before `runMatchesForRequest`. Storefront submissions first; staff-entered requests can follow once the rules are proven.

**Schema:** `requestKind String @default("item")` plus `kindReason String?`. Additive, applied via `scripts/apply-sql.mjs`.

**Critical:** a misclassified real request is far worse than a junk one that slips through. Fail toward `item` when uncertain, and make the classification visible and overridable by staff — one tap to say "this *is* an item request", which re-runs matching.

### Task 1.2: Non-item requests never reach a salesperson

**Confirmed with William:** these must **not** be assigned to anyone. They land on the admin page only.

**Two implementation consequences, both load-bearing:**

**1. Classify BEFORE assignment, not after.** `app/lib/customerRequestIntake.server.js:102` calls `pickNextSalesperson(shop)` before the request is created. That call **advances the round-robin**. If a cold-outreach email or a hiring enquiry consumes a rotation slot, a real salesperson silently loses their turn on a real lead. Classification must therefore run **before** line 102, and non-item requests must skip `pickNextSalesperson` entirely.

This is a business-fairness bug, not just a tidiness one, and it is happening today — the two archived spam requests each burned a rotation slot.

**2. The schema forces an assignment.** Both fields are non-null:
```prisma
salespersonName  String
salespersonEmail String
```
So "no salesperson" needs a decision:
- **(a) Make them nullable.** Cleanest semantically, but every read site must handle null — admin list, detail, POS, digest, rotation. Higher blast radius.
- **(b) Sentinel value**, e.g. `salespersonName: "—"`, `salespersonEmail: ""`. Additive and low-risk, but every consumer must be checked for "would this still email/alert someone?"

**Recommend (a), nullable**, with an explicit audit of every read site. A sentinel that looks like an address is exactly the kind of thing that later sends an email to `""`.

**Must also verify:** non-item requests generate no alert, no digest line, and no POS row that implies someone owes a callback. The digest selects by `salespersonEmail`; a null or empty value must be excluded, not treated as a group.

### Task 1.3: Where non-item requests go

A dedicated filter on the **admin requests page** (see Task 1.4) — not a separate route, not POS. Staff in the office triage them; the shop floor never sees them.

Each row shows the customer's contact details, what they wrote, and the detected category, so the response is a phone call or an email, not a product search.

**Open question for William:** should services and buying enquiries be *rejected* at the storefront form ("for repairs, please call us"), or accepted and routed? Accepting keeps the lead and the contact details; rejecting avoids the noise. Accepting is probably right — "do you buy pearls?" is a genuine business opportunity, just not a matching one.

### Task 1.4: Admin page filters

**Confirmed with William:** the admin requests page needs real filters, with non-item requests as one of them.

Proposed set, each driven by data that already exists or is added above:

| Filter | Rule | Why it earns a slot |
|---|---|---|
| **All** | no filter | default |
| **Non-item** | `requestKind != "item"` | William's ask — services, questions, buying, spam |
| **From website** | `source = "customer"` | came from a shopper, not the counter |
| **Needs a call** | `source = "customer"` AND `calledAt IS NULL` | the only genuinely time-sensitive queue |
| **No matches yet** | `matchCount = 0` AND `matchState = "ok"` | still watching — or quietly broken |
| **Problems** | `matchState = "error"` | currently invisible; one request has sat in error since the budget trip |

**Design constraints:**
- Counts on every chip (`Non-item (9)`), so staff see volume without clicking.
- Hide a chip entirely when its count is zero — an always-empty filter is noise.
- Filter client-side from the already-loaded list, as the wishlist filter in the SaaS build does (`8049ff3`). The list is ~55 rows; a round trip per chip is not worth it.
- The empty state must name the active filter — "No non-item requests" rather than "No requests", which reads as data loss.

**Deliberately not filters:** by salesperson (the rotation already handles ownership) and by date (the 3-month retention rule in Phase 2 covers it). Add them only if staff actually ask.

**Files:** `app/routes/app._index.jsx`

---

## Phase 2 — History retention (3 months)

### Task 2.1: Age out old requests

**Objective:** Stop history growing without bound.

**Confirmed with William:** requests should drop out of history after **3 months**.

**Decisions to settle first — these change the implementation materially:**
1. **Delete, or hide?** Deleting loses the record permanently. Hiding (a `hiddenFromHistoryAt` flag, or filtering on `createdAt`) keeps it recoverable. Strongly prefer hiding — jewelry leads can revive a year later, and "nobody will ever want this" has been wrong before.
2. **Three months from *created*, or from *last activity*?** A request from January still receiving matches in April is live, not stale. Last activity is the safer rule.
3. **Does it apply to fulfilled requests?** Those are sales records. Worth keeping longer or indefinitely.
4. **Does it apply to active ones?** An open "Rolex Submariner" watch request older than 3 months is still a real customer want. Ageing out *active* requests risks discarding live demand.

**Recommended default:** hide `archived` and `fulfilled` requests from the default history view after 3 months of inactivity, keep the rows, and add a "show older" toggle. Leave `active` requests alone regardless of age.

**Implementation:** filter in the `app.history.jsx` loader, not a destructive cron. Reversible, no data loss, no scheduled job to go wrong.

**Also worth doing here:** `ProductEmbedding` rows for deleted products, and `MatchEval` rows, both grow without bound and are genuinely safe to prune.

---

## Phase 3 — POS: mark website requests, and mark them called

### Task 3.1: Verify what POS already does

**Do this before writing code.** `extensions/requests-pos/src/Modal.jsx` already contains source badging:
- line ~499 (detail): `<s-badge tone="warning">Submitted online — call the customer</s-badge>` plus phone/email
- line ~907 (list): `<s-badge tone="warning">Call customer</s-badge>`

So the feature may already exist and simply not be prominent or not deployed. **Ask William what he sees on the iPad before changing anything.** There is a real possibility the answer is "it's there but too subtle", which is a different fix than "it's missing".

### Task 3.2: Add "Mark as called" — the real gap

**Objective:** Let a salesperson clear the callback flag once they've actually phoned the customer.

**Why this is the priority, not the badge.** William confirmed POS already says "call them". The problem is it says so **forever**. Nothing distinguishes *needs calling* from *already called*, so:
- a customer can be phoned three times by three people
- or nobody calls, because everyone assumes someone did
- the badge becomes wallpaper and stops being read at all

This is the same failure as the earlier POS bug, where a correction was saved but still looked unsaved: **the screen not reflecting work the salesperson already did.**

**Schema:** the SaaS fork already added exactly the right column in commit `0148207`:
```prisma
calledAt         DateTime?
```
Backport that single column — not the rest of the needs-call work.

Migration via `scripts/apply-sql.mjs` (never `prisma migrate dev`):
```sql
ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "calledAt" TIMESTAMP(3);
```

**Design decisions to settle before building:**
1. **Keep both facts.** `source: "customer"` must not be overwritten — "came from the website" is permanent history; "has been called" is current state. Two fields, not one.
2. **Record who called**, not just when. With several salespeople sharing POS, "called at 2:14pm" without a name invites the same duplicate call. Suggest `calledBy` alongside `calledAt`.
3. **Make it reversible.** A tap meant for the row below shouldn't be permanent. Allow un-marking.
4. **Badge states:** `Call customer` (warning) → `Called ✓ Sam, 2:14pm` (neutral/success).

**Files:**
- `prisma/schema.prisma` — add `calledAt`, `calledBy`
- `app/routes/api.pos.requests.$id.jsx` — a `mark-called` action, **shop-scoped** (`updateMany` with `scopedWhere`, never `update`)
- `extensions/requests-pos/src/Modal.jsx` — button on detail, state on the list row
- `app/routes/app.requests.$id.jsx` + `app/routes/app._index.jsx` — mirror it in admin so office and floor agree

**Tests:** action sets both fields; un-marking clears them; `source` survives both; a request belonging to another shop cannot be marked.

**Verification is manual on the iPad.** POS extensions render only inside the POS iOS app — they cannot be screenshotted or unit-tested from here. This is precisely how the `navigation.navigate` bug shipped: ESLint raised a false positive, the "fix" was wrong, and nothing caught it until a real tap.

### Task 3.3: Strengthen the marking itself

Once 1.2 exists, revisit prominence:
- sort uncalled website requests to the top — they are the only time-sensitive queue
- show the phone number on the list row, not only on detail, so calling is one tap
- once called, let them fall back into normal order

**Constraint:** POS renders only Shopify's `s-*` components. No custom CSS, fonts, or layout. If something cannot be expressed, say so rather than approximating it.

**Deploy:** `npx shopify app deploy` from the **live repo only**.

---

## Phase 4 — Working across the two codebases

### Task 4.1: Write the rule down

**Files:** Create `WORKFLOW.md` in both repos.

| | Live store | SaaS build |
|---|---|---|
| Path | `C:\Users\wbaum\matchandrequestapp` | `...\OneDrive\Bauman Apps LLC\matchandrequestapp` |
| Branch | `main` | `saas` |
| Git remote | `origin` → GitHub | **none, deliberately** |
| Database | Neon `main` (real customers) | Neon `saas-dev` branch |
| Deploys | `git push` → Vercel; `shopify app deploy` → POS | **never** |
| Shopify config | `shopify.app.toml` (live client_id) | `.bak` + `TEMPLATE` only |

**Trigger phrases to agree on:**
- "in store" / "my store" / "live" → live repo
- "the app we're selling" / "SaaS" → fork
- When ambiguous → **ask**, never infer. A wrong guess here either ships half-built SaaS code to a working store or wastes work in the wrong place.

**Standing rules:**
1. Never run `prisma migrate` without printing the target host first. `scripts/verify-dev-db.mjs` exists in the fork for this and should be copied to the live repo.
2. Backport live→fork freely; fork→live only deliberately, and only features that help a single store. Roughly half the SaaS work (tenant scoping, per-shop budgets, billing) buys the live store nothing.
3. Schema changes go through `scripts/apply-sql.mjs`, never `prisma migrate dev` — migrations are drifted and Prisma will demand a destructive reset.
4. After every `prisma generate`, run `node scripts/patch-prisma.cjs` (Windows ARM64).

### Task 4.2: Back up the SaaS fork

14 commits exist in exactly one folder on one machine, with no remote. A private GitHub repo gives a backup with no path to the live store, since deployment runs through Shopify CLI and Vercel rather than git remotes.

---

## Files likely to change

- Create: `scripts/diagnose.mjs`, `WORKFLOW.md` (both repos)
- Modify: `app/lib/jewelryTerms.js` + test — enewton brand rule (confirmed)
- Modify: `prisma/schema.prisma` — `calledAt`, `calledBy`
- Create: migration SQL for the above, applied via `scripts/apply-sql.mjs`
- Modify: `app/routes/api.pos.requests.$id.jsx` — `mark-called` action
- Modify: `extensions/requests-pos/src/Modal.jsx` — called state + button
- Modify: `app/routes/app.requests.$id.jsx`, `app/routes/app._index.jsx` — mirror in admin
- Modify: `app/lib/aiBudget.server.js`, `app/lib/matchRunner.server.js` — loud failure + retry
- Possibly: `vercel.json` — digest schedule is currently Wed+Sat, not weekly
- Copy: `scripts/verify-dev-db.mjs` fork → live

## Validation

- `npm run test` in the live repo (currently 83/83)
- `npm run build`, `npm run lint`
- `node scripts/diagnose.mjs` clean
- `"silver e newton"` normalizes to contain `enewton`; product text unchanged
- Request `cmw6odyd30003yf0jf79j4845` returns enewton matches
- Request `cmun7047l0000xe0jgavtgfkm` leaves the error state
- Digest dry-run: each salesperson appears once, with only their own requests
- Mark-as-called survives a round trip and cannot be set cross-shop
- POS verified by William on the iPad

## Risks

- **Diagnostics that mutate.** Re-running matching costs real Anthropic spend and can re-trip the cap. Retrieval-only checks are free; use those first.
- **Emailing real salespeople during testing.** Always `?dry=1` first; real send goes to William only.
- **The enewton catalog question is still open.** The spelling fix is confirmed necessary but may not be sufficient if the products were never embedded.
- **POS cannot be verified from here.** Every POS change depends on William looking at the iPad.
- **`calledBy` needs a trustworthy identity.** POS has no login; the staff id is self-reported. Fine for an audit trail, not for a permission gate.
- **Prisma errors are unreadable on this machine.** The Windows ARM64 wasm engine dumps the whole minified bundle before the real message. `scripts/diagnose.mjs` must catch and print only the useful part, or it will be unusable exactly when it matters.

## Decisions (settled with William)

1. **AI cap — interim 1500/day.** Rationale: the breach was 511 against a 500 cap on a day when two non-item requests alone generated 113 and 55 matches. 1500 is ~3× the current ceiling — enough headroom that a heavy Tuesday drop plus some junk cannot pause real matching, while still being a genuine circuit breaker against a runaway loop. **Re-measure after Phase 1 lands and lower it**, because classification should cut usage substantially. Set `ANTHROPIC_DAILY_CALL_LIMIT=1500`.
2. **Non-item requests are accepted, not rejected** at the storefront form, and routed into the same "needs a call" area. The lead and contact details are kept — "do you buy pearls?" is real business, just not a matching job.
3. **History: hide, not delete.** Applies to `archived` and `fulfilled` only, measured from **last activity**, not creation. **`active` requests are exempt regardless of age** — an open want is still an open want.
4. **Salesperson fields become nullable.** A sentinel like `""` still looks like an address to the digest's `salespersonEmail` selection; nullable is honest and the read-site audit is worth doing once.
5. **"Mark as called" ships in BOTH admin and POS.** Office and floor must agree on who has been contacted.
6. **Push and deploy the jewelry vocabulary now**, ahead of the rest of diagnostics.

**Also settled:** email system stays exactly as-is (Wed + Sat); the task is to verify sending, not change it. Non-item requests are never assigned to a salesperson and appear only in admin, behind their own filter.

## Open questions

None blocking. Re-confirm the AI cap after Phase 1 measurement.
