// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE OWNER'S FLOWS ON THE APPLIANCE, THE GATE'S OWN LOGIC OFF THE STACK
 * (workplan 0179 T6). `selfhost-owner-flows.e2e.test.ts` walks these flows on
 * the real stack; this runs the same flows against a fake appliance and a fake
 * Nextcloud (`owner-flows-fake.ts`), first as the product's rules say, where
 * each must pass, and then with one route or rule broken at a time, where the
 * flow that tries it must fail, and for that reason.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL, DAV_TARGET_USER, NEXTCLOUD_URL } from './apply-deletion-lib.ts';
import { fakeWorld, type FakeWorld, type Mutation } from './owner-flows-fake.ts';
import {
  DAV_SOURCE_USER,
  FOLDERS,
  PATHS_MAPPING_ID,
  RETRY_MAPPING_ID,
  SHARING_MAPPING_ID,
  answerTheSharingQueue,
  applyAMove,
  endOneKeepOne,
  retryAFailedItem,
  setPauseMs,
  stopAndResumeOne,
  takeBack,
  theOnePersonHere,
} from './owner-flows-lib.ts';

let world: FakeWorld;

function withWorld(mutation?: Mutation): FakeWorld {
  world = fakeWorld({
    baseUrl: BASE_URL,
    nextcloudUrl: NEXTCLOUD_URL,
    sourceUser: DAV_SOURCE_USER,
    targetUser: DAV_TARGET_USER,
    mappings: [
      { id: RETRY_MAPPING_ID, folder: FOLDERS.retry },
      { id: PATHS_MAPPING_ID, folder: FOLDERS.paths, calendar: true },
      { id: SHARING_MAPPING_ID, folder: FOLDERS.sharing, mailbox: true },
    ],
    ...(mutation ? { mutation } : {}),
  });
  vi.stubGlobal('fetch', world.fetch);
  return world;
}

beforeEach(() => {
  setPauseMs(0);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const RUN = 'r1';
const ALL = [RETRY_MAPPING_ID, PATHS_MAPPING_ID, SHARING_MAPPING_ID];

describe('the owner-flows gate, where the appliance does what its routes say', () => {
  it('G9: a failed item retried until it is copied', async () => {
    withWorld();
    await expect(retryAFailedItem(RUN)).resolves.toBeDefined();
    // Through the appliance's own route, not a pass that happened to retry it.
    expect(world.calls.some((c) => c.includes(`/mappings/${RETRY_MAPPING_ID}/failures/`) && c.endsWith('/retry'))).toBe(true);
  });

  it('G9: a move applied, the file at its new place and not at the old one', async () => {
    withWorld();
    await expect(applyAMove(RUN)).resolves.toBeDefined();
    expect(world.calls.some((c) => c.includes(`/mappings/${RETRY_MAPPING_ID}/moves/`) && c.endsWith('/apply'))).toBe(true);
  });

  it('G7: one data type stopped, a pass copies nothing of it, resumed, it copies again', async () => {
    withWorld();
    await expect(stopAndResumeOne(RUN)).resolves.toBeDefined();
  });

  it('G7: one data type ended and one kept', async () => {
    withWorld();
    await stopAndResumeOne(RUN);
    await expect(endOneKeepOne(RUN)).resolves.toBeDefined();
  });

  it('G8: the sharing queue answered, and the share recreated once on a second pass', async () => {
    withWorld();
    await expect(answerTheSharingQueue(RUN)).resolves.toBeDefined();
    expect(world.targetShares().filter((s) => s.path.includes(RUN))).toHaveLength(1);
  });

  it('G6: the one person here, every migration theirs, and nobody to add', async () => {
    withWorld();
    await expect(theOnePersonHere(ALL)).resolves.toBeDefined();
  });

  it('takes back what it made, and a second run on the same stack passes', async () => {
    withWorld();
    await retryAFailedItem(RUN);
    await applyAMove(RUN);
    await stopAndResumeOne(RUN);
    await endOneKeepOne(RUN);
    await answerTheSharingQueue(RUN);
    await takeBack(RUN);
    expect(world.targetShares()).toHaveLength(0);
    // A second run, as on a stack an earlier run of it left behind.
    await expect(retryAFailedItem('r2')).resolves.toBeDefined();
    await expect(applyAMove('r2')).resolves.toBeDefined();
    await expect(stopAndResumeOne('r2')).resolves.toBeDefined();
    await expect(endOneKeepOne('r2')).resolves.toBeDefined();
    await expect(answerTheSharingQueue('r2')).resolves.toBeDefined();
  });
});

describe('the owner-flows gate, red for the reason it names, on one break at a time', () => {
  it('G9 fails when a retry answers 200 and leaves the item parked', async () => {
    withWorld('retry-leaves-it-parked');
    await expect(retryAFailedItem(RUN)).rejects.toThrow(/after the retry/);
  });

  it('G9 fails when a pass retries a parked item by itself, so the retry would prove nothing', async () => {
    withWorld('a-parked-item-is-retried-anyway');
    await expect(retryAFailedItem(RUN)).rejects.toThrow(/before anybody pressed retry/);
  });

  it('G9 fails when an applied move leaves the old copy where it was', async () => {
    withWorld('apply-move-keeps-the-old-copy');
    await expect(applyAMove(RUN)).rejects.toThrow(/still at its old place/);
  });

  it('G7 fails when a stop does not stop', async () => {
    withWorld('stop-is-ignored');
    await expect(stopAndResumeOne(RUN)).rejects.toThrow(/while it was stopped/);
  });

  it('G7 fails when a resume does not resume', async () => {
    withWorld('resume-is-ignored');
    await expect(stopAndResumeOne(RUN)).rejects.toThrow(/after the resume/);
  });

  it('G7 fails when an ended data type goes on copying', async () => {
    withWorld('an-ended-type-still-copies');
    await stopAndResumeOne(RUN);
    await expect(endOneKeepOne(RUN)).rejects.toThrow(/after it was ended/);
  });

  it('G7 fails when a data type kept copying stops copying', async () => {
    withWorld('a-kept-type-stops');
    await stopAndResumeOne(RUN);
    await expect(endOneKeepOne(RUN)).rejects.toThrow(/after it was kept/);
  });

  it('G8 fails when a second pass recreates the share', async () => {
    withWorld('a-share-applied-twice');
    await expect(answerTheSharingQueue(RUN)).rejects.toThrow(/2 shares/);
  });

  it('G8 fails when a share is applied before its data type is past its cutover', async () => {
    withWorld('sharing-applies-before-cutover');
    await expect(answerTheSharingQueue(RUN)).rejects.toThrow(/before its cutover/);
  });

  it('G6 fails when the appliance takes a person it cannot hold', async () => {
    withWorld('people-takes-a-person');
    await expect(theOnePersonHere(ALL)).rejects.toThrow(/one_person_here/);
  });
});
