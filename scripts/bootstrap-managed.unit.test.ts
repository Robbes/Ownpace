// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The scripts a managed bring-up cannot get wrong, tested.
 *
 * `env-upsert.sh` writes `deploy/compose/.env`, which is sourced by every other
 * script and by compose itself, and a wrong value in it does not fail at
 * bring-up: it fails hours later, as an authentication error that points at a
 * password when the problem was a role. The rest of this file holds the
 * bring-up's wiring: that every wait can say why it failed, that no image
 * floats, that every mount and required variable can be satisfied, the .env
 * it refuses to write into, the Docker networks, and the app and plane phases
 * against a stand-in for Docker.
 *
 * Until alpha.18 it also held `trigger-credentials.sh`, `trigger-magic-link.sh`,
 * the Trigger.dev CLI's login and the images that built the tasks. alpha.18
 * removed Trigger.dev (workplan 0167 T9), and those scripts with it.
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
        '# ---- Identity provider ----',
        'ZITADEL_PROJECT_ID=',
        'SMTP_PASSWORD=',
        '',
      ].join('\n'),
    );
  });

  const read = () => readFileSync(envFile, 'utf8');

  it('replaces a key where it already sits, so the comment above it still applies', () => {
    const r = run(UPSERT, [envFile, 'ZITADEL_PROJECT_ID=368104']);
    expect(r.status).toBe(0);

    const lines = read().split('\n');
    // Under the identity provider's header, not appended at the bottom under Postgres's.
    expect(lines.indexOf('ZITADEL_PROJECT_ID=368104')).toBe(
      lines.indexOf('# ---- Identity provider ----') + 1,
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
    run(UPSERT, ['--if-absent', envFile, 'POSTGRES_USER=somebody-else', 'SMTP_PASSWORD=sm_x']);

    expect(read()).toContain('POSTGRES_USER=openmigrate');
    // `KEY=` is an ABSENT value, not a set one — that is what copying
    // managed.env.example leaves behind, and it must be fillable.
    expect(read()).toContain('SMTP_PASSWORD=sm_x');
  });

  it('refuses a value it cannot represent, and writes nothing at all', () => {
    // A single quote is the one character with no form both compose's dotenv
    // and bash's `source` read identically, so the value itself has to change.
    const before = read();
    const r = run(UPSERT, [envFile, "POSTGRES_PASSWORD=don't", 'API_PORT=3002']);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('POSTGRES_PASSWORD');
    // Not "refused the bad one and wrote the good one" — the whole call is off.
    expect(read()).toBe(before);
  });

  it('refuses a newline, which would be one key over two lines', () => {
    expect(run(UPSERT, [envFile, 'K=first\nsecond']).status).toBe(1);
  });

  // These five used to be REFUSED, on the reasoning that the file is sourced by
  // a shell and no value this repo writes needs any of them. That held until
  // check-env-agreement.sh started telling operators to SINGLE-QUOTE such a
  // value — at which point the writer was refusing the remedy the checker
  // prescribed, and the two scripts gave opposite instructions about one line.
  // They are now written quoted, and what matters is that the bytes survive.
  it.each([
    ['whitespace', 'two words'],
    ['a double quote', 'say"what'],
    ['a dollar', 'has$dollar'],
    ['a backtick', '`id`'],
    ['a backslash', 'back\\slash'],
    ['a brace, as setup-zitadel writes', 'https://idp/ui/console/users/{sub}'],
  ])('stores %s single-quoted, byte for byte', (_label, value) => {
    expect(run(UPSERT, [envFile, `K=${value}`]).status).toBe(0);
    expect(read()).toContain(`K='${value}'`);

    // And a shell reading the file back gets the value that went in — the
    // property the old refusal was protecting, now held by the quoting.
    const back = run('bash', [
      '-c',
      'set -a; . "$1"; set +a; printf %s "$K"',
      'sh',
      envFile,
    ]);
    expect(back.stdout).toBe(value);
  });

  it('refuses something that is not a KEY=VALUE pair, and a bad variable name', () => {
    expect(run(UPSERT, [envFile, 'JUST_A_NAME']).status).toBe(1);
    expect(run(UPSERT, [envFile, '9LIVES=x']).status).toBe(1);
  });

  it('leaves a file `. .env` still reads the way compose does', () => {
    // The property behind the refusals: every consumer sources this file, so a
    // written value must survive the shell unchanged.
    run(UPSERT, [envFile, 'SMTP_PASSWORD=sm_A1b2C3', 'PGBOUNCER_AUTH_PASSWORD=9f8e7d6c']);

    const echoed = execFileSync(
      'sh',
      ['-c', `set -a; . "${envFile}"; set +a; printf '%s|%s' "$SMTP_PASSWORD" "$PGBOUNCER_AUTH_PASSWORD"`],
      { encoding: 'utf8' },
    );
    expect(echoed).toBe('sm_A1b2C3|9f8e7d6c');
  });
});

// ---------------------------------------------------------------------------
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
   * `latest` or tagless. It does not demand a digest itself. Floats within a
   * line are `a-float-nothing-ever-pulled`'s: `postgres:18-alpine` and
   * `redis:7.4-bookworm` were kept floating so that they would take patches,
   * and nothing ever pulled them, so they took none; since 2026-10-22 the
   * stores and the TLS front are pinned by exact version and digest, and that
   * guard refuses a new float. `latest` is not even a trade; it is the absence
   * of one.
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
    expect(references.length).toBeGreaterThanOrEqual(7);
    expect(references.some((r) => r.includes('zitadel'))).toBe(true);
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

});

