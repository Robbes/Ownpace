# Workplan 0150 — Dropbox native formats, and the downloads that will not hand themselves over

> **In one line:** `.paper` files (and the other Dropbox native stubs — `url`/`web`, Google files parked in Dropbox) list like files but refuse `files/download` with 409 `unsupported_file`; mirror the Drive source's native-file machinery — kind-keyed policy, `files/export`, stated `source_refused`, parked decisions.

## Status — 2026-09-25 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the live failure, read from the wire | ✅ **Diagnosed 2026-09-25** | Owner's managed migration: `"_ Aan de slag met Dropbox Paper.paper"` fails every pass with `Dropbox refused the download of "…paper" (409): {"error":{".tag":"unsupported_file"}}` and no other file moves. In `dropbox-file-source.ts` the download is `files/download` with the arg in `Dropbox-API-Arg`; a non-OK response throws a bare `Error` with no stated category, so `failure-category.ts` classifies it by the `409…refused the` prose rule — **`target_refused`**, which is a lie: the destination was never asked. And because every attempt fails identically, `consecutiveFailures` climbs toward `ABORT_AFTER_CONSECUTIVE_FAILURES = 25` (`domain-sync.ts`), which is how one file sticks the whole pass. |
| T2 the native-format inventory, before any code | 📋 | Enumerate what Dropbox lists as a file but refuses to `files/download`, with the wire evidence for each: `.paper` / `.papert` (Paper docs and templates — exportable via `files/export`), `.url` / `.web` hyperlink shortcuts (not downloadable, no export), Google-native files (`gdoc`/`gsheet`/`gslides`) parked into a Dropbox account by other migration tools, and online-only placeholders on accounts whose Paper lives in the filesystem (the 2019 Paper-in-Drive change). Record for each: does `files/download` refuse? does `files/export` work? what listing metadata distinguishes it? This table is the input to T3's kind key — build it from the API docs plus a real account, not from extension guessing alone. |
| T3 kind-keyed policy, modelled on Drive | 📋 | One policy shape for the Dropbox source keyed by *kind*, mirroring `nativeFilePolicy` + `nativeFilePolicies` (a format per kind, workplan 0042 T9): `refuse` (default, stated refusal), `export-html` / `export-markdown` for `.paper`/`.papert` where Dropbox renders them, `skip` for kinds with no export path (`url`/`web`). Threaded through `shared/config.ts`, the dropbox factory, the mapping create API (BOTH schema enums — the 0046 lesson), the wizard card, and EN/NL. Whether this reuses the `nativeFilePolicy` key or gets a Dropbox-named sibling is a decision to record here before coding. |
| T4 the export path | 📋 | `POST /2/files/export` (`export_as_html` / `export_as_markdown`, arg in the header like `download`) is the official way to fetch a `.paper`. Add `exportNative()` to `DropboxFileSource`, route `.paper`/`.papert` fetches through it when the policy says export, and honour the export result's `e_tag`/name (`X.html` / `X.md`). Verify on a real account which export formats a `.paper` answers for before choosing the default. |
| T5 stated refusal, correct category | 📋 | When export is not configured or the kind has no export path, throw a `NativeFileRefused`-shaped error that STATES `source_refused` (the `stated-failure-category.ts` symbol), so the Failures page says *the source would not hand this over*, not *go check the target*. The Drive source's naming (`google-drive-source.ts`, `drive-refusal.ts`) is the model; the message must name the file, the kind, and the setting that changes the answer. |
| T6 park, not abort | 📋 | A native file that fails the same way every pass is a decision, not a world-failure: route it through `isDecisionError`/`NeedsDecision` so it is parked on its first attempt and never contributes to the 25-failure tripwire. Today it is an ordinary `Error` and counts — that is the "no other files moved yet" symptom. |
| T7 legacy Paper accounts | ⏳ | Accounts never migrated to the `.paper`-in-Drive model need `/paper/docs/download` (`paper.docs.*`) instead. Untouched; needs a real legacy account to prove anything. Document the branch, do not build it blind. |
| T8 live proof | ⏳ | Re-run the owner's managed migration and show the Paper doc either exported or parked as a named decision, with the rest of the tree moving. This is the row the whole plan exists for. |

