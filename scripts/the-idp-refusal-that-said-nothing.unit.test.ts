// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REFUSAL THAT NAMES NOTHING IS A RUN SOMEBODY HAS TO REPEAT TO LEARN ANYTHING.
 *
 * E2E (managed) #49 got further than any run before it. The bring-up's poll
 * said `identity provider is ready after 5s`; `setup-zitadel.sh` cleared its
 * own wait and said `ready`. Then:
 *
 *   [setup-zitadel] looking for an existing 'Ownpace' project
 *   [setup-zitadel] creating it
 *   [setup-zitadel] FATAL: could not create the project
 *
 * Seven words, and every one of them already known. At least three different
 * failures arrive at that line — a token the instance will not accept, a
 * machine user without the grant, something other than the provider answering
 * on the issuer — and the provider had said which, in a response body that was
 * piped into `jq -r '.id'` and thrown away.
 *
 * The SEARCH above it was worse, because it could not fail at all:
 *
 *   api POST /management/v1/projects/_search … | jq -r '.result[]? | …'
 *
 * `.result[]?` turns an error body into no output, which is byte-identical to
 * "no such project". A refused search therefore reports that no project exists,
 * and the script proceeds to create one — an error swallowed into an empty
 * result, which is exactly hard rule 9.
 *
 * THE WORKAROUND FOR THIS ALREADY EXISTED, IN ONE PLACE. `read_allow_register`
 * reads its setting back rather than trusting the call, and the note above it
 * says why in as many words: "`api` runs `curl -sS` without `-f`, so an HTTP
 * 404 or 400 still exits 0." The callee was left as it was and one caller
 * defended itself. That is the same shape as #519, where a SIGPIPE lesson was
 * written into the function it bit and eighteen other instances survived.
 *
 * These tests run the real script with `curl` and `docker` stubbed on PATH, in
 * a COPY of deploy/compose so nothing here can write to the repository's .env.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SETUP_SRC = join(REPO, 'deploy/compose');

let dir: string;
let composeDir: string;
let binDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'idp-refusal-'));
  composeDir = join(dir, 'compose');
  binDir = join(dir, 'bin');
  cpSync(SETUP_SRC, composeDir, { recursive: true });
  // A filled .env, so `ensure-env-secrets.sh` has nothing to generate and the
  // script reaches the API calls this file is about.
  writeFileSync(
    join(composeDir, '.env'),
    [
      'POSTGRES_USER=openmigrate',
      'POSTGRES_PASSWORD=x',
      'POSTGRES_DB=openmigrate',
      'ZITADEL_PORT=3126',
      'ZITADEL_ADMIN_PASSWORD=Aa1!aaaaaaaa',
      'ZITADEL_MASTERKEY=0123456789abcdef0123456789abcdef',
      'ZITADEL_DB_PASSWORD=x',
      '',
    ].join('\n'),
  );
  writeFileSync(join(binDir + '.keep'), '');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Stub `curl` and `docker`. `curl` answers `/debug/ready` with 200 so the wait
 * clears, and answers every API path with the status and body given here —
 * honouring `-w '\n%{http_code}'`, which is how the script learns the status.
 */
function stubs(
  apiStatus: string,
  apiBody: string,
  opts: { pat?: string; readExit?: number } = {},
): NodeJS.ProcessEnv {
  mkdirSync(binDir, { recursive: true });

  // MODELS `-w`, because real curl prints a status only when asked for one.
  // The first version of this stub appended the status unconditionally, so
  // deleting `-w '\n%{http_code}'` from the script changed nothing here and the
  // break that removed it passed — a stub that is more helpful than the tool it
  // stands in for cannot catch the script forgetting to ask.
  writeFileSync(
    join(binDir, 'curl'),
    [
      '#!/usr/bin/env bash',
      'url=""; wfmt=""; prev=""',
      'for a in "$@"; do',
      '  case "$prev" in -w) wfmt="$a" ;; esac',
      '  case "$a" in http*) url="$a" ;; esac',
      '  prev="$a"',
      'done',
      'case "$url" in',
      // The readiness poll: `-o /dev/null -w '%{http_code}'` — status only.
      `  */debug/ready) [ -n "$wfmt" ] && printf '200'; exit 0 ;;`,
      'esac',
      '# Everything else is the management API.',
      `printf '%s' ${JSON.stringify(apiBody)}`,
      `case "$wfmt" in`,
      `  *'%{http_code}'*) printf '\\n%s' ${JSON.stringify(apiStatus)} ;;`,
      'esac',
      'exit 0',
    ].join('\n'),
  );
  chmodSync(join(binDir, 'curl'), 0o755);

  writeFileSync(
    join(binDir, 'docker'),
    [
      '#!/usr/bin/env bash',
      '# Reading /machinekey/pat.txt is the only call whose output the script',
      '# reads; everything else just has to succeed.',
      'for a in "$@"; do',
      '  if [ "$a" = "/machinekey/pat.txt" ]; then',
      // MODELS THE IMAGE, NOT JUST THE CALL. `exec … zitadel cat` cannot work:
      // that image has no shell and no coreutils, so Docker answers on STDOUT
      // with exit 127. `run … zitadel-machinekey cat` uses busybox and works.
      //
      // The first version of this stub answered the same way for both, so
      // reverting the fix to the broken call changed nothing here and the break
      // passed — the third time tonight a stub was more capable than the tool
      // it stands in for.
      '    case " $* " in',
      '      *" exec "*" zitadel "*)',
      `        printf '%s\\n' 'OCI runtime exec failed: exec failed: unable to start container process: exec: cat: executable file not found in $PATH'`,
      '        exit 127 ;;',
      '    esac',
      // MODELS A FAILED READ THE WAY DOCKER REPORTS ONE: message on STDOUT,
      // non-zero exit. A stub that wrote it to stderr could not catch #49–#51.
      `    printf '%s\\n' ${JSON.stringify(opts.pat ?? 'a-token-that-looks-fine')}`,
      `    exit ${opts.readExit ?? 0}`,
      '  fi',
      'done',
      'exit 0',
    ].join('\n'),
  );
  chmodSync(join(binDir, 'docker'), 0o755);

  return { PATH: `${binDir}:${process.env.PATH ?? ''}` };
}

