#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PIN THAT KNOWS IT IS BEHIND (workplan 0135 T7 (b); the owner's answer of
 * 2026-09-28, "a+b, 7 days").
 *
 * The identity provider is pinned in `deploy/compose/managed.yml`, and
 * Dependabot ignores it by name, because an upgrade is deliberate: Zitadel
 * moves its schema one way when it boots on the persistent stack (0119 §3
 * item 2). So nothing said when upstream moved on. v4.18.0 fixed
 * GHSA-4hgj-wm6c-q7p2 on 2026-09-21, a rename of any account through login v1,
 * which this stack serves. A week later the stack still ran v4.17.3, and a
 * person reading release notes is what found it.
 *
 * Once a week this compares the pin with the newest release of the same
 * major, read from upstream with `git ls-remote`, and keeps one issue open
 * while the two differ: opened, updated with the newest release, and closed
 * when the pin catches up. The owner also watches the repository's releases
 * and security alerts on GitHub (T7 (a)). This is the half that does not rely
 * on anybody reading their mail.
 *
 * WHAT IT DOES NOT DO. It opens no pull request. Moving the pin is the owner's
 * call, by the route the issue spells out: a dump of the identity provider's
 * database first, its own PR, the gate on the OTA instance, and live from a
 * tag. It reads no advisories either. A newer release is reason enough to
 * read the notes, and a security release is applied within seven days.
 *
 * `.mjs` for the reason `audit-advisories.mjs` gives: it runs in a CI step on
 * a bare checkout and needs no type stripping. Its guard,
 * `scripts/a-pin-that-knows-it-is-behind.unit.test.ts`, runs the functions
 * below with a stubbed tag list and a fake `gh`.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMPOSE = 'deploy/compose/managed.yml';
export const UPSTREAM = 'https://github.com/zitadel/zitadel.git';
export const ISSUE_TITLE = 'The identity provider pin is behind its newest release';
/** 0135 T7: a security release is applied within this many days. */
export const WINDOW_DAYS = 7;

const IMAGE_LINE = /^\s*image:\s*ghcr\.io\/zitadel\/zitadel:(\S+)\s*$/gm;
const RELEASE = /^v(\d+)\.(\d+)\.(\d+)$/;

/** A release tag's three numbers, or null for anything else (a pre-release, a name). */
function numbersOf(tag) {
  const m = RELEASE.exec(tag);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Orders two release tags by their numbers, never by their text: v4.9.0 comes before v4.10.0. */
export function compareTags(a, b) {
  const x = numbersOf(a);
  const y = numbersOf(b);
  if (!x || !y) throw new Error(`not a release tag: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The tag `managed.yml` runs, from its one `image:` line for the identity provider. */
export function readPin(compose) {
  const lines = [...compose.matchAll(IMAGE_LINE)];
  if (lines.length !== 1) {
    throw new Error(`${COMPOSE} names the identity provider's image ${lines.length} times, not once`);
  }
  const tag = lines[0][1];
  if (!numbersOf(tag)) throw new Error(`${COMPOSE} pins the identity provider at ${tag}, which is not a release tag`);
  return tag;
}

/**
 * The newest release of `major`, from `git ls-remote --tags --refs` output. A
 * pre-release (`v4.20.0-rc.1`) and another major are not releases of it. None
 * at all is an error, never "current".
 */
export function newestRelease(major, lsRemote) {
  const releases = lsRemote
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[1] ?? '')
    .filter((ref) => ref.startsWith('refs/tags/'))
    .map((ref) => ref.slice('refs/tags/'.length))
    .filter((tag) => numbersOf(tag)?.[0] === major);
  if (releases.length === 0) {
    throw new Error(`upstream lists no v${major} release, so the pin cannot be called current`);
  }
  return releases.sort(compareTags).at(-1);
}

/** The pin against the newest release of its major: current, behind, or ahead of every release. */
export function comparePin(pin, lsRemote) {
  const major = numbersOf(pin)?.[0];
  if (major === undefined) throw new Error(`not a release tag: ${pin}`);
  const newest = newestRelease(major, lsRemote);
  const order = compareTags(pin, newest);
  return { pin, newest, state: order === 0 ? 'current' : order < 0 ? 'behind' : 'ahead' };
}

/** What the issue says: the two versions, the window, and the route an upgrade takes. */
export function issueBody({ pin, newest }) {
  return [
    `The identity provider runs **${pin}** (\`${COMPOSE}\`), and upstream's newest release of that major is **${newest}**.`,
    '',
    `Read the notes of every release after ${pin}, up to https://github.com/zitadel/zitadel/releases/tag/${newest}. A release that fixes a security issue in something this stack uses is applied within ${WINDOW_DAYS} days (workplan 0135 T7), by the route 0119 §3 item 2 sets:`,
    '',
    "1. Dump the OTA instance's `zitadel` database by hand first, by the runbook's recipe (`docs/operator-runbook.md`, *Backup & restore*). The gate drills Trigger.dev's database, not the identity provider's.",
    '2. Its own pull request moves the pin, with the notes read.',
    "3. E2E (managed) on that branch applies it to the OTA instance, whose schema then moves one way.",
    '4. Live takes it from a release tag.',
    '',
    'This issue is kept by `.github/workflows/idp-pin-watch.yml`. It is updated while the two differ, and closed when the pin catches up.',
  ].join('\n');
}

/** Two issue bodies are the same text, whatever line endings GitHub hands back. */
function sameText(a, b) {
  const plain = (text) => String(text ?? '').replace(/\r\n/g, '\n').trim();
  return plain(a) === plain(b);
}

/**
 * Keeps one issue open while the pin is behind: opens it, or brings the one
 * already open up to date; closes it once the pin is current. `gh` takes the
 * arguments of the GitHub CLI and returns its output.
 *
 * An edit notifies nobody, so a newer release that arrives while the issue is
 * open is also said in a comment. A week with nothing new writes nothing.
 */
export function keepIssue(result, gh) {
  const listed = JSON.parse(
    gh(['issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,title,body']) || '[]',
  );
  const open = listed.filter((issue) => issue.title === ISSUE_TITLE);
  if (result.state === 'behind') {
    const body = issueBody(result);
    if (open.length === 0) {
      gh(['issue', 'create', '--title', ISSUE_TITLE, '--body', body]);
      return 'opened';
    }
    const [issue] = open;
    if (sameText(issue.body, body)) return 'unchanged';
    const number = String(issue.number);
    gh(['issue', 'edit', number, '--body', body]);
    gh(['issue', 'comment', number, '--body', `The pin is ${result.pin}, and upstream's newest release is now **${result.newest}**.`]);
    return 'updated';
  }
  if (result.state === 'current' && open.length > 0) {
    for (const issue of open) {
      gh(['issue', 'close', String(issue.number), '--comment', `The pin is current again: ${result.pin}.`]);
    }
    return 'closed';
  }
  return 'untouched';
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const pin = readPin(readFileSync(join(root, COMPOSE), 'utf8'));
  const lsRemote = execFileSync('git', ['ls-remote', '--tags', '--refs', UPSTREAM], { encoding: 'utf8' });
  const result = comparePin(pin, lsRemote);
  console.log(`identity provider: pinned ${result.pin}, newest release ${result.newest}: ${result.state}`);
  if (argv.includes('--issue')) {
    const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });
    console.log(`issue: ${keepIssue(result, gh)}`);
  }
  // A pin newer than every release is a pre-release, or a tag list read wrong.
  if (result.state === 'ahead') process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`idp-pin-watch: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
