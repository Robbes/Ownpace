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
| 10 | [`soverin-supervised-run.md`](./soverin-supervised-run.md) | A migration into a provider we do not host, and the nightly lane that keeps checking it |
| — | [`operator-runbook.md`](./operator-runbook.md) | What every queue and refusal means, while you are clicking |

Stages 4 to 9 have no document of their own, and are written out in full below. Stages 8 and 9
are walked on `ownpace-live`, the stack testers use, and not on the OTA stack or the appliance.
Stage 10 runs on the OTA stack.

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
   (Passed 2026-09-16 and 17; see the note at the top of Stage 1.)
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

> **Done 2026-09-16 and 17.** The probe measured all twelve (policy, type) combinations. The
> verdicts are in workplan 0042 T3 and in `EXPORT_STABILITY`, and a format can be chosen per
> kind. The two unstable combinations were refused per file until 2026-09-23: since #1083 a
> document is exported again only when Drive's modified time for it moves, and a renamed one
> is paired by its Drive id, so neither is refused any more (ADR-0046, amended). The probe
> remains the way to re-take a verdict.

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

**Running it against a managed stack instead?** Name the Google *connection*
rather than pasting credentials: `DRIVE_CONNECTION_ID`, with `DATABASE_URL`,
`SECRET_ENCRYPTION_KEY` and the deployment's client pair. The exact block,
including why the host's `DATABASE_URL` is not the container's, is in
[`google-workspace-setup.md` §6](./google-workspace-setup.md#which-credentials-it-reads-and-where).
Either way: **from the repo root**, not from `deploy/compose`.

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
- **Also with a Google Doc**, if Docs are exported as Microsoft Office: rename
  one in Drive. Each export of it has other bytes, so it is recognised by its
  Drive id. **Expect** the same *renamed* row, and **not** a deletion two passes
  later. **Remove the old copy** works the same; unattended apply leaves it for
  you.
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

Both gaps this stage used to wait on are built: managed makes a Google Drive
source (through **Start a migration** since the wizard retired, 0153 D5), and
the relocation apply runs through its own queued job (`run-apply-relocation`)
landing on its own receipt. So Stage 4 is Stage 2's drills through the managed
journey:

1. Bring up `deploy/compose/managed.yml` on the Spark (worker included — the
   destructive path runs through Trigger.dev there, so a missing worker shows
   up as receipts stuck `queued`, which is itself worth seeing once).
2. Walk **Start a migration** (`/start`): tick **Google** on
   **Which account are you leaving?**, and **Files** alone on **What moves?**,
   with **Only one folder** for the dedicated test folder (*The safety rails*,
   below). On **Connect your accounts**, type the account under **Username**
   and the same three values Stage 1 proved (client ID, client secret and
   refresh token, under **Use your own Google client** where the deployment
   carries a client of its own), and press **Check the sign-in**. Once the
   account is connected, the screen asks for the folder. Then, on
   **Where does it go?**, choose your Nextcloud/Stalwart. The wizard's check
   that pinned the **file** data type retired with it (0153 D5):
   **Where does it go?** offers only destinations that take files, and a
   create the server refuses shows there as *Not set up: …*, in the server's
   own words.
3. **Next** on **Where does it go?** sets the migration up (it lands paused, by
   design); **Check, then start** counts it, and **Start** starts it. Then run
   drills A–E from Stage 2 at `/mappings/<id>/moves` and
   `/mappings/<id>/deletions`.
   The one visible difference from the appliance: **apply answers with a
   queued receipt** the row polls to its outcome, instead of a synchronous
   sentence — refusals arrive in the same words either way.
4. The drill worth doing here that Stage 2 cannot: rename a file in Drive,
   let it correlate, then delete the NEW name in Drive and wait two passes —
   the same item now sits in BOTH queues. Decide each side; each answers from
   its own receipt. That is migration 0010's discriminator working in front
   of you.

**Send back:** the screen of **Start a migration** where any sentence read
wrong, and for one applied relocation the receipt JSON from
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
   **Gmail** form, which **Start a migration** draws on
   **Connect your accounts** for **Email** under **Google** where the
   deployment has not declared Google's restricted scopes; where it has, the
   Google account carries the mail).
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
   `"type": "google-calendar"` / `"google-contacts"`; managed: **Calendar** and
   **Contacts** ticked under **Google** on **Start a migration**, which the
   Google account carries over the same DAV read path, since the
   **Google Calendar** and **Google Contacts** cards make no new migrations
   (0153).
   **Question zero, added 2026-09-20 — the narrower calendar scope.** The
   console lists `.../auth/calendar.readonly` *under the CalDAV API*, which
   suggests Google's CalDAV endpoint accepts it; this product never writes a
   source, so read-only is the scope it should ask for if it works. Mint the
   calendar token with `https://www.googleapis.com/auth/calendar.readonly`
   first. If discovery (question one) answers, that is the scope we ship and
   the code narrows; if it refuses, mint again with the full scope, and send
   back the refusal sentence — it is worth as much as a pass.
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

