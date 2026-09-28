# Workplan 0153 — One move per person, built from the Migrations page

> **In one line:** The Migrations page lists people's moves: one flow (who, from where, what, to where) moves a person from one or more old accounts to a new home, creates the migrations underneath, and keeps protocols, kinds and ids off screen until needed. Four faults the audit found go first.

## Status — 2026-09-28 (update this block at the end of every session)

**2026-09-28: opened from the owner's request and their answer D1. Nothing is built.** On
2026-09-28 the owner asked for the app to become more intuitive, from a UX and UI point of view.
0152 (the site), this plan and 0154 (progress and proof) were written together from one audit of
`main` at `83eb73e` (§1).

The owner's answer that shapes this plan (§2, D1): *"as 1 (One move per person), but i think
this is simular to the current 'Migrations' page, but just better fitting UX? One can add
multiple migration paths (for example when one person is moving away from Google and Microsoft
and Dropbox)."* So this is not a new product area. It is the Migrations page, grouped by the
person being moved, and a flow that fills it.

D2 puts the minimum before the first invitation (*"Before the first invitation"*). The minimum is
T1 and T3–T7. T8 comes after. 0131 T5 carries a row for this plan (0131's Status block,
2026-09-28).

The audit found four faults that do not wait for the rest. They are T1, one small pull request
each.

| Task | Status | Notes |
|---|---|---|
| T0 The owner's words and the ADR | ⏳ **Owner; before T2** | §3. *Move* / *verhuizing* for the person's set; *migration* / *migratie* for each part. The Dutch site uses *verhuizing* for one migration today. Accept ADR-0050 (T2). |
| T1 Four faults the audit found | 📋 **Proposed; before the first invitation, first** | §3. (a) Review & confirm lists every source's limits on managed. (b) The Gmail app password the guide names is not in the wizard. (c) The Microsoft consent is sent before the data types are chosen (to confirm live). (d) A raw state word on Finish. |
| T2 ADR-0050: a move is a person's migrations | 📋 **Proposed; before the first invitation** | §3. A move row and its members in `packages/managed/migrations`. The appliance answers one implicit move. The billed unit (a path) and the migration (a mapping) do not change. Deleting a move deletes no migration. |
| T3 The Migrations page lists people | 📋 **Proposed; before the first invitation** | §3. One card per move: the person, where from and where to, a row per data type with its state, and a count of what needs them. It becomes the landing page after sign-in. |
| T4 *Move someone*: who, from where, what, to where | 📋 **Proposed; before the first invitation** | §3. Provider tiles with no card preselected. The data types are chosen before any consent. Destinations are suggested per data type, with server fields folded. One review screen holds the green light. The app creates the migrations. |
| T5 A page per move | 📋 **Proposed; before the first invitation** | §3. The person's page: every migration of theirs, the queues with counts, and grant and progress links per person. Progress and proof on it are 0154's. |
| T6 Words a family reads | 📋 **Proposed; before the first invitation, inside T3–T5** | §3. No protocol, kind or id before it is needed. The glossary gains *move*. One word family for *Attention*. Two guards: attributes are read, and no connection kind is rendered as text. |
| T7 Defaults a family can pass | 📋 **Proposed; before the first invitation, inside T4** | §3. Buttons that look like buttons, with the reason in text. A Soverin sign-in in two visible fields. A Nextcloud address, not a DAV URL. Business-only fields only on the business path. The limit blamed on the side that has it. |
| T8 The appliance shows its move | 📋 **Proposed; after the first invitation** | §3. The same page per move, fed by the appliance's one implicit move. No list or create screen (0034 stands). |

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
  (calendars, contacts and tasks), *Gmail*, *Google Calendar*, *Google Contacts* and *Google
  Drive*. Photos come through *Export archive*. The customer guide says mail and files *"come
  through the Gmail and Google Drive cards"* (`docs/guides/en/google.md`:19).
- **One target per migration** (`CreateMapping.tsx`:111). So a person leaving Google for Soverin
  and Nextcloud builds three migrations or more, each through the four steps. Each has its own
  consent, its own progress and its own Finish checklist.

  Measured for Gmail to Soverin plus Drive to Nextcloud: about 19 presses, 9 typed fields, two
  Google consents and two migrations before any data moves.
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
  answered *"Before the first invitation"*. This plan's minimum is therefore T1–T7, built in the
  order in §4. A task the owner wants later can be moved with a dated line here.
