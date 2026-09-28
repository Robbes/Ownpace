# Workplan 0139 — The legal gate for the alpha

> **In one line:** Legal gate for the alpha: `site/legal` placeholders filled and published, a lawyer's pass, alpha conditions, acceptance recorded at first sign-in, notices where data is collected, sub-processors, retention, account closure, breach procedure, `SECURITY.md`.

## Status — 2026-09-28 (update this block at the end of every session)

**2026-09-28, last: the owner set the copy's days and the admin clause follows the code.** The
owner: *"7 days is ok"*. `«UPDATE_COPY_DAYS»` is 7 in §6 of both files, and its row in the legal
README is gone; two placeholders are left, `«ALPHA_NOTICE_PERIOD»` (open question 7) and
`«ACCOUNT_CLOSE_PERIOD»`. §8's last clause now says what an admin cannot do as 0137 T7 found it in
the code, the Team page's line: *"behalve de organisatie sluiten of heropenen, het toepassen van
verwijderingen of het automatisch toepassen van verplaatsingen aan- of uitzetten, en iemand
eigenaar maken"* / *"except close or reopen the organisation, turn applying deletions or
auto-applying relocations on or off, and make somebody an owner"*. 0137 §3 T0's source sentence
is that plan's, and its branch carries the same words; this branch no longer edits 0137.

**2026-09-28, later still: review fixes to T2, on the same branch.** Twelve findings, one of
them blocking, all taken. On three, the draft now says one thing for the owner to confirm:
§10's credentials after closing, §11's rule for a tester who does not accept the new conditions,
and terms §11's export.

- **`--public --check` refuses what `--public` refuses** (the blocking one). It never read the
  version lines: on a copy of `site/` with every placeholder filled, it exited 0 with
  `0 unfilled placeholder(s)`, and `--public` then threw. The entry below says nothing in
  `deploy/` or `.github/` runs the build with `--public`. That is true on this branch, but the
  site step built beside it (branch
  `claude/ownpace-public-readiness-y7orc6-the-site-deployed-with-live`, not merged) does:
  `deploy-live.sh`'s `site_ready` runs `--public --check` through `site_test_build` before
  anything moves and reads that count, and `site_up` runs `--public` after live has moved. With
  both merged, a deploy would have moved live and applied its migrations before the site refused.
  Now `--check` prints `[site] N legal page(s) marked draft on their version line, or with none`,
  and under `--public` exits 1 with the build's refusal, naming each file. The placeholder count
  stays the last line, in its shape, so `site_test_build`'s pattern still reads it, and the exit
  makes `site_ready` refuse with the refusal among the last lines it prints. That branch's
  bring-up step 1 (*"its last line must say `0 unfilled placeholder(s)`"*) stays true. It should
  also say the command exits 0, which is that branch's text to change.
- **The refusal reads every `legal/` entry of `SOURCE`**, as its comment said, not only those in
  `PAGE_KEYS`. T10 may render the conditions outside the nav, as the 404 page is.
- **`DRAFT_WORDS` gains *ontwerp* and *voorlopig*.** `VERSION_LINE`, `DRAFT_WORDS` and
  `versionLineOf` are exported. `scripts/legal-docs.unit.test.ts` reads each version line through
  `versionLineOf`, in a child process, instead of keeping a copy of the pattern.
- **Proved.** `site/site.unit.test.ts`'s block has 18 cases, 8 more: a version line inside a
  comment above a final one is not read, and a final-looking one in a comment does not hide a
  draft line; *ontwerp* and *voorlopig*; a legal `SOURCE` entry outside `PAGE_KEYS` (the copy's
  `SOURCE` patched) is refused; `--public --check` refuses a draft line and passes a final one
  with the placeholder count last; `--check` without `--public` counts and passes; today's real
  texts fail `--public --check` too. Mutations, each killed: no comment stripping (1 case fails),
  `PAGE_KEYS` instead of `SOURCE` (1), no exit code under `--check` (2), without the two Dutch
  words (2). In `legal-docs`: the build not exporting `versionLineOf` (1), a Dutch version number
  that differs (1).
- **The texts.**
  - §2: the conditions prevail over the privacy policy as well as the terms, and name privacy
    §9's two points: the copy before an update (§6) and the *Credentials* row (§10). §4 keeps data
    *"no longer than the privacy policy and §6 and §10 here say"*.
  - §2: the export in terms §11 still applies if the service is discontinued, because no answer
    of the owner's drops it. The briefing's question 1 asks whether it should stay.
  - §6: the data can stay in the copy *"for up to 7 days"* (the number since set), and the Dutch says
    what a lost machine takes: *"de gegevens van de dienst en die kopie"*.
  - §8, Dutch: *verhuizing* throughout, and *"geef die persoon dan de rol beheerder"*. 0137 T0's
    source sentence is reworded the same way.
  - §9: Ownpace's app at Google is in Google's test phase, not the tester's connection (0140).
  - §10: the access is kept until the tester deletes the connection or the migration. After
    closing nothing uses it, and it is destroyed when the data is erased, at the end of the
    chosen window. That is what the service does (`closeTenant` stops the service, and the purge
    destroys it), and it departs from the owner's *"keep until deleted or closes"* and from terms
    §11's *"On closure we delete your credentials"*. The briefing flags it for the owner. A new
    paragraph: at erasure the owner also deletes the sign-in account (T7, by hand until 0135 T8)
    and the Google test-user entry (0131 T4), and the access request is erased with the data
    (0131 §1).
  - §11 follows 0131 open question 1 (b) as it reads, *"new conditions are accepted first"*:
    migrations carry on under them only once accepted. A tester who has not accepted them by the
    day they take effect is closed as in §10, before any of their data goes to another hosting
    provider. That last rule is the drafter's; deemed acceptance under terms §12 is the
    alternative. The briefing says so.
- **One wording for the copy.** The decisions branch
  (`claude/ownpace-public-readiness-y7orc6-the-owners-answers-of-28-september`, not merged)
  drafts its own sentence for the copy in 0134 T2. 0134 T2 now says §6 is the text, so when both
  merge, that sentence gives way to §6.
- **What `--public` needs, said where it is described:** T10 below, and its row, where (c),
  `--no-drafts`, is marked not needed (open question 1 (a)); `docs/google-oauth-verification.md`
  (the home-page row and step 3); `site/legal/README.md`, which now says what a final version
  line looks like; and `docs/managed-bring-up.md`, for `--check`.
- **Not in this change, and needed before the conditions go out:**
  - §6's copy. The dump before a deploy is taken by hand today (`deploy-live.sh` only suggests it
    under `--dry-run`), and nothing removes it, so *"never longer than 7 days"*
    has nothing behind it yet. 0132 T6 step 4's dump, with its automatic removal after that many
    days, comes first.
  - §8's *"a person can only be an owner or an admin"* is true once 0137 T7 is merged (branch
    `claude/ownpace-public-readiness-y7orc6-an-owner-or-an-admin-for-the-alpha`, not merged). That
    branch also corrects the last clause of 0137 T0's sentence against the code, and §8 takes it
    when both are merged.
- **For the owner:** is *"i think that might be more safe to do make a backup?"* a yes to 0134's
  (b)? Then §10 (credentials destroyed at erasure, not at closing), §11 (closing a tester who has
  not accepted), and whether the alpha keeps terms §11's export.

**2026-09-28, later: T2 drafted, at the owner's word, as version 0.1**, on branch
`claude/ownpace-public-readiness-y7orc6-alpha-conditions-in-concept`, not merged. This plan said
the owner writes the text. The owner, the same day: *"5. The alpha conditions (0139 T2): i want to
review it, where can i read it? and yes, also make the draft"*.

- **Where to read it.** `site/legal/alpha.nl.md`, the Dutch that testers read first, and
  `site/legal/alpha.md`. Both say *Versie: 0.1 (concept voor juridische toetsing — nog niet
  gepubliceerd …)* / *Version: 0.1 (draft for legal review — not yet published …)*. The site build
  does not render them (`SOURCE` is unchanged), and the app does not link them
  (`legal-links.ts` still names `conditions` in `NOT_BUILT_YET`). Rendering them is T10's.
- **What it says.** T2's ten points in twelve short sections, as an addendum to the terms. It
  lists what does not apply during the alpha, checked in `terms.md` and `terms.nl.md` (both
  v1.2): §6 (prices), §7 (withdrawal), §8 (billing), §15 (the withdrawal form) and §11's second
  paragraph (30 days' notice, and 90 days with an export). It reuses the sentences already
  drafted: 0134 T2's paragraph on backups, 0137 T0's on inviting others, 0131 T2's label and 0144
  T1's help section. The Dutch follows the glossary (*alfa*, *in rekening gebracht*,
  *Opnieuw verbinden*).
- **The owner's answers of 2026-09-28 it rests on**, verbatim:
  - the end of the alpha (0131 open question 1 (b)): *"End of aplha: we continue, perhapse move
    off the spark to other hoster."* The service carries on under new conditions, perhaps at
    another hosting provider. Testers are told in advance, with the new conditions and where the
    data would go, and may close their account instead (§11);
  - *"tester: households only for now."* (open question 6, below; §1);
  - *"stored access after finished migration: keep until deleted or closes."* (open question 3
    (a), below; §10);
  - *"database copy before live deployment: i think that might be more safe to do make a
    backup?"* (0134 open question 1 (b)): one copy of the databases right before each update,
    kept only to undo a failed update, until the next update succeeds and at most
    7 days (§6), the number the owner set the same day: *"7 days is ok"*;
  - *"mail at the start: real mail relay day one."*: sign-in codes and access decisions come from
    `support@ownpace.eu` through a real relay from the first day (§12);
  - *"public site: yes, search engine index."* (open question 1 (a), below);
  - 0137 T0 answered (b): the tester invites nobody, a progress link is for watchers, anyone
    invited is an owner or an admin, and the tester answers for whom they invite (§8).
