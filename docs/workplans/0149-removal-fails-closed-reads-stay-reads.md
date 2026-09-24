# Workplan 0149 — Removal fails closed, and reads stay reads

> **In one line:** Apply deletions fails closed: CalDAV, CardDAV or WebDAV 412 on create recorded as adopted, failed lookups throw, removal needs a recorded version and `If-Match`, cutover gate fails with no hash compared, IMAP source uses EXAMINE.

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24, later: the owner answered open questions 1 and 2.** *"1) 0159, gate answer: a"*
confirms D2's reading, 0009's option 1. There is no plan 0159, so "0159" is read as 0149.
*"2) 0149, older wors without a version: rewritten"* ("wors" is read as "rows") is D3: a row
without a recorded version is rewritten from the source when its source item changes, as today,
and then carries the version the target returns. Removal still refuses such a row (D1). §2 states
the reading and what it accepts. T3 is now decided in both halves. For a rewrite, the server
checks a row that has a version, and a row without one is rewritten as today. T7 follows D3, and
0009's note records that the reading is confirmed. Open question 3, on weak versions, is still
open.

**2026-09-24: opened from the owner's answer.** The readiness review of 2026-09-23 found that
*apply deletions*, the one path in the product that removes anything, relies on two facts it
cannot always establish: that the copy on the target is one Ownpace wrote, and that nobody has
changed it since. 0131 §5 named this W18, *"Removal fails closed"*, and listed it with the IMAP
source's SELECT and 0009's open gate question. The owner first asked for an explanation
(*"W18 explain"*). After reading it, the owner answered: *"write as a plan. But we do offer 'apply
deletions'. And do hold the cutover-gate when nothing was compared."* §2 records this answer as
D1 and D2. The same message answered three questions about the machine and the questions on W15.
0132, 0140 and 0148 carry those.

Nothing is built. Every fact in §1 was checked on 2026-09-24 at this plan's branch, which is
`main` plus the alpha's plans and changes none of the files cited here, and the line numbers are
today's. Three things came up while writing this plan that the review did not report:

- **The code records an earlier owner decision on 0009's gate question.** The decision is dated
  2026-09-21, and it is written in `verification-report.ts` and in the test that pins the
  behaviour. It is not in 0009, whose section still says *"Not taken"*, and it is not in 0147,
  which calls the question open. That decision kept the gate open. D2 closes the gate in the
  fault case (§1, T4).
- **The JMAP contacts and files targets fail open in the same way as DAV.** If the read of the
  stored version fails, the removal and the rewrite go ahead (§1, T3).
- **A 412 can come from Ownpace's own write.** If a PUT lands but its answer is a 5xx, the PUT
  is retried, and the retry is then refused with 412. T1 therefore records some of Ownpace's own
  copies as adopted. That errs on the safe side, and T1 states what it costs.

**The alpha minimum (before the first invitation):** T1, T2, T3, T4 and T5. They go into the
alpha tag that `ownpace-live` first runs (0146 T0), so that no row on live is ever written by the
old code (T7). **After:** T6, which is 0144 T4's words once T3 has landed, and T7's count for the
OTA stack and the appliances.

| Task | Status | Notes |
|---|---|---|
| T1 A 412 on create is an adoption, in all three DAV writers | 📋 **Decided** (D1) | §3. CalDAV, CardDAV, and WebDAV with its streamed twin. The row is `adopted`, and it is never rewritten or removed as Ownpace's. The JMAP mail writer is the model. A guard fails without it. **Alpha minimum.** |
| T2 A lookup that fails is not an absence | 📋 **Decided** (D1) | §3. The per-item CalDAV REPORT, CardDAV REPORT and WebDAV PROPFIND answer 207 or 404, or they throw (hard rule 9). They go through the retry helper, as the writes do. **Alpha minimum.** |
| T3 Removal and rewrite carry the version, and removal refuses without one | 📋 **Decided** (D1 for removal, D3 for a rewrite) | §3. `If-Match` on the DAV DELETE and on the rewrite PUT. With no recorded version, or a version that cannot be read back, nothing is removed, and removal answers with a new refusal code. A rewrite whose version no longer matches is left alone and counted, as a conflict is today. A row without a version is rewritten, as today, and records the version the target returns (D3). JMAP contacts and files and IMAP mail follow the same rule. JMAP mail is unchanged. ADR-0024's operative rule and the architecture document change in the same PR. **Alpha minimum.** |
| T4 The cutover gate holds when nothing was compared | 📋 **Decided** (D2) | §3. 0009's section headed T9, option 1: a domain whose target can hash, and from which no sample came back with a hash, is FAIL. The pinned test changes with it, because the owner decided, and not so that CI passes. **Alpha minimum.** |
| T5 The IMAP source opens folders read-only, and no source can write | 📋 **Proposed** | §3. `{ readOnly: true }` (EXAMINE) at the four places `imapflow-source.ts` opens a mailbox. A guard over every source connector's calls. **Alpha minimum.** |
| T6 The words become true | 📋 **Proposed** | §3. `APPLY_FLAG_WARNING` and 0144 T4 and T5 once T1 to T3 have landed. This is coordination with 0144, which owns the wording. **After** T3. |
| T7 Ledgers written before the fix | 📋 **Proposed** | §3. A row recorded `copied` after a 412 cannot be told apart from other rows without a version. The rule is T3's, with D3: no recorded version, no removal, and a source change rewrites the row. `ownpace-live` has none of these rows if the alpha tag carries T1. **After**, for the OTA stack and the appliances. |

## 1. What there is today

The review findings this plan carries are `nondestr-dav-412-recorded-as-copied`,
`nondestr-apply-warning-edit-guard-conditional`, `nondestr-imap-source-select-not-examine` and
`wp-0009-pass-without-hash`. It relies on two verified findings: `nondestr-apply-gates-verified`
and `nondestr-source-calls-verified`. It shares `nondestr-populated-target-undisclosed` with 0144
T5, which carries the wording. That finding's headline was refuted, as 0144 §1 records.

### A refusal that is recorded as a copy

All three DAV writers create with `If-None-Match: *`: `caldav-target-writer.ts`:951,
`carddav-target-writer.ts`:739, and `webdav-target-writer.ts`:886 with the streamed twin at :959.
When the server answers the create with 412, each writer returns a bare path:

- **CalDAV**, `uploadEvent`: *"Something was already there, so its version is not ours to
  claim."* The next line is `return { path: eventPath };` (:970-971). The comment above it (:956-957)
  reads the 412 as *"the caller's snapshot was merely stale, and the resource is exactly what we
  would have written"*.
