// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROVIDER NAMED IN THE READER'S LANGUAGE (the owner, 2026-10-05: *"Write
 * provider names the Dutch way in the Dutch app"*).
 *
 * The Dutch app named the account a person leaves *Google account*, the name
 * `providerDisplayName` gave in every language, beside its own Dutch
 * sentences' *Google-account*. The name now takes the reader's language as its
 * second argument, and Dutch writes a few its own way (`credential-fields.ts`).
 * English is the default, for a server's line and a log. Two things keep the
 * Dutch screens Dutch:
 *
 * 1. **Every call in the web app passes the language.** A call with one
 *    argument is English on a Dutch screen, which is the fault this fixed.
 *    The app's helpers (`providerName`, `connectionKindName`) require it, so
 *    the type checker finds those; this finds the direct calls.
 * 2. **A Dutch sentence writes the names the Dutch way too.** None of the
 *    app's Dutch strings writes the English form of a name Dutch writes its own
 *    way: a sentence saying *Google account* under a tile saying
 *    *Google-account* is the same fault the other way round. An API's own name
 *    (*Google Contacts CardDAV API*) is a name, and is left as it is.
 * 3. **So does a Dutch guide.** `docs/guides/nl` sends a reader to *de kaart
 *    **Google account*** on a page whose card says *Google-account*: the
 *    guides name the cards by what they say, so they say it the same way.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerDisplayName, providerTypesWithDutchNames } from '../packages/shared/src/credential-fields.ts';
import { STRINGS } from '../apps/web/src/i18n/strings.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'apps', 'web', 'src');

/** Every source file of the web app, its tests left out. */
function webSources(dir = WEB): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...webSources(path));
    else if (/\.(ts|tsx)$/.test(name) && !name.includes('.test.')) out.push(path);
  }
  return out;
}

/** The text between a call's parentheses, nested ones included. */
function argumentsAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

/** Whether a call's arguments hold a comma outside any nested bracket: a second argument. */
function hasSecondArgument(args: string): boolean {
  let depth = 0;
  for (const ch of args) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) return true;
  }
  return false;
}

describe('a provider named in the reader\'s language (2026-10-05)', () => {
  it('every call in the web app says which language', () => {
    const files = webSources();
    expect(files.length, 'the web app has no sources to read').toBeGreaterThan(50);
    const calls: string[] = [];
    const bare: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bproviderDisplayName\(/g)) {
        const open = m.index! + m[0].length - 1;
        const args = argumentsAt(text, open);
        // The import and the type say the name, not a call.
        if (args.trim() === '') continue;
        const where = `${relative(ROOT, file)}: providerDisplayName(${args})`;
        calls.push(where);
        if (!hasSecondArgument(args)) bare.push(where);
      }
    }
    expect(calls.length, 'no call found: this guard reads nothing').toBeGreaterThan(5);
    expect(bare, 'a name with no language is English on a Dutch screen: pass the reader\'s').toEqual([]);
  });

  it('no Dutch sentence writes the English form of a name Dutch writes its own way', () => {
    const found: string[] = [];
    for (const [key, sentence] of Object.entries(STRINGS.nl)) {
      for (const name of englishNamesSaying(sentence)) found.push(`${key}: ${name}`);
    }
    expect(found, 'these Dutch strings write a name the English way').toEqual([]);
  });

  it('no Dutch guide writes the English form of a name Dutch writes its own way', () => {
    const dir = join(ROOT, 'docs', 'guides', 'nl');
    const guides = readdirSync(dir).filter((name) => name.endsWith('.md'));
    expect(guides, 'the Dutch guides were not found').toContain('google.md');
    const found: string[] = [];
    for (const guide of guides) {
      readFileSync(join(dir, guide), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const name of englishNamesSaying(line)) found.push(`docs/guides/nl/${guide}:${i + 1}: ${name}`);
        });
    }
    expect(found, 'these lines of a Dutch guide write a name the English way').toEqual([]);
  });
});

/** The English names, of those Dutch writes its own way, that a Dutch text writes. */
function englishNamesSaying(text: string): string[] {
  const english = providerTypesWithDutchNames().map((type) =>
    // `Apple account (iCloud)` is written *Apple account* in a sentence.
    providerDisplayName(type, 'en').replace(/ \(.*\)$/, ''),
  );
  if (!english.includes('Google account')) throw new Error('the English names were not read');
  return english.filter((name) =>
    // An API's own name is a name: *Google Contacts CardDAV API*.
    new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?! (?:CardDAV )?API)`, 'i').test(text),
  );
}