- **D3 — A year costs six months.** It does not touch this plan. Billing's own screen shows it
  when 0111 builds annual invoicing.
- **D4 — Names and our own icons.** Provider tiles in the flow are the initial tiles 0107 T2
  built, with the provider's name. No third-party logo is added.

## 3. What each task does

### T0 — the owner's words, and the ADR (owner; before T2)

(a) **The word for the person's set of migrations.** The proposal:

- *move* in English and *verhuizing* in Dutch for the set;
- *migration* / *migratie* for each part, as the glossary has it;
- *path* / *pad* stays the billed unit.

One collision needs the owner's word. The Dutch site already says *verhuizing* for one migration:
*"4 verhuizingen tegelijk"* (`site/copy.mjs`:258, and more). The proposal changes the site's
Dutch to *migraties tegelijk* in 0152 T0, so that *verhuizing* means the person's move
everywhere.

The alternative is to leave the set unnamed and title each card with the person's name. It works
on screen, and it leaves the button to start one without a noun.

(b) **ADR-0050**, drafted in T2, needs the owner's acceptance before T3 builds on it.

(c) ***Connections* or *Accounts* in the menu.**

- The page lists what Ownpace can sign in to, on both sides.
- The proposal is *Accounts* / *Accounts*. A person has accounts; a connection is ours.
- The glossary gains the row either way.

### T1 — four faults the audit found (before the first invitation, first)

Each is its own pull request, each with its own guard. They do not wait for T2.

(a) **Review & confirm shows the rows true of this migration.**

- `ScopeManifestEntrySchema` keeps `appliesTo` and `more`.
- The detail route's answer carries the source's *type*, or `scopeFamilyOf` learns the connection
  kinds. Whichever is chosen, one table maps both, and a test fails when a kind has no family.
- The guard renders `ConfirmMigration` against the real route's JSON shape, not a mock. It
  asserts that a Google Drive migration shows no Microsoft-only row and does show its folded
  *More*.

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
one raw word, fixed now, and T2 of 0145 builds on it.

### T2 — ADR-0050: a move is a person's migrations (before the first invitation)

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

(a) **One card per move.**

- **The person's name.**
- **One line saying where from and where to**, in words: *"From Google and Dropbox to Soverin and
  Nextcloud"*.
- **A row per data type**, one row per path. For example: *"Mail · Gmail → Soverin"*, with its
  state from `StateChip` and 0154's one-line progress.
- **A count of what needs the person:** failures, deletions and moves waiting, and a check not
  yet run. It links the move's page.
- **Primary button *Move someone*,** which opens T4. Each card also has *Add to this move*.

(b) **It is the landing page.** Sign-in lands on Migrations. The Dashboard's tiles become one
line at the top of the page: *"2 moves · 1 needs you"*. The Dashboard route redirects there, so
old links still work. Its *Quick Actions* go, because the page's own buttons are those actions.

(c) **The menu,** managed, for a member:

- Migrations
- Attention, with a count
- Accounts (T0 (c))
- Help: *Setup checklist* and *Setup guides* as two tabs of one entry
- Team (was *Tenants*; T6)
- Billing