## What this is

The owner's live Dropbox→Nextcloud migration sticks on one file. The error is the wire telling us what it is: a Dropbox Paper document lists in `files/list_folder` like any file, but `files/download` answers 409 `unsupported_file` — Paper docs are not files, they are editors, exactly like a Google Doc is not a file and Drive answers `cannotExportFile` or needs `files.export`. The connector is modelled on the Drive source for listing, cursors, and keys, but the Drive source's native-file machinery — the export policy, the stated refusal, the parked decision — was not carried across, because at the time the connector was built (workplan 0055) no live account had a Paper doc. Now one has.

And `.paper` is the canary, not the whole bird. Other Dropbox entries refuse download the same way for the same structural reason, and we should not discover each one through a new owner incident:

- **`.paper` / `.papert`** — Paper docs and templates. Exportable via `files/export`.
- **`.url` / `.web`** — hyperlink shortcuts. Not downloadable as content; no export exists. The honest answer is skip-and-count.
- **Google-native files inside Dropbox** (`gdoc`, `gsheet`, `gslides`) — third-party migration tools leave these parked as stub files; Dropbox will not export what it does not own. Refuse with a stated reason that names them for what they are.
- **Online-only placeholders** — accounts whose Paper content moved into the filesystem (the 2019 Paper-in-Drive change) surface Paper docs as `.paper` entries; the same listing may report other online-only stubs.

Three defects, one root: **the Dropbox source treats native formats as ordinary download failures.**

1. **Wrong category.** The bare `Error` from `download()` matches the `409`/`refused the` prose rule and lands as `target_refused` — the remedy text sends the owner to inspect a Nextcloud account that was never asked. The Drive source states `source_refused` / `policy_refused` from the throw site for exactly this reason (`google-drive-source.ts`, `drive-refusal.ts`); the same symbol mechanism exists and is unused here.
2. **The tripwire.** A file that fails identically every attempt is not the world breaking; Drive-native refusals are `isDecisionError`s and park on the first attempt. The Paper 409 is an ordinary error, counts toward `ABORT_AFTER_CONSECUTIVE_FAILURES = 25`, and — given listing order — can stop a pass before other files are fetched. That is the "no other files moved yet" symptom.
3. **No way out.** There is no setting that makes a `.paper` migratable, so the only honest UI answer is "leave it behind" — while Dropbox itself offers `files/export` (`export_as_html`, `export_as_markdown`) for `.paper` files, the same shape as Drive's `files.export`.

## The shape of the fix (Drive, mirrored)

- **Listing stays as is** — native entries keep listing; the natural key and `content_hash` logic are unchanged. The change lives on the fetch side.
- **`fetch()` consults the kind table** (T2's inventory, keyed by extension and any listing metadata that distinguishes stubs): policy unset → stated refusal naming the setting; policy says export and the kind has a path → `files/export` with the arg in the header, same header-argument protocol `download()` already honours, exported bytes renamed `X.html` / `X.md` the way `exportedNameUnder` does for Drive; policy says skip → counted, not failed.
- **A failed export is a refusal, not a mystery**: `files/export` answering `path/not_found` or `unsupported_export_type` is stated `source_refused` with the wire text quoted, never re-thrown as a bare 409.
- **Parked as a decision** so the pass keeps moving and the Failures page groups it with the policy refusals the owner already understands from Drive migrations.

## What is NOT here

- No `/paper/docs.*` build-out for legacy accounts (T7 stays a documented branch until a real legacy account exists).
- No Paper→Nextcloud *format conversion* beyond what Dropbox's own export renders (no HTML→md reflow in our code — we move what Dropbox hands over).
- No migration of *foreign* native stubs (the Google-in-Dropbox entries) beyond refusing them by name with a stated reason.
- No change to Drive, Box, or WebDAV native handling; their behaviour is unchanged and their tests are the regression net.
