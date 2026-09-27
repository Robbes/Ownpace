// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CLIENT THAT REACHES A TENANT'S HOST (workplan 0136 T1).
 *
 * The managed edition connects to whatever host a tester types, from inside
 * the stack's own network. The rule that refuses a host resolving inward
 * rides the request, not the process: `tenantFetch` for HTTP and
 * `reachableHost` for a client that opens its own socket
 * (`packages/shared/src/reachable-host.ts`). It cannot be a global dispatcher,
 * because the same processes call their own services by compose name.
 *
 * So a client that reaches a tenant's host and calls Node's own `fetch`
 * instead reaches whatever that host resolves to, and nothing at run time says
 * so: the request simply works. This makes the choice a test. It reads the
 * server code, parsed, and holds three lines:
 *
 * - **Every use of Node's own `fetch` is listed in FIXED_HOSTS**, with the
 *   host it reaches and how many uses the file has. That host is one of ours or
 *   a provider's fixed one, never one a tenant typed. A new use fails here
 *   until it is listed there, or goes through `tenantFetch`. A listed file
 *   with fewer uses fails too, so the list cannot go stale.
 * - **Every client that reaches a tenant's host calls `tenantFetch`**
 *   (TENANT_CLIENTS), so a file that stopped reaching one is seen.
 * - **Every IMAP client is built on the host `reachableHost` answered**, with
 *   its `servername`.
 *
 * NOT READ, and why: `apps/selfhost`, because the rule is managed only and the
 * appliance's owner types their own LAN's hosts on purpose (0136 T1);
 * `apps/web`, which calls only our own API from a browser; and
 * `packages/testing`, the test harness.
 *
 * PARSED, not searched, for the reasons `a-source-that-only-reads` gives: a
 * `fetch` in a comment is not a use, and `typeof fetch` is a type.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..');

/** The server code: every package but the test harness, the API and the tasks. */
const READ = ['packages', 'apps/api/src', 'apps/worker/src'];
const NOT_READ = ['packages/testing/'];

/**
 * Every use of Node's own `fetch`, by file: how many, and the host they reach.
 * A host here is ours, at an address in the operator's settings, or a
 * provider's fixed one. The provider clients' base URLs are constants: the
 * doors store no base URL for a provider connection (`sourceConfig` in
 * `apps/api/src/routes/migrations/index.ts` has none, and zod drops a key it
 * does not know).
 */
const FIXED_HOSTS: ReadonlyArray<{ readonly file: string; readonly uses: number; readonly host: string }> = [
  // Ours.
  { file: 'apps/api/src/middleware/auth.ts', uses: 1, host: "the identity provider's discovery document" },
  { file: 'apps/api/src/routes/ready.ts', uses: 1, host: 'the identity provider, for the readiness check' },
  { file: 'apps/api/src/routes/platform-status.ts', uses: 1, host: 'the status page' },
  { file: 'apps/api/src/services/zammad.ts', uses: 2, host: "the operator's Zammad" },
  // A provider's own.
  { file: 'apps/api/src/routes/migrations/dropbox-consent.ts', uses: 1, host: "Dropbox's token endpoint" },
  { file: 'apps/api/src/routes/migrations/google-consent.ts', uses: 1, host: "Google's token endpoint" },
  { file: 'apps/api/src/routes/migrations/microsoft-consent.ts', uses: 1, host: "Microsoft's token endpoint" },
  { file: 'apps/worker/src/cli/index.ts', uses: 1, host: 'Microsoft Graph' },
  { file: 'apps/worker/src/jobs/managed-drift-detect.ts', uses: 1, host: 'Microsoft Graph' },
  { file: 'apps/worker/src/jobs/managed-group-discovery.ts', uses: 1, host: 'Microsoft Graph' },
  { file: 'packages/connectors/src/box-file-source.ts', uses: 1, host: 'Box' },
  { file: 'packages/connectors/src/box-token-provider.ts', uses: 1, host: "Box's token endpoint" },
  { file: 'packages/connectors/src/dropbox-file-source.ts', uses: 1, host: 'Dropbox' },
  { file: 'packages/connectors/src/dropbox-token-provider.ts', uses: 1, host: "Dropbox's token endpoint" },
  { file: 'packages/connectors/src/google-drive-transport.ts', uses: 1, host: 'Google Drive' },
  { file: 'packages/connectors/src/google-jwt-bearer-provider.ts', uses: 1, host: "Google's token endpoint" },
  { file: 'packages/connectors/src/google-tasks-source.ts', uses: 1, host: 'Google Tasks' },
  { file: 'packages/connectors/src/google-token-provider.ts', uses: 1, host: "Google's token endpoint" },
  { file: 'packages/connectors/src/graph-calendar-source.ts', uses: 1, host: 'Microsoft Graph' },
  { file: 'packages/connectors/src/graph-contacts-source.ts', uses: 1, host: 'Microsoft Graph' },
  { file: 'packages/connectors/src/graph-drive-source.ts', uses: 1, host: 'Microsoft Graph' },
  { file: 'packages/connectors/src/graph-mail-source.ts', uses: 1, host: 'Microsoft Graph' },
  { file: 'packages/connectors/src/graph-todo-source.ts', uses: 1, host: 'Microsoft Graph' },
  { file: 'packages/connectors/src/token-provider.ts', uses: 1, host: "Microsoft's token endpoint" },
  { file: 'packages/connectors/src/token-revoker.ts', uses: 1, host: "Google's revocation endpoint" },
  { file: 'packages/core/src/dns-verify-only.ts', uses: 1, host: 'three public DNS-over-HTTPS resolvers' },
  { file: 'packages/managed/src/moneybird-sales-invoices.ts', uses: 3, host: 'Moneybird' },
  { file: 'packages/managed/src/moneybird-tax-rates.ts', uses: 1, host: 'Moneybird' },
  { file: 'packages/managed/src/vies.ts', uses: 1, host: "the EU's VIES service" },
  { file: 'packages/orchestration/src/account-qualification.ts', uses: 1, host: "Google's token endpoint, for a grant's scopes" },
  { file: 'packages/orchestration/src/microsoft-account-test.ts', uses: 1, host: "Microsoft's token endpoint" },
  // The rule itself: `tenantFetch` is Node's `fetch`, with the rule's dispatcher once it is on.
  { file: 'packages/shared/src/reachable-host.ts', uses: 2, host: 'what `tenantFetch` is asked for' },
];

