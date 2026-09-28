# Workplan 0155 — The migration records, handed over on request

> **In one line:** An export of a customer's migration records — what was copied, what could not be, and why — plus what we hold about a person, made by the operator on request and later in the app, delivered and then deleted, as terms §11, DPA §10 and privacy §10 promise.

## Status — 2026-09-28 (update this block at the end of every session)

**2026-09-28: opened from the owner's answers on the legal answer page (0139).** Two answers
promise an export that the app does not have:

- **dpa-q3-return-of-data**, answered (c), *"Add a short return clause"*. DPA §10 (draft 0.2) now
  says: *"If the controller asks before the deletion, Ownpace first sends the controller its
  migration records: what was copied, what could not be, and why. Ownpace then deletes
  everything as above."* The owner's note: *"We need to add a workplan that builds this feature,
  because someone might ask it and when we need to deliver the dump/export."*
- **terms-s11-export**, answered (a), *"Promise the migration records, made on request"*. Terms
  §11 (draft 1.3) now says: if we discontinue the service, *"you get at least 90 days' notice
  and, if you ask for it, an export of your migration records: what was copied, what could not
  be, and why."* The Alpha conditions §2 keep that export during the Alpha. The owner's note:
  *"as mentioned above: draft the export function in a workplan"*.

A third answer points the same way. **privacy-portability-note**, answered (a), *"Keep the note
and add one sentence"*: privacy §10 (draft 1.2) now says *"What we hold about you ourselves
(§4), we send you in a common file format if you ask."* And **privacy-read-log-copy**, answered
(a), *"Keep it, answered by hand"*: privacy §4.5 promises what our support log records about a
person, sent on request, from one query in the operator runbook.

Nothing is built. Every task is 📋 **Proposed**; none is parked. Until T1 and T2 exist, the
operator makes the export by hand (T0). The order is in §4: the recipe by hand now, the command
before the first business customer or before any notice that the service is discontinued,
whichever comes first.

| Task | Status | Notes |
|---|---|---|
| T0 The export by hand, written down | 📋 **Proposed** | §3. A recipe in `docs/operator-runbook.md`, *Tenant offboarding*: which reads make the records, how the file is sent, and when it is deleted. It answers a request during the Alpha. |
| T1 One builder for the migration records | 📋 **Proposed** | §3. Per migration: every item, its outcome in words, and the reason when it was not copied. One CSV per migration beside the completion report, which already exists. A pure builder in `packages/shared`, a reader beside `confirmed-list-read.ts`. |
| T2 The operator's command | 📋 **Proposed** | §3. `operator.sh export <tenant-id> --by <subject> --reference <request>`: the whole organisation, into one file in a directory of its own on the machine, recorded in the audit log. Reads as `app_user`, through T1's reader. Works on a closed organisation until its purge. |
| T3 Delivery, and deletion after delivery | 📋 **Proposed** | §3. Sent to the account holder's address on record, then deleted from the machine. A daily backstop deletes any export older than 7 days, and the purge deletes any that is left. |
| T4 What we hold about a person | 📋 **Proposed** | §3. Privacy §10 and §4.5: the request for access, the membership, the audit log's lines about them, and what the support log records about their organisation, as a second part of T2's file. |
| T5 The owner downloads it in the app | 📋 **Proposed** | §3. One button for the organisation's owner, on the same builder. After T2, and not before the first invitation. |
| T6 The texts say where the file goes | 📋 **Proposed**; the pointers ✅ **done 2026-09-28** (the DPA and terms briefings, the comment beside DPA §10, `site/legal/README.md`) | §3. A row in privacy §9 for an export we made and sent, both languages. |

## 1. What there is today

Every file and line below was read on branch
`claude/ownpace-public-readiness-y7orc6-the-privacy-policy-and-terms-revisited` on 2026-09-28,
except where `main` is named.

### What the texts promise

