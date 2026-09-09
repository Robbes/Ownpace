#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COMMAND THE DOCS TOLD YOU TO RUN, AND THE CHAIN IT QUIETLY BREAKS.
 *
 * `package.json` carried these two lines from the first slice onward:
 *
 *   "db:generate": "drizzle-kit generate",
 *   "db:migrate":  "drizzle-kit migrate",
 *
 * Neither is how this repository authors or applies migrations, and neither
 * has been since `runMigrations` landed (0010 T1). They stayed because a
 * script that nobody runs looks like a script that costs nothing.
 *
 * ## What `pnpm db:generate` actually does, measured 2026-09-09
 *
 * `drizzle.config.ts` pointed `out` at `packages/ledger/migrations` — the real
 * chain, 41 hand-written files. Run against a copy of it, drizzle-kit wrote
 * `0000_silly_iceman.sql` (30 KB of `CREATE TABLE`, a different random name
 * each run) plus a `meta/` directory, and **exited 0**. (`out` now names a
 * throwaway directory, so drizzle-kit is still usable and can no longer reach
 * the chain — that half of the fix is in `drizzle.config.ts`, this half is the
 * command a person actually types.)
 *
 * `listMigrationVersions` sorts the directory lexicographically, and `0000_`
 * sorts BELOW `0001_baseline.sql`. So the generated dump becomes the first
 * migration in the chain, and the baseline then fails on tables that already
 * exist. The error that surfaces names `0001_baseline.sql` — a file nobody
 * touched — rather than the command that caused it.
 *
 * The test suite does catch it: `migrate-rerun.unit.test.ts` replays the whole
 * directory on PGlite, so the file goes red the first time anyone runs
 * `pnpm test`. That is the net, and it is not the same thing as the command
 * refusing. A green exit code from a documented command is a claim, and this
 * one was false.
 *
 * ## And `pnpm db:migrate`
 *
 * drizzle-kit applies the files listed in `migrations/meta/_journal.json` and
 * records them in its own `__drizzle_migrations` table. This repository keeps
 * no journal and reads `schema_migrations`. Two runners, two ledgers, one
 * directory: whichever ran last, the other one is wrong about what is applied.
 *
 * ## Why a refusal rather than a deletion
 *
 * `pnpm db:migrate` is named in workplan 0001 T0's acceptance criteria, and
 * `pnpm db:generate` was named in `pnpm-workspace.yaml` as the canary for the
 * esbuild override. Deleting the scripts makes those references fail with
 * "command not found", which says nothing about what replaced them. This says
 * it, on the one screen a person following a stale doc will actually reach.
 */

const WHAT = new Map([
  [
    'db:generate',
    [
      'What it would do, measured 2026-09-09 (against a COPY of the chain, not the chain):',
      '',
      '  drizzle-kit generate wrote packages/ledger/migrations/0000_silly_iceman.sql —',
      '  30 KB of CREATE TABLE, a different random name each run — plus meta/, and exited 0.',
      '',
      '  Migrations are applied in SORTED filename order, and "0000_" sorts below',
      '  "0001_baseline.sql". The generated dump goes first, the baseline then fails on',
      '  tables that already exist, and the error names the baseline rather than the',
      '  command that caused it.',
    ],
  ],
  [
    'db:migrate',
    [
      'What it would do:',
      '',
      '  drizzle-kit applies the files listed in migrations/meta/_journal.json and records',
      '  them in its own __drizzle_migrations table. This repository keeps no journal and',
      '  reads schema_migrations. Two runners, two ledgers, one directory — whichever ran',
      '  last, the other one is wrong about what is applied.',
    ],
  ],
]);

const HOW = [
  'How migrations are authored here (ADR-0016):',
  '',
  '  1. Write the next numbered file BY HAND, e.g.',
  '       packages/ledger/migrations/0044_what_it_does.sql',
  '     Managed-only tables go in packages/managed/migrations/ instead (ADR-0036) —',
  '     the appliance never applies that chain.',
  '',
  '  2. Nothing applies it by hand. runMigrations() applies every pending file at',
  '     startup under an advisory lock and records it in schema_migrations; the',
  '     appliance and the worker both call it. `pnpm test` replays the whole chain on',
  '     PGlite, so a file that cannot apply is red before it is pushed.',
  '',
  '  3. Pre-release only, scripts/squash-migrations.sh folds the chain back into',
  '     0001_baseline.sql — by dumping an applied database, never by hand-merging SQL.',
  '',
  'If you wanted to SEE the SQL Drizzle would emit, drizzle-kit still runs:',
  '',
  '    npx drizzle-kit generate        # writes to .drizzle-out/, which is gitignored',
  '',
  '  `out` in drizzle.config.ts names that throwaway directory precisely so this is safe;',
  '  it used to name the real chain, which is what made `pnpm db:generate` dangerous.',
  '  Read the SQL, then delete it — nothing applies what is in there.',
  '',
  '  Usually you do not need it: packages/ledger/src/schema-matches-migrations.unit.test.ts',
  '  already compares the Drizzle schema against the chain, table by table and column by',
  '  column, in both directions, on every test run.',
];

function main() {
  const invoked = process.argv[2] ?? '';
  const what = WHAT.get(invoked);

  const lines = [
    '',
    `pnpm ${invoked || '<db:generate|db:migrate>'} is not how migrations are authored here.`,
    '',
    ...(what ?? []),
    '',
    ...HOW,
    '',
  ];
  // stderr, not stdout: this is a refusal, and a refusal that a pipeline can
  // mistake for output is the shape of defect this file exists to end.
  console.error(lines.join('\n'));
  process.exit(1);
}

main();
