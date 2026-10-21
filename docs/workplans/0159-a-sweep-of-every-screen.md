# Workplan 0159 — A sweep of every screen of the app and the site

> **In one line:** Every screen of the managed app and the public site, in English and Dutch, on a phone and a desktop, looked at as a tester meets it: what reads wrong, does not fit or a screen reader cannot follow is fixed where the words are ours, and put to the owner where they are the owner's.

## Status — 2026-10-21 (update this block at the end of every session)

**2026-10-21: follow-ups 6 and 12 built and merged.** Each was built from main, a second reviewer
tried to break it, and it merged on its own after `ci-complete` was green. Their new words, in
both cases, are the builder's and wait for the owner's reading (open question 8).

- **Follow-up 12, the line under a decided decision in Dutch** (#1649, merged 2026-10-21,
  `8380b2c7`). `DECISION_EFFECTS` holds each of its three lines in English and in Dutch. Both
  editions serve the Dutch as `effectNl` beside the English `effect`, and *Wacht op u* shows the
  half in its reader's language, also after a language switch. An answer from a server that sent
  no Dutch still shows the English, marked `lang="en"`. Fourteen unit tests were red before the
  fix and are green: thirteen on main, and one OpenAPI schema guard added in review, after the
  new `DecisionClosed` schema's `effect` description had parsed as a stray key. The two editions'
  decision suites passed against a real Postgres from `scripts/local-pg.sh` (28 tests). The item
  queues' own effect lines are not paired yet (follow-up 18).
- **Follow-up 6, a decided row says what was decided** (#1652, merged 2026-10-21, `bbe1d043`).
  A row under *Already decided* on Deletions and Moves now says it. It reads a `decided` field
  that both ledgers set from what they already record (`deletion_applied_at`), and both editions'
  queues carry it unchanged. On Deletions, the old copy of a renamed item removed through Moves,
  by a person or by the automatic removal of moved files' old copies, says *Moved*, never
  *Deleted*: that removal closes the move at the same time, compared in SQL. The heading stays the
  owner's *Already decided* / *Al besloten*. 29 guards were red on main and are green. The SQL
  half is pinned three ways: on Postgres in the integration job (also run on a throwaway
  Postgres, `scripts/local-pg.sh`), on PGlite in the unit gate, and in the appliance's e2e apply
  runs, which now check that an applied row says so.

**2026-10-19: round 2 answered and built; all 31 items done.** The owner answered rows 19 and 24
on 2026-10-19: *Yes* to the tiles drawn once on a phone, and *Yes* to all four cards of version
1.1 of the legal texts. Asked whether anyone besides the owner had accepted version 1.0, the
owner answered *nobody yet*, so privacy §13's 30 days' notice by email was owed to nobody and 1.1
applies from publication. #1638 draws the tiles once, under the migration's name, on a phone only.
#1639 is version 1.1 of the Alpha conditions, the terms and the privacy statement, applied word
for word from the draft the owner approved, with its version pins. Each was built from main, a
second reviewer tried to break it, and it merged on its own after `ci-complete` was green.

**2026-10-18: the owner's answers, built and merged; two asked again.** The owner answered the 31
questions of §5 on a page that offered *Yes*, *Keep* or their own words for each item. 29 were
built in seven PRs, #1630 to #1636, each from main. A second reviewer tried to break each one,
and each merged on its own, one after the other, on 2026-10-18 (UTC). Each was green in CI
(`ci-complete`) at its head commit, and each head already held the main it merged into. Two
answers asked for the proposal again: rows 19 (the tiles on a phone) and 24 (the legal texts).
Round 2 of both went to the owner the same day, and both wait for the owner. §5 gives each answer
with its PR, and §6 the follow-ups the seven PRs left.

**2026-10-17/18: the sweep, from the owner's request to sixteen fix sets merged.** On
2026-10-17 the owner asked: *"Do a full sweep of the UX of the app and website. Improve where you
can. Work autonomously."* A screenshot harness took 308 shots of every screen (§1). Thirteen
reviewers wrote 252 findings, and a second reviewer tried to refute each one: 195 were kept, 34
went to the owner and 23 were dropped. The kept findings folded into 149 fixes in fifteen fix
sets that touch different files, built side by side. A second reviewer tried to break each set,
and what they found was fixed before it merged. All fifteen merged on 2026-10-17 (UTC), #1613 to
#1627. Shooting main again after them found five loose ends, which are T16 (#1628, merged the
same day). Each of the sixteen was green in CI (`ci-complete`) at its head commit. The owner was
asked 31 questions the same day. Four are answered, and none is built here (§5).

**Evidence.**

- **Before**, on main at `01383e16`: 308 shots, 145 with a problem. Six overflowed a 390-px
  phone. axe found 284 serious nodes: color-contrast 181, link-in-text-block 72,
  label-content-name-mismatch 20, scrollable-region-focusable 9, list 2. It also found 104
  moderate or minor ones.
