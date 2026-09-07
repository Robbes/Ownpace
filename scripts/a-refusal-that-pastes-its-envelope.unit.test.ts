// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FIX WRITTEN ONCE AND APPLIED TO ONE OF THIRTEEN SITES.
 *
 * On 2026-09-02 the owner's first Google Test answered with a wall of GData
 * XML, and `davRefusalBody` was written to unwrap it — Google's code and
 * reason kept verbatim, only the envelope removed. It was applied to the four
 * PROPFIND refusals that had produced the complaint.
 *
 * There were nine others. Five days later the owner's connection card read:
 *
 *     Contacts — not measured: addressbook-query REPORT failed with status
 *     400: { "error": { "code": 400, "message": "Request contains an invalid
 *     argument.", "status": "INVALID_ARGUMENT" } }
 *
 * The same provider, the same shape of envelope, the same phone — and a fix
 * that had been written, tested and merged, sitting one function call away
 * from the line that needed it. Nothing was broken; something was simply not
 * reached.
 *
 * ## Why it could not be reached from where it was
 *
 * Five of the nine are in `@openmig/engines`, which does not depend on
 * `@openmig/connectors`, where the helper lived. So half the family was out
 * of reach by construction and the other half by omission. It is in
 * `@openmig/shared` now, which both packages already depend on.
 *
 * ## What this asserts
 *
 * That no DAV request refuses by interpolating `response.body` raw. Read as
 * text over the connector and engine sources, because the property is
 * syntactic — "this string is built from that expression" — and there is no
 * behaviour to drive: a writer that pasted the envelope would return exactly
 * what a writer that trimmed it returns, minus the readability, against every
 * server that does not answer in GData XML. That is the whole failure mode.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY (AGENTS.md). The helper's own
 * behaviour — which envelopes it unwraps, what passes through untouched — is
 * tested beside it in `packages/shared/src/gdata-refusal.unit.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The DAV-speaking sources and writers — the ones that read `response.body`. */
const DIRS = ['packages/connectors/src', 'packages/engines/src'];

function davSources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const dir of DIRS) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (!name.endsWith('.ts') || name.includes('.test.')) continue;
      const text = readFileSync(join(ROOT, dir, name), 'utf8');
      // Only files that actually build a refusal out of a response body.
      if (text.includes('${response.body}') || text.includes('davRefusalBody(')) {
        out.push({ file: `${dir}/${name}`, text });
      }
    }
  }
  return out;
}

describe("a provider's refusal reaches a person without its envelope", () => {
  const files = davSources();

  it('finds the DAV files at all — this guard is not passing on an empty list', () => {
    // The failure this control exists for: a rename or a move makes the glob
    // match nothing, and every assertion below passes having read no code.
    expect(files.length, 'no DAV source or writer was found to check').toBeGreaterThan(4);
  });

  it.each(files.map((f) => [f.file, f.text]))('%s never pastes a raw response body', (file, text) => {
    const raw = String(text)
      .split('\n')
      .map((line, i) => ({ n: i + 1, line }))
      // `${response.body}` is fine anywhere it is not being interpolated INTO
      // a refusal; in practice every occurrence is one, so the rule is flat.
      .filter(({ line }) => line.includes('${response.body}'))
      .map(({ n, line }) => `line ${n}: ${line.trim()}`);

    expect(
      raw,
      `${file} builds a refusal out of the raw body. A GData error document is ~400 ` +
        'characters of XML around one sentence, and the sentence is the remedy — wrap it in ' +
        '`davRefusalBody(...)` from @openmig/shared, which leaves every non-Google refusal ' +
        'exactly as it found it',
    ).toEqual([]);
  });

  it('and the helper is somewhere both packages can reach', () => {
    // The reason five of these could not have been fixed where the helper
    // was: `@openmig/engines` has no dependency on `@openmig/connectors`.
    const engines = readFileSync(join(ROOT, 'packages/engines/package.json'), 'utf8');
    expect(engines, 'engines can no longer reach shared').toContain('@openmig/shared');
    expect(
      engines,
      'engines now depends on connectors — if that is deliberate, this guard\'s reasoning ' +
        'about why the helper lives in shared needs revisiting',
    ).not.toContain('@openmig/connectors');
    const shared = readFileSync(join(ROOT, 'packages/shared/src/index.ts'), 'utf8');
    expect(shared, 'shared no longer exports the trimmer').toContain('gdata-refusal');
  });
});
