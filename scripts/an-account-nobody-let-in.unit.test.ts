// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ACCOUNT NOBODY LET IN (workplan 0135 T8).
 *
 * Anybody can create an account at the sign-in page. It opens nothing until an
 * operator grants a request for its address, but the identity provider holds a
 * name, an address, a password hash and sessions for it, and privacy 1.2's §9
 * keeps it 30 days. Nothing removed one. `deploy/compose/idp-strays.sh` lists
 * them and, when asked, removes them. What it must never get wrong, a case or
 * two each:
 *
 *   Whom it lists. An account with no membership, no operator row, no open
 *   request and no open invitation for its address, older than 30 days. An
 *   address compares without case. The provider's own members, the first human
 *   among them, are never listed; nor is a machine user, or an account whose
 *   age it cannot read. Every page of the listing is read.
 *
 *   An account that was let in is kept (2026-09-29). A member removed on the
 *   Team page (`apps/api/src/routes/tenants/members.ts`) or by `operator.sh
 *   leave` has no member row left, and the script took their used account for
 *   one nobody let in. Privacy §9's 30 days are for an account "that we never
 *   let in" (`site/legal/privacy.md`), and the owner's answer was "unused, yes"
 *   (`site/legal/README.md`). Both removals record `member.removed` in
 *   `audit_log` with the subject, and the script keeps every subject so
 *   recorded. `apps/api/src/routes/tenants/a-member-removed-is-recorded.unit.test.ts`
 *   holds the route's half.
 *
 *   Only our own organisation's accounts. An account whose
 *   `details.resourceOwner` is not `GET /management/v1/orgs/me`'s id is
 *   another organisation's, and one given a membership or a grant at the
 *   provider was given a role there by hand: both are left alone. A membership
 *   or grant answer is read as the provider counts it, the larger of its list
 *   and its count; one that counts roles it lists elsewhere, or not at all, is
 *   refused, never read as "no role" (review of 2026-09-29).
 *
 *   What it removes. Nothing, without `--remove`. With it, exactly what it
 *   listed, each removal on a line with the id and never the address. A
 *   removal that fails is named, and the run fails. With `--at-most N`, as
 *   live's daily duty runs it (0135 T8 (b)), nothing when more than N would go.
 *
 *   When it refuses, removing nothing. A database read that fails, a listing in
 *   a shape it does not know, a page with accounts and no count, an empty page
 *   before the count is reached, a count below the accounts already given, a
 *   membership or grant answer in a shape it does not know, a token the
 *   provider refuses, no token at all,
 *   an instance with no members, no organisation for the token, a membership
 *   or grant search that fails, a database whose people have no account at
 *   this provider, and, with `--remove`, a database with no operator row: each
 *   would make somebody look like a stranger. In the review of 2026-09-29, a
 *   stand-in with an empty database beside a provider holding three testers
 *   removed all three: the strangers check needs somebody named, and
 *   `--at-most 20` does not stop a stack of 20 or fewer. Listing on a fresh
 *   stack is still allowed.
 *
 *   One account, at any age (`--subject`), for an organisation that has been
 *   erased; refused while it is still a member anywhere, was removed from an
 *   organisation that still exists, is an operator, has an open request or
 *   invitation, belongs to another organisation or holds a role at the
 *   provider. A subject that is not an id never reaches a URL.
 *
 *   Whose stack, and the token. The checkout's own project, its database and
 *   its token's volume; the token goes to curl in a file, never on a command
 *   line.
 *
 * `docker` and `curl` are stubs on the PATH: the database answers what the
 * fixture holds for the statement it is sent, and the provider pages its
 * accounts as the script asks, names its organisation, and answers each
 * account's memberships and grants, or with a case's own answer
 * (`STUB_MEMBERSHIPS_ANSWER`, `STUB_GRANTS_ANSWER`). The statements themselves
 * are held as text.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const SCRIPT = 'idp-strays.sh';
const PROJECT = 'ownpace-managed';
const TOKEN = 'a-provisioning-token-of-forty-characters';
const DAY = 86_400_000;

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** The database: what each of the script's four statements is answered with. */
const DOCKER_STUB = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >>"$STUB_LOG"
case "$1" in
  run)
    [ "\${STUB_NO_TOKEN:-}" = 1 ] && exit 1
    printf '%s\\n' "$STUB_TOKEN" ;;
  exec)
    sql="\${!#}"
    printf 'sql %s | %s\\n' "$2" "$sql" >>"$STUB_LOG"
    case "$sql" in
      *platform_operator*) table=operators ;;
      *audit_log*) table=removed ;;
      *access_request*) table=requests ;;
      *"status = 'invited'"*) table=invited ;;
      *tenant_member*) table=members ;;
      *) exit 3 ;;
    esac
    if [ "\${STUB_DB_FAIL:-}" = "$table" ]; then
      echo "ERROR:  relation does not exist" >&2
      exit 1
    fi
    cat "$STUB_DIR/$table" ;;
  *) exit 1 ;;
