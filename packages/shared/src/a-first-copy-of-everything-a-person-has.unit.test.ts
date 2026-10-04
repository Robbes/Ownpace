// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHEN A PERSON'S FIRST COPY IS IN (workplan 0154 T7): every migration of
 * theirs has a data type that counts, and every one that counts has had a pass
 * reach the end. A stopped data type and one waiting to start do not count;
 * a migration with nothing that counts has not arrived.
 */
import { describe, it, expect } from 'vitest';
import { firstCopyOf, type FirstCopyDataType } from './first-copy.ts';

const dt = (domain: FirstCopyDataType['domain'], over: Partial<FirstCopyDataType> = {}): FirstCopyDataType => ({
  domain,
  phase: 'active',
  stopped: false,
  completed: true,
  ...over,
});

describe('a person’s first copy', () => {
  it('is in when every data type of every migration has arrived, and names each once, in order', () => {
    const first = firstCopyOf([
      { dataTypes: [dt('contact'), dt('calendar')] },
      { dataTypes: [dt('email'), dt('calendar')] },
    ]);
    expect(first).toEqual({ complete: true, domains: ['email', 'calendar', 'contact'] });
  });

  it('is not in while one data type of one migration has not arrived', () => {
    const first = firstCopyOf([
      { dataTypes: [dt('email')] },
      { dataTypes: [dt('file', { completed: false })] },
    ]);
    expect(first.complete).toBe(false);
  });

  it('leaves out a data type its owner stopped, or one waiting to start', () => {
    const first = firstCopyOf([
      {
        dataTypes: [
          dt('email'),
          dt('calendar', { stopped: true, completed: false }),
          dt('file', { phase: 'ready', completed: false }),
        ],
      },
    ]);
    expect(first).toEqual({ complete: true, domains: ['email'] });
  });

  it('counts one paused after it arrived as arrived', () => {
    expect(firstCopyOf([{ dataTypes: [dt('email', { phase: 'paused' })] }]).complete).toBe(true);
  });

  it('is not in for a migration made and never started, or for nobody’s migrations at all', () => {
    // Paused before its first pass: nothing has arrived, whatever else has.
    expect(
      firstCopyOf([{ dataTypes: [dt('email')] }, { dataTypes: [dt('email', { phase: 'paused', completed: false })] }])
        .complete,
    ).toBe(false);
    // Every data type waiting to start: none counts, so none has arrived.
    expect(firstCopyOf([{ dataTypes: [dt('file', { phase: 'ready', completed: false })] }]).complete).toBe(false);
    expect(firstCopyOf([]).complete).toBe(false);
  });
});
