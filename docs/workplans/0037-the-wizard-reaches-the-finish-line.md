# Workplan 0037 — The wizard reaches the finish line

## Status — 2026-08-10 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The wizard can be completed at all | ✅ Done 2026-08-09 (pulled forward into 0033 T3) | Step gates check only fields their step renders; usernames gate on the credentials step. `CreateMapping.unit.test.tsx` walks all six steps filling only visible fields and reaches submit — fails on the old gates at the first click. |
| T2 A paused mapping can be green-lit after the wizard is gone | ✅ Done 2026-08-10 | `/mappings/:mappingId/confirm` is a real route (ManagedOnly — the appliance's own `/confirm` is where it redirects there); the wizard NAVIGATES on create success instead of swapping component state; a paused Mappings row renders "Review and start" linking there instead of the 409-destined Play. `ConfirmMapping.unit.test.tsx` pins the route renders ConfirmMigration from the URL param; `Mappings.unit.test.tsx` pins the link and the absence of Play on paused rows; `AppRoutes.unit.test.tsx` pins both editions' route behaviour. |
| T3 Field-level honesty: validation, credentials, the closing note | ✅ Done 2026-08-10 | Required markers on gating fields; a `role="status"` line beside a disabled Next names what is missing (`wizard.missing.*`); ports are kept as the typed string and validated where the gate can name them (the NaN trap is gone, pinned by the cleared-port test). Credential inputs carry `autocomplete="username"`/`"new-password"`, a show/hide toggle, and the `wizard.credentials.storage` sentence (true per `SecretStore.encryptCredentials` + GET masking). `wizard.review.note` now states the 0013 truth: created paused, explicit start, nothing copied until then — the may-take-some-time claim is pinned absent. All strings bilingual. |
| T4 Choices that cannot work are refused, not stored | ✅ Done 2026-08-10 | Shared matrix `TARGET_TYPE_DOMAINS` + `targetDomainRefusal` (packages/shared/src/target-domains.ts) mirrors the engines (jmap = email/contact/file — no calendar, 0031 T1 parked); the wizard disables unreachable data types (selected-but-incompatible stays deselectable) and the create API refuses the combination via `CreateMappingSchema.superRefine`, naming both sides, with the sentence in the 400 `message` where `serverMessage()` renders it. Cron: conservative shared validator `describeCronScheduleProblem` (subset of croner's grammar; containment pinned by `apps/worker/src/cron-schedule-parity.unit.test.ts` against the tick's own croner version); wizard validates live and echoes the next three firings via the same pinned croner; server refuses garbage naming the silent 15-minute fallback it prevents. Contract tests: `create-coherence.unit.test.ts` (schema) + wire-level 400s in `create-mapping.integration.test.ts` (whose own payload was the jmap+calendar incoherence — now email+contact). Appliance create path needs no twin: an unsupported pairing throws in the per-domain factories and an invalid cron throws in croner at startup — both already loud. |
| T5 Small keeps: dead Delete, lost state, step naming | ✅ Done 2026-08-10 | Delete is wired through name-the-mapping arming (type the exact name to enable; refusal renders the server's words; row survives a failed delete) — tested both ways. Dirty wizard: `beforeunload` arms only while dirty, and Cancel asks via `confirm` (a full in-app navigation blocker needs a data router this app does not use — recorded, not silently skipped). Step 3 is labeled "Name & credentials" in both languages, matching what it renders and gates. |
| T6 Per-source-type credentials (owner scoping) | ⬜ Owner decision (interim honesty ✅ 2026-08-10) | Interim landed: selecting oauth2/graph renders `wizard.source.credsOnly` stating the wizard collects only username+password used to sign in directly, and that token/tenant/app-registration details cannot be entered yet — no source type collects fields it cannot use without saying so on screen. The owner question (what the o365 connector should collect per source type; row-14 consent runbook) remains queued below. |

## Why this exists

The 2026-08-09 review fleet walked the managed CreateMapping wizard
end-to-end as a first-time tenant admin — the deep pass the hand review
skimmed — and found it **cannot currently be completed at all**, and that
even when it can, the success path strands its own product. Every finding
below was independently verified by an adversarial second agent. The managed
first-run journey is: Login → Dashboard → this wizard → ConfirmMigration →
operating screens; today it dead-ends at step 1.

The chain, in journey order:

1. **Hard block at step 1** (`CreateMapping.tsx:151-168`): `canProceed()` for
   the source step requires `formData.sourceUsername` — an input that renders
   only on step 3 (credentials). Same for the target step. Next is disabled
   forever, with no message, on the first screen.
2. **Success looks like failure** (with 0033 T1's create-response fix this
   moves there; recorded here for the journey): the 201 body fails
   `MappingSchema.parse`, `onSuccess` never runs, ConfirmMigration never
   appears, and a retry click creates a full duplicate chain.
3. **The confirm half is one refresh from unreachable**: ConfirmMigration
   lives only in CreateMapping's in-memory post-create state
   (`CreateMapping.tsx:570-576`); no route reaches it. A refresh strands the
   paused mapping permanently — the only visible affordance is the Mappings
   Play button, whose `triggerSync` gets a 409 telling the operator to
   `POST /start`, which no screen can do (and the catch is `console.error`).
4. **The wizard's last words are false**: the review step's closing note says
   the initial sync "may take some time" — but mappings deliberately land
   PAUSED (0013 T5) and nothing syncs until the explicit green light. An
   admin who navigates away believing migration is underway leaves it paused
   forever.

## Guardrails

- **The two-step create-then-confirm stays exactly as heavy as it is**
  (0013 T5/T6; hard rule 2's spirit). Nothing here streamlines the green
  light — T2 makes it *reachable*, not lighter.
- **ADR-0026:** the coherence check (T4) is a shared-contract fix — client
  constrains, server refuses with prose rendered verbatim — not a client-only
  patch.
- New strings are bilingual from birth; coordinate with 0035 T2, which
  localizes this wizard's existing strings — land keys once.
- **Sequencing:** T1 unblocks everything else's testing. The create-response
  parse fix is 0033 T1/T3's (this plan depends on it landing first or
  together).

## Tasks

### T1 — the wizard can be completed at all

Each step's gate checks only fields that step renders: either move the
username inputs onto the source/target steps (connection identity arguably
belongs with host/port) or change `canProceed('source'/'target')` to
host+port and make the credentials step require name + both usernames.

**Acceptance:** a regression test walks all six steps filling only the
visible fields and reaches submit; the test would have failed on today's
code.

### T2 — a paused mapping can be green-lit after the wizard is gone

Give ConfirmMigration a real route (`/mappings/:id/confirm`), navigate to it
on create success instead of swapping component state, and surface it from
the hub and/or the Mappings row whenever `status === 'paused'` ("Review and
start" instead of the 409-destined Play). The green light itself — discovery
counts, explicit start — stays untouched.

**Acceptance:** create → refresh → the paused mapping is startable from the
UI; the Mappings row for a paused mapping leads to the confirm screen, not to
a 409; a test pins the route renders ConfirmMigration for a paused mapping.

### T3 — field-level honesty: validation, credentials, the closing note

- The only validation feedback today is a silently disabled Next
  (`disabled={!canProceed()}`; no required markers, no error text, no
  aria-invalid; a cleared port becomes `NaN` and disables Next with no clue).
  Minimal honest version: required markers on gating fields, one line beside
  a disabled Next naming what is missing, NaN-guard on the port inputs.
- Credentials step: `autocomplete="new-password"` / `"username"` on the four
  inputs (today the browser offers to autofill the admin's own login into
  the source-password field), a show/hide toggle (long app passwords pasted
  masked cannot be checked), and one honest sentence stating what happens to
  these secrets — encrypted at rest, used only to connect, never displayed
  again — a claim the code already makes true
  (`SecretStore.encryptCredentials`; GET masks `'***'`).
- Replace the review step's closing note with the truth of 0013 T5/T6:
  creating stores the configuration paused; next you review what discovery
  found and give the explicit start.

**Acceptance:** a test asserts the missing-field line names the field; the
credential inputs carry the autocomplete attributes; the review note no
longer claims sync starts on create (test pins the new key).

### T4 — choices that cannot work are refused, not stored

`carddav` target + `email` domain (and friends) currently sail through the
wizard, the API (`CreateMappingSchema` has no cross-validation), and into
`scope_selection` rows the target protocol can never receive — failing later
as sync errors the admin cannot connect to a wizard choice. Client: constrain
or annotate the domain choices from the chosen targetType. Server: refuse the
incoherent combination with a message naming both sides (rendered verbatim
per the prose boundary). Also refuse malformed cron: the schedule is free
text stored verbatim (`z.string().optional()`); the managed tick worker
already logs-and-falls-back to `*/15` (a deliberate hard-rule-9 fallback),
but the admin's stated cadence is silently not honored — validate the
5-field shape client-side with a human-readable echo, refuse garbage
server-side naming the fallback behavior.

**Acceptance:** an incoherent target/domain combination cannot be submitted
and the server-side refusal names both sides (contract test, both editions'
create paths where applicable); a malformed cron is refused with the reason;
a valid one round-trips.

### T5 — small keeps: dead Delete, lost state, step naming

- The Mappings-row Delete button has NO `onClick` (`Mappings.tsx:167-172`) —
  a dead control on the exact path an admin takes after a botched run.
  Either wire it through a deliberate confirmation (name-the-mapping arming,
  consistent with hard rule 2's posture — mapping deletion destroys config
  and ledger linkage) or remove it until that exists; a dead affordance is
  worse than either.
- All wizard state is plain `useState`: refresh/back/Cancel discards six
  steps of typed input silently. Cheapest honest fix: a
  beforeunload/navigation-blocker prompt while `formData` differs from
  initial. (Within-wizard Back keeps state correctly today.)
- Step 3 is labeled "Credentials" but leads with — and after T1 gates on —
  Migration Name. Rename ("Name & credentials") or move the name field to
  step 1; align the gate with what the step shows.

**Acceptance:** Delete either arms-and-works or is gone (test whichever);
leaving a dirty wizard prompts; the step label matches its contents.

### T6 — per-source-type credentials (owner scoping)

The source step offers `imap | oauth2 | graph`, but all three render the same
Host/Port/SSL fields with an `imap.example.com` placeholder and port 993, and
collect username+password — the server maps oauth2/graph to connection kind
`o365` and encrypts `{username, password}`; no token, tenant id, client id,
or OAuth flow exists. Meanwhile the shared config layer models `xoauth2`
token auth for oauth/graph sources. **Owner question (this is 0026 T3 row 14
territory — the per-customer app-registration consent runbook):** what does
the o365 connector actually consume, and what should the wizard collect per
source type? Until answered, the cheap honest step is help text per type (or
hiding choices the wizard cannot yet correctly parameterize) so the
product's headline source is not configured by guesswork.

**Acceptance:** an owner answer recorded here; interim: no source type
collects fields it cannot use without saying so on screen.

## Owner decisions queued by this plan

- T6 (what oauth2/graph sources should collect; ties to the row-14 consent
  runbook).
- T5's sovereignty-notice sibling: the "destination server is yours to run"
  notice renders on the SOURCE step (`createMapping.target.userOperated`,
  `CreateMapping.tsx:199-206`) with an in-code comment claiming deliberate
  placement — its own rationale ("where the choice is made") argues for the
  target step. Move it, or bless the placement?
