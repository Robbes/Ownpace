// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY AUDIT FIELD IS CLASSIFIED (workplan 0129 T4; the owner's D4: "Email
 * addresses and file names replaced by pseudonyms in the export by default").
 *
 * The audit export decides what may leave field by field
 * (`AUDIT_DETAIL_FIELDS` in shared), because no pattern can tell a file's name
 * from a migration's state. A field that list does not know is dropped from
 * the export, which keeps it safe and makes it silent: a new audit field would
 * vanish from every collector and nobody would be told. This reads every
 * place in the repository that writes an audit event, from the syntax tree,
 * and fails naming each field nobody has classified, so the choice between
 * `keep`, `pseudonym` and `origin` is made where the field is added.
 *
 * It also holds every process that records audit events to pointing their
 * lines at its output: the API, the appliance, the worker, and every task file
 * that opens the database, because Trigger.dev runs each task run in a
 * container of its own, so each task is a process nothing else sets up. The two
 * commands an operator types at a terminal (the worker's cutover CLI and
 * `operator.sh leave`) print no line: their output is a terminal, not a stream
 * a collector reads, and T4's download serves their rows.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { AUDIT_DETAIL_FIELDS } from '../packages/shared/src/audit-export.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const sources = execFileSync('git', ['ls-files', 'apps', 'packages'], { cwd: REPO, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'));

/** The field names an object literal gives, through spreads and conditionals, at every depth. */
function fieldsOf(node: ts.Node | undefined, into: Set<string>): void {
  if (!node) return;
  if (ts.isParenthesizedExpression(node)) return fieldsOf(node.expression, into);
  if (ts.isConditionalExpression(node)) {
    fieldsOf(node.whenTrue, into);
    fieldsOf(node.whenFalse, into);
    return;
  }
  if (!ts.isObjectLiteralExpression(node)) return;
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) fieldsOf(property.expression, into);
    else if (ts.isPropertyAssignment(property)) {
      into.add(property.name.getText().replace(/^['"]|['"]$/g, ''));
      fieldsOf(property.initializer, into);
    } else if (ts.isShorthandPropertyAssignment(property)) into.add(property.name.getText());
  }
}

interface Writer {
  readonly where: string;
  readonly fields: ReadonlySet<string>;
}

/** Every audit write: `recordAuditEvent(tenant, { detail })`, and a raw INSERT's JSON. */
function writers(): Writer[] {
  const found: Writer[] = [];
  for (const file of sources) {
    const text = readFileSync(join(REPO, file), 'utf8');
    if (!text.includes('recordAuditEvent(') && !text.includes('INSERT INTO audit_log')) continue;
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const where = `${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        const callee = node.expression;
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'recordAuditEvent') {
          const event = node.arguments[1];
          const fields = new Set<string>();
          if (event && ts.isObjectLiteralExpression(event)) {
            for (const p of event.properties) {
              if (ts.isPropertyAssignment(p) && p.name.getText() === 'detail') fieldsOf(p.initializer, fields);
            }
          }
          found.push({ where, fields });
        }
        const first = node.arguments[0];
        if (first && /INSERT INTO audit_log/.test(first.getText())) {
          const fields = new Set<string>();
          const inner = (n: ts.Node): void => {
            if (ts.isCallExpression(n) && n.expression.getText() === 'JSON.stringify') fieldsOf(n.arguments[0], fields);
            ts.forEachChild(n, inner);
          };
          node.arguments.slice(1).forEach(inner);
          found.push({ where, fields });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return found;
}

describe('every field an audit event carries is classified for the export', () => {
  const all = writers();

  it('finds the writers, so the check below is not vacuous', () => {
    expect(all.length).toBeGreaterThanOrEqual(12);
    expect(all.some((w) => w.where.startsWith('apps/api/src/scripts/operator.ts'))).toBe(true);
    expect(all.some((w) => w.fields.has('grantee'))).toBe(true);
  });

  it('names no field AUDIT_DETAIL_FIELDS does not know', () => {
    const unclassified = all.flatMap((w) =>
      [...w.fields].filter((f) => !(f in AUDIT_DETAIL_FIELDS)).map((f) => `${w.where}: ${f}`),
    );

    expect(unclassified, 'classify each as keep, pseudonym or origin in packages/shared/src/audit-export.ts').toEqual(
      [],
    );
  });
});

/** Each task file that opens the database: a process of its own, one per run. */
const tasks = sources.filter(
  (f) => f.startsWith('apps/worker/src/jobs/') && readFileSync(join(REPO, f), 'utf8').includes('new Pool('),
);

describe('every process that writes audit events points its lines at its output', () => {
  it('finds the tasks, so the check below is not vacuous', () => {
    expect(tasks.length).toBeGreaterThanOrEqual(14);
    expect(tasks).toContain('apps/worker/src/jobs/managed-digest.ts');
    expect(tasks).toContain('apps/worker/src/jobs/run-rollback.ts');
  });

  it.each(['apps/selfhost/src/index.ts', 'apps/api/src/index.ts', 'apps/worker/src/index.ts', ...tasks])(
    '%s',
    (file) => {
      expect(readFileSync(join(REPO, file), 'utf8')).toContain('setAuditExportSink(auditExportOn(');
    },
  );
});
