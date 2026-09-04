# Feature matrix — what migrates, per object type, and what does not (yet)

**Ground truth, not aspiration.** Every row below mirrors the engines and the two shared
coherence matrices (`SOURCE_TYPE_DOMAINS` / `TARGET_TYPE_DOMAINS` in
`packages/shared/src/target-domains.ts`) — the same tables the wizard constrains with and
the create API refuses against. When this document and the code disagree, the code is right
and this file has a bug; the per-domain detail links the ADR or workplan that carries each
decision. Last reconciled: 2026-08-16 (after PR #416).

Legend: ✅ migrates · 🔁 detected & reported, owner decides (never acted on silently) ·
⏳ built, awaiting first contact with reality (owner runbook stage named) ·
⛔ not yet built · 🚫 deliberately not done, with the reason.

---

## Email

| | generic IMAP | Microsoft 365 | Gmail |
|---|---|---|---|
| **Source** | ✅ password (`imap`) | ✅ IMAP+XOAUTH2 with your Entra app (`oauth2`), Graph fallback behind it; ✅ Graph REST (`graph`) | ⏳ IMAP+XOAUTH2 with your Google client (`gmail`, workplan 0044) — Stage 5 |
| **Target** | ✅ IMAP half of `imap-dav` | — (targets are where you migrate *to*) | 🚫 never a target |

Also a target: **JMAP** (`jmap` — Stalwart / La Suite / mosa.cloud), and **Soverin**
(`soverin`, workplan 0106 T4b) — the account kind's mail face: the IMAP half of `imap-dav`,
driven from the mail server the person STORED on the connection (`mailHost` — demanded by
name when email is ticked, never guessed from the provider's name).

What migrates: messages as **verbatim RFC822 bytes**, the folder tree, and the four flags the
engines map (`$seen`, `$flagged`, `$draft`, `$answered` — the last one absent from the Graph
source, omitted rather than guessed). Idempotent on Message-ID: a re-run copies nothing
twice, even after a wiped ledger. Trash and Junk are **left behind by default**
(`excludeSpecialUse`; set `[]` to take them), while the trash is still read as deletion
evidence. Gmail: labels arrive as folders; the All Mail / Starred / Important views are
dropped by attribute so nothing duplicates; a multi-label message is copied once (first
folder seen) and other placements can surface in the Moves queue as reports. A name the
server lists as `\Noselect` or `\NonExistent` — Gmail's `[Gmail]`, and the namespace
containers other servers publish — is a **container, not a folder**: it holds no mail and
cannot be opened, so it is neither counted nor scanned nor created on the target.

Detected & reported, never auto-acted: 🔁 a message moved between folders (stable key —
there is no old copy to remove, so `keep` is the only action); 🔁 a message the owner
binned on the source (positive `trashed` evidence; `apply` may remove the target's copy
behind ADR-0024's gates, per item, per decision).

Not (yet) migrated:
- 🚫 **Server-side rules/filters (sieve), signatures, auto-reply/out-of-office, delegation
  and folder ACLs** — server configuration, not mailbox content; migrating them means
  writing to the target's admin surface, which no engine here touches.
- 🚫 **A shared mailbox as a by-product** — it is an ordinary mapping instead
  (`pattern: shared_s`, `source.mailbox` on the Graph source; §14.1). A **distribution
  list** is refused as a mapping outright: it has no message store, and a "successful,
  empty migration" is the lie that refusal prevents (workplan 0027; manual runbook for the
  definition + members).
- ⛔ **Category/label colours and non-flag keywords** — only the four mapped flags travel.

## Calendars

| | generic CalDAV | Microsoft 365 | Google |
|---|---|---|---|
| **Source** | ✅ (`caldav`) | ⏳ Graph (`graph-calendar`) — WIRED in workplan 0054 (before it, the config parsed but could not build: the connector had no call site); **workplan 0059 fixed a delta loop that re-requested page one forever on any calendar with more than one page, and the `/$delta` path Graph does not serve**; appliance mapping files; shared mailbox via `source.mailbox` | ⏳ CalDAV with OAuth (`google-calendar`, workplan 0045) — Stage 6 |
| **Target** | ✅ CalDAV only | — | 🚫 never a target |

Also a target: **Soverin** (`soverin`, workplan 0106 T4a+T4b) — the first provider-named
**account** kind: one connection row, one app-password, carrying email, calendar *and*
contact mappings through the same writers the protocol kinds use (mail via the stored
`mailHost`, see Email). What the account actually answers per face is measured and stored
(the 0106 qualification), never assumed.

Also a source: **Google** (`google`, workplan 0106 T3b) — the same account shape on the
grant side. One connection row, one OAuth grant, several faces: **calendars and contacts
today**. Mail and files are absent for a reason that is Google's rather than ours — it
prices `calendar` and `carddav` as *sensitive* scopes (brand verification, free) and
Gmail's `https://mail.google.com/` and `drive.readonly` as *restricted*, needing an annual
third-party security assessment. Asking for all four in one consent would push the managed
client into that tier for every customer, including one who only wanted their contacts. So
`gmail`, `google-calendar`, `google-contacts` and `google-drive` **stay and cohabit**: a
person migrating a mailbox uses `gmail` today, and when the assessment is bought those
faces join `google` rather than the kinds being replaced. The constraint binds the managed
client alone — an appliance registers its own OAuth client and does its own verification
(ADR-0041). Which faces any account kind serves lives in one table
(`PROVIDER_ACCOUNT_DOMAINS`), so a provider gaining one is a row edit rather than a branch.

Also a source: **Microsoft 365** (`microsoft`, workplan 0114) — the third account kind, and
the asymmetry with `google` runs the **other way**. It carries **all four faces from the
first day** — mail, calendars, contacts and OneDrive — because Microsoft's delegated read
scopes over the signed-in user's own data (`Mail.Read`, `Calendars.Read`, `Contacts.Read`,
`Files.Read`) carry no equivalent of Google's restricted tier and its annual third-party
security assessment. The one face it does **not** carry is tasks, and that absence is ours
rather than the provider's: Graph serves Microsoft To Do at `/me/todo/lists` under
`Tasks.Read`, and no connector reads them yet (0114 T9). `oauth2` and `graph` **stay and
cohabit** — they mean "the customer's own Entra app registration", which may carry
application permissions this delegated grant never will, and which is what an administrator
migrating other people's mailboxes needs.

What migrates: events as **iCal objects**, with recurring series and their exceptions
preserved over CalDAV; incremental sync via RFC 6578 sync-tokens (ctag fallback); the
shadow-sync **update path** rewrites an event the source changed — unless the target's copy
was edited there, which is detected and left alone (`conflicted`, hard rule 2). Deletions
arrive as **`reported` evidence** (the DAV sync answer names the removed object), the
strongest class, and `apply` may follow them through per owner decision.

Not (yet) migrated:
- 🚫 **JMAP as a calendar target** — parked by owner decision (workplan 0031 T1): recurring
  events cannot round-trip over JMAP yet, and a target that flattens a series into single
  events is data loss wearing a green checkmark. CalDAV is the calendar target until that
  changes upstream.
- 🚫 **Live invitation state** — events are copied as data; nobody is re-invited, no
  organiser is re-pinged. That is the correct behaviour for a migration and it is stated
  here so nobody expects otherwise.
- ⛔ **Tasks (VTODO) and calendar sharing/ACLs, colours, notification defaults** — the
  engines carry events; per-calendar server settings stay where they are.

## Contacts

| | generic CardDAV | Microsoft 365 | Google |
|---|---|---|---|
| **Source** | ✅ (`carddav`) | ⏳ Graph (`graph-contacts`) — wired in workplan 0054, same story as calendars, **including the same page-one-forever delta loop and `/$delta` path, both fixed in workplan 0059**; appliance mapping files; shared via `source.mailbox` | ⏳ CardDAV with OAuth (`google-contacts`, workplan 0045) — Stage 6 |
| **Target** | ✅ CardDAV | — | 🚫 never a target |

Also a target: **JMAP** (workplan 0031 T2), and **Soverin** (`soverin`) — the account kind's
contact face, riding the same CardDAV writer (see Calendars).

What migrates: contacts as **vCards** (photos ride inside), with the same
update/conflict/adoption behaviour as calendars, incremental sync, and `reported` deletion
evidence with the owner-decided `apply`.

Not (yet) migrated:
- 🚫 **Distribution lists / contact groups as mappings** — same refusal and reason as
  mail's (workplan 0027); the group **definitions** are discovered and listed (managed
  group discovery) so the manual step is a checklist, not archaeology.
