// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASSWORD A WORKFLOW SPELLS OUT (workplan 0163, Status of 2026-11-23: an
 * outside, read-only check of 5b51a82b found nine).
 *
 * `.github/workflows/e2e.yml` named six passwords in its top-level `env:`, for
 * the self-hosted dev stack's Stalwart, Nextcloud and Postgres;
 * `e2e-managed.yml` named the password of the demo's mail source on the OTA
 * stack, whose Stalwart persists between runs; and `images.yml`'s database
 * build check wrote a Postgres password into a `.env` and a `docker run`. Each
 * was a test credential to a throwaway or a demo, not a credential to anything
 * real, and gitleaks 8.30.1 with `.gitleaks.toml` finds none of them (its
 * generic rule wants more entropy than `source_password` has), which is why
 * ci.yml's `gitleaks` job never said so. But a working file should name no
 * credential, and one that lives for one run is better than one that lives in
 * the history. So each run now makes its own, at random, masks it and hands it
 * to the steps that need it through `$GITHUB_ENV`. This holds:
 *
 *  1. NO CREDENTIAL KEY IS SET TO A LITERAL, anywhere in a workflow: an `env:`
 *     or `with:` entry whose name says password, passwd, secret, token or key
 *     is empty or an expression (`${{ secrets.X }}`, `${{ env.X }}`), and an
 *     expression carries no string literal but `''`, so `${{ secrets.X ||
 *     'fallback' }}` is a literal too. In a `run:` script, `NAME=value` with
 *     such a name takes a variable or a command substitution (`$X`, `${X}`,
 *     `$(…)`), never a word.
 *  2. A CREDENTIAL A STEP WRITES TO `$GITHUB_ENV` IS MASKED IN THAT SAME STEP
 *     (`::add-mask::`), so no later log line prints it.
 *  3. THE CHECKS THEMSELVES, against made-up workflows: each shape above is
 *     caught, and each allowed shape passes.
 *
 * Not .gitleaks.toml's job and not an allowlist: gitleaks still reads every
 * commit a pull request adds, with its default rules (a-secret-a-pull-request-could-add).
 * This reads the tree's workflows, every pull request and every push.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = '.github/workflows';

/** An environment variable's or an action input's name that says it holds a credential. */
const CREDENTIAL_NAME = /(^|[-_])(PASSWORD|PASSWD|SECRET|TOKEN)([-_]|$)|[-_]KEY$|^(PASSWORD|PASSWD|SECRET|TOKEN)$/i;

/** One place a workflow sets a credential to a literal. */
interface Literal {
  readonly where: string;
  readonly name: string;
}

/**
 * Whether a value given to a credential name is no literal: empty, or nothing
 * but `${{ }}` expressions whose only string literal is `''`.
 */
export function isExpressionOnly(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text === '') return true;
  const expressions = [...text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)];
  if (expressions.length === 0) return false;
  if (text.replace(/\$\{\{[\s\S]*?\}\}/g, '').trim() !== '') return false;
  return expressions.every((m) => [...m[1]!.matchAll(/'((?:[^']|'')*)'/g)].every((s) => s[1] === ''));
}

/**
 * `NAME=value` in a shell script where NAME is a credential's and the value is
 * a word: after one optional quote, the value must take a variable or a
 * command substitution (a `$` in it, `\$` too, a dollar escaped for an inner
 * shell; e2e-managed.yml's `gate-$(od … /dev/urandom …)` is one), or be empty.
 */
export function literalsInScript(script: string): string[] {
  const found: string[] = [];
  for (const m of script.matchAll(/(?<![A-Za-z0-9_$])([A-Za-z0-9_]+)=(\S*)/g)) {
    const name = m[1]!;
    if (!CREDENTIAL_NAME.test(name)) continue;
    const value = m[2]!.replace(/^["']/, '');
    if (value === '' || /^["']/.test(value) || value.includes('$')) continue;
    found.push(name);
  }
  return found;
}

/** Every literal credential in one parsed workflow, by where it sits (1). */
export function literalsIn(file: string, doc: unknown): Literal[] {
  const found: Literal[] = [];
  const walk = (node: unknown, path: string[]): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, [...path, String(i)]));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const here = [...path, key];
      if ((key === 'env' || key === 'with') && value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const [name, given] of Object.entries(value as Record<string, unknown>)) {
          if (CREDENTIAL_NAME.test(name) && !isExpressionOnly(given)) {
            found.push({ where: `${file}: ${[...here, name].join('.')}`, name });
          }
        }
      }
      if (key === 'run' && typeof value === 'string') {
        for (const name of literalsInScript(value)) found.push({ where: `${file}: ${here.join('.')}`, name });
      }
      walk(value, here);
    }
  };
  walk(doc, []);
  return found;
}

