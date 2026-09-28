// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SOURCE ONLY READS (workplan 0149 T5).
 *
 * Nothing Ownpace does may change the system a customer is leaving (hard rule
 * 2). The old account is the way back, and it is whole and current at the
 * moment of cutover only because nothing here ever wrote to it. Until now, what
 * held that line was each connector's own discipline. The readiness review of
 * 2026-09-23 counted the methods by hand and found only reads, plus Dropbox's
 * POSTs, which carry its read RPCs. And the IMAP source opened every folder
 * with SELECT, under which the server accepts a STORE or an EXPUNGE, although
 * none was sent.
 *
 * This makes the count a test. It reads every class in `packages/connectors/src`
 * that implements a source port, and the transports they send through:
 *
 * - the only HTTP methods they name are GET, HEAD, PROPFIND, REPORT and
 *   OPTIONS. Dropbox's API reads over POST, so its POSTs are allowed by the
 *   path they go to: the RPCs that list folders and pages, the space in use
 *   and the shared folders, the content download, and the export of a file
 *   Dropbox hands over only that way, a Paper doc (workplan 0150 T4);
 * - `packages/connectors/src/imapflow-source.ts` calls none of imapflow's
 *   mutators, by the names in imapflow's own typings;
 * - every mailbox that file opens is opened read-only, so imapflow sends
 *   EXAMINE and the server itself refuses a STORE or an EXPUNGE, and a fetch
 *   that forgot PEEK still sets no `\Seen`.
 *
 * A new source class is found on its own. A source that sends through a
 * transport of its own needs a line in TRANSPORTS, and a new Dropbox POST needs
 * its path in DROPBOX_READ_RPCS, or its URL in DROPBOX_POST_URLS.
 *
 * PARSED, not searched. The sources are read with the TypeScript parser, so a
 * method named in a comment is not a use of it, and a regular expression or an
 * `Accept: '*\/*'` header cannot hide code from the check. A hand-written
 * comment stripper, tried first, lost its place at a regular expression in
 * these very files and read the comments after it as code. A root-level test
 * cannot import the workspace packages, and what is under test is what the
 * source says anyway.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..');
const CONNECTORS = 'packages/connectors/src';

/** The source ports. A class that implements one reads a customer's old system. */
const SOURCE_PORTS = new Set(['SourceConnector', 'CalendarSource', 'ContactSource', 'FileSource']);

/**
 * Modules a source sends through that are not source classes themselves:
 * Google Drive's calls go out through `google-drive-transport.ts`, and the
 * archive source reads a WebDAV folder through `webdav-archive-store.ts`.
 */
const TRANSPORTS = [
  'packages/connectors/src/google-drive-transport.ts',
  'packages/connectors/src/webdav-archive-store.ts',
];

const IMAP_SOURCE = 'packages/connectors/src/imapflow-source.ts';
const DROPBOX_SOURCE = 'packages/connectors/src/dropbox-file-source.ts';

/** The methods that read. A source may name these and no others. */
const READ_METHODS = new Set(['GET', 'HEAD', 'PROPFIND', 'REPORT', 'OPTIONS']);

/** Every method a source could name, HTTP's and WebDAV's, so any of them is seen. */
const HTTP_METHODS = new Set([
  'GET', 'HEAD', 'OPTIONS', 'PROPFIND', 'REPORT', 'SEARCH',
  'POST', 'PUT', 'PATCH', 'DELETE', 'PROPPATCH', 'MKCOL', 'MKCALENDAR',
  'COPY', 'MOVE', 'LOCK', 'UNLOCK', 'ACL', 'BIND', 'UNBIND', 'REBIND',
]);

/**
 * The Dropbox RPCs a source may POST to, all of them reads (0149 §1): a
 * folder's listing and its next page, the space in use, and the shared folders
 * and their next page.
 */
const DROPBOX_READ_RPCS = new Set([
  'files/list_folder',
  'files/list_folder/continue',
  'users/get_space_usage',
  'sharing/list_folders',
  'sharing/list_folders/continue',
]);

/**
 * The three requests Dropbox's POSTs may be: an RPC above, a file's bytes, or
 * a file's bytes in a format Dropbox renders it in. `files/export` reads under
 * the same `files.content.read` scope as the download, and changes nothing in
 * the account (0150 T4).
 */
const DROPBOX_POST_URLS = new Set([
  '`${this.apiBase}/${path}`',
  '`${this.contentBase}/files/download`',
  '`${this.contentBase}/files/export`',
]);

/** imapflow's calls that change a mailbox or what is in it. */
const IMAP_MUTATORS = [
  'append',
  'messageFlagsAdd',
  'messageFlagsSet',
  'messageFlagsRemove',
  'setFlagColor',
  'messageDelete',
  'messageCopy',
  'messageMove',
  'mailboxCreate',
  'mailboxRename',
  'mailboxDelete',
  'mailboxSubscribe',
  'mailboxUnsubscribe',
  'mailboxClose',
];

function parse(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, readFileSync(join(ROOT, rel), 'utf8'), ts.ScriptTarget.Latest, true);
}

/** Every node in a file, depth first. */
function nodes(tree: ts.SourceFile): ts.Node[] {
  const all: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    all.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return all;
}

