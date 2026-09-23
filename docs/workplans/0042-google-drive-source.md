# Workplan 0042 — Google Drive as a file source

## Status — 2026-09-23 (update this block at the end of every session)

**2026-09-23, last: T8 (b)'s first half is built: a refusal left under a name the document no
longer has closes by itself.** The Drive source names each native document's paths under the other
export policies (`FileItem.formerPaths`). After a pass that listed everything, a `failed` row under
one of those names that the pass did not list becomes `superseded` (migration 0056), with the row
that took over named on it. So the Failures screen shows each document once, under its current
name, and a switch from `refuse` to a format, the common path, leaves nothing behind. One departure
from the decided design: the match is by the names the policy would give, not by the Drive id
alone, because the owner's own failures were recorded without one (a failure never kept the
source's handle; it does now, and a row that records another object's is left alone). Still open,
the second half: a copy already on the target under an old name.

**And a finding the owner needs before switching: no editable format carries all four kinds.**
`EXPORT_STABILITY` refuses Slides under `export-office` and Docs under `export-odf`, and only PDF
carries all four, none of them editable. The owner's parked files are Slides decks under Office.
Switching that migration to ODF would copy them, refuse every Doc instead, and, until the second
half, copy every Sheet again beside its `.xlsx`. A per-kind choice (Office for Docs and Sheets, ODF
for Slides) would carry all four, editable. That is a new policy and the owner's call.

**2026-09-23, later still: T8 (b) is DECIDED: one record per Google document, whatever its
format.** The owner: *"acknowledged what you adviced"*. A switch of the export format renames
every Google document, and the name is the key, so today a switch leaves the old refused rows on
the Failures screen for good. Between two export formats it also copies every document again beside
its old copy, and after two passes reports each old copy as deleted at the source. The design is in the
T8 row. The owner holds off switching the format on his live migration until it is built.

**2026-09-23, later: T8 (g) done, and (e) is now written down where it is claimed.** ADR-0046
said "not yet built" in its status and "built, and live" in its first rule. Both now say what is
true: built, but the per-part hash never reaches the ledger, because the file pass drops the
export's marker. The feature matrix, the self-host quickstart and the owner test runbook no longer
call the exports unmeasured. The code half of (e) is still open.

**2026-09-23: T8 (c) decided, and (d) fixed.** Doubled extensions such as `Budget.xls.xlsx` stay.
The owner said: *"if those are the original files and work in the target, we keep"*, and both
conditions hold (T8 (c)). (d) was fixed by #1083, so an edit made in Drive now reaches the copy (proven in tests, not yet
seen on a live run).
Next is (b), before any owner switches the export policy on a live migration.

**2026-09-22: listed at the owner's request, not yet worked — see T8.** *"We also need to
stabilise the file formats Google can give. I think we still have an issue with Slides."* A read
of the code the same night found that Slides is the smallest of it. Most urgent: a Drive file
edited after its first copy is never copied again (T8 (d)).

**2026-09-17: the export table is complete, and the chooser stopped hiding what it costs.**
Every one of the twelve (policy, editor type) cells has been measured on the owner's tenant.
`export-pdf` is stable on all four types and is the only policy that carries all four; the two
reds are `export-odf` on a Doc and `export-office` on a deck, each refused per file while the
rest of the folder migrates.

The gap that closed today was not a measurement. **The wizard offered three formats as equals
and named only their file extensions** — so choosing "OpenDocument — .odt, .ods, .odp" meant
unknowingly leaving behind the kind of file that label starts with, and the person found out at
discovery or in the failures queue after the run. `NATIVE_POLICY_COVERAGE` (`@openmig/shared`)
derives from `EXPORT_STABILITY` which kinds a format drops, a guard holds the two equal, and the
chooser says it in both languages beside the `<select>`.

**The default stays `refuse`, deliberately.** T0 Q3 records that as the owner's decision, and
nothing measured since changes who takes it — the remaining question is a preference about
which way to disappoint somebody, not a fact. The one-line change is named in T0 if he wants it.

