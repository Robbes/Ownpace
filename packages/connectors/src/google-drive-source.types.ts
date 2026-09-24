// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Shapes for the Google Drive source (workplan 0042, first slice).
 *
 * Kept beside the connector rather than in `@openmig/shared` for the same
 * reason `graph-drive-source.types.ts` is: these describe Google's wire format,
 * which is Google's business and nobody else's. The one exception is
 * `NativeFilePolicy`, which is a product decision an owner writes in a mapping —
 * see its comment below.
 */

import type { GoogleNativeFilePolicy, NativeFilePolicies } from '@openmig/shared';

/** What a Drive file looks like on the wire, reduced to the fields used. */
export interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  /** Absent on native editor files — they have no bytes and therefore no size. */
  readonly size?: string;
  /** Absent on native editor files, and on some shortcuts. */
  readonly md5Checksum?: string;
  readonly modifiedTime?: string;
  readonly createdTime?: string;
  readonly parents?: readonly string[];
  readonly trashed?: boolean;
}

export interface DriveFileList {
  readonly files?: readonly DriveFile[];
  readonly nextPageToken?: string;
}

/**
 * What to do with a Google Doc, Sheet or Slide.
 *
 * ONE definition, in `@openmig/shared` — see `GoogleNativeFilePolicy` there for
 * why the default is `refuse` and what an export policy still leaves unproven.
 * It lives there rather than here because it is a product decision that appears
 * in a mapping file, unlike everything else in this file, which is Google's wire
 * format. Two copies of three string literals is exactly how a config value comes
 * to mean one thing to the parser and another to the connector.
 */
export type NativeFilePolicy = GoogleNativeFilePolicy;

/**
 * Export MIME types, for when the policy is not `refuse`.
 *
 * Drive renders these server-side (`files.export`) — no converter of ours is
 * involved, which is why three output families cost no dependency.
 *
 * A DRAWING IS THE ODD ONE. Drive exports Docs, Sheets and Slides into the
 * matching member of each family, but a Drawing has no ODF or Office
 * equivalent on offer: `files.export` gives a Drawing only PNG, JPEG, SVG and
 * PDF. So SVG is what both document families get — it is the only VECTOR form
 * available, it opens in LibreOffice Draw and in Word, and a Drawing rendered
 * to PNG would be a diagram nobody can edit again. Do not "correct" these two
 * entries to ODG or VSDX: Drive answers 400 for both.
 */
export const NATIVE_EXPORT_TYPES: Readonly<
  Record<Exclude<NativeFilePolicy, 'refuse'>, Readonly<Record<string, string>>>
> = {
  'export-odf': {
    'application/vnd.google-apps.document': 'application/vnd.oasis.opendocument.text',
    // `x-vnd`, NOT `vnd`. Google's export table spells the Sheets ODS type
    // with the `x-` prefix and rejects the unprefixed one. It reads like a
    // typo and has been "fixed" into a 400 before; it is Google's spelling.
    'application/vnd.google-apps.spreadsheet': 'application/x-vnd.oasis.opendocument.spreadsheet',
    'application/vnd.google-apps.presentation': 'application/vnd.oasis.opendocument.presentation',
    'application/vnd.google-apps.drawing': 'image/svg+xml',
  },
  'export-office': {
    'application/vnd.google-apps.document':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.google-apps.spreadsheet':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.google-apps.presentation':
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.google-apps.drawing': 'image/svg+xml',
  },
  'export-pdf': {
    'application/vnd.google-apps.document': 'application/pdf',
    'application/vnd.google-apps.spreadsheet': 'application/pdf',
    'application/vnd.google-apps.presentation': 'application/pdf',
    'application/vnd.google-apps.drawing': 'application/pdf',
  },
};