- **CardDAV**, `uploadContact`: the same two lines, `return { path: contactPath };` (:755-756).
- **WebDAV**, `uploadFile`: `return { path: filePath };` (:901-902). The streamed twin
  `uploadStreamed` does the same (:964-971).

The callers treat a bare path as a successful write:

- After the write, CalDAV and CardDAV adopt only on `written.alreadyHeld` (caldav :370, carddav
  :279). That flag is set only when the server named an href in a refusal of the UID (caldav
  :986-990, carddav :768-769). WebDAV has no such branch.
- Each writer then records the item with `recordIfAbsent` and no `status` (caldav :383, carddav
  :287, webdav :407). `PgLedger.recordIfAbsent` fills in `status: record.status ?? 'copied'`
  (`packages/ledger/src/ledger.ts`:379).
- Each returns `created: true` (caldav :417, carddav :326, webdav :440). The sync loop records
  `status: result.created ? 'copied' : result.adopted ? 'adopted' : 'updated'`
  (`packages/core/src/domain-sync.ts`:1682). It counts the item as created, and as the arriving
  half of a possible move (`createdThisPass`, :1726).
- The row carries no `targetVersion`. That half is pinned: `dav-write-round-trips.unit.test.ts`
  :235-285 says the writer *"does not know whose bytes they are"*, and it asserts the version but
  never the status. Its CardDAV twin (:393-430) does the same.

So an item the customer already had is recorded as one Ownpace wrote. From then on:

- **A source change overwrites it.** `classifyKnownItem` leaves only `adopted` items alone
  (`domain-sync.ts`:353). With no recorded version the writer skips its ownership check (caldav
  :916, carddav :721, webdav :805).
- ***Apply deletions* accepts it.** Gate 4 lets `copied` through (`apply-deletion.ts`:665), and so
  does the ledger's SQL re-check (`ledger.ts`:1844).

**How a 412 is reached.** Three ways:

- **The snapshot is out of date.** Each writer takes its existence snapshot once per collection
  (`keysIn`, caldav :429 and carddav :332; `keysUnderRoot`, webdav :450). Anything that appears
  on the target during the pass is not in it. The product invites exactly this: *"Both accounts
  work. Use the new one for real mail while the old one keeps receiving."*
  (`site/pages/en/how-it-works.md`:35).
- **A failed lookup reads as "not there"** (next section).
- **A retried PUT.** `requestWithDavRetry` retries on 5xx, 423 and 429 (`dav-retry.ts`). If the
  first attempt landed but was answered with one of those, the retry is refused with 412. The
  header of `dav-retry.ts` (:23-26) calls that 412 *"a SUCCESS to the caller"*.

**The model is already in the repository.** The JMAP mail writer adopts on the server's
equivalent answer, `alreadyExists`. It uses an id the server named or one it asked for, and
*"Never invent one"* (`jmap-target.ts`:1037-1056, `return { targetId: existingId, created: false,
adopted: true };`).

### A lookup that fails reads as "not there"

When the snapshot cannot be taken, each writer asks about each item on its own:

- **CalDAV** `findCalendarByNaturalKey` (:467-536) returns `undefined` for every status except
  207 (:523-535).
- **CardDAV** `findContactByNaturalKey` (:392-426) does the same (:417-425).
- **WebDAV** `findFileByNaturalKey` (:485-521) treats 207 or 200 as found and anything else as
  absent. It also catches every thrown error as *"File doesn't exist"* (:514-518). The only
  exception is a directory conflict.
- **None of the three is retried.** Each calls `this.httpClient.request` directly (caldav :508,
  carddav :406, webdav :493), so a busy Nextcloud's 5xx counts as "not there".

Two lookups already refuse to read a failure as an absence. The JMAP writer's (`jmap-target.ts`
:706-721) and the IMAP target's (`imapflow-dav-target.ts`:273-316) both throw *"refusing to treat
this as 'not present' because that would append a duplicate"*. That is hard rule 9 (`AGENTS.md`):
*"No null-fallbacks or catch-and-continue that turn failures into empty results"*.

### Removal and rewrite check a version only when one was recorded

- **Core passes the version only when there is one.** `applyDeletion` and `applyRelocation` pass
  `expectedTargetVersion` only if `row.targetVersion !== undefined` (`apply-deletion.ts`:357,
  :581). `apply-deletion.unit.test.ts`:427 pins that: *"omits expectedTargetVersion when the row
  never recorded one"*. The test just above it (:408-425) also removes a row that has no version.
  The unattended relocation path takes the same route (`autoApplyRelocations` →
  `applyRelocation`, :1200).
- **DAV removal checks with a HEAD, and only when there is a version.** `removeDavResource` sends
  the HEAD only when a version was given (`dav-remove.ts`:120). A failed HEAD means "proceed"
  (:122-126). The DELETE that follows is a separate request, whose only headers are
  `Authorization` and `Schedule-Reply: F`. There is no `If-Match` (:133-142).
  `dav-remove.unit.test.ts` pins both halves: *"does NOT check ownership when no
  expectedTargetVersion was given"* (:112) and *"proceeds when the HEAD fails"* (:167).
- **The rule is written down as deliberate.** `ownershipOf` returns `'ours'` whenever either side
  is unknown (`dav-target-version.ts`:74). Its comment explains: *"Both unknowns mean PROCEED"*
  (:57). Refusing would be *"a protection that presents as an outage"*. `ports.ts`:561-565 says
  the same about the rewrite. `target-edit-protection.unit.test.ts` pins it three times: *"proceeds
  whenever either side is unknown"* (:70), *"does not check, or block, when we never recorded a
  version"* (:152), and *"does not block when the target reports no version now"* (:169).
- **The architecture document states the limit.** Rows without a version, and servers that return
  no ETag on PUT, *"keep the old overwrite behaviour"* (`docs/architecture/solution-architecture.md`
  :242). Its paragraph on `apply` says the ETag is *"re-checked at the moment of removal"* (:248),
  and ADR-0024's operative rule says *"no-edit-since (ETag; UIDVALIDITY on IMAP)"*
  (`docs/adr/OPERATIVE.md`:254).
- **The JMAP contacts and files targets fail open as well.** This was not in the review. Both
  compare a fingerprint read back from the server. That read returns `undefined` when it fails
  (`jmap-contact-target.ts`:719-726, `jmap-file-target.ts`:934-941). The check is
  `current !== undefined && current !== expected`, so a failed read lets the destroy go ahead
  (contacts :751-757, files :996-1002) and lets the rewrite go ahead (contacts :490-492, files
  :688-690).
- **The IMAP target** compares UIDVALIDITY only when a version was given (`imapflow-dav-target.ts`
  :596-610). It records one on every write (:348, :352).
