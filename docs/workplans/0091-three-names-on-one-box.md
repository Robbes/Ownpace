# Workplan 0091 — three names on one box

## Status — 2026-08-20 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The four variables that carry the browser-visible address | 📋 Planned | `WEB_URL`, `CORS_ORIGIN`, `API_URL`, `VITE_API_URL` — and **one of them is baked into the build**, so a wrong value survives every restart. |
| T2 `www` — the smallest real site, which is the one Google needs | 📋 Planned | `site/legal/` and `site/brand/` exist and are exactly what OAuth verification requires to be reachable. The marketing pages are workplan 0086 T1 and are not this. |
| T3 `ota` — the stack that already exists, under its own name | 📋 Planned (needs T1) | Nothing to build; the stack runs. What changes is the address it believes it has. |
| T4 `app` stays dark until it means production | 📋 Planned (owner decision) | The wildcard already resolves it *to the test box*, so the URI registered as production points at development. |
| T5 What cannot work on the spark, said rather than discovered | 📋 Planned | Mollie's webhooks and Google's verification fetch both need public reachability; a mesh-only host has none. |

## Why this exists

The owner is standing up `www`, `ota` and `app` on the spark box.

**Routing and TLS are netbird's, not this repository's.** Netbird maps a subdomain to a local
target and port, and the owner has that in hand — so there is no reverse proxy to add here, no
Caddyfile to write beyond the one `trigger-tls` already owns, and no certificate story in this
plan. This plan stops at the repository boundary and covers only what is actually ours.

**The arrangement, confirmed by the owner: external names stay on the default port (443/https)
and the specific ports are internal.** That is what makes the redirect URIs registered with
Google correct as they stand — `https://ota.ownpace.eu/oauth/google/callback` carries no port
because externally there is none to carry, while netbird delivers it to whichever port the
service actually listens on. Nothing needs re-registering, and nothing has to change when a
service later moves to a different host: **the port never appears in anything Google stores.**

What *is* ours is smaller and easier to get wrong: the application does not discover its own
public address. It is told, in four places, and one of them cannot be corrected by restarting.

## T1 — the four variables that carry the browser-visible address

`deploy/compose/managed.env.example` defaults all four to `localhost`. Behind a name, every one
of them changes, and the failure modes are unalike enough to be worth listing separately:

| variable | what it is | what a wrong value looks like |
|---|---|---|
| `WEB_URL` | where browsers reach the web app | links in outgoing mail point at the wrong host — invisible until somebody clicks one |
| `CORS_ORIGIN` | the origin the API accepts | every request from the UI blocked by the browser; the app loads and then does nothing |
| `API_URL` | where **Mollie's servers** deliver payment webhooks | payments never confirm, silently — see T5 |
| `VITE_API_URL` | **baked into the web build** | survives every `docker compose restart` and every `.env` edit; only a rebuild fixes it |

**`VITE_API_URL` is the one that bites**, because it is a build argument rather than runtime
configuration. Its default is `/api`, which keeps the API on the same origin as the UI and is
correct under any arrangement where both are reachable through one hostname. **Leaving it alone
is the easiest way not to get it wrong**; changing it is the easiest way to spend an afternoon
on a UI that loads and then fails every request.

The env example already carries a warning against a `localhost` `API_URL` for the Mollie reason.
That warning should say *"or any address only reachable from your own network"*, since a
hostname on a private mesh is the same problem wearing better clothes.

## T2 — `www`, the smallest real site

**There is nothing built for the marketing site**: it is workplan 0086 T1. Waiting for it would
block the thing that *is* ready and *is* on the critical path.

Google's OAuth verification requires a privacy policy and terms **reachable on the verified
domain**, plus an app logo. All three exist as of today:

- `site/legal/privacy.md`
- `site/legal/terms.md`
- `site/brand/logo-120.png`

So `www` starts as a static file server over `site/`, rendering the two documents and serving
the logo. No framework, no meaningful build step, no coupling to `apps/web` — which is also what
keeps workplan 0086's T1/T7 seam honest, since a placeholder that imports nothing is a
placeholder that can be replaced without a migration. When 0086 T1 lands it takes over the same
URLs.

⚠️ **The documents are drafts and carry twelve `«PLACEHOLDER»` tokens** — `site/legal/README.md`
lists every one, and `scripts/legal-docs.unit.test.ts` fails on an unlisted one. Serving them
publicly as they stand puts `«LEGAL_ENTITY»` on the internet. **Fill them before `www` is
public**, and note that "serve it on the mesh only until then" stops being an option the moment
Google needs to fetch the privacy policy.

