# Operator Runbook — Managed Edition

Operational procedures for whoever runs the **managed** control plane (the multi-tenant service),
as distinct from a self-host owner running the single-tenant appliance (see the future
`selfhost-quickstart.md`). Stack definition: [`deploy/compose/managed.yml`](../deploy/compose/managed.yml).

> **Scope note (rewritten 2026-08-01, workplan 0020 T4).** This runbook's managed half now
> describes the REAL bring-up, verified live: the full compose stack including the Trigger.dev
> execution plane (registry, supervisor, ClickHouse, MinIO, the TLS front), the scripted task
> deploy, and `smoke-managed.sh` as the acceptance test. **One execution plane** (workplan
> 0022, per the 0020 T8 owner decision): syncs are started by the `managed-sync-tick`
> scheduled task, and every job — sync, verify, apply, discovery — executes as a deployed
> Trigger.dev task. There is no worker/poller container. The appliance-flavored sections
> further down (127.0.0.1:8080 URLs) are workplan 0021's to fix.

## What the operator can and cannot see

This is a core promise of the architecture (SAD §17, §17.1), not just a policy:

- **Can see:** job **status** and **metadata** — run state, counts, byte totals, errors, sync
  freshness, tenant/mapping ids, addresses and folder names. Note that even metadata (addresses,
  folder names) is **personal data** under GDPR (§17 metadata nuance); handle it accordingly.
- **Cannot see:** **message/file content.** The engines move data directly source → target;
  content never flows through the orchestrator or the control-plane DB. Never add a code path that
  routes content through Trigger.dev payloads or logs (AGENTS.md §12/§17; job payloads carry **ids
  only**).
- **Roles** (§4/§17): tenant **admin** (controller), **operator** (processor — status/ops, no
  content), **support** (read-only status/logs, no content). The operator role must never gain a
  content path.

## Prerequisites

- Docker + Docker Compose v2 on the host.
- `pnpm install` run in the repo (the seed, the deploy CLI wrapper and the env-var/smoke
  scripts use workspace `node_modules`).
- A filled-in env file, with every required secret present. The compose file has **no
  defaults for secrets** (0020 T2) — a missing value fails the `up`, loudly:
  ```
  cd deploy/compose
  cp managed.env.example .env
  # edit .env — set POSTGRES_PASSWORD, APP_DB_PASSWORD, NEXTCLOUD_ADMIN_PASSWORD, ports…
  ./ensure-env-secrets.sh   # generates every still-blank required secret (idempotent —
                            # it NEVER touches a value you already set)
  ```
  Compose auto-loads `.env` from the compose file's directory. To keep it elsewhere, pass
  `--env-file <path>`. The API also refuses to **boot** in production with a
  known-placeholder `JWT_SECRET` — with the tenant-membership gate (0020 T1), that secret
  is the tenancy boundary.

### The two database roles (why there are two DB URLs)

Migration `0009` creates a **non-owner `app_user`** role. RLS is enforced through it:

- `DATABASE_URL` → the DB **owner** (`POSTGRES_USER`). In the postgres image the bootstrap user is a
  **superuser**, which **bypasses RLS even under FORCE**. Used only for **migrations** and the
  **demo seed** — never for the request path.
- `APP_DATABASE_URL` → the **`app_user`** role. The API and worker connect through this for all
  tenant data, so row-level security is always in force (workplan 0011 T1). If you ever point the
  app at the owner URL, tenant isolation silently disappears — don't.

Change `APP_DB_PASSWORD` from the migration default (`app_password`) before any real deployment, and
rotate it in the DB (`ALTER ROLE app_user PASSWORD …`) to match.

## Start / stop

Bring up the WHOLE stack — the trigger execution plane (registry, docker-proxy, supervisor,
ClickHouse, MinIO, the TLS front) is not optional garnish: a stack without the supervisor
accepts every enqueue and executes none of them, and the 2026-08-01 bring-up proved the
dashboard genuinely queries ClickHouse (its absence killed the webapp process, not a page).

```bash
cd deploy/compose

# Everything, in dependency order (healthchecks gate the app tier):
docker compose -f managed.yml up -d --build

# Migrations: the API runs them itself at boot (packages/ledger migration runner,
# under an advisory lock, idempotent). There is deliberately NO initdb mount of the
# migration files — initdb applies them without schema_migrations bookkeeping and
# the squashed baseline is not idempotent, so the API's own migrator would then
# re-apply it and crash (the comment in managed.yml records this).

# Status / logs (status only — no content is ever logged):
docker compose -f managed.yml ps
docker compose -f managed.yml logs -f api worker

# Stop (keep data):
docker compose -f managed.yml stop
# Tear down (KEEP volumes):
docker compose -f managed.yml down
# Tear down and DELETE all data (destructive):
docker compose -f managed.yml down -v
```

