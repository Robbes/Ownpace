# 0099 — An invitation you can answer

## Status — 2026-08-23 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Stop claiming invitations silently | ✅ **Done 2026-08-23** | `claimInvitations` is gone. `pendingInvitations` READS; `acceptInvitation` and `declineInvitation` each act on ONE named organisation. `/api/me` reports rather than binds, and `authenticate` no longer joins anybody on the way past — its 403 now names the unanswered invitation instead of saying "no membership". |
| T2 Somewhere to record a refusal | ✅ **Done 2026-08-23** | Managed migration 0008: `'declined'` joins the status check, `decline_own_invitation` is bounded from both sides, and `see_own_answered_invitation` makes the produced row visible — see below, that last one is the whole difficulty. |
| T3 Reading the organisation that invited you | ✅ **Done 2026-08-23** | `see_tenant_you_were_invited_to` (managed 0008) plus ledger 0028, which stops the four `tenant` policies RAISING on the empty string. Either one missing gives the same broken screen. |
| T4 The three answers, on screen | ✅ **Done 2026-08-23** | `apps/web/src/pages/Invitations.tsx` — Join / Decline / **Not now**. `AuthCallback` routes there ahead of both existing cases, including for somebody who already belongs somewhere. EN + NL. |
| T5 Zitadel in the managed gate | ✅ **Done 2026-08-23** | Added to `bootstrap-managed.sh`'s explicit service list, and `setup-zitadel.sh` is now INVOKED — nothing had ever invoked it. `scripts/identity-in-the-gate.unit.test.ts` pins both. |
| T6 The smoke answers an invitation three ways | ✅ **Done 2026-08-23** | Accept, decline and skip over real HTTP against the running API, plus issuer discovery and JWKS. Skip is asserted as an ABSENCE — no request is made, and the guard fails if `T3` ever appears in a URL. |
| T7 A real browser sign-in in the smoke | ✅ **Done — and this row said otherwise until 2026-08-24** | `sign_in_as` in `smoke-managed.sh` runs the whole authorization-code flow against the live provider: `/oauth/v2/authorize` with an S256 challenge, a session proved with a password at `/v2/sessions`, the auth request finalised against that session, and the code exchanged at `/oauth/v2/token` with the verifier. `scripts/identity-in-the-gate.unit.test.ts` pins every step and **runs** the challenge derivation. |

## What changed, and why it had to

An invitation used to accept ITSELF. `claimInvitations` bound every open
invitation addressed to your verified email the first time you signed in —
silently, as a side effect of reading your own account.

That was defensible while the only invitations were ones an operator had just
granted and emailed you about. It stopped being defensible the moment anybody
could be invited to a second organisation: **reading `/api/me` joined you to
things**, and there was no moment at which anyone could say no.

Adding "decline" is therefore not a feature bolted onto the side. It requires
the silent accept to go, because a choice you are never offered is not a choice.

## Three answers, and only two of them are writes

| | What happens |
|---|---|
| **Join** | `status` → `active`, and the row binds to this subject. Migration 0006's policy, unchanged. |
| **Decline** | `status` → `declined`, and the row binds to **nobody**. |
| **Not now** | Nothing at all. No request, no state. It is offered again next time. |

Skip having no endpoint is the design. "I have not decided" is the absence of a
decision; writing it down would turn a deferral into a record somebody has to
reason about later, and would need its own answer to "when does this expire".

## The hard part was not the refusal. It was seeing it.

The decline was refused by RLS with `new row violates row-level security policy`
from `ExecWithCheckOptions`, against a `WITH CHECK` whose every conjunct
evaluated **true** when queried in the same transaction. It was still refused
with the check reduced to a literal `true`.

Migration 0006 already records that an UPDATE whose WHERE clause reads the row
has SELECT policies applied to it as well. This is that lesson one step further:
**the SELECT policies must also admit the row the update PRODUCES.**

Accepting never noticed, and that is why nobody had hit this. Its new row
carries `user_id = <this subject>`, which `own_membership_select` matches — so
the destination was visible by accident of what accepting happens to write.

A declined row carries `status = 'declined'` with the `pending:` id still on it,
and matches nothing: not `see_own_invitation` (no longer `invited`), not
`own_membership_select` (the id is not this subject), not
`tenant_isolation_select` (no tenant scope). Invisible — so the write was
refused.

`see_own_answered_invitation` fixes it, and is right on its own terms: **you may
see the answer you gave.** Without it, declining is an act whose result you are
not allowed to look at.

## Declining names nobody, and that is enforced

The obvious implementation sets `user_id` the way accepting does. It must not:
that writes a permanent link between a person and an organisation they refused,
into a table that organisation's operator can read.

The `WITH CHECK` pins `user_id LIKE 'pending:%'`, and that half is load-bearing
for a second reason. Membership is unique per (organisation, subject), so

```sql
SET status = 'declined', user_id = '<victim>'
```

— the same statement with one field changed — would permanently block a chosen
person from ever joining a chosen organisation. A denial of service written as a
refusal. No application code distinguishes the two, which is why the bound is a
policy and not a code review.

## The identity provider was never in the gate

`zitadel` went into `managed.yml` in #496 and into **neither** of the two
hand-maintained lists that would have started it: `bootstrap-managed.sh`'s
explicit service list, and — it turns out — nothing at all invoked
`setup-zitadel.sh`, which is documented as a step a person runs by hand.

So for three weeks the identity provider was defined, its secrets were required
by every compose command (which is how E2E (managed) #34–#36 died, workplan
0098), and it was **never started and never configured**. The nightly was green
throughout and said nothing about whether anybody could sign in.

That is the fourth hand-maintained list to drift in four days — `MOUNTS` (0096),
the `pull_request` trigger filters (0097), the pre-flight env list (0098), and
these two. Same treatment: pinned by a test that reads the scripts.

**One wrinkle, stated rather than hidden.** `web` is BUILT before
`setup-zitadel.sh` runs, and `VITE_` values are baked in at build time. On a box
where this is the first ever run, the web bundle carries no OIDC client id until
the next bring-up rebuilds it. The API half reads `JWT_ISSUER` at run time and is
unaffected, so the smoke's checks are honest either way — but a first-run demo
box needs a second bring-up before its login page works.

## One thing only the operator can decide: where the issuer lives

`ZITADEL_EXTERNALDOMAIN` defaults to `localhost`, so `setup-zitadel.sh` writes
`JWT_ISSUER=http://localhost:3126`. That address is baked into every token's
`iss`, and it has to be resolvable by **two different things**:

| Who | Needs to reach the issuer for |
|---|---|
| A browser | the sign-in redirect, and the token exchange |
| The `ownpace-api` container | `/.well-known/openid-configuration` and `jwks_uri`, on every token it verifies |

`localhost` satisfies the first and breaks the second: inside `ownpace-api`,
`localhost` is the API. So a stack left on the default starts, provisions, and
verifies no token at all.

**That is a deployment decision, not a code one** — it wants an address the box
actually answers on (its DNS name, or the Tailscale address the Trigger URLs
already use), set as `ZITADEL_EXTERNALDOMAIN` before the first bring-up. Changing
it later invalidates every token already issued, because `iss` moves.

The smoke asks the discovery and JWKS questions **from inside the API
container** for exactly this reason. Asked from the host they would pass against
the broken default — the port is published, so `localhost:3126` answers there —
which is the kind of green this repository keeps having to un-learn.

## What was still owed — and was quietly paid

**This section described T7 as undone from 2026-08-23 until 2026-08-24, and it
had been done in between.** What it said:

> What it does not do is obtain a token FROM Zitadel through the authorization
> code flow. That needs its session API and a PKCE exchange…
>
> It is worth doing properly, against the live gate, where each step can be seen
> to work.

That is exactly what happened, and nothing came back to say so. `sign_in_as`
creates a human at the provider, starts an authorization request with an S256
challenge, proves a session with the password, finalises the auth request
against that session, and exchanges the code with the verifier — taking the **ID
token**, because Zitadel puts user info claims there only and ADR-0042 requires
`email`. Its own header records the reason to trust it: *"every call below was
driven against the live provider before it was written here (probes,
2026-08-23)."*

**A status that understates what shipped is the same defect as one that
overstates it.** A reader deciding what to work on next would have rebuilt a
thing that exists. The rule was written here for green checks — *a status must
belong to the thing that happened* — and it cuts both ways.

### And nothing pinned it

Worse than the stale row: no test asserted that the smoke gets its token from
the provider at all. `selectAuthMode` falls back to the symmetric `JWT_SECRET`
when `JWT_ISSUER` is unset, so a smoke that quietly went back to minting its own
tokens would have stayed green while asserting nothing about whether anybody can
sign in — the precise blindness T5 and T6 were written to end.

`scripts/identity-in-the-gate.unit.test.ts` now pins all six steps, and **runs**
the one piece of arithmetic in the flow: the whole `challenge=` line is lifted
out of the script, executed, and compared against `base64url(sha256(verifier))`
computed independently. A scan can only see that some pipeline exists; it cannot
see that the pipeline is right.

The first version of that check extracted the challenge with `/challenge="([^"]+)"/`
— which stops at the first quote *inside* the command substitution and hands
back a fragment evaluating to the empty string. It failed loudly rather than
passing vacuously, which is the only reason it was noticed. **Fourth time in a
day** that a check needed checking.

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` — green (2026-08-23).

**The bring-up and smoke changes are not proved by running them**, for the same
reason as 0098: they need the Spark. The scripts are pinned by tests that read
them; whether the gate goes green is the next dispatch's answer.

## What the next dispatch answered: run #38

It got one step further than the last three and stopped, 29 seconds in:

```
Container ownpace-idp Created
Container ownpace-db Healthy
Container ownpace-idp Starting
Error response from daemon: failed to set up container networking: driver failed
programming external connectivity on endpoint ownpace-idp: Bind for
0.0.0.0:8080 failed: port is already allocated
```

Nothing in this stack held 8080 — the teardown's `docker compose ps` lists every
service and none of them publishes it. 8080 is simply the port that everything
else on a machine wants, and picking it was the whole mistake. This repository
already knew better in two places: `setup-stalwart.sh` publishes JMAP on `18080`,
and the E2E (selfhost) gate binds port 0 to get genuinely free ports at run time
rather than assuming fixed ones are available.

The provider is the one service that cannot use that trick, because its port
goes into every token's `iss` and has to still be there tomorrow. So it gets a
fixed number that is free by convention instead: **3126**, continuing the block
this stack already owns — web 3123, status 3124, www 3125.

### The pair that must not drift

`ZITADEL_PORT` is where the stack publishes. `ZITADEL_EXTERNALPORT` is what goes
into `iss`. On a plain bring-up they are one address seen from two sides; they
separate only when something fronts the provider (netbird terminating TLS on
443). Two hand-copied numbers is how a stack ends up serving one port and
stamping the other, which surfaces as every sign-in failing with a message about
signatures.

So the second is derived from the first, in both places that compute it:

```yaml
ZITADEL_EXTERNALPORT: ${ZITADEL_EXTERNALPORT:-${ZITADEL_PORT:-3126}}
```

```bash
IDP_PORT="$(read_env ZITADEL_EXTERNALPORT "$(read_env ZITADEL_PORT 3126)")"
```

Verified against `docker compose config`: with neither set both resolve to 3126;
with `ZITADEL_PORT=9999` alone, the publish and the issuer both move to 9999.
`identity-in-the-gate.unit.test.ts` pins the derivation, the agreement between
the three fallbacks and `managed.env.example`, that the provider does not sit on
a contended port, and that no two services on this host default to the same one
— each case proved by breaking it.

### What run #39 will find next

The identity section, and it will be right to. `ZITADEL_EXTERNALDOMAIN` is still
`localhost` on the runner, so the API container cannot reach the issuer and the
smoke says so in as many words. That is the deployment decision above, not a
code change: the box needs an address that answers for **both** a browser and
`ownpace-api` — its netbird name, or `id.ota.ownpace.eu` under workplan 0091's
scheme — set in the runner's persisted `.env` before the next dispatch.

## And run #39, which got further and said less

The port fix landed and the provider bound its port: `ownpace-idp` existed for
the first time. Then it exited 1, restarted, exited 1 again — and the run
reported this and nothing else:

```
ownpace-idp   ghcr.io/zitadel/zitadel:v4.6.2   3 seconds ago   Restarting (1) Less than a second ago
```

Not one word about why. A whole dispatch spent to learn that something went
wrong, on a failure whose explanation was sitting in `docker logs` the entire
time.

**And the tool for that already existed.** `bootstrap-managed.sh` has had
`up_wait` since the PgBouncer hunt of 2026-08-18, written for exactly this: on a
failed `up --wait` it prints the failing container's log, both ends, because
`container X is unhealthy` names the service and never the cause. Every bring-up
in the file goes through it — postgres, pgbouncer, nextcloud, the whole Trigger
stack, the supervisor.

Except two. The zitadel bring-up added by this workplan called compose directly:

```bash
"${COMPOSE[@]}" up -d --wait zitadel     # no diagnosis
```

and the app services could not use the wrapper at all, because they need
`--build` and a `GIT_SHA` in the environment — so a web or api image that
started and died was equally silent.

The diagnosis is now split out as `explain_failure`, `up_wait` calls it, and so
do both direct callers. `bootstrap-managed.unit.test.ts` refuses any line that
runs `up -d … --wait` without reaching it, and refuses a diagnosis reduced to a
tail-only window or to a warning — each proved by breaking it.

**This does not say why Zitadel exited.** It makes the next run say it. The
answer is available now, on the box, in one command:

```
docker compose -f deploy/compose/managed.yml logs zitadel | head -40
```

## Run #40: the diagnosis worked, and named a password

The bring-up printed the container's own log for the first time, and the answer
had been sitting there since #39:

```
level=info  msg="starting migration"  name=03_default_instance
level=error msg="migration failed"    name=03_default_instance
  error="ID=COMMA-VoaRj Message=Errors.User.PasswordComplexityPolicy.HasUpper"
level=fatal msg="setup failed, skipping cleanup"
```

**`ZITADEL_ADMIN_PASSWORD` was generated as `openssl rand -hex 16`** — 32
lowercase hex characters. Zitadel's default password complexity policy demands a
lowercase letter, an **uppercase** letter, a number and a symbol; hex supplies
the first and the third and nothing else. So the first human could never be
created, `03_default_instance` failed, and the container exited 1 and restarted
forever — which reads like a crash and was a rejected password.

Fixing only the uppercase would have failed again on the symbol, so all four
classes are satisfied at once. The entropy stays where it was — 128 bits of hex
— and the four fixed characters that follow it add none and are not pretended to.

**And a value already written is repaired**, which `ensure` would not do: it
fills a MISSING key and never touches a present one, which is right for a secret
and wrong for one that provably cannot work. The repair is keyed on the old
generator's exact fingerprint (32 lowercase hex characters), and such a value
is safe to replace *because* it is non-compliant: the policy rejected it, so no
account was ever created with it, so there is nothing on the other side to
strand. A password an operator chose is left alone.

That is what heals the runner without anybody editing `.env` by hand — the gate
runs `ensure-env-secrets.sh` and persists the result back.

Five cases, each proved by breaking it, and one of them nearly was not here:
reverting the generator to plain hex left every other case green, because the
repair saw its own bad output and healed it. Defence in depth is good; a test
that cannot see the regression is not. So a fresh `.env` now also asserts that
the repair does **not** fire — if it does, the generator is writing what the
policy rejects.

### The diagnosis did NOT print that itself — and that is a second bug

The error above was read off the box by hand. The run's own diagnosis stopped
one line short of it:

```
container ownpace-idp is unhealthy
!!! compose could not bring these up healthy: zitadel
!!! --- zitadel (restarting ) — FIRST 20 log lines (start-up):
    ownpace-idp | … "initialization started"
    …
    ownpace-idp | … "starting migration" name=01_tables
##[error]Process completed with exit code 255.
```

Twenty lines of initialisation, which say nothing, and then the run **died**.
The `last 20` window — where `PasswordComplexityPolicy.HasUpper` was sitting on
the fatal line — never printed. Neither did the pointer to the failure table.

`docker compose logs "$svc" | head -20` is why. `head` closes the pipe after
twenty lines; a container with a LONG log is still writing, takes SIGPIPE, and
under `set -euo pipefail` that failed pipeline aborts the function — after the
first window and before the second. Reproduced exactly:

```
$ set -euo pipefail; long() { seq 1 100000; }
$ long | head -3 | sed 's/^/    /'; echo "never reached"
    1
    2
    3
[exit 141]
```

It had never bitten before because every container this had run on had a log
SHORTER than twenty lines, so `head` read to EOF and nothing was signalled. The
first service with a long log was the first service it mattered for — and it was
the one the whole mechanism had just been built for.

The log is now read ONCE into a variable and both windows are sliced out of it,
each guarded so that printing cannot abort the thing it exists to print.

### Run #41, which is why this fix is not cosmetic

The password fix merged and the gate was dispatched again. Real progress:

```
Container ownpace-idp Recreate / Recreated          the new password reached it
0.0.0.0:3126->8080/tcp                              the port fix is live
… "verify migration" … name=03_default_instance     verified, not re-applied
```

Every migration in run #41 is a `verify`, where run #39's were `starting` — the
earlier attempt did record them. And the container still exits.

**Why, nobody can say from that run**, because `verify migration …
name=03_default_instance` is the TWENTIETH line, and the window closes there.
Whether that migration was retried and passed, retried and failed, or something
else entirely broke afterwards are three different problems with three different
fixes, and one of them means dropping the `zitadel` database.

A diagnosis that stops one line before the answer is not a smaller version of a
diagnosis. It is the same as not having one, twice over — and it has now cost
two dispatches.

### Runs #42 and #43 — the database was cleared, and nothing changed

The `zitadel` database was dropped by hand on the Spark, the container removed
and the machinekey volume with it. Run #42 shows that landing: `verify
database`, `verify grant`, then `starting migration name=14_events_push`,
`40_init_push_func_v4`, `01_tables` — **starting**, not verifying. A genuinely
empty database.

It failed anyway, and #42 could not say why: it was dispatched before the
window fix merged, so it printed twenty lines of initialisation and died at
exit 255 exactly as #40 had.

Run #43, on a main that carried the fix, printed both windows and this at the
tail:

```
level=error msg="migration failed" … Errors.Instance.Domain.AlreadyExists
  detail="Key (instance_id, unique_type, unique_field)=(, instance_domain, localhost) already exists."
