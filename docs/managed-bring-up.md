# Managed edition: bringing it up on a new machine

The managed edition is a **multi-tenant service**: Postgres behind PgBouncer, a
self-hosted **Trigger.dev** instance that is the one execution plane, the API,
the web app, and the tasks in `apps/worker` deployed onto Trigger.dev. It has
been stood up by hand more than once, each time from notes that were slightly
out of date. This document is those notes, kept next to the script that
executes them.

- **The script:** [`deploy/compose/bootstrap-managed.sh`](../deploy/compose/bootstrap-managed.sh)
- **This document:** the same steps in prose, with every dashboard screen
  written out, what "it worked" looks like at each step, and a failure table.

Read the two together. The script refuses rather than guesses, and every
refusal it prints names the section here that explains it.

---

## The one thing that cannot be automated

The self-hosted Trigger.dev webapp signs you in by **magic link** and exposes
**no admin API**. Creating the account, the organisation and the project is a
human at a browser, and no version of this script removes that.

What the script does instead is make it the *only* human step:

| Step | Who |
| --- | --- |
| Generate every secret, pin the image architecture | script |
| Bring up Postgres, create the pooler's lookup role, bring up PgBouncer | script |
| Bring up the whole Trigger.dev plane and wait for health | script |
| **Find the magic link in the logs** | script (`trigger-magic-link.sh`) |
| **Open it, name an organisation, name a project** | **you** |
| Read the project ref and production key back out of the instance | script (`trigger-credentials.sh`) |
| Log the deploy CLI in (opens a browser) | you, one command |
| Build and start the API and web app | script |
| Upload the task runtime environment, deploy the tasks | script |
| Prove an enqueue becomes a runner on this machine | script (`smoke-managed.sh`) |

Two of those are yours. Everything else is one command.

---

## Cutting over from the pre-rename stack (one time, ADR-0040)

The product was renamed, and with it the compose project, container, network and
volume names (`open-migrate-*` → `ownpace-*`). **Docker does not follow a rename.**
Bringing the new stack up next to an old one gives you a second, empty set of
volumes while the old data sits there dangling — the stack looks freshly broken
rather than un-migrated, which is the confusing failure this section exists to
prevent.

Deleting the checkout is **not** what does it: the state lives in Docker, not in
the working tree.

```bash
# 1. Tear the OLD project down WITH its volumes. This destroys its data — that is
#    the point, and it is only correct because nothing live is running.
docker compose -p open-migrate-managed down -v --remove-orphans
docker compose -p open-migrate-selfhost down -v --remove-orphans   # if present

# 2. `container_name:` is a fixed string, so `-p` never namespaced these. Any that
#    survived step 1 would collide with the new stack by name.
docker rm -f open-migrate-db open-migrate-pgbouncer open-migrate-api \
             open-migrate-web open-migrate-nextcloud \
             open-migrate-selfhost-db open-migrate-selfhost-app 2>/dev/null || true

# 3. The demo Stalwart is created by `docker run` (setup-stalwart.sh — it cannot
#    be a compose service, see that script's header), so it is NOT in the compose
#    project and `down -v` structurally cannot see it. It is also what keeps the
#    old network alive: step 1 reports "Resource is still in use" because this
#    container is still attached to it.
docker ps -a --filter network=open-migrate-managed_open-migrate-network --format '{{.Names}}'
docker rm -f open-migrate-stalwart 2>/dev/null || true
docker network rm open-migrate-managed_open-migrate-network 2>/dev/null || true

# 4. Its volumes are outside compose for the same reason. Three naming generations
#    exist on a long-lived box, as those defaults drifted:
docker volume rm $(docker volume ls -q --filter name=open-migrate-stalwart) 2>/dev/null || true

# 5. Confirm nothing is left holding the old name before you bring the new one up.
docker ps -a      --filter name=open-migrate --format '{{.Names}}'
docker volume ls  --filter name=open-migrate
docker network ls --filter name=open-migrate
```

**Do not delete `openmig-dev-stalwart*`.** That is the dev/e2e Stalwart instance,
named after the package scope rather than the product, so it is deliberately
untouched by the rename and is still in use.

**Do NOT delete `~/.persistent/open-migrate-managed`.** It holds the stack's `.env`
— including `SECRET_ENCRYPTION_KEY`, the key that decrypts every stored credential
in the database — and `pgbouncer/userlist.txt`. It lives outside the checkout
precisely so `actions/checkout`'s clean cannot reach it, which also means nothing
else will recreate it. **Move it:**

```bash
mv ~/.persistent/open-migrate-managed ~/.persistent/ownpace-managed
```

If the repository variable **`MANAGED_ENV_PERSIST_DIR`** is set explicitly, it
overrides the workflow default and still points at the old path — update it in
GitHub → Settings → Variables, or the nightly e2e restores `.env` from a directory
that is no longer there.

The Trigger.dev platform containers (`trigger-db`, `trigger-api`, `trigger-tls`, …)
are **not** product-named and keep their names; nothing above touches them.


## Before you start

**Host**

- Linux with **Docker** and **Docker Compose v2** (`docker compose version`).
- **Node 22+** and **pnpm** (the seed, the deploy CLI and the smoke run on the
  host, not in a container).
- `openssl`, `curl`, `git`.
- **~15 GB free disk.** ClickHouse, MinIO, the Trigger.dev images, the task
  registry and the built API/web images add up; running out midway leaves a
  stack that is partly built and wholly confusing.
- The repository cloned, and `pnpm install --frozen-lockfile` done.

**Architecture.** `DEPLOY_IMAGE_PLATFORM` decides what the task images are
built for, **server-side** — there is no CLI flag. Get it wrong and every task
run dies at `exec` in under a second with `AutoRemove` deleting the evidence.
`managed.env.example` ships `linux/amd64`, so on an **arm64 box the shipped
default is wrong**. The script fixes this for you from `uname -m`; it is
mentioned here because it is the single setting whose failure looks like
nothing at all.

**Ports** published on the host, all overridable in `.env`:

| Port | Service | Notes |
| --- | --- | --- |
| 3001 | API | `API_PORT` |
| 3123 | web | `WEB_PORT` |
| 5432 | Postgres | `POSTGRES_PORT` — the host-run seed and migrations need it |
| 3090 | Trigger.dev API (http) | `TRIGGER_PORT` — what the **deploy CLI** talks to |
| 3443 | Trigger.dev dashboard (https) | `TRIGGER_TLS_PORT` — what your **browser** talks to |
| 5000 | task image registry | `REGISTRY_PORT`, bound to loopback |
| 8083 | Nextcloud | demo backend only |

PgBouncer is deliberately **not** published: it is reached over the compose
network by name. That is why anything running on the host (the seed, the
migrations) connects to `postgres:5432`'s published port directly.

**Addressing the dashboard.** `TRIGGER_TLS_HOST=localhost` (the default) means
the dashboard is usable **only from the machine itself**. The dashboard's
session cookie is `Secure` in production mode, so plain http works from
localhost and nowhere else — which is why the `trigger-tls` service exists.
To reach it from your laptop, before the `trigger` phase set:

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env \
  TRIGGER_TLS_HOST=10.0.0.5 \
  TRIGGER_APP_ORIGIN=https://10.0.0.5:3443 \
  TRIGGER_LOGIN_ORIGIN=https://10.0.0.5:3443
```

Leave `TRIGGER_API_ORIGIN=http://localhost:3090` alone. The deploy CLI follows
the server-advertised API origin and must not meet a self-signed certificate on
the way — when it did, deploys died with a bare `Connection error`.

---

## The short version

```bash
git clone … && cd Ownpace
pnpm install --frozen-lockfile

./deploy/compose/bootstrap-managed.sh          # creates .env, then stops
#   … read deploy/compose/.env and make the decisions in it …
./deploy/compose/bootstrap-managed.sh --from data
#   … create the organisation and project in the dashboard …
./deploy/compose/bootstrap-managed.sh --from account
#   … one `npx trigger.dev login` when it asks …
./deploy/compose/bootstrap-managed.sh --from login
```

Three stops on a brand-new machine, and the first of them goes away with
`--accept-defaults` on a throwaway demo box.

Add `--with-demo` on a demo box or a CI runner: it provisions the demo mail and
DAV backends, seeds two demo tenants, and runs the live smoke at the end. **A
real deployment must not use it** — it creates tenants with fixed credentials
that are published in this repository.

The script exits **2**, not 1, when it is waiting for you, and prints the exact
command to resume with. Re-running it from the top is always safe: every phase
checks whether it is already done.

---

## The long version, phase by phase

`./deploy/compose/bootstrap-managed.sh --list` prints them in order. Any phase
can be run alone with `--only <phase>`, or resumed from with `--from <phase>`.

### 1. `preflight` — the tools, and the one setting that cannot be fixed later

Checks Docker, Compose v2, Node, pnpm, `openssl`, `curl`, that the daemon is
reachable and that `node_modules` exists, and warns below 15 GB free.

**Verify:** it prints the versions it found. Nothing is started yet.

### 2. `env` — `deploy/compose/.env`

Creates `.env` from `managed.env.example` if it is missing (mode `600`), then
runs [`ensure-env-secrets.sh`](../deploy/compose/ensure-env-secrets.sh), which
generates every missing secret — `JWT_SECRET`, `SECRET_ENCRYPTION_KEY`, the
five Trigger.dev secrets, `PGBOUNCER_AUTH_PASSWORD` — and writes
`pgbouncer/userlist.txt`. It is idempotent: a value you already set is never
rotated. Then it pins `DEPLOY_IMAGE_PLATFORM` to this host's architecture.

**What it will not decide for you.** It *reports* these and moves on:

- `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `CLICKHOUSE_PASSWORD`,
  `MINIO_ROOT_PASSWORD`, `NEXTCLOUD_ADMIN_PASSWORD` still at their shipped
  defaults. Fine for a demo box on localhost; not fine for anything a customer
  reaches. **Change them before the `data` phase** — changing
  `POSTGRES_PASSWORD` after the volume exists does not change the password
  inside it.
- `CORS_ORIGIN` / `WEB_URL` / `API_URL`. On a real deployment these are the
  public https addresses. `API_URL` is where **Mollie's servers** deliver
  payment webhooks: with `MOLLIE_API_KEY` set, the API refuses to boot in
  production on a localhost `API_URL`, because the alternative is payments
  that complete while invoices never leave `sent`.
- `PRICING_*` — integer **cents**, never euros. They are a template for *new*
  tenants; each tenant's agreed prices are pinned in the `tenant_pricing` table
  the first time their money is computed and never follow this file again. That
  table is created by the MANAGED migration chain (ADR-0036), which the API
  applies after the shared one — an appliance applies only the shared chain and
  has no such table.
- `SMTP_*` / `NOTIFY_*` — set them all or none. Half-set, the channel stays off
  and names what is missing.
- `OAUTH2_*` — only for a stack with a Microsoft Graph source or 0028's drift
  detector. An IMAP-only stack needs none of it.

Edit `.env` by hand, or use
[`env-upsert.sh`](../deploy/compose/env-upsert.sh), which replaces a key where
it already sits instead of appending a second copy of it:

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env POSTGRES_PASSWORD=…
```

It refuses a value containing whitespace, a quote, `$`, a backtick or a
backslash. That is not fussiness: every consumer of this file reads it with
`set -a; . .env`, so such a value is re-interpreted by a shell, and compose's
own parser would disagree about what happened.

