// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RETENTION SOMEBODY STATED (workplan 0134 T1).
 *
 * The close route tells a customer when their erasure completes, and the date
 * depends on `BACKUP_RETENTION_DAYS` (0085 T5). An empty line in `.env` reads
 * as the default of 7, so the sentence says "Backups that still contain it
 * expire within a further 7 days". Nothing in this repository backs up the
 * managed application database, and the alpha takes no backups at all (0134
 * D1). A stack left blank names backups that do not exist, and nothing said so:
 * a blank is the ordinary state of a file seeded from `managed.env.example`.
 *
 * The default stays 7 (0134 §3, *Why the default stays 7*). What changes is
 * that a blank is no longer silent. The API's start-up check,
 * `describeBackupRetentionProblem` in `config-guards.ts`, says:
 *
 *   - in production, blank is a WARNING that names both honest answers: `0`
 *     when nothing is backed up, and the number of days backups are kept;
 *   - with the alpha setting on (`OWNPACE_STAGE=alpha`, 0131 T1), blank is
 *     FATAL whatever `NODE_ENV` says, because `managed.yml` defaults
 *     `NODE_ENV` to `development` and an alpha stack must not start while it
 *     quotes backups by default. It names `ownpace-live`'s own number, 7, the
 *     most days a dump taken before a deploy is kept (0134 open question 1
 *     (b), 2026-09-28), and no longer points at 0 "as during the alpha";
 *   - a stated number, `0` or `7`, is never a problem.
 *
 * Whether the alpha case should be fatal or only a warning is 0134 open
 * question 4, still the owner's. This builds the plan's recommendation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  backupRetentionDaysFromEnv,
} from '@openmig/shared';
import { describeBackupRetentionProblem, assertBackupRetentionConfig } from './config-guards.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The two blanks an operator can leave: no line, and `BACKUP_RETENTION_DAYS=`. */
const BLANKS = [
  ['unset', undefined],
  ['empty', ''],
] as const;

describe('in production, a blank retention is a warning that names both honest answers', () => {
  it.each(BLANKS)('%s gives one non-fatal problem', (_label, value) => {
    const problems = describeBackupRetentionProblem({
      NODE_ENV: 'production',
      BACKUP_RETENTION_DAYS: value,
    });
    expect(problems).toHaveLength(1);
    const [problem] = problems;
    expect(problem!.fatal).toBe(false);
    expect(problem!.message).toContain('BACKUP_RETENTION_DAYS');
    // The two answers: 0 when nothing is backed up, the days when something is.
    expect(problem!.message).toMatch(/\bto 0\b/);
    expect(problem!.message).toContain('number of days');
    expect(problem!.message).toContain('0134');
    // And what the blank does today, so the operator knows why it matters.
    expect(problem!.message).toContain(`${DEFAULT_BACKUP_RETENTION_DAYS} days`);
  });
});

describe('with the alpha setting on, a blank retention is fatal, in production and outside it', () => {
  it.each([
    ['production', 'production'],
    ['development', 'development'],
    ['NODE_ENV unset', undefined],
  ] as const)('%s', (_label, nodeEnv) => {
    for (const [, value] of BLANKS) {
      const problems = describeBackupRetentionProblem({
        NODE_ENV: nodeEnv,
        OWNPACE_STAGE: 'alpha',
        BACKUP_RETENTION_DAYS: value,
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]!.fatal).toBe(true);
      expect(problems[0]!.message).toContain('BACKUP_RETENTION_DAYS');
      expect(problems[0]!.message).toContain('OWNPACE_STAGE=alpha');
      expect(problems[0]!.message).toMatch(/\bto 0\b/);
      expect(problems[0]!.message).toContain('0134');
    }
  });

  it("names live's 7, the days its pre-deploy dump is kept, and never points live's operator at 0 as the alpha's answer", () => {
    // 0134 open question 1 (b), 2026-09-28: live's databases are dumped before
    // each deploy and each dump is kept at most 7 days, so live sets 7. A
    // refusal saying "0 ... as during the alpha" would have an operator who
    // blanked it on live set 0, and the erasure sentence would then say no
    // copy exists while a dump still holds the data.
    const [problem] = describeBackupRetentionProblem({
      NODE_ENV: 'production',
      OWNPACE_STAGE: 'alpha',
      BACKUP_RETENTION_DAYS: '',
    });
    expect(problem!.message).toContain('7 on ownpace-live');
    expect(problem!.message).toContain('dump');
    expect(problem!.message).not.toMatch(/as during the alpha/i);
  });

  it('reads the setting the way the grant mail does: trimmed, in any case', () => {
    // `alphaFrom` in access-notify.ts is the API's one reader of the setting.
    // A second reading here that disagreed would let an alpha stack start blank.
    const problems = describeBackupRetentionProblem({
      NODE_ENV: 'development',
      OWNPACE_STAGE: ' Alpha ',
      BACKUP_RETENTION_DAYS: '',
    });
    expect(problems.map((p) => p.fatal)).toEqual([true]);
  });
});

