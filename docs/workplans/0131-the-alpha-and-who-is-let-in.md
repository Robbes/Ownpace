# Workplan 0131 — The alpha, and who is let in

> **In one line:** Umbrella for the managed alpha: its decisions (free, invite-only, Dutch, no backups), an alpha note on pages and grant mail, experimental labels on `SOURCE_CARDS`, Billing wording, end-of-alpha fate, go/no-go list for 0132 to 0149.

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24, night: open question 7 answered; the Billing line and the invoice details card say the
free tier's sentence.** The owner: *"Billing: show the free tier's 'not needed' text instead, also
in the seconde sentence"*, and, asked which wording, chose the free tier's text verbatim over an
alpha variant. So during the alpha the invoice details card shows `billing.party.notNeeded` on every
tier, *"Not needed while your tier is free: nothing is invoiced."* / *"Niet nodig zolang uw pakket
gratis is: er wordt niets gefactureerd."*, where a paid tier showed the amber ask; the form stays.
And the Billing line's second sentence is that same key: *"Nothing is charged during the alpha. Not
needed while your tier is free: nothing is invoiced."* The eighteen-word sentence,
`billing.alpha.measured`, and its `ALLOWED_OVER` entry are gone, so the line fits the copy budget. A
viewer or member, who is shown neither figures nor the form, still reads the first sentence alone.
On the same branch; the guard gains a case for the card on a paid tier (it fails with the card's old
condition) and its control half now holds the amber ask without the setting.

**2026-09-24, build: T3 (a) built on branch
`claude/ownpace-public-readiness-y7orc6-a-bill-nobody-will-send`, stacked on T1 (a)'s branch, not
merged.** With `OWNPACE_STAGE=alpha`, the Billing page's subtitle gives way to §3's line, in
English and Dutch, word for word: *"Nothing is charged during the alpha. What you see here is
measured so you can see how it works; it is not a bill."* The request form keeps its package
question, and the question's hint ends with the line's first sentence. Both read T1's `isAlpha()`,
so there is no second setting, and neither shows on the appliance. `main` now carries 0109 T8,
*Tiny is free*: on Tiny the tier block says *"Free: nothing is invoiced on this tier"* and the
invoice details card asks for nothing. The line stands above that unchanged, and the two agree.
The alpha's word is *charged*, as T1's note says it, and a tier's is *invoiced*; the glossary
gains a row for the difference. On a paid tier the block keeps its prices, as §3 says. A viewer or
member is shown no figures, so their Billing page carries the first sentence alone. The second
sentence is eighteen words in English and seventeen in Dutch, over the copy budget (0118). It
stays verbatim and is named in `ALLOWED_OVER`, as `alpha.note.terms` is. §3 gives the hint's
sentence in English only; its Dutch is the Billing line's first sentence, from the same key. The
guard, `apps/web/src/pages/a-bill-nobody-will-send.unit.test.tsx`, has 21 cases. 8 of them failed
on the unchanged code, and each of 7 mutations made at least 2 fail. With the setting on, it says
nothing about the four metered cards: hiding them is **Proposed**, and with them hidden the guard
still passes. Leaving run rows unpruned is **Proposed** too, and nothing here touches retention.
The build review adds three things. First, on a paid tier the invoice details card still shows the
amber *"Not provided yet. Invoices cannot be issued until this is filled in."* under the alpha
line. That asks the tester to fill the form in, which contradicts §3's *"the alpha asks nobody to
fill it in"*, and most testers will see it: Tiny carries one path, so moving two data types lands
on a paid tier. The code is left as §3 says, and open question 7 asks the owner. Second, the
second sentence is in `ALLOWED_OVER` on the authority of §3's Decided text, not of 0118's rule for
consent, safety and remedy sentences, since its first clause explains; open question 7 asks about
that too. Third, the request hint on screen is now `access.tierHint` and the new sentence in one
paragraph: 21 words in three sentences, where each key alone is within budget.

**2026-09-24, build review: T2 (a) fixes on the same branch
(`claude/ownpace-public-readiness-y7orc6-a-card-that-says-it-is-unproven`), not merged.** Two
reviewers read the build, and main was merged in (its T1 (a) notes and 0148 D11 are kept below,
newest first). The Connections page now shows the whole-domain option's why too, in a fold beside
the service-account key and outside its label, so both doors say the same thing about it; before,
only the wizard did. That why now names the option as the fold it joins does: *Domain-wide
delegation* / *Domeinbrede delegatie*, not *Whole-domain delegation* / *Delegatie voor het hele
domein*. The Dutch whys say *Houd uw oude account aan*. The web guard gains a case and asserts
more. It checks the card's accessible name as well as its text, at both doors, in the data-type
step and on the service-account key's box. Before, a tag hidden from a screen reader passed all 30
cases, and with `aria-hidden` on the tag 21 of 31 now fail. It pins the words *Experimental* and
*Experimenteel* and §3's English why as literals, because a Dutch door showing the English word
passed every case. It also finds the Connections fold beside the box. On the unchanged code, 1 of
its 31 cases fails (the Connections fold). The Dutch word set to the English one fails 1, and the
fold moved inside the label fails 1. `FrontDoorChooser`'s comment no longer claims a row of cards
stays one height with a fold under one of them: a tagged card's button ends a fold's height above
an untagged neighbour's. 0141's Status records that the Google account's file face is the
builder's addition to §1's proven list, put to the owner.

