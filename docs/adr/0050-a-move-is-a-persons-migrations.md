# ADR-0050: A move is a person's migrations

- **Status:** **Accepted 2026-09-28**, by the owner, as proposed; amended once, the same day (the
  name in code is *person*). **The tables and the API are built** (workplan 0153 T2, #1332). The
  pages are 0153's T3 and T5. Dated history: the Amendment log below.
- **Date:** 2026-09-28; accepted 2026-09-28; amended 2026-09-28
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

- **Built**: tables and `/api/people` (0153 T2, #1332); on managed, the Migrations page lists
  people, each with a page (`Mappings.tsx`, `Person.tsx`).
- **The name in code is *person*** (the amendment below) — tables, API (`/people`) and shapes
  (`packages/shared/src/people.ts`) — never *move*, which names the moved-items queue (`/moves`,
  `MovesQueue`). On screen the grouping has no noun; the person's name titles it (0153 D6).
- **A person is someone being moved**: a display name, optionally an email address for grant
  links, in one tenant.
- **A migration belongs to at most one person** (`person_migration`'s key is the migration), or
  to nobody: `unassigned`, shown without a person. **Deleting a person deletes no migration**;
  deleting a migration, only its `person_migration` row.
- **A person changes nothing about a migration** and is never billed: engine, ledger and
  ADR-0014's paths stay per migration. **It has no state of its own**: it reads its migrations'
  states, counted, and stages (`leastAdvancedStage`, 0154 T1).
- **Rows, never a column on `mailbox_mapping`** (hard rule 5): `person` and `person_migration` in
  `packages/managed/migrations` (0031), forced row security; a key holds a row to its tenant's
  person, the policy to its tenant's migration. Erasure purges both (`PURGED_TABLES`). Guard:
  `people-under-rls.unit.test.ts`.
- **The appliance keeps no table**: `GET /people` answers one implicit person holding every
  configured migration; writes are refused (`one_person_here`). Guards:
  `one-person-on-the-appliance.unit.test.ts`; `no-managed-leakage.unit.test.ts` names both tables.
- **The API**: `GET` and `POST /api/people`, `POST /api/people/{personId}/migrations`,
  `DELETE /api/people/{personId}`, with the migration routes' tenant checks, in the OpenAPI spec.
  Re-adding a migration changes nothing; one that is somebody else's stays theirs (409
  `with_another_person`). Guard: `people.unit.test.ts`.

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

Accepted 2026-09-28 by the owner, as proposed.

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

## Amendment 2026-09-28: the name in code is *person*

Building the tables (0153 T2) found that `/moves` was taken. On the appliance, `GET /moves` is the
queue of items a source put somewhere else (§11.2's decision queue, `MovesQueue`), and the web
app has a `/moves` page for it. The API above would have collided with it there, and the person
page's `/moves/:id` with the queue's page. In code, *move* would have meant two things.

Asked which name the grouping should take in code and in the API, the owner chose *"person /
people (Recommended)"*. The other choices were to keep *move* with another path on the
appliance, or to build the API on managed only for now. What changed:

| As accepted | As built |
|---|---|
| a `move` row | a `person` row |
| `move_member (move_id, mapping_id)` | `person_migration (mapping_id, person_id, tenant_id)` |
| `GET /moves`, `POST /moves` | `GET /api/people`, `POST /api/people` |
| `POST /moves/:id/members` | `POST /api/people/{personId}/migrations` |
| `DELETE /moves/:id` | `DELETE /api/people/{personId}` |
| the appliance's implicit move | the appliance's `GET /people`, one person with the id `implicit` |
| *Not in a move yet* | the answer's `unassigned`, with the words on screen 0153 T6's |

Nothing else changed. The eight rules hold as accepted, under the new names, and the screen still
has no noun for the grouping. The name also matches what the page says above the cards, *"2
people · 1 needs you"* (0153 T3 (b)).

## Amendment log

- **2026-09-28** — Accepted, by the owner, as proposed. Asked what the pull request needed, and
  told its eight rules and the choices inside them, the owner answered *"accept"*, rule 8
  included. Record: *Decision*.
- **2026-09-28** — **Amended**, by the owner: the name in code and in the API is *person*, not
  *move* ([the amendment](#amendment-2026-09-28-the-name-in-code-is-person)). Record: the section
  "Amendment 2026-09-28: the name in code is *person*".
- **2026-09-28** — The tables and the API built (workplan 0153 T2, #1332).

## Operative rules at length (as they read until 2026-10-03)

The operative section above was cut to the ADR-0051 budget on 2026-10-03. Below are its
bullets as they read before, word for word: the same rules, with the reasons and examples
that no longer fit there. This is a record; the section above is what holds.

- **ACCEPTED; THE TABLES AND THE API BUILT, THE PAGES NOT YET (2026-09-28).** `person`,
  `person_migration` and `/api/people` are 0153 T2's, built in #1332. The pages are 0153 T3 and T5: until
  they land, the Migrations page lists migrations, and nothing on screen groups them.
- **The name in code is *person*** (the amendment): the tables `person` and `person_migration`,
  the API's `/people`, and the shapes in `packages/shared/src/people.ts`. Never *move*: `/moves`
  and `MovesQueue` are the queue of items a source put somewhere else. On screen the grouping has
  no noun; the person's name titles it (0153 D6).
- **A person is someone being moved:** a display name, and optionally an email address for grant
  links, in one tenant.
- **A migration belongs to at most one person.** `person_migration`'s key is the migration. One
  that belongs to nobody is `unassigned`, and the page shows it without a person.
- **A person changes nothing about a migration.** The engine runs migrations, the ledger keys
  items per migration, ADR-0014 counts paths, and a person is never billed.
- **Rows, never a column on `mailbox_mapping`** (hard rule 5): `person` and `person_migration
  (mapping_id, person_id, tenant_id)` in `packages/managed/migrations` (0031), with forced row
  security. A key holds a row to a person of its own tenant, and the policy to a migration of
  it. Erasure purges both (`PURGED_TABLES`). The appliance keeps no table: it answers `GET
  /people` with one implicit person holding every configured migration, and refuses the writes
  (`one_person_here`). `no-managed-leakage.unit.test.ts` names both tables.
- **Deleting a person deletes no migration.** Their migrations belong to nobody again. Deleting a
  migration deletes only its row in `person_migration`.
- **The API is `GET /api/people`, `POST /api/people`, `POST /api/people/{personId}/migrations`
  and `DELETE /api/people/{personId}`,** with the migration routes' tenant checks, and in the
  OpenAPI spec. Adding a migration again changes nothing; one that is somebody else's stays
  theirs (409 `with_another_person`).
- **A person has no state of its own.** What a person reads is their migrations' states, counted
  in the answer, and their stages (`leastAdvancedStage`, 0154 T1).