esac
`;

/**
 * The provider. It refuses a request whose Authorization header, read from the
 * file curl is handed, is not the volume's token; it pages the accounts with
 * the offset and limit it is sent, humans only when it is asked for humans.
 */
const CURL_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$STUB_ARGV"
method=GET url='' body='' header_file='' out=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    -d) body="$2"; shift 2 ;;
    -H) case "$2" in @*) header_file="\${2#@}" ;; esac; shift 2 ;;
    -o) out="$2"; shift 2 ;;
    -w|--max-time|--resolve) shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
path="/\${url#*://*/}"
if [ "$path" = /debug/healthz ]; then
  [ "\${STUB_UNREACHABLE:-}" = 1 ] && exit 7
  exit 0
fi
printf '%s %s %s\\n' "$method" "$path" "$body" >>"$STUB_CALLS"
answer() { printf '%s\\n%s' "$2" "$1"; exit 0; }
header=''
[ -n "$header_file" ] && read -r header <"$header_file"
[ "$header" = "Authorization: Bearer $STUB_TOKEN" ] || answer 401 '{"message":"unauthenticated"}'
[ "\${STUB_REFUSE:-}" = 1 ] && answer 401 '{"message":"token expired"}'
case "$method $path" in
  'POST /admin/v1/members/_search') answer 200 "$(cat "$STUB_DIR/iam.json")" ;;
  'POST /management/v1/orgs/me/members/_search') answer 200 "$(cat "$STUB_DIR/org.json")" ;;
  'GET /management/v1/orgs/me')
    [ "\${STUB_FAILS:-}" = orgme ] && answer 500 '{"message":"internal"}'
    answer 200 "$(cat "$STUB_DIR/orgme.json")" ;;
  'POST /management/v1/users/grants/_search')
    id=''
    re='"userId":"([^"]*)"'
    [[ "$body" =~ $re ]] && id="\${BASH_REMATCH[1]}"
    [ "\${STUB_FAILS:-}" = grants ] && answer 500 '{"message":"internal"}'
    [ -n "\${STUB_GRANTS_ANSWER:-}" ] && answer 200 "$STUB_GRANTS_ANSWER"
    [ -n "$id" ] && [ -e "$STUB_DIR/grants/$id" ] && answer 200 '{"details":{"totalResult":"1"},"result":[{"id":"g-'"$id"'","userId":"'"$id"'","roleKeys":["reader"]}]}'
    answer 200 '{"details":{}}' ;;
  'POST /management/v1/users/'*'/memberships/_search')
    id="\${path#/management/v1/users/}"
    id="\${id%%/*}"
    [ "\${STUB_FAILS:-}" = memberships ] && answer 500 '{"message":"internal"}'
    [ -n "\${STUB_MEMBERSHIPS_ANSWER:-}" ] && answer 200 "$STUB_MEMBERSHIPS_ANSWER"
    [ -e "$STUB_DIR/memberships/$id" ] && answer 200 '{"details":{"totalResult":"1"},"result":[{"userId":"'"$id"'","projectId":"p1","roles":["PROJECT_OWNER"]}]}'
    answer 200 '{"details":{}}' ;;
  'POST /v2/users')
    [ -n "\${STUB_LISTING:-}" ] && answer 200 "$STUB_LISTING"
    # STUB_EMPTY_FROM: from that offset on, an empty page, with the count
    # (STUB_EMPTY_COUNT=keep) or with nothing at all.
    answer 200 "$(jq -c --argjson q "$body" --arg every "\${STUB_IGNORES_TYPE:-}" \\
        --argjson emptyFrom "\${STUB_EMPTY_FROM:-null}" --arg emptyCount "\${STUB_EMPTY_COUNT:-}" '
      (if $every == "" and ($q.queries // [] | any(.typeQuery.type == "TYPE_HUMAN")) then map(select(has("human"))) else . end) as $all
      | ($q.query.offset // 0) as $o
      | if $emptyFrom != null and $o >= $emptyFrom then
          (if $emptyCount == "keep" then { details: { totalResult: ($all | length | tostring) }, result: [] } else {} end)
        else
          { details: { totalResult: ($all | length | tostring) },
            result: $all[$o : ($o + ($q.query.limit // 100))] }
        end' "$STUB_DIR/humans.json")" ;;
  'DELETE /v2/users/'*)
    id="\${path##*/}"
    case " \${STUB_DELETE_FAILS:-} " in *" $id "*) answer 500 '{"message":"internal"}' ;; esac
    case " \${STUB_DELETE_GONE:-} " in *" $id "*) answer 404 '{"message":"not found"}' ;; esac
    answer 200 '{"details":{}}' ;;
esac
answer 404 '{"message":"no such route"}'
`;

interface Account {
  userId: string;
  email?: string;
  /** How old the account is, in days; undefined means no creation date. */
  days?: number;
  machine?: boolean;
  /** The organisation at the provider that holds it (`details.resourceOwner`); '100' is ours. */
  org?: string;
}

function account({ userId, email, days, machine, org }: Account): Record<string, unknown> {
  const details: Record<string, unknown> = { sequence: '7', resourceOwner: org ?? '100' };
  // The provider stamps fractions of a second, which the script must strip.
  if (days !== undefined) details.creationDate = new Date(Date.now() - days * DAY).toISOString();
  return machine
    ? { userId, details, username: userId, machine: { name: 'provisioning' } }
    : { userId, details, username: email, preferredLoginName: email, human: { email: { email, isVerified: true } } };
}

