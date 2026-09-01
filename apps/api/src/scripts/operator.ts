// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Appoint the people who may answer the door (workplan 0093 T6).
 *
 * **This is a script and not a route, and that is the boundary.** `app_user` —
 * the role the API connects as — is granted SELECT on `platform_operator` and
 * nothing else (migration 0005). So an operator can be asked "are you one" and
 * can never answer "and so is she": appointing is the owner's own act, made
 * over the owner connection, from the machine the database runs on.
 *
 * Usage (from the repo root):
 *
 *   ./deploy/compose/operator.sh list
 *   ./deploy/compose/operator.sh add    <subject> <email> [note]
 *   ./deploy/compose/operator.sh remove <subject>
 *
 * The wrapper composes the owner connection and asks compose for Postgres's
 * published port. Calling the underlying `pnpm --filter @openmig/api
 * operator:*` scripts directly works too, but then DATABASE_URL is yours to
 * build — and it is NOT a line in deploy/compose/.env, which is what made the
 * documented recipe fail silently until 2026-08-31.
 *
 * THE SUBJECT, NOT THE EMAIL. `<subject>` is the `sub` the identity provider
 * mints — an opaque string, not an address. There is no way to know it before
 * the person has signed in once, and there is no way to derive it from their
 * email that would not also let whoever registers that address become an
 * operator. So the sequence is: they sign in, they call `GET /api/me`, they
 * read `userId` back, and you run this with it. Three steps, none of them
 * guessing.
 *
 * Idempotent: adding somebody who is already an operator updates their email
 * and note rather than failing, so re-running after a typo is the fix.
 *
 * ## Memberships, which are a different question
 *
 *   ./deploy/compose/operator.sh memberships <subject>
 *   ./deploy/compose/operator.sh leave <subject> <tenant-id>
 *   ./deploy/compose/operator.sh leave <subject> --all
 *
 * BEING PLATFORM STAFF AND BELONGING TO AN ORGANISATION ARE NOT THE SAME FACT,
 * and until now only one of them could be taken back. `platform_operator` says
 * who may answer the door; `tenant_member` says whose organisation somebody is
 * in (ADR-0042). An operator who joins an organisation to look at something —
 * or who presses the enrolment button on their own deployment, which is how
 * this was asked for on 2026-09-01 — acquires a membership the product will not
 * let them drop: `DELETE /api/tenants/:tenantId/members/:memberId` refuses with
 * `Cannot remove yourself from the tenant`, and refuses again with
 * `Cannot remove the last owner`.
 *
 * BOTH REFUSALS ARE RIGHT, and this does not weaken either. A sole owner
 * walking out of a customer's organisation orphans it, and the product should
 * keep saying no to that for ever. What changes is WHO is asking: removing a
 * membership here is a platform act performed at the machine over the owner
 * connection — the same standing `add` has — and it carries the guards those
 * refusals were standing in for, stated as the thing they protect rather than
 * as a rule about the asker:
 *
 *   - an organisation with OTHER PEOPLE in it is never left without an owner;
 *   - an organisation with a MIGRATION STILL RUNNING is never left with nobody
 *     to answer for it;
 *   - `platform_operator` IS NEVER TOUCHED. "Stay an operator, belong to
 *     nothing" is the whole request, and a command that quietly did both would
 *     undo the separation that table exists to make.
 *
 * AND IT IS WRITTEN DOWN. A membership removed through the product leaves the
 * row's absence and nothing else; one removed here writes `audit_log` in the
 * same transaction as the delete. A connection that can remove anybody from
 * anything must not also be able to do it quietly, and the cheapest place to
 * settle that is the moment of writing.
 */

import { Pool } from 'pg';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '@openmig/shared';
import {
  checkByKind,
  HOUSEKEEPING_CHECKS,
  HOUSEKEEPING_KINDS,
  notCleanableRefusal,
  unknownKindRefusal,
  type HousekeepingCheck,
  type HousekeepingClean,
  type HousekeepingRow,
} from './operator-housekeeping.ts';

const USAGE = `Usage:
  operator:list
  operator:add <subject> <email> [note]
  operator:remove <subject>
  operator:memberships <subject>
  operator:leave <subject> <tenant-id>
  operator:leave <subject> --all
  operator:check [kind]
  operator:clean <kind> [--confirm]

DATABASE_URL must be the OWNER connection — app_user cannot write this table,
which is the point of it.`;

