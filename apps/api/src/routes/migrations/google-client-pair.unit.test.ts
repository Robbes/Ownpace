// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * HALF A CLIENT PAIR IS REFUSED AT THE DOOR, NOT COMPLETED BEHIND IT.
 *
 * Once a deployment carries its own Google client (ADR-0041, owner decision
 * 2026-09-01) the create door stops demanding a client id and secret — and
 * the run path fills only the half that is MISSING. Those two facts together
 * made a quiet hole: a request with a client id and no secret passed every
 * check, stored the id, was completed with the deployment's secret at mint
 * time, and was refused by Google's token endpoint hours later, from a sync
 * log nobody watches. The wizard refuses the half-typed pair since the same
 * day; this is the door itself refusing it, for API callers and for the
 * connections add-form that validates through the same shape.
 *
 * Every Google grant kind, because they share one credential shape and one
 * fallback. NOT Dropbox, which rides the same three field names with an app
 * pair of its own and no deployment fallback — its own refusal must remain
 * the one it gets.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CreateMappingSchema } from './index.ts';

const PAIR = {
  GOOGLE_OAUTH_CLIENT_ID: 'deployment.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'not-a-real-secret',
};
const WATCHED = Object.keys(PAIR) as Array<keyof typeof PAIR>;
const before = Object.fromEntries(WATCHED.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of WATCHED) process.env[k] = PAIR[k];
});
afterEach(() => {
  for (const k of WATCHED) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
});

/** A coherent body per Google kind: its own target and domain, the same credential shape. */
const SHAPES = {
  gmail: { targetType: 'jmap', domains: ['email'], target: { host: 'dst.example.nl', port: 443 } },
  'google-drive': {
    targetType: 'webdav',
    domains: ['file'],
    target: { host: 'dst.example.nl', port: 443 },
  },
  'google-calendar': {
    targetType: 'caldav',
    domains: ['calendar'],
    target: { host: 'dst.example.nl', port: 443 },
  },
  'google-contacts': {
    targetType: 'carddav',
    domains: ['contact'],
    target: { host: 'dst.example.nl', port: 443 },
  },
  google: { targetType: 'caldav', domains: ['calendar'], target: { host: 'dst.example.nl', port: 443 } },
} as const;
type GoogleKind = keyof typeof SHAPES;
const KINDS = Object.keys(SHAPES) as GoogleKind[];

function body(kind: GoogleKind, sourceConfig: Record<string, string>) {
  const shape = SHAPES[kind];
  return {
    name: 'a migration',
    sourceType: kind,
    targetType: shape.targetType,
    sourceConfig: { username: 'someone@example.invalid', ...sourceConfig },
    targetConfig: { ...shape.target, username: 'a@example.nl', password: 'x' },
    syncConfig: { domains: [...shape.domains] },
  };
}

function issues(payload: Record<string, unknown>) {
  const result = CreateMappingSchema.safeParse(payload);
  return result.success ? [] : result.error.issues;
}

describe('with the deployment carrying a client, half a pair is refused at every Google door', () => {
  it.each(KINDS)('%s: a client id without its secret is refused, anchored at the secret', (kind) => {
    const found = issues(body(kind, { clientId: 'own.apps.googleusercontent.com', refreshToken: '1//t' }));
    const half = found.find((i) => i.message.includes('clientId was sent without clientSecret'));
    expect(half, `${kind} accepted half a pair`).toBeDefined();
    expect(half?.path).toEqual(['sourceConfig', 'clientSecret']);
    expect(half?.message).toContain("neither to use this deployment's");
  });

  it.each(KINDS)('%s: a secret without its client id is refused, anchored at the id', (kind) => {
    const found = issues(body(kind, { clientSecret: 'own-secret', refreshToken: '1//t' }));
    const half = found.find((i) => i.message.includes('clientSecret was sent without clientId'));
    expect(half, `${kind} accepted half a pair`).toBeDefined();
    expect(half?.path).toEqual(['sourceConfig', 'clientId']);
  });

  it.each(KINDS)('%s: a whole pair of its own still passes — ADR-0041 is a choice', (kind) => {
    expect(
      issues(
        body(kind, {
          clientId: 'own.apps.googleusercontent.com',
          clientSecret: 'own-secret',
          refreshToken: '1//t',
        }),
      ),
    ).toEqual([]);
  });

  it.each(KINDS)("%s: no pair at all passes — the deployment's is used", (kind) => {
    expect(issues(body(kind, { refreshToken: '1//t' }))).toEqual([]);
  });

  it('never prints the value that was sent, nor the deployment\'s', () => {
    const text = issues(body('gmail', { clientSecret: 'SENTINEL-OWN-SECRET', refreshToken: '1//t' }))
      .map((i) => i.message)
      .join(' ');
    expect(text).not.toContain('SENTINEL');
    expect(text).not.toContain('not-a-real-secret');
    expect(text).not.toContain('deployment.apps.googleusercontent.com');
  });
});

describe('where the rule does not reach', () => {
  it('without a deployment client, half a pair gets the missing-key refusal it always got', () => {
    for (const k of WATCHED) delete process.env[k];
    const found = issues(body('gmail', { clientId: 'own.apps.googleusercontent.com', refreshToken: '1//t' }));
    expect(found.some((i) => i.message.includes('was sent without'))).toBe(false);
    expect(found.some((i) => i.message.includes('sourceConfig is missing clientSecret'))).toBe(true);
  });

  it('a Dropbox source keeps its own refusal — the same three names, a different application', () => {
    const found = issues({
      name: 'a migration',
      sourceType: 'dropbox',
      targetType: 'webdav',
      sourceConfig: { username: 'someone@example.invalid', clientId: 'app-key', refreshToken: '1//t' },
      targetConfig: { host: 'dst.example.nl', port: 443, username: 'a@example.nl', password: 'x' },
      syncConfig: { domains: ['file'] },
    });
    expect(found.some((i) => i.message.includes('was sent without'))).toBe(false);
    expect(found.some((i) => i.message.includes('App secret as clientSecret'))).toBe(true);
  });
});