describe('every file managed.yml mounts is a file that exists', () => {
  /**
   * A bind mount whose SOURCE is missing does not fail. Docker creates an
   * empty DIRECTORY at that path and mounts that instead, so the container
   * starts, the config is silently absent, and the service runs on defaults —
   * which for `clickhouse-override.xml` means the <16GB-RAM tuning quietly
   * stops applying on a 16GB box, and for `pgbouncer.ini` a pooler with no
   * configuration at all. Nothing checked this until a second ClickHouse
   * config file was added (2026-08-24); the ClickHouse service went with
   * Trigger.dev's plane in alpha.18 (workplan 0167 T9).
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

  /**
   * Every `- ./x:/y` bind mount source in the file, and the default of every
   * `- ${VAR:-./x}:/y`, which is what Compose mounts when the .env leaves VAR
   * unset: pgbouncer's userlist since 2026-11-03, whose OTA stack's file is in
   * its persisted directory (scripts/a-pooler-file-another-workflow-deleted).
   */
  const sources = [...composeYml.matchAll(/^\s*-\s+(?:\$\{[A-Z_][A-Z0-9_]*:-)?(\.\/[^:\s}]+)\}?:/gm)].map((m) => m[1]!);

  it('found the bind mounts', () => {
    expect(sources.length).toBeGreaterThanOrEqual(4);
    expect(sources).toContain('./gatus.yaml');
    // The interpolated default is read too, or the generated file drops out.
    expect(sources).toContain('./pgbouncer/userlist.txt');
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
    // "is it there" would pass on the machine and fail in CI for the same repo.
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
   * Found live on the machine, 2026-09-01. `deploy/compose/.env` there is a
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

// ---------------------------------------------------------------------------
/**
 * EVERY DOCKER NETWORK ON THE MACHINE LIES INSIDE THE RULE'S RANGES (workplan
 * 0136 T1 (b)).
 *
 * The managed API and tasks refuse a host a tester types when it resolves
 * inside the rule's ranges, and the rule holds none of its own for Docker's
 * networks: with Docker's built-in pools they lie inside the private ranges.
 * The bring-up checks that they do, for every network the daemon has made,
 * this stack's and the other stack's alike (0136 D6), before the API comes up.
 *
 * RUN, not read: the function is lifted from the script and run in bash against
 * a `docker` that answers from a fixture, and the real check behind it runs
 * under the repo's tsx. The fixture is shaped as `docker network inspect`
 * prints it; it was written, not recorded, as this test runs without a daemon.
 * The fake honours a project filter, so a check that asked only for its own
 * project's networks would miss the other stack's and pass what it should not.
 */
describe('bootstrap-managed.sh — every Docker network lies inside the rule (0136 T1 b)', () => {
  const script = readFileSync(join(REPO_ROOT, 'deploy/compose/bootstrap-managed.sh'), 'utf8');
  const lift = (name: string): string => {
    const at = script.indexOf(`${name}() {`);
    return at < 0 ? '' : script.slice(at, script.indexOf('\n}\n', at) + 3);
  };

  interface Net {
    Name: string;
    Id: string;
    Driver: string;
    Scope: string;
    EnableIPv6: boolean;
    IPAM: { Driver: string; Options: Record<string, string>; Config: Array<{ Subnet?: string; Gateway?: string }> };
    Internal: boolean;
    Labels: Record<string, string>;
  }
  const net = (name: string, id: string, project: string | undefined, config: Net['IPAM']['Config']): Net => ({
    Name: name,
    Id: id,
    Driver: name === 'host' || name === 'none' ? name : 'bridge',
    Scope: 'local',
    EnableIPv6: config.some((c) => (c.Subnet ?? '').includes(':')),
    IPAM: { Driver: 'default', Options: {}, Config: config },
    Internal: false,
    Labels: project ? { 'com.docker.compose.network': 'ownpace-network', 'com.docker.compose.project': project } : {},
  });

  /** Two stacks on one daemon, with Docker's own three networks. */
  const machine = (): Net[] => [
    net('bridge', 'b0', undefined, [{ Subnet: '172.17.0.0/16', Gateway: '172.17.0.1' }]),
    net('host', 'h0', undefined, []),
    net('none', 'n0', undefined, []),
    net('ownpace-managed_ownpace-network', 'm1', 'ownpace-managed', [{ Subnet: '172.18.0.0/16', Gateway: '172.18.0.1' }]),
    net('ownpace-managed_status-probe', 'm2', 'ownpace-managed', [{ Subnet: '192.168.16.0/20', Gateway: '192.168.16.1' }]),
    net('ownpace-live_ownpace-network', 'l1', 'ownpace-live', [
      { Subnet: '172.19.0.0/16', Gateway: '172.19.0.1' },
      { Subnet: 'fd12:3456:789a::/64', Gateway: 'fd12:3456:789a::1' },
    ]),
  ];

  /** A `docker` that answers `network ls` and `network inspect` from the fixture, and logs what it was asked. */
  const FAKE_DOCKER = `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_DOCKER_LOG, argv.join(' ') + '\\n');
const all = JSON.parse(fs.readFileSync(process.env.FAKE_DOCKER_NETWORKS, 'utf8'));
if (argv[0] === 'network' && argv[1] === 'ls') {
  const label = argv.map((a, i) => (a === '--filter' || a === '-f' ? argv[i + 1] : a.startsWith('--filter=') ? a.slice(9) : ''))
    .find((f) => f && f.startsWith('label=com.docker.compose.project='));
  const project = label ? label.split('=').slice(2).join('=') : undefined;
  const listed = project ? all.filter((n) => (n.Labels || {})['com.docker.compose.project'] === project) : all;
  process.stdout.write(listed.map((n) => n.Id).join('\\n') + (listed.length ? '\\n' : ''));
} else if (argv[0] === 'network' && argv[1] === 'inspect') {
  if (process.env.FAKE_DOCKER_INSPECT === 'fails') { process.stderr.write('Error: No such network\\n'); process.exit(1); }
  if (process.env.FAKE_DOCKER_INSPECT === 'garbage') { process.stdout.write('this is not JSON\\n'); process.exit(0); }
  const wanted = argv.slice(2);
  process.stdout.write(JSON.stringify(wanted.map((w) => all.find((n) => n.Id === w || n.Name === w)).filter(Boolean), null, 4) + '\\n');
} else {
  process.stderr.write('fake docker: not faked: ' + argv.join(' ') + '\\n');
  process.exit(1);
}
`;

  function check(networks: Net[], inspect?: 'fails' | 'garbage'): { status: number; out: string; asked: string[] } {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'docker'), FAKE_DOCKER);
    chmodSync(join(bin, 'docker'), 0o755);
    writeFileSync(join(dir, 'networks.json'), JSON.stringify(networks));
    const log = join(dir, 'docker.log');
    writeFileSync(log, '');
    const program = [
      'set -euo pipefail',
      `REPO_ROOT="${REPO_ROOT}"`,
      'note() { echo "    $*"; }',
      'die() { echo "!!! $*" >&2; exit 1; }',
      lift('check_docker_networks'),
      'check_docker_networks',
    ].join('\n');
    const r = spawnSync('bash', ['-c', program], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        FAKE_DOCKER_NETWORKS: join(dir, 'networks.json'),
        FAKE_DOCKER_LOG: log,
        ...(inspect ? { FAKE_DOCKER_INSPECT: inspect } : {}),
      },
    });
    return {
      status: r.status ?? -1,
      out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
      asked: readFileSync(log, 'utf8').split('\n').filter(Boolean),
    };
  }

  it('is in the script, and runs before the API and the tasks come up', () => {
    expect(lift('check_docker_networks'), 'the function was not found').toContain('docker network ls -q');
    const app = lift('phase_app');
    expect(app, 'phase_app does not run the check').toMatch(/^ {2}check_docker_networks$/m);
    expect(app.indexOf('check_docker_networks')).toBeLessThan(app.indexOf('local services=('));
  });

  it('passes a machine whose networks all lie inside, and says how many it read', () => {
    const r = check(machine());
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('all 6 Docker networks lie inside the ranges the rule refuses');
  });

  it('asks the daemon for every network, not for one project', () => {
    const r = check(machine());
    expect(r.asked[0]).toBe('network ls -q');
    expect(r.asked[1]?.split(' ').slice(2).sort()).toEqual(['b0', 'h0', 'l1', 'm1', 'm2', 'n0']);
  });

  it("refuses when the OTHER stack's network lies outside, and names it", () => {
    const networks = machine();
    networks[5] = net('ownpace-live_ownpace-network', 'l1', 'ownpace-live', [
      { Subnet: '203.0.113.0/24', Gateway: '203.0.113.1' },
    ]);
    const r = check(networks);
    expect(r.status).toBe(1);
    expect(r.out).toContain('OUTSIDE ownpace-live_ownpace-network (compose project ownpace-live): subnet 203.0.113.0/24');
    expect(r.out).toContain("lies outside the ranges a tester's host is refused in");
    expect(r.out).toContain('default-address-pools');
  });

  it("refuses when this stack's network lies outside, IPv6 included", () => {
    const networks = machine();
    networks[3] = net('ownpace-managed_ownpace-network', 'm1', 'ownpace-managed', [
      { Subnet: '172.18.0.0/16', Gateway: '172.18.0.1' },
      { Subnet: '2001:db8:1::/64', Gateway: '2001:db8:1::1' },
    ]);
    const r = check(networks);
    expect(r.status).toBe(1);
    expect(r.out).toContain('OUTSIDE ownpace-managed_ownpace-network (compose project ownpace-managed): subnet 2001:db8:1::/64');
  });

  it('refuses a gateway outside, though its subnet lies inside', () => {
    const networks = machine();
    networks[4] = net('ownpace-managed_status-probe', 'm2', 'ownpace-managed', [
      { Subnet: '192.168.16.0/20', Gateway: '198.51.100.1' },
    ]);
    const r = check(networks);
    expect(r.status).toBe(1);
    expect(r.out).toContain('gateway 198.51.100.1');
  });

  it('refuses a network wider than the range it starts in', () => {
    const networks = machine();
    networks[0] = net('bridge', 'b0', undefined, [{ Subnet: '172.16.0.0/11', Gateway: '172.16.0.1' }]);
    const r = check(networks);
    expect(r.status).toBe(1);
    expect(r.out).toContain('OUTSIDE bridge: subnet 172.16.0.0/11');
  });

  it('stops, and says so, when the daemon cannot inspect its networks', () => {
    const r = check(machine(), 'fails');
    expect(r.status).toBe(1);
    expect(r.out).toContain('docker network inspect failed');
    expect(r.out, 'a failed inspect read as a network outside').not.toContain('lies outside');
  });

  it('stops when what it read is not what docker network inspect prints', () => {
    const r = check(machine(), 'garbage');
    expect(r.status).toBe(1);
    expect(r.out).toContain('cannot read the networks');
    expect(r.out).toContain('could not be checked');
    expect(r.out, 'an unreadable answer read as a network outside').not.toContain('lies outside');
  });

  it('stops when the daemon lists no networks, rather than passing nothing', () => {
    const r = check([]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('listed no networks');
  });
});