/**
 * The clients that reach a host a tenant typed. Each calls `tenantFetch`: the
 * DAV sources and writers, the JMAP clients (the session, the mail target
 * through `http-rate-limit.ts`, and the file and contact targets), the Test
 * button's JMAP and scheduling questions, the qualification's JMAP session,
 * and the API's two clients for an organisation's Nextcloud.
 */
const TENANT_CLIENTS = [
  'packages/connectors/src/caldav-source.ts',
  'packages/connectors/src/carddav-source.ts',
  'packages/connectors/src/webdav-source.ts',
  'packages/connectors/src/http-rate-limit.ts',
  'packages/connectors/src/jmap-file-target.ts',
  'packages/connectors/src/jmap-contact-target.ts',
  'packages/engines/src/caldav-target-writer.ts',
  'packages/engines/src/carddav-target-writer.ts',
  'packages/engines/src/webdav-target-writer.ts',
  'packages/orchestration/src/probe-connection.ts',
  'packages/orchestration/src/target-scheduling.ts',
  'packages/orchestration/src/account-qualification.ts',
  'apps/api/src/routes/permissions.ts',
  'apps/api/src/routes/migrations/operating-routes.ts',
];

/** The two IMAP clients. imapflow opens its own socket, so they ask `reachableHost`. */
const IMAP_CLIENTS = ['packages/connectors/src/imapflow-source.ts', 'packages/connectors/src/imapflow-dav-target.ts'];

function parse(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, readFileSync(join(ROOT, rel), 'utf8'), ts.ScriptTarget.Latest, true);
}

function nodes(tree: ts.Node): ts.Node[] {
  const all: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    all.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return all;
}

/** Every server source file, tests and declarations left out. */
function serverFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '__testing__'].includes(entry.name)) walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(relative(ROOT, full));
      }
    }
  };
  for (const dir of READ) walk(join(ROOT, dir));
  return out.filter((rel) => !NOT_READ.some((skip) => rel.startsWith(skip))).sort();
}

function withinType(node: ts.Node): boolean {
  for (let p = node.parent; p !== undefined; p = p.parent) {
    if (ts.isTypeNode(p)) return true;
    if (ts.isStatement(p)) return false;
  }
  return false;
}

/**
 * The uses of Node's own `fetch` in a file: the name `fetch` read as a value
 * (called, passed, or a parameter's default) and `globalThis.fetch`. A method
 * or property that happens to be called `fetch` is not one, and nor is
 * `typeof fetch`. A local binding named `fetch` would hide the global, so it
 * is reported as a use too, to be looked at.
 */
