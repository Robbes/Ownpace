// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CIRRUX DRIVE API, AS THIS PRODUCT SPEAKS IT (workplan 0160 T5).
 *
 * The routes are the ones `https://cirrux.co/help/api/drive` and
 * `https://cirrux.co/help/api/user` publish (read 2026-11-19), under
 * `https://api.cirrux.co/public_api/v1`. This file is transport: a bearer
 * token on every request, a refused token refreshed once, a `429` waited out
 * for its `Retry-After`, and Cirrux's `{ error, error_description }` kept as
 * data on the error it throws, so the writer can tell `name_taken` from
 * `version_conflict` without reading prose. Which route answers which
 * question, and what a refusal means for a person's files, is the writer's
 * (`cirrux-drive-target.ts`).
 *
 * ## A simple upload never holds the file
 *
 * Cirrux's simple upload is JSON with the file inside as base64, up to 100 MB
 * (`CIRRUX_SIMPLE_UPLOAD_MAX_BYTES`). Built as a string, that is the file
 * twice over in memory, once as bytes and once a third larger as text, per item
 * in flight. So the body is a STREAM: the JSON's opening, the base64 of the
 * file as it is read, and the JSON's close, with the exact `Content-Length`
 * worked out before a byte is read. `STREAMED_REQUEST_INIT` is what a stream
 * body needs from `fetch` (`file-body.ts` says why).
 *
 * ## The presigned part URLs are Cirrux's storage, not Cirrux's API
 *
 * A chunked upload or a replace PUTs each encrypted chunk to a URL Cirrux's
 * answer names. Those go through `tenantFetch`, with no Authorization header:
 * the address came from a remote answer, so the rule that refuses a host
 * resolving inside our network applies to it (workplan 0136 T1).
 */

import {
  CIRRUX_API_BASE,
  STREAMED_REQUEST_INIT,
  log,
  parseRetryAfterMs,
  withFailureCategory,
  type FileBody,
} from '@openmig/shared';
import { tenantFetch } from '@openmig/shared/reachable-host';
import type { CirruxTokenProvider } from './cirrux-token-provider.ts';

/** A `drive_file`, with the fields this product reads. */
export interface CirruxDriveFile {
  readonly object?: 'drive_file';
  readonly uuid: string;
  readonly folder_uuid?: string;
  readonly name: string;
  readonly content_type?: string;
  readonly file_size_bytes?: number;
  readonly upload_status?: 'uploading' | 'completed';
  readonly trashed?: boolean;
  /** The content version: 0 for a new file, one higher after each completed replace. */
  readonly ctag?: number;
  readonly version?: number;
  readonly content_modified_at?: string | null;
}

/** A `drive_folder`, with the fields this product reads. */
export interface CirruxDriveFolder {
  readonly object?: 'drive_folder';
  readonly uuid: string;
  readonly parent_uuid?: string;
  readonly name: string;
  readonly trashed?: boolean;
}

/** One folder's live children (`GET /drive/files`). Trashed items are left out by Cirrux. */
export interface CirruxFolderListing {
  readonly folders: ReadonlyArray<CirruxDriveFolder>;
  readonly files: ReadonlyArray<CirruxDriveFile>;
}

/** What the chunked flow's init answers, for an upload and a replace alike. */
export interface CirruxChunkedInit {
  readonly file_uuid: string;
  readonly version_uuid?: string;
  readonly data_key?: string;
  readonly chunk_size_bytes?: number;
  readonly chunk_count?: number;
  readonly plaintext_size_bytes?: number;
  readonly ciphertext_size_bytes?: number;
  readonly expires_at?: string;
  /** Set when a 0-byte file was finished on the spot: nothing to upload. */
  readonly upload_status?: 'uploading' | 'completed';
}

/** A refusal from Cirrux, as data: the status, its `error` code, and the rest of its body. */
/**
 * Cirrux's storage refused one part's PUT. A presigned URL is valid for one
 * hour (the page), and one past it answers `403`: the writer asks for that
 * part's URL again once, and only then gives up.
 */
export class CirruxPartRefused extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CirruxPartRefused';
    this.status = status;
  }
}