**It stops here the first time.** The file has just been created, so none of
those decisions has been made — and the next phase creates the Postgres volume,
after which changing `POSTGRES_PASSWORD` in this file changes nothing at all
while the stack looks configured and fails to authenticate. Read the file,
then resume with `--from data`. On a throwaway demo box where the shipped
values are the right answer, `--accept-defaults` removes the pause.

**Verify:** `grep -c '=.' deploy/compose/.env`, and that
`deploy/compose/pgbouncer/userlist.txt` exists.

**Never commit `.env`.**

### 3. `data` — Postgres, the pooler's lookup role, PgBouncer

```bash
docker compose -f deploy/compose/managed.yml up -d --wait postgres
PGOPTIONS="-c my.pw=$PGBOUNCER_AUTH_PASSWORD" \
  docker compose -f deploy/compose/managed.yml exec -T postgres \
  psql -U openmigrate -d openmigrate -f - < deploy/compose/pgbouncer/setup-auth.sql
docker compose -f deploy/compose/managed.yml up -d --wait pgbouncer
```

**The order is the whole point.** PgBouncer's healthcheck authenticates as
`pgbouncer_auth`, and that role is created by `setup-auth.sql`, which needs
Postgres up. Bring both up together on a fresh box and it hangs at the
healthcheck complaining about a password, when the cause is a role that does
not exist yet.

**Verify:**

```bash
docker compose -f deploy/compose/managed.yml exec -T pgbouncer \
  psql "postgresql://pgbouncer_auth:${PGBOUNCER_AUTH_PASSWORD}@127.0.0.1:6432/pgbouncer" -tAc "SHOW POOLS"
```

Anything back, containing `transaction`, is the pooler serving in the right
mode.

### 4. `demo` — the demo backends and the two demo tenants *(only with `--with-demo`)*

Runs [`setup-managed-demo.sh`](../deploy/compose/setup-managed-demo.sh) — real
Stalwart (IMAP source, JMAP target) and real Nextcloud (CalDAV/CardDAV/WebDAV)
— then the seed:

```bash
DATABASE_URL=postgresql://…@localhost:5432/openmigrate \
DIRECT_DATABASE_URL=… JWT_SECRET=… SECRET_ENCRYPTION_KEY=… \
  ./deploy/compose/seed-managed.sh
```

Those exports matter. The seed runs **on the host** and inherits nothing;
nothing in `apps/api` loads a dotenv file. It also runs the migrations itself —
**both chains**, shared then managed (ADR-0036), each advisory-locked under its
own key, so racing an API boot is safe — which is why the schema exists before
the API has ever started. The order is not a preference: every table in the
managed chain references `public.tenant`.

**Verify:** the seed prints two demo owner tokens. Re-running it is a no-op.

### 5. `trigger` — the Trigger.dev plane

Brings up `trigger-db`, `trigger-redis`, `clickhouse`, `minio`,
`trigger-registry`, `trigger-docker-proxy`, `trigger-api`, `trigger-tls`,
`trigger-supervisor` and waits for all of them to be **healthy**, not merely
started.

**Verify:** `curl -fsS http://localhost:3090 -o /dev/null && echo up`

### 6. `account` — **your turn**

If `.env` already has `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY`, this
phase does nothing. If the project exists on the instance but `.env` is behind
(a re-clone, a rotated file), the script reads them back and carries on. Only
if the instance genuinely has no project does it stop, and then:

1. **Open the dashboard** — `TRIGGER_APP_ORIGIN` from `.env`, by default
   <https://localhost:3443>. It serves a **self-signed certificate**. Accept
   the browser warning; this is the `trigger-tls` front, and it exists because
   the dashboard's session cookie is `Secure` in production mode.

2. **Type the email address** the account should belong to and press
   **Continue**. No mail is sent — there is no mail server — so the sign-in
   link goes to the log instead.

3. **Fetch the link:**

   ```bash
   ./deploy/compose/trigger-magic-link.sh
   ```

   Open it **in the same browser**. Links are single-use and short-lived; if
   one is spent, ask the dashboard for another and run the command again — it
   always prints the newest. `--all` prints every link still in the log buffer.

   *If it finds nothing*, you have almost certainly not done step 2 yet: the
   link is only written when one is requested. That is not a broken stack.

4. **Name an organisation**, then **name a project**. Both are yours to choose
   and nothing in this repository depends on either. (Suggestion:
   organisation `Ownpace`, project `ownpace`.)

5. **Do not hand-copy anything.** Resume:

   ```bash
   ./deploy/compose/bootstrap-managed.sh --from account
   ```

   [`trigger-credentials.sh`](../deploy/compose/trigger-credentials.sh) reads
   the `proj_…` ref and the **production** `tr_prod_…` key straight out of the
   instance, checks the shape of both, writes them with `env-upsert.sh`, and
   restarts the API so it picks the key up.

   It introspects the Trigger.dev schema before querying it and **refuses**
   rather than guessing if the shape is not the one it knows — that schema
   belongs to Trigger.dev and can change under a version bump. Every refusal
   prints the two dashboard pages to read instead: **Project → Settings** for
   the ref, **Project → API keys → the PROD environment** for the key. A `dev`
   key is refused on purpose: it is personal to a CLI session and would not
   work from a container.

   If the instance holds several projects it will not choose for you —
   re-run it with `--project <name>`.

> The `tr_prod_` key is a credential. Treat this script's output like the
> `.env` it is destined for; do not paste a run of it into an issue.

### 7. `login` — the deploy CLI, once per machine

The CLI version is read from `@trigger.dev/sdk` in `apps/worker/package.json`,
so there is one version number and it lives where it already lived.

```bash
npx -y trigger.dev@<version> login -a http://localhost:3090 --profile openmig
```

**`openmig` is the DEFAULT profile name, not a fixed one.** It is pre-rename
branding (ADR-0040) kept on purpose — a machine already logged in under it,
the gate's runner most likely, would be stranded by a default that moved.
`TRIGGER_CLI_PROFILE` in `.env` overrides it, and the phase then asks for
whatever you set.

**Setting that variable moves the SETTING, and cannot move a login.** A login
is a token stored per profile NAME in `~/.config/trigger/config.json` on the
host — outside the checkout, untouched by the rename, and invisible to
anything in this repository. So a stack whose `.env` says `ownpace` while that
file holds only `openmig` is correct in both halves and refuses anyway; it is
one browser round trip from agreeing (2026-08-31). The refusal prints the name
in use and the default as two separate lines for exactly this reason.

The script prints the exact line with the version filled in and stops, because
the command opens a browser and waits for you. Note the address is the plain
**http api origin**, not the https front.

**The URL it then asks you to open is on the https front**
(`TRIGGER_LOGIN_ORIGIN`, the `trigger-tls` service), which serves a
self-signed certificate — and one browser has been seen to fail there where
another succeeds. See the failure table.

**Verify:** `npx -y trigger.dev@<version> whoami --profile <name>` — and read
its OUTPUT, not its exit code, which is 0 either way (below).

### 8. `app` — API and web

`docker compose up -d --build --wait`, with `GIT_SHA` passed so `GET /version`
reports a commit rather than `unknown`. The API runs both migration chains at
boot (ADR-0036), shared first.

Without `--with-demo` the services are **named explicitly** rather than swept
up, so a bare `up` does not start Nextcloud — whose admin password is
`change-me-nextcloud-admin` by default.

**Verify:**

```bash
curl -fsS http://localhost:3001/health && curl -fsS http://localhost:3001/version
```

### 8b. Sign-in — the identity provider *(optional, but the paste box is the alternative)*

Not a `bootstrap-managed.sh` phase, and deliberately separate: a stack is
usable without it, and skipping it leaves exactly the sign-in that existed
before ([ADR-0042](./adr/0042-who-holds-the-passwords.md)) — the owner mints a
token with the seed script and whoever needs one pastes it into `/login`.

To have real accounts instead:

```bash
./deploy/compose/setup-zitadel.sh
```

It generates the provider's own secrets, starts it against the existing
Postgres, waits for it to be healthy, creates the project and a **public**
client (authorization-code + PKCE, no client secret — this is a browser app,
and a secret shipped to every visitor is not a secret), and writes
`JWT_ISSUER`, `JWT_AUDIENCE` and the two `VITE_OIDC_*` values back into
`deploy/compose/.env`. Re-running it is safe; it adopts what already exists.

**Then restart the API and REBUILD the web app, or nothing changes.** The API
only needs the new environment; the web app bakes `VITE_*` in at build time, so
a container built before the script ran has no issuer in its bundle and still
renders the paste box. The script prints these two lines when it finishes:

```bash
docker compose -f deploy/compose/managed.yml up -d --force-recreate api
docker compose -f deploy/compose/managed.yml up -d --build web
```

**Verify** — `/login` shows a *Sign in* button rather than only a token box,
and the round trip ends on the dashboard:

```bash
curl -fsS "$(grep '^JWT_ISSUER=' deploy/compose/.env | cut -d= -f2-)/.well-known/openid-configuration" | head -c 200
```

The API reads the key-set URL from that document rather than composing one, and
the browser reads its endpoints from the same place — which is what makes the
provider a component rather than a foundation. Replacing it is `JWT_ISSUER` +
`JWT_AUDIENCE` + `VITE_OIDC_*` pointed somewhere else and a rebuild; two tests
fail if that stops being true.

> **The issuer's address ends up inside every token.** `ZITADEL_EXTERNALDOMAIN`
> is what the provider stamps as `iss`, and the API compares it byte for byte.
> Changing the address later invalidates every live session — it belongs with
> the other browser-visible addresses in `.env`, decided once.

#### Offering Google, Microsoft, GitHub or Apple as a second way in

Optional, and configuration only — nothing in the product knows a provider's
name (ADR-0042; `no-issuer-lock-in.unit.test.ts` fails the build on one). The
upstream goes into Zitadel, Zitadel still mints the token, and `tenant_member`
never learns anybody used Google.

**Your half** is registering an OAuth client at each provider's console. The
redirect URI is **not the same for all four** — Apple posts its answer back,
the others redirect:

| Provider | Where | Redirect / Return URI |
|---|---|---|
| Google | Cloud Console → Credentials → OAuth client ID (Web) | `$JWT_ISSUER/ui/login/login/externalidp/callback` |
| Microsoft | Entra ID → App registrations | `$JWT_ISSUER/ui/login/login/externalidp/callback` |
| GitHub | Settings → Developer settings → OAuth Apps | `$JWT_ISSUER/ui/login/login/externalidp/callback` |
| Apple | Developer → Services ID (**paid account**) | `$JWT_ISSUER/ui/login/login/externalidp/callback/form` |

**Our half** is `.env` and a re-run. Fill in the pairs you want — a provider
with no credentials is simply not offered. The keys, exactly as `.env` spells
them:

```bash
IDP_GOOGLE_CLIENT_ID=       IDP_GOOGLE_CLIENT_SECRET=
IDP_MICROSOFT_CLIENT_ID=    IDP_MICROSOFT_CLIENT_SECRET=    IDP_MICROSOFT_TENANT=
IDP_GITHUB_CLIENT_ID=       IDP_GITHUB_CLIENT_SECRET=
IDP_APPLE_CLIENT_ID=        IDP_APPLE_TEAM_ID=
IDP_APPLE_KEY_ID=           IDP_APPLE_PRIVATE_KEY=
```