| Task | Status | Evidence |
|---|---|---|
| T0 decide the FOUR questions that have no precedent here | 🟡 **Three answered by building. Q3's MEASUREMENT half closed 2026-09-17 — all twelve combinations run, and the chooser now says what each format drops. What is left of Q3 is one preference: whether the DEFAULT moves off `refuse`, which is the owner's and is not a measurement** | **Q1 delta — answered by T1:** per-folder enumeration, no `changes.list`, on the WebDAV precedent. **Q2 identity — answered by T2 and [ADR-0030](../adr/0030-relocation-is-positive-evidence.md):** the path-shaped natural key is KEPT, and the gap that made `fileId` look necessary is closed by correlating a rename to its arrival by content hash instead of by changing how every provider is keyed. **Q4 `removed` semantics — answered by T4:** the Drive source never populates `removed`, so a scope or access change cannot become destructive evidence; absence-counting does its slower, corroborated job. **Q3 native files — ANSWERED 2026-09-16, all three renderers measured against one real Doc.** `export-odf` NOT byte-stable (three sizes in a four-byte window across four draws). `export-office` NOT byte-stable (17644 bytes every time, five different hashes over five draws) — and the member-level reading says why: **nothing inside the document changed at all**, only the zip's own member timestamps, on all 9 parts. `export-pdf` produced **identical bytes five times**, the first policy ever to survive this measurement. **One counterexample settles a policy against**, because enabling one needs stability for EVERY document: the claim is universal, so a single document that breaks it is the whole answer. Five identical draws are NOT the mirror image — one document, one type, one tenant, one day. So `refuse` stays the default for all three: measured for two, and a much narrower caution for the third. Enabling `export-pdf` is a decision the owner has not taken. **The precondition this row set — "it wants a Sheet and a Slide measured first" — WAS MET the same day:** both came back STABLE, five identical draws each, so `export-pdf` is now measured on all three editor types and nothing is blocking the decision but the decision. The trade it turns on is unchanged and is not a measurement: a `.pdf` is not editable afterwards, so carrying a Doc as PDF exchanges an editable original for a fixed rendering. See T3 and T6. **2026-09-17 — the measurement half of Q3 is finished and the trade is now ON THE SCREEN.** Every one of the twelve (policy, type) cells has been run; `export-pdf` is measured stable on all four editor types and is the only policy that carries all four. The product does not silently take the owner's decision: the default stays `refuse`, because 0042 T0 Q3 records that as his and nothing measured since changes who decides. What DID change is that the choice is now an informed one — `NATIVE_POLICY_COVERAGE` derives from `EXPORT_STABILITY` which kinds each format leaves behind, and the wizard says it beside the `<select>`: OpenDocument drops every Doc, Office drops every deck, PDF drops nothing and nothing comes back editable. **Before this, the chooser offered three formats as equals** and a person picking "OpenDocument — .odt, .ods, .odp" was choosing, unknowingly, to leave behind the kind of file that label starts with; they found out at discovery, or per file in the failures queue after the run. **The one-line change still open for the owner:** flipping the shipped default in `GoogleDriveSourceConfig` from `refuse` to `export-pdf` would make every Google file move by default. It is deliberately NOT taken here. |
| T1 the delta shape: a per-drive changes feed behind a per-folder port | 🟢 **Sidestepped for the first slice** | The slice enumerates per folder like `WebdavFileSource` and lets the natural key + ledger give idempotency — a pass costs a listing per folder and creates zero on the second run. Slower than a delta, and correct, which is the right order. `changes.list` remains unbuilt and unneeded until someone measures that the listing cost hurts. |
| T2 identity: opaque fileId vs the path-shaped natural key | ✅ **Done 2026-08-15 — path key kept, and the real gap found and CLOSED** | The audit's finding, verified by running it: a renamed file was not correlated at all, so it became an absence and — two clean scans later — a reported DELETION of a file plainly still there, carrying `inferred` evidence that ADR-0024 gate 3 refuses. A moved file was correlated and its only action was `keep`. Either way the target kept a stale copy nothing could remove. **[ADR-0030](../adr/0030-relocation-is-positive-evidence.md) was proposed, accepted by the owner the same day, and built**: relocations are recorded by natural key, a rename in place is now one move report instead of a phantom deletion, and `apply` removes the old copy under every ADR-0024 gate plus one that re-checks the arrival is ours and unchanged. ~~Appliance only~~ **Managed route built 2026-08-16**: `POST …/moves/{hash}/apply` + the `run-apply-relocation` job + an action-discriminated receipt (migration 0010), and the Moves screen offers the action in both editions. **Then audited twice more, because the first build of a destructive path is not the one to trust.** Round two confirmed 19 defects (gate 7 could not see the arrival; a correlation could pair the wrong two files; a tombstoned row still competed for arrivals) and produced the owner's decision to ASK THE TARGET before removing anything. Round three (PR #408) confirmed six more, of which two were unrecoverable: gate 4 admitted four statuses the ledger's own `UPDATE` refuses, and since this path removes first and records second, it did not race into "copy destroyed, ledger refused" — it guaranteed it; and an already-explained disappearance went on competing for arrivals, so a file renamed twice lost the explanation for its real move. Also: the mass breaker measured deletions and nothing else, so a whole corpus could relocate at once and every apply would sail through; a `keep` was enforced only by a button that happened not to render; a rename showed the operator a SHA-256; and `applyRelocation`'s statement had never been executed by any test — only the in-memory fake ran it, which proves the fake is self-consistent and nothing else. Nine integration cases now run the SQL itself. |
| T3 native Google editor files: export, or refuse | 🟡 **Built; THREE POLICIES AND THREE EDITOR TYPES MEASURED 2026-09-16. Under `export-office`: Doc and Sheet vary ONLY in the zip container, a Slide varies INSIDE five of its members and is refused. Under `export-pdf`: Doc, Sheet AND Slide byte-identical over five draws each — the measured way out for a refused deck. The default stays `refuse`** | `NativeFilePolicy` is `refuse` (default) / `export-office` / `export-pdf`, per migration as the owner chose. A refusal is thrown INSIDE the per-item boundary, so it lands in the failures queue with a verbatim reason and the rest of the folder still migrates — not skipped, which would report "migrated" for a file nobody copied. **The export paths must not be enabled for a real migration until `files.export` byte-stability is measured**: if it is not stable, `contentHash` sees a change every pass and every document is rewritten forever. **ALL THREE MEASURED on the owner's tenant, 2026-09-16** (`scripts/drive-export-stability.ts`, My Drive, 3000 ms gap, one `application/vnd.google-apps.document` last modified 2026-08-25). `export-odf`: four draws, three sizes in a four-byte window (3127558/3127560/3127561) — **NOT STABLE**, a variable-length field. `export-office`: five draws, **17644 bytes every time and five different hashes** — NOT STABLE, and a different failure, now MEASURED rather than guessed: every one of its 9 members is byte-identical across all five draws and only the zip's own modification stamps moved, so the instability is entirely in the CONTAINER and not in the document. (This section previously named `docProps/core.xml` and `w:rsid` as the likely cause. That hypothesis was wrong.) `export-odf` fails differently again: **`settings.xml` genuinely changes content**, with the other 24 members only restamped. `export-pdf`: five draws, **195869 bytes and one hash, `a4271e749a2279c5…`, five times** — the first policy ever to survive this. The default stays `refuse` for all three: measured for two, and for the third because five identical draws on ONE Doc of ONE type on ONE tenant are evidence and not proof — the red verdicts are conclusive in a way the green one is not. **Also recorded because the bytes are metered (0109 T3):** the same document renders to 17644 / 195869 / 3127560 bytes, a 177-fold spread, so the policy choice is also a choice about what a customer is billed. **THE SHEET AND THE SLIDE, MEASURED LATER THE SAME DAY** — the two this row had listed as "not measured, and not to be assumed", now aimed by `DRIVE_FILE_KIND` rather than by an id pasted from a browser. Both under `export-office`, same tenant, same 3000 ms gap, five draws each. They do NOT agree with each other, and that is the finding.

`export-office` on a **Sheet** (`application/vnd.google-apps.spreadsheet`, last modified 2023-12-28): **5659 bytes every time, five different hashes** (`d582487f…`, `04fb935c…`, `16761164…`, `eb76945f…`, `f65980a6…`). No member's content changed; only the zip's own modification stamps moved, on **all 10 members**. Normalise the container and the five draws **agree**. So a Sheet fails exactly as the Doc does: **container-only**, and ADR-0046's structural hash settles it.

`export-office` on a **Slide** (`application/vnd.google-apps.presentation`, last modified 2025-08-10): **lengths oscillate by one byte** — 34833 / 34832 / 34833 / 34832 / 34833 — and five different hashes. **Five members genuinely change content**: `ppt/_rels/presentation.xml.rels`, `ppt/notesMasters/_rels/notesMaster1.xml.rels`, `ppt/slideMasters/_rels/slideMaster1.xml.rels`, `ppt/theme/theme1.xml`, `ppt/theme/theme2.xml`. Thirty-seven more were only restamped. Normalise the container and **two draws still differ**, so this is emphatically NOT a rebuilt container.

**THIS REFUTES THE GENERAL CLAIM, AND THAT IS WHY IT WAS WORTH MEASURING.** ADR-0046 was accepted on a Doc, having recorded in its own text that it "still wants a Sheet and a Slide measured". The Sheet confirms it. The Slide does not: a container hash computes fine for a `.pptx` and still moves on every pass, so `export-office` on any migration containing a Google Slides deck would rewrite every deck nightly — the exact failure 0042 exists to prevent, arriving through the fix for it. One counterexample settles a universal claim; this is that counterexample, and it cost one command.

**WHAT CHANGED IS PLUMBING, NOT SLIDES — stated narrowly.** No `ppt/slides/slideN.xml` is among the five. What moved is three `.rels` relationship files and two themes, and the one-byte oscillation is what a relationship id changing width looks like. That is an OBSERVATION ABOUT WHICH MEMBERS, not a reading of what is inside them: `drive-export-members.ts` compares the zip index and never inflates a member, deliberately. Whether those five could be declared "not the document" is the same question `settings.xml` raises for `export-odf` — a claim about OOXML's semantics rather than about packaging — and ADR-0046 rule 6 already refused to answer it in a script. It is an ADR, and nobody has written it.

**`export-pdf` ON THE SAME SHEET AND THE SAME SLIDE, MEASURED 2026-09-16** — the run T0 Q3 said the `export-pdf` decision wanted first. Both **STABLE**: the Sheet 54591 bytes and one hash five times, the Slide **2017 bytes and one hash five times**. A PDF is not a zip, so no container normalisation is involved in either — these are greens on the bytes themselves, which is the strongest shape a green in this table can take.

**AND IT CALLS THE FILE WHAT ITS OWNER CALLS IT (2026-09-16, later).** The refusals said "a Google presentation" — the MIME suffix with a space in front of it, which is nobody's name for a deck — and went out that way to every customer whose deck was refused. `nativeFileWord` gives the four EDITOR types their product names (Doc, Sheet, Slides deck, Drawing) and leaves everything else on the suffix, because "a Google form" and "a Google site" ARE what people say and those refusals ask nobody to choose anything. **The ledger key is untouched and guarded to stay untouched:** `migration_discovery.refused_native` is still `{"presentation": 3}`, which is what `discovery.refusedNative.kind.*` translates in both locales — a connector that started writing "Slides deck" there would strand every stored count without a label. Same change fixed the way-out clause naming one policy twice in a row (`"export-pdf" is measured stable for a Slides deck ("export-pdf" is not editable afterwards)`); with a single alternative it now reads as one clause, and the parenthetical is kept only where there are two and it says WHICH.

**THIS IS WHAT MAKES THE SLIDE REFUSAL SURVIVABLE.** `export-office` refusing a deck was, until this run, a dead end: the customer was told their decks could not be carried and given nothing to do about it. `export-pdf` is now measured to carry the same file, so the refusal names a way out instead of a wall — derived from `EXPORT_STABILITY` by `stablePoliciesFor` rather than written into the sentence, because the sentence previously read *"export-pdf is stable for a Doc"* and said Doc to a customer whose deck had just been refused. The same derivation fixed a second defect nobody had noticed: a Doc refused under `export-odf` is now sent to `export-office`, which is measured stable for it and **keeps it editable**, where the fixed clause had sent it to PDF.

**THE 2017 BYTES ARE PART OF THE EVIDENCE.** That is a thin deck — the `.pptx` of the same file is 34833 bytes and the five members that moved there are `.rels` files and themes, i.e. packaging around not much content. A deck carrying images, embedded fonts or charts has more surface to vary on, and font subset tags and image recompression are where a PDF renderer is known to differ between draws. So this green is real, and narrower than a reader might take it: **a content-rich deck under `export-pdf` is the measurement worth taking next** (`DRIVE_FILE_ID` names one exactly).

**THE DRAWING, MEASURED 2026-09-17:** `export-office` renders it to SVG at **8324 bytes and one hash over five draws** — and because a Drawing has no ODF form either, `export-odf` asks Drive for the identical `image/svg+xml` and the one run answers both entries. Not an inference about Drive: `exportUrlFor` builds the url from the render table alone, so the two policies issue the same request. A guard derives every such pair and holds it to one answer, so nobody can later refuse a Drawing under one policy while exporting the identical bytes under the other. **Still not measured, and still not to be assumed:** a Drawing under `export-pdf` (a different request — PDF, not SVG); a Sheet or Slide under `export-odf`; a content-rich deck under `export-pdf` — **looked for on 2026-09-16 with `DRIVE_PICK=largest` and not found: the largest of the owner's four exportable decks IS the 2017-byte one**, so this tenant cannot answer it; any of this on a second tenant or day. Every `export-pdf` green is still five identical draws on one document of its type, and a green is not the mirror of a red. |
| T4b a refusal Drive makes that no policy can answer | 🟢 **DONE 2026-09-17 — found live, and it blamed the wrong account** | A Slides deck in the owner's Drive answered `403 cannotExportFile`, "This file cannot be exported by the user." Three things were wrong with what a customer would have been told, and only the first is cosmetic. **(1)** Fourteen lines of JSON envelope around nine words, into a failures queue read on a phone — `dav-refusal.ts` and `graph-refusal.ts` had each fixed this for their provider and Drive had nothing. **(2) The remedy named the wrong account.** `classifyFailure` sees 403 + "refused" and answers `target_refused`, whose sentence is *"The destination refused to accept this. Common causes are a full mailbox, a read-only folder or missing permission on the target account."* Google refused to EXPORT; the destination never saw the file, and a customer following that advice audits Nextcloud for a problem entirely inside Drive. **(3) It was retried.** `cannotExportFile` cannot succeed on a second attempt or a fifth, and unmarked it rode the automatic lane, so an item needing a person sat looking busy. `drive-refusal.ts` is the sibling of the other two — Google nests the actionable reason in `error.errors[0].reason` where Graph puts a string at `error.code`, so a reader for one finds nothing in the other. Reasons that are answers rather than weather (`cannotExportFile` observed; `exportSizeLimitExceeded`, `fileNotDownloadable`, `insufficientFilePermissions`, `appNotAuthorizedToFile` from Google's published list, **not seen here, and the distinction is kept**) park on the first attempt. An unrecognised reason passes through with Google's own words and **no invented advice** — silence is the honest answer, and inventing a remedy for an unmet refusal is the defect this module exists to fix. Until the category vocabulary grows a source-side answer the LINE carries the correction itself: "Nothing was sent to the destination for this item." Three mutations killed, each asserting its search matched first. |
| T4 the connector itself, against a fake transport | ✅ **First slice done 2026-08-15** | `google-drive-source.ts` implements `FileSource`, modelled on **WebDAV rather than Graph** — full folder enumeration, no `changes.list`, `removed` never populated. 11 tests against a fake transport, no network. Mutation-verified: silently skipping native files, dropping `trashed=false`, and downloading a native file instead of exporting it each fail exactly one test. **Amended 2026-08-15, second slice: the connector could never feed move detection.** Found preparing the owner's manual drill, not by a test: `listSince` returned a sentinel cursor and the connector had no `listKeys`, so with a cursor store configured — always, in production — every pass after the first counted its key set incomplete and `detectPathKeyedMoves` never ran. No rename, move, drift or absence-counted deletion could EVER surface for a Drive source; the ADR-0030 relocation path was unreachable through the connector that motivated it, and every pass reported clean. Fixed with `listKeys` answering from the listing `listSince` just made (consume-once memo — no second `files.list` per folder), plus a two-pass regression through the real `runFileSync` with cursors configured, red before the fix. Four mutations killed: deleting `listKeys`, bypassing the memo, dropping the path prefix, and removing the consume-once clear. **Amended 2026-08-16, third slice: a shared drive listed as EMPTY.** The docs promise `rootFolderId` may name a shared drive; the API silently omits shared-drive items from `files.list` without `supportsAllDrives` + `includeItemsFromAllDrives` (200, empty array — not an error), so a shared-drive migration would have discovered zero files and completed every pass clean, having copied nothing. The parameters now ride every listing, and `supportsAllDrives` the metadata read and download (`files.export` defines neither — an export is addressed by id alone, and the code says so). Three tests, three mutations, each killed. **Amended 2026-08-16, fourth slice: the bin is read** (`listTrashedPaths`): a trashed file's ORIGINAL path is recovered by walking its intact `parents` up to the migration root (the `'root'` alias resolved to its real id first — parents carry real ids, and comparing the alias reads the whole bin as out of scope), per-file failures skip that file only, and the shared-drive parameters ride the trash listing too. Drive deletions now carry positive `trashed` evidence and the apply action is offerable, end-to-end-tested through `runFileSync`; T0 Q4's decision stands untouched — `removed` is still never populated, and the bin is a different kind of evidence: a deletion the owner PERFORMED, found where they put it. Two mutations killed: deleting the method, and comparing the root alias instead of the resolved id. |
| T5 wiring: config schema, both editions, credentials | ✅ **Done 2026-08-15 — the connector is now REACHABLE** | `SourceConfig` has a `google-drive` variant with validation; both editions construct it through one shared factory (`drive-source-factory.ts`), each refusing in its own vocabulary — `GOOGLE_CLIENT_ID` for the appliance, `clientId` for a managed connection. Credentials: a **second `TokenProvider`**, because `createTokenProvider` is MSAL and would have posted a Google refresh token to `login.microsoftonline.com`; scope is `drive.readonly`, so the token cannot write. Managed needed a migration (`0008`) — `connection.kind` is a CHECK constraint, so without it the appliance could be pointed at a Drive and the managed edition could not represent one. 27 new tests. **Mutation-verified, 13 mutations, every one caught**: dropping the 401 retry, letting a caller override the Authorization header, removing single-flight, leaking the client secret into an error, defaulting a bad `nativeFilePolicy` to `refuse`, accepting an empty `rootFolderId`, routing Drive through the DAV resolver, deleting either edition's branch, using the wrong vocabulary in the managed refusal, dropping the pool close on a refusal, the factory inventing its own policy default, dropping `rootFolderId` on the way to the connector, and removing `google_drive` from the TS enum. |
| T6 proof against a real Drive | 🟡 **Both halves built and tested; the VERDICT half has now been run against the owner's tenant for ALL THREE policies (2026-09-16 — see T3), the fixture half has not** | `scripts/drive-export-stability.ts` with `DRIVE_CAPTURE_FILE` set produces, in ONE run, the T0 Q3 byte-stability verdict AND a redacted fixture — it also walks the folder tree and lists a subfolder, because path derivation is the thing most likely to be wrong and a flat listing of the root cannot gate it. `createReplayTransport` turns a capture back into a `DriveTransport`; an unmatched request THROWS and repeats are served in order, so a stale fixture cannot go green by answering nothing. **An adversarial audit of the redactor found 24 confirmed defects in it, including one live leak** — the preserved "extension" was everything after the last dot, and a native Doc has no extension at all, so any dot in a Doc's name carried the rest of the sentence into the fixture. All fixed, each with a test named after it. **What the tier will not cover, stated now:** anything Drive changes after the day it was recorded, and anything about the owner's specific documents — the verdict speaks to that and is printed, not stored.

