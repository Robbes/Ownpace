# Workplan 0148 — A guide written for the person using it

> **In one line:** Dutch and English customer guides per source and target card, operator text kept in `docs/*-setup.md`, no own-app hints where the deployment carries one, the export archive labelled experimental and readable from the tester's Nextcloud or WebDAV files, `Docs.tsx` extended.

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24, T9 built.** The export read from a folder in the migration's own files is built
on branch `claude/ownpace-public-readiness-y7orc6-the-export-in-your-own-files`, stacked on
0136 T5's branch (`…-no-archive-disk-path-on-managed`). Not merged. What it does:

- **The form.** The archive's descriptor gains `where`, a choice of two, before the path. Both
  doors draw it with one component (`ChoiceField.tsx`), as radio buttons. On managed the
  destination's files are the default, and the disk is shown disabled with *Only on a self-hosted
  appliance* / *Alleen op een eigen appliance* (D10, D11). On the appliance the disk stays the
  default. The path's label, hint and example follow the choice. The descriptor gained
  `defaultValue`, `follows` and translated options for this, read through `followedField` and
  `choiceDefaults` in shared.
- **The doors.** `POST /api/migrations` and `POST /api/connections` accept `where` and store it.
  An unknown value is refused by name. The builder passes it to `parseArchiveSource`, and a
  reused connection's override keeps it beside the path. With `where: 'target'` the create door
  asks `archiveInTargetRefusal(targetType)`, a new shared function that the wizard's target step
  reads too. WebDAV and Nextcloud pass. JMAP is refused with the sentence `archiveStoreInTarget`
  throws, which moved to shared word for word. A destination with no files is refused with a
  sentence that names the two that have them. 0136 T5's refusal lets `where: 'target'` through
  and still refuses an absent or `disk` location.
- **The wizard.** The Test of an export in the destination answers `probe.countedAtPreflight`,
  and the wizard keeps and uses the saved connection on that answer. The target step shows the
  refusal and holds Next while the destination cannot serve the export.
- **The guide.** `docs/archive-setup.md` gains *Your export in your own Nextcloud*, written so it
  can move to `docs/guides/` as it is.
- **The gate.** `smoke-managed.sh` writes the four-file fixture Takeout into tenant B's files on
  the demo Nextcloud. It creates a migration from it with `where: "target"`, reusing tenant B's
  stored Nextcloud connection as the destination, and asks for its preflight. The preflight must
  count 3 items and 44 bytes in `Photos from 2024`: the two photos and the edited version. The
  gate checks that `where` and no credential were stored, then takes the migration, its source
  connection and the folder back. T5's gap line is gone.