- **After the fifteen**, on main at `50c50875`: 308 shots, 4 with a problem. All four are the site
  home's *Leaving…* links, in both languages and at both widths (label-content-name-mismatch, 20
  nodes), which T16 fixed. No overflow, and no other axe node of any impact. The first run after
  the merges counted 8. The other four were the harness pressing step 5's button by its old
  name; the harness was fixed, and the product was not at fault.
- **T16's branch**, before it merged: its 100 shots taken again (the 40 app shots of the
  screens it changes and all 60 site shots): 0 with a problem, and axe clean on the site home in
  both languages.
- **Tests.** Each set added tests for what it changed and showed them red on the old code (the
  counts are in each PR). The integration tests of the support views (T13) and of the sharing
  rescan (T10) could not run here, with no container runtime. CI ran them, green on both PRs.
  Migration 0058 was applied to a real Postgres 16 with `scripts/local-pg.sh`.
- **One flaky test, fixed in #1622.** `Connections.unit.test.tsx` read the reason under the
  Dropbox button after one turn of the event loop. On a busy runner the form had not yet heard
  the deployment's answer, and it read *"Enter the App key and App secret first"*. The test now
  waits for the deployment's answer.

| Task | Status | Findings | PR | Merge commit |
|---|---|---|---|---|
| T1 The frame names every screen once, fits a phone, and can be skipped past | ✅ **Merged 2026-10-17** | 11 | #1613 | `7110af60` |
| T2 The doors before sign-in have a language, a way out and one title | ✅ **Merged 2026-10-17** | 15 | #1614 | `559e36d3` |
| T3 The Migrations list, a person's page and Team say what is true and fit a phone | ✅ **Merged 2026-10-17** | 13 | #1615 | `758bb856` |
| T4 Start a migration says what each step does and shows only what the tester chose | ✅ **Merged 2026-10-17** | 9 | #1616 | `7e0ac6d5` |
| T5 The Accounts page and the provider guides speak plainly and agree with the app | ✅ **Merged 2026-10-17** | 14 | #1617 | `99c3d7a9` |
| T6 Help: guides with an outline and a way back, checklists that match the forms | ✅ **Merged 2026-10-17** | 17 | #1618 | `805917ef` |
| T7 A migration's time and steps say what is true at every stage | ✅ **Merged 2026-10-17** | 11 | #1619 | `192fc093` |
| T8 The migration page's panels speak the reader's language and assume nothing | ✅ **Merged 2026-10-17** | 8 | #1620 | `647f16fc` |
| T9 Deletions, Moves and Failures read on a phone and in plain words | ✅ **Merged 2026-10-17** | 11 | #1621 | `fd0ddcac` |
| T10 Decisions and the sharing checklist say their answers in words, in Dutch | ✅ **Merged 2026-10-17** | 9 | #1622 | `25c256df` |
| T11 Verify and the Report read on a phone and in the reader's numbers | ✅ **Merged 2026-10-17** | 5 | #1623 | `b8989e2a` |
| T12 Finish and Confirmed say what blocks, read on a phone, and name things once | ✅ **Merged 2026-10-17** | 14 | #1624 | `29220270` |
| T13 Billing and the operator pages show money, dates and tables correctly | ✅ **Merged 2026-10-17** | 13 | #1626 | `3020b7c4` |
| T14 Pricing, the estimate and the home page in Dutch numbers and plain words | ✅ **Merged 2026-10-17** | 15 | #1625 | `bbd7e762` |
| T15 Legal pages read on a phone, Leaving pages use the app's words, Sign in keeps the language | ✅ **Merged 2026-10-17** | 11 | #1627 | `50c50875` |
| T16 The sweep's loose ends: one heading on every state, link names that read their words | ✅ **Merged 2026-10-17** | 5 | #1628 | `01ba14c0` |

*Findings* counts the reviewers' findings each set fixed. A finding that crossed sets was split
by file and is counted in each, so the column adds to 176 for 149 distinct fixes. T16's
five came from shooting main again and from the reviews' notes.

## 1. Why, and how the sweep was done

**Why.** The owner, on 2026-10-17: *"Do a full sweep of the UX of the app and website. Improve
where you can. Work autonomously."*

**The shots.** A screenshot harness, kept on the machine and not in this repository, built the
managed app as the UI smoke does and served it with fixture data at the same origin, with the
clock held still. It photographed all 62 app routes, in English and Dutch, at 390 px and at
1280 px: 248 shots. The routes include the empty and error states, the six steps of *Start a
migration* and the operator's pages. It photographed the site's 30 pages (15 in each language)
at both widths: 60 shots. On each shot it measured horizontal overflow, console errors, failed
requests and, on the app in English and on every site page, axe.

