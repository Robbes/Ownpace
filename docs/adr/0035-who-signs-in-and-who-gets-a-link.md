# ADR-0035: Who signs in, and who just gets a link

- **Status:** Accepted 2026-09-20 (owner: "yes on all 3"; the 1/7/30-day link expiry presets
  stand). Proposed until then — but the substance below was decided by the owner on 2026-08-17 in
  conversation: (a) **only the migrated person holds their own source credential, never the
  organisation**; (b) migrated people get **links, not accounts**; (c) an admin — a parent, a
  small-business owner — **must see the progress of everyone in their family or
  organisation**; (d) the billing/seat question is answered **inside this ADR** rather than
  alongside it. What awaits an accept/reject is the reasoning and the consequences, not
  those four choices.
  **Restated by the owner 2026-08-19, in these words: "owners login, and owner decides who
  gets a link to manage and grant their migration."** That confirms (a), (b) and (c) and
  sharpens who holds the initiative: **the owner is the only party who signs in**, and the
  link is not merely a status view — it is how the migrated person GRANTS their own
  migration, which is the only place their source credential is ever handled. The formal
  accept/reject of the reasoning and consequences was outstanding until 2026-09-20, and was deliberately
  NOT being inferred from this restatement — see ADR-0034's correction for why an
  unstated answer must never be recorded as one.
- **Date:** 2026-08-17
- **Deciders:** owner
- **Relates to:** [ADR-0034](./0034-appliance-configuration-surface.md) (**decision 6 is
  restated by this ADR** — see decision 7), [ADR-0033](./0033-domain-wide-delegation.md)
  (whose credential-transport problem this largely removes, and whose honesty discipline
  decision 3 borrows wholesale), [ADR-0032](./0032-sharing-queue-target-native-invites.md)
  ("Ownpace never mails third parties itself" — which settles who sends the link),
  [ADR-0014](./0014-cost-recovery-billing.md) (cost recovery — which settles the seat
  question), [ADR-0006](./0006-o365-access-model.md), SAD §7.3 (the `Auth` row this
  changes).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **Owners sign in; migrated people get links, not accounts** — and the owner decides who gets a link to manage and **grant** their own migration (restated 2026-08-19).
