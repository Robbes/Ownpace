// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Which document the measurement measures, chosen by KIND rather than by id.
 *
 * THE DEFECT THIS EXISTS TO FIX, and it is a documentation defect that became
 * an operational one. `drive-export-stability.ts` takes `DRIVE_FILE_ID`, and
 * 0042 T3 asks for a Sheet and a Slide to be measured as well as a Doc. So
 * every instruction for that measurement has had the shape
 *
 *   DRIVE_FILE_ID=<a Sheet>  pnpm exec tsx scripts/drive-export-stability.ts
 *
 * and a placeholder inside a runnable line is a trap. The owner ran it three
 * times on 2026-09-16; the third time the literal string `sheet-file-id`
 * reached Drive, which answered 404 for a file of that name — correctly, and
 * uselessly. Looking an id up means leaving the shell, opening the file in a
 * browser and reading it out of the URL, for a measurement whose whole point is
 * that it should be cheap to repeat.
 *
 * So: name the KIND, and let the script find one.
 *
 *   DRIVE_FILE_KIND=sheet  pnpm exec tsx scripts/drive-export-stability.ts
 *
 * `DRIVE_FILE_ID` still wins when set — measuring one SPECIFIC document is the
 * case that matters when a result is being reproduced, and a kind cannot
 * promise you got the same file twice.
 *
 * PURE ON PURPOSE, like `drive-export-credentials.ts` and for the same reason:
 * the script runs `main()` on import, so nothing inside it can be reached by a
 * unit test. The choosing is the part with a decision in it, so the choosing
 * lives here.
 */

/** What a caller may ask for by name. */
export type DriveFileKind = 'doc' | 'sheet' | 'slide';

/**
 * The three native editor types this measurement can speak about.
 *
 * A Drawing is deliberately absent. It IS a native editor file, and under
 * either document policy it exports as SVG — text, a different risk, and a
 * different question from the one 0042 T3 asks. A Form has no export mapping at
 * all. Offering either as a `--kind` would invite a run whose refusal answers
 * something nobody asked.
 */
export const KIND_MIME_TYPES: Readonly<Record<DriveFileKind, string>> = {
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  slide: 'application/vnd.google-apps.presentation',
};

/** Just enough of a Drive file to choose between candidates. */
export interface ChoosableFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
}

export type ChoiceOutcome<T> =
  | { readonly ok: true; readonly file: T }
  | { readonly ok: false; readonly reason: string };

/**
 * Read `DRIVE_FILE_KIND` into a kind, or say why it cannot be read.
 *
 * An unset value is `undefined` and NOT an error — the script's older behaviour
 * (take the first exportable native file) is still the right default for
 * somebody who only wants a number. A value that is set and wrong IS an error,
 * because a typo silently falling back to "whatever was first" would report a
 * Doc's stability under the heading of a Sheet's.
 */
export function readKind(raw: string | undefined): ChoiceOutcome<DriveFileKind | undefined> {
  const trimmed = (raw ?? '').trim().toLowerCase();
  if (!trimmed) return { ok: true, file: undefined };
  if (trimmed in KIND_MIME_TYPES) {
    return { ok: true, file: trimmed as DriveFileKind };
  }
  return {
    ok: false,
    reason:
      `DRIVE_FILE_KIND="${raw}" is not one of doc, sheet, slide. Leave it unset to measure ` +
      'the first exportable native file found, or set DRIVE_FILE_ID to name one exactly.',
  };
}

/**
 * Pick the file to measure from a folder listing.
 *
 * `exportable` is the policy's own mime-type map: a kind the POLICY cannot
 * export is refused here rather than discovered three requests later, and the
 * refusal says which policy refused it.
 */
export function chooseFile<T extends ChoosableFile>(
  files: readonly T[],
  exportable: Readonly<Record<string, unknown>>,
  kind: DriveFileKind | undefined,
  where: string,
  policy: string,
): ChoiceOutcome<T> {
  if (kind) {
    const wanted = KIND_MIME_TYPES[kind];
    if (!exportable[wanted]) {
      return {
        ok: false,
        reason:
          `"${policy}" has no export mapping for a ${kind}, so there is nothing to measure. ` +
          'That is a fact about the policy, not about your Drive.',
      };
    }
    const match = files.find((f) => f.mimeType === wanted);
    if (!match) {
      return {
        ok: false,
        reason:
          `No Google ${kind} directly under ${where} (this listing is that folder only, not ` +
          'its subfolders). Put one there, point DRIVE_ROOT_FOLDER_ID at a folder that has ' +
          'one, or set DRIVE_FILE_ID to name a specific file.',
      };
    }
    return { ok: true, file: match };
  }

  const first = files.find((f) => exportable[f.mimeType]);
  if (!first) {
    return {
      ok: false,
      reason:
        `No Google Doc, Sheet or Slide directly under ${where} (this listing is that folder ` +
        'only, not its subfolders). Set DRIVE_FILE_ID to one, or point DRIVE_ROOT_FOLDER_ID ' +
        'at a folder that has one — the whole question is about native editor files, so an ' +
        'ordinary file cannot answer it.',
    };
  }
  return { ok: true, file: first };
}
