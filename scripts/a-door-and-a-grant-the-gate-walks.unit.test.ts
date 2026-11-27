// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOOR AND A GRANT THE GATE WALKS (workplan 0179 T2, T3 and T4; the
 * maintainer's D1 (a) of 2026-11-27: new sections of the managed smoke).
 *
 * Two sections of `deploy/compose/smoke-managed.sh`:
 *
 *  - *a recommendation's code, at its own door* (T2): the demo owner makes a
 *    recommendation, the door checks its code and refuses one nobody made,
 *    lets an address in with it (the request granted, an organisation with an
 *    owner's invitation, the gift spent, together), and refuses the spent code;
 *  - *a person's grant that starts their migration, and their stop* (T3, T4):
 *    the owner starts a person's first migration, the person types their
 *    destination's password, their second migration starts by itself and its
 *    pass completes; on their progress link, made in *je*, they stop copying,
 *    the migration is held, the owner's Start says why, and a second stop is
 *    refused in the *je* twin of its sentence.
 *
 * No pull request runs the gate (the maintainer dispatches it), so a section
 * that cannot pass, or one that passes whatever the stack does, would merge
 * green. These run each section exactly as the script has it, against a fake
 * API, a fake database and a fake DAV server, as
 * `a-password-link-the-gate-types.unit.test.ts` runs the section before them:
 *
 *  - it passes against a stack that answers as alpha.21 built it;
 *  - it fails on each answer the section exists to catch;
 *  - a code and a password are never on a command line, and never printed;
 *  - it takes back what it added, and an earlier run's leftovers, first and
 *    after, the copies before the rows.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SMOKE = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'compose', 'smoke-managed.sh');
const script = readFileSync(SMOKE, 'utf8');

/** A function the smoke defines, exactly as written there. */
function defined(name: string): string {
  const oneLine = new RegExp(`^${name}\\(\\) \\{.*\\}$`, 'm').exec(script);
  if (oneLine) return oneLine[0];
  const block = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm').exec(script);
  if (!block) throw new Error(`smoke-managed.sh no longer defines ${name}()`);
  return block[0];
}

/** A section, from its banner to the next one. */
function sectionAt(banner: string): string {
  const start = script.indexOf(banner);
  return start < 0 ? '' : script.slice(start, script.indexOf('# ---------- ', start + banner.length));
}
const DOOR = sectionAt("# ---------- a recommendation's code, at its own door (workplan 0177; 0179 T2)");
const GRANT = sectionAt("# ---------- a person's grant that starts their migration, and their stop (workplan 0179 T3, T4)");

const API = 'http://api.test';
const NC = 'http://nc.test';
const TENANT = 'b0000000-0000-4000-8000-000000000002';
const SUB = 'seed:demo-owner-b';
const TARGET_PASSWORD = 'fixture-not-a-password-target';
/** A code as the API mints one: shown once, never to be printed or passed as an argument. */
const CODE = 'K7QM-3XPD-W9RT-HC4N';

/** One canned answer: an HTTP code (or 0, for a query) and a one-line body. */
type Answer = readonly [number, unknown];
/** Answers per key; a list is answered in turn, its last answer repeating. */
type Api = Record<string, Answer | readonly Answer[]>;

const keyFile = (key: string): string => createHash('md5').update(key).digest('hex').slice(0, 16);

/**
 * Run `section` against `api`. `http`, `curl` and `q` are fakes that log each
 * call and answer from `api`, in turn, through files, because each call runs
 * in a subshell that cannot hand a variable back. `jq`, `sed` and `date` are
 * the real ones, as the gate's; `sleep` waits for nothing.
 */