function run(env: NodeJS.ProcessEnv): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(join(composeDir, 'setup-zitadel.sh'), [], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd: dir,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ---------------------------------------------------------------------------
describe('what the identity provider said, when it refused', () => {
  it('names a token this instance will not accept, and where the remedy is', () => {
    const body = '{"code":16,"message":"auth header missing"}';
    const r = run(stubs('401', body));

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('401');
    // The provider's own words, not a paraphrase.
    expect(r.stderr).toContain('auth header missing');
    // Named as a credential problem, with the scenario this repo actually hit:
    // the database cleared while the machinekey volume was kept.
    expect(r.stderr).toMatch(/token was NOT accepted/);
    // Names the scenarios without claiming either is the only one — the
    // earlier wording asserted a single cause for a code that has several, and
    // cost two clear-downs of a database that was never at fault. Since the
    // rotation change the refusal names both known causes side by side, and
    // still sends the reader to the provider's own log to pick.
    expect(r.stderr).toMatch(/machinekey VOLUME/);
    expect(r.stderr).toMatch(/Two causes/);
    expect(r.stderr).toContain('IT EXPIRED');
    expect(r.stderr).toContain('IT BELONGS TO AN INSTANCE THAT NO LONGER EXISTS');
    expect(r.stderr).toMatch(/logs zitadel/);
    expect(r.stderr).toContain('REPROVISIONING');
  });

  it('tells a missing GRANT apart from a bad credential', () => {
    // 401 and 403 have entirely different remedies — mint a token vs. give the
    // machine user a role — and collapsing them sends somebody to the wrong one.
    const r = run(stubs('403', '{"code":7,"message":"No matching permissions found"}'));

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('403');
    expect(r.stderr).toContain('No matching permissions found');
    expect(r.stderr).toMatch(/is not allowed to do this/);
    expect(r.stderr).toContain('ownpace-setup');
    expect(r.stderr).toMatch(/ui\/console/);
    // NOT the credential story.
    expect(r.stderr).not.toMatch(/token was NOT accepted/);
  });

  it('prints the status and the body for anything else that goes wrong', () => {
    const r = run(stubs('500', '{"code":13,"message":"database is starting up"}'));

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('500');
    expect(r.stderr).toContain('database is starting up');
  });

  it('refuses a 200 that is not JSON, rather than reading it as "not found"', () => {
    // A proxy in front of the provider answering its own error page with 200 is
    // indistinguishable from a real answer once `jq` has turned it into `null`.
    const r = run(stubs('200', '<html><body>502 Bad Gateway</body></html>'));

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not JSON/);
    expect(r.stderr).toContain('502 Bad Gateway');
  });

  /**
   * WHAT E2E (managed) #49, #50 AND #51 ACTUALLY DIED OF.
   *
   * The read was `compose exec -T zitadel cat /machinekey/pat.txt`, and the
   * Zitadel image has no `cat` — no shell, no coreutils. Docker reports that on
   * STDOUT and exits 127:
   *
   *   OCI runtime exec failed: … exec: "cat": executable file not found in $PATH
   *
   * `2>/dev/null` silenced the wrong stream, `|| true` swallowed the 127, and
   * `[ -n "$PAT" ]` was satisfied by the error message — which was then sent to
   * the provider as a Bearer token. Zitadel named it precisely: `illegal base64
   * data at input byte 3`, byte 3 being the space after `OCI`.
   *
   * Two full clear-downs of a database and a volume that were never at fault
   * were spent on it, because the refusal confidently blamed a stale token.
   */
  const OCI_FAILURE =
    'OCI runtime exec failed: exec failed: unable to start container process: ' +
    'exec: "cat": executable file not found in $PATH';

  it('refuses when READING the token fails, instead of using the error as one', () => {
    const r = run(stubs('200', '{"result":[]}', { pat: OCI_FAILURE, readExit: 127 }));

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/could not read \/machinekey\/pat\.txt/);
    expect(r.stderr).toContain('127');
    // The operator sees what came back, not a story about what it might mean.
    expect(r.stderr).toContain('executable file not found');
    // And it must NOT be the stale-token narrative, which sent somebody
    // clearing a database twice for a machine that was fine.
    expect(r.stderr).not.toMatch(/REPROVISIONING/);
  });

  it('refuses an error message that arrives with exit 0, because it has spaces', () => {
    // The nastier half: a read that "succeeds" and returns prose. Exit status
    // alone cannot catch this, so the shape of a token is checked too.
    const r = run(stubs('200', '{"result":[]}', { pat: OCI_FAILURE, readExit: 0 }));

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/is not a token/);
    expect(r.stderr).toMatch(/contains whitespace/);
    expect(r.stderr).toContain('OCI runtime exec failed');
  });

  it('refuses something too short to be a token', () => {
    const r = run(stubs('200', '{"result":[]}', { pat: 'nope' }));

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/too short to be one/);
  });

  it('still refuses when the token file is empty, before asking anything', () => {
    const r = run(stubs('200', '{"result":[]}', { pat: '' }));

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no provisioning token/);
  });
});

