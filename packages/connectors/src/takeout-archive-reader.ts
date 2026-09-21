// Copyright 2026 The Ownpace authors (Apache-2.0)

import { createHash } from 'node:crypto';
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
import { localStore, type ArchiveStore } from './archive-store.ts';
import { openZipTree, type ArchiveTree } from './archive-tree.ts';
import { ZipUnreadable } from './zip-archive.ts';

/**
 * The Google Takeout reader (workplan 0116 T3a, implementing 0112 T1).
 *
 * Reads a Takeout as the person has it: the folder they extracted, or the
 * `.zip` download itself — one part, or every part of a multi-part download
 * from any one of them. Until 2026-09-20 this read an extracted tree only,
 * because the repository carried no zip reader and taking one on was a
 * supply-chain decision (0116 D7); the owner decided on a reader of our own,
 * `zip-archive.ts`, and the tree seam in `archive-tree.ts` is what lets this
 * file not know which container it is reading. The reader's job is the
 * archive's INSIDE; the container is the tree's.
 *
 * ## What Takeout actually looks like, and why each quirk is here
 *
 * The photo tree — `Takeout/Google Photos/` in English, `Takeout/Google Foto_s`
 * in Dutch, and so on, which is why `findPhotosRoot` looks for it rather than
 * naming it — holds one folder per album plus one `Photos from <year>` per
 * year, and **a photo in three albums appears three times, byte-identical**,
 * plus once more in its year folder. Collapsing that is this reader's first
 * job (0116 T2's rule 1); a caller that saw four records
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

/**
 * The folder every Takeout puts its products under. English in every export
 * seen so far, including a Dutch one (owner, 2026-09-21) — it is the only part
 * of the path that is NOT translated.
 */
const TAKEOUT_ROOT = 'Takeout';

/*
 * WHAT A TAKEOUT'S PHOTO TREE IS CALLED, WHICH IS NOT ONE THING.
 *
 * This was `Takeout/Google Photos`, a constant, and it was wrong for everyone
 * who does not use Google in English. The owner's own 45 GB export
 * (2026-09-21) holds `Takeout/Google Foto_s` with `Foto_s van 2025` inside it
 * — Dutch, with `'` written as `_` — and the reader refused the whole export
 * with a sentence blaming his download. He would have re-fetched 45 GB to be
 * told the same thing again.
 *
 * Worth recording precisely, because it fooled me first: Takeout's own
 * **picker** lists these folders in ENGLISH (`Photos from 2011`, `Trash`) even
 * in a Dutch account. Only the paths are translated, and a display name is not
 * a path — this file needs the path. (`archive_browser.html`, the report in
 * part 001, is the other way round: its folder names ARE the translated paths,
 * and its one English key, `data-english-name`, names the SERVICE only.)
 *
 * So the root is FOUND, not named: see `findPhotosRoot`, one level under
 * `Takeout`, the folder whose own subfolders hold photos. That is what a photo
 * tree IS, in any language.
 */

/** A sidecar is a `.json` beside the media, never an item in its own right. */
const SIDECAR_JSON = /\.json$/i;

/**
 * WHICH OF THREE THINGS A FOLDER UNDER THE PHOTO TREE IS.
 *
 * Takeout puts albums, year folders and the bin side by side, and until
 * 2026-09-21 this file told them apart with `/^Photos from (\d{4})$/` — a
 * constant, in English, that every translated export fell through. Under a
 * Dutch root EVERY folder read as an album, year folders included, so a photo
 * that HAS an album was placed under its year folder as well.
 *
 * MEASURED, on the owner's two real exports rather than reasoned about:
 *
 * | folder                     | own `metadata.json` | bucket |
 * |----------------------------|---------------------|--------|
 * | `Foto_s van 2024/25/26`    | no (all three)      | year   |
 * | `Reis`, `Test Album_1$#_`  | YES (both)          | album  |
 * | `Prullenbak` (the bin)     | no                  | other  |
 *
 * So an album is known POSITIVELY, by carrying its own `metadata.json`, and
 * that is what makes the rest safe: the year test only has to catch what is
 * left, so an album called `Thailand 2019` is claimed by the album rule before
 * the year rule ever sees it. No part of this reads English.
 *
 * The bin is the third bucket and it is SKIPPED (owner, 2026-09-21: *"we
 * should leave out Trash ... and we should not move it to target"*). Anything
 * else that is neither album nor year lands there too, which is the
 * conservative direction: a folder this reader cannot account for is not
 * copied, and the summary says it was skipped and how much was in it.
 */
