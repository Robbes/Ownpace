# Workplan 0028 — the drift decision queue, first slice

## Status — 2026-08-03 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The decision plumbing (write, list, resolve) | ✅ **Done 2026-08-03** | Migration 0005 gives `decision` a `subject_key` + the partial unique index that makes raising idempotent AT THE DATABASE (pending-only — an answered subject may be asked again; history accumulates). `DecisionStore` port in `@openmig/shared`; `PgDecisionStore` in the ledger (raise via on-conflict + read-back with a one-retry gap guard, list newest-first with status/mapping filters, resolve/dismiss that never overwrite an answer — the second answer gets `undefined`). 7 PGlite-backed unit tests (real migrations applied). Gates: typecheck + lint clean, 1298/1298 unit. Managed routes built the same day: `/api/decisions` (list, any member; status/mapping filters) + `/:id/resolve` and `/:id/dismiss` (owner/admin, 409 on unknown-or-answered — RLS makes a foreign tenant's row the same 409, no existence leak), with an integration suite covering isolation, the role gate, and the never-overwrite contract. Appliance routes too: `GET /decisions` (every configured tenant, like every queue) + resolve/dismiss with the SAME 409 words as managed (ADR-0026), a new `readJson` helper (the first appliance route to carry a body), answers attributed to `appliance-operator`; 5 wiring tests on a real PGlite appliance (the store semantics stay proven in the store suite — PGlite's single connection precludes seeding around the server, so the first detector's tests own the full HTTP round trip). And the screen: `Decisions.tsx` at `/decisions` in BOTH editions' nav (tenant-level — a new mailbox belongs to no mapping), bilingual frame + all ten category words EN/NL, `summary` verbatim, the detector's `proposedDefault` verbatim as the accept button, dismiss, answered section — and the load-bearing pin: the EMPTY state says "nothing can raise a decision yet / not watched yet", never "no changes" (rule 9), tested. 5 screen tests; 1308/1308 unit. |
| T2 The first detector: `new_mailbox` | ⬜ **Blocked on 0027 T0** | Enumerating a source tenant's mailboxes needs Graph *application* permissions, which is the auth-model extension 0027 T0 spikes and which needs admin consent on the O365 tenant (owner action). Not started rather than half-built: the detector's only other path is the honest refusal for sources that cannot enumerate a directory, and shipping a detector whose sole live behaviour is "I cannot look" would front-run the auth decisions T0 exists to make. This is also what keeps 0030 T2's `decision_raised` notification unwired — it is the one event with no live source. |
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
