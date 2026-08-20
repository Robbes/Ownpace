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
