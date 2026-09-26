# Workplan 0150 — Dropbox native formats, and the downloads that will not hand themselves over

> **In one line:** Dropbox entries marked `is_downloadable: false` (Paper docs as `.paper` files, and any other kind T2 finds) refuse `files/download` with 409 `unsupported_file`; export each kind in the user's chosen format via `files/export`, or state a refusal and park it on first sight, as Drive does.

## Status — 2026-09-26 (update this block at the end of every session)

**2026-09-26: corrected against the code, and the owner's decisions recorded.** At the owner's
request 0150 was checked against `main` at `dff5af13`, and against Dropbox's API spec
(`dropbox-api-spec`, branch `main`) and SDKs on GitHub. dropbox.com was not reachable from the
check, so every Dropbox fact below that no real account has shown is marked as such. When this
correction was written, every file and line of this repository it cites was read again at `main`
`e9abd451`, and the line numbers are that commit's. The Dropbox spec's lines were read again the
same day, on its branch `main`. T1's two mechanisms were wrong. The Paper 409 reads `source_refused`
today, not `target_refused`. And one failing file cannot stop a pass. So T1 is 🟡, and the cause of
"no other file moves" is open. The Dropbox names in T3, T4 and *The shape of the fix* were not
Dropbox's (`export_as_html`, `export_as_markdown`, `e_tag`, `unsupported_export_type`). The exported
name is chosen at listing, because it is the natural key. An exportable Paper doc with no format
chosen is `policy_refused`. T6 (b) was already built. The owner was then asked whether to open this
correction with the recommended answers, and answered: *"yes, open the 0150 docs PR with your
recommendations"*. Those answers are D1 to D8 (*Decisions*). Two things stay open: T1's evidence,
and the owner's own words for the two requests (*Open questions*). Nothing is built.

**The alpha minimum (decided, D6):** T5 and T6 (a), T9's lines in the Dropbox docs and guides, and
a 0144 known-limitations entry. Until T3 lands, the refusal points to no setting. 0144's page is
itself planned for after the first invitation (0144 T2), so until it exists a tester reads the
limit in the Dropbox guide (T9). **After:** T3, T4 and T7 (a). An M group builds the plan: M8 in
0131 §6 (D7).