**AMENDED 2026-09-16 — the instrument had been made unable to re-take its own readings, and was fixed the same day.** T3's refusal shipped, the script measures THROUGH the connector on purpose (its comment says why: the question is "what would a migration store"), and so the script inherited the refusal and could no longer measure `export-office` on a Slide or `export-odf` on a Doc — the exact two combinations its own output had condemned. The consequence is worse than the inconvenience: **a red verdict became permanent by construction.** Google rebuilding its `.pptx` exporter would change nothing, because the one instrument that could observe the fix declines to look, and the only route back to green would be editing `EXPORT_STABILITY` by hand — the "moving an entry on a guess" the three-answer table exists to prevent. A measurement that cannot be repeated is a recorded opinion with a date on it. Fixed with a third constructor argument, `{ exportDespiteMeasuredInstability: true }`, which lifts that ONE refusal and no other (`refuse` still refuses; a Form still has nothing to export; the bytes still arrive marked as a rendering, so a draw is hashed the way a migration would hash it). **Deliberately not a field on `GoogleDriveSourceConfig`** — that type is parsed from an appliance's config file and a managed connection's stored row, so a field there would be a text-file route around the one thing standing between a Slides deck and a library rewritten nightly. `an-instrument-that-cannot-take-its-own-reading.unit.test.ts` holds both halves: that the escape works for the instrument, and that no production call site has taken it. Proved by breaking, both ways.

**AMENDED 2026-09-16, later: `DRIVE_PICK=largest` — the measurement stops being taken on a document nobody chose.** Two failures, one root. First, the evidence: `export-pdf` was recorded `stable` for a Slides deck on a deck rendering to **2017 bytes** — a deck with almost nothing in it to be unstable about — because "the first file of that kind" is whatever Drive listed first. Second, the instruction: measuring a richer deck meant naming it, naming it meant an id, and the id went into a written command block as `PASTE_DECK_ID_HERE`, which was pasted, run, and answered 404 by Drive — **the second placeholder to reach Google that day**, after `sheet-file-id` that morning. `a-placeholder-that-reached-google.unit.test.ts` had already been written about the first one, and its own header says the defect was "in the INSTRUCTION, not the script". Twice is a pattern: any instruction carrying a blank to fill in is eventually run with the blank still in it, so the fix has to remove the blank rather than warn about it. `DRIVE_PICK=largest` exports each candidate ONCE and measures the biggest, so a substantial document is found without anybody naming one. Size is a PROXY for varying surface and is documented as one — a 4 MB deck of one photograph has less structure than a 400 KB deck of thirty charts — but it costs one export apiece, needs no parsing, and beats first-found by a wide margin. Drive reports no `size` for a native file, so the rendering must exist before it can be weighed; `DRIVE_PICK_LIMIT` (default 25) caps that spend, because an unbounded list turns "measure a good deck" into "export every deck they own". `candidatesToWeigh` in `drive-export-choose.ts` is the testable half and sits beside `chooseFile`, sharing its refusal wording; `DRIVE_FILE_ID` together with `DRIVE_PICK` REFUSES rather than letting one win, because either choice would make the output a lie about which document was measured; and the picker prints a count and a size, never a name or an id, like the run it feeds. **One guard in the first draft asserted nothing** — the name-printing check anchored on `\w+\.name` and so passed while a mutation printed `${best.file.name}`. Found by mutation, widened, re-proved. Three mutations killed: dropping the cap, ignoring the requested kind, printing the name.