**The findings.** Thirteen reviewers read the shots and the code behind them: ten by area (the
pages before sign-in, the Migrations list and a person's page, Start a migration, a running
migration, the queues, Finish, Help, money, the site's front pages and its deeper pages) and
three across all of them (accessibility, words, and a tester's journey through both). Each finding
went to a second reviewer whose task was to refute it. Of 252: 195 kept, 34 for the owner, 23
dropped (D1).

**The fixes.** The 195 kept folded into 149 fixes, as 45 repeated another finding and one went
to the owner. They were grouped into fifteen fix sets that touch different files (D3), built side
by side, each with its own tests. A second reviewer tried to break each set; four asked for
changes before merge, and every point was fixed, or recorded in its PR and in §6. The sets
merged in the order D3 gives. Main was then shot again, and what it showed became T16, with the
notes the reviews had left for later.

## 2. What changed, as a tester sees it

- **Every screen names itself once**, in the top bar and in the browser tab, in the reader's
  language. A migration is called by its name, never its long id. A *Skip to content* link is
  the first stop for the keyboard. Each step page ends with *Next step: …*.
- **Before sign-in**, the sign-in and request pages have an English/Dutch switch and open in the
  language a link asks for; the site's *Sign in* carries the page's language. *Not now* on an
  invitation no longer loops back to sign-in.
- **The Migrations list's buttons say their word**: *Sync now*, *Pause*, *Details →*, *Delete*.
  A finished migration offers no *Sync now*. A list that does not load offers *Try again*.
- **A person's page** offers the Google grant link only where one of their migrations reads
  Google. **Team** is one readable list on a phone.
- **Start a migration**: step 1 asks *Who signs in to the accounts?*; step 4 asks the company
  question once; step 5's button says *Set up* / *Klaarzetten*; step 6 lists only the data types
  ticked, counts the Dutch way on a Dutch screen (18.734, 3,4 GB), and offers *Not now*.
- **Accounts**: *Add an account* no longer opens on IMAP with its boxes filled. *Targets* /
  *Doelen* are *Destinations* / *Bestemmingen*. An expired account's note names the button on its
  own row.
- **Help**: each guide opens with *On this page* and ends with a link back to all guides. Long
  addresses wrap on a phone. The Gmail section opens with the 2.5 GB-a-day limit. The checklist
  chooser lists the Microsoft 365 account and no retired tiles.
- **A migration's page**: *How long* shows only while a first copy runs. A migration that never
  ran no longer shows three green *Done* queues. Finish says *Needs you* once the stage says
  *Ready to switch*, and a migration without mail is not told about mail delivery.
- **In Dutch, a refusal is in Dutch**: a data type that cannot be added says why. The strip says
  *laatste ronde* / *last pass*, and the log is the *Technical log*.
- **Deletions, Moves and Failures**: names wrap at the slashes on a phone instead of shrinking to
  a letter. The chips are explained above the rows. The warning before *Turn on deleting by
  hand* is in plain words. A provider's raw error is a small grey *Technical message:*.
- **Decisions** say their answer in words, never JSON. Each row of the **sharing checklist** has
  its line in Dutch on a Dutch screen. A count of one is singular.
- **Verify and Confirmed** are labelled lists on a phone. Verify's score uses the reader's
  decimals (100,0%). Confirmed's own pass is *read back* / *teruglezen*, apart from Verify's
  check. Downloads are named after the document, the migration and the day.
- **Finish** step 2 says what holds up finishing (items that could not be copied), and the
  greyed mail buttons say why in words under the row.
- **Billing**: invoice rows wrap on a phone, months and periods are in words, a credit note has
  its own words. The operator's pages show euros, days and the invoice number a customer quotes.
- **The site**: Dutch prices and sizes (€2,50, 1,5 TB), *voorcontrole*, *switch* for *cut over*,
  and plain words for developer terms. The legal pages stack their tables on a phone and open
  with a list of sections. The Leaving pages use the app's own names (*Connect with Microsoft*,
  *postvak*, *eigen oauth-app*).
- **T16**: every loading, error and not-found state of a page with its own title has one h1. The
  site's Leaving links are named from their own words. The permission report's FullAccess line
  no longer ends in an internal reference.

## 3. The measurements, before and after

From the harness's report of each run. *A problem* is anything the harness flags on a shot: a
horizontal overflow, a serious or critical axe node, an error in the page or the console that the
shot did not expect, a request with no fixture, a broken link or image, a screen that never
showed, or a click the harness could not make. The error states' own failures are expected and
not counted.

| | Before (main at `01383e16`) | After T1 to T15 (main at `50c50875`) | T16's branch (its 100 shots) |
|---|---|---|---|
| Shots | 308 (248 app, 60 site) | 308 | 100 (40 app, 60 site) |
| Shots with a problem | 145 | 4 | 0 |
| Horizontal overflow | 6 | 0 | 0 |
| axe, serious (none critical) | 284 | 20 | 0 |
| — color-contrast | 181 | 0 | 0 |
| — link-in-text-block | 72 | 0 | 0 |
| — label-content-name-mismatch | 20 | 20 | 0 |
| — scrollable-region-focusable | 9 | 0 | 0 |
| — list | 2 | 0 | 0 |
| axe, moderate and minor | 104 | 0 | 0 |

- **color-contrast** was mostly the build stamp, pale grey under the menu and in the site's
  footer: on 74 of the 124 app shots axe read, and on all 60 site shots. The rest was pale grey
  text in the queues, Decisions, Sharing and the request form, and the estimate's dimmed fields.
- **link-in-text-block** was links inside sentences told apart by colour alone (D5).
- **label-content-name-mismatch** was the site's *Leaving…* links. Their `aria-label` said
  *Leaving Google* while the visible text was *Google*. A reviewer dropped this as not a WCAG
  failure, since the name contains the visible word. axe still flags it, so T16 names each link
  from its own words: a visually hidden *Leaving* before the visible name, and no `aria-label`.
- **The six overflows** were three Help guides on a phone (long addresses in code), in both
  languages.

## 4. The decisions

**D1. A finding is kept only if a second reviewer could not refute it.** Of 23 dropped, most
were the harness's fixtures showing something real data cannot reach, or a behaviour an earlier
plan chose on purpose (the Leaving menu as a `<details>` that runs no script, *up* from a
migration going to the Migrations list), or words the owner chose.

**D2. The owner's words stay the owner's.** Every text key a fix changed was compared with the
owner's own text commits (#1556 among them). Where a fix changed the owner's words in more than
spelling, case or a noun, it went to the owner instead (§5). Five keys were changed within that
limit: `tenants.org.readError` (EN, *organization* to *organisation*), `finish.ending.keep` (EN,
the data type in lower case), `confirmed.joined` (NL, *controle* to *terugleesronde*), the setup
checklist's client-secret keys (NL, *Client-secret* to *Clientsecret*, the owner's own later
field name) and `tenants.invite.hint` (EN and NL, *below* to *above*, which was wrong).