- ⛔ **Address-book sharing/ACLs** — server configuration.

## Files

| | generic WebDAV (Nextcloud, …) | Google Drive | Microsoft 365 | Dropbox | Box |
|---|---|---|---|---|---|
| **Source** | ✅ (`webdav`), incl. trash-bin read for deletion evidence | ✅ (`google-drive`, workplan 0042), My Drive, a **shared drive** or a **folder shared with the account** by id — browsable since workplans 0049/0051; bin read for evidence; **orphan check** (`scripts/list-drive-orphans.ts`, workplan 0058) reports owned files under no folder at all — Drive's `is:unorganized`, which no walk from a root can reach | ⏳ OneDrive/SharePoint (`graph-drive`, wired in workplan 0054; **workplan 0058 fixed three defects that made it unable to migrate a real drive** — a natural key read from a `path` field Graph never returns, which flattened every file onto the root; a folder listing that never recursed and omitted the root; and `isRename` comparing the same phantom field); appliance mapping files; deletions arrive as **`reported`-class evidence** from the delta stream's `deleted` facets (pinned by test, 0054 T4c corrected); another user's drive via `mailbox` needs `Files.Read.All` (see the setup doc's consent note) | ⏳ (`dropbox`, workplan 0055): the whole Dropbox or a `rootPath` — **browsable** via `sharing/list_folders` (wizard button + appliance script; mounted shares carry the path, optional `sharing.read` scope); the owner's own read-only app; `content_hash` change detection; **tombstone read** (`include_deleted`) gives `trashed`-class deletion evidence, absence-counting covers the rest | ⏳ (`box`, workplan 0056): All Files or a `rootFolderId`; the owner's own read-only platform app via the **Client Credentials Grant** — no refresh token, because Box rotates refresh tokens on every use and stored credentials are never written back; the numeric subject user id rides the mapping (one subject per mapping); `sha1` change detection; **bin read** (`/folders/trash/items`, original paths recovered from the `path_collection` ancestor chain the listing already carries) gives `trashed`-class deletion evidence, so a Box deletion can be APPLIED, not only reported; **web links** are pointers, not files — not enumerated |
| **Target** | ✅ WebDAV | 🚫 never a target | 🚫 never a target | 🚫 never a target | 🚫 never a target |

