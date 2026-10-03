# ADR-0035: Who signs in, and who just gets a link

- **Status:** Accepted 2026-09-20 (owner: "yes on all 3"), substance owner-decided 2026-08-17
  and restated 2026-08-19; amended three times (latest 2026-09-29: the link is per person); two
  proposals of 2026-09-29 pending, not in force; consolidated 2026-10-03 (ADR-0051)
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

<!-- What holds NOW, within the ADR-0051 budget: 8 bullets, 60 words a bullet, 250 words in
     all. Amend in place when a later decision changes it, then regenerate OPERATIVE.md:
     node scripts/adr-operative.mjs --write -->

- **Owners sign in; migrated people get links, not accounts** (decisions 1, 7). Admins see
  their whole family's or organisation's progress (decision 5); nobody is a seat to bill
  (decision 6).
- **Only the migrated person holds their own source credential, never the organisation**
  (decision 4). Organisation-held credentials (Box CCG, app-only Graph, DWD) **cannot be
  narrowed** — stated, not hidden (decision 3).
- The owner decides who gets a link to manage and **grant** their own migration, and
  **distributes it; we never do** (decision 2). A grant link expires in 1, 7 or 30 days
  (`mapping-link-store.ts`).
- **The link is per person** (owner, 2026-09-29; ADR-0050): one grant link and one progress
  link for all their migrations, a grant asked and bound per Google account, covering only what
  the page showed. Of these, only the grant link is built (`a-link-for-a-person.unit.test.ts`);
  per-migration links serve meanwhile.
- The person can **take their grant back** from the progress page: revoked at Google where it
  will, always deleted here, they are told which; until they grant again nothing reads that
  account for that migration, on any credential (`withdraw-grant.ts`).
- A link can be **reported** from the grant or progress page to the Ownpace team's helpdesk or
  support mailbox, never to the organisation that asked; a reply address is optional
  (`link-reports.ts`).
- **Pending (proposed 2026-09-29, not in force):** no new per-migration links, those sent work
  until they expire, a migration with no person gets one first, and *Start* waits for a grant
  (*Pending* below).

## Context

[ADR-0034](./0034-appliance-configuration-surface.md) decision 6 made authentication a hard
prerequisite for an Organisation deployment, bounded on the owner's word that an Organisation's
~1000 is "migrated accounts operated by a small admin team, **not a thousand interactive
logins**": "an admin login and a session … **not per-user identity**, not RBAC, not per-migrator
scoping." The owner then chose (2026-08-17) that **only the migrated person may hold their own
source credential**. A credential only that person can hold needs them *present* to supply it,
which sounds like the thousand logins the bound ruled out. There is a third answer, and it needs
precision about what a "login" is for.

[ADR-0033](./0033-domain-wide-delegation.md) adopted domain-wide delegation because per-user
OAuth meant 120 consent ceremonies, "each producing a secret somebody has to transport into a
mapping". The problem there is **transport**, not consent count: a person authorising their own
account in their own browser is cheap; moving the secret to an operator is not.

Managed already had accounts, roles and invitations: `tenant_member` (roles `owner | admin |
member | viewer`) and a JWT boundary (`apps/api/src/middleware/auth.ts`) that takes the role from
an *active* `tenant_member` row, never from the token ([ADR-0042](./0042-who-holds-the-passwords.md)).
For Managed this ADR names that model and adds the link; the self-host side is where the work is.
The owner restated it on 2026-08-19: *"owners login, and owner decides who gets a link to manage
and grant their migration."* **The owner is the only party who signs in.**

**The question:** who needs an account, who holds which credential, what may an admin see — and
does any of it create a seat to bill?

## Decision

### 1. Two populations. Only one of them gets accounts.

**People who operate a migration** are `tenant_member` rows. They sign in, configure the
organisation's connections and watch the progress board: an owner, maybe an admin or two.

**People being migrated** get a link. No `tenant_member` row, no password, no session, no seat —
in any deployment. They are **persons** ([ADR-0050](./0050-a-move-is-a-persons-migrations.md)),
each with their migrations (mappings). A forty-person company is one or two accounts and forty
persons; a family is one account and three mappings, or more, under three persons.