level=fatal msg="setup failed, skipping cleanup"
```

The same error the cleanup was supposed to remove. Which looks like the cleanup
failing, and is not.

**Read the timestamps.** The head of #43's window is `12:59:57` — run #42's
container, still restarting twelve minutes later, still the same container, so
`docker compose logs` holds every attempt end to end. The tail is `13:12:08`.
Between them sit some dozens of restarts, and the first of them is the one that
matters: on a clean database Zitadel got through every migration, began
`03_default_instance`, wrote the instance domain, and then failed at something
after it. `setup failed, skipping cleanup` is not a warning — it is Zitadel
saying it will not undo what the failed migration already wrote. From that
moment the database is poisoned and every restart dies on the leftover.

So the cycle we had been in for four runs:

| | what the log said | what was true |
|---|---|---|
| first attempt | (past line 20 in one window, past line -20 in the other) | the cause |
| every attempt after | `Errors.Instance.Domain.AlreadyExists` | the leftover |
| the remedy that follows from it | drop the database | correct, and insufficient |

Dropping the database is the second half of the fix. Doing it without the first
half buys exactly one more run before the same first failure poisons the same
database again — which is precisely what #42 and #43 were.

### What the windows could not do, and now can

A head and a tail assume the log has two interesting ENDS. A container under
`restart: unless-stopped` has neither; it has one interesting line, somewhere in
the middle, and dozens of copies of its consequence on either side.

`explain_failure` gains a third window: **every line in the whole log that
reports a failure, oldest first**, capped at ten with the total stated. In a
crash loop the oldest is the cause and the rest are its echoes, and the output
says so rather than leaving the reader to notice.

Two smaller things came with it:

- The windows are sliced out of a bash array instead of piped. `|| true` had
  stopped SIGPIPE from killing the function, but the pipe still fired — run #43
  printed `bootstrap-managed.sh: line 203: printf: write error: Broken pipe`
  into the middle of its own diagnosis. A window that cannot break needs no
  forgiving, and the empty-log case now says so in words instead of printing a
  blank indent.
- `setup failed, skipping cleanup` is recognised by name. The bring-up prints
  the clear-down it needs and does **not** perform it: a bring-up that drops a
  database because a migration failed is one bad heuristic away from erasing the
  identity store of a stack with real users in it. A test refuses any
  `DROP DATABASE`, `docker volume rm` or `rm -sf` line in the file that is not
  inside an `echo`.

Proved against a stub of run #43's own log — 62 lines, the cause at line 21 and
its consequences at 40 through 62. The head window shows initialisation, the
tail window shows `AlreadyExists`, and the failure window's first line is the
cause neither of them could reach.

### Run #44 — the line nobody had read

The failure window worked on its first outing, and the answer was not the one
anybody had been chasing:

```
!!! --- zitadel — 215 line(s) reporting a failure. THE FIRST 10, OLDEST FIRST:
    12:59:58  migration failed  name=03_default_instance
                error="open /machinekey/pat.txt: permission denied"
    12:59:58  setup failed, skipping cleanup
    12:59:59  add unique constraint failed … unique_constraints_pkey
    12:59:59  Errors.Instance.Domain.AlreadyExists
    …
```

Three lines of cause and 212 lines of echo, the echo starting **one second
later** — the first restart. Six dispatches had been spent reading the echo.

**It was never the password.** `03_default_instance` creates the first HUMAN
before the machine account, so while the admin password was being rejected the
migration died earlier and never reached the token. #509 fixed a real bug; what
it actually did was let the next one become reachable. Two bugs in a queue, and
the second could not be seen until the first was gone.

Docker creates a new named volume's mount point owned by root. The Zitadel image
runs as a non-root user — which the error proves, since root could have written
anywhere. So `/machinekey` was never writable and the provisioning token could
never be written. **This had not regressed; it had never worked once.**

### Why the fix reads the uid instead of writing one down

`setup-zitadel.sh:136` reads exactly `/machinekey/pat.txt` to provision the
project and client without anybody clicking through a console, and the volume is
what keeps that token out of the working tree (hard rule 3). So the path stays
and the ownership changes.

The user is read off the image with `docker image inspect --format
'{{.Config.User}}'`. Zitadel's image is built `FROM scratch`, so there is no
shell in it to ask — but its config is the same one the daemon applies, so this
cannot disagree with reality the way a number in a comment can, and a version
bump that changes the user is handled rather than discovered in a nightly.
Nobody in this session could have verified a hardcoded `1000`: the environment
this was written in has a compose parser but no Docker daemon.

Two branches that are answers rather than fallbacks:

- **Empty** means the image declares no USER, so it runs as root, and root needs
  no help writing to a root-owned directory. Substituting a guessed uid there
  would be inventing a fact (hard rule 9).
- **A name** (`nonroot`, say) is REFUSED, because `chown` inside the busybox
  that prepares the volume resolves names against BUSYBOX's passwd, where a name
  from another image does not exist — the failure would land one layer further
  from the cause than the one being fixed. A scratch image cannot use a name
  today, having no passwd file to resolve one against, but that is a property of
  the current base image and not a promise. The refusal prints the one-line
  `docker run` that prepares the volume by hand.

One trap found while writing it. `docker compose config --images zitadel` looks
like the obvious way to name the image and is not: it prints the service's
DEPENDENCIES too — `postgres:18-alpine` came back on the second line — so taking
the first line is a coin flip on an ordering nothing documents, and losing it
means inspecting Postgres and chowning the token volume to whatever user THAT
runs as. It is asked for by key instead, `.services.zitadel.image`, with `jq`
that setup-zitadel.sh and smoke-managed.sh already require.

The preparation runs through `compose run --rm` from the bring-up rather than as
a compose dependency. `up -d --wait` and a container that exits 0 have a fraught
history across compose versions, and a new way for the identity provider's
bring-up to hang or misreport is the one thing this stack cannot afford right
now. `run` returns the one-shot's exit code and nothing else.

### What is still owed after this

The Spark's `zitadel` database still holds the instance-domain row the failed
attempts left behind, so it needs the clear-down the bring-up now prints —
**after** this fix is on main, not before. Clearing it first buys one run and
poisons the database again, which is exactly the loop #42 and #43 were.

### A hint nobody could paste, for the second time

The clear-down remedy shipped in #511 printed this:

```
docker exec -i ownpace-db psql -U "$POSTGRES_USER" -d postgres -c 'DROP DATABASE zitadel WITH (FORCE)'
```

An operator pasted it the same afternoon and got:

```
psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed:
FATAL:  role "root" does not exist
```

`POSTGRES_USER` is set inside `ownpace-db` and nowhere else. Pasted into a host
shell it expands to nothing, `psql` falls back to the host username, and `root`
is not a role. The container and the volume were removed; the drop — the one
step that actually mattered — silently did not happen.

**This exact bug, with this exact error message, was found and fixed in
`seed-demo-dav-content.sh` in #487.** The test written for it asserted the
`sh -c` wrapper — in that one file. So when a second script printed the same
shape it had nothing to say, and `smoke-managed.sh`'s `run_event` hint turned
out to be carrying the same bug at the same time, unnoticed and unreported by
anybody.

The fix is both instances plus the thing that let it recur:
`scripts/pasteable-hints.unit.test.ts` reads **every** script in
`deploy/compose` and refuses the shape wherever it appears. It also refuses
`sh -c` with the dollars in DOUBLE quotes, which looks correct and expands in
the pasting shell just the same, and requires `IF EXISTS` on the clear-down so
that pasting it twice does not add a failure to the pile somebody is already
reading.

It carries a vacuity case, proved by breaking the selector: without one, a
regex that stops matching turns the whole guard green while it checks nothing —
which is a fair description of what the per-file version had become.

> A guard scoped to the file where a bug was found does not stop the class. It
> stops the instance, and reports success for the class.

### Run #45 — the refusal was right, and it was only half an answer

The machinekey fix reached the Spark and the bring-up stopped on its own guard:

```
!!! ghcr.io/zitadel/zitadel:v4.6.2 runs as 'zitadel', which is not a numeric uid[:gid].
```

**`Config.User` is a NAME.** A hardcoded `1000` — which is what an afternoon of
"everyone uses 1000" would have produced — would have chowned a token directory
to whoever else holds that uid, and the run would have failed later and
differently. Reading the value rather than assuming it is what caught this, and
it caught it in one run rather than three.

But the refusal rested on a claim that #45 also disproved. #512's comment said
the image is `FROM scratch` and therefore has no passwd to resolve a name
against. It cannot be: **Docker resolves `USER zitadel` against the image's own
`/etc/passwd` when it starts the container**, so that file is in there. A
scratch image can carry one — COPYing a prepared passwd in is a common way to
get a non-root user without a distro.

So the name is now looked up rather than rejected:

```
docker create "$image"                 a container, NOT started
docker cp "$cid:/etc/passwd" - | tar -xO
awk -F: -v u="$name" '$1 == u { print $3; exit }'
docker rm -f "$cid"                    unconditionally, on any outcome
```

No shell, no entrypoint, no running process — which matters precisely because
what is in that image beyond the binary is what nothing here can assume.

**The refusal stays**, for a name the image's own passwd does not explain.
There is no number anybody can justify in that case, and chowning a credential
directory to an unjustified uid is how a token ends up owned by whoever happens
to hold it. The refusal prints the `docker run` that prepares the volume by
hand.

Proved against a stubbed docker whose fixture passwd maps `zitadel` to a uid:
the name resolves, `name:group` resolves, a name absent from passwd still
refuses, a numeric user skips the lookup, and an empty user still means root.
The real uid is whatever the real passwd says — this environment has a compose
parser, no Docker daemon, and no route to ghcr.io, so it is read on the Spark
and nowhere else.

### Run #46 — uid 1000, and a provider older than its database

The lookup worked and printed the number nobody had been able to read:

```
ghcr.io/zitadel/zitadel:v4.6.2 runs as 'zitadel', which is uid 1000 in its own /etc/passwd
ghcr.io/zitadel/zitadel:v4.6.2 runs as 1000; making the machinekey volume writable by it
machinekey volume is now owned by 1000, mode 700
```

**It was 1000 after all.** That is worth sitting with rather than passing over:
the guess would have been right, and guessing would still have been wrong. The
value was unverifiable from the dev box, `Config.User` was a NAME rather than a
number, and the only reason anybody can now say "1000" with a straight face is
that something read it. A guess that happens to be correct is indistinguishable
from a guess that is not, until a stack is broken in a way nobody can explain.

Then Zitadel got further than it ever has — past `01_tables`, through twenty-odd
verified migrations — and died somewhere new:

```
migration failed  name=34_add_cache_schema
  error="ERROR: partitioned tables cannot be unlogged (SQLSTATE 0A000)"
setup failed, skipping cleanup
```

All three windows agreed for the first time: nine failure lines, the oldest at
15:22:27, and every one of them the same error. No echo, no leftover, no
misdirection. The diagnosis had nothing to disentangle because there was nothing
tangled — which is what it should look like when a container fails once for one
reason.

### The finding

**Zitadel v4.6.2 cannot initialise against PostgreSQL 18 at all.** Its cache
schema created an UNLOGGED PARTITIONED table; PostgreSQL removed support for
that shape, so setup step 34 fails on every attempt, for everyone, always. It is
not a misconfiguration and no setting avoids it — `zitadel/zitadel#10712`.

Upstream fixed it in `zitadel/zitadel#11484`, merged 2026-02-03 into main with
the `version/v4` label and backported to the v4 line: step 34 now creates the
parent LOGGED and keeps the individual partitions unlogged, and a new step 69
migrates deployments carrying the old shape. Zitadel's own requirements page now
documents PostgreSQL 14–18.

So the pin moves to **v4.17.1**, the current v4, rather than to the oldest
release carrying the fix. Two reasons: there is nothing to regress, this
provider having never once completed an init here; and an identity provider is
the last component in a stack that should be running seven months behind. What
cannot be checked from here is config drift across eleven minors — no Docker
daemon, no route to ghcr.io — and the honest mitigation is that the bring-up can
now name whatever breaks instead of restarting quietly, which is exactly what
the last six runs bought.

`zitadel-image-matches-postgres.unit.test.ts` refuses the pairing rather than
either number: a Postgres major that forbids unlogged partitions may not sit
beside a Zitadel below the floor, in either direction, and the floor is written
down as a floor rather than as a claim about the earliest release that works —
naming an exact first-fixed version would be inventing precision nobody here can
check.

### What the six runs actually bought

| Run | Died at | Visible cause | True cause |
|---|---|---|---|
| #38 | port bind | `port is already allocated` | the same |
| #39–#40 | zitadel restart | *nothing* | password, unreadable |
| #41 | zitadel restart | password (read by hand) | the same |
| #42–#43 | zitadel restart | `Domain.AlreadyExists` | pat.txt permission denied |
| #44 | zitadel restart | `Domain.AlreadyExists` | pat.txt, **now visible** |
| #45 | prepare volume | `not a numeric uid[:gid]` | the same, refused not guessed |
| #46 | setup step 34 | `cannot be unlogged` | the same |

The interesting column is the gap between the last two. It closes at #44 — the
run after the failure window shipped — and has stayed closed since. Every run
from there on says what is wrong on the first read.

### Run #47 — the identity provider works, and the probe asks the wrong address

```
Management Console URL : http://localhost:3126/ui/console
registered route  endpoint=/oauth/v2/authorize
registered route  endpoint=/oauth/v2/token
server is listening  version=v4.17.1  address=[::]:8080
```

Zitadel v4.17.1 completed its init, applied every migration, registered its OIDC
routes and served. **The failure window printed nothing at all** — zero
error-or-fatal lines in 168. Eleven minors of config drift, the acknowledged
unverified risk in #515, changed nothing this stack depends on.

`ownpace-idp` then sat at `Up 5 minutes (unhealthy)`, `--wait` gave up, and the
bring-up died with three windows that between them said: the log is clean.

It was clean. **The answer was never in the log.**

### The shape none of the three windows can describe

`docker compose logs` shows what the CONTAINER wrote. A healthcheck runs beside
it and its output goes somewhere else entirely: Docker keeps the last few probe
attempts in `.State.Health.Log`, reachable only through `docker inspect`.
Nothing in the bring-up had ever looked there.

Every failure before this one was a container that DIED, and a dead container's
reason is in its log. A container that is running and unhealthy is the exact
complement of that, and the diagnosis built across #507, #510 and #511 is blind
to it by construction — three windows onto the wrong file.

So there is a fourth window: `what the HEALTHCHECK said (not in the log above)`,
straight from `docker inspect`, with the exit code beside each attempt. It says
"not in the log above" in as many words, because somebody reading three clean
windows and one failing container needs telling why a fourth exists.

Guarded three ways, each proved by breaking it: `{{if .State.Health}}` because
four services in this stack have no healthcheck and a template that dereferences
a missing field errors instead of saying nothing; `|| true` on the inspect
because this sits between the failure window and the pointer to the failure
table and must not take either with it; and a `[ -n "$cname" ]` guard because a
container compose cannot name is not a crash.

### Two of the five breaks were bad, and that is the finding

The first pass reported five breaks failing five cases. Two of them passed:

- **the `{{if .State.Health}}` guard deleted** — the assertion matched the
  COMMENT one line above the template, which quotes the guard in order to
  explain it. Prose read as code.
- **the inspect's `|| true` deleted** — the assertion sliced from `docker
  inspect` to the next `fi` at four spaces, but the inner block closes at six,
  so the slice swept in the `printf … || true` below and found what it wanted
  there.

Both are the same mistake in two costumes: an assertion that matched something
adjacent to the thing it meant to check. Neither would ever have failed, and
both would have been reported as coverage.

This is the second time today prose has been mistaken for code — the same
correction was made to the `config --images` case in #514 — which is enough to
call it a pattern rather than a slip: **when a comment explains a construct by
quoting it, any test asserting that construct must strip comments first.**

Mutation-verified, after fixing the two bad breaks:

| Break | Result |
|---|---|
| the probe window removed entirely (back to #47) | 4 failed \| 44 passed |
| the template stops guarding a missing `.State.Health` | 1 failed \| 47 passed |
| the exit code dropped, leaving output with no verdict | 1 failed \| 47 passed |
| the inspect can abort the diagnosis it sits inside | 1 failed \| 47 passed |
| the header stops explaining why this window exists | 1 failed \| 47 passed |

### What is still open — and the answer the fourth window would have given

The probe's own words, read by hand from the Spark while this was being
written:

```
"Status":"unhealthy", "FailingStreak":188,
"Output":"Error: not ready\n"   ExitCode: 1
```

This was first read as "the probe reached the server and Zitadel said no",
because zitadel/zitadel#9495 shows a failed connection surfacing as a raw
transport error (`Get "https://…": …`) rather than as `not ready`. **That
reading was wrong**, and the next observation showed it:

```
curl -o /dev/null -w '%{http_code}'  http://localhost:3126/debug/ready    → 200
curl -o /dev/null -w '%{http_code}'  http://localhost:3126/debug/healthz  → 200
```

Zitadel IS ready. The host reaches `/debug/ready` through the published port —
which lands on container port 8080, the same address and scheme the probe would
use if it were asking `http://localhost:8080` — and gets 200. So the probe is
not asking that. It is asking some other address and failing to reach it, and
v4.17.1 reports an unreachable endpoint as `Error: not ready` rather than as the
transport error #9495 documents.

Which of the two wrong addresses it uses — `localhost:3126`, the HOST-side port
present in the container's environment as `ZITADEL_EXTERNALPORT`, or
`https://localhost:8080` against an http server — is still not established, and
this workplan is not going to guess a third time. Three readings, three
corrections: the first hypothesis, then "both hypotheses eliminated", now this.
Each was stated with more confidence than the evidence carried.

Why Zitadel reports itself not ready is not yet known and this change does not
claim to fix it. What it does is make that sentence obsolete: the next run
prints `Error: not ready` in its own output, beside the exit code, without
anybody at a terminal.

**The database is fully initialised and must not be dropped.**

### The probe was asking an address that cannot exist

`curl http://localhost:3126/debug/ready` answers **200** from the host. That
port publishes to container 8080 — the same address and scheme the probe would
use if it were asking `http://localhost:8080` — so the probe is not asking that,
and Zitadel is not the thing that is wrong.

`zitadel ready` builds its URL from **ExternalPort**, and ExternalPort is by
definition *the address the outside reaches Zitadel on*. Inside the container
nothing is listening there. On this stack it is 3126, a published port. On
`id.ota.ownpace.eu` it is 443, terminated by netbird — something that is not
Zitadel and is not in the container at all.

So the probe is not merely misconfigured here. **It cannot be made correct by
configuration in any deployment with a front**, which is the deployment this
product ships. And no substitute exists inside the image: it is built with no
shell and no HTTP client but that one.

### So the check moved to the side that can ask it

`wait_for_idp_ready` in `bootstrap-managed.sh` polls
`http://localhost:${ZITADEL_PORT}/debug/ready` from the HOST — the published
port, never ExternalPort, because the host can only reach what compose
published and using ExternalPort would rebuild the bug one layer out.

