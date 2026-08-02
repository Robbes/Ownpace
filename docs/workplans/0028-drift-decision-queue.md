# Workplan 0028 — the drift decision queue, first slice

## Status — 2026-08-02 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The decision plumbing (write, list, resolve) | ⬜ Not started | — |
| T2 The first detector: `new_mailbox` | ⬜ Not started | — |
| T3 The second category: `shared_address_pattern` (with 0027) | ⬜ Not started | — |
| T4 The Decisions screen | ⬜ Not started | — |
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
