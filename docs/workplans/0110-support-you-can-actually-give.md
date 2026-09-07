# Workplan 0110 — support you can actually give

## Status — 2026-09-05 (update this block at the end of every session)

**2026-08-30: T6 finished — the disclosure joined the v1.1 lawyer drafts.** Privacy §4.5
(EN+NL) now discloses standing operator access in the build's own terms — metadata-only,
content structurally out of reach, every view append-only logged — and §5's table carries
the read-log row (Art. 6(1)(f)). Timed on purpose: the drafts go to the lawyer once, and
the sentence a customer is owed under ask 1 = b belongs in that pass, not after it. What
remained in this plan was T5's platform-wide status, which this surface had no source for
until 2026-09-05 — see *T5's last half* below.

**The owner answered the three review asks on 2026-08-27, and one answer REVERSED an earlier
one.** Support access is now **on by default and disclosed** (ask 1 = b), not off until the
customer enables it. His reason, verbatim: *"i want to be able to offer support, also when
someone doesn't know how it all works. people expect me to be able to see what they see in case
I'm contacted."* The plan below is rewritten to match; §4 changed the most, because removing
consent removes the thing that was carrying the accountability, and something has to take its
place. The two decisions of 2026-08-27 that still stand unchanged are **metadata only** and
**read-only**.