const YEAR_IN_NAME = /(?:^|\D)(?:19|20)\d{2}(?:\D|$)/;

/** The file an album folder carries and a year folder does not. */
const ALBUM_METADATA = 'metadata.json';

/** What an album's own `metadata.json` holds, as far as this reader reads it. */
export interface AlbumMetadata {
  readonly title?: string;
  readonly description?: string;
  /** `"protected"` on an album the person shared. Verbatim; never interpreted here. */
  readonly access?: string;
  readonly [key: string]: unknown;
}

/** A folder under the photo tree, and which of the three things it is. */
export type FolderKind =
  | { readonly kind: 'album'; readonly title: string; readonly metadata: AlbumMetadata }
  | { readonly kind: 'year' }
  | { readonly kind: 'other' };

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
  /** Where in the tree, `/`-separated. */
  readonly treePath: string;
  readonly folder: string;
  readonly mediaName: string;
}

/** One walk of the tree, and everything the walk learned. */
/** What was deliberately left behind, so nothing is dropped in silence. */
export interface Skipped {
  readonly folders: ReadonlyArray<string>;
  readonly items: number;
}

interface Collapsed {
  readonly items: ReadonlyArray<ArchiveItem>;
  /** Content hash → the tree path of ONE copy of those bytes. */
  readonly whereabouts: ReadonlyMap<string, string>;
  /** The bin and anything else this reader could not account for. */
  readonly skipped: Skipped;
  /** Every album the export carried, by folder name, with its own metadata verbatim. */
  readonly albums: ReadonlyMap<string, { readonly title: string; readonly metadata: AlbumMetadata }>;
}

interface TakeoutHandle extends ArchiveHandle {
  /** The folder or the zip(s), behind the seam. Closed with the handle. */
  readonly tree: ArchiveTree;
  /** Where this export's photo tree was FOUND — see {@link findPhotosRoot}. Not a constant. */
  readonly photosRoot: string;
  /**
   * The collapse, ONCE per open handle (workplan 0116 T5). `summary()` and
   * `items()` used to walk and hash the whole tree each on their own, which
   * was tolerable while the measure was the only caller and is not once the
   * import asks for every item's bytes after them. Held on the handle rather
   * than the reader so two archives opened by one reader never share a walk.
   */
  collapsed?: Promise<Collapsed>;
}

/**
 * Folders and files SORTED, whatever order the tree lists them in. A folder
 * on disk and a zip of the same export list their entries in each one's own
 * order, and the reader's `folders`, `placeIn` and `metadata.albums` follow
 * the order the copies were met — so without this the same export answered
 * differently depending on whether the person had pressed "extract", and the
 * manifest's bytes with it. Caught by the four-layout test, not by reasoning.
 */
