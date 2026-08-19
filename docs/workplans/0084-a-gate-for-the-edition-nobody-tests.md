# Workplan 0084 — a gate for the edition nobody tests

## Status — 2026-08-18 (update this block at the end of every session)

**Built 2026-08-18. HONESTLY GREEN on run #13, the same day.** Run #6 was
green and over-claiming; runs #7–#12 were the argument with it. The gate now
enforces what it always said, and its verdict — read from the run, not
inferred from its colour — is:

```
--- verdict ---
verify: done   apply: applied
SMOKE PASS — evidence in smoke-managed-32189040577.log
```

**It cost nine red runs and it found two product defects on the way**, both in
the apply path this gate exists to cover and neither reachable by review: the
ledger stored every target handle as a string of itself, and an empty handle
aimed a DELETE at the collection root. See run #11 below. Runs #1–#5 each failed at a different step and were fixed by a
separate PR (#457 persist/restore, #458 stalwart-cli, #459 CLI-config restore,
#460 `TRIGGER_ACCESS_TOKEN`). Run #6 passed every step. Reading it against T7
rather than accepting the checkmark found that **two of the five criteria were
never enforced and a third had never produced anything** — see "Run #6, and
what the green actually covered" below. T1–T5 and T7 are in
`.github/workflows/e2e-managed.yml`; T6 was **withdrawn** on a finding that
changed the design (below).

| Task | Status | Notes |
|---|---|---|
| T1 stand the managed stack up in CI | ✅ **Built 2026-08-18** | `deploy/compose/managed.yml` is **fourteen services**: postgres, pgbouncer, trigger-db, trigger-redis, trigger-api, clickhouse, trigger-registry, trigger-docker-proxy, trigger-supervisor, minio, trigger-tls, api, web, nextcloud. That is the honest scope — this is not "add a job". Self-hosted arm64 Spark runner, same as `e2e.yml`, because nothing else in CI can host it. |
| T2 the acceptance itself — **mostly already written** | ✅ **Built 2026-08-18** | `deploy/compose/smoke-managed.sh` (257 lines, workplan 0020 T5) already drives the live verify + apply smoke against a running managed stack, captures runner logs before AutoRemove destroys them, and lands stuck rows by hand rather than leaving them pointing at nothing. **This task is wiring, not writing.** `setup-managed-demo.sh` + `seed-managed.ts` + `deploy-tasks.sh` are the bring-up it expects. |
| T3 the pooler is in the path | ✅ **Built 2026-08-18** | The reason this workplan exists at all. 0082 T4 shipped PgBouncer and **nothing can verify it** — `e2e.yml` stands up `deploy/selfhost/compose.yml` and never references `managed.yml`. The gate must assert the app is actually talking through the pooler (`SHOW POOLS` reports non-zero `cl_active`) and that **migrations are not** (they hold a session advisory lock; through a transaction pooler two replicas would stop excluding each other, silently). Closing 0082 T4 is this task. |
| T4 nightly, and somebody reads it | ✅ **Built 2026-08-18** | Nightly like `e2e.yml` (`30 1` postgres, `30 3` pglite — pick a third slot, not one of those two: the Spark cannot run them concurrently). **A nightly nobody reads is worse than no nightly**, because it converts a real signal into a green-looking habit. See "Who reads it" below. |
| T5 evidence without leaking secrets | ✅ **Proved 2026-08-18 (run #13)** | Ran empty through run #9 — the smoke wrote to `/tmp` while the collector globbed the workspace, so redaction had never redacted anything and no artifact existed. Fixed by pointing `SMOKE_OUT` at a collected path. Run #9's artifact was downloaded and grepped: no `tr_prod_`, `tr_pat_`, `postgres://` or JWT shapes survive, and a `[redacted]` marker is present. The evidence tail now also prints into the job log on `always()`, from the REDACTED copy — the original carries the runners' whole task environment. |
| T6 teardown that actually tears down | ⛔ **Withdrawn 2026-08-18** | Fourteen services, named volumes, a local registry and a docker proxy on a **shared, long-lived** machine. **Withdrawn, and this is the finding that mattered most.** The naive `down -v` this row asked for would have destroyed the Trigger.dev account, project and API key — none of which can be recreated unattended — and the next run would fail looking like a broken test rather than a missing account. See below. The run now leaves the stack standing and reports what state it is in. |
| T7 what "green" is allowed to mean | ✅ **Enforced and met 2026-08-18 (run #13)** | Writing the criteria down did not enforce them: run #6 went green with T7.1 unasserted and T7.3's apply half skipped. All five are now enforced in code and mutation-verified, and run #13 satisfies them — `verify: done   apply: applied`, a runner executing, the pooler assertion passing, `unhealthy: none`, and the stack left standing for the next run. **One documented gap remains:** T7.1 cannot speak for the seven services that define no healthcheck. |

**Follow-on: workplan 0087.** T6's withdrawal rested on *"the Trigger.dev half
cannot be bootstrapped unattended"*. 0087 takes that as far as it goes: the
human step is now two clicks with a script either side of it, the whole
bring-up is one resumable command (`deploy/compose/bootstrap-managed.sh`) with
a runbook (`docs/managed-bring-up.md`), and **this workflow's bring-up step now
runs that script** rather than an inline copy of the order. 0087 also fixed two
latent bugs this workflow carried: its seed step depended on the runner's
ambient environment, and `setup-auth.sql`'s header documented a flag the SQL
does not read.

## Run #7 — the red, and what it was pointing at (2026-08-18)

The first run after the apply half stopped being allowed to skip. It failed,
correctly, and the failure turned out to be worth more than the green was.

**Three of the four fixes are now proved in CI, not just in tests.**

- The evidence artifact **exists** — `smoke-managed-32176950847.log`, 7808
  bytes, downloaded and read. `redact-evidence.sh` ran over it, and grepping
  the artifact for `tr_prod_`/`tr_pat_`/`postgres://`/JWT shapes returns
  nothing. T5's redaction has now actually redacted something, which through
  run #6 it never had.
- The apply half **fails instead of passing**: `verify: done   apply:
  skipped-no-item` → `SMOKE FAIL`, exit 1.
- A runner appeared and executed (`runner-cmsz2fj3k008h4wo50kdle29s`, deployment
  `20260818.3`), so the new no-runner assertion did not misfire.

**Why there was no eligible item — and it is not the apply path.**

`deploy/selfhost/setup-nextcloud-users.sh` provisions **accounts and nothing
else**: grep it for `PUT`, `MKCOL`, `.ics` or `.vcf` and every one comes back
empty. The demo tenant B source account has therefore always been empty, every
sync of that mapping has correctly copied nothing, and `item` has never held a
`copied` row for it. **The apply half was never blocked by a defect in apply.
It was blocked by a demo with nothing in it, for as long as the demo has
existed** — and until run #7 the smoke reported that as a pass.

Mail looks different only by accident. Run #7's verify half reports
`sourceCount 3, targetCount 3, checksumMatches 3` — but nothing in this repo
seeds those three messages either. They are ambient state on the Spark's
Stalwart, put there by hand at some point. Worth knowing before trusting the
verify half's counts on a fresh machine: **that half would find nothing to
verify too.**

A smaller thing found while reading the query that decides all this: the smoke
filtered on `status='copied' AND target_ref IS NOT NULL`, and `target_ref` is
`jsonb NOT NULL DEFAULT '{}'` — so the second half of that predicate was true
of every row ever written. It read like "and it landed somewhere on the target"
and filtered nothing. It now tests `target_ref->>'id'`.

**What was built in response.** `deploy/compose/seed-demo-dav-content.sh` puts
two events, two contacts and two files into the demo DAV **source** account.
It deliberately does **not** write ledger rows: inserting `status='copied'`
would hand the smoke its precondition and prove nothing, and it would be a
claim that a copy happened in the table whose whole job is recording copies
that did. The data goes in the source and a real sync earns the rows.

The script re-reads what it wrote with a `Depth: 1` PROPFIND and refuses if the
content is not there, because "every PUT returned 201" and "the data is
present" are different claims — the same distinction this workplan exists for.
It also discovers the collection paths rather than assuming them: Nextcloud's
layout is not symmetric (`calendars/<user>/` but `addressbooks/users/<user>/`),
and guessing wrong yields a 404 indistinguishable from "the account has no
calendar". `scripts/seed-demo-dav-content.unit.test.ts` covers both, plus the
refusal, with a stubbed Docker; three of four mutations were caught and the
fourth turned out not to be a defect at all (see below).

**Not yet wired into the bring-up, on purpose.** `--with-demo` does not call it
yet. If it misbehaves against the real Nextcloud it would break the bring-up
step and take the whole gate with it, which is a worse failure than the one it
fixes. Run it by hand on the Spark first; wire it into `setup-managed-demo.sh`
once it has worked once.

**A correction worth recording, since this workplan is about not over-claiming.**
The seeder's first draft passed curl's Content-Type via
`${ctype:+-H "Content-Type: $ctype"}`, and I rewrote it to an argument array
with a comment stating that the original word-split a value containing `;`.
The mutation test disagreed, and it was right: bash honours the quotes inside a
`${var:+word}` alternate value, and the header arrived intact all along. The
array form is kept because it is obvious rather than something you have to
know, and the comment now says that instead of describing a bug that never
existed.

## Run #8 — same red, and the check that it was the same red (2026-08-18)

Red again, at the same step and for the same reason. Worth a paragraph only
because "it failed in the same place" is a claim that has to be checked rather
than assumed, and because two of the previous fixes are now confirmed in CI.

**Confirmed live.** The health step reports what it means: seven services under
"no healthcheck defined (this gate cannot speak for these)" and `unhealthy:
none`. Through run #6 the same seven were printed as unhealthy under a step
that could not fail. The evidence artifact was produced again.

**Ruled out, rather than assumed.** Run #7's fix changed the query that decides
whether an eligible item exists. A malformed one would return nothing and be
reported as "no eligible item" — indistinguishable, in the log, from the
genuine absence. So the predicate was checked directly instead of by reading
the failure message twice:

| | matches |
|---|---|
| `status='copied' AND target_ref IS NOT NULL` | `h-default`, `h-empty-id`, `h-real` |
| `status='copied' AND coalesce(target_ref->>'id','') <> ''` | `h-real` |

against the real migrated schema under PGlite, with the shell quoting through
`q()` verified separately to deliver the SQL to `psql` intact. The old form
matched every copied row including one whose `target_ref` was the column
default; the new one matches only a row that actually landed. The change is
sound and is not the cause of the red.

That is now `packages/ledger/src/target-ref-eligibility.unit.test.ts`, which
also asserts the script still asks the discriminating question — the SQL being
right and the script using it are separate facts, and only worth something
together.

**Still the same missing precondition.** Nothing has yet put content into the
demo DAV source, so there is still nothing to sync and no `copied` row to act
on. `seed-demo-dav-content.sh` exists and has not been run on the Spark.

## Run #9 — a refusal that named a symptom, not a state (2026-08-18)

Red again, byte-for-byte the same refusal as #8: `no eligible item`, verify
`done`, a runner executing normally (deployment `20260818.5`). And the evidence
does not say **why** there is nothing to act on — which is the finding.

`no eligible item` was one paragraph covering three states with three entirely
different fixes:

| state | what it means | the fix |
|---|---|---|
| no `item` rows at all | nothing has ever synced here | put content in the source |
| rows exist, none `copied` | a sync ran and copying failed | a product fault; read the run log |
| `copied` but no `target_ref` id | the ledger write dropped the handle | a bug in the sync's ledger write |

Telling them apart meant going and querying the box by hand, and across runs
#7, #8 and #9 that is exactly what it cost — three rounds in which the gate
reported the same sentence and the actual state was never in the evidence. The
refusal now prints the `domain / status / count / with_target_id` breakdown for
the mapping and names which of the three it is. **A refusal that names a
symptom and not a state is only half a refusal.**

**The DAV chain is confirmed intact, which narrows what is left.** It was not
obvious that seeding content would be sufficient — `buildTargetWriterFromCredentials`
throws `Unsupported target type: undefined` for a config without a `type`
discriminator, and the demo's DAV connections have none (`{ baseUrl: … }`),
which matches a fault seen on the old instance. Read rather than assumed: that
function is on the **email** path only. Calendar, contact and file go through
`buildDomainDepsFromMapping` → `davEndpointFromCreds` → `davUrl`, and `davUrl`
accepts `baseUrl` directly, with credentials as `{username, password}` — which
is exactly what `seed-managed.ts` writes. So the path from seeded content to a
`copied` row with a target id is unbroken, and content is the only thing
missing.

Whether `seed-demo-dav-content.sh` has been run on the Spark is still not
knowable from a run's evidence. After this change it is: run #10's refusal, if
it comes, will say which of the three states the ledger is in.

## Run #10, and making the gate able to prepare its own box (2026-08-18)

Red at the same step. The interesting part is not the failure, it is what the
gate could not do about it: every remaining route to green needed a human on
the Spark, and there was none.

**The two things standing between the gate and an honest green, both structural.**

The demo DAV source has no content and never has —
`setup-nextcloud-users.sh` provisions accounts and nothing else. And a mapping
with no schedule syncs on `DEFAULT_SYNC_SCHEDULE = */15`, so even with content
in place the gate would either sit idle for a quarter of an hour or race the
tick and lose. Neither is a defect in the product; both mean the gate cannot
reach its own precondition unaided.

So the smoke gained `SMOKE_PREPARE_APPLY`, **off by default**. Run by hand it
remains an acceptance test — it reports what the stack is, and a script that
manufactured its own fixture by default would be the same class of lie as the
skip that used to pass. In CI, where nobody prepares the box between runs, the
gate sets it and the smoke seeds the DAV source and enqueues the sync itself
(`POST /api/migrations/:id/sync`, which is the "run now" path rather than the
scheduler's cadence), then re-asks the same eligibility question it always
asked. A seeding failure does not short-circuit anything: it falls through to
the diagnosis added for run #9, which then says whether the ledger is empty or
stalled.

**A failure has to be readable from where it is read.** Run #10's diagnosis was
written, uploaded, and unreachable: the artifact host is not always fetchable,
and the verdict sits about a hundred lines up a job log behind the artifact
upload and `docker compose ps`, so a log tail does not reach it. There is now a
final `if: failure()` step that prints the last 45 lines of the evidence.

It prints **the redacted copy**, never the workspace original. Those last lines
are the captured runner logs, a runner's debug output prints the whole task
environment — `DATABASE_URL`, `SECRET_ENCRYPTION_KEY`, the `tr_prod_` key — and
a job log is readable by everyone who can see the repo. The first draft of that
step tailed the original; it was caught before it ran, and a test now pins the
redacted path.

## Run #11 — the gate paid for itself (2026-08-18)

The first run with `SMOKE_PREPARE_APPLY=1`. It seeded the DAV source, enqueued
a sync, four runners executed, items were created and reached `copied` — and
the apply half still found nothing. The diagnosis added for run #9 said which
of the three states it was, and it was the third:

> there ARE copied items, but none carries a target_ref id.
> That is a bug in the sync's ledger write, not a missing precondition.

It was right, and it found two defects.

**`target_ref` was a string of itself.** `PgLedger` wrote
`JSON.stringify({ id })` into a drizzle `jsonb` column. Drizzle serialises
whatever it is handed, so the JSON *text* was stored as a jsonb string scalar —
`"{\"id\":\"abc\"}"` — rather than the object. Confirmed through the real
write path against real migrations under PGlite:

| | jsonb_typeof | `target_ref->>'id'` |
|---|---|---|
| a hand-written `INSERT` of the same value | `object` | `target-abc` |
| through `PgLedger` | **`string`** | **`null`** |

That second row is the bug, and the first row is why it hid so well: write the
value yourself and it is fine — only drizzle's own serialisation double-encodes,
so any test that inserted its own fixture would have proved the opposite of the
truth. `target_ref->>'id'` was NULL on every row ever written, and
`mapRowToRecord` read `.id` off a string, got `undefined`, and handed `''` to
every caller. **Every `targetId` in the system came back empty.** Fixed in
`ledger.ts` (three sites); migration 0027 repairs the rows already written.

**And an empty handle was not refused.** This is the worse of the two. Every
DAV writer builds its URL with `buildUrl(targetId)`, and `buildUrl('')` is the
**collection** — so `removeItem('')` does not fail, it aims the DELETE at the
whole calendar, address book or folder. `apply-deletion.ts` passes the ledger's
`targetId` straight in. Applying one deletion would have removed the container
and everything in it.

Reachable, not theoretical: the storage bug guaranteed `''`. Both halves are
fixed, but the guard stands on its own — a handle we do not have is never
permission to delete what contains it (ADR-0024, hard rule 2). It refuses
before any URL is formed, in all three writers, and a test asserts the ordering
so a writer added later cannot quietly skip it.

**What this says about the gate.** Nine runs of arguing with a nightly produced
a latent data-loss path in the apply route — the exact path 0084 exists to
cover, in the edition nobody tested. The skip that used to pass would have
hidden all of it: `apply: skipped-no-item` and `SMOKE PASS`, indefinitely.

## Run #13 — the honest green, and what it is allowed to claim (2026-08-18)

Held against T7's five criteria, read from the run rather than inferred from
its colour:

| T7 | criterion | run #13 |
|---|---|---|
| 1 | every service HEALTHY, not merely started | `--- unhealthy --- none`. **Partial:** seven services define no healthcheck and are reported as such rather than counted. |
| 2 | a task deployed and RAN — an enqueue became a runner container | a runner reached `EXECUTING` on deployment `20260818.9`, captured in the evidence before AutoRemove |
| 3 | verify terminal, and apply `applied` or `refused` | **`verify: done   apply: applied`** |
| 4 | the app talked through PgBouncer, and migrations did NOT | the pooler assertion passed: transaction mode, `DIRECT_DATABASE_URL` on neither `pgbouncer` nor `:6432` |
| 5 | the stack is left in a state the next run can use | #13 ran against the stack #12 left standing |

**What "apply: applied" means, precisely.** The smoke flips
`allow_apply_deletions`, fabricates the deletion evidence, applies it, and
retracts the evidence afterwards — guarded, so evidence is only retracted if
the deletion was never applied, because retracting under an applied receipt
would falsify the record. So a real deletion was applied to a real DAV target
through a real runner, and the receipt reached a terminal state. That is the
half that had never once executed under this gate.

**Reading the verdict was itself a fix.** Run #12 was green with all fifteen
steps passing, and its verdict was unreadable — the artifact host is not always
fetchable and the log tail could not reach back past the artifact upload and
`docker compose ps`. What remained was "all steps passed, so it must be fine",
which is the reasoning that made run #6's green a lie. The evidence tail now
prints on `always()` rather than `failure()`: a green needs it more than a red
does, because a red at least names the step that broke. **A gate whose
conclusion cannot be read is not a gate, it is a colour.**

## Closing T7.1's gap, and the vacuous verify underneath it (2026-08-19)

Two things 0084 recorded as still owed. One is now closed for three of seven
services; the other turned out to have a worse half hiding under it.

### Healthchecks: three added on evidence, four argued rather than probed

A healthcheck is not free here. `up -d --wait` blocks on it, so a probe naming
a binary the image does not ship does not misreport — it **fails the bring-up**,
and takes the gate with it. So these were added from evidence rather than from
what the images probably contain:

| service | probe | why it is safe to assert |
|---|---|---|
| `nextcloud` | `curl … /status.php` | **proven** — `setup-nextcloud-users.sh` has been running exactly this via `docker exec` against this image on the Spark since the demo existed |
| `trigger-api` | `node -e fetch('http://127.0.0.1:3000/')` | Node application image, so the runtime its own entrypoint uses is the one binary certainly present; the appliance's healthcheck uses the same shape |
| `trigger-supervisor` | `node -e fetch('http://127.0.0.1:8020/')` | same, and 8020 is the workload API a runner's own log names (`TRIGGER_SUPERVISOR_API_PORT`) |

**Liveness, not a named endpoint.** `fetch` resolves on any HTTP response, 404
included, and rejects only when nothing is listening. That is the question
worth asking — *is this process serving?* — and unlike a probe on
`/healthcheck` it cannot go quietly wrong when an upstream image moves its
health path.

**The four that remain, and why they are not simply unfinished.**
`trigger-registry` and `trigger-docker-proxy` are proven **functionally** by the
gate itself: a task deploy pushes an image through the registry and the
supervisor starts runner containers through the proxy, so T7.2's "a runner
executed" is a stronger statement about both than any liveness probe would be.
`minio` and `trigger-tls` are genuinely unasserted — the smoke exercises
neither (minio holds oversized payloads the demo never produces; the Caddy TLS
front serves the dashboard, which only a human uses). That is the honest
residue, and it is smaller and better understood than "seven services have no
healthcheck".

### The mail half: a verify that compared nothing was passing

Chasing the second gap — nothing seeds the three Stalwart messages the verify
half counts — found the more serious thing. **`state: done` says the run
finished, not that it compared anything.** On a mailbox with no mail, verify
reports `sourceCount: 0, targetCount: 0, PASS`. Perfectly true, and worth
nothing.

It is the same shape as the apply half's skip-that-passed, and it survived that
fix untouched. It has never fired on the Spark only because that box happens to
hold three messages somebody put there by hand, and **nothing in this
repository seeds them** — so on any other machine this half has been vacuous
and green for its whole existence.

The smoke now refuses a verify that reached `done` having compared zero items,
and refuses one whose report does not carry the count at all: a report shape
that changed is not evidence that anything was verified. It does not
double-report a verify that already failed for its own reason.

**And the seeder is built — it already existed.** My first answer here was that
this needed a four-round-trip JMAP flow written from scratch and untestable
without containers, so I shipped the guard and left the row open. That was
wrong, and the owner said so: *"don't we have examples of this seeding
elsewhere?"*

`test/e2e/seed-imap-source.mjs` has been seeding mail for `e2e.yml` every night
since 0010 T5 — imapflow (the same client the app's own IMAP connector uses),
stable Message-IDs, `rejectUnauthorized: false` for Stalwart's self-signed
certificate. Its defaults are `source@dev.local` / `source_password`, which is
**exactly** the managed demo's tenant A source. There was no protocol work to
do at all; there was a port to point at, and I had looked for `APPEND` and
`seed-mail` in the source instead of asking how the existing mail e2e gets its
data. The lesson is the cheap one: *before concluding a thing cannot be built,
check whether it has already been built.*

The one genuine change it needed is `SEED_ONLY_IF_EMPTY`. `append` is an
append: the self-host e2e starts from a mailbox it has just destroyed, so a
re-run is harmless there, but this gate runs against a stack it deliberately
never tears down (T6's withdrawal) — unguarded, the demo source would gain
three messages every night and the count the verify half compares would drift
for ever. The option defaults OFF, so `e2e.yml` is untouched.

`setup-managed-demo.sh` publishes the managed Stalwart's IMAPS on **1994**,
chosen so it cannot collide with the dev stack's 1993 — which makes "seeded the
wrong instance" a real way to be quietly wrong, and is asserted in the tests.

## Run #6, and what the green actually covered (2026-08-18)

The gate's first fully green run. Every one of its fourteen steps reports
`success`, none skipped. Held against T7's own five criteria, three of them
were satisfied and two were not — and the run said nothing about the
difference, which is the failure mode T7 was written to prevent.

**What green did prove.**

- *T7.2 — a task deployed and RAN.* Real, and the strongest thing the run says.
  Container `runner-cmsz11lj5005w4wo5jv6v7xyc` was scheduled at 18:59:46.187Z,
  dequeued two milliseconds earlier, connected to the supervisor and reached
  `EXECUTING` on deployment `20260818.2`. An enqueue became a runner on this
  machine — 0018 T5's question, answered in the affirmative by evidence rather
  than by a green tick.
- *T7.3, verify half.* `verification_run` reached `done`, started 18:59:45.838Z
  and finished 18:59:47.901Z, with an empty error column.
- *T7.4 — the pooler is in the path.* `SHOW POOLS` answered, reported
  transaction mode, and `DIRECT_DATABASE_URL` inside the api container pointed
  at neither `pgbouncer` nor `:6432`. This is the criterion the whole workplan
  exists for, and it holds.

**What green did not prove, and did not admit.**

- *T7.3, apply half — never ran, and passed anyway.* The smoke printed `no
  eligible item (status='copied' with a target_ref) — apply half SKIPPED`, then
  `verify: done   apply: skipped-no-item`, then `SMOKE PASS`. The
  terminal-state assertion sat inside the `else` of the eligible-item check, so
  the one branch that needed judging was the only branch that escaped it. The
  script's own header had said all along that success requires apply terminal;
  the code had quietly stopped agreeing. **The apply half has never executed
  under this gate.**

  The precondition is not an accident of timing: `seed-managed.ts` creates
  tenants, connections and mappings but **no items**, and only a real sync
  produces one. So this half could not have run, on any run, and the smoke
  reported that as a pass. It now fails, and names the fix. Expect the nightly
  to go red until a sync lands a `copied` item on the apply mapping — that red
  is the accurate state, and the known `run-delta-sync` fault
  (`Unsupported target type: undefined`) sits squarely in the path that would
  clear it.
- *T7.1 — nothing asserted on health.* The closing step ran `|| true` and could
  never fail the job. Worse, it printed seven services under the heading
  "unhealthy services, if any" — `trigger-api`, `trigger-supervisor`,
  `trigger-tls`, `minio`, `trigger-registry`, `trigger-docker-proxy`,
  `nextcloud` — **none of which was unhealthy.** `docker compose ps` showed
  every one plainly `Up`; they define no healthcheck, so `.Health` is empty and
  a `grep -v ' healthy$'` matched them. A heading that cries wolf on seven
  healthy services teaches its reader to skip it. The step now separates "no
  healthcheck defined" from `unhealthy`, and only the latter fails the job.
  T7.1 still cannot speak for the seven: closing that means giving them
  healthchecks in `managed.yml`, which is not done here.
- *T5 — the evidence artifact was empty.* `redact-evidence.sh` reported
  `cleaned 0 file(s)` and upload-artifact warned `No files were found with the
  provided path: managed-evidence/`. The smoke defaults its output to
  `/tmp/openmig-smoke-managed-*.txt` while the collector globs the workspace,
  so **T5's redaction had never once redacted anything in CI** and the run left
  behind no evidence at all. The workflow now sets `SMOKE_OUT` to a workspace
  path the collector matches; that file is secret-bearing (runner debug logs
  print `DATABASE_URL`, `SECRET_ENCRYPTION_KEY` and the `tr_prod_` key) and is
  gitignored for the same reason the redaction exists.
- *T7.2, as an assertion rather than a fact.* A runner did appear, so the
  criterion holds for this run — but `(no runner containers appeared)` was an
  echo, not a failure. The gate could have missed the single thing it was
  written to catch. It now fails.

**The lesson, since it is the second time this shape has appeared here.** Both
this and the `deploy/compose` configuration 0087 found had the same property:
written carefully, never executed, and therefore wrong in ways no amount of
re-reading surfaces. A gate is a program too. Its first green is a claim to be
checked against its own stated criteria, not a result.

`scripts/smoke-managed-verdict.unit.test.ts` holds all four fixes, executing the
script's real decision lines rather than restating them; five mutations
reverting each fix were confirmed to fail it.

## The first two runs, and what they found (2026-08-18)

Hand-triggered twice, hours apart, on different commits — the second run
came *after* the managed stack had been fully rebuilt, verified, and proven
executing tasks cleanly by hand. Both failed at the exact same step:
`Refuse early if the one-time setup was never done`, both naming a missing
`deploy/compose/.env`.

**Neither is a defect in the stack.** The job log (`get_job_logs`, not
guessed) showed the checkout at
`/home/robbes/infra/gha-runner-openmig/_work/open-migrate/open-migrate` —
a different directory from wherever the manual bring-up happened all day.
A self-hosted runner does not share a working directory with a human's own
clone just because it is the same machine.

**And it would have kept failing even after a manual fix**, which is the
real finding: `actions/checkout` defaults to `clean: true` (`git clean
-ffdx` before every checkout), which destroys gitignored files — `.env`
among them — at the start of every single run. A one-time setup placed by
hand in the runner's checkout does not survive to the next run.

Fixed by moving the one-time setup **outside** any checkout: a `Restore`
step now copies `.env` and `userlist.txt` in from a fixed persist directory
before the refuse-early check runs, and the refusal message names the exact
two commands to seed that directory. Because `managed.yml` pins its project
name, the containers a manual bring-up already created are the same
containers CI would manage — so seeding the persist directory from an
already-working `.env` is a copy, not a second bring-up.

**Run #3**, after `MANAGED_ENV_PERSIST_DIR` was seeded: got materially further —
postgres, pgbouncer (recreated, healthy, `auth_query in openmigrate`) and
nextcloud all came up clean, proving the restore mechanism above actually
works. Failed at `--with-demo`'s Stalwart provisioning:

```
[setup-stalwart] stalwart-cli not found. Install it (see this script's header) or set STALWART_CLI_PATH.
```

`e2e.yml` installs `stalwart-cli` on the same runner class for its own job,
but a job's `PATH`/`GITHUB_PATH` additions do not carry to a different
workflow's job — confirmed from `e2e.yml`'s own "Install stalwart-cli" step,
copied here verbatim rather than reinvented, to avoid the two drifting into
two different install recipes for the same tool.

**Run #4**, after `stalwart-cli` was installed: the whole `data` and `demo`
phases went clean — Stalwart provisioned, Nextcloud provisioned, the seed ran
and minted fresh demo tokens, the entire Trigger.dev plane came up healthy,
and `account` correctly found the persisted `.env`'s project and did nothing.
**Everything up to the human step now works unattended.** Stopped, correctly,
at `login`:

```
The deploy CLI is not logged in on this machine.
```

Not the `whoami` bug recurring — this run already has that fix, and the
check is trustworthy. The owner HAD logged in by hand, hours earlier, against
this exact project (`account` found no reason to redo anything, so no reset
happened in between) — the session simply had nowhere to persist TO before
this run, the same gap `.env` had before its own fix. Same treatment: the
CLI's session file (`${XDG_CONFIG_HOME:-$HOME/.config}/trigger/config.json`,
confirmed from the CLI's own `xdg-app-paths` dependency, not guessed) is now
restored from the persist directory alongside `.env`, seeded from whatever
login already exists rather than clicking through the magic link again.

**Run #5**, before the fix below merged, failed identically to run #4 — the
persist directory had not been seeded yet, expected and not a new finding.

**Found while answering the owner's own question — why not a Personal
Access Token, the way most Trigger.dev CI examples do it — a genuinely
better mechanism than the session-file restore above.** Read from source
(`dist/esm/commands/deploy.js` calls `login({embedded:true})`, whose FIRST
branch checks `TRIGGER_ACCESS_TOKEN` before ever touching the profile file):
`deploy` honours it directly, and it is the CLI's own documented answer for
a CI environment that cannot run the interactive flow. `whoami` cannot see
it — confirmed from the same source, `isLoggedIn()` never reads that
variable — so `trigger_cli_logged_in()` now short-circuits on its presence
rather than trying to make `whoami` agree. The session-file restore stays as
a fallback for a manual bring-up that would rather not mint a token.

**Still open, and the actual next step for this workplan:** add the
`TRIGGER_ACCESS_TOKEN` repository secret (docs/managed-bring-up.md has the
exact steps — minting it is a browser action only the owner can do). The
next trigger after that is the workflow's first attempt with every
prerequisite — `.env`, `stalwart-cli`, and now a CI-native login — actually
in place.

## What this is

The owner asked for a managed end-to-end gate, nightly, with the results
checked. It follows directly from a finding recorded the same day (0083): **the
managed edition has no end-to-end gate at all.** The unit and integration tiers
cover managed *code*; nothing stands the managed *stack* up. That is why
PgBouncer could not be verified by CI and why the honest answer to "is the
pooler tested?" was "no, and it cannot be".

The good news, found while scoping this: most of the acceptance already exists.
0020 T5 wrote `smoke-managed.sh` precisely because *"a green CI says nothing
about whether an enqueue actually becomes a runner on this machine"* — which is
the same sentence this workplan would otherwise have had to write from scratch.

## What "green" is allowed to mean (T7)

A gate is only as honest as its weakest allowed pass. Stated before it is built:

1. **The stack came up** — every service healthy, not merely started.
2. **A task deployed and RAN** — an enqueue became a runner container on this
   machine. This is 0018 T5's lesson and the reason the smoke exists.
3. **Verify reached a terminal state**, and `apply` reached `applied` **or**
   `refused`. A refusal is a legitimate pass: the gates said no and said why.
4. **The app talked through PgBouncer, and migrations did not** (T3).
5. **The teardown left nothing behind.**

And what must NOT count as green: a skipped step, a timed-out poll, or a stack
that came up with a service in `unhealthy` while nothing asserted on it.

## Who reads it, and what happens on red (T4)

The owner asked for results "checked by you". Concretely:

- A scheduled check-in reads the nightly run each morning, the same mechanism
  already used to watch PRs to green.
- **Red on the managed gate is diagnosed, not re-run.** A re-run is the correct
  fix only when the job died before anything of its own ran — lost runner,
  registry pull, disk. Anything else gets root-caused, because on a stack this
  size "flaky" is where real defects go to hide.
- Two consecutive reds, or any red that is not understood within a day, is
  raised to the owner rather than sat on.

**The failure mode to design against is not a red nightly. It is a nightly that
goes red and stays red** until everyone reads the badge as decoration.

## The finding that changed the design

**The managed stack's Trigger.dev instance cannot be bootstrapped unattended.**
`deploy-tasks.sh` documents the one-time prerequisites and every one of them
needs a person: create an account and project through the dashboard's
magic-link login (the link is printed into `docker logs trigger-api`, because
no mail server is configured), copy `TRIGGER_PROJECT_REF` and a `tr_prod_` key
into `.env`, run a CLI login once per machine, and set the task runtime
environment variables **in the dashboard** — the deployed tasks run in their own
containers and inherit nothing.

Two consequences, and the first is the one that would have bitten:

1. **T6 is withdrawn.** A nightly that tore the stack down would erase that
   setup and need a human before the next run — and the failure would present
   as a broken test. What the gate does instead is leave the Trigger.dev half
   standing and recreate the halves it owns: API, web, worker image, seed.
2. **This gate does not prove bring-up from scratch**, and says so in its own
   header. It proves the application works against a *configured* stack.
   Somebody changing `managed.yml`'s Trigger.dev services still verifies those
   by hand.

Rather than leave that as a trap, the workflow's first step **refuses early**
when the one-time setup is absent, naming the exact fix. The alternative is a
failure fifteen minutes later, inside the smoke, pointing at a task that never
deployed.

## Cost, stated rather than discovered

Fourteen services on one shared arm64 machine, nightly, alongside two existing
e2e runs. Before building: measure a manual `up → smoke → down` cycle and write
the number here. If it exceeds roughly 30 minutes, the honest options are a
narrower gate (bring up fewer services and say which are unproven) or a lower
frequency — **not** a gate that quietly overruns and gets cancelled by the next
one, which reads as green while proving nothing.

## What this deliberately does NOT do

- **No real O365 source.** Same posture as `e2e.yml`: Stalwart and Nextcloud
  are the fixtures. A gate that needs live Microsoft credentials is a gate that
  fails for reasons that are not ours.
- **No public-internet exposure.** The stack comes up on the Spark's network
  and dies there.
- **Not a performance test.** It proves the stack works, not that it is fast.
  0082's numbers still want `pg_stat_statements`, which is a separate thing.
- **Not a bring-up test** (see above).

## Run #18: the gate refused an item it had just printed

The nightly went red with `apply: skipped-no-item`, and its own diagnosis
contained the counter-example:

```
what IS on this mapping:
  calendar|tombstoned|3|3
  contact|tombstoned|4|4
  file|adopted|64|64
  file|tombstoned|1|1
  file|updated|1|1
```

`file|updated|1|1` is one updated file **with a target_ref id** — eligible by
the product's own rule. `ownershipCheck` in `apply-deletion.ts` accepts
`copied` OR `updated`, and its comment insists that list "has to be an
equality, not an approximation". The smoke asked for `status='copied'` alone,
so it declared there was nothing to act on and failed the gate for a reason
that was not true. **A gate paraphrasing the rule it is checking will
eventually disagree with it**, and the disagreement reads as a product fault.

Fixed by asking for what the product accepts, and by a guard that READS
`ownershipCheck` rather than restating its answer — so widening the product
without the smoke, or narrowing the smoke without the product, fails a test.
Both directions are mutation-verified, as is the case that must never pass:
`adopted` becoming eligible, which would have the gate asking to delete bytes
that were the account owner's before we arrived.

**Two things the same run proved, first time out.** `minio HTTP 200` and
`trigger-tls: TLS terminated on 127.0.0.1:3443 (HTTP 200)` — both new
assertions correct on first contact, including the by-IP reasoning for the
SNI. And the bring-up seeding worked: the prepare phase's PUTs all returned
**204, not 201**, which is Nextcloud saying the resources were already there.

**A risk this run surfaced without settling.** 64 files came back `adopted`
and nothing came back `copied`. `adopted` means the target already held the
item, and the product refuses to remove those on purpose (hard rule 2). On a
long-lived stack whose demo target already holds everything the seeder writes
— byte-identical bodies, fixed paths, every bring-up — the eligible population
can converge on nothing, and the gate would go red for a condition that is not
a fault. It did not happen this time; there was an `updated` row. **What would
settle it is the next few runs**: if `apply` starts refusing with an empty
`eligible` count while `adopted` grows, the fixture needs one resource whose
content genuinely changes per run, and that is a deliberate change to make with
the evidence in hand rather than now, on a hunch about which status a writer
picks.

**Run #19 (2026-08-19) is green**, which settles the fix: the apply half found
an eligible item on the same stack that had none the run before, so the
predicate was the whole of the fault. It does NOT settle the `adopted` question
— a green tells us the eligible population was not empty, not which status
filled it. That still wants a few more runs.

### Run #20 (2026-08-19) — the gate had eaten its own fixture

Red, with `verify: done   apply: skipped-no-item`, on `3730a5d` — a commit whose
PR was green and whose `E2E (self-hosted) #140` was green, four hours after run
#19 passed on the same stack. Nothing had regressed. The gate had spent the last
of a fixture it could not replace, and would have failed every run from then on.

**The mechanism, and it is a ratchet.** The apply half applies a REAL deletion
to one eligible item per pass. `applyDeletion` writes `status='tombstoned'`, and
`classifyKnownItem` refuses forever to re-create a tombstoned natural key —
deliberately, because it cannot tell a change of mind from an erasure request.
`seed-demo-dav-content.sh` writes SIX fixed natural keys (the VEVENT/vCard UID
and the file path ARE the keys), so *re-seeding cannot give one back*: the PUT
succeeds, the next sync sees the key again, and the only thing that happens is a
"reappeared after removal" warning. **One green run, one item spent, six items
ever.**

The arithmetic is in the two evidence files. Run #18 held
`calendar|tombstoned|3`, `contact|tombstoned|4`, `file|adopted|64`,
`file|tombstoned|1`, `file|updated|1` — 73 rows, one eligible. Run #19 applied
that last one (`kind: binned`). Run #20's breakdown is the same 73 rows with the
`updated` file moved to `tombstoned`: nothing eligible, and nothing that could
become eligible.

**Two things made this hard to read, and both are fixed.**

The diagnosis called it *"a product fault, not a missing fixture; a sync ran and
the copying did not succeed"* — which sends the next reader hunting a copy bug in
a sync that had never once failed. It now tells the fourth state apart from the
third: a mapping whose items are `tombstoned` has a SPENT fixture, and the fix
is new keys, not a re-seed of the old ones.

And the seeder's own verification said `present now — events:1` after writing
two, every run since it was written. `grep -c` counts matching LINES, and
Nextcloud answers a `PROPFIND` on one. A verification step that cannot tell one
resource from two is most of the way back to trusting the PUT's status code,
which is the thing that step exists not to do.

**The fix: `seed-demo-dav-content.sh --fresh`.** It seeds a set whose UIDs and
paths carry a tag unique to the invocation, so the natural keys have never been
seen by the ledger and CANNOT collide with a tombstone. The smoke's prepare
phase uses it; bring-up does not, because bring-up wants the same handful of
demo resources on every stack. It is still an honest fixture — it goes into the
SOURCE, and a real sync has to copy it before anything is eligible.

**What `--fresh` costs, stated rather than discovered later:** it adds to a
long-lived source instead of overwriting it. It seeds six, the smoke spends one
per run, and it only runs when nothing eligible is left — so the steady state is
roughly one new object per run, each a few hundred bytes. If that ever needs
bounding, prune the tagged resources from the SOURCE; never the ledger rows,
which are the record.

**This also answers the `adopted` question left open under run #18** — and not
the way that note guessed. The eligible population was not being eaten by
`adopted`; it was being eaten by this script, one applied deletion at a time. A
resource whose content genuinely changed per run would not have helped: a
changed body under a spent key still classifies as `tombstoned`.

## What is still owed

- ~~**The DAV seeder is still not wired into the bring-up.**~~ **Done
  2026-08-19.** `setup-managed-demo.sh` now seeds the source right after
  provisioning the accounts it fills, so the by-hand bring-up and the nightly
  get the same demo. **No `only if empty` guard, unlike the mail seeder** — that
  one APPENDS, so an unguarded re-run on this long-lived stack grows the mailbox
  every night; this one PUTs to fixed paths and accepts 201 or 204, created or
  overwritten, so re-running converges instead of growing. Idempotent by
  construction rather than by a check. The smoke keeps its copy as an explicit
  FALLBACK for stacks brought up before this change.
- ~~**Healthchecks for `minio` and `trigger-tls`**~~ **Asserted instead,
  2026-08-19 — and the substitution is the point.** A compose probe runs INSIDE
  the image, so under `up -d --wait` one naming a binary that image lacks does
  not misreport: it fails the bring-up and takes the gate with it. `nextcloud`'s
  probe could be written because `setup-nextcloud-users.sh` has run exactly that
  curl against exactly that image for months. **Nothing in this repository has
  ever executed a command inside `bitnamilegacy/minio` or `caddy:2-alpine`**, so
  there is no evidence to write either probe from, and "the image probably has
  curl" is the guess that costs a bring-up.

  So the smoke asserts them from places whose tooling IS proven. `minio` through
  the API container (a Node image, the same reasoning the trigger probes use)
  because it publishes no port and `http://minio:9000` is the address
  trigger-api is configured with — asserting it from the host would assert a
  different thing. `trigger-tls` from the host's own curl, **by IP**, because
  the Caddyfile's site address is the operator's own host and a request to
  `localhost` sends an SNI matching no site; an IP sends none, which is the case
  `default_sni` exists for (rule 2, learned live on 2026-08-01).

  **What this does not do is make `docker compose ps` say "healthy"**, so
  T7.1's count of services without a healthcheck is unchanged at seven. What
  changed is that five of them are now proven by something.
- **The `SMOKE_PREPARE_APPLY` path has run exactly once as a full seed.** Run
  #11 exercised it end to end (seed, enqueue, poll) and it worked; runs #12 and
  #13 found an eligible item already present and skipped it. So the branch is
  proved, but it is not exercised by every run, and a regression in the seeder
  would surface only on a stack with no copied items.
- **`--fresh` grows the demo source, slowly and on purpose.** Roughly one new
  object per run in the steady state, never pruned. It is cheap enough to leave
  alone and easy enough to bound later; what must not happen is pruning the
  ledger rows instead, which are the record of what this gate did.
- **The mail side has the same hole, unnoticed.** Nothing seeds the three
  Stalwart messages the verify half counts, so on any machine but this one the
  verify half would have nothing to verify. The DAV seeder's equivalent for
  mail does not exist.
- **Healthchecks for the seven services that have none.** T7.1 asks that every
  service the run touches be healthy; for `trigger-api`, `trigger-supervisor`,
  `trigger-tls`, `minio`, `trigger-registry`, `trigger-docker-proxy` and
  `nextcloud` this gate can only say they are running. `trigger-api` and
  `trigger-supervisor` are on the path every executed task takes, so those two
  are the ones worth doing first.
- **The reading habit.** T4 describes what happens on red; making that real
  means a check-in that reads the run each morning, which is a standing
  arrangement rather than a file in the repo.
