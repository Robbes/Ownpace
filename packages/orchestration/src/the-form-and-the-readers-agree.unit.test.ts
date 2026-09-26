// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE FORM AND THE READERS AGREE (workplan 0148 T3, D7).
 *
 * The archive form tags an export it cannot read yet with *To be tested* and
 * a line that says so. The form lives in the web app and reads
 * `@openmig/shared`; the readers live here, in `READERS`, and shared cannot
 * import orchestration. So the list of exports a reader exists for is written
 * down in shared, `ARCHIVE_PROVIDERS_WITH_READERS`, and this file is what
 * keeps that copy honest.
 *
 * Both directions matter, and neither fails anywhere else:
 *
 * - **A reader lands and the list is not told.** The Apple option keeps its
 *   tag and its line, *"We cannot read an Apple export yet"*, beside a Test
 *   that now reads it.
 * - **The list names an export `READERS` does not open.** The tag goes, and
 *   the person asks Apple for a week-long export that Test and the pass then
 *   refuse as a wiring gap. That is the finding D7 answers.
 *
 * `archiveProvidersWithReaders()` stays, reading `READERS` as it did: it is
 * the orchestration side's own statement of the fact, and this file holds the
 * two equal rather than making one of them read the other.
 */

import { describe, it, expect } from 'vitest';
import { ARCHIVE_PROVIDERS, ARCHIVE_PROVIDERS_WITH_READERS } from '@openmig/shared';
import { archiveProvidersWithReaders, archiveReaderFor } from './archive-source-factory.ts';

describe('the exports the form calls readable are the exports READERS opens', () => {
  it('names the same exports, in the vocabulary order', () => {
    expect([...ARCHIVE_PROVIDERS_WITH_READERS]).toEqual([...archiveProvidersWithReaders()]);
  });

  it('agrees export by export: listed exactly where a reader is built', () => {
    const disagree = ARCHIVE_PROVIDERS.filter(
      (p) => ARCHIVE_PROVIDERS_WITH_READERS.includes(p) !== (archiveReaderFor(p) !== undefined),
    );
    expect(disagree, 'exports the shared list and READERS disagree about').toEqual([]);
  });
});