- **JMAP mail** accepts the version and ignores it. It records none, because JMAP gives no
  per-message ETag, and the comment adds that a message is immutable apart from its flags and
  mailbox membership (`jmap-target.ts`:1155-1159).
- **WebDAV's chunked upload records no version** (webdav :851-859). No production caller turns it
  on: `chunkedUploads` occurs only in the writer itself (:71, :849, :936) and in one unit test
  (`a-type-the-big-files-lost.unit.test.ts`:56).

On 2026-09-24 the owner's answer made removal something testers may use (D1). A row without a
version then does not stop a removal. It skips the check. A 412 row (above) is exactly such a row.

### What *apply deletions* does with an adopted item

It never removes one. Gate 4, `ownershipCheck`, returns `not_ours` for `adopted`, with *"those
bytes are the account owner's, not ours to delete (hard rule 2)"* (`apply-deletion.ts`:662-697).
The ledger's conditional UPDATE accepts only `copied` or `updated` for a deletion (`ledger.ts`
:1844) and for a relocation (:1913). `apply-deletion.unit.test.ts`:194, *"refuses adopted
bytes"*, pins it.

A rewrite never touches an adopted item either (`domain-sync.ts`:353, rule 4 at :243-246). The
customer sees these items as *"left as they are"* on the progress strip (`itemsAdopted`,
`LiveProgress.tsx`:131-132). The confirmed list shows them as `yours` (`confirmed-list.ts`
:312-313).

So the fix is to put the right status on the row. Once a 412 row is `adopted`, every existing
gate already protects it.

### The cutover gate when nothing was compared

**The mechanism.** In `packages/core/src/verification.ts`, when no sample of a domain could be
compared, the ratio falls back to 1: `const checksumMatchPercentage = checksumComparable > 0 ?
checksumMatches / checksumComparable : 1;` (:432). `calculateVerificationScore` has the same
fallback (:762-765). `determineVerificationStatus` reads ratios and counts and never reads the
issue list (:616-656). So the `CHECKSUM_UNAVAILABLE_*` warning (:471-481) cannot change the
verdict, and PASS opens the gate (`canProceedToCutover`, :322).

**Two different cases end up here, and today nothing tells them apart:**

- **The target has no way to hash.** `JmapContactTarget` leaves out `contentHashFor` on purpose
  (`jmap-contact-target.ts`:782-789).
- **The target can hash, and every call came back empty.** `getTargetSamplesFromReindexer` calls
  `contentHashFor` only when the reindexer offers it, and it leaves the sample empty when the call
  returns nothing (`verification-implementations.ts`:237-243). The JMAP mail writer returns
  `undefined` for every entry while its session is not resolved (`jmap-target.ts`:876), and again
  when the blob download fails. 0009's section quotes the comment (:895 today) that records the
  second happening, *"run after run"*.

**What the repository says about the decision.** It says three different things:

- **0009** sets out three options in its section headed T9 (:74-150). Its last paragraph says
  *"Not taken"*.
- **0147** §1 and its T3 describe the question as open.
- **The code** records an answer. The comment on `VerificationResult.contentEvidence`
  (`packages/shared/src/verification-report.ts`:150-177) says *"The owner asked (2026-09-21) for a
  `PASS_ON_COUNTS` status"*. By its content that is 0009's option 2. It was built as a field
  beside the verdict, and the comment goes on: *"It deliberately does NOT close the gate: the
  owner's decision is that a count-only PASS still opens it, because both targets in use can fail
  to hash for ordinary operational reasons and refusing would block nearly everyone."* The pinned
  test says the same: *"ANSWERED 2026-09-21 … The owner's decision was (b): the gate still
  opens"* (`verification-bytes-and-checksums.unit.test.ts`:248-253). The screen shows *"counts
  only"* beside a ready verdict (`Verify.tsx`:48-56, `verify.evidence.none` at `strings.ts`:1493),
  and the sentence `verify.countsOnly` (:1489): *"No content was compared."*

**What the pinned test builds.** Its fixture is a reindexer with no `contentHashFor` at all
(:194-254, `reindexer(sized([100, 200]))`). That is the case where the target cannot hash. The
title and the long comment speak for every *"NOTHING could be hashed"* case. The comment says:
*"Whether that second case should hold the gate shut is … the owner's and not this test's"*.

**The nightly depends on the gate.** The appliance nightly asserts
`expect(report.canProceedToCutover).toBe(true)` (`test/e2e/selfhost-verification.e2e.test.ts`
:181).

### The IMAP source opens folders read-write

`packages/connectors/src/imapflow-source.ts` opens a mailbox in four places, and none of them
passes `readOnly`:

- `client.mailboxOpen('INBOX')` (:235), the fallback when LIST offers no selectable mailbox;
- `client.getMailboxLock(folder.path)` when measuring (:291) and when listing (:334);
- `client.getMailboxLock(item.folder.path)` when fetching (:442).

imapflow 2.0.5 (the one installed) sends SELECT unless it is told `readOnly`:

- `commands/select.js`:111 reads `command: !options.readOnly ? 'SELECT' : 'EXAMINE'`.
- The typings declare `MailboxOpenOptions.readOnly`: *"If true then opens mailbox in read-only
  mode"* (`dist/esm/types.d.ts`:675-676). `MailboxLockOptions` extends it, and both
  `mailboxOpen` and `getMailboxLock` take it (`imap-flow.d.ts`:302, :583).
- A lock is reused only when the read-only flags match (`imap-flow.js`:3644).

What keeps the source unchanged today is the code's own discipline. The body fetch uses PEEK
(`fetchOne(…, { source: true }, …)`, :448), which the review confirmed sets no `\Seen`. No STORE,
EXPUNGE, MOVE or CLOSE is sent. The unit test's fake records neither option
(`imapflow-source.unit.test.ts`:98-104).

The review's verifier rated this low and gave two reasons. EXAMINE is chosen by the client, so it
protects against a future mistake in this code, not against the code as it stands. And the only
effect today, using up the session-level `\Recent` flag, is invisible to a user.

### What the review verified, and this plan relies on

- **No source connector sends a call that changes the source** (`nondestr-source-calls-verified`).
  A count of the `method:` literals in the fifteen files whose class implements a source port
  finds only GET, PROPFIND and REPORT, plus Dropbox's two POSTs. Those carry its read RPCs
  (`files/list_folder`, `…/continue`, `users/get_space_usage`, `sharing/list_folders`,
  `…/continue`) and `files/download` (`dropbox-file-source.ts`:118-335). Google Drive and the
  archive source send through a transport of their own, and this plan did not repeat the
  review's count of those.