/**
 * WHETHER TWO EXPORTS OF AN UNCHANGED DOCUMENT AGREE — the measurements, as a
 * table (workplan 0042 T3, ADR-0046, decision 2026-09-16).
 *
 * **A RECORD, NO LONGER A GATE (2026-09-23, ADR-0046 amended).** Until then the
 * connector refused every combination this table calls `unstable`, a Doc under
 * OpenDocument and a Slides deck under Office, for the reason in the next
 * paragraph. That reason is gone: a document is copied again when Drive says it
 * was edited, never because its bytes differ (#1083), and a renamed one is
 * paired by its Drive id (ADR-0030, amended). So nothing reads this table to
 * refuse, and every format is offered for every kind; the owner's aim was
 * *"working fileformats that suite the user"*. The measurements stay because
 * they are true, and the instrument that took them can take them again.
 *
 * THE PROBLEM THIS EXISTED FOR. A Google Doc has no bytes; migrating one means
 * asking Drive to EXPORT a rendering. If two exports of an unchanged document
 * differ, `contentHash` sees a change on every pass and the migration rewrites
 * every document nightly, forever, with every write succeeding and nothing
 * looking broken. ADR-0046 settles ONE class of that — a container rebuilt
 * around identical parts — and settles nothing else.
 *
 * THREE ANSWERS, NOT TWO, and the third is the important one:
 *
 *   - `stable`     measured, and either byte-identical or settleable by the
 *                  container hash. Safe to export.
 *   - `unstable`   measured, and NOT settleable: something inside a member
 *                  varies. Refused until 2026-09-23, when a rewrite stopped
 *                  depending on the bytes; copied since.
 *   - `unmeasured` nobody has run it. **Recorded, and NOT acted on** — a blank
 *                  is not a red. EVERY entry that has ever left this column has
 *                  gone to `stable`, twice now: `export-pdf` on a Sheet and a
 *                  Slide, blank for one day and then STABLE, and the Drawing
 *                  under both document policies, blank until somebody aimed the
 *                  instrument at it and then STABLE at 8324 bytes. Refusing on
 *                  absence of a measurement would have turned off all four —
 *                  the `export-pdf` escape hatch and every Drawing in every
 *                  migration — on no evidence at all. That is not an argument
 *                  that blanks are safe; it is the record of what treating them
 *                  as reds would have cost, against nothing it would have saved.
 *                  The entry exists so somebody can see what is missing and go
 *                  and measure it; a table with only two answers would have had
 *                  to guess for every blank, which is how a guess becomes a fact.
 *
 * WHAT WAS ACTUALLY MEASURED, on the owner's tenant, five draws each, 3000 ms
 * apart, with `scripts/drive-export-stability.ts`:
 *
 *   - `export-office` on a **Doc**: 17644 bytes every draw, five hashes, all
 *     nine members byte-identical, only zip stamps moved. Container-only.
 *   - `export-office` on a **Sheet**: 5659 bytes every draw, five hashes, all
 *     ten members byte-identical. Container-only.
 *   - `export-office` on a **Slide**: lengths oscillate by one byte, and FIVE
 *     members change content (`ppt/_rels/presentation.xml.rels`, two more
 *     `.rels`, both themes). Two draws still differ once the container is
 *     normalised — so the container hash does not save it.
 *   - `export-odf` on a **Doc**: `settings.xml` genuinely changes, 24 other
 *     members only restamped. Same verdict as the Slide, one format earlier.
 *   - `export-pdf` on a **Doc**: 195869 bytes and ONE hash, five times.
 *   - `export-pdf` on a **Sheet**: 54591 bytes and one hash, five times.
 *   - `export-pdf` on a **Slide**: 2017 bytes and one hash, five times.
 *   - `export-office` on a **Drawing**: 8324 bytes and one hash, five times
 *     (2026-09-17) — which is also `export-odf` on a Drawing, for the reason
 *     in the next paragraph.
 *   - `export-pdf` on a **Drawing**: 16854 bytes and one hash, five times
 *     (2026-09-17). A different renderer from the SVG above and a different
 *     size, which is the cheap confirmation that the PDF branch answered.
 *   - `export-odf` on a **Sheet**: 12856 bytes, five hashes, and ZERO members
 *     changed content — 15 restamped, normalised draws agree. Container-only.
 *   - `export-odf` on a **Slide**: 12633 bytes, five hashes, zero content
 *     changes, 16 members restamped, normalised draws agree. Container-only —
 *     and the same deck under `export-office` is NOT, which is the sharpest
 *     evidence in this table that a policy cannot be judged as a whole.
 *
 * ONE REQUEST CANNOT HAVE TWO ANSWERS, and that is why one run moved two
 * entries. `exportUrlFor` builds the export url out of
 * `NATIVE_EXPORT_TYPES[policy][mimeType]` and nothing else — the policy's NAME
 * never reaches Google. So wherever two policies render the same source type to
 * the same export type, they issue the byte-identical HTTP request, and a
 * measurement of one IS a measurement of the other. That is not an inference
 * about how Drive behaves, which would be a guess; it is the url, which is ours.
 * It applies exactly once today: a Drawing has neither an ODF nor an Office
 * form, so `export-odf` and `export-office` both ask for `image/svg+xml`.
 * `an-answer-that-must-match-its-twin.unit.test.ts` holds every such pair to a
 * single answer, so nobody can record a green under one policy and leave its
 * twin sitting blank — or, worse, mark one of them `unstable`.
 *
 * **THERE IS NOTHING LEFT UNMEASURED (2026-09-17).** Every one of the twelve
 * cells has been run on the owner's tenant. That is the first time this table
 * has been complete, and it is worth saying what it does NOT mean: the greens
 * are still five draws each, on one document of each type, on one tenant, on
 * one day. A full table is not a proved table — see the asymmetry below.
 *
 * `unmeasured` therefore has no instances today and STAYS, because it is the
 * answer for a type Drive adds next: the rule is that a blank is recorded and
 * copies rather than refusing, and the day that rule has no cell to stand on is
 * not the day to delete it. `exportStabilityOf` still returns it for any
 * mimeType this table has not met.
 *
 * A GREEN IS NOT THE MIRROR OF A RED. Five identical draws are evidence, not
 * proof — one counterexample disproves stability and no number of agreements
 * proves it. That asymmetry is why `stable` here means "measured and not
 * disproved" and why the Slide, which took one run to disprove, outranks every
 * green in this table.
 *
 * WHICH DOCUMENTS THE GREENS WERE TAKEN ON IS PART OF THE EVIDENCE, and the
 * `export-pdf` Slide renders to **2017 bytes** — a thin deck, with little in it
 * to be unstable about. The `.pptx` of that same deck is 34833 bytes and the
 * five members that moved there are `.rels` files and themes, i.e. packaging
 * around not much content. A deck carrying images, embedded fonts or charts has
 * more surface: font subset tags and image recompression are the places a PDF
 * renderer is known to vary. So this green is real and narrower than it looks,
 * and a richer deck is the measurement worth taking next (`DRIVE_FILE_ID` names
 * one exactly). Recorded here rather than left for somebody to infer from a
 * byte count.
 */
