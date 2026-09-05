# 0094 — A page that says what is wrong

## Status — 2026-09-05 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Build or reuse (owner) | ✅ **Decided 2026-08-22: reuse — [Gatus](https://github.com/TwiN/gatus), Apache-2.0** | Its configuration is a YAML file in git, reviewed like everything else — the same reason `setup-zitadel.sh` exists rather than a page of console clicks. Uptime Kuma is the popular choice and keeps its monitors in a SQLite blob edited through a web UI: not diffable, not reviewable, not reproducible on a fresh machine. Cachet does not probe at all; you feed it. |
| T0b Where it runs (owner) | ✅ **Decided 2026-08-22: inside the stack, and the page says so** | The honest alternative — a separate EU host — is right eventually and is a real cost now. Before there are customers, a page that is open about its own blind spot beats a second machine to patch. The condition attached to that decision was that visitors are told, which is `ui.buttons` → `docs/status-page.md`, guarded by a test. |
| T1 A health answer that can be NO | ✅ **Done 2026-08-22** | `/ready` and `/api/ready` (`apps/api/src/routes/ready.ts`). Checks the database through the request path's own pool and the issuer's discovery document. 6 unit + 5 integration cases. |
| T2 The page itself | ✅ **Done 2026-08-22** | `deploy/compose/gatus.yaml` — three groups, ten endpoints — and the `gatus` service in `managed.yml`. 9 guard cases in `scripts/status-page.unit.test.ts`. |
| T3 Say what it cannot do | ✅ **Done 2026-08-22** | `docs/status-page.md`, linked from a button beside the page's heading. The guard asserts the button exists, that it points at that file, and that the file leads with the limitation rather than burying it. |
| T4 Move it to its own host | 📋 Planned — when there are customers | A deploy change, not a rewrite: `gatus.yaml` and every endpoint in it stay as they are, pointed at the same public URLs from a machine that is not this one. Keep it in the EU — see below. |
| T5 Per-tenant connection health | ✅ **Done 2026-09-05, in two slices** — the connection card says what is standing against it, and on which side | Different page, different audience: "*your* Gmail credential is failing" is dashboard work and must not be public. `GET /api/connections` now carries `standingFailures` per connection, folded from `migration_status.last_error_category` of every migration that signs in with it; the card renders one line per migration and category, with the category's remedy sentence and the Replace-credentials button beside it. Guarded against a real database (`connections-standing-failures.unit.test.ts`) and on the page (`Connections.unit.test.tsx`). **Second slice, same day:** the pass tags a failure at the closure that threw (`withSides` over the shared domain pass, mail included), `markFailed` writes it to `migration_status.failed_side` (migration 0040, both editions' catch sites pinned), and the fold puts a sided entry on one card, the tail saying so; an unsided one still lands on both. Guards: `failure-side.unit.test.ts` (the tag, the cause chain, the seam), the ledger's stored-category test extended, `failure-side-recorded.unit.test.ts`, and the API and page guards extended. |

## T5 — the connection card says what is standing against it

The public page above answers "is Ownpace up". T5 is the other question, the
one a customer actually has: "is *my* credential still good", and it is the
tenant's own dashboard, behind sign-in, never the public page — a status page
that named a customer's Gmail account would be an incident of its own.

### What already existed, and why the card still said nothing

A sync pass that fails writes `migration_status.last_error` and, since 0110
T3, its category — six values with a remedy sentence each, cleared by the
next clean pass. The migration's own page shows both. The Connections page
showed the connection's `status` and its qualification badges, both of which
describe the **last Test**: a credential that expired after that Test stayed
"connected" on the card while every pass against it failed, and the person
who owns the credential had to open each migration to learn that the thing to
fix was on the page they had just left.

`connection.status` is only ever written by the connections route (add, test,
rotate). A failing pass does not touch it, and must not: a Test is a fact
about the credential, a failed pass is a fact about a pass, and one column
carrying both would say "connected" and "failing" at the same time with no
way to tell which was newer. So the card shows both, side by side, and a
green badge beside a red line is a true sentence: the last Test passed, the
pass since did not — press Test.

