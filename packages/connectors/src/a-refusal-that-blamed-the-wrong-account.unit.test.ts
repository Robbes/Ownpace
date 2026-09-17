// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * GOOGLE REFUSED TO GIVE, AND THE QUEUE SAID THE DESTINATION WOULD NOT TAKE
 * (found live 2026-09-17, workplan 0042).
 *
 * The owner ran the export measurement over his Drive and one Slides deck
 * could not be weighed. The reason, in full, was Google's:
 *
 *   "This file cannot be exported by the user."   reason: cannotExportFile
 *
 * Three things were wrong with what a customer would have been told, and only
 * the first is about formatting.
 *
 * 1. **The envelope.** Fourteen lines of JSON around nine words, into a
 *    failures queue read on a phone. `dav-refusal.ts` and `graph-refusal.ts`
 *    had each met this and fixed it for their provider; Drive had nothing.
 *
 * 2. **The remedy named the wrong account.** `classifyFailure` sees a 403 and
 *    the word "refused" and answers `target_refused`, whose sentence is *"The
 *    destination refused to accept this. Common causes are a full mailbox, a
 *    read-only folder or missing permission on the target account."* Google
 *    refused to export; the destination never saw the file. A customer
 *    following that goes and audits Nextcloud for a problem that is entirely
 *    in Drive. Until the category vocabulary grows a source-side answer, the
 *    line itself has to say so.
 *
 * 3. **It was retried.** `cannotExportFile` cannot succeed on a second
 *    attempt, or a fifth. Unmarked, it rode the automatic lane, so an item
 *    that needed a person sat looking busy.
 */

import { describe, expect, it } from 'vitest';
import { classifyFailure } from '@openmig/shared';
import { driveFailure, driveRefusalBody, driveRefusalHint, isDriveDecision } from './drive-refusal.ts';

/** Exactly what Drive answered on 2026-09-17, whitespace and all. */
const CANNOT_EXPORT = `{
  "error": {
    "code": 403,
    "message": "This file cannot be exported by the user.",
    "errors": [
      {
        "message": "This file cannot be exported by the user.",
        "domain": "global",
        "reason": "cannotExportFile"
      }
    ]
  }
}`;

describe('the envelope goes and Google\'s words stay', () => {
  it('reads the reason out of errors[0], where Google puts the actionable half', () => {
    // Graph puts a string code at `error.code`; Google puts an HTTP number
    // there and the reason one level down. A reader written for one shape
    // finds nothing in the other, which is why this is a sibling module.
    expect(driveRefusalBody(CANNOT_EXPORT)).toBe(
      'cannotExportFile — This file cannot be exported by the user.',
    );
  });

  it('passes anything that is not a Drive error document through untouched', () => {
    // An HTML error page from a proxy, a plain string, an empty body. The
    // rule is to remove an envelope, never to replace a body we did not
    // recognise with one we invented.
    for (const body of ['<html>502 Bad Gateway</html>', 'upstream timed out', '', '{']) {
      expect(driveRefusalBody(body)).toBe(body);
    }
  });

  it('unwraps a document that carries a message but no reason array', () => {
    expect(driveRefusalBody('{"error":{"code":500,"message":"Internal Error"}}')).toBe(
      'Internal Error',
    );
  });
});

describe('the way out, for the reasons where one is knowable', () => {
  it('names both causes and says no policy change helps', () => {
    const hint = driveRefusalHint(CANNOT_EXPORT);
    expect(hint).toContain('turned off download, copy and print');
    expect(hint).toContain('No export policy changes either');
    expect(hint).toContain('open it in Drive');
  });

  it('says NOTHING for a reason nobody here has seen', () => {
    // The honest answer, and the one that keeps this module from becoming the
    // defect it fixes. Google's own sentence is already in the line; inventing
    // advice for an unmet refusal is how a message comes to name a wrong cause.
    expect(driveRefusalHint('{"error":{"code":403,"errors":[{"reason":"somethingNew"}]}}')).toBe('');
    expect(driveRefusalHint('not a document at all')).toBe('');
  });
});

describe('an answer parks; weather retries', () => {
  it('parks the reason observed live', () => {
    expect(isDriveDecision(CANNOT_EXPORT)).toBe(true);
  });

  it('parks the other permanent reasons Google documents', () => {
    for (const reason of [
      'exportSizeLimitExceeded',
      'fileNotDownloadable',
      'insufficientFilePermissions',
      'appNotAuthorizedToFile',
    ]) {
      expect(isDriveDecision(`{"error":{"errors":[{"reason":"${reason}"}]}}`), reason).toBe(true);
    }
  });

  it('does NOT park a rate limit, which is weather and passes', () => {
    // The safe direction of the two: retrying something permanent wastes a
    // little, parking something transient strands an item that would have
    // succeeded on its own.
    for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded', 'backendError']) {
      expect(isDriveDecision(`{"error":{"errors":[{"reason":"${reason}"}]}}`), reason).toBe(false);
    }
    expect(isDriveDecision('econnreset')).toBe(false);
  });
});

describe('the line a customer actually reads', () => {
  const line = driveFailure('Drive refused the download of "Survey Results"', {
    status: 403,
    body: CANNOT_EXPORT,
  });

  it('carries no JSON at all', () => {
    expect(line).not.toContain('{');
    expect(line).not.toContain('"domain"');
  });

  it('says the destination never saw it, because the category says otherwise', () => {
    // The correction that matters. Asserted TOGETHER with the category below,
    // so that if a source-side category ever lands and this sentence becomes
    // redundant, whoever removes it meets the reason it was here.
    expect(line).toContain('Nothing was sent to the destination for this item.');
  });

  it('is still classified target_refused, which is why the sentence is needed', () => {
    // Not an assertion that this is RIGHT — it is an assertion that it is the
    // state of things, so the correcting sentence above cannot be dropped
    // while the classifier still answers this way.
    expect(
      classifyFailure(line),
      'the classifier no longer reads this as a target refusal — if a source-side category ' +
        'landed, the "Nothing was sent" sentence in driveFailure can go, and this test with it',
    ).toBe('target_refused');
  });

  it('reads as one sentence a person can act on', () => {
    expect(line).toBe(
      'Drive refused the download of "Survey Results" (403): cannotExportFile — This file ' +
        'cannot be exported by the user. Nothing was sent to the destination for this item. ' +
        'Google will not export this particular file for this account. The usual cause is the ' +
        "file's owner having turned off download, copy and print for the people they share " +
        'with; a file Drive cannot render is the other. No export policy changes either — ask ' +
        'the owner to allow downloads, or open it in Drive and save a copy yourself.',
    );
  });
});