interface World {
  accounts?: Account[];
  /** `tenant_member.user_id`, every status. */
  members?: string[];
  /** `detail.userId` of `audit_log` rows `member.removed`: people let in and removed since. */
  removed?: string[];
  operators?: string[];
  /** Addresses on open access requests. */
  requests?: string[];
  /** Addresses on `tenant_member` rows with status 'invited'. */
  invited?: string[];
  /** The instance's members at the provider. */
  iam?: string[];
  /** The organisation's members at the provider. */
  org?: string[];
  /** What `GET /management/v1/orgs/me` answers; the organisation '100' by default. */
  orgMe?: unknown;
  /** Accounts with a membership at the provider (a project role, say). */
  memberships?: string[];
  /** Accounts with a user grant at the provider. */
  grants?: string[];
}

interface Run {
  status: number | null;
  out: string;
  err: string;
  /** `METHOD /path body` for every call to the provider but the health probe. */
  calls: string[];
  deleted: string[];
  docker: string[];
  argv: string;
}

function run(world: World, opts: { args?: string[]; stub?: Record<string, string>; shell?: Record<string, string> } = {}): Run {
  const root = mkdtempSync(join(tmpdir(), 'idp-strays-'));
  tempDirs.push(root);
  const compose = join(root, 'checkout', 'deploy', 'compose');
  const bin = join(root, 'bin');
  const data = join(root, 'data');
  for (const d of [compose, bin, data]) mkdirSync(d, { recursive: true });
  for (const f of [SCRIPT, 'env-read.sh', 'stack-kind.sh', 'managed.yml']) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
  }
  writeFileSync(join(compose, '.env'), 'POSTGRES_USER=openmigrate\n');
  const lines = (xs: string[] = []) => xs.map((x) => `${x}\n`).join('');
  writeFileSync(join(data, 'members'), lines(world.members));
  writeFileSync(join(data, 'removed'), lines(world.removed));
  writeFileSync(join(data, 'operators'), lines(world.operators));
  writeFileSync(join(data, 'requests'), lines(world.requests));
  writeFileSync(join(data, 'invited'), lines(world.invited));
  const members = (ids: string[]) => JSON.stringify({ result: ids.map((userId) => ({ userId, roles: ['IAM_OWNER'] })) });
  writeFileSync(join(data, 'iam.json'), members(world.iam ?? ['1']));
  writeFileSync(join(data, 'org.json'), members(world.org ?? []));
  writeFileSync(join(data, 'orgme.json'), JSON.stringify(world.orgMe ?? { org: { id: '100', name: 'Ownpace' } }));
  // One file per account holding a role, so the stand-in answers without a process.
  for (const held of ['memberships', 'grants'] as const) {
    mkdirSync(join(data, held));
    for (const id of world[held] ?? []) writeFileSync(join(data, held, id), '');
  }
  writeFileSync(join(data, 'humans.json'), JSON.stringify((world.accounts ?? []).map(account)));
  const logs = { STUB_LOG: join(root, 'docker.log'), STUB_CALLS: join(root, 'calls.log'), STUB_ARGV: join(root, 'argv.log') };
  for (const f of Object.values(logs)) writeFileSync(f, '');
  writeFileSync(join(bin, 'docker'), DOCKER_STUB);
  writeFileSync(join(bin, 'curl'), CURL_STUB);
  chmodSync(join(bin, 'docker'), 0o755);
  chmodSync(join(bin, 'curl'), 0o755);
  const r = spawnSync('bash', [join(compose, SCRIPT), ...(opts.args ?? [])], {
    cwd: join(root, 'checkout'),
    env: {
      PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: root,
      STUB_DIR: data,
      STUB_TOKEN: TOKEN,
      ...logs,
      ...opts.stub,
      ...opts.shell,
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  const calls = readFileSync(logs.STUB_CALLS, 'utf8').split('\n').filter(Boolean);
  return {
    status: r.status,
    out: r.stdout,
    err: r.stderr,
    calls,
    deleted: calls.filter((c) => c.startsWith('DELETE ')).map((c) => c.split(' ')[1]!.split('/').pop()!),
    docker: readFileSync(logs.STUB_LOG, 'utf8').split('\n').filter(Boolean),
    argv: readFileSync(logs.STUB_ARGV, 'utf8'),
  };
}

/** An account for each reason to leave one alone, beside one stray. */
function aStackWithEveryReason(): World {
  return {
    accounts: [
      { userId: '1', email: 'first@provider.example', days: 400 },
      { userId: '2', email: 'admin@provider.example', days: 90 },
      { userId: '10', email: 'stray@example.test', days: 45 },
      { userId: '11', email: 'member@example.test', days: 45 },
      { userId: '12', email: 'operator@example.test', days: 45 },
      { userId: '13', email: 'Asked@Example.test', days: 45 },
      { userId: '14', email: 'invited@example.test', days: 45 },
      { userId: '15', email: 'new@example.test', days: 5 },
      { userId: '16', email: 'undated@example.test' },
      { userId: '99', machine: true, days: 400 },
    ],
    members: ['11', 'pending:an-invitation'],
    operators: ['12'],
    requests: ['ASKED@example.test'],
    invited: ['INVITED@example.test'],
    iam: ['1', '99'],
    org: ['2'],
  };
}

describe('whom it lists', () => {
  it('an account older than 30 days that nobody let in, and none of the others', () => {
    const r = run(aStackWithEveryReason());
    expect(r.status, r.err).toBe(0);
    expect(r.out).toMatch(/^ {2}10 {2}stray@example\.test {2}created \d{4}-\d{2}-\d{2}, 45 days ago$/m);
    for (const kept of ['first@', 'admin@', 'member@', 'operator@', 'Asked@', 'invited@', 'new@', 'undated@']) {
      expect(r.out).not.toContain(kept);
    }
    expect(r.out).toContain(
      "stack 'ownpace-managed': 9 accounts at the provider, 1 nobody let in and older than 30 days.",
    );
    expect(r.out).toContain(
      "left alone: 2 the provider's own members, 1 members of an organisation, 1 operators, " +
        '1 with an open access request, 1 with an open invitation, 1 younger than 30 days, 1 with no creation date.',
    );
    expect(r.out).toContain('nothing was removed. To remove it: ./deploy/compose/idp-strays.sh --remove');
    expect(r.deleted).toEqual([]);
  });

  it('asks the provider for humans, a page at a time, and reads every page', () => {
    // The first and the last are old, on the first page and the third; the
    // rest are young, so they are weighed without a question to the provider
    // each (a membership, a grant), which 250 strays would ask 500 times.
    const accounts = Array.from({ length: 250 }, (_, n) => ({
      userId: `${1000 + n}`,
      email: `p${n}@example.test`,
      days: n === 0 || n === 249 ? 60 : 5,
    }));
    const r = run({ accounts: [{ userId: '1', email: 'first@provider.example', days: 400 }, ...accounts], members: ['1'] });
    expect(r.status, r.err).toBe(0);
    const listings = r.calls.filter((c) => c.startsWith('POST /v2/users '));
    expect(listings.map((c) => JSON.parse(c.slice('POST /v2/users '.length)).query.offset)).toEqual([0, 100, 200]);
    for (const c of listings) expect(c).toContain('"typeQuery":{"type":"TYPE_HUMAN"}');
    expect(r.out).toContain('251 accounts at the provider, 2 nobody let in');
    expect(r.out).toContain('248 younger than 30 days');
    expect(r.out).toContain('  1000  p0@example.test');
    expect(r.out).toContain('  1249  p249@example.test');
  });

  it('never lists a machine user, even from a provider that answers with one', () => {
    const world = aStackWithEveryReason();
    world.accounts!.push({ userId: '98', machine: true, days: 400 });
    const r = run(world, { stub: { STUB_IGNORES_TYPE: '1' } });
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('9 accounts at the provider, 1 nobody let in');
    expect(r.out).not.toMatch(/^ {2}98 /m);
  });

  it('reads the database with these statements, and no others', () => {
    const r = run(aStackWithEveryReason());
    expect(r.docker.filter((l) => l.startsWith('sql '))).toEqual([
      `sql ${PROJECT}-db | SELECT DISTINCT user_id FROM tenant_member`,
      `sql ${PROJECT}-db | SELECT DISTINCT detail->>'userId' FROM audit_log WHERE action = 'member.removed'`,
      `sql ${PROJECT}-db | SELECT user_id FROM platform_operator`,
      `sql ${PROJECT}-db | SELECT DISTINCT email FROM access_request WHERE state = 'open'`,
      `sql ${PROJECT}-db | SELECT DISTINCT email FROM tenant_member WHERE status = 'invited'`,
    ]);
  });
});

describe('an account that was let in is kept, also after its membership is gone', () => {
  // The Team page's removal and `operator.sh leave` delete the member row and
  // record `member.removed` in audit_log with the subject. Privacy §9's 30 days
  // are for an account "that we never let in"; the owner's question was
  // whether these are unused accounts, answered "unused, yes"
  // (site/legal/README.md). What becomes of a removed member's account is the
  // owner's open question (0135); until it is answered, it is kept.
  const withARemovedMember = (): World => {
    const world = aStackWithEveryReason();
    world.accounts!.push({ userId: '20', email: 'former@example.test', days: 120 });
    world.removed = ['20', 'pending:an-invitation-withdrawn'];
    return world;
  };

  it('keeps an account whose removal from an organisation is recorded, and says why', () => {
    const r = run(withARemovedMember(), { args: ['--remove', '--at-most', '20'] });
    expect(r.status, r.err).toBe(0);
    expect(r.deleted).toEqual(['10']);
    expect(r.out).toContain('10 accounts at the provider, 1 nobody let in and older than 30 days.');
    expect(r.out).toContain('1 let in and removed since');
  });

  it('refuses --subject for it, naming the reason', () => {
    const r = run(withARemovedMember(), { args: ['--subject', '20', '--remove'] });
    expect(r.status).toBe(1);
    expect(r.err).toContain('account 20 is left alone: it was let in, and removed from an organisation here since.');
    expect(r.deleted).toEqual([]);
  });

  it('refuses, before it asks the provider anything, when the record of removals cannot be read', () => {
    const r = run(withARemovedMember(), { args: ['--remove'], stub: { STUB_DB_FAIL: 'removed' } });
    expect(r.status).toBe(1);
    expect(r.err).toContain('could not be read');
    expect(r.err).toContain('nothing was removed.');
    expect(r.calls).toEqual([]);
  });
});

describe('it removes nothing when the database names nobody', () => {
  // An emptied database, or one restored without its operator row, beside a
  // provider that still holds the testers: every tester looks like a
  // stranger, and at the alpha's scale --at-most 20 does not stop it. Live
  // always has an operator row after managed-bring-up's "Become the operator".
  // A reset that brought that row back first and not the members is not seen
  // here: the runbook holds the duty until the members are back.
  const aDatabaseThatNamesNobody = (): World => ({
    accounts: [
      { userId: '1', email: 'first@provider.example', days: 400 },
      { userId: '20', email: 'tester1@example.test', days: 60 },
      { userId: '21', email: 'tester2@example.test', days: 60 },
      { userId: '22', email: 'tester3@example.test', days: 60 },
    ],
  });

  it('--remove refuses when no operator row exists, before it asks the provider anything', () => {
    const r = run(aDatabaseThatNamesNobody(), { args: ['--remove', '--at-most', '20'] });
    expect(r.status).toBe(1);
    expect(r.err).toContain("the database of 'ownpace-managed' has no operator row (platform_operator)");
    expect(r.err).toContain('Become the operator');
    expect(r.err).toContain('nothing was removed.');
    expect(r.deleted).toEqual([]);
    expect(r.calls).toEqual([]);
  });

  it('--subject --remove refuses there too', () => {
    const r = run(aDatabaseThatNamesNobody(), { args: ['--subject', '20', '--remove'] });
    expect(r.status).toBe(1);
    expect(r.err).toContain('has no operator row (platform_operator)');
    expect(r.deleted).toEqual([]);
    expect(r.calls).toEqual([]);
  });

  it('a database with members and no operator row refuses --remove as well', () => {
    const r = run({ ...aStackWithEveryReason(), operators: [] }, { args: ['--remove'] });
    expect(r.status).toBe(1);
    expect(r.err).toContain('has no operator row (platform_operator)');
    expect(r.deleted).toEqual([]);
  });

  it('but listing, a fresh stack, still works, and says why --remove would refuse', () => {
    const r = run(aDatabaseThatNamesNobody());
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('4 accounts at the provider, 3 nobody let in');
    expect(r.out).toMatch(/^ {2}20 {2}tester1@example\.test/m);
    expect(r.out).toContain('--remove refuses while the database names no operator (platform_operator)');
    expect(r.out).not.toContain('To remove these');
    expect(r.deleted).toEqual([]);
  });
});

describe('it weighs only the accounts of our own organisation at the provider', () => {
  it('leaves an account of another organisation alone, however old, and counts it', () => {
    const world = aStackWithEveryReason();
    world.accounts!.push({ userId: '30', email: 'elsewhere@example.test', days: 90, org: '200' });
    const r = run(world, { args: ['--remove', '--at-most', '20'] });
    expect(r.status, r.err).toBe(0);
    expect(r.deleted).toEqual(['10']);
    expect(r.out).toContain('1 of another organisation at the provider');
    expect(r.calls).toContain('GET /management/v1/orgs/me ');
  });

  it('refuses --subject for such an account', () => {
    const world = aStackWithEveryReason();
    world.accounts!.push({ userId: '30', email: 'elsewhere@example.test', days: 90, org: '200' });
    const r = run(world, { args: ['--subject', '30', '--remove'] });
    expect(r.status).toBe(1);
    expect(r.err).toContain('account 30 is left alone: it belongs to another organisation at the provider.');
    expect(r.deleted).toEqual([]);
  });

  const orgAnswers: Array<[string, { orgMe?: unknown; stub?: Record<string, string> }, RegExp]> = [
    ['answers 500', { stub: { STUB_FAILS: 'orgme' } }, /the organisation of the provisioning token: the provider answered HTTP 500/],
    ['names none', { orgMe: { details: {} } }, /the provider named no organisation for the provisioning token/],
  ];
  it.each(orgAnswers)('refuses when the organisation it asks for %s', (_what, how, reason) => {
    const r = run({ ...aStackWithEveryReason(), orgMe: how.orgMe }, { args: ['--remove'], stub: how.stub });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(reason);
    expect(r.err).toContain('nothing was removed.');
    expect(r.deleted).toEqual([]);
  });

  it('refuses a listing that names no organisation for an account', () => {
    const noOrg = account({ userId: '40', email: 'x@example.test', days: 90 });
    delete (noOrg.details as Record<string, unknown>).resourceOwner;
    const operator = account({ userId: '12', email: 'operator@example.test', days: 45 });
    const r = run(aStackWithEveryReason(), {
      args: ['--remove'],
      stub: { STUB_LISTING: JSON.stringify({ details: { totalResult: '2' }, result: [operator, noOrg] }) },
    });
    expect(r.status).toBe(1);
    expect(r.err).toContain('names no organisation (details.resourceOwner) for an account');
    expect(r.err).toContain('nothing was removed.');
    expect(r.deleted).toEqual([]);
  });

  it.each([
    ['a membership', 'memberships'],
    ['a user grant', 'grants'],
  ])('leaves an account with %s at the provider alone, and asks only of the accounts it would remove', (_what, where) => {
    const world = aStackWithEveryReason();
    world.accounts!.push({ userId: '17', email: 'another@example.test', days: 31 });
    world[where as 'memberships' | 'grants'] = ['10'];
    const r = run(world, { args: ['--remove', '--at-most', '20'] });
    expect(r.status, r.err).toBe(0);
    expect(r.deleted).toEqual(['17']);
    expect(r.out).toContain('1 with a membership or a grant at the provider');
    const asked = r.calls
      .filter((c) => c.includes('/memberships/_search'))
      .map((c) => c.split(' ')[1]!.split('/')[4]);
    expect(asked).toEqual(['10', '17']);
  });

  it.each([['memberships'], ['grants']])('refuses when the %s search fails, removing nothing', (what) => {
    const r = run(aStackWithEveryReason(), { args: ['--remove'], stub: { STUB_FAILS: what } });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(new RegExp(`the ${what} of account 10: the provider answered HTTP 500`));
    expect(r.err).toContain('nothing was removed.');
    expect(r.deleted).toEqual([]);
  });

  it('refuses --subject for an account with a membership at the provider', () => {
    const r = run({ ...aStackWithEveryReason(), memberships: ['15'] }, { args: ['--subject', '15', '--remove'] });
    expect(r.status).toBe(1);
    expect(r.err).toContain('account 15 is left alone: it holds a membership or a grant at the provider.');
    expect(r.deleted).toEqual([]);
  });
});

describe('a role at the provider is read as the provider counts it, or the run refuses', () => {
  // The memberships and grants searches have met stand-ins only (0135 Status:
  // unverified), so an answer in another shape than expected is the likely
  // failure, and read as "no role" it removes an account somebody gave a role
  // by hand. In the review of 2026-09-29, a memberships answer that counted
  // one and listed it under `results`, and one that counted one and listed
  // nothing, each removed account 10. The account listing fails safe on a
  // shape it does not know; these now do too.
  const project = { userId: '10', projectId: 'p1', roles: ['PROJECT_OWNER'] };
  const grant = { id: 'g1', userId: '10', roleKeys: ['PROJECT_READER'] };
  const unknown: Array<[string, 'memberships' | 'grants', unknown, string]> = [
    ['a memberships answer that counts one and lists it under another name', 'memberships',
      { details: { totalResult: '1' }, results: [project] }, '[["details","results"],[]]'],
    ['a memberships answer that counts one and lists nothing', 'memberships',
      { details: { totalResult: '1' } }, '[["details"],[]]'],
    ['a memberships answer whose list is not a list', 'memberships', { result: project }, '[["result"],[]]'],
    ['a memberships answer whose count is not a number', 'memberships',
      { details: { totalResult: 'one' }, result: [] }, '[["details","result"],[]]'],
    ['a grants answer that counts one and lists it under another name', 'grants',
      { details: { totalResult: '1' }, grants: [grant] }, '[["details","grants"],[]]'],
  ];
  it.each(unknown)('refuses %s, naming its fields and none of their values', (_what, where, answer, fields) => {
    const stub = where === 'memberships' ? 'STUB_MEMBERSHIPS_ANSWER' : 'STUB_GRANTS_ANSWER';
    const r = run(aStackWithEveryReason(), { args: ['--remove', '--at-most', '20'], stub: { [stub]: JSON.stringify(answer) } });
    expect(r.status).toBe(1);
    expect(r.err).toContain(`the ${where} of account 10 came back in a shape this does not know. Its answer's fields: ${fields}`);
    expect(r.err).toContain('nothing was removed.');
    expect(r.err).not.toMatch(/PROJECT_OWNER|PROJECT_READER/);
    expect(r.deleted).toEqual([]);
  });

  it('keeps an account whose memberships answer counts one and lists an empty page', () => {
    const r = run(aStackWithEveryReason(), {
      args: ['--remove', '--at-most', '20'],
      stub: { STUB_MEMBERSHIPS_ANSWER: JSON.stringify({ details: { totalResult: '1' }, result: [] }) },
    });
    expect(r.status, r.err).toBe(0);
    expect(r.deleted).toEqual([]);
    expect(r.out).toContain('1 with a membership or a grant at the provider');
  });
});

describe('the listing is read to its end, or refused', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => account({ userId: `${2000 + i}`, email: `m${i}@example.test`, days: 60 }));

  it('refuses a page with accounts and no count, which would read as the last page', () => {
    const r = run({ operators: ['2000'] }, { args: ['--remove'], stub: { STUB_LISTING: JSON.stringify({ result: many(101) }) } });
    expect(r.status).toBe(1);
    expect(r.err).toContain('a page of the account listing holds 101 accounts and no count (details.totalResult)');
    expect(r.err).toContain('nothing was removed.');
    expect(r.calls.filter((c) => c.startsWith('POST /v2/users '))).toHaveLength(1);
    expect(r.deleted).toEqual([]);
  });

  it.each([
    ['with its count', 'keep'],
    ['with no count at all', 'none'],
  ])('refuses an empty page before the count is reached (%s)', (_what, count) => {
    const accounts = Array.from({ length: 250 }, (_, n) => ({ userId: `${1000 + n}`, email: `p${n}@example.test`, days: 60 }));
    const r = run(
      { accounts: [{ userId: '1', email: 'first@provider.example', days: 400 }, ...accounts], members: ['1'], operators: ['1'] },
      { args: ['--remove'], stub: { STUB_EMPTY_FROM: '100', STUB_EMPTY_COUNT: count } },
    );
    expect(r.status).toBe(1);
    expect(r.err).toContain('the account listing stopped at 100 of the 251 accounts it counted');
    expect(r.err).toContain('nothing was removed.');
    expect(r.deleted).toEqual([]);
  });

  it.each([
    ['0', 101],
    ['50', 100],
  ])('refuses a count of %s beside %i accounts already given, which would read as the last page', (count, n) => {
    // The accounts are young, so a run that took the page for the last one
    // lists them all and asks the provider nothing more.
    const young = Array.from({ length: n }, (_, i) => account({ userId: `${3000 + i}`, email: `y${i}@example.test`, days: 5 }));
    const r = run({ operators: ['3000'] }, { stub: { STUB_LISTING: JSON.stringify({ details: { totalResult: count }, result: young }) } });
    expect(r.status).toBe(1);
    expect(r.err).toContain(`the account listing counts ${count} accounts and has already given ${n}`);
    expect(r.err).toContain('nothing was removed.');
    expect(r.calls.filter((c) => c.startsWith('POST /v2/users '))).toHaveLength(1);
  });

  it('an empty listing with no count is an empty listing: proto3 leaves a zero out', () => {
    const r = run({}, { stub: { STUB_LISTING: '{}' } });
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('0 accounts at the provider, 0 nobody let in');
  });
});

