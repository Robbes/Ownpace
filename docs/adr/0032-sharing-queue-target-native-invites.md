# ADR-0032: The sharing queue — re-sharing on the target as an owner decision, invites through the target's own messaging

- **Status:** Accepted (owner decision, 2026-08-16 — "yes, accepted") — first slice built
  the same day, with the owner's own addition: **every manual step is a trackable
  checklist row**, not only the applicable ones (workplan 0052)
- **Date:** 2026-08-16
- **Deciders:** owner
- **Relates to:** workplan 0029 (the permission inventory — §14.2's read half; this is the
  deferred write half, revisited), ADR-0024 (`apply` — one destructive path, per item, per
  decision; this ADR borrows its shape for a non-destructive act with an audience),
  workplan 0027 (Pattern D: definitions discovered, a person executes), ADR-0030/0031
  (the queue-and-gates idiom this reuses). Arch doc §14.2.

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- Grants are **rows** (`share_grant`) with verbatim source evidence; applying a share is a **per-grant owner decision** (apply/skip/edit) — never a pass side-effect; bulk is a loop over the same gated per-row apply.
- **Nextcloud OCS is the only apply-capable target**; every other row stays manual with the protocol gap named. Link shares are **never auto-recreated**.
- The **target's own messaging notifies the grantee** — open-migrate never emails third parties, ever. Apply is refused until the mapping's lifecycle says done/cutover.
- Grantee addresses are proposed by the machine and **confirmed by a person**; attribution names the decider.

## Context

The inventory half of §14.2 exists: every grant on the source, in the source's own words,
link-shares flagged, blind spots stated — rendered into the permissions handover the owner
works through by hand. Workplan 0029 deferred the write half ("apply where safe") until the
report proved there was something worth applying. The Google Drive scan (0029 T5) closes
the last read gap for the first Drive customer, so the revisit trigger has fired: an owner
holding a handover document listing forty grants is now doing forty manual steps on the
target, each a chance to mistype an address or skip a row.

And there is a second half to the problem the handover cannot solve at all: **the people
on the other end of those grants.** A migration moves Anna's files; the colleagues she
shared them with wake up with dead links and no idea where the content went. Telling them
is today entirely the owner's problem, by hand, with no tooling.

## The question

May open-migrate **recreate a share on the target** — and if so, who says so, when does it
happen, and **who tells the person on the receiving end**?

## Decision (proposed)

### 1. A sharing queue, in the image of the existing queues