const byName = (a: { readonly name: string }, b: { readonly name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * How many of a product folder's own subfolders to look inside before deciding
 * it is not the photo tree. A Takeout lists year folders and albums together,
 * so the first few are enough — and on the relay each `list` is a PROPFIND
 * against the customer's server, so this is a budget, not a formality.
 */
const FOLDERS_PROBED = 4;

/**
 * THE PHOTO TREE, FOUND RATHER THAN NAMED (the block comment above says why).
 *
 * One level under `Takeout`, the folder whose own subfolders hold PHOTOS. Two
 * questions, strongest first, because neither alone is enough:
 *
 * 1. a media file with its sidecar beside it. That shape is what a Google
 *    Photos export IS — a Drive or Mail export under the same `Takeout` has no
 *    such pairs — and it survives translation, which `'Google Photos'` did not;
 * 2. failing that, in ANY product, a still or a motion clip by extension.
 *    "A missing sidecar is not an error" is this file's own rule, so a library
 *    whose sidecars are all absent is still a library.
 *
 * Both are needed, and in that order. Question 1 alone refuses a sidecar-less
 * export outright — the same class of defect as naming the root, and how this
 * was found. Question 2 alone lets a Drive export with one holiday snap in it
 * win on sort order, since `Drive` sorts before `Google Foto_s`.
 *
 * Returns the path, or `undefined` with the product folders it DID see, so the
 * refusal can name them instead of guessing at the person's download.
 */
async function findPhotosRoot(
  tree: ArchiveTree,
): Promise<{ readonly root?: string; readonly sawProducts: ReadonlyArray<string> }> {
  if (!(await tree.isDirectory(TAKEOUT_ROOT))) return { sawProducts: [] };
  const products = (await tree.list(TAKEOUT_ROOT)).filter((e) => e.isDirectory).sort(byName);
  const probed: { readonly root: string; readonly folders: ReadonlyArray<ReadonlySet<string>> }[] = [];
  for (const product of products) {
    const root = `${TAKEOUT_ROOT}/${product.name}`;
    const inside = (await tree.list(root)).filter((e) => e.isDirectory).sort(byName);
    const folders: Set<string>[] = [];
    for (const folder of inside.slice(0, FOLDERS_PROBED)) {
      const entries = await tree.list(`${root}/${folder.name}`);
      folders.push(new Set(entries.filter((e) => !e.isDirectory).map((e) => e.name)));
    }
    // First pass, and it returns the moment it is satisfied: the listings above
    // cost a PROPFIND each on the relay, so a Takeout of photos alone — the
    // ordinary case — probes one product and stops.
    if (folders.some(holdsASidecarPair)) return { root, sawProducts: [] };
    probed.push({ root, folders });
  }
  // Second pass, over what was already listed. A photo tree whose sidecars are
  // all absent is still a photo tree: "a missing sidecar is not an error" is
  // this reader's own rule, and a first pass that stood alone would refuse such
  // an export outright — which is the same class of defect as naming the root.
  // Weaker evidence, so it runs only when NO product answered the first pass:
  // that ordering is what stops a Drive export with one holiday snap in it from
  // out-voting a photo tree that has its metadata.
  const byMediaAlone = probed.find((candidate) => candidate.folders.some(holdsMedia));
  if (byMediaAlone) return { root: byMediaAlone.root, sawProducts: [] };
  return { sawProducts: products.map((p) => p.name) };
}

/**
 * A media file with its sidecar beside it — the PAIR, never a `.json` alone.
 * An album's own `metadata.json` has no media of that name beside it, and a
 * folder holding only sidecars is not a tree of photos either.
 */
function holdsASidecarPair(names: ReadonlySet<string>): boolean {
  for (const name of names) {
    if (SIDECAR_JSON.test(name)) continue;
    if (sidecarNamesFor(name).some((sidecar) => names.has(sidecar))) return true;
  }
  return false;
}

/** A still or a motion clip, by the same extensions `classifyMedia` knows. */
function holdsMedia(names: ReadonlySet<string>): boolean {
  for (const name of names) {
    if (STILL_EXTENSION.test(name) || MOTION_EXTENSION.test(name)) return true;
  }
  return false;
}

async function listFolders(tree: ArchiveTree, root: string): Promise<string[]> {
  return (await tree.list(root))
    .filter((e) => e.isDirectory)
    .sort(byName)
    .map((e) => e.name);
}

/**
 * Every folder under the photo tree, sorted into the three buckets
 * {@link FolderKind} describes.
 *
 * One `metadata.json` read per folder — a handful of reads for an export with
 * a handful of folders, and on the relay a GET each. A folder whose
 * `metadata.json` is absent or unreadable is NOT an album: absent is the year
 * folder's normal state, and unreadable is not evidence of album-ness.
 */
async function classifyFolders(
  tree: ArchiveTree,
  root: string,
): Promise<Map<string, FolderKind>> {
  const out = new Map<string, FolderKind>();
  for (const folder of await listFolders(tree, root)) {
    const metadata = await readAlbumMetadata(tree, `${root}/${folder}`);
    if (metadata) {
      // The title is the person's OWN spelling, which the folder name is not:
      // Takeout writes `Test Album'1$#%` to disk as `Test Album_1$#_`, so the
      // folder has already lost characters the metadata still has.
      const title = typeof metadata.title === 'string' && metadata.title !== '' ? metadata.title : folder;
      out.set(folder, { kind: 'album', title, metadata });
      continue;
    }
    out.set(folder, YEAR_IN_NAME.test(folder) ? { kind: 'year' } : { kind: 'other' });
  }
  return out;
}

async function readAlbumMetadata(tree: ArchiveTree, dir: string): Promise<AlbumMetadata | undefined> {
  try {
    const parsed: unknown = JSON.parse(utf8.decode(await tree.read(`${dir}/${ALBUM_METADATA}`)));
    // An album's metadata is an OBJECT. A `metadata.json` holding an array or
    // a bare string is not one, and calling it an album on the strength of the
    // file name alone would put a year folder in the wrong bucket.
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as AlbumMetadata)
      : undefined;
  } catch {
    // Absent (the year folder's normal state) or unreadable. Neither is
    // evidence of an album, and neither is an error.
    return undefined;
  }
}

async function findMedia(
  tree: ArchiveTree,
  root: string,
  kinds: ReadonlyMap<string, FolderKind>,
): Promise<{ readonly found: Found[]; readonly skipped: Skipped }> {
  const out: Found[] = [];
  const skippedFolders: string[] = [];
  let skippedItems = 0;
  for (const [folder, kind] of kinds) {
    const dir = `${root}/${folder}`;
    const entries = [...(await tree.list(dir))].sort(byName);
    const media = entries.filter((e) => !e.isDirectory && !NOT_AN_ITEM.test(e.name));
    if (kind.kind === 'other') {
      // The bin, and anything else this reader cannot account for. Counted so
      // the person is told what was left behind, never silently dropped.
      skippedFolders.push(folder);
      skippedItems += media.length;
      continue;
    }
    for (const entry of media) {
      out.push({ treePath: `${dir}/${entry.name}`, folder, mediaName: entry.name });
    }
  }
  return { found: out, skipped: { folders: skippedFolders, items: skippedItems } };
}

const utf8 = new TextDecoder();

async function readSidecar(tree: ArchiveTree, dir: string, mediaName: string): Promise<Sidecar | undefined> {
  for (const name of sidecarNamesFor(mediaName)) {
    try {
      return JSON.parse(utf8.decode(await tree.read(`${dir}/${name}`))) as Sidecar;
    } catch {
      // Missing, or not JSON. Try the next spelling; an absent sidecar is a
      // legitimate state and the loop falling through is how that is said.
    }
  }
  return undefined;
}

/**
 * SHA-256 and size of one file, STREAMED (0116 T2 rule 2; 0120 T5).
 *
 * Streamed rather than read whole, on both trees: a video in a photo library
 * is routinely larger than the two gigabytes `readFile` will return, and the
 * zip tree inflates as it goes — so the walk that opens an archive holds one
 * chunk at a time whatever the item weighs. The hash is the same one the file
 * domain computes over the same bytes, whichever door they came through.
 */
async function fingerprint(tree: ArchiveTree, path: string): Promise<{ hash: string; sizeBytes: number }> {
  const digest = createHash('sha256');
  let sizeBytes = 0;
  const stream = await tree.stream(path);
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    digest.update(chunk);
    sizeBytes += chunk.byteLength;
  }
  return { hash: digest.digest('hex'), sizeBytes };
}

