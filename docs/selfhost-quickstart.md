# Self-host quickstart (NAS / mini-PC / Raspberry Pi / Windows-WSL2)

The self-host edition is a **single-tenant appliance**: one small bundled
Postgres + one app container that migrates itself on startup, discovers what a
new mapping will move, waits for you to review and confirm it, then runs on an
in-process schedule and serves a local status endpoint. It runs **all four
domains** (mail / calendar / contacts / files) with the same engines as the
managed edition, and loads **none** of the managed-only machinery (no Trigger.dev,
no billing). Container-first per **ADR-0019**; Postgres-backed per **ADR-0023**.

> **Footprint note (ADR-0023, amended by ADR-0028).** Earlier designs imagined an
> embedded SQLite file. Both editions standardise on Postgres — but since
> ADR-0028 the appliance can run it **embedded** (PGlite, Postgres compiled to
> WASM, in-process): same SQL, same migrations, same RLS, no second container,
> no port. The bundled-Postgres compose below remains the default; the
> no-Postgres-server shape is one override file away (see "No Postgres server:
> the PGlite variant" under step 4).

## What you need

- A host with **Docker + Docker Compose v2** on a **local disk** (see the warning
  below). ~1 GB RAM free is comfortable.
- Works on:
  - **Linux NAS / mini-PC** (Synology, Unraid, a spare box) — native `amd64`.
  - **Raspberry Pi 4/5 or other arm64 SBC** — the image is multi-arch (`arm64`).
  - **Windows** via **Docker Desktop / WSL2** — supported today.
- Source/target credentials (e.g. an app password or OAuth token for the source
  mailbox, a password for the JMAP/DAV target).

> ⚠️ **The Postgres data volume must be on a LOCAL filesystem.** Never place it on
> a network share (SMB/NFS) — Postgres can corrupt on network filesystems. On a
> NAS, use a local SSD/HDD volume, not a mounted share.

## 1. Get the compose files

Clone the repo (or copy the `deploy/selfhost/` directory and the source it
builds from) onto the host:

```sh
git clone https://github.com/robbes/open-migrate.git
cd open-migrate
```

## 2. Configure secrets

```sh
cp deploy/selfhost/selfhost.env.example deploy/selfhost/.env
chmod 600 deploy/selfhost/.env          # keep secrets readable only by you
```

Edit `deploy/selfhost/.env`:

- **`POSTGRES_PASSWORD`** — required; the stack refuses to start without it.
  Generate one: `openssl rand -hex 24`.
- **Credential variables** — your mapping references secrets by **env var name**
  (`tokenFromEnv` / `passwordFromEnv`), never inline. Add those variables here,
  e.g. `SOURCE_OAUTH_TOKEN=…`, `TARGET_JMAP_PASSWORD=…`, and match the names in
  your mapping (step 3).
- Optional: `SELFHOST_BIND` (default `127.0.0.1` — localhost only; set to
  `0.0.0.0` to reach `/status` from the LAN, behind your own firewall),
  `SELFHOST_PORT` (the compose files default to `8081`), `SELFHOST_IMAGE` (pin
  to a `stable` tag or a digest for production — see **Upgrades** below).
  (Running the appliance straight from source with `pnpm` and no `PORT` set
  defaults to `8080` — the examples in this guide use the compose port, 8081.)

- **`LOG_LEVEL`** — `error` | `warn` | `info` (default) | `debug`. Raise it to
  `debug` when a migration is slower than you expect: the appliance then prints
  a per-domain breakdown of where the wall time went (source reads, target
  writes, ledger) and an `overlap` figure showing how much work was genuinely
  in flight at once. An overlap near 1 with a concurrency of 4 means the pass is
  running serially, which is a configuration problem rather than a slow server.

`.env` is git-ignored; never commit a filled-in copy.

### Metrics

The appliance serves Prometheus metrics at **`GET /metrics`** on the same port as
`/status` — items migrated and failed, bytes transferred, pass duration, per-item
latency by phase, and `openmigrate_pass_overlap_ratio` (how much work was in
flight; near 1 means the pass ran serially). Point a scrape at it, or read it
with `curl`:

```bash
curl -s http://127.0.0.1:${SELFHOST_PORT:-8081}/metrics
```

`/status` also carries a `lastPass` block per domain with the same timings, if
you would rather read JSON than set up a scraper.

Metric labels are **tenant, mapping and domain identifiers only** — never
addresses or folder names. Job metadata is personal data, and a metrics store
has different retention and access than the migration ledger.

## 3. Add a mapping

Every `*.json` under `deploy/selfhost/config/` is loaded and scheduled on
startup (files ending in `.example` are ignored). Start from the template:

```sh
cp deploy/selfhost/config/mapping.json.example \
   deploy/selfhost/config/mapping.json
```

Edit `mapping.json` — set the source/target hosts and users, point
`tokenFromEnv` / `passwordFromEnv` at the variable names you defined in `.env`,
and set a `schedule.cron` (default is every 15 min). The mail domain uses the
top-level `source`/`target`; to also sync calendar/contacts/files, add a
`domains` block (see `packages/shared/src/config.ts` for the schema). Invalid or
duplicate-`mappingId` files fail fast on startup with the offending path.

## 4. Start it

```sh
docker compose -f deploy/selfhost/compose.yml up -d
```

Postgres comes up and passes its healthcheck → the app applies the ledger
migrations under an advisory lock → the app becomes healthy. Check it:

```sh
curl -s http://127.0.0.1:8081/healthz          # {"status":"ok"}
docker compose -f deploy/selfhost/compose.yml logs -f app
```

A new mapping loads **paused** — it is not scheduled yet. In the background the
appliance runs a read-only, body-free **discovery** pass against your source
(counting mailboxes/messages, calendars/events, address books/contacts,
drives/files — never fetching content) and stores the counts.

### No Postgres server: the PGlite variant (ADR-0028)

The appliance can run with **no Postgres container at all** — PGlite is
Postgres compiled to WASM running in-process, so the database becomes a
directory inside the app's own state volume. Same SQL, same migrations, same
RLS; the *server* goes away, not Postgres. Start it with the override file:

```sh
docker compose -f deploy/selfhost/compose.yml \
               -f deploy/selfhost/compose.pglite.yml up -d
```

The override sets `SELFHOST_PERSISTENCE=pglite` and
`SELFHOST_PGLITE_DIR=/data/state/pglite`; `DATABASE_URL` and
`POSTGRES_PASSWORD` are simply not used on this path. Everything else in this
guide — ports, config directory, every URL — is identical. Two differences
that matter:

- **One container instead of two**, and nothing listening on the Postgres
  port. This is the shape the future native Windows installer ships
  (workplan 0015).
- **Backups work differently** — there is no `pg_dump`; see the Backup
  section below.

The local-disk warning above applies unchanged: the PGlite directory is still
a Postgres data directory and must not live on a network share.

## 5. Review & confirm

**One question worth answering before you start: should your Deleted Items and
Junk come along?**

By default they do **not**. Almost nobody wants a fresh mailbox pre-loaded with
mail they threw away, and until this was asked the tool copied it anyway — not
as a decision, just as what listing every folder did.

The confirm screen shows what will be left behind and how many items are in it,
so it is a choice rather than a surprise. If you keep Deleted Items as an
archive, say so in the mapping:

```yaml
# Migrate everything, trash and junk included:
excludeSpecialUse: []

# Or just drop the spam, keep deleted mail:
excludeSpecialUse: ['junk']
```

Accepted roles are the RFC 6154 ones: `inbox`, `sent`, `drafts`, `archive`,
`junk`, `trash`, `normal`. A name that is not one of those is rejected at
startup rather than silently ignored — a typo here would migrate exactly the
thing you asked to leave behind.

There is a second reason to leave the trash out, which matters later. Something
sitting in Deleted Items is *proof* the owner deleted it. That is much better
evidence than "it stopped appearing", which is all the deletions queue
(§8 below) otherwise has to work from. Keeping the trash out of scope as content
is what makes it usable as a signal.

Mail only for now: calendars and address books have no trash in their listing,
and the Nextcloud file trashbin lives at an endpoint the tool does not read.



Open `http://127.0.0.1:8081/` in a browser (or over the LAN if you set
`SELFHOST_BIND=0.0.0.0`) — the root redirects to the confirm screen at
`/ui/confirm`, part of the shared operating UI (ADR-0026). For each
configured mapping you'll see the discovery
counts as they land, next to the scope manifest — what migrates, what's
partial, and what's explicitly **not** migrated (SAD §11.2, "no silent
omissions"). Nothing has been copied yet. Once you're satisfied, click
**Start migration** — this flips the mapping `paused`→`active` and the
in-process scheduler picks it up on its normal cron from then on.

The same information is available as JSON, if you'd rather script it:

```sh
curl -s http://127.0.0.1:8081/scope-manifest | jq   # what migrates / partial / does not
curl -s http://127.0.0.1:8081/discovery | jq         # per-mapping discovery counts
curl -si -X POST http://127.0.0.1:8081/mappings/<mappingId>/start   # green light
```

`POST /mappings/:id/start` is idempotent (a second click on an already-active
mapping is a no-op) and refuses with `409` once the mapping has moved on to
`cutover`/`done`.

The first scheduled pass after confirming is a **shadow pass**: it reads the
source and writes to the target idempotently. Re-runs converge — nothing is
duplicated.

## 6. Read `/status`

```sh
curl -s http://127.0.0.1:8081/status | jq
```

You get per-mapping, per-domain state derived from the ledger: `state`
(pending/in_progress/completed/failed/skipped), `itemsSynced`, `itemsFailed`,
`bytesTransferred`, `lastSyncedAt`, and `lastError` **verbatim** when a domain
failed (nothing is masked). Each domain also carries `itemsRetrying` and
`itemsNeedingDecision` — see the next section. `/status` only ever surfaces
those fields — it never echoes your config or credentials.

## 7. Items that would not migrate

A single item can fail for reasons that have nothing to do with the rest of the
migration: a corrupt file, a message the source will not hand over, a calendar
object the target rejects. **One such item does not stop its domain.** The pass
records it, steps over it, and carries on; everything else keeps moving.

Each failed item is retried automatically on the next few passes. Most failures
are transient and resolve themselves. After **5 attempts** an item stops being
retried and waits for you.

```sh
curl -s http://127.0.0.1:8081/failures | jq
```

You get two lists per mapping:

- **`retrying`** — still being attempted on every pass. **No action needed.**
- **`needsDecision`** — out of automatic attempts. These will **not** be on the
  target when you cut over unless you act.

Each entry carries `attempts`, `lastAttemptAt`, the server's error **verbatim**
in `lastError`, and a `naturalKeyHash` that identifies the item. (The hash, not
the file path or address — that identifier is enough to act on and keeps
personal data out of a response you might paste into a ticket.)

### What to do about one

Read `lastError` first; it is the whole reason the queue exists. Then choose:

**Retry** — you have fixed the cause (freed disk space, restored a permission,
raised a quota):

```sh
curl -X POST http://127.0.0.1:8081/mappings/<mappingId>/failures/<naturalKeyHash>/retry
```

Attempts reset to zero and the item is tried again on the next scheduled pass.
This also clears the mapping's sync cursors, so the next pass re-lists in full
and the item is certain to be seen again. That costs one slower pass and
nothing else — re-listing is idempotent, never a re-copy.

**Accept (leave behind)** — the item cannot be migrated and you want to proceed
without it:

```sh
curl -X POST http://127.0.0.1:8081/mappings/<mappingId>/failures/<naturalKeyHash>/accept
```

Permanent. The item stops being retried, and stops counting as missing at the
verification gate — so it no longer blocks cutover. The ledger keeps the row and
the error as the record of what you decided and why. Nothing is deleted from
the source.

**Do nothing** — fine for anything under `retrying`, and fine for
`needsDecision` too if you are not ready. The items simply stay in the queue,
and the verification report (`POST /verify/start`, then `GET /verify/report`)
keeps counting them as missing on the target, which is accurate.

> **A whole domain can still stop.** If 25 items fail in a row, the pass stops
> with a clear error instead of failing every remaining item the same way. That
> pattern means the problem is the connection, not the items — an expired
> credential, a target that is down, a full disk. Fix that and the next pass
> picks up where it left off.

## 8. Keep working while it runs — what is safe, and what is not

The whole point of shadow sync is that nobody has to down tools. The two sides
are not symmetrical, though, and it is worth telling whoever uses these accounts.

**In the OLD system, do anything.** New mail, edited events, deleted files,
reorganised folders — all handled.

Nothing you delete in the old system is deleted in the new one **by default**.
Instead it is reported at `GET /deletions`, and you say what you want:

```sh
curl -s http://127.0.0.1:8081/deletions | jq
curl -X POST http://127.0.0.1:8081/mappings/<mappingId>/deletions/<naturalKeyHash>/keep
```

How quickly it shows up depends on how we found out, which each entry states as
`evidence`:

- **`reported`** — for calendar events and contacts, the old server tells us
  outright which objects it removed, so the entry appears on the next pass.
- **`trashed`** — for mail, we find the message sitting in Deleted Items; for
  Nextcloud files, we find it in the account's trashbin, which records where each
  file came from. Also on the next pass: the old system's own filing is the
  evidence, and there is nothing to wait for.
- **`inferred`** — for a plain WebDAV server there is neither, so we go by the item
  having vanished from **two consecutive** complete scans. One absence is not
  evidence: a throttled listing or a connector having a bad ten minutes looks
  exactly the same. If it reappears the count starts again from zero.

Migrating from OneDrive or SharePoint gets `reported` for files too: the Graph delta
query names what was deleted, the same way CalDAV does.

Two things about the mail one. It works *because* Deleted Items is left behind
(§5) — if you set `excludeSpecialUse: []` so the bin is migrated too, it stops
being read as a signal. And Junk is never treated as a deletion: a message in there
was probably put there by a spam filter, not by a person.

One about the file one: Nextcloud puts a deleted **folder** in the bin as a single
entry, so the files that were inside it are not named individually. They are still
caught, two passes later, as `inferred` — they have vanished from a complete
listing.

"Keep" — the new system holds on to its copy — is the usual and expected answer.
A migration target that is a slightly fuller archive than the shrinking source is
working as designed. If you genuinely want something gone, delete it in the new
system yourself — or, for `reported`/`trashed` evidence, ask this tool to do it:

```sh
curl -X POST http://127.0.0.1:8081/mappings/<mappingId>/deletions/<naturalKeyHash>/apply
```

This is the ONE call in the whole appliance that deletes anything, so it is off
by default. Add `"allowApplyDeletions": true` to the mapping's config to turn it
on, and read the full write-up — the gates it checks, what "removed" means per
target, and why a reappearing tombstoned item is never quietly re-copied — in
the operator runbook before using it.

Items you *move* are noticed and reported the same way (`GET /moves`), never
acted on.

**In the NEW system, before cutover:**

| Safe | Why |
|---|---|
| Browsing and reading anything | Nothing here writes to the source. |
| Creating brand-new items | The migration never touches them. Verification lists them as `extraOnTarget`, a warning that does not block cutover. |

| Avoid | What happens if you do |
|---|---|
| Editing an item the migration copied | The migration will not overwrite your edit — it checks the target's ETag first and backs off. But that item then stops receiving further updates from the old system, so the two versions diverge from that point. |
| Deleting an item the migration copied | It does **not** come back, and it counts as missing at the verification gate — which will block cutover until you decide about it. |

The edit protection is real but it has an edge: items copied by an older build,
and items on a server that returns no ETag, carry no recorded version and are
still overwritten by a later source change. The protection starts the first time
an item is written after upgrading.

```sh
# Items whose target copy was edited, so a source change was NOT applied:
docker compose -f compose.yml logs app | grep 'changed on the source, but'
```

## Backup (do this before every upgrade)

The Postgres volume is the appliance's state (the ledger + cursors). Back it up
with a portable dump:

```sh
docker compose -f deploy/selfhost/compose.yml exec postgres \
  pg_dump -U openmigrate -d openmigrate > openmigrate-$(date +%F).sql
```

Keep the dump off the host. Restore into a fresh volume with `psql` if needed.

**On the PGlite variant there is no `pg_dump`** — no server to connect to.
The database is the `pglite` directory inside the app's state volume; back it
up by copying that directory **while the appliance is stopped** (a copy taken
mid-write is not a consistent snapshot):

```sh
docker compose -f deploy/selfhost/compose.yml -f deploy/selfhost/compose.pglite.yml stop app
# Find the state volume's real name first (compose prefixes it with the
# project name): docker volume ls | grep appdata
docker run --rm -v <project>_appdata:/data -v "$PWD":/backup alpine \
  tar czf /backup/openmigrate-pglite-$(date +%F).tar.gz -C /data state/pglite
docker compose -f deploy/selfhost/compose.yml -f deploy/selfhost/compose.pglite.yml start app
```

Restore by untarring into the volume the same way, again with the app stopped.

> **Recovery (ADR-0020): ledger loss ≠ data loss.** The ledger records what was
> migrated; the migrated data lives on the **target**. If you lose the ledger,
> a reindex rebuilds it from the target and the next pass resumes correctly —
> you don't re-copy everything. Still, backing up the volume saves that rework.

## Upgrades

The appliance is safe to upgrade in place:

```sh
# 1. BACK UP the volume first (above).
# 2. Pin/pull the new image (edit SELFHOST_IMAGE in .env, or pull the tag).
docker compose -f deploy/selfhost/compose.yml pull app
# 3. Recreate — migrations auto-apply under the advisory lock on startup.
docker compose -f deploy/selfhost/compose.yml up -d
```

Rules of the road (§22.1):

- **Never run two app versions against one database.** Bring the old one down
  before the new one up (compose `up -d` recreates in place, which is fine).
- **No downgrades.** If you start an app image **older** than the DB schema, the
  startup runner **refuses to start** (the downgrade guard) rather than risk the
  data — roll forward, or restore the matching backup.
- **Channels.** `edge` is the rolling build from `main` (good for trying it);
  `stable` is a promoted release. Pin production to a `stable` tag or an
  immutable `sha256` digest so upgrades are deliberate.

## Stopping / removing

```sh
docker compose -f deploy/selfhost/compose.yml down          # stop, keep data
docker compose -f deploy/selfhost/compose.yml down -v       # ALSO delete the DB volume
```

## Troubleshooting

- **App unhealthy / restarts:** `… logs app`. A bad `mapping.json` prints the
  offending path; a source/target auth failure shows up as a domain `lastError`
  in `/status`.
- **`POSTGRES_PASSWORD` error on `up`:** it's unset in `.env`.
- **Can't reach `/status` from another machine:** it binds to localhost by
  default — set `SELFHOST_BIND=0.0.0.0` (and firewall it).

See also: `deploy/selfhost/README.md` (file layout + channels) and
`docs/workplans/0010-selfhost-edition.md` (design + acceptance).