- **Three new placeholders**, in the legal README's table: `«ALPHA_NOTICE_PERIOD»` (open
  question 7, not answered), `«UPDATE_COPY_DAYS»` (0134's answer named no number) and
  `«ACCOUNT_CLOSE_PERIOD»` (T7's stated number of days).
- **For the lawyer.** The comment at the top of `alpha.md` holds T1's questions 1 and 2, in the
  form of the briefings in `privacy.md` and `terms.md`, and what else the draft rests on:
  households only, so no data-processing agreement; privacy §9's credentials row, which open
  question 3 (a) changes; and the copy before an update.
- **A draft cannot be published by accident.** `site/build.mjs` now refuses a `--public` build
  while a legal page it renders says *draft*, *concept*, *not yet published* or *nog niet
  gepubliceerd* on its *Version* line, in any case, or has no such line. The message names each
  file and its line. A build without `--public` still works. Privacy and terms say those words
  today, so `--public` refuses them until the owner's final text, as intended. Nothing in
  `deploy/` or `.github/` runs the build with `--public` (the site step's branch does; see the
  review fixes above). In `scripts/`, only
  `the-test-site-sent-people-to-production` does: it imports the build with `--public` in a child
  process to read `rendered`. The refusal sits where the build writes, beside the placeholder
  refusal, so that test passes unchanged. `docs/managed-bring-up.md` says so.
- **Proved.**
  - `site/site.unit.test.ts`, 10 new cases, on a copy of `site/` with fixture legal files, in a
    child process. Without the build change, 7 fail: a draft version line names its file and writes
    nothing; each of the four words, in any case; no version line; today's real texts, their
    placeholders filled, are refused by name. The 3 controls pass either way: final lines build
    `--public`, the word elsewhere on the page is not a draft, and a test build from drafts still
    builds. Mutations: 5, all killed (no `/i`; the whole file read; no refusal without a version
    line; no refusal; `**Versie:**` not read).
  - `scripts/legal-docs.unit.test.ts`: `DOCS` gains `alpha.md` and `alpha.nl.md`, so their
    placeholders must be in the README and they name the support address. A new case checks a
    *Version* line in every document, the same number in both languages. The Dutch-translation
    case in `site.unit.test.ts` names `alpha`. With the two files absent, 4 cases fail.
- **Not in this change:** rendering them and T2's guard half that the build renders them (T10);
  T3. Three texts elsewhere now say less than the answers: privacy §9 (credentials, the copy), and
  0131 T1's note and the grant mail, *"nothing is backed up"* / *"er worden geen back-ups
  gemaakt"*, next to the copy before an update. 0134 T1's erasure sentence then quotes
  `«UPDATE_COPY_DAYS»` instead of 0. Those are 0131's, 0134's and the lawyer's pass.
- **For the owner:** read `alpha.nl.md` first. Then the three numbers, and open question 7.

**2026-09-28: T10 (b), the site's second copy (0131 §6, group R7, step 9)**, built on branch
`claude/ownpace-public-readiness-y7orc6-a-site-named-by-its-project`, not merged.

- **The names.** `www.yml` keeps `name: ownpace-www` as the default. Its `container_name` is now
  `${COMPOSE_PROJECT_NAME}`, so under the default the container is still `ownpace-www`. Compose
  5.1.1 gives the service the same configuration hash as on `main`, so the next `up -d` does not
  recreate the OTA site. A second copy names its own project with `-p` on every command, and its
  container and network follow. It sets its own `WWW_PORT` and `WWW_BIND` in its checkout's
  `.env`.
- **Why `-p` and not the `.env`.** `www.yml` reads the same `.env` as `managed.yml`. Live's
  `.env` will set `COMPOSE_PROJECT_NAME=ownpace-live` (0132 T1b, decided, not stood up yet), so in
  live's checkout a bare `docker compose -f deploy/compose/www.yml` would put the site in live's
  own project (checked with `docker compose config` against a stand-in `.env`). There each file sees the other's containers as orphans. Nothing in a
  compose file can refuse the bare command. `www.yml`'s header, the bring-up's section on the
  public site and `managed.env.example` say so.
- **A refusal nobody meant is gone.** On `main`, that bare command fails on a machine where the OTA
  site runs: the fixed `container_name` is the OTA site's own and is taken, the conflict 0132 T1
  names. Now the container takes live's project's name, so the command succeeds as soon as live's
  `.env` has a `WWW_PORT` of its own, which a copy from that checkout needs anyway (checked with
  `docker compose config`, not on a machine). That is the price of a second copy that can start.
  `www.yml`'s header and the bring-up say so.
- **Proved.** `scripts/two-stacks-on-one-box.unit.test.ts` gains a block for `www.yml`, 6 cases, 4
  of which fail on `main`: the fixed `container_name`, `ownpace-www` written in four places besides
  `name:` (the container name and three comments), the two copies sharing a container name, and no
  `-p` in the header. It renders the file under two projects and checks that they share no container
  name, network, volume or host port, that the OTA site's container is still `ownpace-www`, and that
  the header says the refusal above is gone. Four mutations fail it: no `container_name`, and a
  fixed network name, host port or volume name.
- **What addressed the container by name.** Nothing in `deploy/` or `scripts/` runs a command
  against it. The healthcheck asks `127.0.0.1` inside the container, and the status page's
  `Website` row asks `STATUS_SITE_URL`. The incident runbook's `Website` row now says that a copy
  brought up with `-p` takes the same `-p`.
- **T0's fact 6, supplied the same day:** the reference machine serves `www.ownpace.eu` during the
  alpha, so the second copy this makes possible is the one the alpha needs. The change is harmless to the OTA site whichever way it is
  answered: the site keeps its project and its container name.
- **For the owner, if fact 6 puts `www.ownpace.eu` on the reference machine:** knowing that a
  bare command in live's checkout is no longer refused, one of three: `-p` on every command for
  live's copy, and the name it takes; a directory and a `.env` of the site's own, so that a bare
  command is safe; or a check on live's side that refuses when live's project holds a `www`
  service. Then that copy's `WWW_PORT` and `WWW_BIND`, and the route from `www.ownpace.eu` to that
  port, as in 0132 T1e.

**2026-09-28: T10 (a), one setting for every link the app makes to the texts (0131 §6, group R1,
step 6)**, built on branch `claude/ownpace-public-readiness-y7orc6-a-policy-link-that-answers`,
not merged.

- **The setting.** `VITE_LEGAL_SITE_URL`, a build argument for the web app. `managed.yml` passes
  it to the web build as it passes `VITE_OIDC_ISSUER`, and `apps/web/Dockerfile` declares it.
  Empty is the production site, `https://www.ownpace.eu`, which the grant page linked before.
  `managed.env.example` documents it. A value that is not an http(s) origin alone is refused,
  and the error names the setting. The web build refuses it too (`vite.config.ts`), because the
  grant page reads it while it renders and the web app has no error boundary: a typo would
  otherwise blank the page for every recipient.
- **The module.** `apps/web/src/services/legal-links.ts` turns the setting into an address per
  page and per language, for the pages the site build writes: the privacy policy and the terms,
  in English and Dutch. The grant page reads it, and its own table is gone. The request form, the
  Connect panel and the report form link no text today, so nothing else moved. T4 adds their
  links from this module.
- **Not links yet.** The site build does not render the alpha conditions or `subprocessors.md`.
  Their text comes from T2 and T5, and T10 renders them. The module names both in
  `NOT_BUILT_YET` and gives them no address.
- **Proved.** `scripts/a-policy-link-that-answers.unit.test.ts`, 20 cases. On `main` all fail
  but one, the control that a good value builds. It runs the site build in a child process.
  Every address the module produces, from `legalLinks()` as the grant page reads it and from
  `legalUrl()`, with the setting empty and with the OTA site's value, is a file the build writes
  for that language and page, on the site the case expects. It fails when the build renders a
  legal page the module does not link. It checks `managed.yml`, the Dockerfile and the example,
  that the web build refuses `www.ota.ownpace.eu` and builds the OTA value, that the default is
  the address the site build calls itself (`PUBLIC_SITE_URL`), and that no other shipped file in
  the web app names the site or a legal file. `site/build.mjs` now exports `SOURCE` for it.
  `Grant.unit.test.tsx` passes unchanged: the default gives the addresses it pins.
- **`scripts/legal-docs.unit.test.ts`.** `DOCS` gains the Dutch privacy policy and terms. A new
  case holds the list to the build's `SOURCE`, and fails with the old list.
- **For the owner:** the OTA stack's `.env` sets
  `VITE_LEGAL_SITE_URL=https://www.ota.ownpace.eu`, and its web image is rebuilt. Live leaves it
  empty.
- **Not in this change, and still T10's:** rendering the alpha conditions (with T2) and
  `subprocessors.md` in the site build, which gives `«SUBPROCESSORS_URL»` an address; publishing
  the texts with `--public` at `www.ownpace.eu`, served where T0's fact 6 says; (b), `www.yml`'s
  fixed project name and container name (group R7, step 9); and (c), the `--no-drafts` switch,
  needed only if open question 1 chooses (b). 0135 T5's `IDP_PRIVACY_URL` and `IDP_TOS_URL` take
  the same addresses when that task is built.

**2026-09-27, late: T9 written (0131 §6, group M3, step 6, its second half)** on branch
`claude/mailbox-sync-errors-c2xsw2-one-way-to-report-a-vulnerability`, not merged, as the owner
decided it the same day (open question 5).

- **`SECURITY.md`** names the advisory form, then `support@ownpace.eu` for someone without a
  GitHub account, as the only two channels. It promises an acknowledgement within five working
  days, and no date for a fix. Its new **Scope** covers the code in both editions and the hosted
  service, `ownpace-live` at the `ownpace.eu` names and the test stack at `ota.ownpace.eu`. It
  says that testing against the hosted service needs the owner's permission first, and points at
  the two bring-up guides for a stack of one's own. **Supported versions:** `main`, and the release
  the hosted service runs.
- **`/.well-known/security.txt`** is written by the site build (`site/security-txt.mjs`). It has
  the same two `Contact` lines in the same order, `Expires` 180 days after the build,
  `Preferred-Languages: en, nl` and a `Policy` link. `Canonical` names `www.ownpace.eu` on a
  `--public` build only.
- **Proved.** `scripts/one-way-to-report-a-vulnerability.unit.test.ts`, 8 cases, 5 of which fail
  on `main`: the scope, the versions and the five days, and the two channels in order in
  `SECURITY.md` and in `security.txt`. It also checks that `Expires` is ahead and under a year,
  that `Canonical` is on the public build only, and that the build writes the file. Privacy §11,
  in both languages, names one of the channels.
- **Not in this change:** privacy §11 names only `support@ownpace.eu`. The texts are the
  lawyer's pass (T1), which the owner keeps as they are for now, and that pass adds the form; the
  guard then asks for both, in order.

**2026-09-27: T6's access requests built (0131 §6, group M3, step 2)**, merged as #1255. The
owner answered open question 2 with (a) the same day.

- **A declined request is deleted 30 days after its decision.** `pruneDeclinedAccessRequests`
  (`packages/managed/src/access-request-retention.ts`) deletes every request whose state is
  `declined` and whose `decided_at` is more than 30 days old. The nightly `managed-retention` task
  runs it over the owner connection and logs the count and the cutoff, never who.
- **What stays:** an open request, however old, because the owner answers every one; a granted
  one, which goes with its organisation when offboarding purges it.
- **0093's rule, for people, is unchanged.** `app_user` still has no DELETE on the table, so
  neither the operator nor anybody else can make a decision disappear. 0093's rule and the
  decline route's comment now say it ages out on a stated date.
- **Proved.**
  - `packages/managed/src/a-request-nobody-keeps-forever.unit.test.ts`, on PGlite with both chains.
    The plan names it as an integration test; it is a PGlite unit test like the other managed
    guards. A request declined 31 days ago goes, and 29 and exactly 30 days ago stay. An open one
    and a granted one, 90 days old, stay. `app_user` gets *permission denied* on DELETE.
  - `apps/worker/src/jobs/a-request-nobody-keeps-forever.unit.test.ts` reads the task body as
    text: it calls the prune, and its log line names only the count and the cutoff.
  - Both fail on `main`.
- **Not in this change:** privacy §4 and §9's row for access requests. The texts are the
  lawyer's pass (T1), and the owner keeps them as they are for now.

**2026-09-27, evening: the owner answered open questions 2 and 5, and keeps T0 and T1 as they
stand for now.**

- **Open question 2: (a)**, *"2a"*. A declined access request is deleted 30 days after the
  decision, in the managed retention job, as T6 proposes. It is M3's step 2, next.
- **Open question 5 and T9's two facts**, *"yes all three"*:
  - one channel: the GitHub advisory form, with `support@ownpace.eu` as the fallback for someone
    without a GitHub account;
  - a report is acknowledged within five working days, with no promise of when a fix lands;
  - supported: `main`, until there is a release line, and the release live runs.

  T9 is the second half of M3's step 6, after this one.
- **T0 and T1**, *"legal: keep as is for now"*. Nothing in them changes.

**2026-09-27: T8 (a) written (0131 §6, group M3, step 6)**, merged as #1241. `docs/breach-procedure.md`
is the procedure §3 names:

1. **Contain:** the hold, the passes already running cancelled in the Trigger.dev dashboard, a
   tester's own credential, and the nightly gate paused before it rebuilds the OTA stack.
2. **Keep the evidence:** `app_event`, `support_read`, `platform_pause`, the journal and the audit
   export, copied off the machine before they age out.
3. **Assess:** what data (the data-processing agreement's Annex A), whose, how, both stacks, and
   the risk.
4. **Notify the Autoriteit Persoonsgegevens** within 72 hours where feasible (Art. 33).
5. **Tell the testers** when the risk is high (Art. 34), with the message in Dutch and English. A
   business tester is told as the controller (the agreement's §7).
6. **Register every breach** (Art. 33(5)).

It adds one paragraph on keys: the stored credentials have no rotation (`SECURITY.md`). The
docs index lists the page. No code, so no guard, as §3 says.

- **Not in this change:** the record of processing and the light impact assessment, which the
  owner keeps outside this repository (T8's other two parts). T9 waits on open question 5 (the
  channel) and on the owner's response target and supported versions.

**2026-09-27: T7 (a) built (0131 §6, group M3, step 3)** on branch
`claude/mailbox-sync-errors-c2xsw2-an-account-a-tester-can-end`, merged as #1237. A tester who asks the
owner to end their account can now have it ended. The Close button needs the organisation's own
owner signed in, and the owner is not.

- **One function, two doors.** The Close button and `operator.sh close` both call `closeAccount`
  (`apps/api/src/close-account.ts`):
  - in one transaction, in the organisation's context: the kinds it connected, `closeTenant`, an
    audit row, and the passes in flight;
  - after the commit, the orchestrator asked to stop each of those passes;
  - then the dates and the sentences, in both languages.
- **`operator.sh close <tenant-id> <window-days> --by <subject> --reference <request>`**
  (`apps/api/src/scripts/operator-close.ts`):
  - the window is one of `CLOSE_WINDOWS_DAYS`;
  - `--by` must be an appointed operator's subject;
  - `--reference` names the tester's request.

  It prints what to tell the tester.
- **The audit row** is `tenant.closed`. It names the actor (the owner at the button, the operator
  at the machine), `via` (`screen` or `operator`), the window, and the operator's reference.
  `tenant_closure.closed_by` names the operator. The audit export keeps `windowDays` and
  `reference` (`AUDIT_DETAIL_FIELDS`).
- **Found and fixed: on managed, a close never stopped a pass in flight.** 0085 T8's
  `stopPassesInFlight` read `run` on the API's pool, as `app_user`, with no organisation set. `run`
  is under FORCE ROW LEVEL SECURITY, so that read saw no rows, or failed on the emptied setting and
  logged a warning. Either way the orchestrator was asked to stop nothing, and the purge's quiesce
  was the only backstop. The read is now in the organisation's own transaction.
- **The runbook's Tenant offboarding** says how to close a tester's account at the machine. It also
  gains the identity provider's account after the purge, removed by hand in the console until
  0135 T8's script exists.
- **Proved.** `apps/api/src/scripts/an-account-a-tester-can-end.unit.test.ts`, 16 cases, against
  PGlite. The button runs as `app_user` through the real route, and the command over the owner
  connection:
  - for the same organisation, window and moment, the command answers what the button answers;
  - the printed lines carry both dates and both languages;
  - the audit rows name the operator and the reference, or the owner and `screen`;
  - refusals: a window outside the list, or not a number; no subject; no reference; a flag
    without its value; something that is not a tenant id; an option it does not have;
  - a subject that is not an appointed operator's writes nothing, and an organisation that is not
    there says so;
  - the passes in flight:
    - each door stops its own organisation's pass and no other's;
    - as `app_user` with no organisation set, a read of `run` finds none, which is why the old
      close stopped none;
    - an orchestrator that does not answer never fails the close.
  - **Mutations:** 18, all killed:
    - the passes in flight: never asked to stop; one the orchestrator never took asked; every
      organisation's read; a queued one skipped; a finished one asked; an orchestrator that does
      not answer failing the close;
    - the audit row: missing, without the reference, or always `screen`;
    - the command: closing under another name, without the operator check, at any window, without
      a reference, with another retention or at another moment; the printout in English only;
    - the button: closing under nobody's name, or never asking the orchestrator.
- **Not in this change:** the self-serve screen (0144, W14 in 0131 §5), and 0135 T8's script.

**2026-09-27: T6's migration-delete revocation built** (0131 §6, group M3, step 1), merged as
#1229. §1 found that deleting a migration dropped our copy of the credential its own row holds
and revoked nothing. That credential is `source_secret_ref`, the token a person granted through a
grant link.

**2026-09-27: T6's task runner's stores checked (0131 §6, group M3, step 4)**, with 0134 T1 (c), on
branch `claude/mailbox-sync-errors-c2xsw2-what-the-task-runner-keeps`, not merged. The full finding
is in 0134's Status block. In short:

- **Trigger.dev's own database, `triggerdb`, can hold a tester's personal data.** A failed run's
  error, `run-discovery`'s output and, probably, the run's logs can name a tester's folders,
  files and mailboxes, and quote the provider's own words.
- **Nothing limits how long it is kept, and the erasure never reaches it.** The dumps of it are
  kept by count, not by age.
- **ClickHouse and MinIO probably hold none of it on this stack.** Trigger.dev's defaults put a
  run's small payloads, outputs and log events in `triggerdb`. 0134 lists the checks that settle
  it on live.
- **So this bullet of §3 is answered, and the texts cannot say how long yet.** What follows is
  0134's open question 3: keep the text out of Trigger.dev (recommended), stop the dumps and say
  how long the run history lives, or prune by age.

**2026-09-27: T6's migration-delete revocation built** (0131 §6, group M3, step 1) on branch
`claude/mailbox-sync-errors-c2xsw2-a-deleted-migration-revokes-its-grant`, not merged. §1 found
that deleting a migration dropped our copy of the credential its own row holds and revoked
nothing. That credential is `source_secret_ref`, the token a person granted through a grant link.

- **The delete now revokes it**, with `revokeCredentialRow`, as the connection delete does:
  after the delete, so nothing is revoked until the row is gone and no network call holds the
  tenant transaction open. The source connection's kind, read in the same transaction, decides
  how. Best effort: the answer carries `revocation`, and `failed` means the person withdraws it
  themselves. Only the row's own credential: the organisation's, on the connection, is never
  touched. A migration without one answers as before, with no `revocation`.
- **Proved.** `apps/api/src/routes/migrations/a-deleted-migration-revokes-its-grant.unit.test.ts`,
  against PGlite as `app_user` through the real route, with only Google's revocation endpoint
  stubbed. Deleting a migration that holds a granted token sends Google that token once, after
  the row is gone. The connection's credential is left as it was, and a migration without a
  credential of its own calls nobody. A migration that is not there, or is another
  organisation's, revokes nothing. Google not answering still deletes the migration, and the
  answer says the revocation failed. The two revoking cases fail on `main`.
- **Not in this change:** the screens do not show `revocation` after a migration delete yet;
  the rest of T6 waits on open questions 2 and 3.

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found that the
legal texts of the managed service are unpublished drafts with unfilled placeholders. It also
found that no screen shows them where a tester's data is collected, and that no tester accepts
anything. Several promises in the drafts are not what the code does. The owner answered that a
lawyer reads the texts before the first invitation, that the test is called an alpha, and that
the owner supplies the missing facts and updates the texts (§2). This plan is the single
checklist for that gate: the owner's facts (T0), the lawyer's pass (T1), the alpha conditions
(T2), the product changes that make the texts true where a tester meets them (T3, T4, T6, T7,
T10, T11), the names the texts owe (T5), the procedures behind them (T8), and the security
policy (T9).

It extends 0086 T5 and does not replace it. 0086 T5 still owns the legal surface for taking money:
the data-processing agreement for business customers and the paid journey (0086 T6). This plan
owns what must be true before the first tester is let in. Every legal sentence is the owner's to
write and the lawyer's to check. This plan names sections and never rewrites them.

Nothing in this plan is built. The grant page's links to the addresses the site build writes, in
the reader's language, and the legal README's list of those addresses are fixed in #1137, merged
2026-09-24 (`LEGAL` in `Grant.tsx`, and the README's table). Three drafts elsewhere feed this
plan: 0134 T2 drafts the paragraph on backups, 0131 T1 drafts the alpha note, and 0137 T0 drafts
the sentence on inviting others.

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137
merged.** Testers now use a second stack, `ownpace-live` (live), at the production names
(`app.ownpace.eu`, `id.ownpace.eu`, `status.ownpace.eu`), and the OTA stack stays CI's and the
demo's (D5). So the ingress T5 asks about is the one in front of the production names, the texts
are published on the production site at `www.ownpace.eu`, where the grant page already links
(T10, open question 1, now recommending the existing `--public` build), and T8's procedure no
longer starts by pausing the nightly gate, which never touches live.

| Task | Status | Notes |
|---|---|---|
| T0 The owner's facts: the placeholders and the names | ⏳ **Owner** (D1) | §3. Nine placeholder names are still open, and six facts have no placeholder yet. Values never go in this plan, only dates. |
| T1 A lawyer's pass before the first invitation | ⏳ **Owner**; 📋 **Decided 2026-09-24** (D1) | §3. The two existing briefings, plus the questions this plan adds. |
| T2 The alpha conditions, in Dutch and English | 🔨 **Drafted 2026-09-28** at the owner's word, on branch `claude/ownpace-public-readiness-y7orc6-alpha-conditions-in-concept`, **not merged**: `site/legal/alpha.nl.md` and `alpha.md`, version 0.1 concept, not rendered; ⏳ **Owner** reads it, then the lawyer (T1) — *was:* 📋 **Decided 2026-09-24** (D1, D2) | §3. Free, a few weeks, no obligations, no backups, no availability promise, how it ends. The owner wrote them in the plan; an agent drafted them at the owner's word. |
| T3 Acceptance recorded, with version and time, at first sign-in | 📋 **Proposed** | §3. A screen, one managed table, and no connection or migration before acceptance. |
| T4 A notice wherever a tester's data is collected | 📋 **Proposed** | §3. The request form, the identity provider's registration page (0135 T5), the Connect buttons, the report form. The grant page's addresses were fixed in #1137, merged 2026-09-24. |
| T5 The sub-processors named | ⏳ **Owner** for the names; 📋 **Proposed** for the text | §3. The ingress in front of the production names testers use (0132 T1e), the mail relay (0133 T5), the support channel (0130). |
| T6 What is kept, and for how long, made true | 🔨 **Credentials on delete built 2026-09-27**, merged as #1229; access requests 📋 **Decided 2026-09-27** (open question 2 (a)) and 🔨 **built 2026-09-27**, merged as #1255 (declined ones deleted 30 days after the decision); the rest 📋 **Proposed** | §3. Access requests, credentials, preflight counts, sign-in data, logs, the task runner's stores, run history. A code change or a wording change for each. |
| T7 A tester can end their account | 🔨 **(a) built 2026-09-27, merged as #1237**: `operator.sh close`, and the identity provider's account by hand until 0135 T8; *was:* 📋 **Proposed** | §3. An audited operator command for the close that exists without a screen, and the identity provider's account (0135 T8). |
| T8 A breach procedure, a record of processing, a light impact assessment | 🔨 **(a) the procedure written 2026-09-27**, merged as #1241: `docs/breach-procedure.md`; the record and the assessment are the owner's — *was:* 📋 **Proposed** | §3. One page in `docs/`, and two documents the owner keeps. |
| T9 SECURITY.md covers the hosted service, with one channel | ✅ **done** in #1257, merged 2026-09-27 (`12cb40fb`): `SECURITY.md`'s scope, versions and five days, and `security.txt` from the site build; privacy §11's form still goes with T1 — *was:* 🔨 **Written 2026-09-27, not merged**; 📋 **Decided 2026-09-27** (open question 5): the advisory form with `support@ownpace.eu` as fallback, five working days, `main` and live's release | §3. Scope, supported versions, a response target, `security.txt`. |
| T10 The texts published where a tester can read them, with no placeholder left | (a) the link module ✅ **done** in #1270, merged 2026-09-28 (`a8ed15b5`): `VITE_LEGAL_SITE_URL` and `legal-links.ts`, the grant page on it; (b) 🔨 **built 2026-09-28** on branch `claude/ownpace-public-readiness-y7orc6-a-site-named-by-its-project`, **not merged**: `www.yml`'s container is named after its project, and a second copy names its own with `-p`; still 📋 **Proposed**: rendering the conditions and `subprocessors.md`, and publishing with `--public` on the reference machine (T0 fact 6, answered 2026-09-28), which also waits for T1's final version lines (T2's refusal, 2026-09-28); (c) `--no-drafts` not needed, open question 1 answered (a) on 2026-09-28 — *was:* (a) 🔨 built 2026-09-28, not merged; (b) 📋 **Proposed**; 📋 **Proposed** | §3 and open question 1. The production site at `www.ownpace.eu`, from the `--public` build that already refuses placeholders and draft version lines, served where T0 says, and one setting for every link the app makes to them. |
| T11 A family member's permission, recorded | 📋 **Proposed**; waits on T1 | §3. Only if the lawyer confirms the household model the terms describe. |

## 1. What there is today

Each fact below was checked at the current checkout on 2026-09-24, unless it says otherwise.
The review's findings this plan carries are `wp-0086-legal-and-stale-status`,
`journey-legal-drafts-block-public`, `legal-drafts-unpublished`,
`codecfg-legal-placeholders-block-public-site`, `legal-no-notice-at-entry`,
`legal-test-terms-mismatch`, `legal-access-request-kept-forever`,
`legal-netbird-unlisted-subprocessor`, `legal-credential-retention-overclaim`,
`legal-no-breach-ropa-dpia`, `legal-drafts-disagree-internally`,
`legal-social-signin-not-disclosed`, `journey-no-account-closure-path`,
`legal-idp-identity-not-erased`, `ops-no-incident-response`, `rootdocs-security-md-hosted-scope`,
`wp-0110-support-disclosure` and `legal-household-permission-uncaptured`. The review confirmed all
of them. Where its verifier added a limit, the limit is stated below.

### The texts, and why none can be published

- **Six drafts.** `site/legal/` holds the privacy policy and the terms in English and Dutch,
  the data-processing agreement (`dpa.md`) and the sub-processor list (`subprocessors.md`). The
  privacy policy and the terms say *"Version: 1.1 (draft for legal review — not yet published"*.
  The other two say *"draft v0.1"*. The README's heading is *"These are DRAFTS. Do not publish
  them yet."*
- **Two lawyer briefings already exist.** They are HTML comments at the top of `privacy.md` and
  `terms.md`, with ten numbered questions each. The site build strips them.
- **What the build renders.** `site/build.mjs` renders the privacy policy and the terms in both
  languages (`SOURCE`). It does not render the data-processing agreement or the sub-processor
  list. Run with `--check` against `app.ota.ownpace.eu`, it printed *"14 pages across 2 locales,
  22 unfilled placeholder(s)"*.
- **The public build refuses.** `--public` throws while any placeholder is rendered
  (`if (PUBLIC && drafts > 0)`). It also throws unless `OWNPACE_APP_URL` is
  `https://app.ownpace.eu` (`PUBLIC_APP_URL` in `site/prices.mjs`). A build without `--public` is
  noindex, and shows each placeholder visibly without stopping. It also throws when
  `OWNPACE_APP_URL` is the production address (`!PUBLIC && APP_URL === PUBLIC_APP_URL`), so a
  noindex build cannot point at `app.ownpace.eu`. The alpha now runs at `app.ownpace.eu` (D5). So
  the build that refuses placeholders is the one whose buttons lead to the alpha. It is also the
  indexable one: no `noindex` tag, and a `robots.txt` that allows everything.
- **Where the site is served.** `deploy/compose/www.yml` serves `site/dist`. Its header builds it
  with `OWNPACE_APP_URL=https://app.ota.ownpace.eu`, which is a noindex test build, and names
  `www.ota.ownpace.eu` as the test site. It declares a fixed project name (`name: ownpace-www`)
  and a fixed `container_name: ownpace-www`. The review found that `www.ownpace.eu` does not serve
  this repository's site. That was not re-checked here. The production names 0132 T1e routes to
  live are `app.`, `id.` and `status.ownpace.eu`; `www.ownpace.eu` is not among them.
- **The placeholders still open** in the documents (the README's table has twelve rows, of which
  three are filled and two are retired): `«REGISTERED_ADDRESS»`, `«VAT_NUMBER»`,
  `«HOSTING_PROVIDER»`, `«HOSTING_REGION»`, `«EMAIL_PROVIDER»`, `«EMAIL_REGION»`,
  `«LOG_RETENTION»`, `«SUBPROCESSORS_URL»` and `«PRIVACY_HISTORY_URL»`.
  `scripts/legal-docs.unit.test.ts` fails when `privacy.md` or `terms.md` uses a placeholder the
  README does not list. Its list of documents (`DOCS`) names those two only, so it does not read
  the Dutch files, the data-processing agreement or the sub-processor list.

**0086.** T5 is *"🟡 Drafted, not published"* and says *"Wants a lawyer, not this plan."* The
Status block is dated 2026-08-18 and says *"Nothing here is built"*, and T4 is still *"⬜
Planned"*, although 0093 built the request door that T4 plans, on 2026-08-22. This plan does not
edit 0086. Correcting its Status block belongs to whoever next works on 0086.

### Where a tester meets the texts today

- **The request form** (`RequestAccess.tsx`) shows one line, `access.privacy`: *"We keep what you
  type only to answer you; asking creates no account."* It has no link. The form stores an
  address, a name, an organisation and a note in the person's own words (managed migration 0002).
- **The grant page** (`Grant.tsx`) is the only screen that links the privacy policy and the
  terms. It used to link `https://www.ownpace.eu/privacy` and `/terms`, which are not files the
  build writes, and the site's nginx (`www-nginx.conf`, `try_files $uri $uri/ =404`) adds no
  `.html`. Fixed in #1137, merged 2026-09-24: it now links the files the build writes, in the
  reader's language (`/privacy.html` and `/terms.html`, `/nl/privacy.html` and
  `/nl/voorwaarden.html`, in `LEGAL`), and the legal README's table names the same addresses. They
  are on `www.ownpace.eu`, the production site, which is where the texts belong now that testers
  use the production names (D5). The review found that name does not serve this site (not
  re-checked here). T10 makes the host a setting.
- **The Connect buttons** (`ProviderConsentPanel` in `ProviderConsent.tsx`, the one path for
  Google, Microsoft and Dropbox) link neither text.
  `docs/google-oauth-verification.md` §5 requires *"Links to the privacy policy and terms sit
  beside the button, not in a footer."*
- **The report form** (`ReportProblem.tsx`, 0130) collects a description and a screenshot with no
  privacy link. 0130 T4 is 📋 Proposed.
- **The mails** in `packages/shared/src/notifications.ts` link neither text.
- **Acceptance.** Terms §1 says that creating an account or using the service is acceptance.
  Terms §7 relies on a customer's *"express request"* when the first migration is created. No
  screen presents the terms, and nothing in `apps/` or `packages/` records an acceptance. A search
  for `termsAccepted`, `terms_version` and similar names finds nothing.

### Terms written for a paid service

Terms §6 to §8 cover prices, the right of withdrawal and monthly billing through a payment
provider. Nothing is charged: `POST /api/billing/invoices/generate` answers
`409 billing_model_retired` (`NO_TIER_BILLING_CODE`). Terms §11 promises 30 days' notice before
the terms end, and 90 days' notice and an export if the service is discontinued. The alpha runs
for a few weeks (D2). Terms §9 already says there is no contractual uptime guarantee. Nothing in
the drafts covers a free test: that it may be reset or ended, or what happens to stored
credentials at its end.

### Promises the code does not keep

- **Access requests are never deleted.** Managed migration 0002 grants `app_user` INSERT on
  `access_request` and revokes DELETE. 0093 states the rule: *"No DELETE on `access_request` for
  anybody, operator included."* Offboarding purges only the rows that name the erased organisation
  (`PURGED_TABLES` in `packages/managed/src/offboarding.ts`), which is the granted request. Nothing
  prunes declined or open requests: neither `packages/ledger/src/retention.ts` nor a worker job
  names the table. The privacy policy has no section on access requests, in §4 or in §9. The
  review's *"nobody can delete them"* is slightly strong: the database owner can, and migration
  0020 did so for duplicates. There is no product path, runbook step or stated period.
- **Credentials outlive what §9 says.** Privacy §9 and the data-processing agreement's Annex A say
  credentials are destroyed when the migration ends or is deleted. The code differs in two places:
  - Finishing a migration (`POST /:mappingId/finish` in `operating-routes.ts`) keeps them on
    purpose. The answer says *"Set the mapping's status back to 'active' to resume"*.
  - Deleting a migration (`DELETE /:mappingId` in `apps/api/src/routes/migrations/index.ts`)
    deletes the row and revokes nothing. That row can hold a credential of its own
    (`mailbox_mapping.source_secret_ref`, written by `grant-ending.ts`).

  Deleting a connection does revoke (`revokeCredentialRow` in `connections.ts`, whose comment
  quotes the privacy promise). So does erasure (`revokeStoredCredentials`). A connection cannot
  be deleted while a migration uses it (`409 in_use`), so its credential lives until the
  connection goes, not until the migration ends.
- **Preflight counts.** Annex A says *"30 days if no customer relationship follows"*, and so does
  the privacy briefing's question 5. Privacy §4.3 and §9 say the counts go with their migration.
  The code agrees with §4.3: `migration_discovery` has `ON DELETE CASCADE` on its mapping (ledger
  baseline), and nothing prunes it after 30 days.
- **Account and sign-in data.** Privacy §9 says *"While your account exists, then 30 days"*.
  The close windows are 0, 7, 30 or 90 days, chosen by the customer (`CLOSE_WINDOWS_DAYS`). The
  identity provider's account is not erased at all: `offboarding.ts` never refers to it, the
  runbook's *Tenant offboarding* never mentions it, and ADR-0042 rules out an issuer-specific API
  in shipped code. 0135 T8 proposes the operator step.
- **Closing.** Terms §11 says *"You may close your account at any time."*
  `POST /api/tenants/:tenantId/close` exists with `requireRole('owner')`. Nothing in the web app
  calls it. `deploy/compose/operator.sh` has no close or erase command (its sub-commands are
  `list`, `add`, `remove`, `memberships`, `leave`, `check`, `clean` and `secrets`). The runbook's
  example calls the route with `$OWNER_TOKEN`, and an operator belongs to no organisation. So
  neither a tester nor the owner can close an organisation without raw API or database access.
- **Operators see service metadata.** 0110 turned support access on by default and disclosed it
  in privacy §4.5. That disclosure is in the unpublished draft only.
- **Social sign-in.** `managed.env.example` has `IDP_GOOGLE_CLIENT_ID`,
  `IDP_MICROSOFT_CLIENT_ID`, `IDP_GITHUB_CLIENT_ID` and `IDP_APPLE_CLIENT_ID` for sign-in
  buttons at the identity provider. The privacy policy mentions none of them, and §8 says there is
  no transfer to a third country *"by us"*. The keys are blank by default. Whether live's `.env`
  will set any of them is not visible from the repository (T0). 0140 T10 proposes email and
  password only, and 0135 open question 10 asks this for GitHub.
- **Isolation in the database.** Privacy §11, its Dutch mirror and the data-processing
  agreement's Annex B say tenant isolation is enforced *"in the database itself through
  row-level security"*, and Annex B adds that database roles hold least privilege. 0138 found
  that the eight per-tenant jobs in `apps/worker/src/jobs/` open their pool from
  `DATABASE_URL`, which `set-task-env.sh` composes from the owner role. Checked here: all eight
  `run-*.ts` jobs read `process.env.DATABASE_URL`. So the sentence holds for the application's
  requests and not yet for the background tasks. 0138 hands the wording to this plan.
- **A separately held key.** Privacy §11 says credentials are encrypted *"under a separately held
  key"*. 0134 §1 notes that the key is held apart from the database, in `.env`, but on the same
  machine, and hands the wording to this plan.
- **Who in an organisation sees what.** 0137 found that the privacy policy does not say this, and
  that §4.2 leaves out display names and stored error text. The finding was only partly confirmed.
- **A family member's permission.** Terms §3 requires it before another person's account is
  connected. `grant-ending.ts` enforces it on the grant-link path (*"The account that signed in
  must be the one the migration names"*). The password paths (app passwords, IMAP, an Apple
  app-specific password) record nothing.

### Who else handles the data

Privacy §7 and `subprocessors.md` list two current rows, both placeholders: the hosting and the
mail relay. `subprocessors.md` also has one planned row, for invoicing. None mentions an ingress.
The repository says that TLS for the OTA names is terminated by NetBird. `managed.yml` says so in
its comment on `ZITADEL_EXTERNALPORT` (*"netbird terminating TLS on 443"*), 0091 says *"Routing
and TLS are netbird's, not this repository's."*, and the troubleshooting table in
`docs/managed-bring-up.md` says that behind netbird the identity provider's port is 443,
*"terminated by something that is not Zitadel"*. The repository does not say whether that
terminator runs on the reference machine or is a service the mesh provider operates. The review's
DNS lookup found the OTA names resolving to the mesh provider's hosted ingress. That was not
re-checked here, and the region and legal entity were not confirmed.
`docs/google-oauth-verification.md` still says that anyone off the mesh gets a timeout.

Testers now reach live at the production names (D5): `app.ownpace.eu`, `id.ownpace.eu` and
`status.ownpace.eu`. 0132 T1e routes them in NetBird to live's ports, and has not been done. If
they are routed the way the OTA names were found to be, the mesh provider's hosted ingress sits in
front of every tester's request. Whether they are is T0's fact 1. 0132 T3 records the path a
tester's request takes, for the production names and the OTA names. No file in `site/legal/`
mentions NetBird.

### Procedures

- **No breach procedure.** The data-processing agreement's §7 promises to notify a controller
  *"without undue delay after becoming aware"* of a breach. No runbook in `docs/` describes what
  happens then. A search of `docs/`, `site/` and `SECURITY.md` for a breach procedure, a record of
  processing activities or an impact assessment finds only that promise.
- **Two vulnerability channels.** `SECURITY.md` says GitHub Security Advisories is *"the only
  reporting channel"*. Privacy §11 says to write to support@ownpace.eu.
- **The security policy's scope.** `SECURITY.md` has a reporting section and principles. It has
  no scope for the hosted service, no supported versions and no response target. The site has no
  `security.txt`.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words, then the answer as given, typos included. Where
an answer needed a reading, the reading is stated.

**D1 — a lawyer first, and the owner writes.** *A lawyer's pass before the first invitation, or a
labelled beta notice? And can you supply the registered address, the btw-id and the hosting
details?* — *"Yes before, Alpha, and i can supply."* On the legal blocker (the drafts are
unpublished and full of placeholders, nothing is shown where data is collected, and no tester
accepts anything): *"I will update"*.

So the lawyer's pass happens before the first invitation, the test is labelled "Alpha", the owner
supplies the facts, and the owner updates the texts. This plan prepares what the owner and the
lawyer need. It does not write the texts.

**D2 — what the alpha is.** *Is the test free or paid, for how many people, for how long, and in
which language?* — *"Free and invite only. 10 to 20 people max. Dutch."* On the posture of the
test: *"Free. A few weeks. No obligations both sides."* On the missing database backup: *"No
obligations during controlled test"*.

"No obligations both sides" is read as the contract: no service level, no payment, no minimum
term, and either side may stop. It cannot switch off the duties the GDPR places on whoever
controls personal data: telling people what happens to it, keeping it secure, notifying a breach,
and answering rights. The alpha processes whole mailboxes from the first tester on. So T4 to T8
stay necessary in a free alpha, and they are sized for 20 people.

**D3 — no backups.** *How much loss is acceptable, how fast must service come back, and where are
backups kept?* — *"None during the test"*. 0134 carries it. T2 includes 0134 T2's paragraph.

**D4 — the owner is the gate, and supports each tester.** *What may a member and a viewer do, and
should only owners and admins invite?* — *"I am the gate for letting people in the test."* On a
tester stack apart from CI and the nightly gate, reachable from the internet: *"Yes, but its a
controlled rest. I Let people in and support them. Max 10/20 people"* ("rest" is read as
"test"). *Should the Google client move to
production, or stay in Testing with each tester registered in advance?* — *"Ill add people by
hand"*. On its tokens, which expire after about seven days in Testing: *"I add people,
controlled small test Group."*

So every tester is someone the owner granted, and the owner is their contact. The conditions (T2)
say how to reach the owner. The tester stack apart from CI and the nightly gate is `ownpace-live`
(D5).

**D5 — where it runs, and who can reach the machine.** *Where do testers run, and under which host
names?* — *"This machine, ci states. The OTA address. It's all controlled by me and invite only."*
("ci states" is read as "CI stays".) *Are ports 5432, 3001, 3090, 3443 and 3126 reachable from
outside, were the database passwords changed, and does the live identity provider hold other
organisations?* — *"No, these ports are not reachable outside of private network/NetBird.
Usernamea changed. No other organisations are hosted."* ("Usernamea" is read as "usernames".)
On rotating the demo secrets if the current stack is reused: *"Who would need/het credentials? I
aupporrthe test. No one will be added to NetBird network. Devs need to setup own private test/dev
environments. GitHub PRs and git is the bridge."* ("het" is read as "get", and "aupporrthe" as
"support the".)

The first answer placed the alpha at the OTA address. Later the same day the owner asked:
*"check, can't i just (as a start) host a 'ownpace-live' as production, next to the current
'ownpace-managed' on OTA-domain? What would i need to do to keep alle seperate from each other?"*
The proposal back was to make that the decision in 0132, with testers on `ownpace-live`. The
owner's answer: *"Yes! The spark has a lot free memory and disk, it will fit."* (0132 D-new.)

So the alpha runs on the reference machine, in a second compose project, `ownpace-live` (live),
at the production names of 0091: `app.ownpace.eu`, `id.ownpace.eu` and `status.ownpace.eu`. The
OTA stack, `ownpace-managed` at `app.ota.ownpace.eu` and `id.ota.ownpace.eu`, stays the nightly
gate's target and the demo, and no tester is let in there. CI never touches live. The two stacks
share one Docker daemon, so their separation is logical, not a security boundary (0132 D-new).
Only the owner administers either. The hosting placeholders (T0), the record of processing and
the assessment (T8) must describe that truthfully.

**D6 — mail.** *Which EU mail relay and sending domain, and does a person read support@?* —
*"I'll register a ownpace ampt, a todo"*. This is read as: the owner will register a
mail-sending (SMTP) account for Ownpace, as a to-do. On mail leaving the machine: *"I will
practically forward / help"*. So `«EMAIL_PROVIDER»` and `«EMAIL_REGION»` wait for 0133 T0, and
until then the owner forwards by hand (T5 covers what that means for the texts).

**D7 — unproven sources are labelled.** *For sources nobody has run against a real account:
prove them first, hide them, or label them experimental?* — *"Label"*. 0131 T2 builds the label,
and T2's conditions say what it means.

## 3. What each task does

### T0 — the owner's facts (owner)

**The placeholders.** The owner supplies a value for each of these, or says where it comes from.
Values go into the legal files, never into this plan.

| Placeholder | Where it comes from |
|---|---|
| `«REGISTERED_ADDRESS»` | The owner, in the printed form the owner chooses (the README leaves the form open). |
| `«VAT_NUMBER»` | The owner (D1). |
| `«HOSTING_PROVIDER»`, `«HOSTING_REGION»` | The owner. The README warns against naming a host the service is not on. During the alpha the service runs on the reference machine, in `ownpace-live` (D5), and the value must describe that. The lawyer checks the wording. |
| `«EMAIL_PROVIDER»`, `«EMAIL_REGION»` | The relay from 0133 T0, with its data-processing agreement. Until it exists, see T5. |
| `«LOG_RETENTION»` | 0129 D2 already gives the numbers: one month for the application's errors and warnings and for container output, two months for a pass's lines, and the audit log until the customer is erased. The owner confirms which of these the row states. T6 says where the alpha differs. |
| `«SUBPROCESSORS_URL»` | Follows from T10: the address where the sub-processor list is published. |
| `«PRIVACY_HISTORY_URL»` | The owner chooses where earlier versions are kept. One option is the file's history in this public repository. The lawyer says whether that meets privacy §13's promise. |

The data-processing agreement also carries `«REGISTERED_ADDRESS»` and `«SUBPROCESSORS_URL»`. It
is not rendered by the build, and 0086 T5 owns it.

**The facts that have no placeholder yet.**

1. **Where TLS ends for the production names** (T5): `app.ownpace.eu`, `id.ownpace.eu` and
   `status.ownpace.eu`, once 0132 T1e routes them, and `www.ownpace.eu` if fact 6 puts it behind
   the same ingress. Is it on the reference machine, or at a service the mesh provider operates?
   If the latter, which legal entity, and in which region? 0132 T3 records the path, and this
   answer decides whether the ingress is a sub-processor.
2. **The support mailbox.** Which provider hosts `support@ownpace.eu`, and does a person read it
   during the alpha (0133 open question 3)? Privacy §1 says *"A person reads that address."*
3. **Zammad.** Is the report form (0130) configured on live, and where does that Zammad run?
4. **Social sign-in.** Which of the four `IDP_*_CLIENT_ID` keys will live's `.env` set?
5. **Organisations in the alpha.** Is any tester a business rather than a household (open
   question 6)? **Supplied 2026-09-28:** *"tester: households only for now."*
6. **The production site.** Where `www.ownpace.eu` is served from during the alpha (T10). The
   grant page and the legal README point there, 0132 T1e does not route it, and the review found
   it does not serve this repository's site. **Supplied 2026-09-28:** *"site will first be hosted
   on this machine during alpha"*: the reference machine serves `www.ownpace.eu` for the alpha.

The dates on which each fact was supplied go in the Status block.

### T1 — the lawyer's pass before the first invitation (owner; decided, D1)

The lawyer reads the privacy policy and the terms in both languages, T2's conditions, the
sub-processor list, and T8's breach procedure, record and assessment. The two briefings at the top
of `privacy.md` and `terms.md` stay the brief. Their questions are still open. This plan adds the
following, which the owner can paste under them:

1. **The contract for a free alpha.** Are T2's conditions an addendum to terms v1.1 that says
   which sections do not apply (§6 to §8 on money, the notice periods in §11), or stand-alone
   conditions? And does *"No obligations both sides"* hold against Dutch consumer law, given terms
   §10's liability cap of what was paid in twelve months, which is nothing?
2. **Dutch first.** The alpha is Dutch (D2). The terms briefing's question 6, whether English can
   prevail over the Dutch text for a Dutch consumer, is now the live case.
3. **The retention truths** of T6, as decided by the owner.
4. **What the identity provider holds**, from 0135 T5: name, address, user name, a password hash,
   links to social sign-ins, and sessions. Plus whether removing an account also removes the
   personal data in its earlier events, which 0135 T8 did not check.
5. **Social sign-in**, if T0 says it is on: one sentence in §4.4 and §7, and whether §8's *"no
   transfer … by us"* still reads correctly. With it, 0140's sentence on who holds a Microsoft
   credential: the client secret is the deployment's, and the refresh token sits in the
   service's encrypted store, as it does for Google.
6. **Support.** 0130 T4's paragraph on problem reports, and privacy §4.5 (operators see service
   metadata, 0110) now reaching a tester for the first time.
7. **Who in an organisation sees what**, and §4.2's display names and stored error text (0137,
   partly confirmed).