Also a target: **JMAP files** (workplan 0031 T3).

What migrates: file **bytes, verbatim**, hashed (`contentHash`) so unchanged files are never
re-sent and changed ones are updated (with the same edited-on-target conflict protection);
the folder tree; optional `targetFolderPrefix` to merge several sources into one account
(merge is the default — owner decision 2026-08-16) or keep a subfolder per source.

The file domain is where **relocations** live, because its natural key is the path: a moved
or renamed file is 🔁 detected by content-hash correlation and may be **applied** — the old
copy removed only after the target itself confirms the bytes exist under the new key
(ADR-0030 and its amendments) — and, per mapping opt-in, applied **unattended** behind four
extra gates (ADR-0031: unique pairing, survived-a-pass, breaker-decides-for-the-pass,
per-pass cap, `system:auto-apply` audit rows, digest narration). Deletions: a file in the
source's **bin** is positive evidence, reported at once; an emptied bin falls back to
absence-counting (`inferred`, two clean passes, and gate 3 bars applying it).

Every file source enumerates by walking DOWN from its configured root, so anything not
reachable that way is not migrated. What can float differs per provider, and is stated rather
than assumed: **WebDAV** nothing (the server mounts received shares into the tree); **Box**
nothing structural (every item has a parent, collaborated folders appear in "All Files");
**Dropbox** unmounted shared folders (shown in the browse) and Business team namespaces (⛔);
**Drive** shared-with-me items (root a separate mapping) and genuinely orphaned owned files
(⏳ reported by the 0058 orphan check, not migrated); **OneDrive** `sharedWithMe` (⛔ not
enumerated).

