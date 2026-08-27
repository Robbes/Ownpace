# Workplan 0110 — support you can actually give

## Status — 2026-08-27 (update this block at the end of every session)

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
| T3 A failure has a CATEGORY, not only prose | ✅ **Done 2026-08-27** | Six categories classified at `markFailed`, stored beside the prose in migration 0033, and rendered on the CUSTOMER's own progress strip as a remedy sentence in both languages — the owner's reframing, so the primary reader is the person whose migration stopped. `last_error` still renders verbatim beneath it: precision for whoever needs it, the way out for whoever does not. Ordering is load-bearing and tested — quota beats rate beats auth, because *"wait until tomorrow"*, *"wait a minute"* and *"reconnect"* are different instructions and telling somebody to reconnect a working credential sends them to do damage. `unknown` is a real answer with its own sentence carrying the way OUT of self-service, and NULL (nothing failed) is deliberately distinguishable from `unknown` (failed, unclassified). Proved at three levels and by breaking each: the classifier against real provider messages (20), the STORE against PGlite (4 — dropping the classify call leaves all 20 classifier tests green, which is the whole reason that file exists), and the SCREEN (6 — rendering the label instead of the sentence turns 3 red). |
| T4 The operator's screens: tenants, one tenant, one migration | 📋 Ready to build | Three levels, no fourth. |
| T5 Invoices and status, for the tenant in front of you | 📋 Ready to build (owner: platform-wide status only, 2026-08-27) | Totals and states; and 0109 T0 means "no invoice" is now a real answer. The customer's OWN configured checks stay out (ask 3 = a). |
| T6 The words, and the guard | 📋 Ready to build | Now a DISCLOSURE rather than a switch's label — it must be true before the first customer arrives, not after. And the appliance never gains any of it. |

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

Support access being on must be **visible to the customer, not only to us**: a line on their
settings page saying it is on, who can see (Ownpace support), what that means in the same
metadata vocabulary used here, and the switch to turn it off. If the privacy policy gains a
sentence, it gains the one that is true — *"when you turn support access on, Ownpace staff can
see the state of your migrations, never their contents"* — and it says it in both languages.

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
