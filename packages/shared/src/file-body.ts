// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A file's bytes, without holding them all at once.
 *
 * ## The ceiling this exists to remove
 *
 * Until now a file crossed this system as a `Uint8Array`: the source read the
 * whole thing into memory, the sync loop carried it, and the target hashed it
 * and wrote it. Three copies of one file, alive at the same time, per item in
 * flight — and `concurrency` items in flight at once.
 *
 * So the largest file a migration could move was bounded by the RUNNER'S RAM,
 * not by anything about the file, the customer or the provider. On the managed
 * stack no machine preset is set at all, which means Trigger.dev's smallest
 * default. A file above that ceiling did not fail politely: the process was
 * killed, mid-pass, with no run event and no failure-queue row — the pass
 * simply stopped existing, which from a customer's side is the migration
 * quietly stalling on one file for ever.
 *
 * ## What a body is
 *
 * A size, and a way to read the bytes once. Not the bytes.
 *
 * `open()` may be called MORE THAN ONCE and must produce a fresh read each
 * time: a retry after a half-written upload has to start from the beginning,
 * and a stream that has already been consumed cannot. A source that cannot
 * re-open (a one-shot socket) must buffer or refuse — silently returning an
 * exhausted stream would write an empty file and call it a copy, which is the
 * single worst failure this code can produce (see `dav-sync`'s `fetchRaw`).
 *
 * ## Why not just a `ReadableStream`
 *
 * Because the size is load-bearing in three places that have nothing to do
 * with reading it: the daily byte meter spends it before the fetch, the
 * chunked-upload path needs a total to divide, and the refusal below needs it
 * to decide. A stream knows its length only after you have read it, which is
 * exactly too late for all three.
 */
export interface FileBody {
  /** Total bytes, known before a single one is read. */
  readonly sizeBytes: number;
  /**
   * A fresh read of the bytes, from the start. Safe to call again — a retry
   * depends on it.
   */
  open(): Promise<ReadableStream<Uint8Array>>;
}

/**
 * How much of one file a pass will hold in memory when it cannot stream it.
 *
 * Not a guess at the runner's RAM — a deliberate, uniform ceiling that every
 * edition and every machine size shares (hard rule 5). Set BELOW the smallest
 * plausible runner so that crossing it produces a sentence rather than a
 * different outcome per deployment, which is the failure mode that makes a
 * limit impossible to support: "it worked on my appliance" is not something a
 * customer can act on.
 *
 * 256 MB, with the buffered path holding at most three copies of one item
 * (source read, in flight, target write) across `concurrency` items — so the
 * worst case is bounded and statable, which is the whole point of naming it.
 */
export const MAX_BUFFERED_FILE_BYTES = 256 * 1024 * 1024;

/**
 * Above this, a file is read as a stream rather than into memory.
 *
 * Not the memory ceiling above (`MAX_BUFFERED_FILE_BYTES`, which is where a
 * path that CANNOT stream gives up) — this is where streaming starts being
 * worth its machinery. Deliberately far below that ceiling so the streaming
 * path is exercised by ordinary files in ordinary runs, rather than only by
 * the rare enormous one, where a defect would be found by a customer.
 *
 * It lives here, beside the ceiling and the seam it belongs to, because it is
 * a property of the SEAM and not of any one protocol: every connector that
 * moves to `FileBody` decides at the same size, so a file of a given size
 * behaves the same whichever provider it came from. It was defined in
 * `webdav-source.ts` while DAV was the only connector that had moved, and
 * importing a DAV constant into the Graph connector would have said something
 * untrue about where the rule comes from.
 */
export const STREAM_FILES_LARGER_THAN_BYTES = 8 * 1024 * 1024;

/**
 * The refusal for a file too large for a path that cannot stream it.
 *
 * A SENTENCE, not a crash. The item lands in the failure queue like any other
 * per-item failure, the pass carries on with the rest of the folder, and the
 * customer is told which file and why — where before, the container died and
 * took the whole pass with it, silently.
 *
 * Names the provider, because "which end cannot stream" is the only part of
 * this a person can do anything about (move the file by hand, or wait for that
 * connector's resumable upload).
 */
export function tooLargeToBuffer(
  what: 'read from' | 'written to',
  provider: string,
  path: string,
  sizeBytes: number,
): Error {
  return new Error(
    `${path} is ${Math.round(sizeBytes / (1024 * 1024))} MB, and cannot be ${what} ${provider} ` +
      `without holding all of it in memory at once. The limit is ` +
      `${Math.round(MAX_BUFFERED_FILE_BYTES / (1024 * 1024))} MB. Nothing was copied and nothing ` +
      'was changed; every other file in this folder continues normally. Copy this one by hand, ' +
      'or wait for resumable transfer on this connector.',
  );
}

/** A body over bytes already in memory — the shape every buffered path keeps. */
export function bodyOfBytes(content: Uint8Array): FileBody {
  return {
    sizeBytes: content.byteLength,
    // A fresh stream per call, over the SAME bytes. Re-opening is what a
    // retry needs, and the buffer is already the whole file.
    open: async () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(content);
          controller.close();
        },
      }),
  };
}