## Stage 7 — the cutover gate on real data (workplan 0009, ~10 min, the Spark)

The cutover's state machine is proved on Postgres and, since 0009 T12, pressed
nightly on the managed stack. What no gate can prove is the one thing that
depends on YOUR data: whether the §20 completeness gate PASSES over a real
mapping — a domain that cannot be read reports `NOT_VERIFIABLE` and blocks,
and that has never been asked of real volumes.

**This touches no DNS and stops nothing.** `start-cutover` opens a ledger and
`verify` reads; the sync keeps running; only `execute --yes` (not run here)
stops the passes and asks for the MX switch, and Ownpace never switches it
itself (owner decision 2026-07-16: verify-only DNS). The runbook the operator
follows for the switch is `runbook`'s output; that is the manual, not this.

```sh
# from the repo root on the Spark, DATABASE_URL pointing at the managed Postgres
pnpm exec tsx apps/worker/src/cli/index.ts start-cutover \
  --tenant <tenant-id> --mapping <mapping-id> \
  --domain <your-domain> --target <the target's mail host>
pnpm exec tsx apps/worker/src/cli/index.ts verify \
  --tenant <tenant-id> --mapping <mapping-id> --domain <your-domain>
pnpm exec tsx apps/worker/src/cli/index.ts status \
  --tenant <tenant-id> --mapping <mapping-id> --domain <your-domain>
```

Before the switch, `verify`'s DNS leg only checks that the domain HAS MX
records (SPF/DKIM/DMARC are warnings), so it does not block on DNS; the data
leg is the real question. On a green run the ledger advances to
`READY_FOR_CUTOVER` by itself; leave it there — a real cutover later
re-prepares from it (0009 T9), and nothing else reads it.

**Send back:** the full `verify` output — every domain's line, especially any
`NOT_VERIFIABLE` — and the `status` output. Nothing else is yours here: the
door, the job and the rollback are the managed gate's.

---

## Stage 8 — two strangers (workplan 0141 T12 (a); `ownpace-live`, before the first invitation)

Two people who are not you walk the managed journey on live: sign-in, a source, *Check, then
start*, a first pass, a progress link, a grant link, *Report a problem* and the Finish page's
permission list. Nothing in the repository drives this journey in a browser against a real API
(0141 §1). The phone half is Stage 9.

**When.** On `ownpace-live`, after 0133 T4, the mail half of the same walk. It starts once A and
B have each joined as the owner of an organisation of their own (*Before you start*). 0133 T4 does
not bring in both: it lets in one address, and its step 6 declines the other. The alpha note
(0131 T1) and the *Experimental* tag (0131 T2) are both on `main`, so any release cut from it
carries them.

**Before you start.**

- **Two fresh accounts, A and B.** Neither is on your own domains.
- **Two languages.** A's browser is set to Dutch, B's to English. The app takes its language
  from the browser the first time, and keeps a choice made with the menu's switch after that.
