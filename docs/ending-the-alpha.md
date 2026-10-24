# Ending the alpha

How the operator ends the alpha on `ownpace-live`, and how to check that it took. **The decision
is the owner's.** This page lists what the decision switches and what must be true before it (*Before*),
and how to tell afterwards that the switch reached every part (*Checks*).

The alpha is one setting in live's `.env`: `OWNPACE_STAGE=alpha`. Ending it means emptying that
setting and deploying a release, so that every process reads the new value.

**The OTA stack takes live's stage.** The owner checks a deploy there before it reaches live
(the owner, 2026-10-05), so OTA runs the alpha as live does. With the stage set, OTA's `.env`
also needs `BACKUP_RETENTION_DAYS`: 0 when nothing backs up its database. Left blank, the API
refuses to start during the alpha. Every other stack (a developer's, CI, every appliance) runs
without the stage. **Rehearse the switch on the OTA stack:** empty the stage there first, check
it, and only then on live.

## What the stage switches

The stage reaches four processes by four different routes. The table names every place where it
enters, held by `scripts/the-end-of-the-alpha-names-every-switch.unit.test.ts`: a file that starts
reading the stage fails that guard until it has a line here.

| Where | How it reads the stage | During the alpha | After it |
|---|---|---|---|
| The API's billing routes: `apps/api/src/routes/billing/index.ts` | `holdsAtCeiling(process.env.OWNPACE_STAGE)` | No yes is taken (409 `nothing_charged_during_the_alpha`), and no tier is picked (the same 409 from `POST /api/billing/pick`). `holds: false`. The Billing panel is titled *What this puts you on* and names what was used. *Pick a tier* lists the tiers above it with their prices and no button, and says every tier is free during the Alpha. | A yes is taken at the data ceiling and at *Start*, and recorded with its price (`data_allowance`). A tier may be picked, by the order button (workplan 0157 T6): a raise counts at once, a lower pick from the next month (`tier_pick`, managed 0044), and a pick above the agreed tier is a yes as well. The panel is titled *What this month bills* and names what the month bills: what it used, never above the agreed tier, and never below the tier picked. |
| The API's start doors: `apps/api/src/routes/migrations/path-lifecycle-wiring.ts` | the same `holdsAtCeiling` | Nothing is refused for running too many at the same time. | A start that takes slots past the agreed tier's paths is refused, 409 `paths_need_a_yes`, and *Start* asks first with both ways on (ADR-0014, 2026-10-04). |
| The API's pace: `apps/api/src/routes/migrations/free-pace.ts` | the same `holdsAtCeiling` | No door is held to a pace, on any tier, and *How often to look for changes* offers every cadence. | On Free: *Sync now* within a day of the migration's last pass is refused, 409 `free_pace`, with when the next pass starts, and the final pass *Finish* asks for never is (workplan 0157 T2). A schedule faster than a day is refused, 409 `free_pace_schedule`. *Start* on a paused migration that ran inside the day waits for the pace. The page offers *Automatic* and *Daily*, and says why (T4). |
| The first-copy email: `apps/worker/src/jobs/the-first-copy-email.ts` | `holdsAtCeiling(process.env.OWNPACE_STAGE)`, in the **task environment**, as the sync tasks read it | Says that everything has arrived and is kept in step, and nothing of a pace. | On Free it adds that keeping in step is one pass a day, and that a higher tier looks as often as every 15 minutes (workplan 0157 T5). |
| The slower-cadence email: `apps/worker/src/jobs/the-slower-cadence-email.ts` | `holdsAtCeiling(process.env.OWNPACE_STAGE)`, in the **task environment**, as the sync tasks read it | Each slower step of a migration on *Automatic* is said by the morning mail, on every tier: every 6 hours after 14 days in step, once a day after 30 (workplan 0157 T7). | On Free nothing is said, and a step said before is no longer in force: a migration there runs one pass a day whatever its cadence. A paid tier as during the alpha. |
| The sync tick: `apps/worker/src/jobs/managed-sync-tick.ts` | `holdsAtCeiling(process.env.OWNPACE_STAGE)`, in the **task environment**, as the sync tasks read it | Every tier runs at a paid tier's pace: the first copy back to back, then the migration's schedule. | A migration on Free runs one pass a day, 24 hours after its last pass started, its first copy included, and a Free organisation's files-only migrations take its later turns (workplan 0157 T2, T3). |
| The month's invoices: `apps/worker/src/jobs/managed-month-invoices.ts` | `holdsAtCeiling(process.env.OWNPACE_STAGE)`, in the **task environment**, as the sync tasks read it, beside `OWNPACE_BILLING_FROM` | Nobody is invoiced, whatever `OWNPACE_BILLING_FROM` says. The hourly run says so and reads nothing about any organisation. | From the month `OWNPACE_BILLING_FROM` names, and never while it is empty: each organisation's month is invoiced in advance, on its first day at the tier it starts on, and after a move up for the difference (workplan 0111, slice 4). Free is never invoiced. |
| The invoices' push: `apps/worker/src/jobs/managed-invoice-push.ts` | the same `whyNobodyIsInvoiced`, in the **task environment** | Nothing is sent to Moneybird. The hourly run says so and reads nothing about any organisation. | Each draft is numbered by Moneybird, within the hour it was made, once `OWNPACE_BILLING_FROM` is set and the `MONEYBIRD_*` keys reach the tasks (workplan 0111, slice 5). |
| The API's alpha rule: `apps/api/src/access-notify.ts` | `alphaFrom(env)`, read by `conditions-not-accepted.ts`, `config-guards.ts` and the access-granted mail | Every member is asked to accept the Alpha conditions, the privacy policy and the terms before any access is stored, once no text is a draft (0139 T3). The access-granted mail says it is the alpha. A blank `BACKUP_RETENTION_DAYS` stops the API from starting. | Nobody is asked to accept anything. The mail does not mention the alpha. A blank `BACKUP_RETENTION_DAYS` is a warning in production (`stand-up-live.sh` still refuses one on live). |
| The sync tasks: `apps/worker/src/jobs/run-delta-sync.ts` | `process.env.OWNPACE_STAGE`, in the **task environment**, never compose's | Nothing waits at the data ceiling. Every first copy is marked as the alpha's (`bytes_moved.alpha_bytes`, managed 0040) and never counts. | New first copies wait at the ceiling until a yes (0109 T6). First copies count from here. |
| The web bundle: `apps/web/src/components/AlphaNote.tsx` | `import.meta.env.VITE_OWNPACE_STAGE`, **baked in at build** through the build arg in `apps/web/Dockerfile` | The Alpha note on every page, the sign-in page and the request page. A visitor without a session reads a line about the Alpha in the guides instead (workplan 0152 T1 (a)). The acceptance screen on load. The tester-guide link. The Billing page's alpha line, and its invoice-details card saying none are needed. | None of these. The invoice-details card asks for the details unless the tier is Free. |
| The public site: `site/build.mjs` | `process.env.OWNPACE_STAGE` **at build** | The tester guide is built (`/alpha-guide.html`, `/nl/alpha-handleiding.html`). Every page says the Alpha to its visitor in one line under the header (workplan 0152 T1 (a)). | The guide and the line are left out. The Alpha conditions page stays. |
| Compose: `deploy/compose/managed.yml` | `${OWNPACE_STAGE:-}` from live's `.env` | Handed to the api's environment and, as `VITE_OWNPACE_STAGE`, to the web image's build. | The same, empty. The api takes it when its container is recreated; the web only when its image is rebuilt. |
| The task environment: `deploy/compose/set-task-env.sh` | the value in live's `.env` | Uploaded to the tasks. | **Deleted** from the tasks; it prints `deleted OWNPACE_STAGE: no stage is set, so the hold at the data ceiling is on`. A task container inherits nothing from compose, so nothing else reaches it. |
| The env check: `deploy/compose/ensure-env-secrets.sh` | `env_value` from the stack's `.env`, as the bring-up's env phase and the gate's Fill step run it | A blank `BACKUP_RETENTION_DAYS` is written as `0` off live, where no copy is kept, so the API can start; on live it writes nothing and names 7 (workplan 0134). | Nothing: the API only warns about a blank line, and a value written during the alpha stays. |
| The live deploy: `deploy/compose/deploy-live.sh` | `env_value` from live's `.env` (`SITE_STAGE`) | Hands `alpha` to the site build. | Hands it an empty stage. |
| The OTA site: `deploy/compose/www.yml` | the OTA stack's `.env` | `alpha`, as live's: the tester guide and the line, as on live's site. | Emptied on the OTA stack first, as the rehearsal. |

## Before: what must be true first

These are facts from the repository. Each one is a reason **not** to switch yet. Deciding them is
the owner's job.

1. **The new conditions, and each tester's yes to them.** The owner decided on 2026-09-28 that
   everything carries on after the alpha under new conditions, which each tester accepts first
   (workplan 0131 §3 T4, answer (b)). Today the texts a member accepts are the Alpha conditions,
   the privacy policy and the terms (`packages/managed/src/legal-versions.ts`), and the API asks
   for them **only while the stage is `alpha`** (`acceptanceAsked` in
   `apps/api/src/conditions-not-accepted.ts`). Emptying the stage as the code stands asks nobody
   anything. So the new conditions, and a gate that asks for them outside the alpha, come first.
   `legal-versions.ts` says the new conditions replace the Alpha's there, and whether the paid
   service asks at all is workplan 0086's question. 0131 §3 T4 lists the rest of what (b) needs:
   a restore procedure if the service moves host (0134 T5), the new host in the privacy texts
   (0139 T5), the run-row retention rule (0143 T6), and the Google test-user entries kept.
2. **The invoice.** After the switch a yes is taken and recorded with its price, and the Billing
   page names what the month bills. The month task makes each month's invoice in advance, as a
   draft, from the month `OWNPACE_BILLING_FROM` names (workplan 0111, slice 4,
   `managed-month-invoices`), and the hourly push has Moneybird number each one
   (`managed-invoice-push`, slice 5) once live's `MONEYBIRD_*` keys are set and uploaded to the
   tasks. The Billing page names the legal number (slice 5b), the invoice details are asked
   before leaving Free (decision 14, slice 5e), and a consumer can withdraw (slices 7a to 7c).
   A payment Mollie confirms is booked on its invoice in Moneybird, on the account
   `MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE` names, and paid and late are read back from Moneybird
   every hour (slice 5f; the owner, 2026-10-11). Every yes is given at an order button that
   says, for a consumer within the fourteen days, that ordering asks us to begin at once, and
   each order is confirmed by email (slice 7e, terms §7): a withdrawal then bills the days
   used. A credit note's amount is made real once the books number it (slice 7d, its second
   half): refunded through Mollie with live's `MOLLIE_API_KEY`, which `set-task-env.sh` hands to
   the tasks, settled against its invoice in the books, or said to the operator for a transfer
   by hand. Each refund is followed until Mollie says it ended: one that failed is said for a
   transfer by hand and not booked, and one still going a week after it was made is said once.

   **A year paid ahead** can be bought on the Billing page (0111 T11; ADR-0014, *Amendment
   2026-10-12*): one invoice of credit at six months' price, each month drawing its tier at half
   price, and one email a month before the credit runs out. Two answers come before the first
   year is sold: the accountant's on VAT for credit a customer may spend on any tier, and the
   lawyer's question 27 (terms §8, and what a withdrawn year costs).

   Terms §7 has the lawyer's agreement, and the two Moneybird calls of slice 7d passed in the
   sandbox (`register_payment_creditinvoice` on a credit note crediting part of an open invoice,
   and a negative payment booked on a credit note; the owner, 2026-10-11, with
   `./deploy/compose/moneybird-money-back-proof.sh`), and so did Mollie's refund in test mode
   (the same script with `refund`). **Before invoices reach customers, live needs its books and
   payments**, each step as *8i. The books and payments* in
   [managed-bring-up.md](./managed-bring-up.md) says, run in live's checkout:
   - **live's own Moneybird administration**, a real one: its token and id, then its workflow
     and tax rate ids from `./deploy/compose/operator.sh moneybird check`, which only reads and is
     safe on live. None of the sandbox's ids carry over;
   - **`MONEYBIRD_DELIVERY=email`**, so that Moneybird e-mails each invoice;
   - **the outside-EU rate**, or none, as the accountant answers;
   - **Mollie's onboarding of the business finished**, and its `live_` key as `MOLLIE_API_KEY`,
     with `API_URL` live's public https address, where Mollie confirms each payment;
   - **the financial account Mollie pays out from**, made in live's administration, as
     `MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE`, and the accountant's answer on how Moneybird's own
     link to Mollie matches the payments and refunds Ownpace books there;
   - **the API recreated and `set-task-env.sh` run**, then the check again, which ends
     `RESULT: ready`.
   - **a way to hear the money you owe**: the hourly push mails a credit note to pay back by hand,
     a refund that failed and one running late to `NOTIFY_TO`, so live's SMTP settings and
     `NOTIFY_TO` reach the tasks, and lists each on the support screen's *Money to give back*
     until you mark it given back. The [operator runbook](./operator-runbook.md)
     (`managed-invoice-push`) says what each asks of you.

   The proofs do not run on live; each refuses it. Leave `OWNPACE_BILLING_FROM` empty until all
   of this is done, and until the whole chain has been walked once on the OTA stack, as
   [billing-rehearsal-on-ota.md](./billing-rehearsal-on-ota.md) says: a tier ordered, the month
   invoiced, numbered, paid and booked, a year bought, and a withdrawal that credits and refunds
   it all.
