// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASSWORD LINK THE GATE TYPES INTO (workplan 0174 T8, §11 E2E (managed)).
 *
 * The managed gate's section *a person's own passwords on their grant link*
 * adds a person with an `imap` source on the demo Stalwart and a `nextcloud`
 * destination on the demo Nextcloud, both saved for them without a password;
 * opens their grant link; types five wrong passwords and a sixth that must be
 * answered `locked` without a login (the try row and Stalwart's own log both
 * say five); connects both on a new link; and looks for every password it
 * typed in the API's and the worker's log, the audit rows and the try rows.
 *
 * No pull request runs the gate (T9 is the owner's), so a section that cannot
 * pass, or one that passes whatever the stack does, would merge green. These
 * run the section exactly as the script has it, against a fake API, a fake
 * database and a fake Docker, so what is proved is the code that runs on the
 * machine, not a copy of it:
 *
 *  - it passes against a stack that answers as T1 to T6 built it;
 *  - it fails when the sixth try is tried, when the try row or Stalwart's log
 *    says other than five, when the page lacks a card's server or shows the
 *    destination first, when a password is found in a log or an audit row;
 *  - it says, without failing, when Stalwart's log names no failed login;
 *  - a password is never on a command line and never in its output;
 *  - it takes back what it added, and an earlier run's leftovers, by name.
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

/** The section, from its banner to the next one. */
const BANNER = "# ---------- a person's own passwords, typed on their grant link (workplan 0174 T8)";
const start = script.indexOf(BANNER);
const section = start < 0 ? '' : script.slice(start, script.indexOf('# ---------- ', start + BANNER.length));

const API = 'http://api.test';
const TENANT = 'b0000000-0000-4000-8000-000000000002';
const PERSON = '0174a900-e29b-41d4-a716-446655440041';
const SOURCE = '0174a900-e29b-41d4-a716-446655440011';
const TARGET = '0174a900-e29b-41d4-a716-446655440021';
const MAIL = '0174a900-e29b-41d4-a716-446655440031';
const CAL = '0174a900-e29b-41d4-a716-446655440032';
const LINK1 = '0174a900-e29b-41d4-a716-446655440051';
const LINK2 = '0174a900-e29b-41d4-a716-446655440052';
const T1 = `p.${LINK1}.first`;
const T2 = `p.${LINK2}.second`;
const SOURCE_REF = 'ref-source-0174';
const TARGET_REF = 'ref-target-0174';
/** The demo's placeholders, as the gate's environment names them. */
const SOURCE_PASSWORD = 'fixture-not-a-password-source';
const TARGET_PASSWORD = 'fixture-not-a-password-target';

/** One canned answer: an HTTP code (or nothing, for a query) and a one-line body. */
type Answer = readonly [number, unknown];
/** Answers per key; a list is answered in turn, its last answer repeating. */
type Api = Record<string, Answer | readonly Answer[]>;

const card = (role: string, provider: string, ref: string, host: string, left = 5, granted = false) => ({
  ref,
  role,
  way: 'password',
  provider,
  account: role === 'source' ? 'source@dev.local' : 'tenant-b-target',
  granted,
  server: { hosts: [host], published: false },
  fields: [{ key: 'password', who: 'person', secret: true }],
  tries: { left, locked: left === 0 },
});
const PAGE = {
  kind: 'person',
  accounts: [card('source', 'imap', SOURCE_REF, 'stalwart'), card('target', 'nextcloud', TARGET_REF, 'nextcloud')],
};
const refused = (left: number): Answer => [422, { error: 'refused_login', tries: { left, locked: left === 0 } }];
const STALWART_FIVE = Array.from({ length: 5 }, (_, i) => `2026-11-25T00:00:0${i}Z INFO Authentication failed (auth.failed) accountName = "source@dev.local"`).join('\n');

/** The whole section passing, as a stack built by T1 to T6 answers it. */
function passing(over: Api = {}): Api {
  return {
    // The take-back before and after: nothing left over before, the run's rows after.
    'q leftover-mappings': [[0, ''], [0, `${MAIL}\n${CAL}`]],
    'q leftover-connections': [[0, ''], [0, `${SOURCE}\n${TARGET}`]],
    'q leftover-people': [[0, ''], [0, PERSON]],
    'q update': [0, 'UPDATE 1'],
    'q tlsverify': [0, 'false'],
    'q status': [0, 'error'],
    'q tries': [0, '5 true'],
    'q granted': [0, '1'],
    'q audit': [0, '{"action":"mapping.grant_refused","detail":{"refused":"refused_login"}}'],
    'q trylog': [0, '{"refused":5}'],
    'POST /api/people': [201, { id: PERSON, displayName: 'Smoke run: own passwords' }],
    'POST /api/connections source': [201, { id: SOURCE, forPerson: true }],
    'POST /api/connections target': [201, { id: TARGET, forPerson: true }],
    'POST /api/migrations mail': [201, { id: MAIL, status: 'paused' }],
    'POST /api/migrations calendar': [201, { id: CAL, status: 'paused' }],
    [`GET /api/people/${PERSON}/awaiting-grant`]: [
      [200, { migrations: [{ mappingId: MAIL }, { mappingId: CAL }] }],
      [200, { migrations: [] }],
    ],
    [`POST /api/people/${PERSON}/links`]: [
      [201, { id: LINK1, url: `https://app.example.test/grant/${T1}` }],
      [201, { id: LINK2, url: `https://app.example.test/grant/${T2}` }],
    ],
    [`GET /api/grant/${T1}`]: [200, PAGE],
    [`GET /api/grant/${T2}`]: [[200, PAGE], [401, { error: 'link_spent' }]],
    [`PUT /api/grant/${T1}/password wrong`]: [refused(4), refused(3), refused(2), refused(1), refused(0)],
    [`PUT /api/grant/${T1}/password source`]: [423, { error: 'locked' }],
    [`PUT /api/grant/${T2}/password source`]: [200, { connected: true, faces: ['email'], linkSpent: false }],
    [`PUT /api/grant/${T2}/password target`]: [200, { connected: true, faces: ['calendar'], linkSpent: true }],
    [`DELETE /api/migrations/${MAIL}`]: [200, {}],
    [`DELETE /api/migrations/${CAL}`]: [200, {}],
    [`DELETE /api/connections/${SOURCE}`]: [200, {}],
    [`DELETE /api/connections/${TARGET}`]: [200, {}],
    [`DELETE /api/people/${PERSON}`]: [200, { deleted: true }],
    'docker ownpace-stalwart': [0, STALWART_FIVE],
    'docker ownpace-api': [0, '[api] a password on a person\'s link: refused_login (ref ref-source-0174)'],
    'docker ownpace-worker': [0, '[worker] tick'],
    ...over,
  };
}

const keyFile = (key: string): string => createHash('md5').update(key).digest('hex').slice(0, 16);

/**
 * Run the section against `api`. `http`, `curl`, `q` and `docker` are fakes
 * that log each call and answer from `api`, in turn, through files, because
 * each call runs in a subshell that cannot hand a variable back. `jq`,
 * `base64` and `date` are the real ones, as the gate's.
 */
function run(api: Api): { out: string; calls: string[]; argv: string; fail: boolean; notProven: boolean } {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-own-password-'));
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
      'APPLY_TOKEN="aaaa.bbbb.cccc"',
      `APPLY_TENANT="${TENANT}"`,
      'TARGET_DAV_USER="tenant-b-target"',
      `TARGET_DAV_PASSWORD="${TARGET_PASSWORD}"`,
      `STALWART_SOURCE_PASSWORD="${SOURCE_PASSWORD}"`,
      'API_CONTAINER="ownpace-api"',
      'WORKER_CONTAINER="ownpace-worker"',
      `ANSWERS="${join(dir, 'answers')}"`,
      `CALLS="${join(dir, 'calls')}"`,
      `ARGV="${join(dir, 'argv')}"`,
      ': > "$CALLS"; : > "$ARGV"',
      // The next canned answer for a key; the last one repeats.
      'answer() {',
      '  local d n',
      `  d="$ANSWERS/$(printf '%s' "$1" | md5sum | cut -c1-16)"`,
      '  [ -d "$d" ] || { echo "599 {\\"error\\":\\"no answer for $1\\"}"; return 0; }',
      '  n="$(cat "$d/next" 2>/dev/null || echo 1)"',
      '  if [ -f "$d/$n" ]; then echo $((n + 1)) > "$d/next"; cat "$d/$n"; else cat "$d/$((n - 1))"; fi',
      '}',
      // Every argument any fake was called with, for "never on a command line".
      'argv() { printf "%s\\n" "$@" >> "$ARGV"; }',
      // The smoke's `http`: "<code> <body>" on one line, keyed by what is made.
      'http() {',
      '  argv "$@"',
      '  local path="${2#"$API"}" key',
      '  printf "%s %s\\n" "$1" "$path" >> "$CALLS"',
      '  key="$1 $path"',
      '  case "$1 $path ${4:-}" in',
      '    "POST /api/connections "*\'"role":"source"\'*) key="$key source" ;;',
      '    "POST /api/connections "*\'"role":"target"\'*) key="$key target" ;;',
      '    "POST /api/migrations "*\'(mail)\'*) key="$key mail" ;;',
      '    "POST /api/migrations "*\'(calendar)\'*) key="$key calendar" ;;',
      '  esac',
      '  answer "$key"',
      '}',
      // `curl` for what the person does, with no session: the GET of the page,
      // and the PUT whose body comes on stdin. Answers "<body>\\n<code>".
      'curl() {',
      '  argv "$@"',
      '  local url="${*: -1}" method=GET a got body pw class',
      '  for a in "$@"; do',
      '    [ "$a" = "PUT" ] && method=PUT',
      '    case "$a" in Authorization:*) echo "OPEN-WITH-A-SESSION" >> "$CALLS" ;; esac',
      '  done',
      '  if [ "$method" = PUT ]; then',
      '    body="$(cat)"',
      '    pw="$(jq -r .values.password <<<"$body")"',
      '    if [ "$pw" = "$STALWART_SOURCE_PASSWORD" ]; then class=source',
      '    elif [ "$pw" = "$TARGET_DAV_PASSWORD" ]; then class=target',
      '    else class=wrong; fi',
      '    printf "PUT %s %s %s\\n" "${url#"$API"}" "$class" "$(jq -r .ref <<<"$body")" >> "$CALLS"',
      '    got="$(answer "PUT ${url#"$API"} $class")"',
      '  else',
      '    printf "OPEN %s\\n" "${url#"$API"}" >> "$CALLS"',
      '    got="$(answer "GET ${url#"$API"}")"',
      '  fi',
      '  printf "%s\\n%s" "${got#* }" "${got%% *}"',
      '}',
      // `q` by what it asks, its answer the body after the code.
      'q() {',
      '  argv "$@"',
      '  local key',
      '  case "$1" in',
      '    *"FROM mailbox_mapping WHERE"*) key=leftover-mappings ;;',
      '    *"FROM connection WHERE tenant_id"*"LIKE"*) key=leftover-connections ;;',
      '    *"FROM person WHERE"*) key=leftover-people ;;',
      '    UPDATE*) key=update ;;',
      '    *"tlsVerify\' FROM"*) key=tlsverify ;;',
      '    *"SELECT status FROM connection"*) key=status ;;',
      '    *"FROM person_link_try WHERE link_id"*) key=tries ;;',
      '    *"FROM person_granted_connection"*) key=granted ;;',
      '    *"FROM audit_log"*) key=audit ;;',
      '    *"FROM person_link_try t"*) key=trylog ;;',
      '    *) key=unknown ;;',
      '  esac',
      '  printf "q %s\\n" "$key" >> "$CALLS"',
      '  local got; got="$(answer "q $key")"',
      '  printf "%s\\n" "${got#* }"',
      '}',
      // `docker logs --since <t> <container>`: the canned log, or a refusal.
      'docker() {',
      '  argv "$@"',
      '  local c="${*: -1}" got',
      '  printf "docker %s\\n" "$c" >> "$CALLS"',
      '  got="$(answer "docker $c")"',
      '  [ "${got%% *}" = 599 ] && { echo "Error: No such container: $c"; return 1; }',
      '  printf "%s\\n" "${got#* }"',
      '}',
      defined('note'),
      defined('fail_at'),
      defined('not_proven'),
      section,
      'echo "fail=$fail"',
      'printf "%s" "$FAIL_REASONS"',
      'printf "NOT_PROVEN=%s" "$NOT_PROVEN"',
    ].join('\n');
    const file = join(dir, 'run.sh');
    writeFileSync(file, program);
    const out = execFileSync('bash', [file], { encoding: 'utf8' });
    const calls = readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean);
    const argv = readFileSync(join(dir, 'argv'), 'utf8');
    return { out, calls, argv, fail: out.includes('fail=1'), notProven: !out.endsWith('NOT_PROVEN=') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the gate types a person’s own passwords on their grant link', () => {
  it('found the section, so the rest of this file is not vacuous', () => {
    expect(section).toContain('note "a person\'s own passwords on their grant link (0174 T8)"');
    expect(section.length).toBeGreaterThan(4000);
  });

  it('passes against a stack that answers as T1 to T6 built it', () => {
    const { out, fail, notProven } = run(passing());
    expect(fail, out).toBe(false);
    expect(notProven, out).toBe(false);
    for (const said of [
      'both of the person\'s migrations wait for them before any password',
      'the page shows two password cards, the source\'s on stalwart before the destination\'s on nextcloud, five tries each',
      'a wrong password refused by stalwart: 0 tries left',
      'the sixth, the right password, answered locked',
      'the try row: five refused, locked',
      'stalwart\'s own log: five failed logins, not six',
      'the right passwords connected both, and the link is spent',
      'and nothing of theirs waits any more',
      'no password typed on the link is in the api',
      'no password typed on the link is in the worker',
      'no password typed on the link is in the audit',
      'the person, their two migrations and the four accounts are taken back',
    ]) {
      expect(out).toContain(said);
    }
  });

  it('saves both accounts for the person, with no password, and makes two draft migrations for them', () => {
    const { calls, argv } = run(passing());
    expect(calls.filter((c) => c === 'POST /api/connections')).toHaveLength(2);
    expect(argv).toContain(`"forPerson":"${PERSON}"`);
    // The bodies that save the person's accounts carry no password of any kind.
    for (const line of argv.split('\n').filter((l) => l.includes('"forPerson"') && l.includes('"values"'))) {
      expect(JSON.parse(line).values).not.toHaveProperty('password');
      expect(line).not.toContain(SOURCE_PASSWORD);
    }
    expect(calls.filter((c) => c === 'POST /api/migrations')).toHaveLength(2);
  });

  it('types five wrong passwords and one right one on the first link, then the two right ones on a new link', () => {
    const { calls } = run(passing());
    const puts = calls.filter((c) => c.startsWith('PUT '));
    expect(puts).toEqual([
      ...Array(5).fill(`PUT /api/grant/${T1}/password wrong ${SOURCE_REF}`),
      `PUT /api/grant/${T1}/password source ${SOURCE_REF}`,
      `PUT /api/grant/${T2}/password source ${SOURCE_REF}`,
      `PUT /api/grant/${T2}/password target ${TARGET_REF}`,
    ]);
    expect(calls).not.toContain('OPEN-WITH-A-SESSION');
  });

  it('never puts a password on a command line, and never prints one', () => {
    const { argv, out } = run(passing());
    expect(argv).toContain('--data-binary'); // vacuity: the PUTs were made
    for (const p of [SOURCE_PASSWORD, 'smoke-not-the-password-']) {
      expect(argv, p).not.toContain(p);
      expect(out, p).not.toContain(p);
    }
    // The demo's own placeholder is on the owner's migration body, as the
    // Nextcloud door sends it: never the person's typed password, checked above.
    expect(out).not.toContain(TARGET_PASSWORD);
  });

  it('fails when the sixth try is tried', () => {
    const { out, fail } = run(passing({ [`PUT /api/grant/${T1}/password source`]: [200, { connected: true }] }));
    expect(fail).toBe(true);
    expect(out).toContain('the sixth try on a locked card was not refused as locked');
  });

  it('fails when the try row or Stalwart’s log says other than five', () => {
    const six = run(passing({ 'q tries': [0, '6 true'] }));
    expect(six.fail).toBe(true);
    expect(six.out).toContain('the tries were not counted as five and locked');

    const log = run(passing({ 'docker ownpace-stalwart': [0, `${STALWART_FIVE}\nINFO Authentication failed (auth.failed)`] }));
    expect(log.fail).toBe(true);
    expect(log.out).toContain('stalwart saw a different number of logins than the five tries');
  });

  it('says, without failing, when Stalwart’s log names no failed login', () => {
    const quiet = run(passing({ 'docker ownpace-stalwart': [0, 'INFO started'] }));
    expect(quiet.fail, quiet.out).toBe(false);
    expect(quiet.notProven).toBe(true);
    expect(quiet.out).toContain('NOT PROVEN on this stack: stalwart\'s log');
  });

  it('fails when the page shows a card without its server, or the destination first', () => {
    const noServer = {
      ...PAGE,
      accounts: [{ ...PAGE.accounts[0], server: { hosts: ['elsewhere.example'], published: false } }, PAGE.accounts[1]],
    };
    const a = run(passing({ [`GET /api/grant/${T1}`]: [200, noServer] }));
    expect(a.fail).toBe(true);
    expect(a.out).toContain('the grant page did not show the two password cards, each with its server');

    const reversed = { ...PAGE, accounts: [PAGE.accounts[1], PAGE.accounts[0]] };
    const b = run(passing({ [`GET /api/grant/${T1}`]: [200, reversed] }));
    expect(b.fail).toBe(true);
  });

  it('fails when a password is in the API’s log or, in base64, in an audit row, and says only that it was', () => {
    const api = run(passing({ 'docker ownpace-api': [0, `login with ${SOURCE_PASSWORD}`] }));
    expect(api.fail).toBe(true);
    expect(api.out).toContain('a password typed on a grant link leaked into the api');
    expect(api.out).not.toContain(SOURCE_PASSWORD);

    const b64 = Buffer.from(TARGET_PASSWORD).toString('base64');
    const audit = run(passing({ 'q audit': [0, `{"detail":{"x":"${b64}"}}`] }));
    expect(audit.fail).toBe(true);
    expect(audit.out).toContain('a password typed on a grant link leaked into the audit');
  });

  it('fails when the link is not spent, or the migrations still wait', () => {
    const live = run(passing({ [`GET /api/grant/${T2}`]: [200, PAGE] }));
    expect(live.fail).toBe(true);
    expect(live.out).toContain('a spent grant link still opened');

    const waits = run(passing({ [`GET /api/people/${PERSON}/awaiting-grant`]: [200, { migrations: [{ mappingId: MAIL }, { mappingId: CAL }] }] }));
    expect(waits.fail).toBe(true);
    expect(waits.out).toContain('the migrations still wait after both passwords were stored');
  });

  it('takes back what it added even when a step failed, and an earlier run’s leftovers first', () => {
    const broken = run(passing({ [`POST /api/people/${PERSON}/links`]: [500, { error: 'boom' }] }));
    expect(broken.fail).toBe(true);
    for (const del of [
      `DELETE /api/migrations/${MAIL}`,
      `DELETE /api/connections/${TARGET}`,
      `DELETE /api/people/${PERSON}`,
    ]) {
      expect(broken.calls).toContain(del);
    }

    const left = run(passing({ 'q leftover-people': [[0, PERSON], [0, PERSON]] }));
    const deletes = left.calls.filter((c) => c === `DELETE /api/people/${PERSON}`);
    expect(deletes).toHaveLength(2);
    expect(left.calls.indexOf(`DELETE /api/people/${PERSON}`)).toBeLessThan(left.calls.indexOf('POST /api/people'));
  });
});