Grants stop being only a rendered document and become **rows**: the inventory scan writes
`PermissionGrant`s to a `share_grant` table (per mapping, per item, per grantee — the
grant's `raw` kept verbatim as evidence). The operating UI gains a **Sharing** queue beside
Moves / Deletions / Failures: each row shows what was shared, with whom, at what level, in
the source's words. Nothing about storing them changes the read-only promise — a stored
row is still only a fact.

### 2. Applying a share is an owner decision, per grant — never a pass side-effect

The house rule extended one step: relocations and deletions are destructive and gated;
**a share is outward-facing** — it grants a person access and (see §4) *messages* them —
so it gets the same per-item ceremony even though nothing is destroyed. Owner actions per
row: **apply** (create the share on the target), **skip** (recorded, so the closing report
can say "deliberately not carried over"), or **edit-then-apply** (change the grantee
address or level first). A bulk "apply all clean rows" button may exist, but it is a loop
over the same gated per-row apply with one attribution per row — never a different code
path (the ADR-0031 lesson).

### 3. What "apply" does, per target

Only targets with a real share API get the action:

- **Nextcloud (the WebDAV file target):** OCS Share API
  (`POST /ocs/v2.php/apps/files_sharing/api/v1/shares`) — user shares, group shares, and
  link shares with optional password/expiry. This is the tractable, first target.
- **CalDAV / CardDAV / JMAP / plain WebDAV without OCS:** no portable share verb. Rows for
  these targets stay **manual**, rendered exactly as the handover does today — the queue
  refuses `apply` with the reason naming the protocol gap, verbatim.

`mapGrant`'s verdicts (0029 T2) gate the button: a `clean` grant is applicable; a `manual`
one (FullAccess, Send-As, and — see below — sharing links) never gets an enabled apply
button, only guidance.

### 4. The invite IS the notification — the target's own messaging does the telling

This is the core of the proposal, and the answer to "how do we help users message the
people affected". **When a share is applied through the target's API, the target itself
notifies the grantee** — Nextcloud sends its own share notification (in-app + email, per
that server's configuration) exactly as if a person had shared the file in its UI. That is
deliberately the preferred channel, for four reasons:

- The message comes **from the platform the person will actually use**, in its branding
  and language, carrying a **working link** to the content in its new home — not a
  hand-written email pointing at a URL somebody may mistype.
- It arrives **only when the share is real**: notification and access cannot disagree,
  because they are the same act. No "you've been invited" mail before the grant exists, no
  grant nobody was told about.
- open-migrate **never emails third parties itself**. The digest mails the owner; grantees
  are reached only through the target platform's own machinery, triggered by an
  owner-decided apply. This tool holding its own list of other people's addresses and
  mailing them is a line this ADR proposes never to cross.
- Deliverability and consent are the platform's, already configured by its admin.

Where the target's API offers a notify flag, the apply carries an owner choice
(default **on** — the invite is the point); where it does not, the platform's default
behaviour is stated on the queue row before the owner presses apply, in the target's own
terms.

### 5. Timing: shares apply at or after cutover, gated

An invite is an announcement that the new system is live. A share applied mid-migration
mails a colleague a link into a half-filled target — the wrong announcement, at the wrong
time, from the right channel. So `apply` on a share row is **refused until the mapping's
lifecycle says done/cutover** (same gate the completion report derives its verdict from),
with the refusal naming the gate. The intended flow: copy everything → cut over → work the
sharing queue → the invites land in inboxes as the new system's first act.

### 6. Grantee addresses: mapped by proposal, confirmed by a person

`anna@old-domain.nl` is usually `anna@new-domain.nl` — but "usually" is not a rule the
machine may act on. The queue proposes a candidate mapping (same local part, the mapping's
target domain) **rendered as a suggestion the owner confirms or edits per grantee**, once
— confirmed pairs apply to that grantee's other rows. An address with no confident
candidate proposes nothing. This is Pattern D's shape again: discovery automated,
judgment human.

### 7. Sharing links are never auto-recreated

A link grant has no addressable audience: recreating it re-opens access to an unknown set
of people, and no platform can notify "whoever had the old link". Link rows stay `manual`
with guidance (0029 T2 already says why); if the owner creates a new link on the target,
the queue row records that decision and the NEW link, so the closing report can carry it —
distributing it remains a human act.

### 8. What lands in the record

Every applied share writes an audit row (`system:sharing-queue` acts only ever on behalf
of a named owner decision — attribution names the decider, ADR-0031's idiom), lands on
the completion report as an "access carried over" section (applied / skipped / manual
remaining), and the digest narrates counts, never addresses.

## Consequences

- Two new surfaces (table + queue), one new connector capability (OCS shares), and a
  lifecycle gate — meaningfully more machinery than the handover document. The trade is
  forty error-prone manual steps against one reviewed queue.
- The tool gains its first **outward-facing** apply. The containment is §2 (per-grant
  owner decision), §5 (timing gate), §4 (no self-authored mail to third parties, ever).
- Nextcloud-first leaves every other target manual — the queue must say so per row rather
  than looking broken.
- The share_grant snapshot can go stale against the source; rows carry their scan
  timestamp and the queue offers re-scan (mirroring how the report is derived fresh
  today).

## What acceptance would build (first slice)

1. `share_grant` table + scan-to-rows (both editions), queue UI with verbatim evidence.
2. Nextcloud OCS share creation in the WebDAV target connector, capability-probed.
3. The lifecycle gate, the per-row apply/skip/edit with attribution, audit + report +
   digest wiring.
4. Grantee address proposal/confirm flow.

## Build record (2026-08-16, workplan 0052)

Built as accepted, with the checklist framing the owner added: migration 0016
(`share_grant`, decisions surviving rescans by `grant_hash` identity), the ledger port
trio (`upsertShareGrants` / `listShareGrants` / `decideShareGrant` — only an open row
settles, every settled row keeps who and when), `share-queue.ts` in core (refresh /
apply / mark, every gate of §§2–7 answering with its own sentence), the Nextcloud OCS
client (origin-rooted endpoint, envelope-trusted answers, refusals verbatim), the three
routes in both editions behind the parity and OpenAPI drift locks, and the Sharing
checklist screen (progress line, per-row apply with editable owner-confirmed address /
done-by-hand / skip, blind spots listed verbatim as the checklist items the tool cannot
enumerate). Deferred within the decision, recorded in workplan 0052: the digest's
sharing counts, the completion report's "access carried over" section, the
confirm-once-apply-to-all-rows address flow, and a real-Nextcloud integration proof.

## What this ADR does not decide

Group shares (needs the target's group model — Pattern D covers discovery), DAV ACLs
(`setacl` support is too uneven to promise), any Google-as-target sharing (Google is never
a target), and any automated re-pointing of the SOURCE's shares (the source is never
written, rule 2 — the old links die when the source is retired, which is the cutover
announcement's job to say).
