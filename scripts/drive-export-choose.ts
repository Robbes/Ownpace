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
export type DriveFileKind = 'doc' | 'sheet' | 'slide' | 'drawing';

/**
 * Every native editor type a policy can RENDER, and therefore every type this
 * measurement must be able to speak about.
 *
 * ## The Drawing was left out, and the reason expired
 *
 * This map held three kinds until 2026-09-17. The comment said a Drawing was
 * "deliberately absent": it exports as SVG under either document policy, which
 * is text, a different risk, and a different question from the one 0042 T3 was
 * asking. That was sound while the question was whether `export-office` could
 * be trusted at all.
 *
 * It stopped being sound when `unmeasured` was decided to COPY rather than
 * refuse. From that moment a Drawing was a file the product exports on every
 * pass with nothing measured behind it — and the one native type nobody could
 * point the instrument at, so the blank could never be filled. A deliberate
 * omission had quietly become the only unmeasurable hole in the table.
 *
 * ## The rule that replaces the judgement
 *
 * If a policy can render it, it must be aimable by kind. Not "the types worth
 * asking about" — that is a judgement, and the judgement is what went stale.
 * `a-placeholder-that-reached-google.unit.test.ts` holds the two tables against
 * each other, so a fifth exportable type Drive grows cannot arrive measurable
 * by accident or unmeasurable by omission.
 *
 * A Form, a Site, a My Map and an Apps Script are still absent, and correctly:
 * no policy renders them, `files.export` answers 403 for all four, and there is
 * nothing to measure. That is the same rule, not an exception to it.
 */
export const KIND_MIME_TYPES: Readonly<Record<DriveFileKind, string>> = {
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  slide: 'application/vnd.google-apps.presentation',
  drawing: 'application/vnd.google-apps.drawing',
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
      `DRIVE_FILE_KIND="${raw}" is not one of doc, sheet, slide, drawing. Leave it unset to ` +
      'measure the first exportable native file found, or set DRIVE_FILE_ID to name one exactly.',
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

/**
 * WHICH FILES A `largest` RUN MAY WEIGH, and how many of them.
 *
 * `chooseFile` above answers "which one", for a run that takes the first file
 * of a kind. This answers "which several", for a run that exports each once and
 * measures the biggest — and it exists for the same reason `chooseFile` does.
 *
 * The header of `a-placeholder-that-reached-google.unit.test.ts` records the
 * first half of that reason: a placeholder in a pasted command is a trap, and
 * `DRIVE_FILE_KIND` removed the need for one. The second half arrived the same
 * evening. `export-pdf` measured `stable` on a Slides deck that renders to 2017
 * bytes — a deck with almost nothing in it — because "first file of that kind"
 * is a document nobody chose. Measuring a richer one meant naming it, naming it
 * meant an id, and an id in an instruction meant a placeholder again: the
 * literal `PASTE_DECK_ID_HERE` reached Drive and got its 404, one written
 * instruction after the last one did.
 *
 * So the way to pick a substantial document must not be an id either. This is
 * the filtering half of that; the weighing half needs real exports and lives in
 * the script.
 *
 * ## The limit is not a detail
 *
 * Every candidate costs a real export against somebody's Drive and their rate
 * budget. An unbounded list would turn "measure a good deck" into a full export
 * of every deck they own, which is not a thing a measurement script may decide
 * to do on its own. The cap is required rather than optional for that reason —
 * there is no sentinel here meaning "all of them".
 */
export function candidatesToWeigh<T extends ChoosableFile>(
  files: readonly T[],
  exportable: Readonly<Record<string, unknown>>,
  kind: DriveFileKind | undefined,
  limit: number,
): ChoiceOutcome<readonly T[]> {
  const wanted = kind ? KIND_MIME_TYPES[kind] : undefined;
  if (wanted && !exportable[wanted]) {
    // Word for word the refusal `chooseFile` gives, because it is the same
    // fact: this policy renders nothing for this type. A reader who has seen
    // one should recognise the other.
    return {
      ok: false,
      reason:
        `"${kind}" has no export mapping under this policy, so there is nothing to weigh. ` +
        'That is a fact about the policy, not about your Drive.',
    };
  }

  const matching = files.filter((f) => (wanted ? f.mimeType === wanted : exportable[f.mimeType]));
  if (matching.length === 0) {
    return {
      ok: false,
      reason:
        `No ${kind ? `Google ${kind}` : 'exportable native editor file'} found to weigh. ` +
        'Unset DRIVE_PICK to measure the first file found instead, or point ' +
        'DRIVE_ROOT_FOLDER_ID somewhere that has one.',
    };
  }

  // A limit below one is a typo, not an instruction to do nothing: answering
  // with an empty list would strand the caller with "nothing to measure" for a
  // reason that has nothing to do with their Drive.
  return { ok: true, file: matching.slice(0, Math.max(1, Math.floor(limit) || 1)) };
}
