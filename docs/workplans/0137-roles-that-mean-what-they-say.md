# Workplan 0137 — Roles that mean what they say

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found that a
person with the role *viewer* in an organisation can delete a migration, replace the target's
credentials, prepare a cutover and, once the owner has allowed deletions, apply them. The owner
asked *"Explain risk and advice. Are permissions not implemented?"* and, on who may do what,
answered *"I am the gate for letting people in the test."* (§2).

The short answer to the question: permissions are implemented as a mechanism and only partly
applied. The four roles exist in the database. The middleware that refuses a role exists
(`requireRole`). It is applied route by route, and 22 of the 58 write routes a signed-in member
can reach carry it. The other 36, which include creating, changing and deleting a migration or a
connection, check only that the caller belongs to the organisation (§1). §4 explains when that
matters and gives the advice for the alpha.

Two pieces are built, both in the consistency PR, #1137, which merged on 2026-09-24: the invite
route refuses an admin who invites somebody as owner (T3 (a)), and `docs/grant-links.md` points a
person who wants to watch progress to the view link, the product's progress link. Nothing else is
built. 0131 T5 carries this plan's minimum for the first invitation.

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137
merged.** T3 (a) is done: on `main` an admin's owner invitation answers 403 and writes no row.
Testers use `ownpace-live`, a fresh stack without the demo (0132 T1b), so T7's check for existing
`member` and `viewer` rows is made there, and an invitee's verification code comes from live's own
catcher until 0133's relay exists.

| Task | Status | Notes |
|---|---|---|
| T0 The alpha rule for a second person in a tester's organisation | ⏳ **Owner** | §4 and open question 1. Recommended: testers add nobody and share progress links, and T7 keeps the product from offering a role that promises less than it allows. |
| T1 The role matrix, written down | 📋 **Proposed** (D1, D2) | §3. An amendment to ADR-0035: which acts are owner only, owner and admin, or open to every role, and what a member may do that a viewer may not. |
| T2 Every write route names its roles, and a guard fails when one does not | 📋 **Proposed** (D2) | §3. Named role constants on 34 of the 36 ungated writes, and an allowlist with reasons for the other two; a route-table guard in `scripts/` that fails today. |
| T3 The owner role is guarded on every door | 📋 **Proposed**; (a) the invite half ✅ **done** in #1137, merged 2026-09-24 | §3. An admin cannot invite as owner (done). The last-owner guard counts active owners only, in one transaction. An admin cannot demote or remove an owner (with T1). |
| T4 Who deleted it, who replaced the password, who prepared the cutover | 📋 **Proposed** | §3. An `audit_log` row with the actor for deleting a migration or a connection, replacing credentials, and preparing a cutover. |
| T5 The web app shows a viewer no button it cannot press | 📋 **Proposed**, after T2 | §3. One table in the web app that mirrors T1, checked against the API's. |
| T6 A viewer and a member are refused, and a test says so | 📋 **Proposed**, with T2 | §3. 403 cases for every gated write, driven by T2's table; the migrations suite stops asserting that a member may delete. |
| T7 Until T2 lands: nobody is invited or moved below admin | 📋 **Proposed**, advised before the first invitation (T0) | §3. The invite and role-change routes and the Team page offer owner and admin only. T2's PR undoes it. |

## 1. What there is today

Each fact below was checked on 2026-09-24 at the current checkout. The route table was checked
again at `main` after #1137 merged: #1137 changed the invite handler (*The owner role*, below)
and no route or its middleware. This plan concerns the managed edition only: the appliance has
one operator, and `apps/selfhost` reads no role.

**The roles exist.** `tenant_member.role` is constrained to `owner`, `admin`, `member` and
`viewer` by `tenant_member_role_check` in
`packages/managed/migrations/0001_the_managed_service.sql`, and `schema-managed.ts` declares the
same four. A new row defaults to `member`.

