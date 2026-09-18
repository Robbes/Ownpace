# Workplan 0123 — A checklist you can work through

## Status — 2026-09-18 (update this block at the end of every session)

**2026-09-18, last: the measurement came back, and it picks §5's SECOND design — plus the
instrument was overstating what it had measured.** Rob ran
`scripts/drive-share-inheritance.ts` against his own Drive (folder "Foto shoot Emma", 10
children). Drive answered, so this is not a refusal and not an absence. But the answer is
narrower than the old two-way verdict could express:

```
  inline: 0/10     permissions.list: 10/10     with inheritedFrom: 0/10
```

`permissionDetails` comes back, carrying `inherited` as a boolean (`inherited=true, inherited=true,
inherited=false` on every child). **`inheritedFrom` never came back** — on any of the thirty
detail entries — though `DETAIL_FIELDS` names it explicitly. So Drive will say a grant *is*
handed down and will not say *what from*.

That matters because §5's first design is "group children under the folder **they inherit
from**". The field naming that folder is the one Drive withheld. The first design is therefore
**not open**, and the old `inheritanceVerdict` said it was — it returned `reported` on
`permissionDetails` being present, never checking whether the grouping KEY had come back. It
recommended a design whose key it had just watched Drive decline to supply, in the same breath as
reporting the fact. Fixed: the verdict is now four-way, `reported-without-source` is its own
answer, and a mutation collapsing it back into `reported` goes red.

**The second finding is the cost, and it points the same way.** `inline: 0/10` means the details
are on `permissions.list` only — **one request per item**. On the owner's 482 rows that is 482
extra Drive calls per scan, against the 0090 byte-and-request budget. `parents` rides along on the
`files.list` the scan already makes, for nothing (`listOrphanedFiles` asks for exactly that field
today). So the fallback is both the design the data allows and the cheaper one.

**T4's design is settled: group by `parents`, compare grant sets, list deviations separately.**
`inherited` stays worth reading as CONFIRMATION of a grouping made on parents — never as the
grouping itself. What is owed is the build.

**One thing the transcript settles in passing:** every child carried a permission with
`inherited=false` — its own owner row. So "has a non-inherited permission" must never be read as
"is directly shared"; the owner is not a share, which `listOwnedShareGrants` already knows
(`p.role !== 'owner'`) and the grouping must keep knowing.

