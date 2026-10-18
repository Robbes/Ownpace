// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * What the check found, in the reader's words (the owner, 2026-10-18).
 *
 * A Dutch screen read `NOT_VERIFIABLE` beside *Geverifieerd*, and *ERROR
 * PROPFIND on / failed with 401 Unauthorized* under *Problemen*. The owner's
 * answer: the client's word on the screen, and the server's token kept where
 * somebody can still quote it in a support thread — in the title, under
 * *Technical details*, and in every download, which this does not touch.
 *
 * One map for the verdicts, read by Verify and by Finish's step 1, so the two
 * screens cannot say the same verdict in two ways. Total records: a sixth
 * verdict or a third severity is a compile error here, not a token on screen.
 */

import type { DataTypeVerification, DataTypeVerificationStatus } from '@openmig/shared';
import type { StringKey } from './strings.ts';

export const VERDICT_KEY: Readonly<Record<DataTypeVerificationStatus, StringKey>> = {
  PASS: 'verify.verdict.PASS',
  WARN: 'verify.verdict.WARN',
  FAIL: 'verify.verdict.FAIL',
  SKIPPED: 'verify.verdict.SKIPPED',
  NOT_VERIFIABLE: 'verify.verdict.NOT_VERIFIABLE',
};

type Issue = DataTypeVerification['issues'][number];

export const SEVERITY_KEY: Readonly<Record<Issue['severity'], StringKey>> = {
  ERROR: 'verify.severity.ERROR',
  WARNING: 'verify.severity.WARNING',
};

/**
 * The client's sentence for a finding it knows by its id, or `null`, which
 * keeps the server's text: nothing found is dropped for want of a sentence.
 *
 * The ids are the ones `runVerification` writes (`packages/core/src/
 * verification.ts`), each `<prefix>_<dataType>`, matched whole: the prefix
 * `CHECKSUM` alone would also catch `CHECKSUM_UNAVAILABLE_…`, which says
 * something else. `Verify.unit.test.tsx` reads that file for each one.
 *
 * `{type}` is filled by the caller, with the data type's own word; `{n}` is
 * the count as the report holds it, for the caller to say in the reader's
 * digits.
 */
export function issueSentence(
  issue: Issue,
  d: DataTypeVerification,
): { key: StringKey; n?: number } | null {
  const is = (prefix: string) => issue.id === `${prefix}_${d.dataType}`;
  if (is('TARGET_FOLDER_MISSING')) return { key: 'verify.issue.folderMissing' };
  if (is('TARGET_UNREAD')) return { key: 'verify.issue.targetUnread' };
  if (is('MISSING') && d.missingOnTarget > 0) return { key: 'verify.issue.missing', n: d.missingOnTarget };
  if (is('CHECKSUM') && d.checksumMismatches > 0) {
    return { key: 'verify.issue.checksum', n: d.checksumMismatches };
  }
  return null;
}
