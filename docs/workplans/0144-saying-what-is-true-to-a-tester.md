# Workplan 0144 — Saying what is true to a tester

> **In one line:** What a tester is told: a Dutch tester guide, a known-limitations page guarded by the feature matrix, corrected read-only wording on site and grant page, `APPLY_FLAG_WARNING`, a support contact, Request access on sign-in, organisation closure.

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 read what the
site and the product say to somebody who is about to try the service, and found it written for
a finished product or for the owner. There is no tester guide and no list of known limitations
a tester can read. The site and the grant page call the connection *"read-only"* while some of
the permissions the product asks for can write. The warning in front of the only destructive
switch promises a check that does not always run. A tester who is stuck before signing in has
nobody to write to. The sign-in page has no way to ask for access. An owner cannot close their
organisation from any screen. The owner chose to write this plan: *"W11 write, W12 write, W13
write, W14 write, W15 explaoin, W16 write, W17 write, W18 explain, W19 write"*. 0131 §5 calls
this work W14.

Nothing is built, apart from the compose fix named at the end of this paragraph. Neighbouring
plans carry parts of what a tester is told, and this plan does not repeat them: the alpha note
(0131 T1), the "experimental" label (0131 T2), "nothing is charged" (0131 T3), the alpha
conditions and the legal texts (0139 T2 and T10), acceptance (0139 T3), and closing an
organisation during the alpha by an operator command (0139 T7). Two fixes on the pages this plan
changes were drafted in #1137, which merged on 2026-09-24: the request page opens in the language
the site linked it with, and the grant page links the privacy policy and terms the site publishes.
One defect was found while writing this plan and is not in the review: the managed compose file
did not hand the API the three settings that switch the problem report form on. It is fixed on the
branch that carries this plan, and not yet on `main` (§1, T6).

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137
merged.** Testers use a second compose project, `ownpace-live`, at the production names
`app.ownpace.eu` and `id.ownpace.eu`. The OTA stack stays the nightly gate's target and the demo
(0131 D3, 0132 D7). The alpha's texts are published on the production site, `www.ownpace.eu`
(0139 T10 and its open question 1). So the guide (T1) names the production addresses and is
published beside those texts, and T6's GitHub route points there. Every fact in §1 was checked
again at `main` after the merge (`987cb06`), and the line numbers are today's. The grant page's
part of T3 is now tied to 0140's open question 2, as 0145 T6's grant half is: it is needed before
the first invitation only if testers send grant links during the alpha.

**2026-09-24, cross-plan sync: W15 and W18 are 0148 and 0149, and open question 3 is answered.**
Later the same day the owner answered W15 and W18. The in-app guides, which §1 and *Not in this
plan* called W15 and not planned, are 0148, *A guide written for the person using it*. Removal
that fails closed, W18, is 0149, *Removal fails closed, and reads stay reads*. Its D1 answers open
question 3: *"But we do offer 'apply deletions'."* So testers may arm the switch, against this
plan's recommendation (a), and 0149 T1 to T3 make removal fail closed before the first invitation.
T1's line about the switch, T4 and the lists below change with it. T4 stays after the first
invitation: its drafted condition is false once 0149 T3 lands, so it is written after that (0149
T6).

**Before the first invitation.** This is the minimum, and it is kept small:

- T0, the owner's words: the address testers write to, and the site copy;
- T1, the tester guide, in Dutch, in its short form;
- T3's Connect line and site copy, and its grant page if testers send grant links (0140 open
  question 2);
- T6, a person to write to, before and after sign-in;
- T7, *Request access* on the sign-in page.

**After the first invitation**, during or after the alpha: T2, T4, T5's screen changes and T8.
Until they land, the guide carries their advice: keep the old account, start with an empty
target, and ask the owner to close. What it says about *apply deletions* follows 0149 D1 (T1).

Everything a tester reads is written in Dutch first and translated into English (D1).

| Task | Status | Notes |
|---|---|---|
| T0 The owner's words: the address, the site copy, the guide read in Dutch | ⏳ **Owner** | §3. The address testers write to (0133 open question 3). Approval or rewrite of T3's site copy. A read of T1's Dutch before it is published. **Before the first invitation.** |
| T1 A Dutch tester guide | 📋 **Proposed** (D1, D3) | §3. One page on the site that carries the alpha's texts (0139 T10): what the alpha is, before you start, how to start, what is experimental, how to get help, how to leave. Built only when the site is built for the alpha. **Before the first invitation**, in its short form. |
| T2 A known-limitations page the feature matrix keeps true | 📋 **Proposed** (D4) | §3. A copy on the site, in Dutch and English, and a guard that fails when it disagrees with the matrix's open gaps or 0131 T2's verdicts. **After.** |
| T3 "Read-only" replaced by what is true | 📋 **Proposed**; the site copy ⏳ **Owner** (T0) | §3. The grant page says "read-only" only when Google enforces it. One line beside *Connect with Google*. Site copy, how-it-works, the grant-link guide and one setup title. **Before the first invitation**: the Connect line and the site copy, and the grant page if testers send grant links (0140 open question 2). |
| T4 The warning in front of the delete switch says what the check does | 📋 **Proposed** | §3. `APPLY_FLAG_WARNING` in both languages. Making removal fail closed is W18, now 0149, whose T1 to T3 land before the first invitation (0149 D1). **After**, written once 0149 T3 has landed, because T3 changes what the check does (0149 T6). |
| T5 A destination that is not empty | 📋 **Proposed** | §3. The advice goes into T1 (**before**). The confirm screen names what adoption means later, and an IMAP target's exception (**after**). |
| T6 A person to write to, before and after sign-in | 📋 **Proposed**; the address ⏳ **Owner** (T0) | §3. A support line on the pages outside the app, and in the sidebar when the report form is off. The GitHub chooser gets a route for the hosted service. The report form's settings now reach the API on this plan's branch, not yet on `main` (§1). **Before the first invitation.** |
| T7 *Request access* on the sign-in page | 📋 **Proposed** (D3) | §3. One link under the sign-in button, in the reader's language. **Before the first invitation.** |
| T8 An owner can close their organisation from the screen | 📋 **Proposed** | §3. The screen for the close route that exists. The operator's path during the alpha and the identity provider's account are 0139 T7's, and the erasure sentence's word on backups is 0134 T1's. **After.** |

## 1. What there is today