/**
 * THE NAME A PERSON CALLS EACH OF THESE, for the sentence they read.
 *
 * The refusals used to say "a Google presentation", which is the MIME suffix
 * with a space in front of it. Nobody calls it that. Google calls the product
 * Slides, people call the file a deck, and a customer scanning a failures queue
 * for the thing they are missing is looking for the word they use, not the word
 * our URL scheme uses.
 *
 * ## Why this is not the same map the ledger uses
 *
 * `migration_discovery.refused_native` is keyed by that MIME suffix —
 * `{"presentation": 3}` — on purpose: a stored key is provider-shaped and stays
 * still, and the screen translates it (`discovery.refusedNative.kind.*`, both
 * locales). This map is for the ENGLISH sentence the connector writes into a
 * failure row verbatim, which no locale file touches. Two maps, two jobs; the
 * ledger key must not start reading "Slides deck".
 *
 * ## Only the four a policy can render, and that is the rule
 *
 * For a Form, a Site, a My Map or an Apps Script the suffix IS the word people
 * use — "a Google form", "a Google site" — and those refusals say the same
 * thing whatever the noun: Drive will not export this in any format, ever. It
 * is the four EDITOR types where the suffix actively misleads, because those
 * are the refusals that ask somebody to choose a policy, and choosing one means
 * first recognising which of your files this is about. "A Google presentation"
 * is nobody's name for a deck.
 *
 * Anything unlisted falls back to the suffix, so a Google product nobody has
 * met yet still produces a sentence rather than a gap.
 */
