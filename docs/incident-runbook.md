# When something is wrong: alerts and tester reports

What the operator of a managed deployment does when the status page goes red, an alert
arrives, or a tester says something happened to their data (workplan 0142 T6). It is written for
`ownpace-live` during the alpha, and holds for any managed deployment. The appliance has its own
operator, who is also its only user.

This page holds no secrets and no names. Keep the record of each incident outside the repository,
because it names testers.

Commands run from the stack's own checkout (`~/ownpace-live` for live, 0132 T1b), and every
`docker compose` below means `docker compose -f deploy/compose/managed.yml` from there.

## Who is told, and what is promised

The owner, alone (0142 D1): the one person who is told and the one who acts. Nobody else is on the
machine or the mesh, so an alert that reached someone else could not be acted on.

The alpha promises best effort and no response time (0142 D2). What testers are told of it is the
sentence 0142 T0 gives 0139's alpha conditions. An alert is not a page: nothing here is meant to
wake anyone.

## Where signals arrive

- **The status page.** Each Ownpace row below goes red on its own. The page also e-mails the owner
  when a row stays red for three minutes, and again when it is green again, where `ALERT_ENABLED`
  is `true` (0142 T1): on live, once 0133's relay carries its mail. The mail names the row below.
  On the OTA stack it is off, and the page has to be looked at.
- **A tester's report,** through the report form (0130), which on live sends it as a mail to the
  support mailbox (no Zammad runs during the alpha, 0130 T5), or by mail to the address in the
  alpha conditions (0131 T5).
- **GitHub's own notifications:** a red scheduled run (the nightly gate on the OTA stack, and the
  lanes 0141 T13 makes evidence), and an issue the weekly image watch opens (0135 T7, 0146 T8).
  GitHub sends these where the account's notification settings say, which cannot be seen from
  here. 0142 T0's first step checks them.

## One row per alert

The name in the first column is the row's name on the status page (`deploy/compose/gatus.yaml`),
and an alert carries the same name. `scripts/a-runbook-for-every-alert.unit.test.ts` fails when a
row of the page's Ownpace group, or anything on the page that sends an alert, has no row here.

If every Ownpace row went red at once, start with the machine, its connection and the front that
terminates TLS for the public names, not with a service. The page runs on the same machine
(`status-page.md`, *Start here*), so a machine that is down sends nothing at all (0142 T5).

