# Workplan 0169 — DAV sources on the managed door

> **In one line:** CalDAV, CardDAV and WebDAV source cards on the managed edition's front door, in the protocol lane beside IMAP and labelled experimental, with no Nextcloud source card, so a person can leave any DAV server, a Nextcloud among them, through the screens.

## Status — 2026-11-24 (update this block at the end of every session)

**2026-11-24: built, on `claude/ownpace-public-readiness-y7orc6-dav-sources`, for alpha.19; merged
as #2104 on 2026-11-24 at about 12:04 UTC (`7f091778`)**, after E2E (managed) run 45382336433 went
green on its branch and E2E (self-hosted) on Postgres, run 45388431027, and on PGlite, run
45389247665, went green on its head (`e2f20452`). No database change: the three
kinds have been allowed on `connection.kind` since the baseline, because the DAV targets store
them.

**The owner's decision, 2026-11-24, verbatim:** *"yes to all, build them. But dont add the
nextcloud as source card, add only the generic cards as source."*

**Why.** During workplan 0160 T2b on the OTA test environment, the owner could not pick Nextcloud
or any DAV server as a source on the screens. The gap was already recorded as 0141's open
question 9 (2026-09-27), whose option (b), *"a CalDAV and CardDAV source on the managed door:
code, and a card of its own"*, is the one chosen, with WebDAV added. 0141's question is marked
answered.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T1 The three source cards | builder | ✅ **Done 2026-11-24** | §2. In the protocol lane beside IMAP; hints in English and Dutch written for the source side; no Nextcloud source card. |
| T2 The managed path, end to end | builder | ✅ **Done 2026-11-24** | §3. The create route and the web contract, the worker's wiring, Test, the permission report and the scope families. |
| T3 The egress guard | builder | ✅ **Done 2026-11-24** | §4. Proven by test, by base URL and by host and port. |
| T4 The experimental label | builder | ✅ **Done 2026-11-24** | `SOURCE_PROOFS.kinds`: experimental, until a real run through the managed door is recorded in the feature matrix's Live proofs. |
| T5 The guides | builder | ✅ **Done 2026-11-24** | `dav#caldav-source`, `dav#carddav-source`, `dav#webdav-source`, in both languages. |
| T6 Tests | builder | ✅ **Done 2026-11-24** | §5. |
| T7 Records | builder | ✅ **Done 2026-11-24** | This plan, the feature matrix, 0141's open question 9, the CHANGELOG. |
| T8 The managed E2E run | owner | ✅ **Done 2026-11-24** | E2E (managed) run 45382336433 green on the branch; E2E (self-hosted) runs 45388431027 (Postgres) and 45389247665 (PGlite) green on its head; merged as #2104. |
| T9 A real run, which lifts the label | owner | ⏳ **Owner** | One pass through the managed door against a real DAV account, recorded in the feature matrix's Live proofs table (0141 T1's rule); then `SOURCE_PROOFS` flips in the same pull request. |

## 1. What existed

- The source connectors since workplan 0007: `caldav-source.ts`, `carddav-source.ts` and
  `webdav-source.ts` in `packages/connectors`, with unit and integration tests. The appliance uses
  them through its mapping files, and its nightly reads them against a Nextcloud we run.
- On managed, `SOURCE_CARDS` had no DAV card, and the create route's `sourceType` refused one.
  `TARGET_CARDS` had `caldav`, `carddav` and `webdav` cards, with hints and guides for the target
  side.
- The worker's managed wiring already built a DAV face for any kind no table claims
  (`sourceFaceBuilder`'s protocol default), and the account qualification already measured
  `caldav`, `carddav` and `webdav` rows. Neither needed a change.

## 2. The cards

`SOURCE_CARDS` in `apps/web/src/components/front-door-cards.ts` gains `caldav`, `carddav` and
`webdav`, each with a source hint (`account.proto.caldavSource.hint` and its siblings) and a guide
section of its own. `FRONT_DOOR_GROUPS` already placed the three ids in the protocol lane, so the
Accounts page shows them beside IMAP. On *Start a migration* they are three tiles named for what a
person has, by the owner's rule of 2026-10-18 that put *Other mail provider (IMAP)* on IMAP's:
**Calendar server (CalDAV)**, **Contacts server (CardDAV)** and **File server (WebDAV)**, in both
languages. Each offers only its protocol's data types (`SOURCE_TYPE_DOMAINS`, read from the target
table so the two sides of one protocol cannot disagree). The fold under the tiles no longer says
calendars, contacts and files are read only from the providers above it.

The form (`credentialFieldsFor('source', …)`) is a DAV target's: host, port, DAV base URL, and a
login. Each card's checklist is IMAP's two steps in DAV's words: the server's address, and an app
password.

## 3. The managed path

- **The create route** (`apps/api/src/routes/migrations/index.ts`): the three are source types;
  `sourceKindFor` stores each under its own kind; `sourceConfig` takes `url`; the config is a DAV
  target's shape and the credential is the login. The superRefine demands a server (host and port,
  or the base URL) and the login, by name, with a link to the guide section, and refuses a data
  type the protocol does not carry. `nextcloud` stays out of the enum, so it is refused as a
  source.
- **The worker**: nothing new. A `caldav`, `carddav` or `webdav` row resolves to the `dav` builder
  for each of its faces, through the builders every pass calls.
- **Test** (`probeSourceConnection`): an arm per kind, through those same builders. A CalDAV
  source lists its calendars, a CardDAV source its address books, a WebDAV source its folders.
  Before this, each answered "No probe exists".
- **Discovery** reads through the pass's builders and needed nothing.
- **The permission report** (`apps/api/src/routes/permissions.ts`): a WebDAV source's shares are
  read through OCS at the origin of the base URL its door stored (`url`, which it did not read),
  and its calendar section no longer names Nextcloud. A CalDAV or CardDAV source asks nothing of
  the network and says, in its own neutral words, that its sharing is not read.
- **The scope manifest**: the three join the `standards` family, by kind and by card, as their
  mapping-file types already are.

## 4. The egress guard

Every request a DAV source makes goes through `tenantFetch` (0136 T1), so a host a person types is
refused on managed when it resolves inside the service's own network. The proof is in
`packages/orchestration/src/a-host-we-are-asked-to-reach.unit.test.ts`, beside the DAV targets':
for each kind, typed as a base URL and as a host and port, the admitted name is reached and its
redirect inward is not followed; `127.0.0.1` is refused in our words before a request arrives;
and with the rule off, as on the appliance, the same probe reaches the stub and follows its
redirect.

## 5. Tests

- `apps/web/src/pages/every-card-through-start-a-migration.unit.test.tsx`: each new card reaches
  *Connect your accounts* through its tile.
- `apps/api/src/routes/migrations/a-dav-source-at-the-create-door.unit.test.ts`: each accepted by
  base URL and by host and port; refused without a server or a password, and for a data type its
  protocol does not carry; `nextcloud` refused as a source; what is stored.
- `packages/orchestration/src/a-dav-source-through-the-managed-door.unit.test.ts`: the worker's
  wiring, a listing at the address the row names with the stored login, and Test.
- `apps/api/src/routes/a-dav-source-in-the-permission-report.unit.test.ts`: the permission report,
  over a real ledger.
- The egress guard, §4.

The Nextcloud Testcontainers fixture's integration tests of the three source connectors
(`packages/connectors/src/*-source.integration.test.ts`) run in CI as before; nothing in this plan
changes what they read.

## 6. Open

Nothing of the owner's. T9 is the owner's run; T8 is done.
