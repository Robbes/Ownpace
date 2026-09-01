// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The three scripts a managed bring-up cannot get wrong, tested.
 *
 * `bootstrap-managed.sh` itself is not tested here and cannot usefully be:
 * every one of its phases is a `docker compose` call, and a test that stubbed
 * Docker would be testing the stub. What IS tested is the part of the bring-up
 * that decides what ends up written into `deploy/compose/.env` — because that
 * file is sourced by every other script and by compose itself, and a wrong
 * value in it does not fail at bring-up. It fails hours later, as an enqueue
 * that never became a runner, or as an authentication error that points at a
 * password when the problem was a role.
 *
 *   env-upsert.sh           writes the file
 *   trigger-credentials.sh  decides WHAT to write for the two values a human
 *                           would otherwise transcribe by eye
 *   trigger-magic-link.sh   finds the one-time link that makes the human step
 *                           possible at all
 *
 * The Trigger.dev schema `trigger-credentials.sh` reads belongs to Trigger.dev
 * and can change under a version bump, so the tests below lean hard on the
 * refusals: what matters is not that the happy path works today, it is that a
 * changed schema, an extra project or a value of the wrong shape produces
 * "refused, here is the dashboard page" rather than a plausible wrong answer.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  existsSync,
  cpSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPSERT = join(REPO_ROOT, 'deploy/compose/env-upsert.sh');
