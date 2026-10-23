// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RELEASE PREFLIGHT THAT SAID YES TOO SOON: on 2026-10-22 the names check passed `v0.2.0-alpha.2` while `CHANGELOG.md`'s `[Unreleased]` still held about 170 lines above a section dated 2026-10-11 (workplan 0146 T2, the fold not done).
 *
 * ## What it is
 *
 * `scripts/release-preflight.mjs` is the first job of the Release workflow.
 * It reads, writes nothing, and prints one line per check, `pass` or
 * `refuse`, so the owner sees every reason at once instead of the first. In
 * release mode one refusal stops the run before anything is written; in
 * preflight mode the run is red with the list; in rehearse mode the list is
 * carried to the end of the run, which then says the real run would have
 * stopped there.
 *
 * ## The order, and why (the critique of 2026-10-22)
 *
 * 1. `resolve`: the inputs; dispatched from `main`; the commit (given, or the
 *    one the nights pick, or the existing tag's in verify mode); the release
 *    before it; and whether the commit is on `main`'s first-parent line, by
 *    `git merge-base` BEFORE a worktree is made, so a commit that is not on
 *    `main` is a refusal and not a git error.
 * 2. `names`, a step of its own with no token in it: the candidate's own
 *    `release-names-agree.mjs`. A process can read its parent's environment,
 *    so the token is kept out of the step, not only out of the spawn (the
 *    review of 2026-10-23).
 * 3. `check`, with the candidate checked out beside `main`: the tag is free
 *    (or Release's own, at the commit), no branch is named like it, the API
 *    contract's version, the changelog folded, CI's push run on the commit
 *    with lint, unit, UI and integration actually run, Security Scan's push
 *    run on it, and the nights.
 * 4. The install, with no token in the step.
 * 5. `callees`: the workflows Release will dispatch, read from the
 *    candidate with the candidate's own YAML parser (`createRequire`), offer
 *    the inputs Release passes.
 * 6. The upgrade gates (`release-upgrade-gates.mjs`).
 * 7. `verdict`: counts, and refuses any check that should have run and did
 *    not, and any step that ended in an error rather than a line.
 *
 * ## What this test holds
 *
 * Each check refuses the shape that would have let a bad tag through, on
 * real inputs where there are any: `main`'s `CHANGELOG.md` as it stood on
 * 2026-10-23, frozen (entries under `[Unreleased]`, a section twelve days
 * old), `main`'s `openapi.yaml`, CI's jobs of run 39866562875, the workflows
 * as they are. And in rehearse mode it carries the record's refusals to the
 * end of the run, but never one that says which commit this is: a commit
 * that is not on `main` never reaches the gate scan.
 *
 * ## The open code-scanning alerts, read whole and grouped (2026-10-23)
 *
 * The preflight's first run printed one count, *"67 critical and 100 high
 * code-scanning alert(s) open on main"*, and the 100 was the page size: it
 * read one page of each severity. A count is no triage either: nobody can
 * tell from it whether the repository's own lockfile or one of the 26 images
 * of the weekly scan holds them. So the alerts are read page by page
 * (`getAll` in `scripts/release-github.mjs`, a cap that refuses to stop
 * silently), kept only as far as the whitelist `slimAlert` keeps them (the
 * API's alert names the accounts that dismissed it or were assigned it), and
 * printed as one note per tool and analysis category, with each group's most
 * alerted rule ids and, for an image scan's category, the image. Still a
 * note, never a refusal (the owner's decision 11). The alerts it is held
 * against, `scripts/fixtures/release/code-scanning-alerts-hand-made.json`,
 * are written by hand in the API's shape and passed through `slimAlert`: the
 * session that wrote them had a token code scanning answers 403 ("Resource
 * not accessible by integration"). The categories are the real ones (the
 * repository scan's, and `trivy-image-<name>` for images the weekly scan
 * lists); the rule ids and their counts are illustrative.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  MODES,
  REQUIRED_CI_JOBS,
  validateInputs,
  dispatchedFromMain,
  previousTag,
  candidateOnMain,
  changelogFolded,
  openapiAgrees,
  ciGreen,
  scanGreenOnMain,
  tagFree,
  refUnambiguous,
  calleesDispatchable,
  approvalNote,
  alertsNote,
  alertsNotes,
  alertGroups,
  readOpenAlerts,
  REPOSITORY_SCAN_CATEGORY,
  TOP_RULES,
  candidateEnv,
  verdict,
} from './release-preflight.mjs';
import type { Line, Alert } from './release-preflight.mjs';
import { tagDecision } from './release-cut-tag.mjs';
import { ALERT_FIELDS, ALERT_INSTANCE_FIELDS, ALERT_RULE_FIELDS, ALERT_TOOL_FIELDS, getAll, slimAlert } from './release-github.mjs';
import type { Client } from './release-github.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const fixture = <T>(name: string): T => JSON.parse(read(`scripts/fixtures/release/${name}`)) as T;

const C = '721c6ea82bf0214e2d132c37e84d8da2d43247bc';
const OTHER = '91b49de91f1ce654b103a5a1b5485aba8926b349';
const V = 'v0.2.0-alpha.2';
const kinds = (lines: Line[]) => lines.map((l) => l.kind);
const refused = (lines: Line[]) => lines.filter((l) => l.kind === 'refuse');

describe('the inputs', () => {
  it('knows the five modes', () => {
    expect(MODES).toEqual(['preflight', 'rehearse', 'rehearse-tag', 'release', 'verify']);
  });

  it('takes a v and a SemVer version, a full commit or none, and a known mode', () => {
    expect(refused(validateInputs({ version: V, commit: '', mode: 'release' }))).toEqual([]);
    expect(refused(validateInputs({ version: V, commit: C, mode: 'rehearse' }))).toEqual([]);
    expect(refused(validateInputs({ version: '0.2.0-alpha.2', commit: '', mode: 'release' }))).toHaveLength(1);
    expect(refused(validateInputs({ version: 'v0.2', commit: '', mode: 'release' }))).toHaveLength(1);
    expect(refused(validateInputs({ version: V, commit: '721c6ea8', mode: 'release' }))).toHaveLength(1);
    expect(refused(validateInputs({ version: V, commit: '', mode: 'ship' }))).toHaveLength(1);
  });

  it('runs from main, as main has it', () => {
    const repository = 'Robbes/Ownpace';
    const at = (ref: string) => `${repository}/.github/workflows/release.yml@${ref}`;
    expect(dispatchedFromMain({ ref: 'refs/heads/main', workflowRef: at('refs/heads/main'), repository }).kind).toBe('pass');
    expect(dispatchedFromMain({ ref: 'refs/heads/edited', workflowRef: at('refs/heads/edited'), repository }).kind).toBe('refuse');
  });

  it('finds the release before this one, by SemVer, among the release tags only', () => {
    const tags = ['v0.1.0-rc.1', 'v0.2.0-alpha.1', 'v0.2.0-alpha.2', 'rehearsal-3', 'vnext'];
    expect(previousTag(tags, V)).toBe('v0.2.0-alpha.1');
    expect(previousTag(tags, 'v0.2.0-alpha.1')).toBe('v0.1.0-rc.1');
    expect(previousTag(['v0.2.0-alpha.2'], V)).toBeNull();
  });
});

describe('the commit', () => {
  it('is on main’s own line: an ancestor of main, and on its first-parent history', () => {
    expect(candidateOnMain({ commit: C, isAncestor: true, firstParent: true }).kind).toBe('pass');
    expect(candidateOnMain({ commit: C, isAncestor: false, firstParent: false }).kind).toBe('refuse');
    // A commit from a merged branch is an ancestor and never was main.
    expect(candidateOnMain({ commit: C, isAncestor: true, firstParent: false }).kind).toBe('refuse');
  });

  it('a tag already at another commit, or a lightweight one, refuses; a free name passes', () => {
    expect(tagFree(tagDecision({ ref: null, tagObject: null, commit: C, releaseRun: null, version: V })).kind).toBe('pass');
    const lightweight = { ref: `refs/tags/${V}`, object: { type: 'commit', sha: C } };
    expect(tagFree(tagDecision({ ref: lightweight, tagObject: null, commit: C, releaseRun: null, version: V })).kind).toBe('refuse');
    const annotated = { ref: `refs/tags/${V}`, object: { type: 'tag', sha: 'f'.repeat(40) } };
    const elsewhere = { sha: 'f'.repeat(40), message: 'Ownpace', object: { type: 'commit', sha: OTHER } };
    expect(tagFree(tagDecision({ ref: annotated, tagObject: elsewhere, commit: C, releaseRun: null, version: V })).kind).toBe('refuse');
  });

  it('a branch named like the tag makes the dispatch ref ambiguous, and a gate branch elsewhere is not ours', () => {
    expect(kinds(refUnambiguous({ version: V, commit: C, branch: null, gate: null }))).toEqual(['pass']);
    expect(refused(refUnambiguous({ version: V, commit: C, branch: { object: { sha: C } }, gate: null }))).toHaveLength(1);
    expect(refused(refUnambiguous({ version: V, commit: C, branch: null, gate: { object: { sha: OTHER } } }))).toHaveLength(1);
    expect(refused(refUnambiguous({ version: V, commit: C, branch: null, gate: { object: { sha: C } } }))).toEqual([]);
  });
});

describe('the changelog is folded (the owner’s rule: [Unreleased] empty, the section dated the day of the fold)', () => {
  // main's CHANGELOG.md as it stood on 2026-10-23 (`a5ae29d1`), through the
  // alpha.2 heading, frozen: the fold this file asks for changes the live
  // one, and a guard that read it would go red on the fold's own pull request.
  it('refuses main’s CHANGELOG.md as it stood on 2026-10-23: entries under [Unreleased], and a section twelve days old', () => {
    const lines = changelogFolded(read('scripts/fixtures/release/changelog-2026-10-23.md'), V, '2026-10-23');
    const said = refused(lines).map((l) => l.sentence).join('\n');
    expect(said).toMatch(/\[Unreleased\] still holds \d+ lines/);
    expect(said).toMatch(/dated 2026-10-11, 12 days before/);
  });

  it('answers for the live CHANGELOG.md at every stage, before the fold and after it', () => {
    const root = (JSON.parse(read('package.json')) as { version: string }).version;
    const lines = changelogFolded(read('CHANGELOG.md'), `v${root}`, new Date());
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.check === 'changelog-folded')).toBe(true);
  });

  const folded = (date: string, unreleased = '') =>
    `# Changelog\n\n## [Unreleased]\n${unreleased}\n## [0.2.0-alpha.2] - ${date}\n\n### Added\n\n- something\n\n## [0.2.0-alpha.1] - 2026-10-07\n`;

  it('passes a fold dated within the week before the run, or the day after (the owner’s own time zone)', () => {
    expect(refused(changelogFolded(folded('2026-10-24'), V, '2026-10-26'))).toEqual([]);
    expect(refused(changelogFolded(folded('2026-10-19'), V, '2026-10-26'))).toEqual([]);
    expect(refused(changelogFolded(folded('2026-10-27'), V, '2026-10-26'))).toEqual([]);
    expect(refused(changelogFolded(folded('2026-10-18'), V, '2026-10-26'))).toHaveLength(1);
    expect(refused(changelogFolded(folded('2026-10-28'), V, '2026-10-26'))).toHaveLength(1);
  });

  it('a heading with nothing under it is not an entry; a line is', () => {
    expect(refused(changelogFolded(folded('2026-10-24', '\n### Added\n\n'), V, '2026-10-26'))).toEqual([]);
    expect(refused(changelogFolded(folded('2026-10-24', '\n- a late fix\n'), V, '2026-10-26'))).toHaveLength(1);
  });

  it('a version with no section refuses', () => {
    expect(refused(changelogFolded(folded('2026-10-24'), 'v0.2.0-alpha.3', '2026-10-26')).length).toBeGreaterThan(0);
  });
});

describe('the API contract names the version', () => {
  it('passes main’s openapi.yaml for the root version, and refuses the version after it', () => {
    const openapi = read('apps/api/docs/openapi.yaml');
    const root = (JSON.parse(read('package.json')) as { version: string }).version;
    // The next one, derived, so the bump to it does not turn this red.
    const next = root.replace(/(\d+)$/, (n) => String(Number(n) + 1));
    expect(next).not.toBe(root);
    expect(openapiAgrees(openapi, `v${root}`).kind).toBe('pass');
    expect(openapiAgrees(openapi, `v${next}`).kind).toBe('refuse');
  });
});

describe('CI and the scan on main ran the commit, and ran the suite', () => {
  const jobs = fixture<{ jobs: Array<{ name: string; status: string; conclusion: string | null }> }>('ci-jobs-39866562875.json').jobs;
  const run = { id: 39866562875, run_number: 4694, event: 'push', status: 'completed', conclusion: 'success', head_sha: C, head_branch: 'main' };

  it('names the jobs it requires', () => {
    expect(REQUIRED_CI_JOBS).toEqual(['lint', 'unit-tests (all)', 'ui-tests', 'integration-tests (self-hosted)', 'ci-complete']);
  });

  it('passes run 4694 on 721c6ea8, where every one of them ran', () => {
    expect(ciGreen(run, jobs, C).kind).toBe('pass');
  });

  it('refuses a green run that skipped the unit tests: a docs-only merge reports success over a tree nothing tested', () => {
    const skipped = jobs.map((j) => (j.name === 'unit-tests (all)' ? { ...j, conclusion: 'skipped' } : j));
    expect(ciGreen(run, skipped, C).sentence).toMatch(/unit-tests \(all\) was skipped/);
  });

  it('refuses a cancelled run, a running one, none, and one on another commit', () => {
    expect(ciGreen({ ...run, conclusion: 'cancelled' }, jobs, C).kind).toBe('refuse');
    expect(ciGreen({ ...run, status: 'in_progress', conclusion: null }, jobs, C).kind).toBe('refuse');
    expect(ciGreen(null, null, C).kind).toBe('refuse');
    expect(ciGreen({ ...run, head_sha: OTHER }, jobs, C).kind).toBe('refuse');
  });

  it('refuses a red Security Scan push run, and the absence of one', () => {
    const scan = { ...run, id: 39866564070, run_number: 4710 };
    expect(scanGreenOnMain(scan, C).kind).toBe('pass');
    expect(scanGreenOnMain({ ...scan, conclusion: 'failure' }, C).kind).toBe('refuse');
    expect(scanGreenOnMain(null, C).kind).toBe('refuse');
  });
});

describe('the workflows Release dispatches can be dispatched as it will', () => {
  const workflow = (file: string) => parse(read(`.github/workflows/${file}`)) as Record<string, unknown>;
  const now = () => ({
    'security-scan.yml': workflow('security-scan.yml'),
    'images.yml': workflow('images.yml'),
    'windows-payload.yml': workflow('windows-payload.yml'),
  });

  it('passes the workflows as they are', () => {
    expect(refused(calleesDispatchable(now()))).toEqual([]);
  });

  it('refuses a candidate whose security-scan.yml has no image_scans input: the dispatch would answer 422', () => {
    const callees = now();
    const scan = structuredClone(callees['security-scan.yml']) as { on: Record<string, unknown> };
    scan.on.workflow_dispatch = null;
    expect(refused(calleesDispatchable({ ...callees, 'security-scan.yml': scan }))).toHaveLength(1);
  });

  it('refuses a publisher with no dispatch trigger, and a payload without win-x64', () => {
    const callees = now();
    const images = structuredClone(callees['images.yml']) as { on: Record<string, unknown> };
    delete images.on.workflow_dispatch;
    expect(refused(calleesDispatchable({ ...callees, 'images.yml': images }))).toHaveLength(1);
    const payload = structuredClone(callees['windows-payload.yml']) as {
      on: { workflow_dispatch: { inputs: { platform: { options: string[] } } } };
    };
    payload.on.workflow_dispatch.inputs.platform.options = ['win-arm64'];
    expect(refused(calleesDispatchable({ ...callees, 'windows-payload.yml': payload }))).toHaveLength(1);
  });
});

describe('the approval and the token', () => {
  it('says whether the release environment asks for a reviewer, and never refuses on it', () => {
    const reviewed = { protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }] };
    expect(approvalNote(reviewed)).toMatchObject({ kind: 'note' });
    expect(approvalNote(reviewed).sentence).toMatch(/asks a reviewer/);
    expect(approvalNote({ protection_rules: [] }).sentence).toMatch(/passes without a click/);
    expect(approvalNote(null).sentence).toMatch(/does not exist yet/);
  });

  it('reports open code-scanning alerts and never refuses on them (the owner’s decision 11)', () => {
    expect(alertsNote({ critical: 1, high: 2 })).toMatchObject({ kind: 'note' });
    expect(alertsNote({ critical: 1, high: 2 }).sentence).toMatch(/1 critical and 2 high .*reported, not refused/);
    expect(alertsNote({ critical: 0, high: 0 }).kind).toBe('note');
    expect(alertsNote(null).kind).toBe('note');
  });

  it('spawns the candidate’s own scripts with no token in their environment', () => {
    const env = candidateEnv({ PATH: '/usr/bin', GH_TOKEN: 'x', GITHUB_TOKEN: 'y', ACTIONS_RUNTIME_TOKEN: 'z', HOME: '/h' });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/h' });
  });
});

