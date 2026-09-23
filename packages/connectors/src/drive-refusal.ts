// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Drive refuses in JSON too, and Google puts the sentence that matters
 * somewhere Microsoft does not (workplan 0042, found live 2026-09-17).
 *
 * The owner's Drive held a Slides deck the measurement could not weigh. What
 * the run had to show him was:
 *
 *   Drive refused the download of "Enterprise Design: State of the Art -
 *   Survey Results" (403): {
 *     "error": { "code": 403, "message": "This file cannot be exported by the
 *     user.", "errors": [ { "message": "This file cannot be exported by the
 *     user.", "domain": "global", "reason": "cannotExportFile" } ] } }
 *
 * Fourteen lines of envelope around nine words. The same wall `dav-refusal.ts`
 * met in Google's GData XML and `graph-refusal.ts` met in Microsoft's JSON,
 * and the same rule applies: **the provider's words are rendered verbatim,
 * reason and message in Google's order, and only the envelope goes.**
 *
 * ## Where Google differs from Microsoft, which is why this is not that file
 *
 * Graph puts a STRING code at `error.code`. Google puts an HTTP NUMBER there
 * and the machine-readable reason one level down, in `error.errors[0].reason`
 * — the part worth acting on is the part nested deepest. A reader written for
 * one shape returns nothing useful for the other, so this is a sibling rather
 * than a generalisation: two providers, two documents, one rule.
 *
 * ## The half that is not about formatting
 *
 * `cannotExportFile` can never succeed. Not on the next pass, not on the fifth
 * attempt — Drive will refuse that file for that account until somebody
 * changes something in Drive. Left unmarked it rode the automatic retry lane,
 * so an item that needed a person sat in the queue looking busy. `DECIDED_BY`
 * names the reasons that are answers rather than weather, and the connector
 * marks those refusals so they park on the first attempt (the rule `ports.ts`
 * states and #207 fixed the other way round).
 *
 * ## What is measured here, and what is read from Google's list
 *
 * `cannotExportFile` was OBSERVED, on a real Drive, with the message quoted
 * above. Every other reason below comes from Google's published error table
 * and has not been seen by this code. That distinction is kept for the same
 * reason `EXPORT_STABILITY` keeps `unmeasured` as a third answer: a reason we
 * have never met might not carry the message we expect, so an unrecognised
 * reason PASSES THROUGH with Google's own words and no invented advice. The
 * envelope still goes — that part is safe for any shape.
 */

/**
 * Reasons that are a decision, not weather.
 *
 * Each will answer identically on every retry until a person changes
 * something, so an item refused for one of these is parked on its first
 * attempt rather than tried five times. A reason absent from this set is
 * treated as retryable, which is the safe direction: retrying something
 * permanent wastes a little; parking something transient strands an item that
 * would have succeeded.
 */
const DECIDED_BY: ReadonlySet<string> = new Set([
  // Observed 2026-09-17. Drive will not render this file for this account.
  'cannotExportFile',
  // Google's export ceiling. A bigger policy does not help; a smaller file would.
  'exportSizeLimitExceeded',
  // Drive holds bytes it will not hand over through the API at all.
  'fileNotDownloadable',
  // The share does not carry the permission this read needs.
  'insufficientFilePermissions',
  // The grant covers the Drive but not this file — per-file authorisation.
  'appNotAuthorizedToFile',
]);

/** What a person can DO about it, for the reasons where that is knowable. */
const WAY_OUT: Readonly<Record<string, string>> = {
  cannotExportFile:
    'Google will not export this particular file for this account. The usual cause is the ' +
    "file's owner having turned off download, copy and print for the people they share with; " +
    'a file Drive cannot render is the other. No export policy changes either — ask the owner ' +
    'to allow downloads, or open it in Drive and save a copy yourself.',
  exportSizeLimitExceeded:
    'The file is past the size Drive will export. No export policy changes that — open it in ' +
    'Drive and download it there, or split it and migrate the parts.',
  fileNotDownloadable:
    'Drive holds this file but will not hand it over through the API. Open it in Drive and ' +
    'download it there; nothing about the migration settings changes this.',
  insufficientFilePermissions:
    'This account can see the file but not read it well enough to copy it. Ask whoever shared ' +
    'it to give this account at least viewer access with download allowed.',
  appNotAuthorizedToFile:
    'The Google grant this migration holds does not cover this particular file. Reconnect the ' +
    'account, or ask the owner to share the file with the account directly.',
};

interface DriveError {
  /** Google's HTTP code, repeated inside the document. */
  readonly code: number;
  /** The machine-readable reason, from `error.errors[0].reason`. */
  readonly reason: string;
  /** Google's own sentence. */
  readonly message: string;
}

/** Google's error document, if the body is one. */
function driveError(body: string): DriveError | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const error = (parsed as { error?: unknown })?.error;
  if (!error || typeof error !== 'object') return null;
  const { code, message, errors } = error as {
    code?: unknown;
    message?: unknown;
    errors?: unknown;
  };
  // The reason lives in the FIRST entry of `errors`, which is where Google
  // puts the actionable half. A document without it is still a document —
  // the message alone is worth unwrapping.
  const first = Array.isArray(errors) ? (errors[0] as { reason?: unknown } | undefined) : undefined;
  const r = typeof first?.reason === 'string' ? first.reason.trim() : '';
  const m = typeof message === 'string' ? message.trim() : '';
  if (!r && !m) return null;
  return { code: typeof code === 'number' ? code : 0, reason: r, message: m };
}

/**
 * The refusal body as a person should read it: Google's reason and message
 * without the envelope. Anything that is not a Drive error document passes
 * through unchanged.
 */
export function driveRefusalBody(body: string): string {
  const error = driveError(body);
  if (!error) return body;
  return error.reason && error.message
    ? `${error.reason} — ${error.message}`
    : error.reason || error.message;
}

/**
 * Google's machine-readable reason (`error.errors[0].reason`), or `''`.
 *
 * Every Google JSON API refuses in this one document, so a source for another
 * Google face reads it here rather than parsing it a second way (0126 T1).
 */
export function googleRefusalReason(body: string): string {
  return driveError(body)?.reason ?? '';
}

/**
 * The way forward for a reason we know one for, and NOTHING for a reason we
 * do not.
 *
 * Silence is the honest answer for an unrecognised reason: Google's own
 * sentence is already in the line, and inventing advice for a refusal nobody
 * here has seen is how a message comes to name the wrong cause — which is the
 * defect this module exists to fix.
 */
export function driveRefusalHint(body: string): string {
  const reason = driveError(body)?.reason ?? '';
  const way = WAY_OUT[reason];
  return way ? ` ${way}` : '';
}

/** Whether this refusal is an answer, and so parks rather than retries. */
export function isDriveDecision(body: string): boolean {
  const reason = driveError(body)?.reason ?? '';
  return DECIDED_BY.has(reason);
}

/**
 * Both halves in one, plus the sentence that corrects the queue.
 *
 * "Nothing reached the destination" was written as a workaround: `classifyFailure`
 * read a 403 carrying "refused" as `target_refused`, whose remedy told the
 * customer their destination would not accept the item and to go and check its
 * permissions and free space — the exact opposite of what happened, sending
 * them to audit an account that never saw the file. The comment here said so,
 * and said the line would carry the correction "until the category vocabulary
 * grows a source-side answer".
 *
 * **IT GREW ONE on 2026-09-17, and this sentence stays anyway.** Not because
 * the fix was incomplete — a pass-level refusal thrown inside `fetchRaw` is
 * now `source_refused`, and its remedy says the destination is not the thing to
 * look at — but because a Drive refusal usually never reaches a pass-level row.
 * It is thrown INSIDE the per-item boundary so the rest of the folder still
 * migrates, which lands it in `item.last_error`: prose, and no category column
 * beside it. The category work moved the surface that has a category and left
 * untouched the one that does not.
 *
 * So on a pass-level row the correction is now said twice, once here and once
 * in the remedy, which is redundancy and not contradiction; and on the
 * per-item row it is said the only place it can be. Deleting it would trade a
 * duplicated sentence for a silent one. What would retire it properly is a
 * category on `item`, which is its own change with its own migration.
 */
export function driveFailure(
  what: string,
  response: { readonly status: number; readonly body: string },
): string {
  const error = driveError(response.body);
  const nothingSent = error ? ' Nothing was sent to the destination for this item.' : '';
  return `${what} (${response.status}): ${driveRefusalBody(response.body)}${nothingSent}${driveRefusalHint(response.body)}`;
}