- **The apply gates work as described** (`nondestr-apply-gates-verified`). Apply is off by default
  (`0004_managed_apply.sql`:21). Only positive evidence is acted on. Only `copied` and `updated`
  rows are removed. The breaker applies. Deletions never auto-apply (`apply-deletion.ts`:1088). The
  review's own caveats were the 412 and the missing version. Those are T1 and T3.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words, then the answer as given. Where the answer
needed a reading, the reading is stated, as 0131 reads its answers.

The answer opened with *"write as a plan."*, and so this plan exists. The rest of the answer made
two decisions, D1 and D2. The owner's answers to open questions 1 and 2, later the same day,
confirmed D2's reading and made D3.

**D1 — *apply deletions* is part of the alpha.** *Until removal fails closed, should testers
leave* apply deletions *off?* (0144 open question 3 recommended that.) — *"But we do offer 'apply
deletions'."*

So a tester may arm the switch. It is owner-only (0137 §1), and the owner of a tester's
organisation is the tester. Removal therefore has to fail closed before the first invitation.
T1, T2 and T3 are the alpha minimum, and the guide's advice to leave the switch off
(0144 T1, section 2) is no longer the protection. This answers 0144's open question 3: testers
may use it. T1 to T3 here are what close the gaps the review found. 0144 T4's words alone would
not.

**D2 — the gate holds when nothing was compared.** *0009's section headed T9: when the content
check compared nothing, should the cutover gate still open on matching counts?* — *"And do hold
the cutover-gate when nothing was compared."*

This replaces the decision of 2026-09-21 that the code records (§1), under which a count-only
PASS still opened the gate, for the cases D2 covers; the reading below says which. The second
axis that decision built, `contentEvidence`, stays. What changes is that the gate now also holds.

**The reading.** 0009 proposed option 1, and this plan reads D2 as option 1. In 0009's own words:

> **Ask the reindexer.** A `TargetReindexer` either offers `contentHashFor` or it does not, and
> that is already the difference — it is knowable at the seam without a new capability flag. When
> the method IS present and every call came back empty, that is the fault case: hold the gate
> (FAIL, or WARN that cannot reach 0.95). When it is absent, today's behaviour, unchanged.
> Cheapest, and needs no decision about thresholds.

0009 gave its reason for proposing it: *"because it separates the two cases using a distinction
the code already makes and changes nothing for JMAP contacts."*

Read word for word, the answer would also hold a domain whose target can never hash. Today that
is JMAP contacts, which could then never be cut over. 0009 warned against exactly that: *"not
honesty, a product that cannot cut over"*. Open question 1 asked the owner to confirm the reading.

**Confirmed the same day:** *"1) 0159, gate answer: a"*. There is no plan 0159, and the same
message's next answer names 0149, so "0159" is read as 0149 and "a" as open question 1's (a),
option 1. One neighbouring case still opens the gate under option 1 as written. If every
sample's recorded hash was made by an older fingerprint version, the target did answer with a
hash, but nothing was compared (`dav-canonical.ts`: a cross-version comparison counts as
unavailable). Open question 1 said so, and the answer takes option 1 as written. `ownpace-live`
has no such rows.

**D3 — a row without a version is rewritten.** *Rows on the OTA stack and the appliances that were
written without a version: leave them frozen, never removed and never rewritten from the source?*
(Open question 2 recommended that.) — *"2) 0149, older wors without a version: rewritten"*
("wors" is read as "rows").

**The reading.** A row without a recorded version is rewritten from the source when its source
item changes, as today. The rewrite records the version the target returns (`domain-sync.ts`:1687),
so from then on the row carries one, and T3's check applies to it like any other. Removal stays
as T3 has it: a row without a version is never removed.

- **Every such row.** No row shows whether it predates the fix (T7), so the answer is read as the
  rule for every row without a version. That includes a row from a target that returns no ETag
  on PUT.
- **Not a one-off rewrite.** The answer is not read as rewriting every such row once to give it
  a version. That would overwrite each item whether or not its source had changed. If that was
  meant, it is a task of its own.

**What it accepts.** On a row without a version there is nothing to compare. So when the source
item changes, a copy somebody has edited on the target is overwritten. That is today's
trade-off, pinned by `target-edit-protection.unit.test.ts`:152: refusing would stop source
changes from reaching every such row. It also covers a row recorded `copied` after a 412 before
T1 (T7). There, the item that was already at that address on the target, the customer's, is
overwritten when the source item changes. `ownpace-live` has no such rows if the alpha tag
carries T1 (T7), so on live D3 matters only for a target that returns no ETag on PUT.

## 3. What each task does

Before editing a file, grep `docs/LESSONS.md` for it (`AGENTS.md`, session protocol). Today it
lists guards for:

- `apply-deletion.ts`: `a-hash-compared-against-a-different-scheme` and `smoke-managed-verdict`;
- `verification.ts`: `a-hash-compared-against-a-different-scheme` and
  `a-report-domain-the-gate-never-reads`;
- `domain-sync.ts`: `a-hash-that-was-never-sha256` and `a-list-somebody-deletes-on-the-strength-of`;
- `carddav-target-writer.ts`: `an-addressbook-query-without-a-filter`. T2 changes that REPORT's
  error path, not its body;
- `verification-report.ts`: `a-domain-the-fan-outs-forgot`, `a-domain-the-readme-forgot` and
  `a-report-domain-the-gate-never-reads`;
- `ports.ts`: `a-list-somebody-deletes-on-the-strength-of` and
  `an-item-the-listing-dropped-in-silence`;
- `docs/adr/OPERATIVE.md`: `adr-operative`, `a-command-the-docs-told-you-to-run` and
  `a-doc-a-test-reads-that-ci-skipped`, which also covers the architecture document;
- `deploy/compose/smoke-managed.sh`: more than twenty, `smoke-managed-verdict` among them.

### T1 — a 412 on create is an adoption (decided, D1; alpha minimum)

**What changes.** A 412 on the create path means something is already at the href Ownpace was
about to write. The writer no longer returns a bare path. It adopts, as the JMAP mail writer does
on `alreadyExists`:

