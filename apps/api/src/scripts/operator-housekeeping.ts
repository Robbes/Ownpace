// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The states a managed deployment drifts into, and what to do about each.
 *
 * ## Why a registry and not six ad-hoc queries
 *
 * Every fault this repository has spent a day on was VISIBLE IN THE DATABASE
 * before anybody noticed it, and none of them was visible from a screen. Thirty
 * one probe owners on one demo tenant, found by reading a support page. An
 * operator row holding a nine-hundred-character ID token, found after an
 * afternoon of reading a menu that was correct. Memberships pointing at
 * accounts the identity provider had deleted seconds earlier, found by clicking
 * one of them. In each case somebody eventually looked at the right table by
 * hand, and the interesting part is how long "eventually" was.
 *
 * So this is the looking, written down. `operator.sh check` asks every question
 * at once and answers each with a sentence and a remedy; `operator.sh clean`
 * performs the remedies that are safe to perform without a decision.
 *
 * ## Three rules the shape enforces
 *
 * **Finding is not fixing.** Most of what turns up here needs somebody's
 * judgement — which member becomes the owner, whether an organisation nobody
 * has claimed in six weeks is abandoned or merely slow. Those are report-only,
 * and `clean` refuses them by name rather than guessing. `clean` refusing is
 * the ordinary case, not a gap.
 *
 * **A finding names its remedy.** The refusal-that-named-no-remedy lesson
 * (`scripts/a-refusal-that-named-no-remedy.unit.test.ts`) applies to a report
 * exactly as it applies to an error: the message is the only surface that
 * reaches the person who is stuck, and "3 ownerless organisations" without the
 * UPDATE that fixes one is a fact filed where nobody can act on it.
 *
 * **Nothing prints a credential.** Two checks are about `platform_operator`
 * rows holding a token where a subject or an address should be, and the value
 * is the finding. Printing it would move the credential from a table into a
 * terminal, a scrollback, and whatever the operator pastes it into. So those
 * checks describe the row — its shape, its length, its age — and their remedy
 * is `clean`, which acts by id without the id ever being displayed.
 *
 * ## What `clean` cannot do, said rather than hidden
 *
 * IT CANNOT WRITE `audit_log`. That table's `tenant_id` is NOT NULL, and both
 * cleanable kinds are either about no tenant at all (`platform_operator`) or
 * about a tenant that is being removed, whose audit rows cascade away with it.
 * `operator.sh leave` audits because it is about an organisation that survives
 * the act; this is not, and inventing a row somewhere to make the two look
 * alike would be worse than the gap. What `clean` does instead is print exactly
 * what it changed, and refuse to write anything at all without `--confirm`.
 */

/**
 * One row a check found, normalised so a single runner can execute every query.
 *
 * The numbers mean different things per check — each `describe` documents its
 * own — which is the cost of one row type, and cheaper than five. What they
 * have in common is that they are the numbers that make a finding SPECIFIC:
 * "an empty organisation" is a category, "an empty organisation holding 4
 * mappings and 2 invoices" is something to decide about.
 */
export interface HousekeepingRow {
  /** Tenant uuid, member uuid, or operator subject — whatever `clean` keys on. */
  readonly id: string;
  /** A name a person recognises, or `(not printed)` where the value is a secret. */
  readonly label: string;
  /** Whatever else the check needs to say — a candidate's address, a tenant name. */
  readonly note: string;
  /** The count that makes this finding what it is. Meaning is per check. */
  readonly count: number;
  /** A second count, where one check needs two. Zero elsewhere. */
  readonly otherCount: number;
  /** How long it has been like this, in whole days. Zero where age is not the point. */
  readonly ageDays: number;
}

export type FindingKind =
  | 'empty-tenant'
  | 'ownerless-tenant'
  | 'stale-invitation'
  | 'operator-that-matches-nobody'
  | 'credential-at-rest';

/**
 * How to resolve one finding automatically, for the kinds where that is safe.
 *
 * `can` is the second gate and the important one: the QUERY decides what is a
 * finding, and this decides whether this particular row may be acted on without
 * a person. An empty organisation is always worth reporting; only one holding
 * nothing at all may be removed by a script.
 */