- **Both in, each as an owner.** A and B each come in the way 0133 T4's steps 1 to 4 let one
  address in. They ask for access at `/request-access`. You press *Grant access* for each in the
  access queue (*Access requests*, `/access-requests`). Each registers at live's identity
  provider with the address they asked with, signs in, and presses *Meedoen* / *Join* on the
  Invitations page (`/invitations`). A does this in the Dutch browser and B in the English one.
- **A's source** is a Google account that is a test user of live's Google client (0140 T0).
- **A second Google account, for step 6.** It is not A's, and it is also on live's Google client's
  list of test users (0140 T0). Google stops an account that is not on that list on its own
  screen, before the product learns who it is. That tests Google, not the product.
- **B's source** is a personal Microsoft account (outlook.com, hotmail.com or live.com). Its
  consent is also 0140 T6's personal-account consent. Microsoft must know live's callback address
  first (0140 T11). Until it does, step 2 fails for B at Microsoft, and that is not the product's
  failure.
- **A target for each first pass**, one you provide for the walk (0141 open question 3).
- **Live's release.** Note it from the build stamp at the foot of the menu. Every record below
  carries it.

Each step says what to do, then what to expect. A for Dutch, B for English, unless a step names
one of them.

1. **The language.** Open the dashboard.
   **Expect:** A sees Dutch and B sees English. The amber note at the top of the page begins
   *"Alfa: een kleine, uitgenodigde groep probeert deze dienst uit."* for A and *"Alpha: a
   small invited group is trying this service out."* for B. No note means live's web bundle
   was not built for the alpha (`VITE_OWNPACE_STAGE`, `apps/web/src/services/stage.ts`). Press
   the other language (the **EN** and **NL** buttons in the menu): the page's text changes, and
   the page's `lang` follows it (`<html lang="nl">` or `"en"`, in the browser's inspector).
2. **The source.** Start a migration (*Migratie starten* / *Start a migration*, which opens
   `/start`). On *Voor wie?* / *Who is it for?* each types a name. On *Welk account verlaat u?* /
   *Which account are you leaving?* A ticks *Google* and B ticks *Microsoft 365*, and on
   *Wat wilt u migreren?* / *What moves?* the data types stay as they are. On
   *Uw accounts verbinden* / *Connect your accounts*, A types the address under *Gebruikersnaam*
   and presses *Verbinden met Google*, once for each Google row the screen lists; B types the
   address under *Username* and presses *Connect with Microsoft*.
   **Expect:** the provider's consent completes, and the account's row says *Verbonden als …* /
   *Connected as …*. For B, write down what Microsoft's screens showed and whether the app was
   marked unverified: that record is 0140 T6's.
3. **The tag and the scope.** On *Waar gaat het naartoe?* / *Where does it go?*, choose the
   target you provided for each data type and press *Volgende* / *Next*. The migrations are set
   up, paused, and *Controleren, dan starten* / *Check, then start* opens.
   **Expect:**
   - On *Welk account verlaat u?* / *Which account are you leaving?* and *Wat wilt u migreren?* /
     *What moves?*, a source that has no live proof carries *Experimenteel* / *Experimental*
     (`SOURCE_PROOFS` in `packages/shared/src/front-door.ts`). B's *Microsoft 365* tile carries
     it, and so does each of its data types. A's *Google* tile does not, but its tasks data type
     does, and so does email where live reads it through the Google account.
   - On *Controleren, dan starten* / *Check, then start*, B's scope list shows *Shared mailboxes*
     under *Partial*, and never under *Migrates* (0141 T10). A's list has no shared-mailbox row:
     that row applies to the Microsoft 365 account only. The list's column titles follow the
     language (*Gedeeltelijk*, *Migreert*); its rows are English on both.
