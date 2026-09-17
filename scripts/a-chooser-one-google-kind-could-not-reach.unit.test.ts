// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SOURCE WHOSE FILES COME OUT OF GOOGLE DRIVE AND CANNOT CHOOSE THEIR EXPORT
 * LEAVES EVERY DOC BEHIND, SILENTLY.
 *
 * THE DEFECT, from the owner's first real migration (2026-09-17). 7,480 items,
 * and every Google Doc and Drawing among them left behind — each one recorded
 * as refused under `nativeFilePolicy="refuse"`, the default. His words: *"i
 * didnt find any options to pick what export format i want to get in my target
 * from the google propiritory formats."*
 *
 * There was nothing to find. The chooser rendered beside the `rootFolderId`
 * box, and only the legacy `google-drive` source type has that field. He had
 * migrated through the `google` ACCOUNT kind — Connect with Google, one address
 * and one consent — whose file face is `ACCOUNT_FACE_BUILDERS.google.file`:
 * the same Drive connector, reading the same policy out of the same blob.
 *
 * So the setting existed, the engine read it, the create door stored it, and
 * the only screen that could set it was reachable from one of the two doors
 * that lead there. **A default nobody was offered a way out of is not a
 * default; it is a decision made on their behalf and not told to them.**
 *
 * ## Why a guard, and why this shape
 *
 * The fix makes the wizard ask a product question — *does this source carry
 * Google-native files* — instead of noticing a field. That is
 * `GOOGLE_NATIVE_FILE_SOURCE_TYPES` in
 * `packages/shared/src/google-native-coverage.ts`, and a list in shared is a
 * list somebody has to remember to extend. The authority on the same question
 * already exists one package over: the face tables in
 * `packages/orchestration/src/source-face-builders.ts`, which decide which
 * builder speaks for a connection's file face. This holds the first against
 * the second.
 *
 * Both directions, because they fail differently. **A Drive-backed kind missing
 * from the list** is the owner's bug again, on whichever kind arrives next.
 * **A kind in the list with no Drive file face** is a chooser offered for files
 * that will never be exported, which is a promise the connector cannot keep.
 *
 * ## Why the table is read as TEXT
 *
 * The same reason the `a-face-a-provider-account-cannot-build` guard beside it
 * gives: two packages, and what is being compared is a table literal. Importing the
 * orchestration index to reach it would prove the import resolves. The kind
 * CONSTANTS the table is keyed by are resolved from the factory files that
 * export them, so nothing here is a second copy of a kind string.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GOOGLE_NATIVE_FILE_SOURCE_TYPES,
  carriesGoogleNativeFiles,
  credentialFieldsFor,
  wizardTypeForConnectionKind,
} from '@openmig/shared';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORCHESTRATION_SRC = join(REPO_ROOT, 'packages/orchestration/src');
const BUILDERS = 'source-face-builders.ts';

/**
 * The file with its comments removed — a comment is prose about code, never
 * code. This table's own prose names builders it does NOT use for a face
 * ("Soverin's `task` is the calendar builder"), and read raw a matcher finds
 * those and reports a disagreement that does not exist.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/** Every `export const X_CONNECTION_KIND = 'y'` the orchestration package has. */
function kindConstants(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of readdirSync(ORCHESTRATION_SRC)) {
    if (!file.endsWith('.ts') || file.includes('.test.')) continue;
    const text = readFileSync(join(ORCHESTRATION_SRC, file), 'utf8');
    for (const m of text.matchAll(/export const (\w+_CONNECTION_KIND) = '([^']+)'/g)) {
      out.set(m[1]!, m[2]!);
    }
  }
  return out;
}

/**
 * The connection kinds whose FILE face is the Drive builder, as the engine's
 * own tables write them — `google: { … file: 'google-drive' }` for an account
 * row, `[GOOGLE_DRIVE_CONNECTION_KIND]: { file: 'google-drive' }` for a
 * single-purpose one.
 */
function kindsWhoseFilesComeFromDrive(): string[] {
  const text = code(readFileSync(join(ORCHESTRATION_SRC, BUILDERS), 'utf8'));
  const constants = kindConstants();
  const kinds: string[] = [];
  for (const row of text.matchAll(/(\[?\w+\]?):\s*\{([^{}]*)\}/g)) {
    const [, key, faces] = row;
    if (!/\bfile:\s*'google-drive'/.test(faces!)) continue;
    const token = key!;
    if (!token.startsWith('[')) {
      kinds.push(token);
      continue;
    }
    const name = token.slice(1, -1);
    const value = constants.get(name);
    expect(
      value,
      `${BUILDERS} keys a Drive-backed row by ${name}, and no orchestration module ` +
        'exports a connection kind of that name — this guard cannot tell which kind it is',
    ).toBeDefined();
    kinds.push(value!);
  }
  return [...new Set(kinds)];
}

describe('every source whose files come from Drive can choose its export', () => {
  it('finds the engine’s Drive-backed rows at all', () => {
    // A regex that matched nothing would make the comparison below pass by
    // agreeing about an empty world.
    const kinds = kindsWhoseFilesComeFromDrive();
    expect(
      kinds.length,
      'the account kind and the single-purpose row are both Drive-backed; finding fewer ' +
        `than two means the shape of ${BUILDERS} moved and this guard stopped reading it`,
    ).toBeGreaterThanOrEqual(2);
  });

  it('names exactly those kinds in the list the chooser is keyed on', () => {
    const fromEngine = kindsWhoseFilesComeFromDrive().map(wizardTypeForConnectionKind).sort();
    expect(
      fromEngine,
      'A kind here that the list omits is the owner’s bug of 2026-09-17 on a new door: its ' +
        'Docs are left behind under the `refuse` default with no screen able to say otherwise. ' +
        'A type in the list with no Drive face is a chooser for an export that never happens. ' +
        'Add the wizard source type to GOOGLE_NATIVE_FILE_SOURCE_TYPES in ' +
        'packages/shared/src/google-native-coverage.ts, or take it out.',
    ).toEqual([...GOOGLE_NATIVE_FILE_SOURCE_TYPES].sort());
  });

  it('names types the wizard has a door for', () => {
    // A wizard source type is one `credentialFieldsFor` answers for; a word
    // that is not one would put the chooser on a screen nobody can reach,
    // which is the defect this file exists about, spelled differently.
    for (const type of GOOGLE_NATIVE_FILE_SOURCE_TYPES) {
      expect(carriesGoogleNativeFiles(type)).toBe(true);
      expect(
        credentialFieldsFor('source', type).length,
        `${type} is offered the export chooser and is not a source type the wizard asks fields for`,
      ).toBeGreaterThan(0);
    }
  });
});
