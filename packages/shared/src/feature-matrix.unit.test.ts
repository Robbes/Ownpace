// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The feature matrix's drift lock.
 *
 * `docs/feature-matrix.md` opens with a promise: every row mirrors the shared
 * coherence matrices, and when the two disagree the code is right and the
 * document has a bug. A promise only a test can keep — the same trick the
 * route-parity and OpenAPI locks use: connectors will keep being added to
 * `SOURCE_TYPE_DOMAINS` / `TARGET_TYPE_DOMAINS`, and each addition must fail
 * THIS test until the matrix mentions the new kind by its config name.
 *
 * Mentioned means BACKTICKED — the literal the wizard stores and a mapping
 * file writes — because prose ("Gmail") drifts and renames, while `gmail` is
 * greppable and exact. The lock checks presence, not placement or status:
 * which section a kind sits in, and which of the five statuses it carries,
 * stay judgment calls for the author. Presence is the floor — a kind the
 * document does not name at all is invisible to the one page that promises
 * the whole picture.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOURCE_TYPE_DOMAINS, TARGET_TYPE_DOMAINS } from './target-domains.ts';

const matrix = readFileSync(
  fileURLToPath(new URL('../../../docs/feature-matrix.md', import.meta.url)),
  'utf8',
);

describe('docs/feature-matrix.md mirrors the coherence matrices', () => {
  it('names every SOURCE kind the create API accepts, backticked', () => {
    for (const kind of Object.keys(SOURCE_TYPE_DOMAINS)) {
      expect(matrix, `the matrix never mentions source kind '${kind}'`).toContain(`\`${kind}\``);
    }
  });

  it('names every TARGET kind, backticked', () => {
    for (const kind of Object.keys(TARGET_TYPE_DOMAINS)) {
      expect(matrix, `the matrix never mentions target kind '${kind}'`).toContain(`\`${kind}\``);
    }
  });

  it('still carries the self-description this lock enforces', () => {
    // If somebody rewrites the intro away from the mirror promise, the lock
    // outlives its reason — surface that instead of silently policing prose
    // that no longer claims anything.
    expect(matrix).toContain('the code is right');
    expect(matrix).toContain('SOURCE_TYPE_DOMAINS');
  });
});