**AMENDED again, same evening: the weigh loop lied about its own cause.** Reviewing the code just written, the per-candidate `catch {}` was bare. A grant that expires between the listing and the first export fails EVERY candidate with a 401, and the only sentence left was *"none of them could be exported under this policy — try another policy"*: a setting change proposed for an authentication problem. That is precisely the wrong-cause failure this workplan's refusals exist to prevent, arriving through the tool built to measure them. The skip per candidate is still right; a SILENT skip is not. The first failure's message is now kept and printed when every candidate fails, with the 401/403 case named so nobody changes a policy over an expired grant. Two mutations killed: restoring the bare catch, removing the 401/403 sentence. **Both of those mutations initially appeared not to kill anything, and both times the mutation script had silently failed to apply** — the third such no-op today. Every mutation now asserts that its search string matched before it claims a result. |
| T7 build ADR-0046: a rendering compared by its parts | 🟢 **DONE — (a)–(d) built, the wiring live on both sides, and `export-office` refusing the one thing it measured unstable** | [ADR-0046](../adr/0046-a-rendering-is-compared-by-its-parts.md), accepted 2026-09-16 on the T3 measurement — `export-office` is byte-unstable ONLY in its zip container, now confirmed across **fifteen draws in three runs**, every one of them "no member's content changed, only zip stamps moved, on 9 members". **(a) DONE** — `packages/shared/src/container-hash.ts`: `containerContentHash` takes member names sorted and the sha256 of each member's UNCOMPRESSED bytes, ignoring member timestamps, order, compression method and level, extra fields and the archive comment. It answers `null` rather than throwing when it cannot canonicalise (not a zip, an unimplemented compression method, zip64, a malformed index, an inflate that fails), so the caller falls back to hashing the whole file — conservative: it can cause a rewrite, never a missed change. **(b) DONE, and guarded at the SOURCE because behaviour cannot reach it** — swapping sha256 for CRC-32 passes every one of the fifteen behavioural tests, measured rather than assumed, because CRC-32 detects change perfectly well on any fixture a test can write; its weakness is an adversary choosing a collision. `a-content-hash-built-from-thirty-two-bits.unit.test.ts` therefore reads both files and asserts the content hash never imports `crc32` while the diagnostic still does. **The version tag exists** — `zip1:` on the front, read by the `sameFingerprintVersion` that already keeps `cal1`/`card1` rows from being misread, and baked INTO the digest so two schemes cannot collide even bare. **(d) DONE, and deliberately BEFORE the wiring.** A stored hash records its scheme in the value itself — the tag on its front, with no column beside it — and the rule is that nothing compares across schemes. Three files compare two stored hashes and decide something: `verification.ts` (§20's content sample) had held the rule since the DAV fingerprints were versioned; `confirmation-pass.ts` (whether a confirmed-list row reads `verified` or `differs`) did not; `apply-deletion.ts` (what the relocation gate SAYS when it refuses) refused correctly but blamed the customer for an edit nothing had observed. All three now reach the one shared `sameFingerprintVersion`, and `a-hash-compared-against-a-different-scheme.unit.test.ts` is the join: it names every comparison site, asserts each reaches the shared rule, and asserts none re-derives the tag regex. **The ordering is the point** — the first pass that writes a `zip1:` row against a whole-file target read would otherwise report every already-migrated document as changed, on the page somebody deletes their originals from. The rule cannot be added afterwards without shipping that pass. **(c) DONE — the report says what it compared.** `ClaimKind` gains a third word, `container-parts`, beside `byte-hash` and `fingerprint`: *"by the document's parts"* on screen, in both locales. The ceiling alone could never have produced it — two rows in the `file` domain can have been compared by two different questions, and `claimCeilingFor` knows only the domain. **What tells them apart is the scheme tag (d) built**, which is why (d) had to land first: `claimFor(domain, contentHash)` narrows the ceiling when the stored value carries `zip1:`, and never raises one (a `cal1:` calendar row stays `fingerprint`; an unknown tag is left alone rather than guessed at). `rowFor` now takes the stored hash **required rather than optional** — an optional parameter would let a call site forget it and quietly print "by hash" over a row nobody compared by bytes, which is the one sentence (c) exists to prevent; the compiler named all sixteen call sites.
| T8 what the first live run left open: Slides, suffixes, and an edit nobody copies | 🟡 **Listed 2026-09-22. (d) FIXED by #1083; (c) DECIDED 2026-09-23: keep; (g) DONE 2026-09-23. (b) DECIDED 2026-09-23: first half built, second half next** | Each point was checked against the source on 2026-09-22. **(a) Slides under `export-office` are refused, on purpose.** T3 measured five parts of the `.pptx` changing between draws, beyond the zip wrapper. Nothing is built to change that: it needs either an ADR declaring those parts not the document, or a change signal that is not the bytes (see (d)). `export-pdf` is measured stable only on a thin deck; `export-odf` is stable. Under the default `refuse` a deck is `policy_refused`. **(b) Switching the export policy renames every native file.** `exportedName` appends the export's suffix, and the name is part of the natural key, so under `export-office` a Doc listed as `Report` becomes `Report.docx`: a new item. The comment calling that *"survivable only because … no deployment has selected one"* is stale since 0125 made the policy revisable on a live migration. The owner would see the files arrive under the new names while the rows refused under the old names stay on the Failures screen for good, because nothing lists those keys again. A Slides deck that is still refused under the new policy appears twice. Between two export formats it is worse again: every document is copied a second time beside its old copy, and because a Drive pass lists every folder, `detectPathKeyedMoves` sees each old copy's name missing with no arrival carrying its bytes (the new format's bytes differ), so after two passes each old copy is reported as an inferred deletion at the source. **DECIDED 2026-09-23 (owner: *"acknowledged what you adviced"*): one record per Google document, whatever its format.** Every row carries the document's Drive id (`source_ref`), so when a pass meets a Google document under a name the ledger does not know, it looks for rows with the same Drive id under another name. A refused or failed one is closed as superseded by the new name, and it leaves the Failures screen by itself. An earlier export that is on the target is never deleted for the owner. It is offered in the Deletions queue as an earlier export of the same document, not as a deletion at the source, and the owner decides. The export-format setting says all of this before a save: every Google document gets a new name, and earlier exports stay until they are removed. Until it is built, the owner holds off switching the format on a live migration. **First half built 2026-09-23: the refusals.** Matched by name rather than by Drive id alone: the Drive source lists each native document's paths under the other policies (`formerPaths`, the same `exportedName` rule), the file pass hashes them, and after a pass that listed everything, `supersedeFormerNames` closes a `failed` row under a former name that pass did not list. A name still listed is left alone (a real `Deck.pdf` beside a deck called `Deck`), and so is a row whose recorded source handle is another object's; failures now record it. The status is `superseded` (migration 0056): off the Failures screen, out of `placedItems` and verification's source counts, never placed, and retried if the name comes back. **Second half, still open: earlier exports on the target.** **(c) Doubled extensions: DECIDED 2026-09-23, keep.** The suffix is skipped only when the name already ends in that same suffix, so a Sheet named `Budget.xls` becomes `Budget.xls.xlsx` and a Doc named `Notes.rtf` becomes `Notes.rtf.docx`. The owner: *"if those are the original files and work in the target, we keep"*. Both conditions hold. Only a Google-native document is renamed, and the name the owner gave it stays whole in front of the suffix; an uploaded `Budget.xls` is copied byte for byte under its own name. Nextcloud types a file by its last suffix (`Detection::detectPath` in `nextcloud/server`, read 2026-09-23), and that suffix is the format the export actually is. The tests pinned only the same-suffix case; `a-document-that-arrived-without-its-extension.unit.test.ts` now pins this one too. **(d) FIXED by #1083 (2026-09-22): a Drive file edited after its first copy was never copied again, and the same held for OneDrive.** The file domain's change signal is `sourceVersion`, read from `FileItem.etag` (`dav-sync.ts`), and `classifyKnownItem` answers `skip` when it is absent. Neither Drive's `toFileItem` nor the Graph drive listing set it; only the WebDAV source did. It is also why no unstable export was ever rewritten nightly: nothing was rewritten at all. Box and Dropbox had the same gap. All four now fill it through `fileVersion` (`packages/shared/src/file.ts`): the provider's content hash where it keeps one (Drive `md5Checksum`, OneDrive `quickXorHash`, Box `sha1`, Dropbox `content_hash`), and the last modification otherwise. That is not the `version`/`eTag` first planned here, because those move on metadata alone (Drive's `version` *"reflects every change made to the file"*, and Graph's `eTag` covers *"metadata + content"*), so a rename would re-copy unchanged bytes. A native Doc has no checksum, so its version is its `modifiedTime`, the only sign of an edit it shows before it is exported. **(e) ADR-0046's per-part hash does not reach the ledger.** Drive's `fetch` marks an export `rendering: true`, but `dav-sync`'s `fetchRaw` rebuilds the raw item from `item`, `content` and `body` only, so `contentHash` sees no flag and hashes the whole file. The guard test for it reads source text, not a stored hash. This is harmless while (d) holds, and once versions arrive a version decides a rewrite, not a hash. ADR-0046 and its register row should still say what is actually live. **They do since 2026-09-23**: the status line, the first operative rule and the register row now say built but not reaching the ledger. The code half stays open: whether to pass the marker through `fetchRaw`, and what that changes for relocation and verification, which compare stored hashes. **(f) An export has no size until it exists**, and it is always buffered. Drive's own export size limit (`exportSizeLimitExceeded`) has no fallback, and image-heavy decks are the likely casualty. Not seen live. **(g) Stale docs: DONE 2026-09-23.** `docs/feature-matrix.md`, `docs/selfhost-quickstart.md` and `docs/owner-test-runbook.md` called the exports unmeasured, and the ADR register called ADR-0046 unbuilt. All four now say what was measured and what is live. **Order:** (d) first, because it was data going stale silently and it changes what (a) and (e) need: done. A deck is now re-exported only when its `modifiedTime` moves, which is the change signal that is not the bytes that (a) names, so whether the refusal still protects anything is (a)'s next question. Then (b), before any owner switches policy on a live migration. (c) is decided and needs nothing built. (a) and (f) need live measurement. |

**A PURITY GUARD CAUGHT THE FIRST ATTEMPT, and the fix was the better design.** `confirmed-list.ts` is asserted to import nothing that reads the world, so that every assertion over the claim vocabulary can be exhaustive rather than sampled. Importing `container-hash.ts` for one string constant would have ended that, and copying the tag would have been the drift the scheme exists to prevent. So the three scheme tags and the never-compare-across rule moved to `packages/shared/src/fingerprint-scheme.ts`, **which imports nothing and is guarded to keep importing nothing**. `dav-canonical.ts` and `container-hash.ts` re-export from it, so no caller's import path changed.