const NATIVE_FILE_WORDS: Readonly<Record<string, string>> = {
  'application/vnd.google-apps.document': 'Doc',
  'application/vnd.google-apps.spreadsheet': 'Sheet',
  'application/vnd.google-apps.presentation': 'Slides deck',
  'application/vnd.google-apps.drawing': 'Drawing',
};

/** What to call this file in a sentence somebody reads. */
export function nativeFileWord(mimeType: string): string {
  return NATIVE_FILE_WORDS[mimeType] ?? mimeType.slice('application/vnd.google-apps.'.length);
}

export type ExportStability = 'stable' | 'unstable' | 'unmeasured';

export const EXPORT_STABILITY: Readonly<
  Record<Exclude<NativeFilePolicy, 'refuse'>, Readonly<Record<string, ExportStability>>>
> = {
  'export-odf': {
    // `settings.xml` changes content between draws — measured, not settleable.
    // THE ONLY ODF TYPE THAT FAILS, and the contrast with the two below is the
    // whole point of ADR-0046: a member whose CONTENT moves cannot be
    // normalised away, a restamped container can.
    'application/vnd.google-apps.document': 'unstable',
    // Container-only (2026-09-17). 12856 bytes every draw, five hashes, and
    // ZERO members changed content — 15 were restamped and the normalised
    // draws agree. Same shape as `export-office` on a Doc and a Sheet, settled
    // by the same hash, and `rendering` is set for EVERY export policy
    // (`google-drive-source.ts`), so that hash is live on this path too.
    'application/vnd.google-apps.spreadsheet': 'stable',
    // Container-only as well: 12633 bytes, five hashes, zero content changes,
    // 16 members restamped, normalised draws agree. A deck under `export-odf`
    // is therefore usable where the same deck under `export-office` is NOT —
    // there five members genuinely move. Two renderers, two answers, which is
    // exactly why this table is per (policy, type) and not per policy.
    'application/vnd.google-apps.presentation': 'stable',
    // Nobody ran the instrument under THIS policy, and it is measured anyway:
    // a Drawing has no ODF form, so this policy and `export-office` both ask
    // Drive for `image/svg+xml` and issue the identical request. Same request,
    // same evidence — see ONE REQUEST CANNOT HAVE TWO ANSWERS above. A unit
    // guard refuses to let this entry and its twin drift apart.
    'application/vnd.google-apps.drawing': 'stable',
  },
  'export-office': {
    // Container-only, both of them: ADR-0046's hash settles these two and they
    // are the reason that decision exists.
    'application/vnd.google-apps.document': 'stable',
    'application/vnd.google-apps.spreadsheet': 'stable',
    // The counterexample. Five members change content; normalising the
    // container leaves two draws still differing.
    'application/vnd.google-apps.presentation': 'unstable',
    // 8324 bytes and ONE hash, five draws (2026-09-17). An SVG is XML text,
    // not a zip, so — like the PDFs below — there is no container to normalise
    // and no second chance: this is a green on the bytes themselves.
    'application/vnd.google-apps.drawing': 'stable',
  },
  'export-pdf': {
    // Byte-identical over five draws each. A PDF is not a zip, so there is no
    // container to normalise and no second chance: these are greens on the
    // bytes themselves, which is the strongest shape a green in this table can
    // have. The Slide is the one that matters — it is the only measured way to
    // carry a deck at all. (This comment used to open by counting the editor
    // types it covered, and went on counting them after the Drawing was added
    // below it. A count in a sentence is a copy of the table — see
    // `scripts/a-count-in-a-sentence-the-table-outgrew.unit.test.ts`.)
    'application/vnd.google-apps.document': 'stable',
    'application/vnd.google-apps.spreadsheet': 'stable',
    'application/vnd.google-apps.presentation': 'stable',
    // Measured the same day the blank was named: 16854 bytes and ONE hash,
    // five draws. A different request from the SVG the other two policies ask
    // for — and a different SIZE, which is the cheap confirmation that it
    // really was the PDF renderer answering. The twin rule never reached this
    // entry; the instrument did.
    'application/vnd.google-apps.drawing': 'stable',
  },
};