- **The link is per person** (owner, 2026-09-29; ADR-0050's person): one grant link and one progress link for all of a person's migrations, a grant asked and bound per Google account, and covering only the migrations the page showed. Built by workplan 0153 T5 (b).
- **It replaces the per-migration link** (owner, 2026-10-03): no migration's page issues one any more. A per-migration link already sent is honoured until it expires, listed on the migration's page and revocable there, and a migration that belongs to nobody is given a person first (*Who is this for?*).
- **Start when granted, per person** (owner, 2026-10-03): once the owner has started a person's move (*Start*, after a count they saw), each migration of theirs that waits for a grant starts by itself when the grant lands, recorded `via: 'grant'`, though the move is paused or finished since (*"was ever started"*). Before that first Start a grant starts nothing, and a migration the owner paused after it ran stays paused.
- Only the migrated person holds their own source credential, never the organisation; admins see their whole family/organisation's progress.
- `tenant_member` rows sign in; mappings get links. Organisation-held credentials (Box CCG, app-only Graph, DWD) **cannot be narrowed** — stated, not hidden.
- Formally accepted 2026-09-20 (owner: "yes on all 3"); the 1/7/30-day link expiry presets stand.
- The migrated person can **take their grant back** from their progress page: revoked at Google where Google will, deleted here whatever Google answers, and they are told which (0108 T8 (c), 2026-09-24). Until they grant again, nothing reads that account for that migration, on any credential.
- The person holding a link can **report it** from the grant page or the progress page: a ticket on the owner's helpdesk, never a message to the organisation that asked, offered only where a helpdesk is set up (0108 T8 (d), 2026-09-24). A reply address is optional: a report without one is filed under the helpdesk's own user and cannot be answered (the owner, 2026-09-24).

## Context

### A correction, first, because it changed my advice

I told the owner that "21 ledger migrations and none create a user, account or membership
table, so the product has no concept of a person today." That is false, and I reached it by
reading migration *filenames* instead of opening the 83 KB baseline.

What is actually there:

- **`tenant_member`** (`0001_baseline.sql`): `tenant_id`, `user_id`, `email`, `role`
  constrained to `owner | admin | member | viewer`, `status` constrained to
  `active | invited | suspended | removed`, plus `invited_at` and `joined_at`. An invitation
  lifecycle, already modelled.
- **`apps/api/src/middleware/auth.ts`**: a real JWT boundary with `sub`, `tenantId`, `role`
  and `email` claims — and it does **not** trust the token's role. It confirms
  `(tenantId, sub)` is an *active* `tenant_member` row and takes the role from the database,
  precisely so a forged `{tenantId: any, role: 'owner'}` cannot mint authority.
  `assertProductionAuthConfig` refuses to boot on a placeholder `JWT_SECRET` rather than
  "serve authenticated theater".
- SAD §7.3's `Auth` row: **managed** is `IdP/SSO (Zitadel)`; **self-host** is
  `local / single-user`.

So Managed already has accounts, roles, and invitations. This ADR is therefore much smaller
than it would otherwise be: for Managed it mostly *names* an existing model and adds one
thing to it. The self-host side is where the work is.

### Why this is being decided now

[ADR-0034](./0034-appliance-configuration-surface.md) decision 6 made authentication a hard
prerequisite for an Organisation deployment, and bounded it using an owner decision recorded
in the same ADR — that an Organisation's ~1000 is "migrated accounts operated by a small
admin team, **not a thousand interactive logins**". On that basis decision 6 asks for "an
admin login and a session … **not per-user identity**, not RBAC, not per-migrator scoping."

The owner then chose that **only the migrated person may hold their own source credential.**
Those two do not obviously fit: a credential only that person can hold requires that person
to be *present* to supply it, which sounds exactly like the thousand logins the bound ruled
out.

This ADR exists because there is a third answer that satisfies both, and because saying so
requires being precise about what a "login" is for.

### What "self-service" was actually solving

ADR-0033 adopted domain-wide delegation because per-user OAuth "does not scale to a tenant":
120 consent ceremonies, "each producing a secret somebody has to transport into a mapping",
and an operator who "has every incentive to cut corners (one shared browser profile, tokens
over chat)".

Read that carefully: the problem named is **transport**, not consent count. A person
authorising their own account in their own browser is not expensive; moving the resulting
secret from that person to an operator is. Remove the transport and the ceremony count stops
mattering — which is what this ADR does, and why it reduces the pressure toward DWD without
retracting it.

## The question

Who needs an account, who holds which credential, what may an admin see — and does any of
it create a seat to bill?

## Decision

### 1. Two populations. Only one of them gets accounts.

**People who operate a migration** are `tenant_member` rows. They sign in, they configure the
organisation's connections, they watch the progress board. There are a handful of them: an
owner, maybe an admin or two.

**People being migrated** are **mappings**. They get a link. No `tenant_member` row, no
password, no session, no seat — in any deployment.

A forty-person company is therefore one or two accounts and forty mappings. A family is one
account and three mappings.

**Vocabulary, and this matters:** `tenant_member.role` already uses **`member`** to mean a
person who can sign in with limited rights. This ADR must not reuse that word for a migrated
person, and neither should the UI or the schema. ADR-0034 already says **"migrated
accounts"**; "migrator" is the shorthand. Reusing `member` for both populations is a bug
waiting for a maintainer.

### 2. The link is the migrator's whole interface

One mechanism, mapping-scoped, signed, expiring, revocable. It does two jobs:

- **Supply the credential**, once.
- **Be their page afterwards** — their own progress, their own start and pause. This is what
  "migrate at your own pace" actually requires; without it, pace belongs to whoever holds the
  admin login.

