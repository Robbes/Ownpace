# Workplan 0027 — shared addresses (Pattern S + Pattern D)

## Status — 2026-08-04 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 The auth-model extension (application access, spike) | 🟡 **Built 2026-08-03; the live proof is the only thing left, and it waits on the owner running the consent steps** | Owner decision: **grant application permissions on the test tenant, scoped by an Application Access Policy to named test mailboxes** (option A of three; tenant-wide-without-a-policy was declined, and so was retracting the §14.1 promises). Read-only scopes, least privilege — the app cannot reach a mailbox outside the named set, so a bug or a leaked credential reaches one test mailbox rather than the tenant. This is what SAD §14.3 already committed to, now actually chosen. **Split deliberately:** the admin-consent runbook and the connector's `/users/{address}` auth mode are built WITHOUT consent, against the existing config types and with unit tests; only the live proof — one real shared-mailbox read — waits on the owner running the consent steps. So the consent step is a short task done when convenient, not a blocker. This decision also unblocks 0028 T2/T3/T5, all of 0029, and 0030 T2's `decision_raised`, the one notification event with no live source. **The build:** `packages/connectors/src/graph-scope.ts` is the whole difference, in one place rather than as a second URL convention spread across four connectors — `resolveMailboxScope` turns an optional address into `/me` (the delegated default every existing mapping relies on, unchanged) or `/users/{address}`, and all four Graph sources — mail, calendar, contacts, drive — now build every URL from that prefix. **It validates rather than concatenates**, and that is the security-relevant part: under application permissions the app can address any mailbox the access policy allows, so an empty or malformed value degrading into `/users/` would aim a request at the tenant's user COLLECTION — a listing of everybody, from code that meant to read one person's mail. Writing the tests caught a real defect before it shipped: the first pattern refused `#` outright, which rejects **every Azure AD guest account**, whose UPN is literally `person_theirdomain.com#EXT#@yourtenant.onmicrosoft.com`; `#` is now allowed in the local part and still refused after the `@`. 12 scope tests plus the four connectors' existing 114, all green. `directoryNotEnumerable()` is here too — the sentence 0028's detector will need when a source cannot list a directory, so "I could not look" and "nothing found" cannot become the same report (rule 9). **The runbook:** `docs/o365-application-access.md` — the exact portal steps, the three read-only permissions and no more, and the `New-ApplicationAccessPolicy` scoping that turns *the whole tenant* into *these mailboxes*. It says out loud that between granting consent and applying the policy the app can read every mailbox, tells the operator to wait up to an hour for the policy to take effect, and insists on proving BOTH halves — that an in-scope mailbox is granted and an out-of-scope one is **denied**, the half people skip. **What is not done:** one live read against a real tenant with a real policy. That is the owner's consent step; the code is waiting for it, not the other way round. **Follow-up the same evening — the option was unreachable.** T0 gave the connectors a `mailbox` option and, for a day, nothing could SET it: no mapping file had a field for it, which is a capability that may as well not exist. `GraphMailSource`/`GraphCalendarSource`/`GraphContactsSource` config types now carry `mailbox?`, the parser reads it, and `build-deps` threads it into the connector — so a Pattern S mapping (T3) can finally say *migrate the shared store at this address*. Unset still means `/me` everywhere, unchanged for every mapping written before today. **And the flow mismatch is refused at build time:** the worker builds a DELEGATED token when `OAUTH2_REFRESH_TOKEN` is set and an APPLICATION token from `OAUTH2_CLIENT_SECRET` otherwise, so a mapping naming a mailbox while a refresh token is present cannot work — Graph would answer a bare 403 on `/users` and the operator would read an access-denied error that says nothing about which of the two flows they are on. It now fails with the address, the offending variable, and a pointer to the runbook. 7 tests (4 config surface, 3 wiring including the guard and the proof it does NOT break delegated `/me` reads). |
| T1 Discovery: groups + shared mailboxes into `group_def` | 🟡 **Built 2026-08-04; live proof waits on the same consent step as T0** | `group_def` finally has a reader and a writer — it had neither since ledger v1, which is why the scope manifest's two §14.1 rows had no code behind them. **The judgement is separated from the vocabulary**, in three pieces: `packages/connectors/src/graph-groups.ts` translates Microsoft's words into three source-neutral ones (a `Unified` group type means `has_store`; mail-enabled and not Unified means `no_store`; anything else is `unknown`), `packages/core/src/classify-shared-address.ts` turns those into §14.1's patterns (store → S, no store → D), and `run-group-discovery.ts` is the pass around them. A second source one day states the same three facts and reuses the same judgement. **The third answer is the point.** `unknown` is not a failure: both wrong guesses cost real work — guessing D for something with a store silently drops a mailbox full of mail from the migration, and guessing S for a distribution list recreates no group, so mail sent to the address after cutover reaches nobody. §11.2 anticipated exactly this, which is why `decision` has carried a `shared_address_pattern` category since ledger v1; the row is stored with a NULL pattern and the question is asked (raising it is 0028 T3's). **The defect the tests forced out before it shipped:** `members` defaults to `[]`, and an empty member list is a perfectly good answer — plenty of groups have none. It is also what a FAILED member read leaves behind, and Pattern D recreates a group FROM that list, so the two silently colliding would have T2 create an empty group on the target and call it done. Migration 0006 adds `members_known` so they cannot look alike, and `listGroupMembers` returns the same `listed | not_enumerable` union as the directory rather than a short list — one group's 403 does not shorten the others. **Migration 0006** also adds `pattern`, `display_name`, `source_group_id` and, the one that makes re-running converge, a unique key on (tenant, source connection, address): discovery runs before every migration and again during shadow, and without it the second pass would insert a second row and which member list won would depend on read order (rule 1). The upsert deliberately does NOT move `status` backwards — a group T2 already created stays created (rule 2). **IMAP says so out loud:** `listImapGroups()` always answers `not_enumerable` with the reason, and it is a tested function rather than an omission, because the regression it guards against is somebody later returning `[]` to make a screen look tidier — which would tell an owner their organisation has no shared addresses. **Wired on both editions:** `managed-group-discovery` (Trigger schedule, 06:30 UTC, per SOURCE CONNECTION rather than per tenant, since the same address on two consolidated sources is genuinely two findings) and appliance section 3e (croner, 06:30 local, deriving its connection row deterministically from the Graph tenant so the upsert keys are stable). Both an hour before the drift detector and the digest. 46 new tests (16 connector, 14 core, 16 ledger against real migrations on PGlite); 1571 unit across 156 files, lint and typecheck clean. **What is not done:** one live read against a real tenant — the same consent step T0 is waiting on — and surfacing the results, which is T4. |
| T2 Pattern D: recreate the group on the target | ⬜ Not started | — |
| T3 Pattern S: the shared store as an ordinary mapping | ⬜ Not started | — |
| T4 Surface it: Review & confirm + manifest truth | ⬜ Not started | — |

