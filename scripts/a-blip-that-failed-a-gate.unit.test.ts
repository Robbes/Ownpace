// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A read that never got an answer is asked again; a write never is.
 *
 * ## What happened
 *
 * E2E (managed) #174 died at `setup-zitadel.sh` twice in a row — both attempts
 * — with `curl: (35) OpenSSL/3.0.13: error:0A000438:SSL routines::tlsv1 alert
 * internal error` against the fronted issuer. Run #175, on the same runner and
 * the same box half an hour later, brought the same stack up cleanly with
 * nothing in between that touched TLS, the provider or the ingress.
 *
 * The front was briefly unable to complete a handshake. The script asked once,
 * so a blip became a failed gate and an afternoon spent looking for a cause in
 * a diff that had none.
 *
 * ## Why the boundary is where it is, and why that is the interesting part
 *
 * A retry that covers too much is worse than none. Three rules hold it in:
 * only a transport failure (never an HTTP status, which is the provider
 * ANSWERING and already has a diagnosis attached); only reads (a `recv
 * failure` can land after the server has acted, and this script MINTS ACCESS
 * TOKENS — a duplicated mint leaves a live credential nothing tracks); and the
 * last failure is still fatal with the message it always had.
 *
 * The first two are asserted by RUNNING the helper against a fake `curl`,
 * because a rule about how many times something is attempted is not something
 * source-reading can check. The third is read out of the source, where it is a
 * sentence rather than a behaviour.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SETUP = join(REPO, 'deploy/compose/setup-zitadel.sh');
const source = readFileSync(SETUP, 'utf8');

/**
 * The helper, lifted out of the script so it can be run without running the
 * script. Taken verbatim — a copy of the logic in this file would pass while
 * the shipped one rotted.
 */
function helperSource(): string {
  const start = source.indexOf('curl_read_retrying() {');
  expect(
    start,
    'setup-zitadel.sh no longer defines curl_read_retrying. If the bounded\n' +
      'retry moved, point this test at where it lives — but a gate that fails\n' +
      'on one dropped handshake is what this exists to prevent.',
  ).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 3);
}

/**
 * Runs the helper with a `curl` that fails `failures` times before succeeding
 * (or forever, when `failures` is Infinity), and `sleep` replaced so the test
 * does not actually wait fourteen seconds.
 *
 * Returns what the helper set, plus how many times `curl` was really called —
 * which is the number the rules are about.
 */
function run(failures: number, attempts = 4): { rc: number; calls: number; slept: number[] } {
  const fails = failures === Infinity ? 999 : failures;
  // `set -euo pipefail`, exactly as the script runs — the retry has to survive
  // it, and an earlier draft of the helper did not.
  //
  // The call counter lives in a FILE, not a variable: `curl` is invoked inside
  // a command substitution, so anything it increments in the shell is lost with
  // that subshell. The first draft of this harness counted in a variable, read
  // 0 every time, and its fake curl therefore failed forever — which looked
  // exactly like a broken retry.
  const script = `
set -euo pipefail
say() { :; }
COUNT="$(mktemp)"
SLEPT=""
sleep() { SLEPT="$SLEPT $1"; }
IDP_READ_ATTEMPTS=${attempts}
curl() {
  local n
  n=$(( $(cat "$COUNT" 2>/dev/null || echo 0) + 1 ))
  printf '%s' "$n" > "$COUNT"
  if [ "$n" -le ${fails} ]; then return 35; fi
  printf 'ok'
  return 0
}
${helperSource()}
curl_read_retrying "probe" -sS https://example.invalid
echo "rc=$CURL_RC calls=$(cat "$COUNT") attempts=$CURL_ATTEMPTS slept=$SLEPT"
rm -f "$COUNT"
`;
  const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim();
  const m = /rc=(\d+) calls=(\d+) attempts=(\d+) slept=(.*)$/.exec(out);
  expect(m, `unexpected harness output: ${out}`).not.toBeNull();
  return {
    rc: Number(m![1]),
    calls: Number(m![2]),
    slept: m![4]!.trim() ? m![4]!.trim().split(/\s+/).map(Number) : [],
  };
}

