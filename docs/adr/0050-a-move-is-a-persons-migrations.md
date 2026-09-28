# ADR-0050: A move is a person's migrations

- **Status:** **Proposed 2026-09-28**, for the owner's acceptance (workplan 0153 T0 and T2).
  Nothing here holds until then.
- **Date:** 2026-09-28
- **Deciders:** owner
- **Relates to:** [ADR-0014](./0014-cost-recovery-billing.md) (a path is billed, never a move),
  [ADR-0026](./0026-one-operating-ui-one-contract.md) (both editions answer the same shapes),
  [ADR-0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md) (managed-only
  tables live in `packages/managed`), workplans 0153 (which builds it) and 0154 (what shows on
  it).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **Nothing is operative yet.** This ADR is proposed, and waits for the owner's acceptance (0153
  T2). Until then a migration belongs to no grouping, and the Migrations page lists migrations.
- On acceptance, the rules under *Decision* become this section, amended in place, and
  `OPERATIVE.md` is regenerated.

## Context

The owner asked for the app to become more intuitive, and answered on 2026-09-28 how a person's
work should be grouped (0153 D1):

> *"as 1 (One move per person), but i think this is simular to the current 'Migrations' page,
> but just better fitting UX? One can add multiple migration paths (for example when one person
> is moving away from Google and Microsoft and Dropbox)."*

- **Today a migration has one target** (`CreateMapping.tsx`). So a person leaving Google for
  Soverin and Nextcloud has three migrations or more, each with its own consent, its own
  progress and its own Finish checklist (0153 §1). Nothing groups them, and the Migrations page
  lists them flat.
- **The migrations underneath work, and stay.** The engine runs a migration, the ledger keys
  items per migration, and ADR-0014 bills a path (a migration times a data type). Moving any of
  that for a screen would be the wrong trade.
- **The words (0153 D6).** Dutch says *migratie*. The grouping has no noun on screen: a person's
  card and page carry the person's name. *Move* is the internal name only, in code, tables and
  this ADR.

## Decision

These rules are proposed, and hold once accepted.

1. **A move is a person being moved.** It has a display name, and optionally the person's email
   address, for grant links (0108). It belongs to a tenant.
2. **A migration belongs to at most one move.** Migrations created before this belong to none.
   They show under *Not in a move yet*, with one press to add them to one.
3. **A move changes nothing about a migration.** The engine still runs migrations, the ledger
   still keys items per migration, and ADR-0014 still counts paths. A move is never billed.
4. **Storage, on managed.** A move is a row in a `move` table, and membership is a row in
   `move_member (move_id, mapping_id)`. Both live in `packages/managed/migrations`, with row
   security like every tenant table there. `mapping` gains no column. Hard rule 5 says a managed
   thing hanging off a core table becomes a row of its own.
5. **The appliance** has no create screen and one person. It answers the same API with one
   implicit move holding every configured migration, and it has no table (ADR-0026's shared
   shapes). `no-managed-leakage.unit.test.ts` gains the new module's specifier.
6. **Deleting a move deletes no migration.** Its members return to *Not in a move yet*. Deleting
   a migration stays the two-press delete it is.
7. **The API.**
   - `GET /moves` lists moves with their members' states and counts.
   - `POST /moves` creates one.
   - `POST /moves/:id/members` adds a migration.
   - `DELETE /moves/:id` ungroups.

   They carry the same tenant checks as the migration routes. The OpenAPI spec is updated in the
   same pull request.
8. **What a person reads** about a move is their migrations' stages, summed (`stageOf` and
   `leastAdvancedStage` in shared, 0154 T1). A move has no state of its own; hard rule 10 says a
   status belongs to the thing that happened.

## Consequences

- **One card and one page per person** (0153 T3, T5). Progress and the steps before switching sum
  over the person's migrations (0154). Grant and progress links are issued per person (0108).
- **No existing data moves.** Old migrations appear under *Not in a move yet*, and nothing about
  them changes until someone adds them to a move.
- **Two answers to one question.** Managed reads two tables, and the appliance answers with an
  implicit move. That is ADR-0026's shape rule doing its work, and a shared-shape test holds the
  two to one answer.
- **A new managed migration** (`move`, `move_member`) goes in `packages/managed/migrations`,
  numbered in turn with every other session's.

## Alternatives considered

- **A `move_id` column on `mapping`.** Rejected by hard rule 5: a managed thing hanging off a core
  table becomes a row of its own. The appliance would also carry a column it has no use for.
- **A move as the unit the engine runs,** one migration per person with many sources and
  targets. Rejected: it rewrites the engine, the ledger's keys and ADR-0014's billing for a
  change of screen. D1 says the migrations underneath stay what they are.
- **Grouping in the browser only,** by name. Rejected: grant and progress links would have
  nothing to belong to, and two devices would disagree.
- **One grouping per provider** (all Google, all Microsoft). Rejected by D1: the unit is the
  person, who may be leaving several providers at once.
