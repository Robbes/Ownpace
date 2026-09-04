// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN APOSTROPHE IN A COMMENT TOOK THE WHOLE GATE DOWN.
 *
 * E2E (self-hosted) #175, 2026-09-04, on main. The step "Prepare appliance
 * config + secrets" died in under a second with:
 *
 *     …/cd86f45c-….sh: line 24: syntax error near unexpected token `('
 *
 * Every gate after it — the appliance build, the UI smoke, restart-resume,
 * verification, apply-deletion, backup/restore, finish — was SKIPPED. The run
 * was red for a reason that had nothing to do with migrating anything.
 *
 * ## What it was
 *
 * The step ran `node -e '<javascript>'`. A comment inside that JavaScript said
 *
 *     // the collection's declared component, not by the address (0113
 *
 * and the apostrophe in **`collection's`** closed the shell's single-quoted
 * string. Bash then parsed the rest of the JavaScript as commands and hit the
 * `(` on that same line. Line 24 of the generated step script, exactly as
 * reported.
 *
 * The prose was added by 0113 T8 (`cb4355b`), which is also the change that
 * gave the gate its task domain. It landed AFTER the last green self-hosted
 * run, and this workflow runs nightly — so the gate had been dead since, and
 * the first person to look was looking for something else.
 *
 * ## Why a guard rather than a careful comment
 *
 * Because the failing thing is prose, and prose is what nobody proof-reads for
 * shell metacharacters. The fix in `e2e.yml` is a heredoc with a quoted
 * delimiter, which makes that one step immune — but the next step somebody
 * writes will reach for `node -e '…'` again, and the next comment will have an
 * apostrophe in it, and the gate will die on a Tuesday night with nobody
 * watching.
 *
 * So: **every `run:` script in every workflow is parsed by bash**, in CI, in
 * seconds. `bash -n` reads a script and checks its syntax without running a
 * single command, which is exactly the question worth asking here.
 *
 * ## What this deliberately does NOT hold
 *
 * It says nothing about whether a step is CORRECT — only that bash can parse
 * it. A step that parses and then does the wrong thing is what the gates
 * themselves are for. It also cannot see a syntax error that only appears
 * after `${{ }}` substitution, because those are GitHub's to expand and their
 * values are not known here; the placeholders are replaced with a harmless
 * literal so the surrounding shell still parses.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(REPO_ROOT, '.github', 'workflows');

interface Step {
  readonly workflow: string;
  readonly job: string;
  readonly name: string;
  readonly run: string;
  readonly shell?: string;
}

/**
 * Every `run:` script in every workflow, with where it came from.
 *
 * Composite `uses:` steps have no `run` and are skipped — their scripts belong
 * to whoever published them.
 */
function everyRunStep(): Step[] {
  const steps: Step[] = [];
  for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    const doc = parse(readFileSync(join(WORKFLOWS, file), 'utf8')) as {
      jobs?: Record<string, { steps?: Array<Record<string, unknown>> }>;
    };
    for (const [job, body] of Object.entries(doc.jobs ?? {})) {
      for (const step of body.steps ?? []) {
        if (typeof step.run !== 'string') continue;
        steps.push({
          workflow: file,
          job,
          name: typeof step.name === 'string' ? step.name : '(unnamed)',
          run: step.run,
          shell: typeof step.shell === 'string' ? step.shell : undefined,
        });
      }
    }
  }
  return steps;
}

/**
 * The script as bash will see it, with GitHub's own expressions stubbed.
 *
 * `${{ … }}` is substituted by the runner BEFORE bash ever sees the file, so
 * leaving it in would make every step with an expression fail to parse for a
 * reason that is not real. A quoted literal keeps the surrounding syntax
 * intact — which is the part this guard is actually asking about.
 */
function asBashSees(run: string): string {
  return run.replace(/\$\{\{[^}]*\}\}/g, 'GITHUB_EXPRESSION');
}

/** `bash -n`: parse the script, run nothing. Returns bash's complaint, or ''. */
function syntaxError(script: string): string {
  try {
    execFileSync('bash', ['-n', '-'], { input: script, stdio: ['pipe', 'pipe', 'pipe'] });
    return '';
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr;
    return stderr ? stderr.toString().trim() : String(err);
  }
}

describe('every workflow step is a script bash can parse', () => {
  const steps = everyRunStep();

  it('finds steps at all — this guard is not passing vacuously', () => {
    // The control. Zero steps agree with everything, and a rename of the
    // workflows directory would otherwise make this file silently useless.
    expect(steps.length, 'no run: steps found in .github/workflows').toBeGreaterThan(20);
  });

  it('parses every run: script, so no gate dies on prose', () => {
    const broken = steps
      // `shell: python` and friends are not bash and must not be read as it.
      .filter((s) => s.shell === undefined || /^bash|^sh$/.test(s.shell))
      .map((s) => ({ step: s, error: syntaxError(asBashSees(s.run)) }))
      .filter(({ error }) => error !== '')
      .map(
        ({ step, error }) =>
          `${step.workflow} → ${step.job} → "${step.name}"\n    ${error.replace(/\n/g, '\n    ')}`,
      );

    expect(
      broken,
      'a workflow step is not valid bash. The runner writes each `run:` block to a file and ' +
        'executes it, so this fails at the START of the step — before anything it was meant ' +
        'to do — and every step after it is skipped. The usual cause is an apostrophe in an ' +
        "English comment inside a single-quoted argument (`node -e '…'`): it closes the " +
        'string, and bash parses the rest as commands. Use a heredoc with a QUOTED delimiter ' +
        "(`node <<'NODE'`) rather than escaping the prose",
    ).toEqual([]);
  });
});