const CREDENTIALS = join(REPO_ROOT, 'deploy/compose/trigger-credentials.sh');
const MAGIC_LINK = join(REPO_ROOT, 'deploy/compose/trigger-magic-link.sh');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bootstrap-managed-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Run a script, capturing both streams and the status instead of throwing. */
function run(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(script, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd: dir,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ---------------------------------------------------------------------------
describe('env-upsert.sh', () => {
  let envFile: string;

  beforeEach(() => {
    envFile = join(dir, '.env');
    writeFileSync(
      envFile,
      [
        '# ---- Postgres ----',
        'POSTGRES_USER=openmigrate',
        'POSTGRES_PASSWORD=change-me-openmigrate',
        '',
        '# ---- Trigger ----',
        'TRIGGER_PROJECT_REF=',
        'TRIGGER_SECRET_KEY=',
        '',
      ].join('\n'),
    );
  });

  const read = () => readFileSync(envFile, 'utf8');

  it('replaces a key where it already sits, so the comment above it still applies', () => {
    const r = run(UPSERT, [envFile, 'TRIGGER_PROJECT_REF=proj_abc']);
    expect(r.status).toBe(0);

    const lines = read().split('\n');
    // Under the Trigger header, not appended at the bottom under Postgres's.
    expect(lines.indexOf('TRIGGER_PROJECT_REF=proj_abc')).toBe(
      lines.indexOf('# ---- Trigger ----') + 1,
    );
  });

  it('appends a key that was not there at all', () => {
    run(UPSERT, [envFile, 'DEPLOY_IMAGE_PLATFORM=linux/arm64']);
    expect(read()).toContain('DEPLOY_IMAGE_PLATFORM=linux/arm64');
  });

  it('collapses duplicates, so the value a reader sees is the value in force', () => {
    // The state `echo >> .env` leaves behind: two lines, the second winning.
    writeFileSync(envFile, 'API_PORT=3001\n# note\nAPI_PORT=9999\n');
    run(UPSERT, [envFile, 'API_PORT=3002']);

    const occurrences = read().split('\n').filter((l) => l.startsWith('API_PORT='));
    expect(occurrences).toEqual(['API_PORT=3002']);
  });

  it('--if-absent leaves an operator’s own value alone but fills an empty one', () => {
    run(UPSERT, ['--if-absent', envFile, 'POSTGRES_USER=somebody-else', 'TRIGGER_SECRET_KEY=tr_prod_x']);

    expect(read()).toContain('POSTGRES_USER=openmigrate');
    // `KEY=` is an ABSENT value, not a set one — that is what copying
    // managed.env.example leaves behind, and it must be fillable.
    expect(read()).toContain('TRIGGER_SECRET_KEY=tr_prod_x');
  });

  it('refuses a value the shell would re-interpret, and writes nothing at all', () => {
    const before = read();
    const r = run(UPSERT, [envFile, 'POSTGRES_PASSWORD=has$dollar', 'API_PORT=3002']);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('POSTGRES_PASSWORD');
    // Not "refused the bad one and wrote the good one" — the whole call is off.
    expect(read()).toBe(before);
  });

  it.each([
    ['whitespace', 'K=two words'],
    ['a double quote', 'K=say"what'],
    ['a single quote', "K=don't"],
    ['a backtick', 'K=`id`'],
    ['a backslash', 'K=back\\slash'],
  ])('refuses %s', (_label, pair) => {
    expect(run(UPSERT, [envFile, pair]).status).toBe(1);
  });

  it('refuses something that is not a KEY=VALUE pair, and a bad variable name', () => {
    expect(run(UPSERT, [envFile, 'JUST_A_NAME']).status).toBe(1);
    expect(run(UPSERT, [envFile, '9LIVES=x']).status).toBe(1);
  });

  it('leaves a file `. .env` still reads the way compose does', () => {
    // The property behind the refusals: every consumer sources this file, so a
    // written value must survive the shell unchanged.
    run(UPSERT, [envFile, 'TRIGGER_SECRET_KEY=tr_prod_A1b2C3', 'PGBOUNCER_AUTH_PASSWORD=9f8e7d6c']);

    const echoed = execFileSync(
      'sh',
      ['-c', `set -a; . "${envFile}"; set +a; printf '%s|%s' "$TRIGGER_SECRET_KEY" "$PGBOUNCER_AUTH_PASSWORD"`],
      { encoding: 'utf8' },
    );
    expect(echoed).toBe('tr_prod_A1b2C3|9f8e7d6c');
  });
});

// ---------------------------------------------------------------------------
describe('trigger-magic-link.sh', () => {
  /** A log shaped like the webapp's: the link buried in JSON and in prose. */
  const LOG = [
    '{"level":"info","msg":"webapp listening on 3000"}',
    'Click here to log in with this magic link: http://localhost:3090/magic?token=OLDEST',
    '{"level":"info","message":"email","url":"https://spark.local:3443/magic?token=NEWEST"}',
    'GET /login 200 12ms',
  ].join('\n');

  const logCmd = (text: string) => {
    const file = join(dir, 'trigger.log');
    writeFileSync(file, `${text}\n`);
    return { TRIGGER_LOG_CMD: `cat ${file}` };
  };

  it('prints the newest link, because an older one may already be spent', () => {
    const r = run(MAGIC_LINK, [], logCmd(LOG));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('https://spark.local:3443/magic?token=NEWEST');
  });

  it('--all prints every link, oldest first', () => {
    const r = run(MAGIC_LINK, ['--all'], logCmd(LOG));
    expect(r.stdout.trim().split('\n')).toEqual([
      'http://localhost:3090/magic?token=OLDEST',
      'https://spark.local:3443/magic?token=NEWEST',
    ]);
  });

  it('stops at the JSON quote rather than swallowing the rest of the line', () => {
    const r = run(MAGIC_LINK, [], logCmd('{"url":"https://h:3443/magic?token=ABC","expires":"5m"}'));
    expect(r.stdout.trim()).toBe('https://h:3443/magic?token=ABC');
  });

  it('says the link is only written when one is REQUESTED, rather than blaming the stack', () => {
    const r = run(MAGIC_LINK, [], logCmd('{"level":"info","msg":"webapp listening on 3000"}'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/only written when one is REQUESTED/);
    expect(r.stdout).toBe('');
  });
});

// ---------------------------------------------------------------------------
describe('trigger-credentials.sh', () => {
  const FULL_SCHEMA = [
    'Project.externalRef',
    'Project.id',
    'Project.name',
    'RuntimeEnvironment.apiKey',
    'RuntimeEnvironment.slug',
    'RuntimeEnvironment.projectId',
  ].join('\\n');

  /**
   * A stand-in for `psql` inside the trigger-db container: it answers the
   * introspection probe and the lookup differently, which is the only thing
   * the script's contract with psql actually is.
   */
  function stubPsql(schema: string, rows: string): NodeJS.ProcessEnv {
    const path = join(dir, 'psql-stub');
    writeFileSync(
      path,
      [
        '#!/usr/bin/env bash',
        'sql="$(cat)"',
        'case "$sql" in',
        `  *information_schema*) printf '${schema}\\n' ;;`,
        `  *) printf '${rows}' ;;`,
        'esac',
      ].join('\n'),
    );
    chmodSync(path, 0o755);
    return { TRIGGER_DB_PSQL: path };
  }

  it('prints the ref and the prod key as env lines', () => {
    const r = run(CREDENTIALS, [], stubPsql(FULL_SCHEMA, 'proj_abc123|tr_prod_XYZ789|ownpace\\n'));
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      'TRIGGER_PROJECT_REF=proj_abc123',
      'TRIGGER_SECRET_KEY=tr_prod_XYZ789',
    ]);
  });

  it('--write puts both into .env and nothing else', () => {
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'TRIGGER_PROJECT_REF=\nTRIGGER_SECRET_KEY=\nAPI_PORT=3001\n');
    // The script writes to the .env NEXT TO ITSELF, so drive the write through
    // env-upsert directly on a temp file and assert the pair it would hand over.
    const r = run(CREDENTIALS, [], stubPsql(FULL_SCHEMA, 'proj_abc123|tr_prod_XYZ789|ownpace\\n'));
    run(UPSERT, [envFile, ...r.stdout.trim().split('\n')]);

    expect(readFileSync(envFile, 'utf8')).toBe(
      'TRIGGER_PROJECT_REF=proj_abc123\nTRIGGER_SECRET_KEY=tr_prod_XYZ789\nAPI_PORT=3001\n',
    );
  });

  it('refuses when the schema is not the one it knows, and names the missing columns', () => {
    // Trigger.dev renamed a column in a version bump — the case this guard is for.
    const partial = 'Project.id\\nRuntimeEnvironment.slug\\nRuntimeEnvironment.projectId';
    const r = run(CREDENTIALS, [], stubPsql(partial, 'anything\\n'));

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Project.externalRef');
    expect(r.stderr).toContain('RuntimeEnvironment.apiKey');
    expect(r.stdout).toBe('');
  });

  it('refuses a value of the wrong shape rather than writing a plausible one', () => {
    // The column exists but holds something else — the failure mode that would
    // otherwise be believed for the rest of the deployment's life.
    const r = run(CREDENTIALS, [], stubPsql(FULL_SCHEMA, 'cm9iYmVz|tr_prod_XYZ789|ownpace\\n'));

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/does not look like a project ref/);
    expect(r.stdout).toBe('');
  });

  it('refuses a dev key where a prod key belongs', () => {
    // A `tr_dev_` key is personal to a CLI session and would not work from a
    // container — and it is the one an operator is most likely to copy.
    const r = run(CREDENTIALS, [], stubPsql(FULL_SCHEMA, 'proj_abc123|tr_dev_XYZ789|ownpace\\n'));

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/does not look like a tr_prod_ key/);
  });

  it('says which project to name when the instance holds more than one', () => {
    const rows = 'proj_aaa|tr_prod_AAA|first\\nproj_bbb|tr_prod_BBB|second\\n';
    const r = run(CREDENTIALS, [], stubPsql(FULL_SCHEMA, rows));

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('first');
    expect(r.stderr).toContain('second');
    expect(r.stderr).toContain('--project');
    expect(r.stdout).toBe('');
  });

  it('does not blame the stack when compose could not read the file at all', () => {
    // Seen live on the Spark, 2026-08-18. `docker compose exec` interpolates
    // the WHOLE compose file before running anything, so ONE unset variable —
    // here on a service this command never touches — fails the call. The old
    // message said "Is the stack up?" and sent the operator looking at a
    // Trigger.dev instance that was running perfectly well.
    const composeError =
      'error while interpolating services.pgbouncer.environment.PGBOUNCER_AUTH_PASSWORD: ' +
      'required variable PGBOUNCER_AUTH_PASSWORD is missing a value';
    const path = join(dir, 'psql-failing');
    writeFileSync(path, ['#!/usr/bin/env bash', 'cat >/dev/null', `echo '${composeError}' >&2`, 'exit 1'].join('\n'));
    chmodSync(path, 0o755);

    const r = run(CREDENTIALS, [], { TRIGGER_DB_PSQL: path });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('NOT a database problem');
    expect(r.stderr).toContain('PGBOUNCER_AUTH_PASSWORD');
    expect(r.stderr).toContain('ensure-env-secrets.sh');
    // And it must NOT hand out the dashboard instructions, which would be
    // answering a question nobody asked.
    expect(r.stderr).not.toContain('Project → Settings');
  });

  it('treats "no project yet" as the expected pre-setup answer and says which pages to open', () => {
    const r = run(CREDENTIALS, [], stubPsql(FULL_SCHEMA, ''));

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/expected answer BEFORE the one human step/);
    expect(r.stderr).toContain('Project → Settings');
    expect(r.stderr).toContain('API keys');
  });
});

// ---------------------------------------------------------------------------
/**
 * `trigger.dev whoami` cannot be trusted by exit code (found 2026-08-18).
 *
 * Read from the installed CLI's own source: on an auth failure `whoami`
 * returns `{success:false}` as DATA rather than throwing, and the CLI's own
 * command wrapper only marks the process failed when something throws. So
 * `whoami --profile X >/dev/null 2>&1; echo $?` is 0 for a revoked, stale, or
 * entirely absent token — exactly the state a wiped Trigger.dev instance
 * leaves behind, since the local CLI profile lives outside its database and
 * survives untouched. Both bootstrap-managed.sh's `login` phase and
 * deploy-tasks.sh's preflight trusted that exit code and let a dead token
 * through; `deploy` only failed once it tried to use it.
 */