**THE WIRING IS LIVE, BOTH SIDES, and it landed with the gate that makes it safe (owner's decision, 2026-09-16: "do the wiring, gated on a preflight slides count").** `RawFileItem.rendering` marks bytes that exist only because this product asked a provider to render something — set by Drive's export branch and nowhere else, because the narrowness IS the safety argument: a `.zip` a customer stored must keep being compared by its bytes. `dav-sync.ts` reads the marker and takes `containerContentHash`, falling back to whole-file on `null`. On the other side `contentHashFor` gained a `scheme` parameter and the confirmation reader asks for the scheme the ROW was stored in, read off its own tag; a target that cannot answer that question answers `undefined`, which reads as unmeasured rather than as a difference.

**THE GATE: `export-office` REFUSES A SLIDES DECK, per item.** `EXPORT_STABILITY` in `google-drive-source.types.ts` is the one place the measurements live, with three answers rather than two — `stable`, `unstable`, `unmeasured`. `refusalFor` refuses on `unstable` with a sentence that says what was measured and what to do instead; `exportUrlFor` refuses to build the URL at all, a second gate on purpose, because the first is protected only by the order of two statements in `fetch`. `export-odf` on a Doc is refused by the same rule.

**`unmeasured` IS RECORDED AND NOT ACTED ON**, and the line is drawn there deliberately. Refusing on absence of a measurement would have turned off a Drawing under `export-office` — which #969's predecessor deliberately made work — and would have taken `export-pdf` on Sheets and Slides with it, the escape hatch an owner reaches for. **All four have since measured STABLE**, the Sheet and Slide on 2026-09-16 and the Drawing on 2026-09-17: every entry that has ever left this column left it for `stable`, and none for `unstable`. A blank is a reason to go and measure; the table now names exactly which blanks.

**THE PREFLIGHT COUNT, end to end.** The Drive source tallies what its policy will refuse **during the listing the preflight already makes** — a map lookup per file, no extra request — and `buildTask` attaches it to the domain's result as an optional capability, in the shape `listTrashedPaths` and `storageUsage` already use. Migration 0047 adds `migration_discovery.refused_native jsonb`, nullable on the table's own established rule: NULL is "did not look" (every non-Drive source, permanently), `{}` is "looked and found none". The confirm screen reads it as a note beside the existing two — *"3 Google Slides **will not be copied** because this export format does not produce the same file twice"* — in both locales, inside the fifteen-word budget 0118 set.

**THE COUNT IS THE WARNING; THE REFUSAL IS THE GATE.** They are not interchangeable and the guard says so: a preflight count is a snapshot, and a deck added to the Drive afterwards is refused all the same. **Enabling `export-office` is still a separate owner decision** and still wants a Sheet and a Slide measured — the 2026-09-16 attempt measured the Doc three times instead, because `DRIVE_FILE_KIND` had not merged and the variable was ignored. |

## What this is

A `GoogleDriveSource` implementing the existing `FileSource` port
(`packages/shared/src/ports.ts:171`), so a Google Workspace tenant can be a **source** for the
file domain the way OneDrive/SharePoint already is.

`packages/connectors/src/graph-drive-source.ts` (521 lines) is a delta-capable, OAuth2, opaque-id
file source that already implements this port, and it is the closest thing to a template.

**Corrected 2026-08-15, after a read-only audit of this plan's own claims.** The first draft said
"the seams exist" and called this "the second connector of its kind". That was too generous:
`GraphDriveSource` is **wired into nothing** — `SourceConfig` has no drive variant, and neither
edition's builder constructs it. It is a class with tests, not a working source. So T5 is not
"follow the existing wiring"; there is no existing wiring for a file source of this shape, and
whoever does T5 will be cutting that path for the first time.

Answering the question that prompted this directly: **today there is no Google connector of any
kind.** `SourceConfig` (`packages/shared/src/config.ts:253`) is

```
ImapOAuth2Source | CalDAVSource | CardDAVSource | WebDAVSource
| GraphCalendarSource | GraphContactsSource | GraphMailSource
```

and Drive is not reachable indirectly either: Google withdrew WebDAV support years ago, so
`WebDAVSource` cannot be pointed at it.

## Why the OneDrive precedent does not make this easy

Three of Drive's properties conflict with assumptions this repo has baked in. Each is a decision
before it is code, which is why T0 exists.

| | OneDrive via Graph (built) | Google Drive |
|---|---|---|
| delta granularity | **per folder** — `{scope}/drive/root:/{path}:/delta` | **per drive** — `changes.list` from a `startPageToken` |
| file identity | GUID **and** a stable server path | `fileId` only; path is derived by walking `parents` |
| content | every file has bytes and a `quickXorHash` | native Docs/Sheets/Slides have **no bytes** and no checksum |

### The delta mismatch is structural, not cosmetic

`FileSource.listSince(folder, cursor)` is **per folder** — the sync loop calls it once per folder
and stores one cursor per folder. Graph fits because its delta can be scoped by folder path;
`graph-drive-source.ts:118-133` does exactly that, and its comment records what happened when it
did not:

> the files sync calls this […] delta, so every folder's poll processed every item on the drive
> […] cost per pass — 0026 T1 item 1

Drive has no folder-scoped changes feed. `changes.list` reports the whole drive. Implementing
`listSince` naively — call `changes.list` per folder and filter — reproduces that exact defect,
deliberately, in a connector written after the lesson. **T1 is a design decision, not an
implementation detail**, and it must be made before any connector code is written.

**And it cannot be papered over inside the connector.** The sync loop owns the cursor, not the
source: it reads and writes one per folder (`domain-sync.ts:679`) against a store keyed
`uk_cursor_tenant_mapping_folder` (`schema-pg.ts:743`). A connector is handed one cursor per folder
and must hand one back per folder; there is no way for it to say "this source has a single
cursor".

### Identity is the one that can duplicate customer data

The file domain keys items by **normalized path** (§10; `graph-drive-source.ts` header calls it
"Path normalization as natural key"). A Drive file has no intrinsic path — it has a `fileId` and a
`parents` array, and its path is a derived walk. Two consequences:

1. A file **moved** between folders keeps its `fileId` and changes its derived path, so it is
   copied again under the new path while the old copy stays. What the move DETECTOR then does is
   the part that matters, and it is covered below — the target converges through the deletions
   queue rather than through the key.
2. Two files can hold the **same name in the same folder**. Drive permits it; a path-shaped key
   cannot express it, so one would silently overwrite or collide with the other.

**Corrected again, 2026-08-15 — and this is the important correction.** The first draft offered
"`fileId`-anchored keying" as a free choice; the audit said it required superseding ADR-0020. Both
framings were wrong, because **moves are already correlated by CONTENT HASH, not by path.**

`detectPathKeyedMoves` (`domain-sync.ts:1588-1698`) takes a disappeared ledger row, looks up its
`contentHash` among the arrivals of this pass, and pairs them — consuming each arrival so that
three identical files deleted and one created is one move and two deletions, not three moves.

That changes the whole question:

- A Drive file moved between folders keeps its bytes. **Its move is detectable today**, with no
  identity change at all.
- A `fileId` is not merely barred by ADR-0020 — it is **unnecessary**. The correlation work is
  already being done by something the target can produce.
- And that is precisely why the ADR bars it: a content hash **is** recoverable from the target
  (hash what is there), while a `fileId` never can be. ADR-0020's own **Decision 4** already
  establishes content-hash as a legitimate anchor for items lacking an intrinsic id.

**So T2 does not need an ADR change and should not have one.**

Worse, the same-name-siblings case is not a design decision at all — it is a hard blocker.
`fileNaturalKeyHash(path) = sha256('file:' + path)` (`hash.ts:87-89`) feeds a **database unique
index**, `uk_item_tenant_mapping_natural_key_hash` on `(tenantId, mappingId, naturalKeyHash)`
(`schema-pg.ts:282-286`). Two Drive files with the same name in one folder produce one key. They
cannot both be represented, whatever the connector does.

### `removed` does not mean deleted, and this repo treats it as proof

**Found by the audit; the first draft of this plan missed it, and it is the most dangerous of the
four.**

`resolveReportedRemovals` (`domain-sync.ts:1410-1467`) describes itself as *"the only place in
this product where a deletion is KNOWN rather than suspected… No corroboration is required and
none would help."* Items arriving that way go straight into the owner's deletions queue with
`confirmed: true, evidence: 'reported'`, and under ADR-0024 the owner can then **apply** that
decision — the only destructive operation in the product.

Google's `changes.list` sets `removed: true` for changes that are **not** deletions: losing access,
a file leaving a shared drive's scope, a sharing change. Feeding those into this path would present
an owner with confirmed deletion evidence for files that still exist, and offer to delete the
target's copy. **This is a blocker, and it is a data-destruction blocker rather than a duplication
one.** A Drive source must either not populate `removed` at all, or populate it only from a change
class it can prove means deletion.

### Native editor files have no bytes

A Google Doc is not a file with content; it is a server-side document exported on request through
`files.export`, choosing a target format (`.docx`, `.pdf`, …). This collides with three things at
once:

- **`contentHash`** — the repo hashes the bytes it will write. If an export is not byte-stable
  across runs, every pass sees a changed file and rewrites it forever. Whether Google's export is
  byte-stable **is not something to assume**; T3 must measure it.
- **§20 verification** — checksum sampling compares the target against what was written. Same
  dependency.
- **fidelity** — an exported `.docx` is a lossy rendering, and the original is not recoverable
  from it. Copying a Doc as `.docx` and reporting it migrated is a claim the product would be
  making on the owner's behalf.

Refusing native files with a named reason is a legitimate outcome of T3, and a better one than a
silent lossy export. `imap-groups.ts` is the precedent for that shape: an honest, tested "no"
rather than an empty result that reads as "there was nothing".

## T0 — decide the four questions

No code. Write the answers into this file, with reasoning, so T1–T3 implement a decision rather
than discover one. **A fourth was added on 2026-08-15** — the audit of this plan found a blocker
the first draft missed, and it is the one that can destroy data rather than duplicate it:

1. **Delta**: one whole-drive poll shared across folders, or per-folder filtering, or a change to
   the `FileSource` port. Name the cost of each.
2. **Identity**: path-shaped natural key (consistent with every other file source) versus
   `fileId`-anchored (correct for Drive, divergent from the rest). A per-source difference in
   keying is a real cost — §20 and the ledger read the same column for every provider.
3. **Native files**: export with a fixed format map, export with an owner-chosen map, or refuse
   with a reason. Measure export byte-stability before choosing, because two of the three options
   depend on it.
4. **`removed` semantics**: whether a Drive source populates `removed` at all. It feeds the one
   path in this product where a deletion is treated as KNOWN and becomes owner-actionable
   destructive evidence, and Drive sets the flag for access and scope changes that are not
   deletions. The safe default is to populate nothing and let the existing absence-based detector
   do its slower, corroborated job; departing from that needs a change class provably meaning
   deletion.

## T1 — the delta shape

Implement whatever T0 decided, with the cursor stored in the existing `SyncCursor` shape. The
acceptance property is the one 0026 T1 already paid for: **a pass over N folders must not process
every item on the drive N times.** Assert it directly — count transport calls in a unit test with
a fake, the way the existing connector tests do.

## T2 — identity, and the two real gaps

Keep the path-shaped natural key. No ADR change. What is left is narrower than "moves do not
work", and it is two specific things:

1. **A rename IN PLACE is not detected as a move.** `domain-sync.ts:1641` requires the arrival's
   collection to differ: `candidates.findIndex((c) => c.collection !== row.collection)`. Same
   folder, new name therefore degrades to a disappearance plus an unrelated arrival, and after
   `DELETION_CONFIRMATIONS` clean passes it is reported as a deletion. Relaxing that condition is
   nearly a one-liner — and needs care, because same-folder-same-hash is also exactly what a
   genuine duplicate looks like. Whichever way it goes, pin it with a test.

   **Corrected 2026-08-15, after running it.** The one-liner is real and it is the wrong fix.
   Two facts, both now pinned in `move-detection.unit.test.ts`:

   - The rename's deletion report carries `inferred` evidence, and **ADR-0024 gate 3 refuses
     `inferred` outright** (`weak_evidence`). So the owner is shown a deletion of a file that
     still exists and cannot act on it.
   - A *detected* move is no better: the moves queue has exactly one action, `keep`, which
     acknowledges and changes nothing.

   So every source-side reorganisation leaves the target holding a stale copy that the product
   will not remove, and relaxing the filter alone would swap an unappliable deletion for an
   unappliable move rendered as "moved from `a` to `a`" — `movedToCollection` cannot express a
   rename, because what changed is the NAME.

2. **Convergence waits on a human — and for a move, waiting does not help, because there is
   nothing for the human to press.** Detection reports; the target only follows once the owner
   *applies* (ADR-0024), and no apply exists for this class. For a target nobody is working in —
   the owner's stated case — that is the whole gap.

   **[ADR-0030](../adr/0030-relocation-is-positive-evidence.md) proposes the fix and is
   Proposed, not Accepted**: record the relocation by natural key rather than by collection,
   correlate on the key so a rename and a move are one event, and admit a correlated relocation
   as a POSITIVE evidence class at gate 3 — on the specific ground that the bytes are, at the
   moment of applying, verifiably on the target under the new key, so removing the old copy
   cannot lose data. That argument is stronger than the `reported` evidence gate 3 already
   accepts. Per-mapping **auto-apply** stays out of it deliberately: "safe to press once, having
   looked" is not "safe unattended", and that is a separate decision.

Two things stay true regardless and must be said out loud to the owner rather than discovered:

- Two files sharing a name in one folder **cannot both be represented** — the DB unique index on
  `(tenantId, mappingId, naturalKeyHash)` makes that a hard stop, not a tuning question.
- A file **edited and moved in the same pass** has a new hash and will not correlate: it appears as
  a delete plus an add. Against an untouched target that still converges to the right end state.

## T3 — native editor files

Implement the T0 decision. If exporting: pin byte-stability with a test that exports the same
unchanged document twice and asserts identical bytes — and if it is NOT stable, say so here and
change the decision rather than shipping a connector that rewrites every Doc on every pass.

### Said here, as this section asked: all three renderers, measured

Measured 2026-09-16 on the owner's tenant, **one Google Doc** (`modifiedTime`
2026-08-25T06:30:25.392Z), untouched throughout, exports three seconds apart.

