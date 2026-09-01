// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE DRIVE BROWSE RESOLVES ITS CLIENT THE WAY THE CONSENT DOES.
 *
 * `POST /google-drive/shared-drives` and `/shared-folders` demanded all three
 * of { clientId, clientSecret, refreshToken } after #703 had made the pair a
 * deployment setting — so on a deployment carrying its own client, the
 * wizard's "Browse shared drives" stayed dead behind two fields nobody had
 * to fill any more. Both routes now resolve the client through shared's
 * `resolveGoogleClient`: the caller's whole pair, else the deployment's, else
 * a refusal naming both ways forward; half a pair refused before either.
 *
 * Pinned by reading the source, because the routes sit in the migrations
 * router, which a unit test cannot mount without a database — and what
 * matters here is exactly WHICH routes read the shared order: the two Google
 * ones, and not Dropbox, whose three fields are its own application's.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'index.ts'), 'utf8');

/** The body of one `router.post('<path>', …)` registration. */
function route(path: string): string {
  const start = source.indexOf(`'${path}'`);
  expect(start, `${path} is not registered`).toBeGreaterThan(-1);
  const end = source.indexOf('\nrouter.', start);
  return source.slice(start, end === -1 ? undefined : end);
}

describe('the two Google browse routes', () => {
  for (const path of ['/google-drive/shared-drives', '/google-drive/shared-folders']) {
    it(`${path} reads the client through shared, with the pair optional as a whole`, () => {
      const body = route(path);
      expect(body).toContain('GoogleBrowseSchema.safeParse');
      expect(body).toContain('resolveGoogleClient(parsed.data)');
      // The refusal is the resolver's own — error and sentence — never a
      // paraphrase here that could disagree with the consent route's.
      expect(body).toContain('{ error: client.error, reason: client.reason }');
      // And the token stays the caller's: the deployment can never supply it.
      expect(body).toContain('refreshToken: parsed.data.refreshToken');
    });
  }

  it('the schema takes the pair as a whole or not at all, never as empty strings', () => {
    const schema = source.slice(
      source.indexOf('const GoogleBrowseSchema'),
      source.indexOf('});', source.indexOf('const GoogleBrowseSchema')),
    );
    expect(schema).toContain('clientId: z.string().min(1).optional()');
    expect(schema).toContain('clientSecret: z.string().min(1).optional()');
    expect(schema).toContain('refreshToken: z.string().min(1),');
  });
});

describe('and Dropbox is left alone', () => {
  it('/dropbox/shared-folders still demands its own three, and resolves nothing', () => {
    const body = route('/dropbox/shared-folders');
    expect(body).toContain('SharedDrivesSchema.safeParse');
    expect(body).not.toContain('resolveGoogleClient');
  });
});
