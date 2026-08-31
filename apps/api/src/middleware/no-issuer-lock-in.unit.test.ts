// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ADR-0042's third operative rule, enforced rather than remembered:
 *
 *   "the integration must stay inside plain OIDC discovery +
 *    authorization-code + PKCE + JWKS. No issuer-specific API, no issuer-side
 *    tenancy model, no issuer-side roles."
 *
 * That rule is what makes the choice of Zitadel reversible, and a rule of that
 * shape decays silently: one convenient call to a provider's management API,
 * one hard-coded endpoint path, and switching is a project again rather than a
 * variable. Nobody notices, because everything still works — until the day it
 * has to move.
 *
 * So this walks the shipped source and fails if a provider's name or URL shape
 * appears where it would create a dependency. The compose file, the setup
 * script and the docs are exactly where those names BELONG — a deployment has
 * to name what it deploys — and are not scanned.
 *
 * The bug this exists to prevent is not hypothetical. The middleware shipped
 * with `${issuer}/.well-known/jwks.json` hard-coded, an Auth0/Clerk convention,
 * which matched neither the chosen provider nor the named fallback. That is
 * precisely a URL shape that a scan like this one would have caught.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * The shipped source of the two apps that authenticate, plus the packages they
 * share. Tests are excluded: naming a provider in a test is how
 * `issuer-is-replaceable.unit.test.ts` proves the code does NOT know them.
 */
const SCANNED_ROOTS = ['apps/api/src', 'apps/web/src', 'packages'];

/** Provider names, and the endpoint shapes that would pin us to one. */
const LOCK_IN = [
  { pattern: /\bzitadel\b/i, why: 'names the provider ADR-0042 chose' },
  { pattern: /\bkeycloak\b/i, why: 'names the provider ADR-0042 keeps as the fallback' },
  { pattern: /\bauth0\b/i, why: 'names a provider' },
  { pattern: /\bclerk\b/i, why: 'names a provider' },
  { pattern: /\bokta\b/i, why: 'names a provider' },
  { pattern: /\bauthentik\b/i, why: 'names a provider' },
  {
    pattern: /\/oauth\/v2\/(keys|authorize|token)/,
    why: "hard-codes Zitadel's endpoint paths",
  },
  {
    pattern: /\/protocol\/openid-connect\//,
    why: "hard-codes Keycloak's endpoint paths",
  },
  // THE ADMIN CONSOLE IS NOT AN OIDC CONCEPT, and no two providers spell it the
  // same way. Added 2026-08-31, when the support screen gained a link out to
  // the account at the provider (a password nobody can reset, a lost second
  // factor — the provider's job, never ours). Composing `${issuer}/ui/console/
  // users/${sub}` in the screen would have worked, and passed every test that
  // existed, and been precisely the decay this file's own header describes.
  // The link is a DEPLOYMENT variable instead — `VITE_IDP_CONSOLE_USER_URL`,
  // written by `setup-zitadel.sh` beside the four that already make the issuer
  // swappable — so these three shapes have no business in shipped source.
  {
    pattern: /\/ui\/console\//,
    why: "hard-codes Zitadel's admin console path — use VITE_IDP_CONSOLE_USER_URL",
  },
  {
    pattern: /\/admin\/master\/console\//,
    why: "hard-codes Keycloak's admin console path — use VITE_IDP_CONSOLE_USER_URL",
  },
  {
    pattern: /\/if\/admin\//,
    why: "hard-codes Authentik's admin console path — use VITE_IDP_CONSOLE_USER_URL",
  },
  {
    pattern: /\.well-known\/jwks\.json/,
    why:
      'guesses a key-set URL. This is the Auth0/Clerk convention and it is what shipped ' +
      'broken — ask the discovery document for jwks_uri instead',
  },
];

/**
 * The file with its comments removed.
 *
 * **Comments are documentation; code is dependency.** The first run of this
 * guard flagged seven hits and every one of them was prose — `auth.ts`
 * explaining WHY it reads `jwks_uri` instead of guessing, and naming the two
 * providers whose paths differ, which is exactly the explanation a reader
 * needs. A guard that forbade that would make the code less clear to protect a
 * rule about what the code DOES.
 *
 * Deliberately a small stripper rather than a parser: block comments, then
 * line comments where `//` is not part of a `://` scheme. It can be fooled by
 * `//` inside a string that is not a URL, which would only ever hide a finding
 * on that one line — and `strips comments without eating URLs` below is what
 * keeps it honest, because a stripper that quietly removed everything would
 * make this whole file pass while checking nothing.
 */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    if (!/\.(ts|tsx|mjs|js)$/.test(entry)) continue;
    // Tests may name providers freely — that is how the replaceability proof
    // is written at all.
    if (/\.(unit|integration|e2e|ui)\.test\.(ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

describe('no issuer lock-in reaches the shipped source', () => {
  it('scans a real set of files, so a clean result is not an empty search', () => {
    const files = SCANNED_ROOTS.flatMap((r) => sourceFiles(join(ROOT, r)));
    expect(files.length, 'the scan found no source at all — the roots moved').toBeGreaterThan(100);
    // And it is looking at the file that matters.
    expect(files.some((f) => f.endsWith(join('middleware', 'auth.ts')))).toBe(true);
  });

  it('names no identity provider, and hard-codes no provider endpoint', () => {
    const findings: string[] = [];
    for (const root of SCANNED_ROOTS) {
      for (const file of sourceFiles(join(ROOT, root))) {
        const text = stripComments(readFileSync(file, 'utf8'));
        for (const { pattern, why } of LOCK_IN) {
          const match = pattern.exec(text);
          if (!match) continue;
          const line = text.slice(0, match.index).split('\n').length;
          findings.push(
            `${relative(ROOT, file)}:${line} — ${JSON.stringify(match[0])} ${why}`,
          );
        }
      }
    }

    expect(
      findings,
      'ADR-0042 keeps the issuer replaceable by keeping the integration inside plain ' +
        'OIDC. Provider names and endpoint paths belong in deploy/ and docs/, not here:\n' +
        findings.map((f) => `  - ${f}`).join('\n'),
    ).toEqual([]);
  });

  it('strips comments without eating URLs, or it would be checking nothing', () => {
    // A stripper that removed too much would make the case above pass on any
    // codebase at all. Both halves asserted.
    const stripped = stripComments(
      [
        '// zitadel in a line comment',
        '/* keycloak in a block comment */',
        "const url = 'https://id.example/oauth/v2/keys';",
        "const kept = 'zitadel';  // and a trailing comment",
      ].join('\n'),
    );
    expect(stripped, 'a line comment survived').not.toMatch(/zitadel in a line/);
    expect(stripped, 'a block comment survived').not.toMatch(/keycloak in a block/);
    expect(stripped, 'a trailing comment survived').not.toMatch(/and a trailing/);
    // The URL is intact — its `//` is a scheme, not a comment.
    expect(stripped).toContain('https://id.example/oauth/v2/keys');
    // And real code is still there to be found.
    expect(stripped).toContain("const kept = 'zitadel';");
  });

  it('reads the issuer and its audience from the environment, nowhere else', () => {
    // The other half of replaceable: if the issuer were a constant, no amount
    // of provider-neutral code would let a deployment change it.
    const auth = readFileSync(join(ROOT, 'apps/api/src/middleware/auth.ts'), 'utf8');
    expect(auth).toContain('process.env.JWT_ISSUER');
    expect(auth).toContain('process.env.JWT_AUDIENCE');
    // And the discovery path is the standard one, spelled out once.
    expect(auth).toContain('/.well-known/openid-configuration');
  });
});