The two jobs get different lifetimes, because they carry different risk. The credential step
is **short-lived and single-use**; the progress page is **longer-lived but revocable**, and
carries counts and states rather than content, which is what makes the longer window
acceptable.

**The admin distributes the link. We never do.** [ADR-0032](./0032-sharing-queue-target-native-invites.md)
already decided that Ownpace never mails third parties itself, routing share invites
through the target's own messaging. The same reasoning applies with more force here: an
email from an unfamiliar domain asking someone to authorise access to their mailbox is
indistinguishable from an attack, and training people to click it is a harm that outlives
the migration. So the UI gives the admin a copy-link per migrator, and the admin sends it
through a channel their people already trust. This also removes deliverability, spam-listing
and "why is this vendor emailing our staff" from the product entirely.

### 3. Three credential categories — because the promise is not uniform

"Only the person holds their credential" is **not achievable for every provider**, and the
tree says so. From `sourceCredentialRecord`:

| Category | Providers | What is stored | Can the organisation read this person's data? |
|---|---|---|---|
| **A — person-held** | Google per-user, Dropbox | `{clientId, clientSecret, refreshToken}` | **No.** The refresh token is minted by their own consent. |
| **B — person-supplied** | `imap`, and the targets | `{username, password}` | Not from us — the admin never sees it back. But it is a reusable password we hold, not a scoped token. |
| **C — organisation-held by the provider's design** | **Box** `{clientId, clientSecret}` (CCG, subject in config); **`oauth2`/`graph`** `{username, tenantId, clientId, clientSecret}` (app-only, reads `/users/{mailbox}`); **Google DWD** `{serviceAccountKey, subject}` | the organisation's app credential | **Yes, by construction.** No link changes this. |

Category C is not a gap to close. Box's own model has no per-user consent step — the comment
in the tree explains why: "Box rotates refresh tokens on every use, so the Client Credentials
Grant is used and the subject user id names whose files the token reads." A migrator's Box
files are readable by whoever holds the organisation's Box app credentials, and that is Box's
design, not ours.

Therefore: **the category is recorded per mapping and stated in plain words**, on the
migrator's own page and on the admin's board. For A, "only you can authorise this". For C,
"your organisation's Box app can read this account." This is exactly the discipline ADR-0033
already imposes — the tool "must be honest about what cannot be narrowed" — applied one level
down.

One pleasing consequence: **the link stays universal and only its meaning changes.** For
category C it is not a consent, because there is nothing to consent to; it is a notification
that this is happening, plus their progress page. Someone whose files are being read is owed
that regardless of whether their click is what authorises it.

### 4. Credentials need a per-mapping home

`secret_ref` exists on exactly two tables — `connection` and `backup_target`. There is none on
`mailbox_mapping`.

That is the blocker. For a category-A Google source the stored record is
`{clientId, clientSecret, refreshToken}` — **the organisation's app secret and the person's
token in one encrypted blob**. Under this ADR they must separate: the app credential belongs
to the connection, the person's token belongs to their mapping.

So `mailbox_mapping` gains a nullable credential reference, and `buildDepsFromMapping` prefers
it over the connection's when present. This is the same shape as `source_config_override`
(migration 0021) — one nullable column, one key-by-key preference, NULL meaning "nothing of
mine, use the connection's" — which is deliberate: the config split and the credential split
are the same split, and should look like it.

### 5. What an admin may see, and the one thing they may not

The progress board is **almost free**. RLS already scopes every table by `app.current_tenant`,
and `mailbox_mapping` already carries per-person status, counts and timings. Migrators have no
session at all, so there is not even a member-isolation predicate to write. An admin signs in
and sees their tenant, which is today's behaviour.