- **Terms §11, second paragraph** (1.3, draft): the migration records on request, if we
  discontinue the service. The Alpha conditions §2 set that paragraph's notice periods aside and
  keep its export.
- **DPA §10** (0.2, draft, English only, unpublished until the first business customer): the
  migration records first, if the controller asks before the deletion; then everything is
  deleted. A comment beside it says the app has no export and the records are made by hand.
- **Privacy §10** (1.2, draft): what we hold about a person ourselves (§4), in a common file
  format, on request. **Privacy §4.5**: what our support log records about a person, on request.
- None of them sets a deadline. The GDPR's month for a request under Art. 15 or Art. 20
  (Art. 12(3)) applies to privacy §10.

### What the product already makes, per migration

- **The completion report** (workplan 0047). `GET /api/migrations/:mappingId/completion-report`
  (`apps/api/src/routes/migrations/operating-routes.ts`, the route after `/moves`) gathers each
  domain's status, the failures, the items left as they were, the moves, the deletions, the
  apply receipts and the sharing checklist. `buildCompletionReport` and
  `renderCompletionReportMarkdown` (`packages/shared/src/completion-report.ts`) turn them into
  one Markdown document, *"the deliverable an owner downloads and hands over"*. It holds counts
  and the open queues, not a line per item. The web app offers it on the Finish page and the
  migration's page (`apps/web/src/components/CompletionReportDownload.tsx`). The appliance serves
  the same builder at `/mappings/:id/completion-report` (`apps/selfhost/src/index.ts`).
- **The confirmed list as CSV.** `GET /api/migrations/:mappingId/confirmed-list/export` streams
  every item of a migration (`streamConfirmedListCsv`,
  `packages/orchestration/src/confirmed-list-read.ts`). Its columns are `domain`, `collection`,
  `item`, `name`, `state`, `claim` and `checked_at` (`confirmedListCsv`,
  `packages/shared/src/confirmed-list.ts`). It starts with a byte-order mark, quotes by RFC 4180,
  and defuses a cell that a spreadsheet would read as a formula. Its `state` answers *"is it on
  the target, and how do we know"*. Every item that was not copied (`failed`, `skipped`,
  `left_behind`, `superseded`, `pending`) is `never-placed`, with no reason.
- **The failures.** `GET /api/migrations/:mappingId/failures` lists the items that failed, with
  the ledger's `last_error` (the provider's own words) and `last_error_category` (the kind of
  failure, in the vocabulary the screens translate).
