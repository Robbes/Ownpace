# Workplan 0119 — What runs, what is current, and what moves it

## Status — 2026-09-06 (update this block at the end of every session)

**2026-09-06, night: the audit, and the two holes it found.** The owner asked for the
lifecycle of every component to be checked and for upgrades "in a safe manner". Detection
already ran (`security-scan.yml`: Trivy and `pnpm audit`, weekly) and Dependabot already
moved the npm packages and the GitHub Actions, weekly and grouped. What nobody watched was
the **container images**: eighteen image references across three Dockerfiles and four
compose files, none under Dependabot, three of them pinned by digest alone so that no tool
could even say which version they were. Measured on the night of 2026-09-06, against the
registries themselves (§2): four images current, seven behind by a patch or a minor, one
behind by a major, one behind by four patch releases that are one-way, and one whose
upstream has stopped publishing altogether.

Two holes, both closed in T1: Dependabot learns the Dockerfiles and the compose files, and
`@trigger.dev/*` leaves the weekly npm group, because the SDK may only move with the image
(the drift that broke the managed gate on 2026-08-24 was Dependabot moving the SDK alone).
The safe moves are T2, one PR, proven by the image build and both E2E gates. The rest is
a decision each, §3, for the owner.

| Task | Status | Notes |
|---|---|---|
| T0 The audit | ✅ Done 2026-09-06 | §2. Registries queried directly (Docker Hub v2 API, GHCR token + paginated tag list, `git ls-remote` for the actions); `pnpm outdated -r` for npm. |
| T1 Dependabot learns the images | ✅ Done 2026-09-06 | `docker` over the three Dockerfiles, `docker-compose` over `deploy/compose` and `deploy/selfhost`, weekly, minor+patch grouped, majors one PR each. The one-way images and the deliberate pins are ignored by name (§2.1). `@trigger.dev/*` ignored in npm: it moves through `trigger-version.sh` or not at all. The three digest-only pins (`node@sha256:…` ×3, `postgres@sha256:…`) carry their tag now — same digests, no version moved — because Dependabot compares tags, and a bare digest has nothing to compare. |
| T2 The safe moves | 🔨 In progress | node 24.20.0-slim (three Dockerfiles), postgres 18.6-alpine (self-host), pgbouncer v1.25.2-p0, mailpit v1.31.1, busybox 1.38 (compose, three scripts, one test), nginx 1.30-alpine (web image and www). Stateless, or a fixture, or a patch of a store that upgrades in place. One PR, stacked on T1; proof is `images.yml` on the PR plus `e2e.yml` and `e2e-managed.yml` dispatched on the branch. |
| T3 The owner's decisions | ⏸ Waiting on the owner | §3: Trigger.dev v4.5.16, Zitadel v4.17.3, Redis 8, registry 3, the object store with no upstream, `@azure/msal-node` 6, `nodemailer` 10. Each has a reason it is not a patch. |
| T4 vitest 5 | ⏸ Not started | Dev-only major (`vitest`, `@vitest/coverage-v8`). Trial on a branch; a PR only if every suite is green. |

## 1. Why this exists

A component that nobody is responsible for moving does not stay where it is; it falls
behind, silently, until a CVE or a removed tag forces the move on the worst day. This
repository had the detection half (the weekly scan) and, for npm and the actions, the
moving half (Dependabot). For the images it had neither, and the pins were written in
three different shapes: a bare digest (`node@sha256:…`), a tag with a digest
(`axllent/mailpit:v1.31.0@sha256:…`), and a floating tag (`postgres:18-alpine`). Only the
middle shape says what it is *and* what it was when it was pinned.

The rule this workplan settles is short: **everything moves by a tool on a schedule,
except what a person must decide, and those are named.** A patch or a minor of a stateless
image, a fixture, or a store that upgrades in place moves in the weekly group. A major, a
one-way schema migration on the persistent stack, a licence change, or an upstream that has
stopped publishing is a decision, listed in §3 with its reason, and the tool is told to
leave it alone so the decision is not made by a green tick at 06:00 on a Monday.

## 2. The inventory (measured 2026-09-06, 01:45 UTC)

### 2.1 Images

Distance is from the pinned version to the newest published in the same line; *moves by*
is who moves it after T1.

