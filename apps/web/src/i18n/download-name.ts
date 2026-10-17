// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE NAME A DOWNLOAD IS SAVED UNDER (the UX sweep).
 *
 * The completion report was saved as `completion-report-<uuid>.md`, the
 * permission list as `permissions-<uuid>.md` and the confirmed list as
 * `confirmed-<uuid>.csv`: English, whatever the screen's language, and named
 * by an id nobody can tell apart in a downloads folder. Each is now named
 * for what it is, in the reader's language, the migration's own name, and
 * the day: *Ownpace-rapport - Goog2NC - 2026-10-17.md*, as the invoice is
 * *Ownpace-invoice-2026-0001.pdf*.
 *
 * The name comes from the query the bar above every migration screen
 * already holds (`Layout`, under the same key), read when the button is
 * pressed rather than on every screen that shows one. Where none is known
 * (the appliance, whose id is the name somebody chose; a screen drawn without
 * a query cache; a read that failed) the file keeps the name it had.
 */
import React from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { mappingApi } from '../services/mapping-service.ts';
import { mappingDetailKey } from '../services/mapping-cache.ts';
import { isSelfHost } from '../services/edition.ts';

/** The characters Windows, macOS or Linux refuse in a file name. */
const NOT_IN_A_FILE_NAME = /[\\/:*?"<>|]/g;

/** `<prefix> - <migration> - <yyyy-mm-dd>.<ext>`, with what a file name cannot carry left out. */
export function downloadName(prefix: string, migrationName: string, isoDate: string, ext: string): string {
  return `${prefix} - ${migrationName} - ${isoDate}`
    .replace(NOT_IN_A_FILE_NAME, '')
    .replace(/\s+/g, ' ')
    .trim()
    .concat(`.${ext}`);
}

/** The reader's own calendar day, as `yyyy-mm-dd`: the day they saved it. */
export function localIsoDate(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

/**
 * A function the press awaits: the readable name for this migration's file,
 * starting with `prefix` (the document's word in the reader's language,
 * `download.*`), or `undefined` where no name is known, and the caller keeps
 * its own.
 */
export function useDownloadName(): (
  mappingId: string | undefined,
  prefix: string,
  ext: string,
) => Promise<string | undefined> {
  // The app always has its query cache; a screen drawn without one, which
  // only a test does, has nowhere to read the name from.
  const cache = React.useContext(QueryClientContext);
  return React.useCallback(
    async (mappingId, prefix, ext) => {
      if (mappingId === undefined || cache === undefined || isSelfHost()) return undefined;
      let name: string | undefined;
      try {
        const mapping = await cache.fetchQuery({
          queryKey: mappingDetailKey(mappingId),
          queryFn: () => mappingApi.get(mappingId),
          staleTime: 60_000,
          retry: false,
        });
        name = mapping.name.trim();
      } catch {
        // A name that could not be read is not a reason to withhold the file.
        return undefined;
      }
      return name ? downloadName(prefix, name, localIsoDate(new Date()), ext) : undefined;
    },
    [cache],
  );
}