**2026-09-24, build: T2 (a), the table and the *Experimenteel* tag, built with 0141 T1 on branch
`claude/ownpace-public-readiness-y7orc6-a-card-that-says-it-is-unproven`, not merged.**
`SOURCE_PROOFS` in `packages/shared/src/front-door.ts`, beside `FRONT_DOOR_FAMILIES`, holds a
verdict for each source kind and, for the four account kinds, one for each face. A proven verdict
names its row in the new "Live proofs" section of `docs/feature-matrix.md` (0141 T1). The tag,
*Experimental* / *Experimenteel*, is text inside the card's `<button>` at both doors
(`FrontDoorChooser`, which now takes the side it draws, so a target card is never tagged: open
question 5). Its why folds beside the card, through `Hint`, whose line may now be left out for
this. The data-type step tags an experimental face the same way, and the service-account key, the
whole-domain option on the Google cards, carries the word in its label and the why in its fold.
Both editions, and nothing is hidden on either: the export archive card stays at both doors on
managed and carries the tag there (0148 D10), and so does *Via IMAP* (0148 D5). The first content
follows §1's list, read with 0141 §1's table: experimental are every Microsoft 365 face, *Via
IMAP* and *Via the Graph API* (no run behind the matrix's ✅ is recorded; 0148 D5), Dropbox, Box,
the Apple account, Google Tasks, whole-domain delegation, the export archive (a fixture Takeout
only) and Soverin as a source (not offered). Proven are IMAP (a server we run), the four Google
product cards and the Google account's calendar, contacts and files. The Google account's mail
face is experimental: no run through the account is recorded. The guards:
`apps/web/src/components/a-card-that-says-it-is-unproven.unit.test.tsx` failed 28 of its 30 cases
on `main` and passes 30 of 30. Ten of them look for the export archive and *Via IMAP* by name on
the screen, at both doors, on a managed build as on the appliance, in English and Dutch, and ask
that each is offered and tagged. `packages/orchestration/src/a-face-that-arrives-without-a-verdict.unit.test.ts`
failed 5 of 5 and passes 5 of 5. Each of ten mutations fails one of them: the fold moved inside
the card's button, the chooser tagging whatever the side, no tag in the data-type step, an account
card tagged when any one face is experimental, the whole-domain tag dropped on the Connections
page, the tag an icon with no word, Microsoft To Do without a verdict, the archive card left out
of both doors' lists on managed (4 of 30 fail, and only the new cases: the walks over the lists
stay green), the archive's tag dropped on managed only (9 of 30), and the archive's verdict set to
proven (10 of 30, and 0141 T1's guard). 0141 T1's guard is in 0141's Status. Not built: (b), the
why's link to 0144 T2's known-limitations page. 0136 T5, the managed API refusing a typed disk
path, and 0148 T3's *to be tested* tag on the Apple export are separate steps. Found while writing
the guard, not fixed: the wizard's `sourceKindOf` answers `o365` for `microsoft`, `apple` and
`archive`, so a stored connection of those kinds is never offered for reuse on the source step.

**2026-09-24, build review: T1 (a) fixes on the same branch
(`claude/ownpace-public-readiness-y7orc6-the-alpha-said-out-loud`), not merged.** Two reviewers
read the build, and this note replaces two statements in the build note below. First, the Dutch
middle sentence is §3's draft again, word for word: *"Er wordt niets in rekening gebracht, er
worden geen back-ups gemaakt en de alfa kan stoppen."* It is sixteen words, one over the copy
budget, and it stays long because 0118 records that safety sentences are not shortened; the
budget's `ALLOWED_OVER` names `alpha.note.terms` with that reason. Second, "every signed-in page"
now includes `/invitations`, which sits outside `Layout` (0099). An invited member never passes
`/request-access` and never receives the grant mail, so the note stands under that screen's
title. `/request-access` also keeps the note after the request is sent. The web guard covers
both, on, off and on the appliance (39 cases, 6 of which failed before the change). The grant
route's call to `accessGrantedEvent` is now held too.
`apps/api/src/routes/access-request-grant-alpha.unit.test.ts` drives the real route against
PGlite and reads the mail the transport is handed. With the route's old inline event it fails 2
of 5. `an-alpha-both-halves-know-about` also refuses an `access_granted` event written anywhere
else in the API. The glossary gains *alpha* / *alfa*. Whether invitations stay open during the
alpha is still open question 6; the note only makes sure an invited member is told.

**2026-09-24, build: T1 (a) built on branch
`claude/ownpace-public-readiness-y7orc6-the-alpha-said-out-loud`, not merged.** One setting,
`OWNPACE_STAGE`, empty by default, so the note is off unless a deployment sets it. `managed.yml`
passes it to the API, and to the web build as the build argument `VITE_OWNPACE_STAGE`, which
`apps/web/Dockerfile` declares; Vite exposes only `VITE_` names. `managed.env.example` and step 8g
of `docs/managed-bring-up.md` say how to switch it on. With `OWNPACE_STAGE=alpha`, the note stands
at the top of every signed-in page (`Layout.tsx`, above the pause banner) and under the title of
`/login` and `/request-access` (`AlphaNote.tsx`), in the pause banner's amber `role="note"` shape.
The access-granted mail ends with the same words as a paragraph of its own (`accessGrantedEvent`
in `apps/api/src/access-notify.ts`, `grantedAlpha` in `notifications.ts`). Both are in English and
Dutch. The appliance never shows the note, whatever its bundle was built with
(`apps/web/src/services/stage.ts`). The three guards §3 names are in place, and each failed on the
unchanged code: `an-alpha-said-out-loud.unit.test.tsx` 12 of 25, the mail's test beside
`notifications.ts` (`a-grant-mail-that-says-alpha.unit.test.ts`) 4 of 7, and
`scripts/an-alpha-both-halves-know-about.unit.test.ts` 8 of 14. Two things differ from §3's draft.
The Dutch middle sentence reads *"Niets wordt in rekening gebracht, …"*, because the draft's
sixteen words are one over the copy budget (0118). The mail carries the note's three sentences as
one paragraph rather than one sentence, so the pages and the mail say the same words, and a test
holds them together. T1 (b), the links to the alpha conditions and the tester guide, waits on 0139
T2 and T10 and on 0144 T1; `AlphaNote.tsx` and the mail's paragraph mark where they go. The site
build's half is 0144 T1's guard.

**2026-09-24, night: the export read from the tester's own files (0148 D11).** The owner answered
0148's open question 6: *"the wizard should be able to read a Takeout export from a folder in the
tester's Nextcloud or other target files-kind supporting target."* So the archive card gains a way
to complete on managed: the export in a folder of the migration's own Nextcloud or WebDAV files.
0148 T9 builds it in R2, stacked on 0136 T5 (§6), and T5's row for 0148 names it. The card keeps
T2's tag until 0141 records a run.

**2026-09-24, night: the archive card is labelled, not hidden (0148 D10).** The owner: *"Hide the
archive card on manage: I don't want them hidden. I want labelled as 'expirimental'."* So T2's table
gives the export archive card the *experimental* verdict, and it keeps its place at both doors on
managed. Open question 4 is answered a second time, the other way. 0136 T5, the managed API refusing
a typed disk path, moves into the minimum with it, and joins R2 in §6. T5's row for 0148 and §6's R2
say so.

**2026-09-24, evening: the plans are being built, in fourteen groups split between two sessions
(§6).** The owner answered how: *"One PR per task"*, the order *"3 (tester-facing) then 1
(safety/foundation) then 2 (live)"*, and *"Yes, but create logical groups you can stack, and
devide between you and the other session."* §6 lists each group as a stack of pull requests, and
which session builds it. What a tester meets (R1 to R5) comes first; the engines and the
operator's side (M1 to M5) are built beside it by the other session; `ownpace-live` itself (R7)
and the identity provider (M7) come last. T5's list is unchanged: it still says what must be true
before the first invitation, whoever builds it.

**2026-09-24: opened from the owner's answers.** A read-only readiness review on 2026-09-23
listed what stands between the managed edition and a small public test: eleven groups of
blockers and a set of questions. The owner answered them on 2026-09-24 and asked that the test be
called an **alpha**. This plan is the umbrella for it. It records the decisions that shape the
alpha as a whole (§2, D1–D7), holds the three small builds that follow from them (T1–T3), asks
what happens when the alpha ends (T4), and keeps the list of what must be true before the first
invitation goes out (T5). The work itself is split over nine plans opened the same day, 0132 to
0140. Nothing in this plan is built. A few fixes it depended on were drafted in the consistency
PR, #1137. It merged on 2026-09-24, and each fix is named where it occurs.

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137
merged.** Testers now use a second stack, `ownpace-live`, on the production names, while the OTA
stack stays CI's and the demo's (D3), so the nightly gate no longer reaches testers' data and open
question 2 is answered. T5's 0132 row is now 0132's new minimum, the fixes #1137 carried are
marked done where they occur, and §5 says which further work the owner had written up as 0141 to
0147.

**2026-09-24, cross-plan review: 0141 to 0147 are in T5 and §5.** T5 gains a row for each of
0141 to 0147, taken from that plan's own alpha minimum; 0142, 0143 and 0146 drafted their rows in
their §4. §5's summaries now say what those plans carry. Open question 3 is now one question with
0141's open question 1, which recommends the other answer. T1 and T2 take up what 0144 and 0145
ask of them: the note also links the tester guide, the site build receives the setting, and the
experimental tag stays text inside the card's button with its fold beside the card. 0130's row
records that the managed API is handed the helpdesk settings on this branch (2c564a5), not yet on
`main`. §1's gate failures of 21 to 23 September were re-checked in 0141 §1.

**2026-09-24, later still: W15 and W18 opened as 0148 and 0149, and the owner's three checks
recorded.** In one message the owner answered the three things there were to check, W15 in four
points, and W18. W15 is now 0148, *A guide written for the person using it*, and W18 is 0149,
*Removal fails closed, and reads stay reads* (§5). T5 gains a row for each, from that plan's own
alpha minimum. 0148 D3 answers open question 4: the export archive card is to be hidden on managed,
so T2's "Appliance only" tag is dropped. Under 0149 D1, *apply deletions* stays on offer during the
alpha. That answers 0144's open question 3 against its recommendation to leave the switch off, so
removal has to fail closed before the first invitation (0149 T1 to T3). T5's 0132 row now says that
the owner sets live's database passwords in its `.env` before the first bring-up (0132 D8) and that
every network live joins is its own (0132 D9). Its 0140 row now gives what the one Google client
holds, as the owner read it in the console (0140 D5). The owner's own steps follow both. 0149 D2
decides 0009's section headed T9, and 0009's Status block carries a dated note of it, so T5's 0147
row and §5's W19 entry say so.

**2026-09-24, cross-plan sync: 0148's and 0149's open questions answered.** The owner answered
0148's five and 0149's first two. T5's 0148 row now keeps *Via IMAP* on managed, tagged
experimental until the owner's run is recorded (0148 D5), and asks for every guide in Dutch and
English (0148 D8). Its 0149 row says that removal refuses a row without a version while a rewrite
of it goes ahead (0149 D3). §5's entries say the same, and that the owner confirmed 0149's reading
of the gate answer.

| Task | Status | Notes |
|---|---|---|
| T1 The word "alpha" wherever a tester meets the service | 📋 **Decided 2026-09-24** (D1, D4). (a) 🔨 **Built on branch `claude/ownpace-public-readiness-y7orc6-the-alpha-said-out-loud`, not merged.** (b) 📋 waits on 0139 T2, T10 and 0144 T1 | §3. A note on every signed-in page, on the sign-in and request pages, and one sentence in the grant mail, in Dutch and English. Managed only. Off unless the deployment sets it. (a) is the setting, the note and the mail's paragraph; (b) is their links to the conditions and the tester guide. |
| T2 An "experimental" label on sources nobody has run against a real account | 📋 **Decided 2026-09-24** (D6) | §3. One table in shared, read by both doors and by the wizard's data-type step. Both editions. |
| T3 Billing says nothing is charged during the alpha | 📋 **Decided 2026-09-24** (D1). (a) 🔨 **Built on branch `claude/ownpace-public-readiness-y7orc6-a-bill-nobody-will-send`, not merged**: the Billing line and the request hint, and the invoice details card's *not needed* during the alpha (open question 7, answered). The cards and the run rows stay 📋 **Proposed** | §3. One sentence on the Billing page and one on the request form. Hiding the four metered cards, and leaving run rows unpruned for the alpha, are **Proposed**. |
| T4 What the end of the alpha does to organisations, credentials and identities | ⏳ **Owner** | §3 and open question 1. What exists today, three options, one recommended. |
| T5 Go/no-go before the first invitation | 📋 **Proposed** | §3. For each of 0132–0149, 0093 T2c and 0130, the minimum that must be true, plus the owner's own steps. |

## 1. What there is today

Each fact below was checked at the current checkout on 2026-09-24. Where a fact comes from the
review and was not re-checked here, it says so.

**Nothing tells a tester it is a test.** No string in `apps/web/src/i18n/strings.ts` or
`packages/shared/src/notifications.ts` calls the service an alpha, a beta, a trial or a test.
"Alpha", "beta" and "trial" do not occur at all, and "test" occurs only for testing a
connection. The request page's introduction (`access.intro`) says *"Invite-only for now: tell us
what you want to move, and we will email you."* The grant mail's subject is *"Ownpace — your access is ready"*, and its body
does not mention a test. The website's front page says *"From … for the first month. Prices
published in full — no quote, no sales call."* (`heroFine` in `site/copy.mjs`).

**Billing shows prices, and nothing can charge.** `POST /api/billing/invoices/generate` answers
`409 billing_model_retired` to every owner or admin who calls it (`NO_TIER_BILLING_CODE` in
`apps/api/src/routes/billing/no-bill-we-do-not-sell.ts`), and no worker job issues an invoice.
`managed.env.example` says to leave
`MOLLIE_API_KEY` blank *"until billing is wired end-to-end"*. The Billing page
(`apps/web/src/pages/Billing.tsx`) is in the managed menu for owners and admins, and it still
reads like a bill:

- its subtitle is *"Manage your subscription, usage, and payments"*;
- four cards show Storage, Data Transfer, Compute Time and API calls. The first three are the
  quantities the metered model priced before ADR-0014 replaced it with tiers, and the fourth is a
  count from the same metering;
- the tier block shows the tier's set-up fee and monthly price.

The terms (`site/legal/terms.md` §8) say *"Billing is **monthly in arrears** … through our
payment provider Mollie."*

Billing nothing has one side effect. Managed retention prunes a tenant's run rows only as far back
as its newest issued invoice, and *"a tenant with none is skipped entirely, keeping all of its
runs"* (`apps/worker/src/jobs/managed-retention.ts`). Run logs (`run_event`) are pruned
regardless. So in a free alpha, no tenant's run rows are pruned.

**Unproven sources look like proven ones.** Both doors read one list of cards, `SOURCE_CARDS` in
`apps/web/src/components/front-door-cards.ts`. The wizard reads it through
`migratableSourceCards()`, and the connections page through `frontDoorCards()`.
`FrontDoorChooser` renders a name and a hint, and says nothing about proof. Whether a source has
met a real account is written down in two places, and the screen reads neither:
`docs/feature-matrix.md` (the ⏳ marker) and, for CI, `scripts/connector-coverage.unit.test.ts`
(driven, owed or uncoverable). By the matrix, the following are built but have not yet run
against a real account:

- the Microsoft 365 account's calendar, contacts, OneDrive and To Do faces (`graph-calendar`,
  `graph-contacts`, `graph-drive` and `graph-todo` in `source-face-builders.ts`: *"⏳ wired; a
  live connection Test, no migration measured"*);
- Dropbox and Box (⏳ in the Files table; the gap table at the end of the matrix does not list
  them);
- the Apple account (*"⏳ built, unproven"*);
- the Google account's Tasks face (*"unmeasured against a live account"*, 0126);
- whole-domain Google through delegation (*"⏳ built, awaiting first contact with a real
  Workspace"*, 0053).

Gmail, Google Calendar and Google Contacts are marked ✅, and the matrix says what that covers:
the owner's own Google account, *"not yet against a second one"*. The export archive card is a
different case. A managed pass cannot read a local path (0116 T4: *"a local path can never reach
a managed pass"*), yet the wizard asks for one (`sourceArchivePath` in `CreateMapping.tsx`). The
reader can also open an archive that sits inside the migration's own file target (`where` on the
archive source, 0116 T4), but no control in the wizard sets it; 0116 leaves that to the relay
page, which is not built. So a tester who picks this card on managed cannot get it to work.

**The machine.** The OTA stack (`app.ota.ownpace.eu`, `id.ota.ownpace.eu`) runs on the reference
machine, which is also this repository's self-hosted runner:

- `ci.yml` runs there on a push to `main`, and on GitHub-hosted runners for a pull request
  (`runs-on: ${{ github.event_name == 'push' && 'self-hosted' || 'ubuntu-24.04' }}`);
- the nightly gates `e2e.yml` and `e2e-managed.yml` run there on a schedule.

`e2e-managed.yml` brings the stack up with `bootstrap-managed.sh --from data --with-demo
--no-smoke`, and its header says *"the run recreates the halves it owns: the API, the web app,
the worker image and the seed."* `managed.yml` fixes the names of the compose project
(`ownpace-managed`) and the database container (`ownpace-db`). The review found that the gate
therefore rebuilds the same stack the OTA addresses serve. The same file gives 17 services a fixed
`container_name`, so a second compose project cannot start on the machine while this one's
containers exist (0132 T1). The runbook's own rule is that this
must end first: *"before the first non-demo tenant is onboarded, CI and production must not
share this machine"* (`docs/operator-runbook.md`, "This box also runs CI"). The same item is in
`docs/release.md`'s checklist.

The review also recorded that `e2e-managed.yml` failed its scheduled runs of 2026-09-21, 22 and
23, and that a run started by hand passed on 2026-09-23. 0141 §1 re-read that history from GitHub
on 2026-09-24: scheduled runs #193 to #195 failed, dispatched run #196 passed, and the last green
scheduled run is #191, of 2026-09-20. It gives the review's causes: the tasks' Node 21 for #193 and
#194 (0146 T6), and an API restart in the middle of the run for #195 (0132 §1).

The repository does not settle whether a person off the mesh can reach the OTA addresses.
`docs/google-oauth-verification.md` says *"Anyone not on the mesh gets a timeout"*, and 0091
says *"Routing and TLS are netbird's, not this repository's."* The review's DNS lookup found the
OTA names resolving to the mesh provider's hosted ingress. 0132 T3 establishes which is true, for
these names and for the production names testers will use (D3).

**Letting someone in is already one person's act.** `/request-access` is public and managed-only
(`AppRoutes.tsx`). It stores a request and creates nothing. The operator's access queue
(`AccessRequests.tsx`, 0093 T7) grants or declines each request. Granting creates the
organisation and sends the grant mail (0095), and the person becomes its owner at first sign-in.
`POST /api/tenants` answers 501, so apart from the demo seed the queue is the only way a new
organisation is made.

The queue is not the only way into an organisation. An owner or admin of one can invite anyone
by email address (`POST /api/tenants/:tenantId/members`, `requireRole('owner', 'admin')`); no
mail is sent. The invited person signs in with that address, verified, accepts the invitation,
and is in without passing the queue. 0137 covers what they may then do, and open question 6 asks
whether testers may invite at all.

A request that was granted is purged with its organisation at erasure (`access_request` is in
`PURGED_TABLES` in `offboarding.ts`). An open or declined request names no organisation and is
kept: the application role has no DELETE on `access_request`, and no job removes one.

The form accepts 60 requests an hour, counted per `req.ip`. Since #1137 (merged 2026-09-24),
`managed.yml` passes `TRUST_PROXY` and `ACCESS_REQUEST_MAX_PER_HOUR` to the API. Both are empty
in `managed.env.example`, and with `TRUST_PROXY` empty the API trusts no proxy, so behind an
ingress every caller shares one count until a deployment sets it (`apps/api/src/knock-limit.ts`).
This is 0093 T2c, which the owner deferred on 2026-09-01 until self-service arrives: while
granting is the operator's act, sixty an hour for the whole service is enough. The alpha keeps
granting as the operator's act. The form has no spam protection.

**Ending an organisation has no button.** `POST /api/tenants/:tenantId/close` exists: owner only,
with a window of 0, 7, 30 or 90 days (`CLOSE_WINDOWS_DAYS` in
`packages/managed/src/offboarding.ts`). Nothing in the web app calls it.
`deploy/compose/operator.sh` has no close or erase command, and an operator belongs to no
organisation.

Erasure revokes stored credentials (`packages/orchestration/src/revoke-stored-credentials.ts`)
and purges an explicit list of tables. It does not remove the person's identity at the identity
provider: `offboarding.ts` makes no call to it, and ADR-0042 rules out an issuer-specific API.
Finishing a migration keeps its credentials on purpose (the finish route answers *"Set the
mapping's status back to 'active' to resume"*). Deleting a connection revokes its credential
(`revokeCredentialRow` in `connections.ts`). Deleting a migration removes the row and revokes
nothing, even when the row holds a credential (`apps/api/src/routes/migrations/index.ts`).

For a stop across the whole platform there is the operator hold (managed migration 0023). It
stops the sync tick from starting new passes (`readOpenPause` in `managed-sync-tick.ts`) and
shows every signed-in customer a sentence. A pass a customer starts by hand is not checked
against it: the manual sync route does not read the hold.

**Language.** The app has English and Dutch (`nl` is typed against the English keys), and it
picks Dutch for a Dutch browser. The in-app guides do not have Dutch: `Docs.tsx` serves
`docs/*-setup.md`, and those are English only.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words and the answer as given, typos included. Where
an answer needed a reading, the reading is stated.

**D1 — what the alpha is.** *Is the test free or paid, for how many people, for how long, and in
which language?* — *"Free and invite only. 10 to 20 people max. Dutch."* On the posture of the
test: *"Free. A few weeks. No obligations both sides."* The name comes from the legal question
(D4): *"Alpha"*.

So the alpha is free and by invitation, for at most 20 people, in Dutch, for a few weeks, with no
obligations on either side. Nothing is invoiced: no route or job in the code can issue an invoice
today (§1).

**D2 — who lets people in.** Four answers bear on this:

- *What may a member and a viewer do, and should only owners and admins invite?* — *"I am the
  gate for letting people in the test."*
- *For Google: move the consent client to production, or keep it in Testing with pre-registered
  testers?* — *"Ill add people by hand"*
- *A tester stack separate from CI and the nightly gate, reachable from the internet?* — *"Yes,
  but its a controlled rest. I Let people in and support them. Max 10/20 people"* ("rest" is read
  as "test").
- *The Google client is in Testing, so tokens expire after about seven days* — *"I add people,
  controlled small test Group."*

So the owner grants every organisation from the access queue, adds each tester's Google address
as a test user by hand, and supports the testers directly. The first answer is about who enters
the alpha. One door is not the owner's today: a tester who owns an organisation can invite
others into it without the queue (§1). Whether that stays open during the alpha is open
question 6. What a member or a viewer may do inside a tester's organisation is still open, and
0137 covers it.

**D3 — where it runs.** *Where do testers run, and under which host names?* — *"This machine, ci
states. The OTA address. It's all controlled by me and invite only."* ("ci states" is read as
"CI stays".) On exposure: *Are ports 5432, 3001, 3090, 3443 and 3126 reachable from outside, were
the database passwords changed, and does the live identity provider hold other organisations?* —
*"No, these ports are not reachable outside of private network/NetBird. Usernamea changed. No
other organisations are hosted."*

So the alpha runs on the reference machine, and CI stays on it. The first answer placed it at the
OTA address. Later the same day the owner asked: *"check, can't i just (as a start) host a
'ownpace-live' as production, next to the current 'ownpace-managed' on OTA-domain? What would i
need to do to keep alle seperate from each other?"* The proposal back was to make that the
decision in 0132, with testers on `ownpace-live`. The owner's answer: *"Yes! The spark has a lot
free memory and disk, it will fit."*

Testers therefore use a second compose project, `ownpace-live`, beside the OTA stack
`ownpace-managed` on the same machine, at the production names of 0091: `app.ownpace.eu`,
`id.ownpace.eu` and, for the status page, `status.ownpace.eu` (`docs/status-page.md`). 0091 T4,
*"`app` stays dark until it means production"*, is thereby answered: it now means production.
`ownpace-managed` stays at `app.ota.ownpace.eu` and `id.ota.ownpace.eu`, as the nightly gate's
target and the demo, and CI never touches `ownpace-live`.

The separation is by name on one Docker daemon, not a security boundary: both stacks' Trigger.dev
planes can use the Docker socket, and so can the self-hosted runner (§4). That is accepted for a
hand-picked alpha. A separate virtual machine, or a rootless daemon for each stack, is the step if
the separation must become a boundary. So this still departs from the runbook's rule (§1), which
names a shared Docker daemon as the class of problem. 0132 records the decision and the work that
makes a second stack possible, starting with its T1, since today's fixed container names stop a
second project from starting (§1). It also covers what changes in the runbook and the release
checklist so that neither contradicts this decision.

**D4 — the legal surface comes first.** *A lawyer's pass before the first invitation, or a
labelled beta notice? And can you supply the address, the btw-id and the hosting details?* —
*"Yes before, Alpha, and i can supply."* On the legal blocker: *"I will update"*.

So the lawyer's pass happens before the first invitation, the test is labelled "Alpha", and the
owner supplies the facts the drafts leave as placeholders. 0139 carries this.

**D5 — no backups during the alpha.** *How much loss is acceptable, how fast must service come
back, and where are backups kept?* — *"None during the test"*. On the missing database backup:
*"No obligations during controlled test"*.

So nothing is backed up during the alpha, and testers are told so before they start. 0134 makes
that statement true everywhere the product now suggests otherwise.

**D6 — unproven sources are labelled.** *For sources nobody has run against a real account:
prove them first, hide them, or label them experimental?* — *"Label"*. This is T2.

**D7 — nobody else gets onto the machine.** *If the current stack is reused, its demo secrets
must be rotated* — *"Who would need/het credentials? I aupporrthe test. No one will be added to
NetBird network. Devs need to setup own private test/dev environments. GitHub PRs and git is the
bridge."* ("het" is read as "get", and "aupporrthe" as "support the".)

So no tester, contributor or developer gets a login on the machine, a place on the mesh or a
copy of its secrets. Developers run their own environments, and code reaches the machine only
through a merged pull request. §4 answers the question inside this answer. With `ownpace-live`
(D3), testers are not on the current stack at all: live starts from its own `.env`, and the OTA
stack keeps its secrets as a demo (§4).

**The other answers, and the plans that carry them.**

| Question, in plain words | The answer, as given | Carried by |
|---|---|---|
| Which EU mail relay and sending domain, and does a person read support@? | *"I'll register a ownpace ampt, a todo"*. Read as: the owner will register a mail-sending (SMTP) account for Ownpace, as a to-do. | 0133 |
| Mail must leave the box | *"I will practically forward / help"* | 0133 |
| Close public organisation registration at the identity provider | *"Advice"* | 0135 |
| The database is published with a password the repository contains | *"Ill change user and pass. But not reached from internet."* | 0132 |
| Requests to hosts a tester types (SSRF) | *"Explain risk and Advice"* | 0136 |
| Roles do not restrict writes | *"Explain risk and advice. Are permissions not implemented?"* | 0137 |
| Microsoft: an ADR for the deployment's multi-tenant app, and publisher verification now? | *"Explain"* | 0140 |

## 3. What each task does

### T1 — the word "alpha" wherever a tester meets the service

**One setting, read in three places.** A deployment setting in `deploy/compose/.env` (for the
alpha, `ownpace-live`'s own), unset by default. Its name is for the build to settle;
`OWNPACE_STAGE=alpha` is the working name. `managed.yml` passes it to the web build as a build
argument, as it already does for `VITE_OIDC_ISSUER`. It also passes it to the API service, whose
environment is an explicit list. The third reader is the site build: 0144 T1 hands it to
`node site/build.mjs`, as `OWNPACE_APP_URL` is handed today, and the site renders the tester guide
only while it is set.

It is a build argument, not a value the web app reads from the API, because the request page and
the sign-in page have no session. A note that disappears when a read fails would go silent exactly
when something is wrong. The appliance never sets the setting.

**Where it shows.**

- At the top of every signed-in page, in `Layout.tsx` beside `PlatformPauseBanner`. It uses the
  same amber `role="note"` shape, which the pause banner adopted so that two kinds of platform
  news do not look like two different kinds of thing.
- On `/login` and `/request-access`, under the title.
- In one sentence of the access-granted mail (`access_granted` in `notifications.ts`), in both
  languages.

**What it says.** This is a draft. It must match 0139's alpha conditions once they exist.

- EN: *"Alpha: a small invited group is trying this service out. Nothing is charged, nothing is
  backed up, and the alpha can end. Keep your old account until you have checked what arrived."*
- NL: *"Alfa: een kleine, uitgenodigde groep probeert deze dienst uit. Er wordt niets in rekening
  gebracht, er worden geen back-ups gemaakt en de alfa kan stoppen. Houd uw oude account tot u
  hebt gecontroleerd wat er is aangekomen."*

Once 0139 publishes the alpha conditions, the note links to them in the reader's language. Beside
them it links 0144 T1's tester guide, and the access-granted mail's sentence carries the same
link. The app builds both addresses through 0139 T10's module; until that lands, the mail and the
owner's own invitation carry the guide's link (0144 T1). Writing the tester guide, a
known-limitations page and a close-account screen is not part of T1. They belong to 0144 (W14,
§5).

**Guards.** Each of these fails on today's code:

- `apps/web/src/components/an-alpha-said-out-loud.unit.test.tsx`: with the setting on, `Layout`,
  `Login` and `RequestAccess` render the note in English and Dutch. Without it, none of them do,
  and an appliance build never does.
- A test beside `notifications.ts` in shared: with the setting on, the access-granted mail carries
  the sentence in both languages, and without it the mail does not.
- `scripts/an-alpha-both-halves-know-about.unit.test.ts`: `managed.yml` passes the setting to
  both the web build and the API. Today it passes it to neither. The pattern to follow is
  `a-client-the-worker-never-got.unit.test.ts`.
- The site build's half is 0144 T1's guard, a case in `site/site.unit.test.ts`: with the setting
  the build writes the tester guide, and without it the build does not.

### T2 — an "experimental" label, from one table

**The table.** It lives in `packages/shared/src/front-door.ts`, beside `FRONT_DOOR_FAMILIES`, so
that both doors and the wizard read the same thing. It holds a verdict for each source kind, and
for the account kinds a verdict for each face (the faces `source-face-builders.ts` maps in
orchestration). There are two verdicts:

- **proven**: a complete pass has run against a real account of this kind, and the entry says
  where that run is recorded;
- **experimental**: built, but not yet run against a real account.

Its first content is §1's list. A face moves to proven when its live run is recorded. The live
runs themselves belong to 0141 (W11, §5). The matrix stays the long-form record and
the table is what the screen reads. A change to one goes into the same PR as the matching change
to the other.

**Where it shows.**

- On the card, in `FrontDoorChooser`, so the wizard and the connections page both show it. It is a
  small tag, *"Experimental"* / *"Experimenteel"*, and uses the Hint component's *why* to say:
  *"Built, not yet run against a real account of this kind. Keep your old account and check what
  arrives."* The card is a `<button>`, and 0145 T2 needs two things of it. The tag stays text
  inside the button, never an icon alone, so that a screen reader reads it as part of the card's
  name; 0145 T2's guard checks that name. The Hint's fold sits beside the card, not inside it,
  because a fold inside the button could not be opened on its own. Once 0144 T2's
  known-limitations page exists, the *why* links to it, as 0144 T2 asks.
- In the wizard's data-type step (the domain list in `CreateMapping.tsx`), beside any face of the
  chosen account that is experimental, for example the Microsoft 365 account's calendar.
- Beside the whole-domain option on the Google cards.

**Both editions.** Whether a connector has met a real account is a fact about the connector, not
about the edition. The label therefore also shows on the appliance, which offers the same cards.

**The export archive on managed** is not experimental: as the wizard offers it, it cannot work
there at all (§1). The proposal here was a different tag on managed only, *"Appliance only"* /
*"Alleen op de appliance"*, with the card disabled. The owner chose to hide it instead: *"cards
that cant work: hide on manged"* (0148 D3, where "manged" is read as "managed"). 0148 T3 builds
that, so T2 carries no such tag, and open question 4 is answered.

**2026-09-24, later: labelled after all (0148 D10).** The owner: *"Hide the archive card on manage:
I don't want them hidden. I want labelled as 'expirimental'."* So the archive card is not hidden.
T2's table gives it the *experimental* verdict, and the tag shows on it at both doors, on both
editions. Its why is the general one; that the card cannot complete on managed yet is said by the
refusal 0136 T5 adds, and 0148's open question 6 asks whether the wizard learns the one place a
managed pass can read an export. The owner answered yes the same night: a folder in the tester's
Nextcloud or WebDAV files (0148 D11), built by 0148 T9.

**Guards.** Each of these fails on today's code, because the table does not exist:

- `apps/web/src/components/a-card-that-says-it-is-unproven.unit.test.tsx`: every `SOURCE_CARDS`
  id has a verdict, and every *proven* verdict says where its run is recorded. An experimental
  card shows the tag in the wizard and on the connections page, and a proven card does not.
- In orchestration, beside `source-face-builders.ts`: every face that `everyFaceClaimedBy`
  returns for an account kind has a verdict. This stops a new face from arriving without one.

### T3 — Billing says nothing is charged during the alpha

**The Billing page, when the setting says alpha:**

- The subtitle is replaced, and the page opens with one line. EN: *"Nothing is charged during the
  alpha. What you see here is measured so you can see how it works; it is not a bill."* NL:
  *"Tijdens de alfa wordt niets in rekening gebracht. Wat u hier ziet, wordt gemeten zodat u kunt
  zien hoe het werkt; het is geen rekening."*
- The tier block stays, prices included, under that line. The measurement is one of the things
  worth trying: 0121 T4 records the owner's decision of 2026-09-09 that the customer gets to see
  it. The prices shown are ADR-0014's (`MANAGED_TIERS` in
  `packages/managed/src/tier-calculator.ts`), which `tier-calculator.unit.test.ts` holds to the
  ADR's table and to the site's calculator.
- **Proposed:** the four metered cards are hidden while the setting says alpha. They show the
  quantities of the model ADR-0014 replaced, and on a page that says nothing is charged they look
  like a meter that is running. Whether they go for good is a question for 0121, not for this plan.
- Unchanged: the invoice list, which is empty, and the payment methods, where the page offers
  no way to add one. The *"Invoice details"* form (who invoices are addressed to, with an address
  and a VAT number) also stays as it is; the alpha asks nobody to fill it in, and T1's note says
  nothing is charged.

**The request page.** The package question (*"Which package looks right?"*) stays, because it
tells the owner roughly how large a request is. Its hint gains the sentence *"Nothing is charged
during the alpha."*

**Nothing to build on the server.** The invoice route already refuses every call.
`ownpace-live` keeps `MOLLIE_API_KEY` empty, which is a T5 check.

**Run rows (Proposed).** Accept that run rows are not pruned during the alpha while nothing is
invoiced. The rows grow with every pass, but the growth stops when the alpha ends, and it covers
at most 20 organisations over a few weeks. A retention rule for tenants that are never billed is
0143 T6, 🅿️ **Parked (trigger: the alpha runs past the 60-day run window, or its organisations
carry on after it)**. The run window is 60 days, so nothing a few weeks of alpha writes would be
old enough to prune even with the rule changed, and 0143 T9 measures what the rows cost meanwhile.

**Guard.** `apps/web/src/pages/a-bill-nobody-will-send.unit.test.tsx`: with the setting on, the
Billing page shows the line in both languages and none of the four metered labels. Without the
setting, the page is as it is today; that half is the control. The first half fails on today's
code.

### T4 — the end of the alpha

**What there is to end, for each tester:**

- an organisation and its members;
- migrations that keep running on their schedule;
- stored credentials, on connections and on migration rows;
- an identity at the identity provider;
- an access request;
- a Google test-user entry;
- run history.

Two things are not the service's to end: the copies at the tester's target, which belong to the
tester, and the source account, which no connector writes to.

**The options.**

- **(a) Everything ends.** The owner starts the operator hold, which stops scheduled passes, and
  its sentence says the alpha has ended. A pass a tester starts by hand is not held (§1). Each
  organisation is then closed with a 0-day or short window. The close route stops that
  organisation's passes in flight (`stopPassesInFlight`), and erasure revokes its stored
  credentials when the window ends. The owner deletes each tester's identity at
  `ownpace-live`'s identity provider and removes their Google test-user entry. Testers keep what
  arrived at their targets. *Recommended as the default.* D1's *"No obligations both sides"* is
  only true at the end if none of a tester's credentials is still stored.
- **(b) Everything carries on** into whatever follows, a longer test or the paid service, and new
  conditions are accepted first.
- **(c) Each tester chooses** between (a) and (b), and anyone who does not answer gets (a).

**What (a) needs that does not exist yet.**

- A way for the owner to close an organisation. The close API is for an organisation's own owner,
  and neither the web app nor `operator.sh` offers a path. A close screen is 0144 T8; an audited
  operator command is the smaller build, and 0139 T7 proposes it.
- A runbook step for the identity provider, because erasure does not reach it.
- An answer for credentials whose migration a tester deleted before the end. That row is gone, so
  erasure can no longer revoke its credential, and the delete did not revoke it either (§1). 0139
  T6 proposes that deleting a migration revokes its credential, as deleting a connection does,
  and owns the wording that promises revocation.

Under (a), each tester's granted access request goes with their organisation, because erasure
purges it (§1). A declined request is kept under every option, and nothing removes it. 0139 T6
proposes how long it is kept and what the privacy policy says about it.

### T5 — go/no-go before the first invitation

The first invitation goes out when every row below is either done or has the owner's written,
dated acceptance beside it. The table is the minimum, not the whole plan: each sibling plan
contains more than its row.

| Plan | The minimum before the first invitation | Today |
|---|---|---|
| 0131 The alpha (this plan) | T1 and T3 on `ownpace-live` with the setting on. T2 built. T4 decided, and 0139's conditions say what the end does. Open question 6 answered, and the answer in place. | Nothing built. Any owner or admin can invite by email address (§1). |
| 0132 ownpace-live beside the nightly gate, on one box | 0132's T1, T1b to T1e, and T3 (D3). **T1:** container names, networks and scripts take the stack from `COMPOSE_PROJECT_NAME`, and a guard fails on a fixed stack name and on any hard-coded `ownpace-managed_` name. Every network live's containers join, the one its task runs join included, is live's own and named after it (0132 D9: *"all need to land in their own seperate docker network, with names corresponding with 'ownpace-live'."*). **T1b:** `ownpace-live` has its own checkout and `.env`, fresh secrets from its first bring-up, its own ports and no demo. The owner sets its database passwords in live's `.env` before that bring-up (0132 D8: *"ill set them in .env for the ownpace-live before bringup."*), and its application role is created with its own password before anything migrates, because otherwise the baseline creates it with the repository's literal. **T1c:** its own Trigger.dev plane, never the OTA one. **T1d:** its own identity provider at `id.ownpace.eu`, and a web build that names it as the issuer. **T1e:** the production names routed to live's ports. **T3:** checked from a machine off the mesh, port 443 on the production names answers over TLS, the OTA names answer as 0132's open question 7 decides, and nothing else answers; every port that need not be reachable is bound to loopback in both stacks (T1f). The result is written in 0132. Deploying live by hand from a tag (T1g) goes with 0146. The tag live first runs names a commit on which both nightly gates are green on their last N scheduled runs (0132 T6, step 1). 0141 T14 states that rule: scheduled runs only, since a dispatched run's moment was chosen, and a failed or cancelled scheduled run resets the count. The review suggested five, and the owner names N. The runbook and the release checklist say what D3 decided (0132 T1g). | `managed.yml` pins `name: ownpace-managed` and gives 17 services a fixed `container_name`, and scripts address containers by those names, so a second stack cannot start beside the OTA one (0132 §1). The owner reports the ports unreachable off the mesh (D3). `managed.yml` publishes seven ports (the database, the API, the web app, the status page, the identity provider and two for Trigger.dev) on all interfaces, and `www.yml` the site's, unless the host restricts them. The application role's password is a literal in the shared baseline migration (`packages/ledger/migrations/0001_baseline.sql`), and `ensure-env-secrets.sh` generates neither that password nor the database owner's; `trigger-db`'s password is a literal in `managed.yml` that no `.env` reaches (0132 D8, T2). Compose names the stack's two networks after the project, but the network task runs join is a literal in `managed.yml` (`DOCKER_RUNNER_NETWORKS: ownpace-managed_ownpace-network`), and `ownpace-managed_` names are hard-coded on 13 lines in six files (0132 T1). |
| 0133 Mail that reaches a tester | On `ownpace-live`, one address outside the owner's own domains walks through the request, the grant mail, the identity provider's verification mail and the first sign-in, and every mail arrives in that inbox. SPF, DKIM and DMARC pass for the sending domain. Live's API and its identity provider both send through the relay, the provider with a login: `setup-zitadel.sh` hands it `SMTP_USER` and `SMTP_PASSWORD` since #1137 (merged 2026-09-24). The notice that a request has arrived reaches the owner. | `managed.env.example` defaults `SMTP_HOST` to `mailpit`, and every bring-up starts Mailpit, with or without the demo (`bootstrap-managed.sh`), so mail stays on the box until live's `.env` names the relay. |
| 0134 No backups during the alpha, said truthfully | The alpha conditions, T1's note and the grant mail say that nothing is backed up. Nothing the product shows promises a backup that does not exist. The owner has written down what a lost database costs a tester. | The application database has no backup (review); on `ownpace-live` it will hold the testers' data. The runbook's manual recipe dumps the zitadel database and the roles as well since #1137 (merged 2026-09-24), and says neither dump is usable without the stack's `.env`. |
| 0135 The sign-in page is the front door | Public organisation registration is off at `ownpace-live`'s identity provider (`id.ownpace.eu`), and the setting has been read back; 0135 applies the same to the OTA instance. A user of another organisation cannot sign in to the project. | Open, which is the upstream default (review), so a new instance starts open. The owner reports that no other organisations are hosted on the OTA instance (D3). |
| 0136 A host we are asked to reach | 0136's minimum, after its explanation. A host a tester types is refused before any connection when it resolves to loopback, a private or link-local range, or a compose service name, and redirects are checked too. The Docker networks and their gateway are among the refused ranges, because through them a container can reach the other stack's host-published ports (D3). The alternative is the owner's written acceptance, given in the knowledge that every tester is someone the owner let in. | No check (review). |
| 0137 Roles that mean what they say | A viewer or member cannot delete, cut over, repoint credentials or apply deletions. Until that is built, testers invite nobody below admin, and the conditions say so. An admin cannot invite an owner: done in #1137 (merged 2026-09-24), where the invite route answers 403. | Most writes are open to every role (review, including an integration test that asserts it). |
| 0138 Tasks under row security | Built, or accepted in writing with the reason stated. | Tasks read and write tenant data as the database owner, so row security does not apply in the worker plane (review). |
| 0139 The legal gate for the alpha | The lawyer's pass is done (D4) and the placeholders hold the owner's facts. The alpha conditions are published in Dutch and English: free, no obligations, a few weeks, no backups, and how it ends. The pages describe the service at the production names (D3). The privacy policy and the conditions are linked from the request page and the grant page; since #1137 (merged 2026-09-24) the grant page links to the privacy policy and the terms on `www.ownpace.eu`, in the reader's language. Each tester's acceptance is recorded with the version and the time. | Drafts with placeholders. `site/build.mjs` refuses `--public` while any placeholder is unfilled. |
| 0140 Consent screens a tester can pass | **T11:** `ownpace-live`'s Google client carries live's consent address, `https://app.ownpace.eu/api/migrations/google/callback`, and live's sign-in address only if T10 keeps a Google sign-in. Microsoft and Dropbox know live's redirect addresses (D3), and each reaches its consent screen with the owner's own account. The owner left the Google choice open, *"I'll need to add one for app.ownpace.eu or create a new oauth-client"* (0140 D5); 0140 T11 advises a new client, separate from the OTA stack's test client. **T1**'s measurement and choice, then each tester's Google address a test user for live's client before they connect (T0). **T10** decided: which sign-in buttons live offers. Testers know Google will ask them to reconnect: after about seven days while the client is in Testing, a figure to confirm on Google's pages. A tester with a Microsoft work or school account knows, before pressing Connect, what their organisation's consent policy may do (0140 explains). Dropbox, Box and Apple carry T2's label. | One Google client exists, the test (OTA) client registered on 2026-08-20 (ADR-0041). The owner read its redirect URIs in the console on 2026-09-24: it holds two, both the OTA stack's, the identity provider's sign-in callback at `id.ota.ownpace.eu` and the migration consent's at `app.ota.ownpace.eu`, and no production address (0140 D5). The `/oauth/…` production entry that `docs/google-oauth-verification.md` §4b records for 2026-08-20 is not among them. The client is in Testing (0089 T2 names the seven-day expiry). |
| 0141 Proof before strangers | Before the first invitation: 0141's T1, the "Live proofs" section of the feature matrix that this plan's T2 verdicts point at; T9, the organiser canary; T12's walk with two strangers on `ownpace-live`; T14's rule, read before live's first bring-up from a tag; and T11's true sentence, if a first tester brings a Microsoft 365 account. Before a tester who uses a source is granted, if open question 3 settles that such a tester waits: that source's sitting (0141 T2 the Microsoft 365 account, T3's Dropbox half, T4 Apple, T5 Google Tasks, T7 Soverin as a target, which runs on the OTA stack). Before a tester on a Microsoft card, whatever open question 3 settles: T10's move of shared mailboxes to Partial, or the consent run first, as 0141's open question 4 settles. | Nothing built, and the matrix has no "Live proofs" section. The managed gate's last green scheduled run is #191, of 2026-09-20, so T14's count is 0 (0141 §1). The organiser canary is open (0103 T3). `e2e-o365.yml` has never completed a run, and the live-target lane is green because it stands down. |
| 0142 Alerts someone reads | 0142's T0: its test alert arrived on live, and its recovery too. Its T1 and T2 are on `ownpace-live` with the switch on, and off on the OTA stack. T6, the incident runbook, is in `docs/`. | Nobody is told when the stack, the tick, the disk or a pass fails. `gatus.yaml` has no `alerting` block, the tick records nothing about itself, and outside the workplans `docs/` has no incident procedure (0142 §1). |
| 0143 A box with a known size | 0143's T1, T2a, T3a and T4 are on `ownpace-live`, and live's caps are uploaded. T9 passed with live standing beside the OTA stack, and its numbers and the runway are written in 0143's Status block. T0's final numbers are set. T2d's step for stopping one organisation is in 0142 T6's runbook. | No task names a machine, and nothing caps passes in flight. An organisation sets its own `maxMappings`, and nothing reads it. A file over 8 MB written to a JMAP target fails with *"No content for …"*, and no largest file is stated. The managed stack has never been measured under load (0143 §1). |
| 0144 Saying what is true to a tester | 0144's T0: the address testers write to, and the owner's answer on the site copy. T1's tester guide in Dutch, in its short form. T3's line beside *Connect with Google* and its site copy, and its grant page if testers send grant links (0140 open question 2). T6: a person to write to, before and after sign-in. T7: *Request access* on the sign-in page. | No tester guide. The site and the grant page call the connection *"read-only"* where some of the permissions asked for can write. The pages outside the app name nobody to write to, and `Login.tsx` has no link to `/request-access` (0144 §1). |
| 0145 Phones, screen readers and in-app browsers | 0145's T0, one press of *Connect with Google* on an iPhone, on today's code. T1, the phone menu takes focus and gives it back. T3 (a), each wizard step and each new page starts at the top. T5, the consent window opens on the press itself, with T7 (a). T6, the consent endings in Dutch, and the grant half if testers send grant links. T9 (a), one paragraph in 0144 T1's guide. T10, the walk on two phones, on `ownpace-live`. | Both consent buttons open the window only after an awaited call; whether Safari blocks it is T0's to find out. The closed phone menu stays in the tab order. The grant page's "what will be read" phrase and the consent endings are English only. Nothing checks the app at phone width or in WebKit (0145 §1). |
| 0146 A release testers can name | The alpha tag exists (0146 T0 recommends `v0.2.0-alpha.1`), and its release is published with its images and SBOM. `ownpace-live`'s build stamp and `/api/version` name that tag's version and commit. If the report form is on at `ownpace-live` (this table's row for 0130 allows an address instead), a problem report sent from there carries the build line. The tasks on `ownpace-live` were built on `node-24`: the task deploy's build output names `triggerdotdev/node:24-bookworm`, where run #193's named `node:21-bookworm`. 0146 T0's answers are written in 0146. Also before the first invitation, carried by 0135 T7: the identity provider's release watch and response window. | The only tag is `v0.1.0-rc.1`, of 2026-08-04, and every build since calls itself that. A problem report carries no build. `trigger.config.ts` names no runtime, so the tasks run Node 21 (0146 §1). |
| 0147 An index that writes itself | 0147's T3 (a): three dated notes, on 0009, on 0008 T7 and on 0026 row 14, because the owner reads those plans when deciding go or no-go; 0009's note was written on 2026-09-24, and its table row remains. If the session writing the alpha's plans is not idle by then, they go as their own small pull request. | 0009's section headed T9 was an open owner decision until 2026-09-24. Its Status block now opens with a dated note of the decision (0149 D2 and T4), above *"Nothing open in this plan."*, and its table has no row for it. 0008 T7 is ✅ with no run linked; both runs of `e2e-o365.yml` were cancelled. 0026 row 14 calls publisher verification moot, a premise 0114's deployment registration changed (0147 §1, T3). |
| 0148 A guide written for the person using it | T3: the Apple export tagged *to be tested* on both editions; the export archive stays offered on managed with T2's tag (0148 D10), and 0136 T5 refuses a typed disk path there. 0148 T9: the export read from a folder in the migration's own Nextcloud or WebDAV files (0148 D11). *Via IMAP* stays, tagged experimental until the owner's run is recorded (0148 D5). T2 (a), (b) and (d): where `ownpace-live` carries Google's, Dropbox's or Microsoft's app, no about-line, redirect line, checklist or create refusal tells a tester to create one or register an address on it. T1 and T4 for every card live offers: a customer guide in Dutch and English (0148 D8), served in the app, with no operator material, read by the owner against live's screens (T0). The Microsoft guide carries 0148 T8's two recipes (D5). T6's first half, the parts of the renderer those guides use, and T2 (c). T5's profiles for Apple, Nextcloud and Soverin, and the Google account card's. | The seven served guides are in English and written for operators; no target and not the IMAP source has one. The archive card is offered on managed and asks for a path on the server, which a managed pass cannot read. The wizard's about-lines, the redirect line under its button, the checklist and the create refusals say "your own" whatever the deployment carries (0148 §1). |
| 0149 Removal fails closed, and reads stay reads | 0149's T1 to T5, merged and in the alpha tag `ownpace-live` first runs, so that no row on live is written by the old code: a DAV 412 on create is an adoption (T1), a lookup that fails is not an absence (T2), removal and rewrite carry the version, removal refuses a row without one, and a rewrite of such a row goes ahead (T3, D3), the cutover gate holds when a target that can hash compared nothing (T4, 0009's option 1), and the IMAP source opens folders read-only (T5). T1 to T3 are in the minimum because testers may arm *apply deletions* (0149 D1). The first scheduled run of the appliance nightly after T3 and T4 is green, its three apply legs and its verification leg included, or a red result is explained in writing and dated; the managed smoke's apply half is green on the OTA stack on the same commit. | A 412 on create is recorded `copied`; a failed per-item lookup reads as "not there"; removal and rewrite skip the edit check when no version was recorded; the gate opens when a target that can hash compared nothing; the IMAP source opens folders with SELECT (0149 §1). |
| 0093 T2c The request door | `TRUST_PROXY` and `ACCESS_REQUEST_MAX_PER_HOUR` reach the API (done in #1137, merged 2026-09-24), and `TRUST_PROXY` is set in `ownpace-live`'s `.env` for the ingress that 0132 settles. Spam protection is 🅿️ **Parked (trigger: junk in the queue, or the request address published)**: the owner reads every request, and a decline can be quiet. | Both are empty by default, so every caller shares one count (§1). |
| 0130 A problem report that reaches a person | A tester can reach a person. Either the report form works on `ownpace-live`, with a Zammad configured, or the conditions name an address the owner reads. | Built. On `main`, `managed.yml` does not pass `ZAMMAD_URL`, `ZAMMAD_TOKEN` or `ZAMMAD_GROUP` to the API, whose environment is an explicit list, so on a stack started from `main` the form stays off whatever `.env` says, although step 8f of `docs/managed-bring-up.md` says to set them there. On this branch, with this plan's PR, `managed.yml` passes all three to the API, empty by default (2c564a5, guarded by `scripts/a-helpdesk-the-api-was-never-handed.unit.test.ts`). Whether a Zammad is configured for `ownpace-live` is 0139 T0's fact 3. |

**The owner's own steps.**

1. The lawyer's pass, with the registered address, the btw-id and the hosting details supplied to
   0139 (D4).
2. The mail-sending account, and the DNS records for the sending domain (0133).
3. `ownpace-live` brought up from its own checkout and `.env`, never a copy of the OTA stack's,
   with its database passwords set by the owner in that `.env` before the first bring-up (0132 D8)
   and the application role created with its own password before anything migrates (0132 T1b).
   Every network live's containers join is its own and named after `ownpace-live`, checked as 0132
   T0 step 5 says (0132 D9). D3's answer says the user names are changed, and the answer on the
   database says the user and password will be; that was about the OTA stack, where 0132 T2 changes
   them with `ALTER ROLE`, and 0132 records which of these is done there.
4. Live's own Trigger.dev account, project and access token, and the production names routed to
   `ownpace-live` in NetBird (0132 T1c, T1e). Live's Google client, carrying live's consent
   address, and live's addresses at Microsoft and Dropbox (0140 T11): a new Google client, as
   0140 advises, or live's address added to the one client there is, which the owner's answer
   also allows (0140 D5).
5. For each tester, before they connect: grant their request in `ownpace-live`'s access queue,
   and add their Google address as a test user for live's Google client (D2, 0140 T0).
6. On `ownpace-live`: the alpha setting from T1 switched on, and `MOLLIE_API_KEY` left empty.
7. Name N for the nightly gates (0132 T6, 0141 T14), and answer the open questions below.

## 4. Explaining the risk: who would need the credentials (D7)

The owner asked: *"Who would need/het credentials?"* Nobody. Rotation is not about who will be
given the secrets. It is about copies that already exist outside the owner's control.

- Workplan 0020 records that the stack's generated values (the database password,
  `SECRET_ENCRYPTION_KEY` and a Trigger.dev key) *"have appeared in pasted logs"*. It also says
  that *"trigger runner debug output prints the full task env, so treat runner logs as
  secret-bearing."* 0020 does not say where those logs were pasted. The machine also runs this
  public repository's CI (D3), and a public repository's workflow logs are not private.
