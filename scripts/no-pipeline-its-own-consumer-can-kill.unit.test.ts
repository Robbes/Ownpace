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

/**
 * The index of the `)` that closes the `(` at `open`, or -1.
 *
 * Quotes are tracked because a paren inside one is a character, not a nesting
 * level — `$(grep -c ")" f)` balances only if the quoted one is skipped. A
 * single quote inside a double-quoted run is literal and vice versa, which is
 * why the state is one variable rather than two flags.
 */
function matchingParen(src: string, open: number): number {
  let depth = 0;
  let q: "'" | '"' | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (q === '"' && ch === '\\') i++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === '\\') i++;
    else if (ch === "'" || ch === '"') q = ch as "'" | '"';
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

const countNewlines = (text: string): number => text.split('\n').length - 1;

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
    // The next segment starts HERE, not where the last one did. Without this
    // a pipeline continued across a `\` newline reported the line it opened
    // on rather than the line the consumer is on — a finding that points at
    // the wrong line is a finding somebody has to re-derive by hand.
    segmentLine = line;
    pipeFed = nextIsPipeFed;
  };

  for (let c = 0; c < script.length; c++) {
    const ch = script[c];

    // ---- A COMMAND SUBSTITUTION IS CODE, EVEN INSIDE DOUBLE QUOTES ----
    //
    // This is where the scanner used to lose the shape it exists to find.
    // `x="$(cmd | head -1)"` is a real pipeline: `"` suppresses word splitting
    // around the RESULT, it does not stop `$( )` from being parsed as
    // commands. The old reading swallowed everything between the quotes, so
    // that line was invisible while the identical unquoted one was caught.
    //
    // Worse than "missed": UNPREDICTABLE. Quote state was a single toggle, so
    // `x="$(echo "$(cmd | head -1)")"` came back FOUND — the inner `"` flipped
    // the toggle off and exposed the code by accident. Whether a pipeline was
    // seen depended on how many double quotes happened to sit before it.
    //
    // The substitution is scanned as its own script, which is what the shell
    // does: a fresh command context, so nothing outside it is pipe-fed by it,
    // and its findings are reported at their real line.
    //
    // NOT handled, deliberately, because the repository contains none and
    // machinery with no caller rots: backtick substitution, and expansion
    // inside an unquoted heredoc body. A test below pins that this file's own
    // scan of the tree stays the authority on what exists.
    if (quote !== "'" && heredocTag === null && ch === '$' && script[c + 1] === '(') {
      const arithmetic = script[c + 2] === '(';
      const close = matchingParen(script, c + 1);
      if (close !== -1) {
        if (!arithmetic) {
          // `$(( a | b ))` is a BITWISE OR, not a pipe, which is the whole
          // reason arithmetic is skipped rather than scanned.
          for (const f of findEarlyExitConsumers(script.slice(c + 2, close))) {
            found.push({ ...f, line: line + f.line - 1 });
          }
        }
        line += countNewlines(script.slice(c, close + 1));
        // The substitution's VALUE stands where it was: one word, and never a
        // consumer name this rule can resolve.
        segment += ' ';
        c = close;
        continue;
      }
    }

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

  it('reads inside a command substitution, quoted or not', () => {
    // The gap this scanner had until 2026-09-01, and the reason eight real
    // pipelines in `smoke-managed.sh` were invisible. `"` suppresses word
    // splitting around the RESULT of `$( )`; it does not stop the shell
    // parsing what is inside as commands.
    expect(findEarlyExitConsumers(`x=$(cmd | head -1)`)).toHaveLength(1);
    expect(findEarlyExitConsumers(`x="$(cmd | head -1)"`)).toHaveLength(1);
  });

  it('is not thrown by quotes nested inside the substitution', () => {
    // The real shape: a double-quoted argument inside a double-quoted
    // substitution. Quote state used to be one toggle, so the inner `"` turned
    // it OFF and everything after was read as code — or as data, depending on
    // how many quotes came before. Unpredictable rather than merely blind.
    expect(
      findEarlyExitConsumers(`x="$(q "SELECT a FROM t" 2>/dev/null | head -1)"`),
    ).toHaveLength(1);
    expect(findEarlyExitConsumers(`x="$(jq -r '.a' <<<"$b" | head -1)"`)).toHaveLength(1);
  });

  it('reads a substitution nested inside a substitution', () => {
    expect(findEarlyExitConsumers(`x="$(echo "$(cmd | head -1)")"`)).toHaveLength(1);
  });

  it('reports the line inside the substitution, not the line it opens on', () => {
    const found = findEarlyExitConsumers('a=1\nx="$(cmd \\\n  | head -1)"\nb=2');
    expect(found).toHaveLength(1);
    expect(found[0]!.line, 'the finding points at the line that opened it').toBe(3);
  });

  it('does not mistake arithmetic for a pipeline', () => {
    // `|` inside `$(( ))` is a BITWISE OR, and the operand after it is a
    // variable — which may perfectly well be called `head`. Scanned as code
    // that reads as a pipe into an early-exit consumer, so arithmetic is
    // skipped rather than descended into. The name collision is contrived; the
    // shape it stands for is not, and a guard that cannot fail is not a guard.
    expect(findEarlyExitConsumers(`n=$(( mask | head ))`)).toEqual([]);
    expect(findEarlyExitConsumers(`n="$(( 1 | head ))"`)).toEqual([]);
    // And the limit that follows from skipping: a substitution nested INSIDE
    // arithmetic is not read either. There are none in this repository, and
    // `tail -n +$(( BACKUP_KEEP + 1 ))` is the shape that actually occurs.
    expect(findEarlyExitConsumers(`n=$(( $(f | head -1) + 1 ))`)).toEqual([]);
  });

  it('still treats a pipe inside single quotes as data, inside a substitution too', () => {
    // The negative that has to survive the change: a jq program is not a
    // pipeline, and neither is a string that happens to contain one.
    expect(findEarlyExitConsumers(`x="$(jq -r '.a | .b' <<<"$y")"`)).toEqual([]);
    expect(findEarlyExitConsumers(`x="$(printf '%s' 'a | head -1')"`)).toEqual([]);
  });

  it('does not hang or throw on an unterminated substitution', () => {
    // A half-written script must fail the run's other gates, not this one's
    // scanner. `bash -n` is what says the file is broken.
    expect(() => findEarlyExitConsumers(`x="$(cmd | head -1`)).not.toThrow();
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

  it('has no backtick substitution, which is why the scanner does not read one', () => {
    // The scanner descends into `$( )` and NOT into backticks. That is a
    // deliberate limit — machinery with no caller rots — but a limit is only
    // safe while the thing it excludes is absent, and "absent today" is not a
    // property that keeps itself.
    //
    // So the limit is pinned from the other side: nothing in the tree may
    // write a backtick substitution that pipes into a consumer this rule cares
    // about. Add one and this goes red, naming the file, and whoever added it
    // can either use `$( )` or teach the scanner.
    // COMMENT LINES ARE SKIPPED, and the first run of this check is why: it
    // went red on `bootstrap-managed.sh` quoting `docker compose logs "$svc" |
    // head -20` in prose — this repository documents the hazard in backticks,
    // markdown-style. Prose naming the shape is not the shape.
    const BACKTICK_PIPELINE = /`[^`\n]*\|[^`\n]*`/g;
    const offenders: string[] = [];
    for (const { file, text } of shellScripts) {
      text.split('\n').forEach((src, i) => {
        if (/^\s*#/.test(src)) return;
        for (const m of src.matchAll(BACKTICK_PIPELINE)) {
          const consumer = m[0].slice(1, -1).split('|').pop() ?? '';
          const why = exitsEarly(consumer);
          if (why) offenders.push(`${file}:${i + 1}: ${m[0]} — ${why}`);
        }
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
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
