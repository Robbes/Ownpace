# Workplan 0173 — Deleting by hand, on by default

> **In one line:** The owner asks for *Turn on deleting by hand* to go and for deleting by hand to be on from the start, because every delete already asks for a second press; this plan maps where ADR-0024's gate 1 lives, weighs what it still protects, and advises on by default with an off switch kept, for alpha.21.

## Status — 2026-11-25 (update this block at the end of every session)

**2026-11-25: assessed and planned. Nothing built.** No product code, test or ADR is changed by
this plan. §2 maps every place the per-mapping opt-in lives, §3 assesses the impact, §4 weighs
four options, §5 advises **(b) on by default, with the switch kept to turn it off, and the single
press hardened**, size **M**, for **alpha.21** (§8). §6 is the ADR-0024 amendment as a draft, not
applied. §7 lists the tasks as pull requests. §9 holds the owner's questions; T1 to T6 wait for
their answers.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The single press ignores a double click | builder | 📋 Planned | §7. Independent of every answer; small enough for alpha.20 if the owner wants it there (Q5). |
| T1 One rule for the default, both editions | builder | ⏳ Waits on Q1, Q6 | §7. `deletingByHandOn` in shared; the appliance's absent key reads as on; the new guard. |
| T2 Managed: the column's default, existing rows | builder | ⏳ Waits on Q1, Q2 | §7. Ledger migration `0076`, one way. |
| T3 The Deletions page and its words, EN and NL | builder | ⏳ Waits on Q1, Q3 | §7. Panel, warning, refusals, guidance; the owner reads the Dutch. |
| T4 Docs and the ADR amendment | builder | ⏳ Waits on Q1 | §6, §7. ADR-0024, ADR-0030, ADR-0031, arch §11.1, runbooks, quickstart, guides. |
| T5 The terms' words | builder + owner | ⏳ Waits on Q4 | §7. Terms §2, EN and NL; the version number is the owner's. |
| T6 E2E steps | builder | ⏳ Waits on T1, T2 | §7. `e2e.yml`'s fixture, `smoke-managed.sh`'s apply step. |
| T7 The E2E runs | owner | ⏳ Owner | Self-hosted E2E (Postgres and PGlite) and the managed E2E, after T1 to T6 merge. |
| T8 The owner's decisions | owner | ⏳ Owner | §9: Q1 to Q6. |

## 1. The owner's words

2026-11-25, verbatim:

> "Also, i want the manual delete Activation removed and manual delete default active through the
> Delete-page. I want this because one always already has to press each item or bulk twice, so one
> is away of what one is doing. Please reflect on this and assess impact."

Today a migration's *Deletions* page needs **Turn on deleting by hand** before any *Delete it here
too* works. That switch is ADR-0024's gate 1: the per-mapping opt-in
`MappingConfig.allowApplyDeletions` (managed: `mailbox_mapping.allow_apply_deletions`), refused
as `not_enabled`, which also stops a *Delete all of these here too* run.

## 2. Where the opt-in lives

Line numbers are `main` at `32b620a`.

### 2.1 Core: gate 1