- The application role's password is a literal in the shared baseline migration
  (`packages/ledger/migrations/0001_baseline.sql`), which this public repository contains.
  Nothing in the repository changes it (0132 T2), and the baseline creates the role with it on
  every new stack.
- The demo seed (`--with-demo`) creates demo organisations whose credentials are in the
  repository's scripts.

D7 stops new copies from being made. It does nothing about the copies that already exist.

**What D3 changes.** The logged values are the OTA stack's. `ownpace-live` does not inherit them:
it has its own `.env`, and at its first bring-up `ensure-env-secrets.sh` generates fresh values
for the secrets it knows (the signing and encryption keys, Trigger.dev's secrets, the identity
provider's master key and passwords, and the pooler's password). Live is never brought up with
`--with-demo`. So 0026 row 24 closes for `ownpace-live`, which never had demo secrets, and stays
parked with its trigger for the OTA stack, which remains a demo (0132 T5). The script does not
generate the database passwords: the database owner's is whatever live's `.env` says at the first
bring-up, and the application role gets the baseline's literal unless it is created with its own
password before anything migrates (0132 T1b).

**The advice.**

- For `ownpace-live`: copy nothing from the OTA stack's `.env`. Before the first bring-up, set the
  database owner's password in live's `.env`, and ClickHouse's and MinIO's, which
  `bootstrap-managed.sh` reports while they are at their shipped defaults. The owner will set them
  there (0132 D8). Changing the database owner's password once the volume exists changes nothing
  inside it (`bootstrap-managed.sh`). Create the application role with its own password before
  anything migrates (0132 T1b); if the baseline got there first, change it with `ALTER ROLE` before
  the first invitation (0132 T2). Keep live's `SECRET_ENCRYPTION_KEY` as its first bring-up made
  it. Stored credentials are encrypted under that key, and SECURITY.md states there is *"no
  rotation"*: a new key after testers have connected would make every stored credential unreadable,
  and every tester would have to reconnect.
