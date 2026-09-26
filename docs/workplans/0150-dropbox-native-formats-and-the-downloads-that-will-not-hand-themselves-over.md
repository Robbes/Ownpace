# Workplan 0150 — Dropbox native formats, and the downloads that will not hand themselves over

> **In one line:** Dropbox entries marked `is_downloadable: false` (Paper docs as `.paper` files, and any other kind T2 finds) refuse `files/download` with 409 `unsupported_file`; export each kind in the user's chosen format via `files/export`, or state a refusal and park it on first sight, as Drive does.

## Status — 2026-09-26 (update this block at the end of every session)

**2026-09-26, later still: the owner answered open question 4, and D9 was checked against the
code.** The owner, word for word: *"open question 4: (a), policy_refused as recommended"*. So a
Paper doc states `policy_refused` before T3 as well as after, and the Failures page chooses its
remedy by the migration's source as well as by its category, so a Dropbox migration's Paper docs
are not told to use Google's setting (D9). That change is part of T5, in the alpha minimum. D9 as
first written named four screens. A review against the code found that the Failures page shows the
remedy in two files, its rows and its group panel, and that the other three screens read a
domain-level category that never holds `policy_refused`. So T5 now changes the two places on the
Failures page only, and the failures payload carries the migration's source for them (T5, D9).
Open question 4 keeps its text, with the answer under it. Three things stay open: T1's evidence
(open question 1), the owner's own words (open question 2), and T2's listing of the owner's
account (open question 3).

**2026-09-26, later: the correction reviewed, and the branch rebased on `main` at `979c7974`.** A
review of this correction against the code found it wrong in places, and each is fixed here. Only an
item that is fetched and written resets the 25-in-a-row tripwire, so once the rest of the tree is
copied, 25 Paper docs still being retried stop a pass, whatever folders they are in (T1 (b), defect
2). That is a new candidate for T1's open half. A row at the ceiling waits on a person with
`parked_at` NULL; only a decision error is parked (T1, T8). A tombstone carries no
`is_downloadable`, so the trash read can name a Paper doc only by its extension (T3 (b)). This
correction had written the category a Paper doc states before T3 as a decision, but the owner's
answer does not settle it, so it is now open question 4 (answered later the same day: D9). #1194
merged on 2026-09-26, so the consent asks for `account_info.read` and T7 (a) has its scope. T8
now has the owner press Retry before recording, and counts for 0141 T3 only under 0141 T3's own
conditions. Dropbox's missing 429 handling has a home now, 0055 T3 (e).

**2026-09-26: corrected against the code, and the owner's decisions recorded.** At the owner's
request 0150 was checked against `main` at `dff5af13`, and against Dropbox's API spec
(`dropbox-api-spec`) and SDKs on GitHub. dropbox.com was not reachable from the check, so every
Dropbox fact below that no real account has shown is marked as such. When this correction was
written, every file and line of this repository it cites was read again at `main` `e9abd451`. After
the rebase, the files that changed on `main` since then were read again at `979c7974`, so every line
number of this repository's code and docs below is `979c7974`'s. The spec's lines are those of
`dropbox-api-spec` at `404afad5`, and rclone's those of its `master` at `9dc8b71a`, both read on
2026-09-26. T1's two mechanisms were wrong. The Paper 409 reads `source_refused` today, not
`target_refused`. And one failing file cannot stop a pass, though 25 Paper docs still being retried
in one pass can (T1 (b)). So T1 is 🟡, and the cause of "no other file moves" is open. The Dropbox
names in T3, T4 and *The shape of the fix* were not Dropbox's (`export_as_html`,
`export_as_markdown`, `e_tag`, `unsupported_export_type`). The exported name is chosen at listing,
because it is the natural key. An exportable Paper doc with no format chosen is `policy_refused`
once a format can be chosen (D1), and before that as well (D9). T6 (b) was already built. The
owner was then asked whether to open this correction with the recommended answers, and answered:
*"yes, open the 0150 docs PR with your recommendations"*. Those answers are D1 to D8
(*Decisions*). Four things stayed open: T1's evidence (open question 1), the owner's own words
(open question 2), T2's listing of the owner's account, which decides open question 3 and is
needed before T3, and the category a Paper doc states before T3 (open question 4, since answered:
D9). Nothing is built.

**The alpha minimum (decided, D6):** T5 and T6 (a), T9's lines in the Dropbox docs and guides and
its feature-matrix row, and a 0144 known-limitations entry. Until T3 lands, the refusal points to
no setting, and it states `policy_refused` with a remedy that names none (D9). One part of the
recommendation did not hold: 0144's page is itself planned for after the first invitation (0144
T2), so until it exists a tester reads the limit in the Dropbox guides (T9), and the 0144 entry is
written with 0144 T2 (D6). **After:** T3, T4 and T7 (a). An M group builds the plan: M8 in 0131 §6
(D7).