function globalFetchUses(tree: ts.SourceFile): number {
  let uses = 0;
  for (const node of nodes(tree)) {
    if (ts.isIdentifier(node) && node.text === 'fetch') {
      const p = node.parent;
      const declares =
        (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isBindingElement(p)) &&
        p.name === node;
      const names =
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        ((ts.isMethodDeclaration(p) ||
          ts.isPropertyDeclaration(p) ||
          ts.isPropertyAssignment(p) ||
          ts.isPropertySignature(p) ||
          ts.isMethodSignature(p) ||
          ts.isImportSpecifier(p) ||
          ts.isExportSpecifier(p)) &&
          p.name === node);
      if (declares || (!names && !withinType(node))) uses++;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'fetch' &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'globalThis'
    ) {
      uses++;
    }
  }
  return uses;
}

function callsTo(tree: ts.SourceFile, name: string): ts.CallExpression[] {
  return nodes(tree).filter(
    (n): n is ts.CallExpression => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name,
  );
}

describe('a client that reaches a tenant host', () => {
  const files = serverFiles();

  it('reads the server code, so every check below has something to find', () => {
    // 388 files on 2026-09-27. Far fewer means the walk stopped finding them,
    // and the checks below would pass on nothing.
    expect(files.length).toBeGreaterThan(300);
    for (const rel of [...FIXED_HOSTS.map((f) => f.file), ...TENANT_CLIENTS, ...IMAP_CLIENTS]) {
      expect(files, `${rel} is not read`).toContain(rel);
    }
  });

  it("uses Node's own fetch only where the host is ours or a provider's fixed one", () => {
    const listed = new Map(FIXED_HOSTS.map((f) => [f.file, f.uses]));
    const found = new Map<string, number>();
    for (const rel of files) {
      const uses = globalFetchUses(parse(rel));
      if (uses > 0) found.set(rel, uses);
    }
    const unlisted = [...found].filter(([rel]) => !listed.has(rel)).map(([rel, n]) => `${rel}: ${n}`);
    expect(
      unlisted,
      "Node's own fetch in a file FIXED_HOSTS does not list. If the host is one a tenant typed, " +
        "use tenantFetch from '@openmig/shared/reachable-host'. If it is ours or a provider's " +
        'fixed one, list it with the host it reaches.',
    ).toEqual([]);
    const miscounted = FIXED_HOSTS.filter((f) => (found.get(f.file) ?? 0) !== f.uses).map(
      (f) => `${f.file}: listed ${f.uses}, found ${found.get(f.file) ?? 0}`,
    );
    expect(miscounted, 'a listed file has a use more, or fewer, than FIXED_HOSTS says').toEqual([]);
  });

  it.each(TENANT_CLIENTS)('%s reaches a tenant host through tenantFetch', (rel) => {
    const tree = parse(rel);
    expect(callsTo(tree, 'tenantFetch').length).toBeGreaterThan(0);
    expect(globalFetchUses(tree), 'and uses no fetch but the ones FIXED_HOSTS lists for it').toBe(
      FIXED_HOSTS.find((f) => f.file === rel)?.uses ?? 0,
    );
  });

  it.each(IMAP_CLIENTS)('%s connects where reachableHost answered, with its servername', (rel) => {
    const tree = parse(rel);
    const clients = nodes(tree).filter(
      (n): n is ts.NewExpression => ts.isNewExpression(n) && n.expression.getText() === 'ImapFlow',
    );
    expect(clients.length, 'no ImapFlow is built here').toBeGreaterThan(0);

    // `const reach = await reachableHost(this.config.host)` names what the
    // rule answered; the client must take its host and servername from it.
    const answered = nodes(tree)
      .filter(ts.isVariableDeclaration)
      .filter((d) => {
        const init = d.initializer;
        return (
          init !== undefined &&
          ts.isAwaitExpression(init) &&
          ts.isCallExpression(init.expression) &&
          init.expression.expression.getText() === 'reachableHost'
        );
      })
      .map((d) => d.name.getText());
    expect(answered.length, 'reachableHost is not asked').toBeGreaterThan(0);

    for (const client of clients) {
      const options = client.arguments?.[0];
      expect(options && ts.isObjectLiteralExpression(options), 'the options are not written here').toBe(true);
      const literal = options as ts.ObjectLiteralExpression;
      const host = literal.properties.find(
        (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === 'host',
      );
      expect(host && answered.map((n) => `${n}.host`).includes(host.initializer.getText()), `host: ${host?.initializer.getText()}`).toBe(
        true,
      );
      expect(
        answered.some((n) => literal.getText().includes(`servername: ${n}.servername`)),
        'the typed name is not passed on as servername, so TLS would check the address',
      ).toBe(true);
    }
  });
});