- For the OTA stack: row 24's rotation waits for its trigger. When it fires, re-running
  `ensure-env-secrets.sh`, which row 24 names as the way to rotate, does not do it: the script
  says *"re-running it never rotates anything"*. 0132 carries the steps.

**The bridge D7 names is also a gate.** A pull request runs on GitHub-hosted runners (`ci.yml`),
so a contributor's code does not run on the machine before the owner merges it. After the merge
it does: a push to `main` runs on the self-hosted runner, and the nightly gates build `main`
there. SECURITY.md says of that runner: *"trusted workflows only (docker socket + root = RCE
risk)"*. So the owner's merge is the gate for code, just as the access queue is the gate for
people. The advice is to keep the self-hosted runner off `pull_request` events, as it is today,
and to read any change to `.github/workflows/` before merging it with the same care as a change to
the stack itself. D3's separation is by name on one Docker daemon, so a workflow that runs on that
runner can reach `ownpace-live` as well as the OTA stack.

## 5. Further work, and where it is planned

The review found more than the ten plans above cover, and this section first named the rest W11
to W19 so that they were not lost. On 2026-09-24 the owner chose, item by item: *"W11 write, W12
write, W13 write, W14 write, W15 explaoin, W16 write, W17 write, W18 explain, W19 write"*
("explaoin" is read as "explain"). The seven the owner said "write" to were opened the same day,
each under the next free number. The two the owner asked to have explained were explained, and
later the same day the owner answered both. They were opened under the next free numbers, 0148
and 0149.

**Opened 2026-09-24, at the owner's word "write":**

- **W11 → 0141 Proof before strangers:** live runs of the sources T2 labels, the 0103 organiser
  canary (T9), the 0105 Soverin supervised run (T7), and a browser walk of the managed journey
  (T12). It also moves shared mailboxes to Partial until one is copied (T10), has the detectors and
  the permission report tell a Connect-with-Microsoft tester the true reason (T11), makes the O365
  and live-target lanes count only when they ran the product against a real account (T13), and
  sets the nightly managed gate's readiness rule (T14). Live proofs run on `ownpace-live`. T7 runs
  on the OTA stack, not live: its source is that stack's demo Nextcloud, and the lane it arms reads
  that stack's `.env`. The OTA stack's nightly gate stays the CI signal (D3).
- **W12 → 0142 Alerts someone reads:** somebody is told when the stack, the tick, the disk or a
  pass fails, on `ownpace-live` first.
- **W13 → 0143 A box with a known size:** capacity for both stacks on the one machine, each with
  its own Trigger.dev plane (D3), caps on passes and on migrations per organisation (T1, T2), a
  stated largest file that is refused before a byte moves (T4), and one measured rehearsal of the
  alpha's shape (T9). JMAP files over 8 MB (T3) are split in two: T3a, a refusal that names the
  real reason, is in 0143's alpha minimum, and T3b, the streamed upload, comes after. Run retention for
  tenants that are never billed is parked (0143 T6, and T3 here). A manual sync's
  `concurrencyKey` is done: since #1137 (merged 2026-09-24) the manual sync route sets it to the
  mapping's id.
- **W14 → 0144 Saying what is true to a tester:** a tester guide (T1), known limitations (T2), the
  "read-only" wording (T3), the warning in front of the delete switch (T4), a destination that is
  not empty (T5), a person to write to before and after sign-in (T6), *Request access* on the
  sign-in page (T7), and a close-account screen (T8). The notice itself is not 0144's: it is T1
  here, and the alpha conditions are 0139 T2.
- **W16 → 0145 Phones, screen readers and in-app browsers.**
- **W17 → 0146 A release testers can name:** an alpha tag (0146 T0 recommends `v0.2.0-alpha.1`),
  with the build written into every problem report (T2); `ownpace-live` running only a release tag
  (T5); and the Node runtime of the tasks (T6). The watch on identity provider releases is 0135
  T7, and 0146 T8 extends it to the other pinned images Dependabot leaves alone. `ownpace-live` is
  deployed by hand from a tag, while the OTA stack keeps following `main` nightly (0132 T1g).
- **W19 → 0147 An index that writes itself:** the workplan index's table generated from each
  plan's own first line, Status heading and task table (T1), with the hand-written sections kept as
  history (T2), and the Status blocks that contradict themselves or the code corrected as dated
  notes (T3). T3 (a), the notes on 0008 T7, 0009 and 0026 row 14, comes before the first
  invitation; the rest after. 0009's note, on the decision 0149 T4 carries, was written on
  2026-09-24.

**Opened 2026-09-24, at the owner's word after the explanation:**

- **W15 → 0148 A guide written for the person using it.** The owner answered in four points:
  *"Audience: the in-app guide should target the endusers/testers, not the operators/self-hosters
  (they are more technical, and do need to edit env files/run commands)"*; *"Contradict:
  self-hosters need to make those, but endusers dont, or not in the ownpace-managed deployment. Stop
  the false hints on managed."*; *"cards that cant work: hide on manged"*; and *"Gaps: write also
  dutch guides for each source and target."* ("manged" is read as "managed".) So under 0148 the app
  serves a guide written for the person who connects an account, and the operator material stays in
  `docs/` (T1). Where the deployment carries a provider's app, nothing tells a tester to create one
  or register an address on one (T2). A card that cannot work on managed is hidden there, the export
  archive first (T3), which answers open question 4. (The owner later kept the archive card,
  labelled: 0148 D10.) Each source and target card gets a guide in Dutch and in English, Dutch first
  (T4). The owner then answered 0148's five questions. *Via IMAP* stays on managed (D5), the
  renderer in `Docs.tsx` is extended (D6), and the Apple export stays on the appliance, tagged *to
  be tested* (D7). The five new guides are written in English as well before the first invitation
  (D8), and the appliance's `/docs` points to the operator documents (D9).
- **W18 → 0149 Removal fails closed, and reads stay reads.** The owner: *"write as a plan. But we
  do offer 'apply deletions'. And do hold the cutover-gate when nothing was compared."* So a tester
  may arm *apply deletions* (0149 D1), and 0149 makes removal fail closed before the first
  invitation: a DAV 412 on create is an adoption (T1), a lookup that fails is not an absence (T2),
  and removal carries the version and refuses without one (T3). A row without a version is
  still rewritten from the source, the owner's answer to 0149's open question 2 (D3). The cutover
  gate holds when a target that can hash compared nothing (T4, D2). 0149 read that as 0009's
  option 1, and the owner confirmed the reading.
  0149 also proposes that the IMAP source opens folders read-only, with EXAMINE rather than SELECT
  (T5), and puts it in its alpha minimum.

## 6. Who builds what, and in which order (2026-09-24)

On 2026-09-24 the owner asked for the plans to be built. Three answers set how:

- **One pull request per task:** *"One PR per task"*. Each task is built on its own branch, named
  with the building session's prefix, and has its own guard. A task too small to stand alone
  rides with the task beside it in its group, and the pull request says so.
- **The order:** *"3 (tester-facing) then 1 (safety/foundation) then 2 (live)"*. What a tester
  meets comes first, then what keeps a tester's data safe, then the second stack itself.
- **Two sessions:** *"Yes, but create logical groups you can stack, and devide between you and the
  other session."* So the tasks of 0131 to 0149 that an agent can build are put in groups. A group
  is a **stack**: its pull requests are built in the order listed, and one that needs another
  group member's unmerged change is branched from that member's branch and says so. Each group
  belongs to one session, so that two sessions never edit the same files at once.

The two sessions are named here by their branch prefixes:

- **R**, `claude/ownpace-public-readiness-y7orc6-…`, the session that wrote 0131 to 0149;
- **M**, `claude/mailbox-sync-errors-c2xsw2-…`, the session that built most of the plans before
  0131, 0128 among them.

R takes what a tester meets, because those groups share the web app's strings, the wizard and
the cards, and one session can keep them from colliding. M takes the engines, the connectors, the
worker and the operator's side, which it built most recently. The owner's own steps are not in the
groups: they are in each plan's task table and in T5's list. R works R1 to R7 in order and M
works M1 to M7, each group in its numbered order.

