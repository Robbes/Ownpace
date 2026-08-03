# Workplan 0028 — the drift decision queue, first slice

## Status — 2026-08-03 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The decision plumbing (write, list, resolve) | ✅ **Done 2026-08-03** | Migration 0005 gives `decision` a `subject_key` + the partial unique index that makes raising idempotent AT THE DATABASE (pending-only — an answered subject may be asked again; history accumulates). `DecisionStore` port in `@openmig/shared`; `PgDecisionStore` in the ledger (raise via on-conflict + read-back with a one-retry gap guard, list newest-first with status/mapping filters, resolve/dismiss that never overwrite an answer — the second answer gets `undefined`). 7 PGlite-backed unit tests (real migrations applied). Gates: typecheck + lint clean, 1298/1298 unit. Managed routes built the same day: `/api/decisions` (list, any member; status/mapping filters) + `/:id/resolve` and `/:id/dismiss` (owner/admin, 409 on unknown-or-answered — RLS makes a foreign tenant's row the same 409, no existence leak), with an integration suite covering isolation, the role gate, and the never-overwrite contract. Appliance routes too: `GET /decisions` (every configured tenant, like every queue) + resolve/dismiss with the SAME 409 words as managed (ADR-0026), a new `readJson` helper (the first appliance route to carry a body), answers attributed to `appliance-operator`; 5 wiring tests on a real PGlite appliance (the store semantics stay proven in the store suite — PGlite's single connection precludes seeding around the server, so the first detector's tests own the full HTTP round trip). And the screen: `Decisions.tsx` at `/decisions` in BOTH editions' nav (tenant-level — a new mailbox belongs to no mapping), bilingual frame + all ten category words EN/NL, `summary` verbatim, the detector's `proposedDefault` verbatim as the accept button, dismiss, answered section — and the load-bearing pin: the EMPTY state says "nothing can raise a decision yet / not watched yet", never "no changes" (rule 9), tested. 5 screen tests; 1308/1308 unit. |
| T2 The first detector: `new_mailbox` | 🟡 **Core built 2026-08-03 — the read and the judgement; the schedule and the live proof are the next slice** | Unblocked by 0027 T0's auth model landing the same day. Two halves, both pure enough to test without a tenant. **The read** (`packages/connectors/src/graph-directory.ts`): `/users` is an APPLICATION-permission endpoint, so a delegated connection is refused **before a request is made** — Graph would answer 403 and the operator would learn what broke rather than what to change; this names `docs/o365-application-access.md` instead. Every failure path — no permission, an error status carrying Graph's own words, a transport failure, a non-JSON body, paging that will not end — produces `not_enumerable` **with the reason**, never `[]`. `mail` is preferred and `userPrincipalName` is the fallback, because some tenants leave `mail` unset on perfectly real mailboxes and dropping those would hide a mailbox somebody expects to see. **The judgement** (`packages/core/src/detect-new-mailboxes.ts`): diff the directory against covered addresses, case-insensitively, and raise one decision per uncovered mailbox with the address as `subjectKey` — so the store's partial unique index makes an hourly detector converge on the same pending set instead of growing it (rule 1). Dismissed subjects are not re-raised; a directory listing the same address twice produces one decision; an empty entry produces none. **`DirectoryListing` is a union, not an array**, and that is the load-bearing choice: an empty list from a source that never looked reads exactly like a tenant where nothing changed, and those mean opposite things. 22 unit tests. **The run** (`packages/core/src/run-new-mailbox-detection.ts`, added the same evening) closes the gap between the two: read the directory, diff, write to the queue, tell somebody. Four rules, each of them a production failure mode with a test: **notify only on a decision that was actually CREATED** — the store's raise is idempotent, so without this an hourly detector emails about the same mailbox twenty-four times a day until it is answered, and the channel is filtered by the second day; **a blind spot is warned EVERY run**, not once, because an operator reading today's log must see that today's run could not look; **one address failing does not stop the others**, so a tenant with one problematic mailbox still hears about the other four; and **a failed announcement never undoes a raised decision** — the decision is in the queue and the screen has it, the email was the courtesy. 9 tests. **Coverage resolution added 2026-08-03 evening** (`packages/core/src/mapping-coverage.ts`), because wiring the run exposed a correctness hole in the question itself: the detector asks *is there a mailbox nobody is migrating*, and that is only as good as its idea of what IS migrated. Two of the three source kinds state it — `imap-oauth2` carries `user`, which IS the address, and a Graph source carries `mailbox` (0027 T0's field, made settable the same evening). The third does not: a Graph source WITHOUT `mailbox` reads `/me`, whoever the stored credentials belong to, and the mapping file never records who that is. **Reported as UNSTATED rather than guessed**, and a tenant with any unstated mapping raises NOTHING, with the reason naming the mappings and the one-line fix. The asymmetry that drove it: being too generous makes the detector miss an unmigrated mailbox; being too confident makes it announce one the owner is already migrating — and that second failure teaches the owner the queue is wrong, which is worse than no queue. 11 tests (9 coverage, 2 the detector's new refusal path, including that a directory that could not be READ is reported ahead of incomplete coverage — no point comparing against a listing that does not exist). **The managed wiring landed 2026-08-03** (`apps/worker/src/jobs/managed-drift-detect.ts`): a daily task at 07:00 UTC — an hour before the digest, so a mailbox found this morning is in the summary the owner reads rather than waiting a day, and because `/users` against a whole tenant is not a query to run 1,440 times a day. It is thin by construction: the rules are all in core, and the file holds the Pool, the token, the store, the notifier and the cron. Coverage comes from the LEDGER here rather than mapping files — a mapping points at a source `mailbox` row carrying `primary_address`, and a NULL there is managed's version of *unstated*. **`decision_raised` finally has a live source**, closing 0030 T2's last unwired event. The one rule that lives only in the worker got extracted and tested (`directory-availability.ts`, 7 tests): three preconditions that fail for three different reasons with three different fixes — no O365 source connection (an IMAP-only tenant, legitimate, not an error), the DELEGATED flow (checked BEFORE the client secret, because a stack carrying both is configured for delegated access and would otherwise be told it was fine and then meet a 403), and missing credentials (naming the ONE that is absent, since *credentials are missing* leaves an operator checking two things). **And a latent bug found on the way:** `set-task-env.sh` never uploaded `OAUTH2_*`, so a task container had no Graph credentials at all — the same trap the SMTP values fell into, and it would have broken Graph-based managed syncs too, not just this detector. Fixed, and documented in `managed.env.example`. **Still not done:** the appliance's own wiring, and the live read against a consented tenant. |
| T3 The second category: `shared_address_pattern` (with 0027) | ⬜ Not started | — |
| T4 The Decisions screen | ✅ **Done 2026-08-03 — shipped inside T1's slice** | Recorded here rather than left saying "not started" while the screen exists: `apps/web/src/pages/Decisions.tsx`, mounted at `/decisions` in BOTH editions' nav (tenant-level, because a new mailbox belongs to no mapping yet). Bilingual frame with all ten category words EN/NL; `summary` and the detector's `proposedDefault` render **verbatim** (the prose boundary — the proposed default is the accept button's own label, so rewording it would reword the action). Resolve, dismiss, and an answered section. The load-bearing pin is the EMPTY state: it says "nothing can raise a decision yet — not watched yet", never "no changes", because with no detectors built those two sentences mean opposite things and only one of them is true (rule 9). 5 screen tests. T5's per-category preset control is the one piece of this task's description still unbuilt, and it waits on T2 for the same reason T5 does — a preset that pre-answers a category nothing detects would pre-answer nothing. |
| T5 Presets: `auto` answers for the two categories | ⬜ Not started | — |

