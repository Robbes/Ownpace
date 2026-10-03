// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * NEXTCLOUD'S CHUNKED UPLOAD, the pieces of it that are not about one writer
 * (workplan 0156; the owner's report of 2026-10-03).
 *
 * ## What it is for
 *
 * A file above 8 MB crosses as a stream and goes up as ONE `PUT`
 * (`uploadStreamed`). One request is what a server or a proxy limits: the
 * demo Nextcloud's image puts Apache's `LimitRequestBody` at 1 GiB
 * (`APACHE_BODY_LIMIT`), nginx installs set `client_max_body_size`, and a CDN
 * in front caps an upload at 100 MB. Past the limit Apache withholds the
 * body, Sabre reads 0 of the bytes it was promised, and the answer is
 *
 *   413: Sabre\DAV\Exception\BadRequest — Expected filesize of 1401302831
 *   bytes but read (from Nextcloud client) and wrote (to Nextcloud storage)
 *   0 bytes
 *
 * which is what the owner's four largest Dropbox files (1.3 GB twice, 2.1 GB
 * and 4.5 GB) read on every one of their five tries, while a 1 GB VOB went
 * up the same way and arrived.
 *
 * Nextcloud's own answer to a limit on one request is to send the file as
 * several (developer manual, *Chunked file upload*,
 * https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/chunking.html):
 *
 *   MKCOL <dav>/uploads/<user>/<transfer-id>        Destination: <file url>
 *   PUT   <dav>/uploads/<user>/<transfer-id>/00001  Destination, OC-Total-Length
 *   PUT   …/00002 …                                 (numbered 1-10000, assembled
 *                                                    in numerical order)
 *   MOVE  <dav>/uploads/<user>/<transfer-id>/.file  Destination, OC-Total-Length
 *
 * and a DELETE of the transfer folder to abandon one. Nothing appears at the
 * destination until the MOVE, and the MOVE assembles the file there in one
 * step, so a failure part way leaves pieces in the account's upload area,
 * never a partial file among its files. Nextcloud removes a transfer folder
 * left behind after 24 hours.
 *
 * ## What was measured rather than read (nextcloud:34-apache, 2026-10-03)
 *
 * Against the image the demo runs, started with a 16 MiB `APACHE_BODY_LIMIT`
 * and no distributed cache, which is the image's default and makes the server
 * take the v1 assembly path for a v2-shaped request:
 *
 *  - a 20 MiB single PUT answered 413 with exactly the owner's sentence;
 *  - MKCOL 201, three PUTs of 8, 8 and 4 MiB 201 each, MOVE 201 with `ETag`,
 *    `OC-ETag` and `OC-FileId`; the file read back with the source's sha256,
 *    and the transfer folder was gone;
 *  - MOVE with `Overwrite: F` onto a path that is taken answered 412, *"The
 *    destination node already exists, and the overwrite header is set to
 *    false"*, wrote nothing, and left the transfer folder in place;
 *  - `If-Match` on the MOVE is checked against `.file`, NOT the destination:
 *    the destination's own ETag was refused with 412. RFC 4918 §10.4's tagged
 *    `If: <destination> (["etag"])` is checked against the destination: a
 *    stale ETag answered 412, *"Failed to find a valid token/etag combination
 *    for files/…"*, and the current one 204. Against a destination that is
 *    not there, 404 naming it;
 *  - `OC-Total-Length` that the pieces do not add up to answered 400, *"Chunks
 *    on server do not sum up to 999 but to 4194304 bytes"*, and nothing was
 *    written at the destination;
 *  - a piece larger than the body limit answered 413 like a whole file;
 *  - MKCOL under a user the server does not know answered 409, *"Parent node
 *    does not exist"*;
 *  - DELETE of the transfer folder answered 204, and 404 once it was gone.
 *
 * Measured with a name carrying `&`, `#`, `%`, a space and an accent too: the
 * percent-encoded `Destination` and `If` URLs both resolved.
 */

/**
 * How large one piece is: 64 MiB.
 *
 * Inside every limit worth meeting (Cloudflare's 100 MB is the smallest a real
 * deployment is likely to put in front of Nextcloud) and inside Nextcloud's
 * own v2 bounds of 5 MB to 5 GB a piece. It is also the most a failed piece
 * can cost a retry. It is NOT the memory a piece costs: a piece is a window
 * onto the source's stream, never a buffer (`ChunkSlicer`).
 *
 * A file goes up in pieces only when it is LARGER than one piece: one piece
 * would be the same single request with three more around it.
 */
export const NEXTCLOUD_CHUNK_BYTES = 64 * 1024 * 1024;

/** Nextcloud v2 numbers pieces 1 to 10000 and refuses any other name. */
export const NEXTCLOUD_MAX_CHUNKS = 10000;

/**
 * The account's upload area, derived from its files URL, or `undefined` when
 * the URL is not Nextcloud's `…/dav/files/<user>/…` shape.
 *
 * The same derivation `nextcloudTrashbinUrl` makes for the bin
 * (`packages/connectors/src/webdav-trashbin.ts`), and for the same reasons:
 * the user comes from the URL, not the login, since the two can differ and
 * the uploads have to land beside the files being written; and the match is
 * anchored on `/dav/files/` rather than `/remote.php/dav/files/`, so an
 * install under a subdirectory still matches. `/remote.php/webdav` names no
 * account, so it has no upload area this can find.
 */
