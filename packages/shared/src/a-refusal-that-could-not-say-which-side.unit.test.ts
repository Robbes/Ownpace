// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A REFUSAL THAT COULD NOT SAY WHICH SIDE (owner's go-ahead, 2026-09-17).
 *
 * A live Drive refusal — `cannotExportFile`, a Doc whose owner had turned off
 * downloading — reached a customer as `target_refused`, whose remedy is *"The
 * destination refused to accept this. Common causes are a full mailbox, a
 * read-only folder or missing permission on the target account."* Nothing had
 * been sent to the destination. The remedy sent somebody to audit an account
 * that had never seen the file, and a wrong remedy is worse than `unknown`,
 * which at least says it does not know.
 *
 * The owner added the second half on the same day: *"it also makes sense a
 * target might refuse certain fileformats/types and we need to be transparrant
 * about that."*
 *
 * ## Why this is not more regex
 *
 * A source refusal and a target one read IDENTICALLY in prose — a 403 is a
 * 403, `Forbidden` is `Forbidden`. No wording distinguishes them, so matching
 * harder could not have found this and would only have invented a signal.
 *
 * The pass already knew. `sided()` tags whatever `fetchRaw` throws as `source`
 * and whatever `upsert` throws as `target`, at the closure, and `markFailed`
 * receives that tag and the message in the SAME call. So the answer was one
 * argument away the whole time, sitting in a column the screens were already
 * showing beside the wrong remedy.
 *
 * That is also why these two facts cannot drift: they are written by one
 * statement, from one call, and the guards below hold them to each other.
 */
import { describe, it, expect } from 'vitest';
import { FAILURE_CATEGORIES, FAILURE_SIDES, classifyFailure } from './failure-category.ts';
import type { FailureCategory, FailureSide } from './failure-category.ts';

/** The exact line the owner's Drive refusal produced, minus the provider's prose. */
const DRIVE_REFUSAL =
  'Drive refused the download of "Survey Results" (403): cannotExportFile — This file ' +
  'cannot be exported by the user.';

/** A target that would not take the write, in Sabre's shape. */
const SABRE_REFUSAL = 'PUT failed for /files/report.docx with status 403: Forbidden';

const SIDES: ReadonlyArray<FailureSide | undefined> = [undefined, 'source', 'target'];

describe('the same words, two sides, two answers', () => {
  it('a Drive export refusal is the SOURCE refusing, once the pass says so', () => {
    expect(classifyFailure(DRIVE_REFUSAL, 'source')).toBe('source_refused');
  });

  it('the identical message from the target side is the target refusing', () => {
    // The point of the whole change, in one pair of lines: nothing in the text
    // tells these apart, and the answers are opposite.
    expect(classifyFailure(DRIVE_REFUSAL, 'target')).toBe('target_refused');
    expect(classifyFailure(SABRE_REFUSAL, 'target')).toBe('target_refused');
    expect(classifyFailure(SABRE_REFUSAL, 'source')).toBe('source_refused');
  });

  it('with no side at all it answers what it always answered', () => {
    // Deliberate. `failed_side` is NULL on a pass that could not tell and on
    // every row written before the column existed; re-reading those as source
    // refusals would rewrite history on no evidence.
    expect(classifyFailure(DRIVE_REFUSAL)).toBe('target_refused');
    expect(classifyFailure(SABRE_REFUSAL)).toBe('target_refused');
  });
});