| Group | The stack, in order | Mostly touches | Waits on the owner for |
|---|---|---|---|
| **R1. The alpha, said out loud** | 1. 0131 T1 (a), the alpha setting and note. 2. 0131 T3 (a), nothing charged. 3. 0144 T7, *Request access* under the sign-in button. 4. 0144 T6 (a) and (c), a person to write to. 5. 0134 T1 (a) and (b), the erasure wording and the start-up check. 6. 0139 T10 (c) and (a), the `--no-drafts` switch and the one link module. 7. 0139 T4 (a), (b) and (d), the notices. 8. 0131 T1 (b), the links. 9. 0139 T3, acceptance recorded at first sign-in. | `Layout.tsx`, `Login.tsx`, `RequestAccess.tsx`, `Billing.tsx`, `strings.ts`, `notifications.ts`, the access-request routes, `site/` | 0144 T0 (the address testers write to); 0139 T2 (the conditions) for steps 7 to 9 |
| **R2. Cards and hints** | 1. 0141 T1 with 0131 T2 (a), the live-proof record and the *Experimenteel* tag, which the export archive card carries on managed (0148 D10) and 0140 T8 (a) and T9 (a) carry too. 2. 0136 T5, the managed API refuses a typed disk path, with the sentence it says instead (moved here with D10). 3. 0148 T9, the export read from a folder in the migration's own Nextcloud or WebDAV files (0148 D11), stacked on step 2. 4. 0148 T3's Apple tag (D7), on both editions. 5. 0148 T2 (a), (b) and (d), no hint to create an app the deployment carries. 6. 0144 T3 (a) and (c), the line beside *Connect with Google* and the grant page's "read-only". 7. 0140 T2 (b), T3 (a), T6 (b) and T7 (b), the consent screens' own lines. 8. 0141 T10 (a), shared mailboxes to Partial. (0148 T3 (a), the hiding, is dropped: D10.) | `front-door-cards.ts`, `FrontDoorChooser.tsx`, `CreateMapping.tsx`, `Setup.tsx`, `provider-setup.ts`, the create route, `microsoft-consent.ts`, `feature-matrix.md`, `apps/api`'s connection and migration routes (0136 T5, 0148 T9), `credential-fields.ts`, `smoke-managed.sh`'s archive steps | none |
| **R3. Guides** | 1. 0148 T6 (a), the renderer's first half. 2. 0148 T1 with T2 (c) and T8 (c), customer guides served and operator material left in `docs/`. 3. 0148 T4 (a) with T8 (a) and (b), the Google, Microsoft, Dropbox, Box and Apple guides in Dutch and English. 4. 0148 T4 (b), the IMAP, JMAP, DAV, Nextcloud and Soverin guides. 5. 0148 T5 (a), the checklist profiles. | `Docs.tsx`, `docs/guides/`, the end-user-docs lint, `ci.yml`'s filter | 0148 T0, the reading, after step 4 |
| **R4. Phones and screen readers** | 1. 0145 T1 (a), the phone menu's focus. 2. 0145 T3 (a), each step starts at the top. 3. 0145 T5 (a) with T7 (a), the consent window on the press. 4. 0145 T6 (a) and (b), one language through the consent and the grant. 5. 0145 T4 (a), errors announced. | `Layout.tsx`, `CreateMapping.tsx`, `ProviderConsent.tsx`, the grant and view pages | 0145 T0 (one press on an iPhone) before step 3 |
| **R5. What a tester reads outside the app** | 1. 0144 T3 (b), the site stops saying "read-only". 2. 0144 T1 (a) with T5 (a) and 0145 T9 (a), the tester guide's short form. 3. 0141 T12 (a1), 0145 T10 (a) and 0141 T7 (a), the runbook stages and the Soverin corrections. 4. 0133 T1 (a), passing mail on by hand. | `site/`, the owner test runbook, `docs/managed-bring-up.md` | 0144 T0 (the site copy), 0139 T2 |
| **R6. Roles and row security** | 1. 0137 T7 (a), nobody invited below admin until 0137 T2. 2. 0138 T5 (a) and (b), the documents say where row security holds. 3. 0138 T3 (a) with T4, the tasks lose the owner's connection string, with the guard. | the team and member routes, `apps/worker`, `docs/rls-guide.md`, the architecture document | 0137 T0 |
| **R7. `ownpace-live` on the reference machine** | 1. 0132 T1, names that follow the project. 2. 0132 T3 (a) with T1f, loopback binds. 3. 0132 T2 (b), roles that follow `.env`. 4. 0132 T6 (b), the hold covers every enqueue. 5. 0146 T6 (a), `node-24` for the tasks. 6. 0146 T2 (a), the version and the build line. 7. 0132 T1g and T6 (a) with 0146 T5 (a), `deploy-live.sh` from a tag. 8. 0132 T3 (b) to (d) and T7, the exposure checks and the gate for live. 9. 0139 T10 (b), the site's second copy. 10. 0143 T9 (a), the rehearsal script. | `deploy/compose/`, `scripts/`, `.github/workflows/`, `trigger.config.ts` | 0146 T0 (the tag); 0132 T1b to T1e are the owner's bring-up |
| **M1. Removal fails closed** | 1. 0149 T2 with T1, in the engines. 2. 0149 T3. 3. 0149 T4, beside 1 and 2. 4. 0149 T5, beside them. 5. 0141 T8 (c), the nightly's legs on targets we do not run. | the DAV and JMAP writers, `dav-remove.ts`, `domain-sync.ts`, `apply-deletion.ts`, `verification.ts`, `imapflow-source.ts`, ADR-0024 | none |
| **M2. A host we are asked to reach** | 1. 0136 T1 (a), internal addresses refused after DNS. 2. 0136 T2, the operator's allowlist. 3. 0136 T3 (a), a probe answer that says what happened (after 0129 T1). 4. 0136 T1 (b), the bring-up checks Docker's ranges. 5. 0136 T6 (a), guards and mutation runs. | `packages/connectors`, `probe-connection.ts`, the bring-up scripts | none |
| **M3. What is kept, and what is removed** | 1. 0139 T6 (b), deleting a migration revokes its credential. 2. 0139 T6 (a), a declined request deleted after 30 days. 3. 0139 T7 (a), `operator.sh close`. 4. 0139 T6 (d) and 0134 T1 (c), the task runner's stores. 5. 0134 T3, what a lost machine costs. 6. 0139 T8 (a) and T9, the breach procedure and `SECURITY.md`. 7. 0139 T7 (b), after 0135 T8. | the access-request and retention jobs, `scripts/operator.sh`, `docs/` | 0139 T0 and T1 for the texts |
| **M4. A box with a known size, and alerts** | 1. 0143 T3a, the JMAP file refusal. 2. 0143 T4 (a), a file no pass can carry refused up front. 3. 0143 T2a, a cap on migrations. 4. 0143 T5, every data type gets a turn. 5. 0142 T2 (a), a tick that says it ran. 6. 0143 T1, every task names its machine. 7. 0142 T1, the status page tells the owner. 8. 0142 T6 with 0143 T2d (a), the incident runbook. | `apps/worker`, `packages/scheduler`, the JMAP file target, the API's ready routes, the status page's config | 0143 T0 (a) (the machine preset) before step 6; 0142 T0 before step 7 |
| **M5. Mail that reaches a tester** | 1. 0133 T2 (c), `requireTLS` with a login. 2. 0133 T3 (b) and (c), Mailpit only with the demo, and a note on `.invalid` addresses. 3. 0133 T2 (b), the identity provider's relay. 4. 0133 T5, after 0139 T1. | the API's mail transport, the bring-up scripts, `setup-zitadel.sh` | 0133 T0 (the relay) |
| **M6. What Microsoft is asked, said truthfully** | 1. 0141 T11 (a), the detectors and the permission report. 2. 0141 T14 (a), the gate's readiness rule. | the permission report, the detectors in orchestration, the gate's docs | 0141 T14's N |
| **M7. The front door** | 1. 0135 T1 and T2, organisation registration off and the project check. 2. 0135 T3 (a), the organisation count. 3. 0135 T6 (a), the identity provider's languages. 4. 0135 T7 (a) and (c), the release notes and the weekly pin check. 5. 0135 T5, after 0139 T10. | `setup-zitadel.sh`, `managed.yml`, `.github/workflows/` | none |

**Rules for both sessions.**

- **A task's pull request** carries its guard, updates its plan's Status block, and names its
  group and step in its description. Once 0147 T1 has landed, it also runs
  `node scripts/workplan-index.mjs --write`.
- **Out of turn.** A group of the other session is not started without the owner's word. A task
  that turns out to touch a file the other session is changing waits for that pull request, or is
  rebased on it, and the description says which.
- **A group whose owner step is missing** goes on with the steps that do not need it, and the
  pull request says what waits.
- **0147 T3 (a)**, the dated notes on 0008 and 0026, is R's and goes with 0147 T1's pull request.

## Open questions

1. **The end of the alpha (T4).** (a) everything ends, which is recommended; (b) everything
   carries on under new conditions; or (c) each tester chooses, with (a) for anyone who does not
   answer.
2. **Is the nightly managed gate paused during the alpha?** *Answered 2026-09-24, by D3: no.* The
   gate, scheduled for 03:30 UTC (`cron: '30 3 * * *'`), keeps rebuilding and seeding the OTA
   stack `--with-demo`, and testers are on `ownpace-live`, which CI never touches. 0132's earlier
   options for its T1, pausing the gate for the alpha's weeks among them, are superseded.
   `ownpace-live` is deployed by hand from a tag (0132 T1g, 0146).
