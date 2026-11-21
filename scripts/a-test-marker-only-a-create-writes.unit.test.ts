// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TEST MARKER ONLY A CREATE WRITES: a migration's marker is written when it is made and never again, which 0070's trigger guarantees, and this guard warns of any update that names it before the merge (workplan 0162 T1, §3; the owner's §2 (c); ADR-0053).
 *
 * A test migration copies only the items whose own title carries its marker
 * (`mailbox_mapping.test_marker`, ledger migration 0070). Taking the marker
 * off a running one would start copying a real account whole into a test
 * target; changing it would leave copies the new marker does not explain. So
 * `POST /api/migrations` writes it once, in the transaction that creates the
 * migration, copied from the organisation, and nothing writes it afterwards.
 *
 * **The guarantee is 0070's BEFORE UPDATE trigger**, which refuses any change
 * of the column, for every role, at the database. This guard is an early
 * warning, before the merge: it reads every update of `mailbox_mapping` it can
 * recognise in the repository and refuses any that names the column, so a
 * door that tried is red here rather than a refusal somebody meets on live.
 * It reads:
 *
 *  - **SQL, in every tracked file that can carry it** (TypeScript, scripts,
 *    shell, SQL, workflows and docs): each `UPDATE` of the table, to the end of
 *    its statement, each `INSERT` into it with an `ON CONFLICT … DO UPDATE`,
 *    whose update half is read, and each `MERGE INTO` it, whose `UPDATE SET`
 *    clauses are read. A statement ends at its first `;` outside a quoted
 *    literal, so `'a;b'` does not end one;
 *  - **drizzle, from the syntax tree**: each `.update(table).set(…)` and each
 *    `.insert(table)…onConflictDoUpdate({ set })`. The table must be named as
 *    itself, `schema.<table>` or an imported table, so that `mailboxMapping`
 *    cannot hide behind another name: an alias (`const t = schema.mailboxMapping`),
 *    `schema['mailboxMapping']`, or any table argument that is not a defined
 *    table's own name is refused, whichever table it is. For `mailboxMapping`,
 *    the keys its `.set(…)` writes are read, and a spread is followed to the
 *    object it spreads: its declaration's literal, and every `x.key = …` and
 *    `Object.assign(x, …)` in the function around it, as the PUT route builds
 *    its `updateData`. A key it cannot read refuses too: a `.set()` whose keys
 *    nobody can see is one that could name the marker.
 *
 * What it cannot see, the trigger still refuses: SQL built by concatenating
 * strings, a column named through `sql.identifier()`, a statement longer than
 * forty lines before its end, and the tests, which are not read because the
 * trigger's own proof updates the column on purpose, to watch it refused
 * (`packages/ledger/src/__tests__/the-marker-column.ts`). The planted cases
 * below are this guard's own proof that it catches what it can see.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/a-test-marker-only-a-create-writes.unit.test.ts';

/** The column, as SQL names it and as drizzle's schema names it. */
const COLUMN_SQL = /\btest_marker\b/i;
const COLUMN_KEYS = new Set(['test_marker', 'testMarker']);

/** Text files that can carry a statement. */
const TEXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|sql|sh|bash|ps1|md|yml|yaml)$/;
const A_TEST = /(\.test\.(ts|tsx)$)|(\/__tests__\/)/;

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((f) => TEXT.test(f) && !A_TEST.test(f) && f !== SELF);
}

/** One update found: where, what it is, and why it is refused, if it is. */
export interface Update {
  readonly where: string;
  readonly kind: 'sql update' | 'sql upsert' | 'sql merge' | 'drizzle update' | 'drizzle upsert';
  /** Null when it names no marker; otherwise why it is refused. */
  readonly refused: string | null;
}

const TABLE = String.raw`(?:ONLY\s+)?(?:"?public"?\s*\.\s*)?"?mailbox_mapping(?![A-Za-z0-9_])"?`;
const SQL_UPDATE = new RegExp(String.raw`\bUPDATE\s+${TABLE}`, 'gi');
const SQL_INSERT = new RegExp(String.raw`\bINSERT\s+INTO\s+${TABLE}`, 'gi');
const SQL_MERGE = new RegExp(String.raw`\bMERGE\s+INTO\s+${TABLE}`, 'gi');

/**
 * Where a quoted SQL literal that opens at `open` closes, or -1. A literal
 * closes on its own line (a doubled `''` inside it is a quote, not its end); a
 * quote that does not close on its line, such as the one that ends a
 * JavaScript string around the statement, is read as text.
 */
