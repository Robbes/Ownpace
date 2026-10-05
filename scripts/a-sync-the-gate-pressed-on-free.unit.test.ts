// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SYNC THE GATE PRESSED ON FREE (E2E (managed) #238, 2026-10-05).
 *
 * 0157 T2 and T4 put Free at one pass a day outside the alpha. *Sync now*
 * inside that day answers `409 free_pace`. The managed gate's stack ran outside
 * the alpha, and its demo organisations are billed Free by what they hold. So
 * #238 pressed, read `free_pace`, and found the task lane, the large file and
 * the canary copied NOTHING, because no pass ran. No pull request runs the
 * gate, so the change merged green.
 *
 * Before it presses, the prepare phase now picks Small for each demo
 * organisation, through the Billing page's own door (`POST /api/billing/pick`,
 * 0157 T6), at the price that door offers. On a stack in the alpha it picks
 * nothing, since no pace holds there. These tests run `at_a_paid_pace`
 * exactly as the script has it, against a fake API. So what is proved is the
 * code that runs on the Spark, not a copy of it.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(REPO, path), 'utf8');
const script = read('deploy/compose/smoke-managed.sh');
const billingRoute = read('apps/api/src/routes/billing/index.ts');
const freePace = read('apps/api/src/routes/migrations/free-pace.ts');

/** A function the smoke defines, exactly as written there. */
function defined(name: string): string {
  const oneLine = new RegExp(`^${name}\\(\\) \\{.*\\}$`, 'm').exec(script);
  if (oneLine) return oneLine[0];
  const block = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm').exec(script);
  if (!block) throw new Error(`smoke-managed.sh no longer defines ${name}()`);
  return block[0];
}

const API = 'http://api.test';

/** One canned answer: an HTTP code and a body, JSON unless it is a string. */
type Answer = readonly [number, unknown];
/** Answers per "METHOD path". */
type Api = Record<string, Answer>;

const SMALL = { id: 'small', name: 'Small', paths: 6, dataGb: 500, monthlyEur: 5, annualEur: 30 };
const MEDIUM = { id: 'medium', name: 'Medium', paths: 15, dataGb: 1000, monthlyEur: 15, annualEur: 90 };
const FREE = { id: 'free', name: 'Free', paths: 1, dataGb: 15, monthlyEur: 0, annualEur: 0 };

/** What the door answers an organisation billed `billed`, outside the alpha unless `holds` says otherwise. */
const offers = (billed: object, raise: object[], holds = true) => ({
  holds,
  billed,
  picked: { now: null, next: null, nextFrom: '2026-11-01T00:00:00.000Z' },
  raise,
  lower: [],
});

/** A demo organisation billed Free, the pick taken as the live door takes it. */
function onFree(over: Api = {}): Api {
  return {
    'GET /api/billing/pick': [200, offers(FREE, [SMALL, MEDIUM])],
    'POST /api/billing/pick': [200, { from: 'now', ...offers(SMALL, [MEDIUM]) }],
    ...over,
  };
}

const keyFile = (key: string): string => createHash('md5').update(key).digest('hex').slice(0, 16);

/**
 * Run `at_a_paid_pace` against `api`. `http` is a fake that writes each call
 * to a log and answers from `api` through files, because each call runs in a
 * subshell that cannot hand a variable back. `jq` is the real one, as the
 * gate's.
 */