| Where | What |
|---|---|
| `packages/core/src/apply-deletion.ts:28-30` | The file's account of gate 1: *"Off unless `allowApplyDeletions` is set, so an appliance nobody configured for it cannot delete at all, however the endpoint is called."* |
| `packages/core/src/apply-deletion.ts:236-243` | `ApplyDeletionDeps.allowApplyDeletions?: boolean`, *"Defaults to FALSE. A destructive capability that is on unless disabled is one somebody gets by accident."* |
| `packages/core/src/apply-deletion.ts:321-330` | Gate 1 in `evaluateApplyDeletion` (the managed route's synchronous check). |
| `packages/core/src/apply-deletion.ts:400-409` | Gate 1 in `applyDeletion`. |
| `packages/core/src/apply-deletion.ts:568` | Gate 1 in `evaluateApplyRelocation`. |
| `packages/core/src/apply-deletion.ts:621-637` | `applyRelocation` *shares* the flag: *"a second switch would mean an owner who opted into the more dangerous operation is refused the safer one"*. |
| `packages/core/src/apply-deletion.ts:790-799` | `notEnabled()`, the one refusal sentence; it tells the reader to set `allowApplyDeletions: true` in a config file. |
| `packages/core/src/apply-deletion.ts:1282-1290` | `autoApplyRelocations` runs every manual gate again per item, gate 1 included. |
| `packages/core/src/domain-sync.ts:984-988` | A comment that names the flag as the apply site's gate (after cutover, no detector runs). |

Every check is written `!== true`: anything but an explicit `true` is off.

### 2.2 Managed: where it is stored, read and changed

| Where | What |
|---|---|
| `packages/ledger/migrations/0004_managed_apply.sql:3-21` | `allow_apply_deletions boolean DEFAULT false NOT NULL`, with the reason. |
| `packages/ledger/migrations/0014_auto_apply_relocations.sql:4-12` | `auto_apply_relocations`, *"DEFAULT FALSE, like allow_apply_deletions beside it"*. |
| `packages/ledger/src/schema-pg.ts:233`, `:238` | Drizzle's `.default(false)` for both. |
| `apps/api/src/routes/migrations/operating-routes.ts:1649-1686` | `POST /:mappingId/deletions/:hash/apply` reads the column and hands it to `evaluateApplyDeletion`. |
| `apps/api/src/routes/migrations/operating-routes.ts:1788-1824` | `POST /:mappingId/moves/:hash/apply`, the same column. |
| `apps/api/src/routes/migrations/operating-routes.ts:1918-1941` | `GET /:mappingId/apply-deletions`, the flag for the page (`source: 'mapping'`). |
| `apps/api/src/routes/migrations/operating-routes.ts:1945-2005` | `PATCH /:mappingId/apply-deletions`, **`requireRole('owner')`** at `:1958`, on and off alike. It writes a log line, **no audit row**. |
| `apps/api/docs/openapi.yaml:4759` | `allowApplyDeletions: { type: boolean }` in the flag's schema. |
| `apps/worker/src/jobs/run-apply-deletion.ts:133-141`, `:177` | The job reads the column afresh at the removal. |
| `apps/worker/src/jobs/run-apply-relocation.ts:125-133`, `:164` | The same for a move. |
| `apps/worker/src/jobs/run-delta-sync.ts:89-106` | Auto-apply of relocations reads both columns at the end of a pass. |

Who may turn it on: the owner only. **Who may press Delete: an owner or an admin** (the apply
routes have no `requireRole`). So today the switch is also the owner's consent before an admin
can delete: `apps/web/src/i18n/strings/organisation.ts:263-272` (EN) and `:470` (NL) say an
admin can do everything an owner can *except turn deleting by hand on or off*, pinned by
`apps/api/src/routes/tenants/a-role-that-promises-less-than-it-allows.unit.test.ts:230-331` and
its web twin `apps/web/src/pages/a-role-that-promises-less-than-it-allows.unit.test.tsx`.

### 2.3 The appliance: the mapping file

| Where | What |
|---|---|
| `packages/shared/src/config.ts:784` | `MappingConfig.allowApplyDeletions?: boolean`. |
| `packages/shared/src/config.ts:789-797` | `autoApplyRelocations` *"Requires `allowApplyDeletions` too"*. |
| `packages/shared/src/config.ts:1508-1511`, `:1530` | Parsed strictly as a boolean when present; **absent stays absent**, read as off. |
| `packages/shared/src/config.ts:1552` | The root of the file **ignores unknown keys**: a key removed from the parser would be ignored silently, `false` included. |
| `packages/orchestration/src/orchestration.ts:889`, `:1618`, `:1684` | The appliance's three call sites pass `config.allowApplyDeletions` as it is. |
| `apps/selfhost/src/index.ts:3258-3265` | `GET …/apply-deletions` answers `allowApplyDeletions: m.config.allowApplyDeletions === true`, `source: 'config'`. |
| `apps/selfhost/src/index.ts:3267-3278` | `PATCH` answers 405 `config_owned`, naming the file. |
| `apps/selfhost/src/index.ts:2174-2178`, `:3322-3330`, `:3385-3389` | Comments that name the opt-in on the apply routes. |

The appliance's apply route (`POST /mappings/{id}/deletions/{hash}/apply`, on the appliance's
own port) needs no second press: **the two presses are the web page's, not the API's.**

### 2.4 Shared contract and prose

| Where | What |
|---|---|
| `packages/shared/src/apply-each-in-turn.ts:34-36`, `:84` | `not_enabled` is one of `RUN_STOPPING_REFUSALS`: turned off mid-run, the run stops. |
| `packages/shared/src/operating-contract.ts:1043-1063` | `ApplyDeletionsFlag`; *"Off is the default in both editions, by migration and by config parsing: a capability that destroys data is opted INTO, never out of."* |
| `packages/shared/src/operating-contract.ts:1065-1094`, `:1103-` | `APPLY_FLAG_WARNING` and `APPLY_FLAG_WARNING_NL`, the warning in front of the switch; ends *"While this is off, nothing can be removed."* |
| `packages/shared/src/operating-contract.ts:1218-1221`, `:1251-1261` | The moves and deletions `apply` descriptions: *"refused unless this mapping has `allowApplyDeletions: true` in its config"*. |
| `packages/shared/src/queue-guidance.ts:66`, `:94` | *"This works only while deleting by hand is on"* / *"Dit kan alleen zolang Handmatig verwijderen aan staat"*. |

### 2.5 The web: the Deletions page

