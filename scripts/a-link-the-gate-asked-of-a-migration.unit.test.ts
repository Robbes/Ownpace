// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LINK THE GATE STILL ASKED OF A MIGRATION (E2E (managed) #232, 2026-10-03).
 *
 * #1408 (0153 T5 (b)) made links a person's: one progress link to all of a
 * person's migrations, and `POST /api/migrations/:id/links` refuses with `409
 * links_are_per_person`. The managed gate's progress-link section still asked
 * the migration, so #232 failed there and nowhere else: verify was done and
 * apply applied. No pull request runs the gate, so the change merged green.
 *
 * The section now adds a person of its own, puts the APPLY mapping with them,
 * issues and opens THEIR progress link, revokes it, and deletes the person.
 * These run the section exactly as the script has it, against a fake API, so
 * what is proved is the code that runs on the Spark, not a copy of it.
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
const BANNER = '# ---------- the page somebody with no account opens (0122)';
const start = script.indexOf(BANNER);
const section = start < 0 ? '' : script.slice(start, script.indexOf('# ---------- ', start + BANNER.length));

const API = 'http://api.test';
const TENANT = 'b0000000-0000-4000-8000-000000000002';
const MAPPING = '0153d500-e29b-41d4-a716-446655440031';
const PERSON = '0153d500-e29b-41d4-a716-446655440041';
const LEFTOVER = '0153d500-e29b-41d4-a716-446655440042';
const LINK = '0153d500-e29b-41d4-a716-446655440051';
const VIEW_TOKEN = `p.${LINK}.s3cr3t`;

/** One canned answer: an HTTP code and a one-line body. */
type Answer = readonly [number, unknown];
/** Answers per "METHOD path"; a list is answered in turn, its last answer repeating. */
type Api = Record<string, Answer | readonly Answer[]>;

/** A person's page, as `GET /api/view/:link` answers it for one DAV migration. */
const PAGE = {
  kind: 'person',
  organisation: 'Demo B',
  expiresAt: '2026-11-02T00:00:00.000Z',
  migrations: [
    {
      from: 'caldav',
      to: 'caldav',
      state: 'active',
      started: true,
      domains: [{ domain: 'calendar', state: 'completed', itemsSynced: 3, itemsFailed: 0 }],
      account: null,
    },
  ],
  accounts: [],
};

/** The whole section passing: the run's person, their link, both refusals, and the clean-up. */
function passing(over: Api = {}): Api {
  return {
    'POST /api/people': [201, { id: PERSON, displayName: 'Smoke run: progress link', migrations: [] }],
    [`POST /api/people/${PERSON}/migrations`]: [201, { id: PERSON, migrations: [{ id: MAPPING, status: 'active' }] }],
    [`POST /api/people/${PERSON}/links view`]: [
      201,
      { id: LINK, purpose: 'view', url: `https://app.example.test/view/${VIEW_TOKEN}`, expiryDays: 30 },
    ],
    [`POST /api/people/${PERSON}/links grant`]: [
      409,
      { error: 'nothing_to_grant', reason: 'None of their migrations can be granted through a link.' },
    ],
    [`GET /api/view/${VIEW_TOKEN}`]: [[200, PAGE], [401, { error: 'link_unusable' }]],
    [`GET /api/grant/${VIEW_TOKEN}`]: [401, { error: 'link_unusable' }],
    [`DELETE /api/people/${PERSON}/links/${LINK}`]: [200, { revoked: true }],
    [`DELETE /api/people/${PERSON}`]: [200, { deleted: true, unassigned: [MAPPING] }],
    ...over,
  };
}

const keyFile = (key: string): string => createHash('md5').update(key).digest('hex').slice(0, 16);

/**
 * Run the section against `api`. `http` and `curl` are fakes that write each
 * call to a log and answer from `api`, in turn, through files, because each
 * call runs in a subshell that cannot hand a variable back. `jq` is the real
 * one, as the gate's.
 */
