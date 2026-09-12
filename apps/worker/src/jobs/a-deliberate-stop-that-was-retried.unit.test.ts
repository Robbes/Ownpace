// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DELIBERATE STOP, RETRIED THREE TIMES (live 2026-09-11).
 *
 * A file pass tripped the 25-in-a-row tripwire and threw `PassAbortError` —
 * the pass saying "the world is broken, stop". `run-delta-sync` rethrew it as
 * an ordinary error, so `trigger.config.ts`'s default retry (3 attempts,
 * 5s/10s/20s apart) ran it twice more. ONE tick produced four failed runs
 * inside 13:01, against a target that had already refused 25 items in a row,
 * and the only way to halt them was `docker stop` on the worker containers.
 *
 * Retrying was pointless by construction: the pass had just proven the same
 * thing twenty-five times. `AbortTaskRunError` fails the run once and the sync
 * tick's failing-backoff ladder spaces the next attempts out — the layer built
 * for that.
 *
 * **The other half is what must NOT be aborted**, and it is the half a fix
 * like this gets wrong: a thrown pool error, an OOM, a provider 500 are all
 * worth another go, and a blanket abort here would turn one bad minute into a
 * migration that never resumes on its own. So both directions are asserted.
 */

import { describe, it, expect } from 'vitest';
import { AbortTaskRunError } from '@trigger.dev/sdk';
import { PassAbortError } from '@openmig/core';
import { taskErrorFor } from './stopping-a-pass.ts';

describe('a pass that stopped on purpose', () => {
  it('fails the task once instead of retrying it', () => {
    const mapped = taskErrorFor(new PassAbortError('25 items failed in a row'));
    expect(mapped).toBeInstanceOf(AbortTaskRunError);
  });

  it('keeps the pass’s own sentence, because that is what the run row shows', () => {
    // The operator reads this, not the class name. "25 items failed in a row"
    // is the diagnosis; "the task was aborted" is not.
    const mapped = taskErrorFor(
      new PassAbortError('25 items failed in a row — this is not an item-level problem'),
    );
    expect((mapped as Error).message).toContain('25 items failed in a row');
    expect((mapped as Error).message).toContain('not an item-level problem');
  });
});

describe('everything else still gets another go', () => {
  it('hands an ordinary error back UNCHANGED', () => {
    // Identity, not equality: the error must reach trigger as the same object,
    // with its own stack and cause, so the retry ladder and the run log see
    // what actually happened.
    const crash = new Error('Connection terminated unexpectedly');
    expect(taskErrorFor(crash)).toBe(crash);
  });

  it('does not abort on an error that merely mentions a pass abort', () => {
    // The decision is the CLASS, never the words. A provider whose 500 body
    // quotes our own message back at us must not switch off this migration's
    // retries.
    const lookalike = new Error('upstream said: PassAbortError: 25 items failed in a row');
    expect(taskErrorFor(lookalike)).toBe(lookalike);
  });

  it('hands a non-Error throw back unchanged', () => {
    // A library that throws a string or a plain object must not be reshaped
    // into an abort on its way past.
    expect(taskErrorFor('boom')).toBe('boom');
    const odd = { code: 'ECONNRESET' };
    expect(taskErrorFor(odd)).toBe(odd);
  });

  it('is idempotent: an already-mapped abort is not wrapped twice', () => {
    // So a caller that routes an error through this twice does not bury the
    // pass's sentence inside a second envelope.
    const once = taskErrorFor(new PassAbortError('25 items failed in a row'));
    expect(taskErrorFor(once)).toBe(once);
  });
});