| Where | What |
|---|---|
| `apps/web/src/pages/Deletions.tsx:380-382` | `<ApplyDeletionsPanel>` at the top of each migration's section, *"Gate 1, visible where it bites"*. |
| `apps/web/src/pages/Deletions.tsx:134-146` | `refusedInOurWords`: a `not_enabled` refusal says *press Turn on deleting by hand above* (managed) or *the mapping's file* (appliance). |
| `apps/web/src/pages/Deletions.tsx:450-457` | The single *Delete it here too*, a `DestructiveButton`. |
| `apps/web/src/components/queues/ApplyDeletionsPanel.tsx` (whole file; `:83-200`) | State line, the shared warning before the switch, **Turn on** as arm-then-confirm, **Turn off** as one click; the automatic-removal switch is shown **only while deleting by hand is on** (`:166`). |
| `apps/web/src/components/queues/DeleteAllPanel.tsx:187`, `:211`, `:284`, `:295`, `:359-368` | *Delete all of these here too* is offered only when the flag is on; the refusal and stop sentences for `not_enabled`. |
| `apps/web/src/components/queues/primitives.tsx:262-301` | `ConfirmButton`: first click arms, second click acts, disarms after 5 s or on blur. **No guard against a double click**: a double click arms and confirms. *Delete N* in `DeleteAllPanel` does ignore a double click and any click within 800 ms (ADR-0024, 2026-11-21). |
| `apps/web/src/services/operating-service.ts:504` | `setApplyDeletionsFlag`. |
| `apps/web/src/i18n/strings/confirm.ts:89-110` (EN), `:362-384` (NL) | `applyFlag.*` and `autoApply.*`. |
| `apps/web/src/i18n/strings/queues.ts:145`, `:162`, `:176-182` (EN); `:339`, `:356`, `:368-372` (NL) | `deletions.all.stoppedBy.notEnabled`, `deletions.all.notTried.notEnabled`, `deletions.refused.notEnabled(.turnOn|.config)`. |
| `apps/web/src/i18n/strings/organisation.ts:263-272`, `:470` | `tenants.invite.adminCan` (§2.2). |

The Moves page has no switch of its own: its *apply* rides the Deletions page's.

### 2.6 Tests and guards that pin it

| File | What it pins |
|---|---|
| `packages/core/src/apply-deletion.unit.test.ts` (35 mentions) | Gate 1 for both functions; most cases pass `allowApplyDeletions: true`. |
| `packages/core/src/apply-deletion-evaluate.unit.test.ts`, `apply-relocation.unit.test.ts`, `auto-apply-relocations.unit.test.ts` (auto on, base off refuses every item), `a-delete-all-through-every-gate`, `a-deletion-the-owner-kept`, `a-dropbox-rename-in-a-delete-all-run`, `a-lane-that-runs-with-the-detector-present`, `a-move-applied-after-cutover`, `a-name-the-document-outgrew`, `a-refusal-code-the-page-knows`, `a-rename-the-bytes-could-not-pair`, `an-apply-pressed-after-cutover`, `move-detection`; `a-google-calendar-deletion-is-reported.integration.test.ts` | Pass the flag explicitly. Unchanged if core keeps its rule (§5). |
| `packages/shared/src/config.unit.test.ts:70-90` | Absent parses as `undefined`. **Changes.** |
| `packages/shared/src/operating-contract.unit.test.ts`, `queue-guidance.unit.test.ts`, `apply-each-in-turn.unit.test.ts` | The prose and `RUN_STOPPING_REFUSALS`. Prose tests change. |
| `scripts/a-warning-the-check-keeps.unit.test.ts` | `APPLY_FLAG_WARNING(_NL)` names the data types as the writers treat them. Keeps holding; the text it reads changes. |
| `packages/ledger/src/apply-receipt-schema.unit.test.ts:6`, `:70` | *"DEFAULTS TO FALSE"*. **Changes.** |
| `packages/ledger/src/__tests__/the-marker-column.ts:179`, `a-deletion-the-owner-kept.(unit|integration).test.ts` | Set the column explicitly. |
| `apps/api/src/routes/migrations/apply-routes.integration.test.ts:122-147` | *"gate 1 wins first: the flag DEFAULTS off"*. **Changes**; `:419-430` (turned off → `not_enabled`) stays. |
| `apps/api/src/a-hold-that-holds-every-door.unit.test.ts`, `an-organisation-closed-at-every-door.unit.test.ts` | Name the PATCH door. Stay. |
| `apps/api/src/routes/tenants/a-role-that-promises-less-than-it-allows.unit.test.ts`, web twin | The owner-only door. Stay under (b), change under (a). |
| `apps/selfhost/src/apply-flag.unit.test.ts:59`, `:103-109` | GET reads the file; absent → `false`. **Changes.** |
| `apps/selfhost/src/an-apply-pressed-after-cutover.integration.test.ts`, `packages/orchestration/src/an-apply-pressed-after-cutover-on-the-appliance.unit.test.ts` | Set the key. |
| `apps/web/src/components/queues/ApplyDeletionsPanel.unit.test.tsx` (19), `apps/web/src/pages/Deletions.unit.test.tsx` (11), `a-delete-all-each-decided-by-itself`, `a-delete-all-answered-over-http`, `a-deletion-that-names-the-item`, `components/queues/primitives.unit.test.tsx`, `i18n/i18n.unit.test.tsx` | The panel, the off state, the refusal sentences, the arm-then-confirm. **Change.** |

### 2.7 E2E

| Where | What |
|---|---|
| `.github/workflows/e2e.yml:472-476` | The self-hosted E2E's one fixture that sets `cfg.allowApplyDeletions = true`; *"every other e2e run leaves it unset"*. |
| `test/e2e/selfhost-apply-deletion-{mail,file,calendar}.e2e.test.ts:34-35` | Comments: they need the flag on. |
| `deploy/compose/smoke-managed.sh:3178`, `:3209` | The managed smoke turns the column on by SQL before its apply and **off** after it. Run by `.github/workflows/e2e-managed.yml` (`:309`, `:774`). |

No E2E step asserts the *off* default or presses the switch.

### 2.8 Docs