### The first slice

`GET /api/connections` folds, per connection, the standing failures of every
migration that signs in with it: `mailbox_mapping` → `mailbox` → `connection`,
both sides. One entry per migration and category, carrying the domains it
stands on and the row's `updated_at` as the as-of; latest first. Read-only —
no column, no migration. Migrations in `done` are left out (the migration is
over and a rotation would fix nothing); paused ones stay, because pausing is
what a person does when a pass keeps failing.

The category travels; the prose does not. `last_error` routinely carries a
mailbox address and a folder name, and it already has a home on the
migration's page where the prose boundary applies. The list is asserted never
to contain it.

The card renders the category's own remedy sentence — the same `FAILURE_KEY`
map the migration page and the operator's support screen read, so all three
say the same words — and the Replace-credentials button is the remedy,
already beside it.

### Which side failed: recorded where it happens, and the card says which case it shows

A migration signs in with two connections and the category does not say which
one failed. `target_refused` is not the exception it looks like: the
classifier files any 403 there, and a source that refuses a read (Graph's
`Authorization_RequestDenied` for a face nobody granted) classifies exactly
like a target that refuses a write. Parsing `last_error` for the side would be
the text-matching 0110 T3 drew the line at, on prose that carries addresses.

The first slice therefore put the line on **both** cards and, for the three
categories where the connection is the thing to act on (`auth_expired`,
`target_refused`, `unknown`), said that Test tells which of the two it was.
For the three that resolve on their own (`rate_limited`, `quota_exceeded`,
`network`) the sentence already says "no action needed", and a tail inviting
a Test would contradict it — pinned.

**The second slice records the side at the one seam that knows it.** Every
closure the shared domain pass calls is one side or the other — listing,
reading and fetching are the source; ensuring a collection and writing an item
are the target — so `runDomainSync` wraps them once (`withSides`) and an error
coming out of a closure carries its side as a non-enumerable property under a
well-known symbol: the error keeps its class, message and stack, logs and JSON
never see the tag, and a `PassAbortError` carries it through its `cause`. No
connector knows this exists, and mail is covered because the mail pass runs
through the same function. The pure closures (keys, hashes, versions) stay
untagged: a bad natural key is nobody's credential.