describe('trigger_cli_logged_in (trigger-cli-lib.sh)', () => {
  const LIB = join(REPO_ROOT, 'deploy/compose/trigger-cli-lib.sh');

  function stub(body: string): NodeJS.ProcessEnv {
    const path = join(dir, 'whoami-stub');
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path, 0o755);
    return { TRIGGER_CLI_WHOAMI_CMD: path };
  }

  function loggedIn(env: NodeJS.ProcessEnv): boolean {
    const r = spawnSync('bash', ['-c', `. "${LIB}"; trigger_cli_logged_in 4.5.9 openmig`], {
      env: { ...process.env, ...env },
    });
    return r.status === 0;
  }

  it('the login phase does not claim to have verified TRIGGER_ACCESS_TOKEN', () => {
    // e2e-managed printed "already logged in" and then died inside `deploy`
    // with "Invalid or Missing Access Token": the check short-circuits on
    // TRIGGER_ACCESS_TOKEN WITHOUT validating it (whoami structurally cannot
    // see that variable), so on CI the phase was reporting a trust decision as
    // a verification. The trust is fine; the wording was not.
    const bootstrap = readFileSync(join(REPO_ROOT, 'deploy/compose/bootstrap-managed.sh'), 'utf8');
    const phase = bootstrap.slice(bootstrap.indexOf('phase_login()'));
    expect(phase).toMatch(/TRIGGER_ACCESS_TOKEN[\s\S]{0,400}NOT verified here/);
    // And the profile path must still report itself as the verified one.
    expect(phase).toContain('already logged in (profile');
  });

  it('recognises a real successful lookup by its User ID line', () => {
    expect(
      loggedIn(stub('echo "User ID: user_abc123"; echo "Email:   owner@example.test"')),
    ).toBe(true);
  });

  it('is NOT fooled by an exit code of 0 on a stale token', () => {
    // This is the bug, reproduced: the real CLI exits 0 here too.
    const env = stub(
      'echo "You must login first. Use `trigger.dev login --profile openmig` to login."; exit 0',
    );
    expect(loggedIn(env)).toBe(false);
  });

  it('treats a platform-down fetch failure as not logged in, not a crash', () => {
    expect(loggedIn(stub('echo "Fetch failed. Platform down?"; exit 0'))).toBe(false);
  });

  it('treats a genuinely nonzero exit as not logged in too', () => {
    expect(loggedIn(stub('echo "boom" >&2; exit 1'))).toBe(false);
  });

  it('does not match "User ID" appearing somewhere it should not (e.g. an error dump)', () => {
    // Guards the anchor: a stray mention of the phrase in unrelated output must
    // not be read as a successful account lookup.
    expect(loggedIn(stub('echo "no User ID: field was present in the response"'))).toBe(false);
  });

  it('reads the BOXED account details the CLI actually prints', () => {
    // The bug this pins, found on a live bring-up 2026-08-20. The CLI draws
    // account details inside a box, so the line is `\u2502  User ID: …  \u2502`
    // and never starts with "User ID:". The old `grep -q "^User ID:"` therefore
    // told a correctly authenticated operator "Not logged in" — and the advice
    // it printed was to run `login`, which short-circuits on "already logged
    // in". A loop with no exit, on a stack where nothing executes until the
    // tasks deploy.
    // One `echo` per line — a single printf with embedded \n would be escaped
    // back into one literal line by the shell quoting, which is not what the
    // CLI produces and would test nothing.
    const boxed = [
      '\u250c  Displaying your account details [openmig]',
      '\u2502',
      '\u25c7  Account details [openmig] \u2500\u2500\u2500\u256e',
      '\u2502                                      \u2502',
      '\u2502  User ID: cmt0uv3zg0005r05dwkrmhgfy  \u2502',
      '\u2502  Email:   owner@example.test         \u2502',
    ];
    expect(loggedIn(stub(boxed.map((l) => `echo ${JSON.stringify(l)}`).join('; ')))).toBe(true);
  });

  it('still refuses a boxed line with no ID after the colon', () => {
    // Decoration tolerance must not become "the words appeared somewhere".
    // The matcher requires an alphanumeric value, which is what proves a
    // lookup actually returned something.
    expect(loggedIn(stub('echo "\u2502  User ID:                          \u2502"'))).toBe(false);
  });

  // ---------------------------------------------------------------------
  /**
   * TRIGGER_ACCESS_TOKEN (found 2026-08-18, following run #5). `whoami`
   * structurally cannot see this variable — confirmed from the installed
   * CLI's source, `isLoggedIn()` reads only the local profile file. `deploy`
   * uses it directly via a different code path (`login({embedded:true})`).
   * So when it is set, this function must trust it WITHOUT ever invoking
   * whoami — these tests prove that by pointing TRIGGER_CLI_WHOAMI_CMD at a
   * stub that would fail, and confirming it is never reached.
   */
  it('trusts TRIGGER_ACCESS_TOKEN without ever calling whoami', () => {
    const env = {
      ...stub('echo "You must login first."; exit 0'), // would report false, if called
      TRIGGER_ACCESS_TOKEN: 'tr_pat_fakeButPresent',
    };
    expect(loggedIn(env)).toBe(true);
  });

  it('does not treat an empty TRIGGER_ACCESS_TOKEN as set', () => {
    const env = { ...stub('echo "User ID: user_abc123"'), TRIGGER_ACCESS_TOKEN: '' };
    // Empty falls through to the real check, which here says logged in —
    // proving the empty value did NOT short-circuit on its own to a false
    // positive OR a false negative, only that the fallback ran at all.
    expect(loggedIn(env)).toBe(true);
    const envLoggedOut = { ...stub('echo "not logged in"; exit 0'), TRIGGER_ACCESS_TOKEN: '' };
    expect(loggedIn(envLoggedOut)).toBe(false);
  });
});

/**
 * Every bring-up that WAITS has to be able to say why it failed.
 *
 * The header above says `bootstrap-managed.sh` cannot usefully be tested
 * because every phase is a `docker compose` call. That is true of its
 * behaviour and not of its wiring, and the wiring is what went wrong.
 *
 * `up_wait` has existed since the PgBouncer hunt of 2026-08-18, and it exists
 * for exactly one reason: `up --wait` reports `container X is unhealthy`, which
 * names the service and never the cause, and the cause is always in that
 * container's own log. Every bring-up in the file went through it — except two.
 *
 * E2E (managed) #39 is what that cost. The zitadel bring-up added in #504
 * called compose directly, the container exited 1 on every restart, and the run
 * reported `ownpace-idp Restarting (1)` and not one word about why. A whole
 * dispatch spent to learn nothing, on a failure whose explanation was sitting
 * in `docker logs` the entire time.
 *
 * So: the diagnosis is split out as `explain_failure`, the two direct callers
 * reach it, and this refuses any future bring-up that waits without one.
 */