Every bin read distinguishes **two kinds of skip** (workplan 0057): an entry whose original
location is outside the migration's root is not counted — it was never copied, so no target copy
exists to reconcile — while an entry the source could not NAME (a permanently-deleted Drive
ancestor, a Box item with no `path_collection`, a tombstone with no path) is counted and
explained on the pass result. Those deletions are still found by absence-counting, but their
evidence drops to `inferred`, which gate 3 will not apply — so the count is what tells an owner
why an apply button is missing rather than leaving them to guess.

Not (yet) migrated:
- ⏳ **Google Docs / Sheets / Slides** — refused by default, each named with the reason:
  they have no bytes, only lossy exports, and `nativeFilePolicy` stays `refuse` until
  export **byte-stability is measured** against a real tenant (Stage 1,
  `scripts/drive-export-stability.ts`). An unstable export would silently rewrite every
  document every night. Drive **shortcuts** fall under the same refusal (they are pointers,
  not files).
- 🚫 **Sharing permissions / ACLs, version history, comments, stars** — the file's bytes
  and place migrate; its social metadata does not. The Finish screen's **permissions
  handover** document is the deliberate substitute for ACL migration.
- 🚫 **Two same-named files in one folder** — the path is the natural key and the ledger's
  unique index makes the second a hard stop, not a silent overwrite.
- ⛔ **Incremental Drive delta** — every pass lists every folder (the ledger still copies
  nothing twice; the cost is listing time, not correctness). `changes.list` is deliberately
  unused for now (workplan 0042 T1 records why).

## Shared content

"Shared" means a different thing per provider, so its migration state is stated per case
rather than as one row:

- ✅ **A shared drive (Google)** is a first-class root: `rootFolderId` names it by id
  (browsable since workplan 0049), and the connector always sends the two query parameters
  without which the Drive API *pretends a shared drive is empty* — the silent-empty-pass
  failure that guard exists for is documented on the connector itself.
- ✅ **A shared mailbox or a shared mailbox's calendar (M365)** is an ordinary mapping via
  `source.mailbox` — see the Email and Calendars sections.
- ✅ **Received shares over WebDAV (Nextcloud and friends)** need no feature at all: the
  server mounts them into the account's tree, and the connector migrates whatever the tree
  presents. They arrive as ordinary content.
- ✅ **A folder shared with the account (Drive)** migrates by rooting a **separate mapping**
  at the folder's own id (workplan 0051) — the same parent-scoped, all-drives-guarded
  listing every root uses. The browse (wizard button, `scripts/list-shared-folders.ts`)
  lists these folders beside the shared drives, sharer's address included. "Shared with me"
  itself is a view, not a folder — no walk from My Drive reaches it, which is why the root
  is the mechanism.
- ✅ **A collaborated folder (Box)** needs no feature: Box places a folder you were
  invited to into the account's own tree ("All Files"), so it migrates as ordinary
  content — the WebDAV posture, not the Drive one. Rooting a mapping at its
  `rootFolderId` scopes to just that folder.
- ✅ **A mounted shared folder (Dropbox)** lives in the account's own tree and migrates as
  ordinary content — its path is a valid `rootPath`. The browse (wizard button,
  `scripts/list-dropbox-shared-folders.ts`; optional `sharing.read` scope) lists what the
  account can see; an **unmounted** share is shown path-less — it has no place in the tree
  until the account mounts it in Dropbox itself, which no migration tool should do for it.
- ⛔ **Loose shared files (Drive)** — shared with the account but not inside a folder it can
  root at — are still not enumerated by any pass. A **shortcut** the owner added to My
  Drive surfaces as a per-item refusal in the failures queue (a pointer, not a file) —
  loud, never a silent skip.
- 🚫 **The share itself does not survive the copy, on purpose.** A migrated file is the new
  account's own bytes: the link to the original is severed, later edits flow nowhere, and
  two mappings migrating the same shared item produce two independent copies — one per
  account, exactly like every other item. A migration copies data; it does not re-plumb
  collaboration.