8. **The lists the owner keeps for the alpha**: the testers' names and addresses off the machine
   (0134 T4), and each tester's Google address entered as a test user at Google (0140).
9. **Internal disagreements to settle in the same pass.** Annex A's preflight retention against
   privacy §4.3 and the code. The privacy briefing's *"counts kept 30 days"*. The terms briefing's
   item 10, which describes a revision that privacy v1.1 has already made. Privacy §11's
   vulnerability channel against `SECURITY.md` (T9).
10. **The household model**, terms §3 and the privacy briefing's questions 1, 2 and 6, which
    decide T11.
11. **What the security sections promise.** Isolation *"in the database itself"* (privacy §11,
    Annex B) holds for the application's requests and not yet for the background tasks (§1,
    0138). Either 0138 T1 to T3 land before the texts are published, or the texts say where row
    security applies and where it does not yet. And *"a separately held key"*: held apart from
    the database, but on the same machine (0134).

The owner records the date of the pass and the version numbers it approved in the Status block.
The first invitation waits for it (0131 T5).

### T2 — the alpha conditions, in Dutch and English (decided, D1 and D2)

**Where.** `site/legal/alpha.nl.md` and `site/legal/alpha.md`, rendered by the site build beside
the privacy policy and the terms, with a *Version* line like theirs. Dutch first, because testers
read Dutch (D2). Which language governs is T1's question 2.