3. **Does a tester who names a source wait for that source's live proof (0141, W11)?** This is
   also 0141's open question 1, and one answer serves both plans. The request's *"What are you
   moving?"* tells the owner which sources a person needs before the owner grants, so the answer
   applies per source. (a) No: the label is the answer for every source (D6). (b) Yes, where the
   proof is one sitting on the owner's own accounts: the Microsoft 365 account (0141 T2), Dropbox
   (T3's first half), Apple (T4), Google Tasks (T5) and Soverin as a target (T7). The label alone
   carries Box, a second Google account and whole-domain delegation, whose proofs need a tester or
   a Workspace (0141 T3, T6). The two plans recommend differently. This plan recommends (a), with
   one exception worth weighing. The Microsoft 365 account's calendar face fetches each event from
   `…/events/{id}/$value` with an iCalendar preference header (`graph-calendar-source.ts`), and
   0059 T5 records that nobody has confirmed Graph serves that combination. If it does not, the
   face needs rebuilding, not fixing. 0141 recommends (b), because each of those proofs is one
   sitting, and the calendar may need a rebuild rather than a fix.
4. **The export archive card on managed:** keep it with an "Appliance only" tag and disabled (T2's
   proposal), or hide it on managed? 0136 open question 3 is the same question: 0136 T5 makes the
   managed API refuse the disk path and advises hiding the card. One answer serves both plans.
   *Answered 2026-09-24, by 0148 D3: hide.* The owner: *"cards that cant work: hide on manged"*.
   0148 T3 is to hide the card on managed; it returns when an upload or relay path exists (0148's
   parked trigger). *Answered again 2026-09-24, by 0148 D10: label.* The owner: *"Hide the archive
   card on manage: I don't want them hidden. I want labelled as 'expirimental'."* The card stays,
   with T2's tag, and 0136 T5 refuses the disk path on managed.
5. **Target cards:** should T2's label also go on targets? Soverin has no recorded live run as a
   target: 0105 T3's supervised run still waits for the owner, and 0141 T7 plans it, on the OTA
   stack. JMAP contacts and files have integration tests and no nightly leg: 0031 T2 says JMAP
   contacts are *"Not yet in the nightly e2e"*, and 0141 §1 found that the only e2e fixture that
   uses `jmap` maps mail. 0141 T8 (a) proposes the legs that map contacts and files to `jmap` in
   the appliance nightly. Until this is answered, the owner's grant is the only gate in front of a
   target card (0141 §1).
6. **Invitations inside a tester's organisation.** The owner is the gate for organisations (D2),
   but an owner or admin of one can invite anyone by email address, and that person gets in
   without the queue (§1). (a) Keep invitations during the alpha, limited to owner and admin as
   0137 T7 proposes, and let the conditions say that whoever a tester invites is the tester's
   responsibility. (b) Turn invitations off on `ownpace-live`, so that every person passes the
   queue. (b) matches *"I am the gate for letting people in the test."* more closely; (a) keeps a
   family or a small office able to try the service together. 0137 open question 1 asks the same
   question from the side of roles, with (b) here as its option (d).

- the Google account's Tasks face (*"unmeasured against a live account"*, 0126);
- whole-domain Google through delegation (*"⏳ built, awaiting first contact with a real
  Workspace"*, 0053).

Gmail, Google Calendar and Google Contacts are marked ✅, and the matrix says what that covers:
the owner's own Google account, *"not yet against a second one"*. The export archive card is a
different case. A managed pass cannot read a local path (0116 T4: *"a local path can never reach
a managed pass"*), yet the wizard asks for one (`sourceArchivePath` in `CreateMapping.tsx`). The
reader can also open an archive that sits inside the migration's own file target (`where` on the
archive source, 0116 T4), but no control in the wizard sets it; 0116 leaves that to the relay
page, which is not built. So a tester who picks this card on managed cannot get it to work.

**The machine.** The OTA stack (`app.ota.ownpace.eu`, `id.ota.ownpace.eu`) runs on the reference
machine, which is also this repository's self-hosted runner:

- `ci.yml` runs there on a push to `main`, and on GitHub-hosted runners for a pull request
  (`runs-on: ${{ github.event_name == 'push' && 'self-hosted' || 'ubuntu-24.04' }}`);
- the nightly gates `e2e.yml` and `e2e-managed.yml` run there on a schedule.

`e2e-managed.yml` brings the stack up with `bootstrap-managed.sh --from data --with-demo
--no-smoke`, and its header says *"the run recreates the halves it owns: the API, the web app,
the worker image and the seed."* `managed.yml` fixes the names of the compose project
(`ownpace-managed`) and the database container (`ownpace-db`). The review found that the gate
therefore rebuilds the same stack the OTA addresses serve. The same file gives 17 services a fixed
`container_name`, so a second compose project cannot start on the machine while this one's
containers exist (0132 T1). The runbook's own rule is that this
must end first: *"before the first non-demo tenant is onboarded, CI and production must not
share this machine"* (`docs/operator-runbook.md`, "This box also runs CI"). The same item is in
`docs/release.md`'s checklist.

The review also recorded that `e2e-managed.yml` failed its scheduled runs of 2026-09-21, 22 and
23, and that a run started by hand passed on 2026-09-23. 0141 §1 re-read that history from GitHub
on 2026-09-24: scheduled runs #193 to #195 failed, dispatched run #196 passed, and the last green
scheduled run is #191, of 2026-09-20. It gives the review's causes: the tasks' Node 21 for #193 and
#194 (0146 T6), and an API restart in the middle of the run for #195 (0132 §1).

The repository does not settle whether a person off the mesh can reach the OTA addresses.
`docs/google-oauth-verification.md` says *"Anyone not on the mesh gets a timeout"*, and 0091
says *"Routing and TLS are netbird's, not this repository's."* The review's DNS lookup found the
OTA names resolving to the mesh provider's hosted ingress. 0132 T3 establishes which is true, for
these names and for the production names testers will use (D3).

**Letting someone in is already one person's act.** `/request-access` is public and managed-only
| T2 An "experimental" label on sources nobody has run against a real account | 🔨 **(a) Built on branch `claude/ownpace-public-readiness-y7orc6-a-card-that-says-it-is-unproven`, not merged** (2026-09-24): the table, the tag at both doors on both editions (the export archive card included, offered and tagged on managed: 0148 D10), in the data-type step and beside the whole-domain option, with 0141 T1. 📋 **Decided 2026-09-24** (D6); (b), the why's link to 0144 T2's page, not built | §3. One table in shared, read by both doors and by the wizard's data-type step. Both editions. |
(`AppRoutes.tsx`). It stores a request and creates nothing. The operator's access queue
(`AccessRequests.tsx`, 0093 T7) grants or declines each request. Granting creates the
organisation and sends the grant mail (0095), and the person becomes its owner at first sign-in.
`POST /api/tenants` answers 501, so apart from the demo seed the queue is the only way a new
organisation is made.

The queue is not the only way into an organisation. An owner or admin of one can invite anyone
by email address (`POST /api/tenants/:tenantId/members`, `requireRole('owner', 'admin')`); no
mail is sent. The invited person signs in with that address, verified, accepts the invitation,
and is in without passing the queue. 0137 covers what they may then do, and open question 6 asks
whether testers may invite at all.

A request that was granted is purged with its organisation at erasure (`access_request` is in
`PURGED_TABLES` in `offboarding.ts`). An open or declined request names no organisation and is
kept: the application role has no DELETE on `access_request`, and no job removes one.

The form accepts 60 requests an hour, counted per `req.ip`. Since #1137 (merged 2026-09-24),
`managed.yml` passes `TRUST_PROXY` and `ACCESS_REQUEST_MAX_PER_HOUR` to the API. Both are empty
in `managed.env.example`, and with `TRUST_PROXY` empty the API trusts no proxy, so behind an
ingress every caller shares one count until a deployment sets it (`apps/api/src/knock-limit.ts`).
This is 0093 T2c, which the owner deferred on 2026-09-01 until self-service arrives: while
granting is the operator's act, sixty an hour for the whole service is enough. The alpha keeps
granting as the operator's act. The form has no spam protection.

**Ending an organisation has no button.** `POST /api/tenants/:tenantId/close` exists: owner only,
with a window of 0, 7, 30 or 90 days (`CLOSE_WINDOWS_DAYS` in
`packages/managed/src/offboarding.ts`). Nothing in the web app calls it.
`deploy/compose/operator.sh` has no close or erase command, and an operator belongs to no
organisation.

Erasure revokes stored credentials (`packages/orchestration/src/revoke-stored-credentials.ts`)
and purges an explicit list of tables. It does not remove the person's identity at the identity
provider: `offboarding.ts` makes no call to it, and ADR-0042 rules out an issuer-specific API.
Finishing a migration keeps its credentials on purpose (the finish route answers *"Set the
mapping's status back to 'active' to resume"*). Deleting a connection revokes its credential
(`revokeCredentialRow` in `connections.ts`). Deleting a migration removes the row and revokes
nothing, even when the row holds a credential (`apps/api/src/routes/migrations/index.ts`).

For a stop across the whole platform there is the operator hold (managed migration 0023). It
stops the sync tick from starting new passes (`readOpenPause` in `managed-sync-tick.ts`) and
shows every signed-in customer a sentence. A pass a customer starts by hand is not checked
against it: the manual sync route does not read the hold.

**Language.** The app has English and Dutch (`nl` is typed against the English keys), and it
picks Dutch for a Dutch browser. The in-app guides do not have Dutch: `Docs.tsx` serves
`docs/*-setup.md`, and those are English only.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words and the answer as given, typos included. Where
an answer needed a reading, the reading is stated.

**D1 — what the alpha is.** *Is the test free or paid, for how many people, for how long, and in
which language?* — *"Free and invite only. 10 to 20 people max. Dutch."* On the posture of the
test: *"Free. A few weeks. No obligations both sides."* The name comes from the legal question
(D4): *"Alpha"*.

So the alpha is free and by invitation, for at most 20 people, in Dutch, for a few weeks, with no
obligations on either side. Nothing is invoiced: no route or job in the code can issue an invoice
today (§1).

**D2 — who lets people in.** Four answers bear on this:

- *What may a member and a viewer do, and should only owners and admins invite?* — *"I am the
  gate for letting people in the test."*
- *For Google: move the consent client to production, or keep it in Testing with pre-registered
  testers?* — *"Ill add people by hand"*
- *A tester stack separate from CI and the nightly gate, reachable from the internet?* — *"Yes,
  but its a controlled rest. I Let people in and support them. Max 10/20 people"* ("rest" is read
  as "test").
- *The Google client is in Testing, so tokens expire after about seven days* — *"I add people,
  controlled small test Group."*

So the owner grants every organisation from the access queue, adds each tester's Google address
as a test user by hand, and supports the testers directly. The first answer is about who enters
the alpha. One door is not the owner's today: a tester who owns an organisation can invite
others into it without the queue (§1). Whether that stays open during the alpha is open
question 6. What a member or a viewer may do inside a tester's organisation is still open, and
0137 covers it.

**D3 — where it runs.** *Where do testers run, and under which host names?* — *"This machine, ci
states. The OTA address. It's all controlled by me and invite only."* ("ci states" is read as
"CI stays".) On exposure: *Are ports 5432, 3001, 3090, 3443 and 3126 reachable from outside, were
the database passwords changed, and does the live identity provider hold other organisations?* —
*"No, these ports are not reachable outside of private network/NetBird. Usernamea changed. No
other organisations are hosted."*

So the alpha runs on the reference machine, and CI stays on it. The first answer placed it at the
OTA address. Later the same day the owner asked: *"check, can't i just (as a start) host a
'ownpace-live' as production, next to the current 'ownpace-managed' on OTA-domain? What would i
need to do to keep alle seperate from each other?"* The proposal back was to make that the
decision in 0132, with testers on `ownpace-live`. The owner's answer: *"Yes! The spark has a lot
free memory and disk, it will fit."*

Testers therefore use a second compose project, `ownpace-live`, beside the OTA stack
`ownpace-managed` on the same machine, at the production names of 0091: `app.ownpace.eu`,
`id.ownpace.eu` and, for the status page, `status.ownpace.eu` (`docs/status-page.md`). 0091 T4,
*"`app` stays dark until it means production"*, is thereby answered: it now means production.
`ownpace-managed` stays at `app.ota.ownpace.eu` and `id.ota.ownpace.eu`, as the nightly gate's
target and the demo, and CI never touches `ownpace-live`.

The separation is by name on one Docker daemon, not a security boundary: both stacks' Trigger.dev
planes can use the Docker socket, and so can the self-hosted runner (§4). That is accepted for a
hand-picked alpha. A separate virtual machine, or a rootless daemon for each stack, is the step if
the separation must become a boundary. So this still departs from the runbook's rule (§1), which
names a shared Docker daemon as the class of problem. 0132 records the decision and the work that
makes a second stack possible, starting with its T1, since today's fixed container names stop a
second project from starting (§1). It also covers what changes in the runbook and the release
checklist so that neither contradicts this decision.

**D4 — the legal surface comes first.** *A lawyer's pass before the first invitation, or a
labelled beta notice? And can you supply the address, the btw-id and the hosting details?* —
*"Yes before, Alpha, and i can supply."* On the legal blocker: *"I will update"*.

So the lawyer's pass happens before the first invitation, the test is labelled "Alpha", and the
owner supplies the facts the drafts leave as placeholders. 0139 carries this.

**D5 — no backups during the alpha.** *How much loss is acceptable, how fast must service come
back, and where are backups kept?* — *"None during the test"*. On the missing database backup:
*"No obligations during controlled test"*.

So nothing is backed up during the alpha, and testers are told so before they start. 0134 makes
that statement true everywhere the product now suggests otherwise.

**D6 — unproven sources are labelled.** *For sources nobody has run against a real account:
prove them first, hide them, or label them experimental?* — *"Label"*. This is T2.

**D7 — nobody else gets onto the machine.** *If the current stack is reused, its demo secrets
must be rotated* — *"Who would need/het credentials? I aupporrthe test. No one will be added to
NetBird network. Devs need to setup own private test/dev environments. GitHub PRs and git is the
bridge."* ("het" is read as "get", and "aupporrthe" as "support the".)

So no tester, contributor or developer gets a login on the machine, a place on the mesh or a
copy of its secrets. Developers run their own environments, and code reaches the machine only
through a merged pull request. §4 answers the question inside this answer. With `ownpace-live`
(D3), testers are not on the current stack at all: live starts from its own `.env`, and the OTA
stack keeps its secrets as a demo (§4).

**The other answers, and the plans that carry them.**

| Question, in plain words | The answer, as given | Carried by |
|---|---|---|
| Which EU mail relay and sending domain, and does a person read support@? | *"I'll register a ownpace ampt, a todo"*. Read as: the owner will register a mail-sending (SMTP) account for Ownpace, as a to-do. | 0133 |
| Mail must leave the box | *"I will practically forward / help"* | 0133 |
| Close public organisation registration at the identity provider | *"Advice"* | 0135 |
| The database is published with a password the repository contains | *"Ill change user and pass. But not reached from internet."* | 0132 |
| Requests to hosts a tester types (SSRF) | *"Explain risk and Advice"* | 0136 |
| Roles do not restrict writes | *"Explain risk and advice. Are permissions not implemented?"* | 0137 |
| Microsoft: an ADR for the deployment's multi-tenant app, and publisher verification now? | *"Explain"* | 0140 |

## 3. What each task does

### T1 — the word "alpha" wherever a tester meets the service

**One setting, read in three places.** A deployment setting in `deploy/compose/.env` (for the
alpha, `ownpace-live`'s own), unset by default. Its name is for the build to settle;
`OWNPACE_STAGE=alpha` is the working name. `managed.yml` passes it to the web build as a build
argument, as it already does for `VITE_OIDC_ISSUER`. It also passes it to the API service, whose
environment is an explicit list. The third reader is the site build: 0144 T1 hands it to
`node site/build.mjs`, as `OWNPACE_APP_URL` is handed today, and the site renders the tester guide
only while it is set.

It is a build argument, not a value the web app reads from the API, because the request page and
the sign-in page have no session. A note that disappears when a read fails would go silent exactly
when something is wrong. The appliance never sets the setting.

**Where it shows.**

- At the top of every signed-in page, in `Layout.tsx` beside `PlatformPauseBanner`. It uses the
  same amber `role="note"` shape, which the pause banner adopted so that two kinds of platform
  news do not look like two different kinds of thing.
- On `/login` and `/request-access`, under the title.
- In one sentence of the access-granted mail (`access_granted` in `notifications.ts`), in both
  languages.

**What it says.** This is a draft. It must match 0139's alpha conditions once they exist.

- EN: *"Alpha: a small invited group is trying this service out. Nothing is charged, nothing is
  backed up, and the alpha can end. Keep your old account until you have checked what arrived."*
- NL: *"Alfa: een kleine, uitgenodigde groep probeert deze dienst uit. Er wordt niets in rekening
  gebracht, er worden geen back-ups gemaakt en de alfa kan stoppen. Houd uw oude account tot u
  hebt gecontroleerd wat er is aangekomen."*

Once 0139 publishes the alpha conditions, the note links to them in the reader's language. Beside
them it links 0144 T1's tester guide, and the access-granted mail's sentence carries the same
link. The app builds both addresses through 0139 T10's module; until that lands, the mail and the
owner's own invitation carry the guide's link (0144 T1). Writing the tester guide, a
known-limitations page and a close-account screen is not part of T1. They belong to 0144 (W14,
§5).

**Guards.** Each of these fails on today's code:

- `apps/web/src/components/an-alpha-said-out-loud.unit.test.tsx`: with the setting on, `Layout`,
  `Login` and `RequestAccess` render the note in English and Dutch. Without it, none of them do,
  and an appliance build never does.
- A test beside `notifications.ts` in shared: with the setting on, the access-granted mail carries
  the sentence in both languages, and without it the mail does not.
- `scripts/an-alpha-both-halves-know-about.unit.test.ts`: `managed.yml` passes the setting to
  both the web build and the API. Today it passes it to neither. The pattern to follow is
  `a-client-the-worker-never-got.unit.test.ts`.
- The site build's half is 0144 T1's guard, a case in `site/site.unit.test.ts`: with the setting
  the build writes the tester guide, and without it the build does not.

### T2 — an "experimental" label, from one table

**The table.** It lives in `packages/shared/src/front-door.ts`, beside `FRONT_DOOR_FAMILIES`, so
that both doors and the wizard read the same thing. It holds a verdict for each source kind, and
for the account kinds a verdict for each face (the faces `source-face-builders.ts` maps in
orchestration). There are two verdicts:

- **proven**: a complete pass has run against a real account of this kind, and the entry says
  where that run is recorded;
- **experimental**: built, but not yet run against a real account.

Its first content is §1's list. A face moves to proven when its live run is recorded. The live
runs themselves belong to 0141 (W11, §5). The matrix stays the long-form record and
the table is what the screen reads. A change to one goes into the same PR as the matching change
to the other.

**Where it shows.**

- On the card, in `FrontDoorChooser`, so the wizard and the connections page both show it. It is a
  small tag, *"Experimental"* / *"Experimenteel"*, and uses the Hint component's *why* to say:
  *"Built, not yet run against a real account of this kind. Keep your old account and check what
  arrives."* The card is a `<button>`, and 0145 T2 needs two things of it. The tag stays text
  inside the button, never an icon alone, so that a screen reader reads it as part of the card's
  name; 0145 T2's guard checks that name. The Hint's fold sits beside the card, not inside it,
  because a fold inside the button could not be opened on its own. Once 0144 T2's
  known-limitations page exists, the *why* links to it, as 0144 T2 asks.
- In the wizard's data-type step (the domain list in `CreateMapping.tsx`), beside any face of the
  chosen account that is experimental, for example the Microsoft 365 account's calendar.
- Beside the whole-domain option on the Google cards.

**Both editions.** Whether a connector has met a real account is a fact about the connector, not
about the edition. The label therefore also shows on the appliance, which offers the same cards.

**The export archive on managed** is not experimental: as the wizard offers it, it cannot work
there at all (§1). The proposal here was a different tag on managed only, *"Appliance only"* /
*"Alleen op de appliance"*, with the card disabled. The owner chose to hide it instead: *"cards
that cant work: hide on manged"* (0148 D3, where "manged" is read as "managed"). 0148 T3 builds
that, so T2 carries no such tag, and open question 4 is answered.

**2026-09-24, later: labelled after all (0148 D10).** The owner: *"Hide the archive card on manage:
I don't want them hidden. I want labelled as 'expirimental'."* So the archive card is not hidden.
T2's table gives it the *experimental* verdict, and the tag shows on it at both doors, on both
editions. Its why is the general one; that the card cannot complete on managed yet is said by the
refusal 0136 T5 adds, and 0148's open question 6 asks whether the wizard learns the one place a
managed pass can read an export. The owner answered yes the same night: a folder in the tester's
Nextcloud or WebDAV files (0148 D11), built by 0148 T9.

**Guards.** Each of these fails on today's code, because the table does not exist:

- `apps/web/src/components/a-card-that-says-it-is-unproven.unit.test.tsx`: every `SOURCE_CARDS`
  id has a verdict, and every *proven* verdict says where its run is recorded. An experimental
  card shows the tag in the wizard and on the connections page, and a proven card does not.
- In orchestration, beside `source-face-builders.ts`: every face that `everyFaceClaimedBy`
  returns for an account kind has a verdict. This stops a new face from arriving without one.

### T3 — Billing says nothing is charged during the alpha

**The Billing page, when the setting says alpha:**

- The subtitle is replaced, and the page opens with one line. EN: *"Nothing is charged during the
  alpha. Not needed while your tier is free: nothing is invoiced."* NL: *"Tijdens de alfa wordt
  niets in rekening gebracht. Niet nodig zolang uw pakket gratis is: er wordt niets
  gefactureerd."* The second sentence is the free tier's own (`billing.party.notNeeded`), by the
  owner's answer to open question 7 (2026-09-24); it replaced *"What you see here is measured so
  you can see how it works; it is not a bill."* A viewer or member, who is shown neither figures
  nor the invoice details form, reads the first sentence alone (the T3 build's reading).
- The tier block stays, prices included, under that line. The measurement is one of the things
  worth trying: 0121 T4 records the owner's decision of 2026-09-09 that the customer gets to see
  it. The prices shown are ADR-0014's (`MANAGED_TIERS` in
  `packages/managed/src/tier-calculator.ts`), which `tier-calculator.unit.test.ts` holds to the
  ADR's table and to the site's calculator.
- **Proposed:** the four metered cards are hidden while the setting says alpha. They show the
  quantities of the model ADR-0014 replaced, and on a page that says nothing is charged they look
  like a meter that is running. Whether they go for good is a question for 0121, not for this plan.
- Unchanged: the invoice list, which is empty, and the payment methods, where the page offers
  no way to add one. The *"Invoice details"* form (who invoices are addressed to, with an address
  and a VAT number) also stays as it is; the alpha asks nobody to fill it in, and T1's note says
  nothing is charged. So during the alpha the card shows the free tier's *"Not needed while your
  tier is free: nothing is invoiced."* on every tier, in place of the amber ask (open question 7,
  answered 2026-09-24).

**The request page.** The package question (*"Which package looks right?"*) stays, because it
tells the owner roughly how large a request is. Its hint gains the sentence *"Nothing is charged
during the alpha."*

**Nothing to build on the server.** The invoice route already refuses every call.
`ownpace-live` keeps `MOLLIE_API_KEY` empty, which is a T5 check.

**Run rows (Proposed).** Accept that run rows are not pruned during the alpha while nothing is
invoiced. The rows grow with every pass, but the growth stops when the alpha ends, and it covers
at most 20 organisations over a few weeks. A retention rule for tenants that are never billed is
0143 T6, 🅿️ **Parked (trigger: the alpha runs past the 60-day run window, or its organisations
carry on after it)**. The run window is 60 days, so nothing a few weeks of alpha writes would be
old enough to prune even with the rule changed, and 0143 T9 measures what the rows cost meanwhile.

**Guard.** `apps/web/src/pages/a-bill-nobody-will-send.unit.test.tsx`: with the setting on, the
Billing page shows the line in both languages (and, once the **Proposed** hiding is decided, none
of the four metered labels). Without the
setting, the page is as it is today; that half is the control. The first half fails on today's
code.

### T4 — the end of the alpha

**What there is to end, for each tester:**

- an organisation and its members;
- migrations that keep running on their schedule;
- stored credentials, on connections and on migration rows;
- an identity at the identity provider;
- an access request;
- a Google test-user entry;
- run history.

Two things are not the service's to end: the copies at the tester's target, which belong to the
tester, and the source account, which no connector writes to.

**The options.**

- **(a) Everything ends.** The owner starts the operator hold, which stops scheduled passes, and
  its sentence says the alpha has ended. A pass a tester starts by hand is not held (§1). Each
  organisation is then closed with a 0-day or short window. The close route stops that
  organisation's passes in flight (`stopPassesInFlight`), and erasure revokes its stored
  credentials when the window ends. The owner deletes each tester's identity at
  `ownpace-live`'s identity provider and removes their Google test-user entry. Testers keep what
  arrived at their targets. *Recommended as the default.* D1's *"No obligations both sides"* is
  only true at the end if none of a tester's credentials is still stored.
- **(b) Everything carries on** into whatever follows, a longer test or the paid service, and new
  conditions are accepted first.
- **(c) Each tester chooses** between (a) and (b), and anyone who does not answer gets (a).

**What (a) needs that does not exist yet.**

- A way for the owner to close an organisation. The close API is for an organisation's own owner,
  and neither the web app nor `operator.sh` offers a path. A close screen is 0144 T8; an audited
  operator command is the smaller build, and 0139 T7 proposes it.
- A runbook step for the identity provider, because erasure does not reach it.
- An answer for credentials whose migration a tester deleted before the end. That row is gone, so
  erasure can no longer revoke its credential, and the delete did not revoke it either (§1). 0139
  T6 proposes that deleting a migration revokes its credential, as deleting a connection does,
  and owns the wording that promises revocation.

Under (a), each tester's granted access request goes with their organisation, because erasure
purges it (§1). A declined request is kept under every option, and nothing removes it. 0139 T6
proposes how long it is kept and what the privacy policy says about it.

### T5 — go/no-go before the first invitation

The first invitation goes out when every row below is either done or has the owner's written,
dated acceptance beside it. The table is the minimum, not the whole plan: each sibling plan
contains more than its row.

| Plan | The minimum before the first invitation | Today |
|---|---|---|
| 0131 The alpha (this plan) | T1 and T3 on `ownpace-live` with the setting on. T2 built. T4 decided, and 0139's conditions say what the end does. Open question 6 answered, and the answer in place. | Nothing built. Any owner or admin can invite by email address (§1). |
| 0132 ownpace-live beside the nightly gate, on one box | 0132's T1, T1b to T1e, and T3 (D3). **T1:** container names, networks and scripts take the stack from `COMPOSE_PROJECT_NAME`, and a guard fails on a fixed stack name and on any hard-coded `ownpace-managed_` name. Every network live's containers join, the one its task runs join included, is live's own and named after it (0132 D9: *"all need to land in their own seperate docker network, with names corresponding with 'ownpace-live'."*). **T1b:** `ownpace-live` has its own checkout and `.env`, fresh secrets from its first bring-up, its own ports and no demo. The owner sets its database passwords in live's `.env` before that bring-up (0132 D8: *"ill set them in .env for the ownpace-live before bringup."*), and its application role is created with its own password before anything migrates, because otherwise the baseline creates it with the repository's literal. **T1c:** its own Trigger.dev plane, never the OTA one. **T1d:** its own identity provider at `id.ownpace.eu`, and a web build that names it as the issuer. **T1e:** the production names routed to live's ports. **T3:** checked from a machine off the mesh, port 443 on the production names answers over TLS, the OTA names answer as 0132's open question 7 decides, and nothing else answers; every port that need not be reachable is bound to loopback in both stacks (T1f). The result is written in 0132. Deploying live by hand from a tag (T1g) goes with 0146. The tag live first runs names a commit on which both nightly gates are green on their last N scheduled runs (0132 T6, step 1). 0141 T14 states that rule: scheduled runs only, since a dispatched run's moment was chosen, and a failed or cancelled scheduled run resets the count. The review suggested five, and the owner names N. The runbook and the release checklist say what D3 decided (0132 T1g). | `managed.yml` pins `name: ownpace-managed` and gives 17 services a fixed `container_name`, and scripts address containers by those names, so a second stack cannot start beside the OTA one (0132 §1). The owner reports the ports unreachable off the mesh (D3). `managed.yml` publishes seven ports (the database, the API, the web app, the status page, the identity provider and two for Trigger.dev) on all interfaces, and `www.yml` the site's, unless the host restricts them. The application role's password is a literal in the shared baseline migration (`packages/ledger/migrations/0001_baseline.sql`), and `ensure-env-secrets.sh` generates neither that password nor the database owner's; `trigger-db`'s password is a literal in `managed.yml` that no `.env` reaches (0132 D8, T2). Compose names the stack's two networks after the project, but the network task runs join is a literal in `managed.yml` (`DOCKER_RUNNER_NETWORKS: ownpace-managed_ownpace-network`), and `ownpace-managed_` names are hard-coded on 13 lines in six files (0132 T1). |
| 0133 Mail that reaches a tester | On `ownpace-live`, one address outside the owner's own domains walks through the request, the grant mail, the identity provider's verification mail and the first sign-in, and every mail arrives in that inbox. SPF, DKIM and DMARC pass for the sending domain. Live's API and its identity provider both send through the relay, the provider with a login: `setup-zitadel.sh` hands it `SMTP_USER` and `SMTP_PASSWORD` since #1137 (merged 2026-09-24). The notice that a request has arrived reaches the owner. | `managed.env.example` defaults `SMTP_HOST` to `mailpit`, and every bring-up starts Mailpit, with or without the demo (`bootstrap-managed.sh`), so mail stays on the box until live's `.env` names the relay. |
| 0134 No backups during the alpha, said truthfully | The alpha conditions, T1's note and the grant mail say that nothing is backed up. Nothing the product shows promises a backup that does not exist. The owner has written down what a lost database costs a tester. | The application database has no backup (review); on `ownpace-live` it will hold the testers' data. The runbook's manual recipe dumps the zitadel database and the roles as well since #1137 (merged 2026-09-24), and says neither dump is usable without the stack's `.env`. |
| 0135 The sign-in page is the front door | Public organisation registration is off at `ownpace-live`'s identity provider (`id.ownpace.eu`), and the setting has been read back; 0135 applies the same to the OTA instance. A user of another organisation cannot sign in to the project. | Open, which is the upstream default (review), so a new instance starts open. The owner reports that no other organisations are hosted on the OTA instance (D3). |
| 0136 A host we are asked to reach | 0136's minimum, after its explanation. A host a tester types is refused before any connection when it resolves to loopback, a private or link-local range, or a compose service name, and redirects are checked too. The Docker networks and their gateway are among the refused ranges, because through them a container can reach the other stack's host-published ports (D3). The alternative is the owner's written acceptance, given in the knowledge that every tester is someone the owner let in. | No check (review). |
| 0137 Roles that mean what they say | A viewer or member cannot delete, cut over, repoint credentials or apply deletions. Until that is built, testers invite nobody below admin, and the conditions say so. An admin cannot invite an owner: done in #1137 (merged 2026-09-24), where the invite route answers 403. | Most writes are open to every role (review, including an integration test that asserts it). |
| 0138 Tasks under row security | Built, or accepted in writing with the reason stated. | Tasks read and write tenant data as the database owner, so row security does not apply in the worker plane (review). |
| 0139 The legal gate for the alpha | The lawyer's pass is done (D4) and the placeholders hold the owner's facts. The alpha conditions are published in Dutch and English: free, no obligations, a few weeks, no backups, and how it ends. The pages describe the service at the production names (D3). The privacy policy and the conditions are linked from the request page and the grant page; since #1137 (merged 2026-09-24) the grant page links to the privacy policy and the terms on `www.ownpace.eu`, in the reader's language. Each tester's acceptance is recorded with the version and the time. | Drafts with placeholders. `site/build.mjs` refuses `--public` while any placeholder is unfilled. |
| 0140 Consent screens a tester can pass | **T11:** `ownpace-live`'s Google client carries live's consent address, `https://app.ownpace.eu/api/migrations/google/callback`, and live's sign-in address only if T10 keeps a Google sign-in. Microsoft and Dropbox know live's redirect addresses (D3), and each reaches its consent screen with the owner's own account. The owner left the Google choice open, *"I'll need to add one for app.ownpace.eu or create a new oauth-client"* (0140 D5); 0140 T11 advises a new client, separate from the OTA stack's test client. **T1**'s measurement and choice, then each tester's Google address a test user for live's client before they connect (T0). **T10** decided: which sign-in buttons live offers. Testers know Google will ask them to reconnect: after about seven days while the client is in Testing, a figure to confirm on Google's pages. A tester with a Microsoft work or school account knows, before pressing Connect, what their organisation's consent policy may do (0140 explains). Dropbox, Box and Apple carry T2's label. | One Google client exists, the test (OTA) client registered on 2026-08-20 (ADR-0041). The owner read its redirect URIs in the console on 2026-09-24: it holds two, both the OTA stack's, the identity provider's sign-in callback at `id.ota.ownpace.eu` and the migration consent's at `app.ota.ownpace.eu`, and no production address (0140 D5). The `/oauth/…` production entry that `docs/google-oauth-verification.md` §4b records for 2026-08-20 is not among them. The client is in Testing (0089 T2 names the seven-day expiry). |
| 0141 Proof before strangers | Before the first invitation: 0141's T1, the "Live proofs" section of the feature matrix that this plan's T2 verdicts point at; T9, the organiser canary; T12's walk with two strangers on `ownpace-live`; T14's rule, read before live's first bring-up from a tag; and T11's true sentence, if a first tester brings a Microsoft 365 account. Before a tester who uses a source is granted, if open question 3 settles that such a tester waits: that source's sitting (0141 T2 the Microsoft 365 account, T3's Dropbox half, T4 Apple, T5 Google Tasks, T7 Soverin as a target, which runs on the OTA stack). Before a tester on a Microsoft card, whatever open question 3 settles: T10's move of shared mailboxes to Partial, or the consent run first, as 0141's open question 4 settles. | Nothing built, and the matrix has no "Live proofs" section. The managed gate's last green scheduled run is #191, of 2026-09-20, so T14's count is 0 (0141 §1). The organiser canary is open (0103 T3). `e2e-o365.yml` has never completed a run, and the live-target lane is green because it stands down. |
| 0142 Alerts someone reads | 0142's T0: its test alert arrived on live, and its recovery too. Its T1 and T2 are on `ownpace-live` with the switch on, and off on the OTA stack. T6, the incident runbook, is in `docs/`. | Nobody is told when the stack, the tick, the disk or a pass fails. `gatus.yaml` has no `alerting` block, the tick records nothing about itself, and outside the workplans `docs/` has no incident procedure (0142 §1). |
| 0143 A box with a known size | 0143's T1, T2a, T3a and T4 are on `ownpace-live`, and live's caps are uploaded. T9 passed with live standing beside the OTA stack, and its numbers and the runway are written in 0143's Status block. T0's final numbers are set. T2d's step for stopping one organisation is in 0142 T6's runbook. | No task names a machine, and nothing caps passes in flight. An organisation sets its own `maxMappings`, and nothing reads it. A file over 8 MB written to a JMAP target fails with *"No content for …"*, and no largest file is stated. The managed stack has never been measured under load (0143 §1). |
| 0144 Saying what is true to a tester | 0144's T0: the address testers write to, and the owner's answer on the site copy. T1's tester guide in Dutch, in its short form. T3's line beside *Connect with Google* and its site copy, and its grant page if testers send grant links (0140 open question 2). T6: a person to write to, before and after sign-in. T7: *Request access* on the sign-in page. | No tester guide. The site and the grant page call the connection *"read-only"* where some of the permissions asked for can write. The pages outside the app name nobody to write to, and `Login.tsx` has no link to `/request-access` (0144 §1). |
| 0145 Phones, screen readers and in-app browsers | 0145's T0, one press of *Connect with Google* on an iPhone, on today's code. T1, the phone menu takes focus and gives it back. T3 (a), each wizard step and each new page starts at the top. T5, the consent window opens on the press itself, with T7 (a). T6, the consent endings in Dutch, and the grant half if testers send grant links. T9 (a), one paragraph in 0144 T1's guide. T10, the walk on two phones, on `ownpace-live`. | Both consent buttons open the window only after an awaited call; whether Safari blocks it is T0's to find out. The closed phone menu stays in the tab order. The grant page's "what will be read" phrase and the consent endings are English only. Nothing checks the app at phone width or in WebKit (0145 §1). |
| 0146 A release testers can name | The alpha tag exists (0146 T0 recommends `v0.2.0-alpha.1`), and its release is published with its images and SBOM. `ownpace-live`'s build stamp and `/api/version` name that tag's version and commit. If the report form is on at `ownpace-live` (this table's row for 0130 allows an address instead), a problem report sent from there carries the build line. The tasks on `ownpace-live` were built on `node-24`: the task deploy's build output names `triggerdotdev/node:24-bookworm`, where run #193's named `node:21-bookworm`. 0146 T0's answers are written in 0146. Also before the first invitation, carried by 0135 T7: the identity provider's release watch and response window. | The only tag is `v0.1.0-rc.1`, of 2026-08-04, and every build since calls itself that. A problem report carries no build. `trigger.config.ts` names no runtime, so the tasks run Node 21 (0146 §1). |
| 0147 An index that writes itself | 0147's T3 (a): three dated notes, on 0009, on 0008 T7 and on 0026 row 14, because the owner reads those plans when deciding go or no-go; 0009's note was written on 2026-09-24, and its table row remains. If the session writing the alpha's plans is not idle by then, they go as their own small pull request. | 0009's section headed T9 was an open owner decision until 2026-09-24. Its Status block now opens with a dated note of the decision (0149 D2 and T4), above *"Nothing open in this plan."*, and its table has no row for it. 0008 T7 is ✅ with no run linked; both runs of `e2e-o365.yml` were cancelled. 0026 row 14 calls publisher verification moot, a premise 0114's deployment registration changed (0147 §1, T3). |
| 0148 A guide written for the person using it | T3: the Apple export tagged *to be tested* on both editions; the export archive stays offered on managed with T2's tag (0148 D10), and 0136 T5 refuses a typed disk path there. 0148 T9: the export read from a folder in the migration's own Nextcloud or WebDAV files (0148 D11). *Via IMAP* stays, tagged experimental until the owner's run is recorded (0148 D5). T2 (a), (b) and (d): where `ownpace-live` carries Google's, Dropbox's or Microsoft's app, no about-line, redirect line, checklist or create refusal tells a tester to create one or register an address on it. T1 and T4 for every card live offers: a customer guide in Dutch and English (0148 D8), served in the app, with no operator material, read by the owner against live's screens (T0). The Microsoft guide carries 0148 T8's two recipes (D5). T6's first half, the parts of the renderer those guides use, and T2 (c). T5's profiles for Apple, Nextcloud and Soverin, and the Google account card's. | The seven served guides are in English and written for operators; no target and not the IMAP source has one. The archive card is offered on managed and asks for a path on the server, which a managed pass cannot read. The wizard's about-lines, the redirect line under its button, the checklist and the create refusals say "your own" whatever the deployment carries (0148 §1). |
| 0149 Removal fails closed, and reads stay reads | 0149's T1 to T5, merged and in the alpha tag `ownpace-live` first runs, so that no row on live is written by the old code: a DAV 412 on create is an adoption (T1), a lookup that fails is not an absence (T2), removal and rewrite carry the version, removal refuses a row without one, and a rewrite of such a row goes ahead (T3, D3), the cutover gate holds when a target that can hash compared nothing (T4, 0009's option 1), and the IMAP source opens folders read-only (T5). T1 to T3 are in the minimum because testers may arm *apply deletions* (0149 D1). The first scheduled run of the appliance nightly after T3 and T4 is green, its three apply legs and its verification leg included, or a red result is explained in writing and dated; the managed smoke's apply half is green on the OTA stack on the same commit. | A 412 on create is recorded `copied`; a failed per-item lookup reads as "not there"; removal and rewrite skip the edit check when no version was recorded; the gate opens when a target that can hash compared nothing; the IMAP source opens folders with SELECT (0149 §1). |
| 0093 T2c The request door | `TRUST_PROXY` and `ACCESS_REQUEST_MAX_PER_HOUR` reach the API (done in #1137, merged 2026-09-24), and `TRUST_PROXY` is set in `ownpace-live`'s `.env` for the ingress that 0132 settles. Spam protection is 🅿️ **Parked (trigger: junk in the queue, or the request address published)**: the owner reads every request, and a decline can be quiet. | Both are empty by default, so every caller shares one count (§1). |
| 0130 A problem report that reaches a person | A tester can reach a person. Either the report form works on `ownpace-live`, with a Zammad configured, or the conditions name an address the owner reads. | Built. On `main`, `managed.yml` does not pass `ZAMMAD_URL`, `ZAMMAD_TOKEN` or `ZAMMAD_GROUP` to the API, whose environment is an explicit list, so on a stack started from `main` the form stays off whatever `.env` says, although step 8f of `docs/managed-bring-up.md` says to set them there. On this branch, with this plan's PR, `managed.yml` passes all three to the API, empty by default (2c564a5, guarded by `scripts/a-helpdesk-the-api-was-never-handed.unit.test.ts`). Whether a Zammad is configured for `ownpace-live` is 0139 T0's fact 3. |

**The owner's own steps.**

1. The lawyer's pass, with the registered address, the btw-id and the hosting details supplied to
   0139 (D4).
2. The mail-sending account, and the DNS records for the sending domain (0133).
3. `ownpace-live` brought up from its own checkout and `.env`, never a copy of the OTA stack's,
   with its database passwords set by the owner in that `.env` before the first bring-up (0132 D8)
   and the application role created with its own password before anything migrates (0132 T1b).
   Every network live's containers join is its own and named after `ownpace-live`, checked as 0132
   T0 step 5 says (0132 D9). D3's answer says the user names are changed, and the answer on the
   database says the user and password will be; that was about the OTA stack, where 0132 T2 changes
   them with `ALTER ROLE`, and 0132 records which of these is done there.
4. Live's own Trigger.dev account, project and access token, and the production names routed to
   `ownpace-live` in NetBird (0132 T1c, T1e). Live's Google client, carrying live's consent
   address, and live's addresses at Microsoft and Dropbox (0140 T11): a new Google client, as
   0140 advises, or live's address added to the one client there is, which the owner's answer
   also allows (0140 D5).
5. For each tester, before they connect: grant their request in `ownpace-live`'s access queue,
   and add their Google address as a test user for live's Google client (D2, 0140 T0).
6. On `ownpace-live`: the alpha setting from T1 switched on, and `MOLLIE_API_KEY` left empty.
7. Name N for the nightly gates (0132 T6, 0141 T14), and answer the open questions below.

## 4. Explaining the risk: who would need the credentials (D7)

The owner asked: *"Who would need/het credentials?"* Nobody. Rotation is not about who will be
given the secrets. It is about copies that already exist outside the owner's control.

- Workplan 0020 records that the stack's generated values (the database password,
  `SECRET_ENCRYPTION_KEY` and a Trigger.dev key) *"have appeared in pasted logs"*. It also says
  that *"trigger runner debug output prints the full task env, so treat runner logs as
  secret-bearing."* 0020 does not say where those logs were pasted. The machine also runs this
  public repository's CI (D3), and a public repository's workflow logs are not private.