/**
 * A SUBJECT IS NOT A TOKEN, and this is what it costs when nothing says so.
 *
 * `add` took whatever strings it was handed and reported success. On
 * 2026-08-31 the owner's appointment went to nobody twice, for two different
 * reasons, and neither said a word:
 *
 *  1. `operator.sh` passed `--` before the arguments and pnpm FORWARDED it, so
 *     everything shifted one place: `user_id` became the literal `--`, the
 *     subject landed in `email`, the email in `note`. Fixed in the wrapper.
 *  2. On the first attempt the value offered as the subject was the whole ID
 *     TOKEN — an easy mistake, because the documented steps are "sign in, read
 *     `userId` from /api/me, appoint it" and the token is what you are holding
 *     at step two. It went into `email`, where a 900-character credential then
 *     sat at rest.
 *
 * Both rows existed, `operator:list` showed them, and this script had said
 * "may now read the access queue and grant requests" each time.
 *
 * Every signal downstream then told the truth about a world nobody wanted:
 * `isPlatformOperator` matched nothing, `/api/me` answered `operator: false`,
 * the nav correctly hid Access requests and Support, and an afternoon went into
 * reading a menu that was right. A message asserting an outcome it has not
 * checked is the failure this repository keeps finding, and the cheapest place
 * to stop it is the moment of writing.
 *
 * IT CANNOT VALIDATE A SUBJECT IN GENERAL, and must not pretend to: there is no
 * user table on this side, deliberately (ADR-0042), and a subject is whatever
 * the issuer mints — digits here, a uuid elsewhere. What it CAN do is refuse
 * the three things a subject is definitely not: a token, an argument
 * separator, and something far too long to be an identifier.
 *
 * AND THE ANSWER IS INSIDE THE MISTAKE. A JWT carries the very subject that was
 * meant, so the refusal decodes it and prints the command to run. Nothing is
 * verified and nothing needs to be: the appointment is the owner's own act over
 * the owner connection, and this only saves them a second trip to /api/me. A
 * refusal that hands back the right command is worth ten that merely name the
 * mistake.
 *
 * A TOKEN IN THAT COLUMN IS ALSO A CREDENTIAL AT REST, which is its own reason
 * not to write one: `platform_operator` is a table of identifiers, and nothing
 * about it is protected the way a secret would be.
 */
const MAX_SUBJECT = 200;

export function subjectRefusal(subject: string): string | null {
  const parts = subject.split('.');
  if (parts.length === 3 && /^eyJ[A-Za-z0-9_-]+$/.test(parts[0]!)) {
    let sub: string | undefined;
    try {
      const body = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
      const json = JSON.parse(
        Buffer.from(body + '='.repeat((4 - (body.length % 4)) % 4), 'base64').toString('utf8'),
      ) as { sub?: unknown };
      if (typeof json.sub === 'string' && json.sub) sub = json.sub;
    } catch {
      // Token-shaped, but the middle is not JSON. Still not a subject — the
      // refusal stands, it just cannot offer the shortcut.
    }
    return (
      'that is a TOKEN, not a subject.\n\n' +
      'The subject is the `userId` in what `GET /api/me` answers; the token is\n' +
      'what you send to ask it. Appointing the token writes a row that matches\n' +
      'nobody — sign-in then reports `operator: false`, the access queue and the\n' +
      'support screens stay hidden, and nothing says why.\n\n' +
      (sub === undefined
        ? 'Read the subject from /api/me and use that.'
        : "That token's own subject is:\n\n" +
          `    ${sub}\n\n` +
          'So the command you meant is:\n\n' +
          `    ./deploy/compose/operator.sh add ${sub} <email> [note]\n\n` +
          'Read out of the token without verifying it, which is all this needs\n' +
          "to do: the appointment is your act, over the owner connection.") +
      '\n\nNOTHING WAS WRITTEN.'
    );
  }
  // A BARE `--` IS A WRAPPER BUG WEARING A SUBJECT'S CLOTHES, and it is the one
  // that actually happened. Catching it here is defence in depth: the wrapper
  // no longer sends it, and if some future caller does, the appointment fails
  // loudly instead of writing a row nobody will ever match.
  if (subject === '--') {
    return (
      'that is an argument separator, not a subject.\n\n' +
      'Something between you and this script passed `--` as the first argument,\n' +
      'so every value after it shifted one place: the subject would have gone\n' +
      'into the email column and the email into the note. pnpm forwards `--`\n' +
      'rather than consuming it — `deploy/compose/operator.sh` no longer sends\n' +
      'one, so an out-of-date copy of that script is the likely cause.' +
      '\n\nNOTHING WAS WRITTEN.'
    );
  }
  if (subject.length > MAX_SUBJECT) {
    return (
      `that is ${subject.length} characters, and a subject is not.\n\n` +
      'Issuers mint short opaque identifiers — digits, or a uuid. Something this\n' +
      'long is a token, a header, or a paste that went wrong. Read the subject\n' +
      'from what `GET /api/me` answers.\n\nNOTHING WAS WRITTEN.'
    );
  }
  return null;
}

/**
 * The audit action a membership removed at the machine is recorded under.
 *
 * `member.removed` and not `operator.left`: what happened TO THE ORGANISATION
 * is that it lost a member, and that is the sentence somebody reading its
 * history needs to find. Who did it, and by what means, ride in `actor` and
 * `detail.via` — where `connections.ts` and `mapping-status-audit.ts` both put
 * the particulars.
 */
export const MEMBERSHIP_REMOVED_ACTION = 'member.removed';

