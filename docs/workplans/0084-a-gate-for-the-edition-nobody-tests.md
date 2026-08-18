# Workplan 0084 — a gate for the edition nobody tests

## Status — 2026-08-18 (update this block at the end of every session)

**Built 2026-08-18. First two hand-triggered runs, same day, both failed
before the stack ever came up** (see below) — genuinely never yet exercised
past its own precondition check. T1–T5 and T7 are in
`.github/workflows/e2e-managed.yml`; T6 was **withdrawn** on a finding that
changed the design (below). No Docker in the authoring session, so its first
firing on the Spark is its first real run.

| Task | Status | Notes |
|---|---|---|
| T1 stand the managed stack up in CI | ✅ **Built 2026-08-18** | `deploy/compose/managed.yml` is **fourteen services**: postgres, pgbouncer, trigger-db, trigger-redis, trigger-api, clickhouse, trigger-registry, trigger-docker-proxy, trigger-supervisor, minio, trigger-tls, api, web, nextcloud. That is the honest scope — this is not "add a job". Self-hosted arm64 Spark runner, same as `e2e.yml`, because nothing else in CI can host it. |
| T2 the acceptance itself — **mostly already written** | ✅ **Built 2026-08-18** | `deploy/compose/smoke-managed.sh` (257 lines, workplan 0020 T5) already drives the live verify + apply smoke against a running managed stack, captures runner logs before AutoRemove destroys them, and lands stuck rows by hand rather than leaving them pointing at nothing. **This task is wiring, not writing.** `setup-managed-demo.sh` + `seed-managed.ts` + `deploy-tasks.sh` are the bring-up it expects. |
| T3 the pooler is in the path | ✅ **Built 2026-08-18** | The reason this workplan exists at all. 0082 T4 shipped PgBouncer and **nothing can verify it** — `e2e.yml` stands up `deploy/selfhost/compose.yml` and never references `managed.yml`. The gate must assert the app is actually talking through the pooler (`SHOW POOLS` reports non-zero `cl_active`) and that **migrations are not** (they hold a session advisory lock; through a transaction pooler two replicas would stop excluding each other, silently). Closing 0082 T4 is this task. |
| T4 nightly, and somebody reads it | ✅ **Built 2026-08-18** | Nightly like `e2e.yml` (`30 1` postgres, `30 3` pglite — pick a third slot, not one of those two: the Spark cannot run them concurrently). **A nightly nobody reads is worse than no nightly**, because it converts a real signal into a green-looking habit. See "Who reads it" below. |
| T5 evidence without leaking secrets | ✅ **Built 2026-08-18** | `smoke-managed.sh` already warns that runner debug logs print the **full task environment — `DATABASE_URL`, `SECRET_ENCRYPTION_KEY`, the `tr_prod_` key**. A nightly job that uploads those as an artifact is a credential disclosure with a retention policy. Redaction is a prerequisite for artifact upload, not a nicety. |
| T6 teardown that actually tears down | ⛔ **Withdrawn 2026-08-18** | Fourteen services, named volumes, a local registry and a docker proxy on a **shared, long-lived** machine. **Withdrawn, and this is the finding that mattered most.** The naive `down -v` this row asked for would have destroyed the Trigger.dev account, project and API key — none of which can be recreated unattended — and the next run would fail looking like a broken test rather than a missing account. See below. The run now leaves the stack standing and reports what state it is in. |
| T7 what "green" is allowed to mean | ✅ **Built 2026-08-18** | Stated up front so the gate cannot quietly weaken. See below. |

**Follow-on: workplan 0087.** T6's withdrawal rested on *"the Trigger.dev half
cannot be bootstrapped unattended"*. 0087 takes that as far as it goes: the
human step is now two clicks with a script either side of it, the whole
bring-up is one resumable command (`deploy/compose/bootstrap-managed.sh`) with
a runbook (`docs/managed-bring-up.md`), and **this workflow's bring-up step now
runs that script** rather than an inline copy of the order. 0087 also fixed two
latent bugs this workflow carried: its seed step depended on the runner's
ambient environment, and `setup-auth.sql`'s header documented a flag the SQL
does not read.

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

## What is still owed

- **Its first run.** Written without Docker, so nothing here has executed. The
  first firing on the Spark is the verification, and the honest expectation is
  that it needs a round or two of fixing — a 14-service stack driven by a
  workflow nobody has watched is not green on the first try.
- **The reading habit.** T4 describes what happens on red; making that real
  means a check-in that reads the run each morning, which is a standing
  arrangement rather than a file in the repo.