function run(api: Api): { out: string; calls: string[]; fail: boolean } {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-paid-pace-'));
  try {
    for (const [key, [code, body]] of Object.entries(api)) {
      mkdirSync(join(dir, 'answers'), { recursive: true });
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      writeFileSync(join(dir, 'answers', keyFile(key)), `${code} ${text}`);
    }
    const program = [
      'set -u',
      'fail=0',
      'SECTION=""',
      'FAIL_REASONS=""',
      `API="${API}"`,
      `ANSWERS="${join(dir, 'answers')}"`,
      `CALLS="${join(dir, 'calls')}"`,
      ': > "$CALLS"',
      // The smoke's `http`: "<code> <body>" on one line.
      'http() {',
      '  local path="${2#"$API"}" f',
      '  printf "%s %s %s\\n" "$1" "$path" "${4:-}" >> "$CALLS"',
      `  f="$ANSWERS/$(printf '%s' "$1 $path" | md5sum | cut -c1-16)"`,
      '  if [ -f "$f" ]; then cat "$f"; else echo "599 {\\"error\\":\\"no answer for $1 $path\\"}"; fi',
      '}',
      defined('note'),
      defined('fail_at'),
      defined('at_a_paid_pace'),
      'note "prepare (SMOKE_PREPARE_APPLY=1) — the demo organisations at a paid tier\'s pace"',
      'at_a_paid_pace "aaaa.bbbb.cccc" dav',
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

const posts = (calls: string[]): string[] => calls.filter((c) => c.startsWith('POST '));

describe('the gate puts its demo organisations at a paid tier’s pace before it presses', () => {
  const prepare = script.indexOf('if [ "${SMOKE_PREPARE_APPLY:-0}" = "1" ]; then');
  const press = script.indexOf('"$API/api/migrations/$APPLY_MAPPING/sync"');
  const syncBeforeVerify = script.indexOf('sync_and_wait "$VERIFY_TENANT"');

  it('found the function and the prepare phase, so the rest of this file is not vacuous', () => {
    expect(defined('at_a_paid_pace')).toContain('/api/billing/pick');
    for (const [name, at] of [['prepare', prepare], ['press', press], ['sync before verify', syncBeforeVerify]] as const) {
      expect(at, `${name} not found`).toBeGreaterThan(-1);
    }
  });

  it('asks for both demo organisations, inside prepare, before either press', () => {
    const block = script.slice(prepare, press);
    expect(block).toContain('at_a_paid_pace "$VERIFY_TOKEN" mail');
    expect(block).toContain('at_a_paid_pace "$APPLY_TOKEN" dav');
    expect(press).toBeLessThan(syncBeforeVerify);
  });

  it('picks Small at the price the door offers, when the organisation is billed Free outside the alpha', () => {
    const { out, calls, fail } = run(onFree());
    expect(fail, out).toBe(false);
    expect(posts(calls)).toEqual(['POST /api/billing/pick {"tierId":"small","priceEur":5}']);
    expect(out).toContain('picked Small at EUR 5 a month, counting now');
  });

  it('sends the price the door offers today, never one written into the gate', () => {
    const dearer = { ...SMALL, monthlyEur: 7 };
    const { calls, fail } = run(
      onFree({
        'GET /api/billing/pick': [200, offers(FREE, [dearer])],
        'POST /api/billing/pick': [200, { from: 'now', ...offers(dearer, []) }],
      }),
    );
    expect(fail).toBe(false);
    expect(posts(calls)).toEqual(['POST /api/billing/pick {"tierId":"small","priceEur":7}']);
  });

  it('picks nothing once a paid tier stands, so a re-run converges', () => {
    const { out, calls, fail } = run(onFree({ 'GET /api/billing/pick': [200, offers(SMALL, [MEDIUM])] }));
    expect(fail, out).toBe(false);
    expect(posts(calls)).toEqual([]);
    expect(out).toContain("billed small — a paid tier's pace already");
  });

  it('picks nothing during the alpha, where every tier runs at a paid tier’s pace and the door refuses', () => {
    const { out, calls, fail } = run(onFree({ 'GET /api/billing/pick': [200, offers(FREE, [SMALL], false)] }));
    expect(fail, out).toBe(false);
    expect(posts(calls)).toEqual([]);
    expect(out).toContain('the alpha');
  });

  it('fails, and says so, when the pick is not taken', () => {
    const { out, fail } = run(
      onFree({ 'POST /api/billing/pick': [409, { error: 'offer_changed', pick: offers(FREE, [MEDIUM]) }] }),
    );
    expect(fail).toBe(true);
    expect(out).toContain('the pick of Small was not taken (HTTP 409)');
  });

  it('fails when the door answers 200 but the tier did not change', () => {
    const { out, fail } = run(onFree({ 'POST /api/billing/pick': [200, { from: 'now', ...offers(FREE, [SMALL]) }] }));
    expect(fail).toBe(true);
    expect(out).toContain('the pick of Small was not taken (HTTP 200)');
  });

  it('fails when the organisation is billed Free and the door offers no Small', () => {
    const { out, calls, fail } = run(onFree({ 'GET /api/billing/pick': [200, offers(FREE, [MEDIUM])] }));
    expect(fail).toBe(true);
    expect(posts(calls)).toEqual([]);
    expect(out).toContain('the door offers no Small to pick');
  });

  it('never takes an answer it cannot read for the alpha, or for a paid tier', () => {
    for (const [label, answer] of [
      ['a server fault', [500, { error: 'pick_failed' }]],
      ['a refused token', [401, { error: 'Unauthorized' }]],
      ['a page that is not JSON', [200, '<html>gateway</html>']],
      ['no billed tier', [200, { holds: true, raise: [SMALL] }]],
      ['no holds', [200, { billed: SMALL, raise: [] }]],
    ] as const) {
      const { out, calls, fail } = run(onFree({ 'GET /api/billing/pick': answer as Answer }));
      expect(fail, label).toBe(true);
      expect(posts(calls), label).toEqual([]);
      expect(out, label).toContain('could not be read');
    }
  });
});

describe('the doors it relies on still answer as it reads them', () => {
  it('the Billing page’s door reads and takes a pick, with `holds`, `billed`, `raise` and `monthlyEur`', () => {
    expect(billingRoute).toContain("router.get('/pick'");
    expect(billingRoute).toContain("router.post('/pick'");
    expect(billingRoute).toMatch(/tierId: z\.string\(\)/);
    expect(billingRoute).toMatch(/priceEur: z\.number\(\)/);
    expect(billingRoute).toMatch(/^\s+holds,$/m);
    expect(billingRoute).toContain('billed: pickTier(state.billed.tier)');
    expect(billingRoute).toContain('raise: offers.raise.map(pickTier)');
    expect(billingRoute).toContain('monthlyEur: monthlyEur(t)');
  });

  it('Sync now on Free still refuses with `free_pace`, the refusal #238 read', () => {
    expect(freePace).toContain("error: 'free_pace'");
  });
});
