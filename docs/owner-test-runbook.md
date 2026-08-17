# Owner testing — what to run yourself, in what order, and why

This runbook sequences every test only the owner can run, across the machines you
actually have: the Windows laptop, the Spark, and a real Google Drive. It does not
repeat the documents that already exist — it says **which one to follow when, what
to do differently this round, and what to send back**. The stage documents are:

| Stage | Follow | What it proves |
|---|---|---|
| 1 | [`google-workspace-setup.md`](./google-workspace-setup.md) | Credentials + the export byte-stability verdict + the CI fixture |
| 2 | [`windows-appliance-runbook.md`](./windows-appliance-runbook.md) | The appliance on Windows — already proven for mail; this round adds Drive and the queues |
| 3 | [`selfhost-quickstart.md`](./selfhost-quickstart.md) | The compose deployment on the Spark, over days |
| — | [`operator-runbook.md`](./operator-runbook.md) | What every queue and refusal means, while you are clicking |

## App-first or commands-first? Both — but the order is not a preference

You said you prefer testing with the actual app, and for almost everything that is
the right instinct: the unit, integration and e2e tiers already grind the logic
against real Postgres, Stalwart and Nextcloud in CI, so re-proving logic by hand
adds nothing. What CI **cannot** reach is exactly what app testing on your machines
reaches: real Google behaviour, real Windows, a schedule running for days, and
whether the queue sentences make sense to the person they were written for.

Two things still come **before** the app, and for reasons stronger than habit:

1. **The Drive probe is a decision gate, not a test.** Its byte-stability verdict
   decides whether `nativeFilePolicy` export modes may ever be enabled. Testing
   the app first would either test with Docs refused (fine, but it answers
   nothing) or tempt you to enable an unmeasured export — the one failure mode
   where every pass rewrites every document forever while every write succeeds.
   The probe also proves the credentials through the *same code the appliance
   runs* — same env names, same token provider, same transport — so a later app
   failure can never be a credentials mystery. And with one extra variable it
   records the redacted fixture CI will replay forever. Ten read-only minutes.

2. **Each app drill below states its expected outcome first.** This round of
   preparation found a bug by doing exactly that: writing down "rename a file,
   the Moves queue shows it" and checking the code path led to the discovery
   that Drive move detection could never fire after the first pass (fixed in
   this same change, with the two-pass test that now pins it). An app drill
   without a stated expectation reads silence as success — that bug would have
   surfaced on your laptop as "I renamed a file and nothing happened", an
   evening lost to what a stated expectation catches in review.

Everything else: test through the app, exactly as you prefer.

---

## Stage 1 — the Drive probe (any machine with the repo, ~15 min once credentials exist)

Follow [`google-workspace-setup.md`](./google-workspace-setup.md) §1–4 once: Cloud
project, Drive API, consent screen, OAuth client, and the refresh token via the
OAuth Playground. Treat the refresh token as a password.

Then, from the repo root:

```sh
export GOOGLE_CLIENT_ID=…apps.googleusercontent.com
export GOOGLE_CLIENT_SECRET=…
export GOOGLE_REFRESH_TOKEN=…

# Point it at a folder that HAS A SUBFOLDER WITH FILES — path derivation is the
# thing most likely to be wrong, and a flat root cannot gate it. A dedicated
# test folder's id is ideal; unset means all of My Drive.
export DRIVE_ROOT_FOLDER_ID=…

# Run 1: office rendering, and record the fixture while you are there.
DRIVE_CAPTURE_FILE=./drive-capture.json pnpm exec tsx scripts/drive-export-stability.ts

# Run 2: the PDF renderer is a different renderer — measure it separately.
DRIVE_EXPORT_POLICY=export-pdf pnpm exec tsx scripts/drive-export-stability.ts
```

Ideally point `DRIVE_FILE_ID` at a Doc, a Sheet and a Slide in turn — three
renderers, three answers.