| Task | Status | Evidence |
|---|---|---|
| T1 Standing access, and the log that has to earn it | ✅ **Done 2026-08-27** | `support_read` (managed 0009): one row per view served — who, whose, which screen, when. Append-only by GRANT (no UPDATE, no DELETE), an operator may read only their OWN reads (a log somebody can browse tells them what colleagues are investigating), the screen vocabulary is a CHECK because a fourth screen is a design change, and a read attributed to nobody is REFUSED — the decayed-GUC case, where a row with no subject makes the log look complete while hiding the thing it exists to show. Written through the same handle the view is read with, so a log cannot fail independently of what it logs. |
| T2 The read model: metadata-only views, in the managed chain | ✅ **Done 2026-08-27** | Five views in managed 0009. **The bypass is measured, not assumed:** as `app_user` with no tenant, a DIRECT read of `tenant` returns 0 rows and a read through the view returns them all — a view runs with its OWNER's privileges and the owner is the migrating superuser, so `FORCE ROW LEVEL SECURITY` does not reach through it. That precondition is now a TEST, because on a database where migrations run as a non-superuser owner every operator screen would go quietly empty (fail-closed, but broken). Since there is no second net, the `EXISTS` against `platform_operator` is written out in every view rather than factored into a helper somebody could forget to call — and a catalog test fails on ANY `support_%` view lacking it, so a sixth cannot arrive quietly. Proved by breaking: removing one view's predicate turns 3 tests red. The column list is the boundary — `last_error`, `secret_ref`, `encrypted_credentials` and `config` are unreachable BY ERROR, and there is no view over `item`, `mailbox` or `collection_mapping` at all. |
| T3 A failure has a CATEGORY, not only prose | ✅ **Done 2026-08-27** | Six categories classified at `markFailed`, stored beside the prose in migration 0033, and rendered on the CUSTOMER's own progress strip as a remedy sentence in both languages — the owner's reframing, so the primary reader is the person whose migration stopped. `last_error` still renders verbatim beneath it: precision for whoever needs it, the way out for whoever does not. Ordering is load-bearing and tested — quota beats rate beats auth, because *"wait until tomorrow"*, *"wait a minute"* and *"reconnect"* are different instructions and telling somebody to reconnect a working credential sends them to do damage. `unknown` is a real answer with its own sentence carrying the way OUT of self-service, and NULL (nothing failed) is deliberately distinguishable from `unknown` (failed, unclassified). Proved at three levels and by breaking each: the classifier against real provider messages (20), the STORE against PGlite (4 — dropping the classify call leaves all 20 classifier tests green, which is the whole reason that file exists), and the SCREEN (6 — rendering the label instead of the sentence turns 3 red). **2026-09-05:** the side joined the category on the operator's level-3 view (managed 0022, `failed_side` — two words, metadata like the category; 0094 T5's second slice records it). |
| T4 The operator's screens: tenants, one tenant, one migration | ✅ **Done 2026-08-27** | Three routes under `/api/support` and three screens under `/support`, both halves proved by breaking them. **Nothing in either half authorises anybody**: the routes use `authenticateSubject` (an operator has no tenant to resolve), the views decide, and a non-operator gets `200` with an empty list and a `404` for ids that exist — the nav hides the screens from them, which is cosmetic. **Every read is recorded in the same transaction as the read**, so a log cannot fail independently of what it logs; a `404` records nothing, because it is not a read of anybody's data, while an EMPTY LIST still records — an empty list with a log row is an operator on a platform with no customers, without one it is somebody who was never an operator, and that difference is the whole log. Route tests (17) hold fixtures carrying a `secret_ref`, a config host, a `settings` note, an address and `last_error` prose with a folder name in it, and assert none reaches a response body — so a route pointed at the TABLE instead of the view fails rather than passing on a body nobody read. The managed gate now asks `/api/support/tenants` with an ordinary token and pins the answer to ZERO, because the unit test's precondition (the view's owner is the migrating superuser) is a property of the deployment, not a law. Screen tests (11); the six remedy sentences moved to `i18n/failure-key.ts` so the operator and the customer cannot be shown different advice — the owner's *"see what they see"* in one map rather than two. No refetching is armed anywhere: every fetch writes a log row, and the log's value is that a row in it means somebody looked. **Deferred to T5, from §5's own list:** the platform status on level 2, and decision-queue counts on level 3. |
| T5 Invoices and status, for the tenant in front of you | ✅ **invoices and the queue counts done 2026-08-27; the platform-wide status done 2026-09-05** | Invoices ship with T4 — period, status, total and currency on level 2, over `support_tenant_invoices`; and 0109 T0 means "no invoice" is now a real answer, which the screen renders as a sentence rather than an empty table. **The queue counts shipped (managed 0010).** §5 asked each level to say whether anything sits in a decision queue, and without it an operator looking at a healthy-looking migration that has not moved in a week had nothing to say. Two grains, because decisions have two: `decision.mapping_id` is nullable by design (0028 T1 — a newly discovered mailbox belongs to no migration), so the tenant count includes the placeless ones and the migration count does not. **They are not meant to add up**, and a test asserts the disagreement. A COUNT and nothing else: `summary` is prose a detector wrote about one mailbox and `detail` is a jsonb bag that has carried addresses since 0028 T1 — the view selects neither, proved by breaking (adding `summary` to the view turns a test red). Only `pending`: an operator counting resolved decisions would be reading how many judgements a customer has made rather than what is outstanding. On screen it is a second COLUMN rather than a bigger "needs attention" number, because failing and waiting are opposite conversations — one is broken, the other is waiting for somebody who probably does not know it. **The platform-wide status shipped 2026-09-05:** `GET /api/support/platform` and a *Platform, as the customer sees it* section first on level 2 — readiness called in-process and the status page's own endpoint list (0094 T1 and T2, the two sources this surface did not have when the row was written), folded to group, name, state and when. The customer's OWN configured checks stay out (ask 3 = a). Proved against a real HTTP status page (`support-platform.unit.test.ts`) and on the screen (`Support.unit.test.tsx`); see *T5's last half* below for the two rules it bends. |
| T6 The words, and the guard | ✅ **Done — guard 2026-08-27, disclosure 2026-08-30** | The leakage guard now names `support_read` and all five views — added BEFORE any of them has a drizzle declaration, so it catches nothing today and everything the moment somebody reaches for `schema-pg.ts`, which is the natural place. A second half reads the SHARED chain's SQL too, because the guard reads TypeScript and a table created by the ledger chain would be invisible to it while every appliance built it on boot. Both proved by breaking. **The disclosure landed 2026-08-30, into the v1.1 lawyer drafts before the lawyer reads them**: privacy §4.5 (EN+NL) now says what a named operator can see (service metadata: workspace status, migration states and failure categories, invoice summaries, queue counts), what they structurally cannot (content, names, credentials, stored error text — "the screens are built without access to them", verifiable in source), and that every view is itself logged append-only; §5's table gains the read-log row under Art. 6(1)(f). The DPA already carried its §5 sentence ("logged and reviewable — so 'we do not look' is checkable rather than asserted"); the policy now points at it. DPA stays EN-only by the drafts' own design. |