function run(section: string, api: Api): { out: string; calls: string[]; argv: string; stdin: string; fail: boolean } {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-door-grant-'));
  try {
    for (const [key, value] of Object.entries(api)) {
      const answers = (Array.isArray(value[0]) ? value : [value]) as readonly Answer[];
      const at = join(dir, 'answers', keyFile(key));
      mkdirSync(at, { recursive: true });
      answers.forEach(([code, body], i) =>
        writeFileSync(join(at, String(i + 1)), `${code} ${typeof body === 'string' ? body : JSON.stringify(body)}`),
      );
    }
    const program = [
      'set -uo pipefail',
      'fail=0',
      'SECTION=""',
      'FAIL_REASONS=""',
      'NOT_PROVEN=""',
      `API="${API}"`,
      `NC="${NC}"`,
      'APPLY_TOKEN="aaaa.bbbb.cccc"',
      `APPLY_TENANT="${TENANT}"`,
      `APPLY_SUB="${SUB}"`,
      'TARGET_DAV_USER="tenant-b-target"',
      `TARGET_DAV_PASSWORD="${TARGET_PASSWORD}"`,
      'POLLS=3',
      'POLL_SLEEP=0',
      'sleep() { :; }',
      `ANSWERS="${join(dir, 'answers')}"`,
      `CALLS="${join(dir, 'calls')}"`,
      `ARGV="${join(dir, 'argv')}"`,
      `STDIN="${join(dir, 'stdin')}"`,
      ': > "$CALLS"; : > "$ARGV"; : > "$STDIN"',
      'answer() {',
      '  local d n',
      `  d="$ANSWERS/$(printf '%s' "$1" | md5sum | cut -c1-16)"`,
      '  [ -d "$d" ] || { echo "599 {\\"error\\":\\"no answer for $1\\"}"; return 0; }',
      '  n="$(cat "$d/next" 2>/dev/null || echo 1)"',
      '  if [ -f "$d/$n" ]; then echo $((n + 1)) > "$d/next"; cat "$d/$n"; else cat "$d/$((n - 1))"; fi',
      '}',
      'argv() { printf "%s\\n" "$@" >> "$ARGV"; }',
      // The smoke's `http`: "<code> <body>" on one line, keyed by what is asked.
      'http() {',
      '  argv "$@"',
      '  local path="${2#"$API"}" key',
      '  key="$1 $path"',
      '  case "$1 $path ${4:-}" in',
      '    "POST /api/migrations "*"(first)"*) key="$key first" ;;',
      '    "POST /api/migrations "*"(second)"*) key="$key second" ;;',
      '    "POST /api/people/"*"/links "*\'"view"\'*) key="$key view" ;;',
      '    "POST /api/people/"*"/links "*\'"grant"\'*) key="$key grant" ;;',
      '  esac',
      '  printf "%s\\n" "$key" >> "$CALLS"',
      '  answer "$key"',
      '}',
      // `curl` for what has no session: the door, the person's pages, and DAV.
      // Answers "<body>\\n<code>", or the code alone under `-o /dev/null`.
      'curl() {',
      '  argv "$@"',
      '  local url="${*: -1}" method=GET prev="" a body="" key got quiet=""',
      '  for a in "$@"; do',
      '    [ "$prev" = "-X" ] && method="$a"',
      '    [ "$a" = "/dev/null" ] && quiet=1',
      '    case "$a" in Authorization:*) echo "OPEN-WITH-A-SESSION" >> "$CALLS" ;; esac',
      '    prev="$a"',
      '  done',
      '  case " $* " in *" @- "* | *" -K - "*) body="$(cat)"; printf "%s\\n" "$body" >> "$STDIN" ;; esac',
      '  case "$url" in',
      '    "$API"/api/gifts/*)',
      '      local class=other',
      `      [ "$(jq -r .code <<<"$body")" = "${CODE}" ] && class=made`,
      '      [ "$(jq -r .code <<<"$body")" = "ZZZZ-ZZZZ-ZZZZ-ZZZZ" ] && class=nobody',
      '      key="POST ${url#"$API"} $class" ;;',
      '    "$API"*) key="$method ${url#"$API"}" ;;',
      '    "$NC"*) key="$method ${url#"$NC"}" ;;',
      '    *) key="$method $url" ;;',
      '  esac',
      '  printf "%s\\n" "$key" >> "$CALLS"',
      '  got="$(answer "$key")"',
      '  if [ -n "$quiet" ]; then printf "%s" "${got%% *}"; else printf "%s\\n%s" "${got#* }" "${got%% *}"; fi',
      '}',
      // `q` by what it asks, its answer the body after the code.
      'q() {',
      '  argv "$@"',
      '  local key',
      '  case "$1" in',
      '    *"SELECT tenant_id FROM access_request"*) key=gift-tenants ;;',
      '    "DELETE FROM gift"*) key=del-gift ;;',
      '    "DELETE FROM access_request"*) key=del-request ;;',
      '    "DELETE FROM tenant"*) key=del-tenant ;;',
      '    *"+ (SELECT count(*) FROM access_request"*) key=gift-left ;;',
      '    *"SELECT id || \' \' || state"*) key=gift-request ;;',
      '    *"(SELECT count(*) FROM tenant WHERE id"*) key=gift-made ;;',
      '    *"SELECT count(*) FROM access_request WHERE email ="*) key=gift-requests ;;',
      '    *"AND status <> \'paused\'"*) key=gc-running ;;',
      '    *"FROM migration_status WHERE"*"in_progress"*) key=gc-inprogress ;;',
      '    *"SELECT coalesce(target_ref"*) key=gc-copies ;;',
      '    *"SELECT m.status"*) key=gc-state ;;',
      '    *"string_agg"*) key=gc-met ;;',
      '    *"grant_withdrawn_at IS NOT NULL"*) key=gc-held ;;',
      '    *"SELECT id FROM mailbox_mapping WHERE tenant_id"*) key=gc-mappings ;;',
      '    *"FROM connection WHERE tenant_id"*) key=gc-connections ;;',
      '    *"FROM person WHERE"*) key=gc-people ;;',
      '    *) key=unknown ;;',
      '  esac',
      '  printf "q %s\\n" "$key" >> "$CALLS"',
      '  local got; got="$(answer "q $key")"',
      '  [ "${got%% *}" = 599 ] && { printf "\\n"; return 0; }',
      '  printf "%s\\n" "${got#* }"',
      '}',
      defined('note'),
      defined('fail_at'),
      defined('not_proven'),
      section,
      'echo "fail=$fail"',
      'printf "%s" "$FAIL_REASONS"',
    ].join('\n');
    const file = join(dir, 'run.sh');
    writeFileSync(file, program);
    const out = execFileSync('bash', [file], { encoding: 'utf8' });
    const calls = readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean);
    const argv = readFileSync(join(dir, 'argv'), 'utf8');
    const stdin = readFileSync(join(dir, 'stdin'), 'utf8');
    return { out, calls, argv, stdin, fail: out.includes('fail=1') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ the door --

const GIFT_ID = '01790000-e29b-41d4-a716-446655440001';
const REQUEST = '01790000-e29b-41d4-a716-446655440002';
const LET_IN = '01790000-e29b-41d4-a716-446655440003';

/** The door, as alpha.21 built it. */
function door(over: Api = {}): Api {
  return {
    'q gift-tenants': [[0, ''], [0, LET_IN]],
    'q del-gift': [0, 'DELETE 0'],
    'q del-request': [0, 'DELETE 0'],
    'q del-tenant': [0, 'DELETE 1'],
    'q gift-left': [0, '0'],
    'q gift-request': [0, `${REQUEST} granted ${LET_IN}`],
    'q gift-made': [0, '1/1/1'],
    'q gift-requests': [0, '1'],
    'POST /api/gifts': [201, { id: GIFT_ID, code: CODE, expiresAt: '2028-11-27T00:00:00.000Z' }],
    'POST /api/gifts/check made': [[200, { ok: true, until: '2028-11-27T00:00:00.000Z' }], [410, { error: 'gift_refused' }]],
    'POST /api/gifts/check nobody': [410, { error: 'gift_refused' }],
    'POST /api/gifts/redeem made': [[201, { letIn: true, mailed: true }], [410, { error: 'gift_refused' }]],
    ...over,
  };
}

describe("the gate walks a recommendation's code through its own door (0179 T2)", () => {
  it('found the section, so the rest of this file is not vacuous', () => {
    expect(DOOR).toContain(`note "a recommendation's code at its own door (0177; 0179 T2)"`);
    expect(DOOR.length).toBeGreaterThan(3000);
  });

  it('passes against a stack that answers as alpha.21 built it', () => {
    const { out, fail } = run(DOOR, door());
    expect(fail, out).toBe(false);
    for (const said of [
      'the demo owner made a recommendation, and was answered its code once',
      "the door's check says the code can be used",
      'a code nobody made is refused with the one refusal (410)',
      'the door let the address in (201)',
      'the three writes landed together: organisation/owner-invitation/spent-gift = 1/1/1',
      'the spent code is refused at the check and at the door, and no second request was made',
      'the recommendation, its request and its organisation are taken back',
    ]) {
      expect(out).toContain(said);
    }
  });

  it('asks the door with no session, in its order: check, a bad check, use, use again, check again', () => {
    const { calls } = run(DOOR, door());
    expect(calls.filter((c) => c.startsWith('POST /api/gifts/'))).toEqual([
      'POST /api/gifts/check made',
      'POST /api/gifts/check nobody',
      'POST /api/gifts/redeem made',
      'POST /api/gifts/redeem made',
      'POST /api/gifts/check made',
    ]);
    expect(calls).not.toContain('OPEN-WITH-A-SESSION');
  });

  it('never puts the code on a command line, and never prints it', () => {
    const { argv, out, stdin } = run(DOOR, door());
    expect(stdin).toContain(CODE); // vacuity: the code was sent, on stdin
    expect(argv).not.toContain(CODE);
    expect(out).not.toContain(CODE);
  });

  it('fails when the owner cannot make one, and does not print the code a refusal carried', () => {
    const { out, fail } = run(DOOR, door({ 'POST /api/gifts': [409, { error: 'gift_limit', code: CODE }] }));
    expect(fail).toBe(true);
    expect(out).toContain('the demo owner could not make a recommendation');
    expect(out).not.toContain(CODE);
  });

  it('fails when the door refuses its own code, or lets in a code nobody made', () => {
    const a = run(DOOR, door({ 'POST /api/gifts/redeem made': [410, { error: 'gift_refused' }] }));
    expect(a.fail).toBe(true);
    expect(a.out).toContain("the door did not let the code's person in");

    const b = run(DOOR, door({ 'POST /api/gifts/check nobody': [200, { ok: true }] }));
    expect(b.fail).toBe(true);
    expect(b.out).toContain('the door did not refuse a code nobody made');
  });

  it('fails when the three writes are not together, or the request is not granted', () => {
    const a = run(DOOR, door({ 'q gift-made': [0, '1/0/1'] }));
    expect(a.fail).toBe(true);
    expect(a.out).toContain('without the organisation, the invitation and the spent gift together');

    const b = run(DOOR, door({ 'q gift-request': [0, `${REQUEST} open -`] }));
    expect(b.fail).toBe(true);
    expect(b.out).toContain("a code's person was not let in as a granted request");
  });

  it('fails when a spent code is let in again, or makes a second request', () => {
    const a = run(DOOR, door({ 'POST /api/gifts/redeem made': [201, { letIn: true }] }));
    expect(a.fail).toBe(true);
    expect(a.out).toContain('a spent code was not refused, or made a second request');

    const b = run(DOOR, door({ 'q gift-requests': [0, '2'] }));
    expect(b.fail).toBe(true);
  });

  it('takes back first and after, the gift and the request before the organisation, and fails when rows remain', () => {
    const { calls } = run(DOOR, door());
    const order = calls.filter((c) => c.startsWith('q del-'));
    expect(order).toEqual(['q del-gift', 'q del-request', 'q del-gift', 'q del-request', 'q del-tenant']);
    expect(calls.indexOf('q del-gift')).toBeLessThan(calls.indexOf('POST /api/gifts'));

    const left = run(DOOR, door({ 'q gift-left': [[0, '0'], [0, '1']] }));
    expect(left.fail).toBe(true);
    expect(left.out).toContain('the recommendation section could not take back what it added');
  });
});

// ----------------------------------------------------------------- the grant --

const PERSON = '01790000-e29b-41d4-a716-446655440011';
const DEST = '01790000-e29b-41d4-a716-446655440012';
const FIRST = '01790000-e29b-41d4-a716-446655440013';
const SECOND = '01790000-e29b-41d4-a716-446655440014';
const GRANT_TOKEN = 'p.01790000-e29b-41d4-a716-446655440021.grant';
const VIEW_TOKEN = 'p.01790000-e29b-41d4-a716-446655440022.view';
const DEST_REF = '0179aaaabbbbccccddddeeeeffff0000';
const COPY = '/remote.php/dav/calendars/tenant-b-target/personal/gate-copy-1.ics';

const PAGE = {
  kind: 'person',
  accounts: [
    { ref: DEST_REF, role: 'target', way: 'password', provider: 'nextcloud', granted: false, tries: { left: 5, locked: false } },
  ],
};
const VIEW = { kind: 'person', language: 'nl', register: 'informal', destinations: [{ ref: DEST_REF, provider: 'nextcloud' }] };
const CHANGED_JE = {
  error: 'changed',
  reason: 'Your permission changed since this page was opened.',
  reasonNl: 'Je toestemming is gewijzigd sinds deze pagina werd geopend.',
};

/** The grant, as alpha.21 built it. */
function grant(over: Api = {}): Api {
  return {
    'q gc-running': [[0, ''], [0, `${FIRST}\n${SECOND}`]],
    'q gc-inprogress': [0, '0'],
    'q gc-copies': [[0, ''], [0, COPY]],
    'q gc-mappings': [[0, ''], [0, `${FIRST}\n${SECOND}`]],
    'q gc-connections': [[0, ''], [0, DEST]],
    'q gc-people': [[0, ''], [0, PERSON]],
    'q gc-state': [[0, 'paused none'], [0, 'active in_progress'], [0, 'active completed']],
    'q gc-met': [0, 'adopted=3, copied=1'],
    'q gc-held': [0, 'true 0'],
    'POST /api/people': [201, { id: PERSON }],
    'POST /api/connections': [201, { id: DEST, forPerson: true }],
    'POST /api/migrations first': [201, { id: FIRST, status: 'paused' }],
    'POST /api/migrations second': [201, { id: SECOND, status: 'paused' }],
    [`POST /api/migrations/${FIRST}/start`]: [200, { status: 'active' }],
    [`POST /api/migrations/${SECOND}/start`]: [
      [409, { error: 'awaiting_grant', startsWhenGranted: true }],
      [409, { error: 'grant_withdrawn' }],
    ],
    [`POST /api/people/${PERSON}/links grant`]: [201, { id: 'l1', url: `https://app.example.test/grant/${GRANT_TOKEN}` }],
    [`POST /api/people/${PERSON}/links view`]: [201, { id: 'l2', url: `https://app.example.test/view/${VIEW_TOKEN}`, voice: 'nl-je' }],
    [`GET /api/grant/${GRANT_TOKEN}`]: [200, PAGE],
    [`PUT /api/grant/${GRANT_TOKEN}/password`]: [200, { connected: true, faces: ['calendar'], linkSpent: true }],
    [`GET /api/view/${VIEW_TOKEN}`]: [200, VIEW],
    [`POST /api/view/${VIEW_TOKEN}/withdraw`]: [[200, { withdrawnAt: '2026-11-27T09:00:00Z', provider: 'nextcloud' }], [409, CHANGED_JE]],
    [`PUT /api/migrations/${FIRST}`]: [200, {}],
    [`PUT /api/migrations/${SECOND}`]: [200, {}],
    [`DELETE ${COPY}`]: [204, ''],
    [`DELETE /api/migrations/${FIRST}`]: [200, {}],
    [`DELETE /api/migrations/${SECOND}`]: [200, {}],
    [`DELETE /api/connections/${DEST}`]: [200, {}],
    [`DELETE /api/people/${PERSON}`]: [200, { deleted: true }],
    ...over,
  };
}

describe("the gate walks a person's grant to a copy, and their stop (0179 T3, T4)", () => {
  it('found the section, so the rest of this file is not vacuous', () => {
    expect(GRANT).toContain(`note "a person's grant that starts their migration, and their stop (0179 T3, T4)"`);
    expect(GRANT.length).toBeGreaterThan(6000);
  });

  it('passes against a stack that answers as alpha.21 built it', () => {
    const { out, fail } = run(GRANT, grant());
    expect(fail, out).toBe(false);
    for (const said of [
      "the owner started the person's first migration, so their move was started",
      'Start on the second answers that it waits for the person, and starts by itself once they connect',
      "the person typed their destination's password: connected, and the link is spent",
      "the second migration started by itself on the person's grant, and its first pass completed",
      'what the pass met on the target: adopted=3, copied=1',
      'their progress page speaks Dutch, with je, as chosen for them',
      'they stopped copying to their destination: its password is gone, and the migration is held',
      "the owner's Start now answers that the person withdrew",
      'a second stop is refused, in the je twin of its sentence',
      'the copies the passes made, the two migrations, the destination and the person are taken back',
    ]) {
      expect(out).toContain(said);
    }
  });

  it('saves the destination for the person with no password, and the second migration into it', () => {
    const { argv } = run(GRANT, grant());
    const saved = argv.split('\n').find((l) => l.includes('"forPerson"') && l.includes('"values"'));
    expect(saved).toBeDefined();
    expect(JSON.parse(saved!).values).not.toHaveProperty('password');
    const second = argv.split('\n').find((l) => l.includes('(second)'));
    expect(JSON.parse(second!)).toMatchObject({ targetConnectionId: DEST, forPerson: PERSON, targetConfig: { password: '' } });
  });

  it("types the person's password only on stdin, and removes a copy with the account's password on stdin too", () => {
    const { argv, stdin, out, calls } = run(GRANT, grant());
    expect(calls).toContain(`PUT /api/grant/${GRANT_TOKEN}/password`);
    expect(calls).toContain(`DELETE ${COPY}`);
    const typed = stdin.split('\n').filter((l) => l.includes(TARGET_PASSWORD));
    expect(typed.some((l) => l.includes('"values":{"password"'))).toBe(true);
    expect(typed.some((l) => l.startsWith('user = '))).toBe(true);
    // The owner's first migration carries the demo's placeholder, as the
    // Nextcloud door's does; what must never be an argument is a curl to DAV.
    for (const line of argv.split('\n').filter((l) => l.startsWith('-u') || l.includes(`tenant-b-target:${TARGET_PASSWORD}`))) {
      expect(line).not.toContain(TARGET_PASSWORD);
    }
    expect(out).not.toContain(TARGET_PASSWORD);
  });

  it('fails when Start on the waiting migration does not say it starts by itself', () => {
    const { out, fail } = run(GRANT, grant({ [`POST /api/migrations/${SECOND}/start`]: [409, { error: 'awaiting_grant' }] }));
    expect(fail).toBe(true);
    expect(out).toContain('did not say it starts by itself');
  });

  it("fails when the grant starts nothing, or the pass fails, and still takes everything back", () => {
    const never = run(GRANT, grant({ 'q gc-state': [0, 'paused none'] }));
    expect(never.fail).toBe(true);
    expect(never.out).toContain("a person's grant did not start their waiting migration");
    expect(never.calls).toContain(`DELETE /api/people/${PERSON}`);

    const failed = run(GRANT, grant({ 'q gc-state': [[0, 'active in_progress'], [0, 'active failed']] }));
    expect(failed.fail).toBe(true);
    expect(failed.calls.filter((c) => c === 'q gc-state')).toHaveLength(2);
  });

  it('fails when the page is not in the voice chosen, or the second stop is said with u', () => {
    const u = run(GRANT, grant({ [`GET /api/view/${VIEW_TOKEN}`]: [200, { ...VIEW, register: 'formal' }] }));
    expect(u.fail).toBe(true);
    expect(u.out).toContain('the person\'s page did not speak in the voice chosen for them');

    const said = run(GRANT, grant({
      [`POST /api/view/${VIEW_TOKEN}/withdraw`]: [
        [200, { provider: 'nextcloud' }],
        [409, { ...CHANGED_JE, reasonNl: 'Uw toestemming is gewijzigd sinds deze pagina werd geopend.' }],
      ],
    }));
    expect(said.fail).toBe(true);
    expect(said.out).toContain('a refusal on the person\'s page was not said in their voice');
  });

  it('fails when the stop does not hold the migration, or the owner is not told', () => {
    const a = run(GRANT, grant({ 'q gc-held': [0, 'false 1'] }));
    expect(a.fail).toBe(true);
    expect(a.out).toContain("the person's stop did not take their destination back and hold the migration");

    const b = run(GRANT, grant({
      [`POST /api/migrations/${SECOND}/start`]: [[409, { error: 'awaiting_grant', startsWhenGranted: true }], [200, {}]],
    }));
    expect(b.fail).toBe(true);
    expect(b.out).toContain("the owner's Start did not say the person had stopped it");
  });

  it('takes back the copies before the rows, pauses first, and keeps the rows when a copy cannot be removed', () => {
    const { calls } = run(GRANT, grant());
    const at = (c: string): number => calls.lastIndexOf(c);
    expect(at(`PUT /api/migrations/${SECOND}`)).toBeLessThan(at(`DELETE ${COPY}`));
    expect(at(`DELETE ${COPY}`)).toBeLessThan(at(`DELETE /api/migrations/${SECOND}`));
    expect(at(`DELETE /api/migrations/${SECOND}`)).toBeLessThan(at(`DELETE /api/people/${PERSON}`));

    const stuck = run(GRANT, grant({ [`DELETE ${COPY}`]: [500, ''] }));
    expect(stuck.fail).toBe(true);
    expect(stuck.out).toContain('removing the copy at');
    expect(stuck.calls).not.toContain(`DELETE /api/migrations/${SECOND}`);
  });

  it('refuses to take back while a pass is still running', () => {
    const { out, fail, calls } = run(GRANT, grant({ 'q gc-inprogress': [0, '1'] }));
    expect(fail).toBe(true);
    expect(out).toContain("a pass of this section's migrations is still running");
    expect(calls).not.toContain(`DELETE /api/migrations/${SECOND}`);
  });

  it("takes an earlier run's leftovers back before it adds anything", () => {
    const left = run(GRANT, grant({ 'q gc-people': [[0, PERSON], [0, PERSON]] }));
    const deletes = left.calls.filter((c) => c === `DELETE /api/people/${PERSON}`);
    expect(deletes).toHaveLength(2);
    expect(left.calls.indexOf(`DELETE /api/people/${PERSON}`)).toBeLessThan(left.calls.indexOf('POST /api/people'));
  });
});
