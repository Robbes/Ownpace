// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FILE LISTING UNDER A WINDOW (workplan 0170 §4.2), for the file sources
 * whose provider cannot filter by date on the server: OneDrive, Dropbox, Box,
 * WebDAV and the export archive.
 *
 * Their listing is made in full, as it always was, and split here: what
 * `fileInWindow` holds stays in `items`, the rest goes back as `unmarked`,
 * the field a selection's set-aside items travel in (`FileSource.listSince`).
 * Handed back rather than dropped, so the sync loop still knows every file
 * the source holds (`setAsideKeys`): a file older than the window is never
 * taken for a deleted one.
 *
 * The loop checks every item itself (§3.2 1), so this saves nothing the loop
 * would have spent. What it buys is a source that knows which of its own
 * items it showed, which is what a cursor built from `items` (WebDAV's etag
 * map) has to know to never claim an older file was seen.
 */

import type { RawFileItem } from '@openmig/shared';
import { fileInWindow } from '@openmig/shared';

/**
 * `listed` split by the window starting at `since`; unchanged without one.
 *
 * `unmarked` is present only when it holds something, as everywhere else on
 * the port, so a listing with no window reads exactly as it always did.
 */
export function splitByWindow(
  listed: ReadonlyArray<RawFileItem>,
  since: Date | undefined,
): { items: RawFileItem[]; unmarked?: RawFileItem[] } {
  if (since === undefined) return { items: [...listed] };
  const items: RawFileItem[] = [];
  const unmarked: RawFileItem[] = [];
  for (const raw of listed) (fileInWindow(raw.item, since) ? items : unmarked).push(raw);
  return unmarked.length > 0 ? { items, unmarked } : { items };
}