## T5's last half — the platform status, from the page that already publishes it

§5 gives level 2 "the platform status the customer sees", and the owner's answer 3 says
what that means: platform-wide, and never the customer's own checks. The row said this
surface had no source. It had two by the time it was read again, both from 0094: `/api/ready`,
and the status page — Gatus inside the stack, whose JSON is what its public page renders.
Reading that JSON is the whole idea: the operator on the phone and the customer on the page
look at the same facts, which is the reason this surface exists.

**Two rules in `support.ts` bend for this route, and the bending is said rather than assumed.**
Every other route there reads a view whose predicate is "you are an operator" and writes a
`support_read` row in the same transaction. This one does neither: what it serves is public
already (`/api/ready` answers unauthenticated and the status page *is* the public page), so a
predicate would guard nothing; and the read log names whose data was looked at, so a row for a
status that is of nobody would dilute the record it exists to be. The route's comment says both,
so nobody later "fixes" the omission.

**What leaves is what the page shows: group, name, up or down, and when.** Gatus's JSON also
carries the probed hostname, every condition's text and the error strings — on this stack,
internal container names. The fold builds a new object from the four fields, so a fifth cannot
slip through by spread, and the test plants all three and asserts their absence.

**The newest result decides, read by timestamp and not by position** — which end of Gatus's
result page is newest is a detail of its paging. An endpoint with no result yet is
`unchecked`, not `down`: a page that has just started is not reporting an outage.

