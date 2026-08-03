# Workplan 0027 — shared addresses (Pattern S + Pattern D)

## Status — 2026-08-03 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 The auth-model extension (application access, spike) | 🟡 **Built 2026-08-03; the live proof is the only thing left, and it waits on the owner running the consent steps** | Owner decision: **grant application permissions on the test tenant, scoped by an Application Access Policy to named test mailboxes** (option A of three; tenant-wide-without-a-policy was declined, and so was retracting the §14.1 promises). Read-only scopes, least privilege — the app cannot reach a mailbox outside the named set, so a bug or a leaked credential reaches one test mailbox rather than the tenant. This is what SAD §14.3 already committed to, now actually chosen. **Split deliberately:** the admin-consent runbook and the connector's `/users/{address}` auth mode are built WITHOUT consent, against the existing config types and with unit tests; only the live proof — one real shared-mailbox read — waits on the owner running the consent steps. So the consent step is a short task done when convenient, not a blocker. This decision also unblocks 0028 T2/T3/T5, all of 0029, and 0030 T2's `decision_raised`, the one notification event with no live source. **The build:** `packages/connectors/src/graph-scope.ts` is the whole difference, in one place rather than as a second URL convention spread across four connectors — `resolveMailboxScope` turns an optional address into `/me` (the delegated default every existing mapping relies on, unchanged) or `/users/{address}`, and all four Graph sources — mail, calendar, contacts, drive — now build every URL from that prefix. **It validates rather than concatenates**, and that is the security-relevant part: under application permissions the app can address any mailbox the access policy allows, so an empty or malformed value degrading into `/users/` would aim a request at the tenant's user COLLECTION — a listing of everybody, from code that meant to read one person's mail. Writing the tests caught a real defect before it shipped: the first pattern refused `#` outright, which rejects **every Azure AD guest account**, whose UPN is literally `person_theirdomain.com#EXT#@yourtenant.onmicrosoft.com`; `#` is now allowed in the local part and still refused after the `@`. 12 scope tests plus the four connectors' existing 114, all green. `directoryNotEnumerable()` is here too — the sentence 0028's detector will need when a source cannot list a directory, so "I could not look" and "nothing found" cannot become the same report (rule 9). **The runbook:** `docs/o365-application-access.md` — the exact portal steps, the three read-only permissions and no more, and the `New-ApplicationAccessPolicy` scoping that turns *the whole tenant* into *these mailboxes*. It says out loud that between granting consent and applying the policy the app can read every mailbox, tells the operator to wait up to an hour for the policy to take effect, and insists on proving BOTH halves — that an in-scope mailbox is granted and an out-of-scope one is **denied**, the half people skip. **What is not done:** one live read against a real tenant with a real policy. That is the owner's consent step; the code is waiting for it, not the other way round. |
| T1 Discovery: groups + shared mailboxes into `group_def` | ⬜ Not started | — |
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