**Send back:** the full printed output of every run (the verdict is printed, not
stored), and `drive-capture.json`. The capture is redacted by construction —
names, ids and page tokens become pseudonyms, bodies become a hash and a length —
and it is safe to commit; that is its purpose. **What I do with it:** record the
T3 verdict in workplan 0042, commit the fixture, build the replay contract test
that gates the connector in CI forever, and — only if both renderers are stable —
unlock the export policies for real use.

---

## Stage 2 — the Windows laptop: one run that covers what the proven phases never touched

The platform chain is already proven and does not need re-proving: phases 1–3 of
[`windows-appliance-runbook.md`](./windows-appliance-runbook.md) ran on real
Windows 11 — Task Scheduler, boot survival, hard kill mid-sync, no Node
installed, upgrade in place. What has **never run on Windows** is everything that
merged since: the Drive source, the file target, and both destructive queues. One
sitting covers it.

**Only two genuinely new Windows items exist beyond that** — do them whenever,
they are independent of this round: Phase 4 (the MSI, not started) and a clean-VM
run on a machine that never had a toolchain. If you want the MSI built first, say
so — that is my work, not yours.

### Setup (10 min)

1. Update the payload on the laptop to a build of current `main` (the runbook's
   upgrade-in-place path — proven 2026-08-13).
2. Credentials: add the three `GOOGLE_*` values from Stage 1 to `secrets.cmd`.
3. Mapping: add a `domains.files` block to the mapping JSON —
   [`selfhost-quickstart.md`](./selfhost-quickstart.md) §"Google Drive as the
   file source" has the exact shape. Choose the target by what you want to
   eyeball: **Nextcloud (WebDAV) on the Spark** lets you see arriving files in
   its own web UI (`setup-nextcloud-users.sh` is idempotent, NetBird reaches it,
   `"tlsVerify": false` as the runbook says); Stalwart JMAP files also works.
4. Scope it: set `"rootFolderId"` to your **test folder**, not all of My Drive.
   Leave `nativeFilePolicy` unset (= `refuse`) unless Stage 1 said stable.
5. For the destructive drills only: `"allowApplyDeletions": true` on this
   mapping. This is the switch in front of both apply queues — do not set it on
   any mapping that points at data you care about.
6. A short `schedule.cron` (every 1–2 min) makes the drills interactive; put it
   back to 15 min afterwards.

### Drill A — the migration itself (expect: copied once, then nothing)

Start the appliance, open `http://127.0.0.1:8080/ui`, confirm the mapping.

- **Expect:** every binary file in the test folder appears on the target with its
  folder structure intact; every Google Doc/Sheet/Slide appears in **Could not be
  copied** (`/ui` → failures), one row each, with the refusal sentence naming the
  file and the policy. That is correct behaviour, not a bug — read the sentence
  and tell me if it would not have told you that.
- **Expect on the next pass:** `GET /status` shows the same item counts, nothing
  new created. A second pass that creates anything is a bug worth stopping for.

### Drill B — rename in place (expect: a relocation you can apply)

Rename one migrated file **in Drive**, same folder — `report.pdf` →
`summary.pdf`. Wait one pass.

- **Expect:** the target now holds BOTH copies (nothing is ever deleted by a
  pass), and **Moved on the old system** (`/ui` → moves) shows one row saying
  *renamed*, with two buttons: **Leave it where it is** and **Remove the old
  copy**.
- Click **Remove the old copy** — it arms first (*Confirm removal*), a single
  click never removes anything — then confirm.
- **Expect:** the row resolves with the server's own sentence; the OLD name is
  gone from the target; the new one is still there. In Drive: nothing changed —
  the token cannot write.