| Image | Where | Pinned | Newest | Distance | Moves by | Decision |
|---|---|---|---|---|---|---|
| `node` (24-slim) | `apps/api`, `apps/web`, `apps/selfhost` Dockerfiles | digest `6f7b03f7…`, no tag | 24.20.0-slim (2026-08-27), digest `ba849c60…` | patches within 24 | Dependabot `docker` | **T2** — and T1 gives it its tag |
| `nginx` | `apps/web/Dockerfile` runtime, `deploy/compose/www.yml` | 1.27-alpine | 1.30.4-alpine stable, 1.31.5 mainline (2026-09-03) | 1.27 is a 2024 mainline, past its end | Dependabot `docker` + `docker-compose` | **T2** — 1.30-alpine, the stable line |
| `postgres` (self-host) | `deploy/selfhost/compose.yml` | digest `9a8afca5…` = 18.4-alpine, no tag | 18.6-alpine (2026-08-15), digest `d3e1620b…` | two patch releases | Dependabot `docker-compose` | **T2** — a patch upgrades in place; `e2e.yml`'s restart-resume proves it |
| `postgres` (managed ×2, dev) | `managed.yml`, `dev.yml` | 18-alpine, floating | 18.6 | none, it floats within 18 | `docker compose pull` | stays floating; a major (`pg_upgrade`) is ignored in Dependabot and is the owner's |
| `edoburu/pgbouncer` | `managed.yml` | v1.24.1-p1 | v1.25.2-p0 (2026-06-10) | one minor | Dependabot `docker-compose` | **T2** — stateless; the managed gate proves it |
| `redis` | `managed.yml` | 7-alpine, floating (7.4.11) | 8.8.2-alpine | one major | owner | **§3** — licence changed at 8.0; 7.4 still receives patches |
| `ghcr.io/triggerdotdev/trigger.dev` + `supervisor` | `managed.yml` ×2, `managed.env.example`, `apps/worker/package.json` | v4.5.12 | v4.5.16 | four patch releases | `trigger-version.sh` only | **§3** — one way (schema migrations); Dependabot told to leave all four places alone |
| `clickhouse/clickhouse-server` | `managed.yml` | 26.2.19.43 by digest | — | — | nobody | stays: pinned to what Trigger.dev's own compose pins, on purpose (`managed-bring-up.md`) |
| `registry` | `managed.yml` | 2, floating | 3.1.1 (2026-06-23) | one major | owner | **§3** — 3.0 changed the configuration file |
| `tecnativa/docker-socket-proxy` | `managed.yml` | v0.5.0 | v0.5.0 | current | Dependabot `docker-compose` | — |
| `bitnamilegacy/minio` | `managed.yml` | 2025.5.24-debian-12-r5 by digest | none: `bitnamilegacy` stopped at 2025.7.23 (pushed 2025-08-19); `minio/minio` stopped at RELEASE.2025-09-07 | no upstream | owner | **§3** — the object store has no maintained free image; a replacement is a decision |
| `caddy` | `managed.yml` | 2-alpine, floating (2.11.4) | 2.11.4 | current | `docker compose pull` | stays floating; a major is ignored and is the owner's |
| `ghcr.io/zitadel/zitadel` | `managed.yml` | v4.17.1 | v4.17.3 | two patch releases | owner | **§3** — migrates its schema on boot; the gate's stack is persistent |
| `busybox` | `managed.yml`; `smoke-managed.sh`, `bootstrap-managed.sh`, `setup-zitadel.sh`; one test pins the printed command | 1.37 | 1.38 | one minor | Dependabot for the compose line; the scripts by hand, and the test says so | **T2** |
| `ghcr.io/twin/gatus` | `managed.yml` | v5.36.0 | v5.36.0 | current | Dependabot `docker-compose` | — |
| `axllent/mailpit` | `managed.yml` | v1.31.0 by digest | v1.31.1, digest `98b916bd…` | one patch | Dependabot `docker-compose` | **T2** — a mail catcher for the gate |
| `nextcloud` | `managed.yml`, `dev.yml` | 34-apache, floating (34.0.3) | 34.0.3 (2026-09-02) | current | `docker compose pull` | stays floating; a fixture and a demo target; a major is ignored |
| `ghcr.io/robbes/ownpace-selfhost` | `deploy/selfhost/compose.yml` | `edge` | ours | — | `images.yml` | — |

Ignored by name in the new Dependabot entries, so that a green tick cannot make these
decisions: the two Trigger.dev images and Zitadel (one way), ClickHouse and the object
store (deliberate pins), and the majors of `postgres`, `redis`, `registry`, `nextcloud`
and `caddy`.

### 2.2 npm (`pnpm outdated -r`, 23 packages)

| Distance | Packages | Moves by |
|---|---|---|
| patch (12) | `@testing-library/user-event`, `@types/node`, `@types/react-dom`, `autoprefixer`, `imapflow`, `jmap-jam`, `jose`, `postcss`, `react-router`, `tsx`; **not** `@trigger.dev/core` and `@trigger.dev/sdk` 4.5.12 → 4.5.16 | Dependabot's Monday group, except the SDK (T1: it moves with the image, §3) |
| minor (7) | `@typescript-eslint/*` and `typescript-eslint` 8.68 → 8.69, `eslint` 10.9 → 10.10, `lucide-react` 1.34 → 1.41, `morgan` 1.11 → 1.12, `zod` 4.4 → 4.5 | Dependabot's Monday group |
| major (4) | `vitest` and `@vitest/coverage-v8` 4.1 → 5.0 (dev); `@azure/msal-node` 5.6 → 6.0 and `nodemailer` 9.0 → 10.0 (production code in `packages/connectors`) | T4 for the dev pair; §3 for the two in production code |