**Absence is two answers.** `STATUS_URL` unset is `off` — the self-host edition has no page
and must not read as a page that is down. Set and not answering within three seconds is
`unreachable`, a distinct state because on a stack that has a page, a page that does not
answer is itself news. Neither carries a reason (0094's own rule); the log has it. The screen
fetches this separately from the tenant's facts, so a slow page cannot hold them.

`STATUS_URL` defaults to the gatus container on the compose network (`managed.yml`,
`managed.env.example`), with no `depends_on` in either direction for the reason gatus already
gives: a thing that will not start until the thing it watches is up cannot report that thing
down.

## Why this exists

There is a managed service with customers coming, and **no way to help one of them.** An
operator today can do exactly two things across tenants — read the access-request queue and
decide it (`platform_operator`, managed migration 0005). Everything else about a customer's
account is invisible: their connections, their migrations, what state those are in, whether a
run failed, whether they have an invoice.

So the current answer to *"my migration is stuck"* is to ask the customer to read their own
screen and describe it. That is not support; it is dictation.

## The decided ground (owner, 2026-08-27)

Three answers, and each one narrows the build in a way worth restating:

- **Metadata only.** Names, states, counts, dates, error *categories*, invoice totals. **Never
  a mailbox address, a folder name, a subject line or an item.** Enough to answer "is it stuck
  and why", without being able to read anybody's mail.
- **On by default, and disclosed** (revised 2026-08-27; the earlier answer was the opposite).
  The owner's reason: *"people expect me to be able to see what they see in case I'm
  contacted."* That is true, and a first support conversation that opens with "please turn this
  on" spends trust at the moment there is least of it. **What this costs is the consent record,
  and something has to replace it** — see §4.
- **Read-only.** View connections, migrations, state, invoices, status. Nothing that changes a
  customer's data or configuration, and no credentials, ever.

## The design

### 1. The structural fact that decides everything: two chains, one database

ADR-0036 split the migrations into two chains — the shared one **every** edition applies, and a
managed-only one for tables an appliance has no use for. They share a database and not a
`schema_migrations` table (`packages/ledger/src/migrate.ts:33-55`).

That matters here more than anywhere it has mattered before, because **the tables an operator
needs to read are split across both chains**:

| What | Table | Chain |
|---|---|---|
| the organisations | `tenant` | ledger — every edition |
| connections, mappings, per-domain state, runs | `connection`, `mailbox_mapping`, `migration_status`, `run` | ledger — every edition |
| who is an operator | `platform_operator` | **managed only** |
| invoices, usage | `invoice`, `usage_metric` | **managed only** |

So the obvious approach — add an `operator_may_read` policy to each ledger table, the way
migration 0005 did for `access_request` — **cannot be done.** A ledger-chain policy referencing
`platform_operator` would fail at migration time on every appliance, because the appliance never
runs the managed chain and has no such table. That is hard rule 5 refusing the shortcut, and it
is the right refusal.

### 2. The read model: managed-chain VIEWS over ledger tables

What works, and what this plan proposes: a small set of **views created by the managed chain**
that read ledger tables. The appliance never runs that chain, so it never gains them — the
edition boundary is kept by the same mechanism that already keeps `invoice` out of an appliance.

Three properties, and the first is the reason to do it this way at all:

**The column list IS the privacy boundary.** A view that does not select `last_error` cannot
return it. "Metadata only" stops being a rule a route has to remember and becomes something the
database enforces — which is the difference between a policy and a promise. A later screen that
wants a folder name has to change a migration to get one, in a diff somebody reviews.

**One predicate carries the whole authorisation**, and it fails closed twice:

```sql
WHERE EXISTS (SELECT 1 FROM public.platform_operator
               WHERE user_id = current_setting('app.current_user', true))
```

Not an operator → zero rows. There is no second case.

**This is the whole authorisation now**, where the first draft had a second `EXISTS` against a
consent table. That is what "on by default" means in SQL, and it is worth seeing plainly rather
than buried: the only thing between an Ownpace login and every customer's migration metadata is
one row in `platform_operator`. Which is why §4 is no longer about a switch.

**Read-only by construction.** `GRANT SELECT` and nothing else. The views are not updatable and
nothing asks them to be.

**The risk this carries, stated plainly.** These views must cross tenant RLS to be useful, which
means they are definer-rights: they bypass the very policies that protect every other read. That
is the "privileged pool" 0093 T6 deliberately avoided, wearing a different hat, and pretending
otherwise would be the kind of thing this repository writes comments to prevent. What makes it
survivable is that it is **narrow** rather than general — named columns, one predicate, no write
grant, no ad-hoc SQL — where a privileged connection would have been a key to everything. The
tests must prove both failure directions on a real database, not merely the success one.

### 3. `last_error` is the useful field and the one that cannot be shown

This is the plan's sharpest finding, and it is why T3 is marked blocking for usefulness rather
than for correctness.

`migration_status` has both halves of the argument already in it:

- **`last_pass_metrics`** carries the comment *"Counts and durations only — never folder names
  or addresses."* (`packages/ledger/src/schema-pg.ts:957`, and again in `packages/shared/src/ports.ts:1981`).
  Somebody already drew this exact line, deliberately, in the schema. It is metadata and it may
  be shown.
- **`last_error`** is free text: whatever the provider said. It routinely contains the mailbox
  address, and it can contain a folder name or a subject line. It is the single most useful
  field for answering "why is this stuck", and under the owner's decision it is the one field
  an operator may not see.

So metadata-only support is only as useful as its **classification of failures**, and no such
classification exists. What is needed is a category — `auth_expired`, `rate_limited`,
`quota_exceeded`, `target_refused`, `network`, `unknown` — derived from the message at the point
the failure is recorded, stored beside the prose rather than instead of it.

**The owner accepted those six on 2026-08-27, and reframed who they are FOR:** *"it's good to
have customers be able to understand what is going on. and, most of it must be self-service.
I'm to be contacted in rare / edge cases."*

That inverts the reader, and it changes the task rather than merely approving it. The category
is **the customer's** first; the operator view is the second reader, not the first. Three things
follow:

- **It ships on the customer's own migration screen**, not only behind the operator's login.
  A category that only staff can see cannot reduce the number of people who need staff.
- **Each category carries a remedy the customer can act on**, not just a label. `auth_expired`
  is useless as a word and useful as *"the connection to Google has expired — reconnect it
  here"*. The label is the index; the sentence is the product.
- **The measure of success is fewer support contacts, not better ones.** Which also means the
  six are worth revisiting against real incidents: a category nobody self-serves from is a
  category that failed, and `unknown` staying large means the classification is not earning its
  place.

This is why T3 is the first task built rather than the third. It is the only one of the six that
helps whether or not an operator ever logs in.

Two things that make this cheaper than it sounds: `google-token-provider.ts`'s `hintFor` already
classifies Google's `invalid_grant` into named causes (0089 T2), and 0090's budget pause already
distinguishes "we stopped on purpose" from "the provider refused". The work is naming the
categories and applying them at one seam, not inventing detection.

And one honest limit worth writing into the plan rather than discovering later: **`unknown` will
be common at first.** For an operator that means going back to asking the customer to read their
screen; for the customer — now the primary reader — it means a screen that explains nothing,
which is worse, because they came to it expecting an answer. So `unknown` must say *"we could
not classify this — here is what we know, and here is how to reach us"*, never a blank and never
a bare label. It is the one category whose text has to carry the way OUT of self-service.

### 4. What replaces consent

There is no `tenant_support_access` table. Access is standing, and the customer is told.

**The consequence, stated rather than glossed: consent was doing work, and dropping it leaves a
hole.** Under the first draft, a customer could point at a row and say when they allowed this.
Under this one they cannot, so the accountability has to come from the other end — not *"did
they allow it"* but ***"what was actually looked at, by whom, when"***. That is a weaker promise
in one way and a stronger one in another: a consent row says an operator MIGHT have looked; a
read log says whether they DID.

So T1 is now: **every operator read is recorded.** One row per view served — operator, tenant,
which of the three screens, when. Not a sample, not the interesting ones. The audit machinery
this needs already exists (`recordAuditEvent`, and the `mapping.status` events landed today are
the same shape), so the cost is the discipline, not the code.

Three things follow, and none is optional under an on-by-default posture:

- **The disclosure has to be true before the first customer**, not written after the first
  incident. §6's sentence goes in the privacy policy and the DPA, in both languages, and it is
  the thing a customer can hold us to.
- **The read log is a customer-facing surface eventually, not only ours.** "Ownpace support
  viewed your migration state on 3 September" is the sentence that makes standing access
  honest rather than merely legal. Not in this plan's first cut — named here so it is a
  decision somebody makes rather than a thing nobody got to.
- **An opt-out stays possible** for a customer who asks. It is a row in the same shape the
  consent table would have had, read as a refusal rather than a permission. Nothing is built
  for it until somebody asks; it is named so the design does not preclude it.

**Still not a time box.** With standing access there is nothing to expire. The time-boxed
grant-link shape (0108) becomes interesting only if the opt-out above ever ships, where a
customer could re-admit support for a week rather than permanently.

### 5. Three levels of screen, and no fourth

- **Tenants** — every organisation, since access no longer waits on a switch. Name, when they
  joined, how many migrations, whether anything is failing. This list is also the argument for
  T1's read log: a screen that shows every customer at once is one where "I only looked at the
  one who emailed me" needs evidence rather than assurance.
- **One tenant** — its connections (kind, display name, status, when tested — never a
  credential), its migrations (name, lifecycle, per-domain state), its invoices (period, total,
  status), and the platform status the customer sees.
- **One migration** — per-domain state, the last run's outcome and timings, the failure
  categories and their counts, whether anything sits in a decision queue.

There is deliberately no fourth level. A screen that lists items is a screen that shows subject
lines, and the whole point of the metadata boundary is that the operator surface stops before
the thing being migrated.

### 6. What the customer sees

**This section was written before ask 1 was reversed and said the wrong thing until 2026-08-27.**
It described a settings line "and the switch to turn it off" — a switch the owner's answer
removed. Left uncorrected it would have sent whoever built T6 to construct the exact control §4
decided against, which is how a plan quietly re-litigates a decision by not being edited.

Support access being on must be **visible to the customer, not only to us**. Under standing
access there is nothing for them to toggle, so what they are owed is different in kind and
larger in obligation:

- **That it is on**, said plainly on their settings page, in the same metadata vocabulary used
  here — Ownpace support can see the state of your migrations, never their contents.
- **What was actually looked at.** This is what replaces the switch. `support_read` exists so
  that "we only looked at the account that emailed us" is evidence rather than assurance, and a
  record the customer cannot be shown is a record kept for our benefit. The operator screens say
  so at the top of every page (T4), addressed to the operator; the customer-facing half is the
  half still to build.
- **The privacy policy and the DPA**, in both languages, saying the sentence that is now true:
  *"Ownpace staff can see the state of your migrations — names, states, counts, dates and error
  categories — and never their contents."* Not *"when you turn support access on"*: nobody turns
  it on.

The words themselves are deliberately the owner's to write, which is why T6's guard half shipped
without them.

## Where the cost is

**Schema and a screen, and neither is deep.** One managed table, a handful of views, three
pages, one classification pass at an existing seam. Nothing here needs a provider, a purchase or
a new dependency.

**The expensive part is the promise, not the code.** Once support access exists it will be asked
to grow — one more column, one more level, "just this once for a difficult customer". The
column-list-as-boundary design is chosen precisely so that each of those is a migration somebody
reviews rather than a route somebody edits.

**In doing nothing:** the first customer with a stuck migration gets an email asking them to
describe their own screen, from the people they are paying to know.

## Not in this plan

- **Acting on a customer's behalf.** Read-only was the owner's answer. Re-running a discovery or
  retrying a failure is a coherent later task and a different risk conversation.
- **Anything in the appliance.** It has an owner, not customers, and no operators (ADR-0036).
- **Impersonation.** Signing in *as* a customer would answer every question this plan struggles
  with, and it is exactly the thing the metadata boundary exists to refuse.
- **A time-boxed or break-glass grant.** With standing access there is nothing to expire; §4
  names the one case that would revive it.
- **Item-level anything.** No message list, no folder tree, no subject lines — see §5.

## The owner's answers (2026-08-27)

1. **Off-by-default: no — (b), on and disclosed.** *"i want to be able to offer support, also
   when someone doesn't know how it all works. people expect me to be able to see what they see
   in case I'm contacted."* Recorded in §4, which is rewritten around what has to replace the
   consent record rather than around a switch.
2. **The six categories: accepted**, with the reframing above — the customer is the primary
   reader, most of this must be self-service, and the owner is for rare and edge cases. T3
   becomes the first task built.
3. **The customer's own status page: no — (a), platform-wide is enough.** Their configured
   checks stay out of the operator view; T5 shows the platform status only.

**One thing his answer 1 asks for that this plan still does not give**, named so it is a
decision rather than an omission: *"see what they see"* is not quite what metadata-only
delivers. The customer sees `last_error` in full; an operator will not. T3's categories close
most of that gap and are the reason it is built first — but if literal parity is wanted, that is
a change to the **metadata-only** decision, which still stands, and is worth making
deliberately rather than by drift.

## Still open

- **Should the read log become customer-visible** (§4), and when?
- **Does an opt-out ship** before somebody asks for one? Currently: no.