4. **The first pass.** Press *Starten* / *Start* once every count is in. The person's page opens.
   **Expect:** the progress moves, and the first pass ends `completed` in the target you
   provided. Write down what the preflight found, what was copied and what was skipped, per data
   type.
5. **A progress link.** Links are made per person (ADR-0035, amended 2026-09-29). Open the
   person the migration is for, the one named on *Voor wie?* / *Who is it for?*, from *Migraties*
   / *Migrations* (`/people/<id>`). On the person's page, under *Eén voortgangslink voor alles* /
   *One progress link for everything*, press *Voortgangslink maken* / *Create progress link*.
   Open the link signed out, in a private window.
   **Expect:** the page (`/view/<link>`) shows each of their migrations' progress, and nothing
   that reads or changes a migration.
6. **A grant link (A only).** Grant links are for Google sources only. On the person's page of
   A's migration, under *Eén toegangslink voor alles*, choose how long it works and press
   *Toegangslink maken* ([`grant-links.md`](./grant-links.md), *Issuing one*).
   - Open it in a private window, press *Doorgaan met Google als …* on the account's card, and at
     Google sign in with the second Google account (*Before you start*).
     **Expect:** it is refused. The page after Google names both addresses and says *"Er is
     niets opgeslagen, en uw link werkt nog."* / *"Nothing was stored, and your link still
     works."* If Google's own screen stops the account first, it is not on the test-user list:
     add it and try again. That is not a result for this step.
   - Open it again and sign in as A. **Expect:** it is accepted.
   - Open it a third time. **Expect:** it cannot be used. The grant page says *"Deze link kan
     niet worden gebruikt. Misschien is hij al gebruikt, …"* / *"This link cannot be used. It may
     have been used already, …"*, and on the person's page the link reads *"Op … is toegang
     gegeven. Deze link is verbruikt."*

   Since #1208 (0145 T6), that refusal and the page after Google come in the language the grant
   page was in. Write down the language each came in.
7. **Report a problem.** Look in the menu for *Een probleem melden* / *Report a problem*.
   Live has no helpdesk: a report goes by mail to `support@ownpace.eu`, through the relay the
   sign-in codes use (0130 T5, 0133 T0), once live's `.env` has `REPORT_MAIL_TO` (step 8f of
   [`managed-bring-up.md`](./managed-bring-up.md)). Open the entry and describe anything. Add a
   screenshot (*Schermafbeelding* / *Screenshot*, a PNG or JPEG) two ways, one each: A makes one
   the way the fold under the field says (*Hoe maak ik een schermafbeelding?*) and pastes it on the
   page with Ctrl+V or Command+V; B chooses a picture file, or drops one on the field. Then press
   *Melding versturen* / *Send the report*.
   **Expect:**
   - Before it is sent, the field names the picture it will send, *"Bijgevoegd: …"* for A and
     *"Attached: …"* for B, with *Schermafbeelding verwijderen* / *Remove the screenshot* beside
     it.
   - The menu has the entry. The page answers *"Verstuurd naar ons supportteam, met
     meldingskenmerk …"* for A and *"Sent to our support team, with report reference …"* for B,
     and then *"We antwoorden per e-mail naar …"* / *"We will reply by email to …"* with the
     address the tester signed in with. Write down the report reference.
   - Before it is sent, above the button, the page says *"Gaat naar het supportteam van Ownpace,
     per e-mail naar support@ownpace.eu."* / *"Goes to the Ownpace support team, by email to
     support@ownpace.eu."*, and the fold *Wat we meesturen* / *What we send with this* opens on
     the lines the report will carry, in English: `Page`, `Organisation`, `Build`, `Role`,
     `Organisation status`, `Migration`, `Service hold`, `Scheduler`, `Browser`, then
     `Screen language` (*Dutch* for A, *English* for B), `Time zone` and `Window width`. Opened
     from a migration's page, it also has the migration's `Grant`, `Grant link`, `Data type …` and
     account lines. No line names an address, a folder, a subject or a provider's error text.
   - The report is in `support@ownpace.eu` within a few minutes. Its Subject is *Ownpace:* and
     the first line of the description. Under the description come the same lines the fold
     showed, in the same order, and the body ends with a `Reply to:` line naming the tester's
     sign-in address and a `Report reference:` line with the reference the page gave. The
     screenshot is attached.
   - **The reply check** (0131, the row for 0130). The mail goes from `support@ownpace.eu` to
     itself, so open it in Proton's own client and press Reply. The To field shows the tester's
     sign-in address. Send the reply and the tester receives it. If To shows the support address
     instead, answer with a new mail to the `Reply to:` line's address, and write down that Reply
     did not reach the tester: 0130 records it.

   A menu with no entry on live is a failure of this step, not a result. The API's mail is off or
   `REPORT_MAIL_TO` did not reach it, and the API's log says `problem reports are switched off`,
   with what is missing. Opening `/report` by hand then shows *"Een probleem melden is op deze
   dienst niet ingesteld."* / *"Reporting a problem is not set up on this service."*

   On a stack with a Zammad (`ZAMMAD_URL` and `ZAMMAD_TOKEN` set), the report becomes a ticket
   there instead, and the page answers *"Verstuurd. Uw melding heeft nummer …"* / *"Sent. Your
   report is number …"*. On a stack with neither a Zammad nor the API's mail, the menu has no
   entry, and a tester's route is the address in the alpha conditions (0131 T5).

   Write down which answer the page gave, the browser and whether A's paste attached the picture,
   whether the mail arrived with its screenshot and the same reference, and whether Reply's To
   field showed the tester's address or the support address.