## Why this exists

Owner decision 2026-08-02 (0026 T3 row 2): **keep and build.** The scope
manifest promises migration owners both §14.1 patterns under *Migrates* —
"Shared mailboxes — Pattern S — the shared store is copied" and
"Distribution lists — Pattern D — the group definition + member list" —
and the 2026-08-02 sweep confirmed zero code behind either: `group_def`
(schema'd, RLS'd, status `pending/created/error` since ledger v1) has no
readers or writers, no connector touches Graph's groups surface, and
`mailbox_mapping.pattern` (`shared_s`/`distribution_d`) is settable and
read by nothing. This plan makes the promise real instead of retracting it.

What the SAD already decided (follow, don't re-decide):

- **§14.1** — Pattern S: full folder tree copied idempotently to a
  dedicated target mailbox (team access via app passwords on Soverin;
  Send-As works). Pattern D: usually **no store** — what migrates is the
  **definition + member list** (discover → recreate); members' messages
  ride their own mailbox syncs. An M365 group **with** a store is S, not D.
- **§14.3 (verified legality)** — reading shared mailboxes / org-wide
  requires **application permissions + admin consent**, scoped
  least-privilege via an **Application Access Policy**. The current Graph
  connectors are all delegated `/me/...` — a shared store is reachable only
  as `/users/{address}/...`.
- **§11.2/ledger v1** — the `decision` table already carries a
  `shared_address_pattern` category: the S-or-D question (§14.1's own
  framing) is *designed* to be asked as a decision, not guessed.

## Tasks

- **T0 — the auth spike.** Prove one shared mailbox read end to end with
  application permissions + Application Access Policy on the test tenant
  (read-only, least privilege — safety note applies). Deliverable: the
  admin-consent runbook (docs) + the connector auth mode that takes a
  `/users/{address}` base instead of `/me`, behind the existing config
  types. Nothing ships to users in T0; it de-risks everything below.
- **T1 — discovery.** Enumerate distribution lists / mail-enabled groups
  and shared mailboxes via Graph (`Group.Read.All` application scope),
  classify per §14.1 (store → S, no store → D), and write `group_def` rows
  (`pending`) with the member lists. Counts join the pre-start Review &
  confirm discovery the same way the four domains do. IMAP-only sources:
  discovery honestly reports "not discoverable over IMAP" rather than an
  empty list (rule 9).
- **T2 — Pattern D recreation.** From `group_def`, produce the target-side
  group: automate the clean subset where the target has an API, and
  generate the §14.2-style step-by-step runbook where it does not (Soverin
  e-mail groups, catch-all/forwarding). `status` moves `pending` →
  `created`/`error` and the error is the verbatim reason. Non-destructive
  throughout: never touch an existing target group.
- **T3 — Pattern S.** A shared mailbox becomes an ordinary
  `mailbox_mapping` with `pattern = 'shared_s'` and a `/users/{address}`
  source — the full-tree copy, idempotency and verification are the
  existing mail path, unchanged. The pattern column finally gets its
  reader: routing + the dedicated-target-mailbox convention documented.
- **T4 — surface + truth.** Review & confirm shows the discovered shared
  addresses with their S/D classification (the `shared_address_pattern`
  decision category where ambiguous); the scope manifest's two §14.1 rows
  gain the honest qualifiers for whatever T2 automates vs. guides; SAD
  §14.1 gets a dated update note recording what shipped.

## Hard rules that bite here

- **Rule 1/2:** recreation is create-only and idempotent — re-running T2
  converges, and nothing on the target is modified or deleted.
- **Safety note:** the test O365 tenant is real and read-only —
  application-permission scopes are requested least-privilege and the
  Access Policy limits them to the named shared mailboxes.
- **Rule 9:** an IMAP source that cannot enumerate groups says so;
  a target without a groups API gets a runbook, not a silent skip.