export class CirruxApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly description: string | undefined;
  readonly body: Readonly<Record<string, unknown>>;
  constructor(what: string, status: number, body: Readonly<Record<string, unknown>>) {
    const code = typeof body.error === 'string' ? body.error : undefined;
    const description = typeof body.error_description === 'string' ? body.error_description : undefined;
    super(`Cirrux answered ${what} with ${status}${code ? ` ${code}` : ''}${description ? `: ${description}` : ''}`);
    this.name = 'CirruxApiError';
    this.status = status;
    this.code = code;
    this.description = description;
    this.body = body;
  }
}

export interface CirruxDriveApiOptions {
  readonly tokens: CirruxTokenProvider;
  readonly baseUrl?: string;
  /** The API's own requests. */
  readonly fetchImpl?: typeof fetch;
  /** The presigned part URLs (Cirrux's storage): `tenantFetch` unless a test says otherwise. */
  readonly partFetch?: (url: string, init: RequestInit) => Promise<Response>;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** How many times one request meets `429` before the pass gives up on it. */
const RATE_LIMIT_ATTEMPTS = 6;
/** A wait Cirrux asks for that is longer than this is taken as this. */
const LONGEST_WAIT_MS = 5 * 60_000;

type Body = { readonly json: unknown } | { readonly stream: () => Promise<{ body: ReadableStream<Uint8Array>; length: number }> };

export class CirruxDriveApi {
  private readonly tokens: CirruxTokenProvider;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly partFetch: (url: string, init: RequestInit) => Promise<Response>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: CirruxDriveApiOptions) {
    this.tokens = options.tokens;
    this.base = (options.baseUrl ?? CIRRUX_API_BASE).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.partFetch = options.partFetch ?? ((url, init) => tenantFetch(url, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  // ---------------------------------------------------------------------
  // Who and where
  // ---------------------------------------------------------------------

  /** `GET /user/profile`: who signed in, and the workspace the token belongs to. */
  profile(): Promise<{
    user?: { uuid?: string; username?: string; first_name?: string | null; last_name?: string | null };
    workspace?: { uuid?: string; name?: string; type?: string };
  }> {
    return this.json('GET', '/user/profile');
  }

  /** `GET /workspace/storage`: the pool every Drive file counts against. */
  storage(): Promise<{ used_bytes?: number; pool_bytes?: number }> {
    return this.json('GET', '/workspace/storage');
  }

  // ---------------------------------------------------------------------
  // Folders and files
  // ---------------------------------------------------------------------

  /** A folder's live children; `null` is the Drive root. */
  async listFolder(folderUuid: string | null): Promise<CirruxFolderListing> {
    const answer = await this.json<{ folders?: CirruxDriveFolder[]; files?: CirruxDriveFile[] }>(
      'GET',
      folderUuid === null ? '/drive/files' : `/drive/files?folder_uuid=${encodeURIComponent(folderUuid)}`,
    );
    if (!Array.isArray(answer.folders) || !Array.isArray(answer.files)) {
      // An answer without both lists is not an empty folder, and reading it as
      // one is how a file already there gets uploaded a second time.
      throw new Error(
        `Cirrux answered the listing of ${folderUuid ?? 'the Drive root'} without its folders and files, ` +
          'so it cannot be read as empty.',
      );
    }
    return { folders: answer.folders, files: answer.files };
  }

  createFolder(name: string, parentUuid: string | null): Promise<CirruxDriveFolder> {
    return this.json('POST', '/drive/folders', { name, parent_uuid: parentUuid });
  }

  getFile(uuid: string): Promise<CirruxDriveFile> {
    return this.json('GET', `/drive/files/${encodeURIComponent(uuid)}`);
  }

  /** `POST /drive/files/{uuid}/trash`: restorable for 30 days. Never `DELETE` (ADR-0052). */
  trashFile(uuid: string): Promise<CirruxDriveFile> {
    return this.json('POST', `/drive/files/${encodeURIComponent(uuid)}/trash`);
  }

  /** `GET /drive/files/{uuid}/download`: the decrypted bytes, as URL-safe base64, up to 100 MB. */
  async download(uuid: string): Promise<Uint8Array> {
    const answer = await this.json<{ data?: unknown }>('GET', `/drive/files/${encodeURIComponent(uuid)}/download`);
    if (typeof answer.data !== 'string') throw new Error(`Cirrux answered the download of ${uuid} without its data.`);
    return Uint8Array.from(Buffer.from(answer.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  }

  /**
   * `POST /drive/files`, with the file inside as base64, STREAMED.
   *
   * The JSON is `{"name":…,"content_type":…,"folder_uuid":…,
   * "content_modified_at":…,"data":"<base64>"}`, its opening and close fixed
   * and its middle the file's base64 as the bytes arrive; the length is known
   * before a byte is read, because a base64 length is a function of the byte
   * count alone.
   */
  uploadSimple(p: {
    readonly name: string;
    readonly contentType: string;
    readonly folderUuid: string | null;
    readonly contentModifiedAt?: string;
    readonly body: FileBody;
    /** Where the file's name goes in a refusal. */
    readonly path: string;
  }): Promise<CirruxDriveFile> {
    const meta: Record<string, unknown> = {
      name: p.name,
      content_type: p.contentType,
      folder_uuid: p.folderUuid,
      ...(p.contentModifiedAt ? { content_modified_at: p.contentModifiedAt } : {}),
    };
    const opening = new TextEncoder().encode(`${JSON.stringify(meta).slice(0, -1)},"data":"`);
    const close = new TextEncoder().encode('"}');
    const length = opening.byteLength + 4 * Math.ceil(p.body.sizeBytes / 3) + close.byteLength;
    return this.json('POST', '/drive/files', undefined, {
      stream: async () => ({
        body: jsonWithBase64(opening, await p.body.open(), close, p.body.sizeBytes, p.path),
        length,
      }),
    });
  }

  // ---------------------------------------------------------------------
  // Upload: the chunked flow, for a new file over the simple upload's cap
  // ---------------------------------------------------------------------

  /**
   * `POST /drive/uploads`: a new file, up to 2 GiB, whose bytes go to storage
   * in parts the client encrypts (`CXDRV2`). The answer names the file's
   * `file_uuid`, its `data_key` and the chunk size; the file is listed as
   * `uploading` until complete. Scope `drive.create`.
   */
  uploadInit(p: {
    readonly name: string;
    readonly contentType: string;
    readonly folderUuid: string | null;
    readonly plaintextSizeBytes: number;
    readonly contentModifiedAt?: string;
  }): Promise<CirruxChunkedInit> {
    return this.json('POST', '/drive/uploads', {
      name: p.name,
      content_type: p.contentType,
      plaintext_size_bytes: p.plaintextSizeBytes,
      ...(p.folderUuid ? { folder_uuid: p.folderUuid } : {}),
      ...(p.contentModifiedAt ? { content_modified_at: p.contentModifiedAt } : {}),
    });
  }

  /**
   * The page writes these routes as `/v1/drive/uploads/{uuid}/…` after an
   * init that answers a `file_uuid`, a `version_uuid` and an `s3_upload_id`;
   * `{uuid}` is read as the `file_uuid`, the one the replace routes name too
   * (workplan 0160 §6, the readings).
   */
  uploadPartUrls(fileUuid: string, partNumbers: ReadonlyArray<number>): Promise<ReadonlyArray<{ part_number: number; url: string }>> {
    return this.partUrls(`/drive/uploads/${encodeURIComponent(fileUuid)}/part_urls`, partNumbers);
  }

  uploadComplete(fileUuid: string, parts: ReadonlyArray<{ part_number: number; etag: string }>): Promise<CirruxDriveFile> {
    return this.json('POST', `/drive/uploads/${encodeURIComponent(fileUuid)}/complete`, { parts });
  }

  async uploadAbort(fileUuid: string): Promise<void> {
    await this.json('POST', `/drive/uploads/${encodeURIComponent(fileUuid)}/abort`, {});
  }

  // ---------------------------------------------------------------------
  // Replace: the chunked flow, against an existing file
  // ---------------------------------------------------------------------

  replaceInit(
    uuid: string,
    p: {
      readonly plaintextSizeBytes: number;
      readonly contentType?: string;
      readonly contentModifiedAt?: string;
      /** The `ctag` the edit is based on: a newer one at Cirrux answers `409 version_conflict`. */
      readonly baseCtag?: number;
    },
  ): Promise<CirruxChunkedInit> {
    return this.json('POST', `/drive/files/${encodeURIComponent(uuid)}/replace`, {
      plaintext_size_bytes: p.plaintextSizeBytes,
      ...(p.contentType ? { content_type: p.contentType } : {}),
      ...(p.contentModifiedAt ? { content_modified_at: p.contentModifiedAt } : {}),
      ...(p.baseCtag !== undefined ? { base_ctag: p.baseCtag } : {}),
    });
  }

  replacePartUrls(uuid: string, partNumbers: ReadonlyArray<number>): Promise<ReadonlyArray<{ part_number: number; url: string }>> {
    return this.partUrls(`/drive/files/${encodeURIComponent(uuid)}/replace/part_urls`, partNumbers);
  }

  replaceComplete(uuid: string, parts: ReadonlyArray<{ part_number: number; etag: string }>): Promise<CirruxDriveFile> {
    return this.json('POST', `/drive/files/${encodeURIComponent(uuid)}/replace/complete`, { parts });
  }

  async replaceAbort(uuid: string): Promise<void> {
    await this.json('POST', `/drive/files/${encodeURIComponent(uuid)}/replace/abort`, {});
  }

  /**
   * PUT one encrypted part to its presigned URL, and answer the `ETag` the
   * complete step needs. No Authorization header: the URL is the credential.
   */
  async putPart(url: string, bytes: Uint8Array, what: string): Promise<string> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Cirrux named a part URL for ${what} that is not a URL, so nothing was sent to it.`);
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(`Cirrux named a part URL for ${what} that is not https, so nothing was sent to it.`);
    }
    for (let attempt = 1; ; attempt++) {
      const response = await this.partFetch(url, {
        method: 'PUT',
        headers: { 'Content-Length': String(bytes.byteLength) },
        body: bytes,
        redirect: 'error',
      });
      if ((response.status === 429 || response.status === 503) && attempt < RATE_LIMIT_ATTEMPTS) {
        await this.waitOut(response, attempt, `a part of ${what}`);
        continue;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw withFailureCategory(
          response.status === 403 ? 'target_refused' : 'network',
          new CirruxPartRefused(
            `Cirrux's storage refused a part of ${what} with ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
            response.status,
          ),
        );
      }
      await response.text().catch(() => undefined);
      const etag = response.headers.get('etag');
      if (!etag) {
        throw new Error(`Cirrux's storage took a part of ${what} and answered no ETag, which the complete step needs.`);
      }
      return etag;
    }
  }