**Vocabulary, and this matters:** `tenant_member.role` already uses **`member`** to mean a person
who can sign in with limited rights. No ADR, screen or schema reuses that word for a migrated
person: ADR-0034 says **"migrated accounts"**, "migrator" is the shorthand, and the row is a
*person*. Reusing `member` for both populations is a bug waiting for a maintainer.

### 2. The link is the migrator's whole interface

One mechanism — signed, expiring, revocable — with two jobs:

- **Supply the credential**, once. The link is not merely a status view — it is how the migrated
  person GRANTS their own migration, which is the only place their source credential is ever
  handled.
- **Be their page afterwards** — their own progress, their own start and pause. This is what
  "migrate at your own pace" actually requires; without it, pace belongs to whoever holds the
  admin login.

The two jobs get different lifetimes, because they carry different risk. The credential step is
**short-lived and single-use**; the progress page is **longer-lived but revocable**, and carries
counts and states rather than content, which is what makes the longer window acceptable. A grant
link expires in 1, 7 or 30 days, the owner's choice at issue (accepted 2026-09-20), and is spent
once its work is done; a progress link in 30, 90 or 180 days (workplan 0122;
`packages/ledger/src/mapping-link-store.ts`).

**The admin distributes the link. We never do.** [ADR-0032](./0032-sharing-queue-target-native-invites.md)
already decided Ownpace never mails third parties itself, and here the reason is stronger: an email
from an unfamiliar domain asking someone to authorise access to their mailbox is indistinguishable
from an attack, and training people to click it outlives the migration. The UI gives the admin a
link to copy, and the admin sends it through a channel their people already trust. Showing a
person their progress link on the page that ends their grant is not sending it: nothing is emailed
or stored (workplan 0122 T7).

**The link is per person** (the amendment of 2026-09-29; the owner: *"yes, a per-person link
instead of the per-migration links"*). A person grants their own accounts, so each gets **one grant
link and one progress link for all of their migrations**, not one per migration:

- **The grant page asks per account.** It names each Google account the person's migrations read,
  the migrations each feeds (from, to, what), and one *Sign in as …* per account. 0108 T8's binding
  holds per account: `login_hint`, the ID token's verified address, and a refusal naming both
  addresses when another account signs in.
- **A grant covers what the page showed.** The token lands (decision 4) on each migration that
  reads that account and was listed when the person pressed the button, in one transaction, with a
  `mapping.granted` row each. A migration added later asks again, because its destination is new
  to them.
- **The grant link is spent when every account on it is granted**; until then it stays live within
  its expiry.
- **The progress page is the person's**: every migration of theirs, with *Take my grant back* per
  account, revoked at Google once and cleared from every migration holding the token.
- **The live-link limit counts a person's grant link once.**
- **It is a managed row of its own**, `person_link` (managed migration 0034), shaped like the
  ledger's `mapping_link` (hashed secret, purpose, expiry, used, revoked, a link that sees only
  itself), because `person` is managed-only
  ([ADR-0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md)). The appliance
  has one implicit person and no grant links.

**Built** (workplan 0153 T5 (b), slices 1–2): the row, the owner's doors
`POST`/`GET`/`DELETE /api/people/:personId/links` (owner or admin), the grant page, its ending and
the limit (`apps/api/src/routes/a-link-for-a-person.unit.test.ts`,
`apps/api/src/routes/migrations/link-routes.unit.test.ts`). **Not built** (slices 3–4): the
person's progress link and page — issuing one is refused — and the owner's screens. Meanwhile each
migration's own grant and progress links are issued and honoured as before; what becomes of them is
proposed, not decided (*Pending* below).

**Taking a grant back** (0108 T8 (c)). From the progress page the person withdraws access: revoked
at Google where Google will, deleted here whatever Google answers, and they are told which (the
owner, 2026-09-23). Until they grant again nothing reads that account for that migration, on any
credential, the organisation's own included (the owner, 2026-09-24: *"yes, the cautious
option"*). `apps/api/src/routes/withdraw-grant.ts`, ledger migration 0063.

**Reporting a link** (0108 T8 (d)). The holder can report a link from the grant or progress page,
with no account. It goes to the Ownpace team, as a ticket on its helpdesk or, where there is none,
one mail to its support mailbox (the owner, 2026-09-28; `apps/api/src/services/report-channel.ts`),
never to the organisation that asked, and is not offered where neither is set up. A reply address
is optional (the owner, 2026-09-24); a ticket without one cannot be answered.