/**
 * One membership, and everything the decision to leave it depends on.
 *
 * COMPUTED IN THE SAME QUERY AS THE ROW, never fetched per organisation
 * afterwards. "Is anybody else an owner" read a moment later is a different
 * question from the one being answered, and this is the one place where being
 * a moment out is the difference between leaving an organisation in order and
 * orphaning it.
 */
export interface LeaveFacts {
  /** For the message. Nobody recognises an organisation by its uuid. */
  readonly tenantName: string;
  /** What the leaver is IN this organisation, which is what the guard turns on. */
  readonly role: string;
  /** Everybody else still in it — `invited` and `suspended` count as people. */
  readonly otherMembers: number;
  /** Other ACTIVE owners. An invited one cannot administer anything yet. */
  readonly otherOwners: number;
  /** Mappings that are not `done`: a migration somebody means to finish. */
  readonly liveMappings: number;
}

/**
 * Why this membership must stay, or null when nothing is stranded by its going.
 *
 * THE PRODUCT'S TWO REFUSALS, RESTATED AS WHAT THEY PROTECT.
 * `DELETE /api/tenants/:tenantId/members/:memberId` says `Cannot remove
 * yourself from the tenant` and `Cannot remove the last owner`. The first is a
 * rule about the ASKER and does not survive the move to the machine — an
 * operator taking back their own access is the entire point here. The second is
 * a rule about the ORGANISATION, and it does survive, so it is here, widened to
 * the fact it was really guarding: not "the last owner" but "the last owner OF
 * PEOPLE WHO ARE STILL IN IT".
 *
 * AND ONE THE PRODUCT NEVER HAD. A migration that is not done keeps running on
 * its schedule whether or not anybody is left to watch it: failures accrue with
 * nobody to read them, a cutover waits for a press that cannot come, and the
 * bytes keep being counted against an organisation nobody belongs to. That is a
 * worse outcome than an orphaned empty tenant and nothing anywhere refused it.
 *
 * ORDER MATTERS. The migration check runs first because it is the one that is
 * true of an organisation with nobody else in it — the case a leaver is most
 * likely to think is trivially safe.
 */
export function leaveRefusal(f: LeaveFacts): string | null {
  if (f.liveMappings > 0) {
    const plural = f.liveMappings === 1 ? '' : 's';
    return (
      `${f.tenantName} has ${f.liveMappings} unfinished migration${plural}.\n\n` +
      'A mapping that is not `done` is work in progress: the schedule keeps\n' +
      'firing, failures keep being recorded, and a cutover keeps waiting to be\n' +
      'pressed. Leaving is not pausing — it removes the person who would answer\n' +
      'for all three and changes nothing about the migration itself.\n\n' +
      'Finish them, or pause and close them out, or hand the organisation to\n' +
      'somebody else and leave after that.' +
      '\n\nNOTHING WAS REMOVED.'
    );
  }
  if (f.otherMembers > 0 && f.role === 'owner' && f.otherOwners === 0) {
    const plural = f.otherMembers === 1 ? '' : 's';
    const them = f.otherMembers === 1 ? 'that person' : 'those people';
    return (
      `${f.tenantName} has ${f.otherMembers} other member${plural}, and you are its only owner.\n\n` +
      `Leaving would leave ${them} with an organisation nobody can administer:\n` +
      'no invitations, no member changes, no cutover, no billing party. That is\n' +
      "what the product's own `Cannot remove the last owner` protects, and the\n" +
      'answer is the same at the machine.\n\n' +
      'Make one of them an owner first —\n' +
      '  PATCH /api/tenants/<tenant-id>/members/<member-id>  {"role":"owner"}\n' +
      '— and then leave.' +
      '\n\nNOTHING WAS REMOVED.'
    );
  }
  return null;
}

/**
 * Would this leave the organisation with nobody in it at all?
 *
 * NOT A REFUSAL, deliberately. An organisation with one person and no running
 * migration strands nobody when that person goes: there is no one left to be
 * let down. The demo tenant and every night's smoke residue are exactly this
 * shape, and refusing it would make the tool useless for the case it was built
 * for.
 *
 * It does have a consequence worth saying out loud rather than discovering:
 * a tenant with no members cannot be reached through the product by anybody,
 * because every route resolves the tenant FROM a membership (ADR-0042). So the
 * caller prints the row back as the statement that puts it there again.
 *
 * NOT A `join` SUB-COMMAND, and that is a decision rather than an omission. A
 * verb that adds an operator to any organisation with one word is a different
 * and much larger tool than this one; the undo for a machine-level act belongs
 * at the machine, spelled out, where writing it is a thing somebody did.
 */
export function leavesNobodyBehind(f: LeaveFacts): boolean {
  return f.otherMembers === 0;
}

