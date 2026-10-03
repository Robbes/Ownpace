// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TARGET FOLDER THAT WAS DELETED (workplan 0156 T2).
 *
 * The owner deleted the files target folder of *MS-2-NC*, `/Microsoft-Rhb`, on
 * Nextcloud, and pressed *Voer de verificatie uit*. The answer was *"De
 * verificatie is niet voltooid. PROPFIND on / failed with status 404 …"*, and
 * no data type had a verdict, mail and calendars included: `runVerification`
 * measured the types one after another and caught nothing between them, so
 * the first listing that threw ended the run.
 *
 * What is true instead, and pinned here:
 *
 * - the folder's 404 is a FINDING: files FAIL with every recorded item
 *   missing, an issue naming the folder, and advice that restores it rather
 *   than "Re-sync", which would copy nothing back;
 * - any other listing failure makes ITS data type NOT_VERIFIABLE, the error
 *   quoted, and the cutover held;
 * - the other data types are verified either way;
 * - a closed organisation still ends the run (0139 T7).
 */

import { describe, it, expect } from 'vitest';
import {
  asTenantId,
  asMappingId,
  naturalKeyHash,
  fileNaturalKeyHash,
  isCredentialRefusal,
  TargetFolderMissingError,
  type LedgerVerificationReader,
  type TargetReindexer,
  type TargetEntry,
} from '@openmig/shared';
import { runVerification } from './verification.ts';
import { createRealVerificationDeps } from './verification-implementations.ts';

const TENANT = asTenantId('0156b000-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('0156b000-e29b-41d4-a716-446655440002' as never);

const MAIL_IDS = ['m1@example.com', 'm2@example.com'];
const FILES = ['Documents/report.pdf', 'photo.jpg', 'notes.txt'];

/** The ledger: two mails and three files recorded as copied. */
function ledgerReader(): LedgerVerificationReader {
  const byDomain: Record<string, string[]> = {
    email: MAIL_IDS.map((id) => naturalKeyHash(id)),
    calendar: [],
    contact: [],
    file: FILES.map((p) => fileNaturalKeyHash(p)),
  };
  return {
    countItems: async (_t: unknown, _m: unknown, domain: string) => byDomain[domain]!.length,
    totalSizeBytes: async () => 100,
    getAllNaturalKeyHashes: async (_t: unknown, _m: unknown, domain: string) => byDomain[domain]!,
    getSamples: async () => [],
  } as unknown as LedgerVerificationReader;
}

const mailReindexer = (): TargetReindexer =>
  ({
    async *listEntries(): AsyncIterable<TargetEntry> {
      for (const [i, id] of MAIL_IDS.entries()) {
        yield { naturalKey: id, targetId: `t${i}`, mailboxId: 'INBOX' };
      }
    },
  }) as unknown as TargetReindexer;

/** A files target whose listing throws `thrown`, as the WebDAV writer's does. */
const throwingReindexer = (thrown: unknown): TargetReindexer =>
  ({
    // eslint-disable-next-line require-yield -- a listing that fails before its first entry
    async *listEntries(): AsyncIterable<TargetEntry> {
      throw thrown;
    },
  }) as unknown as TargetReindexer;

function deps(files: TargetReindexer, organisationIsOpen?: () => Promise<boolean>) {
  return createRealVerificationDeps({
    tenantId: TENANT,
    mappingId: MAPPING,
    config: {
      checksumSamplePercentage: 5,
      minSampleSize: 10,
      maxSampleSize: 1000,
      requiredMatchPercentage: 0.99,
      maxDiscrepancyPercentage: 0.01,
      verifyMail: true,
      verifyCalendar: false,
      verifyContacts: false,
      verifyFiles: true,
      verifyTasks: false,
    },
    verificationReader: ledgerReader(),
    targetReindexers: { mail: mailReindexer(), files },
    ...(organisationIsOpen ? { organisationIsOpen } : {}),
  });
}

/** What the WebDAV writer throws for a 404 on its own folder. */
const folderGone = () =>
  new TargetFolderMissingError(
    '/Microsoft-Rhb',
    'PROPFIND on / failed with status 404: Sabre\\DAV\\Exception\\NotFound — File with name ' +
      '/Microsoft-Rhb could not be located',
  );

describe('the files target folder was deleted', () => {
  it('still verifies mail: one data type does not end the run', async () => {
    const result = await runVerification(deps(throwingReindexer(folderGone())));

    expect(result.mail.status).toBe('PASS');
    expect(result.mail.targetCount).toBe(2);
  });

  it('reports files as the finding it is: every copied file missing, the folder named', async () => {
    const result = await runVerification(deps(throwingReindexer(folderGone())));

    expect(result.files.status).toBe('FAIL');
    expect(result.files.sourceCount).toBe(3);
    expect(result.files.missingOnTarget).toBe(3);
    expect(result.files.targetCount).toBe(0);
    const issue = result.files.issues.find((i) => i.id === 'TARGET_FOLDER_MISSING_files');
    expect(issue?.severity).toBe('ERROR');
    expect(issue?.message).toContain('/Microsoft-Rhb');
    expect(issue?.message).toContain('3 files item(s)');
    // And the cutover is held: nothing that was copied is where it was put.
    expect(result.overallStatus).toBe('FAIL');
    expect(result.canProceedToCutover).toBe(false);
  });

  it('advises restoring the folder, not a re-sync that would copy nothing back', async () => {
    const result = await runVerification(deps(throwingReindexer(folderGone())));

    expect(result.recommendations.some((r) => r.includes('Restore the files folder'))).toBe(true);
    // A pass skips every item the ledger records as copied
    // (`webdav-target-writer.ts`, the ledger fast-path).
    expect(result.recommendations.some((r) => r.startsWith('Re-sync'))).toBe(false);
  });
});

describe('a files target that could not be read for any other reason', () => {
  it('is NOT_VERIFIABLE with the error quoted, and mail is still verified', async () => {
    const result = await runVerification(
      deps(throwingReindexer(new Error('PROPFIND on / failed with status 401: Unauthorized'))),
    );

    expect(result.mail.status).toBe('PASS');
    expect(result.files.status).toBe('NOT_VERIFIABLE');
    expect(result.files.sourceCount).toBe(3);
    const issue = result.files.issues.find((i) => i.id === 'TARGET_UNREAD_files');
    expect(issue?.message).toContain('failed with status 401');
    expect(result.canProceedToCutover).toBe(false);
    // Its advice is about the answer, not about a reader that does not exist.
    const advice = result.recommendations.find((r) => r.startsWith('Cannot verify files'));
    expect(advice).toContain('did not answer');
    expect(advice).not.toContain('reindexer');
  });
});

describe('a closed organisation', () => {
  it('still ends the run, read by nobody (0139 T7)', async () => {
    const thrown = await runVerification(
      deps(throwingReindexer(folderGone()), async () => false),
    ).then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(isCredentialRefusal(thrown), String(thrown)).toBe(true);
  });
});
