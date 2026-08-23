// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A command a script prints for a human to paste is part of its interface, and
 * it is expanded by the OPERATOR'S shell before it ever reaches a container.
 *
 * `$POSTGRES_USER` and `$POSTGRES_DB` are set inside `ownpace-db` and nowhere
 * else. Printed bare they expand to nothing in the operator's shell, `psql`
 * falls back to the host username, and the answer is:
 *
 *   psql: error: connection to server on socket "…" failed:
 *   FATAL:  role "root" does not exist
 *
 * THIS HAS NOW HAPPENED TWICE. It was found and fixed in
 * `seed-demo-dav-content.sh` (#487, "the watch it land hint could not be
 * pasted"), and the test written for it watched that ONE FILE — so when
 * `bootstrap-managed.sh` printed a clear-down remedy in the same shape on
 * 2026-08-23, nothing objected, and an operator pasted it and got the same
 * `role "root" does not exist` back. `smoke-managed.sh`'s run_event hint was
 * carrying the same bug at the same time, unnoticed and unreported.
 *
 * A guard scoped to the file where a bug was found does not stop the class. So
 * this one reads EVERY script in deploy/compose and refuses the shape, wherever
 * it appears and whoever writes it next.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPOSE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'compose');

const scripts = readdirSync(COMPOSE_DIR)
  .filter((f) => f.endsWith('.sh'))
  .map((f) => ({ file: f, text: readFileSync(join(COMPOSE_DIR, f), 'utf8') }));

/**
 * Variables that exist ONLY inside a container. Named rather than derived,
 * because the point is what the OPERATOR'S shell does not have.
 *
 * The first version of this list held `POSTGRES_USER` and `POSTGRES_DB` and
 * nothing else — the two the original bug happened to use. `setup-zitadel.sh`
 * was meanwhile printing `psql "$DATABASE_URL" -c 'DROP DATABASE zitadel'` in
 * the remedy its own 401 refusal points at, and this guard had no opinion,
 * because `DATABASE_URL` was not on a list of two. A rule scoped to the
 * variables a bug happened to use is the same mistake as one scoped to the
 * file it happened in.
 */
const CONTAINER_ONLY = ['POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD', 'DATABASE_URL', 'DIRECT_DATABASE_URL'];
const CONTAINER_VAR = new RegExp(`\\$\\{?(${CONTAINER_ONLY.join('|')})\\b`);
const CONTAINER_VAR_WITH_DEFAULT = new RegExp(`\\$\\{(${CONTAINER_ONLY.join('|')}):-`);

/** Lines that run OR print a psql call carrying a container-only variable. */
const psqlLines = scripts.flatMap(({ file, text }) =>
  text
    .split('\n')
    .map((line, i) => ({ file, n: i + 1, line }))
    .filter(
      ({ line }) =>
        /\bpsql\b/.test(line) &&
        CONTAINER_VAR.test(line) &&
        // A `${POSTGRES_USER:-openmigrate}` default resolves in ANY shell, so
        // it is not this rule's business — that is a script calling psql for
        // itself, not a line somebody is meant to paste.
        !CONTAINER_VAR_WITH_DEFAULT.test(line),
    ),
);

