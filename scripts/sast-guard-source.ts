// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What the four guards of workplan 0178 §5.1 read in a source file, parsed,
 * so that a comment or a string that only mentions a thing is never a spot.
 *
 * - `rawHtmlSpots`: HTML put into a page as HTML (G1,
 *   `a-page-given-html-as-html.unit.test.ts`).
 * - `rawSqlSpots`: SQL text a value is put into (G2,
 *   `sql-a-value-is-put-into.unit.test.ts`).
 * - `doorsOf`: each route a router file or `apps/api/src/index.ts` registers,
 *   and whether it signs a session in (G3,
 *   `a-door-public-in-one-place-only.unit.test.ts`).
 * - `secretLogSpots`: a credential or a mail address handed to the logger by
 *   name (G4, `a-secret-handed-to-the-logger.unit.test.ts`).
 *
 * Each returns spots as `{ line, text }`, `line` 1-based, `text` the start of
 * what was found, so a failure names the place. This module holds no list of
 * allowed places: each guard holds its own, with a reason per place.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export interface Spot {
  line: number;
  text: string;
}

/** The tracked files under `roots` with one of `extensions`, repository-relative. */
export function trackedSources(root: string, roots: string[], extensions: RegExp): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', ...roots], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((f) => extensions.test(f));
}

/** A test, a test's fixture or a test helper: what never ships. */
export function isTestSource(file: string): boolean {
  return /\.test\.(ts|tsx|mjs|js)$/.test(file) || /(^|\/)(__tests__|__testing__)\//.test(file);
}

export function readSource(root: string, file: string): string {
  return readFileSync(join(root, file), 'utf8');
}

function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function spotOf(sf: ts.SourceFile, node: ts.Node): Spot {
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  return { line, text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 80) };
}

function visit(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}

/** The name a call is made through: `a.b.c(` gives `c`, `f(` gives `f`. */
function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isIdentifier(e)) return e.text;
  return undefined;
}

/** The object a method is called on, when it is a plain name: `sql.raw(` gives `sql`. */
function receiverName(call: ts.CallExpression): string | undefined {
  const e = call.expression;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) return e.expression.text;
  return undefined;
}

// ── G1 ──────────────────────────────────────────────────────────────────────

const HTML_PROPERTIES = new Set(['innerHTML', 'outerHTML']);
const HTML_METHODS = new Set(['insertAdjacentHTML', 'createContextualFragment']);

/** `dangerouslySetInnerHTML`, `x.innerHTML =` or `+=`, `insertAdjacentHTML(`, `createContextualFragment(`, `document.write(`. */
export function rawHtmlSpots(file: string, text: string): Spot[] {
  const sf = parse(file, text);
  const out: Spot[] = [];
  visit(sf, (n) => {
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === 'dangerouslySetInnerHTML') out.push(spotOf(sf, n));
    else if (
      ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.EqualsToken || n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) &&
      (ts.isPropertyAccessExpression(n.left) ? HTML_PROPERTIES.has(n.left.name.text) : ts.isElementAccessExpression(n.left) && ts.isStringLiteral(n.left.argumentExpression) && HTML_PROPERTIES.has(n.left.argumentExpression.text))
    )
      out.push(spotOf(sf, n));
    else if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      if (name !== undefined && HTML_METHODS.has(name)) out.push(spotOf(sf, n));
      else if ((name === 'write' || name === 'writeln') && receiverName(n) === 'document') out.push(spotOf(sf, n));
    }
  });
  return out;
}

// ── G2 ──────────────────────────────────────────────────────────────────────

/** SQL text, in capitals, at the start of a template: what this code writes SQL in. */
const SQL_START = /^\s*(SELECT\b|INSERT\s+INTO\b|UPDATE\b|DELETE\s+FROM\b|SET\s+(LOCAL|ROLE|SESSION)\b|CREATE\b|ALTER\b|DROP\b|TRUNCATE\b|GRANT\b|REVOKE\b|WITH\b)/;
const QUERY_METHODS = new Set(['query', 'execute', 'executeSql']);

function isBuiltText(e: ts.Expression): boolean {
  if (ts.isTemplateExpression(e)) return true;
  if (ts.isParenthesizedExpression(e)) return isBuiltText(e.expression);
  return ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken;
}

/**
 * `sql.raw(`, `.unsafe(`, `sql.identifier(`; a `.query(`, `.execute(` or
 * `.executeSql(` whose text is a template with a value in it or a `+`; and a
 * template with a value in it, not tagged, whose text opens with SQL, unless it
 * is the text of such a call, which is then the one spot. One spot per line.
 */
