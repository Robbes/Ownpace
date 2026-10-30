// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The smoke gate's reads of the identity provider ride out a gateway error from the front; its writes are still sent once.
 *
 * ## What happened, one script over
 *
 * E2E (managed) #263 and #264 stopped in `setup-zitadel.sh` on 2026-10-21. Its
 * token check went through the public issuer, and the NetBird reverse proxy in
 * front of it answered HTTP 502 with its own "Connection Error" page before the
 * provider was ever reached. #1662 teaches that script's READS to ask again on
 * a 502, 503 or 504 as they already did on a dropped connection, and to keep
 * asking its WRITES exactly once.
 *
 * `smoke-managed.sh` asks the same issuer through the same front on a fronted
 * stack, and it had no retry of any kind: not for a 502, not even for a dropped
 * handshake. Its `idp_api`, the authorization request in `sign_in_as`, the
 * login page a browser is sent to, the form that founds an organisation and
 * the discovery document a browser reads were each asked once, so one blip of
 * the front would fail the whole nightly gate on a healthy stack.
 *
 * ## The boundary, which is the point
 *
 * The same three rules as #1662, on the same knob (`IDP_READ_ATTEMPTS`):
 *
 *   - only NO ANSWER is re-asked: a curl exit code, or a 502, 503 or 504. A
 *     400, 401, 403, 404 or 500 is the provider answering, and is asked once.
 *   - only READS. Which calls those are is NOT quite #1662's predicate:
 *     setup-zitadel.sh's is GET, or a POST on a path ending in `_search`, and
 *     this script's is that plus HEAD, plus Zitadel v2's ListUsers, which is a
 *     bare `POST /v2/users` matched as the whole path. That listing is the
 *     sweep for leftover people, the first question the managed section asks,
 *     behind `|| fail_at`. Creating a person (`POST /v2/users/human`, under the
 *     same prefix), proving a session, finalising an auth request and
 *     exchanging the code at the token endpoint are WRITES, and the code is
 *     one-time: it must never be sent twice.
 *   - the last failure still fails, with the message it always had.
 *
 * The rules are asserted by RUNNING the real functions and blocks, lifted
 * verbatim from the script, against a `curl` that answers from a list, and
 * captured the way the script captures them (`x="$(idp_api …)"`): a retry line
 * written to stdout inside that `$( )` would reach jq as part of the answer.
 *
 * The login page needs the REAL curl, because what is at stake there is what
 * curl's cookie jar does when an ask is repeated, and a fake curl would only
 * prove what the fake does. Those cases run the lifted block against a server
 * in this process that binds each authorization request to the cookie it set,
 * as Zitadel does (`User Agent does not correspond (EVENT-adk13)`).
 */

import { describe, it, expect } from 'vitest';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SMOKE = join(REPO, 'deploy/compose/smoke-managed.sh');
const SETUP = join(REPO, 'deploy/compose/setup-zitadel.sh');
const source = readFileSync(SMOKE, 'utf8');

/**
 * Comments stripped: this file's explanations quote the very shapes the rules
 * below look for, and a rule satisfied by its own explanation is no rule.
 */
const code = source
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

/**
 * A top-level function of the script, lifted verbatim — a copy of the logic in
 * this file would pass while the shipped one rotted.
 */
function lift(name: string): string {
  const at = source.indexOf(`\n${name}() {`);
  expect(
    at,
    `smoke-managed.sh no longer defines ${name}. If it moved, point this test at\n` +
      'where it lives; a gate that fails on one blip of the front is what it exists to prevent.',
  ).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', at + 1);
  expect(end).toBeGreaterThan(at);
  return source.slice(at + 1, end + 3);
}

/**
 * A block of the script, lifted verbatim: from the `read_retrying curl` that
 * starts the statement naming `anchor` to the first `closer` after it.
 */
function block(anchor: string, closer: string): string {
  const at = source.indexOf(anchor);
  expect(at, `smoke-managed.sh no longer contains ${anchor}`).toBeGreaterThan(-1);
  const start = source.lastIndexOf('read_retrying curl', at);
  expect(
    start > -1 && at - start < 400,
    `${anchor} is not asked through read_retrying: a 502 from the front there fails the gate`,
  ).toBe(true);
  const lineStart = source.lastIndexOf('\n', start) + 1;
  const end = source.indexOf(closer, at);
  expect(end).toBeGreaterThan(at);
  return source.slice(lineStart, end + closer.length);
}