describe('a bring-up that waits can say why it failed', () => {
  const bootstrap = readFileSync(join(REPO_ROOT, 'deploy/compose/bootstrap-managed.sh'), 'utf8');

  it('read the real script', () => {
    // Vacuity guard: an empty string satisfies every "no line does X" below.
    expect(bootstrap.length).toBeGreaterThan(5000);
    expect(bootstrap).toContain('explain_failure()');
  });

  it('routes every waiting bring-up through the diagnosis', () => {
    // `up -d … --wait` is the shape that can hang and then give up with one
    // uninformative line. `up -d` without `--wait` is fire-and-forget and is
    // not this rule's business.
    const waiting = bootstrap
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /\bup -d\b/.test(line) && line.includes('--wait'));

    expect(waiting.length, 'no waiting bring-up found at all — the regex stopped matching').
      toBeGreaterThan(0);

    const blind = waiting.filter(
      ({ line }) =>
        // `up_wait`'s own implementation IS the diagnosis path.
        !line.includes('if "${COMPOSE[@]}" up -d --wait "$@"') &&
        // Anything else has to reach it explicitly.
        !line.includes('|| explain_failure'),
    );
    expect(
      blind.map(({ n, line }) => `${n}: ${line.trim()}`),
      'waits for a container and cannot say why it never came up',
    ).toEqual([]);
  });

  it('prints BOTH ends of the log, not just the tail', () => {
    // A misconfigured service says why at START-UP and then loops on the
    // consequence, so a tail-only window shows twenty copies of the symptom and
    // none of the cause — PgBouncer's `could not open auth_file … Permission
    // denied` sat one line above it for three rounds of debugging.
    const body = bootstrap.slice(
      bootstrap.indexOf('explain_failure() {'),
      bootstrap.indexOf('\n}', bootstrap.indexOf('explain_failure() {')),
    );
    // Asserted as the two WINDOWS, not as the commands that produce them. This
    // case used to match `logs --tail 20 "$svc"` and broke when the same two
    // windows started being sliced out of one captured read — a test pinned to
    // the shape of a command rather than to what it prints.
    expect(body, 'the start-up window is the half that matters').toMatch(
      /FIRST 20 \(start-up\)/,
    );
    // And the header states the TOTAL, so a reader can see at a glance whether
    // the two windows overlap — i.e. whether they are the whole log or a
    // keyhole into a much longer one.
    expect(body, 'a window with no idea how much it is not showing').toMatch(
      /\$\{n\} log lines/,
    );
    expect(body, 'and the current symptom is the other half').toContain('— last 20:');
    // The windows are SLICED FROM AN ARRAY now, not piped. Pinning `| head -20`
    // here is the mistake this case's own comment warns about one paragraph up:
    // it describes the command rather than what prints. It also pinned the
    // defect — see the broken-pipe case below.
    expect(body, 'the start-up window is sliced, not piped').toMatch(
      /\$\{lines\[@\]:0:20\}/,
    );
    expect(body, 'and so is the tail').toMatch(/\$\{lines\[@\]: -20\}/);
  });

  it('reads the log ONCE and prints from a variable, so no window can kill the next', () => {
    // E2E (managed) #40 is why. `docker compose logs "$svc" | head -20` looks
    // harmless: `head` closes the pipe after twenty lines, a container with a
    // LONG log is still writing, it takes SIGPIPE, and under `set -euo pipefail`
    // that failed pipeline aborts the function — after the first window and
    // before the second. The run died at exit 255 having printed Zitadel's
    // initialisation, which says nothing, while the `last 20` window holding
    // `PasswordComplexityPolicy.HasUpper` never printed at all.
    //
    // It had never bitten before because every container this had run on had a
    // log shorter than twenty lines, so `head` read to EOF and nothing was
    // signalled.
    const body = bootstrap.slice(
      bootstrap.indexOf('explain_failure() {'),
      bootstrap.indexOf('\n}', bootstrap.indexOf('explain_failure() {')),
    );
    expect(body, 'the log must be captured before it is sliced').toMatch(
      /full="\$\("\$\{COMPOSE\[@\]\}" logs "\$svc"/,
    );
    expect(
      body,
      'no window may pipe `docker compose logs` straight into head or tail again',
    ).not.toMatch(/logs (--tail \d+ )?"\$svc" 2>&1 \| (head|tail)/);
    // And no window may pipe the captured log either. `|| true` stopped the
    // SIGPIPE from killing the function, but the pipe still FIRED: E2E
    // (managed) #43 printed `bootstrap-managed.sh: line 203: printf: write
    // error: Broken pipe` into the middle of its own diagnosis, from a line
    // whose entire job is to be readable. Slicing an array cannot break, so
    // there is nothing left to forgive.
    expect(body, 'the log is read into an array once').toMatch(/mapfile -t lines <<<"\$full"/);
    expect(
      body,
      'a window that pipes the captured log can still emit a broken-pipe line into the diagnosis',
    ).not.toMatch(/printf '%s\\n' "\$full" \| (head|tail)/);
  });

  /**
   * Both windows above assume the log has two interesting ENDS. A container
   * under `restart: unless-stopped` has neither.
   *
   * E2E (managed) #43: Zitadel's first attempt failed part-way through
   * `03_default_instance` at 12:59:57. Twelve minutes and some dozens of
   * restarts later the diagnosis printed a head from 12:59:57 (initialisation,
   * which says nothing) and a tail from 13:12:08 saying
   * `Errors.Instance.Domain.AlreadyExists` — which is what the FIRST failure
   * left behind, not what went wrong. Four rounds of debugging went at the
   * database because the log's two ends agreed on a symptom.
   */
  describe('the failure window — the only one a crash loop cannot hide the cause from', () => {
    const body = bootstrap.slice(
      bootstrap.indexOf('explain_failure() {'),
      bootstrap.indexOf('\n}', bootstrap.indexOf('explain_failure() {')),
    );

    // The script's OWN pattern, lifted out of the script. A test that re-types
    // it tests its copy; this one breaks when the real one stops matching.
    const declared = /^FATAL_LINE_RE='(.+)'$/m.exec(bootstrap);
    const pattern = declared?.[1];

    // Real lines, from run #43's `docker compose logs zitadel`. The order is
    // the order they appeared in: cause at the top, consequences below.
    const CAUSE =
      'ownpace-idp  | time="2026-08-23T12:59:58Z" level=error msg="migration failed" ' +
      'error="Message=Errors.User.PasswordComplexityPolicy.HasUpper" name=03_default_instance';
    const CONSEQUENCE =
      'ownpace-idp  | time="2026-08-23T13:12:08Z" level=error msg="migration failed" ' +
      'error="ID=V3-DKcYh Message=Errors.Instance.Domain.AlreadyExists" name=03_default_instance';
    const CHATTER = [
      'ownpace-idp  | time="2026-08-23T12:59:57Z" level=info msg="verify user" username=zitadel',
      'ownpace-idp  | time="2026-08-23T12:59:57Z" level=info msg="verify database" database=zitadel',
      'ownpace-idp  | time="2026-08-23T12:59:57Z" level=info msg="verify encryption keys"',
      'ownpace-idp  | time="2026-08-23T12:59:57Z" level=info msg="starting migration" name=01_tables',
      'ownpace-nextcloud  | [core] Trusted domain check passed',
    ];

    it('greps the WHOLE log, and leads with the oldest match', () => {
      expect(body, 'the third window has to exist at all').toMatch(/grep -aE "\$FATAL_LINE_RE"/);
      expect(body, 'a tail-of-the-errors window repeats the mistake it fixes').toContain(
        'OLDEST FIRST',
      );
      expect(
        body,
        'and it must say so in the output, because the newest line is the plausible one',
      ).toMatch(/read the OLDEST of these/);
    });

    it("uses the script's own pattern to find the cause a crash loop buried", () => {
      expect(pattern, 'FATAL_LINE_RE is gone or no longer a single-quoted one-liner').toBeTruthy();
      const re = new RegExp(pattern as string);
      expect(re.test(CAUSE), 'the buried cause must match').toBe(true);
      expect(re.test(CONSEQUENCE), 'so must its echoes — they are just not first').toBe(true);
    });

    it('does not match ordinary start-up chatter', () => {
      // A pattern matching every line containing "error" would match Zitadel's
      // `verify` lines and half of Nextcloud's boot, and a failure window the
      // size of the log is a third copy of the log.
      const re = new RegExp(pattern as string);
      for (const line of CHATTER) {
        expect(re.test(line), `matched ordinary chatter: ${line}`).toBe(false);
      }
    });

    it('recognises a setup that failed part-way and says the visible error is the leftover', () => {
      // `03_default_instance` registers the instance domain BEFORE it creates
      // the first human, and Zitadel says `setup failed, skipping cleanup` —
      // it does not roll back. A failure at the human therefore leaves the
      // domain behind, and every restart afterwards dies on the leftover.
      expect(body, 'the half-initialised state has to be recognised by name').toContain(
        'setup failed, skipping cleanup',
      );
      expect(body, 'and the operator told which of the two errors to believe').toMatch(
        /is the leftover, not the cause/,
      );
      // `IF EXISTS`, because this prints while somebody is already debugging and
      // pasting it twice must not add a failure to the pile they are reading.
      // pasteable-hints.unit.test.ts requires the same of every clear-down.
      expect(body, 'and given the clear-down that the fix needs').toContain(
        'DROP DATABASE IF EXISTS zitadel',
      );
    });

    it('prints the clear-down rather than performing it', () => {
      // Non-destructive by default. A bring-up that drops a database because a
      // migration failed is one bad heuristic away from erasing the identity
      // store of a stack that had real users in it.
      const dropLines = bootstrap
        .split('\n')
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) => /DROP DATABASE|docker volume rm|rm -sf/i.test(line));
      expect(dropLines.length, 'the remedy text has gone missing').toBeGreaterThan(0);
      const executed = dropLines.filter(({ line }) => !line.startsWith('echo '));
      expect(
        executed.map(({ n, line }) => `${n}: ${line}`),
        'the bring-up may name a destructive remedy; it may not run one',
      ).toEqual([]);
    });
  });
  /**
   * A container that is RUNNING and unhealthy is the one shape none of the
   * three log windows can describe, because the answer is not in the log.
   *
   * `docker compose logs` shows what the CONTAINER wrote. A healthcheck runs
   * beside it and its output goes somewhere else entirely — Docker keeps the
   * last few attempts in `.State.Health.Log`, reachable only via `docker
   * inspect`. Nothing in the bring-up had ever looked there.
   *
   * E2E (managed) #47: Zitadel v4.17.1 came up perfectly — every migration
   * applied, OIDC routes registered, `server is listening address=[::]:8080`,
   * and ZERO lines in the failure window. It sat at `Up 5 minutes (unhealthy)`
   * and the run died at `--wait`, with a diagnosis that could only report the
   * log was clean. It was clean. The probe was the answer and it was one
   * `docker inspect` away the whole time.
   */
  describe('a container that is running and unhealthy', () => {
    const body = bootstrap.slice(
      bootstrap.indexOf('explain_failure() {'),
      bootstrap.indexOf('\n}', bootstrap.indexOf('explain_failure() {')),
    );

    it('asks docker for the healthcheck output, which is not in the log', () => {
      expect(body, 'the probe window has to exist at all').
        toMatch(/docker inspect "\$cname"/);
      expect(body, 'and read the attempts docker records').
        toMatch(/\.State\.Health\.Log/);
      expect(body, 'a probe that failed without saying so is the thing being fixed').
        toMatch(/\{\{\.ExitCode\}\}/);
      expect(body).toMatch(/\{\{\.Output\}\}/);
    });

    it('says the output is NOT in the log, because that is the confusing part', () => {
      // Somebody reading three clean windows and one failing container needs
      // telling why the fourth exists.
      expect(body).toMatch(/what the HEALTHCHECK said/);
      expect(body).toMatch(/not in the log above/);
    });

    it('does not assume every service HAS a healthcheck', () => {
      // Four services in this stack have none. A template that dereferences a
      // missing .State.Health errors instead of saying nothing.
      // Comments stripped: the line above the template EXPLAINS the guard by
      // quoting it, and a test that reads prose cannot tell the explanation
      // from the thing explained. Removing the guard left the comment behind
      // and this case passed anyway, until it was proved by breaking.
      expect(body.replace(/^\s*#.*$/gm, ''), 'the template must guard the field it reads').
        toMatch(/\{\{if \.State\.Health\}\}/);
    });

    it('cannot abort the rest of the diagnosis it sits inside', () => {
      // This runs after two log windows and a failure window and before the
      // pointer to the failure table. Under `set -e` an inspect that fails on
      // a container compose could not name would take all of that with it.
      // Scoped to the ASSIGNMENT, not to a slice that runs on past it. The
      // first version cut at the outer `fi` and swept in the `printf … || true`
      // below, so deleting the inspect's own guard changed nothing it looked
      // at — found by breaking it.
      expect(
        body,
        'an inspect that can abort takes the diagnosis with it',
      ).toMatch(/probe="\$\(docker inspect[\s\S]*?\|\| true\)"/);
      expect(body, 'and a container compose cannot name is not a crash').
        toMatch(/if \[ -n "\$cname" \]; then/);
    });
  });

  it('stops the bring-up rather than carrying on past a service that never started', () => {
    const body = bootstrap.slice(bootstrap.indexOf('explain_failure() {'));
    expect(body.slice(0, body.indexOf('\n}')), 'a diagnosis that returns 0 is a warning').toContain(
      'exit 1',
    );
  });
});