- **The ledger row** (`item` in `packages/ledger/src/schema-pg.ts`) holds per item: the domain,
  the collection, the natural key, the name a person knows it by (`display_name`, migration
  0050), the size, the status, `last_error` and its category, `repaired` (what we corrected in
  the item's bytes), when it was first seen and last copied, and what the target said when it
  was last re-read. It holds no body, attachment or file content (privacy §4.2).

### What the operator has

- **The audit export**, `GET /api/support/audit-export` (`apps/api/src/routes/support.ts`): the
  audit log as NDJSON lines for a log store, across every customer, with addresses and file names
  replaced by pseudonyms. It is the operator's, recorded in the support log, and it is not a
  customer's records: it is pseudonymised and covers everybody.
- **`operator.sh close <tenant-id> <window-days> --by … --reference …`**
  (`apps/api/src/scripts/operator-close.ts`, 0139 T7): closes an organisation with the window the
  tester chose (0, 7, 30 or 90 days, `CLOSE_WINDOWS_DAYS`), and records it in the audit log. The
  offboarding module says closing *"makes the account read-only"*, and the purge comes when the
  window runs out (`packages/managed/src/offboarding.ts`). On `main` since #1320 (d7868276), a
  member of a closed organisation can still sign in, read and export until the purge:
  `apps/api/src/closed-organisation.ts` says *"Reading, export, the close itself and the reopen
  are never refused"* and *"`authenticate` never asks, because the owner reopens through it"*.
  So the completion report and the confirmed list's CSV can be downloaded during the window.
  This holds on this branch only once it merges `main`.
- **The purge** deletes the tables in `PURGED_TABLES`, `item` among them, and leaves an erasure
  record with dates and counts. After the purge nothing is left to export: the records must be
  made before it.
- **No zip writer.** The repository reads zips (`packages/connectors/src/zip-archive.ts`, and
  `packages/shared/src/container-hash.ts`) and writes none; `packages/connectors/src/crc32.ts`
  exists. No zip package is installed.
- **Where secret-bearing files already live on the machine:** the Trigger.dev dumps, under
  `~/.persistent/<project>/trigger-backups` (`deploy/compose/trigger-version.sh`). The exports
  follow the same pattern, in a directory of their own.

## 2. The owner's decisions (2026-09-28)

- The export is **the migration records: what was copied, what could not be, and why**
  (terms-s11-export (a); dpa-q3-return-of-data (c)). Not everything the service holds, logs and
  history included: that was option (b) of terms-s11-export, which the owner did not choose.
- It is **made on request**. During the Alpha it is made by hand until the command exists.
- **Build the feature**: *"We need to add a workplan that builds this feature, because someone
  might ask it and when we need to deliver the dump/export."*
- What we hold about a person is sent **in a common file format** (privacy-portability-note (a)),
  and what the support log records about them **by hand** (privacy-read-log-copy (a)).

## 3. What each task does

### T0 — the export by hand, written down (proposed)

A section in `docs/operator-runbook.md`, under *Tenant offboarding*, working title *An export on
request*:

- **Before the purge.** The records exist until the organisation is purged. A request that
  comes with a close is answered before the window runs out. With a window of 0 days, the
  export is made before `operator.sh close` runs.
- **The reads.** For each migration of the organisation: the completion report and the confirmed
  list's CSV, which the routes above already make, and the failures with their reasons. Until T2
  exists, the operator either signs in as a member of the organisation (the support screens
  cannot show items, by design), or runs read-only queries over the owner connection. Row
  security is not in force there (the owner is a superuser, `docs/rls-guide.md`), so each query
  names the organisation, and that filter is what keeps others out. The runbook gives the
  queries, with the columns T1 names, so two exports made by hand look the same.
- **Privacy §4.5's query**: what `support_read` records about one organisation, for the
  request privacy-read-log-copy (a) keeps.
- **Sending and deleting**, as T3.
- **What is recorded**: the reference of the request, the date sent, and the file's size and
  counts, in the audit log or the support mailbox's thread. Never the content.

**Guard.** None: a recipe. `a-recipe-the-env-file-could-not-answer.unit.test.ts` already holds
the runbook's commands to what the wrapper can run, and the queries go through `operator.sh`'s
connection, not a line typed from `.env`.

### T1 — one builder for the migration records (proposed)

- **A pure builder in `packages/shared`**, working name `migration-records.ts`, used by both
  editions (rule 5), as the completion report is. Input: a migration's items as the ledger
  keeps them, and its description. Output: CSV text.
- **One row per item**, with these columns: `domain`, `collection`, `item` (the natural key),
  `name` (`display_name`), `outcome`, `reason`, `provider_said`, `size_bytes`, `first_seen_at`,
  `last_copied_at`, `repaired`, and the confirmed list's `state` and `checked_at` where a
  confirmation pass ran.
  - `outcome` is the status in words: *copied*, *updated*, *already there* (`adopted`), *not
    copied: failed*, *not copied: skipped*, *left behind on your decision* (`left_behind`),
    *replaced by a later version* (`superseded`), *waiting* (`pending`), *removed on your
    decision* (`tombstoned`), *deleted at the source* (`deleted_source`).
  - `reason` is the failure's category in words, from the same vocabulary the screens use.
    `provider_said` is `last_error`, verbatim (open question 4).
- **Beside it, per migration**, the completion report's Markdown, from the builder that already
  exists, so the counts in the export and on the screens are one set of numbers.
- **The CSV rules are the confirmed list's**: a byte-order mark, RFC 4180 quoting, and the
  formula defusing. One helper, shared, not a second copy of `csvField`.
- **What is never in it**: a credential, a token, a connection's configuration, `source_ref` and
  `target_ref` (the providers' own identifiers, which may carry more than the person needs), and
  anything from another organisation.
- **A reader** beside `confirmed-list-read.ts`, in `packages/orchestration`: it walks the items
  in pages under the organisation's row security (`withTenant`), and writes as it reads, as
  `streamConfirmedListCsv` does, so a family-sized account is never held in memory.

**Guards.** Each fails today, because nothing makes these rows:

- `packages/shared/src/migration-records.unit.test.ts`: every item status the ledger's enum
  allows has a word in `outcome`, so a new status cannot be added without one (read from the
  enum, never typed out). A failed item carries its category's words and the provider's words;
  a copied one carries neither. A name that starts with `=` is defused. The header is the
  columns above, in that order.
- `packages/orchestration/src/migration-records-read.integration.test.ts`, against a real
  database as `app_user`: the rows equal the ledger's items for that migration, no more and no
  fewer; another organisation's items never appear; the counts equal the completion report's.
- A case that no column name matches a credential or configuration field of the schema
  (`secret_ref`, `source_secret_ref`, `config`, `source_ref`, `target_ref`).

### T2 — the operator's command (proposed)

- **`operator.sh export <tenant-id> --by <your-subject> --reference <the request>`**, a new `export`
  sub-command of `apps/api/src/scripts/operator.ts`, in the shape of `close`
  (`operator-close.ts`): a parser that refuses a missing flag by name, and a runner. It is
  managed-only, like `close`.
- **What it writes**: one file per organisation, holding T1's CSV and completion report for each
  migration, and a short index in both languages that says what each file is and when it was
  made. The file's form is open question 1.
- **Where**: a directory of its own on the machine, `~/.persistent/<project>/exports/`, created
  with mode 0700, each file 0600. The name holds the organisation's id and the date, never a
  person's name or address. The path is built from the Compose project, as every name on the box
  is (`two-stacks-on-one-box.unit.test.ts`).
- **Who may run it**: an appointed operator, checked over the owner connection as `close`
  checks it.
- **How it reads**: the organisation's rows go through T1's reader, inside `withTenant` on
  `APP_DATABASE_URL` (`app_user`), so row security holds on this path as it does on the API's,
  in workplan 0138's direction, and T1's guard covers it. `operator.sh` supplies that URL beside
  the owner's, from `.env`'s `APP_DB_USER` and `APP_DB_PASSWORD`; `docs/rls-guide.md` names the
  connection. The command never falls back to `DATABASE_URL` for these reads. `withTenant`
  needs no membership, and a closed organisation stays readable until its purge (§1).
- **Recorded**: one audit row in the organisation's log, with the operator's subject, the
  reference, the number of migrations and items, and the file's size. No content.
- **A closed organisation** can be exported until its purge. A purged one answers that nothing
  is left, and names the erasure record's date.
- **The three files agree** (`a-verb-three-files-have-to-agree-on.unit.test.ts`): the verb is in
  `operator.sh`'s header and its usage block, in `apps/api/package.json` as `operator:export`, and
  a `case` in `operator.ts`.

**Guard.** `apps/api/src/scripts/an-export-the-operator-makes.unit.test.ts`, against PGlite, in
the shape of `an-account-a-tester-can-end.unit.test.ts`. It fails today:

- the file holds one CSV and one report per migration, with the counts the ledger has;
- refusals: no `--by`, no `--reference`, a subject that is not an operator (nothing written), an
  id that is not an organisation, a purged organisation (says so, writes nothing), no
  `APP_DATABASE_URL` (says so, writes nothing, and does not read the items on the owner
  connection instead);
- a closed organisation within its window is exported;
- the directory is 0700 and the file 0600, under the project's directory;
- the audit row names the operator and the reference, and holds no item name.

### T3 — delivery, and deletion after delivery (proposed)

- **To whom**: the owner of the organisation, at the address our sign-in service holds for them,
  or for a business customer the contact the DPA names. Never to an address given only in the
  request, unless it matches one of those. The person asking is checked as privacy §10 says.
- **How** (open question 3): during the Alpha, as an attachment to a mail from
  `support@ownpace.eu`, through Proton, which the texts already name. A copy of that mail stays
  in the Sent folder under the support-mail rule (privacy §9, privacy-sent-mail-copies (b)):
  until the request is resolved, then 6 months.
- **Deleted from the machine** once it is sent: `operator.sh export --sent <file>` deletes it and
  records the date in the audit log. A daily duty in `box-duties.sh` deletes any export older
  than 7 days, as a backstop, so a file nobody sent does not stay. The purge of an organisation
  also deletes its exports that are left.
- **Never in the copy before an update.** The exports directory is outside the databases, so the
  copy (privacy §9, rec-copies (a)) does not hold it; the guard says so.

**Guards.** In `a-duty-the-gate-used-to-do.unit.test.ts`, which already holds `box-duties.sh`'s
duties: a duty `exports` that deletes files older than 7 days under the project's exports
directory and nothing outside it. In T2's guard: `--sent` deletes the file and writes the audit
row; the purge (`offboarding.unit.test.ts`) deletes an organisation's leftover exports.

### T4 — what we hold about a person (proposed)

- **Privacy §10** promises what we hold about a person ourselves (§4), in a common file format.
  During the Alpha that is: the request for access (`access_request`), the membership, its role
  and whether it came from an invitation or a request, with its dates (`tenant_member`), the
  audit log's lines that name them, what the support log records about their organisation (privacy §4.5), and the invoice
  details they typed on the Billing page, if any. The sign-in account (name, email address, user
  name, sessions) is in our sign-in service, and is read from its console or API.
- **In T2's file, as a second part**, with `--about <subject>`: one CSV per kind of record, in
  the same form as T1. The support log's part is privacy-read-log-copy's query, made once, here.
- **What it does not hold**: the password hash, the migration content (which is in the person's
  own target account, as privacy §10 says), and what the sign-in service keeps in its history
  (privacy §9), which is read by hand if asked.

**Guard.** In T2's guard: `--about` writes each part, for that subject only, and another
member's rows never appear.

### T5 — the owner downloads it in the app (proposed)

- **One button** for the organisation's owner, working place the account page, *Download your
  migration records*: T2's file, for the organisation, made on request and streamed, never
  stored. Both languages.
- **Owner only**: a member who is not the owner sees no button, and the route answers 403.
- **It works while the organisation is closed and not yet purged**: a member of a closed
  organisation can still sign in and read (§1; on `main` since #1320, on this branch once it
  merges `main`).
- Before the first invitation it is not needed: the operator's command covers every promise.

**Guard.** An integration test beside `me.integration.test.ts`: the owner gets the file with the
counts the ledger has; an admin gets 403; another organisation's owner gets nothing of it. A web
unit test: the button shows for the owner only, in both languages.

### T6 — the texts say where the file goes (proposed)

- **Privacy §9**, both languages: a row *An export you asked for*: deleted from our machine once
  it is sent, and at the latest after 7 days; the mail that carried it, under the support-mail
  rule. In the owner's review pass, while the draft markers are on, or as a change under privacy
  §13 afterwards.
- **The comments** beside DPA §10, and the DPA and terms briefings, point to this plan (done
  2026-09-28, with the plan). `site/legal/README.md`, *Before the draft markers come off*, names
  it under *Later* (done the same day).

**Guard.** None beyond `scripts/legal-docs.unit.test.ts`, which already holds both languages to
one version.

## 4. Order

1. **T0 now**, or at the latest on the first request. It is a recipe, and the texts promise the
   export from the first tester on.
2. **T1, T2, T3 and T4 together**, in one pull request with their guards, **before the first
   business customer** (DPA §10, 0086 T5), **or before any notice that the service is
   discontinued** (terms §11), whichever comes first. A request before then is answered by T0.
3. **T6** in the same pull request as T3, or in the owner's review of the texts, whichever comes
   first.
4. **T5** after T2, when the self-serve screens come (0144, W14 in 0131 §5). Not before the first
   invitation.

None of it is on 0131 T5's list for the first invitation.

## Lessons that apply

Grep `docs/LESSONS.md` for each file before editing it (`AGENTS.md`, session protocol). On
2026-09-28 it lists these for the files this plan touches:

- `apps/api/src/scripts/operator.ts` and `deploy/compose/operator.sh`:
  `a-verb-three-files-have-to-agree-on` (the verb in three files),
  `a-recipe-the-env-file-could-not-answer` (a documented command must be runnable),
  `two-stacks-on-one-box` (every name follows the project), and
  `every-audit-field-is-classified` (a new audit row's fields are classified, or the audit export
  fails).
- `packages/shared/src/confirmed-list.ts`: `a-list-somebody-deletes-on-the-strength-of`. The
  export must not put *verified* on a row the confirmed list would not.
- `deploy/compose/box-duties.sh`: `a-duty-the-gate-used-to-do` and `a-first-bring-up-of-live`.

## Not in this plan

- Moving the content itself. It is already in the customer's own target account; that is the
  product (privacy §10, DPA §10).
- The audit export for a log store (0129 T4). It serves the operator, pseudonymised, and stays
  as it is.
- The erasure and its windows (0085, 0139 T7).
- An export of the sign-in service's own history (privacy §9). It is read by hand if asked.
- The DPA's other corrections, and its publication (0086 T5).

## Open questions

1. **The file's form (T2).**
   - (a) One zip per organisation, with a folder per migration. *Recommended*: one attachment,
     opens on every computer. It needs a small writer: stored entries only, with the CRC-32 the
     repository already has, and a guard that `zip-archive.ts` reads back what it wrote.
   - (b) A folder of files on the machine, attached one by one. No writer, but many attachments.
   - (c) One CSV for the whole organisation, with a `migration` column, and the reports as
     separate files.
2. **Who starts it first.**
   - (a) The operator's command first (T2), the button later (T5). *Recommended*: it covers every
     promise, including a closed organisation and a business customer's controller.
   - (b) The button first. It does not help once an organisation is closed at 0 days, or once
     the service is discontinued.
3. **Delivery (T3).**
   - (a) A mail from `support@ownpace.eu` with the file attached, deleted from the machine once
     sent. *Recommended* during the Alpha: the provider and the mailbox are already in the texts.
     A copy stays in Proton's Sent folder under the support-mail rule.
   - (b) A download link in the app, valid 7 days, for the owner only. More code; no copy in a
     mailbox.
   - (c) (a) during the Alpha, (b) once T5 exists. *Also reasonable.*
4. **The provider's own words (T1).** `last_error` can quote a provider's message, which can name
   an address or a folder.
   - (a) Include it verbatim beside the category's words. *Recommended*: it is the customer's own
     migration, and *"why"* is what the texts promise.
   - (b) The category's words only.
5. **The language of the columns and words.** English headers with Dutch and English words in
   the index, or the whole file in the language of the person's account. *Recommended*: headers
   in English, as the confirmed list's are, and `outcome` and `reason` in the account's language.
6. **A deadline.** The texts set none. *Recommended*: none in the texts; the GDPR's month applies
   to privacy §10, and the runbook aims at 7 days.
