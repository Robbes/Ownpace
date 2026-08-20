// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Conservative validation for a mapping's cron schedule (workplan 0037 T4).
 *
 * The schedule used to be stored verbatim (`z.string().optional()`). The
 * managed tick worker evaluates it with croner and — deliberately, hard
 * rule 9's "never dead-stop a mapping" — logs an invalid expression loudly
 * and falls back to the default 15-minute cadence. The mapping keeps
 * syncing, but the admin's STATED cadence is silently not honored. This
 * validator closes the front door instead: garbage is refused at create
 * time, where the person who typed it is still looking.
 *
 * Conservative on purpose: it accepts the classic five-field syntax
 * (numbers, `*`, ranges, steps, lists) plus the `@hourly`-style shorthands —
 * a strict SUBSET of what croner parses — so nothing this validator accepts
 * can ever hit the tick worker's fallback. The parity test in apps/worker
 * (`cron-schedule-parity.unit.test.ts`) pins that containment against the
 * same croner version the tick uses. Month/day NAMES (JAN, MON) are not
 * accepted; the wizard writes numeric expressions and a smaller accepted
 * grammar is a smaller drift surface.
 *
 * The returned sentences are shared-contract prose: the wizard renders them
 * beside the input and the create API embeds them in its refusal, so both
 * doors describe the same problem in the same words.
 */

const NICKNAMES = ['@hourly', '@daily', '@weekly', '@monthly', '@yearly', '@annually'] as const;

interface CronField {
  readonly name: string;
  readonly min: number;
  readonly max: number;
}

const CRON_FIELDS: ReadonlyArray<CronField> = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  // 0 and 7 are both Sunday, as croner accepts.
  { name: 'day of week', min: 0, max: 7 },
];

function rangeProblem(part: string, field: CronField): string | null {
  // Forms: '*', '*/step', 'a', 'a-b', 'a-b/step'. A step on a BARE number
  // ('0/5') is refused because croner refuses it — accepting it here would
  // store a schedule the tick worker cannot evaluate.
  const [base, step, ...extra] = part.split('/');
  if (extra.length > 0 || step === '') {
    return `the ${field.name} field ('${part}') has a malformed step — use e.g. '*/5' or '1-10/2'`;
  }
  if (step !== undefined) {
    if (!/^\d+$/.test(step) || Number(step) < 1) {
      return `the ${field.name} field ('${part}') has a step that is not a positive number`;
    }
    if (base !== '*' && !/^\d+-\d+$/.test(base ?? '')) {
      return (
        `the ${field.name} field ('${part}') steps from a single number, which the scheduler ` +
        `does not accept — use '*/${step}' or a range like '${base}-${field.max}/${step}'`
      );
    }
  }
  if (base === '*') return null;
  const m = /^(\d+)(?:-(\d+))?$/.exec(base ?? '');
  if (!m) {
    return (
      `the ${field.name} field ('${part}') is not a number, range, step or '*' — ` +
      `month and weekday names are not supported here, use numbers`
    );
  }
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  if (lo < field.min || lo > field.max || hi < field.min || hi > field.max) {
    return `the ${field.name} field ('${part}') is out of range (${field.min}-${field.max})`;
  }
  if (hi < lo) {
    return `the ${field.name} field ('${part}') has a backwards range (${lo} > ${hi})`;
  }
  return null;
}

/**
 * Why this cron expression is not a valid schedule, or null when it is.
 *
 * An empty/whitespace-only string is NOT valid here — callers that treat an
 * omitted schedule as "use the default" should skip validation for it rather
 * than pass it in.
 */
export function describeCronScheduleProblem(expression: string): string | null {
  const trimmed = expression.trim();
  if (trimmed === '') {
    return 'the schedule is empty';
  }
  if (trimmed.startsWith('@')) {
    return (NICKNAMES as ReadonlyArray<string>).includes(trimmed)
      ? null
      : `'${trimmed}' is not a known schedule shorthand — expected one of ${NICKNAMES.join(', ')}`;
  }
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return (
      `a cron schedule has five fields — minute, hour, day of month, month, day of week — ` +
      `separated by spaces; this one has ${fields.length}`
    );
  }
  for (const [i, field] of CRON_FIELDS.entries()) {
    for (const part of fields[i]!.split(',')) {
      if (part === '') {
        return `the ${field.name} field ('${fields[i]}') has an empty list entry`;
      }
      const problem = rangeProblem(part, field);
      if (problem) return problem;
    }
  }
  return null;
}