describe('the Trigger.dev images and the SDK that builds the tasks agree', () => {
  /**
   * `bootstrap-managed.sh` refuses to bring the stack up when
   * `apps/worker`'s `@trigger.dev/sdk` and the image tag disagree (0018 T0):
   * the tasks it deploys RUN inside those images, and "the 4.5.x family is
   * SDK-compatible" is a hope, not a deploy story.
   *
   * That refusal is a RUNTIME one — it fires at `docker compose up`, which
   * only the managed gate ever performs, and which no pull request runs. So
   * the agreement was invisible to CI, and dependabot walked straight through
   * it: PR #528 bumped the SDK 4.5.9 -> 4.5.12, passed all seventeen checks,
   * merged, and the next managed run died at the bring-up. The nightly would
   * have died the same way. Two hand-maintained numbers in three files and
   * nothing comparing them — the same shape as the service list (0099), the
   * MOUNTS list (0096) and the trigger filters (0097).
   *
   * So the numbers are compared HERE, where a pull request can see it. The
   * fix for a red from this test is a decision, not an edit: either hold the
   * SDK back, or move all three and accept that the next bring-up recreates
   * the Trigger.dev webapp and supervisor at the new tag.
   */
  const workerPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/worker/package.json'), 'utf8'));
  const compose = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8');
  const example = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.env.example'), 'utf8');

  /** Every `${TRIGGER_IMAGE_TAG:-vX}` default in managed.yml. */
  const composeDefaults = [...compose.matchAll(/\$\{TRIGGER_IMAGE_TAG:-(v[^}]+)\}/g)].map((m) => m[1]);

  it('read the real files', () => {
    expect(workerPkg.dependencies?.['@trigger.dev/sdk']).toBeTruthy();
    // Both the webapp and the supervisor carry the tag; one of them drifting
    // alone would run a split-version plane.
    expect(composeDefaults.length).toBe(2);
  });

  it('every image in managed.yml carries the SAME tag', () => {
    expect(new Set(composeDefaults).size, `managed.yml disagrees with itself: ${composeDefaults.join(' vs ')}`).toBe(1);
  });

  it('the image tag matches the SDK apps/worker builds its tasks with', () => {
    // The exact comparison bootstrap-managed.sh makes, made where CI can see
    // it: tag without the leading v, against the SDK's pinned version.
    const sdk = workerPkg.dependencies['@trigger.dev/sdk'];
    // Read once and asserted present: an empty match list would otherwise
    // make every comparison below vacuously true.
    const tag = composeDefaults[0] ?? '';
    expect(tag, 'managed.yml declares no TRIGGER_IMAGE_TAG default at all').not.toBe('');
    expect(
      tag.replace(/^v/, ''),
      `managed.yml runs images ${tag} but apps/worker builds tasks with SDK ${sdk}. ` +
        'bootstrap-managed.sh refuses this at bring-up, so a merge with it red breaks E2E (managed). ' +
        'Reconcile deliberately: hold the SDK back, or move BOTH managed.yml defaults and ' +
        'managed.env.example forward and accept that the next bring-up recreates the Trigger.dev plane.',
    ).toBe(sdk);
  });

  it('the example env agrees too, or a fresh .env reintroduces the drift', () => {
    // managed.env.example is copied to .env on a new machine, and a value
    // there WINS over managed.yml's default — so a stale one here puts the
    // drift back on exactly the machine least able to debug it.
    const exampleTag = /^TRIGGER_IMAGE_TAG=(.+)$/m.exec(example)?.[1]?.trim();
    expect(exampleTag, 'managed.env.example names no TRIGGER_IMAGE_TAG').toBeTruthy();
    expect(exampleTag).toBe(composeDefaults[0] ?? '');
  });
});

