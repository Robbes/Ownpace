# Workplan 0153 — One move per person, built from the Migrations page

> **In one line:** The Migrations page lists people: one flow (who, from where, what, to where) takes a person from one or more old accounts to a new home and creates their migrations underneath, and protocols, kinds and ids stay off screen until needed. Four faults the audit found go first.

## Status — 2026-09-28 (update this block at the end of every session)

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
| T1 Four faults the audit found | 🟡 **(a) in #1315 and (d) in #1316, each proved by its guard; (b) and (c) proposed; all before the first invitation** | §3. (a) Review & confirm listed every source's limits on managed. (b) The Gmail app password the guide names is not in the wizard. (c) The Microsoft consent is sent before the data types are chosen (to confirm live). (d) A raw state word on Finish. |
| T2 ADR-0050: a move is a person's migrations | ✅ **ADR-0050 accepted 2026-09-28 (#1327), amended the same night: *person*. The tables and `/api/people` built, with the appliance's implicit person (#1332)** | §3. A `person` row and `person_migration` in `packages/managed/migrations` (0031). The appliance answers one implicit person. The billed unit (a path) and the migration (a mapping) do not change. Deleting a person deletes no migration. |
| T3 The Migrations page lists people | 📋 **Proposed; before the first invitation** | §3. One card per person: their name, where from and where to, a row per data type with its state, and a count of what needs them. The landing page after sign-in; the Dashboard goes (D7). Drawing: `wf-migrations-page.svg`, `wf-migrations-phone.svg`. |
| T4 *Start a migration*: who, from where, what, to where | 📋 **Proposed; before the first invitation** | §3. Provider tiles with no card preselected. The data types are chosen before any consent. Destinations are suggested per data type, with server fields folded. One review screen holds the green light. The app creates the migrations. Drawing: `wf-start-a-migration.svg`. |
| T5 A page per person | 📋 **Proposed; before the first invitation** | §3. Every migration of theirs, the queues with counts, and grant and progress links per person. Progress and proof on it are 0154's. Drawing: `wf-person-page.svg`. |
| T6 Words a family reads | 📋 **Proposed; before the first invitation, inside T3–T5** | §3. No protocol, kind or id before it is needed. *Accounts*, *Team*, and one word family for *Needs you*. Two guards: attributes are read, and no connection kind is rendered as text. |
| T7 Defaults a family can pass | 📋 **Proposed; before the first invitation, inside T4** | §3. Buttons that look like buttons, with the reason in text. A Soverin sign-in in two visible fields. A Nextcloud address, not a DAV URL. Business-only fields only on the business path. The limit blamed on the side that has it. Tiles and icons: `tiles.svg`, `icons.svg`. |
| T8 The appliance shows its person's page | 📋 **Proposed; before the first invitation (D5)** | §3. The same page, fed by the appliance's one implicit grouping. No list or create screen (0034 stands). |

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

(b) **The words proposed:**

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