The exception is **`lastError`**, and it is a real leak rather than a theoretical one. The
secret-hygiene test states the contract: `lastError` is surfaced verbatim by design (SAD
§11.2), and the guarantee asked of connectors is that they "must not embed **secrets** in
error strings." Secrets — not *data*. Mail and file connectors routinely put a folder name or
a filename in an error. That is harmless while the only reader is an operator who already has
full access. It stops being harmless the moment an admin is deliberately not supposed to see a
migrator's content: a verbatim `SELECT "Personal/Divorce lawyer" failed` on a parent's
dashboard is a content leak delivered by an error string.

So: **the migrator's own page shows the verbatim error** — hard rule 9 survives exactly where
it can be acted upon, by the person holding the credential. **The admin's board shows a
classified error** — a category and a suggested action. When the classifier does not recognise
something it says so and says to ask the person for the detail, rather than guessing or
passing the string through.

Which gives the admin's capability set its one-line statement: **see, and nudge — never act on
someone's behalf.** They can see who is stuck and on what class of problem, and re-issue a
link. They cannot fix it, because they cannot hold the credential. That is the support burden
this ADR buys, accepted knowingly.

### 6. There are no seats, and this ADR must not invent one

The owner asked for the billing question to be answered here. It answers itself from what is
already built.

`usage_metric.metric_type` is constrained to `storage | egress | compute | api_calls`.
`tenant.pricing` is `{baseFee, storagePricePerGB, egressPricePerGB, computePricePerHour}`.
ADR-0014 sets the model: cost recovery, "a low flat monthly per tenant for the shared baseline
+ marginal pass-through for storage/egress", explicitly not profit-seeking. **Nothing anywhere
counts people.** There is no seat today.

So the decision is: **issuing a link is free, and adding a `tenant_member` is free.** A migrator
costs nothing to *exist*; they cost storage, egress and compute when they migrate, and that is
already metered against the tenant. Billing is untouched by this ADR, which is the correct
amount for an identity decision to touch pricing.

This is worth stating as a decision rather than an omission, because the obvious "improvement"
is actively harmful. **Per-migrator pricing would penalise the private option.** A customer
charged per link has a direct financial reason to stop issuing links and switch to a
category-C credential instead — one Box app or one DWD key covering everyone, no per-person
charge. Pricing would push customers toward the arrangement where the organisation *can* read
everyone's mail. A cost-recovery product must not build an incentive that argues against its
own security model.

If seat pricing is ever wanted it needs its own ADR **amending ADR-0014**, because it is a
departure from cost recovery and not a tariff detail. Note also `0007_tenant_pricing`'s
discipline: `tenant.pricing` is pinned per tenant at first billing and never follows the
operator's template afterwards, so a pricing change is a per-customer agreement, never a
config edit.

### 7. What this restates in ADR-0034

**Decision 6 holds, and its bound holds — because a link is not a login.**

ADR-0034 required an admin login and a session before credential-editing routes reach an
Organisation deployment, and bounded that to "not per-user identity, not RBAC, not
per-migrator scoping" on the owner's "not a thousand interactive logins". Every word of that
survives. Migrators authenticate to **their own provider**, not to Ownpace; they hold a
signed link, not a session; there is no user record, no password and no role for them. The
thousand logins never happen.

What decision 6 needs is one added sentence rather than a reversal: the admin login it demands
is the boundary in front of the **operator** surface, and the migrator's link is a separate,
narrower boundary in front of exactly one mapping. Two boundaries, different shapes, neither
one RBAC.

SAD §7.3's `Auth` row still has to change — self-host reads `local / single-user`, and an
Organisation deployment is neither — but it changes to "admin login + session", not to a user
directory.

### 8. What does not change

- **ADR-0033 is not retracted.** DWD stays for departed staff, shared mailboxes, and people who
  will not engage. What changes is that it stops being the default path for a cooperative
  tenant, because the transport problem that justified it is gone.
- **Hard rule 5.** Both editions run the same core; this is one identity model with the admin
  login optional on Personal (loopback, one person, their own machine) and mandatory anywhere
  bound off loopback.