TypeScript 7 stays ignored by configuration (workplan 0026 row 22: `typescript-eslint`
refuses to load under it; revisit when 7.1 ships).

### 2.3 GitHub Actions (`git ls-remote`, every pinned SHA resolved to its tag)

Nine of twelve actions are pinned at their newest tag. Behind: `pnpm/action-setup`
v6.0.10 → v6.1.0, `softprops/action-gh-release` v3.0.2 → v3.0.3,
`docker/setup-qemu-action` v4.2.0 → v4.3.0 — Dependabot's Monday group, nothing to do.

What the audit did find is that **three comments lie**. The SHA beside `actions/checkout`
is v7.0.1 and its sixteen comments say `v4.5.0`; `actions/setup-node`'s SHA is v7.0.0 and
two of its nine comments say `v6.0.0`; `actions/upload-artifact`'s SHA is v7.0.1 and its
comments say `v4.6.0` seven times and `v5.0.0` once. The code that runs is current; the
label a reviewer reads is not, and Dependabot only rewrites a comment when it moves the SHA,
which for a current SHA is never. T2 sets the three labels to the truth.

### 2.4 Runtimes

Node 24 everywhere it matters: `engines` says `>=24`, CI installs `24`, the images run
24.20.0. pnpm 11.22.0. PostgreSQL 18 on both stacks; PGlite (npm) current. Prisma current.

## 3. The owner's decisions

Each of these is an upgrade the audit found and deliberately did **not** make. The reason
is beside each; none is urgent tonight.

1. **Trigger.dev v4.5.12 → v4.5.16.** Four patch releases, but a Trigger.dev upgrade is a
   schema migration on the persistent stack and is one way (`managed-bring-up.md`,
   *Upgrading Trigger.dev*). The path exists and is scripted: `trigger-version.sh backup`,
   drain, `pin v4.5.16`, `pnpm install`, bring up. It needs a person at the keyboard for the
   drain. Until it is taken, Dependabot no longer offers the SDK half on its own (T1).
2. **Zitadel v4.17.1 → v4.17.3.** Two patch releases; Zitadel migrates its own schema at
   boot, on the same persistent stack. Three guards mention v4.17.1 by name — the SMTP-test
   endpoint that answers 501, the defaults file, the image-matches-postgres floor — and
   should be re-read against the release notes before the tag moves. Its own PR, gated by
   `e2e-managed.yml`, when the owner says so.
3. **Redis 7 → 8.** A major, and the licence changed at 8.0 (RSALv2 / SSPLv1, with AGPLv3
   added). 7.4 still receives patches, `redis:7-alpine` floats to them, and nothing in
   the stack asks for an 8-only feature. No reason to move; a reason to decide on record.
4. **registry 2 → 3.** The 2 line has had no release since 2.8.3; 3.0 rewrote the
   configuration file. The registry only serves Trigger.dev's deploy images inside the
   stack; moving it is a config rewrite plus a bring-up, not a patch.
5. **The object store.** `bitnamilegacy/minio` was pinned by digest after `latest` stopped
   moving (`managed-bring-up.md`); tonight's check shows the other free image,
   `minio/minio`, stopped too, at RELEASE.2025-09-07. There is no maintained free MinIO
   image to move to. The pin is safe as long as it is honest about what it is: frozen
   software with no fixes coming. The decision is whether Trigger.dev's object store should
   be something else (an S3-compatible store that is still published), and that is a design
   choice with a migration behind it, not a version bump.
6. **`@azure/msal-node` 5 → 6** and **`nodemailer` 9 → 10.** Both are production code in
   `packages/connectors` (the Microsoft account kind; SMTP). A major in a library that
   holds tokens or sends mail is read first and moved second; the release notes are the
   next step, and the O365 gate (`e2e-o365.yml`) the proof.

## 4. Not done, honestly

- **The floating tags stay floating.** `postgres:18-alpine`, `redis:7-alpine`, `caddy:2-alpine`,
  `nextcloud:34-apache` move on every `docker compose pull`, within their major, with no PR.
  That is the intended behaviour for a fixture and for stores that upgrade in place, and the
  majors are what the owner decides — so Dependabot is told to ignore their majors rather
  than pin them. A reader who wants reproducibility on the managed stack should know that
  the bring-up records what it pulled; that is where the exact version lives.
- **ClickHouse** is not checked against anything but Trigger.dev's own compose, and that
  is by design; the version that rejected a migration is the reason it is pinned at all.
- **Whether Dependabot reads `${TRIGGER_IMAGE_TAG:-v4.5.12}`** correctly is not tested here;
  those two lines are ignored by name, so the answer does not matter for them.
- **The three actions behind by a patch or a minor** are left to Monday's group rather than
  moved tonight: the group's PR exists precisely so that they arrive together, once.