export interface HousekeepingClean {
  /** Why this row must not be cleaned, or null when it may be. */
  readonly can: (row: HousekeepingRow) => string | null;
  /** The statement, with `$1` bound to `row.id`. */
  readonly sql: string;
  /**
   * Is `row.id` a tenant, so the runner should set `app.current_tenant` around
   * the statement?
   *
   * DECLARED RATHER THAN GUESSED FROM THE SHAPE. Every table here carries FORCE
   * ROW LEVEL SECURITY whose policies read that setting, and the reference
   * stack's owner bypasses them only because it happens to be a superuser. A
   * runner that inferred "looks like a uuid, so set it" would also set it to a
   * member's uuid, where the policies want the TENANT's — and be wrong in a way
   * that works on every stack that bypasses and fails on the one that does not.
   */
  readonly tenantScoped: boolean;
  /** What it did, past tense, for the operator's terminal. */
  readonly did: (row: HousekeepingRow) => string;
}

export interface HousekeepingCheck {
  readonly kind: FindingKind;
  /** One line for the summary, in the plural. */
  readonly title: string;
  /** Why this matters. Printed by `check <kind>`, and read by whoever inherits this. */
  readonly why: string;
  /**
   * The query. MUST return exactly `id, label, note, count, other_count,
   * age_days` — the runner reads no other columns, and a check that returns
   * more is a check whose extra column nothing will ever show.
   */
  readonly find: string;
  /** The whole displayed line for one row. Never prints a value that is a secret. */
  readonly describe: (row: HousekeepingRow) => string;
  /** What to do about it — a command or a statement, ready to run. */
  readonly remedy: (row: HousekeepingRow) => string;
  /** How to resolve it automatically, or null when resolving needs a decision. */
  readonly clean: HousekeepingClean | null;
}

/** Whole days, from a timestamp column, as an int the runner can compare. */
const AGE_DAYS = (column: string): string =>
  `GREATEST(0, (EXTRACT(EPOCH FROM now() - ${column}) / 86400)::int)`;

/**
 * The three shapes a subject is definitely not, in SQL.
 *
 * THE SECOND READING OF `subjectRefusal`, and it has to be: that function runs
 * in TypeScript over one value somebody typed, and this runs in Postgres over
 * every row that is already there. Neither can do the other's job, and the two
 * must agree or a row this refuses to write is a row that never gets found.
 * `operator.unit.test.ts` runs both over the same examples for exactly that
 * reason — the same discipline `two-readings-of-one-env-file.unit.test.ts`
 * applies to `.env`.
 *
 * `~` and not `LIKE`: a JWT is three dot-separated segments beginning `eyJ`,
 * and `LIKE 'eyJ%'` would also catch a provider that happens to mint subjects
 * starting with those three letters.
 *
 * `[^.]*` and not `[^.]+` for the last two segments, which is the one place the
 * two readings nearly disagreed. `subjectRefusal` splits on `.` and asks for
 * THREE parts, and `eyJx..b` is three parts — an empty middle is still a
 * token-shaped thing and it refuses one. A `+` here would have let exactly that
 * row through the query while the writer kept refusing to create it: a shape
 * that can only exist historically, and so exactly the shape a cleanup check is
 * for. Found by writing the test that runs both over the same examples.
 */
const NOT_A_SUBJECT = `(
        %COL% = '--'
     OR length(%COL%) > 200
     OR %COL% ~ '^eyJ[A-Za-z0-9_-]+\\.[^.]*\\.[^.]*$'
      )`;

const notASubject = (column: string): string => NOT_A_SUBJECT.split('%COL%').join(column);

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * Every question `operator.sh check` asks, in the order it asks them.
 *
 * ORDERED BY WHO IS HURT. An ownerless organisation has real people in it who
 * cannot administer their own migration; a credential at rest is a security
 * fact with a clock on it; an empty organisation hurts nobody and is merely
 * untidy. An operator reading a long report reads the top of it.
 */