| Task | Status | Evidence |
|---|---|---|
| T1 the live failure, read from the wire | 🟡 **Partly diagnosed** (2026-09-25; corrected 2026-09-26). The open half ⏳ **Owner** (open question 1) | **Known.** The owner's managed migration met `"_ Aan de slag met Dropbox Paper.paper"`, and `files/download` answered 409 `unsupported_file`. This plan first quoted the error as `Dropbox refused the download of "…paper" (409): {"error":{".tag":"unsupported_file"}}`, with the path shortened. The full text, and the screen or row it was read from, were not recorded (open question 1). `download()` throws a bare `Error` with no stated category and no decision mark (`dropbox-file-source.ts`:383-385). Dropbox's spec says what the tag means: *"This file type cannot be downloaded directly; use :route:`export` instead."* (`files.stone`:1002-1005). **Not as first written.** (a) The row reads `source_refused`, not `target_refused`. `fetchRaw` is `sided('source', deps.fetchRaw)` (`domain-sync.ts`:880), and the matching rule turns a source-side refusal into `source_refused` (`failure-category.ts`:324-328, :366). So the owner is told the old account would not hand the file over (`strings.ts`:1340-1341). The code has worked this way since 2026-09-17. Only a `.paper` listed above 8 MiB would read `target_refused`, because it is downloaded inside `body.open()` (`dropbox-file-source.ts`:411-417) under the target's `upsert` (`domain-sync.ts`:892). (b) One file cannot stop a pass. `consecutiveFailures` lives for one pass (:969). Only an item fetched and written resets it (:1713); an item skipped before the fetch does not (:1402-1414), and neither does one that waits on a person (:1444-1456). The per-item catch carries on (:1746). The file is tried on 5 passes, then waits on a person and is not fetched again (`MAX_ITEM_ATTEMPTS`, `ports.ts`:1896; `domain-sync.ts`:332, :1445). Its `parked_at` stays NULL, because only a decision error is parked (:1860; `ledger.ts`:564, :844). **Open: why "no other file moves".** First read the owner's pass summaries (created, skipped, failed, needs decision), whether any pass ended with a stop, and the `.paper` rows (`last_error_category`, `attempt_count`, `parked_at`), with how many have `attempt_count` below 5. Candidates: (1) once the other files are copied, later passes show created 0 and skipped N beside one failure, which can read as "nothing moved". (2) An account holding 25 or more Paper docs: once the rest of the tree is copied, every Paper doc still being retried counts toward 25 in that pass, whatever folder it is in, and the 25th stops the pass (`PassAbortError`, :1909-1916). A stopped pass does not reach the folders listed after the 25th failure, so new or changed files there do not move until the Paper docs reach the ceiling. #1182's root-path 409 is ruled out for the passes that show the Paper 409, because those passes listed the root first (`domain-sync.ts`:1170). 0128's per-data-type stop (#1174, #1179) is not yet ruled out. |
| T2 the native-format inventory, before any code | 📋 **Proposed** (the rule, from the API spec); ⏳ **Owner** (a listing of the owner's account) | **The rule.** Dropbox states on every listed file whether it must be exported. `is_downloadable` means *"If true, file can be downloaded directly; else the file must be exported."* `export_info` *"must be set if is_downloadable is set to false"*. It holds `export_as` (the default format) and `export_options` (the others) (`files.stone`:822-826, :693-702). The kind table keys on these fields, with the extension as the kind's label. `DropboxEntry` carries neither field today (`dropbox-file-source.types.ts`:56-67). T5 needs only this rule. T3 and T4 also need the listing. **Record from a real listing, per kind** (open question 3): `is_downloadable`; `export_info`; whether `files/export` answers, and with which `export_format` values; the listed size; and whether `content_hash`, `rev` or `server_modified` moves after an edit. The version decides a rewrite (`domain-sync.ts`:350-354; `dropbox-file-source.ts`:451). **Kinds to look for:** `.paper` and `.papert`. `.web`, Dropbox's own shortcut: reported as not downloadable, and one report (rclone issue #8391) says it exports in a `url` format; not checked. Any `.gdoc`/`.gsheet`/`.gslides` left in the account: the spec's own export example turns `Prime_Numbers.gsheet` into `Prime_Numbers.xlsx` (`files.stone`:1664, :1682). `.url` and `.webloc` are ordinary files that download and migrate today; they are not native kinds. |
| T3 the arrival format per kind, chosen by the user and named at listing | 📋 **Decided 2026-09-26** (D1, D4, D5, D7, D8). **After** the alpha (D6) | The owner asked that the user picks the format that arrives (*The owner's words*). **(a) The values.** A kind's choices are the wire's `export_format` strings for it: `html` and `markdown` for Paper, which is what rclone sends (rclone `master` at `9dc8b71a`, `backend/dropbox/dropbox.go`:141-144). Each file's choice is checked against its `export_as` and `export_options`, as rclone does (:1802-1806). The stored setting may use repo-style names mapped to them. A kind with no export path offers no format. No format chosen means refuse (D1). The wizard shows the Paper picker for every Dropbox migration that carries files, and suggests Markdown (D1). **(b) The name is chosen at listing.** The sync loop writes under the listed path and keeps only the bytes from `fetch()` (`dav-sync.ts`:382, :392, :406; `webdav-target-writer.ts`:252, :799). So `listSince`/`toFileItem` name each native entry under the policy in force, as Drive's `exportedNameUnder` does (`google-drive-source.ts`:227-237, :466). The rule is D4's: the suffix is appended, so `Notes.paper` arrives as `Notes.paper.md`. That name is the natural key. Each entry carries `formerPaths` for its names under every other policy, `refuse` included (`google-drive-source.ts`:1116; `dav-sync.ts`:409). So a switch closes a row parked under the old name (`supersedeFormerNames`, `ports.ts`:1683). `sourceIdentity` is the Dropbox id; its comment says it is set only for a Google document today (`file.ts`:103-114). `listKeys` uses the same naming, because it answers from the same listing (`dropbox-file-source.ts`:273-280). `listTrashedPaths` cannot: a tombstone (`.tag: "deleted"`) carries neither `is_downloadable` nor `export_info`, only the fields every entry has and `is_restorable` (`files.stone`:765-788, :896-899), and the source reads only its `.tag` and `path_display` (`dropbox-file-source.ts`:301-314). So a tombstone is the one place the rule falls back to the extension (`.paper`, `.papert`): `listTrashedPaths` emits both the listed name (`Notes.paper`) and the name under the policy in force. A key no ledger row holds resolves to nothing downstream (:296-299), and a row parked under `refuse` still carries the listed name. Drive's own bin read does not rename at all (`google-drive-source.ts`:864, in `originalPathOf`). The version stays the listing's `fileVersion(content_hash, server_modified)` (`dropbox-file-source.ts`:451; ADR-0046, #1083), never the export's hash. **(c) The places the setting passes through,** as Drive's does. D7: the key is `nativeFilePolicies`, reused with a `paper` kind. So the Google-typed kinds and values widen (`google-native-coverage.ts`:110; `config.ts`:214, :1278-1283), and the update door's check becomes source-aware: today it runs the Google parser for every source and would answer 400 (`apps/api/src/routes/migrations/index.ts`:1760). Export a `parseDropboxSource` from the Dropbox branch (`config.ts`:1046-1052, today inside the private `parseSource`, :977) and call it from the create and update doors, as Drive's `parseGoogleDriveSource` is called (`index.ts`:195). It then becomes the one authority for both editions. Today managed builds the Dropbox config itself (`index.ts`:201-205), and the create door's gate and that config drop a setting sent today without a word (:509, :201-205). The factory hands the source `rootPath` and the endpoints only (`dropbox-source-factory.ts`:97-101). Managed's builder hands it `rootPath` only, read straight from the stored JSON (`build-deps-from-mapping.ts`:1110-1111); it reads the policy through the same parser, as the create door does. The wizard's gate and the settings panel's both ask `carriesGoogleNativeFiles` (`CreateMapping.tsx`:1364-1365; `ExportPolicyPanel.tsx`:214; `google-native-coverage.ts`:248). Also: the panel's title (`strings.ts`:557 EN, :2890 NL); the Dropbox remedy sentence T5 adds (D9), which from T3 on names the new setting, while `failure.policyRefused` stays Drive's, word for word (`strings.ts`:1328-1329, :2403-2404); the `source.nativeFilePolicy` revision rule, its consequence and snapshot (`config-revision.ts`:66, :136-145, :394), with 0125's wording; `openapi.yaml`:1885-1898; and the appliance's mapping key with `dropbox-setup.md` §3. The web `MaskedConfigSchema` already names both keys (`mapping-service.ts`:211-238), so D7 needs nothing there. The values stay `z.string()`, with no API enum. T8's export half, on the existing mapping, needs the update door. **(d) Before Start.** Add a `nativeRefusals()` count on `DropboxFileSource` for the confirm screen (`run-discovery.ts`:167-170; `native-refusals.tsx`). It counts `policy_refused` files only, as Drive's does, because the confirm line offers a format as the remedy (`google-drive-source.ts`:459, :1206-1209; `strings.ts`:117-118). Add a `paper` entry in `native-kind-key.ts`, with EN/NL `discovery.refusedNative.kind.paper`; today an unknown kind reads "Google files" (`strings.ts`:105). **(e) Done when** ADR-0046's operative rule names Dropbox: a rewrite follows the listing's version, and a renamed export is paired by the Dropbox id (D8). **Guards:** a listing under a Paper format names the entry and its `formerPaths`, and a second pass creates nothing (extend `dropbox-file-source.unit.test.ts`:111; fails today, because no entry is renamed). The tombstone tests (:322) pin that a deleted `.paper` is emitted under both names. A PUT to `/api/migrations/:mappingId` on a Dropbox migration carrying a `paper` format in `nativeFilePolicies` is accepted and written (400 today, from `UpdateMappingSchema`, `index.ts`:1760): add a Dropbox case beside the 400 case in `apps/api/src/routes/migrations/a-format-that-had-to-fit-all-four-kinds.unit.test.ts`:349, and a merge case in `a-setting-the-route-dropped-in-silence`. Extend `a-policy-the-client-threw-away` and the chooser guard `a-chooser-one-google-kind-could-not-reach`, or add a Dropbox sibling. |
| T4 the export path | 📋 **Decided 2026-09-26** (D2, D8). **After** the alpha (D6) | `POST https://content.dropboxapi.com/2/files/export` with `Dropbox-API-Arg: {"path": <id>, "export_format": <value>}`. It uses the same content host and header argument as `download()` (`files.stone`:2753-2764, `host = "content"`, `style = "download"`), the same id (`sourceRef`, `dropbox-file-source.ts`:454), and the same scope, `files.content.read`, which the consent asks for since #1194 (`DROPBOX_CONSENT_SCOPES`, `dropbox-consent.ts`:50-53, set on the URL at :80) and which every migration's token must carry (`DROPBOX_REQUIRED_SCOPES`, :38-41). **A preview route (D2).** Dropbox marks it `is_preview = true`, *"subject to breaking changes without notice"* (`stone_cfg.stone`:11-13); `files/download` is not marked (`files.stone`:2727-2736). A contract test pins the request and the result, and T8 records the live answer. An answer the code does not recognise stays an ordinary, retryable failure (T5). **The result** is `export_metadata` (`name`, `size`, `export_hash`, `paper_revision`) plus `file_metadata`, in the `Dropbox-API-Result` response header (`files.stone`:1669-1690). There is no `e_tag`. The name comes from the listing (T3 (b)). The header can only confirm it, through an optional `headers` on `DropboxTransport`'s response, added like `body?` (`dropbox-file-source.types.ts`:18-35). **Before the size gate, always buffered.** `fetch()` decides the kind before `item.size > STREAM_FILES_LARGER_THAN_BYTES` (`dropbox-file-source.ts`:411, 8 MiB). An export returns `content` with `item.size = bytes.byteLength`. It never returns a `FileBody` whose `sizeBytes` is the `.paper` listing size (:415), which the target would send as `Content-Length` (`webdav-target-writer.ts`:958). Drive does the same (`google-drive-source.ts`:948, :968, :994). The export is read as bytes, never as text. **Done when** ADR-0046's amendment (D8) covers the export as built. **Guard:** a `.paper` listed above 8 MiB under an export policy returns buffered `content` from one `files/export` call, and never a body. Add it as a Dropbox sibling of `a-drive-file-that-has-no-size-until-it-exists`. It fails today, because the file goes to `files/download` in the streamed branch. |
| T5 a stated refusal, in the category a setting would change | 📋 **Decided 2026-09-26** (D1, D5, D6, D9). **Alpha minimum** | Split as Drive's `NativeFileRefused` does, by *"WHETHER A SETTING WOULD CHANGE THE ANSWER"* (`google-drive-source.ts`:143-205; the owner's choice of 2026-09-18, `failure-category.ts`:113-125). The listing reads T2's rule: `DropboxEntry` gains `is_downloadable` and `export_info`, and the item carries what `fetch()` needs to decide before any download and before the size gate, so the side stays `source`. An exportable kind with no format chosen, or with `refuse`, STATES `policy_refused` and names the setting (D1; `failure-category.ts`:134-143). A kind with no export path states `source_refused` (D5). **Before T3** there is no setting to name (D6), and a Paper doc still states `policy_refused` (D9). Its message says Ownpace does not export Paper docs yet, and that it can be left behind. Until T3 that departs from half of the category's written definition, *"a setting on the mapping is what changed the answer"* (`failure-category.ts`:135-137), so T5 adds to that comment a kind this build does not export yet, whose remedy is chosen by source and names no setting until one exists (D9); T3 takes the addition out. The ledger's column comments say the same as the definition (`0051_a_refusal_that_was_ours.sql`:79-82, :96-99) and hold again from T3, so no migration changes them. **The remedy by source (D9).** `FAILURE_KEY` picks a remedy by category alone (`apps/web/src/i18n/failure-key.ts`:28-38), and `failure.policyRefused` speaks of Google files and names *Export format for Google files* (`strings.ts`:1328-1329, NL :2403-2404). An item's category reaches two places, both on the Failures page: each row (`Failures.tsx`:90) and, when more than one failure is queued, the group panel, which looks the remedy up in its own file (`apps/web/src/components/queues/FailureGroupPanel.tsx`:274; `Failures.tsx`:159-164). Both choose it by the migration's source as well: a Dropbox migration's `policy_refused` rows and group get a Dropbox sentence, in both languages, that names no setting until T3 and names T3's setting from then on. Drive's text stays as the owner worded it on 2026-09-22. **Where the source comes from.** Neither `ItemFailure` (`ports.ts`:1932) nor `FailuresQueue` (`operating-contract.ts`:151) carries it, and the page cannot ask for the mapping on the appliance, which has no mapping API (`MappingDetail.tsx`:123-124). So `FailuresQueue` gains the migration's source kind, set by both editions' `/failures`: managed reads the source connection's `kind`, as the completion report already does (`apps/api/src/routes/migrations/operating-routes.ts`:304-324; the route, :367), and the appliance reads its mapping's `source.type` (`apps/selfhost/src/index.ts`:1761). The page hands it to its rows and to `FailureGroupPanel`. **Not the domain-level screens.** The Connections page, the support view, the live progress and the progress link (`Connections.tsx`:374, `Support.tsx`:956, `LiveProgress.tsx`:187, `View.tsx`:127) show `migration_status.last_error_category`. Only `markFailed` writes it, from a message with no stated category (`migration-status-store.ts`:253), and no rule over a message yields `policy_refused` (`failure-category.ts`:346-348), so it cannot reach them, and they stay as they are. The progress link's own sentence (`view.failure.policyRefused`, `strings.ts`:1063-1064) names neither provider anyway. A row parked before T3 keeps its category until Retry is pressed (`ledger.ts`:875-879), or until a chosen format changes its key (T3 (b)). Every refusal carries `markNeedsDecision`, and names the file and the kind. **Export answers, by tag (from T4).** Drive's rule applies: *"A reason absent from this set is treated as retryable"* (`drive-refusal.ts`:54-59). `non_exportable` (*"This file type cannot be exported. Use :route:`download` instead."*) on an entry whose download was already refused is a stated `source_refused`; on any other entry it means the kind table is wrong. `invalid_export_format` is prevented by checking the choice against `export_as` and `export_options` first; if it still comes, it is a stated `policy_refused`. `retry_error` (*"The exportable content is not yet available. Please retry later."*), any other or unknown tag, 429 and 5xx are ordinary failures, with no decision mark and no stated category. They are retried, and still count toward the tripwire. `path/not_found` on the listed id means the file is gone since the listing; it is not a refusal. `unsupported_export_type` does not exist (`files.stone`:1014-1021). **Guards:** fetching a `.paper` with no format states its category and is a decision error (extend `packages/connectors/src/dropbox-file-source.unit.test.ts`). This fails today, because the code throws a bare `Error` (`dropbox-file-source.ts`:383-385). A `retry_error` and a 409 with an unknown tag are not decision errors (extend `a-refusal-we-wrote-and-then-could-not-read`). A Dropbox migration with two or more `policy_refused` failures shows the Dropbox sentence in its rows and in the group panel, in both languages, and a Drive migration's still shows *Export format for Google files* (beside `a-category-that-reached-a-screen-with-nothing-to-say.unit.test.ts`); this fails today, because the remedy is chosen by category alone. Both `/failures` answers carry the source kind: extend the appliance's case (`apps/selfhost/src/selfhost-queues.integration.test.ts`:314), and add one for managed's, whose route test lists the route only (`operating-routes.unit.test.ts`:58). The choice is made in one place, a `remedyKey(category, sourceKind)` in `failure-key.ts`, and a guard reads `apps/web/src` and fails on any file outside `failure-key.ts` that indexes `FAILURE_KEY` itself, apart from `Connections.tsx`, `Support.tsx` and `LiveProgress.tsx`, which it names with the domain-level reason above, so a new screen that shows an item's remedy cannot miss the source. |
| T6 park on first sight | (a) 📋 **Decided 2026-09-26** (D6), **alpha minimum**. (b) ✅ **Already built** | **(a)** T5's refusals are decision errors, so the file is parked on its first attempt, instead of waiting on a person after its fifth. It never counts toward the 25-in-a-row tripwire (`domain-sync.ts`:1771-1773). That matters for an account with 25 or more Paper docs: once the rest of the tree is copied, every one still being retried counts toward the same 25 in a pass, whatever folder it is in (T1 (b)). Drive met the same case: refused Google Forms stopped a whole pass over a folder of Docs (:1764-1770). Only the decision set T5 names parks; a transient export answer never does. This does not by itself explain "no other file moves" (T1); if T1 finds the tripwire candidate, T6 (a) is what removes it. **Guard:** extend `a-park-that-counted-as-five-attempts` with a Dropbox `.paper`, parked after one attempt (today it waits on a person after five and is never parked). **(b) Already built.** A failed item is recorded and the pass carries on (`domain-sync.ts`:1746; `failure-isolation.unit.test.ts`:137, :245). A Dropbox-shaped case there is a regression test, not a guard that fails today. |
| T7 Paper docs outside the file tree (legacy Paper) | (a) 📋 **Decided 2026-09-26** (D3), **after** the alpha (D6). (b) 🅿️ **Parked (trigger: the owner reopens D3, for instance when a tester asks for legacy Paper docs, or Dropbox offers a route for them that is not deprecated)** | When Dropbox's `paper_as_files` feature is off, *"the user's Paper docs are stored separate from Dropbox files and folders and should be accessed via the /paper endpoints"* (`users.stone`:71-76). `files/list_folder` is the only file listing the source makes (`dropbox-file-source.ts`:149, :167, and the probe's :227, :244), and it never returns them: no 409, no failure row, no count. Today the docs' *"Sharing state, file requests, Paper docs and version history stay behind"* covers them (`docs/dropbox-setup.md`:111). Once T9 changes that line, they need a sentence of their own. **(a) Detect and say so (D3).** One `users/features/get_values` call for `paper_as_files` (`users.stone`:355-361), and a stated line: "Paper docs outside the Dropbox file tree were not migrated". Its scope, `account_info.read`, is the one the source already needs for `users/get_space_usage` (`dropbox-file-source.ts`:211; `users.stone`:364-370). #1194 merged into `main` on 2026-09-26, and the consent URL now asks for it (`DROPBOX_CONSENT_SCOPES`, `dropbox-consent.ts`:50-53, set on the URL at :80), so (a) has its scope. The reason it had to be asked for, that Dropbox grants only the scopes the URL names, comes from Dropbox's OAuth guide as read in a search engine's excerpts (0140's Status, 0140:106-115); it was not checked here, because dropbox.com was blocked. 0140 §3's T7 (b) still names the two files scopes only (0140:725), and 0140's Status records the departure. A `missing_scope` answer is stated as "could not check", never read as "not legacy" (`account-qualification.unit.test.ts`:484). Summaries of Dropbox's migration guide say a `paper_as_files` account can also hold legacy docs (not checked). So the docs keep a general line too (T9). **(b) Their export** needs `paper/docs/list` and `paper/docs/download`, which are deprecated (`paper.stone`:4, :52, :95). It stays parked because D3 chose not to export them. **Guard for (a):** a `missing_scope/account_info.read` answer is reported as "could not check" (beside the space-usage case in `packages/orchestration/src/account-qualification.unit.test.ts`:484, or in `dropbox-file-source.unit.test.ts`). |
| T8 live proof | ⏳ **Owner** | On the owner's managed migration. **First** read the existing `.paper` row's `attempt_count` and `parked_at`. Expect `attempt_count` 5 (fewer if passes stopped, T1 (b)) and `parked_at` NULL. An ordinary failure waits on a person because of its count, and only a decision error is parked (`domain-sync.ts`:332, :1860; `ledger.ts`:564, :844; the test "still waits on a person once its attempts run out", `a-park-that-counted-as-five-attempts.unit.test.ts`:133-146). Neither kind is fetched again until Retry (`ledger.ts`:875-879). **If the row waits on a person, press Retry once T5 has landed**, and record the category and message from that new attempt. Retry is needed whenever the key does not change: throughout the alpha (D6), and after T3 under `refuse`. Only a chosen format renames the entry, and then its `formerPaths` close the old row (T3 (b)). **Then record:** the Paper doc exported (under which name) or parked with its stated category; what `files/export` answered (the `export_format` values the entry offers, and the result header); the pass summary (created, skipped, failed, needs decision), with the rest of the tree moving, which must not be expected from T6 alone; and a second pass that creates nothing. In the pass that parks it, a refused Paper doc counts under both failed and needs decision (`domain-sync.ts`:1771-1772, :1885-1887). Later passes count it under needs decision only (:1444-1448), and it never counts toward the tripwire. **If the owner connects Dropbox again** after #1194, record the Test's *Measured* line on that token. `users/get_space_usage` needs `account_info.read`, so a figure there shows on the wire that the grant carries it (T7 (a)); once T7 (a) is built, its own call must not answer `missing_scope`. The token answer's `scope` field is read and checked at the exchange but not stored (`dropbox-consent.ts`:160), so it cannot be recorded afterwards. **Name the stack** (open question 1). It counts as 0141 T3's Dropbox half only if it meets 0141 T1's rules (0141:465-483) and also does what 0141 T3 asks: on live, a tree with nested folders, and a rename and a deletion after the first pass, the deletion arriving as `trashed`-class evidence (0141:552-560), with the first consent after 0140 T7 (b) recorded (0141:561-562). Otherwise it is a regression proof only. This is the row the whole plan exists for. |
| T9 the words become true, here and in other plans | 📋 **Decided 2026-09-26** (D6), alpha minimum. Its cross-references ✅ **landed 2026-09-26** with this correction | The docs already say Paper docs *"stay behind"* (`docs/dropbox-setup.md`:111, `docs/guides/en/dropbox.md`:26, `docs/guides/nl/dropbox.md`:26), while the code tries every `.paper` and fails. They change with the code, not before. When T5 lands, and again when T4 lands, change them to what the code does: Paper docs are refused and parked by name, later exported in the chosen format, and Paper docs outside the file tree still stay behind (T7). The same lines' next sentence, that a deleted-entry read *"is not yet supported"* (`docs/dropbox-setup.md`:113-114; the guides' :26), is a separate inaccuracy: `listTrashedPaths` has read tombstones since 0055 T3b (`dropbox-file-source.ts`:301-305; `dav-sync.ts`:432-436). T9 corrects it in the same edit. Add a Dropbox native-files row to the open gaps in `docs/feature-matrix.md`, where only "Dropbox against a real account" stands today (:403). Add a 0144 known-limitations entry once 0144 T2's page exists, which is after the first invitation; until then the Dropbox guides carry the limit (D6). With the matrix row it is a `gap` entry, which the guard 0144 T2 proposes would require; that guard does not exist yet. **Cross-references, landed 2026-09-26:** 0055 T3 (native formats go to 0150, and (e), Dropbox's missing 429 handling); 0141 T3 (its sitting records the Paper doc; T8); 0125 (the `nativeFilePolicy` may-change row widens its wording, D7); 0131 T5 (a 0150 row, and the range "0132 to 0149" becomes "0132 to 0150") and 0131 §6 (M8, an M group for 0150, D6 and D7); 0144 T2 (the known-limitations entry, a `gap` entry, proposed, written with 0144 T2). |