Both editions' catch sites hand `failureSideOf(err)` to `markFailed`, which
writes `migration_status.failed_side` (migration 0040: two values and a CHECK,
unlike the category's revisable six; NULL when the pass could not tell) and
clears it with the category on the next clean pass. The fold then puts a sided
entry on that connection only, with `side` set, and the card's tail says *"It
failed on this connection."* instead of inviting a Test. An unsided row — an
older build's, or a failure on neither side — still lands on both cards with
the first slice's tail, so a screen never guesses.

Not done, and named: the migration's own page and the operator's support view
still show the category without the side. Both are one field away.

## Why this exists

Somebody asked for a status page like `status.claude.com`: services and providers
in groups, green/orange/red, with history.

The request is right and the obvious implementation is wrong, for one reason.

## A status page must not share fate with what it reports on

`status.claude.com` runs on Atlassian Statuspage — entirely outside Anthropic's
infrastructure. That is the whole design. A status page inside the stack it
watches is off when the stack is off, which is the only moment anybody looks at
it, and an unreachable status page is indistinguishable from one nobody visited.

So "add a monitoring page to `apps/web`" could not be the answer, and the real
question was never which library but **where it runs**. The owner chose inside
the stack for now, on the condition that the page says so — which is a good
trade before there are customers and a bad one after, so T4 exists.

## The thing that had to be built first: `/health` was a literal

```ts
const health = (req, res) => res.json({ status: 'ok', timestamp: ... });
```

It never touched the database, the identity provider, or anything else. As a
LIVENESS probe that is correct and it stays — compose healthchecks and the
smoke script want exactly that answer, and `ready.integration.test.ts` asserts
the difference so nobody merges the two.

As something to point a status page at, it is a green light somebody trusts
while every request is failing. There was no readiness endpoint anywhere in
`apps/api`.

`/ready` checks the two things whose failure means customers cannot be served:

- **the database**, through the request path's own pool — including PgBouncer
  where one is in front, so it proves the route customers take rather than a
  different one that happens to work;
- **sign-in**, the issuer's discovery document, the same one `auth.ts` reads
  `jwks_uri` from.

Not the worker, not Trigger.dev, not the demo backends. A sync that is behind is
a real thing to know and **not** a reason to tell the world the service is down.

### Degraded is not down, and that is the orange light

The database failing means nothing can be served. Sign-in failing means new
sign-ins fail while everybody already inside carries on. Collapsing those into
one word either cries wolf or hides an outage, depending which way you collapse
it — so the roll-up has three values and the page reads the components, not the
verdict.

Readiness answers **200 while degraded, on purpose**: a load balancer that pulled
the API out of rotation over a sign-in outage would turn a partial problem into
a total one. Which is why the page's `Database` and `Sign-in` rows assert on
`[BODY].database == up` rather than on the status code, and why a test says so.

### It publishes states and never reasons

`/api/ready` is reachable without a credential — a status page has to be able to
read it. So a check reports `up`, `down` or `off`, and the reason goes to the
log. A readiness endpoint that echoes `getaddrinfo ENOTFOUND db.internal` has
published an internal hostname to everybody who asks. Asserted twice: once
against the source, once against a live response with the database gone.

## What the groups mean

| Group | A red light means |
|---|---|
| **Ownpace** | Ours. Two liveness rows and two that read the fields of `/api/ready` that can genuinely fail. |
| **Sources** | Somebody else's service that migrations read FROM. Nothing is wrong with Ownpace, and this is the single most common thing a support message is actually about. |
| **Targets** | A destination we RECOMMEND (ADR-0011). Self-hosted targets are absent on purpose: ADR-0011 is explicit that those are the customer's to operate, and reporting on infrastructure we do not run would claim a responsibility we decline in writing. |

Provider checks use unauthenticated discovery documents — stable, public, no
rate limits, no credential. A status check holding a customer's token goes red
for the wrong reasons and quietly depends on somebody's OAuth grant still being
valid.

## Two smaller decisions worth recording

**History lives in SQLite on its own volume, not in the Postgres it watches.**
Otherwise the record disappears at exactly the moment somebody wants to read it,
which is the failure the page exists to record. That is the shared-fate problem
again, one level down.

**The page probes `WEB_URL`, not `http://api:3001`.** The internal name would
prove the container can talk to itself. The browser address exercises the path a
customer takes: reverse proxy, certificate, same-origin `/api` proxy. Guarded.

## Keep it in the EU when it moves

Atlassian Statuspage, Better Stack and Instatus are US SaaS; Upptime runs on
GitHub Actions and GitHub Pages, also US. A US-hosted status page on the front
of a product that sells getting off US cloud is the kind of detail a prospect
checks — and unlike most such details, it is on a page we would be inviting them
to visit.

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` — green (2026-08-22).

`pnpm test:integration` covers `/ready` against a live Postgres, in both
directions. The sandbox has no Docker, so CI is the only place those five cases
run.

**2026-09-05 (T5, second slice):** `pnpm lint` on the touched files · `pnpm typecheck` ·
the core, ledger, orchestration, api and web unit chunks — green; guards proved by
breaking as the PR records.

**2026-09-05 (T5, first slice):** `pnpm lint` on the touched files · `pnpm typecheck` ·
`npx vitest run --project unit apps/api` (60 files) and `--project unit-browser
apps/web` (59 files) — green. Both new guards proved by breaking: the fold made
to take one side only, and its `done` filter removed; the page made to invite a
Test for `rate_limited`, and its foreign-category guard removed — each failed
exactly its own case and nothing else.
