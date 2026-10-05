// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A CONNECTION KIND SHOWN WHERE A NAME BELONGS (workplan 0153 T6 (a), (c)).
 *
 * The code's words for a provider are keys: a stored kind (`gmail`,
 * `google_drive`, `o365`) and a wizard type (`oauth2`, `google-drive`). The
 * screens rendered them as they are. The Accounts page wore `google_drive` as
 * a badge on its row, the wizard's list of saved accounts said *Anna's mail
 * (gmail)*, its review step said the source was `oauth2`, and the Dashboard
 * and the Migrations table printed `sourceType → targetType`. A family reads
 * *Google Drive* and *Microsoft 365*; the keys were never words.
 *
 * WHAT IS READ: every page and component, for a kind or a type rendered as a
 * JSX child, `{x.kind}`, `{x.sourceType}` or `{x.targetType}`, rather than
 * through its name (`connectionKindName`, `providerDisplayName`,
 * `providerName`). An attribute's value (`selectedId={x.sourceType}`) and a
 * template's (`${x.kind}`) are code, not text, and are not read. A deliberate
 * one says why on its own line: `kind-exempt: <reason>`.
 *
 * AND EVERY KIND HAS A NAME. The kinds a connection row may hold are the
 * ledger's `connection_kind_check`, read from the newest migration that
 * states it, so a kind added there without a name fails here. `proton` and
 * `selfhosted_mail` are from before the cards, and nothing saves them any
 * more: they have no name, and a row shows the account's own name alone.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';
import { connectionKindName } from '../components/ProviderTile.tsx';

const SRC = join(__dirname, '..');
const REPO = join(SRC, '..', '..', '..');
const ROOTS = [join(SRC, 'pages'), join(SRC, 'components')];

// A kind or a type as a JSX child: not after `=` (an attribute) or `$` (a template).
const RENDERED_KEY = /(?<![=$])\{\s*[\w.?!]+\.(kind|sourceType|targetType)\s*\}/g;

/** Kinds from before the cards, which nothing saves any more. */
const NAMELESS = ['proton', 'selfhosted_mail'];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path));
    else if (name.endsWith('.tsx') && !name.includes('.test.')) out.push(path);
  }
  return out;
}

/** The kinds `connection_kind_check` allows, from the newest migration that states it. */
function storedKinds(): string[] {
  const dir = join(REPO, 'packages', 'ledger', 'migrations');
  const stating = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => /ADD CONSTRAINT connection_kind_check CHECK/.test(readFileSync(join(dir, f), 'utf8')));
  const newest = readFileSync(join(dir, stating[stating.length - 1]!), 'utf8');
  const check = newest.slice(newest.lastIndexOf('ADD CONSTRAINT connection_kind_check CHECK'));
  const list = check.slice(0, check.indexOf(']'));
  return [...list.matchAll(/'([a-z0-9_]+)'::text/g)].map((m) => m[1]!);
}

describe('a connection kind is shown by its name, never as itself (0153 T6 (c))', () => {
  it('no page or component renders a kind or a type as text', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const path of tsxFiles(root)) {
        const rel = relative(SRC, path).replace(/\\/g, '/');
        readFileSync(path, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (line.includes('kind-exempt')) return;
            for (const m of line.matchAll(RENDERED_KEY)) offenders.push(`${rel}:${i + 1}: ${m[0]}`);
          });
      }
    }
    expect(
      offenders,
      'A kind or a wizard type is rendered as text. Render its name instead\n' +
        '(connectionKindName, providerDisplayName or providerName), or say why on\n' +
        'the line: kind-exempt: <reason>.',
    ).toEqual([]);
  });

  it('reads the kinds from the ledger, so an empty list cannot pass', () => {
    const kinds = storedKinds();
    expect(kinds.length).toBeGreaterThan(15);
    for (const known of ['gmail', 'google_drive', 'o365', 'imap', 'soverin', 'nextcloud', 'archive']) {
      expect(kinds).toContain(known);
    }
  });

  it('names every kind a card saves, and never as the kind itself', () => {
    for (const locale of ['en', 'nl'] as const) {
      const unnamed = storedKinds().filter((k) => !NAMELESS.includes(k) && connectionKindName(k, locale) === undefined);
      expect(unnamed, `a kind the ledger allows has no name in ${locale}`).toEqual([]);
      for (const kind of storedKinds().filter((k) => !NAMELESS.includes(k))) {
        expect(connectionKindName(kind, locale), `${kind} is named as itself in ${locale}`).not.toBe(kind);
      }
    }
  });

  it.each([
    ['gmail', 'Gmail'],
    ['google_drive', 'Google Drive'],
    ['google_calendar', 'Google Calendar'],
    ['o365', 'Microsoft 365'],
    ['imap', 'IMAP'],
    ['soverin', 'Soverin'],
  ])('names %s "%s"', (kind, name) => {
    expect(connectionKindName(kind, 'en')).toBe(name);
  });

  // Dutch writes a compound with a name with a hyphen, as the app's Dutch
  // sentences do, and Google names two of its products in Dutch itself (the
  // owner, 2026-10-05: "Write provider names the Dutch way in the Dutch app").
  it.each([
    ['google', 'Google-account'],
    ['microsoft', 'Microsoft 365-account'],
    ['apple', 'Apple-account (iCloud)'],
    ['google_calendar', 'Google Agenda'],
    ['google_contacts', 'Google Contacten'],
    ['archive', 'Exportarchief'],
    ['gmail', 'Gmail'],
    ['o365', 'Microsoft 365'],
  ])('names %s "%s" in Dutch', (kind, name) => {
    expect(connectionKindName(kind, 'nl')).toBe(name);
  });

  it('gives the kinds from before the cards no name, so their row shows its own', () => {
    for (const locale of ['en', 'nl'] as const) {
      for (const kind of NAMELESS) expect(connectionKindName(kind, locale)).toBeUndefined();
    }
  });
});
