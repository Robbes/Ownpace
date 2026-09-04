// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BUTTON WHOSE FOLD NEVER HAPPENS ASKS FOR WHAT IT WAS THERE TO SUPPLY.
 *
 * Workplan 0114 T5b. THREE lists name the same providers and none knew about
 * the others:
 *
 *   packages/shared/src/credential-fields.ts   `consent:` on a token field
 *   packages/shared/src/provider-clients.ts    `GRANT_PROVIDERS` + the probes
 *   apps/web/src/services/mapping-service.ts   the zod schema that parses them
 *
 * The descriptor's `consent` says WHOSE consent screen fills this field, and
 * the two doors read it to decide which button to draw. `providerClientFacts`
 * says whether the deployment carries that provider's application, and the
 * doors read THAT to decide whether to fold the client pair away.
 *
 * ## Why a missing row is silent, which is the whole problem
 *
 * The web asks `providerClients?.[grantProvider] === 'deployment'`. A provider
 * the facts have never heard of yields `undefined`, `undefined` is not
 * `'deployment'`, and the screen concludes — reasonably, from what it was
 * told — that this deployment has no application and the customer must paste
 * their own client id and secret.
 *
 * **So the failure is not an error. It is a form that asks for two values
 * nobody should have to find, beside a button that exists precisely so nobody
 * has to find them.** Nothing logs, nothing throws, and the person assumes
 * that is how it works.
 *
 * That is exactly what happened: 0114 T1 added `microsoftDeploymentClient`
 * and `providerClientFacts` was a hand-written object with two entries.
 *
 * ## Both directions
 *
 * A descriptor naming a provider with no facts is the case above. A grant
 * provider no descriptor names is the quieter one: an application a
 * deployment can configure, that no screen will ever offer, so the operator's
 * `*_OAUTH_CLIENT_ID` sits there doing nothing and they have no way to tell.
 *
 * Read as TEXT: two files whose agreement is between literals rather than
 * runtime values, and a `scripts/` guard cannot resolve workspace packages
 * anyway.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The file with its comments removed.
 *
 * FIFTH time (#749, #752, 0114 T4 and T5a). `credential-fields.ts` explains
 * the Microsoft account type by contrasting it with `o365Fields()`, and
 * `provider-clients.ts` explains its own list by describing the defect that
 * caused it — both name providers in prose. A matcher reading raw text finds
 * those and reports agreement or drift that does not exist.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const read = (p: string) => code(readFileSync(join(REPO_ROOT, p), 'utf8'));

const FIELDS = 'packages/shared/src/credential-fields.ts';
const CLIENTS = 'packages/shared/src/provider-clients.ts';
const SCHEMA = 'apps/web/src/services/mapping-service.ts';

/** Every provider a credential descriptor says fills a field by consent. */
function consentProviders(): Set<string> {
  return new Set(
    [...read(FIELDS).matchAll(/consent:\s*'([a-z]+)'/g)].map((m) => m[1]!),
  );
}

/** The `GRANT_PROVIDERS` list, and separately the probe table's own keys. */
function grantProviders(): Set<string> {
  const text = read(CLIENTS);
  const list = /GRANT_PROVIDERS\s*=\s*\[([^\]]*)\]/.exec(text);
  return new Set([...(list?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]!));
}

function probedProviders(): Set<string> {
  const text = read(CLIENTS);
  const start = text.indexOf('DEPLOYMENT_CLIENTS');
  const body = text.slice(start, text.indexOf('\n};', start));
  // `\(` and not `\(env\)`: a probe that ignores its argument is written
  // `() => false`, and the first version of this matcher did not see one —
  // caught by breaking it, which is what breaking it is for.
  return new Set([...body.matchAll(/^\s{2}([a-z]+):\s*\(/gm)].map((m) => m[1]!));
}

/**
 * The providers the WEB's schema will let through.
 *
 * Third file, same list, and its own way of failing: zod's `.parse` strips a
 * key the schema does not declare, so the server can answer honestly and the
 * browser still reads `undefined`. Silent on both sides of the wire.
 */
function parsedProviders(): Set<string> {
  const text = read(SCHEMA);
  const start = text.indexOf('ProviderClientFactsSchema');
  const body = text.slice(start, text.indexOf('});', start));
  return new Set([...body.matchAll(/^\s{2}([a-z]+):\s*CLIENT_SOURCE/gm)].map((m) => m[1]!));
}

describe('every consent a descriptor names is a grant provider', () => {
  it('finds providers on both sides — this guard is not passing vacuously', () => {
    // Two empty sets agree. The control is that both files still name some.
    expect(consentProviders().size, `${FIELDS} names no consent providers`).toBeGreaterThan(1);
    expect(grantProviders().size, `${CLIENTS} names no grant providers`).toBeGreaterThan(1);
    expect(probedProviders().size, `${CLIENTS} has no deployment-client probes`).toBeGreaterThan(1);
    expect(parsedProviders().size, `${SCHEMA} parses no providers`).toBeGreaterThan(1);
  });

  it('a field filled by consent has a provider-client fact behind it', () => {
    const facts = grantProviders();
    const orphans = [...consentProviders()].filter((p) => !facts.has(p)).sort();
    expect(
      orphans,
      'a credential field says a provider fills it by consent, and GRANT_PROVIDERS has never ' +
        'heard of that provider. `providerClients?.[provider]` will be undefined, the client ' +
        'pair will never fold, and the form will ask the customer for an application id and ' +
        `secret beside the very button that made them unnecessary. Add the row in ${CLIENTS}`,
    ).toEqual([]);
  });

  it('a grant provider is offered by at least one door', () => {
    const named = consentProviders();
    const unoffered = [...grantProviders()].filter((p) => !named.has(p)).sort();
    expect(
      unoffered,
      'a provider can have its application configured on this deployment and no screen will ' +
        'ever offer its consent, because no credential descriptor names it. The operator sets ' +
        'the variables and nothing happens, with nothing to tell them why',
    ).toEqual([]);
  });

  it('the browser will parse every provider the server answers with', () => {
    // zod strips what it does not declare, so a provider missing here is
    // dropped between an honest server and a screen that then concludes the
    // deployment has no application. The same silent "no" as a missing row on
    // the server, arriving one layer later.
    expect(
      [...parsedProviders()].sort(),
      `${SCHEMA} parses a different set of providers than ${CLIENTS} answers with`,
    ).toEqual([...grantProviders()].sort());
  });

  it('every grant provider has a probe, and every probe a grant provider', () => {
    // The list and its table are two halves of one fact. A provider in the
    // list with no probe cannot compile — `Record<GrantProvider, …>` sees to
    // that — but a probe for a provider that left the list would linger,
    // reading an environment variable nothing else knows about.
    expect([...probedProviders()].sort()).toEqual([...grantProviders()].sort());
  });
});