export const HOUSEKEEPING_CHECKS: readonly HousekeepingCheck[] = [
  {
    kind: 'ownerless-tenant',
    title: 'organisations with people in them and no owner',
    why:
      'Every administrative act — inviting somebody, changing a role, pressing a\n' +
      'cutover, naming a billing party — is gated on `owner`. An organisation with\n' +
      'members and no active owner is not merely untidy: the people in it can watch\n' +
      'their migration and change nothing about it, and nothing in the product tells\n' +
      'them why. `operator.sh leave` refuses to create one; this finds the ones that\n' +
      'already exist, from a removal, a suspension, or an owner who never claimed.',
    find: `
      SELECT t.id::text AS id,
             t.name     AS label,
             coalesce((SELECT tm.email FROM tenant_member tm
                        WHERE tm.tenant_id = t.id AND tm.status = 'active'
                        ORDER BY tm.created_at LIMIT 1), '') AS note,
             (SELECT count(*) FROM tenant_member tm
               WHERE tm.tenant_id = t.id
                 AND tm.status NOT IN ('removed', 'declined'))::int AS count,
             (SELECT count(*) FROM tenant_member tm
               WHERE tm.tenant_id = t.id AND tm.status = 'active')::int AS other_count,
             0 AS age_days
        FROM tenant t
       WHERE EXISTS (SELECT 1 FROM tenant_member tm
                      WHERE tm.tenant_id = t.id
                        AND tm.status NOT IN ('removed', 'declined'))
         AND NOT EXISTS (SELECT 1 FROM tenant_member tm
                          WHERE tm.tenant_id = t.id
                            AND tm.role = 'owner' AND tm.status = 'active')
       ORDER BY t.name`,
    // count = people still in it; otherCount = how many of those are active.
    describe: (row) =>
      `${row.label} [${row.id}] — ${plural(row.count, 'member', 'members')}, ` +
      `no active owner (${row.otherCount} active)`,
    remedy: (row) =>
      row.note
        ? 'promote somebody who is already there:\n' +
          `        UPDATE tenant_member SET role = 'owner', updated_at = now()\n` +
          `         WHERE tenant_id = '${row.id}' AND email = '${row.note.split("'").join("''")}';`
        : 'nobody in it is active, so there is nobody to promote — the members are\n' +
          '        invited or suspended. Reinstate one first, or treat this as an\n' +
          '        abandoned organisation.',
    // NOT CLEANABLE, and this is the clearest case of why. Picking who becomes
    // the owner of somebody else's organisation is not a tidy-up; it is a
    // decision with a person's name on it, and a script that made it would be
    // choosing an administrator for a customer.
    clean: null,
  },

  {
    kind: 'credential-at-rest',
    title: 'operator rows holding a token where an address belongs',
    why:
      'On 2026-08-31 an appointment was made with the whole ID token in the place of\n' +
      'the subject. The arguments shifted, the token landed in `email`, and a\n' +
      'nine-hundred-character credential sat in a table of identifiers — one that is\n' +
      'protected like an identifier, read by `operator:list`, and printed to whoever\n' +
      'runs it. `subjectRefusal` now stops that at the moment of writing. This finds\n' +
      'the rows written before it existed.\n\n' +
      'The VALUE is never printed, here or anywhere: that would move the credential\n' +
      'from one table into a terminal, a scrollback, and whatever gets pasted where.',
    find: `
      SELECT po.user_id        AS id,
             '(not printed)'   AS label,
             -- NOT po.note, and not po.email either. This row is defined by
             -- holding a credential, and note is operator-written free text of
             -- no fixed length beside it — a report that echoed either into a
             -- terminal would be moving the thing out of a table where it is at
             -- least access-controlled. Nothing is lost: the row is acted on by
             -- id, and the id is never displayed.
             ''                AS note,
             length(po.email)::int AS count,
             0 AS other_count,
             ${AGE_DAYS('po.created_at')} AS age_days
        FROM platform_operator po
       WHERE po.email ~ '^eyJ[A-Za-z0-9_-]+\\.[^.]*\\.[^.]*$'
          OR length(po.email) > 320
       ORDER BY po.created_at`,
    // count = the length of the value, which says what it is without saying it.
    describe: (row) =>
      `an operator whose email column holds ${row.count} characters ` +
      `(appointed ${plural(row.ageDays, 'day', 'days')} ago) — the value is a credential, not an address`,
    remedy: () =>
      'redact it, keeping the appointment:\n' +
      '        ./deploy/compose/operator.sh clean credential-at-rest --confirm\n' +
      '        then set the real address:\n' +
      '        ./deploy/compose/operator.sh add <their subject> <their email> [note]',
    clean: {
      // Always safe: it replaces a credential with a marker and changes nothing
      // about who may do what. The subject is untouched, so the person stays an
      // operator and `operator:add` puts the real address back idempotently.
      can: () => null,
      sql: `UPDATE platform_operator
               SET email = 'redacted-credential@invalid'
             WHERE user_id = $1`,
      tenantScoped: false,
      did: () =>
        'redacted the email column. The appointment stands and the subject is\n' +
        '    unchanged — set the real address with `operator.sh add <subject> <email>`.',
    },
  },

  {
    kind: 'operator-that-matches-nobody',
    title: 'operator rows no subject can ever match',
    why:
      'A `platform_operator` row whose `user_id` is a token, an argument separator,\n' +
      'or something far too long to be an identifier grants nothing: no issuer will\n' +
      'ever mint that subject, so `isPlatformOperator` matches it against nobody. It\n' +
      'is also the exact residue of the 2026-08-31 appointment that went to nobody\n' +
      'twice — and `operator:list` shows it, which is how an afternoon went into\n' +
      'reading a menu that was correct.\n\n' +
      'Removing one takes nothing away from anybody, because it was never anybody.',
    find: `
      SELECT po.user_id      AS id,
             '(not printed)' AS label,
             -- Same reason as credential-at-rest above: the subject in this
             -- row may itself be a token, and note sits beside it as unbounded
             -- free text. Neither is fetched.
             ''              AS note,
             length(po.user_id)::int AS count,
             0 AS other_count,
             ${AGE_DAYS('po.created_at')} AS age_days
        FROM platform_operator po
       WHERE ${notASubject('po.user_id')}
       ORDER BY po.created_at`,
    // count = the subject's length, which is the whole description it may have.
    describe: (row) =>
      `an operator row whose subject is ${plural(row.count, 'character', 'characters')} long ` +
      `and matches nobody (appointed ${plural(row.ageDays, 'day', 'days')} ago)`,
    remedy: () =>
      'remove it — it grants nothing to anybody:\n' +
      '        ./deploy/compose/operator.sh clean operator-that-matches-nobody --confirm',
    clean: {
      can: () => null,
      sql: `DELETE FROM platform_operator WHERE user_id = $1`,
      tenantScoped: false,
      did: () => 'removed. It matched no subject any issuer can mint, so nobody lost anything.',
    },
  },

  {
    kind: 'stale-invitation',
    title: 'invitations nobody has answered',
    why:
      'Granting writes `pending:<uuid>` into `tenant_member` because the person has\n' +
      'not signed in and has no subject to bind to; claiming replaces it on first\n' +
      'sign-in. One that is still `pending:` after a month is an invitation that did\n' +
      'not arrive, went to the wrong address, or was answered by somebody who then\n' +
      'signed in as somebody else. All three are worth knowing, and none of them is\n' +
      'visible anywhere in the product.',
    find: `
      SELECT tm.id::text AS id,
             tm.email    AS label,
             t.name      AS note,
             1 AS count,
             0 AS other_count,
             ${AGE_DAYS("coalesce(tm.invited_at, tm.created_at)")} AS age_days
        FROM tenant_member tm
        JOIN tenant t ON t.id = tm.tenant_id
       WHERE tm.status = 'invited'
         AND tm.user_id LIKE 'pending:%'
         AND coalesce(tm.invited_at, tm.created_at) < now() - interval '30 days'
       ORDER BY coalesce(tm.invited_at, tm.created_at)`,
    describe: (row) =>
      `${row.label} was invited to ${row.note} ${plural(row.ageDays, 'day', 'days')} ago ` +
      'and has never signed in',
    remedy: (row) =>
      're-send it, or withdraw it:\n' +
      `        DELETE FROM tenant_member WHERE id = '${row.id}';\n` +
      '        (check `operator.sh check ownerless-tenant` afterwards if they were\n' +
      '        the only owner)',
    // NOT CLEANABLE. Withdrawing somebody's invitation is a decision — thirty
    // days is a heuristic, not a fact about whether they are coming — and doing
    // it in bulk could leave an organisation with no owner, which is the finding
    // above. A script that created its own next finding would be worse than one
    // that reports.
    clean: null,
  },

  {
    kind: 'empty-tenant',
    title: 'organisations with nobody in them',
    why:
      'Every route resolves the tenant from a membership, so an organisation with no\n' +
      'members cannot be reached through the product by anybody. That is a legitimate\n' +
      'end state — `operator.sh leave --all` reaches it deliberately, and says so —\n' +
      'and it is also where a failed grant, a removed last member, and every night of\n' +
      'demo residue end up.\n\n' +
      'It matters what is INSIDE one. An empty organisation holding mappings or\n' +
      'invoices is somebody\'s work with nobody attached; one holding nothing is a\n' +
      'row.',
    find: `
      SELECT t.id::text AS id,
             t.name     AS label,
             t.status   AS note,
             ((SELECT count(*) FROM mailbox_mapping m WHERE m.tenant_id = t.id)
            + (SELECT count(*) FROM connection c WHERE c.tenant_id = t.id))::int AS count,
             (SELECT count(*) FROM invoice i WHERE i.tenant_id = t.id)::int AS other_count,
             ${AGE_DAYS('t.created_at')} AS age_days
        FROM tenant t
       WHERE NOT EXISTS (SELECT 1 FROM tenant_member tm
                          WHERE tm.tenant_id = t.id
                            AND tm.status NOT IN ('removed', 'declined'))
       ORDER BY t.created_at`,
    // count = mappings + connections; otherCount = invoices.
    describe: (row) =>
      `${row.label} [${row.id}] — nobody in it, ${plural(row.count, 'mapping/connection', 'mappings/connections')}, ` +
      `${plural(row.otherCount, 'invoice', 'invoices')}, created ${plural(row.ageDays, 'day', 'days')} ago`,
    remedy: (row) =>
      row.count === 0 && row.otherCount === 0
        ? 'it holds nothing — remove it:\n' +
          '        ./deploy/compose/operator.sh clean empty-tenant --confirm'
        : 'it holds work. Put somebody back in rather than deleting it:\n' +
          '        BEGIN;\n' +
          `        SELECT set_config('app.current_tenant', '${row.id}', true);\n` +
          '        INSERT INTO tenant_member (tenant_id, user_id, email, role, status, joined_at)\n' +
          `        VALUES ('${row.id}'::uuid, '<subject>', '<email>', 'owner', 'active', now());\n` +
          '        COMMIT;',
    clean: {
      // THE SECOND GATE, and the whole reason `can` exists. Deleting a tenant
      // cascades roughly twenty-five tables — invoices among them, which are
      // kept for tax retention and which migration 0012's trigger refuses to
      // UPDATE precisely because they must not change after issue. So this
      // removes only a tenant that holds nothing at all: no mapping, no
      // connection, no invoice. Everything else is reported and left alone.
      can: (row) =>
        row.count === 0 && row.otherCount === 0
          ? null
          : `holds ${plural(row.count, 'mapping/connection', 'mappings/connections')} and ` +
            `${plural(row.otherCount, 'invoice', 'invoices')} — deleting it would cascade them away. ` +
            'Put an owner back instead.',
      sql: `DELETE FROM tenant WHERE id = $1::uuid`,
      tenantScoped: true,
      did: (row) => `removed. It held no mapping, no connection and no invoice (created ${row.ageDays}d ago).`,
    },
  },
];

