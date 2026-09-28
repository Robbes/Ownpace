// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PIN THAT KNOWS IT IS BEHIND: nothing said when upstream fixed a hole the
 * pinned identity provider still had (workplan 0135 T7 (b)).
 *
 * The identity provider is pinned in `managed.yml`, and Dependabot ignores it
 * by name, because an upgrade moves its schema one way and is the owner's call.
 * So nothing said when upstream moved on. v4.18.0 fixed GHSA-4hgj-wm6c-q7p2,
 * a rename of any account through login v1, on 2026-09-21, and a week later
 * this stack still ran v4.17.3. A person reading release notes found it.
 *
 * `scripts/idp-pin-watch.mjs` now compares the pin with upstream's newest
 * release of the same major once a week, and keeps one issue open while the
 * two differ. This holds what it compares, how it orders tags, the one issue,
 * and the workflow that runs it. The tag list is stubbed, and so is `gh`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  COMPOSE,
  ISSUE_TITLE,
  WINDOW_DAYS,
  compareTags,
  comparePin,
  issueBody,
  keepIssue,
  newestRelease,
  readPin,
} from './idp-pin-watch.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANAGED_YML = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8');
const WORKFLOW_FILE = '.github/workflows/idp-pin-watch.yml';
const WORKFLOW = readFileSync(join(REPO_ROOT, WORKFLOW_FILE), 'utf8');

/** `git ls-remote --tags --refs` output: releases, a pre-release, and two other majors. */
const LS_REMOTE = [
  'a1\trefs/tags/v3.4.9',
  'a2\trefs/tags/v4.9.0',
  'a3\trefs/tags/v4.17.1',
  'a4\trefs/tags/v4.17.3',
  'a5\trefs/tags/v4.18.0',
  'a6\trefs/tags/v4.19.0',
  'a7\trefs/tags/v4.19.1',
  'a8\trefs/tags/v4.20.0-rc.1',
  'a9\trefs/tags/v5.1.0',
].join('\n');

type Issue = { number: number; title: string; body: string; state: 'open' | 'closed' };

/**
 * A `gh` that answers `issue list` from `issues` as the real one would: only
 * the state asked for, and only the fields asked for. Every other call is
 * recorded.
 */
function fakeGh(issues: Issue[]) {
  const calls: string[][] = [];
  const gh = (args: string[]) => {
    if (args[0] === 'issue' && args[1] === 'list') {
      const state = args[args.indexOf('--state') + 1];
      const fields = (args[args.indexOf('--json') + 1] ?? '').split(',');
      const listed = issues.filter((i) => state === 'all' || i.state === state);
      return JSON.stringify(listed.map((i) => Object.fromEntries(fields.map((f) => [f, i[f as keyof Issue]]))));
    }
    calls.push(args);
    return '';
  };
  return { gh, calls };
}

const OTHER: Issue = { number: 7, title: 'Something else', body: 'x', state: 'open' };