**D3. Fifteen sets that touch different files, built side by side.** A finding that crossed
sets was split by file, and each set did only its part. Where two sets had to touch one file,
they touched different parts of it, and the order said which went first: the frame (T1) before
every screen it draws around; T3 before T7, both in a person's page; T4 before T8, both in Review
and start; T14 before T15, both in the site's build. The text tables, the glossary, the API
description and the site's build were shared, in separate places.

**D4. One h1 on every page.** The top bar's title is a heading only where the page draws none of
its own. The routes whose page has its own are listed (`OWN_H1_PREFIXES` in `Layout.tsx`); on
those the bar's title is a paragraph. Help, the setup checklist and a migration's step screens
keep the bar's h1. T16 gave each loading, error and not-found state of the listed pages its own
h1, so no state is left with none.

**D5. A link inside a sentence is underlined.** `text-blue-700 underline underline-offset-2`
where a link shares its line with other words. A link that stands on its own line or row keeps
its look. No rule for all links: the menu's lit entry and the buttons would have changed too.

**D6. Dutch where the server spoke English, values as found.** A refusal to add a data type now
carries a code (`after_cutover`, `measured_no`), and the screen says it in the reader's language.
The sharing checklist's Dutch line is served beside the stored English (`verdictTargetNl`), since
the stored English is what the manual-only refusal quotes. Rights such as FullAccess, roles in
chips, addresses and folder names stay as they were found (0144).

**D7. Step 5's button says what it does.** *Set up* / *Klaarzetten*, with a line under it: the
migrations are set up paused, and nothing is copied before *Start*. It said *Next*.

**D8. The harness stays out of the repository.** It is a scout, not a gate. What it found is held
by tests in the repository: the unit tests of each screen, the guards in `scripts/`, and the UI
smoke (`pnpm test:ui`). A finding only its fixtures could show was dropped, and its own mistakes
were fixed in the harness, never in the product.

## 5. The owner's items

Put to the owner on 2026-10-17, each with a proposal: 34 findings, 31 questions once four were
folded into others and one kept finding was moved here (item 1). None is built in this plan; a
later PR builds the answers.