3. **Tell the testers, with their numbers.** No yes could be taken during the alpha, so every
   organisation is on Free at the switch: six paths at the same time (each kind of data in a
   migration is one), 150 GB counted from the switch, and one pass a day (ADR-0014). Everything
   moved during the alpha never counts (the owner, 2026-10-04: *"In total for ever, and the
   alpha's data doesn't count"*), so every organisation starts at 0 GB counted, and its Billing
   page shows what the alpha moved on a line of its own. An organisation already running more than Free runs keeps running: a resume never
   takes a new slot. But it starts nothing new without a yes, and its Billing page says why.
4. **Do not switch back and forth.** Setting `alpha` again later makes everything moved from then
   on the alpha's again. It never counts, and nothing waits at the ceiling. The yeses already taken
   stay. A trial of the switch belongs on the OTA stack: the
   [billing rehearsal](./billing-rehearsal-on-ota.md) is one, and ends by switching back.

## The switch

On `ownpace-live`, from `~/ownpace-live`. It is an ordinary release deploy (*`ownpace-live`: a
release tag, with `deploy-live.sh`* in [managed-bring-up.md](./managed-bring-up.md)) with one
`.env` change before it. **A deploy, and not a restart, is what reaches every part:**

- the web image must be rebuilt to drop the note;
- the api container must be recreated to read the new value;
- the tasks get the stage only from `set-task-env.sh`, which the bring-up's `tasks` phase runs;
- the site is rebuilt by the deploy's site step.

`docker compose up -d` alone reaches the api and nothing else.

One step is not about the stage: the background tasks' history is emptied first, under the same
hold (step 3), because the privacy policy promises it for the end of the Alpha.

1. **Tell the testers** (*Before*, step 3), and name the day.
2. **Start the hold and wait for the drain**, as for every deploy: the tick's log says
   `0 pass(es) still in flight`.
3. **Empty the background tasks' history**, on live only. Privacy §9 keeps their records *"Until
   the end of the Alpha at the latest: then the background tasks start with an empty history."*
   That history is in every store the task runner writes, not in its own database alone
   (Trigger.dev v4.7.2):
   - **`triggerdb`**, its database: the runs, their payloads, outputs and errors, and their log
     events (`EVENT_REPOSITORY_DEFAULT_STORE` is not set, so they are kept there).
   - **ClickHouse**, although runs are not copied there (`RUN_REPLICATION_ENABLED` is not set,
     which is why its dashboard's Runs page is empty). Every task process sends its host and
     Node.js metrics, collected every 10 seconds, to `trigger_dev.metrics_v1`, whatever either key
     says. Each row carries the run's id, its task and attempt, and Trigger.dev's ids of the
     organisation, project and environment, and is kept 60 days.
   - **Redis**, the queues: a run that died keeps its id in its queue's set for good.
   - **MinIO**: a payload of 512 KB or more, or an output of 128 KB or more.

   `reset-trigger.sh` removes `triggerdb`, and the two lines after it remove the other three, each
   container and volume. Nothing of the application is touched: its database, with every
   organisation, migration, run log and invoice, is another one, and only the task runner uses
   these four. Start only once the drain is done and the hold is at least
   `DEPLOY_LIVE_QUIET_MINUTES` old (5 by default), as `deploy-live.sh` asks before it replaces the
   task containers. A pass the tick queued just before the hold is in no count until it starts,
   and the reset would end it halfway, its run left `running` until the tick takes it for dead two
   hours later. `./deploy/compose/deploy-live.sh --dry-run <tag>` says
   `the hold is on and nothing is in flight` once both are true. Then, **before the `.env` change
   in step 4**:

   ```bash
   ./deploy/compose/reset-trigger.sh --yes
   docker compose -f deploy/compose/managed.yml rm -s -f trigger-redis clickhouse minio
   docker volume rm ownpace-live_redis_data ownpace-live_clickhouse_data_v2 ownpace-live_clickhouse_logs ownpace-live_minio_data_v2
   ./deploy/compose/ensure-env-secrets.sh
   ./deploy/compose/bootstrap-managed.sh --from trigger
   ```

   MinIO's store has been `ownpace-live_minio_data_v2` since alpha.2 (Chainguard's build, workplan
   0146 T7). The Bitnami-era `ownpace-live_minio_data` is the owner's to remove after that deploy;
   if `docker volume ls` still lists it here, it holds the packets of the weeks before alpha.2, so
   remove it in this step too, with `docker volume rm ownpace-live_minio_data`.

   A volume `docker volume rm` refuses is one something still holds: see *If a check fails*. The
   bring-up starts the task runner and its stores empty (`trigger-api` applies ClickHouse's
   schema when it starts, and `minio-init` makes MinIO's `packets` bucket) and stops at its
   `account` phase (exit 2) with the one human step: on live's Trigger.dev dashboard, sign in and
   name an organisation and a project. Then:

   ```bash
   ./deploy/compose/bootstrap-managed.sh --from account
   ```

   It reads the new project's ref and key into live's `.env` and stops once more (exit 2) for the
   deploy CLI's login under live's own profile: the old login went with the old database. Run the
   `npx -y trigger.dev@… login … --profile …` line it prints, then:

   ```bash
   ./deploy/compose/bootstrap-managed.sh --from login
   ```

   That finishes: the app brought up with the new key, the task environment uploaded and the
   tasks deployed, all under the hold. Not `stand-up-live.sh --resume`: it refuses once live's
   deploy log has a line. The task deploy can strip `apps/worker/package.json`'s last newline, and
   the deploy in step 5 refuses a tree that is not clean: if `git status` shows only that file,
   `git checkout -- apps/worker/package.json`.

   - **Why before the `.env` change:** the new project then takes the stage with its task
     environment, and the deploy's `set-task-env.sh` deletes it and prints the line step 6 reads.
     Reset after the change, and the new project never held the stage, so that line never comes.
     And the copy the deploy takes before the update holds the new, empty database.
   - **What still holds the old history, and how long:** a copy before an update taken in the
     week before, when its tag moved the Trigger.dev pin, until that update is proven and after
     day 6 at the latest (privacy §9's row for that copy). Live keeps no daily dumps of the task
     runner's database: `trigger-version.sh` refuses its drill there. No copy or dump takes
     ClickHouse, Redis or MinIO, and each container removed takes its log with it.
   - **The OTA stack is not in the promise**, which is live's. A rehearsal there is optional, with
     its own project's volume names (`ownpace-managed_…`): it costs that stack its dashboard step,
     and the gate's CLI login (its `TRIGGER_ACCESS_TOKEN`, or the session it restores) was made on
     the old instance and has to be made again.

   *Checks*, step 6, proves it.
4. **Empty the stage in live's `.env`.** Keep the line and leave it empty, so the next reader sees
   it was decided:

   ```bash
   ./deploy/compose/env-upsert.sh ~/.persistent/ownpace-live/.env OWNPACE_STAGE=
   grep -n '^OWNPACE_STAGE' ~/.persistent/ownpace-live/.env    # OWNPACE_STAGE=
   ```

   **And name the first month invoiced**, the month the switch happens in, once the invoice can
   be sent (*Before*, step 2). Empty, nobody is invoiced (workplan 0111, decision 7):

   ```bash
   ./deploy/compose/env-upsert.sh ~/.persistent/ownpace-live/.env OWNPACE_BILLING_FROM=2026-11   # the month of the switch
   grep -n '^OWNPACE_BILLING_FROM' ~/.persistent/ownpace-live/.env
   ```

5. **Ask whether the deploy can be undone, then deploy.** Use the tag that runs now or a newer
   release. Running the same tag again is allowed.

   ```bash
   ./deploy/compose/deploy-live.sh --dry-run <tag>
   ./deploy/compose/deploy-live.sh <tag>
   ```

6. **Read its output for the task environment line:**
   `[set-task-env] deleted OWNPACE_STAGE: no stage is set, so the hold at the data ceiling is on`.
   Without it, the tasks still hold the alpha: see *If a check fails*.
7. **Run the checks below, then lift the hold yourself.** Then delete the copy before the update
   once the update is proven, as after every deploy.

## Checks

Before lifting the hold:

1. **The api reads an empty stage.**

   ```bash
   docker compose -f deploy/compose/managed.yml exec -T api sh -c 'printf "[%s]\n" "$OWNPACE_STAGE"'   # []
   ```

2. **The api asks nobody to accept the texts.** Its start log has neither
   `[api] asking every member to accept` nor `[api] OWNPACE_STAGE=alpha`:

   ```bash
   docker compose -f deploy/compose/managed.yml logs api 2>&1 | grep -c -e '\[api\] asking every member to accept' -e '\[api\] OWNPACE_STAGE=alpha'   # 0
   ```

3. **The web bundle has no alpha.** `https://app.ownpace.eu/login` shows no Alpha note, and
   neither does any signed-in page. `https://app.ownpace.eu/docs`, opened in a private window,
   shows no line about the Alpha under its title.
4. **The site has no tester guide, and no line about the Alpha** (only with `WWW_LIVE=true`):

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://www.ownpace.eu/alpha-guide.html        # 404
   curl -s -o /dev/null -w '%{http_code}\n' https://www.ownpace.eu/nl/alpha-handleiding.html  # 404
   curl -s https://www.ownpace.eu/ | grep -c 'class="visitor-line"'                          # 0
   ```

5. **Billing, as the owner of your own organisation.** The Billing page's panel is titled *What
   this month bills*. Its data line counts from 0 (*Moved in total, counted: 0 GB of 250 GB*), and
   what the alpha moved is on a line of its own.
6. **The background tasks start with an empty history** (*The switch*, step 3). Every store the
   task runner writes is new: each volume was made in step 3, and the oldest run in `triggerdb`
   and the oldest metrics row in ClickHouse are younger than the reset, or there are none yet.
   Both read in UTC. `clickhouse-client` takes the container's own user and password, so none is
   typed.

   ```bash
   docker volume inspect -f '{{.Name}} {{.CreatedAt}}' ownpace-live_trigger_db_data ownpace-live_redis_data ownpace-live_clickhouse_data_v2 ownpace-live_clickhouse_logs ownpace-live_minio_data_v2   # each at step 3
   docker compose -f deploy/compose/managed.yml exec -T trigger-db psql -X -At -U trigger -d triggerdb -c 'SELECT min("createdAt") FROM "TaskRun"'   # after the reset, or empty
   docker compose -f deploy/compose/managed.yml exec -T clickhouse clickhouse-client --query "SELECT count(), min(bucket_start) FROM trigger_dev.metrics_v1"   # 0, or an oldest after the reset
   ```

After lifting the hold, once passes have copied new items:

7. **First copies count.** During the alpha every meter has `bytes = alpha_bytes`. After the
   switch, an organisation whose pass copied something new has `bytes > alpha_bytes`:

   ```bash
   docker exec -i ownpace-live-db sh -c 'psql -X -At -U "$POSTGRES_USER" -d openmigrate' <<'SQL'
   SELECT count(*) FILTER (WHERE bytes > alpha_bytes) AS counting, count(*) AS meters FROM bytes_moved;
   SQL
   ```

   `counting` stays 0 while passes copy new items only when the tasks still hold the alpha.

8. **The month task invoices**, when `OWNPACE_BILLING_FROM` is set: its next run, at :23 past the
   hour, logs `[month-invoices] { invoicing: true, month: '…', … }`, and not `nobody is invoiced`.
   An organisation on a paid tier has a draft for the month under
   `ownpace-{organisation}-m-{YYYY-MM}-{tier}`; one on Free has none.

## If a check fails

- **The tasks still hold the alpha** (no `deleted OWNPACE_STAGE` line, or `counting` stays 0 while
  passes copy new items). From `~/ownpace-live`, with live's `.env` already empty, run
  `./deploy/compose/set-task-env.sh` and read the line. What moved in between was marked as the
  alpha's and never counts. That errs in the customer's favour, and nothing reverses it.
- **The api still says `[x]` or asks for acceptance.** The api container was not recreated with
  the new `.env`. Run the deploy again with the same tag.
- **The note is still on the pages.** The web image was built with the old value. The deploy's
  `/version.json` check proves a new image, not the stage it was built with. Run the deploy again
  with the same tag, after checking `.env` (step 4).
- **The guide or the line is still on the site.** The site step built with live's old stage, or
  `WWW_LIVE` is not `true`. Check `.env` and run the deploy again.
- **The history is not empty** (check 6), with the hold still on. A volume made before step 3,
  or a row older than the reset, is a volume that was not removed. `reset-trigger.sh` says so and
  exits 1, `docker volume rm` names the one it refused, and
  `docker ps -a --filter volume=<its name>` names what still holds it.
  - `ownpace-live_trigger_db_data`: run step 3 again.
  - One of the others: stop what holds it, then, from `~/ownpace-live`:

    ```bash
    docker compose -f deploy/compose/managed.yml rm -s -f trigger-supervisor trigger-api trigger-redis clickhouse minio
    docker volume rm <its name>
    ./deploy/compose/bootstrap-managed.sh --from trigger
    ```

    That starts them again and walks the rest with the project the task runner has, so there is
    no dashboard step. Then the `git checkout` of step 3 if `git status` shows that file, and
    check 6 again.

## What changes for customers

Support should know before the day:

- **The alpha is no longer said anywhere:** no note on the pages, no paragraph in the
  access-granted mail, no tester guide on the site, no line about it on the site or in the
  guides, no acceptance screen.
- **Billing.**
  - The panel names what the month bills.
  - Data counts from the switch, and the alpha's is shown apart, never counted.
  - At the data ceiling, new items wait for a choice: move up, or buy another band once. Updates
    to what is already copied carry on.
  - A start that would run more at the same time than the tier runs asks first, with the price,
    side by side with starting what fits now.
- **Every organisation is on Free until it says yes.** See *Before*, step 3.
- **The task runner starts with an empty history** (*The switch*, step 3). A customer sees no
  difference: migrations, their run logs and their settings are in the application's database. A
  failed run's reference from before the switch is looked up on the operator log page as before:
  that page is the application's too.
- **Free runs one pass a day.** Each migration on Free copies once a day, 24 hours after its
  last pass started, its first copy included, and *Sync now* waits for the day; the final pass
  before the switch never waits. A paid tier keeps its schedule (workplan 0157 T2).
  *How often to look for changes* offers Free *Automatic* and *Daily* only, and a faster
  schedule kept from a higher tier runs once a day without being rewritten (T4).

Decisions behind this page: ADR-0014 (*Amendment 2026-10-03*, "Not during the alpha", the path
axis and "The data, in total, and the alpha's"), workplan 0109 (T6), workplan 0131 (the alpha and
who is let in), workplan 0139 (the texts, and privacy-task-records (a): the background tasks'
records until the end of the Alpha), workplan 0086 (whether the paid service asks),
workplan 0157 (each tier's pace).