`IDP_MICROSOFT_TENANT` decides which Microsoft accounts may sign in — empty or
`common` for any, `organisations` / `consumers` to narrow it, or a tenant id to
pin one organisation. Then:

```bash
./deploy/compose/bootstrap-managed.sh --only app
```

Apple needs four values rather than two, and the key is sent as bytes:

```bash
base64 -w0 AuthKey_XXXXXXXXXX.p8     # -> IDP_APPLE_PRIVATE_KEY
```

**What happens when the address already has an account:** the person is prompted
to link, on a match of a *verified* email — never a silent merge. When several
accounts match, Zitadel shows no prompt at all, so the ambiguous case fails
closed. That decision is set once for every provider and is the reason this was
built after workplan 0102 T2 rather than alongside it: a provider sign-in that
minted a second subject would orphan a membership, and the person would be
locked out of an organisation they are still in.

**Microsoft addresses are not treated as verified**, deliberately. Entra does not
say whether it verified an address, and `email_verified` is what binds an
invitation and what moves a membership label — so Zitadel sends its own
verification mail. One click, and every claim downstream means what it says.

**Verify** — the buttons appear on `$JWT_ISSUER/ui/login`, and the bring-up says
what it configured:

```
[setup-zitadel] checking which sign-in providers this instance offers
[setup-zitadel]   Google: added
[setup-zitadel]   Google: now offered on the sign-in screen
[setup-zitadel] allowed (providers offered: true)
```

If a provider will not add, the refusal names the redirect URI to check.