/** Every file in the connectors package with a class that implements a source port. */
function sourceFiles(): string[] {
  return readdirSync(join(ROOT, CONNECTORS))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => `${CONNECTORS}/${f}`)
    .filter((rel) =>
      nodes(parse(rel)).some(
        (n) =>
          ts.isClassDeclaration(n) &&
          (n.heritageClauses ?? []).some(
            (h) =>
              h.token === ts.SyntaxKind.ImplementsKeyword &&
              h.types.some((t) => SOURCE_PORTS.has(t.expression.getText())),
          ),
      ),
    )
    .sort();
}

/** The HTTP method names a file's code holds as strings, in order. */
function namedMethods(tree: ts.SourceFile): string[] {
  return nodes(tree)
    .filter((n): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
      ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n),
    )
    .map((n) => n.text)
    .filter((text) => HTTP_METHODS.has(text));
}

/** Every call to a method of this name, on whatever object. */
function callsTo(tree: ts.SourceFile, name: string): ts.CallExpression[] {
  return nodes(tree).filter(
    (n): n is ts.CallExpression =>
      ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === name,
  );
}

/** Does this object literal say `name: true`? */
function saysTrue(node: ts.Node | undefined, name: string): boolean {
  return (
    node !== undefined &&
    ts.isObjectLiteralExpression(node) &&
    node.properties.some(
      (p) =>
        ts.isPropertyAssignment(p) &&
        p.name.getText() === name &&
        p.initializer.kind === ts.SyntaxKind.TrueKeyword,
    )
  );
}

describe('a source only reads', () => {
  const sources = sourceFiles();

  it('finds the source classes on its own, so one added later is read too', () => {
    // The review counted fifteen. Fewer means the search stopped finding them,
    // and every check below would pass on nothing.
    expect(sources.length).toBeGreaterThanOrEqual(15);
    expect(sources).toContain(IMAP_SOURCE);
    expect(sources).toContain(DROPBOX_SOURCE);
  });

  it('names no HTTP method but a read, in any source or transport', () => {
    const writes: string[] = [];
    for (const rel of [...sources, ...TRANSPORTS]) {
      for (const method of namedMethods(parse(rel))) {
        if (READ_METHODS.has(method)) continue;
        if (rel === DROPBOX_SOURCE && method === 'POST') continue; // by path, below
        writes.push(`${rel}: ${method}`);
      }
    }
    expect(writes, 'a source that names a method that writes can change the old system').toEqual([]);
  });

  it('lets Dropbox POST only to the paths that read', () => {
    const dropbox = parse(DROPBOX_SOURCE);

    // Every RPC names its path as a literal, and every path is a read.
    const rpcs = callsTo(dropbox, 'rpc');
    expect(rpcs.length, 'the RPC calls were not found').toBeGreaterThan(0);
    for (const call of rpcs) {
      const path = call.arguments[0];
      expect(path && ts.isStringLiteral(path), `${call.getText()}: a path that is not a literal cannot be checked`).toBe(
        true,
      );
      expect(DROPBOX_READ_RPCS.has((path as ts.StringLiteral).text), `${(path as ts.StringLiteral).text} is not a read`).toBe(
        true,
      );
    }

    // And every POST is one of the three requests: an RPC, a file's bytes, or its export.
    const posts = namedMethods(dropbox).filter((m) => m === 'POST').length;
    const requests = callsTo(dropbox, 'transport').filter((call) => {
      const init = call.arguments[1];
      return (
        init !== undefined &&
        ts.isObjectLiteralExpression(init) &&
        init.properties.some(
          (p) => ts.isPropertyAssignment(p) && p.name.getText() === 'method' && p.initializer.getText() === "'POST'",
        )
      );
    });
    expect(requests.length, 'a POST that is not a transport request to a known URL').toBe(posts);
    for (const call of requests) {
      const url = call.arguments[0]!.getText();
      expect(DROPBOX_POST_URLS.has(url), url).toBe(true);
    }
  });

  it("calls none of imapflow's mutators from the IMAP source", () => {
    // The names are imapflow's own: a name that is not in its typings is a
    // check that can never fail.
    const require = createRequire(join(ROOT, 'packages/connectors/package.json'));
    const typings = readFileSync(
      join(dirname(require.resolve('imapflow/package.json')), 'dist/cjs/imap-flow.d.ts'),
      'utf8',
    );
    for (const name of IMAP_MUTATORS) {
      expect(new RegExp(`^\\s+${name}\\(`, 'm').test(typings), `imapflow has no ${name}`).toBe(true);
    }

    const imap = parse(IMAP_SOURCE);
    const used = IMAP_MUTATORS.filter((name) => callsTo(imap, name).length > 0);
    expect(used, 'the IMAP source calls a method that changes the mailbox').toEqual([]);
  });

  it('opens every mailbox read-only, so the server refuses a write', () => {
    const imap = parse(IMAP_SOURCE);
    const opens = [...callsTo(imap, 'mailboxOpen'), ...callsTo(imap, 'getMailboxLock')];

    // Four today: the INBOX fallback, the measurement, the listing and the fetch.
    expect(opens.length, 'the opens were not found').toBeGreaterThanOrEqual(4);
    for (const open of opens) {
      expect(saysTrue(open.arguments[1], 'readOnly'), `${open.getText()}: without readOnly, imapflow sends SELECT`).toBe(
        true,
      );
    }
  });
});