- **Managed's existing auth.** Zitadel, the JWT boundary and `tenant_member` stay as they are.
  This ADR adds the link and the per-mapping credential; it does not re-do sign-in.

## Consequences

**Easier.** The migrator's experience is identical in all three deployments and involves no
account anywhere. A parent sends their child a link; nobody registers for the household
migration tool. Managed's half is mostly built. The admin progress board is close to free
because RLS already does the scoping. And ADR-0034's hardest machinery — per-object file/DB
provenance, collision refusals, adopt-or-delete — is largely unnecessary once configuration has
an owner to point at.

**Harder.** A signed link is a bearer credential, with everything that implies: expiry,
revocation, re-issue, and a support path for "my link says invalid". The per-mapping credential
is a schema change plus a preference rule in `buildDepsFromMapping`. Error classification is
new work that did not exist when every reader was an operator.

**Riskier, and named.** A link that lands on a **password form** is shaped exactly like
phishing, and category B is where most self-host deployments will live. Partial mitigations —
the page is on the organisation's own host, the admin announces it out of band, and app-specific
passwords should be preferred where the provider offers them — do not make this go away. It is
the sharpest edge in this ADR.

**And one honest limit on Managed.** We hold the encrypted tokens; the customer's admin does not.
The promise is therefore precisely "your admin cannot read this", never "nobody can" — we operate
the service. On self-host the customer's own machine holds them and the promise is stronger. That
difference should be stated to customers rather than smoothed over.

## Alternatives considered

**An account for every migrated person.** The literal reading of "everyone logs in". Rejected: it
reverses the owner's "not a thousand interactive logins", and it buys nothing the link does not —
migrators authenticate to their *provider*, so an Ownpace password is a second credential
protecting a page that shows counts. It also drags in registration, password reset, session
management and support for a population that interacts with us roughly twice.

**Keep organisation-held credentials and let the admin do everything.** Today's model, and the
cheapest. Rejected by the owner's decision, and it is the arrangement where a stolen appliance
yields every mailbox rather than the endpoints.

**We email the links.** Better admin ergonomics — forty links is forty copy-pastes. Rejected on
ADR-0032's existing precedent and because the trust problem is fatal: the message that matters
must arrive from someone the recipient already trusts. A per-person copy-link and a bulk export
is the compromise; if the friction proves real, the fix is better distribution ergonomics, never
us becoming the sender.

**Charge per migrator.** Rejected in decision 6 above: it would price customers away from the
private option and depart from ADR-0014 without saying so.

## Amendment 2026-09-29 — the link is per person (workplan 0153 T5 (b))

**Decided by the owner, asked whether *Start a migration* should give one link per person:**
*"yes, a per-person link instead of the per-migration links. Perhapse replace it, or do we still
need the per-migration-link?"* The first sentence is the decision. The question after it is
answered below as a recommendation, marked **(proposed)** where it waits for the owner's word.
On 2026-10-03 the owner answered it: *"yes, replace the per-migration links"*.

### Why

