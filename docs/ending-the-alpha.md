# Ending the alpha

How the operator ends the alpha on `ownpace-live`, and how to check that it took. **The decision
is the owner's.** This page lists what the decision switches and what must be true before it (*Before*),
and how to tell afterwards that the switch reached every part (*Checks*).

The alpha is one setting in live's `.env`: `OWNPACE_STAGE=alpha`. Ending it means emptying that
setting and deploying a release, so that every process reads the new value. Only live has the
setting. Every other stack (the OTA stack, a developer's, CI, every appliance) already runs
without it, so **the OTA stack shows today what live will do after the switch**. Rehearse there,
not on live.

## What the stage switches

The stage reaches four processes by four different routes. The table names every place where it
enters, held by `scripts/the-end-of-the-alpha-names-every-switch.unit.test.ts`: a file that starts
reading the stage fails that guard until it has a line here.

| Where | How it reads the stage | During the alpha | After it |
|---|---|---|---|
| The API's billing routes: `apps/api/src/routes/billing/index.ts` | `holdsAtCeiling(process.env.OWNPACE_STAGE)` | No yes is taken (409 `nothing_charged_during_the_alpha`). `holds: false`. The Billing panel is titled *What this puts you on* and names what was used. | A yes is taken at the data ceiling and at *Start*, and recorded with its price (`data_allowance`). The panel is titled *What this month bills* and names what the month bills: what it used, never above the agreed tier. |
| The API's start doors: `apps/api/src/routes/migrations/path-lifecycle-wiring.ts` | the same `holdsAtCeiling` | Nothing is refused for running too many at the same time. | A start that takes slots past the agreed tier's paths is refused, 409 `paths_need_a_yes`, and *Start* asks first with both ways on (ADR-0014, 2026-10-04). |
| The API's pace: `apps/api/src/routes/migrations/free-pace.ts` | the same `holdsAtCeiling` | No door is held to a pace, on any tier, and *How often to look for changes* offers every cadence. | On Free: *Sync now* within a day of the migration's last pass is refused, 409 `free_pace`, with when the next pass starts, and the final pass *Finish* asks for never is (workplan 0157 T2). A schedule faster than a day is refused, 409 `free_pace_schedule`. *Start* on a paused migration that ran inside the day waits for the pace. The page offers *Automatic* and *Daily*, and says why (T4). |
| The first-copy email: `apps/worker/src/jobs/the-first-copy-email.ts` | `holdsAtCeiling(process.env.OWNPACE_STAGE)`, in the **task environment**, as the sync tasks read it | Says that everything has arrived and is kept in step, and nothing of a pace. | On Free it adds that keeping in step is one pass a day, and that a higher tier looks as often as every 15 minutes (workplan 0157 T5). |
| The sync tick: `apps/worker/src/jobs/managed-sync-tick.ts` | `holdsAtCeiling(process.env.OWNPACE_STAGE)`, in the **task environment**, as the sync tasks read it | Every tier runs at a paid tier's pace: the first copy back to back, then the migration's schedule. | A migration on Free runs one pass a day, 24 hours after its last pass started, its first copy included, and a Free organisation's files-only migrations take its later turns (workplan 0157 T2, T3). |
| The API's alpha rule: `apps/api/src/access-notify.ts` | `alphaFrom(env)`, read by `conditions-not-accepted.ts`, `config-guards.ts` and the access-granted mail | Every member is asked to accept the Alpha conditions, the privacy policy and the terms before any access is stored, once no text is a draft (0139 T3). The access-granted mail says it is the alpha. A blank `BACKUP_RETENTION_DAYS` stops the API from starting. | Nobody is asked to accept anything. The mail does not mention the alpha. A blank `BACKUP_RETENTION_DAYS` is a warning in production (`stand-up-live.sh` still refuses one on live). |
| The sync tasks: `apps/worker/src/jobs/run-delta-sync.ts` | `process.env.OWNPACE_STAGE`, in the **task environment**, never compose's | Nothing waits at the data ceiling. Every first copy is marked as the alpha's (`bytes_moved.alpha_bytes`, managed 0040) and never counts. | New first copies wait at the ceiling until a yes (0109 T6). First copies count from here. |
| The web bundle: `apps/web/src/components/AlphaNote.tsx` | `import.meta.env.VITE_OWNPACE_STAGE`, **baked in at build** through the build arg in `apps/web/Dockerfile` | The Alpha note on every page, the sign-in page and the request page. A visitor without a session reads a line about the Alpha in the guides instead (workplan 0152 T1 (a)). The acceptance screen on load. The tester-guide link. The Billing page's alpha line, and its invoice-details card saying none are needed. | None of these. The invoice-details card asks for the details unless the tier is Free. |
| The public site: `site/build.mjs` | `process.env.OWNPACE_STAGE` **at build** | The tester guide is built (`/alpha-guide.html`, `/nl/alpha-handleiding.html`). Every page says the Alpha to its visitor in one line under the header (workplan 0152 T1 (a)). | The guide and the line are left out. The Alpha conditions page stays. |
| Compose: `deploy/compose/managed.yml` | `${OWNPACE_STAGE:-}` from live's `.env` | Handed to the api's environment and, as `VITE_OWNPACE_STAGE`, to the web image's build. | The same, empty. The api takes it when its container is recreated; the web only when its image is rebuilt. |
| The task environment: `deploy/compose/set-task-env.sh` | the value in live's `.env` | Uploaded to the tasks. | **Deleted** from the tasks; it prints `deleted OWNPACE_STAGE: no stage is set, so the hold at the data ceiling is on`. A task container inherits nothing from compose, so nothing else reaches it. |
| The live deploy: `deploy/compose/deploy-live.sh` | `env_value` from live's `.env` (`SITE_STAGE`) | Hands `alpha` to the site build. | Hands it an empty stage. |
| The OTA site: `deploy/compose/www.yml` | the OTA stack's `.env` | (the OTA stack has no stage) | Unchanged. |

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
   page names what the month bills. Nothing turns that into an invoice yet. The invoice line
   (workplan 0109 T5) and the bookkeeping (workplan 0111, Moneybird) wait on the Moneybird trial.
   Switching before them takes consent to prices that nobody invoices.
3. **Tell the testers, with their numbers.** No yes could be taken during the alpha, so every
   organisation is on Free at the switch: one migration at a time (each kind of data counts as
   one), and 250 GB, counted from the switch. Everything moved during the alpha never counts
   (the owner, 2026-10-04: *"In total for ever, and the alpha's data doesn't count"*), so every
   organisation starts at 0 GB counted, and its Billing page shows what the alpha moved on a line
   of its own. An organisation already running more than Free runs keeps running: a resume never
   takes a new slot. But it starts nothing new without a yes, and its Billing page says why.
4. **Do not switch back and forth.** Setting `alpha` again later makes everything moved from then
   on the alpha's again. It never counts, and nothing waits at the ceiling. The yeses already taken
   stay. A trial of the switch belongs on the OTA stack.

## The switch

On `ownpace-live`, from `~/ownpace-live`. It is an ordinary release deploy (*`ownpace-live`: a
release tag, with `deploy-live.sh`* in [managed-bring-up.md](./managed-bring-up.md)) with one
`.env` change before it. **A deploy, and not a restart, is what reaches every part:**

- the web image must be rebuilt to drop the note;
- the api container must be recreated to read the new value;
- the tasks get the stage only from `set-task-env.sh`, which the bring-up's `tasks` phase runs;
- the site is rebuilt by the deploy's site step.

`docker compose up -d` alone reaches the api and nothing else.

1. **Tell the testers** (*Before*, step 3), and name the day.
2. **Start the hold and wait for the drain**, as for every deploy: the tick's log says
   `0 pass(es) still in flight`.
3. **Empty the stage in live's `.env`.** Keep the line and leave it empty, so the next reader sees
   it was decided:

   ```bash
   ./deploy/compose/env-upsert.sh ~/.persistent/ownpace-live/.env OWNPACE_STAGE=
   grep -n '^OWNPACE_STAGE' ~/.persistent/ownpace-live/.env    # OWNPACE_STAGE=
   ```

4. **Ask whether the deploy can be undone, then deploy.** Use the tag that runs now or a newer
   release. Running the same tag again is allowed.

   ```bash
   ./deploy/compose/deploy-live.sh --dry-run <tag>
   ./deploy/compose/deploy-live.sh <tag>
   ```

5. **Read its output for the task environment line:**
   `[set-task-env] deleted OWNPACE_STAGE: no stage is set, so the hold at the data ceiling is on`.
   Without it, the tasks still hold the alpha: see *If a check fails*.
6. **Run the checks below, then lift the hold yourself.** Then delete the copy before the update
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
   this month bills*. Its data line counts from 0 (*Data moved, in total: 0 GB of 250 GB*), and
   what the alpha moved is on a line of its own.

After lifting the hold, once passes have copied new items:

6. **First copies count.** During the alpha every meter has `bytes = alpha_bytes`. After the
   switch, an organisation whose pass copied something new has `bytes > alpha_bytes`:

   ```bash
   docker exec -i ownpace-live-db sh -c 'psql -X -At -U "$POSTGRES_USER" -d openmigrate' <<'SQL'
   SELECT count(*) FILTER (WHERE bytes > alpha_bytes) AS counting, count(*) AS meters FROM bytes_moved;
   SQL
   ```

   `counting` stays 0 while passes copy new items only when the tasks still hold the alpha.

## If a check fails

- **The tasks still hold the alpha** (no `deleted OWNPACE_STAGE` line, or `counting` stays 0 while
  passes copy new items). From `~/ownpace-live`, with live's `.env` already empty, run
  `./deploy/compose/set-task-env.sh` and read the line. What moved in between was marked as the
  alpha's and never counts. That errs in the customer's favour, and nothing reverses it.
- **The api still says `[x]` or asks for acceptance.** The api container was not recreated with
  the new `.env`. Run the deploy again with the same tag.
- **The note is still on the pages.** The web image was built with the old value. The deploy's
  `/version.json` check proves a new image, not the stage it was built with. Run the deploy again
  with the same tag, after checking `.env` (step 3).
- **The guide or the line is still on the site.** The site step built with live's old stage, or
  `WWW_LIVE` is not `true`. Check `.env` and run the deploy again.

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
- **Free runs one pass a day.** Each migration on Free copies once a day, 24 hours after its
  last pass started, its first copy included, and *Sync now* waits for the day; the final pass
  before the switch never waits. A paid tier keeps its schedule (workplan 0157 T2).
  *How often to look for changes* offers Free *Automatic* and *Daily* only, and a faster
  schedule kept from a higher tier runs once a day without being rewritten (T4).

Decisions behind this page: ADR-0014 (*Amendment 2026-10-03*, "Not during the alpha", the path
axis and "The data, in total, and the alpha's"), workplan 0109 (T6), workplan 0131 (the alpha and
who is let in), workplan 0139 (the texts), workplan 0086 (whether the paid service asks),
workplan 0157 (each tier's pace).