## What this is

The owner's live Dropbox→Nextcloud migration sticks on one file. The error is the wire telling us
what it is: a Dropbox Paper document lists in `files/list_folder` like any file, but
`files/download` answers 409 `unsupported_file`. Paper docs are not files, they are editors,
exactly like a Google Doc is not a file and Drive answers `cannotExportFile` or needs
`files.export`. The connector is modelled on the Drive source for listing, cursors, and keys, but
the Drive source's native-file machinery (the export policy, the stated refusal, the parked
decision) was not carried across. Workplan 0055 listed Paper docs under *What does not migrate*
(`docs/dropbox-setup.md`:109-111, and later the guides), but built nothing to leave them behind:
`listSince` keeps every `.tag: file` entry (`dropbox-file-source.ts`:257-260), and `fetch()` sends
each one to `files/download`. The connector had never been run against a real account (0055 T3 (a)
⛔, the matrix's ⏳), so the gap stayed hidden until the owner's migration met a Paper doc.

And `.paper` is the canary, not the whole bird. Other Dropbox entries may refuse download for the
same structural reason, and we should not discover each one through a new owner incident:

- **`.paper` / `.papert`**: Paper docs and templates. They are listed as files on accounts with
  Dropbox's `paper_as_files` feature, which the spec describes for new Paper users (`paper.stone`:4;
  `users.stone`:71-76). Summaries of Dropbox's migration guide date it from 2019, and say older
  accounts moved later (not checked). They carry `is_downloadable: false` and are exported via
  `files/export`, in a format the entry's `export_info` lists.