- The application role's password is a literal in the shared baseline migration
  (`packages/ledger/migrations/0001_baseline.sql`), which this public repository contains.
  Nothing in the repository changes it (0132 T2), and the baseline creates the role with it on
  every new stack.
- The demo seed (`--with-demo`) creates demo organisations whose credentials are in the
  repository's scripts.

D7 stops new copies from being made. It does nothing about the copies that already exist.

**What D3 changes.** The logged values are the OTA stack's. `ownpace-live` does not inherit them:
it has its own `.env`, and at its first bring-up `ensure-env-secrets.sh` generates fresh values
for the secrets it knows (the signing and encryption keys, Trigger.dev's secrets, the identity
provider's master key and passwords, and the pooler's password). Live is never brought up with
`--with-demo`. So 0026 row 24 closes for `ownpace-live`, which never had demo secrets, and stays
parked with its trigger for the OTA stack, which remains a demo (0132 T5). The script does not
generate the database passwords: the database owner's is whatever live's `.env` says at the first
bring-up, and the application role gets the baseline's literal unless it is created with its own
password before anything migrates (0132 T1b).

**The advice.**

- For `ownpace-live`: copy nothing from the OTA stack's `.env`. Before the first bring-up, set the
  database owner's password in live's `.env`, and ClickHouse's and MinIO's, which
  `bootstrap-managed.sh` reports while they are at their shipped defaults. The owner will set them
  there (0132 D8). Changing the database owner's password once the volume exists changes nothing
  inside it (`bootstrap-managed.sh`). Create the application role with its own password before
  anything migrates (0132 T1b); if the baseline got there first, change it with `ALTER ROLE` before
  the first invitation (0132 T2). Keep live's `SECRET_ENCRYPTION_KEY` as its first bring-up made
  it. Stored credentials are encrypted under that key, and SECURITY.md states there is *"no
  rotation"*: a new key after testers have connected would make every stored credential unreadable,
  and every tester would have to reconnect.
- For the OTA stack: row 24's rotation waits for its trigger. When it fires, re-running
  `ensure-env-secrets.sh`, which row 24 names as the way to rotate, does not do it: the script
  says *"re-running it never rotates anything"*. 0132 carries the steps.

**The bridge D7 names is also a gate.** A pull request runs on GitHub-hosted runners (`ci.yml`),
so a contributor's code does not run on the machine before the owner merges it. After the merge
it does: a push to `main` runs on the self-hosted runner, and the nightly gates build `main`
there. SECURITY.md says of that runner: *"trusted workflows only (docker socket + root = RCE
risk)"*. So the owner's merge is the gate for code, just as the access queue is the gate for
people. The advice is to keep the self-hosted runner off `pull_request` events, as it is today,
and to read any change to `.github/workflows/` before merging it with the same care as a change to
the stack itself. D3's separation is by name on one Docker daemon, so a workflow that runs on that
runner can reach `ownpace-live` as well as the OTA stack.

## 5. Further work, and where it is planned

The review found more than the ten plans above cover, and this section first named the rest W11
to W19 so that they were not lost. On 2026-09-24 the owner chose, item by item: *"W11 write, W12
write, W13 write, W14 write, W15 explaoin, W16 write, W17 write, W18 explain, W19 write"*
("explaoin" is read as "explain"). The seven the owner said "write" to were opened the same day,
each under the next free number. The two the owner asked to have explained were explained, and
later the same day the owner answered both. They were opened under the next free numbers, 0148
and 0149.

**Opened 2026-09-24, at the owner's word "write":**

- **W11 → 0141 Proof before strangers:** live runs of the sources T2 labels, the 0103 organiser
  canary (T9), the 0105 Soverin supervised run (T7), and a browser walk of the managed journey
  (T12). It also moves shared mailboxes to Partial until one is copied (T10), has the detectors and
  the permission report tell a Connect-with-Microsoft tester the true reason (T11), makes the O365
  and live-target lanes count only when they ran the product against a real account (T13), and
  sets the nightly managed gate's readiness rule (T14). Live proofs run on `ownpace-live`. T7 runs
  on the OTA stack, not live: its source is that stack's demo Nextcloud, and the lane it arms reads
  that stack's `.env`. The OTA stack's nightly gate stays the CI signal (D3).
- **W12 → 0142 Alerts someone reads:** somebody is told when the stack, the tick, the disk or a
  pass fails, on `ownpace-live` first.
- **W13 → 0143 A box with a known size:** capacity for both stacks on the one machine, each with
  its own Trigger.dev plane (D3), caps on passes and on migrations per organisation (T1, T2), a
  stated largest file that is refused before a byte moves (T4), and one measured rehearsal of the
  alpha's shape (T9). JMAP files over 8 MB (T3) are split in two: T3a, a refusal that names the
  real reason, is in 0143's alpha minimum, and T3b, the streamed upload, comes after. Run retention for
  tenants that are never billed is parked (0143 T6, and T3 here). A manual sync's
  `concurrencyKey` is done: since #1137 (merged 2026-09-24) the manual sync route sets it to the
  mapping's id.