  // ---------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------

  private partUrls(path: string, partNumbers: ReadonlyArray<number>): Promise<ReadonlyArray<{ part_number: number; url: string }>> {
    return this.json<{ part_urls?: Array<{ part_number: number; url: string }> }>('POST', path, {
      part_numbers: partNumbers,
    }).then((answer) => {
      if (!Array.isArray(answer.part_urls)) throw new Error(`Cirrux answered ${path} without part_urls.`);
      return answer.part_urls;
    });
  }

  /**
   * One request: the bearer token, a refused token refreshed once, a `429`
   * waited out, and a refusal thrown as `CirruxApiError`. A stream body is a
   * factory, opened afresh for each attempt.
   */
  private async json<T>(method: string, path: string, json?: unknown, streamed?: Body): Promise<T> {
    const url = `${this.base}${path}`;
    const what = `${method} ${path.split('?')[0]}`;
    let refreshedOnce = false;
    for (let attempt = 1; ; attempt++) {
      const token = await this.tokens.getAccessToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      let init: RequestInit = { method, headers };
      if (streamed && 'stream' in streamed) {
        const { body, length } = await streamed.stream();
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(length);
        init = { ...init, body, ...STREAMED_REQUEST_INIT } as RequestInit;
      } else if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        init = { ...init, body: JSON.stringify(json) };
      }

      const response = await this.fetchImpl(url, init);

      if (response.status === 401 && !refreshedOnce) {
        // The access token was refused (expired early, or revoked): forget it
        // and ask once more with a fresh one. A second 401 is the answer.
        refreshedOnce = true;
        await response.text().catch(() => undefined);
        this.tokens.invalidate(token);
        continue;
      }
      if (response.status === 429 && attempt < RATE_LIMIT_ATTEMPTS) {
        await this.waitOut(response, attempt, what);
        continue;
      }

      const text = await response.text().catch(() => '');
      if (!response.ok) {
        let body: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(text) as unknown;
          if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
        } catch {
          body = { error_description: text.slice(0, 300) };
        }
        const error = new CirruxApiError(what, response.status, body);
        throw withFailureCategory(categoryOf(response.status, error.code), error);
      }
      if (response.status === 204 || text.trim() === '') return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Cirrux answered ${what} with ${response.status} and something that is not JSON.`);
      }
    }
  }

  /** Wait as long as Cirrux asked, within reason. */
  private async waitOut(response: Response, attempt: number, what: string): Promise<void> {
    const header = response.headers.get('retry-after');
    await response.text().catch(() => undefined);
    const asked = header ? parseRetryAfterMs(header) : 1000 * 2 ** attempt;
    const wait = Math.min(Math.max(asked, 0), LONGEST_WAIT_MS);
    log.warn(
      `[cirrux-drive] ${response.status} from ${what}; waiting ${Math.round(wait)}ms before attempt ` +
        `${attempt + 1}/${RATE_LIMIT_ATTEMPTS}`,
    );
    await this.sleep(wait);
  }
}

/** Which failure a refusal is, so a pass reports it with the right remedy. */
function categoryOf(status: number, code: string | undefined): Parameters<typeof withFailureCategory>[0] {
  if (status === 401) return 'auth_expired';
  if (status === 429) return 'rate_limited';
  if (code === 'storage_limit_exceeded') return 'quota_exceeded';
  if (status === 413 || code === 'file_too_large') return 'too_large';
  if (status >= 500) return 'network';
  return 'target_refused';
}

/**
 * The simple upload's body: the JSON's opening, the file's base64 as it is
 * read, the JSON's close. Base64 is cut on whole 3-byte groups, the leftover
 * carried to the next piece, and padded once at the end, so the stream is the
 * same text `Buffer.toString('base64')` of the whole file would be. A source
 * that hands over another byte count than it promised is refused: the length
 * went out before the first byte.
 */
function jsonWithBase64(
  opening: Uint8Array,
  file: ReadableStream<Uint8Array>,
  close: Uint8Array,
  sizeBytes: number,
  path: string,
): ReadableStream<Uint8Array> {
  const reader = file.getReader();
  let carry = new Uint8Array(0);
  let read = 0;
  let started = false;
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(opening);
        return;
      }
      // Read until something can be enqueued: a pull that enqueues nothing is
      // not called again, and the request would wait for ever on a piece of
      // fewer than three bytes.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          if (read !== sizeBytes) {
            controller.error(
              new Error(`${path} handed over ${read} of the ${sizeBytes} bytes it promised, so the upload was stopped.`),
            );
            return;
          }
          if (carry.byteLength > 0) controller.enqueue(encoder.encode(Buffer.from(carry).toString('base64')));
          controller.enqueue(close);
          controller.close();
          return;
        }
        read += value.byteLength;
        if (read > sizeBytes) {
          controller.error(new Error(`${path} handed over more than the ${sizeBytes} bytes it promised, so the upload was stopped.`));
          await reader.cancel().catch(() => undefined);
          return;
        }
        const joined = new Uint8Array(carry.byteLength + value.byteLength);
        joined.set(carry, 0);
        joined.set(value, carry.byteLength);
        const whole = joined.byteLength - (joined.byteLength % 3);
        carry = joined.slice(whole);
        if (whole > 0) {
          controller.enqueue(encoder.encode(Buffer.from(joined.subarray(0, whole)).toString('base64')));
          return;
        }
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}