### 3. Three credential categories — because the promise is not uniform

"Only the person holds their credential" is **not achievable for every provider**. From
`sourceCredentialRecord` (`apps/api/src/routes/migrations/index.ts`), for the kinds there were
when this was decided:

| Category | Providers | What is stored | Can the organisation read this person's data? |
|---|---|---|---|
| **A — person-held** | Google per-user, Dropbox | `{clientId, clientSecret, refreshToken}` | **No.** The refresh token is minted by their own consent. |
| **B — person-supplied** | `imap`, and the targets | `{username, password}` | Not from us — the admin never sees it back. But it is a reusable password we hold, not a scoped token. |
| **C — organisation-held by the provider's design** | **Box** `{clientId, clientSecret}` (CCG, subject in config); **`oauth2`/`graph`** `{username, tenantId, clientId, clientSecret}` (app-only, reads `/users/{mailbox}`); **Google DWD** `{serviceAccountKey, subject}` | the organisation's app credential | **Yes, by construction.** No link changes this. |

Category C is not a gap to close. Box has no per-user consent step: it rotates refresh tokens on
every use, so the Client Credentials Grant is used and the config names whose files it reads
(`packages/shared/src/config.ts`). Whoever holds the organisation's Box app credentials can read a
migrator's Box files; that is Box's design, not ours.

So **the category is recorded per mapping and stated in plain words**, on the migrator's own page
and on the admin's board: for A, "only you can authorise this"; for C, "your organisation's Box
app can read this account." That is ADR-0033's discipline — the tool "must be honest about what
cannot be narrowed" — one level down. **The link stays universal and only its meaning changes:**
for category C it is not a consent but a notice that this is happening, plus their progress page.

### 4. Credentials need a per-mapping home

`secret_ref` was on `connection` and `backup_target`, not on `mailbox_mapping`, so a category-A
Google source kept **the organisation's app secret and the person's token in one encrypted blob**.
They separate: the app credential belongs to the connection, the person's token to their
migration. `mailbox_mapping` carries a nullable `source_secret_ref` (ledger migration 0032), and
`buildDepsFromMapping` merges it over the connection's credentials, key by key
(`packages/orchestration/src/build-deps-from-mapping.ts`). It is deliberately the shape of
`source_config_override` (migration 0021) — one nullable column, a key-by-key preference, NULL
meaning "use the connection's" — because the config split and the credential split are the same
split. A person's grant writes the same token to each migration it covers.

### 5. What an admin may see, and the one thing they may not

The progress board is **almost free**: RLS scopes every table by `app.current_tenant`,
`mailbox_mapping` carries per-person status, counts and timings, and migrators have no session to
isolate. **An admin signs in and sees their tenant.**

The exception is **`lastError`**. It is surfaced verbatim by design (SAD §11.2), and connectors are
asked only not to embed **secrets** in it — secrets, not *data*. Mail and file connectors put
folder and file names in errors, so a verbatim `SELECT "Personal/Divorce lawyer" failed` on a
parent's dashboard is a content leak. So **the migrator's own page shows the verbatim error** —
hard rule 9 survives where it can be acted on, by the person holding the credential — and **the
admin's board shows a classified error**: a category and a suggested action, and, when the
classifier does not recognise something, a sentence saying to ask the person, never the string.
The admin's capability set in one line: **see, and nudge — never act on someone's behalf.** They
see who is stuck and on what class of problem, and re-issue a link; they cannot fix it, because
they cannot hold the credential. That support burden is accepted knowingly.

**Built otherwise, and open.** The progress page shows a failure's category and never the
provider's text, holding to decision 2's counts and states (`packages/shared/src/migration-view.ts`,
workplan 0122); the failure queue shows the category's remedy with the verbatim `lastError` beneath
it (`apps/web/src/pages/Failures.tsx`, workplan 0110 T3). Workplan 0137 records the admin's half as
a choice between two recorded decisions, left for a later plan.

### 6. There are no seats, and this ADR must not invent one

The owner asked for the seat question to be answered here. **Nothing counts people**: ADR-0014
bills a tier on paths at the same time and data moved, and a person is never billed (ADR-0050). So
**issuing a link is free, and adding a `tenant_member` is free.** A migrator costs nothing to
*exist*; their paths and data count when they migrate, as everyone's do.