- **CalDAV and CardDAV** ask the target which object holds the UID. That is the per-item lookup,
  which after T2 throws instead of guessing. If the target names an href, the item is adopted at
  that href through the writer's existing `adopt` (caldav :316, carddav :221), which records
  `status: 'adopted'` and returns `{ created: false, adopted: true }`. If it names none, the href
  is taken by an object with a different UID. The item then fails as `target_refused`, with a
  sentence that says so. It is never recorded as copied and never adopted onto an href the server
  did not name. This is the rule the UID refusal already follows (caldav :986-990: *"Only ever on
  an href the SERVER named"*).
- **WebDAV** adopts at the path, because the path is the natural key. The inline adoption branch
  (:354-395) becomes an `adopt` function, and both the buffered 412 and the streamed 412 use it.
  On the streamed path the adoption hashes the body through `hashOfContent`. That reads the
  source a second time for that one file. Today's streamed 412 already does, because the row it
  records calls `hashOfContent` too (:412), so T1 adds no read.

The collision policy then applies to these items as well: with `onCollision: 'fail'`, a 412 stops
the pass as any adoption does (`domain-sync.ts`:1733-1742). A 412 item no longer counts as
created, so it cannot be the arriving half of a move.

**The cost, stated.** When a PUT lands, is answered with a 5xx, and the retry is refused with
412, the item is Ownpace's own. T1 records it as `adopted` anyway, because nothing in the 412
tells the two cases apart. That item is then never rewritten from the source and never removed by
*apply deletions*. Both of those err on the safe side. It shows among *"left as they are"*.
`dav-retry.ts`'s header (:23-26) changes in the same PR: a 412 is not *"a SUCCESS to the caller"*,
it is an adoption.

**Guard.** `packages/engines/src/a-refusal-recorded-as-a-copy.unit.test.ts` fails today. For
CalDAV, CardDAV, WebDAV buffered and WebDAV streamed, with an empty snapshot and a server that
answers the create PUT with 412:

- the result is `created: false, adopted: true`;
- the one ledger row has `status: 'adopted'` and no `targetVersion`;
- for CalDAV and CardDAV, when the UID lookup finds nothing, the item throws `target_refused` and
  no row is written.

`dav-write-round-trips.unit.test.ts`'s two 412 cases, CalDAV's (:235-285) and CardDAV's
(:393-430), change with it. Their fixtures answer every lookup with an empty 207, so under T1 the
item would fail as `target_refused` and no row would be written. Each fixture gains a lookup that
names the href, and each test gains the assertion it lacks, `recorded[0].status === 'adopted'`.
A case beside `domain-sync`'s own tests adds that such a result lands in `adopted`, not in
`created`, and not in `createdThisPass`.

### T2 — a lookup that fails is not an absence (decided, D1; alpha minimum)

`findCalendarByNaturalKey`, `findContactByNaturalKey` and `findFileByNaturalKey` give one of
three answers:

- **207** is read as today;
- **404** means absent. For a REPORT on a collection, a 404 means the collection is gone, which
  also means the item is not there;
- **anything else throws**, in the words the JMAP and IMAP lookups already use: *"refusing to
  treat this as 'not present'"*.

The WebDAV catch-all (:514-518) goes. WebDAV keeps 200 as found alongside 207. All three go
through `requestWithDavRetry`, as the writes do, so a busy Nextcloud answers on a later attempt
and does not fail the item. A thrown lookup fails the item for this pass. It is retried on the
next pass, which is the behaviour the JMAP lookup describes as *"safe and resumable"*.

The snapshot's own fallback does not change. When the listing fails, `keysIn` and
`keysUnderRoot` log it and hand over to the per-item lookup, which now decides honestly.

**Guard.** `packages/engines/src/an-absence-that-was-a-failure.unit.test.ts` fails today. For each
of the three lookups:

- a 500 that persists through the retries, a 401 and a 403 each throw;
- a 404 gives `undefined`, and so, for CalDAV and CardDAV, does a 207 with no matching UID;
- for WebDAV, a thrown transport error propagates. Today it is swallowed.

### T3 — removal and rewrite carry the version, and removal refuses without one (decided, D1 and D3; alpha minimum)

**On DAV, the server does the check.** The server evaluates the condition in the same request, so
there is no longer a gap between reading and acting.

- The DELETE in `removeDavResource` carries `If-Match: "<recorded version>"`.
- The rewrite PUT in all three writers does the same. Today it sends no precondition (caldav
  :951, carddav :739, webdav :886, :959).
- The HEAD before either request goes (`dav-remove.ts`:120-129, and the writers' `currentEtag`
  calls on the rewrite path). The server's answer to the condition replaces it. The one exception
  is a rewrite of a row whose version is weak (below).

**What a 412 now means.** A 412 on the conditional DELETE or PUT means the object is no longer
the one Ownpace wrote. RFC 9110 also evaluates `If-Match` as false when there is no current
representation, so on a DELETE one HEAD follows the 412:

- a 404 or 410 keeps today's answer, already removed (`dav-remove.ts`:148);
- anything else is `conflicted`;
- a HEAD that fails throws. Nothing was removed.

On the rewrite path a 412 is `conflicted`, where today it throws *"refused with 412 on a
deliberate rewrite"* (caldav :962-969). The sync loop already handles `conflicted`: not written,
the row marked `adopted`, and counted (`domain-sync.ts`:1655-1672). The item then shows among
*"left as they are"*.

**Weak versions.** `readEtag` strips the `W/` prefix before recording
(`dav-target-version.ts`:38, pinned by `target-edit-protection.unit.test.ts`:49). RFC 9110
compares `If-Match` with the strong comparison, so a weak validator never matches. The writer
therefore records whether the ETag was weak.

- **Removal.** A weak version counts as no version, which falls under the next rule.
- **Rewrite.** A weak version keeps today's check: a HEAD, and a comparison of the two values.
  `If-Match` cannot carry it, and dropping the check would leave these rows with less protection
  than they have today. D3 does not ask for that. The gap between the HEAD and the PUT stays open
  for these rows only.

**With no recorded version, nothing is removed. A rewrite goes ahead (D3).**

- **Removal.** The writer sends no DELETE and answers a new result, working name `unversioned`.
  Core turns that into a new refusal code, working name `version_unknown`, with the reason:
  *"This copy was written without a version from the new system, so there is no way to tell
  whether somebody has changed it there since. It was left alone. Delete it in the target system
  yourself if you are sure, then choose `keep`."* The refusal fits the existing handling
  unchanged:
  - on the appliance it falls into the 403 branch (`apps/selfhost/src/index.ts`:2849-2856);
  - on managed it lands on the receipt as `refused` with its code (`ApplyReceipt`,
    `operating-contract.ts`);
  - `evaluateApplyDeletion` stays a prediction, as it already is for gate 5.
- **Rewrite.** The writer sends the PUT without a condition, as today, and the sync loop records
  the version the target returns (`domain-sync.ts`:1687). That is D3, and
  `target-edit-protection.unit.test.ts`:152 already pins it: no HEAD, one PUT.

**The same rule on the other targets that record a version:**

- **JMAP contacts and files.** A failed read of the stored fingerprint refuses. Today it
  proceeds (contacts :719-726 and :751-757, files :934-941 and :996-1002). The same holds for
  their rewrites (contacts :490-492, files :688-690). JMAP has no condition for a single object
  on `/set`. `ifInState` compares the state of the whole type in the account (RFC 8620 §5.3), and
  any other change would trip it. So for these two targets the read and the destroy stay two
  calls, and what changes is that a read that fails is a refusal.
- **IMAP mail.** A row without a recorded UIDVALIDITY is refused. On its own the UID cannot be
  trusted to name the same message (`imapflow-dav-target.ts`:596-610).
- **JMAP mail** is unchanged. It records no version by design, because JMAP gives no
  per-message ETag (`jmap-target.ts`:1155-1159).

**Where the rule lives.** In the writers, because only a writer knows what kind of version its
target has. Core maps the writer's answer to a refusal code, as it does for `conflicted` today.

**The rewrite half follows D3.** D1 is about removal. This plan first proposed that a row
without a version is not rewritten either, which would have reversed a trade-off the code states
on purpose (§1): with no version, a rewrite goes ahead, so as not to block source changes. The
owner kept that trade-off (D3). So for a rewrite T3 changes how the check is made. Which rows are
rewritten stays as today, apart from a JMAP fingerprint read that fails, which now refuses. It is
in the alpha minimum for two reasons:

- it is the same code and the same PR;
- it closes the gap between the HEAD and the PUT for every row with a strong version.

On `ownpace-live` few rows lack a version. Live's database is new, so no row predates the
version, and T1 stops making rows without one. What remains is a target that returns no ETag on
PUT, or only a weak one (open question 3).

**What changes with it, in the same PR:**

- **Pinned tests.** Each change is a decided behaviour change, not a skipped test:
  - `dav-remove.unit.test.ts`:112 and :167.
  - `target-edit-protection.unit.test.ts`:70 and :169. Its case at :152, a rewrite of a row
    without a version going ahead, stays as it is: that is D3.
  - `dav-write-round-trips.unit.test.ts`:216-233, where a 412 on a rewrite becomes `conflicted`
    instead of a throw.
  - `apply-deletion.unit.test.ts`:427 does not change. Core still passes a version only when the
    row has one (`apply-deletion.ts`:357, :581), because the refusal is the writer's and JMAP mail
    records no version by design. The removal just above it (:408-425) goes through a fake remover
    and stays as it is.
- **Comments that state the old rule:** `ownershipOf` and its comment, `ports.ts`:561-565,
  `dav-remove.ts`:121-126, and `apply-deletion.ts`:42-45. With `If-Match`, the claim at
  :42-45 that there is *"no gap between reading and acting"* becomes true for DAV. 0144 T4 planned
  to correct that comment, and this rewrite replaces the correction.
- **ADR-0024's `## Operative rules`**, amended in place: no-edit-since is `If-Match` on DAV and a
  read that must succeed on JMAP, and with no recorded version there is no removal. Then run
  `node scripts/adr-operative.mjs --write` (ADR-0038).
- **The architecture document** §11 (:242, :248) says the same.
- **The gates.** The PR reads `deploy/compose/smoke-managed.sh`'s `ELIGIBLE` (:1443), which picks
  a `copied` or `updated` row with a target handle and does not ask for a version. If that row
  has no version, the smoke's apply half now gets the new refusal, and `ELIGIBLE` gains
  `target_version IS NOT NULL`. The three apply legs of the appliance nightly (`e2e.yml`:538-540)
  run on a real Nextcloud and Stalwart. Their first scheduled run after the merge shows whether
  those targets record versions. This plan does not assume they do.

**Guards.** Each fails today.

- `packages/engines/src/a-removal-the-server-checks.unit.test.ts`:
  - the DELETE and the rewrite PUT carry `If-Match` with the recorded version, quoted;
  - with no version, or a weak one, no DELETE is sent;
  - with no version, the rewrite PUT is sent without `If-Match`, and with a weak one after a HEAD
    whose value matches (D3);
  - a 412 followed by a HEAD answering 200 is `conflicted`, and one answering 404 is already
    removed.
- Cases in the JMAP contacts and files tests: a failed read sends no destroy and no rewrite.
- A case in the IMAP target's tests: a row without UIDVALIDITY is not removed.
- A case in `apply-deletion.unit.test.ts`: `version_unknown` comes back with nothing reaching the
  ledger.

### T4 — the cutover gate holds when nothing was compared (decided, D2; alpha minimum)

**The rule, per domain, as option 1.** A domain is **FAIL** when both of these hold:

- its target can hash (the reindexer offers `contentHashFor`);
- samples were drawn, and not one came back from the target with a hash.

This plan uses FAIL, the first of 0009's two forms, because the overall verdict already fails a
domain whose completeness is unknown (`NOT_VERIFIABLE`, `verification.ts`:699-709). The domain
gets an ERROR issue, working id `CHECKSUM_NOT_COMPARED_<domain>`: *"The new system can be asked
for content, and it answered nothing for any of the N sampled items, so no content was compared.
The cutover is held. Check the connection to the new system and verify again."*

`calculateVerificationScore` scores that domain's checksum ratio, 0.3 of its score (:762-766), as
0, not 1.

**Also held:** a domain with recorded items from which no sample was drawn at all
(`CHECKSUM_NOT_SAMPLED_*`, :446-469). Nothing was compared there either. The code says the case
cannot be reached through `createVerificationDeps` today (the function is now
`createRealVerificationDeps`), so holding it costs nothing on that path.

**Unchanged:**

- a target with no way to hash (JMAP contacts);
- a domain where some samples were compared (`partial`);
- `contentEvidence`, which keeps saying what was compared.

**How core learns it.** `VerificationDeps` gets a required field, working name
`targetCanHash(dataType)`. `createRealVerificationDeps` fills it in from whether the domain's
reindexer has `contentHashFor`. The field is required so that no construction site can forget
it. That is the same approach `VerificationResult` takes with its domains
(`verification-report.ts`, the comment above `VerificationResult`).

**The pinned test changes, because the owner decided.** The test is
`verification-bytes-and-checksums.unit.test.ts`:194-254, *"opens the cutover gate on count parity
alone when NOTHING could be hashed — the owner's call"*. Changing it is part of this task. It is a
decided change of behaviour, not a test skipped to get CI green. How it changes:

- Its title and comment say D2. Its fixture, a reindexer with no `contentHashFor`, is the case D2
  (read as option 1) leaves open. Its assertions (`PASS`, `canProceedToCutover: true`,
  `contentEvidence: 'none'`) stay, under a title that names that case: *"a target that cannot hash
  (JMAP contacts) still opens the gate on counts"*.
- Its comment's *"ANSWERED 2026-09-21 … the gate still opens"* is replaced by the decision of
  2026-09-24.
- **A new case beside it fails today:** a reindexer whose `contentHashFor` returns `undefined`
  for every sample gives mail `FAIL`, overall `FAIL`, `canProceedToCutover: false`, the ERROR
  issue, and `contentEvidence: 'none'`.
- The owner confirmed option 1 (D2), so the existing case's assertions stay. Read word for word,
  they would have flipped to `FAIL` as well.

The PR also reads the tests that rely on the fallback to isolate some other condition. One is
`verification-status-thresholds.unit.test.ts`: its `reader` leaves hashes empty so that the
checksum ratio *"stays 1 and condition (2) cannot fire"*. Its target offers no hasher, so option 1
leaves it untouched.

**Words that change in the same PR:**

- the comments at `verification.ts`:426-430, `verification-report.ts`:173-176 and
  `Verify.tsx`:48-56;
- `Verify.unit.test.tsx`:135-157's comment. Its fixture is still a valid state: a target that
  cannot hash.

0009's Status and its section headed T9 record both decisions, 2026-09-21 and 2026-09-24, in this
task's PR. 0147 T3 (a) writes its own note on 0009 and proposes that the section becomes a row,
T13; §4 says what that note now records.

**The nightly.** The appliance nightly asserts `canProceedToCutover` (§1). After T4, a night on
which a target that can hash compares nothing goes red. The owner asked for that signal.

### T5 — the IMAP source opens folders read-only, and no source can write (proposed; alpha minimum)

**Why it is in the minimum.** Every tester's Gmail, Apple or IMAP source uses this connector, with
a password or permission that could write (0144 §1). The change is four arguments and a guard.

**The change.** `{ readOnly: true }` goes on `mailboxOpen` (:235) and the three `getMailboxLock`
calls (:291, :334, :442). IMAP then sends EXAMINE. The server refuses STORE and EXPUNGE, a CLOSE
removes nothing, and `\Recent` stays untouched. EXAMINE returns the same UIDVALIDITY, UIDNEXT
and message count that the cursor and the measurement read (RFC 3501 §6.3.2).

**The proof on real servers:**

- **Stalwart**: `packages/ledger/src/shadow-pass.integration.test.ts`, which reads a real Stalwart
  through `ImapFlowSource` in CI's integration job.
- **Gmail**: one pass against the owner's own account, recorded under 0141 T1. This plan does not
  claim how Gmail answers EXAMINE.

**Guards.**

- `imapflow-source.unit.test.ts`: the fake records the options of every open, and every open is
  `readOnly`. It fails today.
- `scripts/a-source-that-only-reads.unit.test.ts` covers every class in `packages/connectors/src`
  that implements `SourceConnector`, `CalendarSource`, `ContactSource` or `FileSource`, and the
  transports they send through (`google-drive-transport.ts`, `webdav-archive-store.ts`). It
  checks three things:
  - the only HTTP methods are GET, HEAD, PROPFIND, REPORT and OPTIONS, except for Dropbox's POSTs,
    which are allowed by path (§1);
  - `imapflow-source.ts` calls none of imapflow's mutators: `append`, `messageFlagsAdd`,
    `messageFlagsSet`, `messageFlagsRemove`, `setFlagColor`, `messageDelete`, `messageCopy`,
    `messageMove`, `mailboxCreate`, `mailboxRename`, `mailboxDelete`, `mailboxSubscribe`,
    `mailboxUnsubscribe` and `mailboxClose` (the names in `imap-flow.d.ts`);
  - every open in that file passes `readOnly: true`, which fails today.

  A new source class is found by the guard on its own. A source that sends through a transport
  of its own then needs one line in the guard's list, and a new POST needs an allowed path.

### T6 — the words become true (proposed; after T3; with 0144)

This plan does not re-plan 0144's wording tasks. It says what changes for them.

- **`APPLY_FLAG_WARNING`** and its Dutch twin (`operating-contract.ts`:675-701) promise *"only
  items this tool wrote"* and *"never a copy somebody has since edited"*.
  - After T1 the first promise no longer fails on a 412: a 412 is adopted, and an adopted item is
    never removed.
  - After T3 the second holds for files, calendar entries and contacts. On DAV the server checks;
    on JMAP a read that fails refuses; and with no version, nothing is removed. One narrow gap is
    left: on JMAP the read and the destroy stay two calls (T3).
  - For mail there is no edit check to promise, and the warning keeps saying what 0144 T4 already
    drafts: *"Mail has no such version."*
- **0144 T4.** Its drafted condition, *"where it gave none, or cannot be asked, the removal goes
  ahead"*, is false once T3 lands. So T4 is written after T3 and describes the refusal. Its
  guard, `a-warning-the-check-keeps`, keys on the `row.targetVersion !== undefined ?` form in
  `apply-deletion.ts`. T3 leaves that form in place, because the refusal is the writer's, so the
  guard reads the writers' new refusal instead. 0144's own text foresaw the change: *"When W18
  lands, the warning can drop its condition"*. The comment correction 0144 T4 planned for
  `apply-deletion.ts`:42-45 is T3's (above).
- **0144 T1, section 2**, says *"Leave the switch … alone during the alpha, until T4 lands"*. D1
  changes that line. What the guide says about the switch instead is 0144's to write.
- **0144 T5.** After T1, *"keep the destination's copy"* also holds for an item that appears on
  the target during a pass. The duplicate on an IMAP target is 0144's open question 4, not this
  plan's.

### T7 — ledgers written before the fix (proposed; after)

**Can the rows be found?** No. A 412 row has `status: 'copied'` and no `target_version`, and
otherwise its columns look like a real copy's. The 412 branch logs nothing (caldav :962-972,
carddav :748-757, webdav :894-903 and :964-971), so no log can be searched either. The same row
shape also comes from a server that sent no ETag on PUT, and from rows written before the version
was recorded. The code's comments call that migration 0023; today the column is in
`0001_baseline.sql`:297, since the baseline was squashed.