/**
 * The zip reader's refusal, said as the archive's.
 *
 * `ZipUnreadable` is about a container and `ArchiveUnreadable` about the
 * export, and the surfaces render only the second as "we could not open
 * this" with the reason (0116 §1). A member whose bytes fail their CRC-32
 * check half-way through the walk is exactly that case: a corrupt download,
 * never a smaller library. Anything that is neither is a programming error
 * and passes through untouched.
 */
function asArchiveError(err: unknown): unknown {
  if (err instanceof ZipUnreadable) {
    return new ArchiveUnreadable(`This archive could not be read — ${err.reason}`, { cause: err });
  }
  return err;
}

/** `takeout-20240506T070810Z-003.zip` → stem `takeout-20240506T070810Z`, index `003`. */
const PART_NAME = /^(.+)-(\d+)\.zip$/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every part of a multi-part download, from any one of its parts.
 *
 * Google numbers the parts `-001`, `-002`, … after one stamp, so the set is
 * "the same name with another number" in the same folder, in number order.
 * A name whose number has no leading zero (`photos-2024.zip`) is not read as
 * a part: that is a file somebody named, and it is opened alone.
 *
 * A GAP IN THE NUMBERING IS REFUSED, with the missing parts named. The photos
 * in a part that never finished downloading would otherwise simply be absent
 * — an import that carries most of a library and says nothing about the
 * rest, the silent kind of wrong 0116 §1 exists to prevent. Only a gap can be
 * seen: a LAST part that never arrived leaves no hole in the numbering, and
 * the guide says so.
 */
