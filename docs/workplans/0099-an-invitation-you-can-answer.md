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