The compose healthcheck is removed rather than left failing, and the reason is
written where the healthcheck used to be, because a healthcheck deleted without
one is a healthcheck somebody restores.

**This is not the check being weakened.** It is the same question — Zitadel's own
`/debug/ready` — asked by something in a position to hear the answer, and able
to distinguish the two failures the old probe collapsed into one word:

```
!!! the identity provider never became ready at http://localhost:3126/debug/ready (300s)
!!! 000 above means nothing answered; any other code means it answered and said no.
```

A timeout still ends in `explain_failure`, so the four log windows are unchanged
— only the asker moved. `curl -f` was deliberately not used: it collapses "not
ready yet" and "no such host" into the same silence, and telling those apart is
the entire reason the function exists.

### Three readings, three corrections

Worth recording as a sequence rather than as a conclusion:

| Reading | Basis | Verdict |
|---|---|---|
| probes a host-side port, refused | ExternalPort is in the container env | **right, and abandoned too early** |
| both modes eliminated, Zitadel says no | #9495 formats transport errors differently | wrong — that is an older line |
| the probe cannot reach any address it asks | `ready=200` from the host | holds |

The first reading was correct and was talked out of by an upstream issue that
looked closer than it was. What settled it was not a better hypothesis but a
`curl`, and every step of this workplan since #38 says the same thing in a
different costume.

### How this sits with the fourth window

These two changes were written an hour apart and they overlap, so: the fourth
window (`what the HEALTHCHECK said`) reads `.State.Health.Log` for any service
that has a healthcheck, and this change removes zitadel's. That does not make
the window redundant — postgres, pgbouncer, nextcloud, api, web and six
Trigger.dev services all still have one, and any of them going unhealthy hits
exactly the blind spot #47 exposed. It does mean the failure-table row that
window came with now describes a shape a current checkout cannot produce, and
that row is scoped once both are on main.

One thing this loses honestly: the workflow's closing "what state did we leave
it in?" step can no longer speak for `ownpace-idp`, which now joins the four
services already listed under "no healthcheck defined (this gate cannot speak
for these)". Readiness is asserted at bring-up by the poll and again by the
smoke's identity section; what is gone is the continuous signal between them.
That is the price of a probe that could not be asked from where it ran, and it
is recorded rather than glossed.

### Run #48 — the other thing that waited on health, and it was mine

The bring-up walked past the identity provider for the first time. `ownpace-idp`
came up, stayed up, reported no health at all — exactly as intended — and
nothing was left unhealthy. Then:

```
[setup-zitadel] FATAL: it did not become healthy within five minutes
```

`setup-zitadel.sh` had its own five-minute wait, polling
`"Health":"healthy"` out of `docker compose ps`. Removing the healthcheck made
that field permanently absent, so the script waited the full five minutes for
something that could no longer happen.

**This was a miss in the change that removed it.** Before shipping that, the
check made was `grep depends_on … service_healthy` — nothing found, therefore
nothing depended on the healthcheck. That grep answered a narrower question than
the one being asked. `depends_on` is one way to depend on a healthcheck; a
script polling `ps --format json` is another, and nothing looked for the second.

The fix is the same shape as the first: `setup-zitadel.sh` asks
`/debug/ready` on the **published** port, the address the bring-up already uses.
Its `"State":"exited"` branch stays — a provider that died has its reason in its
log, and saying so immediately beats five minutes of polling.

### The guard, and three passes to make it true

`nothing-waits-on-a-health-that-cannot-arrive.unit.test.ts` derives both sides
from the files: which services declare a healthcheck, and which services the
scripts wait on the health of. It took three attempts to be correct, and each
wrong version passed:

1. **Same-line matching.** It required the health match and the service name on
   one line. Real code puts them three apart — `state="$(… ps --format json
   zitadel …)"` above, `case "$state" in *'"Health":"healthy"'*` below. The
   restored #48 bug passed cleanly.
2. **An unbounded parse.** It scanned from `services:` to end-of-file and
   reported `ownpace-network` as a service. Bounded now, and asserted.
3. **A window that read comments.** `explain_failure` reads health generically
   through `"$svc"` and its header explains itself by naming zitadel — so the
   window read the prose and flagged the one function in the file that REPORTS
   health rather than waiting on it.

All three were found by breaking, and only by breaking: each version was green
against the real tree. That is now three separate occasions today — #514's
`config --images`, #516's two bad breaks, and these — where an assertion matched
something ADJACENT to what it meant to check. It is not a coincidence and it is
not carelessness in the ordinary sense; it is what happens when a test is
written by reading code rather than by making it fail.

One limitation is written into the file rather than left implicit: the guard
reads compose declarations, and a service can inherit a HEALTHCHECK from its
IMAGE instead. `api` and `web` declare none here and still report `(healthy)`.
A script polling one of those would be flagged wrongly — a loud failure somebody
investigates, which is the right way round. Zitadel is empirically clear either
way: #48's `ps` shows `Up 5 minutes` with no health column at all.

---

## A pipeline its own consumer could kill (PR #518's red, and eighteen more)

`unit-tests` went red on #518, on a test file and a script the branch does not
touch:

```
FAIL scripts/bootstrap-managed.unit.test.ts > trigger-credentials.sh
     > treats "no project yet" as the expected pre-setup answer
  [trigger-credentials] This Trigger.dev instance's schema is not the one this
  script knows.
  [trigger-credentials] Missing: Project.id
```

`Project.id` is in the fixture. The script had looked for it, found it, and
reported it missing.

### What it actually was

```bash
for col in $NEEDED; do
  printf '%s\n' "$present" | grep -qxF "$col" || missing="${missing} ${col}"
done
```

`grep -q` exits the instant it matches, without draining its input. The
producer's next write lands on a closed pipe, it dies of SIGPIPE, and
`set -o pipefail` returns the 141 rather than grep's 0. Instrumented under CPU
contention:

```
MISS col=Project.id  PIPESTATUS=(141 0)
```

Grep said **yes**. The producer was killed for being interrupted mid-sentence.
`pipefail` reported the killing.

It is a race, which is why it is a CI bug and not a local one: 0 spurious
failures in 15,000 unloaded iterations, ~1 in 1,400 with the machine loaded —
a runner with 323 test files in flight.

### Why the fix is not one line

This has cost a run before. **E2E (managed) #40** died at exit 255 inside the
bring-up's own failure diagnosis, because `docker compose logs "$svc" | head -20`
did the same thing: `head` closed the pipe, the still-writing container took
the SIGPIPE, and `explain_failure` aborted between its first window and its
second — so the window holding the fatal line never printed. That was fixed in
`explain_failure`, and the lesson was written into a twenty-line comment
directly above the fix.

Eighteen more instances of the same shape were sitting in eight other files at
the time, including:

| Where | What a spurious failure would have said |
|---|---|
| `e2e-managed.yml` | "PgBouncer is not in transaction mode" — on the gate this workplan exists to make green |
| `no-committed-artifacts.yml` | nothing: a false *pass*, letting a committed artifact through |
| `ci.yml` | "Unexpected markdown file at repo root" about an allowed one |
| `upgrade-drill.sh` | "the upgraded appliance logged nothing about migrations" |
| `ensure-env-secrets.sh` | silently skipping the replacement of a password Zitadel will reject |
| `smoke-managed.sh` | "web app not serving" |

The workflows count because GitHub Actions runs every `run:` step as
`bash --noprofile --norc -eo pipefail {0}` — `pipefail` is on whether the step
asked for it or not.

### The shape of the fix

Remove the producer from the pipeline; do not silence the status.

```bash
grep -qxF "$col" <<<"$present"            # here-string: no producer to kill
if [[ "$err" =~ required\ variable\ (…) ]] # bash, no fork at all
grep -o … <<<"$x" | awk 'NR==1'           # awk reads to EOF; head does not
```

`| head -1 || true` is not a fix. It stops the abort and keeps the wrong answer.

### The guard, and what it caught first

`scripts/no-pipeline-its-own-consumer-can-kill.unit.test.ts` reads every shell
script in the repository and every workflow `run:` block, parses out the pipes
the shell would actually see — not the ones inside `jq` programs, `grep -E`
patterns, `||`, comments or heredocs — and refuses an early-exit consumer on
the right of any of them.

Its first run failed on a nineteenth site the hand survey had missed, and its
second failure was its own:

```
deploy/compose/seed-demo-dav-content.sh:161 — grep -l stops at the first match
```

on the line `… | grep -o "$2" | wc -l | tr -d ' '`. There is no `grep -l`
there. The scanner had read the rest of the LINE as grep's arguments and found
the `-l` belonging to `wc`.

That is the **fourth** time in one day an assertion matched something
*adjacent* to what it meant to check — after #514's assertion matching a
comment that quoted the code, #516's slicing to the wrong `fi`, and #518's own
window reading a comment. It now has a test case of its own, and the scanner
cuts the script into segments at every unquoted separator instead of guessing
where a command ends.

Six mutations were run against the finished guard; all six were caught:
putting the pipe back in `trigger-credentials.sh`, putting it back in
`e2e-managed.yml`, adding a fresh `| head` to a file that never had one,
treating `||` as a pipe, dropping quote tracking, dropping heredoc tracking —
plus both vacuity guards, which fail if discovery ever stops finding files.

---

## Run #49 — through the identity provider, and into a refusal that said nothing

The first run in which nothing about the identity provider itself went wrong:

```
    waiting for the identity provider at http://localhost:3126/debug/ready (up to 300s)
    identity provider is ready after 5s
[setup-zitadel] starting the identity provider (issuer will be http://localhost:3126)
[setup-zitadel] waiting for it to report ready at http://localhost:3126/debug/ready
[setup-zitadel] ready
```

Both waits cleared — #517's from the host, #518's in the script that had been
asking for a health field that no longer exists. Twelve runs of work, and the
provider is now a solved problem: `ghcr.io/zitadel/zitadel:v4.17.1`, uid 1000,
a writable machinekey volume, a password its own policy accepts, a port nothing
else holds, and readiness asked from the one side that can hear the answer.

Then:

```
[setup-zitadel] looking for an existing 'Ownpace' project
[setup-zitadel] creating it
[setup-zitadel] FATAL: could not create the project
```

### What the run could not tell anyone

Seven words, every one of them already known. At least three unrelated failures
arrive at that line:

| What happened | What it needs |
|---|---|
| the instance will not accept this token | a new token — REPROVISIONING |
| `ownpace-setup` lacks the grant | a role in the console |
| something other than the provider answered | look at what is in front of it |

The provider had said which. `api` ran `curl -sS` with no `-f`, returned the
body alone, and the caller piped it into `jq -r '.id'` — so a 401 became `null`
and `null` became seven words.

The search above it was worse, because it **could not fail at all**:

```bash
api POST /management/v1/projects/_search … | jq -r '.result[]? | select(…) | .id'
```

`.result[]?` turns an error body into no output, which is byte-identical to
"no such project". A refused search reports that no project exists, and the
script goes on to create one. An error swallowed into an empty result — hard
rule 9, in the one script standing between the stack and a working provider.

### The lesson was already written down, one caller away

`read_allow_register` reads its setting back instead of trusting the call, and
the note above it says exactly why: *"`api` runs `curl -sS` without `-f`, so an
HTTP 404 or 400 still exits 0."* One caller defended itself and the callee was
left as it was — the same shape as #519, where a SIGPIPE lesson was written into
the twenty lines above the function it bit while eighteen other instances of it
survived elsewhere. **The place to fix a thing is the place that is wrong, not
the place where it was noticed.**

### What this run does NOT settle

It does not say which of the three it was. Nothing available from outside the
Spark distinguishes them, and guessing is how #516 nearly shipped a fix for a
failure mode that was not happening. What #50 will do is print the status and
the provider's own words, and refuse at the first call that proves the token
rather than the fourth call that happens to use it.

### Three more adjacent matches, two of them in this change

The count is now seven in one day, and this PR contributed three:

| Where | What it matched instead |
|---|---|
| the pipeline assertion, `[^)]*` | wandered across newlines to a `\| jq` elsewhere — but in doing so found a REAL missed site, `CLIENT_ID="$(api GET … \` + `\| jq …)"`, which a line-bounded `[^)\n]*` would have missed |
| `expect(CODE).toContain('%{http_code}')` | #518's readiness poll three lines above, so deleting the flag from `api` changed nothing |
| the stub `curl` | appended a status unconditionally, modelling a tool more helpful than the real one — so the break that removed `-w` passed |

The third is the one worth keeping. **A stub that is more capable than the
thing it stands in for cannot catch the caller forgetting to ask.** The break
that does not fail is the finding, every time.

Nine mutations against the finished guard, nine caught.

---

## Run #50 — the answer, in one line, in thirty seconds

```
[setup-zitadel] checking the identity provider still accepts this provisioning token
[setup-zitadel] FATAL: GET /auth/v1/users/me answered HTTP 401 — the provisioning token was NOT accepted.
    {"code":16, "message":"Errors.Token.Invalid (AUTH-7fs1e)", …}
```

#49 spent a whole run to say `could not create the project`. #50 named the
cause on the first API call, with Zitadel's own error id, before touching
anything. That is the entire value of #520, delivered on its first outing.

**The finding.** `/machinekey/pat.txt` is written at FIRST INIT and belongs to
the instance created at that moment. The zitadel database was cleared during
today's debugging while the machinekey volume was kept — the volume is chowned
on every bring-up but never removed — so the file holds a token for an instance
that no longer exists. Non-empty, well-formed, and refused by everything.

**The pairing is the rule:** clear the database and keep the volume, and the
token outlives its instance. Clear the volume and keep the database, and no
token is ever written, because init does not run twice. Both halves, every
time.

### The remedy the refusal points at could not be pasted

Two of its three commands were wrong, in the note a 401 sends the operator to:

| Printed | Why it fails |
|---|---|
| `docker volume rm compose_zitadel_machinekey` | the project is `ownpace-managed`, so the volume is `ownpace-managed_zitadel_machinekey`. `docker volume rm` answers "no such volume", which reads as *already gone* rather than *you have not done this step* — and skipping exactly this step is what produces the 401 |
| `psql "$DATABASE_URL" -c 'DROP DATABASE zitadel'` | `$DATABASE_URL` is empty in the operator's shell, points through PgBouncer when it is not, and the statement has no `IF EXISTS`, so a second paste is an error |

The correct three-line form was already printed **correctly** by
`bootstrap-managed.sh` and by the failure table. Only the copy the refusal
names was wrong.

### The guard written to stop this had three holes, and one is exquisite

`pasteable-hints.unit.test.ts` exists because this bug happened twice (#487,
then #513). Its header says, in as many words, that *a guard scoped to the file
where a bug was found does not stop the class*. And then:

| Hole | What it meant |
|---|---|
| the variable list was `POSTGRES_USER` and `POSTGRES_DB` — the two the original bug used | `$DATABASE_URL` is just as container-only and sailed straight through |
| the `DROP DATABASE … IF EXISTS` case read **one file**, `bootstrap-managed.sh` | scoped to the file where the bug was found, inside the test whose header forbids exactly that |
| nothing checked volume names at all | a printed name matching no volume is indistinguishable from a volume already removed |

All three are closed by deriving from the files: the container-only list is
named once and used by every case, every case reads every script, and volume
names are checked against `managed.yml`'s own `name:` and `volumes:` keys, so a
rename cannot drift past.

Six mutations, six caught. The sharpest is a controlled A/B: with the variable
list shrunk back to two, tonight's `$DATABASE_URL` line passes 7/7; with the
list as it now stands, the same line fails two cases.

One of the new cases was wrong first and flagged *everything* — the volumes
block was matched with `\Z`, which JavaScript reads as a literal `Z`, so
nothing parsed and every name looked invalid. A guard that flags everything is
as useless as one that flags nothing. It is a line scan now.

### A postscript: the fix for the paste bug had a paste bug

The corrected REPROVISIONING note shipped an hour later with this line:

```
#   docker exec -i ownpace-db sh -c 'psql -U "\$POSTGRES_USER" -d postgres -c "DROP DATABASE …"'
```

The backslash was copied from `bootstrap-managed.sh`, where it is **correct** —
that line lives inside `echo "…"`, and bash eats one level and prints a literal
`$`. A comment is not printed. It is read out of the file, so nothing eats the
backslash, the operator copies it too, and `sh -c` receives an *escaped* dollar
inside double quotes. Proved at a shell rather than reasoned about:

```
echo "… sh -c 'psql -U \"$POSTGRES_USER\" …'"     →  psql -U ""
echo "… sh -c 'psql -U \"\$POSTGRES_USER\" …'"    →  psql -U "$POSTGRES_USER"
sh -c 'echo psql -U "\$POSTGRES_USER"'            →  psql -U $POSTGRES_USER
sh -c 'echo psql -U "$POSTGRES_USER"'             →  psql -U openmigrate
```

Both wrong answers were live in this repository at the same moment: the comment
had an escape it must not have, and the guard would have accepted an `echo` that
lost the escape it must have. The first prints a role named `$POSTGRES_USER`;
the second is `psql -U ""`, which is #487 verbatim.

**Which form is right depends on whether the line is PRINTED or READ**, and the
guard had no opinion — it accepted `\$` in either context, which is precisely
what let the correction ship broken. It now checks both directions, and they
meet in the middle: whatever the source form, what reaches the operator must be
`psql -U "$POSTGRES_USER"`.

Two mutations, two caught. A third — neutralising the `echo` so the vacuity case
would fire — did **not** fail, and that is the guard being right rather than
wrong: `smoke-managed.sh` prints a second such hint, so the population was never
empty. An incomplete break, not a hole.

---

## Runs #49, #50 and #51 — the token was an error message

Three runs, two full clear-downs of the Spark, and a diagnosis that was wrong
twice. The actual bug, in one line:

```
PAT="$("${COMPOSE[@]}" exec -T zitadel cat /machinekey/pat.txt 2>/dev/null | tr -d '\r\n' || true)"
[ -n "$PAT" ] || die "no provisioning token at /machinekey/pat.txt."
```

**The Zitadel image has no `cat`.** No shell, no coreutils, nothing. Docker
reports that on **stdout**, not stderr, and exits 127:

```
OCI runtime exec failed: exec failed: unable to start container process:
exec: "cat": executable file not found in $PATH
```

Three maskings, stacked, in one line:

| | |
|---|---|
| `2>/dev/null` | silences stderr; Docker wrote this to **stdout** |
| `\|\| true` | swallows exit **127** |
| `[ -n "$PAT" ]` | an error message **is** non-empty |

So `setup-zitadel.sh` sent that sentence to the identity provider as a Bearer
token, every run, for ever. And Zitadel said so exactly:

```
illegal base64 data at input byte 3
token contains an invalid number of segments
Errors.Token.Invalid (AUTH-7fs1e)
```

**Byte 3 is the space after `OCI`.** The provider had been naming the bug
precisely since #49; nobody was reading its log, because the script's own
refusal was busy telling a different story.

### The refusal that sent us the wrong way twice

#520 replaced `could not create the project` with a 401 message that named a
cause — *"the zitadel DATABASE was cleared while the machinekey VOLUME was
kept"*. That is a real failure mode, it fits a 401, and it was **not what was
happening**. It was asserted rather than offered, so two clear-downs of a
database and a volume that were never at fault followed, one of them after I
told the operator it was "the clean state".

A refusal that names ONE cause for a status code with several is worse than one
that names none: it is confident, and it moves somebody.

The message now says the token was read and has the shape of one, offers the
stale-instance case as the likeliest rather than the only, and prints the
command that gets the provider's own account.

### It was already known here, one caller away

`prepare_machinekey_volume` reads `/etc/passwd` out of **this same image** with
`docker create` + `docker cp`, and its comment says why in as many words: no
shell in the image can be assumed, and nothing is started. That was written in
#514. The very next thing to read a file out of that image used `exec … cat`.

That is the third time in one day: #519 (a SIGPIPE lesson written above the
function it bit, eighteen instances elsewhere), #521 (a guard scoped to the file
where its own bug was found), and now this. **A lesson written next to one
caller is not a lesson the codebase has learned.**