The target cannot settle it either:

- For calendars and contacts the comparison is a fingerprint over a fixed set of properties, so
  a change outside that set is not seen. For calendars it leaves out timing on purpose
  (`dav-canonical.ts`: *"Timing properties … are excluded on purpose"*). A moved meeting would
  match.
- For every domain, a match cannot tell Ownpace's copy from the customer's identical one.

**The rule** is T3's, with D3. A `copied` or `updated` row with no recorded version, on a target
that records versions, is not provably Ownpace's. It is never removed. When its source item
changes it is rewritten, and from then on it carries the version the target returned (D3). No
migration changes its status.

**Where it matters:**

- **`ownpace-live`**: nowhere, if the alpha tag carries T1. Live is its own compose project, and
  Compose prefixes its volumes with the project name (0132 §1, T1b). So its database starts
  empty, and no row on it is ever written by the old code.
- **The OTA stack and the appliances**: T3 protects these rows from removal. A source change still
  rewrites them, which is what D3 accepts (§2). What is also wrong is how they are reported. The
  counts call them created, and the confirmed list shows a 412 row as a placed copy rather than
  `yours` (`confirmed-list.ts`:312-313).

**The count.** One query, added to `docs/operator-runbook.md` beside T3, tells an operator how many
rows *apply deletions* will not remove (T3). It counts `status IN ('copied','updated') AND
target_version IS NULL` per domain, for mappings whose mail target is not JMAP, since JMAP mail
records no version by design. D3 says what happens to them: a source change rewrites them, and
nothing removes them.