/**
 * The refusal for pointing this at somebody who is not platform staff.
 *
 * THE ONE GUARD THAT KEEPS THIS FROM BEING A BACK DOOR. Everything else here
 * protects the organisation; this protects the person. Removing a membership
 * over the owner connection means no owner pressed anything, no invitation was
 * answered, and the member was not asked — which is defensible for staff taking
 * back their own access and is not defensible for a customer, whose membership
 * belongs to their organisation's owner to end.
 *
 * The owner connection could of course write that DELETE by hand, and this
 * cannot stop it. What it can stop is this repository SHIPPING the convenient
 * way to do it, which is the difference between something a person had to
 * decide to do and something a tool offered.
 */
export function notAnOperatorRefusal(subject: string): string {
  return (
    `${subject} is not a platform operator.\n\n` +
    'These commands remove a membership from the MACHINE: no owner presses\n' +
    'anything, no invitation is answered, and the person it happens to is not\n' +
    'asked. That is defensible for platform staff taking back their own access.\n' +
    "It is not defensible for a customer, whose membership is their\n" +
    "organisation owner's to end, through the product:\n\n" +
    '    DELETE /api/tenants/<tenant-id>/members/<member-id>\n\n' +
    'If this person really is platform staff, appoint them and the membership\n' +
    'commands will work:\n\n' +
    `    ./deploy/compose/operator.sh add ${subject} <email> [note]` +
    '\n\nNOTHING WAS REMOVED.'
  );
}

function connectionString(): string {
  const url = process.env.DATABASE_URL ?? process.env.SEED_DATABASE_URL;
  if (!url) {
    // NAMING THE VARIABLE IS NOT ENOUGH, and this refusal learned that the
    // expensive way. It used to say only "DATABASE_URL is required", and
    // docs/managed-bring-up.md §8c answered it with
    // `grep '^DATABASE_URL=' deploy/compose/.env` — a line that file has never
    // carried, because managed.yml COMPOSES the value from POSTGRES_* and
    // DB_HOST. So the remedy set it to the empty string and this threw again,
    // on a requirement the operator had just apparently met (2026-08-31).
    //
    // The seed had the same shape and the same fix (`seed-managed.sh`): a
    // wrapper that composes what a host-run script cannot inherit. Say its
    // name, because "set DATABASE_URL" sends somebody to a file that does not
    // contain it.
    throw new Error(
      'DATABASE_URL (the DB owner connection) is required.\n\n' +
        'This runs on the HOST and inherits nothing, and .env does not carry a\n' +
        'DATABASE_URL line — compose builds it from POSTGRES_* and DB_HOST. Use\n' +
        'the wrapper, which composes it and asks compose for the published port:\n' +
        '  ./deploy/compose/operator.sh list\n' +
        '  ./deploy/compose/operator.sh add <subject> <email> [note]\n' +
        '  ./deploy/compose/operator.sh remove <subject>',
    );
  }
  return url;
}

interface OperatorRow {
  user_id: string;
  email: string;
  note: string | null;
  created_at: Date;
}

/**
 * The refusal for a connection that cannot see across organisations.
 *
 * THE VACUOUS ANSWER THIS EXISTS TO NOT GIVE. Both membership commands begin by
 * asking which organisations one subject is in, and that question spans all of
 * them — while `tenant_member`, `tenant` and `mailbox_mapping` all carry FORCE
 * ROW LEVEL SECURITY with policies keyed on `app.current_tenant`, one
 * organisation at a time. A role those policies apply to gets ZERO ROWS back,
 * which is not an error: `memberships` would report "is in no organisation" and
 * `leave --all` would report "nothing to remove", both of them confidently, and
 * both about a person who is an owner of four.
 *
 * That is the exact class `the-check-postgres-never-made.unit.test.ts` was
 * written about — `docker exec … psql -h 127.0.0.1` passing on any password
 * because pg_hba said `trust`. A check whose success cannot fail is not a
 * check, and a listing whose emptiness cannot be distinguished from silence is
 * not an answer.
 *
 * So ASK POSTGRES, once, before answering anything. `rolsuper OR rolbypassrls`
 * is the whole of it — either one means the policies do not apply and the rows
 * being counted are all the rows there are.
 */
export function cannotSeeAcrossOrganisationsRefusal(currentUser: string): string {
  return (
    `connected as ${currentUser}, which row level security applies to.\n\n` +
    'Asking which organisations a subject belongs to spans every tenant, and\n' +
    '`tenant_member`, `tenant` and `mailbox_mapping` all carry FORCE ROW LEVEL\n' +
    'SECURITY with policies keyed on `app.current_tenant` — one organisation at\n' +
    'a time. This role would get zero rows back, and zero rows is not an error:\n' +
    'the answer would be "belongs to nothing", confidently, about somebody who\n' +
    'may own four.\n\n' +
    'It needs the DATABASE OWNER connection, which the wrapper composes:\n\n' +
    '    ./deploy/compose/operator.sh memberships <subject>\n' +
    '    ./deploy/compose/operator.sh leave <subject> <tenant-id>\n\n' +
    'NOTHING WAS READ AND NOTHING WAS REMOVED.'
  );
}