### What the fix is

- Read the **volume**, not the provider — with busybox, via the
  `zitadel-machinekey` service that already mounts it.
- Do not swallow the exit status.
- **A token is not merely non-empty.** Whatever produced the bytes, they are
  checked for the shape of a credential before being sent as one: no
  whitespace, at least twenty characters. An error message has spaces; so does
  a progress line, a warning, and a YAML dump. No token does.

The last of those is the durable part. It catches this class regardless of
which mechanism produces the garbage next time.

### The stub was the weak link, a third time

Two of the five mutations passed at first, and both were the test's fault:

| Break | Why it passed |
|---|---|
| the whitespace check removed | the mutation was `[[:space:]NEVER]`, still a bracket expression matching a space — a bad break, not a hole |
| reverting to `exec … zitadel cat` | the stub answered identically for `exec zitadel` and `run zitadel-machinekey`, so it could not tell the broken call from the fixed one |

The second is the same finding as #520's `curl` stub, which appended a status
whether or not `-w` was passed, and #521's parser that flagged every name. The
stub now models the image: `exec … zitadel cat` returns the OCI failure on
stdout with 127, `run … zitadel-machinekey cat` returns the file. With that,
reverting the fix fails **7 of 14** cases — which is what a fix worth having
looks like when you take it away.

---

## E2E (managed) #52 — the first run past the identity provider, and what it showed

`Bring the stack up` succeeded for the first time ever: 3m45s, every service
healthy, `setup-zitadel.sh` all the way through. The smoke then failed in five
seconds with every authenticated request answering the same thing:

```
close:  500 {"error":"auth_failed","reason":"Something went wrong verifying your session …"}
shared addresses: HTTP 500 …   billing usage: HTTP 500 …   invoices: HTTP 500 …
readiness (database): HTTP 200, .database -> up
```

Seven checks, seven failures, one cause, and no mention of it anywhere. The
unauthenticated endpoint answered 200 throughout, which is the shape of a
verification problem rather than a service being down.

### Four things, none of which could work, all of which reported success

Everything below was **measured against the running provider**, after two wrong
diagnoses earlier the same night taught me not to reason about it.

**1. The check that could not measure anything.** The smoke's identity section
asked the API container with `curl`, under `2>/dev/null || true`. The API image
is `node:24-slim`: no curl, no wget. Its own `HEALTHCHECK` is
`node -e "fetch(...)"` for exactly this reason.

```
docker exec ownpace-api sh -lc 'command -v curl'  ->  no curl
docker exec ownpace-api sh -lc 'command -v node'  ->  /usr/local/bin/node
```

So on every run ever made, `curl: not found` became the empty string, and the
empty string was printed as *"the API cannot reach the issuer at all"*. It was
right by accident in #52 and would have said the same about a perfectly
reachable issuer. **Fourth time in one day** — after #519, #521 and #523 — that
a lesson written next to one caller was not a lesson the codebase had learned.

**2. An issuer the API can never mean.** `ZITADEL_EXTERNALDOMAIN` defaulted to
`localhost`, so `JWT_ISSUER` was `http://localhost:3126`. Inside the API
container, `localhost` is the API:

```
fetch("http://localhost:3126/.well-known/openid-configuration")
  TypeError: fetch failed / Error: connect ECONNREFUSED 127.0.0.1:3126
```

`getJWKS` is called outside `verifyManagedToken`'s try/catch, so that throw is
not a JWT error and lands in `serverFault` as a 500 — which is *correct*, and is
why not one of the seven failures mentioned a token.

There is no internal shortcut. Zitadel resolves the instance from the request's
**origin** — host and port — and refuses every other one:

```
http://zitadel:8080/.well-known/openid-configuration
  404  unable to set instance using origin &{zitadel:8080  http}
       (ExternalDomain is localhost): Instance not found.
```

Three ways round it were tried and all three are closed:

| Attempt | Result |
|---|---|
| instance **trusted** domain (`POST /admin/v1/trusted_domains`) | accepted, `http 200` — and the origin still 404s. It is not origin resolution |
| `AddInstanceDomain` via the Admin API (`POST /admin/v1/domains`, `/instance/domains`, `/iam/domains`) | `404 Not Found` — the endpoint does not exist |
| the System API (`POST /system/v1/instances/_search`) | `401 Errors.Token.Invalid` — it needs a system user, which a provisioning token is not |

**So the origin is fixed at first init and cannot be corrected afterwards.**
Everything else has to agree with it: the domain defaults to `ownpace-idp` and
is registered as a network alias written as the same expression; the provider
listens on the number it publishes, because `3126:8080` gave one address two
meanings; and `setup-zitadel.sh`, which runs on the host, presents the origin
with `curl --resolve` — only when this machine cannot reach it unaided, so a
real deployment is left alone.

**3. A redirect URI the provider refuses outright.**

```
GET /oauth/v2/authorize?...&redirect_uri=http://localhost:3123/auth/callback
  400 {"error":"invalid_request","error_description":"This client's redirect_uri
       is http and is not allowed."}
```

The application was created with `devMode:false` against the default
`WEB_URL=http://localhost:3123`. Zitadel refuses a plaintext redirect URI before
any login screen, so **the sign-in button could never have worked** — while
provisioning reported complete success: project created, application created,
client id written to `.env`, "done". `devMode` is now derived from the scheme of
`WEB_URL`, and the found-branch RECONCILES the application instead of reading
one field off it: the stack that already exists is the broken one.

**4. A token with no email address in it.** With dev mode on, the whole sign-in
completes — and the API then refuses every request for want of a claim.
`verifyManagedToken` requires `sub` and `email` (ADR-0042: invitations are
addressed to an email address, and a first-time signer-in has no row to look one
up in). Measured with `idTokenUserinfoAssertion` off and on:

```
access token   iss sub aud exp iat nbf client_id jti          (both ways)
ID token       ... + email email_verified name given_name ...  (flag ON only)
```

There is no setting that puts user info in a Zitadel access token, and
`apps/web/src/services/oidc.ts` was sending exactly that. It now sends the ID
token — a legitimate bearer rather than a shortcut: its audience is
`[client id, PROJECT id]` and `JWT_AUDIENCE` is that project id, so the API
validates issuer, audience, signature and expiry exactly as it would otherwise.

### What is still owed, and it is no longer a plan

The smoke mints its tokens with the API's `JWT_SECRET`, and `selectAuthMode`
returns `managed` the moment `JWT_ISSUER` is set — at which point that secret
stops being used, deliberately, so a lingering one cannot silently downgrade
verification. So on a provisioned stack every authenticated assertion in the
smoke is refused whatever else is fixed. The smoke now says that **once**,
up front, and is red — rather than letting a reader work backwards from fifteen
unrelated-looking failures.

The replacement was driven end to end against the live provider on 2026-08-23:

1. read the provisioning token off the machinekey volume;
2. grant `IAM_LOGIN_CLIENT` to the calling machine user — `CreateCallback`
   refuses without it (`No matching permissions found (AUTH-AWfge)`), and it is
   the role Zitadel's own login UI holds;
3. `POST /v2/users/human` with a verified email and a password;
4. `GET /oauth/v2/authorize` → `302 /ui/v2/login/login?authRequest=V2_…`;
5. `POST /v2/sessions` with a password check → session id and token;
6. `POST /v2/oidc/auth_requests/{id}` → a callback URL carrying the code;
7. `POST /oauth/v2/token` with the PKCE verifier → an ID token carrying `email`.

Each of those returned what it should. What remains is wiring it into the smoke:
one Zitadel person per tenant the smoke touches, so each token resolves through
a single membership and no tenant header is needed, and the `tenant_member` rows
seeded against the Zitadel subject rather than a made-up one.

### E2E (managed) #60 — the same bug, committed by me, one hour later

The fix for #52's "fifteen misleading refusals" was a warning printed once at
the top of `mint`. It made things worse, and in the most instructive way
available:

```
verify: start-http-400   apply: start-http-400
readiness (database): HTTP 400, .database -> '<unreadable>' —
shared addresses: HTTP 400, .addresses | length -> '<unreadable>' —
```

An empty body and a 400 — which says nothing about tokens at all. **`mint`'s
stdout IS the token**: it is read with `TOK="$(mint …)"`. A bare `echo` inside it
prepends eight lines of prose to every JWT, and the API answers an unparseable
header the only way it can.

That is #523's shape exactly — *output that is not the credential ending up in
the credential* — one caller further along, written by the same hand that had
just finished writing the test which catches #523. Fifth time in a day. The
lesson is not "remember this"; it is that **remembering does not work**, which is
why the fix is two mechanical things rather than a comment:

- the warning goes to **stderr**, which the script's own `tee` still captures;
- and `mint` **checks its own output for the shape of a token** before returning
  it — no whitespace, three dot-separated segments — in the callee, not at the
  four call sites, because fixing the caller and not the callee is how #519
  survived in nineteen other places.

The invitee's token, which is the one `mint` does not produce, gets the same
check for the same reason.

### What is still owed after that

A guard that generalises this rather than pinning it: **every value sent as a
`Bearer` must have passed a shape check.** Two different mechanisms have now
produced garbage into a credential (`docker exec` on an image with no `cat`; an
`echo` in a function whose stdout is a value), and both were caught only after a
night each. Detecting "a function whose stdout is a value must not print
diagnostics" is not mechanically decidable — `read_env` returns its value with
`printf` — but "this string reached an `Authorization: Bearer` header without
being checked" is.

### E2E (managed) #61 — the identity provider works, and one of my conclusions was wrong

The first run with all of the above in place:

```
--- identity provider ---
issuer: http://ownpace-idp:3126 (declares its own name)
jwks:   http://ownpace-idp:3126/oauth/v2/keys (fetchable)

readiness (verdict): HTTP 200, .status -> ok
```

Asked from inside the API container, with node, against the live provider. The
reachability bug is gone, `checkSignIn` returns `up`, and every remaining failure
is the one known cause:

```
close: 401 {"error":"Unauthorized","message":"Token verification failed:
             Unsupported "alg" value for a JSON Web Key Set"}
verify: start-http-401   apply: start-http-401
```

That is `jose` refusing an **HS256** token against an **RS256** key set — the
smoke's minted tokens meeting a managed-mode API, exactly as the one-line warning
above them predicts, and now a 401 that names its cause rather than a 500 that
names nothing.

**AND IT NEEDED NO RE-INITIALISATION.** The instance on that machine was
initialised as `localhost` and has never been re-initialised. The conclusion
written three sections above — *"the origin is fixed at first init and cannot be
corrected afterwards"* — was wrong, and wrong in a way worth recording:

> A trusted domain was added by hand while the provider still LISTENED on 8080
> and published 3126. Every in-network probe therefore went to
> `ownpace-idp:8080`, an origin that could not match `ownpace-idp:3126` whatever
> was trusted. The port was the fault, and the host got the blame.

Zitadel resolves an instance by origin — **host and port**. Once the two agreed,
the trusted domain did exactly what its name says. So `setup-zitadel.sh` now
registers `ZITADEL_EXTERNALDOMAIN` as a trusted domain on every run, idempotently,
and a stack whose external domain changes repairs itself instead of asking
somebody to destroy a database (hard rule 2). The re-initialisation stays in the
refusals as the last resort it actually is: for when nothing the instance knows
resolves, so the script cannot even ask.

The lesson is not about Zitadel. **A negative result from a test with two
variables in it is not a negative result.** One evening went into "trusted
domains do not affect origin resolution", concluded from a probe that could not
have succeeded either way.

## The credential with a deadline nobody was watching

Answering an unrelated question — "where should `IAM_LOGIN_CLIENT` live?" —
meant tracing what the provisioning token actually is, and the trace ended
somewhere else entirely: **the token the whole managed gate runs on has an
expiry nobody was tracking.** The chain, each link reasonable on its own:

1. `ZITADEL_FIRSTINSTANCE_ORG_MACHINE_PAT_EXPIRATIONDATE` is read by the
   provider **once, at first init**, from `ZITADEL_PAT_EXPIRY` in `.env`.
2. `setup-zitadel.sh` wrote that value as *now + 1 day*, `--if-absent` — the
   timestamp of whichever run FIRST executed the script, frozen. The comment on
   it said *"computed now so it is short-lived rather than a date somebody
   picked once and left in a file"*, and `--if-absent` made it exactly that.
3. The trace concluded the live token had inherited a seed from run #47/#48 at
   the #50–#52 re-inits and **would die that same afternoon**, taking with it
   the ability to mint a successor — minting needs the very token that died.

Then the fix ran, and **E2E (managed) #66 measured it**:

```
[setup-zitadel] good until 2026-12-31T23:59:59Z (129 days) — no rotation needed
```

The trace was wrong, and the way it was wrong is itself the finding. The gate
restores `.env` from a persisted copy at the start of every run, and persists
it back **before** `setup-zitadel.sh` runs — so every write this script makes
to `.env` evaporates at the next restore. No seed ever reached an init; the
compose default applied every time. The note said 2026-08-24 while the
credential holds 2026-12-31: **the note and the truth had drifted apart, in
the lucky direction, by an accident of plumbing.** On a self-managed host —
where `deploy/compose/.env` is the durable file the provider actually reads —
the same drift arms the unlucky trap instead: a re-init reads a seed that has
meanwhile slipped into the past and mints a token **born dead**.

So the credential now keeps its own clock, in `setup-zitadel.sh` where the
token already proves itself, and the fix never reads the note: every run asks
the PROVIDER when the token dies and, inside the rotation window, mints a
successor, **proves** it with the same call the predecessor just answered,
lands it in the machinekey volume, **reads it back**, and only then deletes
the predecessors — an order chosen so a failure at any step leaves a working
token somewhere rather than none anywhere. The `.env` note then moves to the
successor's real expiry with a **plain** upsert; on a durable-`.env` host that
un-poisons the re-init path, and everywhere it stops the file asserting a date
no credential carries. Past the deadline with no runs in between, the 401
refusal now names expiry as a cause beside the instance-mismatch one, with the
console remedy that destroys nothing.

Two lessons, one old and one earned tonight:

- **`--if-absent` is for an operator's own choices; it is the wrong mode for
  anything with a clock in it.** A value computed at write time and consumed
  at read time is only as fresh as the day nobody re-wrote it.
- **The note is not the truth — and neither was the archaeology.** A deadline
  for a live system was reconstructed here from git history and stated as
  fact; one run against the system itself contradicted it. Same lesson as
  #61, one day later: a conclusion with the system left unasked is a draft.

## The people a dead run leaves behind

Rob blessed the throwaway-people design — three humans created per run, signed
in, deleted in the EXIT trap — and asked for the residue closed. The residue
was two silences:

- **A hard-killed run never reaches its trap.** Runner loss, SIGKILL, power:
  its three people linger in the provider forever, invisible unless somebody
  opens the console. Nothing looked for them.
- **`|| true` on the take-back.** A delete that failed was indistinguishable
  from one that worked, in the one place whose whole job is putting things
  back.

So the smoke now sweeps before it creates: at the start of the sign-in
section, anybody matching the gate's own naming is a leftover by definition
(runs on the one runner are serialised) and is taken back, loudly. Two fences
before anything is deleted, because deleting PEOPLE on a loose match is the
worst kind of thorough: the provider is asked only for addresses ending in
`@smoke.local`, and each hit must still match the exact shape `sign_in_as`
creates — pinned by a test that EXTRACTS the guard regex and the three
creation emails from the script and runs one against the other, so the two
cannot drift apart. A leftover the sweep can see but not delete fails the
run: an orphan named and left standing is a finding, not a shrug. The
take-back's failures are now said out loud too (still non-fatal — it fires in
the EXIT trap, after the verdict), and a leftover `IAM_LOGIN_CLIENT` is
announced where the grant happens and never removed: the humans are
unambiguously ours; a role on the provisioning user might be an operator's
own choice.

**And the sweep's first live run settled something nobody had asked.** E2E
(managed) #68 printed `swept 18 leftover(s) from earlier runs` — three people
for every run since sign-in was built. Not "some runs crash": **the take-back
had never taken back anybody.** `sign_in_as` appended each created user to
`IDP_USERS` from inside the command substitution it runs in, the append died
with the subshell, and `idp_take_back` iterated an empty array on every run —
with `|| true` keeping the silence. The same shape as the `fail=1` a subshell
swallowed in run #60, one function over. The array is now filled in the
parent shell, from the subjects the reads hand back — pinned by a test that
extracts the read variables and the capture list from the script and checks
one against the other — and `sign_in_as` is pinned to never touch the array
again. The `IAM_LOGIN_CLIENT` warning fired on the same run: a leftover grant
from some earlier failed revoke, present ever since, now at least said out
loud. A cleanup mechanism whose failure mode is silence does not exist until
something independent counts what it left behind.

## A version agreement that only the Spark could check

A confirmation run dispatched for an unrelated reason — proving the identity
provider still granted and revoked cleanly after a hand-edit — died at the
bring-up instead, twenty-one seconds in:

```
!!! Trigger.dev version drift (0018 T0):
!!!   images:  v4.5.9   (TRIGGER_IMAGE_TAG, or managed.yml's default when unset)
!!!   SDK/CLI: 4.5.12   (apps/worker/package.json)
```

Nothing to do with identity. **Dependabot's #528 had bumped
`@trigger.dev/sdk` from 4.5.9 to 4.5.12 in `apps/worker`, and that number has
to match the image tag** — the tasks it deploys RUN inside those images. The
bump passed all seventeen checks, merged, and broke the managed gate on main;
the 05:30 nightly would have died the same way.