**A re-run never re-sends credentials.** An existing provider is matched by
name and left exactly as it is — the script says so when it happens (*"a
provider of this name exists — left as it is"*). So fixing a mistyped secret
in `.env` and re-running changes nothing: remove the provider in the console
first (**Settings → Identity Providers**, at the instance), then re-run. The
button is gone for the seconds in between and anybody mid-sign-in through it
fails, so on a stack with real users do it deliberately, not casually.

**Emptying a pair removes less than it looks like.** The provider stays
configured and on the login policy. Emptying the *last* pair flips "External
IDP allowed" off on the next run, which hides *every* provider button; emptying
one of several leaves that provider's button showing and working, because the
run no longer carries credentials to compare and does not touch what exists.
Actual removal is the console, the same place as rotation.

**Where the Microsoft verification mail lands.** Entra addresses arrive
unverified on purpose (above), so the first Microsoft sign-in triggers the
issuer's own verification mail — which goes wherever this stack's mail goes.
On the OTA stack that is Mailpit, not an inbox: an operator offering Microsoft
there reads the code out of Mailpit ("Mail: caught, not delivered", below),
or the person waits on a mail that
never arrives anywhere they can see.

#### Whatever fronts the provider must pass the original `Host` header

If something terminates TLS in front of the identity provider — a reverse
proxy, a mesh ingress, a tunnel — it has to forward the request with the
original `Host:` intact. A proxy that rewrites it to its own address breaks
sign-in for every human on the deployment, and breaks it in a way that reads
like anything but a proxy problem.

**What it looks like.** Pressing *Sign in* reaches
`…/ui/login/login?authRequestID=…` and the page says:

```
User Agent komt niet overeen (EVENT-adk13)
```

**Why.** Zitadel builds the domain of its user-agent cookie from the raw `Host`
header (`domain := strings.Split(host, ":")[0]`, `internal/api/http/cookie.go`).
Rewritten Host, cookie scoped to the proxy's address. A browser may accept a
cookie only for its own domain or a parent, so it drops the cookie entirely —
and every subsequent request therefore arrives with a *fresh* user-agent id,
which never matches the one recorded on the authorization request.

**Why nothing else notices.** Instance resolution reads the FORWARDED name, so
the provider's own log reports the right host while the cookie says otherwise.
Token verification, the sessions API and every machine-driven path never touch
that cookie. The only thing that breaks is the path a person walks.

**How to check.** Ask the same endpoint twice — once through the ingress, once
straight at the container with the right `Host` — and compare the cookie:

```bash
cd ~/ownpace && set -a; . deploy/compose/.env; set +a
AUTHZ="oauth/v2/authorize?client_id=${VITE_OIDC_CLIENT_ID}&redirect_uri=${WEB_URL}/auth/callback\
&response_type=code&scope=openid%20email&state=probe\
&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"

# through whatever fronts it
curl -sS -o /dev/null -D - "${JWT_ISSUER}/${AUTHZ}"                       | grep -i '^set-cookie'
# straight at the container, with the Host it should have been given
curl -sS -o /dev/null -D - -H "Host: ${ZITADEL_EXTERNALDOMAIN}" \
     "http://localhost:${ZITADEL_PORT:-3126}/${AUTHZ}"                    | grep -i '^set-cookie'
```

Two different `Domain=` values means the ingress is rewriting `Host`. One value,
matching `ZITADEL_EXTERNALDOMAIN`, means it is not — and neither is `Domain=`
being absent altogether, which is the healthy shape for a `__Host-` prefixed
cookie.

**The fix is in the ingress**, not here: nginx `proxy_set_header Host $host`,
Traefik `passHostHeader: true`, or the equivalent. Where the ingress genuinely
cannot be told, put a proxy on the box in front of the provider that restores
it — the same shape as `www-nginx.conf` and the Caddy in front of Trigger.

`smoke-managed.sh` asserts this: it reads the cookie's domain off the
authorization response and names the rewrite rather than letting it surface as
an unexplained error page.

### 8c. Somebody who can answer the door *(needed before anybody can be let in)*

Also not a `bootstrap-managed.sh` phase. `access_request` is written by
strangers and readable by nobody until an **operator** exists (workplan 0093
T6) — so a deployment with no operators has a queue nobody can read and a
front door that only records knocks.

An operator is identified by their OIDC **subject**, not their email, and there
is no way to know it before they have signed in once. So:

1. Sign in at `/login` (§8b) — this creates the account in the provider.
2. Ask the API who you are:

```bash
curl -fsS -H "Authorization: Bearer <token>" http://localhost:3001/api/me
```

   <a id="where-the-token-comes-from"></a>
   **Where `<token>` comes from.** The web app already holds one: after signing
   in it keeps the token under `auth_token` in `localStorage`, on its own
   origin. Open the app, then in the browser console:

   ```js
   copy(localStorage.getItem('auth_token'))   // Chrome/Firefox: straight to the clipboard
   localStorage.getItem('auth_token')         // or just read it
   ```

   It must be **that** value. It is the OIDC **ID token** — `completeSignIn`
   returns `id_token` and the app sends exactly it — and the API validates the
   ID token's claims. An access token minted for the same account, from the
   same provider, is a different token and is refused, which reads as a broken
   appointment rather than as the wrong credential.

   It is short-lived. If either curl here answers `401`, the token has expired:
   sign in again and take a fresh one. Nothing else needs redoing.

3. Take the `userId` from that answer and appoint it, over the **owner**
   connection — `app_user` cannot write this table, which is the point of it:

```bash
DATABASE_URL="$(grep '^DATABASE_URL=' deploy/compose/.env | cut -d= -f2-)"   pnpm --filter @openmig/api operator:add <userId> you@example.com "first operator"
```

`operator:list` shows who can currently answer; `operator:remove <userId>` takes
it away. Adding somebody twice updates their row rather than failing, so a typo
is fixed by re-running.

**Why not an email address, and why not a screen.** Keying the appointment on an
email would mean whoever can register that address becomes an operator. Making
it a route would mean an operator could appoint another one — and then the owner
is no longer the one deciding who decides. It is three steps because each of the
shorter versions gives something away.

**Verify** — the queue answers, and answers only for them:

```bash
curl -fsS -H "Authorization: Bearer <token>" http://localhost:3001/api/access-requests
```

Once appointed, signing in again lands the operator on **Access requests** in
the web app (workplan 0093 T7), which is the same queue with buttons on it.

Granting is `POST /api/access-requests/<id>/grant`, which creates the
organisation and invites the asker as its owner; they become a real member the
first time they sign in, provided the identity provider asserts
`email_verified` for their address. Declining is the same shape and provisions
nothing. Neither can be undone by deleting the row: nobody has DELETE on that
table, so a decision stays on the record.

### 8d. The status page *(comes up with the stack)*

`gatus` starts with everything else in the `app` phase (workplan 0094). It
listens on `STATUS_PORT` (default `3124`); put it behind the reverse proxy at
`status.<your domain>` alongside the app.

```bash
curl -fsS "http://localhost:${STATUS_PORT:-3124}/health"
```

**This section said "starts with everything else" from the day it was written,
and it was not true.** `gatus` was named nowhere in `bootstrap-managed.sh`, so
no bring-up had ever started it — the same thing that happened to `zitadel` for
three weeks, and found the same way, by reading `docker ps` on the Spark and
noticing what was not in it. `scripts/every-service-somebody-starts.unit.test.ts`
now compares `managed.yml`'s service list against the bring-up's, so a service
defined and never started fails a test instead of quietly not existing.

**Read [`status-page.md`](./status-page.md) before you trust a green light.**
This page runs INSIDE the stack it watches, so it cannot tell you the stack is
down — when the box is off, the page is off. It answers three narrower questions
honestly: is a provider down (the usual cause of a stalled migration), is part
of Ownpace unwell while the rest serves, and was there an outage recently. The
page says this itself, in the button beside its heading.

What it watches is `deploy/compose/gatus.yaml` — in git, reviewed, and edited
with a restart rather than through a web console.

### 9. `tasks` — the task environment, then the deploy

```bash
./deploy/compose/set-task-env.sh
./deploy/compose/deploy-tasks.sh
```

**Deploying to a non-production environment.** One Trigger instance can serve a test stack and a
production stack side by side — a project has several environments, and each has its own secret
key, its own deployed task version and its own runs. To move a stack onto one of them:

1. **Take that environment's key** from the dashboard (project → API keys) and put it in
   `deploy/compose/.env` as `TRIGGER_SECRET_KEY`. This is the key the **api** enqueues with.
2. **Set `TRIGGER_ENV`** in the same file to that environment's name (`prod` is the default).
   **One name does all three** — the deploy target, the task variables, and the key
   `trigger-credentials.sh` reads. Until 2026-08-31 the other two read `TRIGGER_ENV_SLUG`,
   so this step moved the deploy alone and this list was the way to find that out; the old
   name is still honoured, once, out loud.
3. **Restart the api** so it picks up the new key:
   `docker compose -f deploy/compose/managed.yml up -d api`
4. **Re-upload the task environment variables**, which are stored per environment and do not
   follow the key: `./deploy/compose/set-task-env.sh`
5. **Re-deploy the tasks**: `./deploy/compose/deploy-tasks.sh`

Steps 1 and 2 must name the **same** environment. If they disagree, nothing errors — the deploy
succeeds, the enqueue succeeds, and the runs simply never meet a deployed task, leaving a queue
that grows beside a dashboard that looks idle. `deploy-tasks.sh` refuses the two combinations
that are unambiguously that mistake; it cannot catch every one, because only the `tr_prod_` key
prefix is known here.

Step 4 is the one most easily forgotten, and its failure is the one the script's own header
already warns about: *"a task that lands before its environment exists runs once against no
database and fails in a way that reads like a broken task."*


**Environment before deploy, deliberately.** Task containers inherit
**nothing** from compose: a run gets only what the Trigger.dev platform stores
for the project's environment. `set-task-env.sh` uploads `DATABASE_URL`,
`APP_DATABASE_URL`, `DIRECT_DATABASE_URL`, `SECRET_ENCRYPTION_KEY` and the
optional `OAUTH2_*` / `SMTP_*` / `NOTIFY_*` from `.env`, with `override: true`
so a stale dashboard value cannot win over a rotated file. The addresses it
uploads are **in-network** (`pgbouncer:6432`, `postgres:5432`), because runners
join the compose network — `localhost` there would point a task at itself.

`deploy-tasks.sh` re-checks the architecture and refuses on a mismatch, then
deploys. **Re-run it after every `git pull` that touches `apps/worker`.**

**Verify:** the dashboard's Deployments page lists the tasks. That is
registration, not execution — see the next phase for the difference.

### 10. `smoke` — the only proof that counts

```bash
./deploy/compose/smoke-managed.sh
```

Mints a seeded-member token, runs a verify to a terminal state and an apply to
`applied` or `refused` (a refusal is a legitimate pass — the gates said no and
said why), and captures runner logs live, because `AutoRemove` destroys them at
exit.

Only runs with `--with-demo`: it drives the demo tenants. A green CI says
nothing about whether an enqueue becomes a runner container **on this machine**
— that lesson cost a whole bring-up session, and this is the step that answers
it.

> Runner debug logs print the **full task environment** — `DATABASE_URL`,
> `SECRET_ENCRYPTION_KEY`, the `tr_prod_` key. The smoke's evidence file is
> secret-bearing by construction. `deploy/compose/redact-evidence.sh` cleans it
> before anything is uploaded anywhere.

---

## The public site is a separate stack, and it must be told which one it is

`bootstrap-managed.sh` does not bring the site up — `deploy/compose/www.yml` is
its own stack, deliberately, so that taking the app down does not take the site
with it. To publish or re-publish:

```bash
OWNPACE_APP_URL=https://app.ota.ownpace.eu node site/build.mjs   # test (OTA)
OWNPACE_APP_URL=https://app.ownpace.eu     node site/build.mjs   # production
docker compose -f deploy/compose/www.yml up -d
```

`site/dist` is bind-mounted read-only, so a rebuild is live immediately and no
restart is needed — because the build **empties** `dist` rather than replacing
it. A bind mount resolves to an inode at container start, so a build that
removed and recreated the directory would leave nginx holding an unlinked one:
`total 0` inside the container, every file present outside, and a 403 on every
request that reads like a permissions problem. If that ever happens,
`docker compose -f deploy/compose/www.yml up -d --force-recreate` re-resolves
the mount.

`--public` and `OWNPACE_APP_URL` must agree, and the build refuses if they do
not: a public build must point at the production app, and a test build must
not. A `--public` build with unfilled legal placeholders is refused too — the
output used to claim "every placeholder must be filled" and then publish
anyway.

**`OWNPACE_APP_URL` has no default and the build refuses without it.** It is
where every *Request access* button points, and the environment is a domain
level (workplan 0091). It used to default to production, on the argument that a
forgotten variable should land on the safe side. On 2026-08-24 the OTA site was
rebuilt without it, and every button on `www.ota.ownpace.eu` pointed at
`https://app.ownpace.eu/request-access` — a click on the *test* site filing a
real access request against the real tenant. The build that forgets is by
definition the one whose value is not the default, so a default can only ever
be wrong silently. Neither side is the safe side; being told is.

If you are ever unsure which environment a served `dist` was built for, read the
host out of a *Request access* link in the page source.

## Mail: caught, not delivered

Every mail this stack sends goes to **Mailpit**, a catcher on the compose
network.

**Two different things send mail, and they are configured separately.** The API
sends operator notifications — an access request, a grant, a decline, the daily
digest — and reads `SMTP_HOST` and friends from `.env` via `managed.yml`. The
**identity provider sends its own**: the verification link on a new account, an
email-change confirmation, a password reset, the invitation to set a first
password. None of that goes through the API. `setup-zitadel.sh` configures it
from the same `SMTP_HOST`/`SMTP_PORT`/`NOTIFY_FROM`, so there is one relay
setting rather than two that can drift — but it only runs during the `app`
phase, so a stack brought up before 2026-08-25 has an issuer with **no email
provider at all**, silently dropping every one of those.

Until then the failure looks like a broken product rather than an unconfigured
one: the account is created, the screen says to check your mail, and Mailpit
stays empty.

### Is it actually pointed at the catcher?

```bash
grep -E '^(SMTP_HOST|SMTP_PORT|SMTP_SECURE|NOTIFY_FROM|NOTIFY_TO)=' deploy/compose/.env
```

For the OTA/dev stack you want:

```
SMTP_HOST=mailpit
SMTP_PORT=1025
NOTIFY_FROM=ownpace@ownpace.invalid
NOTIFY_TO=operator@ownpace.invalid
```

An **absent or empty `SMTP_HOST` means the channel is off** — for both senders,
and by design: a deployment that has not chosen a relay is not misconfigured. It
is also indistinguishable from a broken one unless you look here. `.env` files
copied from an older `managed.env.example` predate these keys entirely, so an
empty result means "never configured", not "deliberately disabled".

What the containers actually got, which is the only thing that matters:

```bash
docker compose -f deploy/compose/managed.yml exec api printenv SMTP_HOST SMTP_PORT NOTIFY_FROM
./deploy/compose/setup-zitadel.sh --print
```

After changing any of them: `./deploy/compose/bootstrap-managed.sh --only app`
(the API reads them at boot, and the issuer's provider is written by
`setup-zitadel.sh` inside that phase).

### Reading what it caught

Mailpit is bound to **loopback only** (`127.0.0.1:3127`), which is not an
oversight and not something to "fix" by opening it up. It has no authentication
of any kind, and what it holds is every verification link and password reset the
stack sends — an unauthenticated reader of those, on a box with a public name,
is an account-takeover primitive. So it is reached from the box itself, or
through a tunnel:

```bash
# On the box
curl -s localhost:3127/api/v1/messages | head -c 400

# From your laptop — then open http://localhost:3127
ssh -N -L 3127:127.0.0.1:3127 you@the-box
```

`MAILPIT_PORT` moves the port. `MAILPIT_BIND` moves the interface, and its
default is loopback.

#### Reaching it over a private mesh, without a tunnel every time

A WireGuard peer address — NetBird, Tailscale — is **not** the same thing as
`0.0.0.0`. It is reachable only by devices holding a key for that network, which
is an authentication boundary Mailpit does not have to provide itself. So it is
a legitimate place to publish the catcher, and the shipped default stays
loopback for everyone who does not ask:

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env MAILPIT_BIND=100.97.25.131
docker compose -f deploy/compose/managed.yml up -d mailpit
```

Then http://100.97.25.131:3127 from any device on the mesh.

That command **recreates the container**, and what it already caught survives
it: Mailpit writes to `mailpit_data` rather than to memory, so verification
links, email-change confirmations and password resets are still there
afterwards — as they are after a version bump, or after any other edit to
`managed.yml` that replaces the container. The store is capped at
`MP_MAX_MESSAGES` (500), which is what stops a volume nothing prunes from
becoming the next thing to fill the disk.

Two things that stay true after you do it:

- **It is still unauthenticated to everyone ON that mesh.** The question moves
  from "who can route to this box" to "who is on this network" — and a default
  peer-to-peer policy includes every device you enroll later. If the answer is
  more than one person, give Mailpit its own password as well
  (`MP_UI_AUTH_FILE`).
- **A public name is still the wrong answer.** `mail.example.com` with public
  DNS and a certificate publishes every password-reset link this stack sends to
  whoever finds it. `0.0.0.0` — and a bind variable with no default, which is
  the same mistake by omission — are refused by a rule in
  `scripts/the-mail-the-issuer-could-not-send.unit.test.ts` rather than by
  convention.

**Mailpit is for OTA and development only.** It is in `managed.yml` because
every environment that is not production wants its mail caught rather than
delivered. A production stack points `SMTP_HOST` at a real relay and never
starts this service.

**A catcher rather than a relay, on purpose.** Every mail the product sends is
visible in a browser; the gate exercises grant, decline and now request on every
nightly run, and none of it can reach a real inbox. `NOTIFY_FROM` and
`NOTIFY_TO` default to `…@ownpace.invalid` — RFC 2606 reserved, so if these ever
reach a real relay the result is a bounce rather than mail to a stranger.

**For real delivery**, point `SMTP_HOST` at a relay, set `SMTP_PORT` /
`SMTP_SECURE` to match, and set `NOTIFY_TO` to an address a person reads. Then
re-run `./deploy/compose/set-task-env.sh` — task containers inherit nothing from
compose, so a value only in `.env` is a value the digest will never see.

`bootstrap-managed.sh` says so out loud when `SMTP_HOST` is still the catcher
and `WEB_URL` is an https origin that is not localhost: every send would report
`sent`, because it *was* sent — to a server whose job is to keep it.

**Somebody knocking now reaches you.** Until 2026-08-24,
`POST /api/access-requests` inserted a row, wrote one log line and told nobody:
the queue was the intended channel, which works exactly as well as somebody's
habit of opening it. It now sends `access_requested` to `NOTIFY_TO`, carrying
the address, organisation and tier — **not** the applicant's note, which stays
in the database behind authentication where the queue shows it. When no channel
is configured the API logs, per request, that nobody was told.

## The CI runner is a different checkout from wherever you did this by hand

If you brought the stack up manually — following this document, on this same
machine — **that checkout and the CI runner's checkout are not the same
directory**, even on a self-hosted runner. `actions/checkout` clones into its
own workspace (typically `<runner>/_work/<repo>/<repo>`), and `deploy/compose/.env`
in your manual clone does nothing for a workflow running from there.

Worse: `actions/checkout` defaults to `clean: true`, which runs `git clean
-ffdx` before every checkout — the `-x` reaches gitignored files, `.env`
among them. So even hand-placing `.env` in the runner's checkout once does
not survive the *next* run. `e2e-managed.yml` now works around this by
persisting the one-time setup **outside** any checkout — at
`$MANAGED_ENV_PERSIST_DIR` (default `~/.persistent/ownpace-managed` on
the runner, overridable as a repository variable) — and restoring it into
the checkout at the start of every run, before the refuse-early check.

**Because `docker compose -f deploy/compose/managed.yml` pins its project
name, the containers are the same regardless of which checkout ran the
command that created them.** So if you already have a working manual stack,
the one-time setup for CI is not a second bring-up — it is copying your
already-correct `.env` into the persist directory:

```bash
mkdir -p ~/.persistent/ownpace-managed
cp deploy/compose/.env ~/.persistent/ownpace-managed/.env
cp deploy/compose/pgbouncer/userlist.txt ~/.persistent/ownpace-managed/userlist.txt
```

### One box, one stack, one `.env`

**Then replace your copy with a link, and do not skip this.** The `cp` above is
a one-time seed. Left as two files it becomes two *configurations* for one
stack, and they drift the moment either side writes — which both sides do:
`setup-zitadel.sh` writes the issuer and the rotated PAT expiry, and you write
whatever you tune by hand.

```bash
ln -sfn ~/.persistent/ownpace-managed/.env deploy/compose/.env
```

Only *your* checkout gets the link. The runner's cannot have one — `git clean
-ffdx` deletes it like any other ignored file — which is exactly why the
workflow restores a copy at the start of every run and persists it back at the
end.

**What it costs when they drift** (2026-08-24, workplan 0099). The `zitadel`
Postgres role's password matched the *runner's* copy. A hand-run bring-up
presented the other one, and Zitadel — which finds an existing role, logs
`user already exists, skipping creation`, and does **not** reset its password —
crash-looped. A crash-looping container is indistinguishable from a slow one
until the readiness deadline passes, so the answer arrived after 300 seconds of
silence, and it named a password nobody had changed. The same divergence had
`ZITADEL_PAT_EXPIRY` in one file describing a token the database did not have.

Three things now make that loud instead of silent:

- `bootstrap-managed.sh` lists any diverging keys **by name** at the top of
  every phase, including the `--from …` resumes that skip preflight. Names
  only — the values are secrets.
- It asks the `zitadel` role for its password **before** starting the
  container, so the answer takes a second rather than five minutes — and it
  asks over the container's **network address**, not the socket. See below:
  the first version of this check could not fail.

**The check that could not fail** (2026-08-24, same day, one bring-up later).
Both the preflight and `zitadel-db-password.sh` asked with
`docker exec ownpace-db psql -U zitadel`. That connects over the **Unix
socket**, and the official Postgres image's generated `pg_hba.conf` answers the
socket and `127.0.0.1` with `trust`: `PGPASSWORD` is never sent and never
looked at, so the query succeeds with *any* password. Both reported

> the zitadel role accepts the password in .env — nothing to do

three times across two runs — and Zitadel, connecting from its own container,
matched the appended `host all all all scram-sha-256` line instead and was
refused with `SQLSTATE 28P01`, five minutes later. The vacuous pass also
short-circuited the repair: `--sync` exits at the check, so the one command
that fixes this declined to run on the grounds that there was nothing to fix.

`managed.yml`'s own header had said so since 2026-07-25, about the
`openmigrate` role — "only a connection from another container's real IP
exercises the scram-sha-256 rule". Nobody carried it thirty lines down the same
file. Every query in `zitadel-db-password.sh` now goes to the container's real
address, refuses to run at all if it cannot resolve one, and **says which
address it asked over** in the passing message. There is one copy of the
question, and `bootstrap-managed.sh` calls it.
- `env-upsert.sh` **follows the link instead of replacing it**. Its write is
  write-temp-then-rename, and `mv -f tmp link` would silently turn the link
  back into a regular file — re-forking the two on the first `TRIGGER_CLI_PROFILE`
  or rotated PAT expiry, with nothing said.

If the role and your `.env` have already parted company:

```bash
./deploy/compose/zitadel-db-password.sh          # check, change nothing
./deploy/compose/zitadel-db-password.sh --sync   # point the ROLE at .env
```

Check the divergence list first. If a second `.env` exists, the role may be
matching *that* one, and syncing would break the other consumer instead of
fixing yours.

**What still could not break the link, and what could.** `env-upsert.sh` is now
the *only* thing that writes `.env`. `ensure-env-secrets.sh` used to write with
`sed -i`, which replaces a symlink with a regular file and leaves the canonical
copy **stale** — the 2026-08-24 divergence exactly, reintroduced by the script
that generates the credentials. It only ran when a key was absent, empty or a
placeholder, so an established `.env` never tripped it: the link would have
survived every ordinary bring-up and died on the first feature that added a new
required secret. `scripts/one-stack-one-env.unit.test.ts` now refuses `sed -i`
and `mv` aimed at the live `.env` anywhere under `deploy/compose/`, and runs
`sed -i` against a real symlink to show why.

The bring-up also reports two files **when they still agree**, not only once
they have drifted — quiet under CI, where `git clean -ffdx` makes a symlink
impossible and the advice would be untakeable.

**Do not run a fresh `bootstrap-managed.sh` or `ensure-env-secrets.sh` in the
CI checkout to "set it up independently.**" It would generate different
random secrets for the *same*, pinned-name containers your manual checkout
is already using — the same class of outage as rotating
`TRIGGER_ENCRYPTION_KEY` without a plan, self-inflicted on a stack that was
just proven working. Reuse what already works; only generate fresh secrets
when there is no working stack yet at all.

**The deploy CLI's login is the same gap, one phase later — and it has a
better answer than restoring a session file.** `deploy` reads
`TRIGGER_ACCESS_TOKEN` directly, before ever touching a profile file, and
this is the CLI's *own* documented answer for CI: unable to run the
interactive flow, it throws

> Authentication required in CI environment. Please set the
> TRIGGER_ACCESS_TOKEN environment variable with a Personal Access Token.

**Preferred**, one-time, in the GitHub UI: mint a token at the self-hosted
instance's own dashboard — *Account → Personal Access Tokens* — or reuse an
existing `tr_pat_…` from `${XDG_CONFIG_HOME:-$HOME/.config}/trigger/config.json`
if you already have one. Then, in the repository: **Settings → Secrets and
variables → Actions → New repository secret**, named `TRIGGER_ACCESS_TOKEN`.
`e2e-managed.yml` also sets `TRIGGER_API_URL` alongside it — required,
because unset, the CLI's env-var login path defaults to the SAAS cloud
(`api.trigger.dev`), not this instance.

**Fallback, if you would rather not mint a token:** the session file still
gets restored the same way `.env` does —

```bash
mkdir -p ~/.persistent/ownpace-managed
cp "${XDG_CONFIG_HOME:-$HOME/.config}/trigger/config.json" \
   ~/.persistent/ownpace-managed/trigger-cli-config.json
```

— though note `whoami` structurally cannot see `TRIGGER_ACCESS_TOKEN` (it
never reads that variable, only `deploy` does), so a manual bring-up that
sets the token will still print "not logged in" from `whoami` even though
`deploy` works fine. That asymmetry is the CLI's, not this repo's.

Neither path makes the login *itself* automatable — creating the account
and project is still the one step that opens a browser (0084 T6). Both only
let a credential obtained once survive to the next run.

## When it goes wrong

| What you see | What it is | What to do |
| --- | --- | --- |
| `pgbouncer` logs `could not open auth_file … Permission denied`, then `no such user: pgbouncer_auth` | `userlist.txt` was written 0600 by the host user; PgBouncer reads it as a different user inside the container, finds no users, and rejects every login | `chmod 644 deploy/compose/pgbouncer/userlist.txt`, then force-recreate. `ensure-env-secrets.sh` now writes 644 and `--only data` repairs the mode |
| The seed or a host-run script talks to the wrong Postgres | On a shared host, `localhost:5432` may belong to something else entirely — this stack's Postgres is published wherever `POSTGRES_PORT` says | The `demo` phase asks `docker compose port postgres 5432` rather than trusting a default. For your own commands, do the same |
| `deploy-tasks.sh` proceeds past its own login check and then fails with `Unable to validate existing personal access token` / `Invalid or Missing Access Token` | `whoami` exits 0 whether or not you are actually logged in — confirmed from the CLI's own source, an auth failure returns data rather than throwing. A stale profile (e.g. left over after `reset-trigger.sh`) passes the check and only fails once `deploy` tries to use it | `npx -y trigger.dev@<version> login -a http://localhost:${TRIGGER_PORT:-3090} --profile <profile>`, then re-run. Fixed at the source in `trigger-cli-lib.sh`, which both scripts now use instead of trusting the exit code |
| `deploy-tasks.sh` says **`Not logged in`** while `trigger.dev login` answers **`You are already logged in`** | The instance's database was destroyed (a wipe, `down -v`, a rename cutover) but the CLI profile at `~/.config/trigger/config.json` is on the HOST and survived it. `login` sees a token in the profile and short-circuits without validating it against the instance, so it reports success for a token whose account no longer exists; `trigger_cli_logged_in()` reads `whoami`'s output properly and correctly says no. **`login` alone cannot fix this** — it never gets far enough to replace the token | `npx -y trigger.dev@<version> logout --profile <profile>` **first**, then `login` as above. If `logout` also short-circuits, delete the profile's entry from `~/.config/trigger/config.json`. **Until 2026-08-31 this symptom had a SECOND cause with the same appearance**: the detector piped `whoami`'s output into `grep -q`, which exits at the first match, so under `set -o pipefail` a long-enough answer killed the producer with SIGPIPE and the pipeline returned 141 for a match that had SUCCEEDED. Verified and fixed — it now reads from a here-string — so on a current checkout this row's cause is the only one left |
| `trigger-supervisor` is `Restarting`, its log says **`Unable to read worker token from file: EACCES … /home/node/shared/worker_token`**, and `up` aborts with `container trigger-supervisor is unhealthy` | trigger-api bootstraps the worker token into the shared volume as **root, mode 0600**; the supervisor reads it as **node**. On a FRESH `trigger_shared` volume — first install, or after a `down -v` — it cannot open its own credential. Everything else reports healthy, so the stack looks fine while dequeuing nothing | `docker exec -u 0 trigger-api chown node:node /home/node/shared/worker_token`, then `docker restart trigger-supervisor`. **chown, not `chmod 644`** — the token is a credential and root bypasses permissions anyway. `bootstrap-managed.sh`'s `trigger` phase now does this between trigger-api and the supervisor, so a fresh volume no longer needs the manual step |
| `set-task-env.sh` fails **`Invalid or Missing API key`** against a `proj_…` ref that looks right | Same cause, other credential: `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY` in `.env` belong to the destroyed instance. `bootstrap-managed.sh`'s `account` phase **short-circuits when both are already set** (it cannot tell a stale value from a good one), so re-running bring-up never replaces them | `./deploy/compose/trigger-credentials.sh --write` — it reads the ref and the prod key out of the INSTANCE and upserts both, overwriting whatever `.env` held. Then re-run `set-task-env.sh` |
| A config fix to `pgbouncer.ini` seems to change nothing — same error after pulling | `pgbouncer.ini` is a bind mount read once at start-up, and `up -d` does not recreate a container whose spec has not changed, so the old process keeps running the old file | `docker compose -f deploy/compose/managed.yml up -d --force-recreate pgbouncer`. `--only data` now does this automatically when the container is unhealthy |
| `pgbouncer` log says `cannot use the reserved "pgbouncer" database as an auth_dbname` | `auth_user` set in the **global** `[pgbouncer]` section governs the admin console too, and the console's database name is reserved — so `auth_query` cannot run and every connection is refused. A per-database `auth_dbname` does not help: the console is not matched by `*` | Fixed by moving `auth_user` onto the `*` entry, where it applies to real databases only. `auth_dbname` there must equal `POSTGRES_DB`; `--only data` refuses if they disagree |
| `pgbouncer` reports `unhealthy` after ~80s, and its own log says the user is not allowed | The healthcheck reads `SHOW POOLS` from the admin console, which PgBouncer refuses to anyone not in `stats_users`/`admin_users` | Fixed in `pgbouncer/pgbouncer.ini` (`stats_users = pgbouncer_auth`). On an older checkout, pull and `--only data` |
| Any `docker compose` command fails with `required variable X is missing a value` | Compose interpolates the **whole** file before running anything, so one unset variable breaks every command — including ones that never touch the service named in the error. An `.env` that predates the pooler hits this on `PGBOUNCER_AUTH_PASSWORD` | `./deploy/compose/ensure-env-secrets.sh`, then `--only data` to create the matching Postgres role and start the pooler |
| `pgbouncer` never becomes healthy, complains about a password | `setup-auth.sql` has not run, or ran without `my.pw` set | `--only data`. The SQL now refuses an unset `my.pw` rather than creating a role with no password |
| Every app connection: `password authentication failed`, though `.env` and the container agree | A volume from a *different* project — compose's project name derived from the directory basename | `managed.yml` pins `name: ownpace-managed`. Check `docker volume ls` for a stray `compose_postgres_data` |
| `trigger.dev login` prints an authorization URL on the https front, and **Firefox** answers *"De pagina verwijst niet op een juiste manier door"* / cannot connect to `<host>:3443`, while **Chromium completes the same URL** — both after clicking through the self-signed-certificate warning | **Observed 2026-08-31 on the Spark, and NOT root-caused — do not repeat the following as though it were the cause.** What is known: `trigger-tls` serves a self-signed certificate, the dashboard's session is a `Secure` cookie, and a session cookie that never sticks renders precisely as "isn't redirecting properly". Chromium and Firefox do not agree about what a connection whose certificate was manually overridden may do with cookies. Whether that is what happened here was not established, because the workaround cost nothing | Do the one-time login in Chromium. The token lands in the host's CLI profile and no browser is needed again, so this is one browser choice per machine and blocks nothing. **It says nothing about the PRODUCT's sign-in**, which is Zitadel on a real hostname with a real certificate — if that ever fails in one browser only, it is a different fault and this row is not it |
| The `login` phase refuses, you run the printed command, it succeeds, and the phase refuses again | Two different things, both true: `TRIGGER_CLI_PROFILE` names the profile the phase asks for, and the CLI stores logins per profile NAME in `~/.config/trigger/config.json` on the host. Setting the variable does not create the login; logging in under the old name does not satisfy the new setting | Read the two lines the refusal prints — `in use` and `default`. Either log in under the name in use, or point the setting at a name the machine already has: `./deploy/compose/env-upsert.sh deploy/compose/.env TRIGGER_CLI_PROFILE=<name>`. Do not delete the other profile to tidy up; the gate's runner may be using it |
| `trigger-magic-link.sh` finds nothing | The link is only written when one is **requested** | Submit your email on the dashboard's login page first, then re-run |
| Dashboard loads but the login never completes | `TRIGGER_APP_ORIGIN` / `TRIGGER_LOGIN_ORIGIN` do not match the address the browser is using; the `Secure` cookie is dropped | Set both (and `TRIGGER_TLS_HOST`) to the real address, then `--from trigger` |
| `npx trigger.dev deploy` dies with a bare `Connection error` | The CLI was pointed at the https front | Log in against `http://localhost:3090` |
| `git status` shows `apps/worker/package.json` modified after a deploy | The Trigger.dev CLI rewrites the file — usually only stripping its trailing newline | `git diff` it; discard unless it is a real SDK bump. `deploy-tasks.sh` now says so rather than leaving you to find it |
| `Seed failed: DATABASE_URL, JWT_SECRET, SECRET_ENCRYPTION_KEY are not set` | The seed runs on the host and inherits nothing; nothing in `apps/api` loads a dotenv file | The refusal now names it: `./deploy/compose/seed-managed.sh`, which reads `.env` and asks compose for the published port. This row is the historical spelling — until 2026-08-25 the message named one variable and no remedy, which is how it reached this table instead of the operator |
| Demo owner tokens are rejected by the API | They expire after seven days | Re-run `./deploy/compose/seed-managed.sh` — it is idempotent and mints fresh ones |
| Supervisor loops on `Snapshot changed inside startRunAttempt`, runs pile up `EXECUTING`, runner containers accumulate | Almost certainly **not** about snapshots. Check `docker compose logs trigger-api` for `Unsupported state or unable to authenticate data` at `PrismaSecretStore.getSecrets` — that is `TRIGGER_ENCRYPTION_KEY` no longer matching the stored secrets | See "Rotating `TRIGGER_ENCRYPTION_KEY`" above. `set-task-env.sh` alone does not fix it |
| `set-task-env.sh` fails with a bare `Connection error`, and works when re-run | It was run straight after `trigger-api` was recreated, before the webapp was accepting requests | Nothing — it now waits for the webapp before uploading, and says so |
| A secret in `.env` is a `change-me-…` value and was never generated | `ensure-env-secrets.sh` used to treat any non-empty value as set, so an `.env` copied from an older template kept its shipped placeholders for ever | Re-run `./deploy/compose/ensure-env-secrets.sh` — it now replaces placeholders and prints what to recreate afterwards |
| `--from trigger` refuses with "Trigger.dev version drift" | `TRIGGER_IMAGE_TAG` and `@trigger.dev/sdk` disagree (0018 T0). Unset, the tag falls back to `managed.yml`'s default, which is easy to miss | Set `TRIGGER_IMAGE_TAG` to `v<sdk version>`, or pin the SDK back. The refusal prints both commands |
| The deploy asks "Would you like to apply those updates?" mid-script | `apps/worker/package.json` pins one SDK version and `node_modules` holds another, so the CLI offers to reconcile them — and waits. In CI there is no terminal to answer from | `pnpm install --frozen-lockfile`, then re-run. `deploy-tasks.sh` now refuses up front rather than letting the deploy become interactive |
| The CLI sits at its version banner for tens of minutes | `npx`'s "Ok to proceed?" install prompt, invisible because output is discarded | Every script here uses `npx -y`; if you are running it by hand, do too |
| Task runs die instantly, no logs, runner container gone | `DEPLOY_IMAGE_PLATFORM` does not match the host | Fix it in `.env`, `up -d --force-recreate trigger-api` (it is read server-side), then `--from tasks` |
| Enqueues fail by name; runs land `failed` immediately | `TRIGGER_SECRET_KEY` unset or not a `tr_prod_` key | `--only account`, then `up -d api` |
| Tasks run but cannot reach the database | The task environment was never uploaded, or holds `localhost` | `./deploy/compose/set-task-env.sh`. Values are read at run start; no redeploy needed |
| `trigger-credentials.sh` says the schema is not the one it knows | **Two causes, and the second one is not about Trigger.dev at all.** Either a version bump renamed a column — or the check was asked through a pipeline its own consumer could kill. `printf … | grep -qxF "$col"` under `set -o pipefail` returns 141 when grep SUCCEEDS: `grep -q` exits at the first match without draining, the producer dies of SIGPIPE, and pipefail hands back the signal. `PIPESTATUS` is `(141 0)` — the answer was yes | If the refusal names a column you can see in the database, it is the second cause and the checkout predates the fix: every such pipeline now reads from a here-string, and `no-pipeline-its-own-consumer-can-kill.unit.test.ts` fails the build if one comes back. If the column really is gone, it is the first: read the two values from the dashboard by hand — the refusal names both pages |
| Seed fails on `DATABASE_URL … is required` | It is running on the host and inherits nothing | Use the `demo` phase, which exports them from `.env` |
| `ownpace-idp` is `Up N minutes (unhealthy)` — RUNNING, not restarting — and its log is clean right down to `server is listening`. **A current checkout cannot produce this: the service has no healthcheck any more** (see the row below). If you are seeing it, the checkout predates that change |
| `[setup-zitadel] FATAL: it did not become healthy within five minutes`, on a run where the provider is plainly up and serving | **A second waiter, on a health signal that no longer arrives.** `setup-zitadel.sh` polled `"Health":"healthy"` from `docker compose ps`; the identity provider has no healthcheck (see the rows above), so that field is never set and the wait always runs its full five minutes | Fixed: it now asks `/debug/ready` on the published port, the same address the bring-up uses. `nothing-waits-on-a-health-that-cannot-arrive.unit.test.ts` fails the build if any script waits on the health of a service that declares no healthcheck |
| The bring-up prints `the identity provider never became ready at http://localhost:3126/debug/ready` | **The readiness check is asked from the host, not from inside the container**, because `zitadel ready` builds its URL from `ExternalPort` — the address the OUTSIDE reaches Zitadel on — and nothing listens there inside. Here that is a published port; behind netbird it is 443, terminated by something that is not Zitadel | Read the code the message names. `000` means nothing answered at all — check the container is up and the port published. Any other code means Zitadel answered and said no, which is a real not-ready and its log is the next place to look. The timeout is `IDP_READY_TIMEOUT` (default 300s); a first init applies every migration from scratch and a slow disk can need longer | **The container is fine and the probe is not.** A healthcheck runs beside the container and its output goes nowhere near `docker compose logs`; Docker keeps the last few attempts in `.State.Health.Log`. This is the one failure shape the log windows cannot describe, because the answer was never in the log | The bring-up now prints a fourth window, `what the HEALTHCHECK said`, read straight from `docker inspect`. By hand: `docker inspect ownpace-idp --format '{{json .State.Health}}' \| jq`. Do NOT delete or weaken the healthcheck to get green — a provider that is unhealthy while serving is the gate working, and an untested probe is how a stack ends up trusting an identity provider that is not there |
| `[setup-zitadel] FATAL: could not read /machinekey/pat.txt (exit 127)` naming `"cat": executable file not found in $PATH` | **The provider's image has no shell and no coreutils.** `docker compose exec -T zitadel cat …` cannot work, and Docker reports that on STDOUT with exit 127 — so a command substitution captures the error message as if it were the file's contents. Before this refusal existed, that sentence was sent to Zitadel as a Bearer token, which answered `illegal base64 data at input byte 3` (byte 3 is the space after `OCI`) and then `Errors.Token.Invalid` | Nothing to do on a current checkout: the token is read off the VOLUME with busybox, via the `zitadel-machinekey` service that already mounts it. If you are reading the file by hand, do the same — `docker run --rm -v ownpace-managed_zitadel_machinekey:/m:ro busybox:1.37 cat /m/pat.txt` — and never `exec` into `ownpace-idp`, which has no binaries to run |
| `[setup-zitadel] FATAL: GET /auth/v1/users/me answered HTTP 401` with `Errors.Token.Invalid (AUTH-7fs1e)` | **The token and the database disagree about which instance this is.** `/machinekey/pat.txt` is written at FIRST INIT and belongs to the instance created then. Clearing the zitadel DATABASE while keeping the machinekey VOLUME leaves a token for an instance that no longer exists; clearing the volume while keeping the database leaves no token at all, since init never runs again to write one. E2E (managed) #50 is the first of these. It can equally mean the token **expired**: each one lives `ZITADEL_PAT_LIFETIME_DAYS` (7) days and `setup-zitadel.sh` rotates it inside the last `ZITADEL_PAT_ROTATE_BELOW_DAYS` (3), so an expired token is what a gate that slept past the gap wakes up to — the refusal itself says which cause is in front of you | **The database and the volume go together.** Either keep the instance — sign in at `http://localhost:3126/ui/console` as the first user, read the client id from the Ownpace project's application, and `env-upsert.sh` `JWT_ISSUER` / `JWT_AUDIENCE` / `VITE_OIDC_CLIENT_ID` by hand — or start over, which destroys every account it holds: `docker compose -f deploy/compose/managed.yml rm -sf zitadel`, then `docker exec -i ownpace-db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS zitadel WITH (FORCE)"'`, then `docker volume rm ownpace-managed_zitadel_machinekey`, then re-run. The `zitadel` ROLE can stay. Both halves, every time |
| `[setup-zitadel] FATAL:` a call to the identity provider's API refused, naming an HTTP status | **Read the status, they mean different things.** `401` — the provisioning token was not accepted: it **expired** (`setup-zitadel.sh` rotates it before that on every run, so this means the gate slept past the rotation window — mint a new personal access token on the `ownpace-setup` service user in the console and write it over `/machinekey/pat.txt`), or it belongs to an instance that no longer exists, because the zitadel DATABASE was cleared while the machinekey VOLUME was kept (`/machinekey/pat.txt` is written on FIRST INIT). `403` — the token is fine and `ownpace-setup` lacks the grant the call needs, which is a role to add, not a credential to replace. Anything else prints the provider's own words | Follow the remedy the refusal names — 401 sends you to REPROVISIONING at the bottom of `setup-zitadel.sh`, 403 to the console's org roles. Before E2E (managed) #49 all of these printed `could not create the project` and nothing else, because the response body went into `jq -r '.id'` and was discarded; the search above it could not fail at all, since `.result[]?` turns an error into the same empty output a real "no such project" gives |
| `ownpace-idp` restarts for ever; the OLDEST line in the failure window is `migration failed … name=34_add_cache_schema error="ERROR: partitioned tables cannot be unlogged (SQLSTATE 0A000)"` | **The identity provider is older than the database it is pointed at.** Zitadel's cache schema created an UNLOGGED PARTITIONED table and PostgreSQL removed support for that, so setup step 34 fails on every attempt and the provider can never finish starting. Not a misconfiguration, and no setting avoids it (zitadel/zitadel#10712) | Nothing to do on a current checkout: the pinned image is above the fix (zitadel/zitadel#11484), and `zitadel-image-matches-postgres.unit.test.ts` fails the build if the two pins are ever moved into a pairing that cannot initialise. If you hit this on an older checkout, raise the Zitadel pin — do not lower Postgres — and then clear the half-written database as the row below describes |
| `ownpace-idp` restarts for ever; the OLDEST line in the bring-up's failure window is `migration failed … name=03_default_instance error="open /machinekey/pat.txt: permission denied"` | **The machinekey volume is not writable by the identity provider.** Docker creates a new named volume's mount point owned by root, and the Zitadel image runs as a non-root user — which the error proves, since root could have written anywhere. `03_default_instance` creates the first human BEFORE the machine account, so while the admin password was being rejected this was never reached; fixing the password is what exposed it | Nothing to do by hand on a current checkout: the bring-up reads the image's own `Config.User` and prepares the volume before starting the provider. `v4.6.2` reports a NAME (`zitadel`), not a uid — so where that happens the bring-up reads the number out of the image's own `/etc/passwd`, the same file Docker resolves the name against, via `docker create` + `docker cp` (no shell in the image is assumed, and nothing is started). It REFUSES only a name that passwd does not explain, and that refusal prints the one-line `docker run` that prepares the volume by hand. Either way the half-written database from the failed attempts still has to be cleared — see the row below |
| `ownpace-idp` restarts for ever; its log ends `migration failed … name=03_default_instance` with `Errors.Instance.Domain.AlreadyExists` and `Key (instance_id, unique_type, unique_field)=(, instance_domain, localhost) already exists` | **Partial state from an earlier failed init.** `03_default_instance` registers the instance domain and THEN creates the first human. If that second half fails — a password the complexity policy rejects, say — Zitadel logs `setup failed, skipping cleanup` and means it: the domain row stays. Every retry re-runs the migration from the top, hits its own leftover row, and dies on a duplicate key that says nothing about the original cause | The `zitadel` database has to go. Nothing depends on it while init has never completed — no users, no clients, no tokens: `docker compose -f deploy/compose/managed.yml rm -sf zitadel`, then `docker exec ownpace-db sh -lc 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS zitadel WITH (FORCE)"'`, then `docker volume rm ownpace-managed_zitadel_machinekey`, then re-run the bring-up. The `zitadel` ROLE can stay — `verify user` reuses it with the unchanged `ZITADEL_DB_PASSWORD`. **Clearing it is the second half of the fix, never the whole one.** The duplicate key is what the FIRST failure left behind; if the thing that caused that failure is still in place, the very next bring-up re-poisons the database and reports the same duplicate key — four E2E (managed) runs went that way on 2026-08-23. The bring-up now prints a third log window, every line that reports a failure, oldest first: the OLDEST is the cause and the rest are its echoes. Fix that, then clear |
| Every authenticated request answers `HTTP 500 {"error":"auth_failed"}`, while `/api/ready` answers 200 and `docker compose ps` shows everything healthy | **The API cannot reach its own issuer, so verification never gets as far as a token.** With `ZITADEL_EXTERNALDOMAIN=localhost` the issuer is `http://localhost:3126` — an address the HOST reaches through the published port and the API container cannot, because inside that container `localhost` is the API. Discovery throws `connect ECONNREFUSED 127.0.0.1:3126`, which is not a JWT error, so it lands in `serverFault` as a 500 rather than a 401. E2E (managed) #52 | Nothing to do on a current checkout: the default is `ownpace-idp`, a network alias on the provider's own container, and the provider listens on the number it publishes so the origin matches from both sides. On a stack initialised under the old value the provider will refuse the new origin — see the `Instance not found` row below. A browser on the same machine needs `127.0.0.1  ownpace-idp` in `/etc/hosts`; a real deployment sets a real hostname and DNS answers for both sides |
| `[setup-zitadel] FATAL:` a call answered `HTTP 404` with `unable to set instance using origin` / `Instance not found` | **The provider does not serve the origin being presented.** Zitadel resolves which instance a request is for from the request's origin — host AND **port** — and refuses any other. **Check the port before assuming the host is wrong:** `ownpace-idp:8080` and `ownpace-idp:3126` are different origins, and an evening went into concluding that trusted domains cannot work when the real fault was a provider listening on one port and stamping another into its issuer | Nothing to do on a current checkout in the ordinary case: `setup-zitadel.sh` registers `ZITADEL_EXTERNALDOMAIN` as an instance **trusted domain** on every run, which is enough to make an instance answer for an origin it was not initialised with — proved on E2E (managed) #61, on an instance initialised as `localhost` and never re-initialised. It can only do that once it can reach the instance, so if NOTHING the instance knows still resolves, the last resort is to initialise it again; the refusal prints those commands. A provisioning token cannot add an instance *domain*: `POST /admin/v1/domains` answers `404 Not Found` and the System API answers `401 Errors.Token.Invalid` |
| Sign-in fails at the very first step with `{"error":"invalid_request","error_description":"This client's redirect_uri is http and is not allowed."}` | **The application was provisioned with `devMode:false` against an `http://` WEB_URL.** Zitadel refuses a plaintext redirect URI outright, at `/oauth/v2/authorize`, before any login screen — so the sign-in button could never work, while provisioning reported complete success: project created, application created, client id written to `.env` | Nothing to do on a current checkout: `devMode` is derived from the scheme of `WEB_URL`, and `setup-zitadel.sh` now RECONCILES an application it finds rather than only reading its client id, so an existing stack is put right on the next bring-up |
| Sign-in completes and then every request is refused with `Missing required claims in token payload` | **The access token carries no email address, and the API requires one.** ADR-0042 narrowed the required claims to `sub` + `email` because invitations are addressed to an email address and a first-time signer-in has no row to look one up in. Zitadel puts user info claims in the ID token and NOT in the access token — measured with `idTokenUserinfoAssertion` both off and on | Nothing to do on a current checkout: the application is provisioned with `idTokenUserinfoAssertion` on, and `apps/web/src/services/oidc.ts` sends the ID token. Its audience is `[client id, project id]` and `JWT_AUDIENCE` is that project id, so the API validates issuer, audience, signature and expiry exactly as it would for an access token |
| The smoke says `the API cannot reach the issuer at all` on a stack whose issuer is plainly fine | **The check asked with a client the image has not got.** `ownpace-api` is `node:24-slim` — no curl, no wget — so `docker exec … curl …` printed `curl: not found`, `\|\| true` swallowed the 127, and the empty string was reported as a verdict about the issuer. The container's own HEALTHCHECK has used `node -e "fetch(...)"` all along | Nothing to do on a current checkout: the smoke asks with node, and keeps "the probe could not run", "the issuer could not be reached" and "the issuer answered X" apart — three facts about three different things (hard rule 10) |

---

## Redoing a rollout somewhere else

The whole configuration is `deploy/compose/.env` plus the two human steps.
On a new machine:

```bash
git clone … && cd Ownpace && pnpm install --frozen-lockfile
./deploy/compose/bootstrap-managed.sh
```

Do **not** copy an old `.env` across wholesale. Copy the *decisions* — prices,
SMTP, OAuth, the public URLs — and let `ensure-env-secrets.sh` mint fresh
secrets. A secret that exists on two machines is a secret that gets rotated on
neither. `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY` in particular belong to
the *old* instance and are meaningless on the new one; the script will read the
new instance's own.

**Upgrading Trigger.dev** is one number in FOUR places that must agree: the
two `${TRIGGER_IMAGE_TAG:-…}` defaults in `managed.yml`, `TRIGGER_IMAGE_TAG` in
`managed.env.example`, and `@trigger.dev/sdk` in `apps/worker/package.json`
(`.env`'s `TRIGGER_IMAGE_TAG`, when set, overrides the compose default on that
machine). `--from trigger` refuses at bring-up when they disagree, and
`bootstrap-managed.unit.test.ts` refuses in CI — added after dependabot moved
the SDK alone, passed all seventeen checks and broke the managed gate.

`trigger-version.sh` does the whole thing rather than leaving it to `sed`:

```
./deploy/compose/trigger-version.sh list              # running / pinned / what you can move to
./deploy/compose/trigger-version.sh backup pre-4.5.12 # verified dump of triggerdb
./deploy/compose/trigger-version.sh pin --latest      # moves all four places
./deploy/compose/trigger-version.sh backups           # what dumps exist
./deploy/compose/trigger-version.sh restore --latest --yes   # DESTRUCTIVE rollback
```

`list` probes the registry by manifest rather than reading its tag list: ghcr's
`/tags/list` is neither newest-first nor complete in one page — with `n=1000`
the newest `v4.5.x` it returns is `v4.5.4`, while `v4.5.9` and `v4.5.12` both
exist. Asking whether a specific tag exists is the question it answers
reliably, so that is the question asked, upward from the version already
pinned.

> **Back the database up first, because the upgrade is one way.** The webapp
> applies its own schema migrations on boot and Prisma has no down-migrations,
> so putting the old tag back restores the IMAGES and not the schema they
> migrated. `triggerdb` holds the account, the project, its API keys, the
> worker group and the deployed-task records — the things whose loss needs a
> person, a browser and a magic link to repair. The managed gate runs
> `trigger-version.sh drill` on every pass, which dumps that database,
> restores it into a throwaway and compares, so the backup is never only a
> claim.

> ⚠️ **Do not upgrade with runs in flight.** Recreating the webapp and
> supervisor under load left the reference deployment looping on
> `Failed to start run … "Snapshot changed inside startRunAttempt"` for every
> run: nothing reached a task body, and the schedule kept adding one run a
> minute on top (2026-08-18). Cancelling the backlog through the API did not
> help — new runs failed identically — so it was the version, not the state.
>
> The order that avoids it:
>
> 1. Stop the schedule producing work, or accept a backlog you will cancel.
> 2. Wait for `TaskRun` to have nothing in `EXECUTING`.
> 3. Change the tag AND the SDK together, `pnpm install`.
> 4. `--from trigger`, then **redeploy the tasks** — an image built by one CLI
>    version and run by another platform version is the same drift by a
>    different route.
> 5. Watch the first few runs reach `COMPLETED_SUCCESSFULLY` before walking
>    away.
>
> Rolling back is the same procedure in reverse, and is the right first move
> when an upgrade goes wrong: the older version has run history behind it and
> the newer one does not.

> ⚠️ **The four places are not the only thing an upgrade depends on.** The
> v4.5.12 attempt did all of the above — verified backup, drained queue, all
> four numbers moved with the tool — and `trigger-api` crash-looped anyway on
> a dependency none of it looked at:
>
> ```
> Code: 80. DB::Exception: Only literals can be skip index arguments. (version 25.5.2.47)
> ```
>
> `clickhouse` was `bitnamilegacy/clickhouse:latest`. Nothing in the repository
> said which ClickHouse the stack ran, so nothing could notice it ran one whose
> SQL dialect rejects a migration the new webapp ships. `bitnamilegacy` is
> archived and tops out at 25.7.5, so there was no newer tag there to move to.
> The migration failed closed and the rollback to v4.5.9 was clean — no restore
> needed — which is the one part that went right.
>
> ClickHouse is now `clickhouse/clickhouse-server:26.2.19.43`, pinned **by
> digest**, which is what upstream's own compose file runs for this release and
> therefore the only ClickHouse the migration has been proved against.
> `bootstrap-managed.unit.test.ts` refuses any `latest` in `managed.yml` from
> here on, so this cannot happen quietly a second time.
>
> **The first bring-up after that change starts ClickHouse EMPTY, on purpose.**
> Bitnami kept its data under `/bitnami/clickhouse` and the official image reads
> `/var/lib/clickhouse`; handing one vendor's directory layout to the other is
> not an upgrade. So the mount moves to a new volume, `clickhouse_data_v2`, and
> the old `clickhouse_data` is left on disk untouched. What is lost is
> **dashboard task-event history** — ClickHouse is the event store, derived from
> the run records in `triggerdb`, so nothing about running, deploying or
> recovering tasks depends on it. Remove the old volume only when you have
> decided you want the space:
>
> ```
> docker volume rm ownpace-managed_clickhouse_data
> ```

> **MinIO was floating too, and told a slightly worse lie.** It was
> `bitnamilegacy/minio:latest`, and that tag stopped moving on **2025-07-03** at
> `2025.5.24` — while the repository went on publishing until 2025-08-19 and ends
> at `2025.7.23-debian-12-r5`. So `latest` was not even bitnamilegacy's last
> word: it quietly stopped six weeks early, and nothing recorded which MinIO the
> stack ran.
>
> It is now pinned to **what was already running** —
> `bitnamilegacy/minio:2025.5.24-debian-12-r5` by digest. That changes the name
> of what runs and not the bytes, on a service holding Trigger.dev's packets and
> run artifacts, so it needs no volume move and no bring-up ceremony. Nothing in
> `managed.yml` floats any more, and `bootstrap-managed.unit.test.ts` refuses a
> new one.
>
> **Moving to upstream's `minio/minio` is a separate job**, and it is not a tag
> swap. Whoever does it needs all four of these:
>
> 1. `command: server /data --console-address ":9001"` — bitnami's entrypoint
>    supplies this; upstream's does not, and the container exits without it.
> 2. The data path changes from `/bitnami/minio/data` to `/data`, so a **new
>    volume** and an empty object store, exactly as ClickHouse did.
> 3. `MINIO_DEFAULT_BUCKETS` **does not exist** upstream. It is a bitnami
>    convenience, and it is what creates the `packets` bucket. Upstream uses a
>    separate `minio-init` service running `mc mb -p local/packets`; without it
>    MinIO comes up healthy and every packet write fails.
> 4. A healthcheck on `/minio/health/live`, which this service has never had.
>
> Losing the packets store costs historical large run payloads and outputs — not
> deployments, which live in the registry, and not the ability to run anything.

**Rotating a secret**: change it in `.env`, `docker compose up -d` the affected
services, re-run `set-task-env.sh` if a task variable changed, and re-mint any
JWTs signed with a rotated `JWT_SECRET`. Rotating `SECRET_ENCRYPTION_KEY`
**strands stored connection credentials** — they have to be re-entered.
Rotating `TRIGGER_LOGIN_SECRET` signs everyone out **including the deploy
CLI**, whose stored token then fails with `Unable to validate existing personal
access token — 500`; a `login` fixes it.

### `whoami` says nothing about whether you are logged in

`trigger.dev whoami --profile <name>` **exits 0 regardless of login state.**
Read from the installed CLI's own source (`dist/esm/commands/whoami.js` +
`cli/common.js`): an auth failure returns `{success:false}` as data rather than
throwing, and the CLI's command wrapper only marks the process failed on a
thrown exception. So a script that does