describe('a dropped handshake is asked again', () => {
  it('rides out two failures and succeeds on the third ask', () => {
    const r = run(2);
    expect(r.rc).toBe(0);
    expect(r.calls).toBe(3);
  });

  it('backs off rather than hammering', () => {
    // 2s then 4s. A retry with no gap re-asks inside the same blip and learns
    // nothing; one that waits a minute outlives the gate's patience.
    expect(run(2).slept).toEqual([2, 4]);
  });

  it('costs a healthy call nothing at all', () => {
    // The happy path must not grow a sleep. Every call in this script is a
    // read on a good day.
    const r = run(0);
    expect(r.calls).toBe(1);
    expect(r.slept).toEqual([]);
  });
});

describe('and it is bounded', () => {
  it('gives up after exactly IDP_READ_ATTEMPTS asks, still failing', () => {
    const r = run(Infinity, 4);
    expect(r.calls).toBe(4);
    expect(r.rc).toBe(35);
  });

  it('honours a different budget rather than a hard-coded four', () => {
    expect(run(Infinity, 2).calls).toBe(2);
  });
});

/**
 * Comments stripped: the paragraphs above and in the script quote these very
 * shapes, and a rule that read prose would be satisfied by its own
 * explanation.
 */
const code = source
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

describe('the boundary the retry must not cross', () => {
  it('re-asks GET and nothing else', () => {
    expect(
      code,
      'The retry in `api` is no longer conditioned on the method. A `recv\n' +
        'failure` can land AFTER the server acted, so a re-sent write can apply\n' +
        'twice — and this script mints personal access tokens, where that leaves\n' +
        'a second live credential nothing tracks and nothing revokes.',
    ).toMatch(/if\s+\[\s+"\$method"\s+=\s+GET\s+\];\s+then\s*\n\s*curl_read_retrying/);
  });

  it('never re-asks an HTTP status', () => {
    // A 401/403/404 is the provider ANSWERING and every one has a diagnosis
    // attached below it. Retrying those delays a correct message and changes
    // nothing about it.
    expect(
      /curl_read_retrying[^\n]*\$\{?status/.test(code),
      'something is retrying on an HTTP status rather than a transport failure',
    ).toBe(false);
    expect(code).toMatch(/CURL_RC" -eq 0 \]/);
  });

  it('still dies when every ask failed', () => {
    // Surviving a blip must not become being quiet about a provider that is
    // gone. The message keeps its original remedy and gains the count.
    expect(code).toMatch(/could not reach \$\{ISSUER\}\$\{path\} at all.*asked \$\{tries\} time/s);
    expect(code).toMatch(/ps zitadel/);
  });
});

describe('refused and never answered are different faults', () => {
  it('the successor probe no longer calls a dead network a refusal', () => {
    // The old form was `|| echo 000` and then "the freshly minted token was
    // refused (HTTP 000)", which sends whoever reads it looking at grants and
    // expiry for what was a network that never carried the question. Both
    // outcomes still rotate nothing; only one of them was ever true.
    // Scoped to the probe, deliberately. The readiness WAIT near the top of
    // the script uses `|| echo 000` and is right to: it is a poll whose whole
    // job is "not yet", where no answer and a bad answer mean the same thing.
    // Here they do not.
    //
    // The window is measured FORWARD from the probe. An earlier draft ended it
    // at `indexOf('rotating nothing')`, which finds an occurrence ABOVE the
    // probe — so the slice was empty and the assertion passed on nothing.
    const from = code.indexOf('proving the new token');
    expect(from, 'the successor-token probe is gone or renamed').toBeGreaterThan(-1);
    // A fixed window forward, and both of the probe's outcomes must be inside
    // it — which is what makes the negative assertion below non-vacuous. An
    // earlier draft ended the window at the FIRST `rotating nothing` after the
    // probe, which is the transport-failure branch, so the refusal branch fell
    // outside and an empty-ish slice matched nothing at all.
    const probe = code.slice(from, from + 900);
    expect(probe).toMatch(/could not reach the provider to prove the freshly minted token/);
    expect(probe).toMatch(/the freshly minted token was refused/);
    expect(
      probe,
      'the successor-token probe is back to collapsing a transport failure into\n' +
        'an HTTP status with `|| echo 000`',
    ).not.toMatch(/\|\|\s*echo\s*000/);
    expect(code).toMatch(/could not reach the provider to prove the freshly minted token/);
  });

  it('rotates nothing either way', () => {
    const rotatesNothing = [...code.matchAll(/rotating nothing/g)];
    expect(rotatesNothing.length).toBeGreaterThanOrEqual(2);
  });
});