function closingQuote(text: string, open: number): number {
  for (let at = open + 1; at < text.length; at++) {
    const c = text[at];
    if (c === '\n') return -1;
    if (c === "'") {
      if (text[at + 1] === "'") {
        at += 1;
        continue;
      }
      return at;
    }
  }
  return -1;
}

/**
 * A statement from its first word to its end: the next `;` outside a quoted
 * literal, or forty lines on, whichever comes first, since a statement in a
 * shell script ends at its line and a template literal's at its backtick.
 */
function statementFrom(text: string, at: number): string {
  let end = -1;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (c === ';') {
      end = i;
      break;
    }
    if (c === "'") {
      const close = closingQuote(text, i);
      if (close !== -1) i = close;
    }
  }
  const lines = text.slice(at, end === -1 ? undefined : end).split('\n');
  return lines.slice(0, 40).join('\n');
}

const lineOf = (text: string, at: number): number => text.slice(0, at).split('\n').length;

/** Every SQL update of the table in one file's text, and each upsert's update half. */
export function sqlUpdatesIn(file: string, text: string): Update[] {
  const found: Update[] = [];
  for (const m of text.matchAll(SQL_UPDATE)) {
    const statement = statementFrom(text, m.index);
    found.push({
      where: `${file}:${lineOf(text, m.index)}`,
      kind: 'sql update',
      refused: COLUMN_SQL.test(statement) ? 'an UPDATE of mailbox_mapping names test_marker' : null,
    });
  }
  for (const m of text.matchAll(SQL_INSERT)) {
    const statement = statementFrom(text, m.index);
    const upsert = /\bDO\s+UPDATE\b/i.exec(statement);
    if (!upsert) continue;
    found.push({
      where: `${file}:${lineOf(text, m.index)}`,
      kind: 'sql upsert',
      refused: COLUMN_SQL.test(statement.slice(upsert.index))
        ? 'an ON CONFLICT … DO UPDATE on mailbox_mapping names test_marker'
        : null,
    });
  }
  for (const m of text.matchAll(SQL_MERGE)) {
    const statement = statementFrom(text, m.index);
    // Each `UPDATE SET` clause, to the next `WHEN` or the statement's end: the
    // INSERT branch may carry the marker, as a create does.
    const updates = [...statement.matchAll(/\bUPDATE\s+SET\b([\s\S]*?)(?=\bWHEN\b|$)/gi)];
    found.push({
      where: `${file}:${lineOf(text, m.index)}`,
      kind: 'sql merge',
      refused: updates.some((u) => COLUMN_SQL.test(u[1] ?? ''))
        ? 'a MERGE into mailbox_mapping updates test_marker'
        : null,
    });
  }
  return found;
}

/** The keys an expression would write, and what in it could not be read. */
interface Keys {
  readonly keys: Set<string>;
  readonly unread: string[];
}

const nameOf = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;

/** The nearest function around a node, or its file: where a spread's object is looked for. */
function scopeOf(node: ts.Node): ts.Node {
  let at: ts.Node | undefined = node.parent;
  while (at && !ts.isFunctionLike(at) && !ts.isSourceFile(at)) at = at.parent;
  return at ?? node.getSourceFile();
}

/** Every node under `root`, depth first. */
function eachNode(root: ts.Node, visit: (n: ts.Node) => void): void {
  const walk = (n: ts.Node): void => {
    visit(n);
    ts.forEachChild(n, walk);
  };
  walk(root);
}

/** What an identifier spread into a `.set()` holds: its literal, and every key written onto it. */
function keysOfIdentifier(id: ts.Identifier, into: Keys, seen: Set<string>): void {
  const name = id.text;
  if (seen.has(name)) return;
  seen.add(name);
  let scope: ts.Node | undefined = scopeOf(id);
  let declared = false;
  // Out from the nearest function to the file, until a declaration is found.
  while (scope && !declared) {
    eachNode(scope, (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
        declared = true;
        if (n.initializer) keysOf(n.initializer, into, seen);
      }
      if (ts.isParameter(n) && ts.isIdentifier(n.name) && n.name.text === name) {
        declared = true;
        into.unread.push(`${name}, a parameter, whose keys are not in this file`);
      }
    });
    if (!declared) scope = ts.isSourceFile(scope) ? undefined : scopeOf(scope);
  }
  if (!declared) {
    into.unread.push(`${name}, declared nowhere this guard can see`);
    return;
  }
  // Every key written onto it afterwards, in the same file.
  eachNode(id.getSourceFile(), (n) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = n.left;
      if (ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.expression) && left.expression.text === name) {
        into.keys.add(left.name.text);
      }
      if (ts.isElementAccessExpression(left) && ts.isIdentifier(left.expression) && left.expression.text === name) {
        const arg = left.argumentExpression;
        if (ts.isStringLiteralLike(arg)) into.keys.add(arg.text);
        else into.unread.push(`${name}[${arg.getText()}], a key computed at run time`);
      }
    }
    if (
      ts.isCallExpression(n) &&
      n.expression.getText() === 'Object.assign' &&
      n.arguments[0] &&
      ts.isIdentifier(n.arguments[0]) &&
      n.arguments[0].text === name
    ) {
      for (const source of n.arguments.slice(1)) keysOf(source, into, seen);
    }
  });
}

