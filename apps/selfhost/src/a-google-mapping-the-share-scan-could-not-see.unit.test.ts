// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GOOGLE MAPPING THE SHARE SCAN COULD NOT SEE.
 *
 * The managed route's half of this (the owner's live run, 2026-09-17) was a
 * lookup asking for a `connection.kind` the column cannot hold. The appliance
 * has no connection table — it reads mapping FILES, whose `source.type` is the
 * wizard vocabulary — so its version of the defect is narrower and just as
 * quiet: it tested
 *
 *     m.config.source.type === 'google-drive'
 *
 * and a mapping written against the `google` ACCOUNT kind, which `parseSource`
 * has accepted since workplan 0106 T3b, is not that string. Its outbound shares
 * became a blind spot, and the Sharing section printed a Graph-worded reason to
 * somebody who has never had an Entra registration.
 *
 * ## What this pins, and what it does not
 *
 * That the appliance asks the SHARED predicate. `carriesGoogleNativeFiles` is
 * one list with one guard over it
 * (`scripts/a-chooser-one-google-kind-could-not-reach.unit.test.ts` holds it
 * against the face table), so a kind that gains a Drive face is answered here
 * on the day that table says so — but only for a caller that asks the list
 * rather than a literal. A second literal is how the export chooser (#988) and
 * then the Sharing page both went wrong, in that order, three weeks apart.
 *
 * Read as text rather than started as a server, for the reason
 * `a-button-only-one-edition-answers.unit.test.ts` gives: booting the appliance
 * needs a database, a config directory and a scheduler, and the thing under
 * test is which question one line asks.
 *
 * It does NOT claim the appliance can MIGRATE files from a `google` mapping —
 * `build-deps.ts` still branches on `google-drive` for the file face, an
 * edition gap #988 recorded. Reading the outbound shares needs only the Drive
 * credentials this deployment already holds in its environment, so the scan is
 * answerable either way, and a blind spot nobody asked for is worse than a
 * section that is right.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { carriesGoogleNativeFiles } from '@openmig/shared';

const SOURCE = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf8');

describe('the appliance detects a Google files source through the shared list', () => {
  it('asks carriesGoogleNativeFiles about the mapping source type', () => {
    expect(
      SOURCE,
      'the appliance no longer asks the shared list which source types carry Google ' +
        'files. Whatever replaced it is a second answer to a question that has one.',
    ).toContain('carriesGoogleNativeFiles(m.config.source.type)');
  });

  it('does not decide it with a literal instead', () => {
    expect(
      SOURCE.includes("source.type === 'google-drive'"),
      "the appliance compares a mapping's source type to 'google-drive' directly. That " +
        'misses the `google` account kind, whose file face IS the Drive connector — which ' +
        'is exactly how its shares became a blind spot on both editions.',
    ).toBe(false);
  });

  it('is not passing vacuously — it read the appliance', () => {
    expect(SOURCE).toContain('scanDrive');
    expect(SOURCE).toContain('hasGoogleDriveSource');
    expect(SOURCE.length).toBeGreaterThan(10_000);
  });

  it('and the list it asks answers for both Google source types', () => {
    // The wizard vocabulary here, not the connection kinds: a mapping file
    // says `"type": "google-drive"`, and the underscored spelling belongs to
    // the managed column alone.
    expect(carriesGoogleNativeFiles('google')).toBe(true);
    expect(carriesGoogleNativeFiles('google-drive')).toBe(true);
    expect(carriesGoogleNativeFiles('dropbox')).toBe(false);
  });
});