**The role is a database fact.** `authenticate` in `apps/api/src/middleware/auth.ts` looks up the
caller's **active** `tenant_member` row and sets `role = membership.role` from it. Outside `dev`
mode, a role claim in the token is not used. Row-level security keeps each organisation to its
own rows (`docs/rls-guide.md`). No policy reads the role, so inside one organisation it draws no
line between members. That is where this plan works.

**The refusal exists.** `requireRole(...allowedRoles)` in the same file answers 401 without a
user and 403 when the role is not in the list. It has no default by method, and nothing applies
it globally: `apps/api/src/index.ts` applies only `helmet`, `cors`, the access log and the body
parsers to every request, and mounts each router with a plain `app.use('<path>', router)`.
`routes/migrations/index.ts` mounts the operating, OAuth and link routers with a plain
`router.use('/', …)`.

**Where it is applied.** There are 125 routes under `apps/api/src/routes`, 68 of them writes
(POST, PUT, PATCH, DELETE). The count is from each file's `router.<method>(` calls with their
middleware, cross-checked against a plain grep, which found one more hit, and that one is inside
a comment.

- **10 writes are not reached with a member's session**, so roles do not apply to them: the
  operator's routes under `authenticateSubject` (`platform-pause` ×2, `support` ×1, access-request
  grant and decline), an invitation's accept and decline by the invited person, the grant link's
  consent (`grant.ts`, link bearer), the public access request, and the Mollie webhook.
- **22 writes carry a role.** Billing's seven writes (`requireBillingWrite`, and
  `requireBillingRead` on `POST /estimate`), the decisions queue (3), links (2, `MAY_ISSUE`),
  organisation settings and closing (6: three owner/admin, three owner only), members (3), and one
  operating route: arming deletions (`PATCH /:mappingId/apply-deletions`, owner only). Every one
  names `owner`, `admin` or both, so the API treats `member` and `viewer` the same everywhere.
- **36 writes carry `authenticate` and nothing else**:
  - migrations (12): create, change (`PUT`), delete, start, sync, discover, add a data type
    (`/domains`), prepare a cutover (`/cutover`), and four probes (`/test-connection`, Google
    shared drives and folders, Dropbox shared folders);
  - operating routes (14): the five sharing writes (rescan, decide, apply all, apply a folder,
    announce), keeping a deletion or a move, the two failure actions, finish (including
    `?force=true` over unresolved failures), verification, applying a deletion, applying a move,
    and the confirmation pass;
  - connections (4): create, test, replace credentials (`PUT /:id/credentials`), delete;
  - consent (3): Google, Dropbox and Microsoft `…/authorize`;
  - one each for the setup checklist (`PUT /api/setup/…`), the problem report, and
    `POST /api/tenants`, which always answers 501.

None of those 36 handlers reads `req.userRole`. In `apps/api/src/routes` the role is read in a
handler only by the members route, for the owner grant.

**Reads.** 35 GET routes are reached with a member's session. Billing's six are owner and admin
only. The other 29 are open to every role, which is what ADR-0035 §5 decides: *"An admin signs in
and sees their tenant"*.

**The code says it meant otherwise.** `link-routes.ts` explains `MAY_ISSUE`: *"the same two roles
that may change the migration itself … never a viewer's."* The Team page tells a member or viewer
*"Your role here is read-only. An owner or admin manages members."* (`tenants.readOnly`), and the
Dutch label for a viewer is *"Kijker"*.

**A test asserts the gap.** `migrations.integration.test.ts` seeds its user as `member` and
expects `200` for a change and a delete, and `202` for a cutover preparation. Refusals of a
viewer or member are tested for billing, links, the deletion flag, decisions, members and
organisation settings. They are not tested for connections, migrations or the other operating
routes, and no guard checks the route table.

**What a second person can do today, whatever their role:**