describe('nothing in the managed stack runs whatever `latest` happens to mean', () => {
  /**
   * THE ONE DEPENDENCY THAT FLOATED.
   *
   * The v4.5.12 upgrade was reasoned about carefully — four places to move,
   * a tool to move them, a verified backup and a restore drill first — and it
   * crash-looped anyway, on the one input none of that looked at:
   *
   *   Code: 80. DB::Exception: Only literals can be skip index arguments.
   *   (version 25.5.2.47)
   *
   * `clickhouse` was `bitnamilegacy/clickhouse:latest`. Nothing in the repo
   * said which ClickHouse the stack ran, so nothing could notice that it ran a
   * version whose SQL dialect rejects a migration v4.5.12 ships. `latest` on an
   * ARCHIVED repository is the worst of both: it never moves, and it never
   * tells you where it stopped. `trigger-version.sh list` cannot see this class
   * — it reads Trigger.dev's tags, and the thing that broke was underneath.
   *
   * So the rule is narrow and absolute: NO image in the managed stack may be
   * `latest` or tagless. It deliberately does NOT demand a digest everywhere —
   * `postgres:18-alpine` and `redis:7-alpine` fix the major version and take
   * patches on purpose, which is a trade somebody made. `latest` is not a
   * trade; it is the absence of one.
   *
   * A float that remains is NAMED here with its reason, the way the connector
   * coverage guard lists what it is owed. An unlisted float fails, and so does
   * a listed one that has been fixed — the list cannot rot in either direction.
   */
  const composeYml = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8');

  /**
   * Floats this repository still carries, and why each is not fixed HERE.
   * Emptying this map is the goal; adding to it is a decision to argue for.
   */
  const NAMED_FLOATS: Record<string, string> = {
    // EMPTY, and that is the point. `bitnamilegacy/minio` lived here for
    // exactly one commit — long enough to be a debt somebody could see rather
    // than a line nobody had looked at since it was written. Naming it is what
    // got it fixed in the same afternoon.
    //
    // Adding an entry back is a deliberate act with a reason attached, which
    // is the whole contract. It is not a place to park an image you have not
    // got round to.
  };

  /** `${VAR:-default}` is what compose runs when .env is silent, so read the default. */
  function withDefaults(image: string): string {
    return image.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*:-([^}]*)\}/g, '$1');
  }

  /** The tag an image reference resolves to, or null when pinned by digest. */
  function tagOf(reference: string): string | null {
    const image = withDefaults(reference);
    if (image.includes('@sha256:')) return null;
    // A ':' before the last '/' is a registry port, not a tag.
    const lastSlash = image.lastIndexOf('/');
    const colon = image.indexOf(':', lastSlash + 1);
    return colon === -1 ? 'latest' : image.slice(colon + 1);
  }

  function repositoryOf(reference: string): string {
    const image = withDefaults(reference);
    const lastSlash = image.lastIndexOf('/');
    const at = image.indexOf('@');
    const colon = image.indexOf(':', lastSlash + 1);
    // The EARLIEST of the two, not '@' by preference: `repo:tag@sha256:…` is a
    // legal reference and carries both, so preferring '@' would report the tag
    // as part of the repository name. Only ever visible in a failure message —
    // which is exactly when a guard must not be confusing.
    const marks = [at, colon].filter((i) => i !== -1);
    return marks.length === 0 ? image : image.slice(0, Math.min(...marks));
  }

  const references = [...composeYml.matchAll(/^\s*image:\s*(\S+)\s*$/gm)].map((m) => m[1]!);

  it('read every image in managed.yml', () => {
    // A scanner that matches nothing passes forever.
    expect(references.length).toBeGreaterThanOrEqual(14);
    expect(references.some((r) => r.includes('clickhouse'))).toBe(true);
  });

  it('every float is a named one, and every named one is still floating', () => {
    const floating = references
      .filter((r) => {
        const tag = tagOf(r);
        // An unsubstituted ${VAR} means the file itself does not know.
        return tag === 'latest' || (tag !== null && tag.includes('${'));
      })
      .map(repositoryOf)
      .sort();

    expect(
      floating,
      'An image here runs whatever `latest` resolved to on the day it was pulled. ' +
        'Pin it to a version, or add it to NAMED_FLOATS with the reason it cannot be pinned yet.',
    ).toEqual(Object.keys(NAMED_FLOATS).sort());
  });

  it('each named float says why, at length', () => {
    for (const [repository, reason] of Object.entries(NAMED_FLOATS)) {
      expect(reason.length, `${repository} is excused without a reason`).toBeGreaterThan(60);
    }
  });

  it('clickhouse is pinned by DIGEST, not merely by version', () => {
    // The one that bit us gets the strongest form available. A version tag can
    // be repointed; a digest names the bytes. It is also what upstream's own
    // docker-compose.yml for this Trigger.dev release runs, which is the only
    // ClickHouse the migration in question has been proved against.
    const clickhouse = references.find((r) => r.includes('clickhouse'));
    expect(clickhouse, 'no clickhouse image in managed.yml at all').toBeTruthy();
    expect(clickhouse).toContain('@sha256:');
    expect(
      clickhouse,
      'bitnamilegacy tops out at 25.7.5, and 25.5.2 is the version that rejected the v4.5.12 migration',
    ).not.toContain('bitnamilegacy');
  });
});

