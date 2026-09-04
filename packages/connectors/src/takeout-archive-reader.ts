// Copyright 2026 The Ownpace authors (Apache-2.0)

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  ArchiveUnreadable,
  type ArchiveHandle,
  type ArchiveItem,
  type ArchiveLocation,
  type ArchiveReader,
  type ArchiveSummary,
} from '@openmig/core/archive-reader';

/**
 * The Google Takeout reader (workplan 0116 T3a, implementing 0112 T1).
 *
 * Reads an **extracted** Takeout tree — a directory, not the `.zip`. That is a
 * deliberate limit and not an oversight: this repository carries no archive
 * dependency, adding one is a supply-chain decision nobody has taken, and
 * unzipping belongs to T4's placement (on the appliance the person already has
 * the folder; in a Drive the file arrives whole). The reader's job is the
 * archive's INSIDE.
 *
 * ## What Takeout actually looks like, and why each quirk is here
 *
 * `Takeout/Google Photos/` holds one folder per album plus one
 * `Photos from <year>` per year, and **a photo in three albums appears three
 * times, byte-identical**, plus once more in its year folder. Collapsing that is
 * this reader's first job (0116 T2's rule 1); a caller that saw four records
 * would write the image four times and every count downstream would agree with
 * itself while being wrong.
 *
 * Beside each media file sits a sidecar of metadata Google holds and the file
 * does not — a taken-time set by hand, a location added in Photos, the people
 * tagged. **Its name is where Takeout is at its worst**, and `sidecarNamesFor`
 * carries every spelling this plan has seen:
 *
 * - `<file>.supplemental-metadata.json` — current exports;
 * - `<file>.json` — older ones;
 * - both, **truncated to 51 characters**, because Takeout caps sidecar names;
 * - the `(1)` duplicate marker on the SIDECAR rather than on the file, so
 *   `IMG.jpg` can be described by `IMG.jpg(1).json`.
 *
 * A missing sidecar is not an error. The bytes are the thing being migrated and
 * they are all present; the sidecar adds what Google knew on top. An item whose
 * sidecar cannot be found is carried with empty metadata rather than skipped —
 * dropping a photo because its description could not be located would be a far
 * worse answer than carrying it plainly.
 */

/** The path inside an extracted Takeout where the photo tree lives. */
const PHOTOS_ROOT = join('Takeout', 'Google Photos');

/** `Photos from 2019` is a YEAR folder; anything else under the root is an album. */
const YEAR_FOLDER = /^Photos from (\d{4})$/;

/** Takeout caps a sidecar's filename at this many characters. */
const SIDECAR_NAME_CAP = 51;

/** Files that are metadata about the export rather than items in it. */
const NOT_AN_ITEM = /\.json$/i;

/**
 * Every sidecar spelling to try for one media file, in the order Takeout has
 * used them. Exported because the spellings ARE the finding — a reader that
 * tries only the current one silently loses every field on an older export,
 * and nothing goes red because the bytes still arrive.
 */
export function sidecarNamesFor(mediaName: string): ReadonlyArray<string> {
  const full = `${mediaName}.supplemental-metadata.json`;
  const short = `${mediaName}.json`;
  // The `(1)` marker lands on the sidecar, after the media extension, so it is
  // built from the media name rather than found by stripping one off.
  const dupFull = `${mediaName}.supplemental-metadata(1).json`;
  const dupShort = `${mediaName}(1).json`;
  const candidates = [full, short, dupFull, dupShort];
  // Truncation is applied to what Takeout would have written, so a capped name
  // is tried in addition to — never instead of — the full one.
  const truncated = candidates
    .filter((name) => name.length > SIDECAR_NAME_CAP)
    .map((name) => name.slice(0, SIDECAR_NAME_CAP));
  return [...new Set([...candidates, ...truncated])];
}

/** What one sidecar is worth keeping, named as Google names it. */
interface Sidecar {
  readonly title?: string;
  readonly description?: string;
  readonly photoTakenTime?: { readonly timestamp?: string };
  readonly geoData?: { readonly latitude?: number; readonly longitude?: number; readonly altitude?: number };
  readonly people?: ReadonlyArray<{ readonly name?: string }>;
  readonly favorited?: boolean;
}

interface Found {
  readonly absolutePath: string;
  readonly folder: string;
  readonly isYearFolder: boolean;
  readonly mediaName: string;
}

interface TakeoutHandle extends ArchiveHandle {
  readonly root: string;
}

async function listFolders(photosRoot: string): Promise<string[]> {
  const entries = await readdir(photosRoot, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function findMedia(photosRoot: string): Promise<Found[]> {
  const out: Found[] = [];
  for (const folder of await listFolders(photosRoot)) {
    const isYearFolder = YEAR_FOLDER.test(folder);
    const dir = join(photosRoot, folder);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || NOT_AN_ITEM.test(entry.name)) continue;
      out.push({ absolutePath: join(dir, entry.name), folder, isYearFolder, mediaName: entry.name });
    }
  }
  return out;
}