describe('the category and the side can never contradict each other', () => {
  // The hazard a second field always carries: `failed_side` and
  // `last_error_category` both say where, so a row could claim the source
  // refused it while recording that the target threw. They cannot, because
  // they are written by one statement from one call — and this is the rule
  // that keeps it that way if anybody adds a category later.
  const MESSAGES = [
    DRIVE_REFUSAL,
    SABRE_REFUSAL,
    '403 Forbidden',
    '507 insufficient storage',
    'mailbox full',
    '415 unsupported media type',
    'invalid file name',
    'invalid_grant',
    '429 too many requests',
    'daily limit exceeded',
    'ECONNREFUSED',
    'something nobody has a rule for',
  ];

  it('never answers source_refused for a failure the TARGET threw', () => {
    for (const message of MESSAGES) {
      expect(classifyFailure(message, 'target'), message).not.toBe('source_refused');
    }
  });

  it('never blames the destination for a failure the SOURCE threw', () => {
    // Both target-shaped answers, together: `format_refused` is as wrong as
    // `target_refused` when nothing was ever sent anywhere.
    const blamesTheTarget: ReadonlyArray<FailureCategory> = ['target_refused', 'format_refused'];
    for (const message of MESSAGES) {
      expect(blamesTheTarget, message).not.toContain(classifyFailure(message, 'source'));
    }
  });

  it('only refusals move with the side — everything else answers the same', () => {
    // Derived rather than listed: a rate limit is a rate limit whoever sent
    // it, and a future rule that started varying by side without meaning to
    // would be caught here rather than on a customer's screen.
    const REFUSALS: ReadonlyArray<FailureCategory> = [
      'source_refused',
      'target_refused',
      'format_refused',
    ];
    for (const message of MESSAGES) {
      const answers = SIDES.map((side) => classifyFailure(message, side));
      const varies = new Set(answers).size > 1;
      if (!varies) continue;
      for (const answer of answers) {
        expect(REFUSALS, `${message} varies by side into ${answer}`).toContain(answer);
      }
    }
  });
});

describe('the destination will not take this KIND of file', () => {
  it('reads 415 as the format, not as a full mailbox', () => {
    // RFC 9110 §15.5.16 — the one signal here that is specified rather than
    // published, which is why it anchors the rule.
    expect(classifyFailure('PUT failed with status 415', 'target')).toBe('format_refused');
    expect(classifyFailure('415 Unsupported Media Type', 'target')).toBe('format_refused');
  });

  it("reads a name the destination will not store as the format too", () => {
    expect(classifyFailure('PUT failed: Invalid file name', 'target')).toBe('format_refused');
    expect(classifyFailure('the name is a reserved word', 'target')).toBe('format_refused');
  });

  it('leaves a bare 403 alone, because there is nothing in it to read', () => {
    // Sabre answers a file-access-control refusal with a plain `Forbidden` and
    // no word about why. Guessing "format" from that would mislabel every
    // permission problem, so it stays the general refusal and the prose beside
    // it carries the path.
    expect(classifyFailure('PUT failed for /files/a.svg with status 403: Forbidden', 'target')).toBe(
      'target_refused',
    );
  });

  it('does not outrank a quota, a rate limit or an expired credential', () => {
    // The format rule sits ABOVE the general refusal and below everything
    // else. A message carrying both signals must take the more specific
    // remedy, and "wait until tomorrow" beats "change your export format".
    expect(classifyFailure('daily limit exceeded: 415', 'target')).toBe('quota_exceeded');
    expect(classifyFailure('429 too many requests (415)', 'target')).toBe('rate_limited');
    expect(classifyFailure('invalid_grant while sending 415', 'target')).toBe('auth_expired');
  });
});

describe('every category is still answerable and still known', () => {
  it('both new categories are reachable, and only with the side that means them', () => {
    const reached = new Set<FailureCategory>();
    for (const side of SIDES) {
      reached.add(classifyFailure(DRIVE_REFUSAL, side));
      reached.add(classifyFailure('415 unsupported media type', side));
    }
    expect(reached).toContain('source_refused');
    expect(reached).toContain('format_refused');
  });

  it('the two sides are still exactly two, which the classifier relies on', () => {
    // `classifyFailure` branches on `side === 'source'` and treats everything
    // else as the target reading. A third side would silently join the target
    // branch, so the list growing is a decision this test forces somebody to
    // take on purpose.
    expect([...FAILURE_SIDES]).toEqual(['source', 'target']);
  });

  it('answers a member of the vocabulary for every input tried here', () => {
    for (const side of SIDES) {
      for (const message of [DRIVE_REFUSAL, SABRE_REFUSAL, '', 'nonsense']) {
        expect(FAILURE_CATEGORIES).toContain(classifyFailure(message, side));
      }
    }
  });
});