Two things had to be true at once for this to land:

1. **The agreement was enforced only at bring-up.** `bootstrap-managed.sh`
   compares the two numbers and refuses — deliberately, "checked rather than
   corrected", since the two directions have different consequences. But a
   `docker compose up` happens only in the managed gate, which no pull request
   runs. Nothing static compared them, so nothing could fail in CI. Two
   hand-maintained numbers across three files with nothing checking them:
   the same shape as the service list here, `MOUNTS` (0096) and the trigger
   filters (0097).
2. **`apps/worker` was being deliberately held back.** The root and the
   scheduler had already drifted to 4.5.11 while the worker stayed at 4.5.9 to
   match the images — a pin nothing recorded as a pin, which reads to
   dependabot as simply out of date.

The worker goes back to 4.5.9, restoring the arrangement that was green, and
the comparison moves to where a pull request can see it. Its failure message
states the decision rather than an edit: hold the SDK back, or move all three
and accept that the next bring-up recreates the Trigger.dev webapp and
supervisor at the new tag — on the one machine whose Trigger.dev account
cannot be rebuilt unattended, which is why nothing does that on its own
initiative.

The general lesson, third time today in a different costume: **a rule that
only fires in the one environment nobody runs on a pull request is not a
rule, it is a landmine with a date on it.** The credential's clock, the
take-back nobody counted, and now a version pin nobody could see — each
invisible until something independent checked, and each cheap once it was.

## What no gate has ever driven

A sweep of the three e2e gates — `e2e.yml` (self-hosted, two nightly
backends), `e2e-managed.yml` (05:30 on the Spark) and `e2e-o365.yml`
(secret-gated, a real read-only tenant) — against the connector list DERIVED
from `config.ts` rather than a list written by hand.

**The gates are in better shape than the question implies.** All four domains
— mail, calendar, contact, file — are seeded and migrated and verified by
`e2e.yml`; the managed smoke verifies two mappings across a mail tenant and a
DAV tenant with required-domain assertions; API route families are already
derived from `index.ts` and guarded by `gate-coverage.unit.test.ts`, with a
written reason demanded for each one the smoke skips.

**One shipping path has never run.** `imap-dav` is a first-class TARGET type:
the API constructs it (`routes/migrations/index.ts`), `config.ts` parses it,
`build-deps.ts` builds it — and no gate, seed, appliance config or smoke has
ever selected it. Mail written to an IMAP target rather than a JMAP one is
covered by unit tests and by nothing that runs. It is also plainly
**coverable**: the Stalwart the gates already stand up serves IMAP on 993 with
the target account provisioned, so closing it needs no new infrastructure and
no credentials.

The gap was invisible from any one place, which is why a guard now derives the
list and demands one of three verdicts per type: **driven** (a gate stands it
up), **uncoverable** (something outside this repository is needed — a Google
account, a Box app — with the reason), or **owed** (coverable here, not done).
Owed is kept separate from uncoverable on purpose: folding "we have not got to
it" in with "it needs somebody's Google account" is exactly how a closable gap
becomes permanent, because both read as "not covered" and only one of them
should ever be accepted. The owed list is asserted EXACTLY, so a second entry
fails until somebody writes that decision down.

**And the gate was still carrying scaffolding.** A `probe:` job added on
2026-08-23 to ask the running Zitadel two questions — commented "Deleted
before this branch is proposed", with a `probe_only` dispatch input that
switched the real gate OFF — was never deleted. It lived on `main` for a day:
a second job, an extra input on every dispatch dialog, and an `if:` on the
real job whose only purpose was to dodge a probe nobody would run again.
Harmless, and the point is that the promise was in a comment, and a comment
cannot delete anything. The workflow now declares exactly one job, takes no
dispatch input, carries no `if:` and says TEMPORARY nowhere — each asserted,
and each proved by putting the probe back.

### And the gate that had never run at all

Writing the verdicts above, `graph-mail` was recorded as **driven** — "e2e-o365.yml,
a real SMB tenant, read-only, secret-gated". Checking rather than assuming:

```
list_workflow_runs(e2e-o365.yml) -> total_count: 0
```

**It has never executed. Not rarely — never, in its entire lifetime.** It is
`workflow_dispatch`-only, so nothing fires it; and the suite it invokes skips
silently unless `O365_CLIENT_ID` and `O365_TENANT_ID` are set, so a run
without them would report pass having executed nothing. Its only commits since
creation are a repo-wide rename and a transpiler change — nobody has
maintained it against the product.

So the first draft of the coverage guard did the exact thing the guard exists
to prevent: it took a workflow file's existence as evidence of coverage and
wrote that down as an assertion. A file that mentions O365 is not a test of
O365. **The correction is the finding**: the four Graph types move to `owed`,
which makes the O365 question visible as one decision — is that path exercised
by a harness nobody runs, by a documented manual migration somebody actually
performs, or not at all? — rather than as a green-looking workflow that has
never once run.
## A backup you have actually restored

The Trigger.dev upgrade question — "can it be done, and how" — had a clean
answer everywhere except one place. The images exist, the four-place version
agreement is now guarded in CI, and the procedure has been documented since
somebody upgraded with runs in flight and watched every run loop on
`Snapshot changed inside startRunAttempt`. What was missing was the part that
makes any of it reversible: **nothing backed `triggerdb` up.**

That database holds what a person cannot rebuild unattended — the account, the
project, its API keys, the worker group, the deployed-task records. The webapp
applies its own schema migrations on boot and Prisma has no down-migrations,
so the documented rollback restores the IMAGES and not the schema they
migrated. The self-hosted appliance has had a Backup/Restore Drill since
§22.1; the managed plane, the half that genuinely cannot be rebuilt without a
browser, had none.

`trigger-version.sh` covers both halves of the problem, because they are the
same problem: you upgrade when a version appears, and you can only upgrade
safely if you can get back.

**Listing versions had to be done the awkward way.** ghcr's `/tags/list` is
neither newest-first nor complete in one page: with `n=1000` the newest
`v4.5.x` it returns is `v4.5.4`, while `v4.5.9` (running) and `v4.5.12` both
answer a manifest request with 200. Following the `last=` Link header works
and walks thousands of SHA-shaped tags to do it. So versions are PROBED by
manifest, upward from the one already pinned — the only question that registry
answers reliably. Measured: 5 seconds, and it finds v4.5.10, v4.5.11, v4.5.12.

**And the size check was wrong on the first pass.** `verify_dump` rejected a
dump under 1KB — measuring the ARCHIVE. SQL compresses ferociously, so a real
dump can land under a hundred KB on disk while a truncated one that compressed
badly sails through. The floor now measures the DECOMPRESSED SQL, which is the
quantity the question is actually about. Found by a test whose own fixture
compressed to 78 bytes.

The drill is the piece that matters most: dump, restore into a THROWAWAY
database, compare table counts and project counts, drop the throwaway. It
never touches the live database — `restore` is the only thing that does, and
it refuses without `--yes`, refuses while `trigger-api` is running, and prints
the stop commands instead. Proved by breaking, five mutations, five caught,
including the one that would matter: the drill's `DROP DATABASE` pointed at
the live database instead of the throwaway.

### And the guard from #519 caught the author of #519

The full suite came back `1 failed | 3825 passed`, and the failure was in the
new script:

```
trigger-version.sh:55  — head stops reading after its limit.
trigger-version.sh:181 — head stops reading after its limit.
trigger-version.sh:181 — grep -q stops at the first match.
trigger-version.sh:232 — head stops reading after its limit.
```

Four instances of #519 — a pipeline its own consumer can kill — written into a
new file by the same hands that fixed nineteen of them repo-wide a day
earlier. `zcat "$f" | head -20 | grep -q …` closes the pipe the moment grep
matches; `zcat` dies of SIGPIPE; `set -o pipefail` reports that as the
pipeline failing. Worse than a plain bug, because it depends on whether the
writer has finished before the reader leaves: it would have passed here and
failed on the Spark, or passed a hundred times and failed once.

Every early-exit consumer now reads from a here-string. **The lesson is about
the guard, not the bug**: knowing a rule, having written the rule, and having
written the test for the rule were all insufficient — what caught it was the
test running. That is the third time in two days a lesson written next to one
caller failed to reach the next one, and the first time the cost was zero,
because by now something automated was watching.

It also caught a worse habit than the bug: `pnpm test | grep 'Tests'` was read
as green because the shell reported exit code 0 — the GREP's status, not the
suite's — and the branch was pushed on that reading. The summary line said
`1 failed` in plain sight.

### The drill's first live run reported its verdict and swallowed its evidence

E2E (managed) #74, the drill's first execution against the real database:

```
[trigger-version] restoring it into triggerdb_drill — the live triggerdb is not touched
[trigger-version] round trip proved: 83 tables, 2 project(s), restored and compared
```

The round trip works. But two lines that should have preceded those —
`dumping triggerdb from trigger-db` and `verified …` — are absent from the job
log, and their absence is the finding. `cmd_backup` returns the path it wrote
by PRINTING it, and `cmd_drill` captures that with
`$(cmd_backup drill | tail -1)`. `say` wrote to stdout, so every diagnostic
inside the backup became part of the captured value and `tail -1` discarded
all of it.

**This is `mint()` again** — smoke-managed.sh, earlier the same day, whose
stdout was the token and which printed a warning into it. That one cost a run;
this one cost the evidence from the run that mattered most, which is cheaper
and exactly as avoidable. `say` writes to stderr now, and a test pins both
halves: `say` is redirected, and `cmd_backup` prints exactly one unredirected
thing — the path.

Three times in two days: #519's pipelines, the mint() stdout rule, and now
both again in one new file. The pattern is not carelessness about the rule; it
is that a rule lives where it was written. What generalises it is a test that
reads every file, and the only reason these cost nothing is that somebody had
already written those tests and something ran them.

## The target nothing had ever written to

`imap-dav` — the single entry the coverage guard listed as **owed** — is now
driven. Mail written to an IMAP target rather than a JMAP one had been covered
by unit tests and by nothing that ran, on a path the API constructs
(`routes/migrations/index.ts`), `config.ts` parses and `build-deps.ts`
dispatches.

**Two wrong shapes were tried before the right one, and both were caught by
guards somebody else had already written.**

The first instinct was a second mapping file in the appliance's config dir,
since `loadConfigDir` reads a DIRECTORY. That would have broken four other
gates: `getDeletions()` takes `Object.keys(body)[0]` and `getDomainStatus()`
takes `mappings[0]` — both pick the first mapping *arbitrarily* — and a file
named `mapping-imap-dav.json` sorts BEFORE `mapping.json`. Every
apply-deletion and verification assertion would have silently retargeted and
started passing or failing for reasons unrelated to what it tests. Caught by
reading the helpers first. `assertSingleMapping` now states that assumption
instead of leaving it implicit, so the next person to reach for a second
mapping is told rather than misled.

The second was a root-level e2e that imported `buildDeps`. It compiled, it
passed locally, and `test/e2e/no-workspace-imports.unit.test.ts` refused it:
`test/e2e` is not inside a workspace package, so pnpm links no `@openmig/*`
there and the import would have died on the runner with
`ERR_MODULE_NOT_FOUND` — while `tsc` and `tsx` both resolved it locally
through tsconfig paths. **A test that passes here and dies on the Spark is
worse than no test**, and the only thing standing between that and a merged
pull request was a guard written for exactly this. Its second half is the
deeper rule: an e2e talks to a RUNNING appliance over the wire, and pulling
library code into one makes it partly a test of this checkout.

So the coverage lives where library-level questions belong: an INTEGRATION
test, where the workspace is linked and Testcontainers provides a real
Stalwart. It drives the product's own `buildDeps` — so the `case 'imap-dav'`
arm and its environment password resolution are on the path — then confirms
the write with an INDEPENDENT `ImapFlow` client rather than the writer's own
report, and writes a second time to prove adoption rather than duplication, by
count on the server. It runs on **every pull request, on both architectures**,
rather than nightly: strictly more often than the e2e would have.

**And the guard grew the half the O365 correction taught.** A `driven` verdict
that names a test file must name one that EXISTS and that something actually
RUNS — a workflow by path for an e2e, `pnpm test:integration` for an
integration test. "A file mentions O365" was never evidence O365 was tested;
"a verdict names a file" is the same laundering one step later. Proved by
breaking: the named file deleted; a verdict naming a file that never existed;
the verdict moved back to `owed` without the owed list following.

## The drill was quietly filling the disk

Running the new tooling by hand on the Spark showed two backups where there
should have been one: a `-drill` dump from the gate's own run, 14MB
compressed (185MB of SQL). **The drill takes a real backup every pass and kept
every one of them** — about 14MB a night, 5GB a year, on the machine whose
gate is supposed to be near-net-zero (0084). Nobody asked for a dump per
night; the dump is a byproduct of proving the round trip.

Retention is bounded now — `TRIGGER_BACKUP_KEEP`, seven by default, `0` to
keep everything deliberately — and pruning happens AFTER the new dump is
verified, never before: pruning to make room for a backup that then fails
would trade a full disk for no backup at all. Found by a human running the
thing and reading the output, which is the same way everything else today was
found.

## The file that made the argument, and then made the mistake

The section above says, in bold, that a test which passes here and dies on the
Spark is worse than no test. The file it shipped to make that argument did
exactly that, one layer down, and CI caught it on both architectures within
eight minutes of the pull request opening:

```
Error: DATABASE_URL environment variable is required.
 ❯ openLedger packages/orchestration/src/build-deps.ts:152:11
 ❯ buildDeps  packages/orchestration/src/build-deps.ts:183:41
 ❯ imap-dav-target.integration.test.ts:164:20
```

`buildDeps` builds the WHOLE bundle — ledger and cursor store included — even
when the caller only wants a mail target, and its ledger arm falls back to
`process.env.DATABASE_URL` when handed no handle. The Testcontainers harness
publishes its Postgres as `TEST_DATABASE_URL` and never sets `DATABASE_URL`;
that name belongs to a deployed appliance. So `buildDeps(config)` with no
second argument could not have worked, on any run, on any architecture.

**Nothing on the local fast path could have said so.** `tsc` was clean, lint
was clean, and 327 unit files were green — because the unit projects are
container-free by design (0084), so the integration project never runs here
and a missing argument stays invisible until a runner with Docker picks it up.
The same gap that made the e2e mistake possible made this one possible: the
check that would have failed is the one that does not run locally.

The fix is the door that already existed. `LedgerOptions.ledgerDb` is how the
appliance passes its own handle (`apps/selfhost/src/index.ts`), and it is how
this file passes the Testcontainers one — closing it itself, since a handle the
caller supplies is deliberately not closed by `deps.close()`. The tempting
alternative, `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL`, would
have made the symptom vanish and left a mutation of global state behind for
every other file sharing that worker.

**And the class is guarded now, not just the instance** — the lesson from the
nineteen pipeline bugs, applied to my own file this time.
`scripts/an-integration-test-is-handed-its-database.unit.test.ts` reads every
`*.integration.test.ts` in the repository and refuses two shapes: a call to
`buildDeps`/`buildDomainDeps` whose arguments carry no `ledgerDb`, and any
reference to `process.env.DATABASE_URL`. It strips comments before scanning,
because this fix's own prose spells out the wrong form as an example and a
scanner that cannot tell a call from a cautionary tale flags its own
explanation.

Proved by breaking, against the real thing rather than a mock-up: the exact
source CI rejected was copied back into the tree, and the guard named it at
**line 164** — the line the runner named.

## The one dependency that floated

The v4.5.12 upgrade was prepared about as carefully as this repository knows
how. Four places identified and a tool built to move them together. A guard so
dependabot could not move one of them alone again. A backup taken, verified by
decompressing it and reading the SQL, and a restore drill that proves the round
trip on every nightly pass. The queue drained first. And it crash-looped inside
a minute:

```
Code: 80. DB::Exception: Only literals can be skip index arguments. (version 25.5.2.47)
```

Not Trigger.dev. **ClickHouse** — `bitnamilegacy/clickhouse:latest`, a line
nobody had looked at since it was written, in a service the upgrade checklist
never mentions because it is not one of the four places.

**Everything the preparation covered, it covered. It just described the wrong
surface.** `trigger-version.sh list` answers "which Trigger.dev versions can I
move to" precisely and reliably — it probes manifests rather than trusting a
tag list, because that lesson had already been paid for. What it cannot see is
what runs *underneath* Trigger.dev, and the version agreement it enforces spans
four hand-maintained numbers that are all in the same layer. A dependency one
level down, with no number at all, was outside every check by construction.

I told Rob this was "a genuinely low-risk afternoon". That was wrong, and it
was wrong in a specific way worth naming: I assessed the risk of the thing I
had built tooling for. The tooling was good. The estimate covered its blast
radius and called that the whole risk.

**`latest` on an archived repository is the worst of both worlds.** It never
moves, so nothing ever breaks and nothing draws attention. And it never says
where it stopped — `bitnamilegacy` was frozen in August 2025, so `latest` had
quietly meant 25.5.2 for a year, a version whose SQL dialect rejects a
migration the new webapp ships. There was no newer tag to move to; the family
tops out at 25.7.5. The apparent safety of "it's pinned in practice, the repo
is archived" is exactly what made it invisible.

The one part that went right went right for a designed reason: the migration
**failed closed**. It refused, the API crash-looped instead of half-migrating,
and the rollback to v4.5.9 was clean with no restore needed. The backup was not
the thing that saved this. A migration that stops when it cannot proceed was.

### What changed

ClickHouse is `clickhouse/clickhouse-server:26.2.19.43`, pinned **by digest**,
which is what upstream's own `docker-compose.yml` runs for this release — the
only ClickHouse the failing migration has ever been proved against. The
override file moves to `/etc/clickhouse-server/config.d/`, where the official
image reads it, and `ulimits nofile` comes across too, since ClickHouse opening
more files than the default soft limit allows surfaces as errors that look like
corruption.

The environment variables are renamed with the image, and that rename is the
part that would have failed silently. Bitnami reads `CLICKHOUSE_ADMIN_USER` /
`CLICKHOUSE_ADMIN_PASSWORD`; the official image reads `CLICKHOUSE_USER` /
`CLICKHOUSE_PASSWORD`. Carrying the old names across would have started an
instance on DEFAULT credentials while `CLICKHOUSE_URL` and
`RUN_REPLICATION_CLICKHOUSE_URL` — which already interpolate the configured
ones — kept presenting the configured password. A bring-up that comes up
healthy and refuses every query.

The data mount moves to a **new volume**, `clickhouse_data_v2`, and the old
`clickhouse_data` is left on disk (hard rule 2). Bitnami kept its data under
`/bitnami/clickhouse`; pointing the old volume at the official path would hand
ClickHouse a directory laid out by a different vendor. So the first bring-up
starts empty, and what is lost is dashboard task-event history — the event
store is derived from the run records in `triggerdb`, so nothing about running,
deploying or recovering tasks depends on it.