| policy | draws | bytes | verdict |
| --- | --- | --- | --- |
| `export-odf` | 2 + 2 + 5 | 3127558 / 3127559 / 3127560 / 3127561 — four sizes in a four-byte window | **NOT STABLE** |
| `export-office` | 5 | 17644 every time, five different hashes | **NOT STABLE** |
| `export-pdf` | 5 | 195869 every time, one hash `a4271e749a2279c5…` five times | **stable over five draws** |

**T0 Q3 is answered.** Two of the three export policies are disproved. The third is the first
credible candidate this workplan has ever had, and it is not the same kind of fact.

**The asymmetry is the spine of this section, so it goes first.** A policy needs a UNIVERSAL
claim: every document, every pass, or `contentHash` sees a change and the migration rewrites the
lot. So:

- **NOT STABLE is conclusive.** One counterexample disproves a universal claim. There is no
  sample size to argue about and no point re-running against more Docs hoping for a better
  average — a second failing document adds nothing, and a passing one rescues nothing.
- **Five identical draws are not the mirror image.** They are five draws that failed to disprove
  it, on ONE document, of ONE type, on ONE tenant, on one day. That is the best evidence this
  repository has about an export policy and it is still evidence, not proof.

`refuse` therefore remains the default for all three. For `export-odf` and `export-office` that
is now the correct answer to a measured behaviour rather than caution about an unmeasured one.
For `export-pdf` it is caution again — but about a much narrower gap than before.

**THE TWO FAILURES FAIL DIFFERENTLY, and the difference is diagnostic.**

`export-odf` moved in LENGTH — three sizes across four draws. Something inside the container
changed size, which means a variable-length field: a fractional-second timestamp, a number
rendered without padding.

`export-office` held 17644 bytes across all five draws and hashed differently every time.
Nothing changed size; something was overwritten IN PLACE.

**WHAT THAT SOMETHING IS — measured 2026-09-16, and NOT what this section first guessed.**
The paragraph here used to name `docProps/core.xml` timestamps and `w:rsid` values as the
likely culprits, labelled a hypothesis. It was wrong, and the real answer is better. Reading
the zip index of each draw (`scripts/drive-export-members.ts`) gives:

| policy | members | what moved |
| --- | --- | --- |
| `export-office` | 9 | **nothing inside the document.** Every member's content is byte-identical across all five draws; only the zip's own modification stamps moved, on all 9 |
| `export-odf` | 25 | **`settings.xml` changed content.** The other 24 were only restamped |

So the two policies do not fail for the same reason at all, and only one of them fails in a
way that needs to know anything about the document format:

- **`export-office` is a CONTAINER problem.** Google rebuilds the `.docx` zip with fresh member
  timestamps around parts that are bit-for-bit identical. A hash taken over member names and
  member contents, ignoring the zip's own bookkeeping, agreed across all five draws — measured,
  not argued. Nothing needs parsing; nothing needs a decision about what may be discarded.
- **`export-odf` is a CONTENT problem, and a container problem on top.** `settings.xml` — the
  ODF part that holds application and view settings rather than the document — genuinely varies,
  which is what moves the total length. Ignoring the container is not enough here: five draws
  still differ once the stamps are set aside. Making this policy usable means deciding that a
  named part may be ignored, which is a format-specific judgement about what counts as the
  document.

**This inverts the tractability ranking for the second time, and now on evidence.** The first
measurement suggested `export-odf` was the better candidate; the same-length `export-office`
result suggested the reverse on a guess about fixed-width fields; the member-level reading
settles it. `export-office` is the tractable one, and by a wider margin than any guess had it:
its failure is entirely outside the document.

**AN OBSERVATION NOBODY ASKED FOR, recorded because the bytes are metered.** One document
renders to 17644 bytes of `.docx`, 195869 of `.pdf`, and 3127560 of `.odt`. That is a
**177-fold** spread between the smallest and the largest rendering of the same content. A PDF
carrying embedded fonts plausibly explains its middle position; what makes the ODT three
megabytes is not explained here. This is not a correctness problem, but this product meters
first-copy bytes (0109 T3), sums them onto an invoice, and prices tiers off them — so the
choice of export policy is also a choice about what a customer is billed for, by two orders of
magnitude. Worth knowing before anybody picks a default.

**WHAT IS STILL NOT MEASURED**, stated so nobody reads the green as broader than it is:

- ~~a **Drawing** under `export-pdf`~~ — **MEASURED 2026-09-17: 16854 bytes and one hash, five
  draws. STABLE.** A different renderer from the SVG pair and a different size, which is the cheap
  confirmation that the PDF branch answered.
- ~~a **Sheet** or a **Slide** under `export-odf`~~ — **MEASURED 2026-09-17, and both are
  CONTAINER-ONLY.** A Sheet: 12856 bytes, five hashes, **zero members changed content**, 15
  restamped, normalised draws agree. A Slide: 12633 bytes, five hashes, zero content changes, 16
  restamped, normalised draws agree. By this table's own definition — `stable` is "byte-identical
  OR settleable by the container hash" — both are **stable**, the same shape as `export-office` on
  a Doc and a Sheet, settled by the same ADR-0046 hash.
