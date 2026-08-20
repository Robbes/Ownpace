// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Containment: everything the shared cron validator ACCEPTS, this croner —
 * the exact version the managed tick evaluates schedules with — must parse
 * (0037 T4).
 *
 * The validator exists so no stored schedule can hit the tick's loud-log +
 * default-cadence fallback (see sync-due.ts). That guarantee holds only while the
 * validator's accepted grammar stays a subset of croner's; this test lives
 * HERE, beside the croner dependency, so a croner upgrade that narrows its
 * grammar fails the build instead of quietly reopening the gap.
 */
import { describe, it, expect } from 'vitest';
import { Cron } from 'croner';
import { describeCronScheduleProblem } from '@openmig/shared';

const ACCEPTED_SAMPLES = [
  '0 2 * * *',
  '*/15 * * * *',
  '0 * * * *',
  '0 */6 * * *',
  '30 4 1,15 * 5',
  '0 0 1-7 * 1-5',
  '5-50/10 2 * 1 0',
  '59 23 31 12 7',
  '@hourly',
  '@daily',
  '@weekly',
  '@monthly',
  '@yearly',
  '@annually',
];

describe('validator-accepted schedules are croner-parseable', () => {
  for (const expr of ACCEPTED_SAMPLES) {
    it(`'${expr}'`, () => {
      expect(describeCronScheduleProblem(expr)).toBeNull();
      expect(() => new Cron(expr)).not.toThrow();
    });
  }
});