- **Also worth one deliberate minute:** rename another file and answer **keep**
  this time. The row moves to *Already decided* and the remove button is gone —
  and stays gone: `keep` is final by design, enforced on the server and in the
  database, not by the missing button (that enforcement is what PR #408 added).

### Drill C — a real move (expect: folder → folder, same buttons)

Drag a migrated file to a different subfolder in Drive. Same as B, but the row
reads `folderA → folderB` instead of *renamed*.

### Drill D — deletion (expect: a report, and NO apply button)

Delete a migrated file in Drive (into Drive's bin is fine). Wait **two full
passes** — absence must repeat before it is reported.

- **Expect:** **Deleted on the old system** (`/ui` → deletions) shows the row as
  *inferred* — and offers **keep only, no apply button**. Drive never *reports*
  deletions (its `removed` flag also fires for sharing changes, so this product
  refuses to treat it as evidence), and inferred absence is never enough to
  destroy a copy (ADR-0024 gate 3). The missing button is the safety argument
  working; the target keeps the file until you delete it there yourself.

### Drill E — trip the breaker on purpose (expect: refusal, then recovery)

With ≥20 files migrated, rename a subfolder holding more than a fifth of them.
Wait a pass, open Moves, try to apply **any single one**.

- **Expect:** the refusal names the numbers — *N of M items are recorded as
  moved… all of them are refused while that is true* — because a bulk relocation
  is indistinguishable from a connector mis-deriving every path, and removing
  copies on that evidence is not undoable. Answer **keep** on the folder's rows
  and applying elsewhere works again. This is the `mass_relocation_suspected`
  breaker doing its job; seeing it once now means recognising it later.

**Send back:** `windows-evidence.txt` from `scripts/windows/collect-evidence.cmd`
(as always), plus a sentence per drill — matched expectation, or what you saw
instead. Every refusal sentence you found unclear is a bug report by itself:
quote it verbatim (rule 9 applies to me too).

---

## Stage 3 — the Spark: the same thing, left alone for a week

Stage 2 proves the flows; it cannot prove a schedule that holds up. Follow
[`selfhost-quickstart.md`](./selfhost-quickstart.md) on the Spark (compose path),
same mapping shape, 15-min cron, and let it run.

- **Day 1:** `GET /status` after a few passes — counts stable, `itemsFailed`
  only the expected native-file refusals.
- **During the week:** use the Drive folder normally — add, edit, rename, move.
  Decide the queues when you feel like it; that is the product's actual shape.
- **Day 7:** `/status` again. What to look for: counts that grew only by what
  you added; a moves queue holding only what you left undecided; **no
  reappeared-after-removal warnings** in the log unless you re-created something
  you had applied (in which case exactly one, saying so).
- Before any upgrade during the week: the quickstart's backup section, as
  written.

**Send back:** the day-1 and day-7 `/status` JSON, and anything from the log that
surprised you.

---

## Stage 4 — managed on the Spark: now a real test

Both gaps this stage used to wait on are built: the wizard creates a
`google-drive` source connection, and the relocation apply runs through its own
queued job (`run-apply-relocation`) landing on its own receipt. So Stage 4 is
Stage 2's drills through the managed journey:

1. Bring up `deploy/compose/managed.yml` on the Spark (worker included — the
   destructive path runs through Trigger.dev there, so a missing worker shows
   up as receipts stuck `queued`, which is itself worth seeing once).
2. Walk the wizard: source **Google Drive** — client ID, root folder, account,
   client secret and refresh token are now **all on the source step** (workplan
   0070 gave each side its own credentials; there is no separate credentials
   step any more), the same three values Stage 1 proved. Then target your
   Nextcloud/Stalwart, and note the wizard pins the **file** data type and
   refuses the others in the same sentence the API would.
3. Confirm the mapping (it lands paused, by design), start it, and run drills
   A–E from Stage 2 at `/mappings/<id>/moves` and `/mappings/<id>/deletions`.
   The one visible difference from the appliance: **apply answers with a
   queued receipt** the row polls to its outcome, instead of a synchronous
   sentence — refusals arrive in the same words either way.
4. The drill worth doing here that Stage 2 cannot: rename a file in Drive,
   let it correlate, then delete the NEW name in Drive and wait two passes —
   the same item now sits in BOTH queues. Decide each side; each answers from
   its own receipt. That is migration 0010's discriminator working in front
   of you.

**Send back:** the wizard step where any sentence read wrong, and for one
applied relocation the receipt JSON from
`GET /api/migrations/<id>/moves/<hash>/receipt`.

## Stage 5 — Gmail (workplan 0044): the two things only reality can prove

The Gmail source reuses the proven IMAP read path; what no unit test can prove
is Google's half of the conversation. Two specific questions, ~30 minutes with
a real Gmail account (a disposable one is fine and better):

1. **Mint the mail token** — `docs/google-workspace-setup.md`, Gmail section:
   same OAuth client as Drive, scope `https://mail.google.com/`, sign in as the
   Gmail account. Configure either edition (appliance:
   `GOOGLE_MAIL_REFRESH_TOKEN` + a mapping with
   `"source": { "type": "gmail", "user": "you@gmail.com" }`; managed: the
   **Gmail** wizard card).
2. **Question one — the handshake**: does the first pass connect and list?
   A failure here is scope consent or client config, and the error should name
   which; if it does not, that sentence is the bug to send back.
3. **Question two — the view filter**: after one pass, the target must have
   INBOX, your labels, Sent and Drafts — and must NOT have All Mail, Starred
   or Important (in any language). If All Mail migrated, the filter missed
   Google's `\All` attribute in the real LIST response: send back the folder
   list from the run log.
4. Worth one look while there: label a single message with TWO labels before
   the first pass. It should land ONCE on the target (under whichever label
   listed first), with the other placement surfacing in the Moves queue as a
   report at most — not as a duplicate copy.

**Send back:** the run summary (folder count, created count), and the target's
folder list.

## Stage 6 — Google Calendar & Contacts (workplan 0045): does Google's DAV dialect answer?

The connectors are the proven CalDAV/CardDAV read paths; what no unit test can
prove is that GOOGLE's endpoints answer their discovery walk and sync-token
polling the way RFC-shaped servers do. ~30 minutes, same disposable Google
account as Stage 5:

1. Mint the tokens — setup doc, Calendar & Contacts section: scope
   `https://www.googleapis.com/auth/calendar` (Calendar) and
   `https://www.googleapis.com/auth/carddav` (Contacts). Configure either
   edition (appliance: `GOOGLE_CALENDAR_REFRESH_TOKEN` /
   `GOOGLE_CONTACTS_REFRESH_TOKEN` + a calendar/contacts domain naming
   `"type": "google-calendar"` / `"google-contacts"`; managed: the two wizard
   cards).
2. **Question one — discovery**: does the first pass list your calendars /
   address book? A failure here is Google's principal URL not answering the
   PROPFIND walk — send back the error verbatim, it names the URL it tried.
3. **Question two — the second pass**: run two passes, add one event and one
   contact between them. The second pass must copy exactly the additions
   (sync-token behaviour); a second pass that re-scans everything is worth
   reporting but not wrong — the ledger still makes it copy nothing twice.
4. Worth one look: a recurring event with an exception (a moved instance).
   It should arrive as ONE event on the target with the exception intact —
   that is the round-trip CalDAV preserves and JMAP cannot yet, and why the
   calendar target is CalDAV only.

**Send back:** both run summaries and, if anything refused, the sentence it
refused with.

---

## The safety rails, all in one place

- **Scope Drive testing to a dedicated test folder** via `rootFolderId` — not
  because the token can damage Drive (it is `drive.readonly`; it cannot), but
  because a small corpus makes every queue legible and every drill reversible.
- **Destructive drills point at disposable targets only**: the Spark's
  `dev.local` accounts exist precisely to be wiped. `allowApplyDeletions` stays
  off everywhere else — it defaults off, and nothing here needs it on a mapping
  you care about.
- **Tenant A stays read-only, forever** ([`test-tenant.md`](./test-tenant.md)).
  Nothing in this runbook goes near it.
- **The order matters once**: Stage 1's verdict gates `nativeFilePolicy`; until
  it exists, leave the default `refuse` and read the failures queue as designed
  behaviour.