/** One check by name, or null — so an unknown kind refuses with the list. */
export function checkByKind(kind: string): HousekeepingCheck | null {
  return HOUSEKEEPING_CHECKS.find((c) => c.kind === kind) ?? null;
}

/** Every kind, for the usage line and the unknown-kind refusal. */
export const HOUSEKEEPING_KINDS: readonly string[] = HOUSEKEEPING_CHECKS.map((c) => c.kind);

/**
 * The refusal for `clean <kind>` where the kind is report-only.
 *
 * NAMES WHAT TO DO INSTEAD, because "this one is not automatic" is the answer
 * to a question nobody asked. The person ran `clean` because they want the
 * finding gone, and the remedy is what makes that possible.
 */
export function notCleanableRefusal(check: HousekeepingCheck): string {
  return (
    `\`${check.kind}\` is reported, never cleaned automatically.\n\n` +
    `${check.why}\n\n` +
    'Resolving one takes a decision this script must not make for you. Run\n' +
    `    ./deploy/compose/operator.sh check ${check.kind}\n` +
    'and each finding is printed with the statement that resolves it.'
  );
}

/**
 * The refusal for a kind that does not exist.
 *
 * A typo in a sub-command's argument is the same class of mistake as a typo in
 * the sub-command, and the same answer works: say what was asked for, and list
 * what there is.
 */
export function unknownKindRefusal(kind: string): string {
  return (
    `there is no check called \`${kind}\`.\n\n` +
    'The checks are:\n' +
    HOUSEKEEPING_CHECKS.map((c) => `    ${c.kind}  — ${c.title}`).join('\n') +
    '\n\nRun `./deploy/compose/operator.sh check` with no argument for all of them.'
  );
}
