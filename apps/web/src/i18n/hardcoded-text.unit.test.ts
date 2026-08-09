// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The guard that ends the class (0035 T2): no new hardcoded English
 * sentences in pages/ or components/.
 *
 * Heuristic, deliberately: a JSX text node that starts with a capitalized
 * word followed by at least one more word is almost always a sentence a
 * user reads. `ConfirmMigration.tsx` was fixed in #355, the rest of the
 * class in 0035 T2 — this test is what keeps the count at zero.
 *
 * A DELIBERATE exception (server-prose passthrough, a brand name, a
 * technical literal) is annotated by putting the literal on a line ending
 * with the comment `// i18n-exempt: <reason>` — or, for whole-file cases,
 * listed in ALLOWLIST below with the reason. Do not add to the allowlist
 * because the guard is inconvenient; add because the words genuinely must
 * not be translated.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOTS = [join(__dirname, '..', 'pages'), join(__dirname, '..', 'components')];

/** file (relative to src/) -> reason. Keep this SHORT. */
const ALLOWLIST: Record<string, string> = {
  // The brand name in the sidebar/header and the login page's code literal.
  'components/Layout.tsx': 'brand name "Open Migrate" in logo/header fallback',
};

// Sentence shape: a capitalized word followed by a lowercase word — the
// signature of prose a user reads. Proper-noun pairs ("Open Migrate") and
// single words ("IMAP") pass.
const SENTENCE = /^[A-Z][A-Za-z'\u2019&-]*\s+[a-z]/;
// Text physically between tags on one line: >Some words<  or  >Some words[EOL]
const BETWEEN_TAGS = />([^<>{}]+)</g;
const AFTER_TAG = />\s*([^<>{}]+)\s*$/;
// A continuation line that is pure text (multiline JSX children).
const BARE_TEXT_LINE = /^\s+([A-Za-z'\u2019&][A-Za-z'\u2019&%().,:\u2014 -]{6,})\s*$/;

describe('no hardcoded user-facing sentences outside t()', () => {
  const offenders: string[] = [];

  const scan = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        scan(path);
        continue;
      }
      if (!name.endsWith('.tsx') || name.includes('.test.')) continue;
      const rel = relative(join(__dirname, '..'), path).replace(/\\/g, '/');
      if (ALLOWLIST[rel]) continue;

      const lines = readFileSync(path, 'utf8').split('\n');
      let inComment = false;
      for (const [i, line] of lines.entries()) {
        const trimmed = line.trim();
        if (trimmed.startsWith('/*') || trimmed.startsWith('{/*')) inComment = true;
        if (inComment) {
          if (trimmed.includes('*/')) inComment = false;
          continue;
        }
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (line.includes('i18n-exempt')) continue;
        if (line.includes("t('") || line.includes('t(`')) continue;

        const candidates: string[] = [];
        for (const m of line.matchAll(BETWEEN_TAGS)) candidates.push(m[1]!.trim());
        const tail = AFTER_TAG.exec(line);
        if (tail) candidates.push(tail[1]!.trim());
        const bare = BARE_TEXT_LINE.exec(line);
        if (bare) {
          const prev = lines[i - 1] ?? '';
          const next = lines[i + 1] ?? '';
          // Only count pure-text lines that sit inside JSX children.
          if (/>\s*$/.test(prev.trim()) || /^\s*</.test(next)) candidates.push(bare[1]!.trim());
        }

        for (const text of candidates) {
          if (SENTENCE.test(text)) {
            offenders.push(`${rel}:${i + 1}: ${text.slice(0, 70)}`);
          }
        }
      }
    }
  };

  it('pages/ and components/ are clean (annotate deliberate exceptions)', () => {
    for (const root of ROOTS) scan(root);
    expect(offenders).toEqual([]);
  });
});