```bash
whoami --profile X >/dev/null 2>&1   # WRONG — 0 either way
```

cannot tell "logged in" from "never logged in" from "token was just revoked".
This bit the `login` phase and `deploy-tasks.sh`'s own preflight the same day,
on the same box: both reported "already logged in" against a profile left over
from before a `reset-trigger.sh`, and the deploy that followed died with

```
Error: Unable to validate existing personal access token
Invalid or Missing Access Token
```

which reads like a broken deployment rather than a login nobody actually did.
`trigger-cli-lib.sh`'s `trigger_cli_logged_in()` is the fix both scripts now
share: run `whoami` for real and look for the `User ID:` line a genuine
successful lookup prints, regardless of exit code. If you ever call the CLI
directly in a script, do the same rather than trusting `$?`.

### Rotating `TRIGGER_ENCRYPTION_KEY`

**Not a normal rotation, and `ensure-env-secrets.sh` refuses to do it for you.**

This key encrypts the Trigger.dev secret store. Changing it does not re-encrypt
anything — it strands every secret written under the old key. The failure is not
at boot; it is every run, at `startRunAttempt`:

```
Error: Unsupported state or unable to authenticate data
  at PrismaSecretStore.getSecrets
  at AuthenticatedWorkerInstance.getEnvVars
  at AuthenticatedWorkerInstance.startRunAttempt
```