**What they must say.** The owner writes the text. *(2026-09-28: the owner let an agent draft
it, as version 0.1; see the Status block.)* Each point has its source:

- **What the alpha is.** A trial of the managed service by a small group the owner invited, for a
  few weeks (D2, D4). The end date or the notice of the end is open question 7.
- **Free.** Nothing is charged, and the sections of the terms about money do not apply (T1 point
  1). 0131 T3 says the same on the Billing page.
- **No obligations either side.** No service level. The tester may leave at any time, and T7 says
  how. The owner may stop the alpha.
- **No availability promise.** The alpha may be paused (the operator hold, managed migration
  0023), reset or ended. Terms §9 already says there is no uptime guarantee.
- **No backups.** 0134 T2's paragraph, which the lawyer's pass decides.
- **Experimental sources.** What the label from 0131 T2 means, and that the tester should keep
  the old account until they have checked what arrived. Terms §10 already says that.
- **The end.** What the end does to organisations, credentials, sign-in accounts and access
  requests, as 0131 T4 decides. What was copied to the target stays.
- **The account is the tester's own.** It is not to be shared (0136). Inviting others follows
  0137 T0's sentence.
- **Google asks again.** While the Google client live uses is in Testing, a tester must reconnect
  after about seven days (0140).
- **How to reach a person.** The report form (0130) or the support address (0133 open question 3).