describe('what it removes', () => {
  it('with --remove, exactly what it listed, each line with the id and never the address', () => {
    const world = aStackWithEveryReason();
    world.accounts!.push({ userId: '17', email: 'another@example.test', days: 31 });
    const r = run(world, { args: ['--remove'] });
    expect(r.status, r.err).toBe(0);
    expect(r.deleted).toEqual(['10', '17']);
    expect(r.out).toMatch(/^ {2}removed 10, created \d{4}-\d{2}-\d{2}$/m);
    expect(r.out).toContain('removed 2 of 2.');
    expect(r.out).not.toContain('stray@example.test');
    expect(r.out).not.toContain('another@example.test');
  });

  it('names a removal that fails, still removes the others, and fails the run', () => {
    const world = aStackWithEveryReason();
    world.accounts!.push({ userId: '17', email: 'another@example.test', days: 31 });
    const r = run(world, { args: ['--remove'], stub: { STUB_DELETE_FAILS: '10' } });
    expect(r.status).toBe(1);
    expect(r.deleted).toEqual(['10', '17']);
    expect(r.err).toContain('could not remove 10: HTTP 500');
    expect(r.err).toContain('removed 1 of 2; 1 could not be removed');
  });

  it('with --at-most, nothing when more would go, and says how to look at them', () => {
    const world = aStackWithEveryReason();
    world.accounts!.push({ userId: '17', email: 'another@example.test', days: 31 });
    const r = run(world, { args: ['--remove', '--at-most', '1'] });
    expect(r.status).toBe(1);
    expect(r.deleted).toEqual([]);
    expect(r.err).toContain('2 accounts would be removed, more than the 1 this run may remove (--at-most).');
    expect(r.err).toContain('./deploy/compose/idp-strays.sh lists them');
    expect(r.err).not.toContain('another@example.test');
  });

  it('with --at-most as many as would go, removes them as --remove does', () => {
    const world = aStackWithEveryReason();
    world.accounts!.push({ userId: '17', email: 'another@example.test', days: 31 });
    const r = run(world, { args: ['--remove', '--at-most=2'] });
    expect(r.status, r.err).toBe(0);
    expect(r.deleted).toEqual(['10', '17']);
  });

  it.each([['0'], ['-1'], ['1.5'], ['twenty'], ['']])('refuses --at-most %j before any call: a usage error', (n) => {
    const r = run(aStackWithEveryReason(), { args: ['--remove', '--at-most', n] });
    expect(r.status).toBe(2);
    expect(r.docker).toEqual([]);
    expect(r.calls).toEqual([]);
  });

  it('counts an account that was gone already as no failure', () => {
    const r = run(aStackWithEveryReason(), { args: ['--remove'], stub: { STUB_DELETE_GONE: '10' } });
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('10 was gone already');
  });
});