| Where | What |
|---|---|
| `docs/adr/0024-explicit-owner-deletion-apply.md:17-18` (operative), `:54`, `:76`, `:145`, `:201` | Gate 1; *"A destructive capability must be turned on, never turned off"*; *"for any mapping that has not explicitly opted in"*; the bulk press *"deleting by hand on"*; `not_enabled` stops a run. |
| `docs/adr/0005-*.md:13-18` | *"the one gated exception is ADR-0024's `apply`"*. Unaffected. |
| `docs/adr/0030-relocation-is-positive-evidence.md:16`, `:85` | Gate 1 shared with moves. |
| `docs/adr/0031-auto-apply-relocations.md:16`, `:48`, `:98`, `:114`, `:118` | Auto-apply **extends** `allowApplyDeletions`; default false. |
| `AGENTS.md:114`, hard rule 2 | *"Non-destructive by default. Never auto-delete…; surface source deletions as user decisions."* Stays true under every option: nothing is removed without a person's press. |
| `docs/architecture/solution-architecture.md:233` (§11.1) | Gate (1) in the list of gates. |
| `docs/operator-runbook.md:2103`, `:2128-2146`, `:2202`, `:2366` | *"It has to be turned on per mapping first … Defaults to `false`"*. |
| `docs/owner-test-runbook.md:133`, `:755` | The destructive drills set the key; *"`allowApplyDeletions` stays"* off elsewhere. |
| `docs/selfhost-quickstart.md:532-540` | *"so it is off by default. Add `"allowApplyDeletions": true`"*. |
| `docs/feature-matrix.md:457-458` | *"behind its gates"*; no default named. |
| `docs/guides/{en,nl}/*.md` | **No mention.** |
| `site/pages/en/alpha-guide.md:54-62`, `site/pages/nl/alpha-handleiding.md:84-93` | *"Deletions are off … Choose Turn on deleting by hand, and confirm."* |

### 2.9 Public and legal text

| Where | What it promises |
|---|---|
| `site/legal/terms.md:618-622` (§2) | *"At your target, nothing is deleted either, unless you switch on deleting by hand and approve each deletion. … Both are off by default, until you explicitly turn these features on."* |
| `site/legal/terms.nl.md:68-73` (§2) | The same in Dutch: *"tenzij u handmatig verwijderen aanzet en elke verwijdering goedkeurt … Beide staan standaard uit"*. |
| `site/legal/alpha.md:325`, `alpha.nl.md:129-131` (§8) | An admin can do everything except *turn deleting by hand … on or off*. True under (b); false under (a). |
| `site/legal/README.md:104`, `:679-683` | The terms' row; *"At the target nothing is deleted unless the customer switches on deleting by hand … Both are off until turned on (terms §2)."* |
| `packages/managed/src/legal-versions.ts:72-86` | All three texts at `1.0`; *"no tester has accepted any version yet"* (as last recorded on 2026-11-22). |

The terms are a promise to every tester: **changing the default changes the words of terms §2**,
in both languages. The privacy policy says nothing about the switch.

## 3. Impact

### 3.1 What still stands between a press and a removal

With the switch gone, every removal still passes:

- **Gate 2**, the target can remove (`target_cannot_remove`).
- **Gate 3**, positive evidence only: the old system reported it, or it is in the old system's
  bin. Never an absence, however often repeated. *Assumed* rows offer no button at all.
- **Gate 4**, ownership: only a copy Ownpace wrote; never an *adopted* item.
- **Gate 5**, not edited since: the server's `If-Match` (DAV), a read (JMAP contacts, files),
  UIDVALIDITY (IMAP); no recorded version, no removal. **Mail is not checked for edits.**
- **Gate 6**, the mass-deletion breaker: past a fifth of a data type of 20 placed items or more,
  every apply is refused, and a run stops.
- **Gate 7**, the ledger's conditional UPDATE.
- **After cutover**, nothing (`after_cutover`); **a kept row** is never removed (`already_kept`).
- **Two presses on the page**: *Delete it here too* then *Confirm delete* (single), or
  *Delete all of these here too* then a confirmation naming the count, with *Cancel* focused and
  clicks within 800 ms ignored (many).
- **Ownership of the organisation**: only an owner or admin of the organisation reaches the page.

So the switch adds no check on **which** item may go. Every safety argument in ADR-0024 about
the evidence being wrong is carried by gates 3 to 7, not by gate 1.

### 3.2 What the switch protects against today, and what the double press covers