- **W14 → 0144 Saying what is true to a tester:** a tester guide (T1), known limitations (T2), the
  "read-only" wording (T3), the warning in front of the delete switch (T4), a destination that is
  not empty (T5), a person to write to before and after sign-in (T6), *Request access* on the
  sign-in page (T7), and a close-account screen (T8). The notice itself is not 0144's: it is T1
  here, and the alpha conditions are 0139 T2.
- **W16 → 0145 Phones, screen readers and in-app browsers.**
- **W17 → 0146 A release testers can name:** an alpha tag (0146 T0 recommends `v0.2.0-alpha.1`),
  with the build written into every problem report (T2); `ownpace-live` running only a release tag
  (T5); and the Node runtime of the tasks (T6). The watch on identity provider releases is 0135
  T7, and 0146 T8 extends it to the other pinned images Dependabot leaves alone. `ownpace-live` is
  deployed by hand from a tag, while the OTA stack keeps following `main` nightly (0132 T1g).
- **W19 → 0147 An index that writes itself:** the workplan index's table generated from each
  plan's own first line, Status heading and task table (T1), with the hand-written sections kept as
  history (T2), and the Status blocks that contradict themselves or the code corrected as dated
  notes (T3). T3 (a), the notes on 0008 T7, 0009 and 0026 row 14, comes before the first
  invitation; the rest after. 0009's note, on the decision 0149 T4 carries, was written on
  2026-09-24.

**Opened 2026-09-24, at the owner's word after the explanation:**

- **W15 → 0148 A guide written for the person using it.** The owner answered in four points:
  *"Audience: the in-app guide should target the endusers/testers, not the operators/self-hosters
  (they are more technical, and do need to edit env files/run commands)"*; *"Contradict:
  self-hosters need to make those, but endusers dont, or not in the ownpace-managed deployment. Stop
  the false hints on managed."*; *"cards that cant work: hide on manged"*; and *"Gaps: write also
  dutch guides for each source and target."* ("manged" is read as "managed".) So under 0148 the app
  serves a guide written for the person who connects an account, and the operator material stays in
  `docs/` (T1). Where the deployment carries a provider's app, nothing tells a tester to create one
  or register an address on one (T2). A card that cannot work on managed is hidden there, the export
  archive first (T3), which answers open question 4. (The owner later kept the archive card,
  labelled: 0148 D10.) Each source and target card gets a guide in Dutch and in English, Dutch first
  (T4). The owner then answered 0148's five questions. *Via IMAP* stays on managed (D5), the
  renderer in `Docs.tsx` is extended (D6), and the Apple export stays on the appliance, tagged *to
  be tested* (D7). The five new guides are written in English as well before the first invitation
  (D8), and the appliance's `/docs` points to the operator documents (D9).
- **W18 → 0149 Removal fails closed, and reads stay reads.** The owner: *"write as a plan. But we
  do offer 'apply deletions'. And do hold the cutover-gate when nothing was compared."* So a tester
  may arm *apply deletions* (0149 D1), and 0149 makes removal fail closed before the first
  invitation: a DAV 412 on create is an adoption (T1), a lookup that fails is not an absence (T2),
  and removal carries the version and refuses without one (T3). A row without a version is
  still rewritten from the source, the owner's answer to 0149's open question 2 (D3). The cutover
  gate holds when a target that can hash compared nothing (T4, D2). 0149 read that as 0009's
  option 1, and the owner confirmed the reading.
  0149 also proposes that the IMAP source opens folders read-only, with EXAMINE rather than SELECT
  (T5), and puts it in its alpha minimum.

## 6. Who builds what, and in which order (2026-09-24)

On 2026-09-24 the owner asked for the plans to be built. Three answers set how:

- **One pull request per task:** *"One PR per task"*. Each task is built on its own branch, named
  with the building session's prefix, and has its own guard. A task too small to stand alone
  rides with the task beside it in its group, and the pull request says so.
- **The order:** *"3 (tester-facing) then 1 (safety/foundation) then 2 (live)"*. What a tester
  meets comes first, then what keeps a tester's data safe, then the second stack itself.
- **Two sessions:** *"Yes, but create logical groups you can stack, and devide between you and the
  other session."* So the tasks of 0131 to 0149 that an agent can build are put in groups. A group
  is a **stack**: its pull requests are built in the order listed, and one that needs another
  group member's unmerged change is branched from that member's branch and says so. Each group
  belongs to one session, so that two sessions never edit the same files at once.

The two sessions are named here by their branch prefixes:

- **R**, `claude/ownpace-public-readiness-y7orc6-…`, the session that wrote 0131 to 0149;
- **M**, `claude/mailbox-sync-errors-c2xsw2-…`, the session that built most of the plans before
  0131, 0128 among them.

R takes what a tester meets, because those groups share the web app's strings, the wizard and
the cards, and one session can keep them from colliding. M takes the engines, the connectors, the
worker and the operator's side, which it built most recently. The owner's own steps are not in the
groups: they are in each plan's task table and in T5's list. R works R1 to R7 in order and M
works M1 to M7, each group in its numbered order.

| Group | The stack, in order | Mostly touches | Waits on the owner for |
|---|---|---|---|
| **R1. The alpha, said out loud** | 1. 0131 T1 (a), the alpha setting and note. 2. 0131 T3 (a), nothing charged. 3. 0144 T7, *Request access* under the sign-in button. 4. 0144 T6 (a) and (c), a person to write to. 5. 0134 T1 (a) and (b), the erasure wording and the start-up check. 6. 0139 T10 (c) and (a), the `--no-drafts` switch and the one link module. 7. 0139 T4 (a), (b) and (d), the notices. 8. 0131 T1 (b), the links. 9. 0139 T3, acceptance recorded at first sign-in. | `Layout.tsx`, `Login.tsx`, `RequestAccess.tsx`, `Billing.tsx`, `strings.ts`, `notifications.ts`, the access-request routes, `site/` | 0144 T0 (the address testers write to); 0139 T2 (the conditions) for steps 7 to 9 |
| **R2. Cards and hints** | 1. 0141 T1 with 0131 T2 (a), the live-proof record and the *Experimenteel* tag, which the export archive card carries on managed (0148 D10) and 0140 T8 (a) and T9 (a) carry too. 2. 0136 T5, the managed API refuses a typed disk path, with the sentence it says instead (moved here with D10). 3. 0148 T9, the export read from a folder in the migration's own Nextcloud or WebDAV files (0148 D11), stacked on step 2. 4. 0148 T3's Apple tag (D7), on both editions. 5. 0148 T2 (a), (b) and (d), no hint to create an app the deployment carries. 6. 0144 T3 (a) and (c), the line beside *Connect with Google* and the grant page's "read-only". 7. 0140 T2 (b), T3 (a), T6 (b) and T7 (b), the consent screens' own lines. 8. 0141 T10 (a), shared mailboxes to Partial. (0148 T3 (a), the hiding, is dropped: D10.) | `front-door-cards.ts`, `FrontDoorChooser.tsx`, `CreateMapping.tsx`, `Setup.tsx`, `provider-setup.ts`, the create route, `microsoft-consent.ts`, `feature-matrix.md`, `apps/api`'s connection and migration routes (0136 T5, 0148 T9), `credential-fields.ts`, `smoke-managed.sh`'s archive steps | none |
| **R3. Guides** | 1. 0148 T6 (a), the renderer's first half. 2. 0148 T1 with T2 (c) and T8 (c), customer guides served and operator material left in `docs/`. 3. 0148 T4 (a) with T8 (a) and (b), the Google, Microsoft, Dropbox, Box and Apple guides in Dutch and English. 4. 0148 T4 (b), the IMAP, JMAP, DAV, Nextcloud and Soverin guides. 5. 0148 T5 (a), the checklist profiles. | `Docs.tsx`, `docs/guides/`, the end-user-docs lint, `ci.yml`'s filter | 0148 T0, the reading, after step 4 |
| **R4. Phones and screen readers** | 1. 0145 T1 (a), the phone menu's focus. 2. 0145 T3 (a), each step starts at the top. 3. 0145 T5 (a) with T7 (a), the consent window on the press. 4. 0145 T6 (a) and (b), one language through the consent and the grant. 5. 0145 T4 (a), errors announced. | `Layout.tsx`, `CreateMapping.tsx`, `ProviderConsent.tsx`, the grant and view pages | 0145 T0 (one press on an iPhone) before step 3 |
| **R5. What a tester reads outside the app** | 1. 0144 T3 (b), the site stops saying "read-only". 2. 0144 T1 (a) with T5 (a) and 0145 T9 (a), the tester guide's short form. 3. 0141 T12 (a1), 0145 T10 (a) and 0141 T7 (a), the runbook stages and the Soverin corrections. 4. 0133 T1 (a), passing mail on by hand. | `site/`, the owner test runbook, `docs/managed-bring-up.md` | 0144 T0 (the site copy), 0139 T2 |
| **R6. Roles and row security** | 1. 0137 T7 (a), nobody invited below admin until 0137 T2. 2. 0138 T5 (a) and (b), the documents say where row security holds. 3. 0138 T3 (a) with T4, the tasks lose the owner's connection string, with the guard. | the team and member routes, `apps/worker`, `docs/rls-guide.md`, the architecture document | 0137 T0 |
| **R7. `ownpace-live` on the reference machine** | 1. 0132 T1, names that follow the project. 2. 0132 T3 (a) with T1f, loopback binds. 3. 0132 T2 (b), roles that follow `.env`. 4. 0132 T6 (b), the hold covers every enqueue. 5. 0146 T6 (a), `node-24` for the tasks. 6. 0146 T2 (a), the version and the build line. 7. 0132 T1g and T6 (a) with 0146 T5 (a), `deploy-live.sh` from a tag. 8. 0132 T3 (b) to (d) and T7, the exposure checks and the gate for live. 9. 0139 T10 (b), the site's second copy. 10. 0143 T9 (a), the rehearsal script. | `deploy/compose/`, `scripts/`, `.github/workflows/`, `trigger.config.ts` | 0146 T0 (the tag); 0132 T1b to T1e are the owner's bring-up |
| **M1. Removal fails closed** | 1. 0149 T2 with T1, in the engines. 2. 0149 T3. 3. 0149 T4, beside 1 and 2. 4. 0149 T5, beside them. 5. 0141 T8 (c), the nightly's legs on targets we do not run. | the DAV and JMAP writers, `dav-remove.ts`, `domain-sync.ts`, `apply-deletion.ts`, `verification.ts`, `imapflow-source.ts`, ADR-0024 | none |
| **M2. A host we are asked to reach** | 1. 0136 T1 (a), internal addresses refused after DNS. 2. 0136 T2, the operator's allowlist. 3. 0136 T3 (a), a probe answer that says what happened (after 0129 T1). 4. 0136 T1 (b), the bring-up checks Docker's ranges. 5. 0136 T6 (a), guards and mutation runs. | `packages/connectors`, `probe-connection.ts`, the bring-up scripts | none |
| **M3. What is kept, and what is removed** | 1. 0139 T6 (b), deleting a migration revokes its credential. 2. 0139 T6 (a), a declined request deleted after 30 days. 3. 0139 T7 (a), `operator.sh close`. 4. 0139 T6 (d) and 0134 T1 (c), the task runner's stores. 5. 0134 T3, what a lost machine costs. 6. 0139 T8 (a) and T9, the breach procedure and `SECURITY.md`. 7. 0139 T7 (b), after 0135 T8. | the access-request and retention jobs, `scripts/operator.sh`, `docs/` | 0139 T0 and T1 for the texts |
| **M4. A box with a known size, and alerts** | 1. 0143 T3a, the JMAP file refusal. 2. 0143 T4 (a), a file no pass can carry refused up front. 3. 0143 T2a, a cap on migrations. 4. 0143 T5, every data type gets a turn. 5. 0142 T2 (a), a tick that says it ran. 6. 0143 T1, every task names its machine. 7. 0142 T1, the status page tells the owner. 8. 0142 T6 with 0143 T2d (a), the incident runbook. | `apps/worker`, `packages/scheduler`, the JMAP file target, the API's ready routes, the status page's config | 0143 T0 (a) (the machine preset) before step 6; 0142 T0 before step 7 |
| **M5. Mail that reaches a tester** | 1. 0133 T2 (c), `requireTLS` with a login. 2. 0133 T3 (b) and (c), Mailpit only with the demo, and a note on `.invalid` addresses. 3. 0133 T2 (b), the identity provider's relay. 4. 0133 T5, after 0139 T1. | the API's mail transport, the bring-up scripts, `setup-zitadel.sh` | 0133 T0 (the relay) |
| **M6. What Microsoft is asked, said truthfully** | 1. 0141 T11 (a), the detectors and the permission report. 2. 0141 T14 (a), the gate's readiness rule. | the permission report, the detectors in orchestration, the gate's docs | 0141 T14's N |
| **M7. The front door** | 1. 0135 T1 and T2, organisation registration off and the project check. 2. 0135 T3 (a), the organisation count. 3. 0135 T6 (a), the identity provider's languages. 4. 0135 T7 (a) and (c), the release notes and the weekly pin check. 5. 0135 T5, after 0139 T10. | `setup-zitadel.sh`, `managed.yml`, `.github/workflows/` | none |

**Rules for both sessions.**

- **A task's pull request** carries its guard, updates its plan's Status block, and names its
  group and step in its description. Once 0147 T1 has landed, it also runs
  `node scripts/workplan-index.mjs --write`.
- **Out of turn.** A group of the other session is not started without the owner's word. A task
  that turns out to touch a file the other session is changing waits for that pull request, or is
  rebased on it, and the description says which.
- **A group whose owner step is missing** goes on with the steps that do not need it, and the
  pull request says what waits.
- **0147 T3 (a)**, the dated notes on 0008 and 0026, is R's and goes with 0147 T1's pull request.

## Open questions

1. **The end of the alpha (T4).** (a) everything ends, which is recommended; (b) everything
   carries on under new conditions; or (c) each tester chooses, with (a) for anyone who does not
   answer.
2. **Is the nightly managed gate paused during the alpha?** *Answered 2026-09-24, by D3: no.* The
   gate, scheduled for 03:30 UTC (`cron: '30 3 * * *'`), keeps rebuilding and seeding the OTA
   stack `--with-demo`, and testers are on `ownpace-live`, which CI never touches. 0132's earlier
   options for its T1, pausing the gate for the alpha's weeks among them, are superseded.
   `ownpace-live` is deployed by hand from a tag (0132 T1g, 0146).
3. **Does a tester who names a source wait for that source's live proof (0141, W11)?** This is
   also 0141's open question 1, and one answer serves both plans. The request's *"What are you
   moving?"* tells the owner which sources a person needs before the owner grants, so the answer
   applies per source. (a) No: the label is the answer for every source (D6). (b) Yes, where the
   proof is one sitting on the owner's own accounts: the Microsoft 365 account (0141 T2), Dropbox
   (T3's first half), Apple (T4), Google Tasks (T5) and Soverin as a target (T7). The label alone
   carries Box, a second Google account and whole-domain delegation, whose proofs need a tester or
   a Workspace (0141 T3, T6). The two plans recommend differently. This plan recommends (a), with
   one exception worth weighing. The Microsoft 365 account's calendar face fetches each event from
   `…/events/{id}/$value` with an iCalendar preference header (`graph-calendar-source.ts`), and
   0059 T5 records that nobody has confirmed Graph serves that combination. If it does not, the
   face needs rebuilding, not fixing. 0141 recommends (b), because each of those proofs is one
   sitting, and the calendar may need a rebuild rather than a fix.
4. **The export archive card on managed:** keep it with an "Appliance only" tag and disabled (T2's
   proposal), or hide it on managed? 0136 open question 3 is the same question: 0136 T5 makes the
   managed API refuse the disk path and advises hiding the card. One answer serves both plans.
   *Answered 2026-09-24, by 0148 D3: hide.* The owner: *"cards that cant work: hide on manged"*.
   0148 T3 is to hide the card on managed; it returns when an upload or relay path exists (0148's
   parked trigger). *Answered again 2026-09-24, by 0148 D10: label.* The owner: *"Hide the archive
   card on manage: I don't want them hidden. I want labelled as 'expirimental'."* The card stays,
   with T2's tag, and 0136 T5 refuses the disk path on managed.
5. **Target cards:** should T2's label also go on targets? Soverin has no recorded live run as a
   target: 0105 T3's supervised run still waits for the owner, and 0141 T7 plans it, on the OTA
   stack. JMAP contacts and files have integration tests and no nightly leg: 0031 T2 says JMAP
   contacts are *"Not yet in the nightly e2e"*, and 0141 §1 found that the only e2e fixture that
   uses `jmap` maps mail. 0141 T8 (a) proposes the legs that map contacts and files to `jmap` in
   the appliance nightly. Until this is answered, the owner's grant is the only gate in front of a
   target card (0141 §1).
6. **Invitations inside a tester's organisation.** The owner is the gate for organisations (D2),
   but an owner or admin of one can invite anyone by email address, and that person gets in
   without the queue (§1). (a) Keep invitations during the alpha, limited to owner and admin as
   0137 T7 proposes, and let the conditions say that whoever a tester invites is the tester's
   responsibility. (b) Turn invitations off on `ownpace-live`, so that every person passes the
   queue. (b) matches *"I am the gate for letting people in the test."* more closely; (a) keeps a
   family or a small office able to try the service together. 0137 open question 1 asks the same
   question from the side of roles, with (b) here as its option (d).
7. **The invoice details card, and the long sentence, on a paid tier during the alpha (T3).**
   With the setting on, a tester on a paid tier reads *"Nothing is charged during the alpha"* and,
   a few cards lower, the amber *"Not provided yet. Invoices cannot be issued until this is filled
   in."* §3 keeps the form as it is because *"the alpha asks nobody to fill it in"*, and on that
   page the notice does ask. (a) Leave it, as §3 says today. (b) Treat the alpha as 0109 T8 treats
   the free tier: when `isAlpha()`, show `billing.party.notNeeded` (*"Not needed while your tier is
   free: nothing is invoiced."*), or an alpha variant of it, in place of the amber notice; the form stays. The T3 build
   points to (b). Separately: the Billing line's second sentence is eighteen words, over the copy
   budget, and is kept verbatim on the authority of §3's Decided text. (a) Keep it verbatim, which
   is how it is built; or (b) keep *"it is not a bill"* on screen and move the explanation into a
   fold. *Answered 2026-09-24: (b) for the card, with the free tier's text verbatim, and the same
   text in place of the second sentence.* The owner: *"Billing: show the free tier's 'not needed'
   text instead, also in the seconde sentence"*; asked which wording, the owner chose the free
   tier's text verbatim.