function run(api: Api): { out: string; calls: string[]; fail: boolean } {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-person-link-'));
  try {
    for (const [key, value] of Object.entries(api)) {
      const answers = (Array.isArray(value[0]) ? value : [value]) as readonly Answer[];
      const at = join(dir, 'answers', keyFile(key));
      mkdirSync(at, { recursive: true });
      answers.forEach(([code, body], i) => writeFileSync(join(at, String(i + 1)), `${code} ${JSON.stringify(body)}`));
    }
    const program = [
      'set -u',
      'fail=0',
      'SECTION=""',
      'FAIL_REASONS=""',
      `API="${API}"`,
      'APPLY_TOKEN="aaaa.bbbb.cccc"',
      `APPLY_MAPPING="${MAPPING}"`,
      `APPLY_TENANT="${TENANT}"`,
      `ANSWERS="${join(dir, 'answers')}"`,
      `CALLS="${join(dir, 'calls')}"`,
      ': > "$CALLS"',
      // The next canned answer for a key; the last one repeats.
      'answer() {',
      '  local d n',
      `  d="$ANSWERS/$(printf '%s' "$1" | md5sum | cut -c1-16)"`,
      '  [ -d "$d" ] || { echo "599 {\\"error\\":\\"no answer for $1\\"}"; return 0; }',
      '  n="$(cat "$d/next" 2>/dev/null || echo 1)"',
      '  if [ -f "$d/$n" ]; then echo $((n + 1)) > "$d/next"; cat "$d/$n"; else cat "$d/$((n - 1))"; fi',
      '}',
      // The smoke's `http`: "<code> <body>" on one line. A link's purpose is
      // part of the key, since the one route issues both.
      'http() {',
      '  local path="${2#"$API"}" key',
      '  printf "%s %s %s\\n" "$1" "$path" "${4:-}" >> "$CALLS"',
      '  key="$1 $path"',
      '  case "${4:-}" in *\'"purpose":"view"\'*) key="$key view" ;; *\'"purpose":"grant"\'*) key="$key grant" ;; esac',
      '  answer "$key"',
      '}',
      // `curl` for the opens, which carry no session: the body then the code,
      // or the code alone with `-o /dev/null`.
      'curl() {',
      '  local url="${*: -1}" quiet=0 a got',
      '  for a in "$@"; do',
      '    [ "$a" = "/dev/null" ] && quiet=1',
      '    case "$a" in Authorization:*) echo "OPEN-WITH-A-SESSION" >> "$CALLS" ;; esac',
      '  done',
      '  printf "OPEN %s\\n" "${url#"$API"}" >> "$CALLS"',
      '  got="$(answer "GET ${url#"$API"}")"',
      '  if [ "$quiet" = 1 ]; then printf "%s" "${got%% *}"; else printf "%s\\n%s" "${got#* }" "${got%% *}"; fi',
      '}',
      defined('note'),
      defined('fail_at'),
      section,
      'echo "fail=$fail"',
      'printf "%s" "$FAIL_REASONS"',
    ].join('\n');
    const file = join(dir, 'run.sh');
    writeFileSync(file, program);
    const out = execFileSync('bash', [file], { encoding: 'utf8' });
    const calls = readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean);
    return { out, calls, fail: out.includes('fail=1') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the progress link the gate asks for is a person’s', () => {
  it('found the section, so the rest of this file is not vacuous', () => {
    expect(section).toContain('note "the progress link"');
    expect(section.length).toBeGreaterThan(2000);
  });

  it('passes against an API that answers as the live one does', () => {
    const { out, fail } = run(passing());
    expect(fail, out).toBe(false);
    expect(out).toContain('opened with no session');
    expect(out).toContain('the progress link is refused at the grant address');
    expect(out).toContain('and it stops opening the moment it is revoked');
    expect(out).toContain('the person is deleted, and the APPLY mapping belongs to nobody again');
  });

  it('never asks a migration for a link: the route #1408 refuses', () => {
    const { calls } = run(passing());
    expect(calls.filter((c) => /\/api\/migrations\/[^ ]*\/links/.test(c))).toEqual([]);
    expect(calls).toContain(`POST /api/people/${PERSON}/links {"purpose":"view","expiryDays":30}`);
  });

  it('opens the link with no session, as the person does', () => {
    const { calls } = run(passing());
    expect(calls).toContain(`OPEN /api/view/${VIEW_TOKEN}`);
    expect(calls).not.toContain('OPEN-WITH-A-SESSION');
  });

  it('fails when the person’s page carries their id, the migration’s or the organisation’s', () => {
    for (const leak of [PERSON, MAPPING, TENANT]) {
      const page = { ...PAGE, organisation: `Demo B ${leak}` };
      const { out, fail } = run(passing({ [`GET /api/view/${VIEW_TOKEN}`]: [[200, page], [401, {}]] }));
      expect(fail, leak).toBe(true);
      expect(out).toContain(`the progress payload leaked ${leak}`);
    }
  });

  it('fails when the page is not a person’s, or not their one migration', () => {
    const notAPerson = run(passing({ [`GET /api/view/${VIEW_TOKEN}`]: [[200, { ...PAGE, kind: 'migration' }], [401, {}]] }));
    expect(notAPerson.fail).toBe(true);
    expect(notAPerson.out).toContain('the progress payload is missing "kind":"person"');
    const twoOfThem = run(
      passing({
        [`GET /api/view/${VIEW_TOKEN}`]: [[200, { ...PAGE, migrations: [...PAGE.migrations, ...PAGE.migrations] }], [401, {}]],
      }),
    );
    expect(twoOfThem.fail).toBe(true);
    expect(twoOfThem.out).toContain("the progress page does not show the person's migrations");
  });

  it('fails when the progress token opens the grant page', () => {
    const { out, fail } = run(passing({ [`GET /api/grant/${VIEW_TOKEN}`]: [200, {}] }));
    expect(fail).toBe(true);
    expect(out).toContain('the two link purposes are not being kept apart');
  });

  it('fails when a revoked link still opens', () => {
    const { out, fail } = run(passing({ [`GET /api/view/${VIEW_TOKEN}`]: [200, PAGE] }));
    expect(fail).toBe(true);
    expect(out).toContain('revocation did not reach the page');
  });

  /** The run leaves no person behind, so the next run is not refused. */
  it('deletes its person even when a step before failed', () => {
    const { calls, fail } = run(passing({ [`POST /api/people/${PERSON}/links view`]: [500, { error: 'boom' }] }));
    expect(fail).toBe(true);
    expect(calls).toContain(`DELETE /api/people/${PERSON} `);
  });

  it('takes back a person an earlier run left holding the migration, and only one by its own name', () => {
    const left = {
      [`POST /api/people/${PERSON}/migrations`]: [
        [409, { error: 'with_another_person', personId: LEFTOVER }],
        [201, { id: PERSON }],
      ],
      'GET /api/people': [
        200,
        { people: [{ id: LEFTOVER, displayName: 'Smoke run: progress link' }, { id: PERSON, displayName: 'x' }] },
      ],
      [`DELETE /api/people/${LEFTOVER}`]: [200, { deleted: true, unassigned: [MAPPING] }],
    } as const satisfies Api;
    const ours = run(passing(left));
    expect(ours.fail, ours.out).toBe(false);
    expect(ours.calls).toContain(`DELETE /api/people/${LEFTOVER} `);

    const someoneElse = run(
      passing({ ...left, 'GET /api/people': [200, { people: [{ id: LEFTOVER, displayName: 'Anna Jansen' }] }] }),
    );
    expect(someoneElse.fail).toBe(true);
    expect(someoneElse.calls).not.toContain(`DELETE /api/people/${LEFTOVER} `);
    expect(someoneElse.out).toContain('not a person this run made');
  });

  it('says the grant link it could not issue was expected, for a person whose source is DAV', () => {
    const { out, fail } = run(passing());
    expect(fail).toBe(false);
    expect(out).toContain('no grant link to cross-check with (nothing_to_grant)');
  });

  it('checks a grant link at the progress address when one is issued, and revokes it', () => {
    const grant = '0153d500-e29b-41d4-a716-446655440052';
    const grantToken = `p.${grant}.g`;
    const { out, calls, fail } = run(
      passing({
        [`POST /api/people/${PERSON}/links grant`]: [
          201,
          { id: grant, purpose: 'grant', url: `https://app.example.test/grant/${grantToken}` },
        ],
        [`GET /api/view/${grantToken}`]: [401, {}],
        [`DELETE /api/people/${PERSON}/links/${grant}`]: [200, { revoked: true }],
      }),
    );
    expect(fail, out).toBe(false);
    expect(out).toContain('a grant link is refused at the progress address');
    expect(calls).toContain(`DELETE /api/people/${PERSON}/links/${grant} `);
  });
});
