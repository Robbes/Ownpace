// Copyright 2026 The Ownpace authors (Apache-2.0)

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  ARCHIVE_ITEM_KINDS,
  ArchiveUnreadable,
  type ArchiveHandle,
  type ArchiveItem,
  type ArchiveItemKind,
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
 * An EDITED version, which Google Photos names by suffixing the stem
 * (workplan 0116 T7, §4).
 *
 * `IMG_0001.jpg` edited becomes `IMG_0001-edited.jpg`. The suffix is
 * LOCALISED — a Dutch account produces `-bewerkt`, German `-bearbeitet` — and
 * an export made in a language not on this list reads its edits as ordinary
 * originals. That is the honest failure mode and the right one: the file is
 * still carried, still hashed, still counted; only its LABEL is wrong, and the
 * count still adds up. The alternative — guessing from the stem — would pair
 * two unrelated photos whose names happen to share a prefix.
 *
 * The list is what has actually been seen, per 0105: `-edited` (English) is
 * measured from a real export; the rest are recorded as EXPECTED and are owed
 * confirmation against an export made in that language. A locale missing here
 * costs a mislabel; a locale wrongly added here costs a false pairing, which
 * is why nothing is added on a translation guess alone.
 */
const EDITED_SUFFIXES = ['-edited', '-bewerkt', '-bearbeitet', '-modifié', '-editado'] as const;

/** Motion photos: an MP4 sharing a stem with a still. */
const MOTION_EXTENSION = /\.(mp4|mov)$/i;
const STILL_EXTENSION = /\.(jpe?g|heic|png)$/i;

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Which of the three things a media file is, and what it belongs to.
 *
 * `stills` maps a STEM to the still's own file name — a map rather than a set
 * because `relatedTo` names an item by its `path`, which is the file name, and
 * a stem is not one. It is also what makes the motion test honest: an MP4 on
 * its own is a video the person filmed, not a motion photo, and calling it one
 * would both mislabel it and invent a `relatedTo` pointing at nothing. Only an
 * MP4 whose still is actually present is a clip OF something.
 */
export function classifyMedia(
  mediaName: string,
  stills: ReadonlyMap<string, string>,
): { kind: ArchiveItemKind; relatedTo?: string } {
  const stem = stemOf(mediaName);
  const suffix = EDITED_SUFFIXES.find((s) => stem.endsWith(s));
  if (suffix) {
    // `relatedTo` only where the original is really here. A person can delete
    // an original in Photos and keep the edit, and a pointer at an absent item
    // would be a broken link placement later has to special-case.
    const original = stills.get(stem.slice(0, -suffix.length));
    return original ? { kind: 'edited', relatedTo: original } : { kind: 'edited' };
  }
  if (MOTION_EXTENSION.test(mediaName)) {
    const still = stills.get(stem);
    if (still) return { kind: 'motion', relatedTo: still };
  }
  return { kind: 'original' };
}

/** Stem → file name, for every STILL in the archive. See `classifyMedia`. */
export function stillsByStem(mediaNames: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  // SORTED, so two stills sharing a stem (`IMG.jpg` beside `IMG.heic`, a real
  // Takeout shape) pair the same way on every run. Unsorted, the winner is
  // `readdir` order — which is the accident that already produced one defect
  // in this reader, when the sidecar was sought beside whichever copy came
  // back first.
  for (const name of [...mediaNames].sort()) {
    if (!STILL_EXTENSION.test(name)) continue;
    const stem = stemOf(name);
    // An edited still is not the original anything points at, so it never
    // claims a stem: `IMG-edited.jpg` must not become the target of
    // `IMG-edited.mp4`'s pairing while `IMG.jpg` sits right beside it.
    if (EDITED_SUFFIXES.some((sfx) => stem.endsWith(sfx))) continue;
    if (!out.has(stem)) out.set(stem, name);
  }
  return out;
}

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

/** One walk of the tree, and everything the walk learned. */
interface Collapsed {
  readonly items: ReadonlyArray<ArchiveItem>;
  /** Content hash → the absolute path of ONE copy of those bytes. */
  readonly whereabouts: ReadonlyMap<string, string>;
}

