# Workplan 0087 — the bring-up that only lived in notes

## Status — 2026-08-18 (update this block at the end of every session)

**Built 2026-08-18. Never executed against Docker.** The authoring session had
no Docker daemon and no Trigger.dev instance, so every phase that touches
either is written and reviewed but unrun. What *was* run: the three helper
scripts, under 23 unit tests, plus the `env` phase end to end against the real
`managed.env.example` (created `.env`, generated eight secrets, pinned the
architecture, idempotent on re-run). The first real proof is the nightly
`e2e-managed.yml`, which now performs its bring-up through this script.

| Task | Status | Notes |
|---|---|---|
| T1 one script, phased, idempotent, resumable | ✅ **Built 2026-08-18** | `deploy/compose/bootstrap-managed.sh`. Ten phases (`--list`), each checking whether it is already done. `--from` resumes, `--only` runs one. Exits **2**, not 1, when it is waiting for a person — "your turn" is not a failure — and always prints the resume command. |
| T2 the `.env` writer | ✅ **Built 2026-08-18** | `deploy/compose/env-upsert.sh`. Replaces a key **where it already sits** and collapses duplicates, because `echo >>` leaves a file whose first occurrence is what a human reads and whose last is what is in force. Refuses a value containing whitespace, a quote, `$`, a backtick or a backslash — every consumer reads this file with `set -a; . .env`, so such a value is re-interpreted by a shell. |
| T3 find the magic link | ✅ **Built 2026-08-18** | `deploy/compose/trigger-magic-link.sh`. Matched by **shape** (a URL containing `magic`), not by the sentence around it — the webapp's wording is Trigger.dev's and a copy-edit there must not look like a broken bring-up. Prints the newest, because an older one may be spent. When it finds nothing it says the link is only written when one is *requested*, which is the actual cause nine times in ten. |
| T4 stop transcribing two opaque strings | ✅ **Built 2026-08-18** | `deploy/compose/trigger-credentials.sh` reads `proj_…` and the prod `tr_prod_…` out of `trigger-db`. **Introspects the schema before querying it** and refuses if the shape is not the one it knows — that schema belongs to Trigger.dev and moves under version bumps. Validates the shape of both values; refuses a `tr_dev_` key (personal to a CLI session, useless from a container); refuses to choose when several projects exist. Every refusal names the two dashboard pages to read instead. |
| T5 the prose companion | ✅ **Built 2026-08-18** | `docs/managed-bring-up.md`. Every command, every script, every button, in order, with a verification per phase, a thirteen-row failure table, and a "what this does not cover" section. |
| T6 make the nightly exercise it | ✅ **Built 2026-08-18** | `e2e-managed.yml` now brings the stack up with `bootstrap-managed.sh --from data --with-demo --no-smoke` instead of an inline copy of the run order. A bring-up script nothing runs is a document with a shebang. |
| T7 the two latent bugs found on the way | ✅ **Fixed 2026-08-18** | Below. |
| T8 first real firing | ⬜ **Open** | Nothing here has met Docker. The `account` and `login` phases are exercised only by a person doing this on a new machine — see "What is still unproven". |

## What this is

The owner's requirement: *"in the past i did setup Trigger.dev on the spark …
however, i'd like the install to be as much automated as possible, so that i
can redo a roll out where ever i want. At minimum all steps need to be
documented, including commands to run, scripts to run, buttons to click."*

The managed stack had been stood up by hand more than once, each time from
notes that were slightly out of date, and the notes lived in three script
headers (`deploy-tasks.sh`, `setup-managed-demo.sh`, `set-task-env.sh`) that
each described one slice of an order none of them owned.

## The step that cannot be automated, and what was done about it instead

0084 T6 was withdrawn on the finding that **the self-hosted Trigger.dev instance
cannot be bootstrapped unattended**: magic-link sign-in, no admin API. That
finding is unchanged and no script removes it.

What this workplan does is make it the **only** human step, and shrink it to
two actions: click a link the script hands you, then type an organisation name
and a project name. Specifically, the two steps flanking it were automated:

- **Before** — the magic link had to be found by eye in `docker logs
  trigger-api`. Now one command prints it.
- **After** — `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY` had to be
  transcribed from two dashboard pages into `.env`. Now they are read back out
  of the instance and shape-checked. **Transcribing an opaque string is the
  kind of step that fails silently**: a `tr_prod_` key one character short does
  not error at `compose up`, it makes every enqueue fail at runtime, hours
  later, on a screen nobody is watching.

## The two latent bugs found on the way (T7)

Neither was the point of the work; both would have cost a bring-up.

1. **`setup-auth.sql` documented a flag it does not read.** Its header said to
   run it with `psql -v pw="'…'"`, but the body reads
   `current_setting('my.pw')` and never references `:pw`. Followed literally,
   `my.pw` is unset, `format('… PASSWORD %L', NULL)` renders as `PASSWORD
   NULL`, and the role is created **with no password** — after which every
   PgBouncer login fails with a message about a password when the problem is a
   role. Header corrected to the `PGOPTIONS="-c my.pw=…"` form, and the DO
   block now **raises** on an unset `my.pw` rather than succeeding into that
   state.

   The ordering this exposed is now written down and enforced by the script:
   Postgres up → `setup-auth.sql` → PgBouncer up. PgBouncer's own healthcheck
   authenticates as the role that SQL creates, so bringing both up together on
   a fresh box hangs at the healthcheck, and the documented order in
   `e2e-managed.yml` only worked because that runner was already configured.

2. **The nightly's seed step depended on the runner's ambient environment.**
   `pnpm --filter @openmig/api seed:managed` runs on the **host**; the seed
   reads `DATABASE_URL`, `JWT_SECRET` and `SECRET_ENCRYPTION_KEY` from its own
   environment and nothing in `apps/api` loads a dotenv file. The workflow
   exported none of them. The `demo` phase exports them from
   `deploy/compose/.env`, pointed at Postgres's **published** port — the pooler
   is internal-only, and migrations must not go through it in any case.

## Two things the script decides that the old order did not

- **Nextcloud is not started unless you ask for it.** `managed.yml` carries it
  for the demo, and a bare `up -d` would publish an admin panel whose password
  is `change-me-nextcloud-admin` by default. Without `--with-demo` the services
  are named explicitly. Not a `profiles:` key on the service: the nightly and
  `setup-managed-demo.sh` both address it by name today, and changing what
  `up` means for an existing stack is a bigger change than this needed.
- **`DEPLOY_IMAGE_PLATFORM` is set from `uname -m`, not merely checked.**
  `managed.env.example` ships `linux/amd64`, so on an **arm64 box the shipped
  default is wrong**, and the failure is task runners that die at `exec` in
  under a second with `AutoRemove` deleting the evidence. `deploy-tasks.sh`
  refuses on a mismatch; the bootstrap owns the file, so it fixes it.

## What is still unproven (T8)

Stated rather than discovered later:

- **No phase from `data` onward has met Docker in this session.** The nightly
  exercises `data` through `tasks` against a stack whose Trigger.dev half
  already exists.
- **`account` and `login` are exercised by nobody but a human on a new
  machine.** That is inherent — they *are* the human steps — and it means the
  wording of those two phases is the part most likely to be subtly wrong. The
  runbook asks whoever finds that to fix it in the same change.
- **The Trigger.dev schema `trigger-credentials.sh` reads is not ours.** It is
  correct against the schema at SDK 4.5.11 / image `v4.5.9` as reasoned from
  the Prisma model names, and it is *guarded* against being wrong: it
  introspects first and validates the shape of what it reads. If a version bump
  moves it, the failure is a refusal naming the dashboard pages, not a wrong
  value written into `.env`.
- **Bring-up from scratch remains untested by CI**, for the reason 0084 gives:
  the gate cannot tear down the half it cannot rebuild.

## See also

- `docs/managed-bring-up.md` — the runbook this workplan produced
- `0084` — the nightly managed gate, and the withdrawal that framed this
- `0082` — PgBouncer, whose lookup role is the ordering trap in T7
- `0020` — the task environment upload and the live smoke this ends with
