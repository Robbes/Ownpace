// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Google's Tasks API v1 resources, as its discovery document describes them
 * (revision 20260920, read 2026-09-23).
 *
 * Only the fields the VTODO mapping reads; Google sends more and the source
 * ignores the rest. Everything but the id is optional: the document marks
 * almost every field optional or output-only, and a deleted task carries very
 * little.
 */

/** A list: `GET tasks/v1/users/@me/lists`. */
export interface GoogleTaskList {
  readonly id: string;
  /** At most 1024 characters. */
  readonly title?: string;
  readonly etag?: string;
  /** RFC 3339. */
  readonly updated?: string;
}

/** One entry of a task's read-only `links`. */
export interface GoogleTaskLink {
  /** e.g. `email`, `generic`, `chat_message`, `keep_note`. */
  readonly type?: string;
  /** The URL. */
  readonly link?: string;
  /** "might be empty". */
  readonly description?: string;
}

/** Where a task assigned to the person came from (Docs or a Chat space). */
export interface GoogleTaskAssignmentInfo {
  /** An absolute link to the original task where it was assigned. */
  readonly linkToTask?: string;
  /** `DOCUMENT` or `SPACE` today; the enum also names `GMAIL`. */
  readonly surfaceType?: string;
}

/** A task: `GET tasks/v1/lists/{tasklist}/tasks`. */
export interface GoogleTask {
  readonly id: string;
  readonly etag?: string;
  /** At most 1024 characters. */
  readonly title?: string;
  /** Plain text, at most 8192 characters. A task assigned from Docs has none. */
  readonly notes?: string;
  /** `needsAction` or `completed`. */
  readonly status?: string;
  /**
   * RFC 3339, but ONLY THE DATE means anything: *"the time portion of the
   * timestamp is discarded when setting this field. It isn't possible to read
   * or write the time that a task is scheduled for using the API."*
   */
  readonly due?: string;
  /** RFC 3339; absent until the task is completed. */
  readonly completed?: string;
  /** RFC 3339, output only. */
  readonly updated?: string;
  /** The parent task's id; absent for a top-level task. */
  readonly parent?: string;
  /** Orders siblings lexicographically. Output only. */
  readonly position?: string;
  /** Completed, and cleared from the list since. */
  readonly hidden?: boolean;
  /** Returned only with `showDeleted=true`. */
  readonly deleted?: boolean;
  readonly links?: ReadonlyArray<GoogleTaskLink>;
  readonly webViewLink?: string;
  readonly assignmentInfo?: GoogleTaskAssignmentInfo;
}

/** One page of either listing. */
export interface GooglePage<T> {
  readonly items?: ReadonlyArray<T>;
  readonly nextPageToken?: string;
}