0131 T1's short note and the grant mail's sentence must match these conditions, and they link to
them once they exist.

**Guard.** `scripts/legal-docs.unit.test.ts` gains a case that fails today: both files exist,
each carries a *Version* line, and the site build renders them in both locales. `alpha.md` joins
that file's `DOCS` list, so its placeholders must be in the README's table. The case in
`site.unit.test.ts` that *"ships a Dutch translation of each legal document"* names `privacy`
and `terms` only; `alpha` joins its list. *(2026-09-28: both done, and a case checks a version
line in every document, the same number in both languages. The half that the build renders them
waits for T10.)*

### T3 — acceptance recorded, with version and time, at first sign-in (proposed)

**What the tester sees.** After the first sign-in, and before any other page, there is one screen:
the alpha conditions, the privacy policy and the terms, each linked in the reader's language, and
one button to accept. It appears again when any of the three changes version. An invited member
(0099) sees it too, at their own first sign-in.

**What is recorded.** A new table in the managed migration chain (`packages/managed/migrations`,
never the shared chain), with the working name `legal_acceptance`: organisation, subject,
document (`alpha`, `privacy` or `terms`), version, language and time. `app_user` may insert and
read its own organisation's rows under row security. It may not update or delete them, so an
acceptance cannot be rewritten. A new version is a new row.