describe('every file managed.yml mounts is a file that exists', () => {
  /**
   * A bind mount whose SOURCE is missing does not fail. Docker creates an
   * empty DIRECTORY at that path and mounts that instead, so the container
   * starts, the config is silently absent, and the service runs on defaults —
   * which for `clickhouse-override.xml` means the <16GB-RAM tuning quietly
   * stops applying on a 16GB box, and for `pgbouncer.ini` a pooler with no
   * configuration at all. Nothing checked this until a second ClickHouse
   * config file was added (2026-08-24).
   *
   * The exception is real and must stay one: `pgbouncer/userlist.txt` holds
   * the pooler's md5 credentials, so it is GENERATED at bring-up by
   * `ensure-env-secrets.sh` and gitignored — hard rule 3. Absence there is
   * correct; presence in the repository would be the bug.
   *
   * So an absent mount must be named below, and every name below must be
   * gitignored. That second half is what keeps the list from becoming a place
   * to put files somebody merely forgot to commit: "generated" is a claim,
   * and `.gitignore` is where this repository records having meant it.
   */
  const composeYml = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8');
  const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
  const COMPOSE_DIR = join(REPO_ROOT, 'deploy/compose');

  /** Mounts that are WRITTEN at bring-up, and why each cannot be committed. */
  const GENERATED_AT_BRING_UP: Record<string, string> = {
    './pgbouncer/userlist.txt':
      "The pooler's md5 credentials. ensure-env-secrets.sh writes it from .env at bring-up; " +
      'committing it would put a working secret in the repository (hard rule 3).',
  };

  /** Every `- ./x:/y` bind mount source in the file. */
  const sources = [...composeYml.matchAll(/^\s*-\s+(\.\/[^:\s]+):/gm)].map((m) => m[1]!);

  it('found the bind mounts', () => {
    expect(sources.length).toBeGreaterThanOrEqual(5);
    expect(sources).toContain('./clickhouse-disable-system-logs.xml');
  });

  it('each one is committed, or named as generated', () => {
    const unexplained = sources.filter(
      (source) => !existsSync(join(COMPOSE_DIR, source)) && !(source in GENERATED_AT_BRING_UP),
    );
    expect(
      unexplained,
      'managed.yml mounts a path that is neither in the repository nor listed as generated. ' +
        'Docker will create an empty DIRECTORY there and the service will start WITHOUT the ' +
        'config, on defaults.',
    ).toEqual([]);
  });

  it('every mount called generated is actually gitignored', () => {
    // Checked against .gitignore rather than against the filesystem: on a
    // machine that HAS run the bring-up the file exists, and a test that reads
    // "is it there" would pass on the Spark and fail in CI for the same repo.
    for (const [source, reason] of Object.entries(GENERATED_AT_BRING_UP)) {
      const path = `deploy/compose/${source.replace(/^\.\//, '')}`;
      expect(
        gitignore.split('\n').some((line) => line.trim() === path),
        `${source} is called generated but .gitignore does not mention ${path} — ` +
          'so nothing stops it being committed, and nothing says it was meant to be absent.',
      ).toBe(true);
      expect(reason.length, `${source} is excused without a reason`).toBeGreaterThan(60);
    }
  });
});

/**
 * A VARIABLE COMPOSE REFUSES TO START WITHOUT, THAT A FRESH `.env` HAS NOT GOT.
 *
 * `${FOO:?message}` in `managed.yml` means compose refuses every command —
 * `up`, `ps`, `config`, `logs` — until FOO is set. `bootstrap-managed.sh`
 * creates a new `.env` by copying `managed.env.example`, so a `:?` variable
 * that the example does not carry and `ensure-env-secrets.sh` does not generate
 * makes a fresh machine unbringable-up, with an error naming a variable nobody
 * has ever heard of.
 *
 * Nothing compared the two. There were per-variable assertions — ZITADEL_PORT
 * here, TRIGGER_IMAGE_TAG there — added one at a time by whoever got bitten,
 * which is a list of past incidents rather than a rule. This is the rule.
 *
 * The same shape as `every-service-somebody-starts.unit.test.ts`, written the
 * same night: the file that DEFINES the stack and the file that has to satisfy
 * it, with nothing checking they agree. That one found a status page no
 * bring-up had ever started. This one currently finds nothing — it is a
 * guardrail rather than a repair, and it is here because the next service
 * added with a required variable is the one that would.
 */