- a **content-rich deck** under `export-pdf`. **SOUGHT AND NOT FOUND on this tenant, 2026-09-16.**
  `DRIVE_PICK=largest` weighed every Slides deck in the owner's Drive — five found, one not
  exportable, four weighed with one export apiece — and the biggest renders to **2017 bytes: the
  same document already measured**, same `modifiedTime`, same hash. So the caveat is not an
  oversight and is not closable here: this Drive holds no deck with enough in it to answer the
  question. The green is now slightly stronger than it was (the deck measured is the LARGEST of
  four, not merely the first found) and no wider: images, embedded fonts and charts remain the
  surface a PDF renderer is known to vary on, and none of them has been put to it. Closing this
  needs a Drive that has such a deck.
- any policy on a **second tenant** or a **second day**.

*(A Sheet and a Slide under `export-office` and under `export-pdf` were on this list until
2026-09-16 and have since been measured — see T3. The `export-office` Slide came back NOT STABLE
and is refused; the three `export-pdf` runs came back stable. A **Drawing under any policy** was
on it until 2026-09-17 — see below.)*

**THE TABLE HAS NO BLANKS LEFT (2026-09-17).** All twelve cells have been run on the owner's
tenant. Two are `unstable` and ten are `stable`, and `export-pdf` is now stable on **all four**
editor types, which is the fullest evidence the escape hatch can have short of a second tenant.
What a full table does NOT mean is settled: every green is still five draws, of one document, of
one type, on one day. `unmeasured` therefore has no instances and STAYS — it is the answer for a
type Drive adds next, and the day a rule has no instance is not the day to delete it.

**A REFUSED DECK NOW HAS AN EDITABLE WAY OUT, which is the product change hiding inside a table
edit.** Until `export-odf` on a deck was measured, the only measured way to carry a deck refused
under `export-office` was `export-pdf` — a fixed rendering. The refusal now reads *"export-odf"
and "export-pdf" are measured stable for a Slides deck ("export-pdf" is not editable
afterwards)*, leading with the format that keeps the deck editable and marking the lossy one as
the aside. Nobody wrote that sentence; `wayOutFor` derives it, which is why recording a
measurement changed the advice.

**AND THE SAME DECK IS UNSTABLE UNDER `export-office`.** Five members genuinely move there; under
`export-odf` none does. Two renderers, two answers, same document — the sharpest evidence in this
workplan that a policy cannot be judged as a whole, and the reason the table is keyed per
(policy, type).

**THE SCRIPT HAD BEEN CONTRADICTING THIS TABLE SINCE ADR-0046, and the owner's run is how it was
found.** Both `export-odf` verdicts printed `✖ NOT STABLE`, then *"Ignoring the zip's OWN
bookkeeping ... the draws agree ... the one a rewrite of the container would fix"*, and then, in
the next sentence, *"MUST NOT be enabled for a real migration ... keep the default `refuse`"*.
Both cannot be true. The rewrite SHIPPED as ADR-0046: `containerContentHash` ignores the zip's
stamps, order and compression, and it is live on this exact path — `google-drive-source.ts` marks
every export `rendering: true` whatever the policy, and `dav-sync.ts` hashes a rendering that
way. `export-office` on a Doc and a Sheet are recorded `stable` on precisely this evidence and
have been exported ever since.

The script now has the table's three answers instead of two: byte-identical, **settled by the
container hash**, and genuinely unstable. Only the third exits 2 and keeps the `refuse` advice.
`a-red-verdict-the-table-calls-stable.unit.test.ts` holds the claim the recording rests on — a
rendering whose members are identical and whose stamps moved is ONE content hash to the code that
does the copying — and asserts the settled branch precedes the refusal sentence in the source.

This is the fourth piece of guidance found in one day that was sound when written and expired
when a later decision was taken, after the Drawing's "deliberately absent", `config.ts` listing
which measurements were blank, and `failure-category.ts` claiming no retry policy keys on a
category. The pattern is worth a deliberate sweep rather than four accidents.

**THE DRAWING, MEASURED 2026-09-17 — and one run moved two entries.** `export-office` on the
owner's Drawing: **8324 bytes and one hash, `31bff0f3661a1eab…`, five draws.** An SVG is XML
text, not a zip, so no container normalisation is involved: this is a green on the bytes
themselves, the same shape as the three `export-pdf` greens and the strongest a green in this
table can have.

It is also, without a second run, the measurement for **`export-odf` on a Drawing** — and that is
an identity rather than an inference. `exportUrlFor` builds the export url out of
`NATIVE_EXPORT_TYPES[policy][mimeType]` and nothing else; the policy's NAME never reaches Google.
A Drawing has neither an ODF nor an Office form, so both entries read `image/svg+xml` and both
policies issue the byte-identical `files/{id}/export?mimeType=image%2Fsvg%2Bxml`. One request
cannot have two answers. `an-answer-that-must-match-its-twin.unit.test.ts` derives every such
pair from the render table and holds it to a single answer — proved by breaking it three ways.
The untidy failure it prevents is a blank left beside a green; **the failure that matters is the
other order**, somebody recording one of the pair `unstable` so that the connector refuses a
Drawing under `export-office` and exports the identical bytes under `export-odf`.

**What made the run possible at all was #979**, which added `drawing` as a fourth `DriveFileKind`.
Until then the instrument could not be aimed at the one native type it had no reading for, so the
blank could never have been filled — a Drawing was exported on every pass with nothing measured
behind it, and was the only unmeasurable hole in the table. That is the second entry to leave
`unmeasured` for `stable`, after `export-pdf` on a Sheet and a Slide; **no entry has ever left it
for `unstable`.** Not an argument that blanks are safe — a record of what refusing on absence
would have cost, against nothing it would have saved.

**Enabling `export-pdf` is a decision, not a consequence of this table.** The case for: it is
the only policy stable on every editor type measured, and a refusal that names PDF as
un-migratable while PDF is in fact stable costs customers their documents for no reason. The
case against: PDF is the most lossy of the three — a `.pdf` is not a document anybody can edit
again, so migrating a Doc as PDF trades an editable original for a fixed rendering. That trade
is the owner's to make.

**UPDATED 2026-09-16 — the evidence this paragraph waited on has arrived.** It read "it wants
the Sheet and the Slide measured first"; both were run that day and both came back STABLE
(Sheet 54591 bytes, Slide 2017 bytes, one hash over five draws each). So the case for is now
three editor types rather than one, and the case against is **purely** the editability trade —
there is no longer a missing measurement standing behind it. For a Slides deck the trade is
also less of one than it looks: `export-office` is refused for a deck on measurement, so PDF is
not the lossy option against an editable one, it is the only measured option at all.

**If the two refused policies are to be usable at all**, the change signal has to stop being the
exported bytes. Two candidates, neither built:

1. **Drive's own `version`** (or `modifiedTime`) as the change signal for native files only.
   `files.get` returns a counter Drive increments on change, so an unchanged document re-exports
   to different bytes and still reports no change. The cost: one class of file stops being
   verified by content, so §20's report would be comparing something else for those rows, and
   that needs saying out loud rather than quietly.
2. **A normalised hash** that ignores the volatile parts. The member-level measurement splits
   this into two quite different jobs, and only the first is small:

   - **For `export-office`, a CONTAINER-normalised hash suffices** — hash each member's name and
     content, ignore the zip's stamps and member order. It needs no format knowledge beyond
     "this is a zip", no parser, and no decision about what may be discarded. Measured as
     sufficient on five draws of one Doc.
   - **For `export-odf` it does not suffice.** `settings.xml` really varies, so that part would
     have to be EXCLUDED by name — a decision that a named part is not the document. That is a
     renderer-specific contract of the kind that breaks whenever Google changes one, and it is
     the thing an ADR has to actually decide.

   **A trap worth naming before anybody implements this.** The diagnostic in
   `drive-export-members.ts` fingerprints members using the CRC-32 the zip index already
   stores, because it is free and this is a diagnostic. **A `contentHash` must not be built that
   way.** CRC-32 is 32 bits and not collision-resistant, and `contentHash` is the thing deciding
   whether a customer's file is rewritten. A real implementation has to inflate each member and
   hash its bytes with sha256. The cheap read is right for answering "what moved"; it is the
   wrong primitive for answering "are these the same file".

Both are decisions, not tasks: either would want an ADR first, and (1) touches what verification
means.

**(2) is now [ADR-0046](../adr/0046-a-rendering-is-compared-by-its-parts.md), ACCEPTED by the
owner 2026-09-16 — and NOT YET BUILT; T7 is the build.** It takes exactly the narrow form the
measurement supports — a canonical container hash for renderings THIS PRODUCT asked Drive to produce, never
for a `.zip` a customer stored — and it carries the two things that are easy to get wrong: the
sha256-not-CRC-32 rule from above, and a versioned hash scheme, without which accepting it would
silently re-label every already-migrated native file and rewrite the lot once. `export-odf` is
explicitly NOT rescued by it. Until T7 lands, `refuse` stands for all three and every file is
compared by its bytes — the decision is made, the code is unchanged, and the ADR's own operative
block says so rather than describing a tree that does not exist yet.