export function rawSqlSpots(file: string, text: string): Spot[] {
  const sf = parse(file, text);
  const byLine = new Map<number, Spot>();
  const counted = new Set<ts.Node>();
  const add = (n: ts.Node) => {
    const s = spotOf(sf, n);
    if (!byLine.has(s.line)) byLine.set(s.line, s);
  };
  visit(sf, (n) => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      const on = receiverName(n);
      if ((name === 'raw' || name === 'identifier') && on === 'sql') add(n);
      else if (name === 'unsafe' && ts.isPropertyAccessExpression(n.expression)) add(n);
      else if (name !== undefined && QUERY_METHODS.has(name) && ts.isPropertyAccessExpression(n.expression) && n.arguments[0] && isBuiltText(n.arguments[0])) {
        add(n);
        // The call is the spot; the template that is its text is not a second one.
        visit(n.arguments[0], (inner) => counted.add(inner));
      }
    } else if (ts.isTemplateExpression(n) && !counted.has(n) && !ts.isTaggedTemplateExpression(n.parent) && SQL_START.test(n.head.text)) add(n);
  });
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

// ── G3 ──────────────────────────────────────────────────────────────────────

/** What signs a session in: a bearer token, checked. A link's own check is not one. */
export const SIGN_IN = new Set(['authenticate', 'authenticateSubject']);
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

export interface Door {
  method: string;
  path: string;
  line: number;
  /** The names of the handlers before the last, in order: `authenticate`, `linkAuth`, `requireRole`. */
  before: string[];
  signsIn: boolean;
}

/** Each `<on>.<method>('<path>', …)` in a file, `on` being `router` or `app`. */
export function doorsOf(file: string, text: string, on: string): Door[] {
  const sf = parse(file, text);
  const out: Door[] = [];
  visit(sf, (n) => {
    if (!ts.isCallExpression(n) || receiverName(n) !== on) return;
    const method = calleeName(n);
    const first = n.arguments[0];
    if (method === undefined || !METHODS.has(method) || !first || !ts.isStringLiteral(first)) return;
    const before = n.arguments.slice(1, -1).map((a) => {
      const callee = ts.isCallExpression(a) ? a.expression : a;
      return ts.isIdentifier(callee) ? callee.text : callee.getText(sf).slice(0, 40);
    });
    out.push({ method, path: first.text, line: spotOf(sf, n).line, before, signsIn: before.some((b) => SIGN_IN.has(b)) });
  });
  return out;
}

// ── G4 ──────────────────────────────────────────────────────────────────────

const LOGGERS = new Set(['log', 'logger', 'appLog', 'console']);
const LEVELS = new Set(['debug', 'info', 'warn', 'error', 'log']);
/** The last word of a name that makes it a credential's. */
const SECRET_WORDS = new Set(['password', 'passwd', 'secret', 'token', 'apikey', 'authorization', 'cookie', 'credential', 'credentials']);

/** `refreshToken` → `refresh token`, `api_key` → `api key`, `APIKey` → `api key`. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-$]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** A name whose value is a credential or a mail address. */
export function isSecretName(name: string): boolean {
  const w = words(name);
  const last = w.at(-1) ?? '';
  const pair = w.slice(-2).join('');
  return SECRET_WORDS.has(last) || SECRET_WORDS.has(pair) || last === 'email' || pair === 'mailaddress';
}

/**
 * The names a log argument hands over by value: the argument itself when it is
 * a name or a property read, a value in a template, an object's keys and
 * values, an array's elements, both sides of a `+` or a `?:`. A call is not
 * followed: `mask(token)` hands over what `mask` returns.
 */
function handedNames(e: ts.Node, out: Array<{ node: ts.Node; name: string }>): void {
  if (ts.isIdentifier(e)) out.push({ node: e, name: e.text });
  else if (ts.isPropertyAccessExpression(e)) out.push({ node: e, name: e.name.text });
  else if (ts.isTemplateExpression(e)) for (const span of e.templateSpans) handedNames(span.expression, out);
  else if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) handedNames(e.expression, out);
  else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    handedNames(e.left, out);
    handedNames(e.right, out);
  } else if (ts.isConditionalExpression(e)) {
    handedNames(e.whenTrue, out);
    handedNames(e.whenFalse, out);
  } else if (ts.isArrayLiteralExpression(e)) for (const el of e.elements) handedNames(el, out);
  else if (ts.isObjectLiteralExpression(e))
    for (const p of e.properties) {
      if (ts.isShorthandPropertyAssignment(p)) out.push({ node: p, name: p.name.text });
      else if (ts.isPropertyAssignment(p)) {
        const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : '';
        if (key !== '' && isSecretName(key)) out.push({ node: p, name: key });
        else handedNames(p.initializer, out);
      } else if (ts.isSpreadAssignment(p)) handedNames(p.expression, out);
    }
}

/** A call to `log.<level>(` or `console.<level>(` that hands a secret-named value over. */
export function secretLogSpots(file: string, text: string): Spot[] {
  const sf = parse(file, text);
  const out: Spot[] = [];
  visit(sf, (n) => {
    if (!ts.isCallExpression(n)) return;
    const on = receiverName(n);
    const level = calleeName(n);
    if (on === undefined || !LOGGERS.has(on) || level === undefined || !LEVELS.has(level)) return;
    const names: Array<{ node: ts.Node; name: string }> = [];
    for (const a of n.arguments) handedNames(a, names);
    for (const { node, name } of names) if (isSecretName(name)) out.push({ ...spotOf(sf, node), text: `${on}.${level}(… ${name} …)` });
  });
  return out;
}
