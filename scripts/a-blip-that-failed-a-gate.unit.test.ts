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
 * only no answer from the provider (a transport failure, or a 502, 503 or 504
 * from whatever is in front of it — never a status the provider gave, which is
 * it ANSWERING and already has a diagnosis attached); only reads (a `recv
 * failure` can land after the server has acted, and this script MINTS ACCESS
 * TOKENS — a duplicated mint leaves a live credential nothing tracks); and the
 * last failure is still fatal with the message it always had.
 *
 * The first two are asserted by RUNNING the helper against a fake `curl`,
 * because a rule about how many times something is attempted is not something
 * source-reading can check. The third is read out of the source, where it is a
 * sentence rather than a behaviour.
 *
 * ## And then the front answered for the provider (E2E (managed) #263)
 *
 * On 2026-10-21 both attempts of #263 died in `api` on an HTTP 502: the NetBird
 * front in front of the issuer answered with its own "Connection Error" page,
 * once on the first read after the provider started and once on a read in the
 * middle of others that had gone through it. Runs through the same front that
 * morning were green. A 502 is not the provider saying no — it is the front
 * saying it got no answer — so reads now ride it out on the same budget, and a
 * write answered 502 is still asked exactly once.
 *
 * Those cases run the REAL `api`, captured the way the script captures it
 * (`x="$(api …)"`), and that is how they found a second fault the helper-only
 * harness above could not: the retry line went to stdout, inside the caller's
 * `$( )`, so a read that was re-asked and then answered handed jq a log line
 * in front of the JSON. True of the transport retry since #174 added it.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/**
 * `is_read`, lifted out and run — same reason as the helper above. Which calls
 * are re-asked is a behaviour, and a regex over the source would be satisfied
 * by the shape of the condition rather than by what it decides.
 */