| Case | The switch today | The double press | Gap without the switch |
|---|---|---|---|
| A careless single delete | The owner chose once, earlier, to allow deletes at all. | Two presses in the same place within 5 s. **A double click passes both** (`primitives.tsx:288-290`). | A double click on *Delete it here too* removes the copy. **Close it (T0).** |
| A careless *Delete all* | Same. | Strong: own confirmation, *Cancel* focused, clicks within 800 ms ignored, count named. Gate 6 bounds one confirmation to a fifth of a data type. | Small. |
| A careless confirm, read in haste | One more deliberate act, with the warning in front of it. | The confirm names the action, not the consequences. The panel's warning (`APPLY_FLAG_WARNING`) is read once, when turning on. | The warning has to move to where the press is (T3). Mail removed even if edited on the target is the sentence most worth keeping. |
| An admin acting in the organisation | **Owner's consent**: an admin cannot turn it on. | An admin presses twice like anyone. | Under (a), an admin can delete without the owner ever agreeing. Under (b) the owner can still turn it off. **Q3.** |
| Someone migrating for another person (grant links) | None: the person who granted access is not in the organisation; the owner turns the switch on. | The same. | None new. The data subject is protected by gates 3 to 7 and by the terms between them and the organisation's owner. |
| A delegated operator (platform support) | None needed: support access is read-only (`apps/api/src/routes/support.ts`). | — | None. |
| A script or API client | **The only consent at the API.** One call is one removal: the API has no confirmation. | Not there: the press is the web page's. | An appliance owner who scripts against the appliance's port, or a managed token holder, can remove with one call. Today they first edit a file or press the switch. Say so in the runbook (T4). |
| A deliberately cautious owner | Leaves it off; nothing can be removed. | — | Under (a) they lose the choice. Under (b) they keep it, turning it off. |

### 3.3 Existing migrations

- **Managed (live and the test environment):** the column is `false` on every mapping nobody
  turned on. Changing the column's default changes **new** rows only. To have existing
  migrations behave as the owner asks, rows must be updated (T2, **Q2**).
- **One way.** The PATCH writes no audit row, so a mapping turned **off by choice** cannot be told
  from one never turned on. An UPDATE to `true` erases that difference for good. The plan
  therefore has the migration write one `audit_log` row per mapping it turns on
  (`actor 'system:migration-0076'`, `action 'apply_flag.default_on'`), so the list is kept and a
  revert is possible by hand. The builder confirms that `audit_log`'s forced row security admits
  the migration's role; if not, the fallback is a one-table record, and the plan says so in its
  pull request.
- **Auto-apply of relocations** stays as it is (`auto_apply_relocations`, default false). With
  deleting by hand on, its switch becomes visible on every page (today it shows only once
  deleting by hand is on, `ApplyDeletionsPanel.tsx:166`). No migration turns it on.
- **Receipts and runs** in flight: none affected; a `not_enabled` receipt stays a past answer.

### 3.4 The appliance

- The key is read from each mapping's file; the appliance has no database copy of it. To be
  **on by default** there, an **absent** key reads as on, and `"allowApplyDeletions": false`
  turns it off. Every appliance that upgrades gains deleting by hand on every mapping that does
  not say `false`. The release notes must say so, in both languages.
- Under (a) the key would be ignored (`config.ts:1552`), and so would a `false` an owner wrote
  to be safe: **silently**. That alone argues against (a) on the appliance.
- The words people read: the panel's *"On this appliance the value lives in the mapping's config
  file"* stays, reworded for the default; the quickstart's *"off by default"* changes.
- Both editions keep the same rule (hard rule 5): the default lives in one shared helper
  (`deletingByHandOn`), read by managed's route and job and by the appliance's orchestration.

## 4. Options

### (a) Remove the opt-in entirely

- **Changes:** gate 1 goes from core (ADR-0024 has six gates); the column is dropped or
  ignored; the PATCH, the GET flag, `ApplyDeletionsFlag.allowApplyDeletions`, the panel and every
  `not_enabled` sentence go; `not_enabled` leaves the closed set and `RUN_STOPPING_REFUSALS`;
  `autoApplyRelocations` no longer *extends* anything (ADR-0031 amended: auto alone suffices);
  the appliance's key is ignored; `tenants.invite.adminCan`, alpha §8 and terms §2 change.
- **Risk:** an admin deletes without the owner's consent; a cautious owner loses the choice; an
  appliance file's `false` is ignored silently; the API's one call becomes the only consent; a
  dropped column is one way. ADR-0031's "extends" argument has to be re-made.
- **Size: L.** Most of §2.6 changes, two ADRs, terms and alpha conditions.
- **Advice: no.** It removes the one thing the owner's reasoning does not replace (the owner's
  consent for admins and the off choice) for no gain the user sees over (b).

### (b) On by default, keeping the switch to turn it off (advised)

- **Changes:** one helper decides the default for both editions; the managed column's default
  becomes `true` and existing rows are turned on with an audit row each (Q2); an absent appliance
  key reads as on. Core is **unchanged**: it still refuses anything but `true`, and callers hand
  it the resolved value. The page no longer opens with a switch: it says, quietly, that deleting
  by hand is on and the owner can turn it off; the warning's facts move beside the delete
  buttons; *Turn on* (two presses) stays for a migration turned off. `not_enabled` stays, with
  its sentences reworded (*turned off for this migration*).
- **Plus, as part of (b):** the single *Delete it here too* ignores a double click and a second
  click within 800 ms of arming, as *Delete N* does (T0), because the double press now carries
  the consent alone.
- **Risk:** low. Every gate stands; the owner's off switch and the admin sentence stay true. The
  data change is one way but recorded. The terms' §2 words change (Q4).
- **Size: M.** About 25 files of code and tests, the docs of §2.8, terms §2.
- **Advice: yes.** It gives the owner exactly what was asked (no activation step, deleting by
  hand active from the page), keeps the editions in step, and keeps an owner's *off*.

### (c) The first confirmed Delete turns it on for that migration

- **Changes:** the apply route writes the flag when the first confirmed press arrives; the page
  says so in the confirmation.
