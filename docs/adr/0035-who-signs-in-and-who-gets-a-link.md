# ADR-0035: Who signs in, and who just gets a link

- **Status:** Accepted 2026-09-20 (owner: "yes on all 3"), substance owner-decided 2026-08-17
  and restated 2026-08-19; amended nine times (latest 2026-10-03: the error text and item names
  follow whose data it is, built); consolidated 2026-10-03 (ADR-0051)
- **Date:** 2026-08-17; consolidated 2026-10-03
- **Deciders:** owner
- **Relates to:** [ADR-0034](./0034-appliance-configuration-surface.md) (its decision 6 is
  restated here, decision 7), [ADR-0033](./0033-domain-wide-delegation.md),
  [ADR-0032](./0032-sharing-queue-target-native-invites.md), [ADR-0014](./0014-cost-recovery-billing.md),
  [ADR-0050](./0050-a-move-is-a-persons-migrations.md), [ADR-0006](./0006-o365-access-model.md),
  SAD §7.3; workplans [0108](../workplans/0108-the-link-that-grants.md),
  [0122](../workplans/0122-the-link-that-shows.md), [0153](../workplans/0153-one-move-per-person.md)
- **History:** the record as it read before consolidation, word for word —
  [history/0035-who-signs-in-and-who-gets-a-link.md](./history/0035-who-signs-in-and-who-gets-a-link.md)

## Operative rules

<!-- What holds NOW, within the ADR-0051 budget: 8 bullets, 60 words a bullet, 300 words in
     all. Amend in place when a later decision changes it, then regenerate OPERATIVE.md:
     node scripts/adr-operative.mjs --write -->

- **Owners sign in; migrated people get links, not accounts** (decisions 1, 7) — persons or
  migrators, never `member`s. Admins see their whole family's or organisation's progress
  (decision 5); nobody is a seat to bill (decision 6).
- **Only the migrated person holds their own source credential, never the organisation**
  (decision 4). Organisation-held credentials (Box CCG, app-only Graph, DWD) **cannot be
  narrowed** — stated, not hidden (decision 3).
- The owner decides who gets a link to manage and **grant** their own migration, and
  **distributes it; we never do** (decision 2). Grant links live 1, 7 or 30 days; progress links
  longer, never showing content (`migration-view.ts`).
- **One link per person** (owner, 2026-09-29 and 2026-10-03; ADR-0050): a grant link and a
  progress link for all their migrations, granting per Google account only what the page showed.
  It replaces the per-migration link; one already sent is honoured until it expires.
- **Start when granted, per person** (owner, 2026-10-03): once the owner has started a person's
  move, each migration of theirs waiting for a grant starts when it lands (`via: 'grant'`).
  Before that first *Start* a grant starts nothing; a migration the owner paused stays paused.
- The person can **take their grant back**, per account: revoked at Google where it will, always
  deleted here, and told which; until they grant again nothing reads that account
  (`withdraw-grant.ts`).
- A link can be **reported** from either page to the Ownpace team's helpdesk or support mailbox,
  never to the organisation that asked; a reply address is optional (`link-reports.ts`).
- **The provider's error text and item names follow whose data it is** (owner, 2026-10-03;
  decision 5): the progress page shows categories only; the owner sees them for accounts the
  organisation connected, and for one a person granted only the category and a reference
  (`whose-data.ts`).

## Context

[ADR-0034](./0034-appliance-configuration-surface.md) decision 6 bounds authentication for an
Organisation deployment to "an admin login and a session … **not per-user identity**, not RBAC,
not per-migrator scoping", on the owner's "**not a thousand interactive logins**". The owner then
chose (2026-08-17) that **only the migrated person may hold their own source credential**, which
seems to need them present: the thousand logins again. A link answers both. It also removes the
**transport** of each person's secret to an operator, which [ADR-0033](./0033-domain-wide-delegation.md)'s
domain-wide delegation was answering.