## Why this exists

Owner decision 2026-08-02 (0026 T3 row 6): **keep, scoped.** SAD §11.1/§11.2
promise that migration-lifecycle drift becomes owner decisions in the UI,
with policy presets pre-answering categories. The schema shipped in ledger
v1 — `decision` (ten categories, `pending/resolved/auto_resolved/dismissed`,
`proposed_default`, a partial index on pending) and `policy_preset`
(`auto`/`ask` per tenant+category) — and the 2026-08-02 sweep confirmed
**zero readers and zero writers**: the largest unowned feature in the repo.

The scope discipline, per the owner: **two categories, not ten.** The first
slice builds the queue end to end for the categories discovery can already
see — `new_mailbox` and `shared_address_pattern` — and leaves the other
eight detectors unbuilt and *said to be unbuilt*. The item-level queues
(Deletions/Moves/Failures, ADR-0026) are untouched: this is the
mapping-level queue above them, not a replacement.

## Tasks

- **T1 — plumbing.** A small `decisions` module in `@openmig/core`: raise
  (idempotent per tenant+category+natural subject — re-detection must not
  duplicate a pending row), list, resolve (`resolution` jsonb + `resolvedBy`
  from the authenticated member), dismiss. API routes in both editions
  following the queue-envelope conventions; RLS-scoped like everything else.
  No detector yet — T1 is proven by tests and the screen skeleton reading an
  empty queue honestly.
- **T2 — `new_mailbox`.** The directory-level poll: enumerate the source
  tenant's mailboxes (the 0027 T0/T1 application-permission surface — this
  task consumes what 0027 discovery builds, one Graph read for both plans),
  diff against configured mappings, raise one decision per unmapped mailbox
  with `proposed_default: 'create a mapping'`. IMAP-only sources cannot
  enumerate a directory: the detector says so rather than reporting "no
  drift" (rule 9).
- **T3 — `shared_address_pattern`.** 0027 T1's classification writes
  `group_def`; where S-or-D is ambiguous (a group with a store that looks
  jointly handled), it raises this decision instead of guessing — the
  category exists precisely for §14.1's question. Lands with or directly
  after 0027 T1; whichever merges second wires the seam.
- **T4 — the screen.** One Decisions screen in the house queue style
  (0019's primitives): pending rows with category, summary, the proposed
  default as the primary action, resolve/dismiss, and the resolved section.
  Bilingual from birth (0024): the FRAME is dictionary keys; `summary` and
  `detail` are the server's words, verbatim (the prose boundary).
  Per-mapping on managed, top-level on the appliance, like every queue.
- **T5 — presets.** `policy_preset.action = 'auto'` makes the detector
  resolve its own decision (`auto_resolved`, resolution recording the
  preset) instead of asking; `'ask'` stays the default. Surface: a small
  per-category control on the Decisions screen, owner/admin only, for the
  TWO built categories — no preset UI for detectors that do not exist.

## Hard rules that bite here

- **Rule 2:** a decision is how destructive-adjacent drift gets a human;
  `auto` presets are allowed only where the action is non-destructive
  (creating a mapping, recording a pattern) — never for anything that
  removes or overwrites.
- **Rule 9:** detectors that cannot see (IMAP directory, unbuilt
  categories) say so; an empty queue must be distinguishable from a blind
  one.
- **Rule 1:** raising is idempotent — every detector re-run converges on
  the same pending set.