Upstream's `clickhouse-disable-system-logs.xml` comes across too, and it comes
across **now** rather than later for a reason the empty volume creates: with no
accumulated ceiling, ClickHouse's eleven internal log tables start filling a
fresh disk from the first boot, on the same box that holds Postgres, MinIO, the
registry, the task images and the nightly Trigger.dev dumps. That is yesterday's
lesson — the drill quietly filling the disk — arriving from a different
direction, and it is cheaper to bring the file in with the pin than to discover
it at 90% full.

### And the class, not the instance

`bootstrap-managed.unit.test.ts` now reads every `image:` in `managed.yml` and
refuses `latest` or a bare repository name. The rule is deliberately narrow: it
does **not** demand a digest everywhere, because `postgres:18-alpine` and
`redis:7-alpine` fix a major version and take patches on purpose — somebody
made that trade. `latest` is not a trade, it is the absence of one.

**A float that remains is named with its reason rather than allowed in
silence**, the way the connector coverage guard lists what it is owed. There is
exactly one: `bitnamilegacy/minio`. Pinning it recreates the object store
holding Trigger.dev's packets and run artifacts, and the bitnami and upstream
minio images disagree on both data path and environment variable names — a
deliberate change with a restore plan of its own, not a rider on a ClickHouse
fix. The list is asserted **exactly**, so an unlisted float fails and so does a
listed one somebody has since pinned. It cannot rot in either direction.

### The guard that found something while being written

Adding a second ClickHouse config file meant adding a second bind mount, and a
bind mount is another thing nothing checked. **A missing mount source does not
fail** — Docker creates an empty *directory* at that path and mounts that, so
the container starts, the config is silently absent, and the service runs on
defaults. For `clickhouse-override.xml` that means the <16GB-RAM tuning quietly
stops applying on a 16GB box; for `pgbouncer.ini`, a pooler with no
configuration at all.

The guard for that found a missing file on its first run: `pgbouncer/
userlist.txt`. Which is **correct** — it holds the pooler's md5 credentials, so
`ensure-env-secrets.sh` writes it at bring-up and `.gitignore` keeps it out
(hard rule 3). Absence is right; presence would be the bug.

So it takes the same shape as the float list, with one addition worth the extra
five lines: a mount may be absent if it is named as generated, **and every name
must be gitignored**. Without that second half the list is a place to put files
somebody merely forgot to commit. "Generated" is a claim; `.gitignore` is where
this repository records having meant it. It is also checked against
`.gitignore` rather than against the disk on purpose — on a machine that has
run the bring-up the file exists, so "is it there" would pass on the Spark and
fail in CI for the same commit.

Seven mutations, seven caught: ClickHouse back to `bitnamilegacy:latest`;
ClickHouse pinned by version but not by digest; minio dropped from the named
list while still floating; minio pinned while still listed; a float excused
with a five-character reason; the new config file left uncommitted; and a
committed file relabelled as generated without a `.gitignore` entry.

The honest summary is that a year-old line in a compose file beat a day of
tooling, and the only reason it cost an afternoon rather than a weekend is that
the migration refused to half-finish.

## The float that was named, and therefore fixed

`bitnamilegacy/minio` sat in `NAMED_FLOATS` for exactly one commit. That list
was built so a remaining float would be a **debt somebody could see** rather
than a line nobody had looked at since it was written — and the entry had been
in the repository for under an hour before Rob read it and said take it along.
That is the whole argument for naming things instead of allowing them
silently, demonstrated faster than expected.

**And `latest` here told a slightly worse lie than ClickHouse's.** ClickHouse's
was frozen: bitnamilegacy stopped publishing, and `latest` stopped with it. But
`bitnamilegacy/minio:latest` stopped moving on **2025-07-03** at `2025.5.24`,
while that same repository went on publishing until **2025-08-19** and ends at
`2025.7.23-debian-12-r5`. So `latest` was not even bitnamilegacy's last word —
it quietly stopped six weeks before the lights went out, and pointed at a build
two versions behind the final one. "It's archived, so `latest` is effectively
pinned" was wrong twice over: it does not tell you *where* it stopped, and it
does not even stop where the repository does.

The pin is deliberately to **what was already running** — `2025.5.24-debian-12-r5`
by digest, the exact bytes `latest` resolved to. It changes the NAME of what
runs and not the thing itself. That is the right shape for a de-floating
commit on a service holding Trigger.dev's packets: recording what you have is
not the same act as changing it, and doing both at once would have hidden which
one moved. `2025.7.23` and upstream's `minio/minio` are both real options and
both are somebody's deliberate next decision.

**Upstream's is emphatically not a tag swap**, and the four things it needs are
written down in `docs/managed-bring-up.md` rather than discovered at bring-up.
The one that would bite hardest is the third: `MINIO_DEFAULT_BUCKETS` is a
bitnami convenience that does not exist upstream, and it is what creates the
`packets` bucket. Upstream uses a separate `minio-init` service running
`mc mb`. Miss it and MinIO comes up **healthy** while every packet write fails
— the same shape as the ClickHouse credential rename, and the reason both are
recorded as prose and not left to whoever tries it next.

Proved by breaking, three ways: minio back to `:latest` with the excuse list
now empty; minio re-listed as a float after it had been pinned; and — the one
that proves the rule stayed narrow rather than creeping — minio pinned by
VERSION with no digest, which must **pass**, because the rule is "no `latest`",
not "digest everywhere". A guard that quietly widened its own remit would be a
different guard than the one that was argued for.

## One stack, two `.env` files, and an afternoon

The ClickHouse pin went to the Spark and the bring-up stopped dead at the
identity provider. Five minutes of nothing, then:

```
!!! the identity provider never became ready (300s)
    initialize ZITADEL failed: failed to connect to `user=zitadel database=zitadel`:
    failed SASL auth: FATAL: password authentication failed for user "zitadel" (28P01)
```

For a password nobody had changed. The failure table's entry for that message
blames a volume collision, and it was not that — Zitadel's ADMIN credentials
had just worked, three log lines earlier, on `verify database` / `verify grant`
/ `verify zitadel`. A stranger's volume would have failed those too. Only the
`zitadel` role's own password was refused.

**The cause was that the Spark runs ONE managed stack and had TWO `.env` files
describing it.** `managed.yml` pins `name: ownpace-managed` and every service
carries a fixed `container_name`, both global to the host — so the operator's
checkout and the nightly gate's checkout drive the very same containers,
volumes and ports. But the gate's checkout cannot keep a `.env` at all
(`actions/checkout` runs `git clean -ffdx` before every run, and `-x` reaches
ignored files), so the workflow restores one from
`~/.persistent/ownpace-managed/`.

That restore was a workaround for a checkout that cannot hold secrets. Nobody
decided it should become a second configuration; it became one by sitting
there. The role's password matched the gate's copy. The hand-run bring-up
presented the other. Whichever ran last won, and the loser got an
authentication failure naming a credential it had never touched.

The same divergence had already produced a quieter symptom nobody chased:
`ZITADEL_PAT_EXPIRY` in one file said `2026-08-31T14:35:20Z` while the
provisioning token in the database expired at `07:02:53` — the file's own
account of a credential, one rotation out of date.

### I fixed the wrong layer first

I read the 28P01, produced an `ALTER ROLE` to point the role at the operator's
`.env`, and it worked. It was also close to the wrong thing to do: the role's
password was not corrupt, it was **correct for the other consumer**, and I had
just pointed the shared stack at whichever file happened to be in front of me.
The gate would have failed that night exactly as the operator failed that
afternoon.

I knew the persisted `.env` existed — it is in this very workplan, several
sections up — and did not think to compare the two before handing over a
repair. Reading an error and producing a plausible fix for it is not the same
act as understanding which of two things is wrong.

### The fix is one file, and one write that respects it

The canonical `.env` lives in the persist directory; the operator's checkout is
a **symlink** to it. Then divergence is not discouraged, it is impossible.

Which puts all the weight on `env-upsert.sh`, because its write is
write-temp-then-rename and **`mv -f tmp link` replaces the link with a regular
file**. One upsert — `TRIGGER_CLI_PROFILE`, a rotated PAT expiry, anything —
and the two files are separate again, silently, with the canonical one quietly
orphaned. It resolves the link first now, which also keeps the rename on one
filesystem and therefore atomic. Proved by running the real script against a
real symlink, and by running the pre-fix version to watch it fork.

Three things now say it early rather than after a timeout:

- **The divergence is named at the top of every phase** — from `load_env`,
  which every `--from …` resume passes through, because the failure arrived on
  `--from trigger` and `--from app` and a preflight-only check would have
  missed the day it was written for. Key names only; the values are secrets.
- **The role's password is asked before the container starts**, between
  `up_wait postgres` and `up -d zitadel`. The same question Zitadel is about to
  ask, one second instead of three hundred.
- **A note, not a refusal.** During a gate run the checkout's copy legitimately
  moves ahead — `setup-zitadel.sh` writes into it and the workflow persists it
  back — so refusing a mid-run difference would break the mechanism that keeps
  them in step.

### And the profile nobody could guess

The same afternoon, one phase earlier: the `login` phase refused with "run
`login --profile openmig`". The operator *was* logged in, as `ownpace`. They
ran the printed command, watched it succeed, and were refused again — because
the script kept asking about `openmig`, which is pre-rename branding
(ADR-0040), and **nothing anywhere said the name was a setting**.
`TRIGGER_CLI_PROFILE` was not in `managed.env.example` either.

`openmig` stays the default deliberately: the gate's runner may be logged in
under it, and moving the default silently would strand that instead of fixing
this. What changed is that both refusals — `bootstrap-managed.sh` and
`deploy-tasks.sh`, which was carrying the identical omission — now name the
variable, list the profiles the machine **is** logged in under, and offer the
`env-upsert` line that points at one.

### Two things caught while writing the fix

`pasteable-hints.unit.test.ts` refused my repair message. It printed
`$POSTGRES_USER` and `$POSTGRES_PASSWORD`, which exist inside `ownpace-db` and
not in the operator's shell — the shape that guard was written for, twice. It
worked in the message I had sent by hand only because a `set -a; . .env` line
came first. Rather than argue with a guard that is right in general, the remedy
became a script: `zitadel-db-password.sh`, which checks by default, syncs on
`--sync`, and **proves the change** by re-authenticating afterwards rather than
trusting that a command exiting 0 achieved the thing.

And one of my own new tests was vacuous. "load_env checks for divergence"
searched from `load_env() {` to the end of the file and found the *definition*
of `note_env_divergence` further down — so it passed with the call deleted.
Caught by mutating the script it guards, which is the only reason to mutate:
five mutations, four caught, one that revealed the test rather than the code.

## What build is this?

Every support conversation starts with that question, and until now the only
thing that could answer it was `GET /version` — which nobody looking at a
screen was going to curl. The app's sidebar and the public site's footer now
say it, quietly, in the smallest type on the page.

**Most of it already existed**, which is worth recording because the instinct
was to build a subsystem. `buildIdentity()` in `packages/core` already read
`OPENMIG_VERSION` / `OPENMIG_COMMIT` with a fallback to the root
`package.json`; the api and selfhost images already took a `GIT_SHA` build
argument; both editions already served `/version`. What was missing was the
display, and one build argument the web image never received. Reading before
writing turned a subsystem into a hundred lines.

### Two answers, because one of them can be wrong

A bundle can only ever report the version it was BUILT from. On this stack the
UI and the API are separate containers with nothing making them move together,
so `docker compose up -d api` without `web` leaves a stale bundle in front of a
newer server — and a single number captioned "the version that is running"
would then be a status that does not belong to the thing that happened
(hard rule 10).

So the UI reports its own build, asks the server for the server's, and shows
**both, but only when they disagree**. Agreeing is the ordinary case and it
says so once: printing two identical strings every time trains the reader to
stop looking, which is exactly when a mismatch would slip past. The likelier
stale-bundle shape is the same release at a different commit, which is why the
comparison includes the commit and not just the version.

**An unstamped build renders nothing at all** — not `v0.0.0`, not `unknown`.
A stamp that invents a number is a wrong answer wearing the clothes of a right
one; an absent line at least prompts the question. `buildIdentity()` still
answers `unknown` to its own callers, so the UI treats that word as "no
answer" rather than rendering it.

### One number, one file