Decision 1 said people being migrated *are* mappings. ADR-0050 has since given them a row of
their own, the **person**, whose migrations a move is. The link followed the old shape, and a
walk of *Start a migration* for somebody else (0153 T4, #1386) shows the cost: Anna has one
Google account; going to Soverin and to a Nextcloud makes two migrations, so they were sent two
links to grant the same account twice. A person grants their own accounts, so the link belongs to
the person. This decision's own alternatives already called the compromise *"a per-person
copy-link"*.

### What changes

- **Decision 1 and 2: people being migrated are persons (ADR-0050), and each gets one grant link
  and one progress link, not one per migration.** Everything else in decision 2 holds: the owner
  distributes it and we never do; the grant link is short-lived and spent once its work is done;
  the progress link is longer-lived and revocable.
- **The grant page asks per account, not per migration.** It names each Google account the
  person's migrations read, with the migrations each one feeds (from, to, what), and one *Sign in
  as …* per account. 0108 T8's binding holds per account: `login_hint`, the ID token's verified
  address, and a refusal naming both addresses when another account signs in.
- **A grant covers what the page showed.** The token lands, as decision 4 says, on each migration
  that reads that account and was listed when the person pressed the button, in one transaction,
  with a `mapping.granted` row per migration. A migration added to the person later is not
  granted by an earlier consent. It asks again, through a link that is still live or a new one,
  because its destination is new to them.
- **The grant link is spent when every account on it is granted.** Until then it stays live
  within its expiry, so a person with a personal and a work account can do one now and one later.
- **A link made while every account is connected asks each of them again** (added 2026-10-03,
  managed migration 0036). A connection can stop working while its token is still held: taken
  back at Google, lapsed, or expired after seven days while the Google application is in testing.
  The account still reads as connected, and a migration's own link, which asked whatever its
  migration needed, was the way back. So the person's link remembers which migrations it asks
  for again, offers each of their accounts *Connect again*, and is spent once each has been
  connected through it. A link made while something was not connected asks only for that.
- **The progress page is the person's.** It shows every migration of theirs. *Take my grant back*
  is per account: the token is revoked at Google once, and cleared from every migration that holds
  it (0108 T8 (c)'s rules otherwise unchanged).
- **The live-link limit counts a person's grant link once** (0108 T8 (d)).
- **Where it lives.** `person` is a managed-only table (ADR-0036, `packages/managed`), and the
  shared ledger cannot point at it. So the person's link is a managed-only row of its own
  (`person_link`, in `packages/managed/migrations`), shaped like `mapping_link`: a hashed secret,
  a purpose, an expiry, used and revoked, and the same row security, including a link seeing only
  itself. The appliance has one implicit person and no grant links; nothing there changes.

### What the question after the decision is answered with (decided 2026-10-03)

The owner: *"yes, replace the per-migration links"*. The three points below were the proposal it
answers, and stand as written.

- **Replace, as the one link that is issued.** Neither the migration's page nor *Start a
  migration* issues a per-migration link once the person's link is built.
- **Keep: a per-migration link already sent works until it expires** (at most 30 days for a
  grant, 180 for a progress page). Breaking a link someone already received would teach them that
  links from their organisation fail, which is the habit decision 2 exists to avoid. The server
  keeps verifying `mapping_link` for that window; the migration's page lists those links and can
  revoke them, and says new links are made on the person's page.
- **Keep: a migration with no person gets one first.** On managed a migration can belong to nobody
  (the Migrations page's *Not with a person yet*). Its page offers *Who is this for?* where the link panel
  was, so there is still one kind of link to explain.

### One more choice for the owner (decided 2026-10-03)

**Start when granted.** Until then nothing started when a grant landed (`grant-ending.ts`), and
*Start* was refused with `awaiting_grant`, so the person starting the migrations had to come back.
The proposal was that *Start* on a migration that waits for a grant is accepted and recorded, and
the migration starts itself when its grant lands, with the audit row saying so.

The owner: *"Yes, but after the move was started in the first place. After preflight the start
needs to be given at least once, the grant may arrive later."* Asked whether that holds per
person or per migration: *"Per person"*. So:

- **Nothing of a person's starts by a grant until the owner has started their move**: pressed
  *Start* once, after a count (the preflight) they have seen. Before that, a grant only makes the
  counts appear.
- **Once one of their migrations has been started**, each migration of theirs that waits for a
  grant starts by itself when the grant lands, ones added later included. The status change is
  recorded `via: 'grant'`, by the link. It holds though that migration is paused or finished
  since: asked whether the move must be running or only have been started, the owner answered
  *"was ever started"* (2026-10-03).
- **A migration's own pause stands.** A migration the owner paused after it ran is not started by
  a grant.
- It stays the owner's Start (decision 2's *"their own start and pause"* is the progress page's,
  and unchanged). The tick for files a format would refuse is not asked of a migration that starts
  by itself: *"at least once"* is the owner's. What it could not copy shows in its queues.