**Env changes need a recreate, not a restart.** `docker compose up -d` recreates only
services whose configuration changed *as compose sees it*; a container that shows
`Running 0.0s` in the `up` output kept its old environment. After editing `.env` for a
running service, force it: `docker compose -f managed.yml up -d --force-recreate <service>`
— the live symptom that teaches this the hard way is changing the `TRIGGER_*_ORIGIN`s and
getting a white screen from a dashboard still advertising the old origins.

### The trigger dashboard's TLS front (`trigger-tls`)

The dashboard runs production-mode Secure cookies, so login is unusable over plain http
from anything but localhost. The `trigger-tls` service (Caddy, `tls internal`) serves
`https://$TRIGGER_TLS_HOST:$TRIGGER_TLS_PORT` for browsers. The origin split is
deliberate and load-bearing:

- `TRIGGER_APP_ORIGIN` / `TRIGGER_LOGIN_ORIGIN` → the **https** front (browsers).
- `TRIGGER_API_ORIGIN` → **`http://localhost:3090`**, always. The deploy CLI follows the
  server-advertised API origin; pointing it at a self-signed https front fails deploys
  with a bare "Connection error".

Set `TRIGGER_TLS_HOST` to the address browsers actually use (e.g. the machine's VPN IP) —
it is both the certificate's subject and the SNI default for IP-connecting browsers, and
both rules exist because their absence fails as a silent TLS handshake death, not an HTTP
error (`trigger-tls.Caddyfile` documents this). The certificate is internally minted, so
the first visit needs the browser's "accept the risk" step.

### Alternative: run apps from source (no image build)

To iterate without rebuilding images, run the three app services from source against the compose
Postgres (the DB port is published on `POSTGRES_PORT`, default 5432):

```bash
export DATABASE_URL="postgres://openmigrate:<POSTGRES_PASSWORD>@localhost:5432/openmigrate"
export APP_DATABASE_URL="postgres://app_user:<APP_DB_PASSWORD>@localhost:5432/openmigrate"
export JWT_SECRET="<same value as in .env>"
pnpm --filter @openmig/api dev       # API on :3001
pnpm --filter @openmig/web dev       # Web (Vite) dev server
pnpm --filter @openmig/worker dev    # Worker
```

## Seed a demo (two-tenant DoD journey)

Seeds two demo tenants — each with an owner, a source/target connection, mailboxes, and a mapping —
and prints a **demo owner JWT** for each (there is no password-login endpoint yet; auth is
bearer-token only). Idempotent: safe to re-run (see the script's header for the one exception —
credential rotation).

The demo tenants point at a **real backend** (not fake config) so a shadow pass can actually
complete instead of failing at "no credentials configured": Tenant A syncs mail against a demo
Stalwart, Tenant B syncs calendar/contact/file against a demo Nextcloud. Provision that backend
first:

```bash
# 1. With the stack up (see Start/stop), provision the demo mail (Stalwart) +
#    DAV (Nextcloud) accounts. Joins Stalwart to the compose network.
./setup-managed-demo.sh

# 2. Seed the two demo tenants, pointed at the accounts just created.
#    Runs as the DB owner (bypasses RLS to create tenants); JWT_SECRET and
#    SECRET_ENCRYPTION_KEY must match the API/worker's .env values — source
#    them from the same file the stack runs on:
cd ..              # repo root
set -a; source deploy/compose/.env; set +a
DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB}" \
  pnpm --filter @openmig/api seed:managed

# The managed-sync-tick scheduled task (deployed via deploy-tasks.sh) picks
# up the seeded mappings within a minute and starts their sync passes on
# each mapping's own schedule (default */15).
```

Use each printed token as `Authorization: Bearer <token>` against the API, or drop it into the web
app's stored auth token, to sign in as that tenant. **Tokens must belong to seeded members**: since
the tenant-membership gate (0020 T1), `authenticate` confirms `(tenantId, sub)` against
`tenant_member` and takes the role from that row — a hand-minted token with an arbitrary sub gets
a 403 *by design*, however valid its signature. The seed's members are `demo-owner-a` (tenant A)
and `demo-owner-b` (tenant B). The **cross-tenant check** is the acceptance centerpiece: tenant
B's token must never read or affect tenant A's data through any path — verified at the SQL layer
(RLS) and the HTTP layer (the T1/T2 integration tests).

## Deploying the Trigger.dev tasks (verify + apply run through these)

The API's verify/apply routes enqueue jobs; without deployed tasks and a running supervisor,
every enqueue lands `failed` with the reason (by design — never silently). Full background:
workplan 0018.

**One-time setup (per fresh trigger-db volume):**

1. Open the dashboard — `https://$TRIGGER_TLS_HOST:$TRIGGER_TLS_PORT` — and enter an email.
   There is no SMTP: fetch the magic link from the logs and open it in the same browser:
   ```bash
   docker logs trigger-api 2>&1 | grep -o 'https://[^ ]*magic[^ ]*' | tail -1
   ```
2. Create an org + project in the dashboard. Copy the project ref (`proj_…`) into `.env` as
   `TRIGGER_PROJECT_REF`.
3. Read the prod API key from the trigger DB and set it in `.env` as `TRIGGER_SECRET_KEY`
   (the dashboard shows it too, under API keys):
   ```bash
   docker exec trigger-db psql -U trigger -d triggerdb -Atc \
     "SELECT e.\"apiKey\" FROM \"RuntimeEnvironment\" e JOIN \"Project\" p ON p.id = e.\"projectId\" WHERE e.slug = 'prod' ORDER BY e.\"createdAt\" DESC LIMIT 1"
   ```
4. Recreate the api/worker so they pick up the new values:
   `docker compose -f managed.yml up -d --force-recreate api worker`
5. Upload the task-runtime env vars (task containers inherit NOTHING from compose):
   ```bash
   ./deploy/compose/set-task-env.sh
   ```
   Re-run it after any rotation of the values it uploads; the dashboard's env page is never
   load-bearing.

**Deploy (every code change to `apps/worker/src/jobs/*` or its dependencies):**

```bash
./deploy/compose/deploy-tasks.sh
```

Idempotent; pins the CLI to the SDK version; preflights reachability, project ref and login.
On a non-amd64 host set `DEPLOY_IMAGE_PLATFORM` in `.env` (e.g. `linux/arm64`) — the platform
is decided server-side and handed to the CLI, and a mismatch produces runners that die at
exec in under a second with `AutoRemove` destroying the evidence.

**Acceptance — after ANY stack change:**

```bash
./deploy/compose/smoke-managed.sh
```

Runs the live verify + apply loop end to end (seeded-member tokens, poll to terminal,
runner-log capture, guarded evidence cleanup) and exits non-zero unless verify lands `done`
and apply lands `applied` or `refused`. A green CI says nothing about this machine; the
smoke does. Its evidence file is **secret-bearing** (runner logs print the task env).

## Backup & restore (§22.1)

**Back up the control-plane DB before every migration/upgrade.** Schema rollback is hard —
we prefer roll-forward + backups.

```bash
# Logical backup (portable):
docker compose -f managed.yml exec -T postgres \
  pg_dump -U openmigrate -d openmigrate --format=custom > backup-$(date +%F).dump

# Restore into a fresh DB:
docker compose -f managed.yml exec -T postgres \
  pg_restore -U openmigrate -d openmigrate --clean --if-exists < backup-YYYY-MM-DD.dump
```

Notes:
- The ledger is a **rebuildable cache** (ADR-0020): even without a ledger backup, a reindex/adopt
  from the target rehydrates idempotency state. Back up the DB anyway — it also holds tenant,
  member, mapping, billing, and audit rows that are not derivable from the target.
- Never run two app versions against one DB (§22.1). Migrate, verify, then deploy.

## Upgrade

1. Back up the DB (above).
2. Pull the new images / new code.
3. Apply migrations as a **gated step** — run and verify before/with the deploy (§22.1). Migrations
   are linear and idempotent; a runner applies only unapplied versions.
4. Start the new app tier; watch health checks and per-tenant run success.
5. Roll-forward preferred; if a release misbehaves, restore from backup rather than reversing schema.

## Tenant offboarding (GDPR right to erasure, §17)

Erasure = **revoke access, then purge data + ledger + logs** for that tenant.

1. **Revoke access.** With local JWTs there is no server-side session to kill, so:
   - Rotate `JWT_SECRET` to invalidate all outstanding tokens (affects every tenant — prefer
     short token lifetimes; see the seam for per-tenant/JWKS revocation when SSO lands), **or**
   - Suspend the tenant: set `tenant.status = 'suspended'` and `tenant_member.status = 'suspended'`
     so the app rejects the tenant even with a valid token.
2. **Purge.** Delete the tenant row; `ON DELETE CASCADE` removes all tenant-scoped rows
   (connections, mailboxes, mappings, items, runs, events, usage, invoices, payment methods, audit
   log). Because RLS is tenant-scoped, do this as the owner with the tenant context set, or via a
   dedicated purge routine. Verify zero residual rows for the tenant id across tenant-scoped tables.
3. **Logs.** Ensure no content was ever logged (it isn't, by design); purge status/metadata logs
   that reference the tenant per your retention policy. Metadata is personal data too.
4. **Record** the erasure in your DPA/audit process (operator = processor).

> A dedicated, audited purge endpoint/job is the correct home for steps 1–3; until it exists,
> perform them deliberately as the DB owner and record what was purged.

> **The three decision queues now have a UI as well as these endpoints**
> ([ADR-0026](adr/0026-one-operating-ui-one-contract.md)). The appliance serves
> it at **`http://127.0.0.1:8081/ui`** — note the `/ui` prefix, which exists
> because `/deletions`, `/moves` and `/failures` are already JSON endpoints on
> that same port and are also screen names. Everything documented below by its
> HTTP route is also a screen, showing the same fields and the same guidance
> text, because both are rendered from one shared contract.
>
> The `curl` recipes here stay correct and remain the reference: they are what
> the screens call, and what a script should use. `verify` and `finish` have
> screens too — see "Finishing a migration" below, where the finish screen walks
> the cutover sequence in order rather than offering a bare button.
>
> If `/ui` reports that the UI has not been built, the appliance is running from
> a source checkout rather than the image; build it with
> `pnpm --filter @openmig/web build:selfhost`. The JSON endpoints work either
> way.

## Items that would not migrate

One unmigratable item does not stop its domain: the pass records it, steps over
it and carries on. Failures are retried automatically for 5 attempts, then park
and wait for a person.

| Where | What it tells you |
|---|---|
| `GET /status` | `itemsRetrying` and `itemsNeedingDecision` per domain |
| `GET /failures` | the queue itself, with `attempts` and the verbatim `lastError` |
| `openmigrate_items_needing_decision` | Prometheus gauge; non-zero means a cutover would leave data behind |

Three answers, per item:

- **retry** (`POST /mappings/{id}/failures/{hash}/retry`) — the cause is fixed;
  attempts reset and the mapping's cursors are cleared so the item is certainly
  re-listed.
- **accept** (`POST /mappings/{id}/failures/{hash}/accept`) — migrate without
  it. Permanent, and it stops counting as missing at the §20 gate, so it no
  longer blocks cutover. The row and its error remain as the audit trail.
- **nothing** — items under `retrying` need no action; parked items stay
  visible and keep the verification gate honest.

A pass that hits **25 consecutive** failures stops instead: that pattern means
the credential or the target is the problem, not the items.

See `docs/selfhost-quickstart.md` §7 for the full walkthrough.

## What the end user may do while a migration is running

Shadow migration exists so nobody has to stop working. The two sides are not
symmetrical, though, and the difference is worth telling people up front.

### In the OLD system: anything

| They do | What the migration does |
|---|---|
| Create items | Picks them up on the next pass. |
| Edit items | Rewrites the target copy — unless the target copy is theirs, see below. |
| Delete items | Nothing is removed from the target. It is **reported** at `GET /deletions` — at once for mail (we find it in Deleted Items) and for a calendar event or contact (the source names what it removed); after several consecutive complete scans for a file, where the deletion has to be inferred from absence. You decide. See below. |
| Move items, rename folders | Detects and reports it; changes nothing. See the section above. |

### In the NEW system: browse freely, create freely, don't edit or delete ours

| They do | What happens |
|---|---|
| Create new items | Untouched by the migration. Verification lists them as `extraOnTarget`, a WARNING that does not block cutover. |
| **Edit an item the migration put there** | The rewrite is REFUSED and the item becomes theirs for good — see below. |
| **Delete an item the migration put there** | It does **not** come back. The ledger has it as copied, so the pass skips it forever. Verification reports it under `missingOnTarget`, which is an ERROR past the discrepancy threshold. |
| Move an item within the target | Nothing breaks. For files, verification counts the old path as missing and the new one as extra — noisy, not destructive. |
| Delete a target folder | Recreated empty on the next pass; everything that was in it stays gone, and shows up as `missingOnTarget`. |

**Edits are protected, deletions are not.** Every ledger row records the ETag the
target gave us when we wrote the item. Before any rewrite the pass checks the
target still reports it; if it does not, somebody has edited that copy, so
nothing is written, the item is marked `adopted` — the owner's, not ours — and
it is never a candidate for overwrite again. The pass reports it as
`conflicted`, and every later source change to it as `changedButAdopted`.

Two limits worth knowing:

- Rows written before this existed carry no target ETag, and neither do items on
  a server that returns none from a PUT. Those keep the old behaviour: a source
  change overwrites the target copy. The protection begins the first time an
  item is written after upgrading.
- A conflicted item stops receiving source updates permanently. That is the
  conservative answer — we cannot merge two edits — but it means the source and
  target versions of that item diverge from then on, which is exactly what the
  `changedButAdopted` count is telling you.

**Deletions on the target are not repaired**, deliberately: putting an item back
that somebody deleted on purpose would be its own kind of destructive. It is
reported instead, and the §20 gate will not pass a cutover with items missing.

## Items the source no longer has

The owner deleted something in the old system after it had been copied. The new
system still has it.

Nothing is removed here. §11.1 leaves lifecycle to the owner and hard rule 2
forbids this tool deleting on a target — but neither says the owner may not
decide, so the disappearance goes in a queue.

| Where | What it tells you |
|---|---|
| `GET /deletions` | `confirmed`, `watching` and `acknowledged`, each with the collection it vanished from, its `evidence`, and `absentPasses` |
| worker log | one warning per domain per pass, with a count |

**`evidence` is the field to read first.** There are two ways we come to believe
an item is gone, and they are different in kind, not in degree.

| `evidence` | What it means | Confirmed |
|---|---|---|
| `reported` | The source **said so**. A CalDAV/CardDAV server answers an incremental poll with the objects it has removed (RFC 6578 `sync-collection`), naming each one. | At once |
| `trashed` | The owner **put it in the bin**, and it is still sitting there. We are looking at the item in a folder whose RFC 6154 role is `\Trash`, which is the old system's own record that the person deleted it. | At once |
| `inferred` | We **stopped seeing it**. Nobody told us anything. | After two consecutive complete scans |

The first two are **positive** observations — we are looking at something — which is
why neither needs to repeat. `inferred` is the absence of an observation, which is
a much weaker thing.

For an inferred deletion `absentPasses` is the number that matters. We never
observe the deletion — only an absence, and an absence has innocent explanations
that all look identical: a folder briefly missing from discovery, a throttled
listing, a permissions blip, a source connector having a bad ten minutes. So the
item is *watched* until it has been missing from **two consecutive complete
scans**, and only then reported. If it reappears the count resets to zero,
because a run of absences only means something if it is unbroken.

For a reported or trashed deletion `absentPasses` is normally **0**, and that is
not a contradiction: nothing had to go missing for us to know. Waiting for it to
repeat would not make the server's own answer truer, or the item less binned —
only later.

An item that comes back clears everything — the count, the report, the bin
sighting, and any decision. An item really can be deleted and restored (a declined
invitation re-sent, a contact restored from a phone, a message dragged back out of
Deleted Items), and a stale claim that the owner threw something away is the last
thing that should survive the item's return.

Three answers, the same set for both kinds of positive evidence:

- **keep** (`POST /mappings/{id}/deletions/{hash}/keep`) — you are happy for the
  new system to keep its copy. This is the usual answer, and it is what the
  architecture expects: the target becoming a fuller archive than the shrinking
  source is a feature, not a fault.
- **apply** (`POST /mappings/{id}/deletions/{hash}/apply`) — remove the
  target's copy too, following the source. See below: this is the one
  destructive action anywhere in this product, and it is off by default.
- **remove it yourself** — delete it in the target system, then `keep`. This
  tool will never do it for you unless you explicitly call `apply`.

### Removing it on the target too — `apply`

**This is the only operation in the whole product that deletes anything.**
Everything documented above it — failures, moves, the deletions queue itself —
only ever reports. `apply` takes the target's copy away, on an explicit,
per-item decision an operator makes by calling the endpoint. Nothing about it is
automatic, batched, or triggered by a schedule.

It has to be turned on per mapping first:

```json
{
  "tenantId": "...",
  "mappingId": "...",
  "source": { "...": "..." },
  "target": { "...": "..." },
  "allowApplyDeletions": true
}
```

Defaults to `false`. A capability that destroys data must be opted into, never
opted out of — a mapping nobody configured for this cannot delete anything,
however the endpoint is called.

Even switched on, every single call still has to pass **all** of the following
before anything is removed:

1. **Positive evidence only.** `reported` or `trashed` — never `inferred`,
   however many passes an absence has repeated. Absence has innocent causes
   that all look identical, and acting on it is the one thing this feature
   must never do.
2. **This tool wrote it.** Only a `copied` or `updated` item is ours to
   remove. An `adopted` item was on the target before this migration ever ran,
   and hard rule 2 forbids touching it.
3. **Nobody has edited it on the target since.** Checked at the moment of
   removal, against the same ETag the shadow-sync overwrite protection already
   uses. An item you (or anyone else) has changed in the new system is yours
   now, and `apply` leaves it alone and reports `edited_on_target`.
4. **This does not look like a mass-deletion event.** If more than a fifth of
   a domain's migrated items (and there are at least 20 of them) are sitting in
   the deletions queue at once, every `apply` call for that domain is refused
   with `mass_deletion_suspected` until that clears. That pattern is far more
   likely to be a source outage, a restored account, or a connector reading the
   wrong place than an owner deleting a fifth of their own data between two
   passes — and once the evidence looks that wrong in bulk, no single item in
   the queue is trustworthy either, including the one you are looking at.
5. **The target actually supports removal.** Not every writer does yet — see
   the table below.

A call that is refused always says why, in a `reason` you can read as-is —
`not_enabled`, `target_cannot_remove`, `weak_evidence`, `not_ours`,
`edited_on_target`, `mass_deletion_suspected`, `already_applied` are the
distinct codes.

**What "removed" means depends on the target.** The response's `kind` tells you
which you got:

| `kind` | What happened |
|---|---|
| `binned` | Moved to the target's own bin/trash. You (or the account owner) can still get it back for whatever retention window that server keeps — this tool cannot restore it, but the server might. |
| `deleted` | Gone, with no recovery path from here. |

Mail is moved to the account's own `\Trash`-role mailbox when it has one
(`binned`), destroyed outright only when it does not (`deleted`). Nextcloud
files are DELETEd, which Nextcloud's own server puts in its trashbin
(`binned`); a plain WebDAV server has no such bin, so the same DELETE is
`deleted`. Calendar and contact removals always report `deleted` — some
Nextcloud versions do keep a deleted calendar object for a while, but which
versions do is not something this tool can tell from the outside, and
understating recoverability is the direction it is safe to be wrong in.

**A row is never deleted, even after `apply` succeeds.** It is marked
`tombstoned` instead, with the date recorded — the record that the item
existed, was migrated, and was removed on that date by that decision. If the
source somehow lists the same key again afterwards (an owner can legitimately
`apply` a removal for an item the source still has, if the evidence was
`trashed` rather than `reported`), the pass does **not** re-create it — doing
so would silently undo the decision you just made, and this tool has no way to
tell "changed my mind" from "this was an erasure request and putting it back is
a compliance failure". It is reported instead (`reappearedAfterRemoval` in the
pass result, and a warning in the worker log) and the tombstone stands.

Coverage today, by domain:

| Domain | Evidence available | `apply` (removal) supported? |
|---|---|---|
| calendar, contacts | `reported` — the CalDAV/CardDAV `sync-collection` REPORT names removed objects on every incremental poll | Yes — CalDAV/CardDAV writers |
| mail, JMAP target | `trashed` — the owner's Deleted Items is scanned for messages we copied. This is IMAP's only signal: it has no removal report, and a mailbox cannot be enumerated cheaply enough to count absences every pass | Yes — moves to the account's own trash mailbox where it has one |
| mail, IMAP/DAV target | same as above | Yes — moves the message into the mailbox the server flags `\Trash` (RFC 6154), whatever it is named; expunges only where the account has no such mailbox. See the note below |
| files, OneDrive/SharePoint **as a source** | `reported` — a Graph delta query answers with the items that changed *and* the ones deleted, each carrying a `deleted` facet | Whatever the target is. Microsoft is never a target here (see below), so this row's `apply` support is the Nextcloud or plain-WebDAV row, depending on where you are migrating to |
| files, Nextcloud | `trashed` — the account's trashbin is read, and every entry in it carries the original path of the file | Yes — WebDAV writer, DELETEs into Nextcloud's own trashbin |
| files, plain WebDAV | `inferred` — no bin and no delta query, but a collection can be enumerated cheaply and completely, so absence can be established | Yes, mechanically — but `inferred` evidence is never enough to pass gate 1 above, so `apply` will always refuse here regardless |

**Microsoft is a source, never a target.** `apply` is therefore implemented for
every target this product has. The complete target list is `jmap`, `imap-dav`,
`caldav`, `carddav`, `webdav` — five open IETF standards (RFC 8620/8621, 3501,
4791, 6352, 4918) and nothing else; `parseTarget` in `@openmig/shared` rejects
anything outside it. Microsoft Graph appears only as **source** connectors,
which is the direction the product exists to serve: you migrate off Microsoft
365, not onto it. Graph is also Microsoft-only — a proprietary REST API for
Microsoft 365 and Entra, implemented by no other vendor — so it could not be a
portable target even if the direction were wanted.

**The IMAP/DAV mail target needs a collection on the row.** Every other target's
id identifies an object on its own — a JMAP Email id, a DAV href — but an IMAP
UID only means something inside one mailbox, and the same number names a
different message in the next one. `apply` therefore passes the collection
recorded on the ledger row down to the writer, and the writer **refuses** if it
is missing rather than guessing INBOX. Rows written before the collection column
was populated have none, so `apply` will refuse for them; `keep` them and remove
those in the target yourself. The writer also refuses if the mailbox's
UIDVALIDITY no longer matches what was recorded when the message was written —
that means the mailbox has been recreated and every UID in it now names a
different message.

Two limits worth knowing.

Matching a removal report back to an item needs the source's own href on the
ledger row, which is recorded when the item is copied. Items copied before that
existed have no href recorded, so a removal report cannot be matched to them and
they fall back to the inferred path. A UID that is deleted and re-created moves to
a new href, and its row keeps the old one — likewise a fall back to the weaker
signal, not a wrong answer.

The bin scan reports a message that exists in **both** the bin and a live folder,
if the live copy was not listed on that pass — a cursor-limited listing shows only
what changed. The same Message-ID in two folders is ordinary on plenty of servers,
so this does happen. Nothing is removed either way, and it corrects itself: the
next pass that lists that message for any reason clears the claim. The alternative
was to require a complete listing of the whole mailbox before believing anything,
which in production would mean the signal fired on the first pass and never again.

Scanning the mail bin depends on it being **out of scope**. If you set
`excludeSpecialUse: []` so that Deleted Items is migrated as content, it stops
being read as a signal — an item cannot be copied and interpreted as a deletion at
the same time. Junk is never read as a deletion either way: a message in there was
very likely put there by a filter rather than by a person.

Two limits on the **file** bin. A bin is not part of WebDAV — RFC 4918 has no such
concept — so it is Nextcloud's own endpoint, derived from the files URL and probed;
a server that does not serve one reports nothing and stays on absence-counting. And
Nextcloud trashes a **folder** as a single entry, so the files that were inside it
are not individually reported. They are still caught, one step slower, by absence:
they have vanished from a complete listing, so they become `inferred` deletions
after two passes.

### Proving it against your own server

The bin is located by its RFC 6154 `\Trash` flag, never by its name — servers
variously call it Trash, Deleted Items, Deleted Messages or `[Gmail]/Trash`. If
your server presents no `\Trash`-flagged mailbox, mail deletions cannot be
detected, and that is worth knowing before you rely on it.

```sh
# Deletes one already-migrated message the way a mail client does, and prints
# which mailbox it found the flag on. Exits non-zero if there is no bin.
node test/e2e/trash-imap-source.mjs

# Files: deletes two already-migrated files — one plain, one with a space and a
# non-ASCII character — then ASSERTS that the trashbin reports paths in the form
# the natural keys are built from. Exits non-zero on a mismatch, because that
# mismatch makes the feature report nothing rather than fail.
node test/e2e/trash-dav-file-source.mjs

# Calendar: deletes one already-migrated event on the source, the way a client's
# "Delete event" does — a plain DELETE. No bin to read here; `reported` evidence
# comes straight from the next sync-collection REPORT.
node test/e2e/trash-caldav-source.mjs

curl -s http://127.0.0.1:8080/deletions | jq
```

`test/e2e/move-dav-source.mjs` does the equivalent for a relocated calendar event.

The self-host e2e workflow (`.github/workflows/e2e.yml`, manual dispatch only) runs
all three of the above automatically, against a real Nextcloud and a real Stalwart,
as its Apply-Deletion Gate: delete → confirm `GET /deletions` → `apply` → verify
directly against the target server that the copy is actually gone or actually
binned → confirm a second `apply` is refused (`already_applied`) → confirm the
tombstone survives one more sync pass without resurrecting anything. See ADR-0024
and `test/e2e/selfhost-apply-deletion-{file,mail,calendar}.e2e.test.ts` (one file per
domain, run together so vitest's own file-level parallelism runs the three domains
concurrently instead of back to back — see `test/e2e/apply-deletion-lib.ts`'s header).

## Items someone moved on the source

Different problem, different queue. These items copied fine; the owner has since
reorganised the source, so the item is on the target under one folder and the
source lists it under another.

Nothing has been done about it. §11.1 leaves topology to the owner, and making
the target match would mean deleting the copy that is there now — which this
tool never does on its own (hard rule 2).

| Where | What it tells you |
|---|---|
| `GET /moves` | `open` and `acknowledged`, each with `from` and `to` |
| worker log | one warning per domain per pass, with a count |

Two answers, per item:

- **keep** (`POST /mappings/{id}/moves/{hash}/keep`) — the target's layout is
  fine; stop reporting this one. If you want the target to match, move the item
  yourself in the target system first, then keep.
- **nothing** — a move that is undone on the source drops off the list by itself
  on the next pass. Moving the same item somewhere *else* reopens it, because
  agreeing to one arrangement is not agreeing to the next.

Two limits worth knowing. For **files** the item is keyed by its path, so the
pass that first sees the move has already copied the file to its new path — the
target then holds both, and the old one is what `from` points at. For **mail**, a
message that genuinely lives in two folders looks exactly like one that moved;
the pass cannot tell them apart, which is why it reports rather than acts.

## Finishing a migration — cutover and cleanup

A shadow sync runs indefinitely by design: it keeps the new system current while
people still use the old one. At some point the old system stops being the one
that matters, and the sync should stop with it — otherwise the appliance goes on
polling a source nobody uses and reporting drift nobody will act on.

> **This sequence is now also a screen** (`/ui/finish`, ADR-0026), which walks
> the same five steps and will not offer the finish button until step 4 has been
> confirmed. Step 4 is the one the appliance cannot check for itself, and the
> reason the order matters at all: **while a mapping is active, items still
> arriving on the old system are being copied across, and finishing stops that.**
> Finish before delivery has moved and everything that arrives afterwards is
> never copied — with nothing reporting it, because the appliance has stopped
> watching. The steps below the button the tool checks; that one it has to ask.

The order that works:

```sh
# 1. Prove the copy is complete. §20 checks counts, checksums and bytes per
#    domain and tells you whether it is safe to proceed.
curl -s http://127.0.0.1:8080/verify | jq '.[].canProceedToCutover'

# 2. Clear the decision queues. Anything here is a real question:
#    /failures = could not be copied, /moves and /deletions = the owner changed
#    something. Nothing outstanding should be a surprise at this point.
curl -s http://127.0.0.1:8080/failures  | jq
curl -s http://127.0.0.1:8080/moves     | jq
curl -s http://127.0.0.1:8080/deletions | jq

# 3. Run one last pass, so the target reflects the source as of right now.
curl -sX POST http://127.0.0.1:8080/mappings/<mappingId>/run

# 4. Move mail delivery to the new system (MX/DNS, client reconfiguration —
#    outside this tool; `openmig runbook` generates the DNS steps).

# 5. Finish. The mapping stops syncing and stops reporting.
curl -sX POST http://127.0.0.1:8080/mappings/<mappingId>/finish
```

**What `finish` does and does not do.** It sets the mapping to `done` and
unschedules it: no more copying, and no more drift, deletion or move reporting.
It changes **nothing** on either system — everything already on the target stays
exactly as it is. It is a statement about what the tool does next, not an action
on anyone's data.

**It refuses while items are still awaiting a decision** in the failure queue,
because finishing over those quietly turns "we are still working on this" into
"this is what you got". Resolve them first (retry, or accept to leave them
behind), or say so explicitly:

```sh
curl -sX POST 'http://127.0.0.1:8080/mappings/<mappingId>/finish?force=true'
```

The response then reports `leftUnmigrated`, so the choice is on the record.

Finishing is idempotent — a second call says `alreadyDone` rather than pretending
to do work. Afterwards the decision queues still return what was outstanding when
the migration ended, marked `reportingClosed`: kept as a record, no longer a list
of things to do. To resume, set `mailbox_mapping.status` back to `active` and
restart the appliance; to retire the mapping for good, remove it from the config
directory.

**A note on the pass in step 3.** `POST /mappings/{id}/run` runs a pass and
answers when it has finished — useful any time, not just at cutover (after fixing
a credential, say). Runs are single-flight per mapping, so it can never start a
second concurrent pass; if one is already running, your call joins it and returns
when that one ends. That also means the pass you get back may have started before
you asked, so if you need one that definitely saw a specific change, check the
result and run it again if not.

## Health & troubleshooting

- **API/worker won't connect / RLS errors on every query:** confirm `APP_DATABASE_URL` is set and
  points at `app_user` (not the owner), and that migration `0009` ran (the role exists).
- **"fail-closed" errors with no tenant context:** expected when a query runs without
  `app.current_tenant` set — that's RLS doing its job, not a bug. The request path must go through
  `withTenantDb`/`withTenant`.
- **Seed prints tokens but sign-in fails:** `JWT_SECRET` used by the seed must equal the API's —
  and the token's `sub` must be a seeded `tenant_member` (the 0020 T1 gate; arbitrary subs 403).
- **Verify/apply enqueues land `failed` with "Could not enqueue":** tasks not deployed, or the
  supervisor is down — run `deploy-tasks.sh`, check `docker ps` for `trigger-supervisor`, then
  `smoke-managed.sh`.
- **Runner containers die in under a second with no logs:** almost always the image platform —
  set `DEPLOY_IMAGE_PLATFORM` to match `uname -m` and redeploy. `smoke-managed.sh` captures
  runner logs live precisely because `AutoRemove` destroys them.
- **Dashboard Runs page is empty while runs exist in postgres:** the runs LIST is served from
  ClickHouse; without run-replication it renders empty. Cosmetic — ACCEPTED (0020 T7 decision,
  2026-08-01): the smoke and the DB rows are the operational truth, the Tasks tab still works,
  and enabling replication adds moving parts for a page nobody depends on. Revisit only if the
  Runs page becomes someone's tool. Not an outage.
- **White screen / login loop on the dashboard:** two known causes, both env. (1) A missing
  `TRIGGER_TLS_HOST` in `.env` — Caddy falls back to `localhost`, your browser's `Host` header
  matches no site block, and the response is EMPTY (a white screen, not an error; confirmed
  live 2026-08-01). (2) Stale origins — the running trigger-api must advertise the SAME
  origins your browser uses. Either way the fix ends with a recreate:
  `--force-recreate trigger-tls trigger-api` after correcting `.env` (see Start/stop).

## Related docs

- Architecture (source of truth): [`architecture/solution-architecture.md`](./architecture/solution-architecture.md) — §4 roles, §16 cost drivers, §17 security/GDPR, §22.1 releases.
- RLS details: [`rls-guide.md`](./rls-guide.md).
- Workplans: [`0018`](./workplans/0018-trigger-task-deployment.md) (task deployment, closed with
  live evidence), [`0020`](./workplans/0020-managed-stack-productionization.md) (this stack's
  productionization — T8 will decide the polling scheduler's future),
  [`0011`](./workplans/0011-managed-edition-hardening.md) (history).
- Deployment overview: [`deployment.md`](./deployment.md).
