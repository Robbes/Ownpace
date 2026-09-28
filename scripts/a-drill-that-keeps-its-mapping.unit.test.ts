/**
 * The upgrade drill's appliances start with the mapping the drill wrote for them
 * (workplan 0146's Status, 0025 T5).
 *
 * The first drill across a real version gap (v0.1.0-rc.1 to main, 2026-09-28)
 * stopped at step 1 with "the released appliance configured NO mappings". The
 * drill had three defects of its own, none of them run since 2026-08-04:
 *
 * - Step 1 called `cleanup`, whose last line removes the config directory, right
 *   after the mapping had been copied into it. Docker then created the missing
 *   mount source itself, empty and owned by root, and the run's own `rm` could
 *   not remove it afterwards.
 * - The directory was mounted read-only at /data/config. The launcher of every
 *   build since 2026-08-06 (`start.mjs`, scripts/package-appliance.mjs) writes a
 *   probe file there before it starts and exits when it cannot, so the upgraded
 *   appliance would never have come up. rc.1 has no probe.
 * - The file's mode was whatever the umask gave it, and the appliance runs as
 *   appuser (uid 10001), neither its owner nor in its group.
 *
 * The drill runs here against a throwaway repository holding the real
 * `deploy/selfhost/compose.drill.yml`, with `docker`, `curl` and `sleep` as
 * stubs on the PATH. The docker stub reads the drill's config mount from that
 * file and plays each appliance at `up`: both need the mapping readable by a
 * process that is neither its owner nor in its group, and the upgraded one also
 * needs /data/config writable, which a read-only directory mount is not. An
 * appliance that cannot start never answers /healthz, as a crash loop does.
 * The drill runs under umask 077, so no mode comes for free.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRILL = readFileSync(join(REPO_ROOT, 'scripts/upgrade-drill.sh'), 'utf8');
const DRILL_YML = readFileSync(join(REPO_ROOT, 'deploy/selfhost/compose.drill.yml'), 'utf8');

const TAG = 'v9.9.9-rc.1';
const TAG_MAPPING_ID = '11111111-1111-4111-8111-111111111111';
const HEAD_MAPPING_ID = '22222222-2222-4222-8222-222222222222';
const HEAD_IMAGE = 'ownpace-selfhost:upgrade-drill-head';

// `up` of either appliance. What the container would see of the drill's mount
// comes from the mount line in compose.drill.yml: the file alone, or the whole
// directory, read-only or not.
const DOCKER_STUB = `#!/usr/bin/env bash
echo "docker $*" >>"$STUB_LOG"
others_can() { [ -n "$(find "$2" -maxdepth 0 -perm "-$1" 2>/dev/null)" ]; }
case " $* " in
  *" up "*)
    d="$DRILL_CONFIG_DIR"; f="$d/mapping.json"
    line="$(grep -E '^[[:space:]]*- [$][{]DRILL_CONFIG_DIR' "$PWD/deploy/selfhost/compose.drill.yml")"
    case "$line" in
      *'/mapping.json:/data/config/mapping.json'*) readable=file; writable=yes ;;
      *':/data/config:ro'*) readable=dir; writable=no ;;
      *':/data/config'*) readable=dir; others_can 002 "$d" && writable=yes || writable=no ;;
      *) echo "stub: no config mount in compose.drill.yml" >&2; exit 1 ;;
    esac
    ok=yes
    [ -f "$f" ] && others_can 004 "$f" || ok=no
    [ "$readable" = dir ] && ! others_can 005 "$d" && ok=no
    if [ "\${SELFHOST_IMAGE}" = "${HEAD_IMAGE}" ] && [ "$writable" = no ]; then ok=no; fi
    if [ "$ok" = yes ]; then
      if [ "\${SELFHOST_IMAGE}" != "${HEAD_IMAGE}" ]; then
        grep -o '"mappingId": *"[^"]*"' "$f" | head -n 1 | sed 's/.*"\\([^"]*\\)"$/\\1/' >"$STUB_STATE"
      fi
      echo up >"$STUB_HEALTH"
    else
      echo down >"$STUB_HEALTH"
    fi ;;
  *" logs "*) echo "app  | [selfhost] applying migrations" ;;
esac
exit 0
`;

const CURL_STUB = `#!/usr/bin/env bash
url="\${@: -1}"
[ "$(cat "$STUB_HEALTH" 2>/dev/null)" = up ] || exit 7
case "$url" in
  */healthz) exit 0 ;;
  */status)
    id="$(cat "$STUB_STATE" 2>/dev/null)"
    if [ -n "$id" ]; then
      printf '{"status":"ok","mappings":[{"mappingId":"%s"}]}' "$id"
    else
      printf '{"status":"ok","mappings":[]}'
    fi ;;