/** The keys an object expression writes, through spreads, conditionals and identifiers. */
function keysOf(node: ts.Expression, into: Keys, seen: Set<string> = new Set()): void {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return keysOf(node.expression, into, seen);
  }
  if (ts.isConditionalExpression(node)) {
    keysOf(node.whenTrue, into, seen);
    keysOf(node.whenFalse, into, seen);
    return;
  }
  if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
    keysOf(node.right, into, seen);
    if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) keysOf(node.left, into, seen);
    return;
  }
  if (ts.isIdentifier(node)) return keysOfIdentifier(node, into, seen);
  if (ts.isObjectLiteralExpression(node)) {
    for (const p of node.properties) {
      if (ts.isSpreadAssignment(p)) keysOf(p.expression, into, seen);
      else if (ts.isShorthandPropertyAssignment(p)) into.keys.add(p.name.text);
      else if (p.name && ts.isComputedPropertyName(p.name)) into.unread.push(`[${p.name.expression.getText()}]`);
      else if (p.name) {
        const key = nameOf(p.name);
        if (key === undefined) into.unread.push(p.name.getText());
        else into.keys.add(key);
      }
    }
    return;
  }
  // `{}` spelled any other way, a call, an await: nothing this can read.
  into.unread.push(node.getText().slice(0, 60));
}

/** The table a drizzle update names: this one, another, or one this guard cannot read. */
type TableNamed = { readonly is: 'the table' } | { readonly is: 'another table' } | { readonly is: 'unread'; readonly what: string };

/**
 * Every drizzle table the repository defines (`export const x = pgTable(…)`),
 * by the name its schema exports: what an update's table argument must be.
 */
function definedTables(): Set<string> {
  const names = new Set<string>();
  for (const file of trackedFiles()) {
    if (!/\.(ts|mts|cts)$/.test(file)) continue;
    const text = readFileSync(join(REPO, file), 'utf8');
    for (const m of text.matchAll(/export const ([A-Za-z0-9_$]+) = pgTable\(/g)) names.add(m[1]!);
  }
  return names;
}

let tables: Set<string> | undefined;
/** The defined tables, read once; a planted case can name its own. */
export function tablesDefined(): Set<string> {
  return (tables ??= definedTables());
}

/** What each name a file imports was exported as: `import { connection as c }` is `c` → `connection`. */
function importedNames(tree: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of tree.statements) {
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const spec of bindings.elements) names.set(spec.name.text, (spec.propertyName ?? spec.name).text);
  }
  return names;
}

/**
 * The table an update's argument names. Only a defined table's own name is
 * read: `<anything>.<table>`, or a name imported as one. Anything else, an
 * alias, `schema['…']`, a call, is a table this guard cannot read, which it
 * refuses whichever table it is: `mailboxMapping` could be behind it.
 */
function tableNamed(node: ts.Expression | undefined, imported: Map<string, string>, defined: Set<string>): TableNamed {
  const named = (name: string): TableNamed =>
    name === 'mailboxMapping' ? { is: 'the table' } : { is: 'another table' };
  if (node === undefined) return { is: 'unread', what: 'no table' };
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name) && defined.has(node.name.text)) {
    return named(node.name.text);
  }
  if (ts.isIdentifier(node)) {
    const exported = imported.get(node.text);
    if (exported !== undefined && defined.has(exported)) return named(exported);
  }
  return { is: 'unread', what: node.getText().slice(0, 60) };
}

