// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * An empty target handle must never widen into "delete the container".
 *
 * Every DAV writer turns its `targetId` into a URL with `buildUrl(targetId)`,
 * and `buildUrl('')` is the COLLECTION. So an empty handle did not fail — it
 * aimed the DELETE at the whole calendar, address book or folder, and applying
 * a single deletion would have removed the container and everything in it.
 *
 * This was reachable, not theoretical. `PgLedger` stored `target_ref`
 * double-encoded, `mapRowToRecord` therefore read `undefined` and handed `''`
 * to its callers, and `apply-deletion.ts` passes that value straight into
 * `removeItem`. The storage bug is fixed and migration 0027 repairs the rows,
 * but the guard belongs here independently: a handle we do not have is not
 * permission to delete the thing that contains it (ADR-0024, hard rule 2).
 */

import { describe, it, expect } from 'vitest';
import { assertRemovableTargetId } from './dav-remove.ts';

describe('assertRemovableTargetId', () => {
  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['a tab', '\t'],
  ])('refuses %s — that URL would be the collection', (_label, id) => {
    expect(() => assertRemovableTargetId(id, 'this item')).toThrow(/no target handle/i);
  });

  it('says nothing was changed, because nothing was', () => {
    // A refusal that leaves the reader wondering whether it half-happened is
    // worse than the error it reports.
    expect(() => assertRemovableTargetId('', 'this item')).toThrow(/Nothing was changed/);
  });

  it('allows a real handle through', () => {
    expect(() =>
      assertRemovableTargetId('/dav/calendars/u/personal/x.ics', 'this item'),
    ).not.toThrow();
  });
});

describe('every DAV writer guards its own removeItem', () => {
  // Three writers, three chances to forget. Asserted by reading the sources
  // rather than by exercising each against a fake server: what matters is that
  // the guard is on the path, and a writer added later without it should fail
  // this rather than ship.
  const files = ['caldav-target-writer.ts', 'carddav-target-writer.ts', 'webdav-target-writer.ts'];

  it.each(files)('%s calls the guard before building a URL', async (name) => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), name), 'utf8');
    const removeItem = src.slice(src.indexOf('async removeItem('));
    const body = removeItem.slice(0, removeItem.indexOf('\n  }'));
    expect(body).toContain('assertRemovableTargetId');
    // Before buildUrl, not after — the point is that no URL is ever formed.
    expect(body.indexOf('assertRemovableTargetId')).toBeLessThan(body.indexOf('buildUrl'));
  });
});