describe('a stated number is never a problem', () => {
  const ENVIRONMENTS = [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', OWNPACE_STAGE: 'alpha' },
    { NODE_ENV: 'development', OWNPACE_STAGE: 'alpha' },
    { NODE_ENV: 'development' },
  ];

  it.each(['0', '7'])('%s gives none, with and without the alpha setting', (value) => {
    for (const env of ENVIRONMENTS) {
      expect(describeBackupRetentionProblem({ ...env, BACKUP_RETENTION_DAYS: value })).toEqual([]);
    }
  });

  it('the default, written out, is a statement too', () => {
    // An operator who writes 7 has said so. The check is about the blank,
    // not about the number, so it never argues with a stated one.
    expect(
      describeBackupRetentionProblem({
        NODE_ENV: 'production',
        OWNPACE_STAGE: 'alpha',
        BACKUP_RETENTION_DAYS: String(DEFAULT_BACKUP_RETENTION_DAYS),
      }),
    ).toEqual([]);
  });
});

describe('without the alpha setting, outside production, a blank gives none', () => {
  it.each([
    ['development', { NODE_ENV: 'development' }],
    ['NODE_ENV unset', {}],
    ['a stage that is not the alpha', { NODE_ENV: 'development', OWNPACE_STAGE: 'beta' }],
  ] as const)('%s', (_label, env) => {
    for (const [, value] of BLANKS) {
      expect(describeBackupRetentionProblem({ ...env, BACKUP_RETENTION_DAYS: value })).toEqual([]);
    }
  });
});

describe('the check fires exactly where the reader falls back to the default', () => {
  // If the two disagreed about what "blank" is, the check would warn about a
  // value the close route honours, or stay quiet about one it replaces with 7.
  it.each([undefined, '', '0', '3', '7', '30'])('%j', (value) => {
    const problems = describeBackupRetentionProblem({
      NODE_ENV: 'production',
      BACKUP_RETENTION_DAYS: value,
    });
    const fallsBack = value === undefined || value === '';
    expect(problems.length > 0).toBe(fallsBack);
    if (fallsBack) expect(backupRetentionDaysFromEnv(value)).toBe(DEFAULT_BACKUP_RETENTION_DAYS);
  });
});

describe('the API runs the check at start-up', () => {
  it('throws on the fatal case and routes the warning to the given sink', () => {
    const oldEnv = { ...process.env };
    try {
      process.env.NODE_ENV = 'production';
      process.env.BACKUP_RETENTION_DAYS = '';
      delete process.env.OWNPACE_STAGE;
      const warnings: string[] = [];
      expect(() => assertBackupRetentionConfig((m) => warnings.push(m))).not.toThrow();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('BACKUP_RETENTION_DAYS');

      process.env.OWNPACE_STAGE = 'alpha';
      expect(() => assertBackupRetentionConfig(() => {})).toThrow(/BACKUP_RETENTION_DAYS/);

      process.env.BACKUP_RETENTION_DAYS = '0';
      expect(() => assertBackupRetentionConfig(() => {})).not.toThrow();
    } finally {
      process.env = oldEnv;
    }
  });

  it('index.ts calls it beside the URL check, in the boot path', () => {
    // A check nothing calls is a check that never runs. index.ts starts the
    // server only outside tests, so this reads the source instead of booting.
    const index = readFileSync(join(HERE, 'index.ts'), 'utf8');
    const start = index.indexOf("if (process.env.NODE_ENV !== 'test')");
    expect(start, 'no boot block found in apps/api/src/index.ts').toBeGreaterThan(-1);
    const boot = index.slice(start);
    // As code at the start of a line, so a call commented out with `//` (the
    // likeliest way a start-up check gets switched off) does not count.
    for (const name of ['assertProductionUrlConfig', 'assertBackupRetentionConfig']) {
      expect(boot, `apps/api/src/index.ts never calls ${name}() at start-up`).toMatch(
        new RegExp(`^\\s*${name}\\(`, 'm'),
      );
    }
  });
});