Each fact below was checked on 2026-09-24 at `main` after the merge of #1137 (`987cb06`). The one
change on this plan's branch that bears on it, the compose fix for the report form, is named where
it occurs. Where a fact comes from the review and was not re-checked here, the text says so. The
review's findings this plan carries are `journey-no-beta-framing`, `nondestr-site-claim-overstates`,
`nondestr-grant-page-readonly-vs-scope`, `nondestr-apply-warning-edit-guard-conditional`,
`nondestr-terms-item-by-item`, `nondestr-populated-target-undisclosed`,
`journey-feedback-and-help-channel`, `rootdocs-issue-route-for-managed-testers`,
`journey-login-no-request-link`, `journey-no-account-closure-path`,
`guides-unproven-faces-not-stated` and `journey-billing-undefined-for-testers`. Four were only
partly confirmed by the review's own verifier (the site claim, the destination, the issue route
and the guides), and the limits are stated where they occur.

### What a tester can read before they start

- **No guide, and no list of limitations a tester can reach.** The in-app help serves
  `docs/*-setup.md` (`Docs.tsx`:27), which are setup guides in English. What is not yet proven is
  written down in `docs/feature-matrix.md`, in the repository only: its legend (⏳ *"built,
  awaiting first contact with reality"*) and its table *"The open gaps, in one place"* (:390).
  `docs/owner-test-runbook.md` is written for the owner (*"every test only the owner can
  run"*). The site renders the home page, how-it-works, pricing, the estimate and the two legal
  texts in both languages (`PAGE_KEYS` in `site/build.mjs`:428). None of them is for a tester.
- **What the neighbours add.** 0131 T1 adds the alpha note, and 0139 T2 the conditions. 0131 T2
  adds the "experimental" tag on the cards, and 0131 T3 the Billing sentence. The review's
  `journey-billing-undefined-for-testers` is carried by 0131 T3 and not repeated here.
- **The in-app guides say nothing about proof.** The review's verifier confirmed that the
  Microsoft guide and the whole-domain Google section carry no caveat, and corrected two details:
  the Apple row is its own row of the open-gaps table (now :405), and
  `google-workspace-setup.md`'s *"What only a real account can prove"* (:512) is a second place
  that states it. Gmail, Google Calendar and Google Contacts moved to ✅ on 2026-09-22, for the
  owner's own account only (matrix :10-17). Rewriting the guides for customers is W15, now
  0148. Since #1137 (merged 2026-09-24) the open-gaps table also lists Dropbox and Box
  (:400-401).

### What "read-only" means today

**What the site says.**

- `site/copy.mjs`:74-75 says *"Nothing is deleted at the source"* and *"That is not a promise
  about our intentions — the software has no way to delete from a source."*
- :85 says *"Your old account never changes"*.
- The Dutch equivalents are at :219-220 and :230.
- `site/pages/en/how-it-works.md`:11-15 has the heading *"Connect the account you are leaving —
  read-only"* and the sentence *"The connection is **read-only**: the software has no path that
  writes to a source"*. `site/pages/nl/hoe-het-werkt.md`:12-16 has *"Die koppeling is
  **alleen-lezen**"*.

**What the code asks for.**

| Source | Permission asked | Can it write? |
|---|---|---|
| Gmail | `https://mail.google.com/` (`GMAIL_SCOPE`, `gmail-source-factory.ts`:50). The comment above it: *"Full mail access as far as the SCOPE is concerned — but this product never writes through it"*. | Yes, by the permission |
| Google Calendar, Contacts | `…/auth/calendar` and `…/auth/carddav` (`google-dav-source-factory.ts`:42, :44). The asked table in `account-qualification.ts`:813-815 says the same. | Yes, by the permission |
| Google Drive | `…/auth/drive.readonly` (`account-qualification.ts`:816-819) | No |
| Google Tasks | `…/auth/tasks.readonly` (`google-tasks-source-factory.ts`:26) | No |
| Microsoft 365, *Connect with Microsoft* | `Mail.Read`, `Calendars.Read`, `Contacts.Read`, `Files.Read`, `Tasks.Read` (`microsoft-scopes.ts`:53-57) | No |
| Microsoft 365 through IMAP (`oauth2` card) | `IMAP.AccessAsUser.All`, or `.default` for app-only (`build-deps-from-mapping.ts`:1380-1382) | Yes, by the permission |
| Any password source (IMAP, a Google app password, Apple) | the password itself (`gmail-source-factory.ts`:62) | Yes, by the password |

Two things are true at once:

- **The software keeps the promise.** The review counted every call each source connector makes.
  The HTTP connectors send only GET, PROPFIND, REPORT and OPTIONS, and Dropbox's POSTs are its
  read calls (`nondestr-source-calls-verified`). That census was not repeated here.
  The IMAP source opens a mailbox with SELECT rather than EXAMINE. It fetches with PEEK, so no
  message is marked as read, but the protocol would allow writing. Making it EXAMINE is W18, now
  0149 T5.
- **The permission does not.** The privacy draft already says this correctly
  (`site/legal/privacy.md`:120-122: *"Where a provider offers nothing narrow … we say so rather
  than implying otherwise"*). The review's verifier judged the site sentences about the
  *software* literally true. What is false is how-it-works' *"The connection is read-only"*.
  The framing *"not a promise about our intentions"* overstates on the managed edition, where a
  tester cannot inspect the code that is deployed.

`docs/google-oauth-verification.md`:86-93 records that `calendar.readonly` may work on Google's
CalDAV endpoint, and `docs/owner-test-runbook.md`:302-309 makes that *"question zero"*. The
repository records no answer to it. If it works, the calendar moves to the "no" column above.

**The grant page.** A grant link is Google only (`isGrantableSourceKind`,
`grant-link-readiness.ts`:61-84): the four single-purpose kinds and the Google account.
`Grant.tsx`:185-190 renders a green box, `grant.readOnly`, which says *"Read-only. Nothing is ever
deleted or changed in your account…"* (`strings.ts`:931-932; in Dutch at :3042-3043, *"Alleen
lezen."*). Directly under it (:192-193) comes `grant.scopeIntro` and the scope Google will
record. For a `gmail` link that scope is `https://mail.google.com/` (`GOOGLE_SOURCE_SCOPES`,
`google-consent.ts`:78-83). For a Google account link it is whatever the migration's ticked types
need (`grant-link-readiness.ts`:251-271). The review's verifier corrected one detail: there is no
default ask, and the tick decides it. `docs/grant-links.md`:72 specifies the same promise, *"**that
it is read-only**"*. The setup checklist's step is titled *"Consent a read-only refresh token"*
(`strings.ts`:2078; Dutch at :3833) for every Google product.

**The Connect button.** `ProviderConsentPanel` (`ProviderConsent.tsx`:250-310) shows the types to
tick, the button and a hint. It says nothing about the permission Google will describe.

### The warning in front of the delete switch

`APPLY_FLAG_WARNING` (`packages/shared/src/operating-contract.ts`:675-682, and the Dutch at
:691-701) is shown in front of the switch that enables removal (`ApplyDeletionsPanel.tsx`:38,
:114). Among the gates it lists is *"never a copy somebody has since edited"*. The code:

- **The check runs only when a version was recorded.** `apply-deletion.ts`:357 and :581 pass
  `expectedTargetVersion` only when `row.targetVersion !== undefined`, and
  `apply-deletion.unit.test.ts`:427 pins that. `ports.ts`:561-564 says why: *"Absent means no
  check"*, which covers every row written before migration 0023 and any server that returns no
  ETag on PUT.
- **A failed look counts as unchanged.** `dav-remove.ts`:120-128 asks with HEAD. A HEAD that
  fails is treated as "proceed", and the DELETE that follows carries no `If-Match` (:133-143).
  `apply-deletion.ts`:42-45 says the check happens *"at the moment of removal so there is no gap
  between reading and acting"*. For DAV that is not so. The review's verifier sized the window at
  milliseconds; the fail-open is what matters.
- **Mail has no edit check.** JMAP mail accepts the version and ignores it
  (`jmap-target.ts`:1155-1159). The IMAP target compares UIDVALIDITY, which catches a recreated
  mailbox and not an edit (`imapflow-dav-target.ts`:596-608). The JMAP comment says why: a message
  is immutable apart from its flags and mailbox membership.
- **The switch is off by default** (`allow_apply_deletions … DEFAULT false`, ledger
  `0004_managed_apply.sql`:21), and so is auto-apply for relocations (`0014`:12). The auto-apply
  switch has its own warning, which says it removes old copies of moved files unattended and
  never applies a deletion (`strings.ts`:132-138). It is shown only once *apply deletions* is on
  (`ApplyDeletionsPanel.tsx`:133).
- **A row recorded as copied when the target refused it** (the review's DAV 412 finding) is a
  provenance defect. It is W18, now 0149 T1.

The terms say *"Deletion at the target only ever happens through a path you switch on and
approve item by item"* (`site/legal/terms.md`:91-92; Dutch `terms.nl.md`:38-39). Auto-apply
removes the old copies of moved files without an item-by-item approval, once a person has
switched it on (`autoApplyRelocations`, `apply-deletion.ts`:1090-1106). That sentence is legal
text and belongs to 0139.

### A destination that is not empty

The review's headline, that testers learn about existing items only afterwards, is **refuted**.
Before they press start, the confirm screen (`DiscoveryCounts.tsx`:231-237, shared by both
confirm pages) says: *"N items already on your destination match something in your source. We
will **keep the destination's copy** and not overwrite it. Anything else already there is left
untouched."* (`strings.ts`:97-100). It also shows a column, *"Already on the destination"*
(:88). What remains:

- **An adopted item stays the destination's copy, also later.** `domain-sync.ts`:243-246: when
  the versions differ and the item was adopted, *"leave it"*. So a later change to that item at
  the source is never copied over it. The confirm screen does not say so.
- **An IMAP target counts one way and writes another.** Discovery walks the whole target
  (`discovery.ts`:99 calls `listEntries()` with no mailbox, and the IMAP target then walks every
  folder, `imapflow-dav-target.ts`:439-446). The writer looks for the Message-ID in the one folder
  it writes to (`findByNaturalKey`, :264-320). So a message the tester already keeps in another
  folder is counted as *"keep the destination's copy"*, and is then appended again. That is a
  duplicate, not a loss. JMAP adopts across the whole account (`jmap-target.ts`:636-639). The
  Soverin account's mail face uses the IMAP writer (`target-domains.ts`:52-60).
- **Nobody advises starting empty.** The only related control is the target folder, and its
  hint is written for another purpose: *"Useful when several sources share one target"*
  (`strings.ts`:450-454).

### Reaching a person

- **Inside the app, only through the report form.** No support address is in `apps/web/src`
  (a search for `support@`, `SUPPORT_EMAIL` and `mailto:` finds none). *Report a problem* sits in
  `Layout.tsx`:318-327 and is shown only when `!selfHost && reportingAvailable`. Its route is
  inside the signed-in layout (`AppRoutes.tsx`:343-350), and the API requires sign-in
  (`problem-reports.ts`:61, :65). The failure line's *Send it to us* link to the form (0130 T3,
  #1132) is on `main` too, and it is also for signed-in customers.
- **The form could not be switched on from `.env`; fixed on this plan's branch.** Found while
  writing this plan; it is not in the review. The report route reads `ZAMMAD_URL`, `ZAMMAD_TOKEN`
  and `ZAMMAD_GROUP` from `process.env` (`problem-reports.ts`:44-52, `services/zammad.ts`:45).
  `managed.yml` lists the API's environment key by key (:794 onward), and on `main` none of the
  three is on the list. Step 8f of `docs/managed-bring-up.md` (:1381-1409) says to set them in
  `.env`, restart the API, *"and the link appears"*. On a stack started from `main`'s
  `managed.yml`, it cannot. The branch that carries this plan passes all three to the API, empty
  by default (`managed.yml`:939-941), and
  `scripts/a-helpdesk-the-api-was-never-handed.unit.test.ts` holds it, on the pattern of
  `the-mail-the-api-could-not-send`. It reaches `main` when that branch merges. Whether a Zammad
  is configured for `ownpace-live` is 0139 T0's fact 3, and 0131 T5's row for 0130 depends on
  both.
- **Outside the app, nothing.** `/login` (:137-144), `/auth/callback` (:148-155),
  `/request-access` (:159-166) and `/invitations` (:199-208) sit outside the layout, so they have
  no report link and no address. The site's footer does show one (`site/build.mjs`:517,
  `SUPPORT_EMAIL` in `site/prices.mjs`:89). Whether a person reads that address during the alpha
  is 0133's open question 3.
- **GitHub.** `.github/ISSUE_TEMPLATE/config.yml` has `blank_issues_enabled: true` and three
  contact links: security, the architecture document and the self-host quickstart. None is for
  somebody using the hosted service. `bug_report.yml` asks for an edition (:13-23) and requires a
  build, described as the appliance's first log line (:25-34). Its opening does warn:
  *"**Do not paste credentials, access tokens, or real mailbox contents.**"* (:8). So the review's
  finding holds only in part: the warning is there, but no route leads a tester away. That
  Discussions is off comes from the review and was not re-checked.

### The sign-in page

`Login.tsx` (361 lines, managed only, `AppRoutes.tsx`:137-144) contains no `Link` and no `href`.
It renders the sign-in button, a fallback for pasting a token, the status link and the build
stamp (:272-358). The only way from the app to `/request-access` is on the callback page, after a
completed sign-in that found no organisation (`AuthCallback.tsx`:116-134). The request page links
back to sign-in (`RequestAccess.tsx`:114, :251). Self-registration at the identity provider is on
(`setup-zitadel.sh`:1495, the owner's decision of 2026-08-22, 0095 T0). So somebody given the
app's address registers there first and only then learns they need to ask. Since #1137 (merged
2026-09-24) the request page reads `?locale=` (`RequestAccess.tsx`:50-59).

### Ending an organisation

- **The route exists.** `POST /api/tenants/:tenantId/close` (`routes/tenants/index.ts`:526-645)
  is owner-only. The window is 0, 7, 30 or 90 days (`CLOSE_WINDOWS_DAYS`, `offboarding.ts`:42).
  It answers with everything a screen needs, in both languages: the dates, the erasure sentence,
  the access that outlives erasure, what erasure never touches, and until when it can be
  reopened. `POST …/reopen` (:647 onward) undoes a close while the window is open.
- **Nothing calls it.** A search of `apps/web/src` finds no caller for close or reopen.
- **Nothing reads the state back.** `GET /api/tenants/:tenantId` answers id, name, slug,
  settings and creation time (:181-187), and not the status. The dates live in
  `tenant_closure` (managed migration 0001:773-782: `closed_at`, `purge_after`, `closed_by`).
- **The organisation page exists.** `Tenants.tsx` is *Team & organization* (*Team & organisatie*
  in Dutch), where members are managed.
- 0139 §1 records that `operator.sh` has no close command, and 0139 T7 proposes one. 0134 T1 makes
  the erasure sentence say that there are no backups.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words, then the answer as given, typos included. Where
an answer needed a reading, the reading is stated, as 0131 reads it.

**D1 — what the alpha is.** *Is the test free or paid, for how many people, and in which
language?* — *"Free and invite only. 10 to 20 people max. Dutch."* On the posture of the test:
*"Free. A few weeks. No obligations both sides."*

So everything a tester reads is written in Dutch first. The guide is short, because the alpha
is short and small. Nothing in it promises what the conditions do not.

**D2 — the word, and the legal texts first.** *A lawyer's pass before the first invitation, or a
labelled test notice? And can you supply the facts the drafts leave open?* — *"Yes before,
Alpha, and i can supply."*

So the guide calls it the alpha, and it is not a contract. The binding words are 0139 T2's
conditions, and the guide links to them.

**D3 — the owner lets people in and supports them.** *What may a member and a viewer do, and
should only owners and admins invite?* — *"I am the gate for letting people in the test."* *A
tester stack separate from CI and the nightly gate, reachable from the internet?* — *"Yes, but
its a controlled rest. I Let people in and support them. Max 10/20 people"* ("rest" is read as
"test"). *Where do testers run, and under which host names?* — *"This machine, ci states. The OTA
address. It's all controlled by me and invite only."* ("ci states" is read as "CI stays".)

Later the same day the owner chose a second stack for testers, `ownpace-live`, at the production
names, beside the OTA stack, which stays the nightly gate's target and the demo. 0131 D3 and 0132
D7 quote the owner's words and carry that decision.

So the person a tester writes to is the owner (T6). *Request access* leads to the owner's queue
on `ownpace-live` (T7). The guide names `app.ownpace.eu` and `id.ownpace.eu`, not the OTA
addresses.

**D4 — unproven sources are labelled.** *For sources nobody has run against a real account:
prove them first, hide them, or label them experimental?* — *"Label"*.

0131 T2 builds the label. T2 lists what it labels, beside the other limitations.

**D5 — no backups.** *How much loss is acceptable, how fast must service come back, and where are
backups kept?* — *"None during the test"*. On the missing database backup: *"No obligations
during controlled test"*.

So the guide says it plainly, with the words 0134 T2 drafts for the conditions.

**D6 — GitHub is the developers' bridge.** *If the current stack is reused, its demo secrets must
be rotated* — *"Who would need/het credentials? I aupporrthe test. No one will be added to NetBird
network. Devs need to setup own private test/dev environments. GitHub PRs and git is the
bridge."* ("het" is read as "get", and "aupporrthe" as "support the".)

So GitHub is where developers work. A tester is supported by the owner, not by a public issue
tracker, and T6's route in the issue chooser sends them there.

## 3. What each task does

### T0 — the owner's words (owner; before the first invitation)

1. **The address testers write to.** It could be `support@ownpace.eu`, which the site's footer
   already shows, or another address a person reads during the alpha (0133 open question 3, 0139
   T0 fact 2). T6 shows it on four pages outside the app, in the sidebar and in the issue
   chooser. The address goes in `ownpace-live`'s `.env` and in the chooser, and never in this
   plan.
2. **The site copy (T3).** The drafts below are proposals. The owner approves them, rewrites them,
   or keeps today's text and says why. Copy on a site the owner publishes is the owner's to
   write.
3. **The guide (T1).** Before it is published, the owner reads the Dutch text against the real
   screens of `ownpace-live`. Google's own Dutch words are used as they appear, as 0140 T2 asks.

The dates go in the Status block.

### T1 — a Dutch tester guide (proposed; before the first invitation, short form)

**Where.** `site/pages/nl/alfa-handleiding.md`, written first, and its translation
`site/pages/en/alpha-guide.md`. They are served as `/nl/alfa-handleiding.html` and
`/alpha-guide.html` on the site that publishes the alpha's texts. Since the owner's ownpace-live
decision that is the production site, `www.ownpace.eu` (0139 T10 and its open question 1). They
are rendered only when the site is built with 0131 T1's alpha setting (working name
`OWNPACE_STAGE=alpha`, handed to `node site/build.mjs` as `OWNPACE_APP_URL` already is; 0131 T1
itself hands it only to the web build and the API). They are not added to the nav (`PAGE_KEYS`),
and the 404 page shows how a page can be left out of it. A build without the setting never
renders them, so they leave the site when the alpha ends.

**Who links to it.**

- 0131 T1's alpha note, on the signed-in pages, the sign-in page and the request page, links to
  it beside the conditions.
- The access-granted mail carries the link in the same sentence as 0131 T1's.
- The owner's own invitation carries it too.

The app builds the address through 0139 T10's module, which turns the site's address into an
address per page and per language. Until that module lands, the mail and the invitation carry
the link.

**What it says.** Six sections, each a heading with a stable id. The Dutch is written first. The
full text is written against the first tester's real screens (T0). The points, and where each
comes from:

1. **Wat de alfa is.** Free, invited, a few weeks, no obligations either side, no backups
   (D1, D5). The binding words are in the conditions (0139 T2), linked here, and this guide is
   not a contract (D2).
2. **Voordat u begint.**
   - Keep your old account until you have checked what arrived.
   - Use a new, empty mailbox, calendar, address book and folder at your new provider, or set a
     target folder for mail and files (T5).
   - Send the owner every Google address you will connect, and wait until it is added (0140 T0 and
     T2).
   - Open links in Safari or Chrome, not inside a mail or chat app (0140 T3).
   - What the switch *Toepassen van verwijderingen inschakelen* does. This replaces the earlier
     advice to leave it alone, since *apply deletions* is offered during the alpha (0149 D1). It is
     off until you switch it on. Once it is on, a deletion you made in your old account can be
     applied to the copy at your new provider, item by item, and only to a copy Ownpace wrote
     there. The line is written once 0149 T1 to T3 have landed, which is before the first
     invitation (0149 T6).
3. **Zo begint u.** The request, the owner's grant, the mail, signing in at `app.ownpace.eu`
   with an account at `id.ownpace.eu`, the conditions (0139 T3), then *Verbindingen* and a new
   migration. Read the confirm screen before you press start, and run *Verifieer de migratie*
   after the first pass. Google asks again about a week later while the client is in Testing.
   What to do is 0140 T2's steps, which move here.
4. **Wat experimenteel is.** A card or data type marked *Experimenteel* (0131 T2) has not yet
   been run against a real account of that kind. The full list is T2's page. Until T2 exists, this
   section says: if you are unsure, ask the owner before connecting.
5. **Hulp.**
   - Use *Een probleem melden* in the app when it is there (0130). Otherwise, and before you are
     signed in, mail T0's address.
   - Say which page you were on and what you did. Give the build shown at the bottom of the page
     (0146 names it).
   - Never send a password, a token or the contents of a mailbox.
   - The owner answers you personally.
   - Do not open a GitHub issue: GitHub is for developers (D6).
   - 0145 T9 (a)'s paragraph, for people who use a screen reader or magnification, goes here.
6. **Stoppen.** You may stop at any time.
   - Ask the owner to close your organisation, and choose when your data is erased (0139 T7; T8
     once built).
   - What stays: the copies at your new provider, and your old account, which Ownpace never
     changed.
   - What you remove yourself: app passwords, and the Microsoft or Dropbox permission. The close
     answer names each one (`outlivingAccess`, built by `accessThatOutlivesErasure`).
   - What happens at the end of the alpha is 0131 T4's decision, and the guide says it once it is
     decided.

**The short form.** Before the first invitation, sections 1, 2, 5 and 6 are enough, together with
section 3's first sentence. Sections 3 and 4 grow as T2 and the first testers' screens arrive.

**Guard.** A case in `site/site.unit.test.ts`, which fails today because neither page exists:

- with the alpha setting, the build writes both files;
- the Dutch page carries the six section ids;
- every link on it resolves to a file the build writes or to a route in `AppRoutes.tsx`;
- neither page appears in the nav;
- without the setting, neither file is written.

### T2 — a known-limitations page the feature matrix keeps true (proposed; after)

**Why a copy and not an import.** `site/` imports nothing from the workspace. Its prices are a
copy that a guard holds to ADR-0014 (`site/prices.mjs`:3-16), so the public pages can be moved
later without a migration. This page follows the same pattern. "Generated from the matrix" means
here that the matrix and 0131 T2's verdicts decide *which* entries the page has, and a guard
fails when the two disagree. The Dutch sentences are written by hand, once per entry, because the
matrix is English and written for developers.

**The data.** `site/limitations.mjs` holds one entry per limitation:

- `kind`: `experimental`, `gap` or `alpha`;
- `nl` and `en`, a plain sentence each, with the Dutch required;
- for a `gap`, `matrixRow`: the opening words of its row in *"The open gaps, in one place"*;
- for an `experimental` entry, the source kind and face it describes.

A matrix row that is no limitation to a tester, such as the per-domain throttle limiters, gets
an entry with `notForTesters` and a reason instead of text.

**The page.** `/known-limitations.html` and `/nl/bekende-beperkingen.html`, built in every site
build, in three parts:

- *Experimenteel*: what the label marks (D4);
- *Wat (nog) niet mee kan*: the open gaps;
- *Goed om te weten in de alfa*, only in the alpha build. It covers Google asking again after
  about a week (0140), no backups (0134), in-app browsers (0140 T3), the permission a provider's
  screen describes (T3), a destination that was not empty (T5), and the export archive on managed
  (0131 T2, open question 4). It also says that a cutover cannot be undone from the screen: the
  only way back is a command the owner runs (`rollback`, `apps/worker/src/cli/index.ts`:97).
  Whether that command reaches a managed tenant was not checked here, and it is checked before
  the sentence is written.

  The same part carries the lines 0141 and 0143 hand to this page, each in the owner's number or
  words once they are set:
  - the largest file a pass copies, and that a larger one is refused with a sentence and left to
    copy by hand (0143 T4, with 0143 T0's number);
  - how many days the first copy of a Gmail mailbox takes at Google's daily download limit
    (0143 §1's table);
  - that a file over 8 MB does not yet reach a JMAP target, and a WebDAV target takes it
    (0143 T3, until T3b lands);
  - with a large Microsoft 365 mailbox, that calendars, contacts and files may wait for the
    mail's first copy (0143 T5, until it lands);
  - that Dropbox Business team folders were left out of the build and have not been tried
    (0141 T3; 0055 T3(c) calls them *"untouched"*).

  Each of these is an `alpha` entry, and it leaves the page in the pull request that removes the
  limit.

The guide (T1) links to it. So can the *why* of 0131 T2's hint, which today names no page; that
is proposed here for 0131 to take up once the page exists.

**Guard.** `scripts/a-limitation-the-tester-can-read.unit.test.ts` fails today, because neither
the data nor the page exists:

- every row of the matrix's open-gaps table matches exactly one entry, and every `gap` entry
  matches a row;
- every *experimental* verdict in 0131 T2's table has an entry, and no entry names a *proven*
  one (the test imports the table; only the site build may not);
- every entry has non-empty Dutch and English;
- the site build writes both pages.

When a live proof recorded under 0141 T1 moves a face to proven, this guard makes the same pull
request remove the entry.

### T3 — "read-only" replaced by what is true (proposed; the site copy is the owner's)

**The sentence everything follows.** Ownpace never writes to the account a person is leaving.
Where the provider has a read-only permission that works for the connection, that is the one it
asks for. Where it does not, the permission the provider's screen describes is broader than what
the software does, and the page says so before the person continues. The privacy draft already
says this (§1).

**The grant page (before the first invitation if testers send grant links, 0140 open question 2;
otherwise after).** 0145 T6 draws the same line for its grant half.

- The grant subject gains `readOnlyAtProvider`, computed in `grant-link-readiness.ts` from the
  scopes asked. It is true only when every data scope is one Google enforces as read-only. Today
  those are `drive.readonly` and `tasks.readonly`. A list beside `GOOGLE_SCOPES_ASKED_BY_DOMAIN`
  in `account-qualification.ts` holds them, and the sign-in scopes are left out of the
  comparison.
- When it is true, the box keeps today's `grant.readOnly`, which is then accurate.
- When it is false, the box shows a new `grant.readsOnly`:
  - NL: *"Ownpace leest alleen. Ownpace verwijdert of wijzigt nooit iets in uw account, en
    niemand — niet de organisatie, niet Ownpace — ziet ooit uw wachtwoord. U logt zelf in bij
    Google, op de pagina van Google zelf. Google kan de toestemming ruimer omschrijven: voor
    e-mail, agenda's en contacten staat de toestemming die Ownpace vraagt ook wijzigingen toe.
    Ownpace doet er geen."*
  - EN: *"Ownpace only reads. Ownpace never deletes or changes anything in your account, and
    nobody — not the organisation, not Ownpace — ever sees your password. You sign in to Google
    yourself, on Google's own page. Google may describe the permission more broadly: for mail,
    calendars and contacts, the permission Ownpace asks for also allows changes. Ownpace makes
    none."*
- `docs/grant-links.md`:72 says the same in the same PR. The privacy and terms links on this page
  have pointed at the addresses the site publishes since #1137 (merged 2026-09-24; `LEGAL` in
  `Grant.tsx`:70-79). This task changes a different part of the same page. 0145 T6 changes the
  "what will be read" sentence just above the box (:183), so the two changes are laid out
  together.

**One line beside *Connect with Google* (before the first invitation).** In
`ProviderConsentPanel`, for a Google kind whose ticked types include mail, calendar or contacts,
and for the `gmail`, `google-calendar` and `google-contacts` cards:

- NL: *"Voor e-mail, agenda's en contacten beschrijft Google een ruimere toestemming dan Ownpace
  gebruikt. Ownpace leest alleen; het wijzigt en verwijdert niets in dit account."*
- EN: *"For mail, calendars and contacts, Google describes a broader permission than Ownpace
  uses. Ownpace only reads; it changes and deletes nothing in this account."*

0140 T3's line about in-app browsers and 0139 T4's links go in the same place, and the three are
laid out together. Microsoft's delegated scopes are read-only, so *Connect with Microsoft* needs
no line. Dropbox asks for whatever its app carries, and 0140 T7 narrows that.

**The site (before the first invitation, T0 approves).**

- `copy.mjs`:75, NL :220:
  - EN: *"Ever. Your old account is your fallback, and it stays intact whatever happens. Ownpace
    only reads from it: the software has no code that changes, moves or deletes anything at a
    source, and the code is open source, so you can check. The permission your provider's screen
    describes can be broader than that — for Gmail, Google Calendar and Google Contacts it is —
    and we say so before you connect."*
  - NL: *"Nooit. Uw oude account is uw vangnet en blijft intact, wat er ook gebeurt. Ownpace
    leest er alleen uit: de software heeft geen code die bij een bron iets wijzigt, verplaatst of
    verwijdert, en de code is open source, dus u kunt het nakijken. De toestemming die het scherm
    van uw aanbieder beschrijft, kan ruimer zijn — bij Gmail, Google Agenda en Google Contacten is
    dat zo — en dat zeggen we voordat u koppelt."*
- `copy.mjs`:85, NL :230:
  - EN: *"Data flows old → new. Ownpace never writes to your old account, which is what keeps it a
    safe place to fall back to."*
  - NL: *"Gegevens gaan van oud naar nieuw. Ownpace schrijft nooit naar uw oude account, en juist
    daarom blijft het een veilige plek om op terug te vallen."*
- how-it-works §2, and its Dutch twin:
  - The heading becomes *"Connect the account you are leaving — Ownpace only reads"* / *"Koppel het
    account dat u verlaat — Ownpace leest alleen"*.
  - The body says what the software does, which providers have a read-only permission that works
    (Microsoft 365 through *Connect with Microsoft*, Google Drive, Google Tasks), and which do not
    (Gmail, Google Calendar and Google Contacts, and any account connected with a password). For
    those, *"the guarantee is the software's"* / *"ligt de garantie bij de software"*.

**After.**

- The setup step's title (`strings.ts`:2078, :3833) loses "read-only": *"Consent a refresh token
  for that product"* / *"Laat een refresh-token voor dat product toestemmen"*.
- The source password field gets a hint, `wizard.sourcePassword.hint`, in 0140 T9's words for
  Apple: a password opens the whole account, and read-only is a property of the software, not of
  the password.

**One legal sentence, for 0139.** Terms §2's *"approve item by item"* (§1) goes on 0139 T1's list
for the lawyer's pass. The review's suggested wording: *"Removal at the target only happens
through a path you switch on: item by item, or, for the old copies of files you moved,
automatically if you choose that separately."* This plan does not edit legal text.

**Guards.** Each fails today:

- `grant-link-readiness.unit.test.ts` gains cases: a `gmail` link and an account link with
  calendar and contacts give `readOnlyAtProvider: false`; `google_drive`, and an account link with
  tasks only, give `true`.
- `apps/web/src/a-permission-described-as-it-is.unit.test.tsx`:
  - with the flag false, the grant page shows the broader sentence in Dutch and English, and the
    box does not open with *"Read-only"* / *"Alleen lezen"*;
  - with it true, it does;
  - the Connect panel shows the line for a Google account with calendar ticked, and not for Drive
    alone.
- `scripts/a-read-only-claim-with-its-scope.unit.test.ts`: in how-it-works (both languages),
  `docs/grant-links.md` and the named setup strings, "read-only", "alleen-lezen" and "alleen
  lezen" occur only in a sentence that also names Drive, Tasks or Microsoft. Today it fails on
  how-it-works, `grant-links.md`:72 and `strings.ts`:2078 and :3833.

### T4 — the warning says what the check does (proposed; after)

**The words.** They stay one source for both editions (ADR-0026), in both languages. The gate
that is conditional is stated with its condition:

- EN: *"… Every removal still has to pass every gate — positive evidence only (never an inferred
  absence), only items this tool wrote, and the mass-deletion breaker. A file, calendar entry or
  contact is also refused when the new system reports it changed since this tool wrote it. That
  check needs a version the new system gave when the copy was written; where it gave none, or
  cannot be asked, the removal goes ahead. Mail has no such version. While this is off, nothing
  can be removed however the endpoint is called."*
- NL: *"… Elke verwijdering moet nog steeds elke controle doorstaan — uitsluitend positief bewijs
  (nooit een afgeleide afwezigheid), alleen items die dit programma zelf schreef, en de
  massaverwijderings-stroomonderbreker. Een bestand, agenda-item of contact wordt bovendien niet
  verwijderd als het nieuwe systeem meldt dat het is gewijzigd sinds dit programma het schreef.
  Die controle heeft een versie nodig die het nieuwe systeem bij het schrijven gaf; waar die er
  niet is of niet kan worden opgevraagd, gaat de verwijdering door. E-mail heeft zo'n versie
  niet. Zolang dit uit staat, kan er niets worden verwijderd, hoe het eindpunt ook wordt
  aangeroepen."*

The opening sentence, up to *"… following a deletion the owner made on the old one"* (*"… in het
oude systeem deed"*), is unchanged.

**The comment.** `apply-deletion.ts`:42-45 is corrected: for DAV the check is a HEAD before the
DELETE, not a condition on it. Sending `If-Match`, and refusing a removal that has no recorded
version, is W18, now 0149 T3, which also takes over this correction (0149 T6). When W18 lands,
the warning can drop its condition, and the guard below says so.

**2026-09-24, after 0149.** 0149 T1 to T3 are in its alpha minimum (0149 D1), so the condition
drafted above, *"where it gave none, or cannot be asked, the removal goes ahead"*, is false before
the first invitation. T4 is therefore written after 0149 T3 lands, and describes the refusal
instead (0149 T6). Until T4 lands, the warning keeps its present words; 0149 T6 says which of
them hold once 0149 T1 to T3 have landed. The guide says what the switch does (T1). The switch is
off by default (§1).

**Guard.** `scripts/a-warning-the-check-keeps.unit.test.ts` fails today. It reads
`packages/core/src/apply-deletion.ts`. While removal passes a version only when one was recorded
(the `row.targetVersion !== undefined ?` form), `APPLY_FLAG_WARNING` and `APPLY_FLAG_WARNING_NL`
must not contain *"never a copy somebody has since edited"* or its Dutch, and must carry the
condition in both languages. When the condition disappears from the code, the test fails with a
message that asks for the warning to be reconsidered. 0149 T3 leaves that form in core, because
the refusal is the writers', so a guard written after 0149 T3 keys on the writers' refusal
instead (0149 T6).

### T5 — a destination that is not empty (proposed; the advice before, the screen after)

**The advice** is in T1's section 2, before anybody connects: for the alpha, use a new, empty
account at the new provider, or at least one where the same data was not already imported by
hand, or set a target folder for mail and files.

**The confirm screen (after).**

- **Later, too.** `discovery.colliding.post` gains the consequence of adoption:
  - EN: *"… and not overwrite it, now or later: a change to that item in your old account is not
    copied over it."*
  - NL: *"… en overschrijven die niet, nu niet en later niet: een wijziging van dat item in uw
    oude account wordt er niet overheen gekopieerd."*
- **An IMAP target.** `DiscoveryCounts` learns the target's kind; today it is not passed
  (`DiscoveryCounts.tsx`:72-86). `ConfirmMigration.tsx` already loads the mapping, whose record
  carries `targetType` (`MappingSchema`, `mapping-service.ts`:257). Whether the appliance's
  `pages/Confirm.tsx`, which reads the status list, has it too is checked when the task starts.
  For an IMAP target, or a Soverin account's mail, the sentence adds:
  - EN: *"On this destination a message is recognised only in the folder it is copied to: one you
    keep in another folder arrives a second time."*
  - NL: *"Op deze bestemming wordt een bericht alleen herkend in de map waarheen het wordt
    gekopieerd: een bericht dat u in een andere map bewaart, komt nog een keer binnen."*

  Whether the IMAP writer should instead adopt across the whole account, as JMAP does, is open
  question 4. That would change what gets written, so it is not decided here.

**Guard.** `apps/web/src/components/confirm/a-destination-that-was-not-empty.unit.test.tsx` fails
today. With colliding items, the sentence says *later* in both languages. With an IMAP target it
adds the folder sentence, and with a JMAP target it does not.

### T6 — a person to write to, before and after sign-in (proposed; before the first invitation)

**The address, as a build setting.** The pages outside the app have no session, so the address
cannot come from the API. It is a web build argument, working name `VITE_SUPPORT_EMAIL`, which
`managed.yml` passes to the web build as it passes `VITE_OIDC_ISSUER`. Its value comes from
`ownpace-live`'s `.env`, and T0 chooses it. When it is unset, nothing below is shown, just as the
report link is hidden when it could reach nobody.

**Before sign-in.** One line on `/login`, `/request-access`, `/auth/callback` (both the
no-organisation state and the failed state) and `/invitations`:

- NL: *"Komt u er niet uit? Mail naar {address} en noem de pagina waarop u bent. Stuur nooit een
  wachtwoord."*
- EN: *"Stuck? Mail {address} and name the page you are on. Never send a password."*

**After sign-in.** When the report form is not available and the address is set, the sidebar
shows *"Hulp: {address}"* where *Report a problem* would be. A signed-in tester then always has
one of the two.

**The report form's settings reach the API: done on this plan's branch.** `managed.yml` passes
`ZAMMAD_URL`, `ZAMMAD_TOKEN` and `ZAMMAD_GROUP` to the `api` service, empty by default, so that
step 8f of the bring-up does what it says, and
`scripts/a-helpdesk-the-api-was-never-handed.unit.test.ts` fails without it (§1). It is not on
`main` until the branch merges. 0131 T5's row for 0130 then has a way to become true, once a
Zammad is configured for `ownpace-live` (0139 T0 fact 3); until then the address above is the
tester's way to a person.

**The GitHub chooser.**

- A first contact link in `config.yml`, in English and Dutch: *"Using the hosted Ownpace alpha? /
  Gebruikt u de Ownpace-alfa?"*. Its `about` says: do not open an issue here; use *Report a
  problem* in the app or the address in the tester guide; never post mailbox contents, addresses
  or screenshots of your data. Its URL is T1's *Hulp* section, on the site that publishes the
  alpha's texts (0139 T10).
- `bug_report.yml`'s opening block gains one sentence to the same effect.
- The security and self-host links stay as they are.
- `blank_issues_enabled` is left alone, because developers use it (D6).

**Guards.** Each fails today:

- `apps/web/src/pages/a-person-before-sign-in.unit.test.tsx`: with the setting stubbed, the four
  pages render a `mailto:` link in both languages, and so does the layout when reporting is
  unavailable. Without the setting, none of them does.
- A case in `scripts/a-helpdesk-the-api-was-never-handed.unit.test.ts`, which already holds the
  report form's three settings: `managed.yml` passes `VITE_SUPPORT_EMAIL` among the web build's
  arguments.
- `scripts/an-issue-route-for-the-hosted-service.unit.test.ts`: the first contact link's URL is
  not on github.com, and its `about` carries the warning in both languages. `bug_report.yml`'s
  opening names the hosted service.

### T7 — *Request access* on the sign-in page (proposed; before the first invitation)

Under the sign-in button in `Login.tsx`, one link:

- NL: *"Nog geen account? Vraag toegang aan."*
- EN: *"No account yet? Request access."*

It goes to `/request-access?locale=<the reader's language>`. The request page has read `?locale=`
since #1137 (merged 2026-09-24). Both routes are managed only (`AppRoutes.tsx`:137-166), so the
appliance never sees the link. The identity provider's own registration page, and accounts that
nobody let in, are 0135's (T5, T8).

**Guard.** `apps/web/src/pages/a-door-from-the-sign-in-page.unit.test.tsx` fails today. With an
issuer, `Login` renders a link to `/request-access?locale=nl` in Dutch and
`/request-access?locale=en` in English.

### T8 — an owner can close their organisation from the screen (proposed; after)

**Where.** A last section on `Tenants.tsx`, *Organisatie sluiten* / *Close this organisation*.
It is shown to the owner only, on the managed edition only. The route is owner-only already
(`requireRole('owner')`).

**What it does.**

1. **The window.** The owner chooses 0, 7, 30 or 90 days from `CLOSE_WINDOWS_DAYS`. Each choice
   says what it means. For 0, that is *"as soon as the purge next runs, and cannot be undone"*,
   the route's own words.
2. **Arming.** The button arms first, as *apply deletions* and auto-apply already do. For a 0-day
   window, the owner also types the organisation's name.
3. **The answer.** After the POST, the screen shows the route's answer in the reader's language:
   the erasure sentence (which 0134 T1 makes say there are no backups), the access that outlives
   erasure with where to remove it, what erasure never touches, and until when it can be
   reopened.
4. **Reopen.** While the window is open, the same section offers *Heropenen* / *Reopen*, which
   calls the existing route.

**A read for the closed state.** `GET /api/tenants/:tenantId/closure`, managed only, reads
`tenant_closure` under the tenant's context. It answers `{ closed: false }`, or the dates, the
window and the erasure sentence rebuilt from the row. Every member of a closed organisation then
sees one line at the top: the date of erasure, and that the owner can reopen until then.

**What it must not say.** The screen shows the route's own sentences, with 0134 T1's change. It
says nothing yet about the sign-in account at the identity provider, which erasure does not reach
today (0139 §1). That line waits for 0135 T8's step and 0139 T7's wording.

**During the alpha** the path is 0139 T7's operator command, and the guide (T1) says so. Whether
the screen should come before the first invitation instead is open question 5.

**Guards.** Each fails today:

- `apps/web/src/pages/an-organisation-its-owner-can-close.unit.test.tsx`: an owner sees the
  section, and an admin, a member and a viewer do not. The POST carries the chosen window and
  only after arming. The answer's Dutch renders for a Dutch reader. Reopen appears only while
  `canReopenUntil` is in the future.
- `apps/api/src/routes/tenants/a-closure-the-screen-can-read.integration.test.ts`: after a close,
  the read answers the same dates as the close did, and before it, `closed: false`. Another
  tenant's closure is never visible.

## 4. Order

**Before the first invitation**, in this order:

1. T0's address.
2. T6 and T7 in one web PR, with the chooser. The compose change for the report form is already
   on this plan's branch.
3. T3's Connect line and site copy, once T0 approves the copy, and its grant page if testers send
   grant links (0140 open question 2).
4. T1's short form, last, because it points at all of the above and at 0131 T1, 0139 T2 and
   0140 T2 and T3.

**After:** T2 as soon as 0131 T2's table exists. Then T4 and T5's screen changes, one PR each.
T8 when the owner chooses, and before the paid service, since terms §11 promises a close *"at any
time"*.

Each code task is its own PR with its guard. The site copy changes only in a PR the owner
approves.

## Not in this plan

- The alpha note, the "experimental" label and the Billing sentence: 0131 T1 to T3.
- The conditions, acceptance, notices where data is collected, the operator's close command and
  the identity provider's account after a close: 0139 (T2, T3, T4, T7). Terms §2's *"item by
  item"* goes to 0139 T1's list. The erasure sentence's word on backups: 0134 T1.
- Google's steps for a tester, and the in-app browser line: 0140 T2 and T3. The guide carries
  them.
- The live runs that take a label off, and `calendar.readonly` on CalDAV (question zero): 0141
  (T6 for question zero).
- The limits behind the capacity lines T2 carries (the largest file, Gmail's daily limit, JMAP
  files, the order of data types), and the owner asking about sizes when granting: 0143.
- Who reads the support address, and the mail relay: 0133.
- Phones and screen readers, the grant page's "what will be read" sentence, and the guide's
  accessibility paragraph: 0145 (T6, T9). A build name a tester can quote: 0146.
- The report form itself: 0130, built.
- In-app guides written for customers, in Dutch: W15, now 0148, *A guide written for the person
  using it*. The line in the site guide that points at *Handleidingen* is proposed there for T1.
- Removal that fails closed: `If-Match` on a DAV DELETE, a row recorded as copied after a 412, and
  IMAP opened with EXAMINE. That is W18, now 0149, *Removal fails closed, and reads stay reads*.

## Open questions

1. **The address (T0, T6).** `support@ownpace.eu`, which the site already shows, or another
   address? And does a person read it during the alpha (0133 open question 3)? The chooser in a
   public repository will show it as well.
2. **The site copy (T3).** Approve the drafts, rewrite them, or keep today's text? The one
   sentence that must go in any case is how-it-works' *"The connection is **read-only**"*.
3. **Apply deletions during the alpha.** (a) Testers leave it off until T4 lands, and the guide
   says so. *Recommended.* (b) T4 goes in before the first invitation, and testers may try it.
   *Answered 2026-09-24, by 0149 D1: testers may use it.* The owner: *"But we do offer 'apply
   deletions'."* Neither option as written: removal fails closed before the first invitation
   (0149 T1 to T3), and T4's words follow once 0149 T3 has landed (0149 T6).
4. **An IMAP destination (T5).** (a) The confirm screen says it, and nothing else changes.
   *Recommended for the alpha.* (b) Discovery counts per folder for an IMAP target, so that the
   screen promises only what happens. (c) The IMAP writer adopts across the whole account, as
   JMAP does. (c) changes what is written and costs a lookup across every folder, so it is for
   after the alpha, if at all.
5. **The close screen (T8).** After the alpha, with 0139 T7's command as the alpha's path
   (*recommended*), or before the first invitation?
6. **The calendar permission.** Who runs the runbook's question zero, and when? If Google's
   CalDAV accepts `calendar.readonly`, the calendar asks for less, T3's sentences name one
   product fewer, and 0141 records it.