| Row | What it means | Look first | First thing to do |
|---|---|---|---|
| **Web app** | The web app did not answer at the public address (`STATUS_WEB_URL`). Testers get no page at all. | `docker compose ps web`, then `docker compose logs --tail 100 web`. If `web` is running, the front that terminates TLS for the public name. | If `web` exited, read its last lines, then `docker compose up -d web`. |
| **API** | `/api/health` did not answer `ok`: the API is down, or the web app cannot reach it. Every screen fails, and sign-in with it. | `docker compose ps api`, then `docker compose logs --tail 200 api`. | An API that exits at start says why in its last lines: a setting it refuses, or a migration. Fix that, then `docker compose up -d api`. |
| **Database** | `/api/ready` says `database: down`: the API is up, and its `SELECT 1` through the pooler fails. Nothing can be read or written. | `docker compose ps postgres pgbouncer`, then the API's log for `[ready] database unreachable`, then `docker compose logs --tail 100 postgres` and `docker compose logs --tail 100 pgbouncer`. | The pooler's rows in the bring-up guide's failure table ([`managed-bring-up.md`](./managed-bring-up.md), *When it goes wrong*). |
| **Sign-in** | `/api/ready` says `signIn: down`: the API cannot fetch the identity provider's keys, at `JWT_JWKS_URI`, or at the issuer's discovery document when that is not set. Nobody can sign in, even when the provider itself is up. | The *Identity provider* row. If it is green, the API's log for `[ready] the issuer's key source`, which names the address it asked. | The sign-in rows of the bring-up guide's failure table. |
| **Identity provider** | The identity provider's `/debug/ready` did not answer over the status page's own network. Nobody can sign in or register. | `docker compose ps zitadel`, then `docker compose logs --tail 200 zitadel`. | The identity provider's rows of the bring-up guide's failure table: the container is named `<project>-idp` there. |
| **Website** | The public site did not answer at `STATUS_SITE_URL`. It is a separate deploy (`www.yml`), and the app is not affected. The row is on only where `STATUS_SITE_ENABLED` is `true`. | **Live's, `www.ownpace.eu`** (workplan 0139 T10), from `~/ownpace-live`, each `docker compose` command with the `-p` (`www-live.sh` builds the name itself): `./deploy/compose/www-live.sh check`, then `docker compose -p ownpace-live-www -f deploy/compose/www.yml --env-file deploy/compose/.env ps`, then the same with `logs --tail 100`. **The OTA site's**, in its checkout: `docker compose -f deploy/compose/www.yml ps`, then its logs; a copy brought up with `-p` takes the same `-p` on each ([`managed-bring-up.md`](./managed-bring-up.md), *The public site*). | **Live's:** to restart it as it is, from `~/ownpace-live`, exactly `docker compose -p ownpace-live-www -f deploy/compose/www.yml --env-file deploy/compose/.env up -d --force-recreate`. Without the `-p` the site lands in live's own project, where one `--remove-orphans` removes live or the site. A new build is `deploy-live.sh`'s, with a tag ([`managed-bring-up.md`](./managed-bring-up.md), *`www.ownpace.eu`: live's copy*). **The OTA site's:** `docker compose -f deploy/compose/www.yml up -d`, in its checkout, with that `-p` if it has one. No workflow recreates either. |
| **Scheduled syncs** | On the public page (0142 T2, and its open question 3). `GET /api/ready/scheduler` says `down`: the sync tick has not completed a run in five minutes, so no scheduled pass starts. A pass started by hand still runs. A held tick still beats, so the hold is not the cause. | The runs of `managed-sync-tick` in live's own Trigger.dev dashboard (0132 T1c), then `docker compose ps trigger-supervisor trigger-api` and `docker compose logs --tail 100 trigger-supervisor`. | The operator runbook's *Health & troubleshooting*: the tasks are not deployed, or the supervisor is down. Or the tick's runs fail naming `MAX_PASSES_IN_FLIGHT` or `MAX_PASSES_PER_ORGANISATION`: the value in the task environment is not a whole number of at least 1 (workplan 0143 T1). Fix it in `.env` and run `set-task-env.sh`. |

## When a tester reports trouble with their data

1. **Find it.** Ask for the reference number the screen showed (0129, 0130), and look it up on
   the log page, `/support/log`, which filters by reference.
2. **Name the kind.** Something missing at the target; something changed or removed that should
   not have been; something in the wrong place or the wrong organisation; or a credential.
3. **Stop it spreading.**
   - **If other testers could be touched, or anything could be removed,** start the hold on live,
     with a sentence in Dutch. It is on the operator's first support screen, under *Hold new
     passes*. It stops scheduled passes, and it is shown to every signed-in tester. Since 0132 T6
     (b) it also refuses what a tester starts by hand, *Sync now* among it, until it is lifted
     ([`managed-bring-up.md`](./managed-bring-up.md), *Draining first*).
   - **So that nothing starts again when the hold is lifted,** ask the affected tester to pause the
     migration (*Pauzeren*, *Pause* in English, on the migrations list or the migration's page),
     and not to press *Synchroniseer nu* (*Trigger sync*) until told.
   - **If one organisation's migrations have to stop at once** (0143 T2d), do it as the database
     owner on live's database. `docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`
     opens it. Write down the id and status of each of the organisation's migrations in a state
     that runs passes; the list is what puts each one back:

     ```sql
     SELECT id, status FROM mailbox_mapping
      WHERE tenant_id = '<organisation id>' AND status IN ('active', 'continuous');
     ```

     Then move each by the lifecycle's own table (`updateTransition` in
     `packages/shared/src/lifecycle.ts`):

     ```sql
     UPDATE mailbox_mapping SET status = 'paused'  WHERE id = '<id>' AND status = 'active';
     UPDATE mailbox_mapping SET status = 'cutover' WHERE id = '<id>' AND status = 'continuous';
     ```

     - An `active` migration goes to `paused`: the table's *pause*.
     - A `continuous` migration goes to `cutover`: the table's *stop*. Never to `paused`. The table
       refuses it, because after a cutover the source is no longer the authority on what exists
       (0117 D4). From `paused`, a press of *Start sync* would make it `active` again and bring
       the deletion detector back.
     - A pass in flight stops starting new items within about fifteen seconds and finishes the
       ones it has begun (a very large file can take longer), because each pass re-reads its
       migration between data types and every `PASS_REREAD_EVERY_MS` inside one. Until
       2026-09-29 it re-read between data types only, and a pause pressed during a file pass
       waited up to fifty minutes for the pass's own deadline.
     - The tester can undo it: *Start sync* (*Start synchronisatie*) from `paused`, or entering
       the lane again from `cutover`.
       Write to them, as the owner does anyway.
     - It goes around the route, row security and the status-change record the route writes (0109
       T1). Note the date and the organisation in the incident's record.
4. **Keep the evidence.** Do not redeploy, restart, prune or reset live before the relevant rows
   and container output are copied off the machine: step 2 of the [breach
   procedure](./breach-procedure.md). The nightly gate rebuilds only the OTA stack and never touches
   live (0132 D7, T1g), so it does not have to be switched off for this. A deploy of live (0132 T6)
   waits until the copy is made.
5. **Decide whether it is a personal-data breach.** If it may be, the [breach
   procedure](./breach-procedure.md) (0139 T8) takes over from here. Its clock starts when the owner
   becomes aware, not when the assessment ends.
6. **Tell the tester,** in Dutch. Say what is known, what is not, and what they should do with their
   old account: keep it, as 0131 T1's draft note says.
7. **Say it plainly if data is gone.** There are no backups during the alpha (0142 D4, 0134). What
   was lost on the machine cannot be restored. The source account is untouched, because no
   connector writes to it (0131 T4), so a migration can be set up again.
8. **Write it down,** in the record kept outside the repository: the date, what happened, which
   organisations, what was done, and what testers were told. The hold keeps its own history (who
   started it, who lifted it and what it said) for platform-wide holds.

## See also

- [`status-page.md`](./status-page.md): what the page can and cannot tell.
- [`operator-runbook.md`](./operator-runbook.md), *Health & troubleshooting*.
- [`breach-procedure.md`](./breach-procedure.md): when personal data may have leaked.
- Workplans 0142 (alerts), 0143 (the box's limits) and 0139 (the legal gate).
