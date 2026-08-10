// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The conservative cron validator (0037 T4).
 *
 * What matters here is the DIRECTION of mistakes: rejecting something croner
 * would accept costs one honest refusal in front of the person typing it;
 * accepting something croner rejects would send the mapping to the tick
 * worker's silent 15-minute fallback — the exact failure this validator
 * exists to close. The croner-containment half lives in apps/worker
 * (cron-schedule-parity.unit.test.ts), next to the version the tick uses.
 */
import { describe, it, expect } from 'vitest';
import { describeCronScheduleProblem } from './cron-schedule';

describe('describeCronScheduleProblem accepts the classic five-field grammar', () => {
  const valid = [
    '0 2 * * *', // the wizard's daily preset
    '*/15 * * * *', // the default cadence
    '0 * * * *',
    '0 */6 * * *',
    '30 4 1,15 * 5',
    '0 0 1-7 * 1-5',
    '5-50/10 2 * 1 0',
    '0 22 * * 7', // 7 = Sunday, croner-legal
    '@daily',
    '@hourly',
  ];
  for (const expr of valid) {
    it(`'${expr}' is valid`, () => {
      expect(describeCronScheduleProblem(expr)).toBeNull();
    });
  }
});

describe('describeCronScheduleProblem refuses garbage with the reason', () => {
  it('the wrong field count names the five fields', () => {
    expect(describeCronScheduleProblem('every day at noon')).toContain('five fields');
    expect(describeCronScheduleProblem('* * * *')).toContain('has 4');
    expect(describeCronScheduleProblem('* * * * * *')).toContain('has 6');
  });

  it('out-of-range values name the field and its bounds', () => {
    expect(describeCronScheduleProblem('61 * * * *')).toContain('minute');
    expect(describeCronScheduleProblem('61 * * * *')).toContain('0-59');
    expect(describeCronScheduleProblem('* 24 * * *')).toContain('hour');
    expect(describeCronScheduleProblem('* * 0 * *')).toContain('day of month');
    expect(describeCronScheduleProblem('* * * 13 *')).toContain('month');
    expect(describeCronScheduleProblem('* * * * 8')).toContain('day of week');
  });

  it('malformed pieces are named, not summarized', () => {
    expect(describeCronScheduleProblem('*/x * * * *')).toContain('step');
    // croner refuses a step on a bare number; accepting it here would store a
    // schedule the tick cannot evaluate (see the parity test in apps/worker).
    expect(describeCronScheduleProblem('0/5 * * * *')).toContain('single number');
    expect(describeCronScheduleProblem('10-5 * * * *')).toContain('backwards');
    expect(describeCronScheduleProblem('1,,2 * * * *')).toContain('empty list entry');
    expect(describeCronScheduleProblem('MON * * * *')).toContain('names are not supported');
    expect(describeCronScheduleProblem('@fortnightly')).toContain('not a known schedule shorthand');
  });

  it('an empty string is a problem for the caller to route around, not a pass', () => {
    expect(describeCronScheduleProblem('')).toContain('empty');
    expect(describeCronScheduleProblem('   ')).toContain('empty');
  });
});