- **`.web`**: Dropbox's own web shortcut. Reported as not downloadable. Whether `files/export`
  answers for it is for T2 to record (one report says it does, in a `url` format). `.url` and
  `.webloc` are not on this list: they are ordinary files that `files/download` returns, and they
  migrate today.
- **Google files in Dropbox** (`.gdoc`, `.gsheet`, `.gslides`). The API documents them as
  exportable: its own `files/export` example turns `Prime_Numbers.gsheet` into
  `Prime_Numbers.xlsx` (`files.stone`:1664, :1682). This plan first said third-party tools left
  them and that Dropbox would not export them. Reports say they came from Dropbox's own Google
  integration, and that from 2023 such files were moved to Google Drive, leaving shortcuts, or
  converted to Office files, so few may remain (search summaries; not checked). T2 records what a
  real account lists. An entry with `export_info` is exported like Paper.

The rule behind every entry above is one field, not an extension: an entry with
`is_downloadable: false` must be exported (`files.stone`:822-826). A tombstone is the one place the
rule has to fall back to the extension, because a deleted entry carries neither field
(`files.stone`:896-899; T3 (b)). "Online-only" is a desktop sync state with no field in the API, so
it is not a kind.

Three defects, one root: **the Dropbox source treats native formats as ordinary download failures.**