Managed has accounts already: `tenant_member` (roles `owner | admin | member | viewer`) and a JWT
boundary that takes the role from an active `tenant_member` row, never from the token
(`apps/api/src/middleware/auth.ts`, [ADR-0042](./0042-who-holds-the-passwords.md)). The owner
restated the substance on 2026-08-19: *"owners login, and owner decides who gets a link to manage
and grant their migration."*

## Decision

### 1. Two populations. Only one of them gets accounts.

**People who operate a migration** are `tenant_member` rows: an owner, maybe an admin or two. They
sign in, configure connections and watch the progress board.

**People being migrated** get a link. No `tenant_member` row, no password, no session, no seat — in
any deployment. They are **persons** ([ADR-0050](./0050-a-move-is-a-persons-migrations.md)), each
with their migrations: a family is one account and three mappings, or more, under three persons.

**Vocabulary:** `tenant_member.role` already uses **`member`** to mean a person who can sign in
with limited rights, so this ADR, the UI and the schema must not call a migrated person that;
"migrator" is the shorthand and *person* the row. Reusing `member` for both populations is a bug waiting for a maintainer.

### 2. The link is the migrator's whole interface

One mechanism — signed, expiring, revocable — with two jobs:

- **Supply the credential**, once. The link is not merely a status view — it is how the migrated
  person GRANTS their own migration, which is the only place their source credential is ever
  handled.
- **Be their page afterwards** — their own progress, their own start and pause. This is what
  "migrate at your own pace" actually requires; without it, pace belongs to whoever holds the
  admin login.

The two jobs get different lifetimes, because they carry different risk. The credential step is
**short-lived and spent once its work is done**; the progress page is **longer-lived but
revocable**, and carries
counts and states rather than content, which is what makes the longer window acceptable. The owner
picks the expiry at issue: a grant link 1, 7 or 30 days (accepted 2026-09-20), a progress link 30,
90 or 180 (`packages/ledger/src/mapping-link-store.ts`); the progress link shown to a person as
their own grant ends lives 90 days.

**The admin distributes the link. We never do.** [ADR-0032](./0032-sharing-queue-target-native-invites.md)
already keeps Ownpace from mailing third parties; here the reason is stronger: a mail from an
unfamiliar domain asking for access to a mailbox is indistinguishable from an attack, and
training people to click it is a harm that outlives the migration. The admin copies the link and
sends it through a channel their people already trust, which also takes deliverability,
spam-listing and "why is this vendor emailing our staff" out of the product. Showing a person their
progress link as their own grant ends is not sending (workplan 0122 T7).

**The link is per person** (the amendment of 2026-09-29; the owner: *"yes, a per-person link
instead of the per-migration links"*): a person grants their own accounts, so they get **one grant
link and one progress link for all their migrations**. The grant page asks **per Google account**:
it names each account the person's migrations read, with the migrations each one feeds (from, to,
what), and one *Sign in as …* per account, binding each sign-in as 0108 T8 does (`login_hint`, the
verified address, a refusal naming both);
a grant lands, as decision 4 says, on each migration of that account **that the page listed**, in
one transaction, one `mapping.granted` row each, and a migration added later asks again, because
its destination is new to them. The grant link is spent once every account on it is granted;
until then it stays live within its expiry, so a person with a personal and a work account can do
one now and one later. The progress page shows all their migrations,
and *Take my grant back* works per account: revoked at Google once, cleared from every migration
holding the token. The live-link limit counts a person's grant link once. It is a managed row, `person_link`
(managed migration 0034), shaped like `mapping_link`, since `person` is managed-only
([ADR-0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md)); the appliance has
one implicit person and no grant links.