/** Every step's `run:` that writes a credential's name to `$GITHUB_ENV` without masking (2). */
export function unmaskedExports(file: string, doc: unknown): string[] {
  const found: string[] = [];
  const jobs = ((doc as { jobs?: Record<string, { steps?: { name?: string; run?: unknown }[] }> }).jobs ?? {});
  for (const [job, body] of Object.entries(jobs)) {
    for (const [i, step] of (body.steps ?? []).entries()) {
      if (typeof step.run !== 'string' || !step.run.includes('GITHUB_ENV')) continue;
      const writes = [...step.run.matchAll(/([A-Za-z0-9_]+|\$\{?[A-Za-z_]+\}?)=[^\n]*>>\s*"?\$GITHUB_ENV/g)].map((m) => m[1]!);
      const credential = writes.some((w) => w.startsWith('$') || CREDENTIAL_NAME.test(w));
      if (credential && !step.run.includes('::add-mask::')) found.push(`${file}: jobs.${job}.steps.${i} (${step.name ?? 'unnamed'})`);
    }
  }
  return found;
}

const workflowFiles = (): string[] =>
  readdirSync(join(REPO_ROOT, WORKFLOWS))
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();

const parsed = (f: string): unknown => parseYaml(readFileSync(join(REPO_ROOT, WORKFLOWS, f), 'utf8'));

describe('a password a workflow spells out', () => {
  it('reads the workflows there are', () => {
    expect(workflowFiles()).toEqual(expect.arrayContaining(['ci.yml', 'e2e.yml', 'e2e-managed.yml', 'images.yml']));
  });

  it('(1) sets no credential to a literal in any workflow', () => {
    const found = workflowFiles().flatMap((f) => literalsIn(`${WORKFLOWS}/${f}`, parsed(f)));
    expect(found.map((l) => `${l.where} (${l.name})`)).toEqual([]);
  });

  it('(2) masks, in the same step, every credential a step hands on through $GITHUB_ENV', () => {
    expect(workflowFiles().flatMap((f) => unmaskedExports(`${WORKFLOWS}/${f}`, parsed(f)))).toEqual([]);
  });

  it("(1) the three workflows the outside check named each make their run's own credentials, masked", () => {
    for (const f of ['e2e.yml', 'e2e-managed.yml', 'images.yml']) {
      const text = readFileSync(join(REPO_ROOT, WORKFLOWS, f), 'utf8');
      expect(text, f).toContain('/dev/urandom');
      expect(text, f).toContain('::add-mask::');
    }
  });
});

describe('a password a workflow spells out: the checks themselves (3)', () => {
  const doc = (yaml: string) => parseYaml(yaml);

  it('catches a literal in a workflow, a job and a step env, and in a with', () => {
    const found = literalsIn(
      'made-up.yml',
      doc(`
env:
  DB_PASSWORD: not-a-real-one
jobs:
  j:
    env:
      API_TOKEN: not-a-real-one
    steps:
      - env:
          SIGNING_KEY: not-a-real-one
          CLIENT_SECRET: '1234'
        run: echo
      - uses: some/action@0000000000000000000000000000000000000000
        with:
          password: not-a-real-one
`),
    );
    expect(found.map((l) => l.name)).toEqual(['DB_PASSWORD', 'API_TOKEN', 'SIGNING_KEY', 'CLIENT_SECRET', 'password']);
  });

  it('catches a literal fallback inside an expression, and a literal around one', () => {
    expect(isExpressionOnly("${{ secrets.X || 'not-a-real-one' }}")).toBe(false);
    expect(isExpressionOnly('prefix-${{ secrets.X }}')).toBe(false);
    expect(isExpressionOnly(1234)).toBe(false);
  });

  it('passes an expression, an empty value and a name that is no credential', () => {
    expect(isExpressionOnly('${{ secrets.TRIGGER_ACCESS_TOKEN }}')).toBe(true);
    expect(isExpressionOnly('${{ env.SOURCE_IMAP_PASSWORD }}')).toBe(true);
    expect(isExpressionOnly("${{ vars.X || '' }}")).toBe(true);
    expect(isExpressionOnly('')).toBe(true);
    const found = literalsIn(
      'made-up.yml',
      doc(`
permissions:
  id-token: write
jobs:
  j:
    steps:
      - uses: actions/checkout@0000000000000000000000000000000000000000
        with:
          persist-credentials: false
          key: some-cache
        env:
          NEXTCLOUD_ADMIN_USER: admin
          GITLEAKS_SHA256_X64: 551f6fc8
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: echo
`),
    );
    expect(found).toEqual([]);
  });

  it('catches NAME=word in a run script and passes NAME=$variable', () => {
    expect(literalsInScript("printf 'POSTGRES_PASSWORD=not-a-real-one\\n' > .env")).toEqual(['POSTGRES_PASSWORD']);
    expect(literalsInScript('docker run -e POSTGRES_PASSWORD=not-a-real-one image')).toEqual(['POSTGRES_PASSWORD']);
    expect(literalsInScript('export API_TOKEN="not-a-real-one"')).toEqual(['API_TOKEN']);
    expect(literalsInScript('docker run -e POSTGRES_PASSWORD="$PASSWORD" image')).toEqual([]);
    expect(literalsInScript('POSTGRES_PASSWORD=${POSTGRES_PASSWORD}')).toEqual([]);
    expect(literalsInScript('healthcheck="PGPASSWORD=\\${PGBOUNCER_AUTH_PASSWORD} psql"')).toEqual([]);
    expect(literalsInScript('echo "${name}=${value}" >> "$GITHUB_ENV"')).toEqual([]);
    expect(literalsInScript('SEED_COUNT=3 node seed.mjs')).toEqual([]);
    expect(literalsInScript('"CLIENT_SECRET=gate-$(od -An -N8 -tx1 /dev/urandom)"')).toEqual([]);
  });

  it('catches a credential handed on unmasked, and passes it masked', () => {
    const step = (run: string) => doc(`jobs:\n  j:\n    steps:\n      - name: s\n        run: |\n${run.split('\n').map((l) => `          ${l}`).join('\n')}\n`);
    expect(unmaskedExports('made-up.yml', step('echo "DB_PASSWORD=$value" >> "$GITHUB_ENV"'))).toHaveLength(1);
    expect(unmaskedExports('made-up.yml', step('echo "${name}=${value}" >> "$GITHUB_ENV"'))).toHaveLength(1);
    expect(unmaskedExports('made-up.yml', step('echo "::add-mask::${value}"\necho "DB_PASSWORD=${value}" >> "$GITHUB_ENV"'))).toEqual([]);
    expect(unmaskedExports('made-up.yml', step('echo "SELFHOST_PORT=1234" >> "$GITHUB_ENV"'))).toEqual([]);
  });
});
