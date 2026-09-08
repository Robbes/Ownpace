// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Every fixture was smaller than a chunk, so the buffering was never tested.
 *
 * Workplan 0120 found `WebdavFileSource.fetch` reading whole files into memory
 * before writing them anywhere, and T4 replaced it with a stream that hashes
 * the bytes as they pass. T6 is the reason none of that was caught earlier: the
 * largest fixture anywhere in this repository is a few hundred bytes, and the
 * threshold is 8 MB. Every gate ran the buffered branch, forever, and reported
 * green.
 *
 * So the managed gate now seeds ONE file above that threshold, and the smoke
 * compares the ledger's `content_hash` against the source file's own sha256.
 * That comparison is the whole assertion: a stream that truncates, reorders two
 * chunks, repeats one, or hashes an empty body still writes a `copied` row with
 * a plausible 64 hex characters, and only the source can tell those apart.
 *
 * ## What these tests hold, and why each one can rot
 *
 *  1. **The size stays between the two constants that decide the branch.** Below
 *     `STREAM_FILES_LARGER_THAN_BYTES` the file is buffered — the fixture then
 *     tests the branch it exists to avoid, and the gate stays green while
 *     proving nothing. At or above `MAX_BUFFERED_FILE_BYTES` the item is
 *     REFUSED, correctly, which is a different behaviour and not this one. Both
 *     ends are read from the source of truth rather than retyped, so moving a
 *     constant moves the guard with it.
 *  2. **`--remove` takes the large file back.** `--fresh` runs whenever the
 *     gate finds nothing eligible, and the file is 32 MB. A set that nothing
 *     removes would grow the demo source by roughly a third of a gigabyte a
 *     month — the measurement changing the thing it measures, which is the
 *     sentence `--remove` was written under.
 *  3. **The smoke asserts the large file BY NAME, and a missing digest fails.**
 *     The file lane already copies two small files, so `domain='file'` rows
 *     exist either way; only a named assertion can tell "the large one landed"
 *     from "some file landed". And when the source digest cannot be read there
 *     is nothing to compare — reporting the row's mere existence as success is
 *     exactly the shape that has fooled this gate twice.
 *  4. **The fixture is never committed.** 32 MB in git is refused by the `No
 *     Committed Artifacts` job and would be permanent in the history even after
 *     a later delete, so it is generated in the container at seed time.
 *
 * Read as text: these are two shell scripts driving a real Nextcloud, and what
 * is asserted is that certain commands are present and certain names agree.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STREAM_FILES_LARGER_THAN_BYTES } from '@openmig/connectors';
import { MAX_BUFFERED_FILE_BYTES } from '@openmig/shared';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

const SEEDER_PATH = 'deploy/compose/seed-demo-dav-content.sh';
const SMOKE_PATH = 'deploy/compose/smoke-managed.sh';

const seeder = read(SEEDER_PATH);
const smoke = read(SMOKE_PATH);

/** The default the seeder uses when `SEED_DAV_BIG_FILE_MB` is unset. */
function defaultBigFileMb(): number {
  const m = seeder.match(/BIG_FILE_MB="\$\{SEED_DAV_BIG_FILE_MB:-(\d+)\}"/);
  expect(
    m,
    `${SEEDER_PATH} no longer sets BIG_FILE_MB from SEED_DAV_BIG_FILE_MB with a literal default.\n` +
      'That default is the size the gate actually seeds; this guard cannot check a\n' +
      'size it cannot find.',
  ).not.toBeNull();
  return Number(m![1]);
}

describe('the gate seeds a file that is streamed, not buffered and not refused', () => {
  it('seeds a file above the streaming threshold', () => {
    const bytes = defaultBigFileMb() * 1024 * 1024;
    expect(
      bytes,
      `The managed gate seeds a ${defaultBigFileMb()} MB file, and\n` +
        `STREAM_FILES_LARGER_THAN_BYTES is ${STREAM_FILES_LARGER_THAN_BYTES} ` +
        `(${STREAM_FILES_LARGER_THAN_BYTES / 1024 / 1024} MB).\n` +
        'At or below that size the file is BUFFERED, so the fixture would exercise the\n' +
        'branch 0120 exists to avoid — and the gate would go green having proved nothing\n' +
        'about streaming, which is the state this whole workplan came out of.',
    ).toBeGreaterThan(STREAM_FILES_LARGER_THAN_BYTES);
  });

  it('seeds a file below the buffering ceiling, so it copies rather than being refused', () => {
    const bytes = defaultBigFileMb() * 1024 * 1024;
    expect(
      bytes,
      `The managed gate seeds a ${defaultBigFileMb()} MB file, and\n` +
        `MAX_BUFFERED_FILE_BYTES is ${MAX_BUFFERED_FILE_BYTES} ` +
        `(${MAX_BUFFERED_FILE_BYTES / 1024 / 1024} MB).\n` +
        'At the ceiling a path that cannot stream REFUSES the item — correct behaviour,\n' +
        'and a different one. T6 is about a file that copies.',
    ).toBeLessThan(MAX_BUFFERED_FILE_BYTES);
  });

  it('refuses a configured size outside those two constants rather than seeding it', () => {
    // The script's own refusals, so somebody setting SEED_DAV_BIG_FILE_MB=4 is
    // told why rather than getting a green run over a buffered file. Whitespace
    // is collapsed first: what matters is that each bound is followed by a
    // refusal, not how the line continuation happens to be wrapped today.
    const flat = seeder.replace(/\s+/g, ' ');
    expect(
      flat,
      'A size at or below the streaming threshold must be refused, not seeded — a\n' +
        'buffered fixture passes this gate while proving the opposite of what it claims.',
    ).toMatch(/-gt 8 \] \\ \|\| fail/);
    expect(
      flat,
      'A size at the buffering ceiling must be refused too: there the item is REFUSED\n' +
        'rather than copied, which is a different behaviour and a green run that tests it\n' +
        'says nothing about streaming.',
    ).toMatch(/-lt 256 \] \\ \|\| fail/);
  });

  it('generates the fixture in the container and never commits it', () => {
    expect(
      seeder,
      'The large file must be generated at seed time inside the Nextcloud container.',
    ).toContain('if=/dev/urandom');
    expect(
      seeder,
      'It must be removed from the container afterwards — it is only a source for one PUT.',
    ).toContain('rm -f /tmp/openmig-bigfile.bin');

    // /dev/urandom rather than /dev/zero, and the reason is not taste: a file
    // of zeros hashes identically however its chunks arrive, so a stream that
    // reordered or repeated one would still match.
    expect(seeder).not.toContain('if=/dev/zero');
  });
});