1. **An unstated category.** The bare `Error` from `download()` is classified from its prose and
   from the side the pass tagged. `fetchRaw` is tagged `source`, so the row reads `source_refused`
   today, and the owner is told the old account would not hand the file over
   (`strings.ts`:1340-1341). That is the wrong answer for a Paper doc Dropbox would export: the old
   account would hand it over, and only Ownpace declines it, which is `policy_refused`
   (`failure-category.ts`:134-143). Only a category stated where the error is thrown can say so.
   Before T3 there is no setting to change the answer, and a Paper doc still states
   `policy_refused`, with a remedy that names no setting (D9). A `.paper` listed above 8 MiB is
   downloaded inside the target's write, and reads `target_refused`. In the Drive source,
   `NativeFileRefused` states the category (`google-drive-source.ts`:124-210). `drive-refusal.ts`
   only marks a download refusal as a decision.
2. **Not a decision.** A file that fails the same way every time is not the world breaking, but
   the Paper 409 is an ordinary error. It is tried on five passes, and then waits on a person. It
   counts toward the 25-in-a-row tripwire (`domain-sync.ts`:58). Only an item fetched and written
   resets the count (:1713); a file skipped before the fetch does not (:1402-1414). Once the rest
   of the tree is copied, every Paper doc still being retried counts toward 25 in that pass,
   whatever folder it is in, so 25 retryable failures in one pass stop that pass
   (`PassAbortError`, :1909-1916). A stopped pass does not reach the folders listed after the 25th
   failure, so new or changed files there do not move until the Paper docs reach the ceiling. One
   Paper doc alone cannot trip it. For Dropbox, which lists every folder in full on every pass
   (`dropbox-file-source.ts`:253, :267-268), a held cursor costs nothing. Whether any of this
   explains "no other file moves" is T1's open half.