describe('a psql hint a human is meant to paste', () => {
  it('found some to check', () => {
    // Vacuity guard: if the regex stops matching, every case below passes on an
    // empty list and the guard silently stops guarding — which is the exact
    // failure mode that let this bug come back.
    expect(psqlLines.length, 'no psql-with-container-variable lines found at all').
      toBeGreaterThan(2);
  });

  it('resolves its credentials INSIDE the container, never in the pasting shell', () => {
    const bare = psqlLines.filter(({ line }) => !/\bsh -l?c\b/.test(line));
    expect(
      bare.map(({ file, n, line }) => `${file}:${n}: ${line.trim()}`),
      'expands to nothing in the operator\'s shell — `FATAL: role "root" does not exist`',
    ).toEqual([]);
  });

  it('keeps the dollar signs literal all the way to that container', () => {
    // `sh -c` with the right words in the wrong quotes is no better: inside
    // DOUBLE quotes the operator's shell expands the name before `sh` sees it.
    // Either single-quote the whole `sh -c` argument, or backslash-escape the
    // dollars so what PRINTS still carries them.
    const inSingles = new RegExp(`sh -l?c '[^']*\\$\\{?(${CONTAINER_ONLY.join('|')})`);
    const escaped = new RegExp(`\\\\\\$\\{?(${CONTAINER_ONLY.join('|')})`);
    const leaky = psqlLines.filter(({ line }) => !inSingles.test(line) && !escaped.test(line));
    expect(
      leaky.map(({ file, n, line }) => `${file}:${n}: ${line.trim()}`),
      'the operator\'s shell expands these before the container ever sees them',
    ).toEqual([]);
  });

  /**
   * WHICH FORM IS RIGHT DEPENDS ON WHETHER THE LINE IS PRINTED OR READ, and
   * both wrong answers were live in this repo at the same time. Proved at a
   * shell, not reasoned about:
   *
   *   echo "… sh -c 'psql -U \\"$POSTGRES_USER\\" …'"   → psql -U ""
   *   echo "… sh -c 'psql -U \\"\\$POSTGRES_USER\\" …'"  → psql -U "$POSTGRES_USER"
   *   sh -c 'echo psql -U "\\$POSTGRES_USER"'          → psql -U $POSTGRES_USER
   *   sh -c 'echo psql -U "$POSTGRES_USER"'            → psql -U openmigrate
   *
   * So an `echo` needs the backslash — bash eats one level and prints a literal
   * `$` — and a COMMENT must not have it, because nothing eats it and the
   * operator copies the backslash too, leaving `sh` an ESCAPED dollar inside
   * double quotes and psql asking for a role literally named `$POSTGRES_USER`.
   *
   * Both end at the same printed text, which is the point: whatever the source
   * form, what reaches the operator is `psql -U "$POSTGRES_USER"`.
   *
   * The comment half of this shipped broken in the fix for the previous bug —
   * the guard accepted `\\$` in either context, so correcting the
   * REPROVISIONING note introduced a new way for the same line to fail.
   */
  const escapedDollar = new RegExp(`\\\\\\$\\{?(${CONTAINER_ONLY.join('|')})`);
  const bareDollar = new RegExp(`(^|[^\\\\])\\$\\{?(${CONTAINER_ONLY.join('|')})`);

  it('does NOT escape the dollars in a comment, which nothing strips', () => {
    const wrong = psqlLines.filter(({ line }) => /^\s*#/.test(line) && escapedDollar.test(line));
    expect(
      wrong.map(({ file, n, line }) => `${file}:${n}: ${line.trim()}`),
      'a comment is copied verbatim, so the backslash reaches the container and psql asks for a role named `$POSTGRES_USER`',
    ).toEqual([]);
  });

  it('DOES escape them in an echo, whose own shell would eat the name first', () => {
    // Nested single quotes inside a double-quoted `echo` protect nothing: the
    // script's shell expands `$POSTGRES_USER` before `echo` ever runs, and on a
    // machine where it is unset the hint prints `psql -U ""`. That is #487.
    const printed = psqlLines.filter(({ line }) => /\b(echo|printf)\s+"/.test(line) && !/^\s*#/.test(line));
    const wrong = printed.filter(({ line }) => !escapedDollar.test(line) && bareDollar.test(line));
    expect(
      wrong.map(({ file, n, line }) => `${file}:${n}: ${line.trim()}`),
      "the printing shell expands the name before it is printed — an unset one prints `psql -U \"\"`",
    ).toEqual([]);
    // Vacuity: this only means anything while such lines exist.
    expect(printed.length, 'no echo-printed psql hints found at all').toBeGreaterThan(0);
  });

  it('the clear-down remedy is idempotent, so a second paste is not an error', () => {
    // It is printed at a moment when somebody is already debugging; pasting it
    // twice must not add a failure to the pile they are reading.
    //
    // THIS CASE USED TO READ ONE FILE — `bootstrap-managed.sh`, where the bug
    // was found — inside the very test whose header says a guard scoped to one
    // file does not stop the class. `setup-zitadel.sh` was printing a bare
    // `DROP DATABASE zitadel` the whole time.
    const drops = scripts.flatMap(({ file, text }) =>
      text
        .split('\n')
        .map((line, i) => ({ file, n: i + 1, line }))
        .filter(({ line }) => /DROP DATABASE/.test(line)),
    );
    expect(drops.length, 'the clear-down remedy has gone missing').toBeGreaterThan(0);
    expect(
      drops
        .filter(({ line }) => !/DROP DATABASE IF EXISTS/.test(line))
        .map(({ file, n, line }) => `${file}:${n}: ${line.trim()}`),
      'DROP DATABASE without IF EXISTS errors on a second run',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
/**
 * A VOLUME NAME IS PART OF THE REMEDY, AND COMPOSE PREFIXES IT.
 *
 * `docker volume rm compose_zitadel_machinekey` sat in the REPROVISIONING note
 * that `setup-zitadel.sh`'s own 401 refusal points at. The project is
 * `ownpace-managed`, so the volume is `ownpace-managed_zitadel_machinekey` and
 * the printed name matches nothing. `docker volume rm` answers "no such
 * volume" — a line an operator working through a four-step recipe reads as
 * "already gone" rather than "you have not done this step".
 *
 * The cost of getting it wrong is precise: the provisioning token is written
 * at FIRST INIT only, so clearing the database while keeping the volume leaves
 * a token for an instance that no longer exists, and every call is refused
 * with `Errors.Token.Invalid`. E2E (managed) #50 spent a run proving it.
 *
 * Both sides are read from `managed.yml`, so a rename cannot drift past this.
 */
describe('a docker volume a human is meant to remove', () => {
  const compose = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');
  const project = /^name:\s*(\S+)/m.exec(compose)?.[1];
  // Walked line by line rather than matched as a block: the first draft ended
  // the block with `\Z`, which JavaScript reads as a literal `Z`, so it parsed
  // nothing and every volume name looked invalid. A guard that flags
  // everything is as useless as one that flags nothing.
  const declared: string[] = [];
  let inVolumes = false;
  for (const line of compose.split('\n')) {
    if (/^volumes:\s*$/.test(line)) {
      inVolumes = true;
      continue;
    }
    if (inVolumes && /^\S/.test(line)) break; // the next top-level key ends it
    const m = inVolumes ? /^ {2}([A-Za-z0-9_-]+):/.exec(line) : null;
    if (m?.[1]) declared.push(m[1]);
  }

  /** Every `docker volume rm <literal-name>` printed by a compose script. */
  const removals = scripts.flatMap(({ file, text }) =>
    text
      .split('\n')
      .map((line, i) => ({ file, n: i + 1, line }))
      .flatMap(({ file: f, n, line }) => {
        const m = /docker volume rm\s+("?)([A-Za-z0-9_.-]+)\1\s*$/.exec(line.trim());
        // A `$VARIABLE` name is resolved by the script itself, not pasted.
        return m && !line.includes('$') ? [{ file: f, n, name: m[2] as string, line }] : [];
      }),
  );

  it('read the project name and its volumes out of managed.yml', () => {
    expect(project, 'managed.yml no longer declares a project name').toBe('ownpace-managed');
    expect(declared, 'no volumes parsed out of managed.yml').toContain('zitadel_machinekey');
  });

  it('found some to check', () => {
    expect(removals.length, 'no literal `docker volume rm` lines found at all').toBeGreaterThan(0);
  });

  it('names a volume this compose project actually creates', () => {
    const valid = new Set(declared.map((v) => `${project}_${v}`));
    expect(
      removals
        .filter(({ name }) => !valid.has(name))
        .map(({ file, n, name }) => `${file}:${n}: '${name}' — no such volume; expected one of ${[...valid].join(', ')}`),
      'docker volume rm on a name that does not exist reads as "already gone"',
    ).toEqual([]);
  });
});