describe('what it compares', () => {
  it('reads the pin from managed.yml itself, its one image line for the identity provider', () => {
    expect(COMPOSE).toBe('deploy/compose/managed.yml');
    const lines = [...MANAGED_YML.matchAll(/^\s*image:\s*ghcr\.io\/zitadel\/zitadel:(\S+)\s*$/gm)];
    expect(lines).toHaveLength(1);
    expect(readPin(MANAGED_YML)).toBe(lines[0]![1]);
    expect(readPin(MANAGED_YML)).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('refuses a file with no pin, with two, or with a tag that is not a release', () => {
    const line = '    image: ghcr.io/zitadel/zitadel:v4.19.1\n';
    expect(() => readPin('services: {}\n')).toThrow(/0 times/);
    expect(() => readPin(line + line)).toThrow(/2 times/);
    expect(() => readPin('    image: ghcr.io/zitadel/zitadel:latest\n')).toThrow(/not a release tag/);
  });

  it('reports behind for v4.17.3 when upstream has v4.19.1, and names the newest', () => {
    expect(comparePin('v4.17.3', LS_REMOTE)).toEqual({ pin: 'v4.17.3', newest: 'v4.19.1', state: 'behind' });
  });

  it('reports current when the pin is the newest release', () => {
    expect(comparePin('v4.19.1', LS_REMOTE)).toEqual({ pin: 'v4.19.1', newest: 'v4.19.1', state: 'current' });
  });

  it('orders tags by their numbers, not their text: v4.10.0 is newer than v4.9.0', () => {
    expect(compareTags('v4.9.0', 'v4.10.0')).toBeLessThan(0);
    expect(newestRelease(4, 'x\trefs/tags/v4.10.0\ny\trefs/tags/v4.9.0')).toBe('v4.10.0');
    expect(comparePin('v4.9.0', 'x\trefs/tags/v4.10.0\ny\trefs/tags/v4.9.0').state).toBe('behind');
  });

  it('counts neither a pre-release nor another major as the newest release', () => {
    expect(newestRelease(4, LS_REMOTE)).toBe('v4.19.1');
  });

  it('calls a pin current only against a release it read: none of its major is an error', () => {
    expect(() => comparePin('v4.19.1', 'a1\trefs/tags/v3.4.9\na9\trefs/tags/v5.1.0')).toThrow(/no v4 release/);
    expect(() => comparePin('v4.19.1', '')).toThrow(/no v4 release/);
  });

  it('says so when the pin is ahead of every release', () => {
    expect(comparePin('v4.99.0', LS_REMOTE).state).toBe('ahead');
  });
});

describe('the one issue', () => {
  const behind = { pin: 'v4.17.3', newest: 'v4.19.1', state: 'behind' as const };
  const current = { pin: 'v4.19.1', newest: 'v4.19.1', state: 'current' as const };
  const watch = (body: string, state: Issue['state'] = 'open'): Issue => ({ number: 42, title: ISSUE_TITLE, body, state });

  it('opens one when the pin is behind and none is open', () => {
    const { gh, calls } = fakeGh([OTHER]);
    expect(keepIssue(behind, gh)).toBe('opened');
    expect(calls).toEqual([['issue', 'create', '--title', ISSUE_TITLE, '--body', issueBody(behind)]]);
  });

  it('opens a new one when the only one with its title was closed: a new time behind', () => {
    const { gh, calls } = fakeGh([OTHER, watch(issueBody(behind), 'closed')]);
    expect(keepIssue(behind, gh)).toBe('opened');
    expect(calls.map((c) => c.slice(0, 2))).toEqual([['issue', 'create']]);
  });

  it('brings the open one up to date instead of opening a second, and says the newer release in a comment', () => {
    const { gh, calls } = fakeGh([OTHER, watch(issueBody({ pin: 'v4.17.3', newest: 'v4.19.0' }))]);
    expect(keepIssue(behind, gh)).toBe('updated');
    expect(calls).toEqual([
      ['issue', 'edit', '42', '--body', issueBody(behind)],
      ['issue', 'comment', '42', '--body', "The pin is v4.17.3, and upstream's newest release is now **v4.19.1**."],
    ]);
  });

  it('writes nothing in a week with nothing new, whatever line endings GitHub hands back', () => {
    for (const body of [issueBody(behind), issueBody(behind).replace(/\n/g, '\r\n') + '\r\n']) {
      const { gh, calls } = fakeGh([OTHER, watch(body)]);
      expect(keepIssue(behind, gh)).toBe('unchanged');
      expect(calls).toEqual([]);
    }
  });

  it('closes it once the pin is current, and leaves every other issue alone', () => {
    const { gh, calls } = fakeGh([OTHER, watch(issueBody(behind))]);
    expect(keepIssue(current, gh)).toBe('closed');
    expect(calls).toEqual([['issue', 'close', '42', '--comment', 'The pin is current again: v4.19.1.']]);
  });

  it('writes nothing when the pin is current and nothing is open', () => {
    const { gh, calls } = fakeGh([OTHER, watch(issueBody(behind), 'closed')]);
    expect(keepIssue(current, gh)).toBe('untouched');
    expect(calls).toEqual([]);
  });

  it('names both versions, the seven-day window and the route an upgrade takes', () => {
    expect(WINDOW_DAYS).toBe(7);
    const body = issueBody(behind);
    expect(body).toContain('**v4.17.3**');
    expect(body).toContain('**v4.19.1**');
    expect(body).toContain('https://github.com/zitadel/zitadel/releases/tag/v4.19.1');
    expect(body).toContain('within 7 days');
    expect(body).toMatch(/Dump the OTA instance's `zitadel` database by hand first/);
    expect(body).toMatch(/Its own pull request moves the pin/);
    expect(body).toMatch(/E2E \(managed\) on that branch/);
    expect(body).toMatch(/Live takes it from a release tag/);
  });

  it('points at the dump script, which exists and dumps the identity provider\'s database', () => {
    const body = issueBody(behind);
    expect(body).toContain('`./deploy/compose/dump-idp.sh`');
    const script = readFileSync(join(REPO_ROOT, 'deploy/compose/dump-idp.sh'), 'utf8');
    expect(script).toMatch(/pg_dump [^\n]*--format=custom/);
    expect(script).toMatch(/ZITADEL_DB_NAME/);
  });
});

describe(`${WORKFLOW_FILE}`, () => {
  const workflow = parseYaml(WORKFLOW) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<string, { 'runs-on': string; steps: Array<{ run?: string; env?: Record<string, string>; with?: Record<string, unknown>; uses?: string }> }>;
  };

  it('runs once a week and on demand, and never on a pull request or a push', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    const crons = (workflow.on.schedule as Array<{ cron: string }>).map((s) => s.cron);
    expect(crons).toHaveLength(1);
    const fields = crons[0]!.trim().split(/\s+/);
    expect(fields).toHaveLength(5);
    expect(fields[4], 'one day of the week, so once a week').toMatch(/^[0-6]$/);
  });

  it('may read the code and write issues, and nothing else', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', issues: 'write' });
  });

  it("runs on a GitHub-hosted runner, never on the machine it watches, and keeps the issue with the script", () => {
    const jobs = Object.values(workflow.jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!['runs-on']).toMatch(/^ubuntu-/);
    const runs = jobs[0]!.steps.filter((s) => s.run);
    expect(runs.map((s) => s.run!.trim())).toEqual(['node scripts/idp-pin-watch.mjs --issue']);
    expect(runs[0]!.env).toMatchObject({ GH_TOKEN: '${{ github.token }}' });
    const checkout = jobs[0]!.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });
});