| # | The question | Answer |
|---|---|---|
| 1 | The sharing checklist tells every Microsoft 365 tester their rows were *found before grouping by folder existed*, which is wrong for Microsoft (the owner wrote the Dutch on 2026-10-10) | **Yes** — #1636 |
| 2 | One sharing feature has many Dutch names (*Share-recht*, *Share-toegang*, *Deelrechten*, *rechtenlijst*), and the sharing buttons' words | **Yes** — #1636 |
| 3 | *What this means and what you can do* shows English API documentation (POST paths, `toNaturalKeyHash`) on Deletions, Moves and Failures | **Yes** — #1634 |
| 4 | Decisions are the server's English sentences, and the new-mailbox button promises *Create a mapping* where it only records the answer | **Yes** — #1636 |
| 5 | When the check finds something, Verify shows English developer prose on a Dutch screen | **Yes** — #1635 |
| 6 | Verify's and Deletions' chips are raw tokens on Dutch screens (PASS, SKIPPED, NOT_VERIFIABLE, ERROR, reported, trashed, inferred) | **Yes** — #1634 (Deletions), #1635 (Verify and Finish) |
| 7 | Finish step 4, *Change MX/DNS and reconfigure clients*, is jargon, and wrong for an @gmail.com address | **Yes** — #1635 |
| 8 | Confirmed's headline says *verified by hash*, which says too much for calendars and contacts | **Yes** — #1635 |
| 9 | The Dutch migration page says *De bestanden komen…* (files) for mail, calendars and contacts | **Yes** — #1632 |
| 10 | Finish's step description is *De cutover-checklist* | **Yes** — #1632 |
| 11 | Lines before sign-in the owner reviewed carry an abbreviation, English words, a comma splice or a vague invitation | **Yes** — #1633 |
| 12 | English and Dutch give opposite advice about asking for access again | **Yes** — #1633 |
| 13 | Dutch says *Aanmelden* to sign in but *Uitloggen* to sign out | **Yes** — #1633 |
| 14 | The sign-in tagline *Soevereine datamigratie voor gezinnen en mkb* is jargon the site never uses | **The owner's own words:** EN *"Your mail, calendars, tasks, contacts and files back to Europe."* NL *"Uw e-mail, agenda's, taken, contacten en bestanden terug naar Europa."* — #1633 |
| 15 | The English line under *They do, with a link* is broken grammar | **Yes** — #1633 |
| 16 | Dutch *Instellen* reads as an action, not as the link to the setup checklist | **Yes** — #1632 |
| 17 | The checklist title *Aanbieder instellen* and the English intro (the destination's sentence is T6's) | **Yes** — #1632 |
| 18 | Lines a person reads call providers *IMAP* and *JMAP* where the wizard said *Another mail provider* | **Yes** — #1632 |
| 19 | On a phone each data type repeats the same *source → destination* tiles | **Yes** (round 2, 2026-10-19) — #1638 |
| 20 | *Mail with no Message-ID* on Review and confirm (kept in #1596) | **Yes** — #1632 |
| 21 | During the Alpha, Billing shows *Data verplaatst, in totaal: 0 GB* under *Alle gegevens: 214 GB* | **Yes** — #1632 |
| 22 | Other words from the owner's review of 2026-10-10 that drift from the glossary | **Yes** — #1632, with `access.noteHint` in #1633 and `finish.ending.phase.cutover` in #1635 |
| 23 | Dutch says *provider* where the rest of the app says *aanbieder*, the grant and progress pages included | **Yes** — #1633 |
| 24 | The Alpha conditions and the terms still use the old names of the two deletion switches | **Yes** (round 2, 2026-10-19), with the rest of version 1.1 of the legal texts — #1639 |
| 25 | The site's hero paragraph (0144 P5a): *Geen big bang* / *No big-bang cutover* | **Yes** — #1631 |
| 26 | The site promises a *free preflight* the app never names (privacy §4.3 says preflight) | **Yes** — #1630 |
| 27 | The Dutch home page says in two ways that nothing is deleted at the source | **Yes** — #1631 |
| 28 | The first facts card's heading opens a TypeScript test on GitHub without saying so | **Yes** — #1630 |
| 29 | Leaving Google says you sign in three times; on the OTA stack the app asks once | **Yes** — #1630 |
| 30 | Connecting Google during the Alpha can end on Google's *Access blocked* page with no warning in the app | **Yes** — #1633 |
| 31 | The *everything arrived* mail tells a Dutch tester *U hoeft niets te doen* while the guide's next step is *Verificatie* | **Yes** — #1635 |

**The answers (2026-10-18).** The owner answered on a page that offered *Yes*, *Keep* or their
own words for each item: *Yes* to 28, their own words for row 14 (the same words as above), and
for rows 19 and 24 a note asking for the proposal again. The 29 answered were built in seven PRs.
Each was built from main, reviewed by a second reviewer who tried to break it, gated, and merged
one at a time on 2026-10-18 (UTC). In the order they merged:

- **#1630** (`3477c38f`), the site: *Leaving Google* says one sign-in where the stack asks once;
  the estimate, pricing and the archive guide no longer promise a *free preflight*; and the first
  fact's proof link says it opens code (rows 26, 28, 29).
- **#1631** (`c4d2ed28`), the site's home page: the first paragraph without *big bang*, and the
  Dutch source promise said one way (rows 25, 27).
- **#1632** (`8742e94d`), the migration pages, Accounts, Help and Billing: *De kopieën komen…*,
  *The checklist for switching over*, *Instelstappen*, *Instelchecklist*, the IMAP and JMAP
  names, *Mail without a message identifier*, Billing's Alpha lines, and the review's leftover
  words (rows 9, 10, 16 to 18, 20 to 22).
- **#1633** (`c1a12c98`), sign-in, the first screens and the grant page: *Aanmelden* and
  *Afmelden*, the owner's tagline, the entry lines, *aanbieder*, and a line before the first
  Google sign-in during the Alpha (rows 11 to 15, 22, 23, 30).
- **#1634** (`e9913b4e`), the queues: *What this means and what you can do* written for the
  reader, in their language, and Deletions' chips in words (rows 3, 6).
- **#1636** (`f20bbce8`), Decisions in the reader's language with a button that says what it
  does, and one name for a share (rows 1, 2, 4).
- **#1635** (`5f5e64d1`), Verify, Confirmed and Finish: the verdicts and four findings in words,
  the server's text in a closed *Technical details*, Finish step 4 in plain words, Confirmed's
  headline, and the *everything arrived* mail (rows 5 to 8, 22, 31).

**Asked again.** Rows 19 and 24 went back to the owner on 2026-10-18, as a round 2. *Row 19*: the
owner said round 1 was not in Dutch. Round 2 shows before and after shots of a prototype, on a
phone only: the tiles once, under the migration's name, and the desktop unchanged. It saves fewer
rows in Dutch than in English, and a migration of one data type can gain a row in Dutch. It has
no new words. *Row 24*: the owner said the proposed Dutch held English. Round 2 is a checked
draft of version 1.1 of the Alpha conditions, the terms and the privacy statement, in four cards:
the switches' names (Alpha §8, terms §2), *aanmelden* and *afmelden* in the Dutch texts, the
count before a migration renamed (privacy §4.3, §5, §9), and two-factor sign-in, passkeys and
the lock after ten wrong passwords (privacy §4.4, §5, §9, §10, on a legitimate-interest basis).
It also asks whether anyone besides the owner accepted 1.0, since privacy §13 promises 30 days'
notice by email of a material change. Nothing in `site/legal` changes before the owner says yes.

**Round 2, answered.** On 2026-10-19 the owner said *Yes* to row 19 and *Yes* to all four cards of
row 24, and answered that nobody besides the owner had accepted 1.0. #1638 built row 19: on a
phone, `MigrationTiles` draws the two tiles once under the migration's name on the Migrations list
and a person's page, and each line keeps its data type, chip and sentence; from `sm` up nothing
changed, and the site's picture of a person's page was taken again. #1639 built row 24 as version
1.1 of the three texts, dated 2026-10-19: `LEGAL_VERSIONS`, the hashes a tester accepts and the
legal README's table say 1.1, and the privacy briefing records that no notice was owed.
Both wait for the owner.

**Deviations worth recording.**

- **#1630.** The estimate's *cannot know* line now says the page cannot know what the destination
  already holds, and that Ownpace counts it when you review your migration. It no longer says the
  review checks that the destination accepts your data, because the review step does not check
  that.
- **#1630.** The site's build reads `GOOGLE_ACCOUNT_SCOPE_CLASS` by the API's rule: `restricted`,
  trimmed, and in exactly that case (not lower-cased). The site follows a change on its next
  build.
- **#1632.** The IMAP and JMAP names are made in `providerName` (`ProviderTile.tsx`), so they also
  show outside the Migrations list and a person's page: in the name a new migration to a JMAP
  destination is saved with, in the rare *Slowed by …* line, and in the heading of the migrated
  person's `/view`. Accounts, the site and a migration's *From … to …* line keep *IMAP* and
  *JMAP*.
- **#1632.** The scope manifest's version went to `2026-10-18` for a change of words only, as the
  owner approved. The promise is unchanged.
- **#1633.** The Alpha's Google line stands above the Google cards on step 4 of *Start a
  migration*, and right above *Continue with Google* on a migration's grant link. On a person's
  grant link it stands above the first account that still has a button, after any account
  already connected, and is not shown when no account has one.
- **#1635.** Finish step 1, built as asked, read *The check did not pass: Did not pass*, or *…:
  Passed, with warnings*. A change before the merge says a failed check once, as a sentence (*The
  check did not pass.* / *De verificatie is niet geslaagd.*), and puts any other verdict that
  holds finishing back after *The check's result is not enough to finish yet:* / *De uitkomst van
  de verificatie is nog niet genoeg om af te ronden:*. This answered the question the PR had put
  to the owner: that line came with 0038, not with the owner's text review.
- **#1636.** `decisionResolvedEffect` takes `changedSomething`, not the category. An answer says
  the migration acts on it only when a shared address's pattern was written to a discovered
  group. Any other answer, one that names no pattern or matches no group included, says *Answer
  recorded. Nothing in your migrations changes because of it.*

## 6. Follow-ups and known limits

1. **The appliance's /people and /decisions have two h1s.** `pageHasOwnH1` in `Layout.tsx` is
   managed-only, so on the appliance the bar keeps its h1 beside the page's own (D4).
2. **Billing has no h1 for a moment while it loads.** Its lazy route's `Suspense` fallback is
   `null` (`AppRoutes.tsx`); T16's h1 is in the page's own loading state, which comes after.
3. ~~**An *inferred* row under Deletions' *Waiting on you* is explained only on hover.**~~
   **Resolved in #1634.** An inferred row reaches that list after enough passes and has no delete
   button, and the sweep's lead explained only *reported* and *trashed*. A line of its own now
   shows when an assumed row is listed (`deletions.evidence.lead.inferred`): the item is missing
   from full scans, was never reported deleted, and is not deleted on the new system. The builder
   wrote its words; the owner approved the explanation, not its wording.
4. **Accounts, an expired sign-in whose side is not known.** The row says the connection to this
   account has expired, then *Test this one to find out which*
   (`connections.standing.whichSide`). A key of its own for that case, which does not say
   *this account*, needs words.
5. **The Gmail mailbox has more than one Dutch word.** The sweep found three: *Gmail-mailbox* in
   the guide (the glossary's word), *Gmail-postvak* on the Accounts card's hint and
   *Gmail-postbus* in the owner's site copy. T15 changed the site's to *Gmail-mailbox*, so two
   remain. Which one is the owner's call.
6. ~~**The decided sections of Deletions and Moves still say *Already decided*.** A title that
   says what was decided was built and reverted in review: the ledger closes a row the same way
   for *keep* and for *apply*, so it would have named the opposite of what happened after *Delete
   it here too*. It needs the server to say per row which it was, for example from
   `item.deletion_applied_at`.~~ **Resolved in #1652.** The heading stays *Already decided*. Each
   decided row says what was decided, from `decided` on the ledger's row: *kept*, *applied*
   (`deletion_applied_at` set) or, on Deletions, *relocated* (removed by `applyRelocation`, whose
   move closes at the same time). Five labels say it, and a kept earlier export says kept too:
   - Deletions: *Kept on the new system* / *Behouden op het nieuwe systeem*; *Deleted on the new
     system too* / *Ook verwijderd op het nieuwe systeem*; *Moved: the old copy was removed on the
     new system* / *Verplaatst: de oude kopie is verwijderd op het nieuwe systeem*.
   - Moves: *Left where it is on the new system* / *Blijft staan op het nieuwe systeem*; *Old copy
     removed on the new system* / *Oude kopie verwijderd op het nieuwe systeem*.

   The builder wrote them, for the owner to read (open question 8). Two limits remain, both
   because *Delete it here too* leaves a moved row's move open. First, on a renamed file, that
   move stays on Moves with a *Remove the old copy* the server refuses (unchanged from before).
   Second, a mail message or event moved to another folder, deleted through Deletions, then
   answered *Leave it where it is* on Moves reads *Old copy removed on the new system*, though it
   had no other copy (`ItemMove.decided` in `ports.ts` names it). Either closing the move inside
   `applyDeletion`, or a Moves value of its own for a removal made through Deletions (new words
   for the owner), would settle both: a candidate follow-up.
7. **Old words in docs no screen draws.** `docs/o365-setup.md` and
   `docs/o365-application-access.md` quote the old *Through our own app, with …* labels; they and
   `docs/google-workspace-setup.md` say *this product*. `docs/owner-test-runbook.md`,
   `docs/incident-runbook.md` and `docs/soverin-supervised-run.md` say *Trigger sync* where the
   button says *Sync now*. No guard reads these quotes.
8. **Integration tests not run where the sets were built.** The support views (T13) and the
   sharing rescan (T10) need a container runtime, which the build machine lacked. CI ran both,
   green.
9. **Migration 0058, the sweep's one schema change.** The operator's invoice view
   (`support_tenant_invoices`, managed chain) gains `invoice_number` and `kind`, added at the end
   with `CREATE OR REPLACE VIEW`; its grant and 0027's revoke stay. Applied to a real Postgres 16
   with `scripts/local-pg.sh`; CI's migration lint reads every file in the managed chain, and the
   nightly E2E (managed) applies the chain at its bring-up. The upgrade drill
   (`scripts/upgrade-drill.sh`) covers the appliance only, so it does not prove this one.
10. **What migrates draws a column's guide links after its rows** (T16), each guide once, so a
    column holding two rows' guides (Microsoft's *Partial*, with Shared mailboxes' guide) no
    longer says which row each belongs to. 0148 now says so.
11. **A person's error and not-found states** show *← Migrations* just above the h1
    *Migrations* (T16). The same word twice, one above the other.
12. ~~**A decision's effect line is English under a Dutch page** (#1636).~~ **Resolved in
    #1649.** `DECISION_EFFECTS` in `operating-contract.ts` holds each line in English and in
    Dutch. Both editions serve the Dutch as `effectNl` beside `effect` (`decisionEffectFields`),
    and the page shows the reader's half (`decisionEffectText`). From a server that sent no Dutch
    it shows the English, marked `lang="en"`. The builder wrote the Dutch, for the owner to read
    (open question 8); the owner's *Yes* was to row 4 (#1636), not to these words.
13. **Verify's sentences have no singular** (#1635). With one item they read *1 email items are
    on the old system…* / *1 items (e-mail) staan…* and *1 sampled … items differ*. They are the
    owner's approved words, so a singular form is the owner's call.
14. ~~**The privacy statement keeps *preflight*** (§4.3, §5 and §9, in both languages) until its
    version 1.1, where #1630 left it.~~ **Resolved in #1639**: version 1.1 names it *the count when
    you review your migration* / *de telling bij het controleren van uw migratie*.
15. **With *Technical details* open, an unknown finding's text shows twice** (#1635): in the list,
    since no sentence of ours covers it, and again in the fold beside its id.
16. **Words #1632 left for a later round**, as the owner did not name them: Review and start's
    counts still say *Message-ID* (`discovery.generatedId.*`, `discovery.unlisted.pre.*`), the
    report says *source side* / *bronkant* / *doelkant* (`report.browser.side.*`),
    `docs/guides/nl/google.md` says *aan de bronkant*, and Billing's other Dutch *verplaatst*
    words remain. The IMAP and JMAP names start with a capital mid-sentence (*… en Andere
    mailaanbieder (IMAP) naar …*); an in-sentence form, as *Start a migration* has, can follow.
    If the owner wants the names only on the Migrations list and a person's page, the saved name
    and the *Slowed by …* line can go back to the old names.
17. **A share still has other names in a few places** (#1636): the downloaded file's name
    (*Ownpace-rechtenlijst*), the downloaded report's *Access carried over*, the scope manifest's
    *permission list* / *rechtenlijst*, the checklist's hover lines *This access …* / *Dit recht
    …*, and *Nog geen gedeelde rechten*. The glossary's share row lists them; they wait for the
    owner.
18. **The item queues' effect lines are still English** (found building #1649). The line under a
    decision just made on Deletions, Moves and Failures is the server's `effect`, shown by
    `Resolved` in `apps/web/src/components/queues/primitives.tsx`. It has no Dutch twin and is
    not marked `lang="en"` under a Dutch page. The fix follows #1649: a Dutch twin in
    `@openmig/shared`, served as `effectNl`. A row under *Already decided* is not affected: since
    #1652 it says what was decided in the page's own words.

## Open questions

1. ~~**The owner's items** still open: two of 31.~~ **None**: rows 19 and 24 were answered on
   2026-10-19 and built in #1638 and #1639 (§5).
2. **Follow-up 4.** Words for an expired sign-in whose side is not known.
3. **Follow-up 5.** One Dutch word for the Gmail mailbox.
4. ~~**Follow-up 3.** Words for an inferred row under *Waiting on you*.~~ **Built in #1634**, in
   words the builder wrote, for the owner to read.
5. **For the owner to read**, changed by the sweep: the warning before *Turn on deleting by hand*,
   rewritten in both languages, and its line *"While it is off, the delete buttons on this screen
   are refused."* (possibly *"While it is off, every delete on this screen is refused."*); the
   five keys of D2; and the Google documents row of *What migrates*, reworded to fit its 90
   characters, with the kinds of document moved into its fold (T4). That row said *converted*
   while the default leaves them in Google.
6. **The Leaving pages' words** (T15) are proposals until the owner has read 0152's.
7. **Follow-up 10.** Is one list of guide links per column right, or should each link name its
   row?
8. **For the owner to read**, built on 2026-10-21 in words the builder wrote:
   - the Dutch of the three lines under a decided decision (#1649, follow-up 12): *Antwoord
     vastgelegd. De migratie handelt er vanaf nu naar.* (the answer changed something),
     *Antwoord vastgelegd. Er verandert daardoor niets aan uw migraties.* (only recorded), and
     *Terzijde gelegd; er is niets mee gedaan. Blijft de situatie zo, dan kan de vraag
     terugkomen.* (set aside). The English is unchanged;
   - the five labels on a decided row of Deletions and Moves (#1652, follow-up 6), in English and
     in Dutch, as follow-up 6 lists them.