8. **The permission list.** On the Finish page (`/mappings/<id>/finish`), press *Haal de
   rechtenlijst op* / *Get the permission list*, and read the file it downloads.
   **Expect:** every sentence in it is true of that source. For A's Google account, the
   calendar section says *"Google Calendar sharing is not yet read by this tool …"*, which is
   true. For B's Microsoft 365 account it says *"this source is a Microsoft account, connected
   with one person's own sign-in. That grant is delegated …"*, and that the directory, other
   people's mailboxes and calendar sharing are not read with it and are noted by hand before
   cutover. That is true too.
   A release without 0141 T11 says instead *"this tenant has no Microsoft 365 source
   connection, and only Graph can enumerate a directory"*, which is not: B has one. On such a
   release, B's step 8 is a failure, and the record names T11.

**Record.** For each step and each person: pass or fail, the date, live's release, and the
language seen. Never an address, a name or a tenant id. It goes in 0141's Status as a dated
paragraph. B's consent screens also go to 0140 T6.

**A live proof, if you want one.** The walk alone is not a live proof. *What counts as a live
proof* ([`feature-matrix.md`](./feature-matrix.md), *Live proofs*) also asks for a verification
and a second pass that creates nothing (its points 5 and 6), and the eight steps have neither. For
a row, do this after step 4, for each person:

- On the migration's page, open *Verificatie* / *Check* (`/mappings/<id>/verify`) and press
  *Voer de verificatie uit* / *Run the check*. Each data type's *Resultaat* / *Result* reads
  `PASS`. Write down its two counts, *Op het oude systeem* / *On the old system* and *Op het
  nieuwe* / *On the new one*.
- Run one more pass: on *Migraties* / *Migrations*, press the play button in the migration's row
  (its tooltip reads *Synchroniseer nu* / *Trigger sync*). When the pass has ended, press
  *Verifieer opnieuw* / *Check again*. Each data type's *On the new one* count is the one you
  wrote down, so the second pass created nothing.

Where Verify does not cover a data type, point 5 lets you compare the counts with the provider's
own screen instead, and write down both. Where calendar events or tasks with attendees were
copied, point 7 also needs the catcher or catch-all to have stayed silent. This stage does not
check that.