**Where it is checked.** `GET /api/me` reports whether acceptance is due, beside the membership
it already binds at first sign-in (`claimRequestedMembership`). `POST /api/me/acceptance` takes the
version and the language, and refuses any version but the current one, so a stale tab cannot
accept an old text. On the server, creating a connection or a migration answers
`409 conditions_not_accepted` until the current versions are accepted. The screen is the notice.
The refusal makes sure no credential is stored before it.

**The version.** The current versions are constants in `packages/managed`, because the app may not
import `site/legal/` (the README forbids it). A guard compares them with the texts.

**When it is on.** Off unless the deployment sets it, like 0131 T1's alpha setting, which can be
the same switch. Live sets it. The appliance never has it: the table, the constants and
the check live in `packages/managed` and the managed API, and the web app shows the screen only
when `GET /api/me` says acceptance is due. `no-managed-leakage.unit.test.ts` already refuses
`@openmig/managed` anywhere in the appliance's import graph, so a module there is kept out
without a change to the guard. Whether the paid service later turns it on for everyone is 0086's
question.

**Erasure.** The new table must be named in `PURGED_TABLES` or `RETAINED_TABLES`. The proposal is
to purge it with the organisation (open question 4).

**Guards.** Each fails today:

- `apps/api/src/routes/an-acceptance-with-its-version.integration.test.ts`. With the setting on,
  `GET /api/me` reports acceptance due, and creating a connection or a migration answers 409.
  Accepting the current version writes one row per document with version, language and time, and
  the same calls then succeed. An old version answers 409. With the setting off, nothing changes.
- `apps/web/src/pages/an-acceptance-before-the-first-connection.unit.test.tsx`. The screen shows
  the three links in both languages when acceptance is due, and does not appear once it is given.
- `scripts/a-version-the-tester-accepted.unit.test.ts`. The constants equal the *Version* lines of
  `alpha.md`, `privacy.md` and `terms.md` and their Dutch files.
