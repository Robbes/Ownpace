// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PROVIDER TILE (workplan 0153 §5, 0152 D4).
 *
 * WHAT IS ASSERTED:
 *
 * - every wizard type the app can connect to has a letter on its own side, so
 *   no tile falls back to a guess;
 * - a connection kind draws its wizard type's letter: `google_drive` is G
 *   like `gmail`, and `o365` is M;
 * - the tile is `aria-hidden` and the name is written, so a screen reader
 *   reads the name once and never the letter;
 * - the two colours are the site's (`site/build.mjs`) and the drawing's
 *   (`docs/design/0152-0154/tiles.svg`).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectableTypes } from '@openmig/shared';
import ProviderTile, { TILE_MINT, TILE_TEAL, tileLetter, type TileRole } from './ProviderTile.tsx';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (...path: string[]) => readFileSync(join(REPO_ROOT, ...path), 'utf8');

afterEach(cleanup);

describe('the provider tile', () => {
  it.each(['source', 'target'] as TileRole[])('has a letter for every %s type the app connects to', (role) => {
    const types = connectableTypes(role);
    expect(types.length).toBeGreaterThan(0);
    expect(types.filter((t) => tileLetter(t, role) === undefined)).toEqual([]);
  });

  it.each([
    ['gmail', 'source', 'G'],
    ['google-drive', 'source', 'G'],
    ['google_drive', 'source', 'G'],
    ['google_calendar', 'source', 'G'],
    ['o365', 'source', 'M'],
    ['imap', 'source', '@'],
    ['imap', 'target', '+'],
    ['soverin', 'target', 'S'],
  ] as [string, TileRole, string][])('draws %s as a %s with %s', (type, role, letter) => {
    expect(tileLetter(type, role)).toBe(letter);
  });

  it('draws no tile for a type it does not know, and still writes the name', () => {
    const { container } = render(<ProviderTile type="no-such-type" role="source" />);
    expect(container.querySelector('[data-tile]')).toBeNull();
    expect(screen.getByText('no-such-type')).toBeTruthy();
  });

  it('hides the letter from a screen reader and writes the name beside it', () => {
    const { container } = render(<ProviderTile type="google_drive" role="source" />);
    const tile = container.querySelector('[data-tile]')!;
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.textContent).toBe('G');
    expect(screen.getByText('Google Drive')).toBeTruthy();
  });

  it('writes the name the caller gives, where the card name is not the word wanted', () => {
    render(<ProviderTile type="google" role="source" name="Google" />);
    expect(screen.getByText('Google')).toBeTruthy();
    expect(screen.queryByText('Google account')).toBeNull();
  });

  it('wears the site\'s teal for a source and its mint for a target', () => {
    const { container } = render(
      <>
        <ProviderTile type="gmail" role="source" />
        <ProviderTile type="soverin" role="target" />
      </>,
    );
    expect(container.querySelector('[data-tile="source"]')!.className).toContain(`bg-[${TILE_TEAL}]`);
    expect(container.querySelector('[data-tile="target"]')!.className).toContain(`bg-[${TILE_MINT}]`);
    expect(container.querySelector('[data-tile="target"]')!.className).toContain(`text-[${TILE_TEAL}]`);
  });

  it('uses the same two colours as the site and the drawing', () => {
    const build = read('site', 'build.mjs');
    expect(build).toContain(`const TEAL = '${TILE_TEAL}';`);
    expect(build).toContain(`const MINT = '${TILE_MINT}';`);
    const drawing = read('docs', 'design', '0152-0154', 'tiles.svg');
    expect(drawing).toContain(`fill="${TILE_TEAL}"`);
    expect(drawing).toContain(`fill="${TILE_MINT}"`);
  });
});