3. **No way out.** No setting makes a `.paper` migratable, so the only honest answer is "leave it
   behind". The docs already promise that, but the code does not do it: it tries and fails (T9).
   Dropbox offers `files/export` for `.paper` files, with the format passed as `export_format`
   from the entry's own `export_info` (for Paper, `html` and `markdown`). That is the same shape as
   Drive's `files.export`. The route is marked preview (T4).

## The owner's words

This section is for the owner's own words, dated and with their place, as the other plans quote
them. None were recorded for 0150. The two commits that wrote the plan carry a subject line only,
and PR #1183's description paraphrases (*"no other file moves"*). So, plainly:

- **The format picker.** The owner asked that the user choose the format that arrives at the
  target (T3). The words, their date and where they were said were not recorded.
- **One file stops everything.** The owner reported that one file stops the migration and no other
  file moves (T1, T6). The words, their date and where they were said were not recorded.
- **The T1 error** was quoted with its path shortened, and where it was read was not recorded (T1).

Open questions 1 and 2 ask for them.

## Decisions

On 2026-09-26 the owner read the check of this plan, with its questions and a recommended answer
for each, and was asked: *"Should I open a docs PR with those corrections? It would use my
recommended answers unless you answer differently."* The answer, word for word: *"yes, open the
0150 docs PR with your recommendations"*.

So the eight questions that were choices take the option marked *Recommended*. Each decision gives
the question in plain words, then the answer as given, as 0149 §2 does. For D1 to D8 the answer is
the owner's one sentence above; D9 quotes its own. After it comes the option that sentence takes,
as the question put it. Where a fact in a recommendation did not hold against the code, the
decision says so and says what follows. The question on T1's evidence was not a choice, and stays
open (open question 1). A review of this correction found one more choice that none of the eight
settles, the category a Paper doc states before T3. It was asked as open question 4, and the owner
answered it the same day (D9).

**D1 — no format chosen, and when the picker shows (T3, T5).** *When a migration has chosen no
format for Paper docs, is a Paper doc refused, or exported as Markdown or HTML?* — *"yes, open the
0150 docs PR with your recommendations"* (2026-09-26), so option (a): no format chosen means
refuse. A stated `policy_refused`, parked on first sight, as Drive does when nothing is set
(`config.ts`:237; `google-drive-source.ts`:316). The wizard shows the Paper picker for every Dropbox
migration that carries files, and suggests Markdown, which Nextcloud's Text app opens. Which
formats a real `.paper` offers is for T2 to confirm (open question 3). Before T3 there is no format
to choose; the category a Paper doc states then is D9's.

**D2 — building on a preview route (T4).** *`files/export` is marked `is_preview`, "subject to
breaking changes without notice". Build on it, or wait until Dropbox drops the flag?* — *"yes,
open the 0150 docs PR with your recommendations"* (2026-09-26), so option (a): build on it, with a
contract test, a live record in T8, and answers the code does not recognise kept retryable. It is
the only route Dropbox offers for `.paper` files, and the `/paper` routes are deprecated.

