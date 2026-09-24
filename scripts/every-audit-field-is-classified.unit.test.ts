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
 * container of its own, so each task is a process nothing else sets up. The
 * three commands an operator types at a terminal (the worker's cutover CLI,
 * `operator.sh leave` and `operator.sh links`) print no line: their output is
 * a terminal, not a stream a collector reads, and T4's download serves their
 * rows.
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
          // Every argument, the first included: a drizzle `sql` template
          // carries its JSON inside the statement, not after it.
          node.arguments.forEach(inner);
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
    // A row written through a drizzle `sql` template, its JSON inside the
    // statement (0108 T8 (d)): missed until a surviving mutation said so.
    expect(
      all.some((w) => w.where.startsWith('apps/api/src/scripts/operator-links.ts') && w.fields.has('until')),
    ).toBe(true);
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

  it("the API reads the key on the owner's connection: its request path is app_user, which may not", () => {
    const api = readFileSync(join(REPO, 'apps/api/src/index.ts'), 'utf8');
    const wiring = api.slice(api.indexOf('setAuditExportSink(auditExportOn('));
    const sink = wiring.slice(0, wiring.indexOf(';'));

    expect(sink).not.toContain('getDbPool()');
    expect(sink).toContain('auditKeyPool');
    expect(api).toMatch(/const auditKeyPool = new Pool\(\{ connectionString: migrationUrl\b/);
    // The operator's download reads the same key on the same connection, so a
    // person is the same pseudonym in a downloaded line as in the printed one.
    expect(api).toContain('setAuditKeyDriver(pgDriver(auditKeyPool))');
  });
});

/**
 * The places the code names a view: a string or a template, which is where SQL
 * is written. A comment that mentions one is not a reader.
 */
function readersOf(view: string): string[] {
  const found: string[] = [];
  const name = new RegExp(`\\b${view}\\b`);
  for (const file of sources) {
    const text = readFileSync(join(REPO, file), 'utf8');
    if (!text.includes(view)) continue;
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
        name.test(node.text)
      ) {
        found.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return found;
}

describe("the operator's download is the one reader of the rows it reads whole", () => {
  // `support_audit_export` (managed migration 0026) serves the audit rows with
  // `detail`, which no other support view selects: the export's line is made
  // from the whole row and pseudonymises it field by field. A second reader
  // could serve those rows as they are, so there is one, and it makes lines.
  it('reads support_audit_export in one place: the download, which makes every row a line', () => {
    const readers = readersOf('support_audit_export');

    expect(readers).toHaveLength(1);
    expect(readers[0]).toMatch(/^apps\/api\/src\/routes\/support\.ts:\d+$/);
    const route = readFileSync(join(REPO, 'apps/api/src/routes/support.ts'), 'utf8');
    const handler = route.slice(route.indexOf("router.get('/audit-export'"));
    const body = handler.slice(0, handler.indexOf('\nrouter.'));
    expect(body).toContain('sql`public.support_audit_export`');
    expect(body).toContain('auditExportLine(e, { pseudonym,');
    expect(body).toContain('auditPseudonymKey()');
  });
});