This is a decision, not an omission, because the obvious "improvement" is harmful: **per-migrator
pricing would penalise the private option.** A customer charged per link has a reason to switch to a
category-C credential — one Box app or one DWD key for everyone — which is the arrangement where the
organisation *can* read everyone's mail. A cost-recovery product must not build an incentive that
argues against its own security model. Seat pricing would need its own ADR **amending ADR-0014**,
because it departs from cost recovery. And a pricing change is a per-customer agreement, never a
config edit: agreed prices are pinned per tenant (`tenant_pricing`, managed migration 0001).

### 7. What this restates in ADR-0034

**Decision 6 holds, and its bound holds — because a link is not a login.** ADR-0034 requires an
admin login and a session before credential-editing routes reach an Organisation deployment,
bounded to "not per-user identity, not RBAC, not per-migrator scoping". Every word survives.
Migrators authenticate to **their own provider**, not to Ownpace; they hold a signed link, not a
session; there is no user record, password or role for them. The thousand logins never happen.

Decision 6 gains one sentence rather than a reversal: its admin login is the boundary in front of
the **operator** surface, and the link is a separate, narrower boundary in front of exactly the
migrations it names — one mapping, or one person's. Two boundaries, different shapes, neither one
RBAC. SAD §7.3's `Auth` row still reads `local / single-user` for self-host; it changes to "admin
login + session", not to a user directory.

### 8. What does not change

- **ADR-0033 is not retracted.** DWD stays for departed staff, shared mailboxes and people who will
  not engage. It stops being the default for a cooperative tenant, because the transport problem
  that justified it is gone.
- **Hard rule 5.** Both editions run the same core: one identity model, the admin login optional on
  Personal (loopback, one person, their own machine) and mandatory anywhere bound off loopback.
- **Managed's existing auth.** Zitadel (ADR-0042), the JWT boundary and `tenant_member` stay as they
  are. This ADR adds the link and the per-mapping credential; it does not re-do sign-in.

## Consequences

**Easier.** The migrator never has an account: a parent sends their child a link, and nobody
registers for the household migration tool. The design is one experience in all three
deployments. The admin's board is close to free because RLS does the scoping, and ADR-0034's
hardest machinery — per-object provenance, collision refusals, adopt-or-delete — is largely
unnecessary once configuration has an owner to point at.

**Harder.** A link is a bearer credential: expiry, revocation, re-issue, and a support path for "my
link says invalid". The per-mapping credential is a schema change and a preference rule. Error
classification is new work that did not exist when every reader was an operator.

**Riskier, and named.** A link that lands on a **password form** is shaped exactly like phishing,
and category B is where most self-host deployments will live. The page on the organisation's own
host, an announcement out of band, and app-specific passwords where offered reduce it; they do not
remove it. It is the sharpest edge here. As built, a grant link asks Google only
(`source_not_google` in `grant-link-readiness.ts`), so no link lands on a password form yet.

**An honest limit on Managed.** We hold the encrypted tokens; the customer's admin does not. The
promise is "your admin cannot read this", never "nobody can" — we operate the service. On
self-host the customer's own machine holds them, and the promise is stronger. Say so to customers.

**Still open (2026-10-03).** A person's progress link and the owner's screens for a person's link
(0153 T5 (b), slices 3–4); start and pause on the progress page (0122 T8); decision 5 as decided;
SAD §7.3's row; links outside managed — the grant and progress pages are managed-only
(`apps/web/src/AppRoutes.tsx`); and the *Pending* proposals.

## Alternatives considered

**An account for every migrated person.** The literal reading of "everyone logs in". Rejected: it
reverses the owner's "not a thousand interactive logins", and buys nothing the link does not —
migrators authenticate to their *provider*, so an Ownpace password is a second credential guarding
a page of counts — while dragging in registration, password reset, sessions and support for people
who interact with us about twice.

**Keep organisation-held credentials and let the admin do everything.** The model before this ADR,
and the cheapest. Rejected by the owner's decision; it is also the arrangement where a stolen
appliance yields every mailbox rather than the endpoints.

**We email the links.** Better admin ergonomics — forty links is forty copy-pastes. Rejected on
ADR-0032's precedent and because the trust problem is fatal: the message that matters must arrive
from someone the recipient already trusts. A per-person copy-link and a bulk export is the
compromise; if the friction proves real, the fix is better distribution ergonomics, never us
becoming the sender.