**D3 — Paper docs outside the file tree (T7).** *Detect such an account and say so, leave it to
the docs line, or build the deprecated `paper/docs/*` export?* — *"yes, open the 0150 docs PR with
your recommendations"* (2026-09-26), so option (a): detect it and say so; do not export. The
detection needs `account_info.read`. #1194 merged on 2026-09-26, and the consent URL now asks for
it (T7). That it had to be asked for at all rests on Dropbox's OAuth guide as read in a search
engine's excerpts (0140's Status), not checked here.

**D4 — the arrival name (T3 (b)).** *`Notes.paper.md` or `Notes.md`?* — *"yes, open the 0150 docs
PR with your recommendations"* (2026-09-26), so option (a): append, `Notes.paper.md`. This is the
rule the owner chose for Drive on 2026-09-23 (0042 T8 (c), `Budget.xls.xlsx`), and it cannot
collide with a real `Notes.md`. Replacing would put two items on one key, which the ledger cannot
hold (`google-drive-source.ts`:38-41).

**D5 — a kind with no export path (T3, T5).** *A stated refusal, parked, or a new "skip, counted"
outcome?* — *"yes, open the 0150 docs PR with your recommendations"* (2026-09-26), so option (a):
a stated `source_refused`, parked, which the person leaves behind, as a Drive shortcut is. It needs
no new core outcome: `fetch()` returns bytes or throws (`ports.ts`:324-331; `dav-sync.ts`:385-388).
Dropping the entry at listing would be the silent skip `an-item-the-listing-dropped-in-silence`
warns about. That guard would not catch a plain `continue`, because it reads only a `catch` that
logs *Failed to process*, so D5's guard must: extend the natural-key cases of
`dropbox-file-source.unit.test.ts` (:89, :111) so that a listing holding a `.paper` entry returns
it as an item. **One part of the recommendation did not hold.** It said the confirm screen counts
such a file. Drive's count before Start covers `policy_refused` files only, on purpose, because
its line offers a format as the remedy (`google-drive-source.ts`:459, :1206-1209;
`strings.ts`:117-118), and a Drive shortcut is not counted. So T3 (d) follows Drive, and a kind
with no export path shows on the Failures page, as a Drive shortcut does.

**D6 — the alpha (all tasks).** *Must Paper docs migrate in the alpha?* — *"yes, open the 0150
docs PR with your recommendations"* (2026-09-26), so option (a): no. The alpha minimum is T5,
T6 (a), T9's lines (the Dropbox docs and guides, and the feature-matrix row) and a 0144
known-limitations entry. T3 and T4 come after. Until T3, the refusal points to no setting.
**One part of the recommendation did not hold.** The 0144 entry lives on the page 0144 T2 builds
after the first invitation (0144:210). Until that page exists, the Dropbox guides carry the limit
(T9), and the entry is written with 0144 T2.

**D7 — the key, and who builds it (T3).** *Reuse `nativeFilePolicies` with a `paper` kind, or add
a Dropbox key?* — *"yes, open the 0150 docs PR with your recommendations"* (2026-09-26), so
option (a): reuse `nativeFilePolicies` with a `paper` kind. The update door's check becomes
source-aware (today it runs the Google parser for every source, `index.ts`:1760). The Google-typed
kinds widen (`google-native-coverage.ts`:110; `config.ts`:1278-1283). 0125's revision row widens
its wording. One key, one panel, one revision rule. **The builder is an M group**, M8 in 0131 §6,
because this is connector work. Files that R's groups change are touched from M8's step 2 (from
step 1 since D9, which puts `strings.ts` and the failures route in T5): T9's lines edit
`docs/guides/*/dropbox.md`, in R3's `docs/guides/`, and `feature-matrix.md`, in R2's list, and
T3's wizard and create-route edits touch `CreateMapping.tsx` and the create route. So by 0131 §6's
out-of-turn rule those steps wait for R's open pull request on those files, or rebase on it, and
the description says which.

**D8 — an ADR (T3, T4).** *Amend ADR-0046, or write a new ADR for Dropbox exports?* — *"yes, open
the 0150 docs PR with your recommendations"* (2026-09-26), so option (a): amend ADR-0046's operative
rule to name Dropbox: a rewrite follows the listing's version, and a renamed export is paired by
the Dropbox id. The amendment is part of T3's and T4's definition of done, in their pull requests.
ADR-0046 is not amended here, because nothing is built.

**D9 — the category a Paper doc states before T3 (T5).** *Before T3 there is no format to choose.
Does a Paper doc then state `policy_refused`, with a remedy that names no setting, or
`source_refused`?* (open question 4) — *"open question 4: (a), policy_refused as recommended"*
(2026-09-26), so option (a): `policy_refused`, as D1 reads; the remedy for a Paper doc names no
setting until T3 and names the new setting from T3 on; Drive's text stays as it is. So a Paper doc
states `policy_refused` from T5 on, before T3 and after: the old account would hand the file over,
and only Ownpace declines it (`failure-category.ts`:135-136). No row has to change category when T3
lands. Until T3, the other half of that definition, *"a setting on the mapping is what changed the
answer"* (:136-137), does not hold for a Paper doc, because there is no setting yet. D9 departs
from it until then, and T5 says so in that comment. The question gave the migration's source only
as an example of how the remedy could be chosen; the plan takes it. **One part of the
recommendation did not hold.** It said the change touches `strings.ts` and the Failures page. The
page shows the remedy from two files, its rows (`Failures.tsx`:90) and its group panel
(`FailureGroupPanel.tsx`:274), and neither has the source to choose by: no payload the page reads
carries it, and the appliance has no mapping API to ask. So the failures payload carries the
source kind, and T5 also touches the shared contract and both editions' `/failures`. The
Connections page, the support view and the live progress show a remedy by category too, but from
the domain-level category, which never holds `policy_refused`, so they do not change (T5). In the
alpha minimum, `strings.ts` and the managed failures route are files R's groups change (0131 §6,
M8 step 1).

## The shape of the fix (Drive, mirrored)

- **The listing names what arrives.** It reads `is_downloadable` and `export_info`, and names each
  native entry under the policy in force (D4: `Notes.paper.md`), with `formerPaths` for its other
  names. That name is the natural key, as in Drive. The listing still keeps every entry; nothing is
  filtered out. A tombstone carries neither field, so the trash read names a deleted `.paper` by
  its extension, under both names (T3 (b)). The version stays the listing's
  `content_hash`/`server_modified`, if T2 shows it moves on an edit.
