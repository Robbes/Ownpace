# Workplan 0091 — the names on one box

## Status — 2026-08-20 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The four variables that carry the browser-visible address | 📋 Planned | `WEB_URL`, `CORS_ORIGIN`, `API_URL`, `VITE_API_URL` — and **one of them is baked into the build**, so a wrong value survives every restart. |
| T2 `www` — the smallest real site, which is the one Google needs | 📋 Planned | `site/legal/` and `site/brand/` exist and are exactly what OAuth verification requires to be reachable. The marketing pages are workplan 0086 T1 and are not this. |
| T3 `ota` — the stack that already exists, under its own name | 📋 Planned (needs T1) | Nothing to build; the stack runs. What changes is the address it believes it has. |
| T4 `app` stays dark until it means production | 📋 Planned (owner decision) | The wildcard already resolves it *to the test box*, so the URI registered as production points at development. |
| T5 What cannot work on the spark, said rather than discovered | 📋 Planned | Mollie's webhooks and Google's verification fetch both need public reachability; a mesh-only host has none. |

## Why this exists

The owner is standing up the managed service's public names, with the environment as a **domain
level** rather than a prefix (owner decision, 2026-08-20):

| | production | test / dev |
|---|---|---|
| site | `www.ownpace.eu` | `www.ota.ownpace.eu` |
| app | `app.ownpace.eu` | `app.ota.ownpace.eu` |

This is a better scheme than the flat one it replaces. The environment is visible in every name,
it extends without further decisions (`api.ota.…` if that is ever wanted), and — see T4 — it is
what makes the production/test boundary *real* rather than merely conventional.

**Three consequences follow, and one of them invalidates something already registered.**

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

### 1. A registered redirect URI is now wrong

`https://ota.ownpace.eu/oauth/google/callback` was registered with Google when the test app
lived at `ota.ownpace.eu`. Under the new scheme the test app is at `app.ota.ownpace.eu`, so the
URI must become:

```
https://app.ownpace.eu/oauth/google/callback          production   (unchanged)
https://app.ota.ownpace.eu/oauth/google/callback      test / dev   (replaces ota.ownpace.eu)
```

Google matches byte-for-byte, so the old entry does not "also work" — it simply never matches.
Change it in the console before the consent flow is first exercised.

### 2. A wildcard matches exactly ONE label

`*.ownpace.eu` covers `www.ownpace.eu` and `app.ownpace.eu`. It does **not** cover
`app.ota.ownpace.eu` — that needs `*.ota.ownpace.eu`. This is true for **DNS and for TLS
certificates alike**, and it is worth knowing in advance because neither failure names itself:
the DNS one looks like a propagation problem, and the TLS one is a handshake that dies before
any HTTP error can be seen — the same silent death `trigger-tls.Caddyfile` already warns about
for a different cause.

So: two wildcards (`*.ownpace.eu` and `*.ota.ownpace.eu`), or a certificate whose SAN list names
both.

### 3. No cookies, so no cross-environment bleed

Worth stating because the nesting *looks* like it should be a problem: `app.ota.ownpace.eu` and
`app.ownpace.eu` share the registrable domain `ownpace.eu`, so a cookie set with
`Domain=.ownpace.eu` from either would be sent to the other — a test session reaching production.

**It is not a problem here, because the application uses no cookies.** Authentication is a
bearer token in `localStorage` (`apps/web/src/services/api.ts:31`,
`operating-service.ts:46`), and `localStorage` is scoped **per origin** — two different hosts are
two different stores, with no attribute that can bridge them.

That is a property to keep rather than a fact to note. **If a session cookie is ever
introduced, it must stay host-only** — no `Domain=` attribute, and ideally a `__Host-` prefix,
which makes host-only enforceable by the browser rather than by remembering. The Trigger
dashboard *does* use cookies (which is why `trigger-tls` exists at all), but it is a separate
operator-only host and not part of this scheme.

---

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

**The nesting largely solves this, and that is the strongest argument for it.** Under the flat
scheme `*.ownpace.eu` resolved **every** name to the spark, `app.` included — so the URI
registered as production pointed at the development box. With the environment as a domain level,
the test names live under `ota.` and production names do not.

**But only if the wildcard is scoped down with them.** A `*.ownpace.eu` record still pointing at
the spark keeps `app.ownpace.eu` resolving there, and the hazard survives the rename untouched.
The recommendation is therefore concrete:

- **`*.ota.ownpace.eu` → the spark.** One wildcard, the whole test environment, and it cannot
  accidentally answer for a production name.
- **`www.ownpace.eu` and `app.ownpace.eu` get explicit records**, pointed at production hosting
  when it exists — and until then, pointed at nothing.

A name that does not resolve cannot be relied on by accident, and `app.ota.ownpace.eu` is a
complete environment, so nothing is lost by testing there.

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