| Task | Status | Evidence |
|---|---|---|
| T1 the live failure, read from the wire | 🟡 **Partly diagnosed** (2026-09-25; corrected 2026-09-26). The open half ⏳ **Owner** (open question 1) | **Known.** The owner's managed migration met `"_ Aan de slag met Dropbox Paper.paper"`, and `files/download` answered 409 `unsupported_file`. This plan first quoted the error as `Dropbox refused the download of "…paper" (409): {"error":{".tag":"unsupported_file"}}`, with the path shortened. The full text, and the screen or row it was read from, were not recorded (open question 1). `download()` throws a bare `Error` with no stated category and no decision mark (`dropbox-file-source.ts`:383-385). Dropbox's spec says what the tag means: *"This file type cannot be downloaded directly; use :route:`export` instead."* (`files.stone`:1002-1005). **Not as first written.** (a) The row reads `source_refused`, not `target_refused`. `fetchRaw` is `sided('source', deps.fetchRaw)` (`domain-sync.ts`:880), and the matching rule turns a source-side refusal into `source_refused` (`failure-category.ts`:324-328, :366). So the owner is told the old account would not hand the file over (`strings.ts`:1312-1313). The code has worked this way since 2026-09-17. Only a `.paper` listed above 8 MiB would read `target_refused`, because it is downloaded inside `body.open()` (`dropbox-file-source.ts`:411-417) under the target's `upsert` (`domain-sync.ts`:892). (b) One file cannot stop a pass. `consecutiveFailures` lives for one pass (:969), every success resets it (:1713), and the per-item catch carries on (:1746). The file is tried on 5 passes, then parked and not fetched again (`MAX_ITEM_ATTEMPTS`, `ports.ts`:1896; `domain-sync.ts`:332, :1445). While it can still be retried, it holds its folder's cursor back (:1934). **Open: why "no other file moves".** First read the owner's pass summaries (created, skipped, failed, needs decision) and the `.paper` row (`last_error_category`, `attempt_count`, `parked_at`). Once the other files are copied, later passes show created 0 and skipped N beside one failure, which can read as "nothing moved". #1182's root-path 409 is ruled out for the passes that show the Paper 409, because those passes listed the root first (`domain-sync.ts`:1170). 0128's per-data-type stop (#1174, #1179) is not yet ruled out. |
| T2 the native-format inventory, before any code | 📋 **Proposed** (the rule, from the API spec); ⏳ **Owner** (a listing of the owner's account) | **The rule.** Dropbox states on every listed file whether it must be exported. `is_downloadable` means *"If true, file can be downloaded directly; else the file must be exported."* `export_info` *"must be set if is_downloadable is set to false"*. It holds `export_as` (the default format) and `export_options` (the others) (`files.stone`:822-826, :693-702). The kind table keys on these fields, with the extension as the kind's label. `DropboxEntry` carries neither field today (`dropbox-file-source.types.ts`:56-67). T5 needs only this rule. T3 and T4 also need the listing. **Record from a real listing, per kind** (open question 3): `is_downloadable`; `export_info`; whether `files/export` answers, and with which `export_format` values; the listed size; and whether `content_hash`, `rev` or `server_modified` moves after an edit. The version decides a rewrite (`domain-sync.ts`:350-354; `dropbox-file-source.ts`:451). **Kinds to look for:** `.paper` and `.papert`. `.web`, Dropbox's own shortcut: reported as not downloadable, and one report (rclone issue #8391) says it exports in a `url` format; not checked. Any `.gdoc`/`.gsheet`/`.gslides` left in the account: the spec's own export example turns `Prime_Numbers.gsheet` into `Prime_Numbers.xlsx` (`files.stone`:1664, :1682). `.url` and `.webloc` are ordinary files that download and migrate today; they are not native kinds. |
| T3 the arrival format per kind, chosen by the user and named at listing | 📋 **Decided 2026-09-26** (D1, D4, D5, D7, D8). **After** the alpha (D6) | The owner asked that the user picks the format that arrives (*The owner's words*). **(a) The values.** A kind's choices are the wire's `export_format` strings for it: `html` and `markdown` for Paper, which is what rclone sends (`backend/dropbox/dropbox.go`:141-144). Each file's choice is checked against its `export_as` and `export_options`, as rclone does (:1802-1806). The stored setting may use repo-style names mapped to them. A kind with no export path offers no format. No format chosen means refuse (D1). The wizard shows the Paper picker for every Dropbox migration that carries files, and suggests Markdown (D1). **(b) The name is chosen at listing.** The sync loop writes under the listed path and keeps only the bytes from `fetch()` (`dav-sync.ts`:382, :392, :406; `webdav-target-writer.ts`:252, :799). So `listSince`/`toFileItem` name each native entry under the policy in force, as Drive's `exportedNameUnder` does (`google-drive-source.ts`:227-237, :466). The rule is D4's: the suffix is appended, so `Notes.paper` arrives as `Notes.paper.md`. That name is the natural key. Each entry carries `formerPaths` for its names under every other policy, `refuse` included (`google-drive-source.ts`:1116; `dav-sync.ts`:409). So a switch closes a row parked under the old name (`supersedeFormerNames`, `ports.ts`:1683). `sourceIdentity` is the Dropbox id; its comment says it is set only for a Google document today (`file.ts`:103-114). `listKeys` and `listTrashedPaths` use the same naming. Drive's own bin read does not (`google-drive-source.ts`:864, in `originalPathOf`). The version stays the listing's `fileVersion(content_hash, server_modified)` (`dropbox-file-source.ts`:451; ADR-0046, #1083), never the export's hash. **(c) The places the setting passes through,** as Drive's does. D7: the key is `nativeFilePolicies`, reused with a `paper` kind. So the Google-typed kinds and values widen (`google-native-coverage.ts`:110; `config.ts`:214, :1278-1283), and the update door's check becomes source-aware: today it runs the Google parser for every source and would answer 400 (`apps/api/src/routes/migrations/index.ts`:1760). The shared parser's Dropbox branch is the one authority for both editions (`config.ts`:1046-1052). The create door's gate and its Dropbox config drop a setting sent today without a word (`index.ts`:509, :201-205). The factory hands the source `rootPath` and the endpoints only (`dropbox-source-factory.ts`:97-101), and managed's builder hands it `rootPath` only (`build-deps-from-mapping.ts`:1110-1111). The wizard's gate and the settings panel's both ask `carriesGoogleNativeFiles` (`CreateMapping.tsx`:1337-1338; `ExportPolicyPanel.tsx`:214; `google-native-coverage.ts`:248). Also: the panel's title (`strings.ts`:541 EN, :2854 NL); the `failure.policyRefused` remedy, Google-only in both languages (`strings.ts`:1300-1301, :2371-2372); the `source.nativeFilePolicy` revision rule, its consequence and snapshot (`config-revision.ts`:66, :136-145, :394), with 0125's wording; `openapi.yaml`:1880-1893; and the appliance's mapping key with `dropbox-setup.md` §3. The web `MaskedConfigSchema` already names both keys (`mapping-service.ts`:211-238), so D7 needs nothing there. The values stay `z.string()`, with no API enum. T8's export half, on the existing mapping, needs the update door. **(d) Before Start.** Add a `nativeRefusals()` count on `DropboxFileSource` for the confirm screen (`run-discovery.ts`:167-170; `native-refusals.tsx`). It counts `policy_refused` files only, as Drive's does, because the confirm line offers a format as the remedy (`google-drive-source.ts`:459, :1206-1209; `strings.ts`:117-118). Add a `paper` entry in `native-kind-key.ts`, with EN/NL `discovery.refusedNative.kind.paper`; today an unknown kind reads "Google files" (`strings.ts`:105). **(e) Done when** ADR-0046's operative rule names Dropbox: a rewrite follows the listing's version, and a renamed export is paired by the Dropbox id (D8). **Guards:** a listing under a Paper format names the entry and its `formerPaths`, and a second pass creates nothing (extend `dropbox-file-source.unit.test.ts`:111 and the tombstone tests at :322; fails today, because no entry is renamed). A PATCH carrying a Dropbox format is accepted (400 today). Extend `a-policy-the-client-threw-away` and the chooser guard `a-chooser-one-google-kind-could-not-reach`, or add a Dropbox sibling. |
| T4 the export path | 📋 **Decided 2026-09-26** (D2, D8). **After** the alpha (D6) | `POST https://content.dropboxapi.com/2/files/export` with `Dropbox-API-Arg: {"path": <id>, "export_format": <value>}`. It uses the same content host and header argument as `download()` (`files.stone`:2753-2764, `host = "content"`, `style = "download"`), the same id (`sourceRef`, `dropbox-file-source.ts`:454), and the same scope, `files.content.read`, which the consent already asks for (`dropbox-consent.ts`:24-27). **A preview route (D2).** Dropbox marks it `is_preview = true`, *"subject to breaking changes without notice"* (`stone_cfg.stone`:11-13); `files/download` is not marked (`files.stone`:2727-2736). A contract test pins the request and the result, and T8 records the live answer. An answer the code does not recognise stays an ordinary, retryable failure (T5). **The result** is `export_metadata` (`name`, `size`, `export_hash`, `paper_revision`) plus `file_metadata`, in the `Dropbox-API-Result` response header (`files.stone`:1669-1690). There is no `e_tag`. The name comes from the listing (T3 (b)). The header can only confirm it, through an optional `headers` on `DropboxTransport`'s response, added like `body?` (`dropbox-file-source.types.ts`:18-35). **Before the size gate, always buffered.** `fetch()` decides the kind before `item.size > STREAM_FILES_LARGER_THAN_BYTES` (`dropbox-file-source.ts`:411, 8 MiB). An export returns `content` with `item.size = bytes.byteLength`. It never returns a `FileBody` whose `sizeBytes` is the `.paper` listing size (:415), which the target would send as `Content-Length` (`webdav-target-writer.ts`:958). Drive does the same (`google-drive-source.ts`:948, :968, :994). The export is read as bytes, never as text. **Done when** ADR-0046's amendment (D8) covers the export as built. **Guard:** a `.paper` listed above 8 MiB under an export policy returns buffered `content` from one `files/export` call, and never a body. Add it as a Dropbox sibling of `a-drive-file-that-has-no-size-until-it-exists`. It fails today, because the file goes to `files/download` in the streamed branch. |
| T5 a stated refusal, in the category a setting would change | 📋 **Decided 2026-09-26** (D1, D5, D6). **Alpha minimum** | Split as Drive's `NativeFileRefused` does, by *"WHETHER A SETTING WOULD CHANGE THE ANSWER"* (`google-drive-source.ts`:143-205; the owner's choice of 2026-09-18, `failure-category.ts`:113-125). The listing reads T2's rule: `DropboxEntry` gains `is_downloadable` and `export_info`, and the item carries what `fetch()` needs to decide before any download and before the size gate, so the side stays `source`. **From T3 on:** an exportable kind with no format chosen, or with `refuse`, STATES `policy_refused` and names the setting (D1; `failure-category.ts`:134-143). A kind with no export path states `source_refused` (D5). **Before T3** there is no setting to name (D6). A Paper doc then states `source_refused`, because the `policy_refused` remedy on the Failures page names a setting (`strings.ts`:1300-1301). Its message says Ownpace does not export Paper docs yet, and that it can be left behind. Every refusal carries `markNeedsDecision`, and names the file and the kind. **Export answers, by tag (from T4).** Drive's rule applies: *"A reason absent from this set is treated as retryable"* (`drive-refusal.ts`:54-59). `non_exportable` (*"This file type cannot be exported. Use :route:`download` instead."*) on an entry whose download was already refused is a stated `source_refused`; on any other entry it means the kind table is wrong. `invalid_export_format` is prevented by checking the choice against `export_as` and `export_options` first; if it still comes, it is a stated `policy_refused`. `retry_error` (*"The exportable content is not yet available. Please retry later."*), any other or unknown tag, 429 and 5xx are ordinary failures, with no decision mark and no stated category. They are retried, and still count toward the tripwire. `path/not_found` on the listed id means the file is gone since the listing; it is not a refusal. `unsupported_export_type` does not exist (`files.stone`:1014-1021). **Guards:** fetching a `.paper` with no format states its category and is a decision error. This fails today, because the code throws a bare `Error` (`dropbox-file-source.ts`:383-385). A `retry_error` and a 409 with an unknown tag are not decision errors (extend `a-refusal-we-wrote-and-then-could-not-read`). |
| T6 park on first sight | 📋 **Decided 2026-09-26** (D6), (a). **Alpha minimum**. (b) ✅ **Already built** | **(a)** T5's refusals are decision errors, so the file is parked on its first attempt instead of its fifth. It stops holding its folder's cursor back (`domain-sync.ts`:1934), and it never counts toward the 25-in-a-row tripwire (:1771-1773). That matters for a folder of 25 or more Paper docs, the case Drive already met (:1764-1770). Only the decision set T5 names parks; a transient export answer never does. This does not explain "no other file moves" (T1). **Guard:** extend `a-park-that-counted-as-five-attempts` with a Dropbox `.paper`, parked after one attempt (it takes five today). **(b) Already built.** A failed item is recorded and the pass carries on (`domain-sync.ts`:1746; `failure-isolation.unit.test.ts`:137, :245). A Dropbox-shaped case there is a regression test, not a guard that fails today. |
| T7 Paper docs outside the file tree (legacy Paper) | 📋 **Decided 2026-09-26** (D3), (a), **after** the alpha (D6); 🅿️ **Parked (trigger: an account whose Paper docs are outside the file tree)** (b) | When Dropbox's `paper_as_files` feature is off, *"the user's Paper docs are stored separate from Dropbox files and folders and should be accessed via the /paper endpoints"* (`users.stone`:71-76). `files/list_folder` is the only file listing the source makes (`dropbox-file-source.ts`:149, :167, and the probe's :227, :244), and it never returns them: no 409, no failure row, no count. Today the docs' *"Sharing state, file requests, Paper docs and version history stay behind"* covers them (`docs/dropbox-setup.md`:99). Once T9 changes that line, they need a sentence of their own. **(a) Detect and say so (D3).** One `users/features/get_values` call for `paper_as_files` (`users.stone`:355-361), and a stated line: "Paper docs outside the Dropbox file tree were not migrated". Its scope, `account_info.read`, is the one the source already needs for `users/get_space_usage` (`dropbox-file-source.ts`:211; `users.stone`:364-370). A `missing_scope` answer is stated as "could not check", never read as "not legacy" (`account-qualification.unit.test.ts`:484). 0140 T7 (b), as written on `main`, asks for the two files scopes only (0140:584). That would make (a) answer "could not check" every time. Its build, open as #1194 and not merged on 2026-09-26, asks for `account_info.read` as well, for the Test's space usage. So (a) needs #1194 to land with that scope, or 0140 T7 (b) to keep it some other way. Summaries of Dropbox's migration guide say a `paper_as_files` account can also hold legacy docs (not checked). So the docs keep a general line too (T9). **(b) Their export** needs `paper/docs/list` and `paper/docs/download`, which are deprecated (`paper.stone`:4, :52, :95). It stays parked. **Guard for (a):** a `missing_scope/account_info.read` answer is reported as "could not check". |
| T8 live proof | ⏳ **Owner** | On the owner's managed migration. **First** read the existing `.paper` row's `attempt_count` and `parked_at`. It has probably reached 5 and is parked. A parked row is not fetched again until Retry is pressed (`ledger.ts`:875-879) or its key changes under a new format (T3 (b)). **Then record:** the Paper doc exported (under which name) or parked with its stated category; what `files/export` answered (the `export_format` values the entry offers, and the result header); the pass summary (created, skipped, failed, needs decision), with the rest of the tree moving, which must not be expected from T6 alone; and a second pass that creates nothing. **Name the stack** (open question 1). If the run meets 0141 T1's rules for a live proof (0141:465-483), it also counts as 0141 T3's Dropbox half (0141:188, :550-563). Otherwise it is a regression proof only. This is the row the whole plan exists for. |
| T9 the words become true, here and in other plans | 📋 **Decided 2026-09-26** (D6), alpha minimum. Its cross-references ✅ **landed 2026-09-26** with this correction | The docs already say Paper docs *"stay behind"* (`docs/dropbox-setup.md`:99, `docs/guides/en/dropbox.md`:26, `docs/guides/nl/dropbox.md`:26), while the code tries every `.paper` and fails. These lines describe the code as it is, so they change with it, not before. When T5 lands, and again when T4 lands, change them to what the code does: Paper docs are refused and parked by name, later exported in the chosen format, and Paper docs outside the file tree still stay behind (T7). Add a Dropbox native-files row to the open gaps in `docs/feature-matrix.md`, where only "Dropbox against a real account" stands today (:403). Add a 0144 known-limitations entry. With the matrix row it is a `gap` entry, which the guard 0144 T2 proposes would require; that guard does not exist yet. **Cross-references, landed 2026-09-26:** 0055 T3 (native formats go to 0150); 0141 T3 (its sitting records the Paper doc; T8); 0125 (the `nativeFilePolicy` may-change row widens its wording, D7); 0131 T5 (a 0150 row, and the range "0132 to 0149" becomes "0132 to 0150") and 0131 §6 (M8, an M group for 0150, D6 and D7); 0144 T2 (the known-limitations entry, a `gap` entry, proposed). **Owed, not landed here:** 0140 T7 (b), the scope T7 (a) needs, unless #1194 lands as opened. |

## What this is

The owner's live Dropbox→Nextcloud migration sticks on one file. The error is the wire telling us
what it is: a Dropbox Paper document lists in `files/list_folder` like any file, but
`files/download` answers 409 `unsupported_file`. Paper docs are not files, they are editors,
exactly like a Google Doc is not a file and Drive answers `cannotExportFile` or needs
`files.export`. The connector is modelled on the Drive source for listing, cursors, and keys, but
the Drive source's native-file machinery (the export policy, the stated refusal, the parked
decision) was not carried across. Workplan 0055 listed Paper docs under *What does not migrate*
(`docs/dropbox-setup.md`:97-99, and later the guides), but built nothing to leave them behind:
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
`is_downloadable: false` must be exported (`files.stone`:822-826). "Online-only" is a desktop sync
state with no field in the API, so it is not a kind.

Three defects, one root: **the Dropbox source treats native formats as ordinary download failures.**

1. **An unstated category.** The bare `Error` from `download()` is classified from its prose and
   from the side the pass tagged. `fetchRaw` is tagged `source`, so the row reads `source_refused`
   today, and the owner is told the old account would not hand the file over
   (`strings.ts`:1312-1313). Once Ownpace can export Paper docs, that is the wrong answer for a
   Paper doc Dropbox would export: a setting would change it, which is `policy_refused`, and only a
   category stated where the error is thrown can say so. A `.paper` listed above 8 MiB is
   downloaded inside the target's write, and reads `target_refused`. In the Drive source,
   `NativeFileRefused` states the category (`google-drive-source.ts`:124-210). `drive-refusal.ts`
   only marks a download refusal as a decision.
2. **Not a decision.** A file that fails the same way every time is not the world breaking, but
   the Paper 409 is an ordinary error. It is tried on five passes before it parks. Meanwhile it
   holds its folder's cursor back, and it counts toward the 25-in-a-row tripwire
   (`domain-sync.ts`:58). One such file cannot trip it, because any success resets the count.
   Twenty-five Paper docs in a row could. None of this explains "no other file moves" (T1).
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
the question in plain words, then the answer as given, as 0149 §2 does. The answer is the owner's
one sentence above; after it comes the option that sentence takes, as the question put it. Where a
fact in a recommendation did not hold against the code, the decision says so and says what
follows. The question on T1's evidence was not a choice, and stays open (open question 1).

**D1 — no format chosen, and when the picker shows (T3, T5).** *When a migration has chosen no
format for Paper docs, is a Paper doc refused, or exported as Markdown or HTML?* — *"yes, open the
0150 docs PR with your recommendations"* (2026-09-26), so option (a): no format chosen means
refuse. A stated `policy_refused`, parked on first sight, as Drive does when nothing is set
(`config.ts`:237; `google-drive-source.ts`:316). The wizard shows the Paper picker for every Dropbox
migration that carries files, and suggests Markdown, which Nextcloud's Text app opens. Which
formats a real `.paper` offers is for T2 to confirm (open question 3).

**D2 — building on a preview route (T4).** *`files/export` is marked `is_preview`, "subject to
breaking changes without notice". Build on it, or wait until Dropbox drops the flag?* — *"yes,
open the 0150 docs PR with your recommendations"* (2026-09-26), so option (a): build on it, with a
contract test, a live record in T8, and answers the code does not recognise kept retryable. It is
the only route Dropbox offers for `.paper` files, and the `/paper` routes are deprecated.

**D3 — Paper docs outside the file tree (T7).** *Detect such an account and say so, leave it to
the docs line, or build the deprecated `paper/docs/*` export?* — *"yes, open the 0150 docs PR with
your recommendations"* (2026-09-26), so option (a): detect it and say so; do not export. The
detection needs `account_info.read`, which 0140 T7 (b) as written on `main` does not ask for, and
its open build, #1194, does (T7).

**D4 — the arrival name (T3 (b)).** *`Notes.paper.md` or `Notes.md`?* — *"yes, open the 0150 docs
PR with your recommendations"* (2026-09-26), so option (a): append, `Notes.paper.md`. This is the
rule the owner chose for Drive on 2026-09-23 (0042 T8 (c), `Budget.xls.xlsx`), and it cannot
collide with a real `Notes.md`. Replacing would put two items on one key, which the ledger cannot
hold (`google-drive-source.ts`:38-41).

**D5 — a kind with no export path (T3, T5).** *A stated refusal, parked, or a new "skip, counted"
outcome?* — *"yes, open the 0150 docs PR with your recommendations"* (2026-09-26), so option (a):
a stated `source_refused`, parked, which the person leaves behind, as a Drive shortcut is. It needs
no new core outcome: `fetch()` returns bytes or throws (`ports.ts`:324-331; `dav-sync.ts`:385-388),
and filtering at listing is not allowed (`an-item-the-listing-dropped-in-silence`). **One part of
the recommendation did not hold.** It said the confirm screen counts such a file. Drive's count
before Start covers `policy_refused` files only, on purpose, because its line offers a format as
the remedy (`google-drive-source.ts`:459, :1206-1209; `strings.ts`:117-118), and a Drive shortcut
is not counted. So T3 (d) follows Drive, and a kind with no export path shows on the Failures page,
as a Drive shortcut does.

**D6 — the alpha (all tasks).** *Must Paper docs migrate in the alpha?* — *"yes, open the 0150
docs PR with your recommendations"* (2026-09-26), so option (a): no. The alpha minimum is T5,
T6 (a), T9's lines and a 0144 known-limitations entry. T3 and T4 come after. Until T3, the refusal
points to no setting.

**The reading.** Before T3 there is no setting, and the `policy_refused` remedy on the Failures
page names one (`strings.ts`:1300-1301, *"Choose one both sides can handle under Export format for
Google files"*). So until T3 lands, a Paper doc is stated `source_refused`, and its message says
Ownpace does not export Paper docs yet (T5). From T3 on, D1 applies. A row parked under that
category is closed by T3's `formerPaths` when the owner picks a format (T3 (b)).

**D7 — the key, and who builds it (T3).** *Reuse `nativeFilePolicies` with a `paper` kind, or add
a Dropbox key?* — *"yes, open the 0150 docs PR with your recommendations"* (2026-09-26), so
option (a): reuse `nativeFilePolicies` with a `paper` kind. The update door's check becomes
source-aware (today it runs the Google parser for every source, `index.ts`:1760). The Google-typed
kinds widen (`google-native-coverage.ts`:110; `config.ts`:1278-1283). 0125's revision row widens
its wording. One key, one panel, one revision rule. **The builder is an M group**, M8 in 0131 §6,
because this is connector work. T3's wizard and create-route edits touch files R's groups change
(`CreateMapping.tsx`, the create route), so by 0131 §6's rule they wait for R's open pull request
there, or rebase on it, and the description says which.

**D8 — an ADR (T3, T4).** *Amend ADR-0046, or write a new ADR for Dropbox exports?* — *"yes, open
the 0150 docs PR with your recommendations"* (2026-09-26), so option (a): amend ADR-0046's operative
rule to name Dropbox: a rewrite follows the listing's version, and a renamed export is paired by
the Dropbox id. The amendment is part of T3's and T4's definition of done, in their pull requests.
ADR-0046 is not amended here, because nothing is built.

## The shape of the fix (Drive, mirrored)

- **The listing names what arrives.** It reads `is_downloadable` and `export_info`, and names each
  native entry under the policy in force (D4: `Notes.paper.md`), with `formerPaths` for its other
  names. That name is the natural key, as in Drive. The listing still keeps every entry; nothing is
  filtered out. The version stays the listing's `content_hash`/`server_modified`, if T2 shows it
  moves on an edit.
- **`fetch()` decides by kind, before the size gate.** An exportable kind with no format chosen, or
  with `refuse`, gets a stated `policy_refused` that names the setting (D1); before T3 it is
  `source_refused` and names none (D6). A kind with no export path gets a stated `source_refused`
  (D5). A kind with a format chosen goes through `files/export`, buffered, with an `export_format`
  the entry offers. Every other file downloads as today.
- **An export answer is routed by its tag.** `non_exportable` and `invalid_export_format` are
  stated refusals (T5). `retry_error`, any other or unknown tag, 429 and 5xx are ordinary failures,
  and are retried. `path/not_found` means the file is gone. The wire text is quoted every time.
- **Parked as a decision** on the first attempt, so the pass keeps moving. On the Failures page, a
  `policy_refused` Paper doc sits with the policy refusals the owner knows from Drive, and a
  `source_refused` entry sits with what the source would not hand over. The confirm screen counts
  the `policy_refused` ones before Start, as Drive's does (T3 (d)).

## What is NOT here

- No export of Paper docs outside the file tree (legacy Paper). T7 (a) detects such an account and
  says so; the deprecated `paper/docs/*` export stays parked (T7 (b)).
- No Paper→Nextcloud *format conversion* beyond what Dropbox's own export renders (no HTML→md reflow
  in our code — we move what Dropbox hands over).
- No special case for Google files in Dropbox. They follow the same `is_downloadable`/`export_info`
  rule as every other entry.
- No change to Drive, Box or WebDAV native handling; their tests are the regression net. The shared
  pieces T3 widens (the `failure.policyRefused` remedy, `ExportPolicyPanel`) keep their Drive
  behaviour.
- No 429 or `Retry-After` handling for the Dropbox connector as a whole. It is missing for
  `list_folder` and `download` too, it predates this plan, and it belongs in its own item (hard
  rule 4). T5 only makes sure a 429 on export is never turned into a decision.
- No change to the product docs in this correction. `docs/dropbox-setup.md` and the Dropbox guides
  describe the code as it is today; T9 changes them when T5 lands.

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
   failed, needs decision); the `.paper` row (`last_error_category`, `attempt_count`, `parked_at`,
   and the error text it stores, in full); and the stack the migration runs on. *Recommended:* read
   them before anything is built. They decide T1's open half, and whether T8 counts for 0141 T3.
2. **The owner's words (*The owner's words*).** The request for a format picker, and the report
   that one file stops everything, were never recorded word for word, with a date and a place. If
   the owner still has them, in a message or a screenshot, they go into that section as given. If
   not, the section keeps saying they were not recorded, and nothing waits on them.
3. **What T2's listing decides (T2, T3, T4).** Not a question for the owner, apart from the listing
   itself, which needs the owner's account. (a) Which `export_format` values a real `.paper` offers,
   so D1's suggested Markdown is one the entry lists. (b) Whether `content_hash`, `rev` or
   `server_modified` moves after a Paper edit. If none does, T4 picks another signal and says why.
   (c) Which other kinds a real account lists (`.web`, Google files), and which of them have no
   export path, so fall under D5. (d) The size a `.paper` is listed with.