- **`fetch()` decides by kind, before the size gate.** An exportable kind with no format chosen, or
  with `refuse`, gets a stated `policy_refused` that names the setting (D1). Before T3 it names
  none, and still states `policy_refused`; the Failures page gives a Dropbox migration a remedy
  that names no setting (D9). A kind with no export path gets a stated `source_refused` (D5). A
  kind with a format chosen goes through `files/export`, buffered, with an `export_format` the
  entry offers. Every other file downloads as today.
- **An export answer is routed by its tag.** `non_exportable` and `invalid_export_format` are
  stated refusals (T5). `retry_error`, any other or unknown tag, 429 and 5xx are ordinary failures,
  and are retried. `path/not_found` means the file is gone. The wire text is quoted every time.
- **Parked as a decision** on the first attempt, so the pass keeps moving. On the Failures page, a
  `policy_refused` Paper doc sits with the policy refusals the owner knows from Drive, and a
  `source_refused` entry sits with what the source would not hand over. The confirm screen counts
  the `policy_refused` ones before Start, as Drive's does (T3 (d)).

## What is NOT here

- No export of Paper docs outside the file tree (legacy Paper). T7 (a) detects such an account and
  says so; the deprecated `paper/docs/*` export stays parked, because D3 chose not to export them
  (T7 (b)).
- No Paper→Nextcloud *format conversion* beyond what Dropbox's own export renders (no HTML→md reflow
  in our code — we move what Dropbox hands over).
- No special case for Google files in Dropbox. They follow the same `is_downloadable`/`export_info`
  rule as every other entry.
- No change to Drive, Box or WebDAV native handling; their tests are the regression net. The shared
  piece T3 widens, `ExportPolicyPanel`, keeps its Drive behaviour. T5 chooses the `policy_refused`
  remedy by source (D9), and Drive's sentence, `failure.policyRefused`, is unchanged.
- No 429 or `Retry-After` handling for the Dropbox connector as a whole. It is missing for
  `list_folder` and `download` too, and it predates this plan. 0055 T3 (e) records it, not planned
  yet (hard rule 4). T5 only makes sure a 429 on export is never turned into a decision.
- No change to the product docs in this correction; T9 changes them when T5 lands.

## Lessons that apply

Before editing a file, grep `docs/LESSONS.md` for it (`AGENTS.md`, session protocol). For this plan:

- `a-deck-that-would-be-rewritten-nightly`: a rewrite follows the listing's version (T3 (b));
- `a-list-somebody-deletes-on-the-strength-of`: the key and the absence count (T3 (b));
- `a-chooser-one-google-kind-could-not-reach`: the chooser's coverage (T3 (c));
- `a-ceiling-the-screen-could-not-see`: the screen shows what the server honours (T3 (c)).

Two guards already read `dropbox-file-source.ts`. The byte-read lesson,
`the-decode-that-was-waiting-in-the-next-connector`, covers the export's bytes (T4).
`a-hash-that-was-never-sha256` says change detection stays on the version: an exported entry's
listed `content_hash` is the `.paper`'s block hash, never the export's (T3 (b)).

## Open questions

1. **T1's evidence (T1, T8).** From the owner's migration: the pass summaries (created, skipped,
   failed, needs decision), and whether any pass ended with a stop; the `.paper` rows
   (`last_error_category`, `attempt_count`, `parked_at`, and the error text each stores, in full),
   with the number of rows whose `attempt_count` is below 5; and the stack the migration runs on.
   *Recommended:* read them before anything is built. They decide T1's open half, and whether T8
   counts for 0141 T3.
2. **The owner's words (*The owner's words*).** The request for a format picker, and the report
   that one file stops everything, were never recorded word for word, with a date and a place. If
   the owner still has them, in a message or a screenshot, they go into that section as given. If
   not, the section keeps saying they were not recorded, and nothing waits on them.
3. **What T2's listing decides (T2, T3, T4).** Not a question for the owner, apart from the listing
   itself, which needs the owner's account. (a) Which `export_format` values a real `.paper` offers,
   so D1's suggested Markdown is one the entry lists. (b) Whether `content_hash`, `rev` or
   `server_modified` moves after a Paper edit. If none does, T3 (b) picks another signal and says
   why, and D8's ADR-0046 amendment names it. (c) Which other kinds a real account lists (`.web`,
   Google files), and which of them have no export path, so fall under D5. (d) The size a `.paper`
   is listed with.
4. **The category a Paper doc states before T3 (T5).** D1 took `policy_refused` for a Paper doc
   with no format chosen, and D6 said that until T3 the refusal points to no setting. Neither says
   which category applies before T3, when there is no format to choose, and the two meet on the
   Failures page. It picks a group's remedy by category alone (`apps/web/src/i18n/failure-key.ts`:32),
   and the `policy_refused` remedy names Google's setting: *"Choose one both sides can handle under
   Export format for Google files"* (`strings.ts`:1328-1329). This correction first wrote the
   answer as `source_refused`, under *Decisions*. The owner did not decide that, so it is asked
   here.
   (a) `policy_refused`, as D1 reads. The old account would hand the file over, and only Ownpace
   declines it, which is what the category means (`failure-category.ts`:134-143). The cost: for a
   Paper doc its remedy must name no setting, and Drive's text must stay as it is, because the
   owner reworded it on 2026-09-22 to name the setting. The remedy follows the category alone
   today, so the Failures page has to choose it by more than the category, for instance by the
   migration's source. That touches `strings.ts` and the Failures page, which R's groups change,
   in the alpha minimum. From T3 on, the row keeps its category, and the remedy names the new
   setting.
   (b) `source_refused`, with the item's own message saying Ownpace does not export Paper docs yet.
   No change to the Failures page. The cost: the group's remedy says *"the old account would not
   hand this over"* and *"Try again if that has changed"* (`strings.ts`:1340-1341). That is the
   answer defect 1 calls wrong, and it disagrees with the item's own message. A row parked this way
   keeps `source_refused` after T3, until Retry is pressed (`ledger.ts`:875-879) or a chosen format
   changes its key (T3 (b)).
   *Recommended:* (a). It is D1 as the owner took it, the category's own definition fits, and no
   row has to change category when T3 lands.
   *Answered 2026-09-26: (a) (D9).* The owner: *"open question 4: (a), policy_refused as
   recommended"*.