## T3 — `ota`, the stack that already exists

Nothing to build. `ownpace-web` and `ownpace-api` run today; what changes is T1's four
variables, and that they are now reached by a name rather than a port on an address.

Worth a line in the runbook rather than left implicit: **`ota` is a complete environment**, not a
subset. It has its own database and its own Trigger.dev stack, so anything proved there is proved
against the real machinery — which is what makes T4's recommendation cheap to accept.

## T4 — `app` stays dark until it means production

`*.ownpace.eu` resolves **every** name to the spark, `app.` included. So
`https://app.ownpace.eu/oauth/google/callback` — registered with Google as *production* — points
at the development box today. Nothing is live, so nothing is harmed; the moment something is, an
authorization code for a real customer lands on a test machine.

**Recommendation: do not serve `app.` yet.** A name that does not answer cannot be relied on by
accident, and `ota.` is a complete environment, so nothing is lost by testing there.

Serving it anyway is **cheaper than an earlier draft of this plan claimed**, and the correction
matters because it removes the lazy argument and leaves only the real one.

**Trigger.dev does not have to be duplicated.** A Trigger project has environments natively —
the repository already uses one (`TRIGGER_SECRET_KEY=tr_prod_…`, "the PROD environment's secret
key"), and the owner has seen `staging` and `production` in their own project. One instance can
serve both: separate secret keys, separate deployed task versions, separate runs, separate task
env vars. So the heavy half — ClickHouse, Redis, MinIO, the registry, the supervisor — is shared,
and only the light half is duplicated: `api`, `web`, and the app's own Postgres.

**And the mechanism is already there.** `set-task-env.sh:80` reads
`ENV_FILE="${SET_TASK_ENV_FILE:-${SCRIPT_DIR}/.env}"`, so a second environment's task variables
upload today by pointing that variable at a second env file. The secret key in that file *is*
the environment selector.

So the argument for keeping `app.` dark is **not** cost. It is the one in the paragraph above:
the name currently resolves to the development box, so a URI registered as production points at
development. That is the whole reason, and it is sufficient.

**Three things do stay shared, and each is a real consequence rather than a caveat:**

1. **The task `DATABASE_URL` is the actual isolation boundary, not Trigger.** Trigger's
   environments separate *runs*; they do not separate *your data*. Two environments whose
   uploaded `DATABASE_URL` is the same are one database behind two façades. Isolation lives in
   what `set-task-env.sh` uploads, which is why the second env file is the load-bearing part.
2. **Compute is shared.** One supervisor, one runner pool. A runaway test job competes with
   production for capacity; per-environment concurrency limits shape that but the machine
   underneath is one machine. Acceptable on the spark, not acceptable once `app.` is real.
3. **The version pin is instance-wide.** `TRIGGER_IMAGE_TAG=v4.5.9` carries a scar — 4.5.11
   broke the reference deployment within an hour, against ~27,500 successful runs on 4.5.9 — so
   the pin is deliberate. One instance means **you cannot canary a Trigger upgrade in staging
   while production stays put**: both move together, or neither does. That is the sharpest
   argument for separate instances *later*, and it costs nothing now.

The trigger for changing this is written down rather than left to judgement: **`app.` gets
served when `app.` stops meaning spark** — pointed explicitly at production hosting ahead of the
wildcard, and, per [ADR-0041](../adr/0041-who-owns-the-oauth-client.md), on a **different OAuth
client** from the one `ota.` uses, so that a leaked development secret is not a production
incident.

## T5 — what cannot work here, stated rather than discovered

- **Mollie webhooks.** `API_URL` is the address *Mollie's servers* call. A mesh-reachable host is
  not reachable by them, so payment confirmations cannot arrive. Billing end-to-end needs a
  publicly reachable host, and workplan 0086 T6 already names that journey as never having been
  walked.
- **Google's verification fetch.** The review reads the privacy policy and home page from the
  public internet, so a mesh-only `www` is invisible to it. **The redirect URI is the exception
  and only the exception**: Google 302s the browser and never resolves that host itself. That
  exception does not extend to anything else on the domain.
- **Anything else that expects an inbound connection from a third party.** The rule is the same
  each time: if it is our browser, the mesh is fine; if it is somebody else's server, it is not.

## Not in this plan

- **Routing, TLS and certificates.** Netbird's, and the owner's.
- The marketing site's content and layout (0086 T1).
- Filling the legal documents' placeholders — an owner task, listed in `site/legal/README.md`.
- Moving anything off the spark. This plan is explicitly *for now, on the spark*; T4 exists so
  that "for now" does not quietly become permanent for the one name where it must not.
