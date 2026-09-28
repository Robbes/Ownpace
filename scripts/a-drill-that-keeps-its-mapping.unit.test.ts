/**
 * The upgrade drill's released appliance starts with the mapping the drill wrote
 * for it (workplan 0146 T0, 0025 T5).
 *
 * The first drill across a real version gap (v0.1.0-rc.1 to main, 2026-09-28)
 * stopped at step 1 with "the released appliance configured NO mappings". Two
 * defects in the drill itself, both there since 2026-08-04:
 *
 * - Step 1 called `cleanup`, whose last line removes the config directory, right
 *   after the mapping had been copied into it. Docker then created the missing
 *   mount source itself, empty and owned by root, and the run's own `rm` could
 *   not remove it afterwards.
 * - `mktemp -d` makes a directory only its owner can enter, and the appliance
 *   runs as appuser (uid 10001). With the deletion fixed, the mount would have
 *   been there and unreadable.
 *
 * The drill runs here against a throwaway repository with `docker` and `curl`
 * as stubs on the PATH. The docker stub plays the released appliance at `up`:
 * it configures the mapping only when a process that is neither the file's
 * owner nor in its group could read it, which is uid 10001's position. The curl
 * stub reports what it configured. Two variants of the script show what each
 * change is for: the old step 1, and the script without its two modes.
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

const TAG = 'v9.9.9-rc.1';
const TAG_MAPPING_ID = '11111111-1111-4111-8111-111111111111';
const HEAD_MAPPING_ID = '22222222-2222-4222-8222-222222222222';

const DOCKER_STUB = `#!/usr/bin/env bash
echo "docker $*" >>"$STUB_LOG"
case " $* " in
  *" up "*)
    if [ "\${SELFHOST_IMAGE}" != "ownpace-selfhost:upgrade-drill-head" ]; then
      d="$DRILL_CONFIG_DIR"; f="$d/mapping.json"
      if [ -f "$f" ] && [ -n "$(find "$d" -maxdepth 0 -perm -001)" ] && [ -n "$(find "$f" -maxdepth 0 -perm -004)" ]; then
        grep -o '"mappingId": *"[^"]*"' "$f" | head -n 1 | sed 's/.*"\\([^"]*\\)"$/\\1/' >"$STUB_STATE"
      else
        : >"$STUB_STATE"
      fi
    fi ;;
  *" logs "*) echo "app  | running migrations" ;;
esac
exit 0
`;

const CURL_STUB = `#!/usr/bin/env bash
url="\${@: -1}"
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

function example(mappingId: string): string {
  return JSON.stringify({ _note: 'drill fixture', tenantId: '00000000-0000-4000-8000-000000000001', mappingId }, null, 2);
}

let root: string;

function git(repo: string, ...args: string[]): void {
  const r = spawnSync('git', ['-c', 'user.email=drill@example.com', '-c', 'user.name=drill', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

/** A repository whose tag carries one migration and its own example, and whose working tree carries two and another. */
function makeRepo(name: string, script: string): string {
  const repo = join(root, name);
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, 'packages/ledger/migrations'), { recursive: true });
  mkdirSync(join(repo, 'deploy/selfhost/config'), { recursive: true });
  writeFileSync(join(repo, 'packages/ledger/migrations/0001_first.sql'), 'SELECT 1;\n');
  writeFileSync(join(repo, 'deploy/selfhost/config/mapping.json.example'), example(TAG_MAPPING_ID));
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

function runDrill(name: string, script: string) {
  const repo = makeRepo(name, script);
  const bin = join(root, `${name}-bin`);
  const tmp = join(root, `${name}-tmp`);
  mkdirSync(bin);
  mkdirSync(tmp);
  writeFileSync(join(bin, 'docker'), DOCKER_STUB);
  writeFileSync(join(bin, 'curl'), CURL_STUB);
  chmodSync(join(bin, 'docker'), 0o755);
  chmodSync(join(bin, 'curl'), 0o755);
  const state = join(root, `${name}-state`);
  const r = spawnSync('bash', [join(repo, 'scripts/upgrade-drill.sh'), TAG], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: tmp,
      STUB_LOG: join(root, `${name}-docker.log`),
      STUB_STATE: state,
    },
  });
  let configured: string;
  try {
    configured = readFileSync(state, 'utf8').trim();
  } catch {
    configured = '(never started)';
  }
  return { ...r, out: `${r.stdout}\n${r.stderr}`, configured, tmpLeft: readdirSync(tmp) };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'drill-mapping-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the upgrade drill keeps the mapping it wrote for the released appliance', () => {
  it('passes across the gap with the mapping the released appliance could read', () => {
    const r = runDrill('fixed', DRILL);
    expect(r.out).not.toContain('DRILL FAILED');
    expect(r.status).toBe(0);
    expect(r.out).toContain('DRILL PASSED');
    expect(r.out).toContain('Upgraded across 1 migration(s), in place, on the released artifact.');
    // The example the tag shipped, the file an operator of that release copied.
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
    expect(r.configured).toBe('(never started)');
  }, 30_000);

  it('without the two modes the released appliance configures nothing, and the drill says so', () => {
    const noModes = DRILL.replace(/^chmod 755 "\$DRILL_CONFIG_DIR"\n/m, '').replace(
      /^chmod 644 "\$DRILL_CONFIG_DIR\/mapping\.json"\n/m,
      '',
    );
    expect(noModes).not.toBe(DRILL);
    const r = runDrill('no-modes', noModes);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('the released appliance configured NO mappings');
    expect(r.configured).toBe('');
  }, 30_000);
});