/**
 * Refuse now if the answer would be empty for the wrong reason.
 *
 * Called by both membership commands before they read anything, because the
 * failure it prevents is a MESSAGE rather than an exception — and a wrong
 * message is the one failure mode nothing downstream can catch.
 */
async function requireCrossTenantSight(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ current_user: string; bypasses: boolean }>(
    `SELECT current_user, (rolsuper OR rolbypassrls) AS bypasses
       FROM pg_roles WHERE rolname = current_user`,
  );
  const seat = rows[0];
  if (!seat || !seat.bypasses) {
    throw new Error(cannotSeeAcrossOrganisationsRefusal(seat?.current_user ?? 'an unknown role'));
  }
}

/**
 * A membership row, with the counts the guards read, as the database hands it
 * back. `snake_case` because that is what it is.
 */
interface MembershipRow {
  member_id: string;
  tenant_id: string;
  tenant_name: string;
  email: string;
  role: string;
  status: string;
  other_members: number;
  other_owners: number;
  live_mappings: number;
}

const factsOf = (row: MembershipRow): LeaveFacts => ({
  tenantName: row.tenant_name,
  role: row.role,
  otherMembers: row.other_members,
  otherOwners: row.other_owners,
  liveMappings: row.live_mappings,
});

/**
 * Every organisation this subject is in, with each leave decision's inputs.
 *
 * ACROSS TENANTS, WHICH IS WHY IT IS HERE AND NOT A ROUTE. `tenant_member`,
 * `tenant` and `mailbox_mapping` all carry `tenant_isolation_*` policies keyed
 * on `app.current_tenant`, so this query returns nothing at all to anybody
 * holding a session — the correct answer for them, and the reason the question
 * can only be asked over the owner connection at the machine.
 *
 * `::int` ON THE COUNTS because node-pg hands `bigint` back as a STRING, and
 * `'1' === 1` is false — the singular/plural in every refusal below would read
 * "1 other members" for ever, on the one case somebody is most likely to be
 * looking at.
 *
 * `status NOT IN ('removed','declined')` for the other members: a person who
 * was removed or who said no is not somebody an ownerless organisation lets
 * down. `status = 'active'` for the other owners, because an invited owner
 * cannot administer anything until they arrive.
 */
async function loadMemberships(pool: Pool, subject: string): Promise<MembershipRow[]> {
  const { rows } = await pool.query<MembershipRow>(
    `SELECT m.id::text        AS member_id,
            m.tenant_id::text AS tenant_id,
            t.name            AS tenant_name,
            m.email           AS email,
            m.role            AS role,
            m.status          AS status,
            (SELECT count(*) FROM tenant_member o
              WHERE o.tenant_id = m.tenant_id
                AND o.user_id <> m.user_id
                AND o.status NOT IN ('removed', 'declined'))::int AS other_members,
            (SELECT count(*) FROM tenant_member o
              WHERE o.tenant_id = m.tenant_id
                AND o.user_id <> m.user_id
                AND o.role = 'owner'
                AND o.status = 'active')::int AS other_owners,
            (SELECT count(*) FROM mailbox_mapping mm
              WHERE mm.tenant_id = m.tenant_id
                AND mm.status <> 'done')::int AS live_mappings
       FROM tenant_member m
       JOIN tenant t ON t.id = m.tenant_id
      WHERE m.user_id = $1
      ORDER BY t.name`,
    [subject],
  );
  return rows;
}

/** A single-quoted SQL literal, for the undo this prints rather than runs. */
const sqlLit = (value: string): string => `'${value.split("'").join("''")}'`;

/**
 * Remove one membership and record it, or neither.
 *
 * ONE TRANSACTION, for `mapping-status-audit.ts`'s reason exactly: a log that
 * can fail independently of the thing it logs has holes precisely where
 * somebody would want them. Written here rather than passed a handle, because
 * this script has no `withTenantDb` to be inside of.
 *
 * `SET LOCAL app.current_tenant` is not decoration. Both tables carry FORCE ROW
 * LEVEL SECURITY (ledger 0001, managed 0001), so their policies apply to the
 * table owner too and only a superuser bypasses them. The reference stack's
 * owner happens to be one — but a deployment whose owner is not would silently
 * write nothing and delete nothing here, and `rowCount` below is what turns
 * that into a refusal instead of a lie. Two statements, and the write is
 * correct either way.
 *
 * THE COUNT IS CHECKED BEFORE THE COMMIT. Reporting a removal that removed
 * nothing is the failure this file's own header was written about.
 */