A pass that then meets all seven points is a row under *Recorded proofs*, with the account *a
second account* and the stack `ownpace-live`. Where that row's kind and data type are still
experimental in `SOURCE_PROOFS`, as all of B's are, the verdict turns proven in the same pull
request as the row; `scripts/a-proof-that-was-written-down.unit.test.ts` refuses a row beside an
experimental verdict.

**Passes when** all eight steps pass for both people. Until 0141 T11 is in live's release, step
8 cannot pass for B.

---

## Stage 9 — the same walk on two phones (workplan 0145 T10; `ownpace-live`, before the first invitation)

Stage 8 again, on phones, in Dutch, and with a screen reader. It also produces the list of
browsers that other apps open a link in. Nothing in the repository runs the app at phone width,
in WebKit or under a screen reader (0145 §1), so this walk is the only check there is.

**When.** After Stage 8, on `ownpace-live`, once live runs a release that carries 0145's
minimum (0146 T5 is how live gets a release). On `main` on 2026-09-27 the minimum is only
partly there:

| 0145 task | Steps below | On `main` |
|---|---|---|
| T1, the phone menu takes focus and gives it back | 3 | Yes, since #1169 (`Layout.tsx`) |
| T3 (a), each step starts at the top and says which it is | 5 | Yes, since #1206 in the wizard, which retired (0153 D5); *Start a migration* keeps the rule (`StartMigration.tsx`, `Layout.tsx`) |
| T5 with T7 (a), the consent window opens on the press, and a greyed-out button says why | 4 | No |
| T6, the grant page and the consent endings in one language | 6 | Yes, since #1208 |

A step whose task is not in live's release is recorded as *not in this release*, not as a
failure.

**Before you start.**

- **The phones.** An iPhone on iOS 16.4 or later, with Safari, and an Android phone with
  Chrome. Both are set to Dutch.
- **The screen readers.** The whole walk once on each phone, then steps 3 to 5 again: once with
  VoiceOver on the iPhone, and once with TalkBack on the Android phone.
- **The apps.** When you grant the first testers' requests, ask which apps they read their mail
  and chats in (0145 D2). Those apps are the rows of the table below.
- **Live's release.** The build stamp is at the foot of the menu, and at the foot of the pages
  outside it, such as sign-in, the request form, and the grant and progress pages.

The steps, on each phone:

1. On the Dutch site, press *Toegang aanvragen*.
   **Expect:** the request form (`/request-access?locale=nl`) opens in Dutch, and the page does
   not scroll sideways.
2. Sign in.
   **Expect:** the identity provider's page fits the phone's width. If it does not, the finding
   goes to 0135.
3. Open the menu (*Menu*), then close it with *Sluiten*, and once more with the grey backdrop.
   **Expect:** when the menu opens, the screen reader is on *Sluiten*. When it closes, the reader
   is back on *Menu* (T1).
4. In *Migratie starten*, tick *Google* on *Welk account verlaat u?*, go on to
   *Uw accounts verbinden*, type the address under *Gebruikersnaam* and press
   *Verbinden met Google*.
   **Expect:** Google's page opens, the result arrives back on that screen, and Google's tab
   closes (T5). Where the button is greyed out, the reason is written under it (T7 (a)).
5. Press *Volgende* on each screen of *Migratie starten*.
   **Expect:** each screen starts at the top of the page, and the screen reader reads its
   heading, such as *"Welk account verlaat u?"*; the line above it says *"Stap 2 van 6"*
   (T3 (a)). The six screens are *Voor wie?*, *Welk account verlaat u?*,
   *Wat wilt u migreren?*, *Uw accounts verbinden*, *Waar gaat het naartoe?* and
   *Controleren, dan starten*. The wizard's four steps retired with it (0153 D5).