describe('every variable managed.yml refuses to start without can be satisfied', () => {
  const yml = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8');
  const exampleEnv = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.env.example'), 'utf8');
  const secrets = readFileSync(join(REPO_ROOT, 'deploy/compose/ensure-env-secrets.sh'), 'utf8');

  /** `${FOO:?…}` — the ones compose treats as fatal, not the `:-` defaults. */
  const required = [...new Set([...yml.matchAll(/\$\{([A-Z_][A-Z0-9_]*):\?/g)].map((m) => m[1]!))];
  const inExample = new Set([...exampleEnv.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]!));

  it('found the required variables, rather than passing on an empty list', () => {
    expect(required.length).toBeGreaterThan(5);
    // The one whose absence stopped every compose command for three weeks.
    expect(required).toContain('ZITADEL_MASTERKEY');
  });

  it.each(required)('%s is in managed.env.example or generated by ensure-env-secrets.sh', (name) => {
    const generated = new RegExp(`^\\s*ensure\\s+${name}\\b`, 'm').test(secrets);
    expect(
      inExample.has(name) || generated,
      `managed.yml refuses to start without ${name}, and a fresh .env copied from\n` +
        'managed.env.example would not have it. Add it to the example, or generate\n' +
        'it in ensure-env-secrets.sh — otherwise a new machine cannot bring the\n' +
        'stack up at all, and the error names a variable nobody has heard of.',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('bootstrap-managed.sh — the env it refuses to write into', () => {
  /**
   * Found live on the Spark, 2026-09-01. `deploy/compose/.env` there is a
   * symlink into the gate runner's persist directory — the shape the script
   * itself recommends — but the file behind it is the DURABLE SET: the seven
   * values a checkout clean must not destroy, because volumes depend on them.
   * Everything else is regenerated into the gate's workspace on every run.
   *
   * Pointed at that file, the bring-up did exactly what it is written to do:
   * generated the eight secrets it found missing, wrote them THROUGH the
   * symlink into the durable set, and then reported `WEB_URL has no value` two
   * phases later — the last symptom, on a box where the answer was never "fix
   * WEB_URL" but "you are on the machine that already has a stack".
   *
   * These run the real script rather than reading it, because the property is
   * an ORDERING — refuse before `ensure-env-secrets.sh` writes — and a string
   * match cannot tell a check that runs first from one that runs second.
   */
  const BOOTSTRAP = 'deploy/compose/bootstrap-managed.sh';

  /** A copy of `deploy/compose`, so a run cannot touch the real one. */
  const compose = (): string => {
    const to = join(dir, 'compose');
    cpSync(join(REPO_ROOT, 'deploy/compose'), to, { recursive: true });
    rmSync(join(to, '.env'), { force: true });
    return to;
  };

  /** A `docker` that fails at once, so a run that gets past `env` stops there. */
  const noDocker = (): string => {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'docker'), '#!/bin/sh\nexit 1\n');
    chmodSync(join(bin, 'docker'), 0o755);
    return `${bin}:${process.env.PATH}`;
  };

  const DURABLE_SET = [
    'POSTGRES_DB=openmigrate',
    'POSTGRES_USER=openmigrate',
    'POSTGRES_PASSWORD=x',
    'ZITADEL_ADMIN_PASSWORD=Aa1_xxxx',
    'ZITADEL_DB_PASSWORD=x',
    'ZITADEL_MASTERKEY=x',
    'ZITADEL_PORT=3126',
  ].join('\n');

  it('refuses a durable set behind the symlink, and writes NOTHING into it', () => {
    const to = compose();
    const persisted = join(dir, 'persist.env');
    writeFileSync(persisted, `${DURABLE_SET}\n`);
    symlinkSync(persisted, join(to, '.env'));

    const r = run(join(to, 'bootstrap-managed.sh'), ['--from', 'env']);

    expect(r.status, 'a refusal, not a wait — 2 is "your turn"').toBe(1);
    expect(r.stderr).toContain('is not a stack env');
    expect(r.stderr, 'the counts, so the refusal can be checked').toMatch(/defines 7 keys/);
    expect(r.stderr, 'it names the file behind the link').toContain(persisted);
    expect(r.stderr).toContain('NOTHING HAS BEEN WRITTEN');

    // The property that matters more than the message: the durable set is
    // still seven keys. If `ensure-env-secrets.sh` ran first this is fifteen.
    const after = readFileSync(persisted, 'utf8');
    expect(after).toBe(`${DURABLE_SET}\n`);
  });

  it('says what to do instead, on both machines it could be', () => {
    const to = compose();
    const persisted = join(dir, 'persist.env');
    writeFileSync(persisted, `${DURABLE_SET}\n`);
    symlinkSync(persisted, join(to, '.env'));

    const { stderr } = run(join(to, 'bootstrap-managed.sh'), ['--from', 'env']);
    expect(stderr, 'the gate runner: dispatch the workflow').toMatch(/E2E \(managed\)/);
    expect(stderr, 'a separate stack: give it an env of its own').toContain('unlink');
  });

  it('does NOT refuse the gate\'s own restored copy — the same content, in the checkout', () => {
    // The bug this nearly shipped as. The workflow restores that same small
    // file INTO `deploy/compose/.env` and then runs this script precisely so
    // it can top the rest up; a refusal on content alone fires there and takes
    // the nightly with it. What separates the two is not what the file says,
    // it is WHERE A WRITE LANDS: in CI a plain copy the bring-up owns, on the
    // gate box a link to the one file it must not own.
    const to = compose();
    writeFileSync(join(to, '.env'), `${DURABLE_SET}\n`);
    const { stdout, stderr } = run(join(to, 'bootstrap-managed.sh'), ['--from', 'env'], {
      PATH: noDocker(),
    });
    expect(stderr).not.toContain('is not a stack env');
    expect(stdout + stderr, 'and it tops the file up, which is the point of it').toContain(
      'generated JWT_SECRET',
    );
  });

  it('does NOT refuse a fresh install', () => {
    // No `.env` at all: the script copies the example and carries on. Refusing
    // here would refuse every first run there has ever been.
    const to = compose();
    const { stdout, stderr } = run(join(to, 'bootstrap-managed.sh'), ['--from', 'env'], {
      PATH: noDocker(),
    });
    expect(stdout).toContain('from managed.env.example');
    expect(stderr).not.toContain('is not a stack env');
  });

  it('does NOT refuse the edit-and-resume flow', () => {
    // An established env whose human has not finished filling it in is the
    // supported middle of this script's own three-stop design. This is why the
    // discriminator is the KEY COUNT and not "WEB_URL has no value": a real
    // `.env` starts as a copy of the example and keeps every key name from its
    // first minute, blank values included.
    const to = compose();
    cpSync(join(to, 'managed.env.example'), join(to, '.env'));
    const { stderr } = run(join(to, 'bootstrap-managed.sh'), ['--from', 'env'], {
      PATH: noDocker(),
    });
    expect(stderr).not.toContain('is not a stack env');
  });

  it('does NOT refuse an env whose WEB_URL was blanked', () => {
    // The discriminator must not be "WEB_URL has no value", and this is the
    // case that says so. MEASURED: the first version of the sibling test above
    // could not catch that mutation, because the example SHIPS a WEB_URL
    // (`http://localhost:3123`), so blanking it is a thing a human does rather
    // than a state the example arrives in. A human halfway through pointing a
    // stack at a real hostname is exactly who would be in it.
    const to = compose();
    const env = readFileSync(join(to, 'managed.env.example'), 'utf8').replace(
      /^WEB_URL=.*$/m,
      'WEB_URL=',
    );
    writeFileSync(join(to, '.env'), env);
    const { stderr } = run(join(to, 'bootstrap-managed.sh'), ['--from', 'env'], {
      PATH: noDocker(),
    });
    expect(stderr).not.toContain('is not a stack env');
  });

  it('scales the threshold with the example rather than hard-coding a number', () => {
    // A fixed floor stops meaning anything the first time somebody adds
    // fifteen keys to the example.
    const script = readFileSync(join(REPO_ROOT, BOOTSTRAP), 'utf8');
    expect(script).toMatch(/env_keys \* 4/);
    expect(script).toContain('managed.env.example');
  });
});