export async function takeoutPartsBeside(zipPath: string, store: ArchiveStore = localStore()): Promise<string[]> {
  const { folder, name } = store.split(zipPath);
  const match = PART_NAME.exec(name);
  if (!match || !match[2]!.startsWith('0')) return [zipPath];
  const stem = match[1]!;
  const width = match[2]!.length;
  const sibling = new RegExp(`^${escapeRegExp(stem)}-(\\d+)\\.zip$`, 'i');
  const parts: Array<{ readonly path: string; readonly number: number }> = [];
  for (const candidate of await store.list(folder)) {
    const found = sibling.exec(candidate);
    if (found) parts.push({ path: store.join(folder, candidate), number: Number(found[1]) });
  }
  parts.sort((a, b) => a.number - b.number);
  const have = new Set(parts.map((p) => p.number));
  const last = parts[parts.length - 1]?.number ?? 0;
  const missing: string[] = [];
  for (let n = 1; n <= last; n += 1) {
    if (!have.has(n)) missing.push(`${stem}-${String(n).padStart(width, '0')}.zip`);
  }
  if (missing.length > 0) {
    throw new ArchiveUnreadable(
      `This archive could not be opened — ${missing.length === 1 ? 'a part is' : `${missing.length} parts are`} ` +
        `missing beside ${name}: ${missing.join(', ')}. A download that never finished looks ` +
        'like this; fetch the missing part into the same folder, or extract every part into one folder and point at that.',
    );
  }
  return parts.map((p) => p.path);
}

const TARBALL = /\.(tgz|tar\.gz|tar)$/i;
const ZIP = /\.zip$/i;

/**
 * The tree behind a location: the folder the person extracted, or the
 * download itself — on the appliance's disk, or inside the customer's own
 * file target (0116 T4, the relay), whichever store the reader was given.
 * Everything refused here is refused with the sentence the surfaces show,
 * because every case is one the person can act on — and none of them may
 * read as an empty library.
 */
async function openTakeoutTree(store: ArchiveStore, path: string): Promise<ArchiveTree> {
  const found = await store.stat(path);
  if (found.kind === 'absent') {
    throw new ArchiveUnreadable(
      `This archive could not be opened — nothing is at ${store.describe(path)}. If the download is still ` +
        'running, or was saved somewhere else, it will look like this.',
    );
  }
  if (found.kind === 'folder') return store.folderTree(path);
  const { name } = store.split(path);
  if (TARBALL.test(name)) {
    throw new ArchiveUnreadable(
      `This archive could not be opened — ${name} is a tar archive, and we read .zip downloads and ` +
        'extracted folders. Google offers .zip when the export is requested; or extract this one and point at the folder.',
    );
  }
  if (!ZIP.test(name)) {
    throw new ArchiveUnreadable(`This archive could not be opened — ${name} is a file, not a folder or a .zip download.`);
  }
  try {
    return await openZipTree(await takeoutPartsBeside(path, store), (part) => store.source(part));
  } catch (err) {
    if (err instanceof ArchiveUnreadable) throw err;
    // The zip reader's sentence names what it found (a spanned set, a
    // directory beyond the end of the file, a member cut short); ours adds
    // what most often causes it.
    const reason = err instanceof ZipUnreadable ? err.reason : err instanceof Error ? err.message : String(err);
    throw new ArchiveUnreadable(
      `This archive could not be opened — ${reason} If the download is still running, or only some parts ` +
        'arrived, it will look like this.',
      { cause: err },
    );
  }
}