async function readSidecar(dir: string, mediaName: string): Promise<Sidecar | undefined> {
  for (const name of sidecarNamesFor(mediaName)) {
    try {
      return JSON.parse(await readFile(join(dir, name), 'utf8')) as Sidecar;
    } catch {
      // Missing, or not JSON. Try the next spelling; an absent sidecar is a
      // legitimate state and the loop falling through is how that is said.
    }
  }
  return undefined;
}

/** `photoTakenTime.timestamp` is seconds since the epoch, as a STRING. */
function takenAt(sidecar: Sidecar | undefined): string | undefined {
  const seconds = Number(sidecar?.photoTakenTime?.timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

export function createTakeoutArchiveReader(): ArchiveReader {
  const collapse = async (handle: TakeoutHandle): Promise<ArchiveItem[]> => {
    const photosRoot = join(handle.root, PHOTOS_ROOT);
    const found = await findMedia(photosRoot);

    // Keyed by content hash: the same bytes under three albums and a year are
    // ONE item that four folders knew about (0116 T2, rule 1).
    const byHash = new Map<string, { copies: Found[]; sizeBytes: number }>();
    for (const item of found) {
      const bytes = await readFile(item.absolutePath);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const seen = byHash.get(hash);
      if (seen) {
        seen.copies.push(item);
        continue;
      }
      byHash.set(hash, { copies: [item], sizeBytes: bytes.byteLength });
    }

    const items: ArchiveItem[] = [];
    for (const [contentHash, { copies, sizeBytes }] of byHash) {
      const first = copies[0]!;
      const folders = copies.map((c) => c.folder);
      // EVERY copy is asked, not just the first one met. Takeout writes the
      // sidecar beside ONE of the copies — often the year folder's — and which
      // copy `readdir` returns first is alphabetical accident. Looking only
      // there finds the metadata for some photos and not others, and the ones
      // it misses still arrive, silently stripped of their dates, locations and
      // descriptions. Caught by the fixture rather than by reasoning.
      let sidecar: Sidecar | undefined;
      for (const copy of copies) {
        sidecar = await readSidecar(join(photosRoot, copy.folder), copy.mediaName);
        if (sidecar) break;
      }
      const createdAt = takenAt(sidecar);
      items.push({
        contentHash,
        // The canonical path is the media's own name, not the folder it was
        // first met in — the folders are carried separately and placement
        // decides what to do with them.
        path: first.mediaName,
        sizeBytes,
        folders,
        ...(createdAt ? { createdAt } : {}),
        metadata: {
          // Verbatim (0116 T2, rule 3): this reader cannot know which field a
          // later task needs, and the archive's link expires.
          ...(sidecar ? { sidecar } : {}),
          albums: folders.filter((f) => !YEAR_FOLDER.test(f)),
          years: folders.filter((f) => YEAR_FOLDER.test(f)),
          sidecarFound: sidecar !== undefined,
        },
      });
    }
    return items;
  };

  return {
    provider: 'google-takeout',

    async open(location: ArchiveLocation): Promise<ArchiveHandle> {
      if (location.provider !== 'google-takeout') {
        throw new ArchiveUnreadable(
          `This reader opens Google Takeout archives, and this one is a ${location.provider} export.`,
        );
      }
      const photosRoot = join(location.path, PHOTOS_ROOT);
      try {
        const info = await stat(photosRoot);
        if (!info.isDirectory()) throw new Error('not a directory');
      } catch (cause) {
        // The common case, and it must read as "we could not open this" rather
        // than as an empty library: an unfinished download, a part never
        // fetched, or a folder that is not a Takeout at all.
        throw new ArchiveUnreadable(
          `This archive could not be opened — no “${PHOTOS_ROOT}” folder was found in ` +
            `${basename(location.path) || location.path}. If the download is still ` +
            'running, or only some parts arrived, it will look like this.',
          { cause },
        );
      }
      return { provider: 'google-takeout', root: location.path, close: async () => {} } as TakeoutHandle;
    },

    async *items(handle: ArchiveHandle): AsyncIterable<ArchiveItem> {
      yield* await collapse(handle as TakeoutHandle);
    },

    async summary(handle: ArchiveHandle): Promise<ArchiveSummary> {
      // Derived from the SAME collapse the iteration uses, so the measure can
      // never promise a number the import then contradicts.
      const items = await collapse(handle as TakeoutHandle);
      const dates = items.map((i) => i.createdAt).filter((d): d is string => Boolean(d)).sort();
      return {
        items: items.length,
        bytes: items.reduce((n, i) => n + i.sizeBytes, 0),
        folders: new Set(items.flatMap((i) => i.folders)).size,
        ...(dates[0] ? { earliest: dates[0] } : {}),
        ...(dates.at(-1) ? { latest: dates.at(-1)! } : {}),
      };
    },
  };
}
