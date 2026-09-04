// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The create-mapping validator ends in a catch-all that asks for AZURE
 * credentials, and nothing pairs it against the source types that exist.
 *
 * Found by the catch-all sweep after workplan 0113's seventh fan-out (a bare
 * `else` that ran a file sync for the task domain and reported success). This
 * is the same shape one layer out, and — measured, not assumed — it is NOT
 * currently a defect:
 *
 *   sourceType enum:  imap oauth2 graph google-drive gmail google-calendar
 *                     google-contacts google dropbox box          (ten)
 *   named branches:   google-drive | google-calendar|google-contacts|google
 *                     | dropbox | box | gmail | imap              (eight)
 *   the else catches: oauth2, graph
 *
 * Both are Microsoft — `graph` is Graph itself, `oauth2` is IMAP authenticated
 * through Azure — and both really do need tenantId + clientId + clientSecret.
 * The catch-all is right today.
 *
 * WHAT IT CANNOT SURVIVE is the eleventh member. Add `soverin`, or `caldav`,
 * or any source that authenticates some other way, and it falls into that
 * `else` and is refused for missing an Azure tenant id — a confident wrong
 * answer, which is worse than an error, and the exact failure the seventh
 * fan-out produced. TypeScript cannot see it: every branch is a plain string
 * comparison and a bare `else` is never an exhaustiveness error.
 *
 * So this pins the pairing rather than restructuring code that works. A new
 * source type fails here, in a file that says why, instead of surfacing as a
 * customer being told to supply credentials for a provider they are not using.
 *
 * Read as TEXT because the validator is a zod `superRefine` inside a 4000-line
 * route module: importing it would drag in the database, the secret store and
 * the whole express app, and what is being asserted is which literals the
 * branch chain names — a property of the source, not of a call.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps/api/src/routes/migrations/index.ts',
);

/**
 * The two the catch-all is ALLOWED to swallow, each with the reason.
 *
 * Both authenticate against Microsoft Entra with the same three fields, which
 * is why sharing one branch is honest rather than lazy. Anything else reaching
 * that `else` is being asked for credentials belonging to a provider it has
 * nothing to do with.
 */
const MICROSOFT_BY_DESIGN = new Set(['oauth2', 'graph']);

function source(): string {
  return readFileSync(ROUTE, 'utf8');
}

/** The `sourceType` enum, read from the zod schema that defines it. */
function declaredSourceTypes(): string[] {
  const m = source().match(/sourceType:\s*z\.enum\(\[([^\]]+)\]\)/);
  expect(m, 'the sourceType z.enum is no longer recognisable in the route module').not.toBeNull();
  return m![1]!
    .split(',')
    .map((s) => s.trim().replace(/['"]/g, ''))
    .filter(Boolean);
}

/**
 * Just the create-mapping branch chain, sliced out of the module.
 *
 * SCOPED, and the first draft of this file was not: a bare match over the
 * whole module found `graph` and `oauth2` named in an unrelated config-shape
 * helper a few hundred lines above, concluded nothing reached the catch-all,
 * and would have passed while the property it claims to check went untested.
 * The chain begins at the `reusingSource` short-circuit and ends at the Azure
 * trio the catch-all demands.
 */
function validatorChain(): string {
  const text = source();
  const start = text.indexOf('if (reusingSource)');
  expect(start, 'the create-mapping chain no longer starts at `reusingSource`').toBeGreaterThan(-1);
  // Past the LAST named branch, not the first mention of a credential field:
  // `clientSecret` appears inside the Google branches too, and anchoring on it
  // directly cut the slice short of `gmail` and `imap`.
  const lastNamed = text.indexOf("body.sourceType === 'imap'", start);
  expect(lastNamed, "the chain's final named branch is no longer `imap`").toBeGreaterThan(start);
  const end = text.indexOf("'clientSecret'", lastNamed);
  expect(end, 'the chain no longer ends at the Azure credential trio').toBeGreaterThan(lastNamed);
  return text.slice(start, end);
}

/** Every literal that chain tests by name. */
function namedInValidator(): Set<string> {
  return new Set(
    [...validatorChain().matchAll(/body\.sourceType === '([a-z0-9-]+)'/g)].map((m) => m[1]!),
  );
}

describe('every source type the API accepts is named by the validator', () => {
  it('declares eleven source types, so the list has not silently moved', () => {
    // A canary on the canary: if the enum shrinks or grows, the reasoning in
    // this file's header is stale and should be re-read rather than trusted.
    // Twelve since workplan 0115 added `apple`, whose stake in being named
    // here is the sharpest yet: the catch-all would refuse it for a missing
    // tenant ID and client secret, neither of which exists for a provider
    // with no OAuth at all.
    // Eleven since workplan 0114 added `microsoft` — the Microsoft ACCOUNT
    // kind, which is NOT one of the two Azure-by-design types below: it takes
    // a delegated grant, its tenant is optional, and its client pair may be
    // the deployment's. Falling into that catch-all would have demanded a
    // tenantId and a client secret from somebody who pressed a button.
    expect(declaredSourceTypes()).toHaveLength(12);
  });

  it.each(
    declaredSourceTypes().filter((t) => !MICROSOFT_BY_DESIGN.has(t)),
  )("names '%s' explicitly rather than letting it fall through", (kind) => {
    expect(namedInValidator()).toContain(kind);
  });

  it('lets ONLY the two Microsoft types reach the Azure-credentials catch-all', () => {
    // Stated from the other side: if a future source type is deliberately
    // added to MICROSOFT_BY_DESIGN, that is a decision someone has to write
    // down here, not something a missing branch does quietly.
    const unnamed = declaredSourceTypes().filter((t) => !namedInValidator().has(t));
    expect(new Set(unnamed)).toEqual(MICROSOFT_BY_DESIGN);
  });

  it('the catch-all still asks for exactly the Azure trio', () => {
    // If this ever stops being an Azure-shaped requirement, the exception above
    // is no longer justified and this file should be revisited.
    const text = source();
    const imapAt = text.indexOf("body.sourceType === 'imap'", text.indexOf('if (reusingSource)'));
    const tail = text.slice(imapAt, text.indexOf("'clientSecret'", imapAt) + 20);
    expect(tail).toContain("'tenantId'");
    expect(tail).toContain("'clientId'");
    expect(tail).toContain("'clientSecret'");
  });
});