**It replaces the per-migration link** (the owner, 2026-10-03: *"yes, replace the per-migration
links"*). Neither a migration's page nor *Start a migration* issues one. A per-migration link
already sent works until it expires — at most 30 days for a grant, 180 for a progress page —
because breaking a link someone already received would teach them that links from their
organisation fail, the habit this decision exists to avoid; the migration's page lists those
links and can revoke them. A migration that belongs to nobody (the Migrations page's *Not with a
person yet*) is given a person first, through *Who is this for?* where its link panel was, so
there is one kind of link to explain.

**A link made while every account is connected asks each of them again** (managed migration
0036). A connection can stop working while its token is still held — taken back at Google,
lapsed, or expired after seven days while the Google application is in testing — and the account
still reads as connected. So the person's link remembers which migrations it asks for again,
offers each of their accounts *Connect again*, and is spent once each has been connected through
it. A link made while something was not connected asks only for that.

**Start when granted, per person** (the owner, 2026-10-03: *"Yes, but after the move was started
in the first place. After preflight the start needs to be given at least once, the grant may
arrive later"*; asked per person or per migration, *"Per person"*; asked whether the move must be
running, *"was ever started"*). Nothing of a person's starts by a grant until the owner has
pressed *Start* once, after a count (the preflight) they have seen; before that, a grant only
makes the counts appear. Once one of their migrations has been started, each migration of theirs
that waits for a grant starts by itself when the grant lands, ones added later included, recorded
`via: 'grant'`, though the move is paused or finished since. A migration the owner paused after it
ran is not started by a grant. It stays the owner's *Start* (the progress page's *"their own start
and pause"* is unchanged), and the tick for files a format would refuse is not asked of a
migration that starts by itself: *"at least once"* is the owner's. What it could not copy shows in
its queues.

**Built** (0153 T5 (b), its four slices: #1394, #1396, #1401, #1408): the managed row and the owner's doors
(`/api/people/:personId/links`), the grant page, the person's progress page
(`apps/api/src/routes/person-progress.ts`), and the owner's screens; *Report this link* from a
person's pages (#1402), asking again (#1407), start when granted (#1409, #1417), and the person's page
saying what waits for their grant (#1413).

**Taking a grant back** (0108 T8 (c)): from the progress page, per account, revoked at Google
where it will, always deleted here, and the person told which; until they grant again nothing reads
that account for those migrations, on any credential. A report of a link (0108 T8
(d)) is a helpdesk ticket or, with no helpdesk, a mail to the support mailbox for the alpha
(`apps/api/src/services/report-channel.ts`); it is not offered where neither is set up, and one
without a reply address (filed under the helpdesk's own user) cannot be answered.

### 3. Three credential categories — because the promise is not uniform

"Only the person holds their credential" is **not achievable for every provider**. From
`sourceCredentialRecord` (`apps/api/src/routes/migrations/index.ts`), for the kinds there were when
this was decided:

| Category | Providers | What is stored | Can the organisation read this person's data? |
|---|---|---|---|
| **A — person-held** | Google per-user, Dropbox | `{clientId, clientSecret, refreshToken}` | **No.** The refresh token is minted by their own consent. |
| **B — person-supplied** | `imap`, and the targets | `{username, password}` | Not from us — the admin never sees it back. But it is a reusable password we hold, not a scoped token. |
| **C — organisation-held by the provider's design** | **Box** `{clientId, clientSecret}` (CCG, subject in config); **`oauth2`/`graph`** `{username, tenantId, clientId, clientSecret}` (app-only, reads `/users/{mailbox}`); **Google DWD** `{serviceAccountKey, subject}` | the organisation's app credential | **Yes, by construction.** No link changes this. |

Category C is not a gap to close: Box has no per-user consent (`packages/shared/src/config.ts`
says why). So **the category is recorded per mapping and stated in plain words** on the migrator's
page and the admin's board — for A, "only you can authorise this"; for C, "your organisation's Box
app can read this account" — ADR-0033's honesty about "what cannot be narrowed", one level down.
**The link stays universal; only its meaning changes:** for C it is a notice, plus their progress
page, owed to anyone whose files are read.

### 4. Credentials need a per-mapping home

`secret_ref` was on `connection` and `backup_target` only, so a category-A Google source held **the
organisation's app secret and the person's token in one encrypted blob**. They separate: the app
credential stays on the connection, the person's token goes on their migration as
`mailbox_mapping.source_secret_ref` (ledger migration 0032), which `buildDepsFromMapping` merges
over the connection's credentials key by key. That is `source_config_override`'s shape (migration
0021) on purpose: the config split and the credential split are the same split.

### 5. What an admin may see, and the one thing they may not

The progress board is **almost free**: RLS scopes every table by `app.current_tenant`, and
migrators have no session to isolate. **An admin signs in and sees their tenant.**

The exception is **`lastError`**, the provider's own text, verbatim by design (SAD §11.2) and kept
free of **secrets**, not of *data*: `SELECT "Personal/Divorce lawyer" failed` on a parent's
dashboard is a content leak. Every failure is also stored with a **category** and a suggested
action (`classifyFailure`). **The text follows whose data it is** (the owner, 2026-10-03, choosing
*"C"* of three options):

- **The person's progress page shows the category, never the text.** It is a bearer link that can
  be forwarded and lives up to 180 days, and decision 2 keeps it to counts and states
  (`packages/shared/src/migration-view.ts`); its sentence says the person running the move can see
  more.
- **The owner sees the text for an account the organisation connected itself**, under its category
  (`apps/web/src/components/LiveProgress.tsx`, `apps/web/src/pages/Failures.tsx`): the organisation
  holds that credential, and the owner is who chooses Retry, Accept or Reconnect.
- **For an account a person connected through their own grant** (`mailbox_mapping.source_secret_ref`,
  or `grant_withdrawn_at` once they took it back), **the owner sees the category, the side and a
  reference**, never the text and never the items' names (the owner, 2026-10-03, on the names:
  *"yes"*): they can name that person's folders and files, which decision 4's promise — the
  organisation cannot read this person's data — would otherwise leak through an error message.
  Support finds the full line by the reference, so the failure is surfaced, not masked (hard
  rule 9).

The admin may **see, and nudge — never act on someone's behalf**: see who is stuck, re-issue a
link, never hold the credential. That is the support burden this ADR buys, accepted knowingly.

**Built** (2026-10-03), on the server, so no browser is sent what it must not show
(`apps/api/src/routes/migrations/whose-data.ts`). The migration page's report carries
`lastErrorWithheld` where it carried `lastError`, and says why; so does the completion report,
whose JSON reaches the browser beside its Markdown. The failure queue's rows keep their
category, domain and attempts with an empty text and no names (`withheldFailure`), the queue says
`textWithheld`, and the group action refuses a substring of text it does not show, since the count
it answers with would read that text one guess at a time. Guards: the two
`a-failure-that-names-someone-elses-files.unit.test.ts` (`packages/shared`, `apps/api`), and the
page tests. **Not covered yet:** the preflight's own error line for a data type it could not count,
which the confirm screen prints as it is.

### 6. There are no seats, and this ADR must not invent one

**Nothing counts people**: ADR-0014 bills a tier on paths at the same time and data moved, and a
person is never billed (ADR-0050). So **issuing a link is free, and adding a `tenant_member` is
free.** This is a decision, not an omission: **per-migrator pricing would penalise the private
option**, giving a customer a reason to switch to one category-C credential for everyone — the
arrangement where the organisation *can* read everyone's mail. A cost-recovery product must not
build an incentive that argues against its own security model. Seat pricing would need its own ADR
**amending ADR-0014**: it departs from cost recovery, and is not a tariff detail.

### 7. What this restates in ADR-0034

**Decision 6 holds, and its bound holds — because a link is not a login.** Migrators authenticate
to **their own provider**; they hold a signed link, not a session, and no user record, password or
role. Decision 6 gains a sentence, not a reversal: its admin login is the boundary in front of
the **operator** surface, and the link a separate, narrower one in front of exactly the migrations
it names — one mapping, or one person's. Two boundaries, different shapes, neither one RBAC. SAD
§7.3's `Auth` row (self-host: `local / single-user`) still has to change, to "admin login +
session", not to a user directory.

### 8. What does not change

- **ADR-0033 is not retracted.** DWD stays for departed staff, shared mailboxes and people who will
  not engage; it stops being the default for a cooperative tenant.
- **Hard rule 5.** One identity model in both editions: the admin login optional on Personal
  (loopback, one person, their own machine), mandatory anywhere bound off loopback.
- **Managed's sign-in** — Zitadel (ADR-0042), the JWT boundary, `tenant_member` — is unchanged; this
  ADR adds the link and the per-mapping credential.

## Consequences

**Easier.** Nobody being migrated registers for anything: a parent sends their child a link. The
design is one experience in all three deployments. ADR-0034's per-object provenance, collision
refusals and adopt-or-delete are largely unnecessary.

**Harder.** A link is a bearer credential: expiry, revocation, re-issue, and a support path for "my
link says invalid". Error classification is new work.

**Riskier, and named.** A link that lands on a **password form** — category B, where most self-host
deployments live — is shaped exactly like phishing. The organisation's own host, an announcement
out of band and app-specific passwords reduce that; they do not remove it. It is the sharpest edge
here. As built, a grant link asks Google only (`source_not_google`, `grant-link-readiness.ts`).

**Honest about Managed.** We hold the encrypted tokens: the promise is "your admin cannot read
this", never "nobody can". On self-host the customer's machine holds them. Say so to customers.

**Still open**, besides what decisions 5 and 7 name: decision 3's per-mapping category and its
sentence, which nothing records yet; start and pause on the progress page (0122 T8); and links
outside managed, whose grant and progress pages are managed-only
(`apps/web/src/AppRoutes.tsx`).

## Alternatives considered

**An account for every migrated person.** Rejected: it reverses "not a thousand interactive
logins" and buys nothing — migrators authenticate to their *provider*, so an Ownpace password is a
second credential guarding a page of counts — while adding registration, resets and sessions for
people who visit about twice.

**Keep organisation-held credentials and let the admin do everything.** The cheapest. Rejected by
the owner's decision; it is also where a stolen appliance yields every mailbox.

**We email the links.** Forty links is forty copy-pastes. Rejected on ADR-0032's precedent, and
because the message that matters must come from someone the recipient already trusts. A
per-person copy-link and a bulk export is the compromise; if the friction proves real, the fix is
better distribution ergonomics, never us becoming the sender.

**Charge per migrator.** Rejected in decision 6: it prices customers away from the private option
and departs from ADR-0014 without saying so.

**A link per migration as the person's interface** (until 2026-09-29). Rejected by the owner after
*Start a migration* (0153 T4, #1386) sent Anna, one Google account going to Soverin and to a
Nextcloud, two links to grant the same account twice.

**A person's link in the ledger's `mapping_link`.** Rejected: the shared ledger every appliance
applies cannot point at the managed-only `person` (ADR-0036).

**Ending the per-migration links already sent** when the person's link replaced them. Rejected
(2026-10-03): a link someone already received that stops working teaches them that links from
their organisation fail, the habit decision 2 exists to avoid. They expire on their own.

**A grant that starts a migration nobody has started** (the proposal of 2026-09-29, as written).
Rejected by the owner: *"After preflight the start needs to be given at least once, the grant may
arrive later."* **Start when granted per migration**, rather than per person: rejected, *"Per
person"*.

**The verbatim text on the person's page and a category on the owner's** (decision 5 as decided
on 2026-08-17). Replaced on 2026-10-03: the person's page is a forwardable bearer link that
decision 2 keeps to counts and states, and the owner, who chooses Retry or Reconnect, needs the
text for the accounts the organisation connected. **The text for every account on the owner's
pages** (as built) and **the text on the person's link** were the other two options; the first
leaks a person's own data to their organisation, the second puts it on a link anyone can be
forwarded.

## Amendment log

- **2026-08-17** — Decided by the owner in conversation, recorded as Proposed: only the migrated
  person holds their own source credential, never the organisation; migrated people get links, not
  accounts; an admin sees the progress of everyone in their family or organisation; the seat
  question is answered inside this ADR. Record: the *Status* entry, *Context* (with *A correction,
  first, because it changed my advice*), *The question*, *Decision* 1–8, *Consequences* and
  *Alternatives considered*.
- **2026-08-19** — Restated by the owner: *"owners login, and owner decides who gets a link to
  manage and grant their migration."* The owner is the only party who signs in, and the link is how
  the migrated person grants. Not taken as the formal accept. Record: the *Status* entry.
- **2026-09-20** — Accepted (owner: "yes on all 3", closing workplan 0108's review); the 1/7/30-day
  link expiry presets stand. Record: the *Status* entry.
- **2026-09-24** — The migrated person can take their grant back from their progress page, and
  nothing then reads that account, on any credential (the owner, 2026-09-23, and 2026-09-24: *"yes,
  the cautious option"*; built by 0108 T8 (c)). Record: *Operative rules*, sixth bullet.
- **2026-09-24** — A link can be reported from its grant or progress page, never to the organisation
  that asked; a reply address is optional (the owner, 2026-09-24; built by 0108 T8 (d)). Record:
  *Operative rules*, seventh bullet.
- **2026-09-28** — With no helpdesk set up, a report goes by mail to the support mailbox, for the
  alpha (the owner; `apps/api/src/services/report-channel.ts`, workplan 0108). Record: none — the
  record said a report is offered only where a helpdesk is set up.
- **2026-09-29** — The amendment of 2026-09-29: the link is per person (owner: *"yes, a per-person
  link instead of the per-migration links"*; workplan 0153 T5 (b)). What becomes of the
  per-migration link, and *start when granted*, were proposed. Record: *Amendment 2026-09-29 — the
  link is per person (workplan 0153 T5 (b))*.
- **2026-10-03** — The person's link replaces the per-migration link; those sent are honoured until
  they expire, and a migration with no person gets one first (owner: *"yes, replace the
  per-migration links"*; #1408). Record: the 2026-09-29 amendment's *What the question after the
  decision is answered with (decided 2026-10-03)*.
- **2026-10-03** — Start when granted, per person, once the move was ever started (owner: *"Yes,
  but after the move was started in the first place…"*, *"Per person"*, *"was ever started"*;
  #1409, #1417). Record: the same amendment's *One more choice for the owner (decided 2026-10-03)*.
- **2026-10-03** — A person's link made while every account is connected asks each of them again
  (managed migration 0036; #1407). Record: the same amendment, *A link made while every account is
  connected asks each of them again*.
- **2026-10-03** — Consolidated in place (ADR-0051). Nothing was decided by the consolidation. Where
  the record and the code differ, the Decision states the decision and says what is built:
  decision 3's per-mapping category (not built), and links on managed only.
- **2026-10-03, later** — Decision 5: the provider's error text follows whose data it is — the
  person's page shows categories only, the owner sees the text for the organisation's own accounts
  and a category with a reference for one a person granted (owner: *"C"*). Asked because the code
  had been built the other way round from decision 5. Not built yet. Record: *Decision* 5, and
  *Alternatives considered*.
- **2026-10-03, last** — Decision 5 built, and the items' names follow the text (owner: *"yes"*).
  Record: *Decision* 5.
- **2026-10-03, after that** — The completion report withholds the text too: its JSON carried each
  data type's error verbatim. Found in review of the build; nothing was decided. Record:
  *Decision* 5.

The full record, word for word as it read before this consolidation:
[history/0035-who-signs-in-and-who-gets-a-link.md](./history/0035-who-signs-in-and-who-gets-a-link.md).