**Charge per migrator.** Rejected in decision 6: it would price customers away from the private
option and depart from ADR-0014 without saying so.

**A link per migration as the person's interface** (the shape until 2026-09-29). Rejected by the
owner: a walk of *Start a migration* (0153 T4, #1386) sent Anna, one Google account going to Soverin
and to a Nextcloud, two links to grant the same account twice. A person grants their own accounts,
so the link is the person's — the *"per-person copy-link"* the alternative above already named.

**A person's link in the ledger's `mapping_link`.** Rejected: the shared ledger every appliance
applies cannot point at the managed-only `person` (ADR-0036), so the person's link is a managed row
of its own, shaped like `mapping_link`.

## Pending — what becomes of the per-migration link, and *start when granted* (proposed 2026-09-29, not in force)

**Status: proposed, for the owner's word.** Until it is accepted, each migration's own grant and
progress links are issued and honoured as before, and *Start* on a migration that waits for a grant
is refused with `awaiting_grant` (`apps/api/src/routes/migrations/index.ts`). Its text, word for word
from the amendment of 2026-09-29:

**Decided by the owner, asked whether *Start a migration* should give one link per person:**
*"yes, a per-person link instead of the per-migration links. Perhapse replace it, or do we still
need the per-migration-link?"* The first sentence is the decision. The question after it is
answered below as a recommendation, marked **(proposed)** where it waits for the owner's word.

### What the question after the decision is answered with (proposed)

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

### One more choice for the owner (proposed)

**Start when granted.** Today nothing starts when a grant lands (`grant-ending.ts`), and *Start*
is refused with `awaiting_grant` until then, so the person starting the migrations must come
back. Proposed: *Start* on a migration that waits for a grant is accepted and recorded, and the
migration starts itself when its grant lands, with the audit row saying so. It stays the owner's
Start (decision 2's *"their own start and pause"* is the progress page's, and unchanged).

**When it is accepted** (ADR-0051): fold it into decision 2 and the operative rules, remove the
*Pending* bullet and this section, and give the acceptance a line in the amendment log below.

## Amendment log

- **2026-08-17** — Decided by the owner in conversation, recorded as Proposed: only the migrated
  person holds their own source credential, never the organisation; migrated people get links, not
  accounts; an admin sees the progress of everyone in their family or organisation; the seat
  question is answered inside this ADR. Record: the *Status* entry, *Decision* 1–8.
- **2026-08-19** — Restated by the owner: *"owners login, and owner decides who gets a link to
  manage and grant their migration."* The owner is the only party who signs in, and the link is how
  the migrated person grants. Not taken as the formal accept. Record: the *Status* entry.
- **2026-09-20** — Accepted (owner: "yes on all 3", closing workplan 0108's review); the 1/7/30-day
  link expiry presets stand. Record: the *Status* entry.
- **2026-09-24** — The migrated person can take their grant back from their progress page, and
  nothing then reads that account on any credential (the owner, 2026-09-23 and 2026-09-24; built by
  0108 T8 (c)). Record: *Operative rules*, sixth bullet.
- **2026-09-24** — A link can be reported from its grant or progress page, never to the organisation
  that asked; a reply address is optional (the owner, 2026-09-24; built by 0108 T8 (d)). Record:
  *Operative rules*, seventh bullet.
- **2026-09-29** — The amendment of 2026-09-29: the link is per person (owner: *"yes, a per-person
  link instead of the per-migration links"*; workplan 0153 T5 (b)). What becomes of the
  per-migration link, and *start when granted*, were proposed and are not accepted: *Pending*,
  above. Record: *Amendment 2026-09-29 — the link is per person (workplan 0153 T5 (b))*.
- **2026-10-03** — Consolidated in place (ADR-0051). Nothing was decided by the consolidation. Where
  the record and the code differ, the Decision says what is built: a report also goes by mail where
  there is no helpdesk (the owner, 2026-09-28, in `report-channel.ts` and workplan 0108); decision
  5's error split; links on managed only.

The full record, word for word as it read before this consolidation:
[history/0035-who-signs-in-and-who-gets-a-link.md](./history/0035-who-signs-in-and-who-gets-a-link.md).