## 4. The alpha: the minimum, and what comes after

**Before the first invitation: T1, T2, T3, T4 and T5,** in the alpha tag `ownpace-live` first runs
(0146 T0, 0132 T1g).

- **T1, T2 and T3**, because of D1. A tester may arm *apply deletions*, and without these three a
  customer's own item can be recorded as Ownpace's copy and then removed. T1 and T2 would be
  needed without D1 as well: the rewrite from the source needs no switch (`classifyKnownItem`,
  `domain-sync.ts`:353-354), so a 412 row recorded `copied` is overwritten when the source
  changes (§1).
- **T4**, because of D2.
- **T5**, because it is four arguments and a guard, and every Gmail, Apple or IMAP mail source a
  tester brings rides on it.

**The order, one PR each:**

1. **T2 and T1 together**, in engines. T1's CalDAV and CardDAV adoption asks the per-item lookup
   after a 412, and that lookup must not read a failure as "not there".
2. **T3**, across engines, connectors, core, shared, ADR-0024's operative section and the
   architecture document.
3. **T4**, in core, shared and web, plus 0009's Status. It can go in parallel with 1 and 2.
4. **T5**, in connectors and scripts. It can also go in parallel.

**For 0131 T5's go/no-go table, this plan's row is:**

- T1 to T5 are merged and in the alpha tag that `ownpace-live` first runs, so that no row on live
  is written by the old code;