- **Delete a migration.** `DELETE /api/migrations/:mappingId` removes the row, and the ledger's
  items, verification runs and apply receipts go with it by cascade (ledger migrations 0001 and
  0042). The copies at the target stay. What outlives it is the `audit_log` rows already written
  and the metered run rows, whose mapping is set to null (`run_mapping_id_fkey`). Nothing records
  who deleted it: the handler writes no audit row.
- **Replace a connection's credentials.** `PUT /api/connections/:id/credentials` keeps the
  connection's server (*"The CONFIG is deliberately left alone"*) and replaces the account: for a
  target, `{ username, password }`. The new account is probed and, if the probe passes, stored.
  Every migration on that connection then writes into the new account. The route handles a source
  the same way. The only audit row is `connection.qualified`, with the actor, written by
  `qualifyAndRemember` for every kind that has a qualifier. That includes every target kind:
  `nextcloud`, `webdav`, `imap` and `jmap` are in `QUALIFIABLE_KINDS`. (The review said the row is
  written only for Microsoft, Dropbox and archive connections; that part did not hold.) The row
  records what the new account can carry, not that the account was replaced, and a plain Test
  press (`POST /api/connections/:id/test`) writes the same row.
- **Prepare a cutover.** `POST /api/migrations/:mappingId/cutover` enqueues the final sync and the
  gate. Pressed on an approved cutover, it revokes the approval. It does not execute a cutover:
  approve and execute are the operator's command-line steps (0128 §1).
- **Apply deletions and moves** once the owner has armed the flag: `POST …/deletions/:hash/apply`
  and `…/moves/:hash/apply` remove an item from the target. The flag is owner only; each item's
  removal is not. These two routes do write an audit row with the actor (0042).
- **Mail people outside the organisation.** Sharing's *apply all* creates the shares, which makes
  the target notify each grantee, and *announce* sends a digest to each grantee of a share made
  by hand.
- **Start, finish, force-finish, add a data type.** Start and finish record the actor
  (`recordMappingStatusChange`). Start and a new data type take a slot, and billing reads the
  slots. Nothing is charged during the alpha (0131 D1), so this costs nothing today.

**Who can create that second person.** Only an owner or an admin can invite
(`requireRole('owner', 'admin')` on `POST /api/tenants/:tenantId/members`). The form defaults to
`member`, and no mail goes out (*"No email yet; tell them yourself"*). The invitee signs in at the
identity provider, which accepts self-registration (`allowRegister: true`, 0135 §1), and accepts
the invitation for their verified address (`acceptInvitation`). None of this passes through the
access queue. Until mail leaves the machine (0133), an invitee who registers with an email address
needs the identity provider's verification code, which lands in a catcher the owner reads: for
testers, `ownpace-live`'s own, never the OTA stack's (0133 T1). So for now the owner would pass
that code on. That is relaying mail, not deciding a role, and it
ends with 0133. What a sign-in through Google does here is not established (0133 §1).

**The owner role.**

- Until #1137, `POST …/members` accepted `role: 'owner'` from an admin, and acceptance keeps the
  invited role, while the PATCH route refused the same grant (`grantsOwnerWithoutPermission`).
  The Team page disables the owner option for an admin, so it took a direct API call. Fixed
  in #1137, merged 2026-09-24: the invite route applies the same check before it touches the
  database and answers 403.
- The last-owner guards (`demotesLastOwner`, `removesLastOwner`) count every owner row. The count
  in `members.ts` filters on the organisation and the role, not on the status, so an invited or a
  declined owner row counts. The operator's script already counts only active owners
  (`other_owners` in `apps/api/src/scripts/operator.ts`). The count and the write are separate
  transactions.
- Neither PATCH nor DELETE compares the caller's role with the target's. An admin may demote or
  remove an owner whenever the count reads two or more.

Together: an organisation can be left with no active owner, and the owner-only routes can then
only be reached through the database.