function readable(pairs: ReadonlyArray<readonly [string, string]>): boolean[] {
  const start = source.indexOf('is_read() {');
  expect(
    start,
    'setup-zitadel.sh no longer defines is_read. The retry decides which calls\n' +
      'are safe to re-ask; if that moved, point this test at where it lives.',
  ).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', start);
  const fn = source.slice(start, end + 3);
  const checks = pairs
    .map(([m, path]) => `if is_read ${m} '${path}'; then echo yes; else echo no; fi`)
    .join('\n');
  const out = execFileSync('bash', ['-c', `set -euo pipefail\n${fn}\n${checks}\n`], {
    encoding: 'utf8',
  }).trim();
  return out.split('\n').map((l) => l === 'yes');
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
 * A function of the script, lifted verbatim: a one-liner (`say`, `die`) by its
 * line, anything longer up to its closing brace.
 */
function lift(name: string): string {
  const at = source.indexOf(`\n${name}() {`);
  expect(at, `setup-zitadel.sh no longer defines ${name}`).toBeGreaterThan(-1);
  const lineEnd = source.indexOf('\n', at + 1);
  const first = source.slice(at + 1, lineEnd);
  if (first.trimEnd().endsWith('}')) return `${first}\n`;
  const end = source.indexOf('\n}\n', at + 1);
  expect(end).toBeGreaterThan(at);
  return source.slice(at + 1, end + 3);
}

/**
 * The block that proves a freshly minted token: the one read in the script that
 * cannot go through `api`, because it presents a different credential. From its
 * `curl_read_retrying` to the end of the `case` that judges the answer.
 */
function probeBlock(): string {
  const at = source.indexOf('  curl_read_retrying "GET /auth/v1/users/me (proving the new token)"');
  expect(at, 'the successor-token probe is gone or renamed').toBeGreaterThan(-1);
  const judged = source.indexOf('case "$new_code" in', at);
  expect(judged).toBeGreaterThan(at);
  const end = source.indexOf('\n  esac\n', judged);
  expect(end).toBeGreaterThan(judged);
  return source.slice(at, end + '\n  esac\n'.length);
}

/**
 * What NetBird's front sent on 2026-10-21 in place of the provider's answer: its
 * own HTML page, several lines long. A stand-in with the same shape — the words
 * a reader would grep for, and no address.
 */
const FRONT_PAGE = [
  '<!DOCTYPE html>',
  '<html><head><title>Connection Error</title></head>',
  '<body><h1>Connection Error</h1><p>NetBird Service</p>',
  '<script>window.__NB__={"proxy":true}</script></body></html>',
].join('\n');

interface Asked {
  /** How the harness ended: 0, or `die`'s 1 — exactly as the script would. */
  rc: number;
  /** What the CALLER captured. `api` runs inside `$( )` at every call site. */
  answer: string;
  stderr: string;
  /** One `<METHOD> <url>` per time curl was really called. */
  calls: string[];
  slept: number[];
}

/**
 * Runs the REAL `api` — with the real `is_read`, `curl_read_retrying`, `say`
 * and `die` — against a `curl` that answers from a list, one entry per ask: an
 * HTTP status, or `x<n>` for curl exiting `n` with no answer at all. The last
 * entry repeats.
 *
 * `call` is the line the harness runs, written the way the script writes it:
 * `x="$(api …)"`. That matters. A line `say` writes inside `$( )` lands in the
 * caller's variable, not in the log, and only a harness that captures the way
 * the script captures can see it.
 */
function ask(answers: readonly string[], call: string, attempts = 4): Asked {
  const dir = mkdtempSync(join(tmpdir(), 'blip-'));
  try {
    writeFileSync(join(dir, 'answers'), `${answers.join('\n')}\n`);
    writeFileSync(join(dir, 'page'), FRONT_PAGE);
    const script = `
set -euo pipefail
D="$BLIP_DIR"
${lift('say')}${lift('die')}
sleep() { printf '%s\\n' "$1" >> "$D/slept"; }
read_env() { printf '%s' "\${2:-}"; }
IDP_READ_ATTEMPTS=${attempts}
ISSUER=https://id.example.invalid
IDP_DOMAIN=id.example.invalid
IDP_PORT=443
CURL_ORIGIN=()
PAT=pat-0123456789abcdefghij
NEW_TOKEN=new-0123456789abcdefghij
SCRIPT_DIR=/srv/ownpace/deploy/compose
ENV_FILE="$SCRIPT_DIR/.env"
COMPOSE_PROJECT=ownpace-managed
PAT_ROTATE_BELOW_DAYS=3
curl() {
  local n m=GET url="" probe=0 prev="" a s body
  n=$(( $(cat "$D/count" 2>/dev/null || echo 0) + 1 ))
  printf '%s' "$n" > "$D/count"
  for a in "$@"; do
    case "$prev" in
      -X) m="$a" ;;
      -o) [ "$a" != /dev/null ] || probe=1 ;;
    esac
    case "$a" in http*) url="$a" ;; esac
    prev="$a"
  done
  printf '%s %s\\n' "$m" "$url" >> "$D/calls"
  s="$(sed -n "\${n}p" "$D/answers")"
  [ -n "$s" ] || s="$(tail -n 1 "$D/answers")"
  case "$s" in x*) return "\${s#x}" ;; esac
  case "$s" in
    2*)      body='{"user":{"id":"u-1"}}' ;;
    50[234]) body="$(cat "$D/page")" ;;
    *)       body='{"code":5,"message":"an answer this test chose"}' ;;
  esac
  if [ "$probe" = 1 ]; then printf '%s' "$s"; else printf '%s\\n%s' "$body" "$s"; fi
}
${lift('curl_read_retrying')}
${lift('is_read')}
${lift('api')}
${call}
`;
    const r = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, BLIP_DIR: dir },
    });
    const read = (f: string): string => {
      try {
        return readFileSync(join(dir, f), 'utf8');
      } catch {
        return '';
      }
    };
    return {
      rc: r.status ?? -1,
      answer: read('answer'),
      stderr: r.stderr,
      calls: read('calls').split('\n').filter(Boolean),
      slept: read('slept').split('\n').filter(Boolean).map(Number),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const READ_ME = `me="$(api GET /auth/v1/users/me)"\nprintf '%s' "$me" > "$D/answer"`;
const MINT = `minted="$(api POST /management/v1/users/u-1/pats '{"expirationDate":"2026-10-28T00:00:00Z"}')"\nprintf '%s' "$minted" > "$D/answer"`;
const PROVE = (): string => `${probeBlock()}\nprintf 'proved' > "$D/answer"`;
const ANSWER = '{"user":{"id":"u-1"}}';

/**
 * E2E (managed) #263, 2026-10-21, both attempts: the front answered 502 with
 * its own page — once right after the provider started, once in the middle of
 * reads that were succeeding through it — and `api` died on it as if the
 * provider had said no. A 502, 503 or 504 is the FRONT saying it could not get
 * an answer; for a read that is a question nobody answered, and it is asked
 * again exactly as a dropped handshake is.
 */
describe('a gateway error from the front is not the provider answering (#263)', () => {
  it.each(['502', '503', '504'])('a read answered %s and then 200 succeeds after one retry', (code) => {
    const r = ask([code, '200'], READ_ME);
    expect(r.stderr).not.toMatch(/FATAL/);
    expect(r.rc).toBe(0);
    expect(r.calls).toHaveLength(2);
    expect(r.slept).toEqual([2]);
    // EXACTLY the provider's answer: nothing the retry said may reach the
    // caller's variable, which goes straight to jq.
    expect(r.answer).toBe(ANSWER);
    expect(r.stderr).toMatch(
      new RegExp(`GET /auth/v1/users/me: the front answered HTTP ${code} without reaching the provider — attempt 1 of 4, retrying in 2s`),
    );
  });

  it('never prints the front\'s page on a retry line', () => {
    const r = ask(['502', '502', '200'], READ_ME);
    expect(r.rc).toBe(0);
    expect(r.stderr).not.toMatch(/Connection Error|NetBird|proxy/);
  });

  it('a read answered 502 every time fails after IDP_READ_ATTEMPTS asks, with today\'s message and the page', () => {
    const r = ask(['502'], READ_ME);
    expect(r.rc).toBe(1);
    expect(r.calls).toHaveLength(4);
    expect(r.slept).toEqual([2, 4, 8]);
    expect(r.stderr).toMatch(/FATAL: GET \/auth\/v1\/users\/me answered HTTP 502:\n\s+<!DOCTYPE html>/);
    expect(r.stderr).toMatch(/Connection Error/);
  });

  it('honours the budget for a gateway error too', () => {
    expect(ask(['503'], READ_ME, 2).calls).toHaveLength(2);
  });

  it('a `_search` is a read here as well', () => {
    // The second attempt of #263 died on a GET; the 2026-09-15 bring-up on a
    // `_search`. Both are reads and both ride it out.
    const r = ask(['504', '200'], `x="$(api POST /management/v1/projects/PID/apps/_search '{}')"\nprintf '%s' "$x" > "$D/answer"`);
    expect(r.rc).toBe(0);
    expect(r.calls).toEqual([
      'POST https://id.example.invalid/management/v1/projects/PID/apps/_search',
      'POST https://id.example.invalid/management/v1/projects/PID/apps/_search',
    ]);
  });

  it('a dropped handshake then 200 hands the caller the answer and nothing else', () => {
    // The transport retry #174 added, run the way the script runs it. Its
    // retry line went to STDOUT, inside `me="$(api …)"`, so a read that was
    // re-asked and then answered handed jq a log line in front of the JSON.
    const r = ask(['x35', '200'], READ_ME);
    expect(r.rc).toBe(0);
    expect(r.answer).toBe(ANSWER);
    expect(r.stderr).toMatch(/no answer at all \(curl exited 35\) — attempt 1 of 4/);
  });
});

describe('a WRITE is still asked exactly once, whatever answers', () => {
  it.each(['502', '503', '504'])('the mint answered %s is never re-sent', (code) => {
    const r = ask([code, '200'], MINT);
    expect(r.calls, 'a re-sent mint leaves a second live credential nothing tracks').toEqual([
      'POST https://id.example.invalid/management/v1/users/u-1/pats',
    ]);
    expect(r.slept).toEqual([]);
    expect(r.rc).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`FATAL: POST /management/v1/users/u-1/pats answered HTTP ${code}:`));
    expect(r.stderr).not.toMatch(/retrying/);
  });

  it.each([
    ['/admin/v1/email/ID/_activate'],
    ['/admin/v1/smtp/ID/_test'],
    ['/management/v1/projects'],
  ])('%s answered 502 is asked once', (path) => {
    const r = ask(['502', '200'], `x="$(api POST ${path} '{}')"`);
    expect(r.calls).toHaveLength(1);
    expect(r.rc).toBe(1);
  });
});