6. For each app on each phone, issue a fresh grant link on the person's page (Stage 8's step 6,
   *Toegangslink maken*), because a link that has been accepted is spent. Once the account is
   connected, the new link asks for it again (*Opnieuw verbinden met Google als …*), which is
   what this step needs. Send it to the phone in that app, one
   in WhatsApp and one in your mail app, and open it from there.
   **Expect:** the grant page, Google's return and the page after it are all in Dutch (T6), and
   that last page fits the screen (#1137). Each app's browser goes in the table below.
7. Open the progress link.
   **Expect:** it can be read on the phone, and it does not scroll sideways.
8. In Safari, set the page zoom to 200% and walk *Migratie starten*.
   **Expect:** all its text and buttons can still be reached (WCAG 1.4.4).

**The in-app browsers.** For the grant link, and for the sign-in link in the access-granted mail,
one row for each app the testers named:

| App | Phone and OS version | Which browser opened | Google's page | Our page after it | Language seen | Date | Release |
|---|---|---|---|---|---|---|---|

*Which browser opened* is one of: the system browser, an in-app tab, or a view inside the app.
The two page columns say whether it worked. *Language seen* is the language our page came in.

**Record.** For each step, on each phone and in each screen-reader pass: pass, fail or *not in
this release*; the date; live's release; the kind of phone and its OS version; the browser; the
language seen. Never an address. The rows and the table go in 0145's Status. The grant link's
in-app rows also go to 0140 T3. Name a browser where neither the consent window nor its link
comes back in 0145 T5: it is what that task's parked same-tab fallback waits for. A sign-in page
that does not fit goes to 0135. 0145 T9 (a)'s paragraph for the tester guide is written after
this, and says only what this walk found.

**Passes when** every step passes on both phones, and steps 3 to 5 pass under both screen
readers.

---

## Stage 10 — Soverin as a target (workplan 0141 T7; the OTA stack, before a tester who picks the Soverin card)

Follow [`soverin-supervised-run.md`](./soverin-supervised-run.md), steps A to H. It is 0105 T3's
sitting: a small calendar and contacts migration into Soverin, a provider we do not host,
through the managed front door, with the catch-all as the only ear. Its step H arms the nightly
lane that keeps checking the same thing (0141 T13).

**Where.** The OTA stack, not `ownpace-live`. The lane reads that stack's persisted `.env`, and
step H points it at that stack's API (0141 T7, under 0132 D7).

**It cannot start yet.** The runbook's source was the OTA stack's demo Nextcloud, which we host
and may seed. On `main` the managed front door offers no CalDAV, CardDAV or Nextcloud source:
*Start a migration* and the Accounts page offer the cards in `SOURCE_CARDS`
(`apps/web/src/components/front-door-cards.ts`), and the create route accepts the same list.
Which source the sitting uses is open question 9 in 0141, and it is yours. The runbook says so
under *Before the sitting*.

**What changed in the runbook on 2026-09-27** (0141 T7 (a)):

- step H signs in with a token from the identity provider, because the stack will not accept a
  token the lane signs itself. It says whose token that is, how to take it, and how long it
  lives;
- step B gains event 4, whose organiser is the Soverin account's own address. So the sitting
  also answers 0141 T9's canary on a target we do not run, and step E checks its copy and one
  update;
- the rest now matches the code: one Soverin connection carries calendars, contacts, mail and
  tasks, so one mapping is enough; the Test no longer shows the scheduling verdict, so step E
  reads it from the audit log; and the labels are the ones on the screen.

**Record.**

- The runbook's findings, as dated rows in 0105's Status, the same day.
- In 0141's Status: that the sitting ran on the OTA stack, and step H's verdict line.
- A pass that meets all seven points of *What counts as a live proof* is a row under *Recorded
  proofs*. Its *Kind* is the source's kind, its *Target* is `soverin`, and its stack is the OTA
  stack. It is never *Kind* `soverin`: `SOURCE_PROOFS.faces.soverin` holds Soverin as a
  *source*, which this sitting does not prove.

**Passes when** step C's control arrives, step E finds every seeded item on Soverin, step F
finds nothing carrying the run's tag that day and the day after, step G leaves nothing behind,
and step H's run by hand prints `PASS`.

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