**What the web app hides.** Only the billing link (`Layout.tsx`), `Billing.tsx`, `Tenants.tsx`
and `Decisions.tsx` read the role. Delete on the migrations list (`Mappings.tsx`), remove and
replace on `Connections.tsx`, and the controls on deletions, moves, failures, sharing, finish,
verify and the wizard are shown to every role.

**What the review found that this plan does not take on, and why.**

- The review's claim that household members see each other's item names *"contrary to ADR-0035
  §5"* was only partly confirmed. ADR-0035 decides that people being migrated get links, not
  accounts, and that signed-in members see the whole organisation. What survives is narrower:
  §5 says *"The admin's board shows a classified error"*, and the failures page shows the verbatim
  error under the category, as 0110 T3 chose. See *Not in this plan*.
- The privacy policy does not say who in an organisation sees which migration data, and §4.2
  leaves out display names and stored error text. That was partly confirmed, and it goes to 0139.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words, then the answer as given, typos included. Where
an answer needed a reading, the reading is stated.

**D1 — who is let in.** *What may a member and a viewer do, and should only owners and admins
invite?* — *"I am the gate for letting people in the test."* *A tester stack separate from CI and
the nightly gate, reachable from the internet?* — *"Yes, but its a controlled rest. I Let people
in and support them. Max 10/20 people"* ("rest" is read as "test"). *The Google client is in
Testing, so tokens expire after about seven days* — *"I add people, controlled small test
Group."*

The tester stack is `ownpace-live`, beside the OTA stack, on the production names (0132 D-new).
So the owner decides which organisations exist in the alpha, one access request at a time (0131
D2). The answer does not say what a second person inside a tester's organisation may do, and the
product does not route that person through the owner (§1). §4 explains the gap, and T0 asks the
owner to close it.

**D2 — an explanation, then advice.** *Roles do not restrict writes: a viewer can delete and
change migrations. What should happen?* — *"Explain risk and advice. Are permissions not
implemented?"* The answer is in the status block and §1, the risk and the advice in §4. The
advice waits on the owner (T0, open questions 1 to 3).

**D3 — the alpha is small, free and Dutch.** *What is the test: free or paid, for how many
people, how long, in which language?* — *"Free and invite only. 10 to 20 people max. Dutch."* So
every new sentence in this plan (T5's and T7's refusals, the role descriptions) is written in
Dutch and English. And since nothing is charged, the part of the risk that is about cost (start,
a new data type) waits for the end of the alpha.

## 3. What each task does

### T0 — the alpha rule for a second person (owner)

The owner chooses one of the options in open question 1, and the alpha conditions (0139) carry
the sentence. A draft, Dutch first:

- NL: *"Nodig tijdens de alpha niemand anders uit in uw organisatie. Wil iemand een migratie
  volgen, stuur dan de voortgangslink van die migratie: die toont aantallen en status, nooit de
  inhoud. Nodigt u toch iemand uit, doe dat dan als beheerder, en weet dat een beheerder alles kan
  wat u kunt, behalve de organisatie sluiten of verwijderen, verwijderingen toestaan en iemand
  eigenaar maken."*
- EN: *"During the alpha, do not invite anyone else into your organisation. If somebody wants to
  follow a migration, send them that migration's progress link: it shows counts and states, never
  content. If you do invite someone, invite them as an admin, and know that an admin can do
  everything you can except close or delete the organisation, allow deletions and make somebody
  an owner."*

"Voortgangslink" and "progress link" are the product's own words (`viewLink.title`:
*"Voortgangslinks"*, *"Progress links"*). The progress link is 0122's: `GET /api/view/:link`
answers with counts and states, and never with the provider's error text. It is issued from the
migration's page by an owner or admin.

### T1 — the role matrix, written down

An amendment to ADR-0035 (`## Amendment, <date>: what each role may do`), plus an operative-rule
bullet amended in place and `OPERATIVE.md` regenerated with
`node scripts/adr-operative.mjs --write`. It defines what ADR-0035 §1 only names: *"`member` to
mean a person who can sign in with limited rights"*. The README index row for ADR-0035 says it
was amended.

