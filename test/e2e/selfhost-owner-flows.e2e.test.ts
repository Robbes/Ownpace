// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE OWNER'S FLOWS ON THE APPLIANCE (workplan 0179 T6; the maintainer's yes
 * of 2026-11-28: *"T6: yes in this alpha"*).
 *
 * What an owner presses on the appliance's screens, on the real stack, through
 * the routes those screens call:
 *
 *  - G9: a failed item retried until it is copied (`/failures/:h/retry`), and a
 *    move applied (`/moves/:h/apply`), the file at its new place and not at
 *    the old one;
 *  - G7: one data type stopped, a pass copying nothing of it, and resumed
 *    (`/domains/:d/(stop|resume)`); one ended and one kept (`(end|keep)`);
 *  - G8: the sharing queue answered (`/sharing/…`), the share recreated once,
 *    not twice, on a second pass;
 *  - G6: the one person the appliance moves (`/people`), adding a person or a
 *    migration refused with its reason, ADR-0050: a migration is added here by
 *    adding its file, as the three this gate uses were.
 *
 * The flows are `owner-flows-lib.ts`, held off the stack by
 * `owner-flows-lib.unit.test.ts` against a fake appliance, one break at a
 * time. Each uses its own mapping and folder (`fixtures/selfhost-owner-flows-
 * *.mapping.json`), names its files with this run's token, and reads every
 * status through `statusAfterAPass`. Each prints its run time.
 *
 * PREREQUISITES: the stack the earlier gates ran on, after the archive gates
 * and before the upgrade gate (see e2e.yml). The main mapping is finished by
 * then, so it reads none of the folders made here. Both backends.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { MAIN_MAPPING_ID } from './apply-deletion-lib.ts';
import {
  PATHS_MAPPING_ID,
  RETRY_MAPPING_ID,
  SHARING_MAPPING_ID,
  answerTheSharingQueue,
  applyAMove,
  endOneKeepOne,
  retryAFailedItem,
  runToken,
  stopAndResumeOne,
  takeBack,
  theOnePersonHere,
  timed,
} from './owner-flows-lib.ts';

const RUN = runToken();
const FLOW_MS = 300_000;

function said(lines: string[]): void {
  for (const line of lines) console.log(`[e2e] owner flows:   ${line}`);
}

const started = Date.now();

afterAll(async () => {
  const left = await takeBack(RUN);
  for (const line of left) console.log(`[e2e] owner flows: not taken back: ${line}`);
  console.log(`[e2e] owner flows: all of T6 took ${((Date.now() - started) / 1000).toFixed(1)}s`);
}, FLOW_MS);

describe(`the owner's flows on the appliance (run ${RUN})`, () => {
  it('G9: a failed item, retried until it is copied', async () => {
    said(await timed('G9 retry', () => retryAFailedItem(RUN)));
  }, FLOW_MS);

  it('G9: a move applied, the file at its new place and not at the old one', async () => {
    said(await timed('G9 move', () => applyAMove(RUN)));
  }, FLOW_MS);

  it('G7: one data type stopped, a pass copies nothing of it; resumed, it copies again', async () => {
    said(await timed('G7 stop and resume', () => stopAndResumeOne(RUN)));
  }, FLOW_MS);

  it('G7: one data type ended and one kept', async () => {
    said(await timed('G7 end and keep', () => endOneKeepOne(RUN)));
  }, FLOW_MS);

  it('G8: the sharing queue answered, the share recreated once and not twice', async () => {
    said(await timed('G8 sharing', () => answerTheSharingQueue(RUN)));
  }, FLOW_MS);

  it('G6: the one person here, every migration theirs, nobody to add', async () => {
    const lines = await timed('G6 people', () =>
      theOnePersonHere([MAIN_MAPPING_ID, RETRY_MAPPING_ID, PATHS_MAPPING_ID, SHARING_MAPPING_ID]),
    );
    said(lines);
    expect(lines.length).toBeGreaterThan(0);
  }, FLOW_MS);
});