export function nextcloudUploadsUrl(filesUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(filesUrl);
  } catch {
    return undefined;
  }
  const match = /^(.*)\/dav\/files\/([^/]+)(?:\/|$)/.exec(parsed.pathname);
  const prefix = match?.[1];
  const user = match?.[2];
  if (prefix === undefined || !user) return undefined;
  return `${parsed.origin}${prefix}/dav/uploads/${user}/`;
}

/** A piece's name: its number, five digits wide, as the manual's examples write it. */
export function chunkName(n: number): string {
  return String(n).padStart(5, '0');
}

/** How many pieces a file of `total` bytes goes up in. */
export function chunkCount(total: number, chunkBytes: number): number {
  return Math.ceil(total / chunkBytes);
}

/**
 * ONE READ OF A FILE, HANDED OUT AS CONSECUTIVE PIECES of exact lengths.
 *
 * Each piece is a stream of its own, for one request each, and none of them
 * is a buffer: a piece pulls from the source only as its request reads, so
 * the most this holds is the source's one chunk in hand, part of which may be
 * waiting for the next piece. That is what lets a 4.5 GB file go up in 64 MiB
 * pieces on a pass machine of half a gigabyte (`a-file-that-never-fits-in-
 * memory`), and read ONCE, through one hasher, so the digest the ledger
 * records is of the whole file.
 *
 * A piece must be read to its end before the next is asked for: the pieces
 * share one reader, in order, as the bytes do.
 *
 * WHAT A SHORT SOURCE DOES. A source that ends before a piece is full errors
 * that piece's stream, and the request carrying it fails. Nothing pads it:
 * Nextcloud would refuse the assembly anyway, since `OC-Total-Length` is
 * checked against what arrived, but the reason worth reading is the source's.
 * It is kept in `failure`, so the writer can surface it rather than how fetch
 * reported a body that broke off.
 */
export class ChunkSlicer {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  /** Named in a failure, so the sentence says which file. */
  private readonly path: string;
  /** Bytes read from the source and not yet handed to a piece. */
  private leftover: Uint8Array | undefined;
  /**
   * What went wrong with the SOURCE, when something did: a read that threw,
   * or an end before the bytes it declared.
   */
  failure: Error | undefined;

  // No parameter properties: `erasableSyntaxOnly` (nothing transpiles at
  // runtime, AGENTS.md).
  constructor(source: ReadableStream<Uint8Array>, path: string) {
    this.reader = source.getReader();
    this.path = path;
  }

  /** The next `length` bytes, as a stream of their own. */
  next(length: number): ReadableStream<Uint8Array> {
    let remaining = length;
    return new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          // One piece of the source per pull: nothing is read ahead of the
          // request that will carry it.
          for (;;) {
            if (remaining === 0) {
              controller.close();
              return;
            }
            let piece: Uint8Array | undefined;
            try {
              piece = await this.take(remaining);
            } catch (err) {
              this.failure ??= err instanceof Error ? err : new Error(String(err));
              controller.error(this.failure);
              return;
            }
            if (piece === undefined) {
              this.failure ??= new Error(
                `${this.path}: the source ended ${remaining} bytes before the size it declared, ` +
                  'part way through a piece of the upload. Nothing was written at the destination.',
              );
              controller.error(this.failure);
              return;
            }
            if (piece.byteLength === 0) continue;
            remaining -= piece.byteLength;
            controller.enqueue(piece);
            if (remaining === 0) controller.close();
            return;
          }
        },
      },
      // Pulled only when the request reads, never to fill a queue.
      { highWaterMark: 0 },
    );
  }

  /**
   * Refuse a source that holds MORE than it declared.
   *
   * Asked after the last piece and before the assembly, because the pieces
   * stop at the declared size: a longer source would otherwise be assembled
   * as its first `sizeBytes` bytes and recorded as the file. The single PUT
   * refuses the same thing through `Content-Length`. Reading to the end is
   * also what lets the hasher finish (`streamingFileContentHash`).
   */
  async assertEnded(declared: number): Promise<void> {
    if (this.leftover !== undefined && this.leftover.byteLength > 0) {
      throw this.tooLong(declared);
    }
    for (;;) {
      const { done, value } = await this.reader.read();
      if (done) return;
      if (value.byteLength > 0) throw this.tooLong(declared);
    }
  }

  /** Let go of the source, so a download is not left open behind a failed piece. */
  async cancel(reason?: unknown): Promise<void> {
    await this.reader.cancel(reason).catch(() => undefined);
  }

  private tooLong(declared: number): Error {
    this.failure ??= new Error(
      `${this.path}: the source sent more than the ${declared} bytes it declared. Nothing was ` +
        'written at the destination; a file assembled from its first bytes would have been ' +
        'recorded as the whole of it.',
    );
    return this.failure;
  }

  private async take(max: number): Promise<Uint8Array | undefined> {
    let piece = this.leftover;
    this.leftover = undefined;
    if (piece === undefined) {
      const { done, value } = await this.reader.read();
      if (done) return undefined;
      piece = value;
    }
    // A view, not a copy: the rest waits, as the same memory, for the next
    // piece.
    if (piece.byteLength > max) {
      this.leftover = piece.subarray(max);
      piece = piece.subarray(0, max);
    }
    return piece;
  }
}