which the supervisor reports as `Snapshot changed inside startRunAttempt` —
a message about snapshots with nothing in it about keys. Runs pile up
`EXECUTING`, retry containers accumulate, and nothing reaches a task body.

**Re-running `set-task-env.sh` alone does not cure it**, and the reason is
worth knowing: `envvars.upload(..., { override: true })` **skips a value whose
plaintext has not changed.** Re-encryption requires a re-write, so any variable
whose value happens to be identical is quietly left on the old key — while the
script reports success and lists it among the uploaded names.

On the reference box that was exactly one variable out of four:
`SECRET_ENCRYPTION_KEY`, whose value had not changed while the three database
URLs had. Three readable secrets, one unreadable, every run dead.

Use the force flag, which **deletes** each variable before writing it, so the
write is a creation and cannot be skipped:

```bash
SET_TASK_ENV_FORCE_REWRITE=1 ./deploy/compose/set-task-env.sh
```

**Delete, not overwrite** — and this is the part that costs a round if you get
it wrong. `envvars.upload` *reads* the existing value to decide whether the
write is a no-op, so on a variable it cannot decrypt, the repair fails on the
same error as the fault:

```
[set-task-env] FAILED: Unsupported state or unable to authenticate data
```

Deletion needs no plaintext. To repair a single variable by hand:

