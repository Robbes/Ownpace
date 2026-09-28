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
 *
 * **Since 2026-09-27 neither carries the words** (workplan 0134, open question
 * 3 (a)). Trigger.dev keeps what a run fails with, with no limit, and the last
 * item's error can name a tester's file. So the rule lives in `planeErrorFor`,
 * which every task's error goes through, and the words go to the container's
 * output under the reference the error carries. The class still decides the
 * retry; `a-run-that-kept-a-testers-words` holds the words.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AbortTaskRunError } from '@trigger.dev/sdk';
import { PassAbortError } from '@openmig/core';
import { planeErrorFor } from './what-a-run-leaves.ts';

const where = { task: 'run-delta-sync' };

// The words go to the container's output; this file does not read them.
afterEach(() => vi.restoreAllMocks());
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('a pass that stopped on purpose', () => {
  it('fails the task once instead of retrying it', async () => {
    quiet();
    const mapped = await planeErrorFor(new PassAbortError('25 items failed in a row'), where);
    expect(mapped).toBeInstanceOf(AbortTaskRunError);
  });

  it('says the pass stopped itself, with its category and reference, in place of the last item’s words', async () => {
    // The operator reads this, not the class name: "stopped itself" is the
    // diagnosis, and the reference finds the rest in the container's output.
    // The last item's words are what the plane must not keep.
    quiet();
    const mapped = await planeErrorFor(
      new PassAbortError("25 items failed in a row. Last error: 403 on 'Belastingaangifte 2025.pdf'"),
      where,
    );
    expect(mapped.message).toMatch(
      /^run-delta-sync stopped itself after items failed in a row \([a-z_]+\)\. Reference [0-9a-f]{8}\.$/,
    );
    expect(mapped.message).not.toContain('Belastingaangifte');
  });
});

describe('everything else still gets another go', () => {
  it('hands an ordinary error back as one that is retried', async () => {
    // The retry ladder reads the class: a plain Error is retried. What it said
    // is in the container's output, under the reference this one carries.
    quiet();
    const mapped = await planeErrorFor(new Error('Connection terminated unexpectedly'), where);
    expect(mapped).not.toBeInstanceOf(AbortTaskRunError);
    expect(mapped.name).toBe('Error');
    expect(mapped.message).toMatch(/^run-delta-sync failed \([a-z_]+\)\. Reference [0-9a-f]{8}\.$/);
  });

  it('does not abort on an error that merely mentions a pass abort', async () => {
    // The decision is the CLASS, never the words. A provider whose 500 body
    // quotes our own message back at us must not switch off this migration's
    // retries.
    quiet();
    const lookalike = new Error('upstream said: PassAbortError: 25 items failed in a row');
    expect(await planeErrorFor(lookalike, where)).not.toBeInstanceOf(AbortTaskRunError);
  });

  it('does not reshape a non-Error throw into an abort', async () => {
    // A library that throws a string or a plain object must not become an
    // abort on its way past.
    quiet();
    expect(await planeErrorFor('boom', where)).not.toBeInstanceOf(AbortTaskRunError);
    expect(await planeErrorFor({ code: 'ECONNRESET' }, where)).not.toBeInstanceOf(AbortTaskRunError);
  });

  it('is idempotent: an error it made is handed back as it is', async () => {
    // So a caller that routes an error through this twice does not bury the
    // pass's reference inside a second one.
    quiet();
    const once = await planeErrorFor(new PassAbortError('25 items failed in a row'), where);
    expect(await planeErrorFor(once, where)).toBe(once);
  });
});