esac
exit 0
`;

const SLEEP_STUB = '#!/usr/bin/env bash\nexit 0\n';

function example(mappingId: string): string {
  return JSON.stringify({ _note: 'drill fixture', tenantId: '00000000-0000-4000-8000-000000000001', mappingId }, null, 2);
}

let root: string;

/** Nothing of the machine's git reaches the fixture: no global or system config, no GIT_* variables. */
function isolatedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.test',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.test',
    LANG: 'C',
    ...extra,
  };
}

function git(repo: string, ...args: string[]): void {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: isolatedEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

/** A repository whose tag carries one migration and its own example, and whose working tree carries two and another. */
function makeRepo(name: string, script: string, drillYml: string): string {
  const repo = join(root, name);
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, 'packages/ledger/migrations'), { recursive: true });
  mkdirSync(join(repo, 'deploy/selfhost/config'), { recursive: true });
  writeFileSync(join(repo, 'packages/ledger/migrations/0001_first.sql'), 'SELECT 1;\n');
  writeFileSync(join(repo, 'deploy/selfhost/config/mapping.json.example'), example(TAG_MAPPING_ID));
  writeFileSync(join(repo, 'deploy/selfhost/compose.drill.yml'), drillYml);
  writeFileSync(join(repo, 'scripts/upgrade-drill.sh'), script);
  chmodSync(join(repo, 'scripts/upgrade-drill.sh'), 0o755);
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'the release');
  git(repo, 'tag', TAG);
  writeFileSync(join(repo, 'packages/ledger/migrations/0002_second.sql'), 'SELECT 2;\n');
  writeFileSync(join(repo, 'deploy/selfhost/config/mapping.json.example'), example(HEAD_MAPPING_ID));
  return repo;
}

function runDrill(name: string, script: string, drillYml: string = DRILL_YML) {
  const repo = makeRepo(name, script, drillYml);
  const bin = join(root, `${name}-bin`);
  const tmp = join(root, `${name}-tmp`);
  mkdirSync(bin);
  mkdirSync(tmp);
  for (const [tool, body] of [
    ['docker', DOCKER_STUB],
    ['curl', CURL_STUB],
    ['sleep', SLEEP_STUB],
  ] as const) {
    writeFileSync(join(bin, tool), body);
    chmodSync(join(bin, tool), 0o755);
  }
  const state = join(root, `${name}-state`);
  const script_ = join(repo, 'scripts/upgrade-drill.sh');
  const r = spawnSync('bash', ['-c', 'umask 077; exec bash "$0" "$@"', script_, TAG], {
    cwd: repo,
    encoding: 'utf8',
    env: isolatedEnv({
      PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
      TMPDIR: tmp,
      STUB_LOG: join(root, `${name}-docker.log`),
      STUB_STATE: state,
      STUB_HEALTH: join(root, `${name}-health`),
    }),
  });
  let configured: string;
  try {
    configured = readFileSync(state, 'utf8').trim();
  } catch {
    configured = '(never configured)';
  }
  return { ...r, out: `${r.stdout}\n${r.stderr}`, configured, tmpLeft: readdirSync(tmp) };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'drill-mapping-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the upgrade drill keeps the mapping it wrote, where both appliances can use it', () => {
  it('passes across the gap, the released appliance configuring the example the tag shipped', () => {
    const r = runDrill('fixed', DRILL);
    expect(r.out).not.toContain('DRILL FAILED');
    expect(r.status).toBe(0);
    expect(r.out).toContain('DRILL PASSED');
    expect(r.out).toContain('Upgraded across 1 migration(s), in place, on the released artifact.');
    expect(r.configured).toBe(TAG_MAPPING_ID);
    // The config directory is removed on exit, and nothing else was left behind.
    expect(r.tmpLeft).toEqual([]);
  }, 30_000);

  it('the old step 1, which removed the mapping it had just written, is stopped before the appliance starts', () => {
    const old = DRILL.replace(/^down_project( +# a stale drill project would poison the result)$/m, 'cleanup$1');
    expect(old).not.toBe(DRILL);
    const r = runDrill('old-step-one', old);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("the drill's own mapping is missing from");
    expect(r.configured).toBe('(never configured)');
  }, 30_000);

  it('without the file mode, the released appliance cannot read its config and never comes up', () => {
    const noMode = DRILL.replace(/^chmod 644 "\$DRILL_CONFIG_DIR\/mapping\.json"\n/m, '');
    expect(noMode).not.toBe(DRILL);
    const r = runDrill('no-mode', noMode);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('released appliance never became healthy');
  }, 30_000);

  it('with the directory mounted read-only, as before, the upgraded appliance cannot write its probe and never comes up', () => {
    const dirRo = DRILL_YML.replace(
      /^(\s*- \$\{DRILL_CONFIG_DIR:\?[^}]*\})\/mapping\.json:\/data\/config\/mapping\.json:ro$/m,
      '$1:/data/config:ro',
    );
    expect(dirRo).not.toBe(DRILL_YML);
    // The released appliance still reads it, since the old mount and a readable
    // directory are all rc.1 needs; the directory is opened up for it here.
    const r = runDrill('dir-read-only', DRILL.replace(/^chmod 644 /m, 'chmod 755 "$DRILL_CONFIG_DIR"\nchmod 644 '), dirRo);
    expect(r.configured).toBe(TAG_MAPPING_ID);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('upgraded appliance never became healthy');
  }, 30_000);
});