/**
 * How stable this policy's rendering of this type is, for a caller that has a
 * MIME type and a policy and nothing else.
 *
 * `unmeasured` for a type the table does not list at all, which is the same
 * answer for the same reason: nobody ran it.
 */
export function exportStabilityOf(
  policy: Exclude<NativeFilePolicy, 'refuse'>,
  mimeType: string,
): ExportStability {
  return EXPORT_STABILITY[policy][mimeType] ?? 'unmeasured';
}

/**
 * The file extension each export MIME type lands under.
 *
 * A Google Doc's `name` carries no extension — there is no file, so there is
 * nothing for one to describe. Copy the export out under that bare name and
 * the result is a file called "Voorbeeldtekst" holding DOCX bytes: Nextcloud
 * shows it as unknown, the desktop offers no application, and the owner's
 * document has arrived in a form they cannot open. The extension is not
 * decoration here; it is the difference between exported and usable.
 *
 * Keyed by the EXPORT type rather than the Google type, so a policy and its
 * suffix cannot disagree — every value in `NATIVE_EXPORT_TYPES` must appear
 * here, and a guard test asserts exactly that.
 */
export const NATIVE_EXPORT_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/x-vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
};

export interface GoogleDriveSourceConfig {
  /** Base URL, overridable so tests never reach Google. */
  readonly baseUrl?: string;
  /** The folder id the migration is rooted at. `'root'` is My Drive. */
  readonly rootFolderId?: string;
  /** See {@link NativeFilePolicy}. Defaults to `refuse`. */
  readonly nativeFilePolicy?: NativeFilePolicy;
  /**
   * A format per editor kind, laid over `nativeFilePolicy` (workplan 0042 T9);
   * a kind left out follows it. See `NativeFilePolicies` in `@openmig/shared`.
   */
  readonly nativeFilePolicies?: NativeFilePolicies;
}

/**
 * The one seam this connector talks to the world through.
 *
 * A function rather than a class so a unit test can be a literal, and so the
 * connector carries no opinion about how a token is obtained — the caller has
 * already resolved that, exactly as `smtpTransport` takes resolved settings.
 */
export type DriveTransport = (
  url: string,
  init?: { readonly headers?: Readonly<Record<string, string>> },
) => Promise<DriveResponse>;

/**
 * What a transport hands back. Structurally satisfied by a `fetch` `Response`,
 * which is how the real one is built without the connector importing anything.
 */
export interface DriveResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  /**
   * The response's bytes, unread, when the transport can offer them
   * (workplan 0120 T5).
   *
   * OPTIONAL, and that is the safe way round: a transport that cannot stream
   * simply omits it, and the streamed path refuses the item by name rather
   * than returning an empty stream — which would write an empty file and
   * record it as a copy. Requiring it would have made every existing double a
   * compile error and taught nothing.
   */
  readonly body?: ReadableStream<Uint8Array> | null;
}

/** Google's own name for the native-editor family, used to detect them. */
export const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
