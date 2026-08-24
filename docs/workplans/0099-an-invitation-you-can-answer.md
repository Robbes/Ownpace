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
| T7 A real browser sign-in in the smoke | 📋 **Planned, and honestly not done** | See "what is still owed". |

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

## What is still owed

**T7: the smoke does not drive a real browser sign-in.** It asserts that the
issuer is running and serving the exact document `oidc.ts` and `auth.ts` both
read, that its `jwks_uri` is fetchable, and that the declared issuer matches byte
for byte — and it exercises the invitation logic end to end over real HTTP with
tokens minted from the API's own secret, as every other check in that script
does.

What it does not do is obtain a token FROM Zitadel through the authorization
code flow. That needs its session API and a PKCE exchange, and it was not
written here for a reason worth recording: this environment has no Docker to run
it against and no network access to Zitadel's API documentation, so it would
have been several hundred lines of unverifiable shell against remembered
endpoint shapes — the exact recipe for a confident PR that turns the nightly red
again, two days after 0098 turned it green.

It is worth doing properly, against the live gate, where each step can be seen to
work.

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
