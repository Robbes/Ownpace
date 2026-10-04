# Workplan 0153 — One move per person, built from the Migrations page

> **In one line:** The Migrations page lists people: one flow (who, from where, what, to where) takes a person from one or more old accounts to a new home and creates their migrations underneath, and protocols, kinds and ids stay off screen until needed. Four faults the audit found go first.

## Status — 2026-10-04 (update this block at the end of every session)

**2026-10-04: T3 and T5 are built in full, and T4 and T1 (c) wait only for the wizard to retire.**
Read against the code with 0154's last part in (#1445, on which this lands).

- **T3, the Migrations page.** Each card's rows now have their own stage and a sentence under
  it, from the progress read (0154 T1 (b) and (d), #1422), set against what discovery found
  (0154 T2, #1420). The rest was built in #1341, #1343 and #1346: the count of what needs the
  person, *Start a migration* and *Add a migration*, the top line, the menu, the empty state,
  and a failed read said as one (`managed-ui.ui.test.ts`).
- **T5, a page per person.** Its rows are filled the same way. Its steps are one list with
  counts (0154 T4), and its links are the person's (T5 (b), four slices), with start when
  granted.
- **T4's screen 6 says how long before Start.** `MigrationCountSection`, which *Start a
  migration* draws once per migration, shows 0154 T3 (a)'s range and its reason once the count
  is in.
- **What is left is the wizard.** T4 and T1 (c) end when *Add one migration by hand* retires
  (D5). Before it can, the reachability test has to pass through the flow, and four questions
  are the owner's:
  1. how a Microsoft 365 app registration is handled;
  2. whether a Google Takeout export is offered;
  3. whether the separate Google Calendar and Google Contacts cards go;
  4. whether four settings the flow does not offer go: the folder prefix, the SSL/TLS switch,
     custom naming, and a migration's own root folder.

**2026-10-03, evening: the managed gate asks a person for the progress link (E2E (managed)
#232).** #1408 made links a person's, and `POST /api/migrations/:id/links` refuses with `409
links_are_per_person`. The gate's progress-link section still asked the migration, so #232 failed
there and nowhere else (verify done, apply applied). No pull request runs the gate.

- **The section now:**
  - adds a person of its own and puts the APPLY mapping with them;
  - issues their progress link and opens it with no session: a person's page, with their one
    migration, and nothing that names the person, the migration or the organisation;
  - shows the two purposes kept apart in the direction a DAV source allows: their progress token
    is refused at the grant address. A grant link for them is refused `nothing_to_grant`, as
    expected;
  - revokes the link and opens it again (401);
  - deletes the person, whatever happened above. That unassigns the migration and takes their
    links with them, so the run leaves no trace.
- **A person an earlier run left holding the migration is taken back** only by the section's
  own name. Anybody else's is said, and left alone.
- **Proved by `a-link-the-gate-asked-of-a-migration`** (12 cases), which runs the section
  exactly as the script has it, against a fake API. Against the old section, 11 fail. Four
  mutations of the new one are caught:
  - the person's id not banned;
  - the clean-up only on success;
  - any leftover deleted;
  - the grant address not asked.

**2026-09-29, morning: a sign-in's example goes when its box is clicked (T6, T7; the owner's
answer).** Asked whether *Username* should read *Email address* where an address is what goes
in it, the owner answered: *"stick with "Username" / "Gebruikersnaam" and fill in a grey example
hint of the formatting/syntax that goes away when clicked, like 'someone@example.com'"*.

- The label stays. The example is *someone@example.com* (Apple's *someone@icloud.com*), from the
  one descriptor every door draws (`credential-fields.ts`).
- Every box of the `.input` class, which is every sign-in box on Accounts, the wizard and
  *Start a migration*, takes its example away while it has focus, and shows it again if it is
  left empty. The search boxes elsewhere keep theirs, since there it is the instruction.
- Proved in Chromium (`managed-ui.ui.test.ts`, *a sign-in's example*): the example's colour
  before a click, transparent once clicked, and back after. Without the rule it failed on
  `expected 'rgb(100, 116, 139)' to be 'rgba(0, 0, 0, 0)'`. Eight web test files found the box by
  its old example, in 55 places, and now find it by the new one.

**2026-09-29: the wizard offers a saved Microsoft 365 or Apple account again.** On branch
`claude/funny-wright-upyuqr`; not merged. This closes the fault 0131 T1 and 0148 T9 found and
left. The wizard (*Add one migration by hand*) kept its own copy of the server's
`sourceKindFor`, `sourceKindOf`, and every type it did not list fell to `o365`. It did not list
`microsoft` (0114) or `apple` (0115). A saved account of either kind was never offered on the
source step, so the person stored it twice. A saved *Via IMAP* or *Graph* row was offered in its
place, could become the one-candidate default, and was posted as the source of a `microsoft` or
`apple` migration, which the create route's reuse check refuses.

- **The picker reads each saved row's kind back through `wizardTypeForConnectionKind`**, the
  inverse the server's round-trip test pins, as T4's *Start a migration* flow already does. A
  kind added later reads back as its own card. A card with no saved row of its kind offers
  nothing, never a wrong row. The one exception is `oauth2`: `oauth2` and `graph` both store as
  `o365`, and the inverse answers `graph`, so `oauth2` reads its rows as `graph`
  (`storedSourceType` in `CreateMapping.tsx`).
- **Proved by** `CreateMapping.reachability.unit.test.tsx`, *offers each card only the rows its
  kind stores as*. It stores one `o365`, one `microsoft` and one `apple` row, then picks each of
  the four cards. Each card must offer only its own row and start on it. Before the fix, the
  Microsoft 365 account and Apple account cases fail, each offered the `o365` row. With the
  `oauth2` case removed, *Via IMAP* fails. `vitest --project unit-browser apps/web/src/pages`
  passes 53 files (1568 tests), `tsc -p apps/web/tsconfig.json` is clean, and the `scripts`
  guards pass 212 files.

**2026-09-29, morning: T4's *Someone else*, by a grant link where one reaches (0108).**

- **Who signs in to the accounts?** *I do*, or *They do, with a link* (*Ik* / *Zij zelf, met een
  link*). The words differ from the person list's *Someone new* / *Iemand anders* (the owner's
  correction of *Iemand nieuws*), so the Dutch never offers *Iemand anders* twice with two
  meanings.
- **For somebody else:**
  - *Connect your accounts* asks only for their address where a link reaches
    (`grantableByLink`): Google's cards, through the deployment's own client, with Gmail and
    Drive only where the restricted scopes are declared. The account is saved with no
    credential, the migration reuses it, and the grant lands on the migration;
  - where no link reaches, the screen says so and they sign in together;
  - no saved account is chosen by default, since one may be the starter's own;
  - *Check, then start* offers each such migration's grant link in place of its count, and the
    count appears once the link is used. *Start* waits, and the person's page keeps the
    migrations meanwhile.
- **Not yet:** grant and progress links *per person* (T5 (b), ADR-0035's amendment); until they
  are built, each migration's page keeps its own.
- **Proved by** `StartMigration.unit.test.tsx` (33 cases) and `start-plan.unit.test.ts` (25),
  and by a walk in Chromium over a fixture API that answers a Google account with no token as
  the create door does (`error`). The walk goes in English and Dutch from *They do, with a link*,
  through Anna's address and two grant links, one per migration, used, to *Start* and their page.
  It found the closing line promising that each migration starts by itself once connected, which
  nothing does, in Dutch that read Anna as a woman (*haar account*). The line now says to start
  each one from its *Details*.
- **The owner's answer on the links (2026-09-29):** *"yes, a per-person link instead of the
  per-migration links"*. The walk shows why: Anna's one Google account took two links, one per
  migration. Designed next, with ADR-0035's amendment.
- Not yet against a real Google grant: the path runs through 0108's own routes, unchanged.

**2026-09-29, morning: T7 (f), the wizard's step labels are not struck through** (0131 §6, R8).

- The line between two steps in the wizard's header is now the step's last flex item. It was
  drawn absolutely from 4rem to the step's right edge, so it ran through every label longer
  than a word. It now fills only what the circle and the label leave.
- On a phone four whole labels do not fit, and with the line out of the way they pushed the page
  117 pixels sideways at 360 pixels. Below Tailwind's `sm` the labels are read, not shown, and
  the heading under the row (*Stap 1 van 4: Bron*) names the step.
- Proved in a real browser (`test/ui/managed-ui.ui.test.ts`, *the wizard's progress row*), in
  English at 1280 pixels and in Dutch at 1280, 768, 640 and 360. No line box crosses a label
  box, and the page does not scroll sideways. With the old positioning and the same markers,
  the three cases it had then (English at 1280, Dutch at 1280 and 360) failed on *the line
  crosses "Source"* and *"Bron"*.

**2026-09-29, morning: T4 with T7, *Start a migration* (the owner's *"Yes"*, 0131 §6), in #1378.**

- **`/start`** (`apps/web/src/pages/StartMigration.tsx`), managed only, drawn in
  `wf-start-a-migration.svg`. *Start a migration* on Migrations, and *Add a migration* on a
  person's card and page, open it. The four-step wizard stays beside them as *Add one migration
  by hand*. Six screens, each starting with focus on its heading:
  1. *Who is it for?* Somebody on Migrations, or a new name, and `?person=` chooses. Nobody is
     made before screen 6, so leaving half-way leaves no empty card.
  2. *Which account are you leaving?* Six tiles, none ticked, more than one allowed, each
     tagged where it has not met a real account. An export archive and a server by its
     protocol go to the wizard, with the person.
  3. *What moves?* Per provider, what it can give on this deployment, all ticked, each tagged
     by the card that carries it. Google Docs and Dropbox Paper get the wizard's own format
     choosers, with its defaults. Photos are a line: a Takeout export, added by hand once it
     is in the new files.
  4. *Connect your accounts.* One sign-in per card, for exactly what was ticked (T1 (c)), and
     how many Google takes is said before the first. A saved account is offered first, and the
     one saved account is the default. A new one is kept only once its check passes; *Try
     again* takes back the account a failed check left.
  5. *Where does it go?* Per data type: a saved account that takes it, or a new Soverin or
     Nextcloud, as drawn.
  6. *Check, then start.* Leaving screen 5 makes the person and one paused migration per pair
     of accounts. Each is named *"{person} — {provider} to {destination}"*, runs daily at
     02:00, and is added to the person. Then each migration's count with its tick, the
     manifest's rows true of these sources, and one *Start*. It waits for every count and
     tick, and lands on the person's page.
- **T7**, as `AccountForm`'s flow variant:
  - (a) *Connect with …* and *Check the sign-in* are primary and at least 44 pixels tall, and a
    greyed Next says why under it;
  - (b) Soverin shows two fields, its servers folded under *Server settings*, which a server
    failure opens;
  - (c) a Nextcloud is its address, with the DAV root derived (`nextcloudDavUrl`) and editable
    in the fold;
  - (d) the company fields wait behind *Is this a company account with an administrator?*;
  - one way in first (the owner, 2026-09-29): the address and *Connect with Google*, and under
    it, each folded, an app password instead (Gmail's) and one's own client. *Check the
    sign-in* shows once one of those is in use;
  - (e) a limit is blamed on its side: *Not from Dropbox*, and *Soverin does not take files*;
  - (f) the flow draws no progress line to strike through; the wizard's stays until it
    retires.
- **Underneath:**
  - `start-plan.ts` holds the rules;
  - `ConfirmMigration`'s count is split into `useMigrationCount` and `MigrationCountSection`,
    so one screen holds several counts under one *Start*, and the confirm page is unchanged.
- **Not yet, and said:**
  - *Myself / Someone else* and grant links: 0108's links are per migration and Google only,
    so they come in the next slice, not as a promise screen 1 cannot keep;
  - screen 6's time estimate waits for 0154 T3 (a);
  - the wizard retires once `CreateMapping.reachability.unit.test.tsx` passes through the flow
    (D5).
- **Proved by:**
  - `StartMigration.unit.test.tsx` (28 cases) and `start-plan.unit.test.ts` (21). They cover
    each screen's focus and reasons, the tags, the saved-account default, a failed check's
    *Try again*, Soverin's fold, Nextcloud's address, and the set-up's payloads. A refused
    set-up asks again only for what was not made, and one *Start* for two migrations lands on
    the person's page. A failed read of the saved accounts is said, and a `?person=` naming
    nobody chooses nobody;
  - `managed-ui.ui.test.ts` in a real browser: from Anna's card through the six screens and
    one *Start* to their page, with no call the API does not serve. With the card's link pointed
    back at the wizard, it fails;
  - `ConfirmMigration`'s own 68 cases pass unchanged;
  - a walk in Chromium over a fixture API, in English, Dutch and at phone width, found two
    faults, both fixed: mail was listed after files, and *Another mail provider* was
    capitalised mid-sentence.

**2026-09-29, morning: one link per person, decided and planned (T5 (b); ADR-0035 amended).**
The owner, asked after the walk of *Someone else* sent Anna two links for one Google account:
*"yes, a per-person link instead of the per-migration links. Perhapse replace it, or do we still
need the per-migration-link?"*

- **ADR-0035's amendment** records the decision, the design, and the answer to the question as a
  proposal: replace, keeping per-migration links already sent until they expire, and a migration
  with no person gets one first. It also proposes *start when granted*.
- **T5 (b)** plans the build in four slices: the managed-only `person_link` row and its doors;
  the grant page per person, asked and bound per Google account; the progress page per person,
  with taking a grant back per account; and the owner's side.
- **Found while mapping it:** the ledger's `mapping_link` cannot point at `person`, which is
  managed-only (ADR-0036), so the person's link is a managed row of its own.

**2026-09-29, morning: the owner's answers to the writing session's eleven questions, and two
words changed with them** (0131 §6, R8).

- **T6's words:**
  - the share announcement, to people who only had files shared with them, says *gemigreerd*,
    not *verplaatst* (*"Gemigreerd"*): *Met u gedeelde bestanden zijn gemigreerd*, and in the
    body *Ze zijn naar een ander platform gemigreerd*. The human copy in
    `docs/cutover-communication-templates.md` follows, and the glossary's *migration* row says
    it;
  - the Dutch menu entry is *Hulp*, not *Help* (*"Hulp or Ondersteuning (Support)"*). *Hulp* is
    the word the sidebar already uses (*Hulp: {address}*); *Ondersteuning* would read as a
    support desk, which is the operator's *Support* page;
  - the Team page keeps *Team & organisatie* under the menu's *Team* (*"Keep"*);
  - the new words of #1347, #1349 and #1353 stand (*"Ok"*).
- **Who builds the rest (*"Yes, but check first if it did not already land during tonight"*):**
  the writing session takes T4 with T7 and the rest of T5, R8 steps 6 and 7. Checked on `main`
  at `5f74ebc`: T4 and T7 are still proposed, and no branch or open pull request of R's or M's
  touches them. 0131 §6 records the split.

**2026-10-03, evening: start when granted, once the move was ever started (T5 (b); the owner's
answer).** Asked whether a person's move must be running for a grant to start a migration of
theirs, or only have been started, the owner answered: *"I think it ment: "was ever started". So
when a grant arrives, it can continue. If it was started, but never had a grant, then we also start
when the grant arrives."*

- **The rule** (`personWhoseMoveStarted` in `start-when-granted.ts`, which replaces
  `personWhoseMoveRuns`): another migration of the person is no draft, so it was started once,
  though it may be paused or finished since. A migration that waits for a grant starts by itself
  when it lands, as before; a migration the owner paused after it ran stays paused.
- **Said in the same words everywhere it is said:** *Start*'s 409 (*"…: another migration of theirs
  has been started."*), the person's page (*"Waits for Anna to connect, then starts by itself:
  another migration of theirs has been started."*, Dutch *"…: een andere migratie van Anna is al
  gestart."*), the spec, ADR-0035's bullet and decided section and its register row, and
  `grant-links.md`.
- **Proved by:** `start-when-granted.unit.test.ts` (+2: a paused move starts its draft and leaves the
  migration paused after it ran as it is; a finished move starts it too; *Start* says so either
  way) and `a-link-for-a-person.unit.test.ts` (+1: the person's page says *starts by itself* while
  the move is paused). With the old rule put back, four cases fail.

**2026-10-03: T8, the appliance shows its person's page (D5).** The appliance's one implicit
person has the page managed gives each person, and it is the appliance's landing once every
migration has started.

- **The landing** (`apps/selfhost/src/landing.ts`): `GET /` redirects to `/ui/people/implicit`
  once every configured migration has been started, and to `/ui/confirm` until then, as before.
  Started means ever started (the owner, 2026-10-03: *"was ever started"*): a migration paused
  since, or finished, leaves the landing on the person's page, where it shows as paused. One
  added to the config directory later, and not started yet, brings Review & confirm back. With
  nothing configured, or when a status cannot be read, the landing is Review & confirm.
- **The rows on the appliance** come from `/status`, which every appliance page polls, since it
  has no list of migrations (ADR-0034). `/status` now names each migration's destination
  (`targetType`), and its `name` when its file gives one. One with no name is called by where it
  goes (*"Dropbox to WebDAV"*). Its data types are those the status reports, and its last pass is
  the latest any of them completed.
- **The route** `people/:personId` is served on both editions. Migrations, *Start a migration* and
  the wizard stay managed. On the appliance the page has no back link to a Migrations page, and,
  as for any implicit person, no *Add a migration* and no links.
- **The menu** opens with *Migrations*, leading to the page, as a member's does. *Review* stays.
- **Not changed:** `appliance-bundle.unit.test.ts`, which the plan named. It asks what ships, and
  the person's page has always shipped in both bundles, by a static import. What changed is that a
  route renders it, which `AppRoutes.unit.test.tsx` now proves for both editions.
- **Proved by:**
  - `pglite-startup.unit.test.ts` (+2): a real appliance on PGlite lands on Review & confirm while
    its migration was never started and on the person's page once it runs, and `/status` names
    the destination and no name its file lacks;
  - `landing.unit.test.ts` (5): nothing configured, one never started, all started, one paused
    since it ran, and one added later;
  - `status.unit.test.ts` (+1), `Person.unit.test.tsx` (+3), `AppRoutes.unit.test.tsx` (+2, and
    the person's page left the managed-only list), `Layout.unit.test.tsx` (+1).

  Ten mutations each fail their cases: the landing never the person's page; blind to a migration
  never started; reading the status alone, so a pause after Start would bring Review & confirm
  back; the status without the destination; the appliance's rows read from the managed list; no
  last pass; no name from where it goes; the back link on the appliance; the route managed only;
  and no menu entry.

**2026-10-03: the person's page says what waits for their grant (T5 (b); start when granted, per
person).** Beside each migration of theirs that waits for their grant, the page says what the
grant does to it when it lands, by the rule that starts it:

- *"Waits for Anna to connect, then starts by itself: another migration of theirs is running."*
  when it never ran and their move runs;
- *"Waits for Anna to connect. Once they have, open Details to review and start it."* when it
  never ran and nothing of theirs runs;
- *"Waits for Anna to connect again."* when it ran, and lost its way in since.

`GET /api/people/:personId/awaiting-grant` answers it (`awaitingTheirGrant` in
`start-when-granted.ts`): the migrations their link asks for that have no way in, read as the
grant page reads them, and judged by the two questions `startWhenGranted` asks. An account two
Google applications read is left out, as the grant page leaves it out, and so is a finished
migration. A read that failed says so under the migrations. Managed only, as their links are.

- **Proved by:** `a-link-for-a-person.unit.test.ts` (+5: each answer, a real grant that starts
  what it said would start, what is left out, and who may read it) and `Person.unit.test.tsx`
  (+5). Five mutations of the server's reading and three of the page each fail their cases.

**2026-10-03: start when granted, per person (T5 (b); ADR-0035's amendment, decided).** The
owner: *"Yes, but after the move was started in the first place. After preflight the start needs
to be given at least once, the grant may arrive later."* Asked whether that holds per person or
per migration: *"Per person"*.

- **When a grant lands** (`start-when-granted.ts`, called by both endings after the grant's own
  transaction):
  - each migration it landed on that never ran starts by itself if another migration of its
    person is running: `active`, its paths with the month's peak, the change recorded `via:
    'grant'` by the link, and its first pass enqueued;
  - a move nothing of which runs (not started yet, or paused) starts nothing, and neither does a
    migration paused after it ran;
  - a closed organisation or an operator hold starts nothing (`enqueueIfFree`, the hold's door
    with nobody to answer).
- ***Start* on a migration that waits** says, when its person's move runs, that it starts by
  itself once they have connected (`startsWhenGranted: true`).
- ***Start a migration*'s last screen** may start once one count is in. It starts the counted
  migrations; one waiting for the person's link says *"Once you have started the others, it starts
  by itself when Anna connects."* With nothing counted, *Start* waits, as before.
- **Not asked of a migration that starts by itself:** the tick for files a format would refuse,
  by the owner's *"at least once"*. What it could not copy shows in its queues.
- **Proved by:**
  - `start-when-granted.unit.test.ts` (6; PGlite as `app_user`, both chains);
  - `a-link-for-a-person.unit.test.ts` (+2, through a person's grant);
  - `a-progress-page-for-a-person.unit.test.ts` (+1, through a migration's link sent before);
  - `StartMigration.unit.test.tsx` (+2), and the hold guard (+1: `enqueueIfFree` has one caller).

  Six mutations each fail their cases: no running-move check, no never-ran check, the hold
  ignored, either ending not calling it, and the wizard waiting for every count.

**2026-10-03: the person's link replaces the per-migration links (T5 (b)'s fourth slice, the rest
of it; ADR-0035's amendment, decided).** The owner, asked the amendment's question: *"yes, replace
the per-migration links"*. Its two "keep" points stand as written.

- **No migration's page makes a link any more.** `POST /api/migrations/:id/links` answers `409
  links_are_per_person`. When the migration has a person, the answer names them, with their id
  for a page to link to. When it has none, it says to say who the migration is for. Nothing is
  written. The door stays rather than going, so an older page or a script is told where links are
  made instead of meeting a 404.
- **The migration's page**, under *Links*, points to the person's page: *Open Anna's page*. A
  migration that belongs to nobody asks *Who is this for?* there first, with somebody on the
  Migrations page or *Someone new*.
- **Links sent before** are listed there with their states, and *Revoke* still works:
  - they are honoured until they expire;
  - one still counts in the live-link limit while it is live;
  - a grant through one ends on the person's progress page when the migration has a person
    (`mintProgressLinkForMigration`).
- **The limit's door is the person's only.** `issueWithinTheLimit` is gone, and the lock's
  integration test (`one-issue-at-a-time`) now issues people's links. On a real Postgres (16, two
  connections) it passes, and fails without the lock. The conditions sweep's order check reads
  `person-link-routes.ts`.
- **The withdrawn-grant banner** on a migration's page says the new link is made per person.
- **The docs** say where links are made now: `grant-links.md` (with *Links sent before*), the
  Google guides, the Workspace setup, and the owner's and operator's runbooks.
- **Proved by:**
  - `link-routes.unit.test.ts` (rewritten, 11) and `a-person-link-within-the-limit.unit.test.ts`
    (6, the limit's cases moved to the person's door);
  - `a-progress-page-for-a-person.unit.test.ts` (+1, a migration's link hands over the person's
    page);
  - `MappingLinksPanel.unit.test.tsx` (rewritten, 22) and `MappingDetail.unit.test.tsx`.

**2026-10-03: a person's link asks again for an account whose connection stopped working (T5 (b);
ADR-0035's amendment, added the same day).** Found while replacing the per-migration links (the
owner: *"yes, replace the per-migration links"*). The person's link was refused once every
account of theirs read as connected. A token Google no longer honours still reads as connected:
taken back at Google, lapsed, or expired after seven days while the Google application is in
testing. Only a migration's own link could ask for it again, and those are going.

- **The issue door** (`person-link-routes.ts`) now makes a link that asks every account again when
  each is connected. It says so (`asksAgain`), and the person's page tells the owner. It still
  refuses a person with nothing a link can serve.
- **The row** remembers which migrations it asks for again: `person_link.asks_again`, managed
  migration 0036. 0035 is taken by another session's branch (the system role's purge of this
  table). Migration ids, not addresses.
- **The grant page** offers such an account *Connect again with Google as …*, with a sentence
  saying why (`grant.ts`, `Grant.tsx`).
- **The ending** (`person-grant-ending.ts`) takes the migrations it wrote off the list. It spends
  the link once every account is connected and none it still asks for is left among the person's
  migrations.
- **Proved by:**
  - `a-link-for-a-person.unit.test.ts` (13 → 16; PGlite as `app_user`, both chains);
  - `person-link-under-rls.unit.test.ts` (+2);
  - `Grant.unit.test.tsx` (+1), `grant-service.unit.test.ts` (+1) and `Person.unit.test.tsx` (+1).

  Three mutations each fail their cases: refusing a connected account whatever the link asks;
  spending once every account holds a token; and still asking for a migration that left the
  person.
- **The spec** documents `asksAgain` and `again`. It now also says a person's progress link is
  offered (slice 3 left the request body at `grant` only).

**2026-10-03: *Report this link* from a person's pages (0108 T8 (d), for ADR-0035's amendment of
2026-09-29).** The third slice's open end: a person's grant page and progress page now offer it,
as a migration's pages do.

- **The doors** (`link-reports.ts`) take a person's link at its own kind's door, and neither kind
  at the other's.
- **The ticket** (`link-report.ts`) names the link as a person's, the person, and every migration
  of theirs on a line of its own (state, from, to, access), from the rows. Each line stays one
  line whatever an organisation typed.
- **Proved by** `a-person-link-that-can-be-reported.unit.test.ts` (4; PGlite as `app_user`, both
  chains, Zammad stubbed), and `Grant.unit.test.tsx` and `View.unit.test.tsx` (+1 each). The
  migration's own report test passes unchanged. Mutation: the doors taking a migration's link
  only fails two cases.

**2026-10-03: T5 (b)'s third slice, a person's progress page (ADR-0035's amendment of
2026-09-29).**

- **The page** (`GET /api/view/:link`, `person-progress.ts`, `View.tsx`): for a person's link,
  every migration of theirs with the counts and states a migration's own page shows
  (`migrationProgress`, now the one reading both use), under the Google account it reads, and the
  others after. An account is named on the page by an opaque `ref`, never by its address, as a
  migration's page carries none.
- ***Take my grant back*, per account** (`POST /api/view/:link/withdraw` with `{ account }`):
  - each token the account's migrations hold is revoked at Google once;
  - then it is cleared from every one of them in one transaction, with a
    `mapping.grant_withdrawn` row each, whatever Google answered;
  - a `ref` that no longer matches what is held (given again, or taken back in another tab)
    deletes nothing, and says so in both languages.
- **The progress link:** the person's grant ending hands one over after the consent lands, as a
  migration's does. The owner's door issues one (`purpose: 'view'`, 30, 90 or 180 days), and the
  person's page offers *One progress link for everything* beside the grant link.
- **Not yet:**
  - *Report this link* from a person's pages: the report route takes a migration's link only;
  - the migration's page still makes its own links, until the owner answers the amendment's
    proposals.
- **Proved by:**
  - `a-progress-page-for-a-person.unit.test.ts` (8; PGlite as `app_user`, both chains, with
    Google's token and revoke endpoints stubbed);
  - `a-link-for-a-person.unit.test.ts` (13), whose progress-link case now issues one;
  - `View.unit.test.tsx` (+5), `Person.unit.test.tsx` (+1) and the view service's test (+3).

  Mutation: sending an account's withdrawal as a migration's fails two cases. The spec
  documents the page and the body, and its checker learns `pattern`.
- **Walked in Chromium**, English and Dutch, at 900 and 390 pixels wide, over a fixture API shaped
  as `person-progress.ts` answers: two accounts and an IMAP mailbox, no sideways scroll, no call
  the fixture does not serve, and one press withdrew the first account by its `ref`, after which
  each of its migrations says copying stopped.

**2026-09-29, morning: T5 (b)'s fourth slice, the owner makes the person's one link (ADR-0035's
amendment of 2026-09-29).**

- **The person's page** has *For Anna*: *One grant link for everything*, its states, *Create
  grant link* and *Revoke*, from the same section a migration's page draws (`LinkSection`, now
  given its doors). Not on the appliance, which issues no links, and not before the person has a
  migration.
- ***Start a migration*'s last screen** offers that one link where it offered one per migration
  (#1386): one Google account read by two migrations is signed in to once. Each migration it
  serves says its count appears once the person has connected, and *Start* waits. Only a link
  used after the screen first read the person's links counts: a person chosen from the list may
  have used one before these migrations were theirs.
- **Not yet:** the migration's page still makes its own links, until the owner answers whether
  the person's link replaces them (the amendment's proposals); the progress link (slice 3).
- **Proved by** `Person.unit.test.tsx` (+2) and `StartMigration.unit.test.tsx` (+1, one *Create
  grant link* for two migrations). Mutation: counting a link used before the screen fails the
  new case. Walked in Chromium, English and Dutch, from *They do, with a link* to one link made,
  both migrations started, and the person's page.

**2026-09-29, morning: T5 (b)'s second slice, a person's link is issued, opened and granted
(ADR-0035's amendment of 2026-09-29).**

- **The owner's doors:** `POST`/`GET`/`DELETE /api/people/:personId/links`
  (`person-link-routes.ts`), owner or admin, the texts accepted, within the limit, grant only.
  A person with nothing a link can serve is refused with each migration's own reason.
- **The page** (`GET /api/grant/:link`, `Grant.tsx`): for a person's link, who asked once, then
  a card per Google account with where each migration goes, the scope in Google's words and its
  own *Continue with Google as …*. A connected account shows *Connected*; one whose migrations
  run through two Google clients says so, for the person to forward. No migration id reaches the
  page. `person-grant-subject.ts` groups the migrations by account as the ending binds a sign-in
  (`googleAccountKey`), and asks each through `grantLinkAsk`, unchanged.
- **The ending** (`person-grant-ending.ts`): in one transaction, the close, the link still live
  (`FOR UPDATE`), the account that signed in the one named, and only the migrations the page
  listed that are still theirs and still read that account take the token, with an audit row each.
  The link is spent once every account is granted.
- **Not yet:** the person's progress link and page (slice 3), and the owner's side (slice 4).
  Reports from a person's page are not offered yet: the report route takes a migration's link
  only.
- **Proved by** `a-link-for-a-person.unit.test.ts` (13, PGlite as `app_user`, both chains,
  Google's token endpoint stubbed), `Grant.unit.test.tsx` (20 → 24) and
  `grant-service.unit.test.ts` (+2). Mutations: granting a migration that left them, and spending
  the link after the first account, each fail their cases. The closed-organisation and
  conditions sweeps count the new doors, and the spec documents them, with its checker taught
  `nullable`.

**2026-09-29, morning: T5 (b)'s first slice, a person's link as a row (ADR-0035's amendment of
2026-09-29).** No page issues or opens one yet: the doors come with the grant page that opens
them, by `link-routes.ts`'s own rule that a link no page honours opens nothing.

- **`person_link`**, managed migration 0034 (0033 is taken by #1358's system role): shaped as
  the ledger's `mapping_link`, with `(person_id, tenant_id)` referencing the person, NULL-safe
  tenant policies, and its own `link_sees_itself` on `app.current_link`. Deleting the person
  deletes their links. Erasure purges it before `person`.
- **`person-link-store.ts`** (managed): issue, verify, spend, revoke, list, count. The secret is
  made, hashed and compared by the ledger's own `mintLinkSecret`, `hashLinkSecret` and
  `linkSecretMatches`, now exported so the two kinds cannot drift. A person's token is
  `p.<id>.<secret>`, and each store refuses the other's by shape before reading anything.
- **The live-link limit counts both kinds** under the one lock (`liveGrantLinks`), a person's
  link once whatever it covers.
- **Proved by** `person-link-under-rls.unit.test.ts` (12, PGlite as `app_user`, both chains) and
  the limit's route test (34 → 35). Mutations: revoking without the person in the `WHERE`, and
  the migration without the person's key, each fail their cases; the limit counting migrations
  only fails the new one.

**2026-09-29, night: T5's first slice, a page per person (0131 §6, R8 step 7, built beside R at
the owner's word *"continue on the rest"*)**, in #1353, stacked on #1349.

- **`/people/:personId`** (`apps/web/src/pages/Person.tsx`), drawn in `wf-person-page.svg`. The
  card's name on Migrations links to it, and so does its *Needs you* count. It holds:
  - *← Migrations*, the person's name, where from and where to, one stage, and what waits on
    them (the card's count), linked to their steps below;
  - each migration's lines per data type, drawn by one component with the card
    (`MigrationLines`), and *Details →* to the migration's own page, where its runs, schedule,
    settings and controls stay;
  - *Before you switch* (0154 T4): the hub's seven steps as one ordered list, each summed across
    the person's migrations, with its state in words: *Done*, *Needs you* or *Not yet*.
    Several migrations each get a link to their own page for the step; one migration's step
    name is the link. On a queue's step each link carries that migration's own count
    (*Anna mail (2)*), so the person sees which one the work is in. A count that could not be
    read says so, on the step and on the link, and claims no state;
  - *Add a migration*.
- **The steps' rules are pure and tested** (`cutover-steps.ts`):
  - Deletions, Moves and Failures need the person while anything waits.
  - Sharing is *Not yet* until every migration is done.
  - Check passes when every migration is ready to finish, or in or past its cutover, and
    Confirmed follows it.
  - Finish needs the person while a migration is in its cutover.
- **The hub's seven** moved to `hub-screens.ts`, so the migration's page and the person's page
  keep one order and one set of names.
- **Not yet, and said:**
  - the one-line progress per data type (0154 T2's totals, R's);
  - grant and progress links per person, which wait for T4 to ask who a migration is for and
    for 0108's per-person links;
  - the migration's own page still shows its seven as cards (0154 T4's other half).
- **Proved by:**
  - `Person.unit.test.tsx` (10 cases) and `cutover-steps.unit.test.ts` (8 cases). With an
    unread count on a link shown as *(0)*, the hard-rule-9 case fails;
  - the routes, the menu (Migrations lit on a person's page) and the card's links;
  - `managed-ui.ui.test.ts` in a real browser: from Anna's card to their page and its seven
    steps.

**2026-09-29, night: T1 (b), Gmail's app password is drawn (0131 §6, R8 step 1, built beside R at
the owner's word *"continue on the rest"*)**, in #1349, stacked on #1347.

- **Confirmed on a render:** the Gmail card drew *Username, Client ID, Client secret, Refresh
  token, Service account key* and *Connection name*, and no *App password*. The descriptor had
  declared it since 0089 T7, and the create door accepts it in place of the OAuth trio. But the
  wizard's field map had no entry for it, and a field with none is skipped without a word. The
  Google guide told a personal account to make one and type it in.
- **Drawn, as the plan recommends:**
  - on the Gmail card only, last, with its hint;
  - typing one steps round the trio, as a pasted service-account key does;
  - the probe and the saved account carry it, and the create payload sends it alone;
  - it is never in the remembered draft, like every secret.
- **The guide cannot name an undrawn field again.** `end-user-docs.unit.test.tsx` now fails
  when a card's guide section names a field the wizard does not draw. With the map entry taken
  out, it names `en/google.md`'s `{#gmail}` and `appPassword`.
- **Accounts, in the wizard too:** the field that names a saved account says *Name for this
  account* / *Naam voor dit account*, as the Accounts page does since #1343.
- **Proved by** `CreateMapping.unit.test.tsx` (3 new cases). With the map entry taken out, all
  three fail.

**2026-09-28, night: T6 (c)'s two guards, and what they found (0131 §6, R8, built beside R at
the owner's word *"continue on the rest"*)**, in #1347, stacked on #1343.

- **Attributes are read.** `hardcoded-text.unit.test.ts` refuses a literal with a word in it in a
  `placeholder`, an `aria-label`, a `title` or an `alt`. A single word counts. An address, a host,
  a path, a URL or a token passes. It found four:
  - the wizard's name box said *My Migration* in both languages. It now gives an example:
    *For example: Anna's mail* / *Bijvoorbeeld: mail van Anna*;
  - its steps were announced as *Progress*. They are now *Progress* / *Voortgang*;
  - two regions were announced by their slugs, *discovery-counts* and *scope-manifest*. The
    first is named by its own heading, and the second *What migrates, and what does not* /
    *Wat migreert, en wat niet*.

  The sign-in's token example stays as it is, marked as a technical literal.
- **No connection kind is rendered as text.** `a-kind-shown-where-a-name-belongs.unit.test.tsx`
  refuses `{x.kind}`, `{x.sourceType}` or `{x.targetType}` as a JSX child. It found three:
  - the Accounts row's badge;
  - the wizard's list of saved accounts, *Anna's mail (gmail)*;
  - its review step, which said the source was `oauth2`.

  Each now says the name. `connectionKindName` names a stored kind, and `o365` is *Microsoft
  365* whichever card saved it. The operator's support table keeps the kind, marked as needed
  there. The guard also holds every kind the ledger's `connection_kind_check` allows to a name,
  apart from the two kinds from before the cards.
- **Proved by** mutation: with *Progress* written back as a literal, the attribute case names
  its line, and with `{connection.kind}` back on the Accounts row, the kind guard names it.

**2026-09-28, night: the menu counts beside *Needs you* what waits (T3 (c); 0131 §6, R8 step 4,
built beside R at the owner's word *"continue on the rest"*)**, in #1346, stacked on #1343.

- **One count, counted one way** (`apps/web/src/services/needs-you.ts`). It is what the cards on
  Migrations count, added up, and the organisation's own decisions about a new mailbox, which
  no card claims:
  - a card counts a migration's failures, deletions and moves waiting, and each data type whose
    grace period ended while nobody chose;
  - *Ready to switch* and the sharing checklist are not counted.
- **The same read, under the same key**, as Migrations and the *Needs you* page, so the three
  agree.
- **The link keeps its name; the count is its description** (*3 waiting on you*). When the read
  fails, or a queue could not be read, the menu shows `?` and says it could not count, never
  nothing (hard rule 9). Nothing is shown while it loads, or at nought.
- **Only a member's menu asks.** The appliance and an operator in no organisation ask nothing.
- **Proved by:**
  - `Layout.unit.test.tsx` (6 new cases);
  - `managed-ui.ui.test.ts` in a real browser: *3 waiting on you*, as the link's description.

  **Mutations:** with an unread count shown as nothing, two cases fail; with *Ready to switch*
  counted, one fails.
- **T3 is built** (#1341, #1343 and #1346), apart from what waits on 0154 T2: the progress line on
  each data type, *Ready to switch*, and a check not yet run in a person's count.

**2026-09-28, night: Migrations is the landing page, the Dashboard is gone, and the menu is the
drawing's (T3's second half, with T6 (b)'s words; 0131 §6, R8 step 4, built beside R at the
owner's word *"continue on the rest"*)**, in #1343, stacked on #1341.

- **Sign-in lands on Migrations** (`Login`, `AuthCallback`, `Invitations`, and `/` itself). An old
  `/dashboard` link redirects there, so a bookmark still lands. The Dashboard page, its test and
  its 36 strings are gone: the top line of Migrations says what its tiles said, and its quick
  actions were the page's own buttons. The last run of each migration is on the migration's own
  page, and a failure that needs a person is in their card's count.
- **A member's menu** is Migrations · Needs you · Accounts · Help · Team · Billing (D7).
  - *Help* is the setup checklist and the setup guides, as two tabs of one entry (`HelpTabs`).
    It opens on the checklist, and stays lit on the guides.
  - The appliance keeps its menu, with T6 (b)'s *Needs you* for its decisions. An operator in no
    organisation keeps the guides, the access queue and support.
- **The words** follow the menu, in both languages, glossary first:
  - *Accounts* on the Connections page and wherever a sentence named it;
  - *Team* for *Tenants*;
  - *Needs you* for the page. Its list of the organisation's own decisions keeps *Needs a
    decision* as its heading, and its box of each migration's line is *Per migration*, so no
    heading repeats the page's.
- **Proved by:**
  - `Layout.unit.test.tsx`: the member's menu in order, nothing of the old menu left, and *Help*
    lit and naming the page on either tab;
  - `HelpTabs.unit.test.tsx` (4 cases), and `AppRoutes.unit.test.tsx`: `/`, `/dashboard` and the
    appliance-only addresses land on Migrations;
  - `managed-ui.ui.test.ts` in a real browser: sign-in lands on Migrations with the drawing's
    menu, and an old `/dashboard` link lands there too.
- **Next:** the count beside *Needs you* in the menu (T3 (c)), which reads what waits on every
  page.

**2026-09-28, night: the product's Dutch says *migratie* (T6 (b), 0152 D6; 0131 §6, R8, built
beside R at the owner's word *"continue on the rest"*)**, in #1342.

- **Every Dutch sentence that said a form of *verhuizen*** is rewritten: eight strings in the web
  dictionary (billing, the grant pages, sharing rights, the access form), the share
  announcement mail's subject and body with their human copy, and a sentence on the erasure
  page.
  - The product's own words became *migratie* and *migreren*.
  - Files that moved to another platform are *verplaatst*.
  - What does not come along *gaat niet mee*.
- **Two guards.**
  - `i18n.unit.test.tsx` refuses `/verhui[sz]/i` in the Dutch dictionary and names the key,
    as T6 (b) asks.
  - `scripts/a-word-the-owner-retired.unit.test.ts` reads every app's and package's source,
    and `docs/cutover-communication-templates.md`, because a mail's Dutch is not in the
    dictionary.

  With one sentence each put back, both fail and name it.
- **The glossary** says it first, in *migration*'s row.

**2026-09-28, night: the Migrations page lists people (T3's first half, with T6's words; 0131
§6, R8 step 4, built beside R at the owner's word *"continue on the rest"*)**, in #1341.

- **One card per person** (`apps/web/src/pages/Mappings.tsx`), read from `GET /api/people`
  beside the migrations list. A card shows:
  - the person's name, and one stage: the least advanced of their migrations' (*"One stage per
    person"*);
  - one line saying where from and where to, in words: *"From Google and Dropbox to Soverin and
    Nextcloud"* (`providerName`, which names the company a person leaves);
  - a line per data type, with its two tiles, its stage and its last pass;
  - a count of what waits on the person: failures, deletions and moves, and a data type whose
    grace period ended while nobody chose. It links to *Needs you* (`/decisions`) until T5's page
    exists. The organisation's decisions about a new mailbox belong to no migration, so they
    are on that page and on no card.
- **Every migration keeps its controls:** sync or pause, *Review and start*, open, and delete in
  two presses. Its own page has neither Delete nor a sync. The whole migration opens it, as the
  table's row did (owner feedback 2026-08-11).
- **Migrations that belong to nobody**, which is every one made before people existed, are
  listed under *Not with a person yet*. Each is added to a person in one press. *Add a person*
  takes a name, and an address or none. The page names the appliance's one implicit person
  *Your migrations* and offers no person to add, ready for T8: the appliance does not route to
  Migrations yet, and lands on its own review page.
- **Add a migration** on a card opens the wizard with `?person=`. The new migration is added to
  the person before its green light. When that add is refused, the green light's page says so
  in the server's words, and the migration waits under *Not with a person yet*.
- **The words** are T6 (b)'s: *Start a migration* / *Migratie starten* and *Needs you* /
  *Wacht op u*. The new ones went into `GLOSSARY.md` first (*person* / *persoon*), then
  `strings.ts`, in both languages.
- **A failed read** of the migrations or of the people is a failure on screen, never an empty
  list (hard rule 9). When what needs a person cannot be read, the card says it could not
  count, never zero.
- **Proved by:**
  - `Mappings.unit.test.tsx` (31 cases);
  - `CreateMapping.unit.test.tsx` (3 new cases) and `ConfirmMapping.unit.test.tsx` (3 new);
  - `ProviderTile.unit.test.tsx` (10 new);
  - `managed-ui.ui.test.ts` in a real browser (13 cases; the people read's failure is new).

  **Mutations:**
  - with the whole-migration click taken out, the unit case and the browser's dead-row case fail;
  - with the actions' stop taken out, a Pause press opens the migration, and the unit case fails;
  - with the wizard's refused add swallowed, its case fails;
  - with the organisation's decisions added back to a person's count, its case fails.
- **Not yet, T3's second half:** Migrations as the landing page, the Dashboard's going with
  `/dashboard` redirected, and the menu (*Accounts*, *Needs you* with its count, *Help*, *Team*).
  Two things wait on 0154 T2: until the list carries the check, a migration whose check passed
  shows *Kept in step* rather than *Ready to switch*, and the one-line progress on each row
  waits for the totals.

**2026-09-28, night: the owner's answers for the rest of R8 (asked by the writing session, which
the owner told to *"continue on the rest"*).**

- **T6 (b)'s words: *"Approve as proposed"*.** The table below is decided, in both languages. It
  includes *Start a migration* / *Migratie starten*, *Team*, and *Needs you* / *Wacht op u*.
  T3 and T4 build with it, the glossary first.
- **T1 (c): *"Skip the test; the new flow fixes it"*.** There is no press on the test tenant. T4
  asks what moves before any consent, so the Microsoft consent is built from the ticked data
  types by construction.
- **For 0154:** a person's card shows one stage, their least advanced migration's (*"One stage per
  person"*, 0154 open question 3). A first-copy email goes once per person (*"One per person"*,
  0154 T7).

**2026-09-28, night: T2's tables and API are built, and named *person* by the owner (0131 §6, R8
step 3, taken on at the owner's word "Take it on")**, in #1332. Building them found `/moves` taken: on the
appliance it is the queue of items a source put somewhere else, and the web app has a page there.
Asked, the owner chose *"person / people (Recommended)"* for the name in code and in the API.
ADR-0050 is amended in place, with a table of the old names and the new.

- **Managed migration 0031:** `person` (a name, and an address or none) and `person_migration`,
  keyed on the migration, so a migration belongs to one person at most. Both have forced row
  security. A key holds a row to a person of its own organisation, and the policy holds it to
  a migration of it. `mailbox_mapping` gains no column. Erasure purges both.
- **`/api/people`** (`apps/api/src/routes/people.ts`, `@openmig/managed`'s `people.ts`):
  - `GET` lists everyone with their migrations' states and counts, and the migrations with nobody
    as `unassigned`;
  - `POST` creates a person;
  - `POST /{personId}/migrations` adds a migration: again changes nothing, and somebody else's
    answers 409;
  - `DELETE /{personId}` deletes a person and no migration.

  All four are in the OpenAPI spec.
- **The appliance** answers `GET /people` with one implicit person holding every configured
  migration, and refuses the writes with `one_person_here`. The shapes are
  `packages/shared/src/people.ts`, and a test holds both editions to one shape.
- **Proved by:**
  - `people-under-rls` (19 cases). With the policy's migration check and the person key's tenant
    taken out, three of them fail;
  - `people.unit.test.ts` (20 cases), with each answer's keys held to the spec's schema;
  - `one-person-on-the-appliance` (5 cases) and `one-answer-from-both-editions` (6 cases);
  - the erasure test, whose fixture now seeds a person and counts both tables in the receipt.
    With the two tables taken off `PURGED_TABLES`, two of its cases fail.
- **Next:** T3 (the Migrations page lists people) and T5 (a page per person, at `/people/:id`)
  read `GET /api/people`. They are R's, in the split's order.

**2026-09-28, night: ADR-0050 accepted by the owner (T0, T2; 0131 §6, R8's split)**, recorded in
#1327. Asked what the pull request needed, and told its eight rules and the choices
inside them, the owner answered *"accept"*: as proposed, rule 8 included. The ADR's operative
section carries its rules, and `OPERATIVE.md` is regenerated. **Nothing is built yet.** The
`move` and `move_member` tables and the API are T2's next step (0131 §6, R8 step 3), and T3 and T5
build on them.

**2026-09-28, night: the tiles and the six icons are components, built beside R (0131 §6, R8's
split)**, merged in #1325. They are §5's first two rows, and T3, T4 and T5 take them as they
are.

- **`ProviderTile`** (`apps/web/src/components/ProviderTile.tsx`) draws `tiles.svg`: the
  initial on the site's teal for an account a person leaves, and on its mint for where the data
  goes. The letter comes from a table of wizard types, and a connection kind is read as its type
  first, so `gmail` and `google_drive` both draw G. The tile is `aria-hidden`, and the name is
  always written beside it.
- **`DataTypeIcon` and `DataTypeLabel`** (`apps/web/src/components/icons/data-type-icons.tsx`)
  draw `icons.svg`'s six, element for element. The label writes the data type's name with
  `DOMAIN_STRING_KEY`, so no new word was needed.
- **Proved by** `an-icon-drawn-twice` (12 cases) and `ProviderTile.unit.test.tsx` (15 cases).
  Four mutations were each caught: a redrawn mail path, a teal that differs from the site's, a
  type with no letter, and a letter a screen reader would read.

**2026-09-28, night: T1 (a) and (d), each proved by its guard, in #1315 and #1316.** The plan
merged in #1321, so the two pull requests record themselves here. Both carry these same lines,
so they merge in either order.

- **(a) Review & confirm shows the rows true of the migration** (#1315, branch
  `claude/ownpace-ux-improvements-v1vjsj-a-manifest-that-reaches-the-screen`). Three things
  together left a Google Drive migration under Microsoft's rows, with no *More* fold ever
  opening:
  - `ScopeManifestEntrySchema` named `item` and `detail` alone, so the schema stripped
    `appliesTo` and `more`;
  - the detail route answers the source's connection *kind* (`google_drive`), and the screen
    looked it up with `scopeFamilyOf`, which is keyed by the source *type* (`google-drive`);
  - given no family, `scopeManifestFor` kept every row.

  The schema now names both keys, and checks the families against shared's `SCOPE_FAMILIES`.
  `scopeFamilyOfConnectionKind` maps every source kind to its family, with `apple` and `imap`
  under `standards`. A manifest that cannot be read now says so (hard rule 9). **Proved by:**
  - `a-manifest-stripped-on-its-way-to-the-screen`, 4 cases, all failing on `main`'s schema
    and component;
  - `a-source-kind-with-no-scope-family`, 3 cases, which fail with `apple` removed from the
    table;
  - `a-kind-the-confirm-screen-could-not-place`, 21 cases.
- **(d) Finish says the state in words** (#1316, branch
  `claude/ownpace-ux-improvements-v1vjsj-a-state-said-in-words-on-finish`). `{m.lifecycle}`
  goes through `StateChip`, so Finish reads *Active* / *Actief*, not *active*. The `StateChip`
  guard's raw-render patterns gain `.lifecycle}`. `Support.tsx`, the operator's screen that
  renders lifecycle raw on purpose, is waived by name for that one pattern. **Proved by** the
  guard, which fails on `main`'s `Finish.tsx` and names the line, and by two cases in
  `Finish.unit.test.tsx`, in English and Dutch, both failing on `main`.
- **(b) and (c) are still proposed.** (c) needs one press on the owner's test tenant first.

**2026-09-28, late evening: one Google consent, as the app already asks.** Seeing the drawing's
*"Connect with Google (2 of 3)"*, the owner asked: *"should we not ask for all the needed grants
in one go, like how we do now?"* Yes. The *Google account* card already makes one connection with
one consent for the ticked data types (0106 T3b, ADR-0041). Where the deployment declares
`GOOGLE_ACCOUNT_SCOPE_CLASS=restricted`, that consent covers mail and files too. The OTA stack
declares it; live is not stood up yet, and declares it if 0140 T1 keeps its client in Testing
(the owner, the same evening). T4's *Connect* step said up to three consents, and *Not in this
plan* called one consent out of scope. Both were wrong and are corrected, and so is the drawing's
step 4.

The drawings' plan numbers were also asked about: they are notes for the builder, never text on
a screen. Where one sat inside a screen's text, it moved into a note (`docs/design/0152-0154/`).

**2026-09-28, evening: the owner's second answers, and two of T1's four faults in review.** Asked
the questions this plan left open, the owner answered:

- **When:** *"before we start Alpha i want this fixed/completed."* So every task here comes before
  the first invitation, T8 and the wizard's retirement included (D5).
- **The Dutch word:** *"Yes, but dutch know 'één migratie en 4 migraties'. So we use 'migratie'
  in instead of 'verhuizing'."*
  - Read as: Dutch copy says *migratie* / *migraties* and never *verhuizing* (D6).
  - A person's card is titled with the person's name and lists their migraties, one per data type.
    That is the unit the site already counts (*"4 migraties tegelijk"*, 0152 T0).
  - *Move* stays the internal name of the grouping, in code, tables and the ADR, the way
    *mapping* is today (`GLOSSARY.md`). It is never a word on screen.
- **The menu:** *"yes and yes"*. *Accounts* replaces *Connections*, and the Dashboard goes, with
  Migrations as the landing page (D7).
- **Who builds it:** *"you draft the workplans and UX/visual image elements we might need or
  explain in the workplans how/with what the other session should make those."*
  - This session drafted the plan and the visual elements, in
    [`docs/design/0152-0154/`](../design/0152-0154/README.md).
  - Session R builds them, as group R8 in 0131 §6 (D8).
  - §5 says what each drawing is for and how R makes it.

**T1:**

- **(a)** is #1315: Review & confirm shows only the rows true of the migration's source, with
  their folds, and says when it could not read the list.
- **(d)** is #1316: Finish says the state in words, and the StateChip guard bans `.lifecycle}`.
- **Both are open**, each with its guard. Each fails on `main`'s code and passes with the fix.
- **(b) and (c)** are unchanged: (b) needs a render, (c) needs a live press.

**2026-09-28: opened from the owner's request and their answer D1.** On 2026-09-28 the owner
asked for the app to become more intuitive, from a UX and UI point of view. 0152 (the site), this
plan and 0154 (progress and proof) were written together from one audit of `main` at `83eb73e`
(§1).

The owner's answer that shapes this plan (§2, D1): *"as 1 (One move per person), but i think
this is simular to the current 'Migrations' page, but just better fitting UX? One can add
multiple migration paths (for example when one person is moving away from Google and Microsoft
and Dropbox)."* So this is not a new product area. It is the Migrations page, grouped by the
person, and a flow that fills it.

0131 T5 carries a row for this plan. Since the second answers, the row is the whole plan.

| Task | Status | Notes |
|---|---|---|
| T0 The owner's words and the ADR | ✅ **Words decided 2026-09-28 (D6, D7); ADR-0050 accepted 2026-09-28 (#1327)** | §3. Dutch says *migratie*, never *verhuizing*. A person's card carries their name. *Accounts*, not *Connections*. The code says `person` (ADR-0050's amendment); `move` was its first name. |
| T1 Four faults the audit found | 🟡 **(a) in #1315 and (d) in #1316, each proved by its guard; (b) drawn and guarded (#1349); (c) is T4's, by construction, and ends when the wizard retires; all before the first invitation** | §3. (a) Review & confirm listed every source's limits on managed. (b) The Gmail app password the guide names is not in the wizard. (c) The Microsoft consent is sent before the data types are chosen: T4 fixes it by construction (the owner, 2026-09-28: no press). (d) A raw state word on Finish. |
| T2 ADR-0050: a move is a person's migrations | ✅ **ADR-0050 accepted 2026-09-28 (#1327), amended the same night: *person*. The tables and `/api/people` built, with the appliance's implicit person (#1332)** | §3. A `person` row and `person_migration` in `packages/managed/migrations` (0031). The appliance answers one implicit person. The billed unit (a path) and the migration (a mapping) do not change. Deleting a person deletes no migration. |
| T3 The Migrations page lists people | ✅ **Built: the page lists people (#1341); it is the landing page, the Dashboard is gone, and the menu is the drawing's (#1343); the menu counts beside *Needs you* what waits (#1346); each row's stage and line come from the progress read (0154 T1 (b) and (d), #1422)** | §3. One card per person: their name, where from and where to, a row per data type with its state, and a count of what needs them. The landing page after sign-in; the Dashboard goes (D7). Drawing: `wf-migrations-page.svg`, `wf-migrations-phone.svg`. |
| T4 *Start a migration*: who, from where, what, to where | 🟡 **Built (#1372, #1378), with *Someone else* by a grant link (#1386), one per person since T5 (b); screen 6 says how long (0154 T3 (a)). Waiting: the wizard retires once the reachability test passes through the flow (D5), after the owner's four questions. Before the first invitation** | §3. Provider tiles with no card preselected. The data types are chosen before any consent. Destinations are suggested per data type, with server fields folded. One review screen holds the green light. The app creates the migrations. Drawing: `wf-start-a-migration.svg`. |
| T5 A page per person | ✅ **Built: the person, their migrations, their rows and their steps (#1353, with 0154 T1, T2 and T4); one link per person, in T5 (b)'s four slices (#1394, #1396, #1401, #1408), with *Report this link* (#1402), asking again (#1407), start when granted (#1409), and what waits for their grant (#1413)** | §3. Every migration of theirs, the queues with counts, and grant and progress links per person. Progress and proof on it are 0154's. Drawing: `wf-person-page.svg`. |
| T6 Words a family reads | 🟡 **(b)'s words approved by the owner 2026-09-28, as proposed; built inside T3–T5, before the first invitation. The Dutch says *migratie* everywhere the product speaks, with two guards (#1342). (c)'s two guards built (#1347)** | §3. No protocol, kind or id before it is needed. *Accounts*, *Team*, and one word family for *Needs you*. Two guards: attributes are read, and no connection kind is rendered as text. |
| T7 Defaults a family can pass | ✅ **(a) to (f) built inside T4 (#1378); the wizard's progress line too (#1383)** | §3. Buttons that look like buttons, with the reason in text. A Soverin sign-in in two visible fields. A Nextcloud address, not a DAV URL. Business-only fields only on the business path. The limit blamed on the side that has it. Tiles and icons: `tiles.svg`, `icons.svg`. |
| T8 The appliance shows its person's page | ✅ **Built: its landing once every migration has started, Review & confirm until then; the page's rows from `/status`; *Migrations* first in its menu** | §3. The same page, fed by the appliance's one implicit grouping. No list or create screen (0034 stands). |

## 1. What there is today

Everything below was read on `main` at `83eb73e` on 2026-09-28. The screens were rendered from a
scratch Vite build with a fixture API and photographed at 1280 and 390 pixels. The data was
invented, and nothing was written in the repository.

### The menu and the landing page

A managed member's menu has eight entries (`apps/web/src/components/Layout.tsx`:254-336):

- Dashboard
- Migrations
- Connections
- Setup checklist
- Setup guides
- Attention
- Tenants (*Organisaties* in Dutch)
- Billing

Sign-in lands on the Dashboard. It shows tiles counting migrations by state, *Recent Activity*
and *Quick Actions*. Nothing on it groups migrations by the person they move.

### Creating a migration

`/mappings/new` (`pages/CreateMapping.tsx`) has four steps: Source, Target, Migration, Review.

- **The source step** shows thirteen cards, seven tagged *Experimental*. Its protocol card
  *IMAP* is preselected (`CreateMapping.tsx`:191). So the first thing a person reads is
  Host, Port, *Use SSL/TLS*, Username and Password, and *"To continue, fill in: Host, Username,
  Password"*. The page is 2,300 pixels tall on a desktop and 3,284 on a phone.
- **A card is a connector, not a provider.** Google alone is five cards: *Google account*
  (calendars, contacts and tasks; mail and files as well where the deployment declares Google's
  restricted scopes), *Gmail*, *Google Calendar*, *Google Contacts* and *Google Drive*. Photos come through *Export archive*. The customer guide says mail and files *"come
  through the Gmail and Google Drive cards"* (`docs/guides/en/google.md`:19).
- **One target per migration** (`CreateMapping.tsx`:111). So a person leaving Google for Soverin
  and Nextcloud builds three migrations or more, each through the four steps. Each has its own
  consent, its own progress and its own Finish checklist.

  Measured for Gmail to Soverin plus Drive to Nextcloud, through the *Gmail* and *Google Drive*
  cards: about 19 presses, 9 typed fields, two Google consents and two migrations before any data
  moves.
- **The buttons that matter look like links.** *Connect with Google* and *Test and save
  connections* are `btn-secondary`, 20 pixels tall with no border (`:2507`, `:2156`). Why one is
  disabled is said only in a tooltip (`:2508-2519`).
- **The review step shows internals:**
  - *"Source: gmail ()"*, with empty brackets when a saved connection is reused
    (`:2798-2799`);
  - *"Target: soverin (caldav.soverin.net:443)"* for a mail migration (`:2808`);
  - *"Schedule: 0 2 * * *"* (`:2817`).
- **The wrong side takes the blame.** With Gmail as the source, Soverin's Calendar and Contacts
  read *"Not available over the selected target protocol."* (`:1292-1295`). The limit is Gmail's.
- **Two reviews.** *Create Migration* makes a paused migration. A second screen, *Review &
  confirm your migration* (`components/ConfirmMigration.tsx`), shows the discovery counts and
  *Start migration*. After Start the person lands on the list (`pages/ConfirmMapping.tsx`:28),
  not on the migration. 0013 T6 planned the migration page.

### The migration page

`/mappings/:id` (`pages/MappingDetail.tsx`) shows:

- the migration's name and its UUID (`:221`);
- *"From gmail · anna@gmail.com (anna@gmail.com) to soverin · …"*;
- one line of live progress;
- seven numbered cards (Deletions, Moves, Failures, Sharing, Check, Confirmed, Finish) with no
  counts and no done or not-yet state (`:273-291`);
- the data types with *Add* and *Stop*;
- grant links and progress links, even when the account is the operator's own;
- the run history.

The UUID is also the heading of every queue page (`components/MappingHubLink.tsx`). Progress is
0154's. The structure is this plan's.

### Four faults, each read in the code

(a) **Review & confirm lists every source's limits on managed.**

- `ScopeManifestEntrySchema` in `apps/web/src/services/mapping-service.ts`:600 is
  `z.object({ item, detail })`. Zod strips unknown keys, so every row reaches the screen without
  `appliesTo` and `more`.
- The detail route answers `sourceType: sourceConn?.kind` (`apps/api/src/routes/migrations/
  index.ts`:2643), a connection kind such as `google_drive`. `SCOPE_FAMILY` in
  `packages/shared/src/scope-manifest.ts` is keyed by source *type*, such as `google-drive`.
  So `scopeFamilyOf` answers `undefined`.
- `scopeManifestFor` then keeps every row whose `appliesTo` is undefined, which after the strip
  is every row (`scope-manifest.ts`:358-375).
- The result: a Google Drive migration is confirmed under *SharePoint extras*, *Teams chat &
  calls*, *Planner* and *InfoPath*, and the folded *More* text never appears. The appliance's
  `pages/Confirm.tsx` is not affected.
- `ConfirmMigration.unit.test.tsx`:38 mocks the API, so no test sees the managed path.

(b) **The Gmail app password.**

- The guide says *"Paste it into the wizard's **App password** field"*
  (`docs/guides/en/google.md`:52, and the Dutch twin).
- The Gmail card's descriptor carries the field (`packages/shared/src/credential-fields.ts`:
  553-558, `wizard.gmailAppPassword`).
- The audit found that the wizard never renders it (`CreateMapping.tsx`:1674-1692, :2019). T1 (b)
  starts by confirming that on a render.

(c) **The Microsoft 365 consent may ask for too little.**

- The source step calls `microsoftAuthorize({ domains: formData.domains, … })`
  (`CreateMapping.tsx`:1223). The data types are chosen on step 3, after the consent.
- If `formData.domains` still holds its default at that moment, the consent is for mail only.
- This is probable from the code and needs a live press to confirm, like 0145 T0.

(d) **A raw state word.** `pages/Finish.tsx`:298 renders `{m.lifecycle}`, which reads *"active"*
in both languages. `components/StateChip.unit.test.tsx` bans five raw-state patterns (`:71-77`),
and this is not one of them.

### What must stay true

- **The green light stays as heavy as it is** (0013, 0037). Nothing copies before a person
  presses Start, on a screen that shows what was found and what will and will not migrate.
- **A guided journey needs a new decision** (0034). D1 is that decision, for managed. The
  appliance keeps its flat menu, and it has no migration list or create screen (0034; its
  migrations come from files).
- **One operating UI for both editions** (ADR-0026). The appliance is not a basic mode.
- **Notifications are by email only.** There is no in-app notification centre (0030). A count on
  a card is not a notification centre.
- **Translate the frame, never the finding** (ADR-0013, `docs/i18n-prose-boundary.md`). Key
  parity is checked at compile time. Dutch uses *u*.
- **The glossary** (`apps/web/src/i18n/GLOSSARY.md`, 0035):
  - *migration*, never *mapping*;
  - *path* / *pad* is ADR-0014's billed unit (one migration × one data type);
  - customer copy says *old system* and *new system*, not *target* (0123);
  - *only reads* is not *read-only* (0144 T3).
- **Word budgets** (0118): a hint of at most 12 words, an intro of at most 15, a title of at most
  8. Longer text folds under *Why?*.
- **Only a measured "no" blocks, and no prefill is guessed** (0106). The one existing connection
  is the default (owner, 2026-09-17). A second migration between the same pair needs another
  folder (0071 T6b).
- **Experimental sources are labelled, not hidden** (0131 D6, 0148 D10).
- **Deleting a migration takes two presses** (owner, 2026-09-03). Removal is per item, pressed by
  the owner (ADR-0024).
- **Managed-only data lives in `packages/managed`** as rows of its own, never as a column on a
  core table (AGENTS.md rule 5). `apps/selfhost/src/no-managed-leakage.unit.test.ts` walks the
  appliance's imports.
- **The guards a change here keeps green:**
  - `pages/CreateMapping.reachability.unit.test.tsx`
  - `i18n/hardcoded-text.unit.test.ts`
  - `i18n/words-that-fit-on-one-line.unit.test.ts`
  - `components/StateChip.unit.test.tsx`
  - `AppRoutes.unit.test.tsx`
  - `components/front-door-cards.unit.test.ts`
  - `components/a-card-that-says-it-is-unproven.unit.test.tsx`
  - `pages/a-guide-for-every-card.unit.test.tsx`
  - `pages/end-user-docs.unit.test.tsx`
  - `test/ui/managed-ui.ui.test.ts`
  - `scripts/a-live-progress-that-needed-f5`
  - `scripts/a-target-vocabulary-typed-out-in-nine-places`

## 2. The owner's decisions (2026-09-28)

D1–D4 are the same four answers 0152 §2 records, given in one session.

- **D1 — One move per person.** The full answer is quoted in the Status block. Read as a
  specification, it says four things:
  - **Built from the Migrations page.** It is *"simular to the current 'Migrations' page, but
    just better fitting UX"*. So this reshapes that page rather than adding an area beside it.
  - **The move is per person.** A person is the unit, not a provider.
  - **Several sources in one move.** *"One can add multiple migration paths"*, for example
    *"away from Google and Microsoft and Dropbox"*. So one move holds migrations from several
    old accounts.
  - **The migrations underneath stay what they are.** They remain the unit the engine runs and
    ADR-0014 bills.
- **D2 — Before the first invitation.** Asked how this work sits against 0131 T5, the owner
  answered *"Before the first invitation"*. D5 made it the whole plan.
- **D3 — A year costs six months.** It does not touch this plan. Billing's own screen shows it
  when 0111 builds annual invoicing.
- **D4 — Names and our own icons.** Provider tiles in the flow are initial tiles with the
  provider's name. No third-party logo is added.
  - The owner chose *"Names + our own icons"* over the option's own words, *"our own neutral
    monogram tiles and data-type icons"*. So the tiles move from 0107 T2's per-provider colours
    to the neutral set in `docs/design/0152-0154/tiles.svg`.

The owner answered this plan's open questions the same evening (quoted in the Status block).

- **D5 — All of it before the alpha.** *"before we start Alpha i want this fixed/completed."*
  - Every task is in 0131 T5's minimum, T8 and the wizard's retirement included.
  - Where a task depends on something only the owner can do, the dependency is named, never the
    task deferred.
- **D6 — The Dutch word is *migratie*.** *"Yes, but dutch know 'één migratie en 4 migraties'. So
  we use 'migratie' in instead of 'verhuizing'."* The reading this plan builds on:
  - Dutch copy says *migratie* / *migraties*, never *verhuizing*. English says *migration* /
    *migrations*.
  - **On screen, a person's migrations have no noun of their own:** the card carries the
    person's name. One migration is one data type from one old account to one new account,
    the unit the site counts (*"4 migraties tegelijk"*).
  - ***Person* is the code's name for the grouping:** ADR-0050 (amended 2026-09-28), the
    `person` table, the API's `/people`. It was *move* until the owner's answer that night,
    because `/moves` is the moved-items queue. On screen a person is only ever their name, and
    *people* in a count, the way *mapping* stays off screen today (`GLOSSARY.md`).
- **D7 — *Accounts*, and no Dashboard.** *"yes and yes"*.
  - The menu entry *Connections* becomes *Accounts*.
  - The Dashboard goes, and Migrations is the landing page after sign-in.
- **D8 — Drafted here, built by R.** *"you draft the workplans and UX/visual image elements we
  might need or explain in the workplans how/with what the other session should make those."*
  - The drawings are in `docs/design/0152-0154/`.
  - §5 says what each is for and how to build it.
  - The tasks are group R8 in 0131 §6.

## 3. What each task does

### T0 — the owner's words, and the ADR (words decided; the ADR is the owner's)

(a) **The words, decided (D6, D7).**

- **Dutch says *migratie* / *migraties*,** never *verhuizing*. English says *migration*.
  - The Dutch site's *"4 verhuizingen tegelijk"* (`site/copy.mjs`:258, and more) becomes
    *"4 migraties tegelijk"* in 0152 T0.
- **A person's card carries their name.** The grouping has no noun on screen.
- **The menu entry is *Accounts*,** in both languages: a person has accounts; a connection is
  ours.
- **The glossary is changed first** (`GLOSSARY.md`), then `strings.ts`:
  - *migration* is shown per data type;
  - *person* is the code's name for the grouping, and on screen a person is their name;
  - *Accounts* replaces *Connections*.

(b) **ADR-0050**, drafted in T2, was accepted by the owner on 2026-09-28 (#1327). T2's tables and
API are built, and T3 builds on them. The owner renamed its *move* to *person* in code the same
night, because `/moves` is the moved-items queue (the ADR's amendment).

### T1 — four faults the audit found (before the first invitation, first)

Each is its own pull request, each with its own guard. They do not wait for T2.

(a) **Review & confirm shows the rows true of this migration.**

- `ScopeManifestEntrySchema` keeps `appliesTo` and `more`.
- The detail route's answer carries the source's *type*, or `scopeFamilyOf` learns the connection
  kinds. Whichever is chosen, one table maps both, and a test fails when a kind has no family.
- The guard renders `ConfirmMigration` against the real route's JSON shape, not a mock. It
  asserts that a Google Drive migration shows no Microsoft-only row and does show its folded
  *More*.
- **Built in #1315, with the kind table.** `scopeFamilyOfConnectionKind` learns the connection
  kinds, and the route is unchanged. The guard feeds the component shared's real manifest
  through JSON, as the route serves it, and mocks only the HTTP client.

(b) **The Gmail app password.**

- Confirm on a render whether the field appears for a personal account.
- If it does not, either the wizard renders it on the Gmail card, or the guide's section goes, in
  both languages. The descriptor keeps it (`credential-fields.ts`:300 gives the rule).
- The recommendation is to render it. The guide already carries every warning (*"Google
  recommends against app passwords, and so do we"*), and a person without a consent screen has no
  other road.
- `end-user-docs.unit.test.tsx` already checks that each card's section names its fields *as the
  wizard labels them*. It is extended to fail when a guide names a field the wizard does not
  render.

(c) **The Microsoft consent asks for what the migration will copy.**

- **First, one press on a real tenant** to confirm the scope sent. The owner has a test tenant
  (`docs/test-tenant.md`).
- **If confirmed,** the source step asks for the Microsoft data types before *Connect with
  Microsoft*. The consent URL is then built from them. A guard reads the call's `domains`
  argument at the moment of the press.
- T4 removes the ordering by construction: what moves is asked before any consent.
- **The owner, 2026-09-28: *"Skip the test; the new flow fixes it"*.** No press. T4's flow is the
  fix, and its guard reads the consent's `domains` at the press.

(d) **Finish says the state in words.** `{m.lifecycle}` goes through `StateChip`. The
`StateChip` guard's banned patterns gain `.lifecycle}`, so the next raw render fails the build.
0145 T2 proposes the Finish states in text for screen readers, after the invitation. This is the
one raw word, fixed now, and T2 of 0145 builds on it. **Built in #1316.**

### T2 — ADR-0050: a move is a person's migrations (before the first invitation)

**Built 2026-09-28, under the names of the owner's amendment:**
- `person` and `person_migration (mapping_id, person_id, tenant_id)` (managed migration 0031);
- `GET` and `POST /api/people`, `POST /api/people/{personId}/migrations` and
  `DELETE /api/people/{personId}`;
- the appliance's `GET /people`, with one implicit person;
- `unassigned` for what the text below calls *Not in a move yet*.

The proposal as the owner accepted it follows, under its first names.

The proposed decision, to be written as `docs/adr/0050-a-move-is-a-persons-migrations.md` with
its operative rules:

- **A move is a person being moved.** It has a display name, and optionally the person's email
  address for grant links (0108). It belongs to a tenant.
- **A migration belongs to at most one move.** Migrations created before this belong to none.
  They show under *Not in a move yet*, with one press to add them to one.
- **What a move changes:** nothing about a migration. The engine still runs migrations, the
  ledger still keys items per migration, and ADR-0014 still counts paths.
- **Storage.** On managed, a move is a row in a `move` table, and membership is a row in
  `move_member (move_id, mapping_id)`. Both live in `packages/managed/migrations` with row
  security, like every tenant table there. `mapping` gains no column (rule 5).
- **The appliance.** It has no create screen and one person. It answers the same API with one
  implicit move holding every configured migration, and it has no table.
  `no-managed-leakage.unit.test.ts` gains the new module's specifier.
- **Deleting a move deletes no migration.** Its members return to *Not in a move yet*.
  Deleting a migration stays the two-press delete it is.
- **The API.**
  - `GET /moves` lists moves with their members' states and counts.
  - `POST /moves` creates one.
  - `POST /moves/:id/members` adds a migration.
  - `DELETE /moves/:id` ungroups.

  They carry the same tenant checks as the migration routes. The OpenAPI spec is updated in the
  same pull request.

### T3 — the Migrations page lists people (before the first invitation)

(a) **One card per person** (drawing: `wf-migrations-page.svg`, and `wf-migrations-phone.svg` for
a phone).

- **The person's name.**
- **One line saying where from and where to**, in words: *"From Google and Dropbox to Soverin and
  Nextcloud"*.
- **A row per data type**, one row per path. For example: *"Mail · Gmail → Soverin"*, with its
  state from `StateChip` and 0154's one-line progress.
- **A count of what needs the person:** failures, deletions and moves waiting, and a check not
  yet run. It links the person's page.
- **Primary button *Start a migration* / *Migratie starten*,** which opens T4. Each card also
  has *Add a migration* / *Migratie toevoegen* (D6: no noun for the grouping).

(b) **It is the landing page, and the Dashboard goes (D7).**

- Sign-in lands on Migrations.
- The Dashboard's tiles become one line at the top of the page: *"2 people · 1 needs you"* /
  *"2 personen · 1 wacht op u"*.
- `/dashboard` redirects there, so old links still work.
- Its *Quick Actions* go, because the page's own buttons are those actions.

(c) **The menu,** managed, for a member:

- Migrations
- Needs you, with a count (T6)
- Accounts (D7)
- Help: *Setup checklist* and *Setup guides* as two tabs of one entry
- Team (was *Tenants*; T6)
- Billing

The operator's menu does not change. `components/Layout.unit.test.tsx` and `AppRoutes.unit.test.
tsx` are updated in the same pull request.

(d) **The list stays a list.**

- On a phone each card stacks, and its actions have names and targets a thumb can hit, as 0145 T7 (b) asks for the Migrations rows.
- The empty state says what to do first, in one sentence, with *Start a migration*.
- A failed read shows as a failure, not an empty list (hard rule 9; `test/ui/managed-ui.ui.test.
  ts` already asserts it for migrations, and it is extended to people).

### T4 — *Start a migration*: who, from where, what, to where (before the first invitation)

One flow of six screens, drawn in `wf-start-a-migration.svg`. Each starts at the top with focus
on its heading, as 0145 T3 built for the wizard.

1. **Who is it for?** / ***Voor wie?*** A name, and *"Myself"* or *"Someone else"*. For someone else, the flow
   offers a grant link (0108), so they connect their own accounts and the owner never holds their
   password.
2. **Where from?**
   - Provider tiles, **with none preselected**: Google, Microsoft 365, Apple iCloud, Dropbox,
     Box, and *Another mail provider*.
   - *An export archive* (Takeout, Apple's export) sits under the tiles as its own line.
   - *Any server, by protocol* is behind *Other ways to connect*, with the protocol cards as they
     are today (0107's two lanes stay).
   - A person can tick more than one provider (D1).
   - Experimental tiles carry their tag (0131 D6).
3. **What moves?** For each provider, the data types it offers. Each has one line on what
   carries it and its limit, taken from the card descriptors and the scope manifest.
   - Example: *"Photos: through a Google Takeout export. You download it and put it in your new
     files."*
   - A data type the provider cannot give is not offered. It sits in a fold *Not from Google*,
     never blamed on the destination (T7 (e)).
   - **This is asked before any consent.** So each consent asks for exactly what was ticked, which
     is T1 (c) by construction.
4. **Connect.**
   - **One sign-in per provider, asking for exactly the ticked data types.** That is the
     provider-account connection the *Google account* and *Microsoft 365 account* cards already
     make (0106 T3b, 0114, ADR-0041): one account row, one consent, the faces ticked. The flow
     reads what each provider serves on this deployment from `GET /api/provider-accounts`
     (`providerAccountFacts`), as the wizard does, and builds nothing new for it.
   - **For Google, that is one consent for mail, calendar, contacts, files and tasks** where the
     deployment declares `GOOGLE_ACCOUNT_SCOPE_CLASS=restricted`.
     - **The OTA stack (`ownpace-managed`) declares it** (the owner, 2026-09-28).
     - **Live is not stood up yet** (0132 T1b). Its `.env` takes the same line if 0140 T1 keeps
       its client in Testing (D1), where test users can grant Google's restricted scopes.
     - **If T1 publishes live's client to Production with the sensitive scopes only**, live gets
       the case below.
   - **Only where a deployment has not declared it** (the default, and every appliance), Google's
     one consent covers calendar, contacts and tasks, and mail and files each take a consent of
     their own through the `gmail` and `google-drive` kinds, because Google classes those scopes
     as restricted. The screen then says how many before the first, and why, in one sentence.
     Photos take no consent: they come from a Takeout export.
   - A saved account is offered first (0064). The one existing account is the default (owner,
     2026-09-17).
   - Each sign-in is checked as it is saved, with the probe 0046 built.
5. **Where to?**
   - For each data type, the destination that takes it is suggested from the accounts the person
     has added, or from the provider directory with its measured prefills (0106). For example,
     mail goes to Soverin and files to Nextcloud.
   - Adding a destination shows only what the person must type: username and password (an app
     password where the provider uses one). Server fields sit in a fold, prefilled where 0106
     measured them.
   - A Nextcloud is asked for by its address, and the DAV URL is derived (T7 (c)).
6. **Review and start.** This is **one screen, and it is the green light** (0013, 0037):
   - For each data type: from → to.
   - The discovery counts (`ConfirmMigration`'s table).
   - The rows of the scope manifest that are true of these sources (T1 (a)).
   - The time estimate (0154 T3 (a)).
   - The tick for Google files that will not be copied, where it applies.
   - One *Start*.

   Nothing copies before *Start*. After it, the person lands on their page (T5), as 0013 T6
   planned.

**Underneath,** the flow creates one migration per pair of old and new account, holding the
ticked data types, named *"{person} — {provider} to {destination}"*. It adds them to the
person (ADR-0050's `person`, `POST /api/people/{personId}/migrations`).
The schedule is daily at 02:00, the default today, and can be changed on the migration later (T5).

**The four-step wizard stays reachable** as *Add one migration by hand* on the person's page and
on Migrations. It stays until the reachability test (`CreateMapping.reachability.unit.test.tsx`)
passes for every card through the new flow. Then it is retired, before the first invitation
(D5), in a pull request of its own. Two doors while one is new is 0077's lesson: both read the same card
descriptors and examples.

### T5 — a page per person (before the first invitation)

`/people/:id` holds the following, drawn in `wf-person-page.svg`. The path keeps the code's
name, as `/mappings/:id` does (D6). It is not `/moves/:id`: `/moves` is the moved-items queue's
page on the appliance.

- the person's name;
- where from and where to;
- the rows per data type (0154 T1 and T2 fill them);
- the cutover steps as one list with counts (0154 T4);
- grant links and progress links, **per person**. A person grants their own accounts, so the
  links belong here, not on each migration. They show only for *"Someone else"*;
- *Add a migration*.

Each migration keeps its page (`/mappings/:id`) for its run history, its data types, its schedule
and its settings. The person's page links each one as *Details*. The seven queue pages keep
working per migration. The person's page shows their counts summed across the person's
migrations, and links each migration's page.

#### T5 (b) — one link per person (ADR-0035's amendment of 2026-09-29)

The owner: *"yes, a per-person link instead of the per-migration links"*. The design, and what it
changes in 0108 and 0122, is the amendment's. Built in four slices, each its own pull request:

1. **The row.** `person_link` in `packages/managed/migrations` (the next free number), shaped as
   `mapping_link` is in `packages/ledger/migrations/0031_a_link_that_grants.sql`: a hashed secret,
   `purpose` (`grant` | `view`), `created_by`, `expires_at`, `used_at`, `revoked_at`, `person_id`
   referencing `person(id, tenant_id)`, and the same row security, including `link_sees_itself`
   on `app.current_link`. A store beside `people.ts` (issue, verify, spend, revoke, list, count),
   the live-link limit counting both tables under the one advisory lock (`live-link-limit.ts`),
   and erasure. No door issues one yet: `link-routes.ts`'s own rule is that a link no page
   honours opens nothing, so the doors come with the page.
2. **The grant page per person, and its doors.** `POST`/`GET`/`DELETE
   /api/people/:personId/links`, owner or admin, the texts accepted, refused where no migration of
   theirs can take a grant (each migration asked through `grantLinkAsk`, unchanged), and within
   the limit; a progress link is refused until slice 3 builds its page. The link middleware tells
   the two kinds apart and sets the tenant and `app.current_link` as `withMappingLink` does.
   `GET /api/grant/:link` answers, for a person's link, each Google account with its migrations
   (from, to, what) and whether it is granted; `POST …/google/authorize` takes the account, and
   asks for every scope its listed migrations need through one client (two clients on one
   account are refused by name). The callback's ending writes the token to each listed migration
   of that account in one transaction, audits each, and spends the link once every account is
   granted. It then mints the person's progress link. `Grant.tsx` draws one *Sign in as …* per
   account.
3. **The progress page per person.** `GET /api/view/:link` for a person's link answers their
   migrations; *Take my grant back* is per account (`withdraw-grant.ts`: one revoke at Google,
   every migration holding that token cleared in one statement). `View.tsx` draws them.
4. **The owner's side.** The person's page (*For Anna*: *Create a grant link*, *Create a progress
   link*, their states), *Start a migration*'s last screen offering the one link in place of each
   migration's (#1386), and the migration's page listing any per-migration link still live,
   revocable, with new ones made on the person's page. A migration with no person offers
   *Who is this for?* there. The per-migration issue route refuses with a sentence naming the
   person's page.

**Tests that pin the per-migration shape today** and take the person's beside it: the grant route
(`grant.unit.test.ts`), issuing (`link-routes.unit.test.ts`, `one-issue-at-a-time.integration.test.ts`),
the store (`mapping-link-store.unit.test.ts`), the middleware (`mapping-link-auth.unit.test.ts`),
the callback (`google-callback-route.unit.test.ts`, `signed-in-account.unit.test.ts`), withdrawing
(`a-grant-taken-back.unit.test.ts`), the progress page (`view-routes.unit.test.ts`), reports
(`a-link-that-can-be-reported.unit.test.ts`), the limit (`as-many-links-as-the-tier-runs.unit.test.ts`),
closing (`an-organisation-closed-at-every-door.unit.test.ts`), the log's redaction
(`a-log-that-kept-the-link.unit.test.ts`) and the OpenAPI spec. Offboarding purges `person_link`
before `person` (`offboarding.ts`'s `PURGED_TABLES`).

**Start when granted** (the amendment's last section): decided by the owner on 2026-10-03, per
person, and built the same day. Once a person's move runs, a migration of theirs that waits for a
grant starts by itself when it lands; before that, a grant only makes the counts appear.

### T6 — words a family reads (before the first invitation, inside T3–T5)

(a) **Nothing technical before it is needed.** Each item moves to where it belongs:

- the migration's UUID goes under *Details* on its page and leaves the queue headings
  (`MappingHubLink.tsx`);
- connection kinds (`gmail`, `google_drive`, `o365`) become provider names (0074's work,
  finished);
- *"(anna@gmail.com)"* is shown once;
- the raw schedule becomes words (*"Every day at 02:00"*);
- the empty *"()"* goes;
- item hashes on queue rows go into a fold.

(b) **The words, approved by the owner on 2026-09-28 as proposed:**

| Where | Today | Proposed (EN / NL) |
|---|---|---|
| Primary button | *New Migration* | *Start a migration* / *Migratie starten* |
| Wizard steps | *Source · Target · Migration · Review* | *Who · From · What · To · Start* / *Voor wie · Van · Wat · Naar · Starten* |
| Source step | *Select Source System* | *Which account are you leaving?* / *Welk account verlaat u?* |
| Target step | *Select Target System* | *Where does it go?* / *Waar gaat het naartoe?* |
| Check button | *Test and save connections* | *Check the sign-in* / *Aanmelding controleren* |
| Schedule | *Sync Schedule* | folded: *How often to look for changes* / *Hoe vaak naar wijzigingen kijken* |
| Menu | *Connections* / *Verbindingen* | *Accounts* / *Accounts* (D7) |
| Menu | *Tenants* / *Organisaties* | *Team* / *Team* |
| Menu | *Dashboard* / *Overzicht* | gone; Migrations is the landing page (D7) |
| Menu, page, box | *Attention* / *Needs a decision* / *What needs you* | one family: *Needs you* / *Wacht op u* |

Every new word goes into `GLOSSARY.md` first, then `strings.ts`, both languages
(`i18n.unit.test.tsx` checks parity), within 0118's budgets. No Dutch string uses any form of
*verhuizen*, such as *verhuizing* or *verhuist* (D6). A case in `i18n.unit.test.tsx` fails on
`/verhui[sz]/i` in the Dutch dictionary.

(c) **Two guards.**

- **Attributes are read.** `hardcoded-text.unit.test.ts` reads JSX attributes (`placeholder`,
  `aria-label`, `title`) as well as text. It would have caught `placeholder="My Migration"`
  (`CreateMapping.tsx`:2654) and `aria-label="Progress"`.
- **No connection kind is rendered as text.** A new guard reads every page and component for a
  connection kind from `credential-fields.ts` rendered as text rather than through the display
  name.

### T7 — defaults a family can pass (before the first invitation, inside T4)

(a) **Buttons look like buttons.** *Connect with Google/Microsoft/Dropbox* and *Check the sign-in*
are primary buttons, at least 44 pixels tall. A disabled one says why in text under it. That is
0145 T7 (a)'s rule, built for the wizard in #1308 (merged 2026-09-28) with 0145 T5's consent
window opened on the press. This task carries both into the new flow and leaves their guards
where they are.

(b) **A Soverin sign-in shows two fields.** Username and password stay visible. Host, port, the
DAV URL, the mail server and the mail port are prefilled from 0106's measured settings and fold
under *Server settings*. The fold opens by itself when the check fails on a server field.

(c) **A Nextcloud is its address.** The person types `cloud.example.eu`, and the flow derives
`https://cloud.example.eu/remote.php/dav`. The full URL is editable in the fold. The derived URL
is checked by the same probe. A server whose DAV root is elsewhere fails that check with the
field named, never silently.

(d) **Company fields only on the company path.** *Tenant ID*, *Service account key* and the
domain-wide option appear after *"Is this a company account with an administrator?"* is
answered yes. They never appear on a personal Gmail step. 0068 T3's rule holds: the admin
question splits the steps and never hides them.

(e) **The limit is blamed on the side that has it.** A data type the old system cannot give reads
*"Not from Gmail"*. One the new system cannot take reads *"Soverin does not take files"*. Neither
reads *"the selected target protocol"*.

(f) **The step labels are not struck through.** The progress line in the step header runs behind
the labels (`CreateMapping.tsx`:2878-2884), and the audit measured the overlap.

### T8 — the appliance shows its person's page (before the first invitation, D5)

The appliance's landing (`GET /` → `/ui/confirm`) shows the person's page from T5 once every
configured migration has started. It uses the implicit grouping from T2. Until then it shows
Review & confirm, as today. There is no list, no create screen and no *Start a migration* (0034's
standing decision). `apps/web/src/appliance-bundle.unit.test.ts` and `AppRoutes`' edition gating are
updated in the same pull request.

## 4. Order

1. **T1 (a) to (d)**, each its own pull request, now. They fix what is wrong today and do not
   wait for the rest.
2. **T0**, the owner's words and acceptance, with **T2**, the ADR and the tables.
3. **T3**, the list and the menu, with T6's words for them.
4. **T4**, the flow, with T7 inside it and T6's words for it.
5. **T5**, the page per person, with 0154 T1, T2 and T4 filling it.
6. **T8**, then the wizard's retirement (T4's last line).

All of it comes before the first invitation (D5).

**Who builds it (D8).** Session R, as group R8 in 0131 §6, from the drawings in
`docs/design/0152-0154/` and §5 below. R8 starts after R2 and R4 have merged, or stacks on them,
because `CreateMapping.tsx` is in both and `strings.ts` is R1's. The pull request says which
(0131 §6, *Out of turn*). T1 (a) and (d) are already open as #1315 and #1316, from this session.

## 5. The drawings, and how R builds from them (D8)

This session drafted them in [`docs/design/0152-0154/`](../design/0152-0154/README.md). They are
references, not specifications to the pixel.

| Drawing | For | How to build it |
|---|---|---|
| `tiles.svg` | T4's provider and destination tiles, T3's rows | One `ProviderTile` component in `apps/web/src/components/`. It takes a display name from `credential-fields.ts` (`PROVIDER_DISPLAY_NAMES`) and draws the neutral tile in the drawing. The letter comes from a table beside it, never from the kind, so `google_drive` and `gmail` both draw *G*. It replaces 0107 T2's per-provider colours (D4). The tile is `aria-hidden` and the name beside it is text, so a screen reader reads the name once and never the letter. |
| `icons.svg` | Data types on cards, rows and ticks | Six 24-pixel icons (mail, calendar, contacts, files, photos, tasks), drawn with the stroke `lucide-react` uses, so they sit beside the icons the app already imports. Build them as React components in `apps/web/src/components/icons/` from the drawing's paths, with `aria-hidden`. The data type's name is always written beside them. `DOMAIN_STRING_KEY` names them. |
| `wf-migrations-page.svg`, `wf-migrations-phone.svg` | T3 | Layout, order and wording of the list and its top line. Cards stack at 390 pixels. |
| `wf-start-a-migration.svg` | T4, T7 | The six screens in order, with the folds T7 asks for. Each step's gate checks only what it shows (0067). |
| `wf-person-page.svg` | T5, and 0154 T1, T2 and T4 | The stage line, the rows per data type with totals and ranges, and the cutover steps as one list with counts. |

**The first two rows are built** as `ProviderTile` and `DataTypeIcon` / `DataTypeLabel`
(Status, 2026-09-28, night). A redraw changes the drawing and the component in the same pull
request, or `an-icon-drawn-twice` and the tile's colour test fail.

**Colours and type are the app's existing Tailwind tokens.** The one new pair is the site's
`TEAL #0E4F4A` and `MINT #7FD4C1` for the tiles, which 0152 T9 already brings to the sign-in
pages. `a-class-tailwind-draws-nothing-for.unit.test.ts` catches a class that renders nothing.

## Lessons that apply

- **0077, two doors.** The new flow and the four-step wizard read the same card descriptors and
  examples, and the reachability test covers both while both exist.
- **0067, a gate checks only what its step renders.** T4's steps gate on their own fields. The
  *"To continue, fill in"* line never names a field that is not on screen.
- **Hard rule 9.** A person whose migrations could not be read says so. It never shows *"No
  migrations yet"*.
- **Hard rule 10.** A person's state is their migrations' states, shown, never a new state made
  up for the grouping.

## Not in this plan

- **A consent wider than the ticks.** One consent per provider account is already the
  product's (0106 T3b, 0114, ADR-0041), and T4 keeps it that way: each consent asks for the ticked
  data types only (T1 (c)).
- **Mail and files in Google's one consent on a deployment that has not declared the restricted
  scopes.** That needs Google's restricted-scope assessment for the product's own client, which
  is ADR-0041's and 0089 T5's question, not a UX change.
- **Recreating a person's shared mailboxes and groups as part of their migrations.** That is 0027's.
- **Billing per person.** A person is not billed. Paths are (ADR-0014).
- **The site.** That is 0152.

## Open questions

1. ~~**Who builds it?**~~ **Answered 2026-09-28 (D8):** R, as group R8, from this session's
   drawings.
2. ~~**T0 (a):** the word for the person's set.~~ **Answered 2026-09-28 (D6):** *migratie* in
   Dutch, never *verhuizing*. The grouping has no noun on screen.
   - If the owner meant that the grouping itself is called *migratie*, say so, and T3 to T5's
     titles change. Nothing built depends on it yet.
3. ~~**T0 (c):** *Accounts* instead of *Connections*?~~ **Answered 2026-09-28 (D7):** yes.
4. ~~**T3 (b):** does the Dashboard go?~~ **Answered 2026-09-28 (D7):** yes.