The version comes from the monorepo root `package.json` everywhere: the app's
bundle (stamped by `vite.config.ts`), the site's footer (read by `build.mjs`),
and the server (`buildIdentity()`'s fallback). `site/` still imports no
workspace package — reading one JSON at build time is not a dependency, and
`@openmig/core` for a version string would have been.

`scripts/what-build-is-this.unit.test.ts` refuses a second copy, and it does it
by searching for the ACTUAL current version string rather than anything
semver-shaped: precise instead of clever, because a regex over version-looking
literals would trip on every dependency pin and teach people to work around the
guard. It also checks the half that cannot come from a file — that every image
building a bundle takes `GIT_SHA` **before** the `RUN` that consumes it, since
an `ARG` declared after is simply not in scope for it and the bundle ships
unstamped while the Dockerfile looks right.

Proved by breaking, three ways: `ARG GIT_SHA` moved below the build; a
component hardcoding today's version; and `managed.yml` no longer passing the
argument to the web image.

### Two things the work turned up

**A partial mock is a trap that springs later.** Six test files mock
`services/edition` with only the one function they happened to need. Adding a
sidebar element that imports `operatingBaseUrl` broke twenty-seven tests in two
of them with "No export is defined on the mock" — not because the component was
wrong, but because a hand-written stand-in for a module goes stale the moment
the module is used differently. Fixed by completing the two mocks that render
`Layout`; worth knowing that the next import will do it again.

**And the comment-stripping lesson had to be learned twice in one day.** This
guard flagged `site/build.mjs` on its first run — for a doc comment describing
what the stamp looks like, which naturally used today's real version. The
integration-test guard written that same morning had needed exactly the same
treatment for exactly the same reason. Prose is not code, and a scanner that
cannot tell an example from a value flags its own explanation.

## The tests that filled the disk

The development box ran out of disk. Not the managed stack, not a runaway
container: **29GB of `/tmp/openmig-*` directories left behind by the unit
suite**, one `mkdtempSync` at a time.

Everything about finding it was harder than it should have been. `pnpm vitest
run` reported **235 test FILES failing to collect** — errors about ports, about
undefined properties, about nothing recognisable — and the actual message was
one line among them:

```
Error: ENOSPC: no space left on device, write
```

A disk that is full does not fail like a disk that is full. It fails like the
code is broken, which is where twenty minutes went before `df` got run.

### Twelve files, none of them cleaning up

`mkdtempSync` with no matching `rmSync`. Not a subtle leak: three of the files
had **no teardown hook at all**, and a PGlite data directory is 41MB. Measured
before the fix: **24 directories, 322MB, per run**. After: **zero**.

**It is not only a laptop problem.** `unit-tests` and `integration-tests` run
on the SELF-HOSTED runner for pushes to main — the same Spark the managed stack
needs ~15GB free on. Five merges today would have been about 1.6GB of dead
PGlite databases on the box we spent the afternoon trying to bring a stack up
on.

And that is the second disk leak on that machine in two days. Yesterday it was
the backup drill keeping every dump it ever took (~14MB a night, ~5GB a year).
Two unrelated leaks on one box inside forty-eight hours is a pattern rather
than bad luck: **anything that writes to disk on every run needs somebody to
say when it stops**, and nothing in a green test suite ever says it. A test
that leaks still passes.

### The guard, and the version of it that was wrong

The first rule was "a file that calls `mkdtempSync` must call `rmSync` **in an
`afterEach`/`afterAll`**", and it flagged eight perfectly healthy files. Wrong
twice over:

- `try { … } finally { rmSync(dir) }` inside a test is a good scoped cleanup,
  and there is no reason to demand a hook instead.
- `afterEach(() => rmSync(dir, { recursive: true }))` has **no braced body**,
  so a brace-scanner walks forward from `afterEach(` and reads the OPTIONS
  OBJECT as the hook — finding no cleanup inside `{ recursive: true }`.

So the rule narrowed to what actually went wrong: a file that makes a temp
directory must call `rmSync` **somewhere**, an import alone not counting. A
file that cleans two paths out of three still passes, and that is an accepted
limit written into the guard's own header rather than hidden. **A guard that
cries wolf gets disabled**, and a weaker rule that is right beats a stronger
one that is not.

Proved by breaking: the cleanup removed from one of the fixed files, and the
guard names it.

## The check Postgres never made

The preflight added a few hours earlier — the one whose whole point was that a
`zitadel` role and a `.env` out of step should cost a second rather than five
minutes — ran on the Spark and said:

```
 ✔ Container ownpace-db Healthy    the zitadel role accepts the password in .env
```

Three hundred seconds later:

```
initialize ZITADEL failed: failed to connect to `user=zitadel database=zitadel`:
172.23.0.9:5432 (postgres): failed SASL auth:
FATAL: password authentication failed for user "zitadel" (SQLSTATE 28P01)
```

Both statements are about the same role, the same password and the same
database, thirty seconds apart, and exactly one of them was produced by asking
Postgres.

### `trust`

`docker exec ownpace-db psql -U zitadel` connects over the **Unix socket**. The
official Postgres image runs `initdb` without `-A`, so the generated
`pg_hba.conf` opens with `local all all trust` and `host all all 127.0.0.1/32
trust`; the entrypoint then *appends* `host all all all scram-sha-256`. A
connection over the socket matches the first line and is let in without the
password being sent, let alone checked. `PGPASSWORD` might as well not be set.
Zitadel, arriving from its own container on `172.23.0.9`, matches the last
line, and that one asks.

So the check succeeded with a password the server would refuse. It was not a
check at all — it was a connection, wearing a check's message. That is hard
rule 10 (**a status must belong to the thing that happened**) violated by the
code written to enforce it.

And it was worse than useless, because the same vacuous pass sits at the top of
the repair:

```bash
if out="$(docker exec … psql …)"; then say "…nothing to do"; exit 0; fi
```

`--sync` never reaches its `ALTER ROLE`. The one command that fixes this
refused to run, on the grounds that there was nothing to fix. **A wrong check
does not merely fail to help; it disables everything downstream of it.**

### It was written down thirty lines away

`deploy/compose/managed.yml`, in its header, since **2026-07-25**:

> …every app-tier connection failed with "password authentication failed"
> despite .env, the container's own POSTGRES_PASSWORD env var, and a
> local-socket/127.0.0.1 psql check all agreeing (the latter two are trusted by
> Postgres's default pg_hba.conf and **never actually check the password** —
> only a connection from another container's real IP exercises the
> scram-sha-256 rule and exposed this).

Same file. Same failure. Same box. Written about the `openmigrate` role, thirty
lines above the `postgres` service that the `zitadel` role lives in. I read that
file to pin the ClickHouse digest, and to add `GIT_SHA`, and did not carry the
paragraph down to the role I was writing a credential check for.

A comment cannot make anyone read it. So the knowledge is now a test —
`scripts/the-check-postgres-never-made.unit.test.ts` — which scans every shell
script under `deploy/` and `scripts/` for a `psql` carrying `PGPASSWORD`, and
refuses any that has no `-h` at a non-loopback address. It fails on the exact
command that shipped, and names the file and the line.

`-h 127.0.0.1` is in the rule deliberately: it is the fix one reaches for
first, it looks like a real TCP connection, and it is trusted by the very same
`pg_hba` line as the socket. It changes nothing.

### What changed

- Every query in `zitadel-db-password.sh` goes to the container's own
  non-loopback address, resolved by asking the container. If it cannot resolve
  one it **exits 2 and does nothing** — a fallback to the socket would be the
  detector reintroducing the defect it detects.
- That resolution sets a global rather than returning through `$( )`, because
  `exit 2` inside a command substitution leaves only the subshell, and the
  caller would have carried on with an empty `-h` — which is the socket. The
  bug's own shape, one layer down.
- The passing message now names the channel: *asked over 172.23.0.9:5432, the
  way Zitadel asks — not the socket*. A status that says how it was obtained is
  one you can argue with.
- Three exit codes, not two: **0** accepts (or nothing exists yet), **1**
  refuses, **2** could not be established. Collapsing 1 and 2 is how an
  operator gets sent to `ALTER ROLE` for a Postgres that was still starting.
- `bootstrap-managed.sh` no longer carries its own copy of the query. There
  were two, they were identical, and they were identically wrong — fixing
  either alone would have left the other still lying. It calls the script now,
  which is also the script its refusal tells you to run.
- The `ALTER ROLE` doubles quotes in the password literal. There is no
  parameter form of `ALTER ROLE`, and the failure mode is setting a *different*
  password than `.env` holds and then reporting success — this class again,
  one step further along.

### A guard from this morning caught the fix

`first_routable_address` was written as `grep … | head -1`, and
`scripts/no-pipeline-its-own-consumer-can-kill.unit.test.ts` — written earlier
the same day, for an unrelated failure — refused it before it could be
committed. `head` closes the pipe at the first line, the still-writing `grep`
dies of SIGPIPE, and under `pipefail` the function returns 141 having produced
the right answer. `awk 'NR==1'` reads to EOF and does not.

That is what a guard for a *class* buys that a fix in one file does not: it
caught a shape in code written hours after it, by someone who knew about the
rule and wrote the bug anyway.

### The shape of it

Every real finding today came from something that **counted what was actually
there**: the leaked directories, the token table's one row, the two `.env`
files differing in one named key. This one is the same lesson stated in the
negative — a check that cannot come back negative is not counting anything.
The question to ask of any green check is not "did it pass" but **"what would
have made it fail?"** For this one the answer was *nothing*, and it took a
five-minute timeout and a crash-loop to say so.

## A version you can see before you sign in

> "I don't see a version on the front app page 'Aanmelden bij Ownpace'?"

The stamp shipped three days ago in `Layout`'s sidebar. `Layout` mounts only
under `ProtectedRoute` at `/`. So the answer to *what build is this?* was
rendered exactly where somebody had already signed in, and nowhere on the four
routes that live outside the shell: `/login`, `/auth/callback`,
`/request-access`, `/invitations`.

Everything else about it was working. `GET /version` returned
`{"version":"0.1.0-rc.1","commit":"72a78d4…"}` — the exact merge commit of
#539 — and the bundle was stamped too: `vite.config.ts` reads `GIT_SHA` into
`import.meta.env.VITE_COMMIT`, `managed.yml` passes `GIT_SHA` to the web build,
and the bring-up exports it from `git rev-parse HEAD`. The whole chain held.
The one place nobody could look was the page everybody looks at first.

That is worth saying plainly, because "show the running version in web, site
and the API" read as done and was: three surfaces, each stamped, each tested.
The question the task never asked was **who is looking, and where are they
standing when they ask.** An operator diagnosing a stack, a person answering an
invitation, somebody asking for access — none of them are past the sign-in
page, and all of them are the ones who need the number.

### The rule, not the page

`Login`, `RequestAccess` and `Invitations` now render their own `<BuildStamp />`.
`AuthCallback` does not, and is exempt by name in the guard with its reason: it
renders for the length of one token exchange and then navigates, so a version
line nobody can finish reading is noise.

`scripts/a-version-you-can-see-before-you-sign-in.unit.test.ts` reads
`AppRoutes.tsx`, takes every page rendered before the single `<Layout />`, and
requires a stamp or an exemption. It asserts there is exactly one `<Layout />`
— the split has no meaning if a second one moves the boundary silently — and it
asserts `Login` is in the list it found, so a refactor cannot satisfy the rule
by removing the case that motivated it.

Proved by breaking: the stamp removed from `Login.tsx` fails both the route
rule (naming the page and what to do) and the component test that renders the
page and looks for the line.

## The test site sent people to production

> "the www.ota webpages have links to production. that should never happen!
> https://app.ownpace.eu/request-access?locale=en&tier=Small"

Every *Request access* button on `www.ota.ownpace.eu` pointed at the production
app. A click there does not put a test visitor on a test form — it files a real
access request against the real tenant, from the one site whose entire purpose
is to not be real.

### The mechanism was already there

`site/prices.mjs` read `OWNPACE_APP_URL`, and its own comment already said to
set it for the OTA build. What defeated it was one line:

```js
process.env.OWNPACE_APP_URL || 'https://app.ownpace.eu'
```

defended, in the comment directly above it, as:

> production is the default because a forgotten variable should land on the
> safe side of that boundary rather than the surprising one.

That reasoning is backwards, and this is the day that showed it. **The build
that forgets is by definition the one whose value is not the default.** A
production build with no variable set produces the right site by luck; an OTA
build with no variable set produces a site that hands its visitors to
production — silently, because a wrong link renders exactly like a right one.
Production is not the safe side of an environment boundary. Neither side is.
Being told is.

So there is no default now, and the build refuses without one, naming both
commands. Two guards keep the refusal meaningful:

- **Nothing in the site hardcodes an environment host** — every absolute app
  link comes from `APP_URL`.
- **A site built for one environment contains no link to another.** Built for
  OTA in a child process, the output must contain the OTA link and zero
  production links; built for production, the reverse. Not "never say prod":
  the production build has to work too.

### Two things caught while writing it

**The rule flagged its own refusal message.** The first version of the
hardcoded-host scan reported three offenders, and two of them were the lines in
the refusal *telling an operator what to set* — the opposite of hardcoding a
link. Narrowed to ignore any line that also names `OWNPACE_APP_URL`, with the
limit written into its header. Same lesson as the temp-directory guard eight
hours earlier: **a guard that cries wolf gets disabled**, and a narrower rule
that is right beats a broader one that is not.

**`Tests  no tests` is not a pass.** The builds ran while collecting the
describe blocks, so restoring the old default made the whole file fail to
*collect* — and vitest printed `Tests  no tests`, which on a dashboard is
indistinguishable from a file that ran clean. Moved into the test bodies, the
same break names four tests. Work that can fail belongs where a failure has a
name — which is the day's other lesson, arriving from a third direction.

## The mount that went blind, and a guard that could not fail

Republishing the site made it disappear. `www.ota.ownpace.eu` served `200` at
19:49 and `403` from 20:20, with every file present and correct on disk the
whole time.

```
2026/08/24 20:20:36 [error] directory index of "/usr/share/nginx/html/" is forbidden
$ docker exec ownpace-www ls -la /usr/share/nginx/html
total 0
```

`site/build.mjs` began with `rmSync(DIST)` followed by `mkdirSync(DIST)`. That
replaces the directory, and therefore its **inode**. A bind mount resolves to an
inode when the container starts, so the running nginx went on holding the old,
now-unlinked one: empty from inside, complete from outside, and a 403 that reads
exactly like a permissions problem.

**And I had documented the opposite.** `www.yml`'s header, in my own words from
the PR eight hours earlier:

> re-publishing is the build command above and nothing else — nginx serves from
> the mount, so no restart is needed.

A property of the mount asserted without looking at what the build did to the
directory. The same shape as the credential check that opened the day: the
right-sounding claim about a mechanism nobody had read.

The fix is not to document the restart. It is to make the sentence true —
`emptyDist()` clears the contents and keeps the directory — and to put the
mechanism *beside* the promise in the header, so that whoever changes one meets
the other.

### The guard that passed with the bug restored

First version: `statSync(DIST).ino` before the build, again after, compare. It
passed with `rmSync(DIST)` deliberately put back.

Nothing held a reference to the removed directory, so the filesystem handed its
inode **number** straight back to the `mkdir` that followed. The comparison was
true and meaningless — a guard that could only answer yes, which is the exact
defect of the socket credential check ten hours earlier, arriving again in the
test written to prevent that class.

An open directory fd is what a bind mount *is*. It pins the inode so the number
cannot be recycled, and `fstat(fd)` against `stat(path)` is the comparison nginx
makes without knowing it. With that, restoring the bug fails three tests instead
of one.

**Ask of every green check: what would have made it fail?** Twice in one day the
answer was *nothing*, and both times the check looked completely reasonable.

### Two switches that both named the environment

The build already had `--public` (noindex, `robots.txt`). Making
`OWNPACE_APP_URL` required earlier the same day added a **second** way to say
which environment a build is for, and nothing compared them:

- `--public` with the test app: an indexable production site whose every call
  to action leads somewhere private.
- no `--public` with production: the reported bug itself.

Both built happily. Requiring the variable stopped the *silent* case; it left
the *contradictory* one. `build.mjs` refuses both now, comparing against
`PUBLIC_APP_URL` — production named exactly once, in the file the check reads,
which the hardcoded-host rule now asserts rather than merely exempts.

A third incoherence went with it: a `--public` build printed *"Every placeholder
must be filled"* and *"MUST NOT be published publicly"* **about the same build**,
and published anyway. `must be filled` is now enforced where it is claimed.

## Nothing else writes the `.env`

"will the one `.env` survive other features, upgrades, other work we do? are
there safeguards?" — a better question than it looks, because the honest answer
was *no, and it would have failed silently on the next feature that needed a
secret*.

Three things did protect it: `env-upsert.sh` resolves the link before writing
(driven against a real symlink by its own test), the bring-up lists diverging
key names at the top of every phase, and the `zitadel` role check catches the
worst consequence in a second. What none of them covered was **a second
writer** — and there was one.

`ensure-env-secrets.sh`:

```bash
sed -i "/^${name}=/d" "$ENV_FILE"
echo "${name}=$(generate "$name" "$bytes")" >>"$ENV_FILE"
```

GNU `sed -i` writes a temp file and renames it over its target, and without
`--follow-symlinks` the target is the **link**. Measured rather than reasoned
about:

```
$ ln -s real.env link.env          # real.env: A=1 B=2
$ sed -i '/^A=/d' link.env
link.env   NOW A REGULAR FILE, holding B=2
real.env   UNTOUCHED, still A=1 B=2
```

So not merely a broken link: the canonical file left **stale** while the
checkout carries a fork nobody can see. Precisely the failure that cost the
afternoon, arriving through the script that generates the credentials.

**And it was invisible by construction.** `ensure()` returns early when a key
already holds a real value, so an established `.env` never reached the write.
The link would have survived every ordinary bring-up — every `--from app`,
every upgrade, every gate run — and died on the first feature that added a new
required secret. Which is the day nobody would think to check a symlink.

### What changed

- Both writes go through `env-upsert.sh`. It resolves the link, replaces the
  key **where it already is** rather than moving it to the end, and is the one
  writer with a test that drives it against a real symlink. Both generators
  produce `[0-9a-f]` plus `Aa1_`, so nothing trips its value rules.
- `scripts/one-stack-one-env.unit.test.ts` refuses `sed -i` or `mv` aimed at
  the live `.env` anywhere under `deploy/compose/`, and **runs `sed -i` against
  a real symlink** to show the reason rather than assert it. `>` and `>>` are
  deliberately not flagged: redirection opens *through* a link and writes the
  target, which is why `touch` and bootstrap's `cp` of the example are safe.
- The divergence note now speaks when the two files still **agree**. It used to
  return silently while every key matched — so the warning arrived after the
  damage rather than before it. Two files describing one stack will drift; the
  point is to hear about it while it is still cheap. Quiet under CI, where
  `git clean -ffdx` makes a symlink impossible and the advice would be
  untakeable — a warning nobody can act on is how a real one gets tuned out.

### The rule the day keeps producing

The first version of the `sed -i` scan flagged `trigger-version.sh` rewriting
`managed.env.example` — a tracked repo file that is never a symlink and is
`sed`-ed entirely correctly. Narrowed by requiring a `/` before `.env`, which is
what separates the live file from the example. **Third guard today to cry wolf
on its first run**, and the third to end up narrower and right rather than
broader and wrong.

## A service nobody ever started, twice

`docker ps | grep own` on the Spark had no `ownpace-status` in it. The status
page was in `managed.yml`, had `STATUS_PORT` in `managed.env.example`, a section
in `docs/managed-bring-up.md` stating it **"starts with everything else"**, and
a whole `status-page.md` of its own.

`grep -c '\bgatus\b' deploy/compose/bootstrap-managed.sh` → **0**.

Named nowhere. No bring-up had ever started it, and the documentation had been
saying otherwise since the day it was written.

**This is the second time.** `zitadel` was added in #496 and left out of the same
list: for three weeks every compose command had to satisfy `ZITADEL_MASTERKEY`
for a container that did not exist, E2E (managed) #34–#36 died on it, and the
nightly said nothing whatsoever about whether anybody could sign in.

Neither was a typo. It is what happens when the file that DEFINES the stack and
the file that STARTS it are two files nothing compares. So they are compared now.

### A deliberately weak rule

`scripts/every-service-somebody-starts.unit.test.ts` asks only whether the
bring-up **mentions** each service by name — not whether it starts it correctly,
in the right phase, with the right flags. A stronger rule would have to model
`up_wait`, the phase list, `--with-demo` and `--from`, and **a guard that models
its subject is a guard that goes stale.** "Named nowhere at all" is exactly the
shape both failures had, and it is cheap to be certain of.

One exemption, with its reason in the source: `zitadel-machinekey`, a one-shot
`run` that chowns a volume rather than a service to start. The rule also asserts
every exemption still names a service that exists — an exemption for something
deleted is a comment claiming a decision nobody is making.

The scan stops at the next top-level key, because a naive two-space-indent read
takes `ownpace-network` for a service and then demands the bring-up start a
network. That case is in the tests.

### And what starting it revealed

Turning a service on for the first time is its own kind of test. Two things
about the status page could not be seen while it never ran, and both would have
shown **red lamps on a healthy stack** — which corrodes trust in a status page
exactly as fast as a green one that means nothing, a point `gatus.yaml`'s own
header makes about the other direction.

**It would have probed itself.** `STATUS_WEB_URL` defaults to `WEB_URL`, and the
shipped default is `http://localhost:3123`. The probe runs INSIDE the gatus
container, where `localhost` is gatus and nothing serves 3123. Web app, API,
Database, Sign-in: four reds, on a stack that is fine.

`WEB_URL` cannot simply change — the issuer, the redirect URIs and the grant
email all read it, and it has to stay the address a **browser** uses. So
`STATUS_WEB_URL` is overridable now, still defaulting to `WEB_URL`, and the
bring-up says so when the effective value is a loopback one. It names the fix
and says why `WEB_URL` must stay put, because "set it to something else" without
that sentence is advice that breaks sign-in.

**And the field names had never been compared.** gatus reads `[BODY].database`
and `[BODY].signIn` from `/api/ready`. They match — but nothing checked, and a
rename on either side is a red lamp nobody could explain. Every `[BODY].x` in
`gatus.yaml` must now name a field `ready.ts` answers with.

Both are run rather than read: the first is a `case` over four URL shapes, the
second a pair of names in two files. Proved by breaking — dropping `127.0.0.1`
from the case, and renaming `signIn` to `signin` in the config.

### The same shape, one file over

`${FOO:?message}` in `managed.yml` means compose refuses **every** command —
`up`, `ps`, `config`, `logs` — until FOO is set. A fresh `.env` is a copy of
`managed.env.example`, so a `:?` variable the example does not carry and
`ensure-env-secrets.sh` does not generate makes a new machine unbringable-up,
with an error naming a variable nobody has heard of. That is exactly what
`ZITADEL_MASTERKEY` did for three weeks.

Nothing compared the two. There were per-variable assertions — `ZITADEL_PORT`
here, `TRIGGER_IMAGE_TAG` there — each added by whoever got bitten, which is **a
list of past incidents rather than a rule.**

The rule now exists, and it currently finds nothing: all twelve required
variables are satisfied. That is worth saying plainly — it is a guardrail, not a
repair. It is here because the next service added with a required variable is
the one that would have found it the expensive way. Proved by breaking:
`WEB_URL` renamed in the example fails it by name.

## A knock that reaches somebody

> "i filled in the request access, but did not receive mail."

Two independent reasons, and the transport was neither of them.

**Nothing emailed anyone when a request arrived.** `POST /api/access-requests`
inserted the row, wrote one log line, returned 201. The notification kinds were
`decision_raised`, `runs_failing`, `verification_finished`,
`migration_finished`, `rollback_finished`, `access_granted`,
`access_declined` — **no `access_requested`**. Mail went out when a request was
*answered*, never when one *arrived*. The queue page was the intended channel,
which works exactly as well as somebody's habit of opening it.

**And no SMTP was configured**, so even a grant would have come back
`notified: "off"` — which the route did report honestly rather than pretending.

### Why not the host's `mail`

The suggestion was the crontab line that already works on that box. The API runs
inside a container: no MTA, no `mail`, no host access. But the testing worry
attached to the question pointed *toward* wiring mail rather than away, just not
at a real mailbox.

**Mailpit, a catcher, in the stack.** It accepts everything on 1025 and delivers
nothing outward.

- Every mail the product sends is **visible**, in a browser, on the box.
- The mail path becomes **assertable** — nothing verified that end of the
  product at all.
- An automated run can **never** reach a real inbox, which a relay cannot
  promise and the nightly gate now needs, because it exercises grant, decline
  and request.

`NOTIFY_FROM` and `NOTIFY_TO` default to `…@ownpace.invalid` (RFC 2606
reserved): if these ever reach a real relay the result is a bounce, not mail to
a stranger.

### The default that would have been quiet

`SMTP_HOST=mailpit` is right for this stack and wrong for a real one, and wrong
in the worst available way: every send reports `sent`, because it **was** sent —
to a server whose job is to keep it. Nobody would hear about a granted account
until somebody asked why they never got the email.

`WEB_URL` already says which kind of deployment this is, so the bring-up
compares the two facts instead of trusting them to agree, and notes when a
catcher is serving an https origin that is not localhost. Same shape as
`--public` against `OWNPACE_APP_URL` in the site build, four hours earlier —
**two settings that both name the environment, checked against each other.**

A note rather than a refusal: a real deployment mid-setup legitimately passes
through this state.

### What the mail carries, and what it does not

Address, organisation, tier. **Not the note** — the applicant's own words about
what they are moving, which is the most useful field on the row and stays in the
database behind authentication, where the queue shows it. An email is forwarded,
archived and searched far more casually than a table is; the same reasoning that
already keeps the name and the note out of the log line (§17).

### Two of my own tests caught being useless

The first version of "sends to NOTIFY_TO, not to the person who asked" asserted
on the **fixture the test itself built**. It would have passed with
`tellOperator` mailing anybody at all. Rewritten to observe the transport, it
fails when the recipient is switched to the applicant.

The bootstrap note is **run**, not read — its condition is three `case` arms and
a string comparison, exactly the kind of thing that reads correct and behaves
otherwise. Six cases, including the two silences that matter: a local stack, and
a real relay already configured.

That makes it three times in one day that a check written to prove something was
found unable to fail. The question is never "did it pass".

### And the assertion that was nearly guessed

The smoke check was going to be skipped: it needs Mailpit's API shape, and
there is no Docker in the environment this was written in. Writing an assertion
against a mechanism nobody had read is exactly what produced the socket
credential check and the inode comparison — so it was left out and said so.

Then read from Mailpit's own source instead of guessed: `GET /api/v1/search`
takes `query`, answers with `messages_count` and a `messages` array whose items
carry **Go field names** — `Subject`, `To`, `Snippet` — because `MessageSummary`
declares no JSON tags. An assertion written against `subject` in lower case
would have found nothing and reported "nobody was told" on a working stack.

So the gate now sends a real request through the real front door and reads the
real mail out of the catcher: the subject must be the knock, and it must be
addressed to `NOTIFY_TO` and never to the applicant. Nothing is deleted — a
smoke that empties the catcher wipes whatever an operator was looking at.

**No gate had ever asserted that this product can send a single email.** The
rendering is unit-tested exhaustively; the wire was never exercised once.

## A knob the tasks can never see

Third instance of the same class in one night, and this one was found by going
looking rather than by being bitten.

Trigger.dev task containers inherit **nothing** from compose. The only way a
value reaches one is `set-task-env.sh` uploading it — which is why that script
exists, and its own header says so: *"a value only in this file and never
uploaded is a value the digest will never see."*

Three variables were read by tasks and uploaded by nobody:

| | |
|---|---|
| `LEDGER_RETENTION_DAYS` | `retention.ts` calls it the operator override, and on managed there was nowhere to put it |
| `TRIGGER_API_URL_IN_NETWORK` | the escape hatch beside the compose-network default that makes due ticks work at all |
| `LOG_LEVEL` | raising a task's logging was impossible |

**Each has a working default, so nothing was broken.** What was broken is that
*setting* them did nothing, silently — and that is the worse of the two
failures. A knob that is missing gets reported. A knob that is ignored gets
believed.

All three upload now, only when set, exactly as `SMTP_*` already did — so an
empty `.env` behaves precisely as before. `managed.env.example` documents them
under a heading that says why they need uploading at all.

### The rule, and what it cannot see

`scripts/a-knob-the-tasks-can-never-see.unit.test.ts` reads every
`process.env.X` in `apps/worker/src/jobs/*.ts` and requires each to be uploaded
or exempted by name — `TRIGGER_SECRET_KEY` and `TRIGGER_API_URL` are injected by
the platform, `TEST_DATABASE_URL` comes from testcontainers.

The limit is in the header: a variable a job reaches **through a package** is
invisible to it. `LOG_LEVEL` is exactly that, found by hand and not by the rule.
Widening the scan means resolving the import graph, and a guard that models its
subject is a guard that goes stale.

### The matcher that was wrong twice, in opposite directions

First version matched `"NAME"` and so missed every **required** variable, which
the upload writes as an unquoted object key — it failed on `DATABASE_URL`, the
one variable every job reads.

The obvious loosening — match the bare name anywhere — would have been worse:
the prose two lines above the list now names all three of the variables this
rule exists for, so the rule would have been satisfied by **its own
documentation**. It matches the two shapes an upload actually takes and nothing
else.

### And an apostrophe that broke the script

The comment documenting all this was written into a `node -e '…'` block — a
single-quoted shell argument. *"the operator's override"* closed the quote, and
`bash -n` reported a syntax error sixty lines further down, near an unrelated
`(`. There is now a rule that the block contains no apostrophe, because a trap
which punishes ordinary English in a file whose every other line is English
deserves a rule rather than a scar.

## Nothing ever parsed the bring-up

Found by rehearsing a merge rather than waiting for one. Five PRs were open and
green against an unmoved `main`; merging them in numeric order, in a scratch
worktree, to see what Rob would hit. Three conflicted, all in the same
harmless-looking way — two branches appending to the same tail.

One of them was not harmless. #546 and #547 each add a `note_*` helper to
`bootstrap-managed.sh` at the same place, and git factors the closing brace the
two sides **share** out of the conflict region, so each side appears to end
without one:

```
<<<<<<< HEAD
note_mail_goes_nowhere_real() {
  ...
=======
note_status_page_probes_itself() {
  ...
>>>>>>> origin/claude/a-status-page-nobody-started
}
```

Delete the three markers and keep both sides — the obvious resolution, and the
one a web editor invites — and the file is one brace short:

```
$ bash -n deploy/compose/bootstrap-managed.sh
deploy/compose/bootstrap-managed.sh: line 1262: syntax error: unexpected end of file
```

Line 1262 is the end of the file, 900 lines below the edit that caused it.
`bash -n` finds it in twelve milliseconds; an eye reading the diff does not.

### The hole that made it worth a guard

**Nothing in this repo had ever handed a shell script to a shell.** `lint` is
ESLint and does not look at `.sh`. There is no shellcheck. Six unit tests do
spawn `bash`, and every one of them passes a `-c` string or one small library —
never the script under test. No test parses `bootstrap-managed.sh` at all: they
all `readFileSync` it and run regexes over the text.

So a syntax error in the 1200-line script that starts the entire managed stack
was invisible to CI, and the first thing that would have noticed is the 05:30
E2E (managed) or an operator's own bring-up. A five-hour feedback loop for a
one-second question.

`bash -n` over all 23 scripts, each judged by the interpreter its own shebang
names. It cannot cry wolf — the judge is the parser, not a heuristic — and an
unrecognised shebang fails rather than skips, because a scanner that quietly
passes over what it does not understand is how a rule ends up covering nothing.

### What it is not

`-n` answers "does this parse". It says nothing about an unquoted variable, a
wrong flag, or a function that does the wrong thing. It is the cheapest
question available and the only one nobody was asking.

### A guard written for the wrong reason first

The first version of this file was a scan for **nested function definitions**,
on the theory that the naive resolution silently defines one helper inside the
other — legal bash, invisible to `bash -n`, and fatal at run time because the
outer helper returns early on any stack with a real SMTP relay.

That theory was wrong, and running it said so: the fixture failed with
`unexpected end of file`, not `command not found`. Removing one brace from a
balanced file leaves it unbalanced; there was never a silently-nested
definition to catch. The guard was deleted and replaced with the one the
measurement justified.

Which is the same lesson as the socket credential check, in the other
direction: that one asserted a mechanism nobody had read, and this one asserted
a consequence nobody had run. **The fixture that fails for the wrong reason is
the cheapest correction available** — it arrives before the guard is pushed
rather than after it is trusted.

### And the rehearsal itself

Merging the five in a scratch worktree needed `node_modules`, and symlinking
the main checkout's was faster than installing. It also resolved
`@openmig/shared` to the main checkout — sitting on `main`, without
`access_requested` — so two of #546's own tests failed against a merge that was
fine. Nearly reported as "the merge broke #546".

A workspace link points at a path, and a second checkout of the same repo is a
different path with the same shape. The shortcut is not available; the real
install takes eight seconds.

With the links right: **4062 unit tests, 15 UI tests, typecheck and lint all
clean** on all five merged together. The conflicts are textual only.

## The mail the api could not send

#546 shipped a mail catcher, an `access_requested` notification, a rendering in
two languages, a smoke that reads the caught message, and documentation for all
of it. It could not send a single email.

`readNotifierConfig` reads `process.env` — `SMTP_HOST`, `NOTIFY_FROM`,
`NOTIFY_TO` and seven more. `managed.yml` lists the `api` service's environment
key by key, and named **none of them**. Compose passes nothing it has not been
told to pass, so the variable an operator sets in `.env` never reached the
process that reads it. `notified: "off"` on every grant, decline and request —
truthfully, and uselessly, because the setting that would have turned it on
could not arrive.

Found by preparing the hand-over summary: checking, rather than asserting from
memory, that "set `SMTP_HOST=mailpit` in `.env`" was advice that would work.

### Why nothing caught it

- The unit tests inject a channel directly (`__setChannelForTests`), which is
  right for testing the three outcomes and blind to how the real one is built.
- `managed.env.example` documents the keys, and the bring-up warns when
  `SMTP_HOST=mailpit` looks wrong for the deployment. Both describe a setting
  that could not take effect.
- **The self-host edition was never affected.** `deploy/selfhost/compose.yml`
  uses `env_file: .env`, so the whole file arrives. Only the managed edition
  enumerates, and only an enumeration can forget an entry.
- The managed smoke *does* assert a mail arrives — in the nightly gate, not on
  a pull request. This would have been a red gate hours after the merge,
  naming the assertion rather than the cause.

### The rule, and what it found on its first run

The two lists are compared directly, both read from the files themselves: the
env names are extracted from `readNotifierConfig`'s own body, so a tenth
setting added there and forgotten in compose fails here rather than in a
bring-up.

It immediately failed on `NOTIFY_DIGEST` — a tenth name I had not put in the
fix, consulted by the same function and missed by the same enumeration. Not
documented in `managed.env.example` either; both are now. **A guard that finds
something on its first run is the only kind worth writing**, and this is the
first one today that failed for a real reason rather than by crying wolf.

### Fifth instance today

After services-vs-bring-up, `${VAR:?}`-vs-example, task-reads-vs-uploads and
gatus-vs-ready. The shape is worth naming: **one file describes a capability
and another enables it, and the product reports the disabled state so politely
that nobody notices.** `notified: "off"` was correct on every occasion it was
printed, which is exactly why it never looked like a bug.

## A healthcheck that could never run

E2E (managed) #77, the first nightly after the whole night's work merged. One
thing red, at the very last step:

```
--- unhealthy ---
ownpace-status
::error::Left unhealthy after the run: ownpace-status
```

Everything else passed. api healthy, mailpit healthy, web healthy, the smoke
green. The only casualty was the service #547 had started for the first time.

```yaml
test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
```

`ghcr.io/twin/gatus`'s final stage is `FROM scratch` — the binary and
ca-certificates, nothing else. No wget. No curl. No shell, so `CMD-SHELL` is
out too. And `main.go` parses no arguments at all, so there is no
`gatus health` subcommand the way mailpit has `/mailpit readyz`. Read from the
upstream Dockerfile and `main.go` at v5.36.0, not assumed — the same discipline
that produced the Mailpit field names, applied to the question "what can this
image actually execute".

**Written in #498 and never once run.** The service was in `managed.yml`, had
its port in `managed.env.example`, a page in `docs/`, and a healthcheck — and
no bring-up had ever started it, so nothing ever asked the healthcheck to
produce a verdict. #547 fixed the not-started half and thereby handed the
never-run half its first execution.

### Third time, same shape

The smoke's issuer probe asked with a `curl` the API image had not got (#517).
The MinIO healthcheck was deliberately NOT written for exactly this reason —
"naming a binary an image may not have is the guess that costs a bring-up".
This one was already in the tree when that sentence was written.

**Starting a service for the first time is its own kind of test**, and it keeps
finding things that reading could not. #547 said that about the self-probe; the
same run proved it about the healthcheck.

### The fix is not deletion

A healthcheck that can never pass is a permanent false negative — worse than
none, because it hides a real one and trains everybody to ignore the lamp. But
removing it and stopping there would leave a started service unchecked.

So the question moves to a side that can answer it: `smoke-managed.sh` probes
`/health` over the published port, from the host, where curl exists. Same
correction as #517 — *ask readiness from the side that can reach the answer*.
It asserts only that gatus is **serving**; whether its lamps are green depends
on `STATUS_WEB_URL` being an address its container can reach, which is the
operator's call and not this gate's.

`up -d --wait` still waits for the container to be running. It simply no longer
waits for a verdict the image cannot produce.

### The rule, and what it deliberately is not

Both halves are pinned: gatus has no healthcheck, and the smoke probes it. Re-adding
a `CMD` here without changing the image fails a unit test rather than the nightly.

The general rule — *every service without a healthcheck is probed by the smoke or
exempted with a reason* — would also cover zitadel, minio, the registry, the docker
proxy and the TLS terminator. It is worth writing when somebody has read what each
of those five images can execute. **Guessing that is how this defect was written in
the first place**, so it stays unwritten and named rather than half-done.

## A healthcheck that asked the wrong address

Found by reading `docker ps | grep unh` on the Spark while chasing a different
unhealthy container. `ownpace-www` had been marked unhealthy every thirty
seconds since **2026-08-20** — five days — and nothing had ever said so, because
`www.yml` is not part of the managed stack and the gate's residue check only
speaks for `managed.yml`.

```
"FailingStreak": 39
"Output": "wget: can't connect to remote host: Connection refused"
```

**Refused, not 404**, and that distinction is the whole diagnosis. The first
theory was an empty `site/dist` — plausible, since that had caused a 403 the day
before. It was wrong: `dist` was fully populated, and an empty one would have
produced a 404 *and* an access-log line. This produced neither, because the
request never reached nginx at all.

Two ordinary decisions meeting:

1. `www-nginx.conf` is bind-mounted onto `/etc/nginx/conf.d/default.conf`
   **read-only**. The base image's `10-listen-on-ipv6-by-default.sh` exists to
   append `listen [::]:80;` to exactly that file, cannot, and says so on every
   start — a line sitting in the log all week:

   ```
   can not modify /etc/nginx/conf.d/default.conf (read-only file system?)
   ```

2. The healthcheck asked `http://localhost/`, and busybox wget resolves
   `localhost` to `::1` first. Nothing was serving there.

`apps/web/Dockerfile` got both halves right *by accident*: it asks
`127.0.0.1:80` explicitly, **and** its config is generated by envsubst into a
writable path so the ipv6 script succeeds. Either alone would have saved it,
which is why the identical-looking service beside it was healthy all along.

### The rule is a conjunction, and that matters

"Never use `localhost` in a healthcheck" would be **wrong**: `nextcloud` in
`managed.yml` asks `http://localhost/status.php` and is genuinely healthy,
because nothing mounts over its config and it listens on both stacks. A rule
that flagged it would be the fifth guard this week to cry wolf on its own first
run.

So the rule is the conjunction — *a service whose nginx config is mounted
read-only has no IPv6 listener, so its healthcheck must name an address that
needs no resolution* — and both halves are read from the compose file. A future
service that mounts a config read-only and asks `localhost` fails in CI rather
than sitting unhealthy for five days.

Its own limit is guarded too: drop the `:ro` and the rule stops covering `www`,
so the scan asserts it still finds it. Losing coverage silently is how this
lasted five days in the first place.

### Two healthchecks, two different lies, one morning

| | what it did | why |
|---|---|---|
| `gatus` | named a binary the image has not got | `FROM scratch` — no wget, no shell |
| `www` | named an address nothing was serving | `:ro` conf → IPv4 only; `localhost` → `::1` |

Both were **written and never once verified against a running container**. The
pattern across the whole night is now unmistakable: *a check is not a check
until something has watched it fail for the right reason.*

## Pages that do not exist, and the page that says whether anything is down

Reported from the live test host:

```
https://app.ota.ownpace.eu/blabla   →  a blank white page, HTTP 200
https://www.ota.ownpace.eu/blabla   →  the landing page,   HTTP 404
```

**Two different lies, and the app's is the worse one.**

The app's nginx does the SPA fallback — `try_files $uri $uri/ /index.html` —
which is correct and unavoidable: the server cannot know which client-side paths
exist without a copy of the route table, and *two files that must agree* is the
failure this repo has spent a week removing. But `AppRoutes.tsx` had no
`path="*"`, so react-router matched nothing and drew nothing. **A 200 with an
empty body is success** as far as every crawler and uptime monitor is concerned.
Neither half was wrong alone; together they answered "everything is fine" over a
blank page.

`www-nginx.conf` said `error_page 404 /index.html;`, so a wrong address served
the **home page** — with the 404 status intact, which is the worst of both: the
visitor sees a working site and concludes their link was fine, while the crawler
is told the page is missing. Two audiences, two wrong answers, one line.

### What the pages say

A 404 on a product that moves somebody's mail has one job before it has any
other: the first thought on an unexpected screen is *has something of mine gone
missing?* So the reassurance is a statement of fact and comes first — "nothing
of yours was lost", "uw migraties zijn ongemoeid" — and the joke is allowed to
be dry. Both are asserted, in both languages, because a reassurance nobody
checks is a reassurance that quietly disappears in a refactor.

The app's page renders **inside the layout**, not instead of it. Somebody who
mistyped a path is still signed in, and taking their navigation away treats a
typo like a session failure.

### The status page finally has a link

gatus has been running since #547 with **nothing pointing at it** — reachable
only by knowing the port. It is now in the site footer on every page, which is
where somebody asking "is it down" already is.

The host is **derived** from `OWNPACE_APP_URL` (`app.` → `status.`) rather than
configured beside it, for exactly the reason `PUBLIC_APP_URL` exists: two
settings that both name an environment drift, and the drift is silent. A test
site linking production's status page answers "is it down" about the wrong
machine — the same class as the production links that reached
`www.ota.ownpace.eu` the day before. It **refuses rather than guesses** when the
host is not an `app.` one, because a wrong status link is worse than none.

`OWNPACE_STATUS_URL` overrides it, which is what the eventual move needs: a
status page hosted on the machine it watches cannot answer the question when
that machine is the problem (docs/status-page.md).

### Sixth guard this week to cry wolf on its own first run

The nginx rule flagged the comment **above** the fix — the one quoting
`error_page 404 /index.html;` as the record of what went wrong. Narrowed to
directives, comments excluded. The tally is now hard to dismiss as coincidence:
a rule written against a file that documents its own history will flag the
documentation unless told not to, every single time.