The operator's menu does not change. `components/Layout.unit.test.tsx` and `AppRoutes.unit.test.
tsx` are updated in the same pull request.

(d) **The list stays a list.**

- On a phone each card stacks, and its actions have names and targets a thumb can hit, as 0145 T7 (b) asks for the Migrations rows.
- The empty state says what to do first, in one sentence, with *Move someone*.
- A failed read shows as a failure, not an empty list (hard rule 9; `test/ui/managed-ui.ui.test.
  ts` already asserts it for migrations, and it is extended to moves).

### T4 — *Move someone*: who, from where, what, to where (before the first invitation)

One flow of five screens. Each starts at the top with focus on its heading, as 0145 T3 built for
the wizard.

1. **Who is moving?** A name, and *"Myself"* or *"Someone else"*. For someone else, the flow
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
   - Per provider, the consents and sign-ins the ticks need. For Google today that can be up to
     three consents: mail, files, and calendar with contacts. The screen says how many before the
     first. A combined consent is not in this plan (§*Not in this plan*).
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

   Nothing copies before *Start*. After it, the person lands on the move's page (T5), as 0013 T6
   planned.

**Underneath,** the flow creates one migration per pair of old and new account, holding the
ticked data types, named *"{person} — {provider} to {destination}"*. It adds them to the move.
The schedule is daily at 02:00, the default today, and can be changed on the migration later (T5).

**The four-step wizard stays reachable** as *Add one migration by hand* on the move's page and on
Migrations. It stays until the reachability test (`CreateMapping.reachability.unit.test.tsx`)
passes for every card through the new flow. Then its retirement is a line in this plan and a
pull request of its own. Two doors while one is new is 0077's lesson: both read the same card
descriptors and examples.

### T5 — a page per move (before the first invitation)

`/moves/:id` holds:

- the person's name;
- where from and where to;
- the rows per data type (0154 T1 and T2 fill them);
- the cutover steps as one list with counts (0154 T4);
- grant links and progress links, **per person**. A person grants their own accounts, so the
  links belong here, not on each migration. They show only for *"Someone else"*;
- *Add to this move*.

Each migration keeps its page (`/mappings/:id`) for its run history, its data types, its schedule
and its settings. The move's page links each one as *Details*. The seven queue pages keep working
per migration. The move's page shows their counts summed across the person's migrations, and
links each migration's page.

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
| Wizard steps | *Source · Target · Migration · Review* | *Who · From · What · To · Start* / *Wie · Van · Wat · Naar · Starten* |
| Source step | *Select Source System* | *Where are you moving from?* / *Waar verhuist u vandaan?* |
| Target step | *Select Target System* | *Where does it go?* / *Waar gaat het naartoe?* |
| Check button | *Test and save connections* | *Check the sign-in* / *Aanmelding controleren* |
| Schedule | *Sync Schedule* | folded: *How often to look for changes* / *Hoe vaak naar wijzigingen kijken* |
| Menu | *Tenants* / *Organisaties* | *Team* / *Team* |
| Menu, page, box | *Attention* / *Needs a decision* / *What needs you* | one family: *Needs you* / *Wacht op u* |

Every new word goes into `GLOSSARY.md` first, then `strings.ts`, both languages
(`i18n.unit.test.tsx` checks parity), within 0118's budgets.

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

### T8 — the appliance shows its move (after the first invitation)

The appliance's landing (`GET /` → `/ui/confirm`) shows the move's page from T5 once every
configured migration has started. It uses the implicit move from T2. Until then it shows Review
& confirm, as today. There is no list, no create screen and no *Move someone* (0034's standing
decision). `apps/web/src/appliance-bundle.unit.test.ts` and `AppRoutes`' edition gating are
updated in the same pull request.

## 4. Order

1. **T1 (a) to (d)**, each its own pull request, now. They fix what is wrong today and do not
   wait for the rest.
2. **T0**, the owner's words and acceptance, with **T2**, the ADR and the tables.
3. **T3**, the list and the menu, with T6's words for them.
4. **T4**, the flow, with T7 inside it and T6's words for it.
5. **T5**, the page per move, with 0154 T1, T2 and T4 filling it.
6. **After the first invitation:** T8, and the wizard's retirement (T4's last line).

**Who builds it** is open question 1. The files overlap group R's (0131 §6): `CreateMapping.tsx`
in R2 and R4, and `strings.ts` in R1. Whoever builds it starts after R2 and R4 have merged, or
stacks on them, and the pull request says which (0131 §6, *Out of turn*).

## Lessons that apply

- **0077, two doors.** The new flow and the four-step wizard read the same card descriptors and
  examples, and the reachability test covers both while both exist.
- **0067, a gate checks only what its step renders.** T4's steps gate on their own fields. The
  *"To continue, fill in"* line never names a field that is not on screen.
- **Hard rule 9.** A move whose members could not be read says so. It never shows *"No
  migrations yet"*.
- **Hard rule 10.** A move's state is its members' states, shown, never a new state made up for
  the move.

## Not in this plan

- **One consent covering Gmail, Drive and the Google account together.** It would mean one token
  with every scope, which is wider than each connector needs. That is a least-privilege question
  for its own ADR, not a UX change.
- **Recreating a person's shared mailboxes and groups as part of a move.** That is 0027's.
- **Billing per move.** A move is not billed. Paths are (ADR-0014).
- **The site.** That is 0152.

## Open questions

1. **Who builds it?** Session R owns the tester-facing files (0131 §6). Is it R, after R2 and R4,
   or a third session with the owner's word?
2. **T0 (a):** *move* / *verhuizing* for the person's set, with the Dutch site changed to
   *migraties tegelijk*? Or no noun, with the person's name as the title?
3. **T0 (c):** *Accounts* in the menu instead of *Connections*?
4. **T3 (b):** does the Dashboard go, as proposed, or stay as a second page?