- ✅ **Re-creating a share on the target is now an owner decision, per grant** (ADR-0032,
  accepted; workplan 0052): every inventoried grant is a row on the **Sharing checklist**
  — apply it through the target's own share API (Nextcloud OCS first; the target then
  sends its own invitation, so the invite IS the notification and Ownpace never
  mails third parties), tick it off as done by hand, or skip it deliberately. Applies are
  gated behind cutover, link shares are never auto-recreated, the grantee address is
  confirmed by a person, and every settled row keeps who decided and when. Targets
  without a share API keep their rows as manual steps, said per row.
- 🔁 **The sharing state is inventoried first** (§14.2, workplan 0029): every
  grant in the source's own words (`raw`, verbatim), link-grants flagged apart from
  person-grants (`viaLink` — "anyone with the link can edit" is the one to catch before
  cutover), and rights that *could not be read* named as such — `not_discoverable` is a
  different value from "none found" (hard rule 9). It lands in the Finish screen's
  **permissions handover** document and, since ADR-0032, feeds the Sharing checklist's
  rows — the handover stays the substitute for a full ACL translator, which remains
  deliberately unbuilt. Coverage, honestly, per source: **M365**
  calendar sharing is scanned (application permissions required); OneDrive/SharePoint
  sharing sits behind the deliberately-unconsented `Files.Read.All` flag; mailbox
  delegation can never be read through Graph and is always a stated blind spot. **Google
  Drive** outbound shares on files the account owns are scanned with the Drive scope the
  pass already holds (workplan 0029 T5) — shared-drive membership and Google
  Calendar/Contacts sharing are stated blind spots. Every other source states its blind
  spots rather than omitting the section.

## Everything, by design

These hold across all object types, and are features rather than gaps:

- **The source is never written to** (retracted `bidirectional`/`asymmetric` modes stay
  retracted) and **the target is never overwritten or emptied by the machine**: collisions
  adopt or fail (`onCollision`, no `overwrite` without an ADR), and the ONLY destructive
  operation is `apply` on an individually evidenced deletion or relocation, behind its
  gates, attributed — to a person, or to `system:auto-apply` where a mapping opted in.
- **Accounts, passwords and server settings do not migrate.** Mappings copy data between
  accounts that already exist; provisioning is out of scope on purpose.
- **Both editions behave identically** (hard rule 5): every source and target above works
  the same from a mapping file on the appliance and from the wizard on managed, refusing
  the same mistakes in the same words.

## The open gaps, in one place

| Gap | Status | Where it is tracked |
|---|---|---|
| Gmail / Google Calendar / Google Contacts against real Google endpoints | ⏳ built, unproven | Owner runbook Stages 5–6 |
| Google-native file export (Docs/Sheets/Slides) | ⏳ measurement gates the policy | Stage 1; workplan 0042 T6 |
| JMAP calendar target | 🚫 parked (recurrence round-trip) | workplan 0031 T1 |
| Drive loose shared *files* (shared folders root a mapping since 0051; shortcuts are refused loudly) | ⛔ not enumerated | Shared content section above; workplan 0051 |
| Sharing checklist: live Nextcloud OCS proof (digest counts, report section and confirm-once addresses shipped) | ⏳ rides the owner runbook | ADR-0032; workplan 0052 T6 |
| M365 calendar / contacts / OneDrive sources in the managed WIZARD (today: appliance mapping files only) | ⛔ needs wizard types + connection kinds | workplan 0054 |
| Whole-tenant Google migration (domain-wide delegation, opt-in) | ⏳ built, awaiting first contact with a real Workspace | ADR-0033; workplan 0053 |
| Drive incremental delta (`changes.list`) | ⛔ deliberate cost/correctness trade | workplan 0042 T1 |
| Per-domain throttle limiters (today: one merged limiter per mapping) | ⛔ future work | `DomainConfig.throttleConfig` |
| Sieve rules, signatures, OOF, ACLs, invitation state, version history | 🚫 out of scope, stated per domain above | this document |