// ---------------------------------------------------------------------------
describe('the script itself', () => {
  const SETUP = readFileSync(join(SETUP_SRC, 'setup-zitadel.sh'), 'utf8');
  /** The file with every comment removed — three assertions today matched prose. */
  const CODE = SETUP.split('\n')
    .map((l) => (/^\s*#/.test(l) ? '' : l))
    .join('\n');

  it('checks the token is accepted before it is used for anything', () => {
    // The old check proved a FILE existed. A token for an instance that was
    // dropped is a perfectly non-empty file.
    expect(CODE).toContain('api GET /auth/v1/users/me');
    const check = CODE.indexOf('api GET /auth/v1/users/me');
    const firstProjectCall = CODE.indexOf('/management/v1/projects');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(firstProjectCall);
  });

  /** The body of `api()` alone — the readiness poll also uses `-w`. */
  const API_FN = (() => {
    const from = CODE.indexOf('api() {');
    expect(from, 'api() not found').toBeGreaterThan(-1);
    const to = CODE.indexOf('\n}', from);
    return CODE.slice(from, to);
  })();

  it('asks curl for the status code, since curl -sS alone reports none', () => {
    // SCOPED TO `api`. Asserting `%{http_code}` against the whole file passed
    // with the flag deleted from `api`, because #518's readiness poll three
    // lines above uses `-w '%{http_code}'` too — the seventh time today an
    // assertion matched something ADJACENT to what it meant to check.
    expect(API_FN).toContain('%{http_code}');
  });

  it('declares `out` before assigning it, so the exit status survives', () => {
    // `local out="$(curl …)"` makes the status `local`'s, which is always 0.
    expect(CODE).not.toMatch(/local\s+out=\s*"\$\(curl/);
  });

  it('keeps a non-fatal path for the one pair of calls that expects a refusal', () => {
    // The login policy is written with PUT and POST because exactly one of them
    // is right for the org's state — so one is EXPECTED to fail. `|| true` does
    // not catch an `exit`, so a strict `api` alone would kill the script here.
    expect(CODE).toContain('api_try PUT /management/v1/policies/login');
    expect(CODE).toContain('api_try POST /management/v1/policies/login');
    // …and api_try must run `api` in a SUBSHELL, or its `die` takes the script.
    expect(CODE).toMatch(/api_try\(\)\s*\{\s*\(\s*api\s+"\$@"\s*\)/);
  });

  it('reads the setting back with the strict caller, and probes with the lenient one', () => {
    // The probe runs before anything is written and must survive an org with no
    // policy of its own; the read-back that DECIDES must not swallow a failure.
    const block = CODE.slice(CODE.indexOf('probe_allow_register'));
    expect(block).toMatch(/probe_allow_register\(\)[^\n]*\|\|\s*true/);
    expect(block).toMatch(/read_allow_register\(\)[^\n]*api GET/);
    expect(block).not.toMatch(/read_allow_register\(\)[^\n]*\|\|\s*true/);
  });

  it('does not read an API answer through a pipeline whose status pipefail decides', () => {
    // `x="$(api … | jq … )"` aborts only because `pipefail` is set 300 lines
    // above. Reading into a variable first makes the abort the assignment's.
    //
    // BOUNDED TO THE COMMAND, not to the line and not to the rest of the file.
    // The first draft used `[^)]*`, which matches newlines, so it wandered on
    // until it found some `| jq` elsewhere — and a line-bounded `[^)\n]*`
    // would have missed the real one, which wraps with a backslash:
    //
    //   CLIENT_ID="$(api GET "…/apps/${APP_ID}" \
    //     | jq -r '.app.oidcConfig.clientId')"
    //
    // So: same line, or exactly one backslash continuation.
    expect(CODE).not.toMatch(/=\s*"\$\(api\s+\w+[^\n]*(\\\n[^\n]*)?\|\s*jq/);
  });
});
