/**
 * The company in the footer (workplan 0152 T8 (c); the owner, 2026-10-16: "yes").
 *
 * Every page of the site names who runs Ownpace: Archico B.V., its KvK number
 * and its VAT number, in the words privacy §1 says it, and no postal address
 * during the Alpha (the owner, 2026-09-28: we correspond by email). The footer
 * reads the line from privacy §1 rather than keeping a copy, so the two cannot
 * drift: this file holds that every page carries privacy §1's line, in its own
 * language.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// The build asks which app its buttons reach; the OTA's, as `site.unit.test.ts` sets it.
process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';

interface Page {
  readonly locale: string;
  readonly key: string;
  readonly file: string;
  readonly html: string;
}

/** Privacy §1's first line of prose, outside HTML comments, read here on its own. */
function whoWeAre(file: string): string {
  const text = readFileSync(join(HERE, 'legal', file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const lines = text.split('\n');
  const heading = lines.findIndex((l) => /^## 1\.\s/.test(l));
  expect(heading, `site/legal/${file} has no "## 1." section`).toBeGreaterThanOrEqual(0);
  const line = lines.slice(heading + 1).find((l) => l.trim() !== '');
  expect(line, `site/legal/${file}: §1 has no line`).toBeDefined();
  return line!.trim();
}

const PRIVACY: Record<string, string> = { en: 'privacy.md', nl: 'privacy.nl.md' };

/** HTML-escaped, as the build writes text. */
const escaped = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('the company in the footer (0152 T8 (c))', () => {
  it('privacy §1 names the company, its KvK number and its VAT number, and no address', () => {
    for (const file of Object.values(PRIVACY)) {
      const line = whoWeAre(file);
      expect(line, `site/legal/${file} §1`).toMatch(/^Archico B\.V\.,/);
      expect(line, `site/legal/${file} §1: the KvK number`).toMatch(/KvK \d{8}\b/);
      expect(line, `site/legal/${file} §1: the VAT number`).toMatch(/\bNL\d{4}\.\d{3}\.\d{2}\.B\d{2}\b/);
    }
  });

  it("every page's footer carries privacy §1's line, in the page's own language", async () => {
    const { rendered } = (await import('./build.mjs')) as unknown as { rendered: Page[] };
    expect(rendered.length, 'the build rendered no pages').toBeGreaterThan(0);
    for (const page of rendered) {
      const footer = page.html.slice(page.html.lastIndexOf('<footer'));
      expect(footer, `${page.file}: no footer`).toMatch(/^<footer/);
      const line = escaped(whoWeAre(PRIVACY[page.locale] ?? 'privacy.md'));
      expect(footer, `${page.file}: the footer does not name the company as privacy §1 does`).toContain(line);
    }
  });
});