/** The knob, as the script sets it — for the case that runs with it unset. */
function knob(): string {
  const m = /^IDP_READ_ATTEMPTS=.*$/m.exec(code);
  expect(m, 'smoke-managed.sh sets no IDP_READ_ATTEMPTS').not.toBeNull();
  return m![0];
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

const PAT = 'pat-0123456789abcdefghij';
const SESSION_TOKEN = 'SESSION-TOKEN-1';
const AUTH_CODE = 'CODE-ONCE';

/**
 * A `curl` that answers from a list, one entry per ask: an HTTP status, `x<n>`
 * for curl exiting `n` with no answer at all, or `cut` for the provider's 302
 * arriving and the connection dropping before its end (curl exits 18). The
 * last entry repeats, so a call that is re-asked when it should not be gets a
 * clean answer and passes — which is what makes "asked once" mean something.
 *
 * It writes what the real one writes for the flags the script uses: `-D -`
 * puts the head on stdout, `-o` sends the body away, and `-w` comes last, with
 * `000` for the status when nothing answered, as curl does. The body is the
 * provider's for the path on a 2xx or 3xx, the front's page on a 502, 503 or
 * 504, and a short JSON error otherwise.
 */
const FAKE_CURL = `
curl() {
  local a prev="" m="" url="" out="" head=0 w="" data=0 n s path body="" loc="" code
  for a in "$@"; do
    case "$prev" in
      -X) m="$a" ;;
      -o) out="$a" ;;
      -D) head=1 ;;
      -w) w="$a" ;;
      -d|--data-urlencode) data=1 ;;
    esac
    case "$a" in http://*|https://*) url="$a" ;; esac
    prev="$a"
  done
  if [ -z "$m" ]; then if [ "$data" = 1 ]; then m=POST; else m=GET; fi; fi
  path="/\${url#*://*/}"; path="\${path%%\\?*}"
  n=$(( $(cat "$D/count" 2>/dev/null || echo 0) + 1 ))
  printf '%s' "$n" > "$D/count"
  printf '%s %s\\n' "$m" "$path" >> "$D/calls"
  printf '%s\\n' "$*" >> "$D/argv"
  s="$(sed -n "\${n}p" "$D/answers")"
  [ -n "$s" ] || s="$(tail -n 1 "$D/answers")"
  case "$path" in
    */oauth/v2/authorize) loc="https://id.example.invalid/ui/v2/login/login?authRequest=V2_\${n}" ;;
  esac
  case "$s" in
    x*) [ -z "$w" ] || printf '%b' "\${w//'%{http_code}'/000}"; return "\${s#x}" ;;
    cut) code=302 ;;
    *) code="$s" ;;
  esac
  case "$code" in
    2*|3*)
      case "$m $path" in
        "GET /auth/v1/users/me") body='{"user":{"id":"u-1"}}' ;;
        "POST /v2/users/human") body='{"userId":"u-1"}' ;;
        "POST /v2/users") body='{"result":[]}' ;;
        "POST /v2/sessions") body='{"sessionId":"s-1","sessionToken":"${SESSION_TOKEN}"}' ;;
        "POST /v2/oidc/auth_requests/"*) body='{"callbackUrl":"https://app.example.invalid/auth/callback?code=${AUTH_CODE}&state=s"}' ;;
        "POST /oauth/v2/token") body='{"id_token":"h.p.s"}' ;;
        "GET /.well-known/openid-configuration") body='{"issuer":"https://id.example.invalid"}' ;;
        *) body='{"result":[{"id":"a-1","name":"Ownpace Web"}]}' ;;
      esac ;;
    50[234]) body="$(cat "$D/page")" ;;
    *) body='{"code":5,"message":"an answer this test chose"}' ;;
  esac
  if [ "$head" = 1 ]; then
    printf 'HTTP/1.1 %s Whatever\\r\\n' "$code"
    if [ -n "$loc" ] && [ "$code" = 302 ]; then printf 'Location: %s\\r\\n' "$loc"; fi
    printf '\\r\\n'
  fi
  if [ "$s" = cut ]; then [ -z "$w" ] || printf '%b' "\${w//'%{http_code}'/$code}"; return 18; fi
  [ -n "$out" ] || printf '%s' "$body"
  [ -z "$w" ] || printf '%b' "\${w//'%{http_code}'/$code}"
}
`;

interface Asked {
  /** How the harness ended: the exit status of its last line. */
  rc: number;
  /** What the CALLER captured, written to a file by the call under test. */
  answer: string;
  stdout: string;
  stderr: string;
  /** One `<METHOD> <path>` per time curl was really called. */
  calls: string[];
  /** Every argument curl was given, one line per call. */
  argv: string[];
  slept: number[];
}

/**
 * Runs `call` after the REAL `read_retrying`, `is_read`, `idp_api`,
 * `sign_in_as` and `idp_sweep_leftovers`, under the script's own
 * `set -uo pipefail`, with `sleep` replaced so a test does not wait fourteen
 * seconds. `attempts: null` runs with IDP_READ_ATTEMPTS unset and the script's
 * own default line.
 */
function ask(answers: readonly string[], call: string, attempts: number | null = 4): Asked {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-blip-'));
  try {
    writeFileSync(join(dir, 'answers'), `${answers.join('\n')}\n`);
    writeFileSync(join(dir, 'page'), FRONT_PAGE);
    const script = [
      'set -uo pipefail',
      'D="$BLIP_DIR"',
      `sleep() { printf '%s\\n' "$1" >> "$D/slept"; }`,
      'fail_at() { echo "FAIL_AT ${1:-}"; }',
      attempts === null ? knob() : `IDP_READ_ATTEMPTS=${attempts}`,
      'STACK_ISSUER=https://id.example.invalid',
      'ISSUER=https://id.example.invalid',
      'IDP_RESOLVE=()',
      `IDP_PAT=${PAT}`,
      'IDP_SIGNIN_CLIENT=client-0123',
      'IDP_REDIRECT=https://app.example.invalid/auth/callback',
      'IDP_SMOKE_APP_NAME="Ownpace Smoke 1"',
      FAKE_CURL,
      lift('read_retrying'),
      lift('is_read'),
      lift('idp_api'),
      lift('sign_in_as'),
      lift('idp_sweep_leftovers'),
      call,
    ].join('\n');
    const env: NodeJS.ProcessEnv = { ...process.env, BLIP_DIR: dir };
    delete env.IDP_READ_ATTEMPTS;
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env });
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
      stdout: r.stdout,
      stderr: r.stderr,
      calls: read('calls').split('\n').filter(Boolean),
      argv: read('argv').split('\n').filter(Boolean),
      slept: read('slept').split('\n').filter(Boolean).map(Number),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `x="$(idp_api <method> <path> [body])"`, the way every call site captures it. */
const api = (method: string, path: string, body = ''): string =>
  `x="$(idp_api ${method} ${path}${body ? ` '${body}'` : ''})"\nrc=$?\nprintf '%s' "$x" > "$D/answer"\nexit "$rc"`;
const READ_ME = api('GET', '/auth/v1/users/me');
const ANSWER = '{"user":{"id":"u-1"}}';

/**
 * `sign_in_as` inside `$( )`, as the script calls it. Captured into a variable
 * rather than through the script's `read -r … <<<`, because `read` answers 0
 * for any line at all and would hide the function's own status.
 */
const SIGN_IN = [
  'x="$(sign_in_as smoke-verify-1@smoke.local Smoke-Person!42)"',
  'rc=$?',
  `printf '%s' "$x" > "$D/answer"`,
  'exit "$rc"',
].join('\n');

describe('a gateway error from the front is not the provider answering (#263, #264)', () => {
  it.each(['502', '503', '504'])('a GET answered %s and then 200 succeeds after one retry', (status) => {
    const r = ask([status, '200'], READ_ME);
    expect(r.rc).toBe(0);
    expect(r.calls).toEqual(['GET /auth/v1/users/me', 'GET /auth/v1/users/me']);
    expect(r.slept).toEqual([2]);
    // EXACTLY the provider's answer: nothing the retry said may reach the
    // caller's variable, which goes straight to jq.
    expect(r.answer).toBe(ANSWER);
    expect(r.stderr).toContain(
      `GET /auth/v1/users/me: the front answered HTTP ${status} without reaching the provider — attempt 1 of 4, retrying in 2s`,
    );
  });

  it('a dropped connection and then 200 works the same way', () => {
    const r = ask(['x35', '200'], READ_ME);
    expect(r.rc).toBe(0);
    expect(r.calls).toHaveLength(2);
    expect(r.answer).toBe(ANSWER);
    expect(r.stderr).toContain('GET /auth/v1/users/me: no answer at all (curl exited 35) — attempt 1 of 4, retrying in 2s');
  });

  it('a `_search` is a read as well', () => {
    const r = ask(['504', '200'], api('POST', '/management/v1/projects/P/apps/_search', '{"queries":[]}'));
    expect(r.rc).toBe(0);
    expect(r.calls).toEqual([
      'POST /management/v1/projects/P/apps/_search',
      'POST /management/v1/projects/P/apps/_search',
    ]);
  });

  it('backs off 2s, 4s, 8s and stops after IDP_READ_ATTEMPTS asks, with today\'s message', () => {
    const r = ask(['502'], READ_ME);
    expect(r.rc).toBe(1);
    expect(r.calls).toHaveLength(4);
    expect(r.slept).toEqual([2, 4, 8]);
    expect(r.answer).toBe('');
    // The message the last failure always printed, page and all: surviving a
    // blip must not make the gate quieter about a front that stays down.
    expect(r.stderr).toMatch(/the provider answered HTTP 502 to GET \/auth\/v1\/users\/me: <!DOCTYPE html>/);
    expect(r.stderr).toContain('attempt 3 of 4, retrying in 8s');
    expect(r.stderr).not.toContain('attempt 4 of 4');
  });

  it('a connection that never comes back fails with today\'s message, after the same budget', () => {
    const r = ask(['x7'], READ_ME);
    expect(r.rc).toBe(1);
    expect(r.calls).toHaveLength(4);
    expect(r.stderr).toContain('could not reach the provider at /auth/v1/users/me');
  });

  it('honours a different budget rather than a hard-coded four', () => {
    expect(ask(['503'], READ_ME, 2).calls).toHaveLength(2);
    expect(ask(['503'], READ_ME, 1).calls).toHaveLength(1);
  });

  it('asks four times when nobody set the knob', () => {
    expect(ask(['502'], READ_ME, null).calls).toHaveLength(4);
  });

  it('costs a healthy call nothing', () => {
    const r = ask(['200'], READ_ME);
    expect(r.calls).toHaveLength(1);
    expect(r.slept).toEqual([]);
    expect(r.stderr).toBe('');
  });
});

describe('the retry line is said on stderr, and says nothing it should not', () => {
  it('reaches stderr, never the captured answer', () => {
    const r = ask(['502', '502', '200'], READ_ME);
    expect(r.rc).toBe(0);
    expect(r.answer).toBe(ANSWER);
    expect(r.stdout).not.toMatch(/retrying/);
    expect(r.stderr.match(/retrying in/g)).toHaveLength(2);
  });

  it('never carries the body, the token or the credential', () => {
    const r = ask(['502', '503', '200'], READ_ME);
    expect(r.rc).toBe(0);
    for (const secret of ['Connection Error', 'NetBird', 'proxy', 'DOCTYPE', PAT, 'Bearer']) {
      expect(r.stderr, `the retry line printed ${secret}`).not.toContain(secret);
    }
  });

  it('names the path of an authorization request without its query', () => {
    // The query carries the client, the redirect and the PKCE challenge. The
    // line says which request was re-asked, and nothing it was asked with.
    const r = ask(['200', '502', '302', '200', '200', '200'], SIGN_IN);
    expect(r.rc).toBe(0);
    expect(r.stderr).toContain('GET /oauth/v2/authorize: the front answered HTTP 502 without reaching the provider — attempt 1 of 4');
    for (const secret of ['?', 'client_id', 'client-0123', 'code_challenge', 'redirect_uri', AUTH_CODE, SESSION_TOKEN, PAT]) {
      expect(r.stderr, `the retry line printed ${secret}`).not.toContain(secret);
    }
  });
});

describe('a status the provider gave is still not re-asked', () => {
  it.each(['400', '401', '403', '404', '500'])('a read answered %s is asked once and fails with its own message', (status) => {
    const r = ask([status, '200'], READ_ME);
    expect(r.calls).toHaveLength(1);
    expect(r.slept).toEqual([]);
    expect(r.rc).toBe(1);
    expect(r.stderr).toContain(`the provider answered HTTP ${status} to GET /auth/v1/users/me`);
    expect(r.stderr).not.toMatch(/retrying/);
  });
});

describe('a WRITE is sent exactly once, whatever answers', () => {
  const writes: Array<[string, string, string]> = [
    ['POST', '/v2/users/human', '{"username":"x"}'],
    ['POST', '/v2/users/new', '{"username":"x"}'],
    ['POST', '/v2/sessions', '{"checks":{}}'],
    ['POST', '/v2/oidc/auth_requests/V2_1', '{"session":{}}'],
    ['POST', '/management/v1/projects/P/apps/oidc', '{"name":"x"}'],
    ['PUT', '/admin/v1/members/u-1', '{"roles":[]}'],
    ['DELETE', '/v2/users/u-1', ''],
    ['POST', '/admin/v1/smtp/ID/_test', '{"receiverAddress":"x"}'],
  ];
  const answers = ['502', '503', '504', 'x56'];
  it.each(writes.flatMap(([m, p, b]) => answers.map((a) => [m, p, a, b] as const)))(
    '%s %s answered %s is never re-sent',
    (method, path, first, body) => {
      const r = ask([first, '200'], api(method, path, body));
      expect(r.calls, 'a write was sent again').toEqual([`${method} ${path}`]);
      expect(r.slept).toEqual([]);
      expect(r.rc).toBe(1);
      expect(r.stderr).not.toMatch(/retrying/);
    },
  );
});

describe('signing in re-asks the authorization request and nothing after it', () => {
  it('rides out a 502 on the authorization request and finalises the one the final answer started', () => {
    // users/human, authorize (502), authorize (302 → V2_3), sessions, callback, token.
    const r = ask(['200', '502', '302', '200', '200', '200'], SIGN_IN);
    expect(r.rc).toBe(0);
    expect(r.answer).toBe('u-1 h.p.s');
    expect(r.calls).toEqual([
      'POST /v2/users/human',
      'GET /oauth/v2/authorize',
      'GET /oauth/v2/authorize',
      'POST /v2/sessions',
      'POST /v2/oidc/auth_requests/V2_3',
      'POST /oauth/v2/token',
    ]);
  });

  it('takes the Location of the final answer, not of an ask the connection cut short', () => {
    // The second ask is the provider's 302 for V2_2, cut off before its end:
    // curl printed that head and exited 18. The request finalised must be the
    // one the THIRD, whole answer started.
    const r = ask(['200', 'cut', '302', '200', '200', '200'], SIGN_IN);
    expect(r.rc).toBe(0);
    expect(r.calls).toContain('POST /v2/oidc/auth_requests/V2_3');
    expect(r.calls).not.toContain('POST /v2/oidc/auth_requests/V2_2');
    expect(r.stderr).toContain('GET /oauth/v2/authorize: no answer at all (curl exited 18)');
  });

  it.each(['502', '503', '504', 'x56'])('the token exchange answered %s is sent once: the code is one-time', (first) => {
    const r = ask(['200', '302', '200', '200', first, '200'], SIGN_IN);
    expect(r.calls.filter((c) => c === 'POST /oauth/v2/token'), 'the authorization code was sent twice').toHaveLength(1);
    expect(r.argv.filter((a) => a.includes(`code=${AUTH_CODE}`))).toHaveLength(1);
    expect(r.slept).toEqual([]);
    expect(r.rc).not.toBe(0);
    expect(r.stderr).toContain('no ID token for smoke-verify-1@smoke.local');
    expect(r.stderr).not.toMatch(/retrying/);
  });

  it.each([
    ['creating the person', ['502', '200'], 'POST /v2/users/human'],
    ['proving the session', ['200', '302', '502', '200'], 'POST /v2/sessions'],
    ['finalising the auth request', ['200', '302', '200', '502', '200'], 'POST /v2/oidc/auth_requests/V2_2'],
  ] as const)('%s answered 502 is sent once and the sign-in stops', (_what, answers, write) => {
    const r = ask(answers, SIGN_IN);
    expect(r.calls.filter((c) => c === write)).toHaveLength(1);
    expect(r.calls.at(-1)).toBe(write);
    expect(r.slept).toEqual([]);
    expect(r.rc).not.toBe(0);
  });
});

/**
 * `idp_sweep_leftovers || fail_at`, as the managed section opens. Its listing is
 * Zitadel v2's ListUsers, a READ that travels as a bare `POST /v2/users`, and it
 * is the first question the section asks the issuer: asked once, one 502 from
 * the front there was a red gate before anything else had been tried.
 */
const SWEEP = 'idp_sweep_leftovers || fail_at';

describe('the sweep for leftover people, the first question the managed section asks', () => {
  it('a 502 on the listing and then the list: asked again, and the gate stays green', () => {
    const r = ask(['502', '200'], SWEEP);
    expect(r.calls).toEqual(['POST /v2/users', 'POST /v2/users']);
    expect(r.slept).toEqual([2]);
    expect(r.stdout).toContain('no leftover smoke people to sweep');
    expect(r.stdout).not.toContain('FAIL_AT');
    expect(r.stderr).toContain(
      'POST /v2/users: the front answered HTTP 502 without reaching the provider — attempt 1 of 4, retrying in 2s',
    );
  });

  it('a dropped connection on the listing is ridden out the same way', () => {
    const r = ask(['x56', '200'], SWEEP);
    expect(r.calls).toEqual(['POST /v2/users', 'POST /v2/users']);
    expect(r.stdout).toContain('no leftover smoke people to sweep');
    expect(r.stdout).not.toContain('FAIL_AT');
  });

  it('a front that stays down still fails the run, with today\'s message', () => {
    const r = ask(['503'], SWEEP);
    expect(r.calls).toHaveLength(4);
    expect(r.stderr).toContain('could not ask the provider for leftover smoke people');
    expect(r.stdout).toContain('FAIL_AT');
  });

  it('a status the provider gave is asked once', () => {
    const r = ask(['403', '200'], SWEEP);
    expect(r.calls).toEqual(['POST /v2/users']);
    expect(r.stdout).toContain('FAIL_AT');
  });

  it('the listing never carries the filter or the token onto the retry line', () => {
    const r = ask(['502', '200'], SWEEP);
    expect(r.stderr).toContain('POST /v2/users: the front answered HTTP 502');
    for (const secret of ['smoke.local', 'emailQuery', 'TEXT_QUERY_METHOD_ENDS_WITH', PAT, 'Bearer']) {
      expect(r.stderr, `the retry line printed ${secret}`).not.toContain(secret);
    }
  });
});

describe('the form that founds an organisation is asked again on no answer', () => {
  const orgForm = (): string => block('/ui/login/register/org"', '\n  fi\n');

  it('a 502 and then the 404 it should be: not served, and the gate stays green', () => {
    const r = ask(['502', '404'], orgForm());
    expect(r.calls).toEqual(['GET /ui/login/register/org', 'GET /ui/login/register/org']);
    expect(r.stdout).toContain('the form that founds an organisation is not served (404)');
    expect(r.stdout).not.toContain('FAIL_AT');
  });

  it('a front that stays down is still a failure, with today\'s message', () => {
    const r = ask(['502'], orgForm());
    expect(r.calls).toHaveLength(4);
    expect(r.stdout).toContain('the form that founds an organisation answered HTTP 502');
    expect(r.stdout).toContain('FAIL_AT');
  });

  it('a 200 is the provider answering, and is asked once', () => {
    const r = ask(['200', '404'], orgForm());
    expect(r.calls).toHaveLength(1);
    expect(r.stdout).toContain('FAIL_AT');
  });
});

describe('the discovery document a browser reads is asked again on no answer', () => {
  const discovery = (): string => block('HOST_DECLARED=', '\n    fi\n');

  it('a 503 and then the document: the issuer declares its own name', () => {
    const r = ask(['503', '200'], discovery());
    expect(r.calls).toEqual(['GET /.well-known/openid-configuration', 'GET /.well-known/openid-configuration']);
    expect(r.stdout).toContain('(declares its own name, as a browser sees it)');
    expect(r.stdout).not.toContain('FAIL_AT');
  });

  it('a connection that never comes back fails with today\'s message', () => {
    const r = ask(['x28'], discovery());
    expect(r.calls).toHaveLength(4);
    expect(r.stdout).toContain('the issuer serves no discovery document at https://id.example.invalid from outside the stack');
    expect(r.stdout).toContain('FAIL_AT');
  });

  it('a front that stays down fails with today\'s message and its page', () => {
    const r = ask(['502'], discovery());
    expect(r.calls).toHaveLength(4);
    expect(r.stdout).toContain('the issuer serves no discovery document');
    expect(r.stdout).toContain('Connection Error');
  });
});

/**
 * The login block, from the authorization request it starts to the line that
 * removes its cookie jar — run with the REAL curl against a server here.
 */
function loginBlock(): string {
  const from = source.indexOf('  login_verifier="$(openssl rand');
  expect(from, 'the login-page block is gone or was renamed').toBeGreaterThan(-1);
  const closer = '  rm -f "$login_jar"\n';
  const to = source.indexOf(closer, from);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to + closer.length);
}