The proposal, for the owner to confirm or change (open questions 2 and 3):

| Act | Routes (under `/api`) | Today | Proposed |
|---|---|---|---|
| Close, reopen or delete the organisation | `tenants/:id` DELETE, `…/close`, `…/reopen` | owner | owner |
| Allow deletions on a migration | `PATCH migrations/:id/apply-deletions` | owner | owner |
| Grant the owner role; change or remove an owner | members POST, PATCH, DELETE | owner for a PATCH grant only | owner (T3) |
| Remove from the target | `…/deletions/:hash/apply`, `…/moves/:hash/apply` | every role, once allowed | owner |
| End a migration over unresolved failures | `…/finish?force=true` | every role | owner |
| Delete a migration | `DELETE migrations/:id` | every role | owner |
| Change a migration | `POST migrations`, `PUT …/:id`, `…/start`, `…/domains`, `…/cutover`, `…/finish` | every role | owner, admin |
| Connections and consent | `connections` POST, `…/:id/test`, `…/:id/credentials`, DELETE; the three `…/authorize`; the four probes | every role | owner, admin |
| Sharing | `…/sharing/rescan`, `…/:grantId/decision`, `…/apply-all`, `…/apply-folder`, `…/announce` | every role | owner, admin |
| Decide about an item | keep a deletion or a move, accept a failure for good (one item, or a group through `POST …/failures`) | every role | owner, admin |
| Check and keep going | `…/sync`, `…/discover`, `…/verify/start`, `…/confirm`, retry a failure (one or a group), `PUT setup/…` | every role | owner, admin, and member (open question 2) |
| Links, decisions, organisation settings, members, billing | as today | owner, admin | owner, admin |
| Report a problem | `POST problem-reports` | every role | every role |
| Read | every GET except billing's six | every role | every role |
| Create an organisation | `POST tenants` | answers 501 | on the guard's allowlist, with its reason |

Three routes carry a lighter and a heavier act: `finish` with and without `force`, and both
failure routes, `failures/:hash/:action` and the group action `POST …/failures`, each with
`retry` and `accept`. For those, the heavier half is checked in the handler, with the same
helper, and T6 tests both halves.

The matrix also narrows who can make the server reach a host that somebody typed. The probes and
the connection test become owner and admin only. That is not a fix for 0136, only a smaller set of
people who can trigger it.

### T2 — every write route names its roles

**The constants.** In `apps/api/src/middleware/auth.ts`, or a small module beside it, one named
constant per row group of T1: for example `ownerOnly`, `operates` (owner, admin) and `keepsGoing`
(owner, admin, and member if the answer to open question 2 is (b)), each `requireRole(...)`.
Billing's `requireBillingWrite` and links' `MAY_ISSUE` become aliases or stay, as long as the
guard knows them. Each of the 36 routes in §1 gets the constant its row names, after
`authenticate`, except the two the guard allowlists below.

**The guard.** `scripts/a-write-that-says-who-may-make-it.unit.test.ts`, in the style of
`apps/api/src/openapi-spec.unit.test.ts`, which already reads every router's routes from source
and checks its table of mounts against `index.ts`. It:

1. reads every `router.post|put|patch|delete(` under `apps/api/src/routes`, with its middleware
   up to the handler;
2. fails when a route that carries `authenticate` names none of the role constants, unless the
   route is on an allowlist with a reason (`POST /api/problem-reports`: every role may report;
   `POST /api/tenants`: 501);
3. holds T1's table as data and fails when a route's constant differs from its row, or when a
   row names a route that no longer exists;
4. checks the ADR amendment's table against the same data, as `scripts/adr-operative.unit.test.ts`
   does for operative rules, so the document cannot drift from the code.