// ---------------------------------------------------------------------------
describe('ensure-env-secrets.sh --only, which load_env runs for the jobs role (ADR-0054)', () => {
  /** A checkout's deploy/compose with the script and what it sources, and an .env. */
  function checkout(env: string): { compose: string; envFile: string } {
    const compose = join(dir, 'deploy', 'compose');
    mkdirSync(join(compose, 'pgbouncer'), { recursive: true });
    for (const f of ['ensure-env-secrets.sh', 'env-read.sh', 'env-upsert.sh', 'shipped-passwords.sh', 'stack-kind.sh', 'managed.yml']) {
      cpSync(join(REPO_ROOT, 'deploy/compose', f), join(compose, f));
    }
    const envFile = join(compose, '.env');
    writeFileSync(envFile, env, { mode: 0o600 });
    return { compose, envFile };
  }
  /** Docker that would fail any question: --only must not ask it anything. */
  function noDocker(): string {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'docker'), '#!/bin/sh\necho "docker was called: $*" >&2\nexit 99\n', { mode: 0o755 });
    return `${bin}:${process.env.PATH ?? ''}`;
  }

  it('fills in a missing JOBS_DB_PASSWORD, and nothing else: no other secret, no date, no group, no userlist', () => {
    const { compose, envFile } = checkout('COMPOSE_PROJECT_NAME=ownpace-managed\nPOSTGRES_PASSWORD=\n');
    const r = run(join(compose, 'ensure-env-secrets.sh'), ['--only', 'JOBS_DB_PASSWORD'], { PATH: noDocker() });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('[ensure-env-secrets] generated JOBS_DB_PASSWORD\n');
    const after = readFileSync(envFile, 'utf8');
    const value = /^JOBS_DB_PASSWORD=([0-9a-f]{48})$/m.exec(after)?.[1];
    expect(value, after).toBeDefined();
    expect(after.replace(/^JOBS_DB_PASSWORD=.*\n/m, '')).toBe('COMPOSE_PROJECT_NAME=ownpace-managed\nPOSTGRES_PASSWORD=\n');
    expect(existsSync(join(compose, 'pgbouncer', 'userlist.txt')), 'the userlist was written').toBe(false);
    expect(`${r.stdout}${r.stderr}`).not.toContain(value!);
  });

  it('keeps one that is set, and writes nothing', () => {
    const before = 'COMPOSE_PROJECT_NAME=ownpace-managed\nJOBS_DB_PASSWORD=' + 'ab'.repeat(24) + '\n';
    const { compose, envFile } = checkout(before);
    const r = run(join(compose, 'ensure-env-secrets.sh'), ['--only', 'JOBS_DB_PASSWORD'], { PATH: noDocker() });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('');
    expect(readFileSync(envFile, 'utf8')).toBe(before);
  });

  it.each([
    ['a key it does not seed alone', ['--only', 'POSTGRES_PASSWORD']],
    ['no key', ['--only']],
    ['another argument', ['--all']],
  ])('refuses %s, and writes nothing', (_what, args) => {
    const before = 'COMPOSE_PROJECT_NAME=ownpace-managed\n';
    const { compose, envFile } = checkout(before);
    const r = run(join(compose, 'ensure-env-secrets.sh'), args, { PATH: noDocker() });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage: ensure-env-secrets.sh [--only <KEY>], KEY one of: JOBS_DB_PASSWORD. Nothing was written.');
    expect(readFileSync(envFile, 'utf8')).toBe(before);
  });
});

