// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The published legal surface gets a guard, for three reasons that nothing
 * else in this suite covers.
 *
 * 1. `site/legal/*.md` are DRAFTS carrying «PLACEHOLDER» tokens for facts only
 *    the owner can supply. A new placeholder added during an edit and then
 *    forgotten is discovered by a customer reading «LEGAL_ENTITY» in a
 *    published privacy policy. So every placeholder used must be listed in
 *    `site/legal/README.md`'s table, and this test is what makes the README
 *    the checklist it claims to be rather than prose that drifts.
 *
 * 2. Google's OAuth verification requires a support contact and a logo of at
 *    least 120x120 (docs/google-oauth-verification.md). Both are easy to lose
 *    to an unrelated edit and neither is exercised by any other test — the
 *    logo is a generated binary nothing imports, and the address is a string
 *    in prose.
 *
 * 3. The Limited Use commitments in privacy §6 are the ones the verification
 *    submission maps onto Google's policy. A policy that quietly stopped
 *    saying "we do not use it for advertising" while the submission still
 *    claimed it does is the shape of problem worth a cheap assertion.
 *
 * Deliberately NOT asserted: prose quality, section ordering, or that the
 * documents are complete. A test that pinned wording would fail on every
 * legitimate edit and teach people to weaken it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEGAL = join(REPO_ROOT, 'site', 'legal');
const BRAND = join(REPO_ROOT, 'site', 'brand');

const SUPPORT_EMAIL = 'support@ownpace.eu';
const DOCS = ['privacy.md', 'terms.md'] as const;

const read = (p: string) => readFileSync(p, 'utf8');
const placeholdersIn = (text: string) => new Set(text.match(/«[A-Z_]+»/g) ?? []);

describe('the published legal surface', () => {
  it('lists every placeholder it uses in the README checklist', () => {
    const readme = read(join(LEGAL, 'README.md'));
    const listed = placeholdersIn(readme);

    for (const doc of DOCS) {
      for (const token of placeholdersIn(read(join(LEGAL, doc)))) {
        expect(
          listed,
          `${doc} uses ${token} but site/legal/README.md does not list it. Add a row to the ` +
            'placeholder table saying what it needs — an unlisted placeholder is one that ' +
            'gets published.',
        ).toContain(token);
      }
    }
  });

  it('names the support address in both documents', () => {
    // Google's verification requires a support contact, and a policy that
    // names no way to exercise the rights it grants is not a policy.
    for (const doc of DOCS) {
      expect(read(join(LEGAL, doc)), `${doc} must name ${SUPPORT_EMAIL}`).toContain(
        SUPPORT_EMAIL,
      );
    }
  });

  it('keeps the Limited Use commitments the Google submission relies on', () => {
    const privacy = read(join(LEGAL, 'privacy.md')).toLowerCase();
    // One assertion per commitment, so a failure names which one went missing
    // rather than reporting that "the policy changed".
    const commitments: ReadonlyArray<readonly [string, string]> = [
      ['api services user data policy', 'the policy Ownpace declares adherence to'],
      ['limited use', 'the requirement set the restricted scopes turn on'],
      ['advertising', 'the no-advertising commitment'],
      ['train', 'the no-AI-training commitment'],
    ];
    for (const [needle, why] of commitments) {
      expect(privacy, `privacy.md no longer states ${why}`).toContain(needle);
    }
  });

  it('says self-host sends us nothing, which is the strongest claim available', () => {
    // The appliance is never invoiced and never phones home (ADR-0036,
    // no-managed-leakage). A privacy policy that dropped this would understate
    // the product.
    expect(read(join(LEGAL, 'privacy.md'))).toMatch(/run Ownpace yourself/i);
  });

  it('ships an app logo at least 120x120, as a real PNG', () => {
    // Read the IHDR rather than trusting the filename: the failure this
    // catches is someone replacing the file with a differently-sized export.
    const png = readFileSync(join(BRAND, 'logo-120.png'));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width, 'Google requires at least 120px wide').toBeGreaterThanOrEqual(120);
    expect(height, 'Google requires at least 120px tall').toBeGreaterThanOrEqual(120);
    expect(statSync(join(BRAND, 'logo-120.png')).size).toBeGreaterThan(0);
  });

  it('keeps the SVG and the PNG the same drawing', () => {
    // Both are emitted by scripts/make-logo.py from shared constants. The
    // regression this pins is an SVG hand-edited in isolation, which is how
    // the two sizes would silently become different marks.
    const svg = read(join(BRAND, 'logo.svg'));
    const script = read(join(REPO_ROOT, 'scripts', 'make-logo.py'));
    const bg = /#0E4F4A/i;
    expect(svg, 'logo.svg lost the brand colour').toMatch(bg);
    expect(script, 'make-logo.py no longer emits the brand colour').toMatch(/0x0E, 0x4F, 0x4A/);
    expect(svg, 'hand-edited? regenerate with python3 scripts/make-logo.py').toContain(
      'aria-label="Ownpace"',
    );
  });
});