- the first scheduled run of the appliance nightly after T3 and T4 is green. That covers its three
  apply legs and its verification leg, or a red result is explained in writing and dated;
- the managed smoke's apply half is green on the OTA stack on the same commit.

Today: a 412 on create is recorded `copied`; a failed per-item lookup reads as "not there";
removal and rewrite skip the edit check when no version was recorded; the gate opens when a
target that can hash compared nothing; the IMAP source opens folders with SELECT (§1). As with the
other rows, the owner may instead accept a gap in writing, dated, with the reason.

**After the first invitation:** T6 with 0144 T4, once T3 has landed. Then T7's count on the OTA
stack and the appliances.

**Handed to other plans, for the session that syncs them:**

- **0131 §5** moves W18 from *"Explained to the owner, not planned yet"* to the plans opened at
  the owner's word, as 0149.
- **0144**: its Status block's advice to leave *apply deletions* off, its T4 row and T4's text
  (the comment correction and *"W18, not planned yet"*), §1's two *"W18, not planned yet"* lines,
  T1's line about the switch, open question 3, and *Not in this plan*.
- **0141 T8 (c)** and its *Not in this plan*.
- **0147 T3 (a)'s note on 0009** records that 0009's section headed T9 was answered twice, on
  2026-09-21 and on 2026-09-24, and that 0149 T4 carries the second answer. 0147's D1 note and
  its *Not in this plan*, which call W18 not planned yet, change with it.

## Not in this plan

- **The warning's words, the guide's line about the switch, and the confirm screen's sentence on
  adoption:** 0144 (T1, T4, T5). T6 here says only what changes for them.
- **Who may press apply:** 0137. Arming the switch is owner-only. Applying one item is open to
  every role once the switch is armed, and 0137 proposes owner only (its T1 matrix, enforced by
  T2).
- **The terms' *"approve item by item"*:** 0139 T1's list (0144 T3).
- **An IMAP target that finds a message only in the folder it writes to:** 0144 T5 and its open
  question 4.
- **Live proof of the sources:** 0141. T5's Gmail half is recorded there.
- **What a tester is told about the gate holding:** the verification screen's existing sentence
  (`verify.countsOnly`) and the new issue's text. A place in the tester guide is 0144's.

## Open questions

1. **D2's reading (T4).** (a) Option 1, as proposed: the gate holds for a domain whose target can
   hash and which returned no hash for any sampled item, and also where nothing was sampled at
   all. JMAP contacts keep opening the gate on counts. *Recommended*, and what 0009 proposed. (b)
   Word for word: the gate holds wherever nothing was compared, JMAP contacts included. A
   migration whose contacts go to JMAP could then never cut over, unless contacts move to CardDAV
   (`packages/shared/src/target-domains.ts`). One neighbouring case needs an answer under either
   reading. If every sample's recorded hash was made by an older fingerprint version, the target
   did answer with a hash, but nothing was compared (`dav-canonical.ts`: a cross-version comparison
   counts as unavailable). (a) as written lets that pass. `ownpace-live` has no such rows.
   *Answered 2026-09-24: (a), option 1 (D2).* The owner: *"1) 0159, gate answer: a"*.
2. **Rows without a version on the OTA stack and the appliances (T3, T7).** (a) Leave them frozen:
   never removed, and never rewritten from the source. *Recommended for the alpha*, since
   `ownpace-live` has none. (b) For files only, re-establish the version when the target's bytes
   hash to what the ledger recorded, and use the ETag read in the same request. Calendars and
   contacts cannot do this, because their fingerprint does not see an edit outside its fixed set
   of properties, such as a meeting's new time. *Answered 2026-09-24: rewritten (D3).* The owner:
   *"2) 0149, older wors without a version: rewritten"*. That is neither (a) nor (b), so §2
   states the reading: a source change rewrites such a row, as today, and nothing removes it.
3. **A target that gives only weak versions (T3).** Under T3 nothing on it is ever removed, and a
   rewrite keeps today's check, a HEAD and a comparison. (a) Accept that, since removal fails
   closed. *Recommended.* (b) Measure first which of the targets testers bring send weak ETags on
   PUT. The first nightly after T3 shows it for Nextcloud and Stalwart.