On today's tree it fails and names the 34 routes of the 36 that are not on the allowlist. After
T2, removing any one constant turns it red. Because it is in `scripts/`,
`node scripts/lessons.mjs --write` indexes it in `docs/LESSONS.md` under the route files it
constrains, so the next person editing `connections.ts` finds the rule.

T2 and T6 are one PR: the gate without the tests is unproven, and the tests without the gate fail.

### T3 — the owner role is guarded on every door

- **(a) An admin cannot invite as owner.** ✅ Done in #1137, merged 2026-09-24: the invite
  route applies `grantsOwnerWithoutPermission` before it touches the database, and
  `members.integration.test.ts` has *"refuses an admin inviting an owner (no self-escalation)"*,
  which expects 403 and no row. The commit records that the old route answered 201.
- **(b) The last-owner guard counts active owners only.** The count adds
  `status = 'active'`, as `operator.ts` already does. The guard applies only when the target is
  itself an active owner, so an owner can still withdraw a pending owner invitation. The count
  and the write run in one `withTenantDb` transaction, with the owner rows locked
  (`SELECT … FOR UPDATE`), so two demotions at once cannot both pass. The helpers in
  `member-guards.ts` change their inputs, so their unit tests change with them.
- **(c) An admin cannot demote or remove an owner** (T1's row). One more pure helper in
  `member-guards.ts`, applied in PATCH and DELETE.

Guards, in `members.integration.test.ts`. These fail on today's tree: demoting the only active
owner while an owner invitation is pending answers 400 (today 200); the same with a declined owner
row; an admin's PATCH and DELETE on an owner answer 403 (today 200 and 204 whenever the count reads
two). One more case passes today and must keep passing: withdrawing a pending owner invitation
with one active owner answers 204. It is what stops (b) from counting too little.

The file warns today that seeding a second owner row *"would break the last-owner guard tests"*,
and the case #1137 added avoids an owner-invites-owner case for the same reason.
After (b) an invited or declined owner row no longer counts, so it no longer breaks them, and the
suite should prove that with an owner-invites-owner case beside the last-owner cases.

### T4 — who deleted it, who replaced the password, who prepared the cutover

An `audit_log` row, with `actor = req.userId`, written in the same transaction as the act:

| Act | Action | Detail |
|---|---|---|
| Delete a migration | `mapping.deleted` | the mapping id (as `mappingId`) and its status before |
| Replace a connection's credentials | `connection.credentials_replaced` | connection id, side, kind, and whether the new account was stored |
| Delete a connection | `connection.deleted` | connection id, side, kind |
| Prepare a cutover | `cutover.preparation_requested` | the mapping id (as `mappingId`), the run id, and whether it revoked an approval |