describe('the open code-scanning alerts, read whole and grouped (report only)', () => {
  const ALERTS = fixture<Alert[]>('code-scanning-alerts-hand-made.json');
  const sentences = (lines: Line[]) => lines.map((l) => l.sentence);
  const groupLine = (lines: Line[], what: string) => lines.find((l) => l.sentence.includes(what))?.sentence ?? '';

  /** The API's whole alert, as `GET code-scanning/alerts` answers it, around a slim one. */
  const raw = (alert: Alert) => ({
    ...alert,
    created_at: '2026-10-19T12:40:00Z',
    updated_at: '2026-10-22T16:10:00Z',
    url: `https://api.github.com/repos/Robbes/Ownpace/code-scanning/alerts/${alert.number}`,
    html_url: `https://github.com/Robbes/Ownpace/security/code-scanning/${alert.number}`,
    instances_url: `https://api.github.com/repos/Robbes/Ownpace/code-scanning/alerts/${alert.number}/instances`,
    fixed_at: null,
    dismissed_by: { login: 'somebody', id: 1, type: 'User' },
    dismissed_at: null,
    dismissed_reason: null,
    dismissed_comment: null,
    dismissal_approved_by: { login: 'somebody-else', id: 2, type: 'User' },
    assignees: [{ login: 'a-third', id: 3, type: 'User' }],
    rule: { ...alert.rule, name: 'OsPackageVulnerability', description: 'a description', tags: ['vulnerability', 'security'], help: 'help text' },
    tool: { ...alert.tool, guid: null, version: '0.67.2' },
    most_recent_instance: {
      ...alert.most_recent_instance,
      analysis_key: '.github/workflows/security-scan.yml:image-scan',
      environment: '{}',
      state: 'open',
      commit_sha: 'c'.repeat(40),
      message: { text: 'Package: openssl\nInstalled Version: 3.0.15\nVulnerability ...' },
      location: { path: 'library/redis', start_line: 1, end_line: 1 },
      classifications: [],
    },
  });

  it('the fixture is what the whitelist keeps of an alert: no account, link or message', () => {
    expect(ALERTS.length).toBeGreaterThan(TOP_RULES * 4);
    for (const alert of ALERTS) {
      expect(slimAlert(alert)).toEqual(alert);
      for (const key of Object.keys(alert)) expect([...ALERT_FIELDS, 'rule', 'tool', 'most_recent_instance']).toContain(key);
      for (const key of Object.keys(alert.rule ?? {})) expect(ALERT_RULE_FIELDS).toContain(key);
      for (const key of Object.keys(alert.tool ?? {})) expect(ALERT_TOOL_FIELDS).toContain(key);
      for (const key of Object.keys(alert.most_recent_instance ?? {})) expect(ALERT_INSTANCE_FIELDS).toContain(key);
    }
    const whole = raw(ALERTS[0]!);
    const slim = slimAlert(whole);
    expect(slim).toEqual(ALERTS[0]);
    expect(JSON.stringify(slim)).not.toMatch(/somebody|a-third|dismiss|assignee|html_url|message|location/);
  });

  it('reads every page of both severities, per_page=100, and keeps only the whitelist', async () => {
    // 67 critical on one page; 237 high over three: the first run's "100 high" was the page size.
    const made = (severity: string, n: number, from: number) =>
      Array.from({ length: n }, (_, i) =>
        raw({
          number: from + i,
          state: 'open',
          rule: { id: `CVE-2026-${10000 + ((from + i) % 40)}`, severity: 'error', security_severity_level: severity },
          tool: { name: 'Trivy' },
          most_recent_instance: { ref: 'refs/heads/main', category: i % 2 ? 'trivy-image-nextcloud' : REPOSITORY_SCAN_CATEGORY },
        }),
      );
    const pages: Record<string, unknown[][]> = {
      critical: [made('critical', 67, 1)],
      high: [made('high', 100, 1000), made('high', 100, 1100), made('high', 37, 1200)],
    };
    const asked: string[] = [];
    const client: Client = {
      async get(path: string) {
        asked.push(path);
        const url = new URL(path, 'https://api.example/');
        const severity = url.searchParams.get('severity') ?? '';
        const page = Number(url.searchParams.get('page'));
        return pages[severity]?.[page - 1] ?? [];
      },
      async send() {
        throw new Error('the preflight writes nothing');
      },
    };
    const alerts = await readOpenAlerts(client);
    expect(alerts).toHaveLength(67 + 237);
    expect(asked).toHaveLength(4);
    for (const path of asked) {
      expect(path).toMatch(/^code-scanning\/alerts\?state=open&ref=refs\/heads\/main&severity=(critical|high)&per_page=100&page=\d$/);
    }
    expect(JSON.stringify(alerts)).not.toMatch(/somebody|dismiss|assignee|message/);
    const lines = alertsNotes(alerts);
    expect(lines[0]!.sentence).toMatch(/^67 critical and 237 high code-scanning alert\(s\) open on main, in 2 group\(s\)/);
  });

  it('a list longer than the cap is an error, never a short count; an answer that is not a list is one too', async () => {
    const full: Client = { get: async () => Array.from({ length: 100 }, (_, i) => ({ number: i })), send: async () => ({ status: 0, json: null }) };
    await expect(getAll(full, 'code-scanning/alerts?state=open', { maxPages: 3 })).rejects.toThrow(/more than 3 pages/);
    const odd: Client = { get: async () => ({ message: 'not a list' }), send: async () => ({ status: 0, json: null }) };
    await expect(getAll(odd, 'code-scanning/alerts?state=open')).rejects.toThrow(/not a list|something other than a list/);
  });

  it('prints the total, then one note per tool and category, the most critical first', () => {
    const lines = alertsNotes(ALERTS);
    expect(lines.every((l) => l.kind === 'note' && l.check === 'code-scanning')).toBe(true);
    const groups = alertGroups(ALERTS);
    expect(lines).toHaveLength(groups.length + 1);
    const critical = ALERTS.filter((a) => a.rule?.security_severity_level === 'critical').length;
    const high = ALERTS.filter((a) => a.rule?.security_severity_level === 'high').length;
    expect(lines[0]!.sentence).toBe(
      `${critical} critical and ${high} high code-scanning alert(s) open on main, in ${groups.length} group(s) by tool and category below: reported, not refused`,
    );
    const order = groups.map((g) => [g.critical, g.critical + g.high]);
    expect(order).toEqual([...order].sort((a, b) => b[0]! - a[0]! || b[1]! - a[1]!));
    expect(groups.reduce((n, g) => n + g.critical + g.high, 0)).toBe(ALERTS.length);
  });

  it('names the image of an image scan’s category, and the repository scan by its own', () => {
    const lines = alertsNotes(ALERTS);
    const nextcloud = groupLine(lines, 'trivy-image-nextcloud');
    expect(nextcloud).toMatch(/^Trivy, image nextcloud \(category trivy-image-nextcloud\): \d+ critical and \d+ high in \d+ rule\(s\); most: /);
    expect(groupLine(lines, 'trivy-image-redis')).toMatch(/^Trivy, image redis \(/);
    expect(groupLine(lines, REPOSITORY_SCAN_CATEGORY)).toMatch(/^Trivy, the repository’s filesystem scan \(category \.github\/workflows\/security-scan\.yml:security-scan\): /);
    // A category's trailing slash, as the upload writes it, is not part of its name.
    const slashed = alertsNotes([{ ...ALERTS[0]!, most_recent_instance: { ref: 'refs/heads/main', category: 'trivy-image-gatus/' } }]);
    expect(slashed[1]!.sentence).toMatch(/^Trivy, image gatus \(category trivy-image-gatus\)/);
  });

  it('lists a group’s most alerted rule ids, critical first, with their counts, and says how many more', () => {
    const lines = alertsNotes(ALERTS);
    const nextcloud = alertGroups(ALERTS).find((g) => g.category === 'trivy-image-nextcloud')!;
    expect(nextcloud.rules.length).toBeGreaterThan(TOP_RULES);
    const most = nextcloud.rules.slice(0, TOP_RULES);
    const sentence = groupLine(lines, 'trivy-image-nextcloud');
    expect(sentence).toContain(`most: ${most.map((r) => `${r.id} (${r.severity}, ${r.alerts})`).join(', ')}, and ${nextcloud.rules.length - TOP_RULES} more`);
    const ranks = nextcloud.rules.map((r) => (r.severity === 'critical' ? 0 : 1));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(most.some((r) => r.alerts > 1)).toBe(true);
    for (const rule of nextcloud.rules) expect(rule.id).toMatch(/^(CVE-\d{4}-\d{4,}|GHSA(-[23456789cfghjmpqrvwx]{4}){3})$/);
  });

  it('keeps tools apart: one category under two tools is two groups', () => {
    const codeql = { ...ALERTS[0]!, number: 99999, tool: { name: 'CodeQL' } };
    const lines = alertsNotes([ALERTS[0]!, codeql]);
    expect(lines).toHaveLength(3);
    expect(sentences(lines).filter((s) => s.startsWith('CodeQL, '))).toHaveLength(1);
  });

  it('prints nothing a log could be made to carry: one line each, no "@", ids cut short', () => {
    const at = String.fromCharCode(64);
    const odd = {
      ...ALERTS[0]!,
      rule: { id: `CVE-2026-1\n::error::forged someone${at}example.invalid`, security_severity_level: 'critical' },
      tool: { name: 'Trivy\r\nnote x' },
      most_recent_instance: { ref: 'refs/heads/main', category: `trivy-image-${'x'.repeat(300)}` },
    };
    for (const line of alertsNotes([odd])) {
      expect(line.sentence).not.toMatch(/[\r\n@]/);
      expect(line.sentence.length).toBeLessThan(400);
    }
    for (const line of alertsNotes(ALERTS)) expect(line.sentence).not.toMatch(/[\r\n@]/);
  });

  it('a list that could not be read is a note that says why, never a refusal; none open says so', () => {
    expect(alertsNotes(null, 'GET code-scanning/alerts answered 403: Resource not accessible by integration')).toEqual([
      { kind: 'note', check: 'code-scanning', sentence: 'the open code-scanning alerts could not be read: GET code-scanning/alerts answered 403: Resource not accessible by integration' },
    ]);
    expect(alertsNotes([])).toEqual([{ kind: 'note', check: 'code-scanning', sentence: 'no open critical or high code-scanning alert on main' }]);
  });
});

describe('the verdict', () => {
  const all = (mode: string): Line[] =>
    [
      'inputs',
      'dispatched-from-main',
      'candidate-on-main',
      'tag-free',
      'ref-unambiguous',
      'names-agree',
      'openapi-agrees',
      'changelog-folded',
      'ci-green',
      'scan-green-on-main',
      'nights',
      'callees-dispatchable',
      'upgrade-ledger',
      'upgrade-managed',
    ].map((check) => ({ kind: 'pass', check, sentence: `${mode} ok` }));
  const outcomes = { resolve: 'success', check: 'success', install: 'success', callees: 'success', gates: 'success' };

  it('lets a release through only when every check ran and passed', () => {
    expect(verdict({ lines: all('release'), mode: 'release', outcomes }).exitCode).toBe(0);
  });

  it('stops a release on one refusal, and on a check that never ran', () => {
    const one = [...all('release'), { kind: 'refuse', check: 'nights', sentence: 'no' }];
    expect(verdict({ lines: one, mode: 'release', outcomes })).toMatchObject({ exitCode: 1, refused: 1 });
    const missing = all('release').filter((l) => l.check !== 'upgrade-managed');
    const v = verdict({ lines: missing, mode: 'release', outcomes });
    expect(v.exitCode).toBe(1);
    expect(v.summary).toMatch(/upgrade-managed: this check did not run/);
  });

  it('refuses a step that ended in an error instead of a line', () => {
    expect(verdict({ lines: all('release'), mode: 'release', outcomes: { ...outcomes, gates: 'failure' } }).exitCode).toBe(1);
  });

  it('carries refusals through a rehearsal, and is red in preflight mode', () => {
    const one = [...all('rehearse'), { kind: 'refuse', check: 'nights', sentence: 'no' }];
    expect(verdict({ lines: one, mode: 'rehearse', outcomes, commit: C })).toMatchObject({ exitCode: 0, refused: 1 });
    expect(verdict({ lines: one, mode: 'preflight', outcomes, commit: C })).toMatchObject({ exitCode: 1, refused: 1 });
  });

  // The review of 2026-10-23: rehearse carried every refusal, so a commit that
  // is not on main still reached the gate scan, which makes a branch at it and
  // runs ITS security-scan.yml with a write token. What the rehearsal carries
  // is the record's refusals, never the ones that say which commit it is.
  it('stops a rehearsal on a commit that is not on main’s first-parent line, or on none', () => {
    const offMain = all('rehearse').map((l) => (l.check === 'candidate-on-main' ? { ...l, kind: 'refuse' } : l));
    expect(verdict({ lines: offMain, mode: 'rehearse', outcomes, commit: C })).toMatchObject({ exitCode: 1, refused: 1 });
    for (const check of ['inputs', 'dispatched-from-main', 'commit', 'previous-release']) {
      const lines = [...all('rehearse'), { kind: 'refuse', check, sentence: 'no' }];
      expect(verdict({ lines, mode: 'rehearse', outcomes, commit: C }).exitCode, check).toBe(1);
    }
    // The resolve step stopped before candidate-on-main: it "did not run".
    const stopped = [
      { kind: 'pass', check: 'inputs', sentence: 'ok' },
      { kind: 'pass', check: 'dispatched-from-main', sentence: 'ok' },
      { kind: 'refuse', check: 'commit', sentence: 'the nights pick no commit' },
    ];
    expect(verdict({ lines: stopped, mode: 'rehearse', outcomes: {}, commit: '' }).exitCode).toBe(1);
    expect(verdict({ lines: all('rehearse'), mode: 'rehearse', outcomes: { ...outcomes, worktree: 'failure' }, commit: C }).exitCode).toBe(1);
  });
});
