// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PIPELINE WHOSE CONSUMER EXITS EARLY REPORTS FAILURE WHEN IT SUCCEEDED.
 *
 * Under `set -o pipefail`:
 *
 *   printf '%s\n' "$present" | grep -qxF "$col"
 *
 * `grep -q` exits the instant it matches, without draining its input. The
 * producer's next write lands on a closed pipe and it dies of SIGPIPE.
 * `PIPESTATUS` is then `(141 0)` — grep said YES, the producer was killed for
 * being interrupted mid-sentence, and `pipefail` hands back the 141. The
 * caller sees a non-zero status and concludes the match failed.
 *
 * It is a race, so it hides on an idle machine and shows up on a busy one:
 * 0 spurious failures in 15,000 unloaded iterations of the line above,
 * ~1 in 1,400 under CPU contention. That is a CI runner with a full test
 * suite in flight, and it is not theoretical here:
 *
 *   - E2E (managed) #40 died at exit 255 inside the bring-up's own failure
 *     diagnosis. `docker compose logs "$svc" | head -20` — `head` closed the
 *     pipe after twenty lines, the still-writing container took the SIGPIPE,
 *     and the function aborted between its first window and its second. The
 *     window holding the actual fatal line never printed.
 *
 *   - `unit-tests` went red on PR #518 with
 *     `[trigger-credentials] Missing: Project.id` — for a column the test
 *     fixture defines and grep had just found. The script told the operator
 *     their Trigger.dev schema was a version this repo does not know, and
 *     sent them to transcribe two credentials by hand for a problem that did
 *     not exist.
 *
 * THE FIRST ONE WAS FIXED IN THE FUNCTION WHERE IT BIT, and the lesson was
 * written down there in full — while eighteen more instances of the same
 * shape sat untouched in eight other files, including the `pgbouncer is in
 * transaction mode` gate on the very workflow that keeps failing. A fix
 * scoped to the file where a bug was found does not stop the class. So this
 * guard reads every shell script in the repository and every `run:` block in
 * every workflow, and refuses the shape wherever it appears.
 *
 * THE FIX IS ALWAYS TO REMOVE THE PRODUCER FROM THE PIPELINE, not to silence
 * the status:
 *
 *   grep -qxF "$col" <<<"$present"      # here-string: nothing to signal
 *   var="${x%%|*}"                      # bash does it without forking
 *   grep -o … <<<"$x" | awk 'NR==1'     # awk reads to EOF; head does not
 *
 * `| head -1 || true` is NOT a fix. It stops the script aborting and leaves
 * the wrong answer in the variable.
 *
 * WHY WORKFLOWS COUNT. GitHub Actions runs every `run:` step as
 * `bash --noprofile --norc -eo pipefail {0}` unless the step says otherwise,
 * so `pipefail` is on in CI whether or not the step asked for it.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo']);