async function removeMembership(
  pool: Pool,
  row: MembershipRow,
  subject: string,
  leftEmpty: boolean,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [row.tenant_id]);
    await client.query(
      `INSERT INTO audit_log (tenant_id, actor, action, entity, detail)
       VALUES ($1::uuid, $2, $3, 'member', $4::jsonb)`,
      [
        row.tenant_id,
        subject,
        MEMBERSHIP_REMOVED_ACTION,
        // `entity_id` stays null and the id rides in `detail`, which is the
        // shape every other writer in the repo uses — see the note in
        // `mapping-status-audit.ts` about not making a reader learn a third one.
        JSON.stringify({
          memberId: row.member_id,
          userId: subject,
          email: row.email,
          role: row.role,
          status: row.status,
          via: 'operator.sh leave',
          leftEmpty,
        }),
      ],
    );
    const { rowCount } = await client.query(`DELETE FROM tenant_member WHERE id = $1::uuid`, [
      row.member_id,
    ]);
    if (rowCount !== 1) {
      throw new Error(
        `${row.tenant_name}: the delete matched ${rowCount ?? 0} rows, not 1 — rolled back.\n\n` +
          'The membership was read a moment ago, so either something else removed\n' +
          'it in between (harmless, re-run and it will say there is nothing to do)\n' +
          'or this connection cannot see what it is deleting, which is what row\n' +
          'level security looks like from the inside. Nothing was written.',
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run one check and hand back what it found.
 *
 * The column names are the contract `HousekeepingCheck.find` documents, and the
 * mapping is here rather than in each query so a check is a question and not
 * also a serialisation format. `::int` is applied inside every query for the
 * reason `loadMemberships` gives: node-pg returns `bigint` as a string, and
 * `'1' === 1` is false in every plural this prints.
 */
async function runHousekeeping(
  pool: Pool,
  check: HousekeepingCheck,
): Promise<HousekeepingRow[]> {
  const { rows } = await pool.query<{
    id: string;
    label: string;
    note: string;
    count: number;
    other_count: number;
    age_days: number;
  }>(check.find);
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    note: row.note,
    count: row.count,
    otherCount: row.other_count,
    ageDays: row.age_days,
  }));
}

/**
 * Resolve one finding, in a transaction, and prove it did.
 *
 * `rowCount !== 1` rolls back for `removeMembership`'s reason: a clean that
 * reports having cleaned something it did not is the failure this whole file
 * keeps finding, and a statement that matches nothing is what row level
 * security looks like from the inside.
 */