```bash
cd apps/worker
TRIGGER_API_URL=http://localhost:3090 TRIGGER_SECRET_KEY=… TRIGGER_PROJECT_REF=… \
  node -e 'require("@trigger.dev/sdk").envvars.del(process.env.TRIGGER_PROJECT_REF, "prod", "SECRET_ENCRYPTION_KEY").then(()=>console.log("deleted"))'
cd .. && ./deploy/compose/set-task-env.sh
```

The order that works:

1. **Before rotating**, list what is in the store:
   `SELECT key, "updatedAt" FROM "SecretStore"` — everything there has to be
   re-creatable, or you cannot rotate without losing it.
2. Drain the queue (nothing in `EXECUTING`) and stop the schedule.
3. Rotate the key, recreate `trigger-api` and `trigger-supervisor`.
4. Re-write every stored secret under the new key —
   `SET_TASK_ENV_FORCE_REWRITE=1 ./deploy/compose/set-task-env.sh` for the task
   environment, and by hand for anything else step 1 found. Then check
   `SELECT key, "updatedAt" FROM "SecretStore"`: **every** row must show a
   timestamp after the rotation. One that does not is one dead run away.
5. Redeploy the tasks and watch the first runs reach a terminal state.

**On a stack whose Trigger.dev data is disposable — which a reference or demo
box usually is — the wipe is faster and more certain than the surgery, and it is
a script because the sequence has two traps:**