// ---------------------------------------------------------------------------
// Consumers that can exit before their input is finished.
//
// `grep` only qualifies with a flag that makes it stop early: `-q` (exits at
// the first match), `-l` (same, prints the filename), `-m N` (exits after N).
// A bare `grep` reads to EOF and is fine. So is `awk`, `cut`, `tail`, `wc`,
// `sed` without a `q` command.
// ---------------------------------------------------------------------------
function exitsEarly(command: string): string | null {
  const words = command.trim().split(/\s+/);
  // Step past `LC_ALL=C grep …` and `env X=1 grep …` to the command itself.
  let i = 0;
  while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i] ?? '') || words[i] === 'env')) i++;
  const base = (words[i] ?? '').replace(/^.*\//, '');
  const args = words.slice(i + 1);

  if (base === 'head') return 'head stops reading after its limit';

  if (base === 'grep' || base === 'egrep' || base === 'fgrep' || base === 'zgrep') {
    for (const a of args) {
      if (!a.startsWith('-') || a.startsWith('--') || a === '-') continue;
      // A short-option cluster: -q, -qxF, -im1 …
      if (/[qlm]/.test(a.slice(1))) return `grep ${a} stops at the first match`;
    }
    return null;
  }

  // `sed -n '1p;q'` / `sed '2q'` — a `q` command ends sed where it stands.
  if (base === 'sed' && args.some((a) => /(^|[;'"\s])\d*q($|[;'"\s])/.test(a))) {
    return 'sed quits before the end of its input';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Finding the pipes. A `|` only counts when the shell would read it as one:
// not inside quotes, not `||`, not inside a heredoc body, and not in a
// comment. `grep -qE 'required variable|error while interpolating'` contains
// no pipe at all; neither does `jq '.result[]? | select(.name == $n)'`.
//
// The script is cut into SEGMENTS at every unquoted separator, and only a
// segment the shell would feed from a pipe is examined. Reading to end-of-line
// instead is how the first draft of this file reported `grep -l` on
//
//   … | grep -o "$2" | wc -l | tr -d ' '
//
// It had walked out of grep's arguments and into `wc -l`'s.
// ---------------------------------------------------------------------------
export interface PipeFinding {
  line: number;
  consumer: string;
  why: string;
}

export function findEarlyExitConsumers(script: string): PipeFinding[] {
  const found: PipeFinding[] = [];

  let quote: "'" | '"' | null = null;
  let heredocTag: string | null = null;
  let heredocIndented = false;

  let segment = '';
  let segmentLine = 1;
  let pipeFed = false;
  let line = 1;

  const flush = (nextIsPipeFed: boolean) => {
    if (pipeFed && segment.trim() !== '') {
      const why = exitsEarly(segment);
      if (why) {
        found.push({ line: segmentLine, consumer: segment.trim().split(/\s+/)[0] ?? '', why });
      }
    }
    segment = '';
    pipeFed = nextIsPipeFed;
  };

  for (let c = 0; c < script.length; c++) {
    const ch = script[c];

    if (ch === '\n') {
      // A heredoc body ends at its tag and is data until then.
      line++;
      if (heredocTag !== null) continue;
      // A pipe with nothing after it on the line hands off to the next line,
      // so a segment that is still empty keeps waiting for its consumer.
      if (segment.trim() === '') {
        segmentLine = line;
      } else {
        flush(false);
        segmentLine = line;
      }
      continue;
    }

    if (heredocTag !== null) {
      // Collect the line and compare it against the terminator.
      let eol = script.indexOf('\n', c);
      if (eol === -1) eol = script.length;
      const body = script.slice(c, eol);
      const candidate = heredocIndented ? body.replace(/^\t+/, '') : body;
      if (candidate.trimEnd() === heredocTag) heredocTag = null;
      c = eol - 1;
      continue;
    }

    if (quote) {
      if (ch === quote) quote = null;
      else if (quote === '"' && ch === '\\') c++;
      segment += ch;
      continue;
    }

    if (ch === '\\') {
      segment += ch;
      if (script[c + 1] === '\n') {
        line++;
        c++;
      } else {
        c++;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch as "'" | '"';
      segment += ch;
      continue;
    }

    // A comment runs to end of line — but only when `#` starts a word.
    if (ch === '#' && (segment === '' || /\s/.test(segment[segment.length - 1] ?? ''))) {
      let eol = script.indexOf('\n', c);
      if (eol === -1) eol = script.length;
      c = eol - 1;
      continue;
    }

    const here = /^<<(-?)\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(script.slice(c, c + 64));
    if (here) {
      heredocTag = here[3] ?? null;
      heredocIndented = here[1] === '-';
      // The rest of THIS line is still code; the body starts after it.
      const eol = script.indexOf('\n', c);
      segment += here[0];
      c += here[0].length - 1;
      if (eol === -1) break;
      continue;
    }

    if (ch === '|') {
      if (script[c + 1] === '|') {
        c++; // `||` is or-else, not a pipe
        flush(false);
        continue;
      }
      flush(true);
      continue;
    }

    if (ch === ';' || ch === '&' || ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      flush(false);
      continue;
    }

    segment += ch;
  }
  flush(false);

  return found;
}

// ---------------------------------------------------------------------------
// What to scan.
// ---------------------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith('.sh')) out.push(p);
  }
  return out;
}

const shellScripts = walk(REPO_ROOT)
  .map((p) => ({ file: relative(REPO_ROOT, p), text: readFileSync(p, 'utf8') }))
  // `pipefail` is what turns the producer's SIGPIPE into the pipeline's
  // status. Without it the pipeline reports grep's answer and the shape is
  // harmless, so a script that does not set it is not this rule's business.
  .filter(({ text }) => /set\s+-[a-zA-Z]*o\s+pipefail|set\s+-o\s+pipefail/.test(text));

const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');
const workflowRunBlocks = readdirSync(WORKFLOW_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .flatMap((f) => {
    const doc = parseYaml(readFileSync(join(WORKFLOW_DIR, f), 'utf8')) as Record<string, unknown>;
    const jobs = (doc?.jobs ?? {}) as Record<string, { steps?: Array<Record<string, unknown>> }>;
    return Object.entries(jobs).flatMap(([jobName, job]) =>
      (job?.steps ?? [])
        .filter((s) => typeof s.run === 'string')
        // A step may opt out of bash, and then pipefail is not on.
        .filter((s) => s.shell === undefined || String(s.shell).startsWith('bash'))
        .map((s) => ({
          file: `.github/workflows/${f}`,
          label: `${jobName} → ${String(s.name ?? '(unnamed step)')}`,
          text: s.run as string,
        })),
    );
  });

// ---------------------------------------------------------------------------
describe('the scanner reads shell the way the shell does', () => {
  it('finds a pipe into an early-exit consumer', () => {
    expect(findEarlyExitConsumers(`printf '%s\\n' "$x" | grep -qxF "$c"`)).toHaveLength(1);
    expect(findEarlyExitConsumers(`docker logs app | head -20`)).toHaveLength(1);
    expect(findEarlyExitConsumers(`cat f | grep -m1 foo`)).toHaveLength(1);
    expect(findEarlyExitConsumers(`cat f | sed -n '1p;q'`)).toHaveLength(1);
  });

  it('follows a pipe that dangles to the next line', () => {
    expect(findEarlyExitConsumers('some_command |\n  head -1')).toHaveLength(1);
  });

  it('stops at the end of the piped command, not the end of the line', () => {
    // The first draft of this scanner read the rest of the LINE as the
    // consumer's arguments, so on
    //
    //   … | grep -o "$2" | wc -l | tr -d ' '
    //
    // it walked out of grep's arguments into `wc -l`'s and reported
    // "grep -l stops at the first match" about a grep that has no such flag.
    // That is the fourth time in one day an assertion matched something
    // ADJACENT to what it meant to check, so it gets a case of its own.
    expect(findEarlyExitConsumers(`curl -sS "$u" | grep -o "$2" | wc -l | tr -d ' '`)).toEqual([]);
    expect(findEarlyExitConsumers(`cat f | awk '{print $1}' | head -1`)).toHaveLength(1);
  });

  it('does not mistake a `|` inside quotes for a pipe', () => {
    // The exact line this bug was found on has a `|` inside its own pattern.
    expect(findEarlyExitConsumers(`grep -qE 'required variable|error while interpolating' <<<"$p"`)).toEqual([]);
    expect(findEarlyExitConsumers(`jq -r '.result[]? | select(.n == $x) | .id'`)).toEqual([]);
    expect(findEarlyExitConsumers(`echo "a|head -1"`)).toEqual([]);
  });

  it('does not mistake `||` for a pipe', () => {
    expect(findEarlyExitConsumers(`grep -q x <<<"$v" || head -1 /dev/null`)).toEqual([]);
  });

  it('ignores comments and heredoc bodies, which are prose and data', () => {
    expect(findEarlyExitConsumers(`# docker compose logs "$svc" | head -20 looks harmless`)).toEqual([]);
    expect(findEarlyExitConsumers(`cat <<'EOF'\n  foo | head -1\nEOF\ntrue`)).toEqual([]);
  });

  it('leaves consumers that read to the end alone', () => {
    expect(findEarlyExitConsumers(`grep -o x <<<"$v" | awk 'NR==1' | cut -d= -f2`)).toEqual([]);
    expect(findEarlyExitConsumers(`printf '%s\\n' "$v" | grep -c .`)).toEqual([]);
    expect(findEarlyExitConsumers(`cat f | tail -1 | sed 's/^/  /'`)).toEqual([]);
    // A bare grep drains its input; only -q/-l/-m cut it short.
    expect(findEarlyExitConsumers(`cat f | grep -E 'x'`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('no pipeline in this repository can be killed by its own consumer', () => {
  it('found scripts and workflow steps to check', () => {
    // Vacuity guard: if the discovery above stops finding files, every case
    // below passes on an empty list and this guard silently stops guarding.
    expect(shellScripts.length, 'no pipefail shell scripts found').toBeGreaterThan(10);
    expect(workflowRunBlocks.length, 'no workflow run: blocks found').toBeGreaterThan(20);
  });

  it.each(shellScripts.map(({ file, text }) => [file, text] as const))(
    '%s pipes into nothing that exits early',
    (file, text) => {
      const findings = findEarlyExitConsumers(text);
      expect(
        findings,
        findings.map((f) => `${file}:${f.line} — ${f.why}. Read it from a here-string instead.`).join('\n'),
      ).toEqual([]);
    },
  );

  it.each(workflowRunBlocks.map((b) => [`${b.file} · ${b.label}`, b.text] as const))(
    '%s pipes into nothing that exits early',
    (label, text) => {
      const findings = findEarlyExitConsumers(text);
      expect(
        findings,
        findings
          .map((f) => `${label} (run: line ${f.line}) — ${f.why}. Read it from a here-string instead.`)
          .join('\n'),
      ).toEqual([]);
    },
  );
});