type Turn = 'front502' | 'cut' | 'ok';
interface Seen {
  path: string;
  cookie: string;
  authRequestID: string;
}

/**
 * The provider's two pages, as far as the jar is concerned. The authorization
 * request starts request `k` and sets the cookie `ua=UA-k` it is bound to; the
 * login page renders a form only for the cookie its request is bound to, and
 * Zitadel's own error otherwise. A `front502` is the front's page and a cookie
 * of the front's own; a `cut` is the provider's 302, cookie set, cut short.
 */
async function signInPage(authorize: Turn[], login: Turn[]): Promise<{ out: string; err: string; seen: Seen[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-jar-'));
  const seen: Seen[] = [];
  let k = 0;
  const front = (res: ServerResponse): void => {
    res.writeHead(502, { 'Content-Type': 'text/html', 'Set-Cookie': 'nb_front=F; Path=/' });
    res.end(FRONT_PAGE);
  };
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    seen.push({
      path: u.pathname,
      cookie: req.headers.cookie ?? '',
      authRequestID: u.searchParams.get('authRequestID') ?? '',
    });
    if (u.pathname === '/oauth/v2/authorize') {
      const turn = authorize.shift() ?? 'ok';
      if (turn === 'front502') return front(res);
      k += 1;
      const head = { Location: `/ui/login/login?authRequestID=${k}`, 'Set-Cookie': `ua=UA-${k}; Path=/; HttpOnly` };
      if (turn === 'cut') {
        res.writeHead(302, { ...head, 'Content-Length': '100' });
        res.write('partial');
        setTimeout(() => req.socket.destroy(), 20);
        return;
      }
      res.writeHead(302, head);
      res.end();
      return;
    }
    if (u.pathname === '/ui/login/login') {
      const turn = login.shift() ?? 'ok';
      if (turn === 'front502') return front(res);
      const ua = /(?:^|;\s*)ua=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        ua === `UA-${u.searchParams.get('authRequestID')}`
          ? '<html><head><title>Login</title></head><body><form method="post"><input name="loginName"></form></body></html>'
          : '<html><head><title>Error</title></head><body><p>User Agent does not correspond (EVENT-adk13)</p></body></html>',
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const script = [
      'set -uo pipefail',
      'D="$BLIP_DIR"',
      `sleep() { printf '%s\\n' "$1" >> "$D/slept"; }`,
      'fail_at() { echo "FAIL_AT ${1:-}"; }',
      'IDP_READ_ATTEMPTS=4',
      `STACK_ISSUER=http://127.0.0.1:${port}`,
      'IDP_RESOLVE=()',
      'IDP_CLIENT_ID=client-human',
      `IDP_REDIRECT=http://127.0.0.1:${port}/auth/callback`,
      lift('read_retrying'),
      loginBlock(),
    ].join('\n');
    // `spawn`, NOT `spawnSync`: the server lives in THIS process, and a
    // synchronous child would block the event loop that has to answer it.
    // No proxy for a server on loopback, whatever the environment says.
    const env = { ...process.env, BLIP_DIR: dir, TMPDIR: dir, NO_PROXY: '*', no_proxy: '*' };
    return await new Promise((resolve) => {
      const child = spawn('bash', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'], env });
      let out = '';
      let err = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      child.on('close', () => resolve({ out, err, seen }));
    });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * THE COOKIE JAR, AND WHY RE-ASKING CANNOT CORRUPT IT. The authorization
 * request writes the jar with `-c` and reads none, so each ask starts from no
 * cookies and curl rewrites the whole jar from that ask's answer: the jar holds
 * the cookie of the final answer, the one its Location belongs to. The login
 * page reads and writes it (`-b`/`-c`): a 502 from the front never reached the
 * provider, so it can add only the front's own cookie and takes none away, and
 * asking for the page again is a reload — it consumes nothing one-time.
 */
describe('the login page a browser is sent to, re-asked with the real curl', () => {
  it('a 502 on the authorization request: the page is asked with the final answer\'s request and cookie', async () => {
    const r = await signInPage(['front502', 'ok'], ['ok']);
    expect(r.out).toContain('the login page a browser is sent to renders a form');
    expect(r.out).not.toContain('FAIL_AT');
    const page = r.seen.filter((s) => s.path === '/ui/login/login');
    expect(page).toHaveLength(1);
    expect(page[0]!.authRequestID).toBe('1');
    expect(page[0]!.cookie).toBe('ua=UA-1');
    expect(r.err).toContain('GET /oauth/v2/authorize: the front answered HTTP 502 without reaching the provider');
    for (const secret of ['UA-', 'nb_front', 'client-human', 'code_challenge', 'Connection Error']) {
      expect(r.err, `the retry line printed ${secret}`).not.toContain(secret);
    }
  });

  it('an ask the provider answered and the connection cut: the jar keeps only the final answer\'s cookie', async () => {
    // Request 1 was started and its cookie set before the drop. Re-asked, the
    // jar must not carry UA-1 into request 2's page, or the provider answers
    // EVENT-adk13 and the gate blames the login page.
    const r = await signInPage(['cut', 'ok'], ['ok']);
    expect(r.out).toContain('the login page a browser is sent to renders a form');
    expect(r.out).not.toContain('FAIL_AT');
    const page = r.seen.filter((s) => s.path === '/ui/login/login');
    expect(page.map((s) => [s.authRequestID, s.cookie])).toEqual([['2', 'ua=UA-2']]);
    expect(r.err).toContain('GET /oauth/v2/authorize: no answer at all (curl exited 18)');
  });

  it('a 502 on the login page itself: asked again with the same cookie, and the form renders', async () => {
    const r = await signInPage(['ok'], ['front502', 'ok']);
    expect(r.out).toContain('the login page a browser is sent to renders a form');
    expect(r.out).not.toContain('FAIL_AT');
    const page = r.seen.filter((s) => s.path === '/ui/login/login');
    expect(page).toHaveLength(2);
    expect(page.every((s) => s.authRequestID === '1' && /(?:^|; )ua=UA-1(?:;|$)/.test(s.cookie))).toBe(true);
    expect(r.err).toContain('GET /ui/login/login: the front answered HTTP 502 without reaching the provider');
    expect(r.err).not.toContain('authRequestID');
  });

  it('only one authorization request is started on a good day', async () => {
    const r = await signInPage(['ok'], ['ok']);
    expect(r.seen.filter((s) => s.path === '/oauth/v2/authorize')).toHaveLength(1);
    expect(r.err).toBe('');
  });
});

/** `is_read`, lifted and run: which calls are re-asked is a behaviour. */
function readable(pairs: ReadonlyArray<readonly [string, string]>): boolean[] {
  const checks = pairs.map(([m, p]) => `if is_read ${m} '${p}'; then echo yes; else echo no; fi`).join('\n');
  const out = execFileSync('bash', ['-c', `set -uo pipefail\n${lift('is_read')}\n${checks}\n`], {
    encoding: 'utf8',
  }).trim();
  return out.split('\n').map((l) => l === 'yes');
}

describe('the boundary the retry must not cross', () => {
  it('reads are GET, HEAD, a POST on `_search` and Zitadel v2\'s ListUsers', () => {
    expect(
      readable([
        ['GET', '/auth/v1/users/me'],
        ['HEAD', '/debug/healthz'],
        ['POST', '/management/v1/projects/P/apps/_search'],
        ['POST', '/admin/v1/idps/templates/_search'],
        ['POST', '/v2/users'],
      ]),
    ).toEqual([true, true, true, true, true]);
  });

  it('ListUsers is matched as the WHOLE path: what lives under it creates people', () => {
    // `POST /v2/users/human` is AddHumanUser and `/v2/users/new` is CreateUser
    // — Zitadel named it `/new` only because ListUsers already holds the bare
    // path. A prefix match would re-send both.
    expect(
      readable([
        ['POST', '/v2/users/human'],
        ['POST', '/v2/users/new'],
        ['POST', '/v2/users/'],
        ['POST', '/v2/users/u-1/password'],
        ['POST', '/v2/usersX'],
        ['PUT', '/v2/users'],
        ['DELETE', '/v2/users'],
      ]),
    ).toEqual([false, false, false, false, false, false, false]);
  });

  it('everything else is a write, underscore or not', () => {
    // `_test` SENDS MAIL and `_activate` turns a provider on: a suffix match on
    // `_search`, not on `_`.
    expect(
      readable([
        ['POST', '/v2/users/human'],
        ['POST', '/v2/sessions'],
        ['POST', '/v2/oidc/auth_requests/V2_1'],
        ['POST', '/admin/v1/smtp/ID/_test'],
        ['POST', '/admin/v1/email/ID/_activate'],
        ['PUT', '/admin/v1/members/u-1'],
        ['DELETE', '/v2/users/u-1'],
      ]),
    ).toEqual([false, false, false, false, false, false, false]);
  });

  it('classifies every call the script makes through idp_api', () => {
    // The guard that outlives this change: walk the REAL call sites, so a write
    // added later under a re-asked shape fails here rather than in a gate run.
    const sites = [...code.matchAll(/\bidp_api\s+(GET|HEAD|POST|PUT|DELETE|PATCH)\s+"?([^"\s)]+)/g)].map(
      (m) => [m[1]!, m[2]!] as const,
    );
    expect(sites.length, 'no `idp_api <verb> <path>` call sites found — renamed?').toBeGreaterThan(10);
    const verdicts = readable(sites);
    const wrong = sites
      .map((site, i) => ({ site, retried: verdicts[i]! }))
      .filter(
        ({ site: [m, p], retried }) =>
          retried !== (m === 'GET' || m === 'HEAD' || (m === 'POST' && (p.endsWith('/_search') || p === '/v2/users'))),
      );
    expect(wrong, `misclassified: ${JSON.stringify(wrong)}`).toEqual([]);
    // The sweep's listing is among them, and is asked again: it is the first
    // question the managed section asks.
    expect(sites).toContainEqual(['POST', '/v2/users']);
    expect(sites).toContainEqual(['POST', '/v2/users/human']);
  });

  it('idp_api asks is_read, and sends what is not a read once', () => {
    const fn = lift('idp_api')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(fn).toMatch(/if is_read "\$1" "\$2"; then\s*\n\s*read_retrying curl "\$\{args\[@\]\}"/);
  });

  it('every issuer request outside idp_api is asked through read_retrying, but the token exchange', () => {
    // A new GET of the issuer added later as a bare curl would be one blip from
    // a red gate again, so this walks every curl that names the issuer.
    const lines = code.split('\n');
    const sites = lines
      .map((l, i) => ({ l, next: lines[i + 1] ?? '' }))
      .filter(({ l }) => /curl -sS "\$\{IDP_RESOLVE\[@\]\}"/.test(l));
    expect(sites.length, 'no issuer curls found — renamed?').toBeGreaterThanOrEqual(6);
    const single = sites.filter(({ l }) => !/\bread_retrying curl -sS/.test(l));
    expect(single.map(({ l }) => l.trim()), 'only the token exchange is asked once').toHaveLength(1);
    expect(single[0]!.l).toMatch(/-X POST "\$\{STACK_ISSUER%\/\}\/oauth\/v2\/token"/);
    expect(single[0]!.l).toMatch(/^\s*tok="\$\(curl /);
  });

  it('keeps each request\'s own time limit', () => {
    const asked = code.split('\n').filter((l) => /\bread_retrying curl -sS "\$\{IDP_RESOLVE\[@\]\}"/.test(l));
    expect(asked.length).toBeGreaterThanOrEqual(5);
    for (const l of asked) expect(l, `lost its -m 15: ${l.trim()}`).toMatch(/ -m 15 /);
  });

  it('re-asks no status but the three a front sends when it got no answer', () => {
    const helper = lift('read_retrying')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    const arms = [...helper.matchAll(/^\s*([0-9|]+)\)/gm)].map((m) => m[1]);
    expect(arms, 'the statuses read_retrying re-asks').toEqual(['502|503|504']);
  });

  it('turns the same knob as setup-zitadel.sh, so one setting covers both', () => {
    expect(knob()).toBe('IDP_READ_ATTEMPTS="${IDP_READ_ATTEMPTS:-4}"');
    expect(readFileSync(SETUP, 'utf8')).toMatch(/^IDP_READ_ATTEMPTS="\$\{IDP_READ_ATTEMPTS:-4\}"$/m);
  });
});

/**
 * THE GRANT LINK'S REGISTRATION PAGE (workplan 0095 T6), run as the login
 * block above is: the REAL block, with the real curl, against a server here
 * that plays the provider. The authorization request with `prompt=create`
 * starts request `k`, sets the cookie `ua=UA-k` it is bound to and sends the
 * browser on, or sends it nowhere; the page it points to is one of the
 * provider's, served only for that cookie (Zitadel's own error otherwise).
 * `idp_api` answers the login policy from a file, or nothing.
 */
function registrationBlock(): string {
  const from = source.indexOf("  reg_hint='smoke-register@example.test'");
  expect(from, 'the registration block is gone or was renamed').toBeGreaterThan(-1);
  const closer = '  rm -f "$reg_jar"\n';
  const to = source.indexOf(closer, from);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to + closer.length);
}

