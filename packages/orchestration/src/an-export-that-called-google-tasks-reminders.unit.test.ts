// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN EXPORT THAT CALLED GOOGLE'S TASKS "REMINDERS" (workplan 0126 T4).
 *
 * An archive connection says, face by face, that it carries files and photos
 * and that the rest is migrated from the account itself, live. For tasks it
 * used Apple's word, "reminders", whichever export it was. On a Google
 * Takeout that named something Google does not have, and until 0126 T2 the
 * "migrated live instead" half was not true of Google's tasks either.
 */

import { describe, it, expect } from 'vitest';
import { qualifyArchive } from './account-qualification.ts';

/** The face sentences do not depend on the archive opening, so no archive is needed. */
const taskDetail = async (provider: string) =>
  (await qualifyArchive('archive', { type: 'archive', provider, path: '/nowhere/export' }))!.domains
    .task.detail;

describe("an export names the provider's tasks in the provider's word", () => {
  it('a Google Takeout says tasks', async () => {
    const detail = await taskDetail('google-takeout');
    expect(detail).toContain('so tasks is not carried');
    expect(detail).not.toContain('reminders');
  });

  it('an Apple export still says reminders', async () => {
    expect(await taskDetail('apple-privacy')).toContain('so reminders is not carried');
  });
});
