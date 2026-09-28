// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ICON DRAWN TWICE (workplan 0153 §5, 0152 T3).
 *
 * The six data-type icons are drawn once, in `docs/design/0152-0154/icons.svg`,
 * and used twice: the site inlines them as a sprite, and the app draws them
 * with `data-type-icons.tsx`. Two copies of a drawing drift the first time
 * somebody improves one of them, and nothing looks wrong on either side:
 * each is a perfectly good icon, just not the same one.
 *
 * WHAT IS ASSERTED:
 *
 * - every icon's elements equal the drawing's `<symbol id="i-…">`, tag by
 *   tag and attribute by attribute, and the drawing has no symbol the app
 *   lacks, nor the other way round;
 * - the stroke the drawing gives its symbols is the one the component draws;
 * - an icon is `aria-hidden` and never focusable, and `DataTypeLabel` writes
 *   the data type's name beside it in the reader's language;
 * - every data type has an icon.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISCOVERY_DOMAINS } from '@openmig/shared';
import { LocaleProvider } from '../../i18n/index.tsx';
import {
  DATA_TYPE_ICONS,
  DATA_TYPE_ICON_PARTS,
  DataTypeIcon,
  DataTypeLabel,
  ICON_OF_DOMAIN,
} from './data-type-icons.tsx';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const DRAWING = readFileSync(join(REPO_ROOT, 'docs', 'design', '0152-0154', 'icons.svg'), 'utf8');

/** `name="value"` pairs, in order. */
function attributes(text: string): Record<string, string> {
  return Object.fromEntries([...text.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
}

/** Each symbol of the drawing: its own attributes and its elements. */
function symbols(svg: string): Map<string, { own: Record<string, string>; parts: [string, Record<string, string>][] }> {
  const found = new Map<string, { own: Record<string, string>; parts: [string, Record<string, string>][] }>();
  for (const m of svg.matchAll(/<symbol id="i-([a-z]+)"([^>]*)>([\s\S]*?)<\/symbol>/g)) {
    const parts = [...m[3]!.matchAll(/<(rect|circle|path)\b([^>]*?)\/>/g)].map(
      (p) => [p[1]!, attributes(p[2]!)] as [string, Record<string, string>],
    );
    found.set(m[1]!, { own: attributes(m[2]!), parts });
  }
  return found;
}

afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

describe('an icon drawn twice', () => {
  const drawn = symbols(DRAWING);

  it('finds the six symbols in the drawing, so the comparison below compares something', () => {
    expect([...drawn.keys()].sort()).toEqual([...DATA_TYPE_ICONS].sort());
  });

  it.each([...DATA_TYPE_ICONS])('draws %s element for element as the drawing does', (name) => {
    const expected = drawn.get(name)!.parts;
    const actual = DATA_TYPE_ICON_PARTS[name].map(([tag, attrs]) => [tag, { ...attrs }]);
    expect(actual).toEqual(expected);
  });

  it('draws with the stroke the drawing gives every symbol', () => {
    for (const { own } of drawn.values()) {
      expect(own).toMatchObject({
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      });
    }
    const { container } = render(<DataTypeIcon name="mail" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
  });

  it('hides the icon from a screen reader and keeps it out of the tab order', () => {
    const { container } = render(<DataTypeIcon name="files" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
  });

  it('gives every data type an icon', () => {
    for (const domain of DISCOVERY_DOMAINS) {
      expect(DATA_TYPE_ICONS).toContain(ICON_OF_DOMAIN[domain]);
    }
  });

  it.each([
    ['en', 'Email'],
    ['nl', 'E-mail'],
  ])('writes the data type\'s name beside its icon in %s', (locale, word) => {
    globalThis.localStorage.setItem('ownpace.locale', locale);
    const { container } = render(
      <LocaleProvider>
        <DataTypeLabel domain="email" />
      </LocaleProvider>,
    );
    expect(screen.getByText(word)).toBeTruthy();
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });
});