describe('a status the provider gave is still not re-asked', () => {
  it.each(['400', '401', '403', '404', '500'])('a read answered %s is asked once and dies with its own diagnosis', (code) => {
    const r = ask([code, '200'], READ_ME);
    expect(r.calls).toHaveLength(1);
    expect(r.slept).toEqual([]);
    expect(r.rc).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`GET /auth/v1/users/me answered HTTP ${code}`));
  });
});

describe('the freshly minted token is proved through the same rule', () => {
  it('rides out a 502 and proves the token', () => {
    const r = ask(['502', '200'], PROVE());
    expect(r.stderr).not.toMatch(/FATAL/);
    expect(r.rc).toBe(0);
    expect(r.answer).toBe('proved');
    expect(r.calls).toHaveLength(2);
    expect(r.stderr).toMatch(/proving the new token\): the front answered HTTP 502 without reaching the provider/);
  });

  it('calls a front that never got through what it is, not a refusal', () => {
    const r = ask(['502'], PROVE());
    expect(r.rc).toBe(1);
    expect(r.calls).toHaveLength(4);
    expect(r.stderr).toMatch(/FATAL: .*the front answered HTTP 502.*rotating nothing/s);
    expect(r.stderr).not.toMatch(/was refused/);
  });

  it('still calls a 401 a refusal, asked once', () => {
    const r = ask(['401', '200'], PROVE());
    expect(r.rc).toBe(1);
    expect(r.calls).toHaveLength(1);
    expect(r.stderr).toMatch(/FATAL: the freshly minted token was refused \(HTTP 401\)/);
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
  it('asks `api` to decide by meaning, not by verb', () => {
    // This assertion used to read `if [ "$method" = GET ]` out of the source —
    // it pinned the IMPLEMENTATION of rule 2 rather than the rule. That is how
    // the gap below survived: Zitadel's list endpoints are POST, so the retry
    // written for reads covered almost none of this script's reads, and a test
    // named "re-asks GET and nothing else" passed while it happened.
    expect(
      code,
      'The retry in `api` is no longer routed through `is_read`. A `recv\n' +
        'failure` can land AFTER the server acted, so a re-sent write can apply\n' +
        'twice — and this script mints personal access tokens, where that leaves\n' +
        'a second live credential nothing tracks and nothing revokes.',
    ).toMatch(/if\s+is_read\s+"\$method"\s+"\$path";\s+then\s*\n\s*curl_read_retrying/);
  });

  it('counts a `_search` as the read it is', () => {
    // The 2026-09-15 bring-up died here: one dropped handshake on
    // `projects/{id}/apps/_search`, asked once, whole phase gone.
    expect(
      readable([
        ['GET', '/auth/v1/users/me'],
        ['POST', '/management/v1/projects/_search'],
        ['POST', '/management/v1/projects/PID/apps/_search'],
        ['POST', '/admin/v1/policies/login/idps/_search'],
      ]),
    ).toEqual([true, true, true, true]);
  });

  it('still asks every WRITE exactly once, underscore or not', () => {
    // The two underscored writes are the reason this predicate is a suffix
    // match and not `*_*`: `_activate` turns an SMTP provider on and `_test`
    // SENDS MAIL. Re-asking either is a side effect, not a retry.
    expect(
      readable([
        ['POST', '/management/v1/users/UID/pats'],
        ['POST', '/admin/v1/email/ID/_activate'],
        ['POST', '/admin/v1/smtp/ID/_test'],
        ['POST', '/management/v1/projects'],
        ['PUT', '/v2/features/instance'],
        ['DELETE', '/admin/v1/policies/login/idps/OID'],
      ]),
    ).toEqual([false, false, false, false, false, false]);
  });

  it('reads the token list but never re-mints one', () => {
    // The sharpest pair in the script, one path segment apart: `pats/_search`
    // lists the tokens, `pats` creates one. Rule 2 exists for the second.
    expect(
      readable([
        ['POST', '/management/v1/users/UID/pats/_search'],
        ['POST', '/management/v1/users/UID/pats'],
      ]),
    ).toEqual([true, false]);
  });

  it('classifies every call this script actually makes', () => {
    // The guard that outlives this change: walk the REAL call sites, so a
    // write added later under a retried shape fails here rather than in a
    // bring-up. A `_search` is a read; everything else that is not a GET is
    // a write.
    const sites = [...source.matchAll(/\bapi\s+(GET|POST|PUT|DELETE|PATCH)\s+"?([^"\s)]+)/g)].map(
      (m) => [m[1]!, m[2]!] as const,
    );
    expect(sites.length, 'no `api <verb> <path>` call sites found — has the helper been renamed?')
      .toBeGreaterThan(10);
    const verdicts = readable(sites);
    const wrong = sites
      .map((s2, i) => ({ site: s2, retried: verdicts[i]! }))
      .filter(({ site, retried }) => retried !== (site[0] === 'GET' || site[1].endsWith('_search')));
    expect(wrong, `misclassified: ${JSON.stringify(wrong)}`).toEqual([]);
  });

  it('re-asks no status but the three a front sends when it got no answer', () => {
    // A 401/403/404 is the provider ANSWERING and every one has a diagnosis
    // attached below it. Retrying those delays a correct message and changes
    // nothing about it. A 502/503/504 is the front saying it got no answer
    // (#263). The behaviour is run above; this pins the list, so a status
    // added to it is a decision somebody makes here and not a drive-by.
    const helper = helperSource()
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    const arms = [...helper.matchAll(/^\s*([0-9|]+)\)/gm)].map((m) => m[1]);
    expect(arms, 'the statuses curl_read_retrying re-asks').toEqual(['502|503|504']);
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