// ---------------------------------------------------------------------------
/**
 * THE BRING-UP'S APP AND PLANE PHASES (workplan 0167 T7 and T9). alpha.18
 * removed Trigger.dev: the jobs run on pg-boss, in the `worker` service the
 * app phase builds and starts, and the `plane` phase removes what is left of
 * Trigger.dev's plane on a stack that ran alpha.17 (its containers, stopped,
 * orphans of a managed.yml that no longer names them), never a volume. The
 * phases are taken out of `bootstrap-managed.sh` as written and RUN, under its
 * own `set -euo pipefail`, with `docker` a stand-in on the PATH that records
 * every call and answers what a case says: which of the plane's containers
 * are left and which run, the api's container id, the host's CPU count and
 * memory. The phases' other helpers (the identity provider's, the mail
 * catcher's, the system role's question, remove-trigger-plane.sh's list) are
 * stand-ins that record that they ran.
 */
describe("the bring-up's app and plane phases (0167 T7, T9)", () => {
  const BOOTSTRAP = join(REPO_ROOT, 'deploy/compose/bootstrap-managed.sh');
  const text = readFileSync(BOOTSTRAP, 'utf8');
  const definition = (name: string): string => {
    const start = text.indexOf(`\n${name}() {`);
    expect(start, `bootstrap-managed.sh defines no ${name}()`).toBeGreaterThan(-1);
    const oneLine = new RegExp(`^${name}\\(\\) \\{.*\\}$`, 'm').exec(text.slice(start + 1));
    if (oneLine && oneLine.index === 0) return oneLine[0];
    return text.slice(start + 1, text.indexOf('\n}\n', start) + 2);
  };
  /** A top-level statement of the script, as written, to the line that ends it. */
  const statement = (re: RegExp): string => {
    const m = re.exec(text);
    expect(m, `bootstrap-managed.sh has no statement matching ${re}`).not.toBeNull();
    return m![0];
  };

  const managedYml = (opts: { cpus?: string } = {}) =>
    [
      'name: ownpace-managed',
      'services:',
      '  api:',
      '    image: example',
      '    environment:',
      '      OWNPACE_JOB_RUNNER: ${OWNPACE_JOB_RUNNER:-pg-boss}',
      '  worker:',
      `    cpus: \${WORKER_CPUS:-${opts.cpus ?? '2.5'}}`,
      // managed.yml's default size, for the default cap of 3 (#2046).
      '    mem_limit: ${WORKER_MEMORY:-2816m}',
      // Keys the worker receives, as #2046's service hands them on.
      '    environment:',
      '      OWNPACE_JOB_RUNNER: ${OWNPACE_JOB_RUNNER:-pg-boss}',
      '      LEDGER_RETENTION_DAYS: ${LEDGER_RETENTION_DAYS:-}',
      '      LOG_LEVEL: ${LOG_LEVEL:-}',
      '',
    ].join('\n');

  interface Ran {
    status: number | null;
    out: string;
    /** Every docker call and every stand-in, in order. */
    calls: string[];
  }

  /**
   * The phases named, run in a bash of their own. PLANE_LEFT names the plane's
   * services that still have a container (each gets the id `id-<service>`),
   * PLANE_RUNNING the ones of those that run, LEFT_VOLUMES what
   * remove-trigger-plane.sh --list answers.
   */
  function phase(phases: string[], o: { env?: string; yml?: string; answers?: Record<string, string> } = {}): Ran {
    const d = mkdtempSync(join(tmpdir(), 'bring-up-phase-'));
    const log = join(d, 'calls');
    for (const f of ['job-runner.sh', 'env-read.sh', 'own-addresses.sh']) {
      cpSync(join(REPO_ROOT, 'deploy/compose', f), join(d, f));
    }
    writeFileSync(join(d, 'managed.yml'), o.yml ?? managedYml());
    writeFileSync(join(d, '.env'), o.env ?? '');
    mkdirSync(join(d, 'bin'));
    writeFileSync(
      join(d, 'bin', 'docker'),
      [
        '#!/usr/bin/env bash',
        'printf "docker %s\\n" "$*" >>"$CALLS"',
        'svc=""; for a in "$@"; do case "$a" in label=com.docker.compose.service=*) svc="${a#label=com.docker.compose.service=}" ;; esac; done',
        'case "$*" in',
        '  "ps -a -q --filter "*) [ "${PS_FAILS:-}" != 1 ] || exit 1; case " ${PLANE_LEFT-} " in *" $svc "*) echo "id-$svc" ;; esac ;;',
        '  "ps -q --filter "*) case " ${PLANE_RUNNING-} " in *" $svc "*) echo "id-$svc" ;; esac ;;',
        '  "rm "*) exit "${RM_EXIT:-0}" ;;',
        '  "info --format {{.NCPU}}") echo "${NCPU:-4}" ;;',
        '  "info --format {{.MemTotal}}") echo "${MEMTOTAL:-17179869184}" ;;',
        // The api's container id: another after the `up` when API_REPLACED says so.
        '  *" ps -q api")',
        '    if [ -f "$STATE.api" ] && [ -n "${API_REPLACED:-}" ]; then echo api-new; else echo api-old; fi',
        '    : >"$STATE.api" ;;',
        '  *" up -d --wait worker" | *" up -d --wait --force-recreate worker") exit "${WORKER_UP_EXIT:-0}" ;;',
        'esac',
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(join(d, 'bin', 'docker'), 0o755);
    for (const s of ['zitadel-network-alias.sh', 'setup-zitadel.sh']) {
      writeFileSync(join(d, s), `#!/usr/bin/env bash\nprintf '%s\\n' "${s}" >>"$CALLS"\n`);
      chmodSync(join(d, s), 0o755);
    }
    writeFileSync(
      join(d, 'remove-trigger-plane.sh'),
      '#!/usr/bin/env bash\nprintf \'%s\\n\' "remove-trigger-plane.sh $*" >>"$CALLS"\n[ -z "${LEFT_VOLUMES:-}" ] || printf \'%s\\n\' $LEFT_VOLUMES\n',
    );
    chmodSync(join(d, 'remove-trigger-plane.sh'), 0o755);
    const stub = (name: string) => `${name}() { printf '%s\\n' "${name}" >>"$CALLS"; }`;
    const harness = [
      'set -euo pipefail',
      `SCRIPT_DIR='${d}'`,
      `REPO_ROOT='${REPO_ROOT}'`,
      'ENV_FILE="${SCRIPT_DIR}/.env"',
      'COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml")',
      'COMPOSE_PROJECT=ownpace-managed',
      'WITH_DEMO=0',
      '. "${SCRIPT_DIR}/env-read.sh"',
      '. "${SCRIPT_DIR}/own-addresses.sh"',
      '. "${SCRIPT_DIR}/job-runner.sh"',
      statement(/^PLANE_SERVICES=\([^)]*\)$/m),
      ...['say', 'note', 'die', 'env_get', 'env_or', 'runner_mode', 'plane_containers', 'plane_containers_removed'].map(definition),
      "WORKER_CPUS_RULE=''; WORKER_MEMORY_RULE=''; WORKER_SIZE_SAID=''",
      ...['worker_size_note', 'worker_sized', 'worker_set_against_rule', 'worker_size_drift', 'worker_cpus_fit', 'worker_memory_bytes'].map(definition),
      definition('worker_memory_fit'),
      ...['worker_env_fit', 'worker_ready_to_start'].map(definition),
      ...['worker_up', 'up_wait', 'phase_plane', 'phase_app'].map(definition),
      // set -a, as load_env sources the file: the shell then holds what it says.
      'load_env() { set -a; . "$ENV_FILE"; set +a; }',
      'explain_failure() { printf "%s\\n" "explain_failure $*" >>"$CALLS"; exit 1; }',
      ...[
        'check_docker_networks',
        'note_catcher_left_running',
        'prepare_machinekey_volume',
        'assert_zitadel_role_password',
        'wait_for_idp_ready',
        'check_idp_console_config',
      ].map(stub),
      // As system_role_ready dies on an unfit role (a-superuser-the-bring-up-would-have-uploaded runs the real one).
      `system_role_ready() { printf '%s\\n' system_role_ready >>"$CALLS"; [ -z "\${ROLE_UNFIT:-}" ] || die "REFUSED, before its password is set or the worker starts with its URL"; }`,
      'catcher_needed() { return 1; }',
      ...phases.map((p) => `phase_${p}`),
    ].join('\n');
    const r = spawnSync('bash', ['-c', harness], {
      env: {
        PATH: `${join(d, 'bin')}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        HOME: d,
        CALLS: log,
        STATE: join(d, 'polls'),
        ...o.answers,
      },
      encoding: 'utf8',
    });
    const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    rmSync(d, { recursive: true, force: true });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, calls: calls.map((c) => c.replace(/-f \S+managed\.yml/, '-f managed.yml')) };
  }

  const PG = 'OWNPACE_JOB_RUNNER=pg-boss\n';
  /** The plane's eleven services, as alpha.17's managed.yml declared them. */
  const PLANE = [
    'trigger-supervisor',
    'trigger-api',
    'trigger-tls',
    'trigger-tls-init',
    'clickhouse',
    'trigger-registry',
    'trigger-docker-proxy',
    'minio',
    'minio-init',
    'trigger-redis',
    'trigger-db',
  ];
  const asked = (all: boolean, svc: string) =>
    `docker ps ${all ? '-a ' : ''}-q --filter label=com.docker.compose.project=ownpace-managed --filter label=com.docker.compose.service=${svc}`;

  describe('plane: what is left of Trigger.dev’s plane, its containers only', () => {
    it('names the eleven services alpha.17 declared, and nothing of the stack that runs', () => {
      expect(statement(/^PLANE_SERVICES=\([^)]*\)$/m).replace(/\s+/g, ' ')).toBe(`PLANE_SERVICES=(${PLANE.join(' ')})`);
    });

    it('a stack with none left: asks for each service by its labels, removes nothing, and says so', () => {
      const r = phase(['plane'], { env: PG });
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/no container of Trigger\.dev's plane on ownpace-managed: nothing to remove/);
      expect(r.calls).toEqual([...PLANE.map((s) => asked(true, s)), 'remove-trigger-plane.sh --list']);
    });

    it("alpha.17's stopped plane: every container removed by id, none running so none stopped, and never a volume", () => {
      const r = phase(['plane'], { env: PG, answers: { PLANE_LEFT: PLANE.join(' ') } });
      expect(r.status, r.out).toBe(0);
      const rm = r.calls.filter((c) => /^docker rm /.test(c));
      expect(rm).toEqual([`docker rm ${PLANE.map((s) => `id-${s}`).join(' ')}`]);
      expect(r.calls.some((c) => /^docker stop /.test(c))).toBe(false);
      expect(r.out).toMatch(/its 11 container\(s\) removed, as orphans of a managed\.yml that no longer names them \(workplan 0167 T9\); no volume was touched/);
      // Never a volume, never the project's other containers, never Compose's own removal.
      expect(r.calls.join('\n')).not.toMatch(/volume|\brm -v\b|\brm -f\b|\bdown\b|--remove-orphans|\bprune\b/);
    });

    it('a container of the plane that still runs is stopped first, the supervisor before the rest, then removed with the others', () => {
      const r = phase(['plane'], {
        env: PG,
        answers: { PLANE_LEFT: 'trigger-supervisor trigger-api trigger-db', PLANE_RUNNING: 'trigger-db trigger-supervisor' },
      });
      expect(r.status, r.out).toBe(0);
      const stops = r.calls.filter((c) => /^docker stop /.test(c));
      expect(stops).toEqual(['docker stop -t 30 id-trigger-supervisor', 'docker stop -t 30 id-trigger-db']);
      const lastStop = r.calls.lastIndexOf(stops.at(-1)!);
      const rm = r.calls.findIndex((c) => /^docker rm /.test(c));
      expect(rm).toBeGreaterThan(lastStop);
      expect(r.calls[rm]).toBe('docker rm id-trigger-supervisor id-trigger-api id-trigger-db');
    });

    it("the plane's volumes still on the machine are said, with the one command that removes them, and not removed", () => {
      const r = phase(['plane'], {
        env: PG,
        answers: { LEFT_VOLUMES: 'ownpace-managed_trigger_db_data ownpace-managed_clickhouse_data_v2' },
      });
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/the plane's volumes are still on this machine, kept until they are removed by name:/);
      expect(r.out).toMatch(/ownpace-managed_trigger_db_data/);
      expect(r.out).toMatch(/\.\/deploy\/compose\/remove-trigger-plane\.sh says what it would remove; with --yes it removes them, one way/);
      expect(r.calls).toContain('remove-trigger-plane.sh --list');
      expect(r.calls).not.toContain('remove-trigger-plane.sh --yes');
    });

    it('Docker that cannot be asked stops the phase, having removed nothing', () => {
      const r = phase(['plane'], { env: PG, answers: { PS_FAILS: '1', PLANE_LEFT: PLANE.join(' ') } });
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/could not ask Docker for the plane's containers \(above\); nothing was removed\./);
      expect(r.calls.some((c) => /^docker (rm|stop) /.test(c))).toBe(false);
    });

    it('a removal that fails stops the phase and says the volumes are as they were', () => {
      const r = phase(['plane'], { env: PG, answers: { PLANE_LEFT: 'trigger-db', RM_EXIT: '1' } });
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/the plane's containers did not all go \(above\)\. Its volumes are as they were\./);
    });

    it('an old .env that says trigger stops the phase before Docker is asked, in the sentence that says alpha.18 removed it', () => {
      const r = phase(['plane'], { env: 'OWNPACE_JOB_RUNNER=trigger\n', answers: { PLANE_LEFT: PLANE.join(' ') } });
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/OWNPACE_JOB_RUNNER in .+ is trigger, but Trigger\.dev was removed in alpha\.18, so remove the key from the \.env or set it to pg-boss/);
      expect(r.calls).toEqual([]);
    });
  });

  describe('app: the worker, on pg-boss', () => {
    it('app: the size follows MAX_PASSES_IN_FLIGHT when .env sets none, exported for the compose calls and never written', () => {
      const env = `${PG}MAX_PASSES_IN_FLIGHT=6\n`;
      const r = phase(['app'], { env, answers: { NCPU: '8' } });
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/WORKER_CPUS 4: 0\.5 x \(MAX_PASSES_IN_FLIGHT 6 \+ 2\), for this run's compose calls \(not written to \.env\)/);
      expect(r.out).toMatch(/WORKER_MEMORY 4352m: \(MAX_PASSES_IN_FLIGHT 6 \+ 2\) x 512 MB \+ 256 MB, for this run's compose calls/);
      expect(r.out).toMatch(/the worker's CPU cap: 4, within this host's CPUs/);
    });

    it('app: the default cap of 3 gives 2.5 CPUs and 2816m, a half CPU and 512 MB for each of the 5 runs at once, and 256 MB for the worker itself', () => {
      const r = phase(['app'], { env: PG });
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/WORKER_CPUS 2\.5: /);
      expect(r.out).toMatch(/WORKER_MEMORY 2816m: /);
      expect(r.out).toMatch(/the worker's memory limit: 2816m, within this host's memory/);
    });

    it.each([
      ['the rule\'s limit above a 2 GB host', `${'OWNPACE_JOB_RUNNER=pg-boss\n'}`, String(2 * 1024 ** 3), /WORKER_MEMORY is 2816m, above this host's 2048 MB of memory\. Set it to at most that \(the rule: \(MAX_PASSES_IN_FLIGHT \+ 2\) x 512 MB \+ 256 MB = 2816m\)/],
      ['a .env limit above the host', 'OWNPACE_JOB_RUNNER=pg-boss\nWORKER_MEMORY=20g\n', String(16 * 1024 ** 3), /WORKER_MEMORY is 20g, above this host's 16384 MB of memory\./],
      ['a limit Compose does not read', 'OWNPACE_JOB_RUNNER=pg-boss\nWORKER_MEMORY=lots\n', String(16 * 1024 ** 3), /WORKER_MEMORY is 'lots', not an amount of memory Compose reads \(a number with b, k, m or g\)\. The rule: \(MAX_PASSES_IN_FLIGHT \+ 2\) x 512 MB \+ 256 MB = 2816m\./],
    ])('%s: refused in one sentence, before the worker starts', (_l, env, memtotal, why) => {
      for (const p of ['app']) {
        const r = phase([p], { env, answers: { MEMTOTAL: memtotal } });
        expect(r.status, `${p}: ${r.out}`).not.toBe(0);
        expect(r.out).toMatch(why);
        expect(r.calls.filter((c) => / stop | up -d --wait( --force-recreate)? worker/.test(c))).toEqual([]);
      }
    });

    it("a passing run prints neither the host's CPU count nor its memory: the gate's log is public", () => {
      // Numbers no other line holds: 13 CPUs, 23 GiB.
      const memtotal = String(23 * 1024 ** 3);
      for (const p of ['app']) {
        const r = phase([p], { env: PG, answers: { NCPU: '13', MEMTOTAL: memtotal } });
        expect(r.status, r.out).toBe(0);
        expect(r.out).not.toMatch(/\b13\b/);
        expect(r.out).not.toMatch(/23552|24696061952|\b23\b/);
      }
      // A refusal names the host's number: the operator needs it to fix .env.
      const refused = phase(['app'], { env: `${PG}WORKER_CPUS=14\n`, answers: { NCPU: '13', MEMTOTAL: memtotal } });
      expect(refused.out).toMatch(/above this host's 13 CPU\(s\)/);
    });

    it("a size worked out here that differs from managed.yml's default says how a hand compose call would undo it, and the one command that keeps it", () => {
      const r = phase(['app'], { env: `${PG}MAX_PASSES_IN_FLIGHT=6\n`, answers: { NCPU: '8' } });
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(
        /managed\.yml's defaults are WORKER_CPUS 2\.5 and WORKER_MEMORY 2816m, so a compose call outside the bring-up \(a hand docker compose up -d\) would recreate the worker at those\. To keep this size there too, set both in \.env: \.\/deploy\/compose\/env-upsert\.sh \S+\/\.env WORKER_CPUS=4 WORKER_MEMORY=4352m/,
      );
      // At the default cap it is managed.yml's own size: nothing to say.
      const same = phase(['app'], { env: PG });
      expect(same.status, same.out).toBe(0);
      expect(same.out).not.toMatch(/managed\.yml's defaults are/);
      // A size .env sets is what any compose call reads: nothing to say either.
      const set = phase(['app'], { env: `${PG}MAX_PASSES_IN_FLIGHT=6\nWORKER_CPUS=4\nWORKER_MEMORY=6400m\n`, answers: { NCPU: '8' } });
      expect(set.out).not.toMatch(/managed\.yml's defaults are/);
    });

    it("app: alpha.16's pinned size at 6 (4 CPUs, 6400m) is kept: one line, no refusal, and the one command that takes the rule", () => {
      const r = phase(['app'], { env: `${PG}MAX_PASSES_IN_FLIGHT=6\nWORKER_CPUS=4\nWORKER_MEMORY=6400m\n`, answers: { NCPU: '8' } });
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/WORKER_CPUS 4, from \.env \(the rule for MAX_PASSES_IN_FLIGHT 6: 4\)/);
      expect(r.out).toMatch(
        /WORKER_MEMORY 6400m, from \.env, is above the rule's 4352m for MAX_PASSES_IN_FLIGHT 6 \(the worker runs at most 8 runs at once\), and is kept as set\. To take the rule: \.\/deploy\/compose\/env-upsert\.sh \S+\/\.env WORKER_MEMORY=4352m$/m,
      );
      expect(r.out.match(/is above the rule's/g)).toHaveLength(1);
      expect(r.out).toMatch(/the worker's memory limit: 6400m, within this host's memory/);
      expect(r.calls.some((c) => / up -d --wait( --force-recreate)? worker/.test(c))).toBe(true);
    });

    it('app: a size .env sets below the rule is kept, and said as a warning', () => {
      const r = phase(['app'], { env: `${PG}WORKER_MEMORY=2g\n` });
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/warning: WORKER_MEMORY 2g, from \.env, is below the rule's 2816m for MAX_PASSES_IN_FLIGHT 3/);
    });

    it('a limit in g or bytes is read as Compose reads it: 4g on a 4 GiB host fits', () => {
      const r = phase(['app'], { env: 'OWNPACE_JOB_RUNNER=pg-boss\nWORKER_MEMORY=4g\n', answers: { MEMTOTAL: String(4 * 1024 ** 3) } });
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/the worker's memory limit: 4g, within this host's memory/);
    });

    it('app: a size .env sets is the one used and checked', () => {
      const r = phase(['app'], { env: `${PG}MAX_PASSES_IN_FLIGHT="6"\nWORKER_CPUS="3"\nWORKER_MEMORY=4g\n`, answers: { NCPU: '4' } });
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/warning: WORKER_CPUS 3, from \.env, is below the rule's 4 for MAX_PASSES_IN_FLIGHT 6/);
      expect(r.out).toMatch(/WORKER_MEMORY 4g, from \.env/);
      expect(r.out).toMatch(/the worker's CPU cap: 3, within this host's CPUs/);
    });

    it('app: the rule\'s size above the host is refused, as a .env value is', () => {
      const r = phase(['app'], { env: `${PG}MAX_PASSES_IN_FLIGHT=6\n`, answers: { NCPU: '2' } });
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/WORKER_CPUS is 4, above this host's 2 CPU\(s\)/);
      expect(r.calls.some((c) => / up -d --wait( --force-recreate)? worker/.test(c))).toBe(false);
    });

    it.each([
      ['spaces', 'LEDGER_RETENTION_DAYS=  # keep a year\n'],
      ['a tab', 'LOG_LEVEL=\t# info\n'],
    ])('app: a worker key whose .env line is empty then a comment after %s is refused, named, and .env left as it was', (_l, line) => {
      const env = `${PG}SOMETHING_ELSE=  # not the worker's\n${line}`;
      const r = phase(['app'], { env });
      expect(r.status).not.toBe(0);
      const key = line.split('=')[0]!;
      expect(r.out).toMatch(new RegExp(`!!! {3}${key}: its line in .* is ${key}= then a space and a # comment`));
      expect(r.out).not.toMatch(/SOMETHING_ELSE/);
      expect(r.out).toMatch(/was not changed; fix each line, then run this again\. The worker was not started\./);
      expect(r.calls.some((c) => / up -d --wait( --force-recreate)? worker/.test(c))).toBe(false);
    });

    it('app: a value with a comment after it, or a # with no space before it, is not that', () => {
      const r = phase(['app'], { env: `${PG}LEDGER_RETENTION_DAYS=365 # a year\nLOG_LEVEL=#info\n` });
      expect(r.status, r.out).toBe(0);
    });

    it("app: builds api, web and worker; starts no service of Trigger.dev's plane; the system role, the CPU cap, then the worker, after the api", () => {
      const r = phase(['app'], { env: PG });
      expect(r.status, r.out).toBe(0);
      const build = r.calls.findIndex((c) => / build /.test(c));
      expect(r.calls[build]).toBe('docker compose -f managed.yml build api web worker');
      const up = r.calls.findIndex((c) => / up -d --wait .*\bapi\b/.test(c));
      expect(r.calls[up]).not.toMatch(/trigger-|minio|clickhouse|worker/);
      const after = r.calls.slice(up + 1);
      expect(after).toEqual([
        'docker compose -f managed.yml ps -q api',
        'system_role_ready',
        'docker info --format {{.NCPU}}',
        'docker info --format {{.MemTotal}}',
        'docker compose -f managed.yml up -d --wait worker',
      ]);
      expect(r.out).toMatch(/the worker's CPU cap: 2\.5, within this host's CPUs \(the rule: 0\.5 x \(MAX_PASSES_IN_FLIGHT \+ 2\) = 2\.5\)/);
    });

    it('app: the worker is built in the api\'s build call, and recreated whenever this run replaced the api (privacy §9)', () => {
      const r = phase(['app'], { env: PG, answers: { API_REPLACED: '1' } });
      expect(r.status, r.out).toBe(0);
      const builds = r.calls.filter((c) => / build /.test(c));
      expect(builds).toEqual(['docker compose -f managed.yml build api web worker']);
      expect(r.calls.at(-1)).toBe('docker compose -f managed.yml up -d --wait --force-recreate worker');
      expect(r.out).toMatch(/the api container was replaced by this run: recreating the worker with it/);
      // The ids were asked around the `up` that replaced the api.
      const up = r.calls.findIndex((c) => / up -d --wait .*\bapi\b/.test(c));
      expect(r.calls[up - 1]).toBe('docker compose -f managed.yml ps -q api');
      expect(r.calls[up + 1]).toBe('docker compose -f managed.yml ps -q api');
    });

    it('app: an api that was not replaced leaves the worker to Compose, which replaces it when its image moved', () => {
      const r = phase(['app'], { env: PG });
      expect(r.status, r.out).toBe(0);
      expect(r.calls.at(-1)).toBe('docker compose -f managed.yml up -d --wait worker');
      expect(r.out).not.toMatch(/recreating the worker/);
    });

    it('app: a worker recreated with the api that never comes up is explained from its own log', () => {
      const r = phase(['app'], { env: PG, answers: { API_REPLACED: '1', WORKER_UP_EXIT: '1' } });
      expect(r.status).not.toBe(0);
      expect(r.calls.at(-1)).toBe('explain_failure worker');
    });

    it('app: an unfit system role stops it before the worker starts, before its URL reaches a run', () => {
      const r = phase(['app'], { env: PG, answers: { ROLE_UNFIT: '1' } });
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/REFUSED, before/);
      expect(r.calls.at(-1)).toBe('system_role_ready');
      expect(r.calls.some((c) => /worker/.test(c) && !/ build /.test(c))).toBe(false);
    });

    it.each([
      ['above the host', 'WORKER_CPUS=8\n', '4', /WORKER_CPUS is 8, above this host's 4 CPU\(s\), and Docker refuses/],
      ['not a number', 'WORKER_CPUS=lots\n', '4', /WORKER_CPUS is 'lots', not a number of CPUs above 0/],
      ['zero', 'WORKER_CPUS=0\n', '4', /not a number of CPUs above 0/],
      ["managed.yml's default above a 2-CPU host", '', '2', /WORKER_CPUS is 2\.5, above this host's 2 CPU/],
    ])('app: a CPU cap %s refuses, in one sentence, before the worker starts', (_l, env, ncpu, why) => {
      const r = phase(['app'], { env: `${PG}${env}`, answers: { NCPU: ncpu } });
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(why);
      expect(r.calls.some((c) => / up -d --wait worker/.test(c))).toBe(false);
    });

    it('app: a worker that never comes up is explained from its own log', () => {
      const r = phase(['app'], { env: PG, answers: { WORKER_UP_EXIT: '1' } });
      expect(r.status).not.toBe(0);
      expect(r.calls.slice(-2)).toEqual(['docker compose -f managed.yml up -d --wait worker', 'explain_failure worker']);
      expect(r.out).not.toMatch(/worker up and healthy/);
    });
  });

  it.each([
    ['--only', 'trigger'],
    ['--only', 'account'],
    ['--from', 'login'],
    ['--from', 'tasks'],
  ])('%s %s: a phase alpha.18 removed is refused in one sentence, before anything runs', (flag, name) => {
    const r = spawnSync(BOOTSTRAP, [flag, name], { env: { ...process.env, HOME: tmpdir() }, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toBe(
      `bootstrap-managed.sh: the phase '${name}' went with Trigger.dev in alpha.18 (workplan 0167 T9); the jobs run in the worker, which the app phase starts. Phases: preflight env data demo plane app smoke\n`,
    );
    expect(r.stdout).toBe('');
  });

  it('--list names the phases alpha.18 runs, the plane phase between the demo and the app', () => {
    const r = spawnSync(BOOTSTRAP, ['--list'], { encoding: 'utf8' });
    expect(r.stdout.trim().split('\n')).toEqual(['preflight', 'env', 'data', 'demo', 'plane', 'app', 'smoke']);
  });

  it.each([
    ['both', /^!!! OWNPACE_JOB_RUNNER in this shell's environment is not pg-boss \(its value is not printed\)/m],
    ['trigger', /^!!! OWNPACE_JOB_RUNNER in this shell's environment is trigger, but Trigger\.dev was removed in alpha\.18/m],
  ])('a switch of %s stops the bring-up before any phase runs', (value, why) => {
    const d = mkdtempSync(join(tmpdir(), 'bring-up-bad-mode-'));
    try {
      const compose = join(d, 'deploy', 'compose');
      cpSync(join(REPO_ROOT, 'deploy', 'compose'), compose, { recursive: true, filter: (src) => !src.endsWith('/.env') });
      const r = spawnSync(join(compose, 'bootstrap-managed.sh'), ['--only', 'smoke'], {
        env: { ...process.env, OWNPACE_JOB_RUNNER: value, HOME: d },
        encoding: 'utf8',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(why);
      expect(r.stdout).not.toMatch(/=== \[smoke\]/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