**How the instrument changed mid-measurement, for the record.** `export-odf` was first measured
with the original two-draw comparison, twice, and re-measured with five draws once the member
reading existed. `export-office` and `export-pdf` were measured with five draws from the start,
because four draws of `export-odf`'s window showed that two draws of a
small wobble can collide and read as STABLE — a false green over a policy that would rewrite
every document nightly, arriving through the instrument built to prevent exactly that. The
script now takes `DRIVE_EXPORT_SAMPLES` draws (default 5, minimum 2; a single draw is REFUSED
rather than reported stable) and prints the asymmetry above with its verdict. `export-office`
proves the change earned its keep in the most direct way available: five draws, five hashes,
same length every time — a two-draw test would have had to be lucky to catch a wobble that
never moves the size.

## T4 — the connector

`GoogleDriveSource implements FileSource`, driven in tests by a **fake transport**, following
`graph-drive-source.unit.test.ts`. No network in unit tests. Cover at minimum: folder
enumeration, a delta page, a removal reported by the changes feed, a native file, a binary file,
throttling, and an expired-token refresh.

## T5 — wiring

The checklist the existing sources establish:

1. `SourceConfig` union + validation (`packages/shared/src/config.ts`).
2. Construction in **both** editions — `build-deps.ts` (self-host, env) and
   `build-deps-from-mapping.ts` (managed, decrypted credentials), through the factory modules.
   Note 0041 collapsed the mail builders onto shared factories; the file path should follow that
   shape rather than growing a fourth copy.
3. Credentials: OAuth2 client id/secret/refresh token through `SecretStore`, with the
   least-privilege read-only scope (`drive.readonly`) — the same posture the O365 e2e already
   holds itself to.
4. `enabled-domains` / discovery surfaces, if a Drive mapping needs to appear in them.
5. The guard tests that enumerate providers — check `no-managed-leakage`, `enabled-domains`, and
   the config round-trip tests for lists that need a new entry.

### What T5 actually built, 2026-08-15

The checklist above, item by item, plus the two things it turned out to need that
were not on it:

1. **`SourceConfig`** gained `GoogleDriveSource` (`type: "google-drive"`), with
   `rootFolderId`, `nativeFilePolicy` and `baseUrl`. No `auth` block — credentials
   never travel in a file that ends up in a support ticket.
2. **Both editions** construct it through `drive-source-factory.ts`. The mail
   factory (0041) keeps its validation with each caller because the editions
   genuinely check different things; here they check the identical three values,
   so the refusal is shared too and only the WORDS are a parameter.
3. **Credentials.** `GoogleTokenProvider` is a second implementation of the
   `TokenProvider` port. This was not optional: `createTokenProvider` is MSAL, and
   the `tokenEndpoint` field on `TokenProviderConfig` that looks like it would
   redirect it **is never read** — reusing it would have posted a Google refresh
   token to Microsoft's token endpoint and presented as a login failure.
4. **A migration (`0008`), which was not on the checklist.** `connection.kind` is
   a database CHECK constraint, so a managed Drive connection could not be
   inserted at all. An appliance that can be pointed at a Drive while the managed
   edition cannot represent one is a difference between editions, which hard rule
   5 forbids. `connection-kind-check.unit.test.ts` now reads the constraint out of
   a real migrated database and compares it to the TypeScript enum, so the two
   lists cannot drift again.
5. **A pool leak, also not on the checklist,** found by adding a refusal to
   `buildDomainDeps`: every refusal there happens *after* the ledger is open and
   none of them closed it. An appliance retrying a misconfigured mapping on its
   schedule leaked one connection per attempt until Postgres refused, at which
   point the failure reads as "the database is down". Fixed and pinned.

**The managed edition can now HOLD a Drive connection. Nothing in it creates one.** Found while
checking T5's own claim, and worth stating so "wired in both editions" is not read as "usable in
both editions":

- The create-mapping wizard's `sourceType` is `imap | oauth2 | graph` — all MAIL sources — and
  `sourceKindFor` maps them to `imap` / `o365`. There is no path through the API or the UI that
  writes a `google_drive` connection; today it takes a hand-inserted row.
- More structural: `loadDomainConnections` reads **one** `role = 'source'` row per tenant and
  hands it to every enabled domain (the same single-connection assumption `fileEndpointFromCreds`
  documents). So a managed tenant cannot have an O365 mail source *and* a Drive file source at
  once, whatever the wizard offers.

Neither is a Drive problem and neither is fixed by pretending otherwise. The appliance path is
complete — a mapping file names `google-drive`, the env holds the credentials, it runs. **The
managed path is complete up to the point where a person has to create the connection**, and
finishing it is a wizard/schema change (per-domain source connections) that belongs to whoever
owns the managed onboarding flow, not to this workplan.

> **Both closed, 2026-08-16.** The wizard's `sourceType` gained `google-drive`
> (client ID + optional root folder on the source step; client secret +
> refresh token, masked, on the credentials step; the file domain pinned by
> the shared `SOURCE_TYPE_DOMAINS` matrix, refused server-side by
> `sourceDomainRefusal` in the same words); `sourceKindFor` maps it to the
> `google_drive` kind migration 0008 added, config validated by
> `parseGoogleDriveSource` — one authority, both editions — and the encrypted
> secret carries exactly the keys `STORED_GOOGLE_CREDENTIAL_NAMES` reads. And
> `loadDomainConnections` now resolves connections THROUGH THE MAPPING
> (mapping → mailbox → connection, tenant-role row only as a legacy fallback),
> so an O365 mail source and a Drive file source can coexist in one tenant.
> **A third defect surfaced while wiring it**: `buildDomainDepsFromMapping`
> resolved the source's DAV endpoint EAGERLY, above the domain branches, and a
> `google_drive` connection has OAuth credentials rather than a
> username/password — so the resolver threw before the file branch (the one
> that knows how to build a Drive source) could ever run. The managed Drive
> path T5 wired was unreachable at the deps layer. Endpoints are now resolved
> inside the branches that are DAV-shaped, and nothing DAV-shaped is asked
> about a Drive.

**What T5 does NOT prove, and nobody should read it as proving:** that any of this
works against Google. Every test here drives a fake — a fake transport, a fake
token endpoint, a stubbed `fetch`. The wiring is proven end to end *inside the
process* (config → credentials → token → Bearer header → Drive URL), which is
exactly the class of defect T5 could introduce. It is not evidence about Drive's
API, and the export byte-stability question (T0 Q3) is untouched.

## T6 — proof against a real Drive

The integration harness runs Postgres, Stalwart and Nextcloud in containers; **Google Drive cannot
be containerised**, so this tier cannot prove the connector the way `dav-sync.integration.test.ts`
proves WebDAV. Options, to be chosen when T4 lands: a recorded-fixture contract test (the "recorded
contract" tier `docs/testing.md` already names), or a manual-dispatch e2e against a real
throwaway Workspace tenant, in the shape of `e2e-o365.yml`.

Whichever is chosen, **say plainly in this Status block which one, and what it does not cover.**
An integration tier that silently skips when a credential is absent is the failure mode workplan
0043 and the `harness-exports-what-tests-guard-on` guard exist to prevent.

## What "done" has to show

1. A migration of a real Drive folder containing: a binary file, a native Google Doc, a file that
   moved between folders since the last pass, two files sharing a name, and a deleted file —
   with the pass's counts matching what a human can see in the target.
2. The idempotency property every other source is held to: **second pass creates 0.**
3. The per-folder cost property from T1, asserted rather than assumed.
4. The three T0 decisions written down here with their reasoning, including anything refused.

## The first slice, approved 2026-08-15

The owner has a real customer waiting and will test against a real Drive later, so the first slice
is scoped to avoid every decision that can destroy or duplicate data:

- **Binary files only.** Native Google editor files are reported un-migratable with a named reason.
- **`removed` populated with nothing.** The absence-based detector does its slower, corroborated
  job instead; nothing enters the owner's queue as *known* deletion evidence on Drive's say-so.
- **Export format wired as a per-migration setting, defaulting to refuse.** The owner chose
  per-migration choice (T0 Q3); the default stays `refuse` until byte-stability is measured.
- **Path-keyed, no ADR change**, with the two limits above stated in the product's own words.

That yields a usable Drive source without touching the two decisions that can lose customer data.

## Note on sequencing

**T0 before everything.** Each of its three questions has a wrong answer that is invisible until
a customer's data is already on the target: a delta that costs a full drive scan per folder, a key
that duplicates every moved file, an export that rewrites every document every night.

Independent of workplan 0043; they share no code.

## What this workplan does NOT include, and why

**Google Groups.** Group discovery in this repo answers one question —
*which shared mail addresses exist, and does each have a store?* — and it is a **mail** concern
throughout: `listMailEnabledGroups` (`graph-groups.ts:88`), the honest IMAP refusal
(`imap-groups.ts`), and `patternForSource` (`mapping-pattern.ts:39`), which returns a §14.1 pattern
only when the source type starts with `graph-` **and** names a `mailbox`, and `undefined` for
everything else. `assertMappingPattern` states the boundary outright: *"The only pattern a mailbox
mapping can carry is `shared_s`."*

Nothing in the file domain consumes it. A Drive migration therefore needs no Google Groups
connector, and adding one would not move this workplan forward by a line.

The Drive-shaped analogue of the same question is **Shared Drives** (a store owned by no single
user, which is structurally what Pattern S describes) versus My Drive. That is answered by
Drive's own API (`drives.list`), not by Groups, and it belongs to T0's scoping decision.

Google Groups becomes worth revisiting only if **Gmail** is added as a mail source — at which
point the question returns in its original form, and a Google Group with a Collaborative Inbox is
the natural Pattern S analogue while a plain mailing list is Pattern D. The judgement itself is
already provider-neutral: `graph-groups.ts` keeps only the Microsoft-specific *"has a store"*
signal, and hands the pattern decision to `@openmig/core`. That seam is the reason a second
provider would be cheap — but it is Gmail's cost to pay, not Drive's.
