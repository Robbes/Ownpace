# Self-host appliance (`deploy/selfhost/`)

A single-tenant bundle for a NAS / mini-PC / Pi: one **app** container that
migrates itself on startup, schedules your mappings with an in-process
scheduler, and serves a local status endpoint + the operating UI — backed by
either a small **bundled Postgres** (default) or **embedded PGlite** (no
database container at all, ADR-0028). No Trigger.dev, no billing — hard
rule 5 (see `docs/workplans/0010-selfhost-edition.md`).

## Quick start

```sh
cp deploy/selfhost/selfhost.env.example deploy/selfhost/.env
chmod 600 deploy/selfhost/.env                       # then set POSTGRES_PASSWORD + creds
cp deploy/selfhost/config/mapping.json.example \
   deploy/selfhost/config/mapping.json               # then edit (one file per mapping)
docker compose -f deploy/selfhost/compose.yml up -d
curl -s http://127.0.0.1:8081/status | jq            # per-domain state

# Or with NO Postgres server (single container, embedded PGlite):
docker compose -f deploy/selfhost/compose.yml \
               -f deploy/selfhost/compose.pglite.yml up -d
```

The full NAS/Pi/WSL2 walkthrough, backup (different on PGlite — no
`pg_dump`), and upgrade guidance live in `docs/selfhost-quickstart.md`.

## Files

| Path | What |
|---|---|
| `compose.yml` | The two-service stack (bundled Postgres + app). |
| `compose.pglite.yml` | Override: drops the Postgres service, `SELFHOST_PERSISTENCE=pglite` — the single-container shape (and what the future native installer ships, workplan 0015). |
| `compose.dev.yml` | Dev conveniences (source mounts); not for production. |
| `selfhost.env.example` | Env template — copy to `.env`, `chmod 600`. |
| `config/*.json` | Your mapping configs (each is scheduled). `*.example` is ignored. |
| `setup-stalwart.sh` / `setup-nextcloud-users.sh` | Test/e2e target provisioning (Stalwart's two-phase bring-up can't be one compose service). |
| `../../apps/selfhost/Dockerfile` | The app image (source-ships-TS, runs under `tsx`). |

## Image channels (§22.1)

What `images.yml` actually publishes to ghcr (0025 T1/T3 — this section said
"stable" before any pipeline existed; these are the real channels):

- **`edge`** — built from `main` on every merge, multi-arch (amd64+arm64),
  cosign-signed. What the example env pins by default; fine for trying the
  appliance, not for unattended production.
- **`sha-<commit>`** — every `edge` publish also lands under its commit, so
  any past build stays addressable.
- **`X.Y.Z`** — published when a release tag is cut. The first is
  **`0.1.0-rc.1`** (2026-08-04, prerelease). **`latest`** appears only with
  the first non-prerelease tag — SemVer's hyphen rule, enforced by
  metadata-action's `latest=auto` — so as long as only rc tags exist there is
  deliberately no `latest`, and production pinning means a version or a
  digest.

**Pin production to a digest**, so an upgrade is a deliberate act and the ref
is immutable. Verify the signature first — the image is signed by this repo's
workflow identity, keyless, in the public Sigstore log:

```sh
cosign verify \
  --certificate-identity-regexp 'https://github.com/Robbes/(ownpace|Ownpace)' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/robbes/ownpace-selfhost:edge
# The digest is in the verify output (and in
# `docker buildx imagetools inspect ghcr.io/robbes/ownpace-selfhost:edge`).
# Then, in .env:
SELFHOST_IMAGE=ghcr.io/robbes/ownpace-selfhost@sha256:<digest>
```

Always **back up the `/data` Postgres volume before upgrading**, and never run
two app versions against one database (the startup downgrade guard refuses a
binary older than the DB schema — §22.1). Upgrade = pull the new tag → `up -d` →
migrations auto-apply under the advisory lock.

> **DB volume must be local.** Never place the Postgres volume on a network
> filesystem (SMB/NFS) — corruption risk. Use a local disk/SSD on the host.