- The erasure guard in `offboarding.unit.test.ts` (*"every tenant-scoped table has a DECIDED
  fate — purged, or retained with a reason"*) fails until the table is named.
  `force-rls-managed.unit.test.ts` then finds its row security forced, and a
  `legal-acceptance-under-rls` test beside the other `*-under-rls` tests shows that an
  organisation reads only its own rows and that nobody can update or delete one.

### T4 — a notice wherever a tester's data is collected (proposed)

| Where | What changes |
|---|---|
| The request form (`RequestAccess.tsx`) | The privacy policy and the alpha conditions linked under the form, in the reader's language. `access.privacy` states the period T6 decides, instead of saying nothing about how long. |
| The identity provider's registration and sign-in pages | 0135 T5: the instance privacy policy's links, set from `.env` and read back. They point at T10's addresses. |
| The Connect buttons (`ProviderConsentPanel`) | The privacy policy and the terms beside the button, as `docs/google-oauth-verification.md` §5 requires. |
| The report form (`ReportProblem.tsx`) | The privacy policy linked beside what the form says it will send. 0130 T4's paragraph is the policy's half. |
| The grant page (`Grant.tsx`) | Already links both texts, at the files the build writes on the production site, per language: fixed in #1137, merged 2026-09-24. T10 moves them into one module. |
| The access-granted mail | The link to the alpha conditions, with 0131 T1's sentence. |

**Guard.** `apps/web/src/components/a-notice-where-data-is-collected.unit.test.tsx` fails today.
It renders the request form, the Connect panel and the report form in both languages, and finds
the privacy link in the reader's language, taken from T10's module.

### T5 — the sub-processors named (owner for the names; proposed for the text)

The owner supplies each name (T0), and the lawyer checks the rows (T1). Privacy §7, its Dutch
mirror and `subprocessors.md` carry the same rows.

- **The ingress in front of the production names**: the application (`app.ownpace.eu`), the
  identity provider (`id.ownpace.eu`) and the status page (`status.ownpace.eu`), which 0132 T1e
  routes to live, and the production site (`www.ownpace.eu`) if T0's fact 6 puts it behind the
  same ingress. The owner confirms it this way (T0 fact 1). If TLS ends at a service the mesh
  provider operates, that service sees every request in plain text: sign-ins, OAuth codes, app
  passwords typed into the wizard, and every page of metadata. It is then a sub-processor, named
  with its region under a data-processing agreement. If TLS ends on the reference machine and
  the provider carries only encrypted traffic, the texts need no row for it. The alternative to
  a new row is to move TLS termination onto the machine. No plan carries that yet; 0132 T3's
  record of the path is where it would start. The OTA names are not where testers are let in
  (D5), so the texts for the production site need no row for them. Whether they still answer
  from the internet is 0132's open question 7.
- **The mail relay**: 0133 T5 fills `«EMAIL_PROVIDER»` and `«EMAIL_REGION»`. Until the relay
  exists, the owner forwards mail by hand (D6). That mail then leaves through the account the owner
  forwards from, and its provider is the one the texts name for that period.
- **The support channel.** Whoever hosts `support@ownpace.eu` handles every rights request and
  support mail. The same goes for the Zammad that holds problem reports (0130), unless it runs on
  the machine the hosting row already covers.

No code changes, so there is no guard. T10 renders `subprocessors.md`, which gives
`«SUBPROCESSORS_URL»` an address.

### T6 — what is kept, and for how long, made true (proposed)

For each promise in §1, either the code changes or the text does. The owner decides which (open
questions 2 and 3), and the lawyer checks the words.

- **Access requests.** Proposed: a declined request is deleted 30 days after the decision. A
  granted one goes with its organisation, as today. An open one stays while it is open, because
  the owner answers every request (D4). The delete runs in the managed retention job
  (`apps/worker/src/jobs/managed-retention.ts`) over the owner's connection, so `app_user` and the
  operator still cannot delete a decision. 0093's rule becomes: a decision is not erased by a
  person, and it ages out on a stated date. Privacy §4 and §9 gain a row for access requests. The
  alternative is in open question 2.
  **Guard:** `packages/managed/src/a-request-nobody-keeps-forever.integration.test.ts` fails
  today. It checks that a declined request older than 30 days is gone, and that a younger one, an
  open one and a granted one stay.
- **Credentials on delete.** Deleting a migration revokes the credential its own row holds, after
  the delete, with `revokeCredentialRow`, as deleting a connection does. This matches the text
  whichever way open question 3 goes.
  **Guard:** `apps/api/src/routes/migrations/a-deleted-migration-revokes-its-grant.unit.test.ts`
  fails today. With a stub revoker, deleting a migration whose row holds `source_secret_ref`
  revokes once, after the row is gone. A 404 revokes nothing.
- **Credentials on finish.** Finishing keeps access on purpose: the finish answer says to set
  the status back to `active` to resume, and today the continuous lane is a second step after
  finishing (0128 §3, T3). Both need the credential. So the proposal changes the text, not the
  code: credentials are kept until the connection or migration is deleted, or the account is
  closed (open question 3).
- **Preflight counts.** Annex A follows privacy §4.3 and the code (T1 point 9).
- **Account and sign-in data.** §9 names the close window the tester chooses (0, 7, 30 or 90
  days), that there are no backups during the alpha (0134 T1), and the identity provider's step
  (T7, 0135 T8). It also names how long an account at the identity provider that nobody let in
  is kept: 0135 T8 proposes 30 days, and 0135 open question 6 asks the owner.
- **The task runner's stores.** 0134 T1 reads what each task returns and what a failed run's
  error can carry. The task events (ClickHouse) and large payloads (MinIO) that `managed.yml`
  describes are not backups, but they can outlive an erasure, and 0134 hands that finding to this
  task. If they can hold a tester's personal data, the text says how long they are kept, or they
  are pruned to match. Neither 0134 nor this plan has checked their retention.
- **Logs** (`«LOG_RETENTION»`, T0). One month for the application's errors and warnings is built
  (0129 T3). Whether container output on the reference machine keeps one month depends on the host
  setting 0129 T3's guide describes. That is not visible from the repository, and the owner checks
  it.
- **Run history.** The texts do not name it. 0129 D2 keeps a pass's lines and runs for two
  months. But managed retention prunes a tenant's runs only as far back as its newest invoice,
  and a free tenant has none (0131 §1). So in the alpha, run rows stay until the alpha ends or the
  organisation is erased. The text says so, or 0143 (W13 in 0131 §5) changes the rule.

### T7 — a tester can end their account (proposed)

The self-serve close screen belongs to 0144 (W14 in 0131 §5). The smaller build that makes
terms §11 true in the alpha is an operator command.

- **`operator.sh close <tenant-id> <window>`**, through a new `close` sub-command of
  `apps/api/src/scripts/operator.ts`. The route does four things: it reads the grants only the
  customer can withdraw, calls `closeTenant` from `@openmig/managed`, asks the orchestrator to
  stop passes in flight (`stopPassesInFlight`), and answers the dates and the sentence in both
  languages. Those four move into one function that the route and the command both call, so the
  two cannot drift. The command passes the operator's subject as `closedBy`, takes a reference to
  the tester's request, and records both in the audit log. The window must be one of
  `CLOSE_WINDOWS_DAYS`.
- **The identity provider's account.** The runbook's *Tenant offboarding* gains 0135 T8's step
  after the purge. Until 0135 T8's script exists, the owner removes the account in the console.
- **The path a tester takes.** T2 says it: ask the owner through the report form or the support
  address, and choose a window. The owner closes within a stated number of days.
- **The end of the alpha** (0131 T4, option a) uses the same command for every organisation.

**Guard.** `apps/api/src/scripts/an-account-a-tester-can-end.integration.test.ts` fails today,
because the sub-command does not exist. For the same tenant and window, the command's result
equals the route's: the dates, the sentence and the standing grants. The command refuses a window
outside the list, and the audit row names the operator and the reference.

### T8 — a breach procedure, a record of processing, a light impact assessment (proposed)

**The breach procedure: one page in `docs/`**, working name `docs/breach-procedure.md`. A
procedure holds no secrets, so it belongs in the public repository. It covers:

1. **Contain.** The operator hold (managed migration 0023) stops the sync tick from starting new
   passes (`readOpenPause` in `managed-sync-tick.ts`). Since 0132 T6 (b) (2026-09-27) a pass a
   tester starts by hand is refused while it is open too (0131 §1). A pass already running
   finishes, so the page also says how to stop those. The nightly gate
   rebuilds only the OTA stack and never touches live (0132 D-new, T1g), so it destroys no
   evidence on live. If a breach reaches the OTA stack too, pause the gate first, because a
   rebuild there destroys evidence.
2. **Keep the evidence.** Copy the application's events (`app_event`, pruned at 30 days) and the
   container output (kept a month where 0129 T3's guide is followed) off the machine before they
   age out, with the audit log beside them. 0129 T4's export covers the audit log once it is
   built. Until then, and for the rest, it is a query and a copy of the journal.
3. **Assess.** What data, which testers, and how likely a risk to them is. The two stacks share
   one Docker daemon, and their separation is not a security boundary (0132 D-new), so the
   assessment starts from both.
4. **Notify the Autoriteit Persoonsgegevens** without undue delay, and where feasible within 72
   hours of becoming aware (Art. 33), unless the breach is unlikely to result in a risk.
5. **Tell the testers**, in Dutch, when the risk to them is high (Art. 34). For a business tester
   under the data-processing agreement, tell the controller (its §7).
6. **Register every breach**, notified or not (Art. 33(5)).

It includes the tester message as a template in Dutch and English, and one line on key rotation.
`SECURITY.md` says stored credentials have *"no rotation"*, so a leaked `SECRET_ENCRYPTION_KEY`
means every tester reconnects.

**The record of processing (Art. 30) and the light impact assessment.** Both are kept by the
owner and not in this repository. They record facts the repository deliberately does not hold,
such as the hosting details of T0 and the list of testers of 0134 T4. The record lists each
activity with its purpose, data, people, recipients, retention and measures: access requests,
sign-in accounts, stored credentials, the ledger's metadata, preflight counts, run history, logs,
the audit and support-read logs, problem reports, mail, the owner's list of testers, and the Google
test-user list. The review's reading is that the Art. 30(5) exemption does not apply, because the
processing is not occasional. The lawyer confirms it.

The assessment covers the household role (privacy §3), the correspondents in a mailbox who never
contracted with anyone, children's mail (privacy §12), where the service runs and who can reach it
(D5, 0132), the two stacks on one Docker daemon (0132 D-new), and the ingress (T5). Whether a
full assessment is required is T1's question. The light one is done either way.

No code, so there is no guard. The Status block records the dates.

### T9 — SECURITY.md covers the hosted service, with one channel (proposed; owner's channel)

- **Scope.** The code in this repository, both editions, and the hosted service: live at the
  production names during the alpha, and the OTA stack at the OTA names. Also a sentence that
  testing against the hosted service needs the owner's permission first, because it holds
  testers' credentials. Anyone can bring up their own stack instead
  (`docs/selfhost-quickstart.md`, `docs/managed-bring-up.md`), and D5 says the same for
  developers.
- **Supported versions.** Stated by the owner. Before there is a release line, that is `main`.
  *Stated 2026-09-27: `main`, and the release live runs.*
- **A response target.** A number of working days to acknowledge a report, named by the owner.
  *Named 2026-09-27: five working days to acknowledge, with no promise of when a fix lands.*
- **One channel, stated the same way everywhere.** *Decided 2026-09-27, as recommended:* the
  GitHub advisory form, which `SECURITY.md` already names, with `support@ownpace.eu` as the
  fallback for someone without a GitHub account. Privacy §11 then says the same in the
  lawyer's pass.
- **`security.txt`** at `/.well-known/security.txt` on the site, written by the site build, with
  `Contact`, `Expires`, `Preferred-Languages` and `Canonical`.

**Guard.** `scripts/one-way-to-report-a-vulnerability.unit.test.ts` fails today. It checks that
`SECURITY.md` has a scope section naming the hosted service, and that privacy §11 in both
languages and the built `security.txt` name the channel `SECURITY.md` names, in the same order.
It also checks that `security.txt`'s `Expires` is in the future and less than a year away.

### T10 — the texts published where a tester can read them, with no placeholder left (proposed)

- **The production site, built with `--public`.** Testers use the production names (D5), so the
  texts they read are the production site's, at `www.ownpace.eu`, where the grant page and the
  legal README already point (#1137). The `--public` build already does what the alpha needs: it
  throws while any placeholder is rendered, and it requires
  `OWNPACE_APP_URL=https://app.ownpace.eu`, which is now the alpha's address. So publishing needs
  no new switch (open question 1 (a)). The site it writes is indexable. *(2026-09-28: it also
  refuses, as `--public --check` does, while a legal page it renders says on its version line
  that it is a draft (T2). So T10 publishes once T1's lawyer pass has given every rendered legal
  page a final version line, as well as once T0's facts are in.)*
- **If the owner wants it unindexed during the alpha** (open question 1 (b)): a new switch, working
  name `--no-drafts`, that throws on a placeholder as `--public` does, stays noindex, and accepts
  the production app address. Today a build without `--public` refuses that address on purpose,
  because a noindex test site once sent its visitors to the real app (the comment above that check
  in `site/build.mjs`). The switch would be the one exception, named on the command line.
- **Where it is served** is T0's fact 6. 0132 T1e routes `app.`, `id.` and `status.ownpace.eu`,
  not `www.ownpace.eu`. If it is served from the reference machine beside the OTA test site,
  `www.yml` has the shape `managed.yml` has before 0132 T1: a fixed project name and a fixed
  `container_name`, both `ownpace-www`. Each checkout has its own `site/dist`, and `WWW_PORT` is a
  variable, so the fixed names are what stop a second copy from live's checkout starting. The fix
  is 0132 T1's pattern: `ownpace-www` stays the default, and a second project sets its own name.
  The route from `www.ownpace.eu` to that copy's port is then the owner's, as in 0132 T1e.
- **What it renders.** The privacy policy and the terms, as today, plus T2's conditions and
  `subprocessors.md`, so `«SUBPROCESSORS_URL»` has an address. The data-processing agreement stays
  0086 T5's.
- **One setting for every link the app makes.** Where the legal pages live is a build argument for
  the web app, which `managed.yml` passes as it passes `VITE_OIDC_ISSUER`. Live's value is the
  production site, and the OTA stack's is its test site. One module in the web app turns it into
  an address per page and per language. The grant page, the request form, the Connect panel, the
  report form and T3's screen all read that module. 0135 T5's `IDP_PRIVACY_URL` and `IDP_TOS_URL`
  are set to the same addresses.

**Guards.** Each fails today, where it applies:

- If open question 1 chooses (b), in `site/site.unit.test.ts`: a `--no-drafts` build with a
  placeholder left throws, and without one it writes noindex pages. Under (a) nothing is added
  here: the `--public` refusal already exists.
- If the site is served from the reference machine, `scripts/two-stacks-on-one-box.unit.test.ts`
  (0132 T1) also reads `www.yml`, and fails today on its fixed `container_name`.
- `scripts/a-policy-link-that-answers.unit.test.ts`: every address the module produces is a file
  the site build writes for that language, including the conditions and the sub-processor list.
  `managed.yml` passes the setting to the web build. This is the check that would have caught the
  grant page's old addresses. `Grant.unit.test.tsx` has pinned the corrected ones since #1137, as
  literals; it does not read what the site build writes.

Beside them, `scripts/legal-docs.unit.test.ts`'s `DOCS` list gains every file the build renders,
including `subprocessors.md`. That passes today, and keeps a new placeholder in any of them from
going unlisted.

### T11 — a family member's permission, recorded (proposed; waits on T1)

Only if the lawyer confirms the household model of terms §3. When a password-type connection (an
app password, IMAP, an Apple app-specific password) is created for an address that is not the
signed-in person's verified address, the form asks for one acknowledgement: this is my account,
or I have this person's permission, or I am their parent or guardian. The acknowledgement is
written to the audit log. The grant-link path needs nothing, because it already checks whose
account signed in.

**Guard.** `apps/api/src/routes/a-permission-that-was-given.integration.test.ts` fails today. It
checks that such a connection without the acknowledgement answers 400 naming the field, that one
with it writes the audit row, and that a connection for the person's own address asks nothing.

## 4. Order

**Before the first invitation.** 0131 T5's row for this plan names a minimum: the lawyer's pass
and the owner's facts, the conditions published in Dutch and English, the privacy policy and the
conditions linked from the request page and the grant page, and each acceptance recorded. That
is T0 to T3, T10, and T4's request and grant rows. This plan recommends the rest of T4, and T5 to
T9, before the first invitation as well, for the reasons given with each (open question 8):

1. T0, then T1. The owner's facts go to the lawyer with the drafts. Fact 6, where
   `www.ownpace.eu` is served, is needed before T10 can publish.
2. T2 and T5, written by the owner, in the same pass.
3. T10's link module (and its switch, if open question 1 chooses (b)), T4 and T3. These are
   code, and can be built while the lawyer reads. T3 goes on with the versions the lawyer
   approves. The production site is published with the approved texts once `www.ownpace.eu` is
   served (T10).
4. T6: the migration-delete revocation (code), and the wording or the purge for everything else.
5. T7's operator command. Terms §11 promises a close *"at any time"*, and today nobody can carry
   one out.
6. T8's breach page and the owner's two documents. The duty to notify starts with the first
   tester's data.
7. T9, which is small, in the same docs PR as T8.

**After the lawyer's answer:** T11.

Each code task is its own PR with its guard. The legal files change only in the owner's PR after
the lawyer's pass.

## Cross-references

- **0086 T5**: the legal surface for taking money, the data-processing agreement and the paid
  journey. This plan extends it and does not replace it.
- **0131**: T1's note and T3's Billing sentence must match T2, T4 decides the end that T2
  describes, and T5 holds this plan's go/no-go row.
- **0132**: D-new puts testers on live at the production names (D5), which T1e routes; T3 records
  the path a tester's request takes, which decides T5's ingress row. T1g keeps CI off live, so
  T8's procedure no longer starts by pausing the gate. T1's pattern is what a second copy of
  `www.yml` would need (T10).
- **0133**: T0's relay and T5's rows. Open question 3 (support@) feeds T0.
- **0134**: T1's erasure sentence and T2's paragraph feed T2 and T6, and T1's finding on the task
  runner's stores feeds T6. T4's list of testers is in T8's record. The wording on the key held
  apart from the database is T1's point 11.
- **0135**: T5's links at the identity provider (T4, T10), and T8's step for the identity
  provider's account (T6, T7). Open question 6 there sets the period for accounts nobody let in
  (T6).
- **0136** and **0137**: the sentences on sharing an account and inviting others (T2), and who in
  an organisation sees what (T1).
- **0138**: the sentence on isolation in the database (T1's point 11).
- **0128**: today the continuous lane is a step after finishing, which T3 turns into a choice at
  the end. It is one reason finishing keeps credentials (T6).
- **0129**: D2's log periods (T0's `«LOG_RETENTION»`, T6), and T4's audit export for T8's
  evidence.
- **0130**: T4's paragraph on support requests (T1), and the report form as a way to reach a person.
- **0140**: the Google test-user list (T8), the reconnect every seven days or so (T2), the sentence
  on who holds a Microsoft credential (T1), and the entity facts publisher verification needs
  (T0).
- **0144** (W14 in 0131 §5): the close-account screen that T7's command stands in for.

## Open questions

1. **Where the texts are published during the alpha (T10).** On the production site,
   `www.ownpace.eu`, since testers use the production names (D5). The OTA test site is no longer
   an option: its buttons lead to the OTA stack, where no tester is let in. The question left is
   whether the production site is indexable during the alpha.
   - **(a)** Built with `--public`, so indexable. *Recommended.* It needs no new code: the build
     already refuses a placeholder and requires `app.ownpace.eu`, which is now the alpha's
     address. The grant page's links and the legal README already name it (#1137).
   - **(b)** Kept noindex for the alpha, with a new `--no-drafts` switch. It costs a switch and an
     exception to the refusal that stops a noindex build pointing at production (T10).

   **Answered 2026-09-28: (a)**, *"public site: yes, search engine index."* So T10 publishes with
   `--public`, and its (c), the `--no-drafts` switch, is not needed.
2. **Access requests (T6).**
   - **(a)** A declined request is deleted 30 days after the decision. *Recommended.*
   - **(b)** The texts say requests are kept until the alpha ends, and the owner deletes them by
     hand as the database owner at the end, with a runbook step.

   **Answered 2026-09-27: (a)**, *"2a"*.
3. **Credentials when a migration is finished (T6).**
   - **(a)** Keep them, and the texts say so: until you delete the connection or migration, or
     close your account. *Recommended*, because resuming a finished migration, and today's step
     into the continuous lane after finishing (0128 T3), need them.
   - **(b)** Destroy them at finish, and the tester reconnects to resume.

   **Answered 2026-09-28: (a)**, *"stored access after finished migration: keep until deleted or
   closes."* The alpha conditions' §10 say so; privacy §9's row follows in the lawyer's pass (T1).
4. **The acceptance record after erasure (T3).** Purged with the organisation, which is
   recommended, or retained with a stated reason?
5. **The vulnerability channel (T9).** The advisory form with support@ as fallback, as
   recommended, the advisory form alone, or an address alone? And the response target?
   **Answered 2026-09-27**, *"yes all three"*: the advisory form with `support@ownpace.eu` as
   fallback, five working days to acknowledge, and `main` with live's release supported.
6. **Businesses in the alpha.** Households only, or may a tester be an organisation? If one is,
   privacy §3 makes the data-processing agreement part of its contract, and its draft is 0086
   T5's.
   **Answered 2026-09-28: households only**, *"tester: households only for now."* No
   organisation or business is admitted during the alpha, so the data-processing agreement is not
   part of the alpha. The alpha conditions' §1 say so.
7. **The end of the alpha.** How much notice do testers get before it ends or is reset? Terms §11
   says 30 days' notice before the terms end, and 90 days' notice and an export if the service is
   discontinued. The conditions state the alpha's own notice period.
8. **What waits for the first invitation (§4).** 0131 T5's row asks for T0 to T3, T10, and T4's
   request and grant rows. This plan recommends the rest of T4, and T5 to T9, as well: notices on
   the Connect buttons and the report form, the sub-processors named, retention made true, a way
   to close an account, a breach procedure, and one vulnerability channel. Which of these must be
   in place first? 0131 T5's row is then updated to match.
