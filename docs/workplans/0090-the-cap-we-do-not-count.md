# Workplan 0090 — the cap we do not count

## Status — 2026-08-26 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Verify the limit before building against it | ✅ **Done 2026-08-26** (one residue open: what the client observes at the limit) | The owner read Google's *Gmail bandwidth limits* page in the Workspace Admin Help (Dutch UI, screenshot, 2026-08-26): **IMAP download 2 500 MB/day, POP download 1 250 MB/day, IMAP upload 500 MB/day**; webclient separately 750 MB/hour / 1 250 MB/day down, 300 MB/hour / 1 500 MB/day up (incl. Gmail SMTP). The page: limits *"gelden voor alle edities van Google Workspace en kunnen zonder voorafgaande kennisgeving worden gewijzigd"*. Per the owner's search summary (secondary — not on the page itself): the limits apply **equally to app passwords and XOAUTH2**, and the penalty is a **24-hour temporary lockout of IMAP/POP access, with the Gmail web interface staying reachable**. Full record in T1 below. |
| T2 A byte-aware budget beside the request-aware one | ✅ **Done 2026-08-26** | `ByteBudget` beside `RateBudget` — a METER, not a bucket: `spend` records what was fetched and never refuses or waits (the bytes already crossed the wire; hiding them is masking), `state` is the pre-fetch gate T4 will read, `remainingBytes` floors at zero while `spentBytes` keeps the truth. Fixed 24-hour window anchored at the first byte (the IMAP table is per-day only; Google's reset rule is the T1 residue, so the ceiling stays configurable with headroom). `InProcessByteBudget` (appliance) + `PgByteBudget` (managed — migration 0030 `byte_budget`, no RLS for `rate_budget`'s three reasons, one-statement accumulate-or-reset so concurrent runners serialise on the row). Counted on fetch, never joined with billing (ADR-0014's first-copy meter stays its own). 20 unit tests; three proofs by breaking (never-resetting window, clamped truth, tenant-blind key — each turned exactly its pinning test red). `byte_budget` joined the offboarding purge list. |
| T3 Wire the IMAP sources to it | ✅ **Done 2026-08-26** | `ImapFlowSource.fetch` spends an optional `ImapByteMeter` with each fetched body's actual length — counted on fetch, bodies only (listings are small against a body; the ceiling carries headroom rather than pretending exact), nothing spent on a failed fetch, awaited so a meter that cannot record is never sailed past. Which endpoints get one is `imapDownloadPlan` — ONE decision for both editions (rule 5), keyed by HOST never by kind: `imap.gmail.com` gets the verified 2 500 MB/day whichever kind pointed at it, any other server gets NO invented cap, and `throttleConfig.downloadBytesPerDay` (migration 0017's surface, parsed by the shared parser) overrides for any host — headroom under Gmail included, and 0/NaN reads as no meter, never as a zero ceiling. Managed wires `PgByteBudget`; the appliance wires `InProcessByteBudget` (one residue, recorded in the code too: an appliance restart forgets the day's count — headroom is the mitigation until it moves to the durable store). Graph mail deliberately gets none. Note: the plan named `imap-source.ts` as a second wiring site, but 0032 T3b had already deleted it — `ImapFlowSource` is the only IMAP read path. 8 new unit tests; proofs by breaking (spend dropped, universal invented cap — each turned exactly its pinning test red). |
| T4 Refuse before the lockout, not after | ✅ **Done 2026-08-26** | `runDomainSync` takes an optional `downloadMeter` (the SAME instance the connector spends, so the state the gate reads is the state the fetches moved) and reads it at pass start and before every fetch — deliberately after the ledger fast-path, since a skip downloads nothing. At zero remaining the pass STOPS AND SAYS SO: the T4 sentence in the log (the limit, today's usage, when it resets, continues by itself; named from OUR meter, never from an unobserved Google response) and a `budgetPause` record on the result carried through `ReconcileResult`. Everything about HOW it stops is pinned by tests: a pause is NOT a failure (no ledger row, no retry counter, no failure-queue entry — the items were never looked at), the paused folder KEEPS its cursor (the 0015 lesson: a ceiling nobody named looks exactly like a bug; and an advanced cursor would retire tomorrow's items), later folders are never listed (never retry into a quota that counts down to a window — the JMAP lesson), and a pass that begins spent lists nothing at all. Overshoot bounded by `concurrency` in-flight bodies, documented at the gate. 7 unit tests; proofs by breaking (pause-as-failure → 2 red, cursor-advance-on-pause → 1 red). Still open, deliberately: carrying the sentence into the summary mail rides with the digest (0104 T3's surface), not this loop. |
| T5 Say it in the price | 📋 Planned — **really blocked on [0088](./0088-a-price-you-can-see-before-you-connect.md) T2+T3** (noted 2026-08-26) | A 2.5 GB/day ceiling and ADR-0014's 750 GB Small band describe very different calendars. The pre-preflight should say so — but the calculator this row edits does not exist yet: 0088's T2 (the versioned assumptions) and T3 (the static page) are still unbuilt, so the ceiling-honest duration lands there when they do, with the verified number (T1) ready for it. |

## Why this exists

The owner, while checking whether an app password could carry a personal Gmail migration
([ADR-0041](../adr/0041-who-owns-the-oauth-client.md), [workplan
0089](./0089-a-consent-you-can-click.md) T7), read that Gmail IMAP downloads are capped around
**2,500 MB per day**, and that exceeding it can throttle or **temporarily lock the account**.

Checking that against this repository found something worse than a caveat on a proposed feature.

**1. The rate budget counts requests, not bytes.** `packages/shared/src/rate-budget.ts:39`
defines the entire configuration surface as `readonly requestsPerSecond: number`, and the token
bucket at `:78` refills in whole request-tokens. A limit expressed in bytes per day is not
merely unenforced — it is **inexpressible** in the current interface.

**2. No IMAP source consumes a budget at all.** Every consumer of `RateBudget` /
`ThrottleLimiter` is a Graph or DAV source: `graph-mail-source.ts`, `graph-calendar-source.ts`,
`graph-drive-source.ts`, `graph-contacts-source.ts`, `caldav-source.types.ts`,
`carddav-source.types.ts`, `webdav-source.types.ts`. Neither `imapflow-source.ts` nor
`imap-source.ts` nor `gmail-source-factory.ts` references one, and a search for any local pacing
— concurrency limit, batch size, inter-fetch delay — finds none either.

**So the Gmail path pulls as fast as the connection allows, with nothing counting and nothing
slowing it down.**

**3. And this is not about app passwords.** The cap belongs to Gmail's IMAP endpoint, so on the
face of it it governs **the OAuth path that ships today** exactly as much as the app-password
path 0089 T7 proposes. That is what turns this from a caveat on an unbuilt feature into a
defect in a shipped one. Whether Google in fact applies a *different* ceiling by credential type
is T1's job to establish, and it matters in both directions: if the cap is credential-specific,
T7's value changes; if it is not, every Gmail migration already runs at this risk.

**Why the penalty is the part that matters.** Most rate limits answer with a 429 and cost time.
This one is reported to lock the account. For a migration tool that is close to the worst
available failure: **the customer loses access to their own live mail, during their migration,
because of us** — while the product's whole claim is that nothing breaks until they say so. A
migration that finishes slowly is working as designed (ADR-0014 sells a period, at your own
pace). A migration that locks a mailbox is not a slow success; it is an outage we caused.

## T1 — verify the limit before building against it ✅ 2026-08-26

Four things were asked; here is what came back, each with its source. The primary source is
Google's **Gmail bandwidth limits** page in the Workspace Admin Help, read by the owner in a
browser on **2026-08-26** (Dutch UI; screenshot provided — this sandbox's egress proxy still
blocks `support.google.com`, so the page itself was not read here). Claims from the owner's
accompanying search summary are marked **(secondary)** — consistent with the page but not on it.

1. **The download ceiling: 2 500 MB/day via IMAP.** The page's POP/IMAP table:
   *Downloaden via IMAP* **2500 MB** per day, *Downloaden met POP* **1250 MB** per day. The
   webclient has its own separate table (750 MB/hour, 1 250 MB/day down) which does not govern
   this product. **The IMAP table is per-day only — no hourly ceiling** — so T2's daily window
   is the right shape.
2. **The upload ceiling: 500 MB/day via IMAP** (*Uploaden via IMAP* 500 MB). Gmail is never a
   target here, so this governs only flag writes on a source pass — metadata, nowhere near
   500 MB/day. Confirmed irrelevant, as hoped.
3. **Credential type: the limits apply equally to app passwords and XOAUTH2** (secondary). So
   the cap belongs to the endpoint, exactly as this plan assumed — 0089 T7's app-password path
   adds no new exposure, and every Gmail-over-OAuth migration shipping today already runs
   against it. **Account type:** the page says the limits hold for *all editions of Google
   Workspace* and may change without notice; personal (consumer) Gmail is not named on it, and
   the same 2 500 MB figure is the one commonly reported there (secondary). Build to
   2 500 MB/day for both; a personal-specific difference, if one ever surfaces, only moves the
   configured number.
4. **The penalty: a temporary lockout of IMAP/POP access for ~24 hours, with the Gmail web
   interface staying reachable** (secondary). This confirms the plan's premise — the failure
   mode is the customer losing IMAP access to their own live mail, not a polite 429. **Still
   open, deliberately:** what the *client* actually observes at the limit (which IMAP response,
   at which command — commonly reported as an alert naming exceeded bandwidth, unverified).
   T4's refusal must not invent words for a response nobody here has seen; it names the cause
   from our own byte counter, which is knowledge we hold either way, and the first observed
   lockout response gets recorded here when reality provides one.

## T2 — a byte-aware budget beside the request-aware one

`RateBudgetConfig` gains a byte dimension; `InProcessRateBudget` and `pg-rate-budget.ts` gain
the matching accounting. Three properties, all load-bearing:

- **The window is a day, not a second.** Every existing budget is a per-second token bucket. A
  daily ceiling has to survive process restarts and be shared across runners, which is exactly
  what the `(tenant, provider)` row in migration 0024 already exists to do — *"the resource
  being protected is shared and singular"* applies here word for word.
- **Bytes are counted where they are already known.** `domain-sync.ts:956` destructures
  `{ raw, sizeBytes }` from `fetchRaw`, and `item.size_bytes` is written from it. The number is
  already flowing; nothing new has to be measured.
- **Counted on fetch, not on write.** The cap is on what Google sends. A retry that re-fetches
  spends the budget again even though the ledger records the item once — which is the opposite
  of ADR-0014's *first-copy-only* billing rule, and the two must not be confused or share a
  query.

## T3 — wire the IMAP sources to it

`imapflow-source.ts` and `imap-source.ts` take a budget the way the Graph sources do. Gmail gets
the Google-specific ceiling; a self-hosted Stalwart or Dovecot gets whatever its operator
configures, defaulting to unlimited — **a cap invented for a server that has none would be this
plan's own way of making migrations mysteriously slow.**

`mapping_throttle_config` (migration 0017) already exists as the per-mapping override surface.

## T4 — refuse before the lockout, not after

At the ceiling the pass **stops and says so**, in the vocabulary the product already uses for a
limit it can see coming: what the limit is, how much of it today's pass used, when it resets,
and that the migration continues by itself tomorrow. Not an error — a scheduled pause, and one
the summary mail can carry.

There is a direct precedent worth copying rather than reinventing. Workplan 0015 recorded
Stalwart's 1000-file blob window: *"`itemsSynced` parking on exactly 1000 with items in
`itemsRetrying` is the target's ceiling, not a stall."* The lesson from that night was that a
ceiling nobody named looks exactly like a bug. Same shape here, with a worse penalty.

**And never retry into it.** The same session taught this too, on JMAP: obeying `Retry-After`
literally versus probing early is a judgement about *magnitude*, and a quota that counts down
accurately to a window rollover must be waited out rather than probed. A byte ceiling whose
penalty is a lockout is the clearest case of that kind there is.

## T5 — say it in the price

ADR-0014 sells Small at 750 GB of cumulative data and Tiny at 250 GB. At 2.5 GB/day, **mail
alone** would take 100 days to reach Tiny's ceiling and 300 to reach Small's. Most personal
mailboxes are nowhere near that — a 15 GB mailbox is about six days — but the pre-preflight
(workplan 0088) quotes a duration, and a quote that ignores the source's own ceiling is the kind
of number that gets screenshotted and then disbelieved.

So the calculator should derive mail duration from the ceiling rather than from bandwidth, and
say which it did. This is the same honesty rule 0088 already applies to everything else: *each
rung replaces a guess with a measurement, and says which it is.*

It also cuts the other way, in the product's favour: **a cap that forces a migration to take
weeks is an argument for a tool that syncs continuously and cuts over when you are ready**, and
against one that sells a single copy pass. Worth saying on the public page, once T1 has a number
worth saying it with.

## Not in this plan

- Any change to how bytes are billed. ADR-0014 counts each item's **first** copy; this counts
  what Google **sends**, including re-fetches. Two meters, deliberately, and they must never
  share a query.
- Microsoft, Dropbox and Box ceilings. The same question exists for each and none is answered
  here.
- Making Gmail faster. This plan is about not being locked out; throughput is a separate
  argument with a separate ceiling.