Guards: 31 cases in three files named `an-export-in-the-destinations-files`, in shared, the API
and the web app. 30 failed on the code this branch started from. The shared vacuity floor passed.
Two mutations were also tried: managed's default set to the disk, and the create door's target
check switched off. They failed 5 cases in shared and the API, and 7 in the web app. Four
existing expectations were rewritten on purpose:
`an-archive-is-a-location-not-an-account` (three fields now), the Connections archive add body
and the wizard reachability row (a managed build asks for the destination's folder), and
`a-verdict-that-does-not-say-what-failed`'s archive case (no gap recorded now). The JMAP test in
`the-store-the-pass-picks` gained an assertion that the pass throws the shared sentence.

Where this differs from §3:

- the gate reads the count from the preflight's row for the year folder. The preflight has no
  per-kind breakdown, so the edit is shown by the bytes (44 = 14 + 14 + 16). The domain total is
  4 because it includes the manifest;
- the gate reuses tenant B's stored Nextcloud connection. The address the script reaches
  Nextcloud at from outside the stack is not one the run containers can reach;
- the wizard's Test posted no `provider` or `path` for an archive at all, so its Test was refused
  for missing fields. It posts all three now;
- the path's hint fits the twelve-word budget. The example and the note that the parts stay and
  take space are under its *Why?*;
- the guide section is in English only, like the served archive guide. The Dutch text comes with
  T4's Dutch guide;
- the JMAP sentence is unchanged. It still offers "a path on the machine running the pass",
  which managed refuses. That is left to the owner.

**2026-09-25, T9's guide text moved to the served guide.** #1173 merged while T9 was open and moved
the customer text to `docs/guides/en/archive.md`, which is what `/docs` serves;
`docs/archive-setup.md` is the operator document now. So the new section, *Your export in your own
Nextcloud* `{#own-nextcloud}`, is in the served guide too, under `connect`, with the owner's points:
no need to unpack, the photos arrive as ordinary files and folders, the `.zip` files stay until
deleted. Its *Adding the connection* list names the three fields the form now asks for, and its
*Stopping* sentence no longer says the archive stays on a disk. The served text says *as Google
delivered them*, not *Google or Apple*, since an Apple export cannot be read yet (D7). The guide
addresses no edition, as the lint requires: the disk choice is described by what the form shows. The
Dutch guide is T4's.

**2026-09-25, T9 reviewed and fixed** on the same branch, one more commit. Not merged. Two
reviewers found five things to fix and five nits:

- **A reused export connection keeps its own store.** The wizard posted this edition's default
  `where` on every reuse, and the pass lays the override over the stored row, so on the
  appliance a row in the destination's files was read from the disk. The wizard now starts the
  choice from the row's own `where` (none means the disk), which the connection list returns
  (`knownConnectionValues`). The create door reads the stored row's config and judges 0136 T5's
  refusal and `archiveInTargetRefusal` on the row with the override laid over it, as the pass
  reads it. The override keeps `where` only beside a path. On a reuse the source step still asks
  for this migration's folder, as the door does, and on managed a row on the disk holds Next
  and names *Where the export is*. The wizard's picker never offered a stored archive at all:
  `sourceKindOf` mapped `archive` to `o365`. It maps it to `archive` now. Found and left for
  their own tasks: that table also sends `microsoft` and `apple` to `o365`, so their stored
  connections are not offered either, and a reused Box connection passes the source step
  without the subject the create door demands on a reuse.
- **The Test's kept connection has a guard.** After `countedAtPreflight` the wizard continues on
  the row it saved: *Which export* is hidden, the folder and the choice stay, and the row is
  added once.
- **The gate finds its source connection through its own migration**, as it finds the
  destination, and never by display name. The name carries the run's tag.
- **The sentences.** The JMAP refusal names the destination *JMAP*, not `jmap`, and is true on
  both editions: a WebDAV or Nextcloud destination, or, on a self-hosted appliance, the disk.
  This replaces the last bullet above. The no-files refusal is plural (*IMAP destinations have
  no files*), so no article has to agree with the name.
- **The guide** names the wizard's button, **Test and save connections**, and *Pointing us at
  it* says that an export in the destination's files is counted at the preflight, not by Test.
- **Two nits applied.** The Dutch path hint reads *De map zoals u die in uw bestanden ziet,
  vanaf de hoofdmap.* The wizard draws *counted at the preflight* with a grey question mark,
  not the red error mark.

The owner asked about this feature the same day: *"yes, but how can we work with what was
uploaded? Will it be added unpacked in that target? Then: yes."* (D11, added 2026-09-25). The
guide's section now says it plainly: there is no need to unpack, the photos arrive as ordinary
files and folders, and the `.zip` files stay and take their space until the person deletes them.

Guards: 11 cases in the unit project and 3 in the browser project failed on the first T9 commit.
Mutations failed them again: dropping the `countedAtPreflight` clause (1 case), the row's `where`
(2), the managed disk row's hold on Next (1), and the door's read of the stored row together
with the path-less override (5, T5's reuse case among them). One existing
expectation was rewritten on purpose: T5's reuse case in
`a-path-on-the-server-a-managed-pass-cannot-read` expected no database call at all, and now
expects one read of the stored row's config, proved read-only.

**2026-09-24, T3's Apple tag built (D7).** On branch
`claude/ownpace-public-readiness-y7orc6-an-export-we-cannot-read-yet`, not merged. The archive
form keeps the Apple export and says it cannot be read yet, on both editions:

- the exports a reader exists for are listed in `archive-providers.ts`
  (`ARCHIVE_PROVIDERS_WITH_READERS`), and a test in orchestration,
  `the-form-and-the-readers-agree.unit.test.ts`, holds that list equal to `READERS`.
  `archiveProvidersWithReaders()` stays and still reads `READERS`;
- at both doors, the wizard and the Connections page, an option whose export has no reader shows
  *To be tested* / *Nog te testen* in its name. While it is chosen, a line under the field says
  *"We cannot read an Apple export yet. Request one only for your own records."* Both come from
  the list, so when a reader lands they go and nothing else changes;
- the card's hint carries the tag after Apple, and `archive-setup.md`'s Apple part opens with
  the tag and the line, before the request.

The guard, `apps/web/src/components/an-export-we-cannot-read-yet.unit.test.tsx`, has 26 cases,
and all 26 failed before the build: a managed and an appliance build, both doors, both
languages. The orchestration test's 2 cases failed too. Where the build differs from §3:

- **The guard's name.** §3's `a-card-that-cannot-work-is-not-offered` named the hiding that D10
  dropped.
- **The Dutch line changes one word.** D7's *"Vraag er alleen een aan voor uw eigen archief"*
  makes the line 16 words, and a line on screen may have 15 (`words-that-fit-on-one-line`). It
  reads *"Vraag die alleen aan voor uw eigen archief."*
- **The card's hint is reworded** so it stays within the 12 words a hint may have: *"A Google
  Takeout or Apple (to be tested) download: photos and files."* and *"Een gedownloade Google
  Takeout- of Apple-export (nog te testen): foto’s en bestanden."* In Dutch the tag follows
  *Apple-export*, which is one word. The hint is a sentence, so it is the one place a landed
  reader has to be answered by hand; the guard fails until it is.
- **The line is shown below the field's own hint**, not instead of it. The Connections form
  shows no field hints, so there the line is the only one. The line is keyed per export
  (`wizard.archiveProvider.noReader.apple-privacy`), because it names the company, and
  `descriptor-labels-resolve.unit.test.ts` now checks a choice's keys in both languages.
- **One existing test changed on purpose.** `CreateMapping.reachability.unit.test.tsx` found the
  Test button by `/Test/i`, which now also matches the archive card's hint. Its nine queries
  are anchored, `/^Test/i`, as its Next button already was.

After review, on the same branch: the rest of `archive-setup.md`'s Apple part no longer says we
read an Apple export today. Step 3, *Getting it ready for us*, *One thing Apple removes* and the
*Which export* row now say *will read* or *to be tested*. T1/T4 carry this wording into
`docs/guides/`. The line under the field is now a status, and the select points at it
(`aria-describedby`), so a screen reader hears it. The guard gained one case per door, edition
and language: 34 cases, and the 8 new ones failed on the pages before this fix.

**2026-09-24, night: the export read from the tester's own files (D11).** The owner answered open
question 6: *"the wizard should be able to read a Takeout export from a folder in the tester's
Nextcloud or other target files-kind supporting target."* So the archive form gains a second
place the export can be: a folder in the files of the migration's own target. T9 builds it, before
the first invitation, stacked on 0136 T5 in 0131 §6's R2. It works where the target is a Nextcloud
or a WebDAV server. A JMAP target carries files too, but the reader asks for a file in pieces, by
byte range, and JMAP does not offer that, so a JMAP target is refused with the sentence the code
already has. Open question 6 said the create door knew `where: 'target'`. It does not: the door
drops the field, and T9 closes that (D11). On managed the disk option stays in the form,
disabled, with the line *Only on a self-hosted appliance*; the owner confirmed that: *"'Only on a
self-hosted appliance': ok"*. The card keeps its experimental tag until 0141 records a run.

**2026-09-24, review fixes to the T1 build.** Same branch
(`claude/ownpace-public-readiness-y7orc6-a-guide-for-the-person-using-it`), not merged.

- **T2 (c)'s open half is now guarded.** The case read the fold before the answer arrived, when
  it is open whatever the answer. It now waits for the query to succeed with `connection`. A
  fold that closes on any answer turns three cases red.
- **A subsection per card, now true and checked.** Google Calendar and Google Contacts had one
  heading; each has its own id now (`google-calendar`, `google-contacts`). A case maps each source
  card to its guide and holds that the card's id is a heading under `connect`; the IMAP card is
  listed as pending until T4.
- **The Microsoft registration for *Via the Graph API* and *Via IMAP*** moved out of the own-app
  fold, to `{#application}` under `connect`. Those two cards always take the customer's own
  registration, so a fold closed where the deployment carries Microsoft's app would hide it as
  optional. This departs from T8's text, which puts both recipes in the `own-app` section: T8
  (a) and (b) write them at `{#application}`.
- **D2 in the Google guide.** The `invalid_grant` causes that only the app's owner can fix
  (External and still in Testing, a deleted client) are now own-app causes; with this service's
  app, a token that keeps dying is for whoever runs it.
- **Smaller.** The Drive about-line names *the Test and save connections button* / *de knop
  Verbindingen testen en bewaren*, and its guard now asks for that. The Apple guide no longer
  says the password refusal names a page, and gives the export's download window as Apple's
  "Available until" date, as the archive guide does. The glossary and the lint say a guide never
  names the operator, and may say *whoever runs it*. Class 5's "the missing one listed" now has
  its list: `TRANSLATION_PENDING` in `Docs.unit.test.tsx`, which names the six Dutch guides and
  fails when one lands and is still listed.

**2026-09-24, T1 in English, T2 (c) and T8 (c) built.** On branch
`claude/ownpace-public-readiness-y7orc6-a-guide-for-the-person-using-it`, stacked on T6 (a)'s
branch (the next note), not merged. The owner's D10 was committed to `main` after this branch was
cut, so it was read there, and the build follows it: the archive guide is served on both
editions.

- **Six customer guides** in `docs/guides/en/`: `google`, `microsoft`, `dropbox`, `box`, `apple`
  and `archive`, the customer half of today's `docs/*-setup.md` per T1's table. Each has T4's
  outline with its ids (`before`, `connect`, `what-moves`, `when-test-says`, `leaving`), a
  subsection per card, and the wizard's own labels. Google, Dropbox and Microsoft end in
  `{#own-app}`. They use no table, blockquote or continuation line, which T6 (b) has not built.
- **Served in the reader's language.** `Docs.tsx` inlines `docs/guides/*/*.md` in place of
  `docs/*-setup.md`. `/docs/<slug>` opens the reader's language, or else the other one under T4's
  line (`docs.otherLanguage`), with `lang` on the article. `docs/guides/nl/` is empty, so a Dutch
  reader gets the English under that line until the Dutch lands (T4, next).
- **The operator documents.** The seven `docs/*-setup.md` keep their names and are not served.
  Each opens with one line naming its customer guide. `o365-setup.md`'s line is 0140 T4's, and
  it sends managed readers to the Microsoft guide (T8 (c)).
- **The lint.** `end-user-docs.unit.test.tsx` reads `docs/guides/*/*.md` and adds T1's thirteen
  patterns, each with what to write instead. It also fails a `*-setup.md` anywhere under
  `docs/guides/`, and a guide outside a folder named for a language. Run against the seven files
  served until now, the patterns fail six; the archive's was already customer text. The Microsoft
  guide's own-app section says in one sentence that the *Via IMAP* and *Graph API* recipe is
  being rewritten (T8 (a) and (b)). A case holds that no served guide names
  `IMAP.AccessAsUser.All`, the permission only the wrong list used. The delegated-permission
  case now reads the guide's bullet list, since the renderer has no tables.
- **CI.** `ci.yml`'s change filter gains `docs/guides/**`.
  `a-doc-a-test-reads-that-ci-skipped.unit.test.ts` now resolves a nested glob; before, it read
  the glob's tail as a suffix of a file directly in `docs/`.
- **D9.** On the appliance only, the `/docs` index ends with the pointer line, which links the
  repository's `docs/`. `Docs.unit.test.tsx` checks both languages, on both editions.
- **T2 (c).** The `{#own-app}` section is a `<details>`, with its heading kept outside so it can
  still be linked. It reads `/api/provider-clients` under the wizard's query key
  (`['provider-clients']`, same options). It is closed where the answer is `deployment` and open
  otherwise, including while the answer is on its way and where none comes (the appliance). A
  link to the section, or to a heading inside it, opens it. Box has none.
- **Also.** `wizard.about.googleDrive.more` names *Test and save connections* / *Verbindingen
  testen en bewaren* in place of the operator command. `Setup.tsx`'s full-guide link reads the
  new slugs. `docs/i18n-prose-boundary.md` gains class 5, *Customer guides*. The glossary gains
  three rows: guide, operator documents and own app. A link to `<slug>.md#<id>` keeps its
  section.

Guards first: on the code before this build, 34 cases failed (33 in the two web tests, one in
the CI-filter guard). All pass now. Mutations each turned a case red: the fold never closing,
the pointer line on managed, a link that does not open the fold, a `box-setup.md` dropped into
`docs/guides/en/`, a guide missing `{#leaving}`, and a `.md#id` link losing its section.

**Deviations.** English first, where T4 says Dutch first: the English is the split of the
English files, and the Dutch is the next task. The operator documents keep their customer
halves too. T1's table says what moves, and trimming them is left, since refusals, runbooks and
guards cite their sections, so the two copies can drift until then. T4's Photos sentence was to
differ by edition, on the ground that T3 hid the archive card on managed. D10 keeps the card, so
the Google guide names the archive guide on both editions. The archive guide says where the
export has to be (on the disk of the computer that runs the migrations; the card takes no upload
yet), with no edition aside. The fold's summary is in the guide's language, not the reader's,
since it sits inside the article. D9's line is the plan's wording less one word in each language
(*Its* / *De*), for 0118's fifteen-word line. 0140 T4 names `docs/microsoft-setup.md` as the
target of the o365 line. That file is now the operator document, so the line names the Microsoft
guide. The lint's field-synonym case reads the English guides only, until T4's label guard
replaces it.

**2026-09-24, T6 (a) built.** The renderer's first half is built on branch
`claude/ownpace-public-readiness-y7orc6-a-renderer-that-keeps-a-guides-shape`, merged in #1159.
`Docs.tsx` is extended and no dependency is added (D6):

- a heading is an `<h2>`–`<h4>` with an id: from a trailing `{#id}`, which leaves the text, or
  else GitHub's slug of the heading. So the ten `#section` links in today's guides resolve;
- a `#section` link stays in the tab and scrolls to its heading. So does a page opened at
  `/docs/<slug>#<id>`, which T4's links from the checklist will need;
- numbered steps are an `<ol>`, which keeps its first number when a sub-list interrupts it;
- a link inside bold is a link;
- the article has `lang="en"`, since every served guide is English until T4 picks per locale;
- the index lists each guide by its first heading, not its slug.

`Docs.unit.test.tsx` tests each feature on fixtures. It also checks every served guide: headings
with ids, `#` links with no `target` that name an id on the page, no paragraph that begins with a
numbered step, and links inside bold. The plan's `|` and `>` assertions are an `it.todo` until
T6 (b), because today's guides still use tables and blockquotes. The build goes beyond the plan on
two points: the not-found page lists titles too, from the same list as the index, and code inside
a link's text renders as code. T2 (c)'s `own-app` fold and T6 (b) are not built. `Docs.tsx`:5-8
is left for T7.

After review, one effect of the first half is fixed and the others are recorded. A numbered step
is now a list item of its own, and its continuation lines render as a paragraph after it until
T6 (b). So a bold span that opened on a step's line and closed on the next showed both `**` as
text. `archive-setup.md`'s step 5 did, and it had rendered as bold while the steps were one
paragraph. That step and `google-workspace-setup.md`'s step 1 are rewrapped with no word changed,
and the served-guides case now checks that a bold span opened on a numbered step's line closes on
it. Two effects were there before this build and stay. Bold across a bullet's continuation line
(`apple-setup.md`:125 and :222, `google-workspace-setup.md`:91) shows its `**` until T6 (b). The
renderer has no italics, so `*x*` shows its asterisks, and bold that holds italics is not bold
(`dropbox-setup.md`:26, `microsoft-setup.md`:86, `google-workspace-setup.md`'s step 1). Neither
half of T6 names italics.

**2026-09-24, night: the archive card is labelled, not hidden (D10).** The owner: *"Hide the archive
card on manage: I don't want them hidden. I want labelled as 'expirimental'."* ("manage" is read as
"managed", "expirimental" as "experimental".) So the export archive card stays offered at both doors
on managed, with 0131 T2's *Experimenteel* tag, and T3 hides nothing. The branch that built the
hiding was not merged and is dropped; nothing of it reached `main`. D10 replaces D3 for this card.
Three things follow:

- **The card still cannot complete on managed** as the wizard offers it (§1): it asks for a path
  on the machine that runs the pass, and a managed pass has none.
- **The connection's Test opens that typed path inside the API process**
  (`account-qualification.ts`:1213). So 0136 T5, the managed API refusing a typed disk path with a
  sentence that says so, moves into the alpha minimum.
- **The Apple export option is seen on managed too**, so D7's *to be tested* tag comes before the
  first invitation, on both editions, and so does the archive guide (T4).

Open question 6 asks whether the wizard should gain the one choice that would make the card work
on managed: the export read from the migration's own file target (`where: 'target'`, 0116 T4).

**2026-09-24, later still: the owner answered open questions 1 to 5.** *"3) 0148: dont hide IMAP,
i tested that once and will do that again. extent the guide renderer. Leave the Apple-export
option in but be clear about it ('to be tested'-label). Add the five new guides already. Yes,
one-line pointer towards the appliance-help-page to de appliance operator docs"*. §2 records the
answer as D5 to D9:

- **D5:** the *Via IMAP* card stays on managed. The owner has run it once and will run it again,
  and the next run is T8 (b)'s walk. (T3 was to hide only the export archive; D10 later kept it
  offered, labelled.)
- **D6:** the renderer in `Docs.tsx` is extended, and no dependency is added (T6).
- **D7:** the Apple export option stays in the archive card's form on the appliance. It is tagged
  *to be tested* and says that it cannot be read yet (T3).
- **D8:** the five new guides are written in English as well as Dutch before the first invitation
  (T4).
- **D9:** the appliance's `/docs` carries one line pointing to the operator documents (T1).

Because *Via IMAP* stays, its section of the `microsoft` guide is needed by the first
invitation, so T8's two recipes are written into that guide with T4. The walks stay the owner's.

**2026-09-24, later: opened from the owner's answers.** The readiness review of 2026-09-23 read
the in-app guides the way a tester would meet them, from the wizard's cards to `/docs`. They were
written for whoever builds or runs the product: environment variables, repository commands and
workplan history sit beside the steps a customer needs. On a deployment that carries its own
Google or Dropbox app, the wizard's own lines, the setup checklist and the guides still tell the
person to create one. The export archive card is offered on the managed edition, where it cannot
work. No target and not the IMAP source has a guide, and every guide is in English. The owner
first chose to have this explained (*"W15 explaoin"*, 0131 §5), and then answered it on four
points (§2). This plan records those answers as D1 to D4, and 0131 §5 calls this work W15.

When this plan was opened, nothing in it was built. T6 (a) has been built since (see the first note).
Five of the review's guide findings were fixed in #1137, merged on
2026-09-24, and are checked again in §1: the checklist strings, the dead *Read the full setup
guide* link, the stale "credentials step", the mechanical text defects and the missing
`Tasks.Read` row. One sentence was left out of that fix on purpose, for the archive decision that
D3 now makes (§1).

Two plans take up what this one settles when they are next edited; this plan does not edit them.
D3 answers 0131's open question 4 and 0136's open question 3: hide, rather than an "Appliance
only" tag. 0131 T5's go/no-go table gains a row for this plan, drafted in §4, as 0142, 0143 and
0146 drafted theirs.

**Before the first invitation.** This is the minimum. Most of it is writing: a Dutch and an
English guide for each family of cards live offers, ten at most (T4's table).

- T3's Apple tag (D7), on both editions, because the export archive card stays offered on
  managed with 0131 T2's tag (D10); *Via IMAP* stays (D5);
- T9, the export read from a folder in the migration's own Nextcloud or WebDAV files (D11),
  stacked on 0136 T5, which refuses a path on the server;
- T2 (a), (b) and (d), no about-line, redirect line, checklist or create refusal tells a tester
  to create an app, or register an address on one, where `ownpace-live` carries it;
- T1 and T4 for every card `ownpace-live` offers: a customer guide in Dutch and English, served in
  the app, with the operator material left in `docs/` (D8), and T1's pointer on the appliance
  (D9). The `microsoft` guide carries T8's two recipes (D5);
- T6's minimum, the parts of the renderer those guides use (D6), and T2 (c), the guide's own-app
  section folded where the deployment carries the app;
- T5's profiles for Apple, Nextcloud and Soverin, where the checklist now says there is nothing
  to set up, and Google's for the Google account card;
- T0, the owner reads the Dutch guides against live's screens.

**After the first invitation:** T6's remainder, T7, T8's walks and T5's remaining profiles. The
walks are the owner's: (a) before the first tester on the *Via the Graph API* card, and (b) the run
the owner announced for *Via IMAP* (D5).

| Task | Status | Notes |
|---|---|---|
| T0 The owner reads the Dutch guides against live's screens | ⏳ **Owner** | §3. In the same sitting as 0144 T0's reading of the tester guide. Open questions 1 to 5 were answered on 2026-09-24 (D5 to D9). **Before the first invitation.** |
| T1 A customer guide served, operator material left in `docs/` | 🔨 **Built in English**, merged in #1173 (2026-09-25): six guides, the widened lint, the CI filter and D9's line; the Dutch is T4's. 📋 **Decided 2026-09-24** (D1) | §3. The customer text moves to `docs/guides/nl/` and `docs/guides/en/`; the existing `docs/*-setup.md` keep their names and become the operator and self-host documents. The end-user-docs lint is widened so the rule holds. The appliance's `/docs` gains one line pointing to the operator documents (D9). **Before**, for the cards live offers. |
| T2 No hint to create an app where the deployment carries one | 🔨 **(c) built**, merged in #1173 (2026-09-25); (a), (b) and (d) not started. 📋 **Decided 2026-09-24** (D2) | §3. (a) the wizard's about-lines and the redirect line under its button, (b) the setup checklist, (c) the guide's own-app section, (d) the create refusals and one Microsoft consent sentence. Each reads the fact the wizard already reads. The appliance keeps its steps. **Before.** |
| T3 Cards that cannot work on managed are hidden there | 🔨 **Apple tag built 2026-09-24** (D7, both editions) merged in #1176 (2026-09-25) — *was:* 📋 **Decided 2026-09-24**: nothing is hidden on managed. The export archive stays, tagged experimental (D10, replacing D3), and so does *Via IMAP* (D5). The Apple export option is tagged *to be tested* on both editions (D7, D10) | §3. The flag and the hiding are not built (D10). What remains is the Apple tag. **Before.** |
| T4 A Dutch and an English guide for each source and target | 📋 **Decided 2026-09-24** (D4, D8) | §3. Eleven guides for the twenty cards. Dutch first. Five are new: IMAP (source and target), JMAP, DAV, Nextcloud and Soverin. The i18n prose boundary gains a class for guides. **Before**, in Dutch and in English, for the cards live offers (D8). |
| T5 The checklist says what must be done first | 📋 **Proposed** | §3. Profiles for Apple, Nextcloud and Soverin, and Google's for the Google account card (**before**); the Microsoft account card's and the archive's (**after**). |
| T6 A renderer that keeps a guide's shape | 🟡 **(a) built**, merged in #1159 (2026-09-24); (b) not started. 📋 **Decided 2026-09-24** (D6): `Docs.tsx` is extended, with no new dependency | §3. Headings with ids, same-tab anchors, numbered steps, links inside bold, `lang` and titles (**before**); tables, blockquotes, continuation lines, indented fences (**after**). |
| T7 Every link in a guide resolves, and a refusal links its guide | 📋 **Proposed** | §3. A guard over every served link; refusals carry a guide handle beside their words instead of naming a `.md` file. **After**, apart from the two sentences in T2 (d). |
| T8 The Microsoft app-registration recipe | 🔨 **(c) built**, merged in #1173 (2026-09-25); the guide says the (a) and (b) recipe is being rewritten. 📋 **Proposed** (the recipes); the tenant walks ⏳ **Owner** (D5) | §3. Both recipes go into the `microsoft` guide with T4, **before** the first invitation, because both cards are offered then. (a) the *Graph API* card's permissions corrected; its walk before the card's first tester. (b) a recipe for *Via IMAP* written from Microsoft's documentation; its walk is the run the owner announced (D5). |
| T9 The export read from a folder in the migration's own files | 🟡 **Built 2026-09-24**, review fixed 2026-09-25, on branch `claude/ownpace-public-readiness-y7orc6-the-export-in-your-own-files`, stacked on 0136 T5's branch, not merged. 📋 **Decided 2026-09-24** (D11) | §3. The archive form's choice and the doors' `where`, for a Nextcloud or WebDAV target; a JMAP target is refused by sentence. The archive guide's section, and the gate's archive step moved to the demo Nextcloud. **Before**, stacked on 0136 T5. |

## 1. What there is today

Each fact below was checked on 2026-09-24 at this plan's checkout: `main` at `987cb06`, which is
#1137's merge, plus this branch's commits (0131 to 0147, and one compose fix). `origin/main` has
moved 19 commits since. None of them changes a fact below, but they shift line numbers in
`strings.ts`, in `build-deps-from-mapping.ts` and, by one line, in `routes/migrations/index.ts`.
So strings are cited by key, and line numbers are this checkout's. Where a claim is about a
provider rather than this repository, the text says it was not read from the provider.

The review's findings this plan carries:

- `guides-operator-content-served-to-customers` (T1)
- `guides-deployment-client-contradiction` (T2)
- `guides-archive-managed-path-unusable` (T3; the server half and the question about a typed
  path on a shared host are 0136 T5's)
- `guides-apple-export-without-reader` (T3)
- `guides-o365-app-permissions-cannot-mint-token` (T3, T8)
- `guides-no-target-guides-and-wrong-nothing-to-do` (T4, T5)
- `guides-english-only-for-nl-tester` (T4). The review's verifier confirmed it only in part: the
  create refusals and the migration step's domain gate are English by design, under
  `docs/i18n-prose-boundary.md`'s refusal class (:18). What is missing is a class for the guides.
- `guides-renderer-mangles-markdown` (T6)
- `guides-dead-internal-links-and-anchors` (T6, T7)
- `guides-refusals-name-files-not-links` (T7; its operator sentence is in T2 (d))
- `guides-coverage-per-card`, the review's roll-up, which T4's table replaces

Two more are carried elsewhere and not repeated here. `guides-unproven-faces-not-stated` is
0144's (T2, the known-limitations page), with 0131 T2's label; this plan only shows that label
on the guide page (T4). `a11ym-title-only-help`, Verify's help that lives in a tooltip, is 0145
T7 (b).

### What #1137 already fixed, checked again

- **The checklist strings.** `setup.google.create_oauth_client.detail` now says *"as a Web
  application"*. `setup.google.enable_api.detail` names *"Google Drive API, Gmail API, CalDAV API,
  Google Contacts CardDAV API or Google Tasks API"*. The JMAP step is titled *"Create an app
  password for it"*, the key `api_token` kept. The Dutch strings match
  (`guides-checklist-strings-contradict-code`).
- **The full-guide link.** `Setup.tsx`:249-257 renders *Read the full setup guide* only when
  `GUIDE_SLUGS` (`Docs.tsx`:42-43) has the slug, so the IMAP source and the targets no longer open
  *"There is no guide by that name"* (`guides-full-guide-link-dead-for-8-cards`). They open
  nothing, which T4 answers.
- **The step names.** No guide and no string names a "credentials step", and
  `end-user-docs.unit.test.tsx`:175-195 holds it in both languages
  (`guides-credentials-step-stale`).
- **The mechanical defects.** The stray Chinese in `o365-setup.md`:312 and :408 is gone. The
  button names in `dropbox-setup.md`:32, `microsoft-setup.md`:96 and `apple-setup.md`:45 and :50
  match the screen. The link to the owner's Apple walk-through is gone
  (`guides-mechanical-text-defects`).
- **Tasks.Read.** `microsoft-setup.md`:67 lists it, and :205-212 of the lint checks that the table
  names every delegated permission the consent can ask for
  (`guides-microsoft-tasks-permission-missing`).

**Left on purpose.** `google-workspace-setup.md`:548-549 still says *"If you need your photos
moved, say so; it decides whether an archive-import route is worth building"*. The archive source
exists, but the fix waited for the archive decision, because pointing a managed tester at a
Takeout would point them at a card that does not work there. D3 settles it (T4's Google guide).

### What the app serves, and to whom

- **Seven files, English, 2,033 lines.** `Docs.tsx`:27 inlines `docs/*-setup.md` at build time:
  apple, archive, box, dropbox, google-workspace, microsoft and o365. `/docs` is inside the
  signed-in layout (`AppRoutes.tsx`:209-216, :338-339), in the nav on both editions
  (`Layout.tsx`:151-154). The Dutch nav calls it *"Handleidingen"* (`nav.docs`), and every
  guide behind it is English.
- **Written for the operator.** Workplan 0068 T8 ruled the served guides customer documents, and
  `end-user-docs.unit.test.tsx` enforces it with narrow patterns: ADR numbers, workplan numbers,
  `§`, hard-rule citations (:51-56), and three edition phrases (:63-67). What passes today and is
  served:
  - `box-setup.md`:46 *"**Appliance** — environment variables + the mapping file"*;
  - `dropbox-setup.md`:62, and :82-86, *"the operator sets the App key and App secret once, in
    the deployment's environment:"*, followed by `DROPBOX_OAUTH_CLIENT_ID=<App key>`;
  - `google-workspace-setup.md`:208 *"Appliance — in `.env`"*; :247-252 *"**From the repo
    root.** … `pnpm exec tsx scripts/drive-export-stability.ts`"*; :333-347, which sources
    `deploy/compose/.env` and asks `docker compose` for the database port; :380 onward, recording
    a fixture for the repository; :79 *"The owner met the calendar one on 2026-09-02"*; :512
    *"(owner runbook, Stage 6)"*;
  - `microsoft-setup.md`:124-126 *"## 3. Configure it (operators) … re-run `set-task-env.sh`"*;
  - `o365-setup.md`:15 *"your own appliance's `secrets.cmd`/`.env`"*, :40 *"(0026 T3 row 14)"*,
    :42 two source paths, :108 and :121 *"Managed Path"* and *"Self-Host Path"*, and two
    `.env.example` blocks (:286 onward, :380 onward);
  - `apple-setup.md`:19 and :220-221 cite `PROVIDER_ENDPOINTS`, a constant in the code.
- **The wizard points at an operator command.** `wizard.about.googleDrive.more` ends *"The setup
  guide walks through all three values and ends with one read-only command that proves them"*,
  which is §6's repository command.

### A deployment that carries the app, and text that says it does not

- **The fact exists.** `GET /api/provider-clients` answers, for `google`, `dropbox` and
  `microsoft` (`GRANT_PROVIDERS`, `provider-clients.ts`:48), whether this deployment carries that
  provider's application: `deployment` or `connection`, never the values
  (`providerClientFacts`, :64-71; `routes/provider-clients.ts`). The wizard reads it
  (`CreateMapping.tsx`:514-521), and so do the Connections page and the consent panel
  (`useProviderConsent`, `ProviderConsent.tsx`:102-108). Where it says `deployment`, the client
  pair folds under *Use your own Google client* with the line *"This deployment has its own
  Google client; enter both to use yours instead."* (`wizard.google.deploymentClient`;
  `CreateMapping.tsx`:1782-1806). Until the answer arrives the pair is asked for, *"the direction
  that cannot under-ask"*. The appliance serves no such route (`apps/selfhost/src` has none).
- **The about-lines do not read it.** `aboutSource` (`CreateMapping.tsx`:1264-1273) picks by
  source type only, so beside that fold the same screen says *"Uses your own Google OAuth client
  and a read-only token."* (`wizard.about.googleDrive`), *"Uses your own Google OAuth client; the
  token needs the mail scope."* (`wizard.about.gmail`), *"Uses your own Google OAuth client; the
  token needs this product's scope."* (`wizard.about.googleDav`) and *"Uses your own read-only
  Dropbox app."* (`wizard.about.dropbox`), whose fold says *"Create it read-only: …"*. The Dutch
  twins say *"uw eigen"*.
- **Nor does the line under the button.** Once *Connect with Google* is pressed, the wizard shows
  *"Register this exact address in your Google client under Authorised redirect URIs:"* and the
  address (`wizard.google.redirectUri`; Dropbox and Microsoft have twins). It shows it whoever's
  app the consent used: the address is kept *"on every attempt"* (`setConsentRedirect`,
  `CreateMapping.tsx`:1116-1135, shown at :2248-2253), and the consent panel on the Connections
  page does the same (`ProviderConsent.tsx`:208-211, :306-311).
- **The checklist does not read it.** The Dropbox profile is create an app, give it permissions,
  have the owner consent through *"the authorisation URL for this app"*, and exchange the code
  (`provider-setup.ts`:78-102). Google's is create a client, enable the API, consent a token
  (:104-123). The managed route builds the list from `setupStepsFor(side, provider)` alone
  (`routes/setup.ts`:56). The consent and exchange steps also predate the buttons, which now do
  both. With an app of one's own, what is left is to register the address the wizard shows under
  the button (`wizard.dropbox.redirectUri`).
- **The guides say "your own".** `google-workspace-setup.md`:5 *"This is what you do once, in
  **your own** Google Cloud project"*; :32 onward, *"Why you register the client and not us"*.
  `dropbox-setup.md`:3 *"authenticates with **your own Dropbox app**"*, although :26-32 then
  describes the button. `microsoft-setup.md`:9-12 already says *"Most people should not need
  this page"*. The Google account card, the usual choice (`front-door-cards.ts`:70-74), has no
  section of its own; the guide names it at :79 and :488.
- **The create refusals say it too.** With the deployment's Google client configured,
  `googleCredentialKeysRequired()` asks only for the refresh token
  (`routes/migrations/index.ts`:334-338), and the refusal still opens *"A 'google-drive' source
  authenticates with your own Google Cloud OAuth client"* (:1150-1157). Dropbox's does the same
  (:1313-1325).
- **One consent sentence asks for an operator setting.** For `AADSTS700016`,
  `microsoftConsentRefusal` says *"either register the application as multi-tenant, or set
  MICROSOFT_OAUTH_TENANT to the directory it belongs to (docs/microsoft-setup.md)"*
  (`microsoft-consent.ts`:107-113). A tester can do neither. The function receives only Entra's
  text. The start route decides whose application it is (`resolveMicrosoftClient`,
  `microsoft-oauth-routes.ts`:97), and the flow it begins carries that client id to the callback
  that calls this function (:163), so the fact is one step away.

### Cards that cannot work on managed

Both doors read one card list, `SOURCE_CARDS` and `TARGET_CARDS` (`front-door-cards.ts`:60-108).
Nothing there depends on the edition. In practice both doors are managed: the wizard route is
`ManagedOnly` (`AppRoutes.tsx`:254-261), and Connections is in the managed nav only
(`Layout.tsx`:133-144) with no appliance API behind it.

| Card or option | Works on managed? | Evidence |
|---|---|---|
| Export archive (`archive`) | **No** | The wizard asks for a path (`archiveFields()`, `credential-fields.ts`:287-310, placeholder `/srv/exports/takeout-20260904`; `sourceArchivePath`, `CreateMapping.tsx`:619). A path is read on *"the machine running the pass, which is the appliance only — a managed run container is given a network and no shared volume"* (`config.ts`:1219-1223). The other location, `where: 'target'`, has no control in the wizard and no relay page. The connection's Test opens the typed path inside the API process (`account-qualification.ts`:1213), which 0136 T5 takes up. 0131 §1 reached the same conclusion. |
| Its *Apple Data & Privacy* option | **No, on either edition** | `apple-privacy` is *"deliberately ABSENT"* from the readers (`archive-source-factory.ts`:56, :71-73). `archiveProvidersWithReaders()` (:89) has one caller, a unit test. The form offers both exports, from `ARCHIVE_PROVIDERS` (`archive-providers.ts`:35; `credential-fields.ts`:296-299), and Test answers *"No reader exists for a '…' archive. This is a wiring gap"* (`probe-connection.ts`:377). The card's hint promises it: *"A Google Takeout or Apple export you downloaded"* (`wizard.proto.archive.hint`). `archive-setup.md`:115-156 walks a request Apple says takes *"up to seven days"*. |
| Microsoft 365 *Via IMAP* (`oauth2`) | **Not with the recipe served today**, as Microsoft's documentation is understood here. The owner has run the card once (D5). | Its fields are a mailbox, a tenant, a client id and a secret, with no refresh token (`o365Fields()`, `credential-fields.ts`:318-334). So the pass always mints an app-only token for `https://outlook.office365.com/.default` (`buildImapSourceFromCredentials`, `build-deps-from-mapping.ts`:1380-1382). The served recipe adds its permissions under **Microsoft Graph → Application permissions**, including `IMAP.AccessAsUser.All` and `offline_access` (`o365-setup.md`:108-118), and lists `IMAP.AccessAsUser.All` as *"Application/Delegated"* (:554). From Microsoft's documentation, not read for this plan and not verifiable in the repository: a token for Exchange Online carries only permissions configured on that API, those two are delegated only, and app-only IMAP needs `IMAP.AccessAsApp` with the application registered in Exchange Online. Apart from this plan, no file in the repository names `IMAP.AccessAsApp`. The matrix marks the card ✅ (`feature-matrix.md`:29), and 0141 §1 found no run linked to that mark. The owner's run is not recorded in the repository either, and neither is the registration it used (D5). |
| Microsoft 365 *Via the Graph API* (`graph`) | **Yes in principle; recipe incomplete** | Its token is for Microsoft Graph (`https://graph.microsoft.com/.default`, `mail-source-factory.ts`:138-140), so Graph permissions are the right kind. The recipe's list (`o365-setup.md`:68-73) has no application `Mail.Read`, which `o365-application-access.md` §2 lists (:152-162). That document's §0, the registration from zero, says it is *"written-but-unproven"* until the owner's validation is recorded there (:100-102), and none is. `e2e-o365.yml` has never completed a run (0141 §1). |
| Every other source and target card | Yes | Each asks for what its provider needs and nothing reads a local path. Which of them have met a real account is 0131 T2's label and 0141's proofs. |

### The gaps: targets, the IMAP source, and "nothing to set up"

- **No guide for any target, nor for the IMAP source.** The target cards are JMAP, IMAP, CalDAV,
  CardDAV, WebDAV, Soverin and Nextcloud (`front-door-cards.ts`:96-108). The seven guides are all
  sources. The coverage case in the lint reads source types only, and skips any type without a
  guide (`end-user-docs.unit.test.tsx`:139-141).
- **The checklist says there is nothing to do where there is.** `setupStepsFor` answers `[]` for
  any provider without a profile (`provider-setup.ts`:240-243), and `Setup.tsx`:264-266 then says
  *"Nothing to set up in advance; go straight to the wizard."* (`setup.nothingToDo`). Profiles
  exist for Box, Dropbox, the four Google products, the two app-registration cards and the IMAP
  source, and for the WebDAV, JMAP, IMAP, CalDAV and CardDAV targets (:213-231). So the line is
  shown for Apple, which needs an app-specific password first (`apple-setup.md`:22-35), for
  Nextcloud and Soverin, which take a password or app password and, for Soverin's mail, a typed
  mail host (`SOVERIN_MAIL_FIELDS`, `credential-fields.ts`:560-567), and for the two account
  cards, which is true only where the deployment carries the app (T2).

### Language

`docs/i18n-prose-boundary.md` draws the line per prose class. Refusals, diagnostics and guidance
render as served (:14-23), and the client localizes its own copy, explanations beside codes,
dates, and shared operator prose written in both languages (:25-54). It says nothing about the
guides: a search for *guide*, *setup.md* and `/docs` in it finds nothing. The article that shows
a guide has no `lang` (`Docs.tsx`:230), so a Dutch page reads an English guide under
`lang="nl"`.

### The renderer

`Docs.tsx`:16-18 says it handles *"headings, lists, code, links, emphasis, paragraphs — because
these documents are prose and tables"*. It has no branch for tables, numbered lists or
blockquotes. Any other line joins one paragraph (:165-174). A bullet takes only lines that start
with `-` or `*` (:127-132), so a continuation line starts a new paragraph. Inline, the text inside
bold is not parsed again (:48, :60-61), so a link inside bold shows as markdown. A heading is a
`<p>` with no id (:112-121). A link is internal only when it starts with `docs/` or ends in `.md`
(:64); anything else, a `#section` link included, opens a new tab (:71-79). The index lists raw
slugs (:190-198). Counted today, the served guides have 86 table lines (o365 36, Google 31, of
which 14 are indented inside numbered steps, Microsoft 8, Apple 7, archive 4), 64 blockquote lines
(Google 34, o365 26, Microsoft 4) and 99 numbered-list lines (o365 65, Google 17, archive 13,
Apple 4). `Docs.unit.test.tsx` has 53 lines and checks one sentence, the slug list and the
not-found page.

### Links, and refusals that name files

- **In the guides.** The links that are not `http`: `google-workspace-setup.md`:3 to
  `o365-setup.md` (works); :149 to `grant-links.md`, which is not served (not found); :29, :59
  and :444 to anchors on the same page, and `o365-setup.md`:26-32, seven more; :323 to
  `o365-application-access.md`, which is not served. The link at `google-workspace-setup.md`:59
  and the one at `o365-setup.md`:323 sit inside bold and show as raw markdown.
- **In the refusals.** `Docs.tsx`:5-8 says the route *"makes those references real links"*.
  Nothing does: `serverMessage` returns the server's string as it is (`services/api.ts`:141-174).
  Outside tests, string literals outside comments that name a `docs/….md` file appear in 24 files
  under `apps/api/src` and `packages/*/src`: eleven in `routes/migrations/index.ts` alone
  (:1115, :1130, :1156, :1199, :1251, :1297, :1325, :1352, :1392, :1421, :1452). Some name a file
  that is not served: `docs/o365-application-access.md` from `credential-refusals.ts`:200 and
  :208 (English and Dutch) and from the Graph connectors, and `docs/shared-mailboxes.md` from
  `mapping-pattern.ts`:77. `create-coherence.unit.test.ts` pins the refusals' file names in six
  places (:125, :217, :270, :464, :512, :559).
- **CI knows these files are read by tests.** `ci.yml`'s change filter runs the suite for every
  top-level `docs/*.md`, the setup guides among them, and for no folder below `docs/` except
  `docs/adr/` and one named workplan. `scripts/a-doc-a-test-reads-that-ci-skipped.unit.test.ts`
  checks the filter against the globs `end-user-docs.unit.test.tsx` reads. A guide moved to a new
  folder fails that guard until the filter names the folder.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words, then the answer as given, typos included. Where
an answer needed a reading, the reading is stated.

**D1 — who the in-app guide is for.** *The served guides are written for operators; who should
they be written for?* — *"Audience: the in-app guide should target the endusers/testers, not the
operators/self-hosters (they are more technical, and do need to edit env files/run
commands)"*.

So a guide served in the app is written for the person who connects an account: what to prepare,
what to press, what the provider's screen will ask, what moves and what does not, and how to
stop. Environment files, mapping files, repository commands, the deployment's own app
registrations and workplan history stay in `docs/`, for operators and self-hosters, and are not
served. A self-hoster reads both: the customer guide in the app, and the operator document in the
repository they already work from.

**D2 — the contradiction.** *The wizard says the deployment has its own Google client, and the
line beside it, the checklist and the guide say to create your own. Which is true?* —
*"Contradict: self-hosters need to make those, but endusers dont, or not in the ownpace-managed
deployment. Stop the false hints on managed."*

Read as: where the deployment carries the provider's app, nothing a person reads tells them to
create one, or to register an address on one. The rule reads the same fact the wizard already
reads (`/api/provider-clients`), so it follows the deployment, not the edition's name. The
appliance serves no such route, so it keeps every step, and so does a managed deployment without
that provider's app. The option to use one's own app stays where the wizard offers it, folded,
as today.

In the same set of answers the owner said that `ownpace-live` will carry a Google client, and
left open which:
*"1) google redirect URI: Now holds https://id.ota.ownpace.eu/ui/login/login/externalidp/callback
and https://app.ota.ownpace.eu/api/migrations/google/callback I'll need to add one for
app.ownpace.eu or create a new oauth-client"*. Either way live carries a Google client, so on
live every "create your own Google client" line is one of the false hints D2 stops. Which of the
two the owner chooses is 0140 T11's question (0140 D5). The first option puts live's address on
the client the OTA stack also uses, where `docs/google-oauth-verification.md`:286 says *"**Test
and production get separate clients**"*. 0140 T11 advises a new client, the owner chooses there,
and this plan works the same either way.

**D3 — cards that cannot work.** *The export archive cannot work on managed as the wizard offers
it: label it, disable it, or hide it?* — *"cards that cant work: hide on manged"* ("manged" is
read as "managed").

So a card that cannot work on the managed edition is not offered there, in the wizard or on the
Connections page, and the guide index does not list its guide. "Cannot work" is read strictly. A
card that works but has not yet met a real account keeps 0131 T2's label (0131 D6, *"Label"*). §1's
table says which cards cannot work. T3 applies D3 to the archive. *Via IMAP* is not hidden (D5).
**Replaced for the archive card by D10:** it is labelled, not hidden. This answers 0131's open
question 4 and 0136's open question 3: hide, not an "Appliance only" tag.

**D4 — the gaps.** *No target and not the IMAP source has a guide, and every guide is in English:
write them, or accept English?* — *"Gaps: write also dutch guides for each source and target."*

So each source and target card gets a guide section in Dutch as well as English. The alpha is
Dutch (0144 D1), so the Dutch is written first.

**The five open questions, answered the same day.** The owner answered them in one line, quoted
in full in the Status block. D5 to D9 give each part.

**D5 — the *Via IMAP* card stays on managed.** *As the card is offered, and as Microsoft's
documentation is understood here, it cannot work: hide it on managed until a recipe has been
walked in a real tenant, or keep it?* (Open question 1 recommended hiding it.) — *"dont hide IMAP,
i tested that once and will do that again."*

So the card stays at both doors on managed, and T3 hides only the export archive. The repository
records neither the owner's run nor the registration it used, so §1's finding is about the recipe
served today, not about the card. Three things follow:

- the card keeps 0131 T2's *Experimenteel* tag until a run is recorded, since a *proven* verdict
  has to say where its run is recorded;
- the run the owner announced is T8 (b)'s walk. It is recorded where 0141 T1 records proofs,
  together with the registration it used;
- the card is offered from the first invitation, so its section of the `microsoft` guide is
  written before then (T4). It carries T8 (b)'s recipe, written from Microsoft's documentation and
  checked by that walk.

**D6 — the renderer.** *Extend the renderer in `Docs.tsx`, or adopt a markdown library?* (Open
question 2 recommended extending it.) — *"extent the guide renderer."* ("extent" is read as
"extend".)

So T6 extends `Docs.tsx`, and no dependency is added.

**D7 — the Apple export option.** *No Apple export can be read, on either edition. Offer only the
exports a reader exists for, or keep the option with a line that says it cannot be read yet?*
(Open question 3 recommended the first.) — *"Leave the Apple-export option in but be clear about
it ('to be tested'-label)."*

So the option stays in the archive card's form on the appliance; on managed it goes with the card
(D3). "'to be tested'-label" is read as a tag, *Nog te testen* / *To be tested*, and "be clear
about it" as a line beside it that says what the tag means today:

- NL: *"Een Apple-export kunnen we nog niet lezen. Vraag er alleen een aan voor uw eigen
  archief."*
- EN: *"We cannot read an Apple export yet. Request one only for your own records."*

The tag alone would suggest an export that can be read and only needs trying. Today Test refuses
it (`probe-connection.ts`:377), and so does a pass (`buildArchiveSourceFrom`,
`archive-source-factory.ts`:121-125). Both call it a wiring gap, not a problem with the export. No
reader exists yet: it waits on a second real export, as 0116 specifies (the comment above
`READERS`). When a reader lands, the tag and the line go (T3).

**D8 — English for the five new guides.** *Write the English of the IMAP, JMAP, DAV, Nextcloud and
Soverin guides after the first invitation, or before?* (Open question 4 recommended after.) —
*"Add the five new guides already."*

Read as: before the first invitation, in both languages, since that was the question. So every
guide `ownpace-live` offers exists in Dutch and English at the first invitation, and T4's
`ENGLISH_PENDING` starts empty. The fallback notice stays, for a guide added later in one
language first.

**D9 — the appliance's `/docs`.** *Should the appliance's guide index carry one line pointing
self-hosters to the operator documents in the repository?* (Open question 5 recommended yes.) —
*"Yes, one-line pointer towards the appliance-help-page to de appliance operator docs"* ("de" is
read as "the").

So on the appliance, and only there, the `/docs` index ends with that line (T1).

**D10 — the archive card is labelled, not hidden.** *D3 hid the export archive card on managed,
where it cannot work as offered. Keep that?* — *"Hide the archive card on manage: I don't want them
hidden. I want labelled as 'expirimental'."* ("manage" is read as "managed", "expirimental" as
"experimental".)

So the card stays at both doors on both editions, with 0131 T2's *Experimenteel* tag and its why.
Nothing in T3 hides it. D10 replaces D3 for this card; D3's rule stays for any other card that
cannot work, and today there is none. What it brings with it:

- **The disk path is refused on managed.** The card asks for a path on the machine that runs
  the pass. A managed pass has no such disk, and the connection's Test opens the path inside the
  API process (`account-qualification.ts`:1213). 0136 T5 makes the managed API refuse it, with a
  sentence that says where a managed archive can live, and it is now in the alpha minimum.
- **The card cannot complete on managed until the wizard can say where else the export is.**
  The only other place the reader knows is the migration's own file target (`where: 'target'`,
  0116 T4), and the wizard has no control for it (§1). Open question 6.
- **The Apple option is seen on managed too**, so D7's tag and line come before the first
  invitation on both editions, and the archive guide is written before it too (T4).

**D11 — the export read from the tester's own files.** *Can the archive card work on managed?*
(Open question 6 recommended (a), a folder in the destination's files.) — *"the wizard should be
able to read a Takeout export from a folder in the tester's Nextcloud or other target files-kind
supporting target."*

Read as (a). The archive form gains a second place the export can be: a folder in the files of
the migration's own target (`where: 'target'`, 0116 T4). T9 builds it, before the first
invitation. What that means:

- **Which targets.** The targets that carry files are JMAP, WebDAV and Nextcloud
  (`target-domains.ts`:47-84; the Soverin card has no file face). The reader asks for byte ranges
  of a file. WebDAV serves them and JMAP does not, so a JMAP target is refused by the sentence
  `archiveStoreInTarget` already writes (`archive-source-factory.ts`:149-162). That leaves a
  Nextcloud or a WebDAV server. Nothing asks which product answers the URL, which is the owner's
  constraint of 2026-09-20, quoted at `ArchiveSource.where` (`config.ts`:455-463).
- **What is there, and what is not.** The shared parser reads `where` (`config.ts`:1202). The
  pass, the preflight and the Test read through it (0116 T4). The Test answers that the contents
  are counted at the preflight (`probe-connection.ts`:369), because a connection has no target
  yet. Open question 6 said the create door knows `where` too. It does not. The migration door's
  schema has `provider` and `path` only (`routes/migrations/index.ts`:938-946). Its builder passes
  those two to the parser (:201-204). A reused archive connection's override keeps `path` only
  (:634-642). The connection form has no field for it (`archiveFields()`,
  `credential-fields.ts`:287-310). T9 closes all four.
- **Both editions.** The choice is offered on the appliance too, because `where: 'target'` means
  the same there (hard rule 5, as `ArchiveSource.where` says). On managed, a path on the server
  cannot be read (0136 T5). So there the destination's files are the default, and the disk
  option is shown, not hidden (D10's rule), disabled, with the line *Only on a self-hosted
  appliance*. The owner confirmed that reading the same night: *"'Only on a self-hosted
  appliance': ok"*. On the appliance the disk stays the default, so no existing mapping changes
  meaning.
- **The card keeps its tag.** No real export has yet been read from a real Nextcloud through a
  managed stack. 0141 records that run, and 0131 T2's tag stays until it is recorded.
- **Not the relay.** The relay, which fetches a download for the person and puts it in the
  target, stays 0116 T4's. Here the person puts the export there.

**Added 2026-09-25: is the upload unpacked?** Asked whether the tester puts the Takeout export in
a Nextcloud folder, the owner wrote: *"yes, but how can we work with what was uploaded? Will it be
added unpacked in that target? Then: yes."* The answer, from `webdav-archive-store.ts` and
`selfhost-archive-in-target-import.e2e.test.ts`: the uploaded `.zip` parts are read where they
lie, by PROPFIND and HTTP `Range`, a few MB at a time. Nothing is unpacked on a server, and the
parts are left byte-identical. An export the person already extracted into the folder works too.
What the migration writes into the destination is unpacked: albums as folders, photos in no album
in a folder per year, and the manifest. So the archive guide's section says three things plainly:
there is no need to unpack (upload the `.zip` files as delivered, all parts in one folder); the
photos arrive as ordinary files and folders; and the `.zip` files stay in that folder, taking
their space, until the person deletes them after checking the result.

## 3. What each task does

### T0 — the owner reads the Dutch guides (owner; before the first invitation)

1. **The reading.** Before the first invitation, the owner reads the Dutch guide of every card
   `ownpace-live` offers against live's real screens, in the same sitting as 0144 T0's reading of
   the tester guide. The provider's screens are quoted in the provider's own Dutch words as they
   appear, the rule 0140 T2 set for Google.
2. **The answers.** Open questions 1 to 5, answered on 2026-09-24 (D5 to D9).

The dates go in the Status block. No code, so no guard.

### T1 — a customer guide served, operator material left in `docs/` (decided, D1)

**Where.** The customer guides live in `docs/guides/nl/<slug>.md` and `docs/guides/en/<slug>.md`,
and T4 names the slugs. `Docs.tsx` inlines that folder instead of `docs/*-setup.md`, and serves
`/docs/<slug>` in the reader's language (T4).

The seven `docs/*-setup.md` keep their names and become the operator and self-host documents:
not served, and each opens with one line naming the customer guide. The names stay because
refusals, runbooks, scripts, `ci.yml` and other documents cite them (§1), and a self-hoster
reads them where they already work.

**What moves where.**

| Today | To the customer guide | Stays for operators and self-hosters |
|---|---|---|
| `google-workspace-setup.md` | A new opening for the Google account card (*Verbinden met Google*); per product card, what it reads and what the wizard asks; a personal Gmail account's app password (:167 onward); what a Drive migration does not do yet; Photos, rewritten (T4); whole-domain delegation's admin steps, under 0131 T2's label; the steps to create one's own client, folded (T2 (c)) | *Configure it* (:206), *Prove it* and its commands (:245), recording a fixture (:380), the dated notes, and the deployment client's own set-up |
| `dropbox-setup.md` | *Verbinden met Dropbox*; the own-app steps (§1), folded; what does not migrate | *Configure it* (:60), the appliance's variables and the deployment's app |
| `box-setup.md` | All of it except the appliance half of §4. Box has no deployment app (`GRANT_PROVIDERS`), so the tester's own Box app and a Box administrator are customer steps, as 0140 T8 says | §4's appliance variables and mapping file |
| `microsoft-setup.md` | *Verbinden met Microsoft*, what Test shows, a refused consent (with what 0140 T6 records there), what this kind is, leaving; §1's registration, folded | §3 *Configure it (operators)* |
| `o365-setup.md` | The own-registration sections for the Graph and *Via IMAP* cards, rewritten in T8 | Everything else: the two paths, the `.env.example` blocks, the `curl` checks, token decoding. 0140 T4's opening line lands here. |
| `apple-setup.md` | Nearly all of it; the `PROVIDER_ENDPOINTS` sentence says the same without the constant. Its part on Apple's export (:97-196), which says reading one *"is being built"*, gains D7's tag and line: an Apple export cannot be read yet | Nothing new |
| `archive-setup.md` | Requesting a Takeout; the Apple request with D7's tag and line; what lands where. Served on the appliance only while the card is hidden on managed | *Pointing us at it*, which on the appliance is the mapping file's `path` |

`wizard.about.googleDrive.more` (EN and NL) stops pointing at the operator command and names
*Test and save connections* / *Verbindingen testen en bewaren*, which checks the same three
values against Google.

**The appliance's pointer (D9).** On the appliance, and only there, the `/docs` index ends with
one line in the reader's language. It links to the operator documents in the repository's
`docs/`:

- EN: *"Running your own appliance? Its settings and commands are in the operator documents in
  the repository."*
- NL: *"Draait u een eigen appliance? De instellingen en commando's staan in de
  beheerdersdocumenten in de repository."*

It lands in T1's PR. That PR stops serving the operator material the appliance's `/docs` shows
today, and the line says where it went.

**The lint, widened.** `end-user-docs.unit.test.tsx` reads `docs/guides/*/*.md` and keeps its
three rules; T4 makes the third read the wizard's own labels. It adds patterns, each with a
message that says what to write instead:

- an edition heading, `/^\*\*(Appliance|Managed)\b/m`, and `/\b(Managed|Self-Host) Path\b/`;
- a task reference, `/\b\d{4} T\d+\b/`, and in Dutch `/\bwerkplan\s+\d{3,4}\b/i`;
- `/\bowner runbook\b/i` and an ISO date, `/\b20\d\d-\d\d-\d\d\b/` (a dated internal note; a
  guide writes a date out);
- a command, `/\b(pnpm|docker compose|psql|curl)\b/`, and a repository path,
  ``/`(apps|packages|scripts|deploy)\//``;
- an environment file or variable: `/\.env\b/`, `/\bset-task-env\b/`,
  `/^\s*[A-Z][A-Z0-9]*_[A-Z0-9_]+=/m`, and a constant or variable in backticks,
  ``/`[A-Z][A-Z0-9]*_[A-Z0-9_]+`/``;
- `/\boperators?\b/i`: a customer guide speaks of *this service* (*deze dienst*), never of its
  operator.

The field names a person types stay allowed. They are camelCase or the provider's own words, and
the i18n boundary already calls them findings (:63-67).

**CI.** The same PR adds `docs/guides/**` to `ci.yml`'s change filter.
`a-doc-a-test-reads-that-ci-skipped.unit.test.ts` demands it on that PR.

**Guard.** The widened patterns fail today, run against the files served today: `box-setup.md`:46,
`dropbox-setup.md`:82-86, `google-workspace-setup.md`:79, :208 and :247-252,
`microsoft-setup.md`:124-126, `o365-setup.md`:15, :40 and :108, `apple-setup.md`:19. After the
move they run against `docs/guides/`. One case more: no file under `docs/guides/` is named
`*-setup.md`, so an operator document cannot be served by being moved into the folder. And one
in `Docs.unit.test.tsx`: under an appliance build the index shows D9's line in both languages,
and under a managed build it does not.

### T2 — no hint to create an app where the deployment carries one (decided, D2)

The one fact is `providerClientFacts()` on the server and `/api/provider-clients` in the
browser. Each part below reads it. None reads the edition's name.

**(a) The about-lines, and the line under the button.** `aboutSource` takes `deploymentClient`
into account. Where it is true, the Google product cards and Dropbox show one line per provider,
and the fold keeps only what is particular to the card: Drive's sentence on Docs, Sheets, Slides
and Drawings, and nothing about clients, scopes or tokens.

- `wizard.about.deploymentApp.google`:
  - EN: *"Signs in through this service's own Google app: press Connect with Google and approve
    at Google."*
  - NL: *"Meldt zich aan via de eigen Google-app van deze dienst: druk op Verbinden met Google en
    geef bij Google toestemming."*
- `wizard.about.deploymentApp.dropbox`:
  - EN: *"Signs in through this service's own Dropbox app: press Connect with Dropbox and approve
    at Dropbox."*
  - NL: *"Meldt zich aan via de eigen Dropbox-app van deze dienst: druk op Verbinden met Dropbox
    en geef bij Dropbox toestemming."*

Where it is false, today's lines stay. 0144 T3's line beside *Connect with Google* and 0140 T3's
in-app browser line sit beside this one and are laid out together.

The redirect line under the button (`wizard.<provider>.redirectUri`, §1) is shown only when the
consent used a client or app the person typed in, in the wizard and in the consent panel. With the
deployment's app, the address is the operator's to register, and the line is not shown.

**(b) The checklist.** A step gains `ownAppOnly?: GrantProvider`, and
`setupStepsFor(side, provider, facts?)` leaves out a step whose provider the facts call
`deployment`. The managed route passes `providerClientFacts()`, and the appliance's route passes
nothing, so the appliance keeps every step. Keys are never renamed (`provider-setup.ts`:32-34).

- **Google:** all three steps are own-app steps, and the consent is the wizard's button. The
  Google account card (`google`), which has no profile today, gets the same one.
- **Dropbox:** *create an app* and *permissions* are own-app steps. The manual consent URL and
  code exchange are replaced by *register the redirect address the wizard shows*, an own-app step
  too. The two old keys leave the file, and their rows are left harmlessly behind (:17-20).
- **Microsoft account (`microsoft`):** gains a profile of own-app steps (T5).

When every step is left out, the page does not say *"Nothing to set up"*. It names the button:

- `setup.deploymentApp`:
  - EN: *"Nothing to create: this service has its own {provider} app. Press Connect with
    {provider} in the wizard."*
  - NL: *"Niets aan te maken: deze dienst heeft een eigen {provider}-app. Druk in de wizard op
    Verbinden met {provider}."*

**(c) The guide.** The Google, Dropbox and Microsoft guides each have one section with the stable
id `own-app` (*Met een eigen app* / *With your own app*). The page reads the same fact through
the same query key, and renders that section as a closed `<details>` where the deployment
carries the app (*"Alleen als u een eigen app wilt gebruiken"* / *"Only if you want to use your
own app"*), open where it does not. That mirrors the wizard, which folds the pair the same way.
The Box guide has no such fold: Box has no deployment app.

**(d) The refusals.**

- The create route's Google and Dropbox refusals (`routes/migrations/index.ts`:1150-1157,
  :1195-1200, :1313-1325, :1417-1422) branch on the same fact. With the deployment's app, a
  refusal names the refresh token and the button, and not "your own". They stay English, as
  refusals are (i18n boundary :18). For example: *"A 'dropbox' source needs a refresh token, and
  this service has its own Dropbox app: press Connect with Dropbox, which fills it in."*
- `microsoftConsentRefusal` receives whether the deployment's registration was used. When it
  was, `AADSTS700016` says: *"Microsoft could not find this service's application in the
  directory it was asked about. That is a setting of this service, not of your account; tell
  whoever runs it. The Entra error is AADSTS700016."* The operator's sentence stays for a
  registration the person typed in.

**Guards.** Each fails today:

- `apps/web/src/pages/a-hint-that-knows-the-service-has-an-app.unit.test.tsx`: with the facts
  stubbed `deployment` for Google and Dropbox, the wizard's about-line for `google-drive`,
  `gmail`, `google-calendar` and `dropbox` is the deployment line in EN and NL, and contains
  neither *"your own"* nor *"uw eigen"*. With `connection`, today's lines. After a stubbed
  consent start, the redirect line is absent in the first case and present in the second, in the
  wizard and in the consent panel. The Docs page renders the `own-app` section closed in the first
  case and open in the second.
- `provider-setup.unit.test.ts`: with Google's fact `deployment`,
  `setupStepsFor('source', 'google-drive', facts)` is empty; without facts it is unchanged.
- In the API: `GET /api/setup/source/dropbox` with the deployment's Dropbox pair in the
  environment returns no `create_app` step.
- `create-coherence.unit.test.ts`: with the deployment's client set, a Dropbox or Google create
  missing only the refresh token is refused without *"your own"*.
- `microsoft-consent.unit.test.ts`: with the deployment's registration, `AADSTS700016` does not
  name `MICROSOFT_OAUTH_TENANT`.

### T3 — cards that cannot work on managed are hidden there (decided, D3, D5 and D7)

> **2026-09-24, D10:** the owner kept the archive card offered on managed, labelled experimental.
> So the flag, `offeredCards()` and the hiding below are not built, and the branch that built them
> is dropped. What remains of T3 is the Apple export's tag (D7), now on both editions and before
> the first invitation. The text below is kept as it was written.

**The flag.** `FrontDoorCard` gains `notOnManaged?: string`, the reason, written for developers
and never rendered, beside the existing `connectionOnly`. One function, `offeredCards(role)`,
drops those cards when `!isSelfHost()`. The wizard (`migratableSourceCards`) and the Connections
page (`frontDoorCards`) both read through it, so the doors cannot differ. The card table itself
is unchanged, so `front-door-cards.unit.test.ts`'s pin, one card for each type the create route
accepts, still holds. Existing connections of a hidden kind stay in the Connections list: the
flag hides a door, not data. The guide index and the Setup chooser skip what the flag hides.

**What it hides, and why.**

- **The export archive** (decided): §1's table. The server half, refusing a disk path on the
  managed API, is 0136 T5's. The card returns when an upload or relay path exists (the parked
  trigger in the table).
- **Not hidden: Microsoft 365 *Via IMAP*** (D5). The owner has run it and will run it again. As
  Microsoft's documentation is understood here, the recipe served today cannot give its token
  a permission Exchange Online accepts for IMAP (§1). So its guide section carries T8 (b)'s
  recipe instead, and 0131 T2's tag stays on the card until a run is recorded.
- **Not hidden: *Via the Graph API*.** Its token is of the right kind and its recipe lacks one
  permission; T8 (a) adds it, and 0131 T2 labels the card.
- **The Apple export option** (D7). On managed it goes with the card. On the appliance it stays,
  with D7's tag and line. The form reads which exports a reader exists for, the fact
  `archiveProvidersWithReaders()` states (:88-91). Shared cannot import orchestration, so that
  list moves to `archive-providers.ts`, and a test in orchestration holds it equal to `READERS`.
  An option whose export has no reader shows the tag, *Nog te testen* / *To be tested*, as text
  inside the option's name, and the field's hint shows D7's line while that option is chosen.
  When a reader lands, both go and nothing else changes. `archive-setup.md`'s Apple part, which
  becomes the archive guide's under T1, gains the same line before the request. The card's own
  hint, *"A Google Takeout or Apple export you downloaded"* (`wizard.proto.archive.hint`), gains
  the tag after *Apple* in both languages.

**Guard.** `apps/web/src/components/a-card-that-cannot-work-is-not-offered.unit.test.tsx` fails
today. Under a managed build, neither door offers `archive`, and both offer `oauth2` (D5). Under
an appliance build the lists are unchanged. The archive form's Apple option carries the tag, and
`google-takeout` carries none, for as long as only Takeout has a reader. Every `notOnManaged`
card has a non-empty reason. `front-door-cards.unit.test.ts`'s case *"the export archive is
offered at BOTH doors"* changes on purpose, to the table and the appliance.

### T4 — a Dutch and an English guide for each source and target (decided, D4 and D8)

**The guides.** One guide per family of cards whose steps are the same, with a subsection per
card where they differ. Slugs are English and stable, so a link reads the same in both languages.

| Guide | Cards (side) | Today |
|---|---|---|
| `google` | `google`, `google-drive`, `gmail`, `google-calendar`, `google-contacts` (source) | `google-workspace-setup.md`, English, no section for the account card |
| `microsoft` | `microsoft`, `graph` and `oauth2` (source) | `microsoft-setup.md` and `o365-setup.md` |
| `dropbox` | `dropbox` (source) | `dropbox-setup.md` |
| `box` | `box` (source) | `box-setup.md` |
| `apple` | `apple` (source) | `apple-setup.md` |
| `imap` | `imap` (source and target) | none |
| `jmap` | `jmap` (target) | none |
| `dav` | `caldav`, `carddav`, `webdav` (target) | none |
| `nextcloud` | `nextcloud` (target) | none |
| `soverin` | `soverin` (target) | none |
| `archive` | `archive` (source), both editions (D10) | `archive-setup.md` |

**One outline.** Each guide has the same sections, with the same ids in both languages, written
as `## Koppelen {#connect}` so the renderer takes the id from the brace (T6):

1. *Wat u nodig hebt* `{#before}`: the accounts, passwords and administrator a person needs
   before starting.
2. *Koppelen* `{#connect}`: the steps in the wizard, with a subsection per card (`{#gmail}`,
   `{#webdav}`, …). The fields are named with the wizard's own labels in that language.
3. *Wat er meegaat* `{#what-moves}`: what arrives and what does not.
4. *Als de test iets meldt* `{#when-test-says}`: the common refusals, quoted as they are shown
   (the provider's words in English), and what to do.
5. *Stoppen* `{#leaving}`: what to revoke at the provider, such as an app password or a consent.
6. *Met een eigen app* `{#own-app}`: Google, Dropbox and Microsoft only (T2 (c)).

**What each new guide says**, and where the facts come from. Nothing is guessed:

- **IMAP**, source and target: host, port, TLS (the box beside the port, on by default,
  `wizard.useSsl`), user name, password, and an app password where the provider refuses the
  account password (`setup.imap.app_password.detail`).
- **JMAP:** host, port, user name and password, sent as HTTP Basic (`jmap-target.ts`:232; the
  field is *Wachtwoord*). An app password where the server offers one
  (`setup.jmap.api_token.detail`). The mailbox must exist first
  (`setup.jmap.account_exists.detail`). A file over 8 MB does not reach a JMAP target yet (0143
  T3, until T3b lands): one sentence, since it decides whether a tester sends files to JMAP or to
  WebDAV, and a link to 0144 T2's page for the rest. 0141 T8 says what JMAP contacts and files
  have been run against.
- **CalDAV, CardDAV, WebDAV:** host and port, or the full address when the DAV root is not at the
  host root (`wizard.targetDavUrl.hint`), user name, and an app password where offered
  (`setup.davbasic.app_password.detail`).
- **Nextcloud:** the address the person opens Nextcloud at, with `/remote.php/dav` on the end
  (`wizard.nextcloudDavUrl.hint`); an app password from *Settings → Security → Devices & sessions
  → Create new app password* (`setup.webdav.app_password.detail`); no mail, which the card's
  hint already says.
- **Soverin:** one account for mail, calendars and contacts; the DAV address (the card's example
  is `caldav.soverin.net`, `credential-fields.ts`:466); the mail host, typed, only if mail will
  arrive (`wizard.soverinMailHost.hint`). The repository has these only second-hand:
  `docs/soverin-supervised-run.md` §A step 2 gives `caldav.soverin.net` and `imap.soverin.net` as
  *"Soverin's published values, not measured ones"*, and says an app password goes in the password
  field, without knowing whether one covers every protocol. The guide's words are read from
  Soverin's own pages when it is written, and checked in 0141 T7's sitting, which is that
  runbook's run.
- **Google, Photos:** Google's Photos Library API does not allow a complete copy (:540-545,
  kept). On managed, the only route, an export archive, is not offered (T3), so the guide says
  Photos cannot be moved on this service yet. On the appliance it names the archive guide. The
  page picks the sentence by edition, as T3 picks the cards, so the served text carries no edition
  aside. This replaces the sentence #1137 left (§1).
- **Google account:** calendars, contacts and tasks, and mail and files through the Gmail and
  Google Drive cards where the deployment has not declared more (`CONSTRAINED_SOURCE_PROSE`,
  `target-domains.ts`).

**Which language.** The page picks `docs/guides/<locale>/`. If that language is missing, it shows
the other language under one line in the reader's own language, and sets `lang` on the article:

- NL: *"Deze handleiding is er nog niet in het Nederlands; hieronder staat de Engelse versie."*
- EN: *"This guide is not yet available in English; the Dutch version follows."*

The Dutch is written first (0144 D1). The English of the sources is the English customer half of
today's files after T1. The English of the five new guides is written before the first invitation
as well (D8), so `ENGLISH_PENDING` starts empty. The fallback notice stays, for a guide added
later in one language first.

**One card table.** Each card in `front-door-cards.ts` gains `guide`, such as `'google#gmail'`,
per side. `Setup.tsx`'s `guideSlug` (:126-130) and the lint's `guideSlugFor` (:106-110) read it,
so there is one map where there are two. *Read the full setup guide* opens the card's section,
and the about-line's fold ends with the same link. Once 0131 T2's table exists, the guide page
shows the card's *Experimenteel* tag beside its section heading, read from that table. The guide
text does not restate it.

**The i18n boundary gains a class.** `docs/i18n-prose-boundary.md`, under *"Classes the client
localizes"*, item 5, *Customer guides*:

- documents authored in each language, side by side in `docs/guides/nl/` and `docs/guides/en/`,
  updated together or the missing one listed;
- a provider's screen words in the provider's own words in that language;
- the wizard's labels as `strings.ts` has them in that language;
- a server finding or refusal quoted verbatim, in English, as it is shown.

**Guard.** `apps/web/src/pages/a-guide-for-every-card.unit.test.tsx` fails today, because
`docs/guides/` does not exist:

- every card offered on managed names a guide section that exists in Dutch, and in English unless
  its slug is on `ENGLISH_PENDING`; an entry there whose English now exists fails, so the list
  only shrinks;
- both languages of a guide carry the same section ids;
- in the card's section, every required field's label appears as the wizard shows it in that
  language (`STRINGS[locale][field.labelKey]`, for `credentialFieldsFor(side, card)`). This
  replaces the lint's English synonym list for the served guides, and covers targets as well as
  sources.

0144 T3's scan for "read-only" (`a-read-only-claim-with-its-scope.unit.test.ts`) should read
`docs/guides/` as well. That is proposed here for 0144 to take up.

### T5 — the checklist says what must be done first (proposed)

**Before the first invitation**, three new profiles, with strings in both languages, and one
mapping:

- **Apple:** make an app-specific password at `account.apple.com` → *Sign-In and Security* →
  *App-Specific Passwords* (the words of `wizard.appleAppPassword.why`). It yields the password.
- **Nextcloud:** the account exists; an app password (`setup.webdav.app_password.detail`'s
  steps); the address with `/remote.php/dav`.
- **Soverin:** the account exists; its password, or an app password if Soverin offers one (T4);
  the mail host, if mail will arrive.
- **The Google account card** reads Google's profile, with T2 (b)'s own-app flags. On
  `ownpace-live` that leaves nothing, and the page names the button.

**After:** the Microsoft account card's own-app profile (T2 (b)), and the archive's on the
appliance: request the export, which Google says takes minutes to days and Apple up to seven
days, and download it before the date the provider shows (`archive-setup.md`:55-62, :127-140).
The Apple step carries D7's tag and line.

**Guard.** A case in `provider-setup.unit.test.ts` fails today: every card offered on managed has
a profile, or is on a short list, `NOTHING_IN_ADVANCE`, with the reason written beside it. Until
its profile lands, `microsoft` is on that list: *nothing in advance where the deployment carries
Microsoft's registration*. Apple, Nextcloud, Soverin and the Google account card fail it today,
and so does the archive, which stays offered on managed (D10).

### T6 — a renderer that keeps a guide's shape (decided, D6)

**Before the first invitation**, what the new guides use:

- real `<h2>`–`<h4>` headings, with the id from `{#id}` or a slug of the heading, the brace
  removed from the text;
- a `#section` link stays in the tab and scrolls to the heading;
- numbered lists as `<ol>`;
- a link inside bold renders as a link;
- `lang` on the article (T4);
- the index shows each guide's title, its first heading, in the reader's language, not its slug;
- the `own-app` fold (T2 (c)).

**After:** GFM tables inside a container that scrolls at phone width, blockquotes, continuation
lines of a list item, and a fence indented inside a list. Until then a guide is written without
them, and the guard below fails when one is used.

The renderer in `Docs.tsx` is extended (D6). The guides are ours and short, and no dependency is
added. Accessibility of the page itself, its
title and where focus lands, is 0145 T3 (b). Adding `/docs/<slug>` to 0145 T8's automated scan is
proposed here for 0145 to take up.

**Guard.** `Docs.unit.test.tsx` renders every served guide in both languages, and fails today:

- no rendered paragraph begins with `|`, `>` or a number followed by a full stop;
- every heading is an `<h2>`–`<h4>` with an id;
- every `#` link names an id on the page and has no `target`;
- a link inside bold is an `<a>`;
- the index shows titles.

### T7 — every link in a guide resolves, and a refusal links its guide (proposed; after)

**Links in the guides.** Every relative link points at a served guide and a section that exists
in the same language, and every `#` link at an id on the page. A link to a file under `docs/`
that is not served fails, and so do today's two (`grant-links.md`, `o365-application-access.md`).
`docs/grant-links.md` is a customer document for whoever issues a grant link. It is split and
served like the others if testers send grant links during the alpha (0140 open question 2);
until then no guide links it. The guard is a case in T4's test file.

**Refusals.** A refusal's words stay as written, in English, verbatim (i18n boundary :18). Beside
them it carries a guide handle, such as `guide: 'dropbox#connect'`:

- in the create route's Zod issues, as `params`;
- in `credential-refusals.ts`'s pairs;
- in the probe's refusals.

The web app renders a link from the handle, *Handleiding: {title}* / *Guide: {title}*. That is a
frame in the reader's language, class 2 of the i18n boundary, and the words themselves are
untouched. The words stop naming `docs/….md`.

**Who reads each sentence, and what it points at.**

- A sentence only an operator reads keeps naming the operator document: the appliance's mapping
  file, a worker log, the CLI. It goes on an allow-list with the reason.
- The sentences that name documents that are not served are re-pointed after reading who sees
  each: the Graph connectors' and `credential-refusals.ts`'s `o365-application-access.md`, and
  `mapping-pattern.ts`'s `shared-mailboxes.md`. A tenant administrator's steps go to the
  `microsoft` guide's `own-app` section. What only an operator can do goes on the allow-list.
- `create-coherence.unit.test.ts`'s six pins on file names change on purpose, to pin the handle.
- `Docs.tsx`:5-8's comment is corrected in the same PR.

**Guard.** `scripts/a-refusal-that-links-its-guide.unit.test.ts` fails today. A string literal in
`apps/api/src` or `packages/*/src`, tests excluded, that names `docs/<name>.md` fails unless it is
on the allow-list with a reason. Every handle names a served guide and section. Eleven sites in
`routes/migrations/index.ts` fail it today.

### T8 — the Microsoft app-registration recipe (proposed; the walks are the owner's)

Both cards that take a registration of the tester's own are offered from the first invitation
(D5). So both recipes are written into the `microsoft` guide's `own-app` section with T4, before
the first invitation. The walks are the owner's.

**(a) The *Graph API* card.** The `microsoft` guide's `own-app` section, for this card, lists the
application permissions under Microsoft Graph that `o365-application-access.md` §2 lists,
`Mail.Read` among them, plus the ones the card's other data types need. It lists no delegated-only
permission as an application permission. The list is checked against Microsoft's current pages when
written, and walked once in the owner's tenant, with the result recorded where 0141 T1 records
proofs. The walk comes before the card's first tester. Until then, 0131 T2's label says the card is
unproven.

**(b) *Via IMAP*.** A recipe for app-only IMAP, written from Microsoft's documentation: the
Exchange Online permission `IMAP.AccessAsApp`, registering the application in Exchange Online,
and giving it the mailbox. None of that is in the repository today, and it is not asserted here
beyond what §1 says. The owner has run the card once and will run it again (D5). The next run
is this recipe's walk. It is recorded where 0141 T1 records proofs, with the registration it used.
Where the run and the recipe differ, the run corrects the recipe. 0141 T13's O365 lane is where
the proof repeats.

**(c) `o365-setup.md`** is operator material after T1. 0140 T4's line sending managed readers to
the Microsoft guide goes at its top.

**Guard.** A case in the lint: the application-permission list of the `microsoft` guide names
`Mail.Read`, and lists neither `IMAP.AccessAsUser.All` nor `offline_access` as an application
permission. The `oauth2` section names `IMAP.AccessAsApp`, since the card is offered (D5). Run
against today's `o365-setup.md`, both fail.

### T9 — the export read from a folder in the migration's own files (decided, D11)

**The form.** `archiveFields()` gains a third field, `where`, a choice of two. It is not a secret,
just as `path` is not.

- *In a folder of your destination's files (Nextcloud or WebDAV)* / *In een map in de bestanden
  van uw bestemming (Nextcloud of WebDAV)*;
- *On this appliance's disk* / *Op de schijf van deze appliance*.

The path field's label and hint follow the choice. For the destination, the field asks for the
folder as it appears in the person's files, from the top (`Exports/takeout-20260904`), or one
`.zip` in it. For the disk, the field stays as it is. On managed the destination is the default,
and the disk option is disabled, with the line *Only on a self-hosted appliance* / *Alleen op een
eigen appliance* (D11). On the appliance the disk stays the default. For the destination, the
Test answers `probe.countedAtPreflight`, a string that exists. The wizard lets the person continue
on that answer.

**The doors.** `POST /api/connections` and `POST /api/migrations` accept `where` in an archive's
values and `sourceConfig`, pass it to `parseArchiveSource`, and store it. `sourceConfigOverride`
keeps `where` beside `path`, because the next export in a series can be kept somewhere else
(0116 §5). When `where` is `target`, the migration door checks the target:

- `webdav` or `nextcloud`: accepted;
- `jmap`: refused with `archiveStoreInTarget`'s sentence;
- a target with no file face: refused with a sentence that says the export must be in the
  destination's files, and which targets have them.

The rule is one function in shared, `archiveInTargetRefusal(targetType)`, and the wizard's target
step reads it too (hard rule 5: one authority, both editions). The JMAP sentence moves to shared
with it, and `archiveStoreInTarget` imports it. 0136 T5's refusal of a server path on managed
names this choice.

**The guide.** The archive guide (T4, Dutch and English) gains a section, *Your export in your
own Nextcloud* / *Uw export in uw eigen Nextcloud*. It says what to do: upload the `.zip` parts
into one folder of the files the migration writes to, then name that folder. It also says that
the parts stay in those files after the migration and take their space, and that the person can
delete them once the result is checked.

**Guard.** Each case fails on today's code.

- In `apps/api`: an archive posted with `where: 'target'` and a Nextcloud target is stored with
  `where` in the mapping's config. A JMAP target is refused with the sentence, and so is a target
  with no file face. A reused connection's override keeps `where`.
- In the web app: the archive form shows the choice. Under a managed build the destination is
  the default, and the disk option is disabled with its line.
- In shared: `archiveInTargetRefusal` accepts `webdav` and `nextcloud`, and refuses every other
  target type the create route knows.

**The gate gets its proof back.** 0136 T5 breaks `smoke-managed.sh`'s archive steps
(:3161-3230), which write a fixture into the API container. T9 moves the step. The fixture
Takeout is written into tenant B's files on the demo Nextcloud, where the gate's tenant B already
migrates files (:2086). A migration from an archive with `where: 'target'` is created against
that target, and its preflight must count three items, one of them an edited version, as today's
step does. The `path: "/tmp"` step becomes 0136 T5's refusal.

## 4. Order

**Before the first invitation**, in this order:

1. T3's Apple tag (D7), one web PR with its guard. The flag and the hiding are not built (D10).
2. T9, the export in the migration's own files (D11), one PR stacked on 0136 T5's.
3. T2 (a), (b) and (d), one PR across the web app, shared and the API.
4. T6's first half, then T1 and T4 for the Google, Microsoft, Dropbox, Box and Apple cards, with
   T2 (c), T1's pointer on the appliance (D9), and T8's two recipes in the Microsoft guide (D5).
   Then T4's IMAP, JMAP, DAV, Nextcloud and Soverin guides, in Dutch and English (D8). One PR per
   guide family, each with the guard cases that family needs.
5. T5's three profiles and the Google account card's mapping.
6. T0, the owner's reading on `ownpace-live`, which may send text back to step 4.

**After:** T6's second half, T7, T8's walks (the owner's: (a) before the first *Graph API* tester,
(b) the run D5 announced) and T5's remaining profiles.

Each code task is its own PR with its guard.

**The row for 0131 T5**, drafted here for 0131 to take in:

| Plan | The minimum before the first invitation | Today |
|---|---|---|
| 0148 A guide written for the person using it | T3: the Apple export tagged *to be tested* on both editions; the export archive stays offered on managed with 0131 T2's tag (D10), and 0136 T5 refuses a typed disk path there. T9: the export read from a folder in the migration's own Nextcloud or WebDAV files (D11). *Via IMAP* stays, tagged experimental until the owner's run is recorded (D5). T2 (a), (b) and (d): where `ownpace-live` carries Google's, Dropbox's or Microsoft's app, no about-line, redirect line, checklist or create refusal tells a tester to create one or register an address on it. T1 and T4 for every card live offers: a customer guide in Dutch and English (D8), served in the app, with no operator material, read by the owner against live's screens (T0). The Microsoft guide carries T8's two recipes (D5). T6's first half. T5's profiles for Apple, Nextcloud and Soverin, and the Google account card's. | The seven served guides are in English and written for operators; no target and not the IMAP source has one. The archive card is offered on managed and asks for a path on the server, which a managed pass cannot read. The wizard's about-lines, the redirect line under its button, the checklist and the create refusals say "your own" whatever the deployment carries (0148 §1). |

## Not in this plan

- The tester guide on the site, the known-limitations page and the "read-only" wording: 0144 T1
  to T3. The site guide says, in one line, that each source has a guide in the app under
  *Handleidingen*. That line is proposed here for 0144 T1 to take up.
- The steps Google, Microsoft, Dropbox, Box and Apple put in front of a tester: 0140 T2 and T6 to
  T9. Their sentences land in the customer guides once T1 has split them. Records read from a
  provider's console land in the operator documents.
- The "experimental" label and its table: 0131 T2.
- The live runs that take a label off: 0141.
- Refusing a disk path on the managed API, and whether a typed path on a shared host is
  acceptable: 0136 T5.
- The Docs page's title and focus, automated accessibility checks, and Verify's tooltip help:
  0145 (T3 (b), T8, T7 (b)).
- The Google client `ownpace-live` carries, and its redirect address: 0140 T11, with the owner's
  answer quoted in D2.
- The limits a guide names, such as JMAP's 8 MB: 0143.
- Removal that fails closed (W18). The owner's answer the same day, *"write as a plan. But we do
  offer 'apply deletions'. And do hold the cutover-gate when nothing was compared."*, is taken up
  in 0149, *Removal fails closed, and reads stay reads*.

## Open questions

1. **The *Via IMAP* card on managed (T3, T8).** (a) Hidden until T8 (b)'s recipe has been walked
   in a real tenant. *Recommended*: as Microsoft's documentation is understood here, it cannot
   work as offered (§1); nobody has recorded a working recipe; and the *Microsoft 365 account*
   card covers a person's own mailbox. (b) Kept, with a
   recipe rewritten from Microsoft's documentation but not walked, and 0131 T2's label.
   *Answered 2026-09-24: kept (D5).* The owner: *"dont hide IMAP, i tested that once and will do
   that again."* The owner's next run is T8 (b)'s walk.
2. **The renderer (T6).** (a) Extend `Docs.tsx`. *Recommended*: no new dependency, and the guides
   are ours. (b) Adopt a small vetted markdown library; the maintainer decides dependencies, as
   0145 open question 4 asks for its own. *Answered 2026-09-24: (a) (D6).* The owner: *"extent the
   guide renderer."*
3. **The Apple export option on the appliance (T3).** (a) Offer only the exports a reader exists
   for, on both editions. *Recommended*: it cannot work anywhere. (b) Keep it, with the line
   that says it cannot be read yet. D3 speaks for managed only, so this is the owner's call.
   *Answered 2026-09-24: (b), with a tag (D7).* The owner: *"Leave the Apple-export option in but
   be clear about it ('to be tested'-label)."*
4. **English for the five new guides (T4).** (a) After the first invitation, with the fallback
   notice meanwhile. *Recommended*: the alpha is Dutch. (b) Before. *Answered 2026-09-24: (b)
   (D8).* The owner: *"Add the five new guides already."*
5. **The appliance's `/docs` (T1).** Should its index carry one line pointing self-hosters to the
   operator documents in the repository? That is a link to the public repository, not served
   text. *Recommended: yes.*
   - EN: *"Running your own appliance? Its settings and commands are in the operator documents
     in the repository."*
   - NL: *"Draait u een eigen appliance? De instellingen en commando's staan in de
     beheerdersdocumenten in de repository."*

   *Answered 2026-09-24: yes (D9).* The owner: *"Yes, one-line pointer towards the
   appliance-help-page to de appliance operator docs"*.
6. **Can the archive card work on managed (D10)?** It is offered there, labelled, but as the
   wizard asks for it, it cannot complete: the only place a managed pass can read an export is
   the migration's own file target, and the wizard cannot say so. (a) Add that choice to the
   wizard: the person puts the export in a folder of the destination's files (a Nextcloud or
   other WebDAV target) and names the folder; the reader and the create door already know
   `where: 'target'` (0116 T4). *Recommended* if testers are to use the card. (b) Leave the card
   labelled and let 0136 T5's refusal say that a managed archive cannot be read yet.
   *Answered 2026-09-24: (a) (D11).* The owner: *"the wizard should be able to read a Takeout
   export from a folder in the tester's Nextcloud or other target files-kind supporting target."*
   The create door did not know `where` after all; T9 teaches it.