- **Risk:** for the person it is (a) with extra machinery: the press that turns it on is the
  same press that deletes, so it adds no consent the confirmation does not already give. An
  admin's press would either turn on the owner's switch (losing the consent) or be refused
  (keeping today's friction for admins only). **The appliance cannot do it at all**: its flag is
  its file, which no API writes (`index.ts:3267-3278`), so the editions would part (hard rule 5).
- **Size: M**, and a new kind of route (a destructive call that changes configuration).
- **Advice: no.**

### (d) Considered: on by default for owners, the switch as the owner's consent for admins

- **Changes:** gate 1 asks the caller's role: an owner's press needs no switch; an admin's needs
  the owner to have allowed it.
- **Risk:** role-aware gates in core, which today knows no roles; the appliance has no roles;
  the admin sentence becomes harder to say. During the Alpha an organisation should have no
  other member (alpha §8), so the case it solves is rare now.
- **Size: L.** **Advice: not now**; reconsider when organisations with several people are
  common. Q3 asks the owner.

## 5. Advice

**(b), with T0's hardening. Size M. alpha.21.**

1. A default, not a removal. Asked to remove a step, the smallest change that removes it for
   every person is to start it on. The switch survives for the owner who wants it off, and for
   the appliance file that says `false`.
2. Gate 1 keeps its code and its place. Core still refuses anything but `true`; what changes is
   who supplies `true` when nobody chose. That keeps every core test and the run-stopping rule.
3. The double press needs one fix to carry the weight the owner puts on it: a double click must
   not be two presses (T0).
4. The warning that today stands in front of the switch is the clearest statement of what a
   delete does (positive evidence only, ours only, mail not checked for edits). It moves next
   to the delete buttons, so it is read where the decision is made.
5. One way, with a record: existing managed rows are turned on, each with an audit row.

## 6. Draft: the ADR-0024 amendment (not applied)

To be applied by T4. The operative bullet changes in place; the narrative is appended.

**Operative rules, in place** (the second bullet's first gate):

> (1) per-mapping switch, **on unless turned off** (2026-11-25): managed's column defaults to
> `true`; an appliance mapping is on unless its file says `"allowApplyDeletions": false`; one
> helper (`deletingByHandOn`) decides for both editions, and core refuses anything but `true`.
> Guard: `packages/shared/src/deleting-by-hand-on-unless-turned-off.unit.test.ts`.

**Status line:** *amended five times (2026-09-27, 2026-10-05, 2026-11-21, 2026-11-22,
2026-11-25)*.

**Appended section:**

> ## Amendment, 2026-11-25: deleting by hand is on unless turned off
>
> Workplan 0173. The owner, 2026-11-25: *"i want the manual delete Activation removed and manual
> delete default active through the Delete-page. I want this because one always already has to
> press each item or bulk twice, so one is away of what one is doing."*
>
> Gate 1 stays, as a switch to turn **off**. The Decision's *"A destructive capability must be
> turned on, never turned off"* no longer holds for deleting by hand: what makes a removal safe
> is gates 2 to 7, the refusals after cutover and after a keep, and a person's own press, each
> confirmed — none of which gate 1 ever checked. What gate 1 still gives is an owner's choice to
> allow no deleting at all on a migration, which an admin cannot override.
>
> - **The default.** `mailbox_mapping.allow_apply_deletions` defaults to `true` (ledger
>   migration `0076`), and every existing row was turned on there, with an `audit_log` row each
>   (`apply_flag.default_on`), so the mappings that were off are known. On the appliance an
>   absent key reads as on; `false` turns it off. `deletingByHandOn` in `@openmig/shared` is
>   the one place the default is decided; managed's routes and job and the appliance's
>   orchestration read it. Core is unchanged: `!== true` refuses, so a caller that forgets to
>   resolve the default fails closed.
> - **The press carries the consent.** A single *Delete it here too* ignores a double click
>   and any click within 800 ms of arming, as *Delete N* does since 2026-11-21. The facts the
>   warning stated before the switch (positive evidence only, our copies only, mail not checked
>   for edits) are shown beside the delete buttons.
> - **Turning it off** is one press, owner only, as before. Turning it on again is two, owner
>   only. `not_enabled` keeps its code and stops a run as before; its sentence says the owner
>   turned deleting by hand off for this migration.
> - **Unchanged:** `autoApplyRelocations` stays off by default and still extends gate 1
>   (ADR-0031); the API asks no confirmation, so one call is one removal, as the runbook says.
>
> The Consequences' *"`apply` changes nothing about that for any mapping that has not explicitly
> opted in"* reads, from this amendment, *"for any mapping whose owner has turned deleting by hand
> off"*.

**Amendment log entry:**

> - **2026-11-25** — Deleting by hand is on unless turned off: the column defaults to `true` and
>   existing rows were turned on with an audit row each; an absent appliance key reads as on; the
>   single press ignores a double click (workplan 0173). Record: *Amendment, 2026-11-25: deleting
>   by hand is on unless turned off*.

ADR-0031 needs one line in its operative rules (*"extends `allowApplyDeletions`, which is on
unless turned off since ADR-0024's 2026-11-25 amendment"*); ADR-0030 needs none beyond its
*"behind the same switch"*.

## 7. The tasks, as pull requests

Each runs the gates of AGENTS.md; each touched file is first looked up in `docs/LESSONS.md`.

**T0 — The single press ignores a double click.** (S; independent; alpha.20 possible.)
`apps/web/src/components/queues/primitives.tsx` (`ConfirmButton`: ignore the second click of a
double click (`event.detail > 1`) and any click within 800 ms of arming, as `DeleteAllPanel`'s
confirmation does); `primitives.unit.test.tsx` gains both cases, failing before the change. It
also hardens *Turn on* and *create a share*, which use the same button; their tests are run.

**T1 — One rule for the default, both editions.** (S–M.)
`packages/shared/src/config.ts` (doc of `allowApplyDeletions`: absent is on; parser unchanged),
new `deletingByHandOn(value: boolean | undefined): boolean` beside `ApplyDeletionsFlag` in
`packages/shared/src/operating-contract.ts` (and its doc at `:1043-1053`), callers
`packages/orchestration/src/orchestration.ts:889,1618,1684`, `apps/selfhost/src/index.ts:3261`.
Tests: `config.unit.test.ts:70-90` (absent → on through the helper), `apps/selfhost/src/apply-flag.unit.test.ts`
(absent → `true`, `false` → `false`), the two after-cutover appliance tests.
**The new guard,** `packages/shared/src/deleting-by-hand-on-unless-turned-off.unit.test.ts`:
(1) an absent key and `true` are on, `false` is off, through `parseMappingConfig` and
`deletingByHandOn`; (2) the managed default read from the migrations (the last `ALTER … SET
DEFAULT` for `allow_apply_deletions` is `true`) and from `schema-pg.ts`; (3) a scan of `apps/`
and `packages/` (not tests) finding no read of `allowApplyDeletions` or `.allow` from a mapping
compared `=== true` outside the helper and core, so absence is never read as off again; (4)
`ApplyDeletionDeps.allowApplyDeletions` still refused unless `true` in core. It fails today on
(1) and (2).

**T2 — Managed: the column's default and the existing rows.** (S.) Waits on Q2.
`packages/ledger/migrations/0076_deleting_by_hand_on_unless_turned_off.sql`: `ALTER TABLE
mailbox_mapping ALTER COLUMN allow_apply_deletions SET DEFAULT true;` then, per Q2, one
`audit_log` row per mapping that is `false`, then `UPDATE … SET allow_apply_deletions = true
WHERE allow_apply_deletions = false`. `packages/ledger/src/schema-pg.ts:233`. Routes and jobs
read through the helper: `operating-routes.ts:1686,1824,1935,2002`, `run-apply-deletion.ts:141`,
`run-apply-relocation.ts:133`, `run-delta-sync.ts:106` (the column is `NOT NULL`, so the helper
is for the one rule, not for nulls). `openapi.yaml:4759` gains the default in its description.
Tests: `apply-receipt-schema.unit.test.ts` (defaults to true; the migration turned an existing
`false` on and left an audit row), `apply-routes.integration.test.ts:122-147` (a fresh mapping
is not refused `not_enabled`; `:419-430` still refuses once turned off). Migration-lock report
(workplan 0165) read before the merge: an `ALTER … SET DEFAULT` is catalogue-only; the UPDATE
touches every mapping row once.

**T3 — The Deletions page and its words, EN and NL.** (M.) Waits on Q3.
`ApplyDeletionsPanel.tsx`: on → one line, *"Deleting by hand is on for this migration."* with
*Turn off* (owner only on managed; the file on the appliance); off → today's arm-then-confirm
*Turn on*, the warning before it. The automatic-removal switch unchanged, now visible whenever
deleting by hand is on. `Deletions.tsx:134-146` (`not_enabled` now *turned off*),
`DeleteAllPanel.tsx` (sentences only). `APPLY_FLAG_WARNING(_NL)` reworded from *"Turning this on
lets you…"* to what a delete does, shown above the rows that offer one; `queue-guidance.ts:66,94`
(*"unless deleting by hand is turned off for this migration"*). Strings: `confirm.ts:89-110,
362-384`, `queues.ts:145,162,176-182,339,356,368-372`; `organisation.ts` unchanged under (b).
Tests: `ApplyDeletionsPanel.unit.test.tsx`, `Deletions.unit.test.tsx`, the three
`a-delete-all-*`/`a-deletion-that-names-the-item` web tests (mocked flag default),
`operating-contract.unit.test.ts`, `queue-guidance.unit.test.ts`, `i18n.unit.test.tsx`,
`scripts/a-warning-the-check-keeps.unit.test.ts` (run; must stay green on the new text). The
Dutch goes to the owner in the pull request.

**T4 — Docs and the ADR amendment.** (S–M.) §6 applied to ADR-0024, ADR-0031's line, then
`node scripts/adr-operative.mjs --write`; `docs/architecture/solution-architecture.md:233`;
`docs/operator-runbook.md:2103,2128-2146,2202,2366` (on unless `false`; the API asks no
confirmation); `docs/owner-test-runbook.md:133,755` (drills that need it *off* now set `false`);
`docs/selfhost-quickstart.md:532-540`; `site/pages/en/alpha-guide.md:54-62`,
`site/pages/nl/alpha-handleiding.md:84-93`; `apps/web` guide pages if served from these;
`site/legal/README.md:679-683`; `CHANGELOG.md` under alpha.21, saying plainly that existing
migrations and upgraded appliances now have deleting by hand on.

**T5 — The terms' words.** (S, the owner's.) Waits on Q4. `site/legal/terms.md:618-622`,
`terms.nl.md:68-73`, the files' header comments, `site/legal/README.md:104`,
`packages/managed/src/legal-versions.ts` and `ACCEPTED_WORDS` in
`scripts/a-version-the-tester-accepted.unit.test.ts`. Proposed words for the owner:

- **EN.** *At your target, nothing is deleted either, unless you approve it yourself on the
  migration's Deletions page: each deletion, or a list of them after one confirmation that
  names how many. You can turn deleting by hand off for a migration. If you switch on the
  automatic removal of moved files' old copies, the old copy of a file that moved at your source
  is removed at your target after strict checks, without asking you each time. That one is off
  by default, until you explicitly turn it on.*
- **NL.** *Bij uw doel wordt ook niets verwijderd, tenzij u dat zelf goedkeurt op de pagina
  Verwijderingen van de migratie: elke verwijdering, of een lijst ervan na één bevestiging die
  zegt hoeveel. U kunt handmatig verwijderen per migratie uitzetten. Zet u het automatisch
  verwijderen van oude kopieën van inmiddels verplaatste bestanden aan, dan wordt de oude kopie
  van een bestand dat bij uw bron is verplaatst, na strenge controles bij uw doel weggehaald,
  zonder dat we het u elke keer vragen. Dat staat standaard uit, tot u het uitdrukkelijk aanzet.*

Alpha §8 stays true under (b) and is not changed.

**T6 — E2E steps.** (S.) `.github/workflows/e2e.yml:472-476`: the fixture no longer needs
`cfg.allowApplyDeletions = true`; it is removed so the apply gate proves the **default**, and a
comment says so. `test/e2e/selfhost-apply-deletion-*.e2e.test.ts:34-35` comments.
`deploy/compose/smoke-managed.sh:3178,3209`: read `GET …/apply-deletions` first and assert
`allowApplyDeletions: true` on the smoke's fresh mapping (the new managed default, end to end),
drop the `UPDATE … = true`, and restore with `true` instead of `false`; one more step turns it
off through the PATCH as the owner, presses, expects 403 `not_enabled`, and turns it on again.

**Order.** T0 any time. T1 first; T2 and T3 on T1's helper, in parallel; T4 and T5 with or after
T3 (the words must match the page); T6 after T1 and T2. One pull request per task.

## 8. Timing

alpha.20's cut-off is 2026-11-25 16:00 UTC. **The advised option belongs in alpha.21.**

- It changes the default of the product's only destructive path, in both editions, with a data
  change that is one way; ADR-0024's own discipline is a reviewed pull request per step, and a
  green managed E2E and self-hosted E2E (Postgres and PGlite) that only the owner dispatches.
  Planned today, those runs would land against the cut-off.
- Terms §2 must change in the same release as the behaviour, in both languages, on the owner's
  approval, and possibly under a new version number with every tester accepting again (Q4).
  Shipping the behaviour without the words would make the terms untrue on the day of release.
- **T0 alone fits alpha.20 safely**: it is a page-only hardening that is right under every
  option, tested by unit tests, with no data, contract or legal change.

## 9. The owner's questions

1. **Q1 — Which option?** (a) remove the opt-in; **(b) on by default, keep a switch to turn it off
   (advised)**; (c) the first confirmed delete turns it on; (d) on for owners, the switch as the
   owner's consent for admins. Advice (b): it removes the activation step for everyone, keeps an
   owner's *off*, and keeps both editions on one rule.
2. **Q2 — Existing managed migrations that have it off?** **(i) turn all on, with an audit row each
   so the list is kept (advised)**; (ii) leave existing ones as they are, new ones start on; (iii)
   turn all on with no record. Advice (i): it does what was asked for every tester, and the record
   makes the one-way step undoable by hand. (ii) leaves testers meeting the old switch.
3. **Q3 — May an admin delete by hand without the owner's say?** **(i) yes, by default; the owner
   can still turn it off for a migration (advised)**; (ii) no, admins only once the owner allowed
   it (option (d), size L). Advice (i): during the Alpha an organisation should have no other
   member, the double press applies to admins too, and the off switch stays owner-only.
4. **Q4 — Has any tester accepted the terms 1.0 yet?** (i) **no** → terms §2 is edited in place
   under 1.0 with the words in T5, on your approval of EN and NL (advised, if true); (ii) **yes** →
   the terms become 1.1 and every tester accepts again before using the Alpha further. The last
   record (2026-11-22) says no tester had accepted.
5. **Q5 — When?** **(i) alpha.21 for T1 to T6, and T0 in alpha.20 (advised)**; (ii) all in
   alpha.21; (iii) all in alpha.20, waiving the waits. Advice (i): §8.
6. **Q6 — The appliance: on by default too?** **(i) yes, an absent key reads as on, `false` turns
   it off (advised)**; (ii) no, the appliance stays off until its file says `true`. Advice (i):
   one rule for both editions (hard rule 5), and the appliance's page has the same two presses.
   Its release notes say plainly that upgraded appliances gain it.