async function applyClean(
  pool: Pool,
  clean: HousekeepingClean,
  row: HousekeepingRow,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (clean.tenantScoped) {
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [row.id]);
    }
    const { rowCount } = await client.query(clean.sql, [row.id]);
    if (rowCount !== 1) {
      throw new Error(
        `matched ${rowCount ?? 0} rows, not 1 — rolled back, and nothing else was touched.\n\n` +
          'Either something changed between the check and the clean (harmless: run\n' +
          'the check again) or this connection cannot see what it is acting on,\n' +
          'which is what row level security looks like from the inside.',
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const pool = new Pool({ connectionString: connectionString() });

  try {
    switch (command) {
      case 'list': {
        const { rows } = await pool.query<OperatorRow>(
          `SELECT user_id, email, note, created_at FROM platform_operator ORDER BY created_at`,
        );
        if (rows.length === 0) {
          // Not an error, and worth saying plainly: a deployment with no
          // operators has a queue nobody can read, which looks like a bug from
          // the outside.
          log.info('No operators. Nobody can read the access queue or grant a request.');
          break;
        }
        for (const row of rows) {
          log.info(`${row.user_id}\t${row.email}\t${row.note ?? ''}`);
        }
        break;
      }

      case 'add': {
        const [userId, email, ...noteParts] = rest;
        if (!userId || !email) throw new Error(`add needs a subject and an email.\n\n${USAGE}`);
        // Before the write, not after: the whole point is that no row appears.
        const refusal = subjectRefusal(userId);
        if (refusal) throw new Error(refusal);
        const note = noteParts.join(' ') || null;
        await pool.query(
          `INSERT INTO platform_operator (user_id, email, note)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, note = EXCLUDED.note`,
          [userId, email, note],
        );
        log.info(`${email} (${userId}) may now read the access queue and grant requests.`);
        break;
      }

      case 'remove': {
        const [userId] = rest;
        if (!userId) throw new Error(`remove needs a subject.\n\n${USAGE}`);
        const { rowCount } = await pool.query(`DELETE FROM platform_operator WHERE user_id = $1`, [
          userId,
        ]);
        // The distinction matters: "removed nobody" usually means the subject
        // was mistyped, and reporting it as success hides that.
        log.info(
          rowCount === 0 ? `No operator with subject ${userId}.` : `${userId} is no longer an operator.`,
        );
        break;
      }

      case 'memberships': {
        const [userId] = rest;
        if (!userId) throw new Error(`memberships needs a subject.\n\n${USAGE}`);
        const refusal = subjectRefusal(userId);
        if (refusal) throw new Error(refusal);
        await requireCrossTenantSight(pool);
        const rows = await loadMemberships(pool, userId);
        if (rows.length === 0) {
          log.info(`${userId} is in no organisation.`);
          break;
        }
        log.info(`${userId} is in ${rows.length} organisation(s):`);
        for (const row of rows) {
          const facts = factsOf(row);
          log.info(`\n  ${row.tenant_name}  [${row.tenant_id}]  ${row.role}/${row.status}`);
          const why = leaveRefusal(facts);
          if (why) {
            // The first line only. The whole refusal is what `leave` prints
            // when it is actually asked to do it; here the answer is which of
            // these can go, and four paragraphs per organisation would bury it.
            log.info(`    CANNOT LEAVE — ${why.split('\n')[0]}`);
          } else if (leavesNobodyBehind(facts)) {
            log.info('    can leave — nobody else is in it, so it would be left with no members');
          } else {
            log.info(
              `    can leave — ${row.other_members} other member(s) stay, ` +
                `${row.other_owners} of them active owner(s)`,
            );
          }
        }
        break;
      }

      case 'leave': {
        const [userId, target] = rest;
        if (!userId || !target) {
          throw new Error(`leave needs a subject and a tenant id (or --all).\n\n${USAGE}`);
        }
        const refusal = subjectRefusal(userId);
        if (refusal) throw new Error(refusal);
        await requireCrossTenantSight(pool);

        // FIRST, before a single organisation is read. Whether this tool may be
        // pointed at this person at all is a different question from what it
        // would do to them, and asking it in that order means a customer's
        // memberships are not even enumerated by a mistyped command.
        const { rows: appointed } = await pool.query(
          `SELECT 1 FROM platform_operator WHERE user_id = $1`,
          [userId],
        );
        if (appointed.length === 0) throw new Error(notAnOperatorRefusal(userId));

        const all = await loadMemberships(pool, userId);
        if (target === '--all' && all.length === 0) {
          // The requested end state, already true. Idempotent by saying so
          // rather than by failing at it.
          log.info(`${userId} is in no organisation. Nothing to remove.`);
          break;
        }
        const chosen = target === '--all' ? all : all.filter((row) => row.tenant_id === target);
        if (chosen.length === 0) {
          throw new Error(
            `${userId} is not a member of ${target}.\n\n` +
              (all.length === 0
                ? 'They are in no organisation at all.'
                : 'They are in:\n' +
                  all.map((row) => `    ${row.tenant_id}  ${row.tenant_name}`).join('\n')) +
              '\n\nNOTHING WAS REMOVED.',
          );
        }

        // ONE ORGANISATION AT A TIME, and a refusal on one does not hold up the
        // others. Leaving A has nothing to do with leaving B, so an
        // all-or-nothing sweep would turn "one of my four is mid-migration"
        // into four commands. What it must not do is report success it did not
        // have — hence the list, and the non-zero exit at the end.
        const refused: string[] = [];
        for (const row of chosen) {
          const facts = factsOf(row);
          const why = leaveRefusal(facts);
          if (why) {
            log.warn(`${row.tenant_name}: ${why}`);
            refused.push(`${row.tenant_name} [${row.tenant_id}]`);
            continue;
          }
          const emptied = leavesNobodyBehind(facts);
          await removeMembership(pool, row, userId, emptied);
          log.info(
            `${row.tenant_name} [${row.tenant_id}]: ${row.role} membership removed, ` +
              `recorded in audit_log as ${MEMBERSHIP_REMOVED_ACTION}.`,
          );
          if (emptied) {
            log.info(
              `    ${row.tenant_name} now has NO members, and nobody can reach it through\n` +
                '    the product: every route resolves the tenant from a membership. To put\n' +
                '    yourself back, over this same owner connection:\n\n' +
                '      BEGIN;\n' +
                `      SELECT set_config('app.current_tenant', ${sqlLit(row.tenant_id)}, true);\n` +
                '      INSERT INTO tenant_member (tenant_id, user_id, email, role, status, joined_at)\n' +
                `      VALUES (${sqlLit(row.tenant_id)}::uuid, ${sqlLit(userId)}, ` +
                `${sqlLit(row.email)}, ${sqlLit(row.role)}, ${sqlLit(row.status)}, now());\n` +
                '      COMMIT;\n\n' +
                '    The audit_log row just written holds what the membership was, if the\n' +
                '    values above ever need checking against something other than this\n' +
                '    terminal.',
            );
          }
        }

        // SAID EVERY TIME, including when nothing could be removed. It is the
        // property the whole sub-command exists to have, and a person running
        // this is by definition wondering whether they just gave up more than
        // they meant to.
        log.info(`${userId} is still a platform operator — platform_operator was not touched.`);

        if (refused.length > 0) {
          throw new Error(
            `${refused.length} of ${chosen.length} membership(s) stay, for the reasons above:\n` +
              refused.map((name) => `    ${name}`).join('\n'),
          );
        }
        break;
      }

      case 'check': {
        await requireCrossTenantSight(pool);
        const [kind] = rest;
        const one = kind === undefined ? null : checkByKind(kind);
        if (kind !== undefined && one === null) throw new Error(unknownKindRefusal(kind));
        const checks = one === null ? HOUSEKEEPING_CHECKS : [one];

        let total = 0;
        for (const check of checks) {
          const rows = await runHousekeeping(pool, check);
          total += rows.length;
          if (rows.length === 0) {
            // SAID, not omitted. A report that lists only problems cannot be
            // told apart from a report that did not run, and "nothing found"
            // is the answer an operator is actually hoping for.
            log.info(`\n${check.kind}: none — ${check.title}`);
            continue;
          }
          log.info(`\n${check.kind}: ${rows.length} — ${check.title}`);
          // The `why` only when asked about one kind. In the full report it
          // would be forty lines of prose between the operator and the list.
          if (kind !== undefined) log.info(`\n${check.why}\n`);
          for (const row of rows) {
            log.info(`  ${check.describe(row)}`);
            log.info(`      → ${check.remedy(row)}`);
          }
        }
        log.info(
          total === 0
            ? '\nNothing to clean up.'
            : `\n${total} finding(s). Each line above carries what resolves it; the ones\n` +
                `\`clean\` can do for you are marked with a clean command.`,
        );
        break;
      }

      case 'clean': {
        await requireCrossTenantSight(pool);
        const [kind, ...flags] = rest;
        if (!kind) {
          // NEVER "clean everything". `clean` writes, and a verb that wrote
          // across five unrelated kinds because somebody left an argument off
          // is the one shape this must not have — the argument is the consent.
          throw new Error(
            'clean needs a kind, and there is deliberately no way to clean them all.\n\n' +
              'The kinds that can be cleaned automatically:\n' +
              HOUSEKEEPING_CHECKS.filter((c) => c.clean !== null)
                .map((c) => `    ${c.kind}  — ${c.title}`)
                .join('\n') +
              '\n\nThe rest are reported and resolved by hand:\n' +
              HOUSEKEEPING_CHECKS.filter((c) => c.clean === null)
                .map((c) => `    ${c.kind}  — ${c.title}`)
                .join('\n') +
              `\n\nAll of them: ${HOUSEKEEPING_KINDS.join(', ')}.\n` +
              'Start with `./deploy/compose/operator.sh check`.',
          );
        }
        const check = checkByKind(kind);
        if (!check) throw new Error(unknownKindRefusal(kind));
        if (!check.clean) throw new Error(notCleanableRefusal(check));
        const clean: HousekeepingClean = check.clean;

        // THE DEFAULT IS TO WRITE NOTHING, and the dry run is the whole output
        // rather than a summary of it: what an operator needs before agreeing
        // to a destructive act is the list of what would actually go, not a
        // count. Hard rule 2 as a command-line default.
        const confirmed = flags.includes('--confirm');
        const rows = await runHousekeeping(pool, check);
        if (rows.length === 0) {
          log.info(`${check.kind}: nothing found. Nothing to do.`);
          break;
        }

        const doable: HousekeepingRow[] = [];
        for (const row of rows) {
          const why = clean.can(row);
          if (why) {
            log.warn(`  KEPT  ${check.describe(row)}\n        ${why}`);
            continue;
          }
          doable.push(row);
        }

        if (doable.length === 0) {
          throw new Error(
            `${rows.length} finding(s), and none of them may be cleaned automatically — ` +
              'every reason is above.\n\n' +
              `Run \`./deploy/compose/operator.sh check ${check.kind}\` for the statement that\n` +
              'resolves each one by hand.',
          );
        }

        if (!confirmed) {
          for (const row of doable) {
            log.info(`  WOULD  ${check.describe(row)}`);
          }
          log.info(
            `\n${doable.length} of ${rows.length} finding(s) can be cleaned. NOTHING WAS WRITTEN.\n` +
              `To do it:\n    ./deploy/compose/operator.sh clean ${check.kind} --confirm`,
          );
          break;
        }

        for (const row of doable) {
          await applyClean(pool, clean, row);
          log.info(`  DONE  ${check.describe(row)}\n        ${clean.did(row)}`);
        }
        // NO audit_log ROW, and the module header says why rather than leaving
        // it to be discovered: that table's tenant_id is NOT NULL, and these
        // acts are about no tenant or about one that is going. This line is the
        // record, which is worth saying out loud to whoever is reading it.
        log.info(
          `\n${doable.length} cleaned. This is not written to audit_log — there is no tenant\n` +
            'to attribute it to; what you are reading is the record.',
        );
        break;
      }

      default:
        throw new Error(USAGE);
    }
  } finally {
    await pool.end();
  }
}

/**
 * RUN WHEN RUN, not when imported.
 *
 * This was a bare `await main()`, so importing the module executed it — which
 * meant `subjectRefusal` below could not be tested without a database, and so
 * it was not tested at all. A script whose only entry point is its side effect
 * has no seam, and the bug this file now refuses shipped through exactly that
 * gap: nothing here could be exercised, so nothing here was.
 *
 * `argv[1]` is the file node was told to run. Comparing it to this module's own
 * path is the ordinary way, and it holds for `node src/scripts/operator.ts` and
 * for the pnpm script that wraps it alike.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) await main();