No address, user name or password goes in `detail`. The mapping id goes under `mappingId`,
because that is the key the operator's log view (`support_log`, managed migration 0025) reads to
link a row to its migration. `audit_log` has no foreign key to the mapping and is not pruned
(0042's own reasoning), so the delete row outlives the cascade it describes. The operator's log
page shows the actor and the action (0129 T2), so *"who deleted my migration"* can be answered
without a database query.

Proposed with it, for the owner to confirm (open question 4): the same for membership:
`member.invited`, `member.role_changed`, `member.removed`.

Guard: one integration case per act, in the suites that already drive those routes
(`migrations.integration.test.ts`, `connection-delete-revokes.integration.test.ts` and the
connections suites), each asserting exactly one row with the action and the caller's subject as
actor. Each finds zero rows today.

### T5 — the web app shows a viewer no button it cannot press

One table in the web app, `can(act, role)`, with the rows of T1, used by every page with a
write control: Mappings (delete), Connections (remove, replace), CreateMapping, Deletions, Moves,
Failures, Sharing, Finish, Verify and the migration page's controls. A control the role may not
use is not shown. Where a whole panel would be empty, one sentence says who can act, in Dutch and
English. The server's refusal still renders verbatim if a control slips through. The table does
not replace T2.

The role comes from `GET /api/me` (`apps/api/src/routes/me.ts`), which reads the caller's active
memberships. The web app takes it through `apps/web/src/services/session.ts`, as the Team and
Billing pages already do.

Guard: a web unit test that renders each page as a viewer and finds none of the write controls
(it fails today on `Mappings.tsx` and `Connections.tsx`), and a test that compares `can()`'s table
with T2's data by reading the API's file as text. The web app does not import the API.

### T6 — a viewer and a member are refused, and a test says so

A table-driven integration suite over T2's data. For every write that is not open to every role,
a request as `viewer` answers 403 and leaves the database as it was, and so does one as
`member`, except on the member rows. One allowed role is shown to succeed. A route added to T2's
table is covered without a new test.

`migrations.integration.test.ts` seeds its user as `owner`, and keeps one `member` case that now
expects 403 for delete. `docs/rls-guide.md`, which cites only *"the apply-flag suite proves
role-from-row"*, names the new suite.

### T7 — until T2 lands: nobody is invited or moved below admin

The stopgap, if the first invitation goes out before T2 and T6 are merged.

- `InviteMemberSchema` and `UpdateMemberRoleSchema` in `members.ts` accept `owner` and `admin`.
  Anything else is a 400 with one sentence: *"Tijdens de alpha kan iemand alleen eigenaar of
  beheerder zijn."* / *"During the alpha, a person can only be an owner or an admin."*
- The Team page offers owner and admin, defaults to admin, and says in one line what an admin can
  do.
- Rows that already hold `member` or `viewer` are listed before the first invitation, on
  `ownpace-live`. It is a fresh stack brought up without the demo (0132 T1b, T5), so there should
  be none.

Guard: an owner inviting a `viewer` gets 400 and no row (today 201), and a web test finds no
`viewer` or `member` option in the role select. T2's PR widens the schemas again and replaces
these tests with T6's.

## 4. Explaining the risk (D2)

**When it matters.** Only when a tester's organisation has a second signed-in person. A tester
who invites nobody is the organisation's only member, and as its owner may do everything anyway.
Nothing here reaches across organisations: row-level security keeps each organisation to its own
rows, and the role comes from the database, not the token (§1).

**What the second person can do, whatever role they were given.** Everything in §1's list. The
two that matter most:

- **Replace the target's credentials.** Suppose a family migrates to its own Nextcloud, and the
  second person has an account on the same server. They replace the target connection's user
  name and password with their own. The probe passes, because it is a real account on the same
  server. From the next pass on, the migrated person's files, calendars and contacts are copied
  into the second person's account. The audit log gains one `connection.qualified` row with the
  second person as actor, the same row a Test press writes, and nothing in it says the account
  changed. The migration looks healthy.
- **Delete a migration.** The migration, its ledger and its apply receipts are gone. The copies
  already at the target stay, but the record of what was copied and what was decided goes with the
  ledger. Nobody can see who did it.

Preparing a cutover can revoke an approval but cannot switch a mail domain, because execution is
the operator's step. Applying a deletion needs the owner to have allowed deletions first. Start
and a new data type would cost money, but not during the alpha.

**Why the role name makes it worse.** The Team page offers *Kijker* (viewer), says a member or
viewer's role is *"alleen-lezen"*, and defaults an invitation to *Lid* (member). A tester who
picks "viewer" for a family member believes they gave read-only access. They gave the power to
repoint the target.

**Why "I am the gate" does not cover it.** The owner decides who gets an organisation. After
that, the tester invites whom they like: no mail goes out, the invitee registers at the identity
provider on their own, and accepts. The access queue never sees them. For now the owner passes on
the invitee's verification code (§1), but that is relaying mail, not deciding what the person may
do, and it stops when 0133 lands. The owner stays the gate for the alpha. The tester is the gate
for their own organisation, and today the role they choose limits almost nothing that person can
do to a migration or a connection.

**The advice.**

1. **Before the first invitation:** testers add nobody, and anyone who wants to follow a
   migration gets its progress link (T0). This is what ADR-0035 already says the product is: *"A
   family is one account and three mappings."* The progress link was built for it (0122).
2. **In the product, at the same time:** T7, so that a tester who invites somebody anyway can
   only choose a role whose name tells the truth. With T3 (a), merged in #1137, an admin cannot
   make somebody owner.
3. **During the alpha:** T1 (the owner confirms the matrix), then T2 with T6 in one PR, then T3
   (b) and (c), T4 and T5. T2's PR undoes T7.

Waiting for T2 and T6 before the first invitation is safe too, but T2 changes 34 routes and
needs the owner's matrix first. Advice 1 and 2 do not restrict an admin. What they do is leave no
role whose name promises less than it allows. A second person then exists only if a tester
chooses to give them everything except closing or deleting the organisation, allowing deletions
and making somebody owner. For at most 20 organisations, each meant to have one person, that is
enough for the alpha, at a fraction of T2's work.

## 5. Order

T0 and T7 before the first invitation; T3 (a) is already on `main` (#1137). Then T1,
because T2's constants are its rows. Then T2 and T6 together, which undo T7. T3 (b) and (c) can go
with them or right after, since they touch the same suite. T4 is independent and small. T5 goes
last, because it mirrors T2's table.

## Not in this plan

- **Which errors an owner or admin sees.** ADR-0035 §5 says the admin's board shows a classified
  error. The failures page shows the verbatim `lastError` under the category (0110 T3's choice),
  so a migrated person's folder or file name can reach the organisation's owner. In the alpha the
  owner usually is the migrated person. This is a decision between two recorded choices, not an
  access-control gap, and it is left for a later plan.
- **The privacy policy on who in an organisation sees what**, and §4.2's missing display names
  and stored error text: 0139.
- **A family member's permission for a password-type connection** (a checkbox and an audit row):
  0139, with the lawyer's pass.
- **Refusing internal hosts**: 0136. T1 only narrows who can trigger the probes.
- **Organisation roles at the identity provider.** Ownpace reads the role from `tenant_member`,
  and 0135 keeps it that way.

## Open questions

1. **The alpha rule for a second person (T0).**
   - **(a)** Testers add nobody, and progress links are for anyone who wants to watch. The
     conditions say so. The product does not enforce it.
   - **(b)** (a) and T7: if a tester invites somebody anyway, the product offers owner and admin
     only. *Recommended.* It matches 0131 T5's row for this plan.
   - **(c)** T2 and T6 are built and merged before the first invitation. Safe, and slower.
   - **(d)** No invitations at all during the alpha, so every person passes the access queue
     (0131 open question 6 (b)). Then T7 is not needed and T0's sentence is one line. Nothing in
     the code switches invitations off today, so this is a small change of its own, and it rules
     out a family or a small office trying the service together.
2. **What may a member do that a viewer may not (T1)?**
   - **(a)** Nothing. Both only read and report a problem. Then the Team page should offer one of
     the two, not both.
   - **(b)** A member may also check and keep a migration going as it is configured: sync now,
     discover, verify, confirm, retry a failed item, tick a setup step. Nothing that removes,
     repoints, takes a slot, or mails anyone. *Recommended*, because the product already shows
     two names and (b) is the smallest difference that is useful.
3. **The owner-only acts (T1).** Today: close, reopen and delete the organisation, and allow
   deletions. Proposed in addition: apply a deletion or a move, finish over unresolved failures,
   delete a migration, and change or remove an owner. *Recommended:* yes to all of them.
   Preparing a cutover stays owner and admin, since executing it is the operator's step. The
   owner may prefer owner only.
4. **Membership changes in the audit log (T4)?** Invitations, role changes and removals are not
   recorded today. *Recommended:* yes, in the same PR as T4.