```bash
./deploy/compose/reset-trigger.sh --yes
./deploy/compose/bootstrap-managed.sh --from trigger
```

The traps, in case you do it by hand anyway: the volume belongs to **`trigger-db`**,
so stopping only `trigger-api` and `trigger-supervisor` leaves `docker volume rm`
refusing with "volume is in use" — and the bring-up afterwards then quietly
reuses the old database and fails exactly as before. And the stale
`TRIGGER_PROJECT_REF` has to be cleared from `.env`, or the `account` phase sees
it populated, reports "nothing to do", and skips the human step that is now
mandatory.

The reset destroys the orchestration database only. The ledger, tenants,
mappings, items and invoices live in `ownpace-db`, a different volume, and
are untouched; the API and pooler keep serving throughout. You are then back at
the one human step, and `trigger-credentials.sh` reads the new project's
credentials.

**Turning the pooler off** is two values: `DB_HOST=postgres`, `DB_PORT=5432`,
then `up -d`. Every service reads them, so nothing in `managed.yml` is edited.

---

## What this does not cover

- **TLS and a public hostname for the API and web app.** Everything above is
  addressed by IP or `localhost`. A real deployment needs a reverse proxy with
  real certificates in front of ports 3001 and 3123, and `CORS_ORIGIN` /
  `WEB_URL` / `API_URL` set to those addresses.
- **Backups of the APPLICATION database.** Nothing here backs up `ownpace-db`
  — including the identity provider's tables, which after 8b hold the only copy
  of who can sign in. (Trigger.dev's own `triggerdb` IS covered, by
  `trigger-version.sh backup`, and its restore is drilled on every managed gate
  run. The same treatment for `ownpace-db` is not built.)
- **Anybody's first account.** `setup-zitadel.sh` stands the provider up; it
  does not create people. Invite-only means the owner does that, and the
  provisioning path for it is workplan 0093 T6, not yet built.
- **The Trigger.dev instance's own upgrade path** between major versions.
- **Bring-up from scratch, tested.** The nightly
  [`e2e-managed.yml`](../.github/workflows/e2e-managed.yml) runs this script
  from the `data` phase against a stack whose Trigger.dev half already exists,
  because tearing that half down would need a person to rebuild it. So the
  phases up to `trigger` are exercised by that gate; `account` and `login` are
  exercised only by somebody doing this on a new machine. If you are that
  person and something here is wrong, fix this document in the same change.

## See also

- [`deployment.md`](./deployment.md) — the editions and what each one is for
- [`operator-runbook.md`](./operator-runbook.md) — running it once it is up
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — symptoms across both editions
- [`rls-guide.md`](./rls-guide.md) — why the app connects as `app_user`
- [`status-page.md`](./status-page.md) — what the status page can and cannot tell you
- [`performance.md`](./performance.md) — the pooler, the rate budget, the tick
