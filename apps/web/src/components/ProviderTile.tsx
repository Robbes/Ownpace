// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PROVIDER'S TILE: our own, neutral, and no logos (workplan 0152 D4, 0153 §5).
 *
 * Drawn in `docs/design/0152-0154/tiles.svg`. An account a person leaves wears
 * its initial on the site's teal; where the data goes wears it on the site's
 * mint. They are the two colours `site/build.mjs` declares, and
 * `ProviderTile.unit.test.tsx` holds them equal, so the site and the app show
 * one look.
 *
 * THE LETTER COMES FROM THE TABLE BELOW, never from the type or the kind
 * string. `gmail`, `google-drive` and a `google_drive` connection all draw G,
 * and `imap` draws @ where a person leaves it and + where the data goes. A
 * type the table does not know draws no tile at all, rather than a guessed
 * letter; the test fails for every type the app can connect to.
 *
 * THE NAME IS ALWAYS WRITTEN, and the tile is `aria-hidden`, so a screen
 * reader reads the name once and never the letter. It is
 * `providerDisplayName`'s unless the caller gives one: the new flow's tiles
 * say "Google", where the card says "Google account".
 */
import React from 'react';
import { providerDisplayName, wizardTypeForConnectionKind } from '@openmig/shared';

/** The site's palette (`site/build.mjs`), which the drawing uses. */
export const TILE_TEAL = '#0E4F4A';
export const TILE_MINT = '#7FD4C1';

export type TileRole = 'source' | 'target';
export type TileSize = 48 | 28 | 20;

/** Each wizard type's initial, per side. A connection kind is read as its wizard type first. */
export const TILE_LETTERS: Readonly<Record<TileRole, Readonly<Record<string, string>>>> = {
  source: {
    google: 'G',
    gmail: 'G',
    'google-drive': 'G',
    'google-calendar': 'G',
    'google-contacts': 'G',
    microsoft: 'M',
    oauth2: 'M',
    graph: 'M',
    apple: 'A',
    dropbox: 'D',
    box: 'B',
    imap: '@',
    archive: 'E',
  },
  target: {
    soverin: 'S',
    nextcloud: 'N',
    jmap: 'J',
    imap: '+',
    caldav: '+',
    carddav: '+',
    webdav: '+',
  },
};

/** The initial a type or a connection kind draws on this side, or undefined for one the table does not know. */
export function tileLetter(typeOrKind: string, role: TileRole): string | undefined {
  const type = wizardTypeForConnectionKind(typeOrKind);
  const letters = TILE_LETTERS[role];
  return Object.prototype.hasOwnProperty.call(letters, type) ? letters[type] : undefined;
}

/**
 * The company a person leaves, where one company has several products: a card's
 * line says *From Google and Dropbox*, not *From Gmail, Google Drive and
 * Dropbox* (0153 T3 (a)). Every other type, and every destination, is named as
 * `providerDisplayName` names it.
 */
const SOURCE_COMPANY: Readonly<Record<string, string>> = {
  google: 'Google',
  gmail: 'Google',
  'google-drive': 'Google',
  'google-calendar': 'Google',
  'google-contacts': 'Google',
  microsoft: 'Microsoft 365',
  oauth2: 'Microsoft 365',
  graph: 'Microsoft 365',
  apple: 'Apple iCloud',
};

/**
 * A stored connection kind's name, for a row that has only the kind (0153 T6
 * (a), (c)): `gmail` is *Gmail* and `google_drive` is *Google Drive*, never the
 * kind itself. `o365` is *Microsoft 365*, whichever of its two cards saved it.
 * A kind no card saves any more (`proton` and `selfhosted_mail`, from before
 * the cards) has none, and its row shows the account's own name alone.
 */
export function connectionKindName(kind: string): string | undefined {
  if (kind === 'o365') return 'Microsoft 365';
  const type = wizardTypeForConnectionKind(kind);
  const name = providerDisplayName(type);
  return name === type ? undefined : name;
}

/** What a line of words calls a type or a connection kind on this side. */
export function providerName(typeOrKind: string, role: TileRole): string {
  const type = wizardTypeForConnectionKind(typeOrKind);
  if (role === 'source' && Object.prototype.hasOwnProperty.call(SOURCE_COMPANY, type)) return SOURCE_COMPANY[type]!;
  return providerDisplayName(type);
}

/** Corner radius 22% of the size, the letter 45% of it, as the drawing says. */
const SIZE_CLASS: Readonly<Record<TileSize, string>> = {
  48: 'w-12 h-12 rounded-[11px] text-[22px]',
  28: 'w-7 h-7 rounded-[6px] text-[13px]',
  20: 'w-5 h-5 rounded-[4px] text-[9px]',
};

const ROLE_CLASS: Readonly<Record<TileRole, string>> = {
  source: 'bg-[#0E4F4A] text-white',
  target: 'bg-[#7FD4C1] text-[#0E4F4A]',
};

export default function ProviderTile({
  type,
  role,
  size = 28,
  name,
}: {
  /** A wizard type (`google-drive`) or a connection kind (`google_drive`). */
  type: string;
  role: TileRole;
  size?: TileSize;
  /** What to call it, where `providerDisplayName` is not the word wanted. */
  name?: string;
}): React.ReactElement {
  const letter = tileLetter(type, role);
  return (
    <span className="inline-flex items-center gap-2">
      {letter !== undefined && (
        <span
          aria-hidden="true"
          data-tile={role}
          className={`inline-flex shrink-0 select-none items-center justify-center font-bold leading-none ${SIZE_CLASS[size]} ${ROLE_CLASS[role]}`}
        >
          {letter}
        </span>
      )}
      <span>{name ?? providerDisplayName(wizardTypeForConnectionKind(type))}</span>
    </span>
  );
}