/** The call `<chain>.<method>(…)` further along the chain that starts at `call`, if any. */
function laterInChain(call: ts.CallExpression, method: string): ts.CallExpression | undefined {
  let at: ts.Node = call;
  while (ts.isPropertyAccessExpression(at.parent) && ts.isCallExpression(at.parent.parent)) {
    if (at.parent.name.text === method) return at.parent.parent;
    at = at.parent.parent;
  }
  return undefined;
}

function refusalOf(keys: Keys, what: string): string | null {
  const named = [...keys.keys].filter((k) => COLUMN_KEYS.has(k));
  if (named.length > 0) return `${what} writes ${named.join(', ')}`;
  if (keys.unread.length > 0) return `${what} writes keys this guard cannot read: ${keys.unread.join('; ')}`;
  return null;
}

/**
 * Every drizzle update of the table in one TypeScript file, and each upsert;
 * and every drizzle update or upsert of a table this guard cannot read.
 */
export function drizzleUpdatesIn(file: string, text: string, defined: Set<string> = tablesDefined()): Update[] {
  if (!/\.update\(|onConflictDoUpdate/.test(text)) return [];
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imported = importedNames(tree);
  const found: Update[] = [];
  eachNode(tree, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const method = node.expression.name.text;
    if (method !== 'update' && method !== 'insert') return;
    const set = method === 'update' ? laterInChain(node, 'set') : undefined;
    const upsert = method === 'insert' ? laterInChain(node, 'onConflictDoUpdate') : undefined;
    // An insert that is no upsert writes a new row: the create is one.
    if (method === 'insert' && upsert === undefined) return;
    const where = `${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const kind = method === 'update' ? 'drizzle update' : 'drizzle upsert';
    const table = tableNamed(node.arguments[0], imported, defined);
    if (table.is === 'another table') return;
    if (table.is === 'unread') {
      // Only a drizzle update is read so: one with a `.set()` after it.
      // `hash.update(…).digest()` names no table.
      if (method === 'update' && set === undefined) return;
      found.push({
        where,
        kind,
        refused: `its table, ${table.what}, is not a table this guard can read: name it as itself (schema.<table>)`,
      });
      return;
    }
    if (method === 'update') {
      const keys: Keys = { keys: new Set(), unread: [] };
      if (set?.arguments[0]) keysOf(set.arguments[0], keys);
      else keys.unread.push('an update with no .set() this guard can find');
      found.push({ where, kind, refused: refusalOf(keys, 'its .set()') });
      return;
    }
    const keys: Keys = { keys: new Set(), unread: [] };
    const config = upsert?.arguments[0];
    const setProp =
      config && ts.isObjectLiteralExpression(config)
        ? config.properties.find((p) => p.name !== undefined && nameOf(p.name) === 'set')
        : undefined;
    if (setProp && ts.isPropertyAssignment(setProp)) keysOf(setProp.initializer, keys);
    else keys.unread.push('an onConflictDoUpdate whose set this guard cannot find');
    found.push({ where, kind, refused: refusalOf(keys, 'its onConflictDoUpdate set') });
  });
  return found;
}

/** Every update of mailbox_mapping in the tree. */
function updatesInTheTree(): Update[] {
  return trackedFiles().flatMap((file) => {
    const text = readFileSync(join(REPO, file), 'utf8');
    return [
      ...sqlUpdatesIn(file, text),
      ...(/\.(ts|tsx|mts|cts)$/.test(file) ? drizzleUpdatesIn(file, text) : []),
    ];
  });
}

describe('no update of mailbox_mapping anywhere names its test marker', () => {
  const all = updatesInTheTree();

  it('finds the updates, so the check below is not vacuous', () => {
    const sites = (kind: Update['kind']) => all.filter((u) => u.kind === kind).map((u) => u.where.replace(/:\d+$/, ''));
    // The doors that write the row, each read from the tree.
    expect(sites('drizzle update')).toEqual(
      expect.arrayContaining([
        'apps/api/src/routes/migrations/index.ts',
        'apps/api/src/routes/migrations/operating-routes.ts',
        'apps/api/src/routes/migrations/grant-ending.ts',
        'apps/api/src/routes/withdraw-grant.ts',
        'packages/ledger/src/mapping-status-audit.ts',
        'packages/ledger/src/a-cutover-of-one-data-type.ts',
      ]),
    );
    expect(all.filter((u) => u.kind === 'drizzle update').length).toBeGreaterThanOrEqual(12);
    // SQL in code, a script, a smoke and a runbook.
    expect(sites('sql update')).toEqual(
      expect.arrayContaining([
        'apps/selfhost/src/config-dir.ts',
        'apps/selfhost/src/index.ts',
        'deploy/compose/smoke-managed.sh',
        'docs/incident-runbook.md',
      ]),
    );
    // The appliance's mapping file, written over its row by an upsert.
    expect(sites('sql upsert')).toContain('apps/selfhost/src/index.ts');
  });

  it('leaves the one writer it is for: the create, which copies the organisation\'s marker', () => {
    // An insert, never an update, so nothing above reads it.
    const create = readFileSync(join(REPO, 'apps/api/src/routes/migrations/index.ts'), 'utf8');
    expect(create).toMatch(/\.insert\(schema\.mailboxMapping\)[\s\S]{0,4000}?testMarker: testMarker \?\? null/);
  });

  it('refuses none, or names each that writes the marker or keys it cannot read', () => {
    const refused = all.filter((u) => u.refused !== null).map((u) => `${u.where} (${u.kind}): ${u.refused}`);
    expect(
      refused,
      'a migration\'s test marker is written when it is created and never again (workplan 0162 §2 (c), ' +
        'ledger migration 0070); take the marker out of this update, or spell its keys where they can be read',
    ).toEqual([]);
  });
});

describe('it catches a planted one', () => {
  const sql = (text: string) => sqlUpdatesIn('planted.ts', text);
  const drizzle = (text: string) => drizzleUpdatesIn('planted.ts', text);
  const refusedOf = (found: Update[]) => found.map((u) => u.refused !== null);

  it('an UPDATE that sets it, clears it, or sets it beside another column, on one line or several', () => {
    expect(refusedOf(sql('await q(`UPDATE mailbox_mapping SET test_marker = NULL WHERE id = $1`);'))).toEqual([true]);
    expect(refusedOf(sql("UPDATE public.mailbox_mapping\n   SET name = 'x',\n       test_marker = 'y'\n WHERE id = $1;"))).toEqual([true]);
    expect(refusedOf(sql('UPDATE ONLY "mailbox_mapping" m SET "test_marker" = $2 WHERE m.id = $1;'))).toEqual([true]);
    // Another column only, the trigger's own DDL, and another table: none refused, or not read at all.
    expect(refusedOf(sql("UPDATE mailbox_mapping SET status = 'paused' WHERE id = $1;"))).toEqual([false]);
    expect(sql('CREATE TRIGGER t BEFORE UPDATE ON public.mailbox_mapping FOR EACH ROW EXECUTE FUNCTION f();')).toEqual([]);
    expect(sql('UPDATE mailbox SET primary_address = $2 WHERE id = $1;')).toEqual([]);
  });

  it('an upsert whose update half writes it, and not the insert that is the create', () => {
    expect(
      refusedOf(
        sql(
          'INSERT INTO mailbox_mapping (id, tenant_id, test_marker) VALUES ($1, $2, $3)\n' +
            '  ON CONFLICT (id) DO UPDATE SET test_marker = EXCLUDED.test_marker;',
        ),
      ),
    ).toEqual([true]);
    expect(
      refusedOf(
        sql(
          'INSERT INTO mailbox_mapping (id, tenant_id, test_marker) VALUES ($1, $2, $3)\n' +
            '  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;',
        ),
      ),
    ).toEqual([false]);
    expect(sql('INSERT INTO mailbox_mapping (id, test_marker) VALUES ($1, $2);')).toEqual([]);
  });

  it('a drizzle .set() that names it, by either spelling, directly or behind a spread', () => {
    expect(refusedOf(drizzle('db.update(schema.mailboxMapping).set({ testMarker: null }).where(x);'))).toEqual([true]);
    expect(
      refusedOf(
        drizzle("import { mailboxMapping } from '@openmig/ledger';\ndb.update(mailboxMapping).set({ status: 'done', 'test_marker': 'y' });"),
      ),
    ).toEqual([true]);
    expect(
      refusedOf(drizzle('const u = { name: "n" };\nif (b) u.testMarker = "x";\ndb.update(schema.mailboxMapping).set({ ...u, updatedAt: now });')),
    ).toEqual([true]);
    expect(
      refusedOf(drizzle('const u = {};\nObject.assign(u, { testMarker: null });\ndb.update(schemaPg.mailboxMapping).set(u);')),
    ).toEqual([true]);
    expect(
      refusedOf(drizzle('db.update(schema.mailboxMapping).set({ ...(clear ? { testMarker: null } : {}), updatedAt: now });')),
    ).toEqual([true]);
  });

  it('a drizzle .set() whose keys it cannot read, and not one it can', () => {
    expect(refusedOf(drizzle('function f(values) { return db.update(schema.mailboxMapping).set(values); }'))).toEqual([true]);
    expect(refusedOf(drizzle('db.update(schema.mailboxMapping).set(await build());'))).toEqual([true]);
    expect(refusedOf(drizzle('db.update(schema.mailboxMapping).set({ [column]: null });'))).toEqual([true]);
    expect(
      refusedOf(drizzle('const u: Partial<Row> = {};\nu.status = "paused";\ndb.update(schema.mailboxMapping).set({ ...u, updatedAt: new Date() });')),
    ).toEqual([false]);
    // Another table's update, and the create's insert: not updates of this one.
    expect(drizzle('db.update(schema.mailbox).set({ testMarker: 1 });')).toEqual([]);
    expect(drizzle('db.insert(schema.mailboxMapping).values({ testMarker: m }).returning();')).toEqual([]);
  });

  it('a table named some other way than as itself, whichever table it is', () => {
    // An alias, a computed member, a table a function was handed, another
    // object's member, a call: mailboxMapping could be behind any of them.
    expect(refusedOf(drizzle("const t = schema.mailboxMapping;\ndb.update(t).set({ status: 'paused' });"))).toEqual([true]);
    expect(refusedOf(drizzle("db.update(schema['mailboxMapping']).set({ status: 'paused' });"))).toEqual([true]);
    expect(refusedOf(drizzle("function f(table) { return db.update(table).set({ status: 'paused' }); }"))).toEqual([true]);
    expect(refusedOf(drizzle("db.update(ctx.table).set({ status: 'paused' });"))).toEqual([true]);
    expect(
      refusedOf(drizzle('db.insert(pick()).values(v).onConflictDoUpdate({ target: x, set: { name: n } });')),
    ).toEqual([true]);
    // An imported table is read as itself, under whatever name it was imported as.
    expect(
      refusedOf(drizzle("import { mailboxMapping as mm } from '@openmig/ledger';\ndb.update(mm).set({ testMarker: null });")),
    ).toEqual([true]);
    expect(
      refusedOf(drizzle("import { mailboxMapping as mm } from '@openmig/ledger';\ndb.update(mm).set({ status: 'paused' });")),
    ).toEqual([false]);
    expect(drizzle("import { connection as c } from '@openmig/ledger';\ndb.update(c).set({ status: 'x' });")).toEqual([]);
    // A hash's update names no table.
    expect(drizzle("createHash('sha256').update(data).digest('hex');")).toEqual([]);
  });

  it('a MERGE whose update writes it, and not one whose insert carries it', () => {
    expect(
      refusedOf(sql('MERGE INTO mailbox_mapping m USING src s ON m.id = s.id\n WHEN MATCHED THEN UPDATE SET test_marker = s.marker;')),
    ).toEqual([true]);
    expect(
      refusedOf(
        sql(
          'MERGE INTO public.mailbox_mapping m USING src s ON m.id = s.id\n' +
            ' WHEN MATCHED THEN UPDATE SET name = s.name\n' +
            ' WHEN NOT MATCHED THEN INSERT (id, test_marker) VALUES (s.id, s.marker);',
        ),
      ),
    ).toEqual([false]);
  });

  it('a statement whose quoted literal holds a semicolon, read to its own end', () => {
    expect(refusedOf(sql("UPDATE mailbox_mapping SET name = 'a;b', test_marker = NULL WHERE id = $1;"))).toEqual([true]);
    expect(refusedOf(sql("UPDATE mailbox_mapping SET name = 'it''s; fine' WHERE id = $1;"))).toEqual([false]);
    // The quote that closes a JavaScript string around the statement is text,
    // and the statement still ends where it does.
    expect(
      refusedOf(sql("db.query('UPDATE mailbox_mapping SET status = $2 WHERE id = $1', [id, s]);\nconst test_marker = 1;")),
    ).toEqual([false]);
  });

  it('an upsert in drizzle whose set writes it', () => {
    expect(
      refusedOf(
        drizzle('db.insert(schema.mailboxMapping).values(v).onConflictDoUpdate({ target: t, set: { testMarker: m } });'),
      ),
    ).toEqual([true]);
    expect(
      refusedOf(drizzle('db.insert(schema.mailboxMapping).values(v).onConflictDoUpdate({ target: t, set: { name: n } });')),
    ).toEqual([false]);
  });
});