describe('when it refuses, removing nothing', () => {
  const refused = (r: Run, reason: RegExp) => {
    expect(r.status).toBe(1);
    expect(r.err).toMatch(reason);
    expect(r.err).toContain('nothing was removed.');
    expect(r.deleted).toEqual([]);
  };

  it('a database read that fails, before it asks the provider anything', () => {
    const r = run(aStackWithEveryReason(), { args: ['--remove'], stub: { STUB_DB_FAIL: 'requests' } });
    refused(r, /the database of 'ownpace-managed' \(ownpace-managed-db\) could not be read: ERROR: {2}relation does not exist/);
    expect(r.calls).toEqual([]);
  });

  it('an account listing in a shape it does not know, naming its fields and none of their values', () => {
    const r = run(aStackWithEveryReason(), {
      args: ['--remove'],
      stub: { STUB_LISTING: '{"details":{"totalResult":"1"},"result":[{"id":"10","email":"renamed@example.test"}]}' },
    });
    refused(r, /the account listing does not look like one \(no userId or details\)\. Its answer's fields: \[\["details","result"\],\["email","id"\]\]/);
    expect(r.err).not.toContain('renamed@example.test');
  });

  it('a token the provider refuses, with the command that renews it', () => {
    const r = run(aStackWithEveryReason(), { args: ['--remove'], stub: { STUB_REFUSE: '1' } });
    refused(r, /refused the provisioning token \(HTTP 401\).*setup-zitadel\.sh --token-only renews it/);
  });

  it('no token on the volume, before it asks the provider anything', () => {
    const r = run(aStackWithEveryReason(), { args: ['--remove'], stub: { STUB_NO_TOKEN: '1' } });
    refused(r, /no provisioning token could be read from the volume ownpace-managed_zitadel_machinekey/);
    expect(r.calls).toEqual([]);
  });

  it('an instance that lists no members, though its own token must be one', () => {
    const r = run({ ...aStackWithEveryReason(), iam: [] }, { args: ['--remove'] });
    refused(r, /lists no members of its instance/);
  });

  it('but a database that names nobody yet, a fresh stack, is no reason to refuse a listing', () => {
    const r = run({ accounts: [{ userId: '1', email: 'first@provider.example', days: 400 }, { userId: '10', email: 'stray@example.test', days: 45 }] });
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('2 accounts at the provider, 1 nobody let in');
    expect(r.out).toMatch(/^ {2}10 {2}stray@example\.test/m);
  });

  it("a database whose people have no account at this provider: the other stack's, or another kind of id", () => {
    const world = aStackWithEveryReason();
    const r = run({ ...world, members: ['a-subject-from-elsewhere'], operators: ['another-one'] }, { args: ['--remove'] });
    refused(r, /names members and operators, and none of them has an account at http:\/\/ownpace-idp:3126/);
  });
});

describe('one account, at any age (--subject)', () => {
  it('removes a young account that nobody let in, and no other', () => {
    const r = run(aStackWithEveryReason(), { args: ['--subject', '15', '--remove'] });
    expect(r.status, r.err).toBe(0);
    expect(r.deleted).toEqual(['15']);
    expect(r.out).toContain('account 15 belongs to nobody here.');
  });

  it.each([
    ['11', 'it is a member of an organisation here'],
    ['12', 'it is an operator'],
    ['13', 'an open access request carries its address'],
    ['14', 'an open invitation is addressed to it'],
    ['1', "it is one of the provider's own members"],
  ])('refuses account %s: %s', (subject, why) => {
    const r = run(aStackWithEveryReason(), { args: ['--subject', subject, '--remove'] });
    expect(r.status).toBe(1);
    expect(r.err).toContain(`account ${subject} is left alone: ${why}.`);
    expect(r.deleted).toEqual([]);
  });

  it('refuses a subject the provider does not hold', () => {
    const r = run(aStackWithEveryReason(), { args: ['--subject', '404', '--remove'] });
    expect(r.status).toBe(1);
    expect(r.err).toContain('no account 404 at the provider');
    expect(r.deleted).toEqual([]);
  });

  it.each([['pending:an-invitation'], ['10/../../admin'], ['10 11']])(
    'never puts %j in a URL: a usage error, before any call',
    (subject) => {
      const r = run(aStackWithEveryReason(), { args: ['--subject', subject, '--remove'] });
      expect(r.status).toBe(2);
      expect(r.docker).toEqual([]);
      expect(r.calls).toEqual([]);
    },
  );
});

describe('whose stack, and the token', () => {
  it("reads the checkout's own database and token volume", () => {
    const r = run(aStackWithEveryReason());
    expect(r.docker[0]).toBe(
      `docker run --rm -v ${PROJECT}_zitadel_machinekey:/machinekey:ro busybox:1.38 cat /machinekey/pat.txt`,
    );
    expect(r.docker.filter((l) => l.startsWith('docker exec')).every((l) => l.startsWith(`docker exec ${PROJECT}-db sh -c `))).toBe(true);
  });

  it('refuses, before any docker call, a shell that names the other stack', () => {
    const r = run(aStackWithEveryReason(), { args: ['--remove'], shell: { COMPOSE_PROJECT_NAME: 'ownpace-live' } });
    expect(r.status).toBe(1);
    expect(r.err).toContain('compose_project:');
    expect(r.docker).toEqual([]);
  });

  it('hands the token to curl in a file, never on a command line', () => {
    const r = run(aStackWithEveryReason(), { args: ['--remove'] });
    expect(r.status, r.err).toBe(0);
    expect(r.calls.length).toBeGreaterThan(3);
    expect(r.argv).not.toContain(TOKEN);
    expect(r.out + r.err).not.toContain(TOKEN);
  });

  it('presents the provider its own name at the published port when this machine cannot resolve it', () => {
    const r = run(aStackWithEveryReason(), { stub: { STUB_UNREACHABLE: '1' } });
    expect(r.status, r.err).toBe(0);
    const apiCalls = r.argv.split('\n').filter((l) => l.includes('/v2/users') || l.includes('/_search'));
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const l of apiCalls) expect(l).toContain('--resolve ownpace-idp:3126:127.0.0.1');
  });
});