const FILLED =
  '<html><body><form><input class="lgn-input" type="email" id="email" name="email" autocomplete="email" value="smoke-register@example.test" required></form></body></html>';
const EMPTY_FIELD =
  '<html><body><form><input class="lgn-input" type="email" id="email" name="email" autocomplete="email" value="" required></form></body></html>';
const OPTION_PAGE =
  '<html><body><form><button class="lgn-raised-button lgn-primary" name="usernamepassword" value="true" formnovalidate>Register</button></form></body></html>';
const LOGIN_FORM = '<html><body><form method="post"><input name="loginName"></form></body></html>';
const WITH_GOOGLE = JSON.stringify({ policy: { allowExternalIdp: true, idps: [{ idpId: 'g' }] } });
const WITHOUT = JSON.stringify({ policy: { allowExternalIdp: false, idps: [] } });

async function registrationPage(
  page: string | null,
  policy: string | null,
): Promise<{ out: string; err: string; seen: Seen[]; asked: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-reg-'));
  const seen: Seen[] = [];
  const asked: string[] = [];
  let k = 0;
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    seen.push({ path: u.pathname, cookie: req.headers.cookie ?? '', authRequestID: u.searchParams.get('authRequestID') ?? '' });
    if (u.pathname === '/oauth/v2/authorize') {
      asked.push(u.search);
      k += 1;
      // `page === null`: the provider answers, and sends the browser nowhere.
      res.writeHead(
        page === null ? 200 : 302,
        page === null ? {} : { Location: `/ui/login/login?authRequestID=${k}`, 'Set-Cookie': `ua=UA-${k}; Path=/; HttpOnly` },
      );
      res.end();
      return;
    }
    if (u.pathname === '/ui/login/login') {
      const ua = /(?:^|;\s*)ua=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        ua === `UA-${u.searchParams.get('authRequestID')}`
          ? (page ?? '')
          : '<html><body><p>User Agent does not correspond (EVENT-adk13)</p></body></html>',
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    if (policy !== null) writeFileSync(join(dir, 'policy.json'), policy);
    const script = [
      'set -uo pipefail',
      'D="$BLIP_DIR"',
      `sleep() { printf '%s\\n' "$1" >> "$D/slept"; }`,
      'fail_at() { echo "FAIL_AT ${1:-}"; }',
      // The management API as the gate calls it: the policy, or nothing and a
      // failure, which is what `idp_api` gives for any answer but a 2xx.
      'idp_api() { [ -f "$D/policy.json" ] && cat "$D/policy.json"; }',
      'IDP_READ_ATTEMPTS=4',
      `STACK_ISSUER=http://127.0.0.1:${port}`,
      'IDP_RESOLVE=()',
      'IDP_CLIENT_ID=client-human',
      `IDP_REDIRECT=http://127.0.0.1:${port}/auth/callback`,
      lift('read_retrying'),
      registrationBlock(),
      'echo BLOCK_END',
    ].join('\n');
    const env = { ...process.env, BLIP_DIR: dir, TMPDIR: dir, NO_PROXY: '*', no_proxy: '*' };
    return await new Promise((resolve) => {
      const child = spawn('bash', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'], env });
      let out = '';
      let err = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      child.on('close', () => resolve({ out, err, seen, asked }));
    });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the page the grant link opens, run with the real curl (0095 T6)', () => {
  const failures = (out: string): number => (out.match(/^FAIL_AT/gm) ?? []).length;

  it('asks once, with the three parameters the button sends, and reads the page with that request\'s cookie', async () => {
    const r = await registrationPage(FILLED, WITHOUT);
    expect(r.asked).toHaveLength(1);
    const q = new URLSearchParams(r.asked[0]);
    expect(q.get('prompt')).toBe('create');
    expect(q.get('login_hint')).toBe('smoke-register@example.test');
    expect(q.get('ui_locales')).toBe('en');
    const page = r.seen.filter((s) => s.path === '/ui/login/login');
    expect(page).toHaveLength(1);
    expect(page[0]!.cookie).toBe('ua=UA-1');
    expect(r.out).toContain("the grant link's registration page has the address filled in\n");
    expect(failures(r.out)).toBe(0);
    expect(r.out).toContain('BLOCK_END');
  });

  it('the form with the address in it, where the policy offers outside providers too: passes, and says so', async () => {
    const r = await registrationPage(FILLED, WITH_GOOGLE);
    expect(r.out).toContain('although the policy offers outside providers');
    expect(failures(r.out)).toBe(0);
  });

  it('the "how do you want to register" page, with outside providers on the policy: passes (OTA, E2E)', async () => {
    const r = await registrationPage(OPTION_PAGE, WITH_GOOGLE);
    expect(r.out).toContain('the provider asks how to register first, as it does with outside providers on the policy');
    expect(failures(r.out)).toBe(0);
  });

  it('that page, with none on the policy: FAILS, since a person granted access would meet an empty field', async () => {
    const r = await registrationPage(OPTION_PAGE, WITHOUT);
    expect(r.out).toContain('but the policy offers no outside provider');
    expect(failures(r.out)).toBe(1);
    expect(r.out).toContain('BLOCK_END');
  });

  it('that page, with a policy that cannot be read: passes, and says the policy was not checked', async () => {
    const r = await registrationPage(OPTION_PAGE, null);
    expect(r.out).toContain('the login policy could not be read, so whether outside providers are on it is unchecked');
    expect(failures(r.out)).toBe(0);
  });

  it('the registration form without the address: FAILS', async () => {
    const r = await registrationPage(EMPTY_FIELD, WITHOUT);
    expect(r.out).toContain('the grant link opens the registration form, but without the address in it.');
    expect(failures(r.out)).toBe(1);
  });

  it('the sign-in form instead of registration: FAILS, with the page\'s text', async () => {
    const r = await registrationPage(LOGIN_FORM, WITHOUT);
    expect(r.out).toContain('the grant link does not open registration');
    expect(failures(r.out)).toBe(1);
  });

  it('no Location: FAILS once and carries on to the next section, with no unbound variable', async () => {
    const r = await registrationPage(null, WITHOUT);
    expect(r.out).toContain('the provider sent a registration request nowhere');
    expect(failures(r.out)).toBe(1);
    expect(r.out).toContain('BLOCK_END');
    expect(r.err).not.toContain('unbound variable');
    expect(r.seen.filter((s) => s.path === '/ui/login/login')).toEqual([]);
  });
});
