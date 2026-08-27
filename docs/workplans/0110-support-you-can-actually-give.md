# Workplan 0110 — support you can actually give

## Status — 2026-08-27 (update this block at the end of every session)

**This is a design for review, not a build.** The owner asked for the smallest thing that lets
him help a customer who is stuck, and answered the three questions that decide its shape on
2026-08-27. Nothing below exists in code until this is merged and a task is started.

| Task | Status | Evidence |
|---|---|---|
| T1 The owner's switch: `tenant_support_access` | 📋 Awaiting review | Off by default. The customer turns it on, and can turn it off. |
| T2 The read model: metadata-only views, in the managed chain | 📋 Awaiting review | The column list IS the privacy boundary — enforced by the database, not remembered by a route. |
| T3 A failure has a CATEGORY, not only prose | 📋 Awaiting review (**blocking for usefulness**) | `last_error` is the most useful field and the one that cannot be shown. |
| T4 The operator's screens: tenants, one tenant, one migration | 📋 Awaiting review | Three levels, no fourth. |
| T5 Invoices and status, for the tenant in front of you | 📋 Awaiting review | Totals and states; and 0109 T0 means "no invoice" is now a real answer. |
| T6 The words, and the guard | 📋 Awaiting review | What the owner sees when it is on; and the appliance never gains any of it. |

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
- **The owner switches it on.** Support access is **off until the customer enables it** for
  their organisation, and they can switch it off again. Not a standing promise about staff
  access — a per-customer choice, visible in their own app.
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
  AND EXISTS (SELECT 1 FROM public.tenant_support_access
               WHERE tenant_id = <the row's tenant> AND revoked_at IS NULL)
```

Not an operator → zero rows. Customer has not switched it on, or switched it off → zero rows.
There is no third case and no partial answer.

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

Two things that make this cheaper than it sounds: `google-token-provider.ts`'s `hintFor` already
classifies Google's `invalid_grant` into named causes (0089 T2), and 0090's budget pause already
distinguishes "we stopped on purpose" from "the provider refused". The work is naming the
categories and applying them at one seam, not inventing detection.

And one honest limit worth writing into the plan rather than discovering later: **`unknown` will
be common at first**, and an operator looking at `unknown` is back to asking the customer to read
their screen. That is acceptable — the category improves with every real incident — but the
screen must say *"we could not classify this"* rather than showing a blank, or it will read as
"nothing is wrong".

### 4. The owner's switch

A `tenant_support_access` row in the **managed** chain: `tenant_id`, `granted_by`, `granted_at`,
`revoked_at`, an optional note. Absent or revoked means no access — the default is off because
the absence of a row is the absence of consent, which is the only default that cannot be got
wrong by a migration that half-ran.

On the customer's side it is one switch and one sentence, on their own settings page, with the
current state visible. Turning it off takes effect on the next query, because the views join the
table rather than caching a decision.

**Not a time box, in this version.** A time-boxed grant is better and it is more machinery — an
expiry, a renewal path, a reminder before it lapses, and a decision about what happens to an
operator mid-incident. The switch is honest without it, and 0108's expiry picker is the shape to
copy if this later wants one.

### 5. Three levels of screen, and no fourth

- **Tenants** — the organisations that have switched support on. Name, when they joined, how
  many migrations, whether anything is failing.
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
- **A time-boxed or break-glass grant.** Named in §4 as the upgrade path if the simple switch
  proves too coarse.
- **Item-level anything.** No message list, no folder tree, no subject lines — see §5.

## Asks of the owner (the review)

1. **Is the switch's default off acceptable commercially?** It means every support conversation
   starts with "please turn this on", including the first one, when trust is lowest. The
   alternative was always-on-and-disclosed, which is what most of the industry does.
2. **Which failure categories matter to you?** T3's list should be the ones that change what
   *you* would do next, not a taxonomy. My proposal: `auth_expired`, `rate_limited`,
   `quota_exceeded`, `target_refused`, `network`, `unknown`.
3. **Does the operator need to see the customer's own status page**, or is the platform-wide one
   enough? The former means reading their configured checks; the latter is free.