describe('the large file is taken back with the set that seeded it', () => {
  /** Just the `--remove` path, so --verify's own calls cannot answer for it. */
  function removeSection(): string {
    const from = seeder.indexOf('if [ "$REMOVE_ONLY" = "1" ]; then');
    const to = seeder.indexOf('# THE SCHEDULING CANARY');
    expect(from, 'the --remove path is gone from the seeder').toBeGreaterThan(-1);
    expect(to, 'the marker this slice ends at is gone; re-anchor it').toBeGreaterThan(from);
    return seeder.slice(from, to);
  }

  it('--remove deletes it', () => {
    expect(
      removeSection(),
      `${SEEDER_PATH}'s --remove path no longer names the large file.\n` +
        '--fresh runs whenever the gate finds nothing eligible, and the file is tens of\n' +
        'megabytes: a set nothing takes away grows the demo source without bound. That is\n' +
        'the measurement changing the thing it measures, and it is the sentence --remove\n' +
        'was written under.',
    ).toContain('BIG_FILE_NAME');
  });

  it('--remove proves the source is clean of it, rather than trusting the status codes', () => {
    // Scoped to --remove. The same `count` call also appears in --verify, so an
    // unscoped match passes while --remove's own proof has lost it — which is
    // what breaking this test showed the first version doing.
    expect(
      removeSection(),
      "--remove counts what is left before reporting success; the large file has to be in\n" +
        'that count, or a delete that silently did nothing would still report a clean\n' +
        'source. --verify carrying the same call is not a substitute: it runs on the way\n' +
        'in, not on the way out.',
    ).toContain('count "$FILES" "openmig-demo-bigfile-${SUFFIX}"');
  });

  it('--verify counts it separately from the small files', () => {
    // `openmig-demo-file-` does not match `openmig-demo-bigfile-`, so one count
    // cannot answer for the other — which is the point, not an accident.
    expect(seeder).toContain('bg=$(count "$FILES" "openmig-demo-bigfile-${SUFFIX}")');
    expect(seeder).toMatch(/present now — .*big:\$\{bg\}/);
  });
});

describe('the smoke checks the large file by name, against the source', () => {
  it('names the large file rather than accepting any file row', () => {
    expect(
      smoke,
      `${SMOKE_PATH} must scope its large-file assertion to that file's own name.\n` +
        'The file lane copies small files every fresh set, so file-domain rows exist\n' +
        'either way and a bare count cannot tell "the large one landed" from "one did".',
    ).toContain('openmig-demo-bigfile-');
  });

  it('compares the ledger content_hash against the source digest', () => {
    expect(smoke).toContain('--big-sha256');
    expect(
      smoke,
      'The assertion is the COMPARISON. A `copied` row proves a request succeeded; only\n' +
        'the source digest proves the streamed bytes were the file.',
    ).toContain('content_hash');
  });

  it('fails when the source digest cannot be read, rather than passing on the row alone', () => {
    // Bounded to the branch itself. `[\s\S]*` reaching the end of the file
    // finds SOME later `fail_at` and passes whatever this branch does — the
    // first version of this test did exactly that, and only breaking it showed
    // so. The window is the unreadable-digest arm up to its `elif`.
    const start = smoke.indexOf("could not read the source's own sha256");
    expect(start, 'the smoke no longer handles an unreadable source digest at all').toBeGreaterThan(
      -1,
    );
    const arm = smoke.slice(start, smoke.indexOf('elif [ "$src_hash"', start));
    expect(arm.length, 'the unreadable-digest arm is no longer followed by the compare').toBeGreaterThan(0);
    expect(
      arm,
      'An unreadable source digest leaves nothing to compare against. Treating the row\n' +
        "as sufficient there is the gate's oldest failure shape: green because the half\n" +
        'that mattered never ran.',
    ).toContain('fail_at');
  });

  it('rejects a row whose recorded size is under the streaming threshold', () => {
    const section = smoke.slice(smoke.indexOf('THE FILE BIGGER THAN A CHUNK LANDED'));
    expect(
      section,
      'A row recorded at a few kilobytes means the pass saw a truncated body — and a\n' +
        'truncated source would then agree with it. The size is checked so the hash\n' +
        'comparison cannot be satisfied by two matching wrongs.',
    ).toContain(String(STREAM_FILES_LARGER_THAN_BYTES));
  });
});
