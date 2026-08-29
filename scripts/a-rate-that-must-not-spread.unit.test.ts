// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * VAT_RATE may not gain a single new caller (ADR-0044; workplan 0111 T3).
 *
 * The constant is a stated correctness bug kept alive for one legacy display
 * surface. ADR-0044 said it "must not spread"; a sentence in an ADR stops
 * nobody at 23:00 with an estimate to ship, so this pins the EXACT files
 * that may name it. Adding a caller fails here with the reason; removing one
 * fails too, so the list can never quietly cover less than it claims —
 * hand-kept completeness lists going stale is this repo's recurring defect
 * class, and the two-way assertion is the antidote.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/**
 * Every file allowed to say VAT_RATE, with why. The DEFINITION is in the
 * list on purpose: its presence is the vacuity guard — a walk that found
 * nothing would otherwise pass perfectly.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'packages/managed/src/pricing.ts': 'The definition, with the containment paragraph.',
  'packages/managed/src/pricing.unit.test.ts': 'Pins the definition.',
  'apps/api/src/services/billing-service.ts':
    'The legacy usage-screen estimate — the one surface the constant survives for, ' +
    'rewired against Moneybird in 0111 T4/T8.',
  'apps/api/src/services/invoice-generation.ts':
    'The RETIRED generator (unreachable since 0109 T0; replaced by 0109 T5). It keeps ' +
    'importing rather than redeclaring, per its own comment about the third copy.',
  'apps/web/src/pages/Billing.tsx':
    'A comment pointing at the server-side constant — words, not arithmetic.',
};

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'build' || name.startsWith('.')) {
      continue;
    }
    const full = join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) out.push(full);
  }
}

describe('VAT_RATE is contained', () => {
  it('is named by exactly the allowed files — no new caller, no stale exception', () => {
    const files: string[] = [];
    for (const top of ['apps', 'packages', 'site']) walk(join(ROOT, top), files);

    const naming = files
      .filter((f) => /\bVAT_RATE\b/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f))
      .sort();

    const unexpected = naming.filter((f) => !(f in ALLOWED));
    expect(
      unexpected,
      'these files name VAT_RATE and are not in the allow-list — the one VAT constant is a ' +
        'stated correctness bug (ADR-0044): decide a treatment via vat-treatment.ts and let ' +
        'Moneybird own the number via moneybird-tax-rates.ts instead',
    ).toEqual([]);

    const missing = Object.keys(ALLOWED).filter((f) => !naming.includes(f));
    expect(
      missing,
      'allow-listed but no longer naming VAT_RATE — remove the entry so the exception list ' +
        'stays exactly as big as the exception',
    ).toEqual([]);
  });
});