**2026-09-18, last: T4's measurement is now one command away, and nothing about the design has
been decided.** §5 says the My Drive inheritance behaviour *"must be checked against the live API
(the owner's account, read-only) rather than assumed"*, and that is still true — reading Google's
shared-drive documentation and inferring the My Drive answer is exactly the assuming it forbids.
So what is built is the **instrument**, not the answer: `scripts/drive-share-inheritance.ts`, in
the tier and the shape `drive-export-stability.ts` established, sharing its credential resolver so
a Drive already measured for export stability needs nothing new set.

It reads metadata only, under `drive.readonly`, and it answers in §5's own vocabulary so the
output can be pasted straight into this file.

**It distinguishes THREE outcomes, not two,** and the third is the one a two-way script would have
got wrong. Hard rule 9: `permissionDetails` coming back empty and the request being REFUSED for
naming it mean opposite things — the first is an answer that picks §5's fallback design, the
second is our own bug and picks nothing. `inheritanceVerdict` in `drive-share-grouping.ts` holds
that apart, and a mutation that reads a refusal as an absence goes red.

**Addresses never reach the transcript.** The output is meant to be pasted into a workplan, and
"is this grant inherited" is answered by none of the grantees' mail addresses. Each becomes a
stable per-run pseudonym, so grant SETS stay comparable by eye and nobody's colleagues end up in
a public repository. Guarded, and the guard goes red if the pseudonymiser lets one through.

**The fallback's comparison rule is built and tested even though the design is not chosen**,
because it is the same rule either way: a child deviates if its grants differ from its folder's in
EITHER direction, role included. A missing grant is as much a deviation as an extra one — "this
file inside a shared folder is not actually shared with everyone the folder is" is precisely the
finding §5 says must never be folded into the folder's row — and comparing grantees without roles
would hide a file somebody can write to inside a folder they can only read.

**What is owed: Rob runs it and pastes the verdict here.** Until then T4 stays open and the design
stays unchosen.

**2026-09-18, later: T1, T2 and T3 built.** T2 turned out sharper than §3 first stated, and the
correction is the finding: the Markdown permission report has ALWAYS named mailbox delegation —
`run-permission-inventory.ts` calls that "THE ONE RULE THIS FILE ENFORCES ON ITS OWN" and emits
the section whatever a caller passes. The **sharing checklist** takes two scans and had no such
rule, so the same product answered the same question two ways: honest in the report, silent on
the screen. `refreshShareGrants` now carries the rule too. Found while building it: a Google
tenant was being handed `Get-MailboxPermission` — Exchange Online PowerShell that will never run
against a Gmail account — so the sentence is now per source. T4 is untouched and still needs the
API check in §5.

**2026-09-18: opened.** The owner ran the Sharing page against his live Google account for the
first time after [#998](https://github.com/Robbes/Ownpace/pull/998) made the scan reach a
Connect-with-Google connection at all, and sent four findings from one screenshot. Three are
defects in what the page says; one is a design gap that decides whether the page is usable at
his scale.

His numbers are the frame: **`0 / 482 settled`**. A checklist with 482 rows is not a checklist,
it is a wall — and most of those rows are one shared folder counted once per file inside it.

| Task | Status | Notes |
|---|---|---|
| T1 The press stops looking like a delete | ✅ Done — §2 | `ConfirmButton` splits the arming from the dressing; `DestructiveButton` stays as the destructive preset, so every caller that really destroys reads as it did. |
| T2 The banner names every class nobody looked at | ✅ Done — §3 | `refreshShareGrants` now enforces the delegation section the way the report does, and the sentence is worded for the tenant's own source. |
| T3 Done and Skip say what they mean | ✅ Done — §4 | The distinction is in `sharing.intro.more` and in a title on each button. |
| T4 A folder is one row, not two hundred | ⬜ **measured; design settled, build owed** | Measured 2026-09-18 on the owner's Drive: `permissionDetails` yes (10/10 via `permissions.list`, 0/10 inline), `inheritedFrom` **no** (0/10). Drive says a grant is inherited, not what from — so §5's **fallback** is the design: group by `parents`, compare grant sets, deviations listed separately. Also the cheaper one (`parents` is free on the existing listing; the details cost one request per item). |

## 1. What the owner saw

Four findings, in his words:

> *"I see we do not yet support emailbox-sharing?"*
>
> *"Why is the button 'Create share on new system' not named 'Apply share on target'? And why
> is it red and has a trashcan icon on it?"*
>
> *"a link-share with anyone that holds the link can access: i guess we cant mirror that […]
> What then is the difference for the user between 'Mark done' and 'Skip'?"*
>
> *"More fundamental, i find it not very userfriendly to apply share-links for each seperate
> object, while probably whole folders are shared with users. Can we not recognise shared
> folders, and offer to apply the share in target on the target's folder instead of individuel
> items? Is there a way to recognize inheritance and a deviation from the folder-inheritance?"*

## 2. T1 — the press stops looking like a delete

`Sharing.tsx:156` reaches for `DestructiveButton`
(`apps/web/src/components/queues/primitives.tsx:175`), which hardcodes both halves of "this
removes something":

```tsx
armed
  ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
  : 'border-red-300 text-red-700 hover:bg-red-50'
…
{pending ? <Loader2 … /> : <Trash2 className="w-3 h-3" />}
```

**The arming is correct and stays.** Pressing this creates a share *and* the new system emails
a real person; that is outward-facing and cannot be unsent, which is exactly what a two-press
confirm is for. What is wrong is that the control says *delete* — in colour and in icon — for
an action that creates access.

So the component splits: the arming behaviour is the reusable part, the red-and-trash dressing
is one caller's. A `ConfirmButton` carrying `tone` and `icon`, with `DestructiveButton` kept as
the destructive preset so `Deletions.tsx`, `Moves.tsx` and `ApplyDeletionsPanel.tsx` are
untouched.

The words are the owner's, with one edit he approved: he proposed *"Apply share on target"*;
`target` is our word, and this page speaks to somebody who does not have it, so the string is
**"Apply Share on the new system"**.

## 3. T2 — the checklist says what nobody looked at

`packages/shared/src/permissions.ts:22` declares what a right can be held over:

```ts
export type PermissionSubject = 'mailbox' | 'calendar' | 'drive_item';
```

And the module's own header states the rule the page exists to keep:

> *An inventory that came back empty because nobody could look reads exactly like one that came
> back empty because there was nothing to find — and the first is the dangerous one, so they
> are different values (hard rule 9).*

Grep for what is actually produced:

| Emitted | Where |
|---|---|
| `calendar` | `graph-permissions.ts:140` |
| `drive_item` | `graph-permissions.ts:193,205`, `google-drive-source.ts:745`, `nextcloud-share-scan.ts:106` |
| `mailbox` | **nowhere** |

So Gmail delegation, SendAs and Microsoft `FullAccess` are uninventoried on every provider.

**And the product already knew.** `run-permission-inventory.ts` opens by calling this its one
non-negotiable:

> *THE ONE RULE THIS FILE ENFORCES ON ITS OWN: the mailbox-delegation section is always
> present. It is not a dep, not optional and not conditional on anything a caller passes […]
> the way that sentence would get lost is exactly the way sections normally get lost: a caller
> that forgot to add one.*

The Markdown report has honoured that since 0029 T1. The **checklist** never did:
`refreshShareGrants` accumulates blind spots from whatever `scans` it is handed, and both
editions hand it two — `[scans.scanCalendars, scans.scanDrive]`. A caller that forgot, exactly
as predicted, on the other surface. One product, one question, two answers.

So the rule moves to where it cannot be forgotten again: `delegationReason` is a **required**
dep of `refreshShareGrants` and is pushed into `blindSpots` before any scan runs. A checklist
whose scans all succeed — the owner's case, and the one where the silence is most convincing —
now still says that mailbox delegation was not looked at.

**Found while building it: the wrong errand, again.** `mailboxDelegations()` returns an
Exchange-worded remedy naming `Get-MailboxPermission` and `Get-RecipientPermission`. Those are
Exchange Online PowerShell and will never run against a Gmail account, so a Google tenant
following them learns nothing and reasonably concludes the tool is broken. Two branches in this
codebase already dodge precisely this for calendars ("*A Google tenant would otherwise get a
Graph-worded reason about an app registration it never had — a wrong errand*"), and the
delegation sentence walked straight into it. `googleMailboxDelegationNotRead()` is its pair, and
the per-source choice is made once in the scans object so the report and the checklist cannot
drift apart.

It claims only what is true: *not read by this tool*, not *cannot be read*. Gmail does expose
delegation and send-as to some callers; we do not read them. Pinned, because a later slice that
adds the scan would otherwise leave a lie in the file.

Building the mailbox scan itself is **not in this plan** — see §7.

## 4. T3 — Done and Skip say what they mean

`packages/ledger/src/ledger.ts:799` stores three states:

```ts
decision: { readonly state: 'open' | 'done' | 'skipped'; readonly decidedBy: string }
```

Both buttons settle a row and both remove it from `0 / 482`. The distinction they record is
real and it is the point of keeping the list at all:

- **Done** — this access was re-established, by hand, on the new system.
- **Skip** — this access is deliberately **not** being carried across.

After a cutover, "we rebuilt it" and "we decided to drop it" are different answers to *why can
Anna no longer open this*. The screen says neither. `sharing.intro.more` gets the distinction,
and each button a title that states its half.

This also answers the owner's link-share question directly: for a `viaLink` row there is
nothing to mirror — a link on the new system is a different URL — so the row is `manual` by
construction, and Done/Skip is the only decision available. The row already says *"decide
whether this link should exist at all after the move"*; what it does not say is that Skip is
how you record "no, it should not".

## 5. T4 — a folder is one row, not two hundred

`google-drive-source.ts:685` asks Drive:

```ts
const q = `'me' in owners and trashed=false`;
const fields =
  'nextPageToken,files(id,name,shared,permissions(id,type,role,emailAddress,domain,displayName,allowFileDiscovery))';
```

Two consequences, and the second is the owner's 482:

1. No `mimeType` filter, so **folders are already listed** — a shared folder is its own row.
2. Drive populates `permissions` on every child of a shared folder too. So one folder shared
   with one person yields a row for the folder **and** a row per file beneath it.

And we cannot currently collapse them, because we do not ask for the fields that would let us:
no `parents`, and nothing from `permissionDetails`. Today an inherited grant and a direct one
are indistinguishable in what we hold.

**The verification is DONE — 2026-09-18, on the owner's own Drive.** It was the task's first
step, and it changed the answer, so it is recorded here rather than summarised. The instrument is
`scripts/drive-share-inheritance.ts` (read-only, `drive.readonly`, no grantee addresses in its
output):

```
pnpm exec tsx scripts/drive-share-inheritance.ts
```

Same environment as `drive-export-stability.ts`; optionally `DRIVE_SHARE_FOLDER_ID` to name a
folder rather than let it find one, and `DRIVE_SHARE_CHILDREN` to cap how many children it reads
(default 10 — the answer needs a handful, and a whole folder is somebody's quota).

**What it measured** (folder "Foto shoot Emma", 10 children, grantees pseudonymised):

```
  inline: 0/10     permissions.list: 10/10     with inheritedFrom: 0/10

  - "IMG20230122103618.jpg"
      grants          person-1:writer, person-2:owner
      same as folder  yes
      inline details  absent
      permissions.list inherited=true, inherited=true, inherited=false
```

Three facts, and each one moves the design:

1. **`permissionDetails` IS returned for My Drive items** — so this is neither an absence nor a
   refusal. Drive knows about inheritance here and will talk about it.
2. **`inheritedFrom` is NOT returned.** Zero of thirty detail entries carried it, though the
   request names it. Drive will say a grant *is* handed down; it will not say *what from*.
3. **The details are on `permissions.list` only, never inline.** `files.list` returned
   `permissionDetails` on 0/10, so reading `inherited` at all costs **one request per item** —
   482 extra Drive calls on the owner's Drive, per scan, against the 0090 budget.

**So the design is the second one, and fact 2 is why.** "Group children under the folder they
inherit from" needs the folder's identity, which is exactly what Drive withheld. Fact 3 says the
same thing from the cost side: `parents` rides along on the `files.list` the scan already makes,
for nothing — `listOrphanedFiles` asks for that very field today — so the fallback is also the
cheaper design rather than a consolation.

- **CHOSEN — group by `parents`, compare grant sets.** A child whose grants match its parent's
  exactly is presumed inherited and folds into the folder's row; anything else is a deviation.
- **NOT AVAILABLE — group by reported inheritance.** Needs `inheritedFrom`; measured absent.
  `inherited` remains worth reading as *confirmation* of a grouping made on parents, if a later
  task wants to pay the per-item request for it. It is never the grouping itself.

**And one thing the transcript settles in passing:** every child carried a permission with
`inherited=false` — its own owner row. "Carries a direct grant" must therefore never be read as
"is directly shared". `listOwnedShareGrants` already drops `p.role !== 'owner'`; the grouping has
to keep doing it, or every file in a shared folder becomes its own deviation.

The owner's second question keeps its first-class answer, and the chosen design is the one that
has to carry it: **deviations are listed separately**, never folded into the folder's row. A file inside a shared folder that carries a
grant the folder does not — or is missing one the folder has — is precisely the finding somebody
needs before a cutover, and a grouping that hid it would be worse than the wall of 482.

The cap stays a cap. `maxSharedItems` counts *items*, and a hit still answers
`not_discoverable` rather than a short list dressed as a whole one; grouping changes what is
rendered, never what "I could not see all of it" means.

## 6. Gates

Standard: `pnpm lint`, `SKIP_STALWART=true SKIP_NEXTCLOUD=true pnpm test`, then `pnpm typecheck`
**last** — vitest strips types, so a typecheck run before the final file is written has not run.

Every guard proved by breaking the code it guards. For T4 specifically that means a fixture with
a folder, inherited children, and one deviating child — the grouping must fail loudly if the
deviation is swallowed.

## 7. Not in this plan

- **The mailbox sharing scan.** T2 makes the gap *visible*; reading Gmail delegation and
  Microsoft `FullAccess` is its own work with its own scopes, and naming it honestly is worth
  more today than half of it.
- **Mirroring a link share.** A sharing link cannot be carried across; the row is manual by
  design (§4) and that is the decided position, not a gap.
- **Shared drives.** `listOwnedShareGrants` speaks only for files the account owns, and its
  header says so. A shared drive's membership is drive-level and remains a documented blind
  spot — which, after T2, the banner will say out loud.