/** `photoTakenTime.timestamp` is seconds since the epoch, as a STRING. */
function takenAt(sidecar: Sidecar | undefined): string | undefined {
  const seconds = Number(sidecar?.photoTakenTime?.timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

/**
 * @param store where locations point: the appliance's disk unless the caller
 *   says otherwise. The managed edition hands the customer's file target
 *   (`webdavStore`), and the reader is none the wiser.
 */
export function createTakeoutArchiveReader(store: ArchiveStore = localStore()): ArchiveReader {
  const collapse = async (handle: TakeoutHandle): Promise<Collapsed> => {
    try {
      return await walk(handle.tree, handle.photosRoot);
    } catch (err) {
      throw asArchiveError(err);
    }
  };
  const walk = async (tree: ArchiveTree, root: string): Promise<Collapsed> => {
    const kinds = await classifyFolders(tree, root);
    const { found, skipped } = await findMedia(tree, root, kinds);
    const albums = new Map(
      [...kinds].flatMap(([folder, kind]) =>
        kind.kind === 'album' ? [[folder, { title: kind.title, metadata: kind.metadata }] as const] : [],
      ),
    );
    const isAlbum = (folder: string): boolean => kinds.get(folder)?.kind === 'album';
    const isYear = (folder: string): boolean => kinds.get(folder)?.kind === 'year';

    // Keyed by content hash: the same bytes under three albums and a year are
    // ONE item that four folders knew about (0116 T2, rule 1).
    const byHash = new Map<string, { copies: Found[]; sizeBytes: number }>();
    for (const item of found) {
      const { hash, sizeBytes } = await fingerprint(tree, item.treePath);
      const seen = byHash.get(hash);
      if (seen) {
        seen.copies.push(item);
        continue;
      }
      byHash.set(hash, { copies: [item], sizeBytes });
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
      whereabouts.set(contentHash, first.treePath);
      const folders = copies.map((c) => c.folder);
      const inAlbums = folders.filter(isAlbum);
      // EVERY copy is asked, not just the first one met. Takeout writes the
      // sidecar beside ONE of the copies — often the year folder's — and which
      // copy `readdir` returns first is alphabetical accident. Looking only
      // there finds the metadata for some photos and not others, and the ones
      // it misses still arrive, silently stripped of their dates, locations and
      // descriptions. Caught by the fixture rather than by reasoning.
      let sidecar: Sidecar | undefined;
      for (const copy of copies) {
        sidecar = await readSidecar(tree, `${root}/${copy.folder}`, copy.mediaName);
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
        placeIn: inAlbums.length > 0 ? inAlbums : folders.filter(isYear),
        ...(createdAt ? { createdAt } : {}),
        metadata: {
          // Verbatim (0116 T2, rule 3): this reader cannot know which field a
          // later task needs, and the archive's link expires.
          ...(sidecar ? { sidecar } : {}),
          albums: inAlbums,
          // The person's OWN spelling, which the folder names have lost:
          // `Test Album'1$#%` reaches disk as `Test Album_1$#_`.
          albumTitles: inAlbums.map((f) => albums.get(f)?.title ?? f),
          years: folders.filter(isYear),
          sidecarFound: sidecar !== undefined,
        },
      });
    }
    return { items, whereabouts, skipped, albums };
  };
  const collapsedOnce = (handle: TakeoutHandle): Promise<Collapsed> =>
    (handle.collapsed ??= collapse(handle));

  /**
   * Where an item's bytes are, BY HASH rather than by name.
   *
   * The same bytes sit under up to four names in a Takeout and any one of them
   * serves. An item this handle never listed is a caller mixing two archives,
   * which is a bug worth a sentence and not a silent read of whatever happens to
   * be at a guessed path.
   *
   * Shared by `content` and `contentStream` so the buffered and streamed reads
   * can never resolve to different files — which would be invisible, since both
   * would return plausible bytes.
   */
  async function locate(handle: ArchiveHandle, item: ArchiveItem): Promise<string> {
    const at = (await collapsedOnce(handle as TakeoutHandle)).whereabouts.get(item.contentHash);
    if (!at) {
      throw new Error(
        `This archive holds no item with hash ${item.contentHash.slice(0, 12)}… (${item.path}).`,
      );
    }
    return at;
  }

  return {
    provider: 'google-takeout',

    async open(location: ArchiveLocation): Promise<ArchiveHandle> {
      if (location.provider !== 'google-takeout') {
        throw new ArchiveUnreadable(
          `This reader opens Google Takeout archives, and this one is a ${location.provider} export.`,
        );
      }
      const tree = await openTakeoutTree(store, location.path);
      const { root, sawProducts } = await findPhotosRoot(tree);
      if (root === undefined) {
        await tree.close().catch(() => {});
        const where = store.split(location.path).name || store.describe(location.path);
        // It must read as "we could not open this" rather than as an empty
        // library — and it must now name WHAT WAS THERE. The sentence this
        // replaces said only that `Takeout/Google Photos` was absent and
        // blamed an unfinished download, which for a translated export was
        // both true and useless: the owner's Dutch 45 GB export is
        // `Takeout/Google Foto_s`, and re-fetching it would have said the
        // same thing again (2026-09-21).
        throw new ArchiveUnreadable(
          sawProducts.length > 0
            ? `This archive could not be opened — ${where} holds ${sawProducts.map((p) => `“${p}”`).join(', ')} ` +
              'under Takeout, and none of them holds photos with their metadata beside them. A Takeout of ' +
              'something other than Google Photos looks like this; so does an export whose photo parts have ' +
              'not all arrived.'
            : `This archive could not be opened — no “${TAKEOUT_ROOT}” folder was found in ${where}. If the ` +
              'download is still running, or only some parts arrived, it will look like this.',
        );
      }
      const handle: TakeoutHandle = {
        provider: 'google-takeout',
        tree,
        photosRoot: root,
        close: () => tree.close(),
      };
      return handle;
    },

    async *items(handle: ArchiveHandle): AsyncIterable<ArchiveItem> {
      yield* (await collapsedOnce(handle as TakeoutHandle)).items;
    },

    async content(handle: ArchiveHandle, item: ArchiveItem): Promise<Uint8Array> {
      const at = await locate(handle, item);
      try {
        return await (handle as TakeoutHandle).tree.read(at);
      } catch (err) {
        throw asArchiveError(err);
      }
    },

    /**
     * The same file, as a stream (0120 T5).
     *
     * Cheap here in a way it is not for any other connector: an item is a
     * file in a folder, or one member of a zip read by byte range, and
     * re-opening is one more read from its first byte — no second pass over
     * the archive, no re-issued request, no signed URL to expire. It resolves
     * the path through the SAME `locate` the buffered read uses, so the two
     * cannot come to disagree about which of Takeout's four copies is the
     * item.
     */
    async contentStream(handle: ArchiveHandle, item: ArchiveItem): Promise<ReadableStream<Uint8Array>> {
      const at = await locate(handle, item);
      try {
        return await (handle as TakeoutHandle).tree.stream(at);
      } catch (err) {
        throw asArchiveError(err);
      }
    },

    async summary(handle: ArchiveHandle): Promise<ArchiveSummary> {
      // Derived from the SAME collapse the iteration uses, so the measure can
      // never promise a number the import then contradicts.
      const { items, skipped, albums } = await collapsedOnce(handle as TakeoutHandle);
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
        ...(skipped.folders.length > 0 ? { skipped } : {}),
        ...(albums.size > 0
          ? {
              albums: [...albums].map(([folder, a]) => ({
                folder,
                title: a.title,
                ...(Array.isArray(a.metadata.sharedAlbumComments) &&
                a.metadata.sharedAlbumComments.length > 0
                  ? { shareActivity: true as const }
                  : {}),
                metadata: a.metadata,
              })),
            }
          : {}),
      };
    },
  };
}