interface TakeoutHandle extends ArchiveHandle {
  readonly root: string;
  /**
   * The collapse, ONCE per open handle (workplan 0116 T5). `summary()` and
   * `items()` used to walk and hash the whole tree each on their own, which
   * was tolerable while the measure was the only caller and is not once the
   * import asks for every item's bytes after them. Held on the handle rather
   * than the reader so two archives opened by one reader never share a walk.
   */
  collapsed?: Promise<Collapsed>;
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
  const collapse = async (handle: TakeoutHandle): Promise<Collapsed> => {
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

    // Built from EVERY media name in the archive, before anything is
    // classified: an edit in an album folder belongs to an original that may
    // only be in the year folder, so a per-folder view would pair almost
    // nothing (0116 T7).
    const stills = stillsByStem(found.map((f) => f.mediaName));

    const items: ArchiveItem[] = [];
    const whereabouts = new Map<string, string>();
    for (const [contentHash, { copies, sizeBytes }] of byHash) {
      const first = copies[0]!;
      whereabouts.set(contentHash, first.absolutePath);
      const folders = copies.map((c) => c.folder);
      const albums = folders.filter((f) => !YEAR_FOLDER.test(f));
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
      const { kind, relatedTo } = classifyMedia(first.mediaName, stills);
      items.push({
        contentHash,
        kind,
        ...(relatedTo ? { relatedTo } : {}),
        // The canonical path is the media's own name, not the folder it was
        // first met in — the folders are carried separately and placement
        // decides what to do with them.
        path: first.mediaName,
        sizeBytes,
        folders,
        // The person's albums, or — for a photo in none — the year folder,
        // which is then the only home the export gave it (0116 T5; 0112 §3's
        // "the year folder is not reproduced" is about a photo that HAS an
        // album, so the album is not written twice).
        placeIn: albums.length > 0 ? albums : folders.filter((f) => YEAR_FOLDER.test(f)),
        ...(createdAt ? { createdAt } : {}),
        metadata: {
          // Verbatim (0116 T2, rule 3): this reader cannot know which field a
          // later task needs, and the archive's link expires.
          ...(sidecar ? { sidecar } : {}),
          albums,
          years: folders.filter((f) => YEAR_FOLDER.test(f)),
          sidecarFound: sidecar !== undefined,
        },
      });
    }
    return { items, whereabouts };
  };
  const collapsedOnce = (handle: TakeoutHandle): Promise<Collapsed> =>
    (handle.collapsed ??= collapse(handle));

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
      yield* (await collapsedOnce(handle as TakeoutHandle)).items;
    },

    async content(handle: ArchiveHandle, item: ArchiveItem): Promise<Uint8Array> {
      // By hash, not by name: the same bytes sit under up to four names, and
      // any one of them serves. An item this handle never listed is a caller
      // mixing two archives, which is a bug worth a sentence and not a
      // silent read of whatever happens to be at a guessed path.
      const at = (await collapsedOnce(handle as TakeoutHandle)).whereabouts.get(item.contentHash);
      if (!at) {
        throw new Error(
          `This archive holds no item with hash ${item.contentHash.slice(0, 12)}… (${item.path}).`,
        );
      }
      return new Uint8Array(await readFile(at));
    },

    async summary(handle: ArchiveHandle): Promise<ArchiveSummary> {
      // Derived from the SAME collapse the iteration uses, so the measure can
      // never promise a number the import then contradicts.
      const { items } = await collapsedOnce(handle as TakeoutHandle);
      const dates = items.map((i) => i.createdAt).filter((d): d is string => Boolean(d)).sort();
      // Seeded with every kind at zero rather than counted up from what is
      // present, so a breakdown always has all three keys: a surface reading
      // `byKind.motion` on an archive with no motion photos must get 0, not
      // `undefined` rendering as blank beside two real numbers (0116 T7).
      const byKind = Object.fromEntries(ARCHIVE_ITEM_KINDS.map((k) => [k, 0])) as Record<
        ArchiveItemKind,
        number
      >;
      for (const item of items) byKind[item.kind] += 1;
      return {
        items: items.length,
        bytes: items.reduce((n, i) => n + i.sizeBytes, 0),
        folders: new Set(items.flatMap((i) => i.folders)).size,
        byKind,
        ...(dates[0] ? { earliest: dates[0] } : {}),
        ...(dates.at(-1) ? { latest: dates.at(-1)! } : {}),
      };
    },
  };
}
