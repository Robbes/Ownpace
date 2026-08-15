// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Recording what Google Drive actually answered, so a test can replay it
 * (workplan 0042 T6 — the "recorded contract" tier `docs/testing.md` names).
 *
 * WHY THIS EXISTS. Drive cannot be containerised, so the connector cannot be
 * proved the way `dav-sync.integration.test.ts` proves WebDAV. The alternative
 * is a fixture recorded from a real tenant once and replayed in CI forever —
 * which is only worth anything if the fixture is what Google REALLY sent.
 * Hand-written fixtures prove that our parser agrees with our idea of Drive; a
 * recording proves it agrees with Drive.
 *
 * WHAT IT DELIBERATELY DOES NOT RECORD, and this is the load-bearing part: a
 * customer's file names, folder names, ids, and document bytes. A fixture lands
 * in a public repository, and "it is only a test file" has never once made
 * somebody's data less theirs.
 *
 *  - **Names** become `f1.pdf`, `f2.docx`, `folder-1` — the EXTENSION and the
 *    folder/file distinction survive, because path derivation is what the
 *    replay checks and both matter to it.
 *  - **Ids** become `id-1`, `id-2`, consistently, so a listing and the metadata
 *    fetch that follows it still refer to the same file.
 *  - **Bodies of exports and downloads** become `{ sha256, byteLength }`. A
 *    contract test needs to know that the bytes arrived and whether two calls
 *    produced the same ones; it does not need the document.
 *  - Everything structural is kept verbatim: mime types, sizes, checksums,
 *    timestamps, pagination tokens, status codes, and the shape of every JSON
 *    envelope.
 *
 * So a recorded fixture answers "does our connector parse what Drive sends, and
 * derive the right paths from it". It cannot answer anything about a specific
 * customer's documents — the byte-stability verdict is the thing that speaks to
 * that, and it is printed for a human rather than stored.
 *
 * The transport type is structural on purpose: this package would otherwise
 * need a dependency on `@openmig/connectors` to name one function shape.
 */

import { createHash } from 'node:crypto';

/** The seam being wrapped — structurally `DriveTransport`. */
export type RecordableTransport = (
  url: string,
  init?: { readonly headers?: Readonly<Record<string, string>> },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;

/** One recorded exchange, already redacted. */
export interface DriveExchange {
  /** The request URL, with ids replaced by their pseudonyms. */
  readonly url: string;
  readonly status: number;
  /** Present for a JSON answer: the redacted body. */
  readonly json?: unknown;
  /** Present for a byte answer: what arrived, without the bytes. */
  readonly bytes?: { readonly sha256: string; readonly byteLength: number };
}

export interface DriveCapture {
  readonly recordedAt: string;
  /**
   * Stated in the file itself, because a fixture outlives the conversation that
   * produced it and the next reader will not have been here.
   */
  readonly note: string;
  readonly exchanges: readonly DriveExchange[];
}

/**
 * A stable pseudonym table.
 *
 * Stable is the whole requirement: the id in a listing and the id in the
 * metadata fetch that follows must map to the SAME pseudonym, or a replay is
 * pointing at a file that never appeared.
 */
class Pseudonyms {
  private readonly ids = new Map<string, string>();
  private readonly names = new Map<string, string>();

  id(real: string): string {
    // `root` is Google's own well-known folder id, not a customer's. Keeping it
    // readable is worth more than pretending it is a secret.
    if (real === 'root') return 'root';
    const seen = this.ids.get(real);
    if (seen) return seen;
    const made = `id-${this.ids.size + 1}`;
    this.ids.set(real, made);
    return made;
  }

  name(real: string, isFolder: boolean): string {
    const seen = this.names.get(real);
    if (seen) return seen;
    // The extension survives: a connector that mangles `.docx` into `.doc`
    // would otherwise pass a replay that had thrown the evidence away.
    const dot = real.lastIndexOf('.');
    const ext = !isFolder && dot > 0 ? real.slice(dot) : '';
    const made = isFolder ? `folder-${this.names.size + 1}` : `f${this.names.size + 1}${ext}`;
    this.names.set(real, made);
    return made;
  }

  /** Replace every recorded id wherever it appears in a URL. */
  scrubUrl(url: string): string {
    let out = url;
    for (const [real, fake] of this.ids) {
      if (real === 'root') continue;
      out = out.split(real).join(fake).split(encodeURIComponent(real)).join(fake);
    }
    return out;
  }
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Redact one Drive JSON body, keeping every structural field verbatim. */
function redactBody(body: unknown, names: Pseudonyms): unknown {
  if (Array.isArray(body)) return body.map((b) => redactBody(b, names));
  if (body === null || typeof body !== 'object') return body;

  const source = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const isFolder = source['mimeType'] === FOLDER_MIME;

  for (const [key, value] of Object.entries(source)) {
    if (key === 'id' && typeof value === 'string') {
      out[key] = names.id(value);
    } else if (key === 'name' && typeof value === 'string') {
      out[key] = names.name(value, isFolder);
    } else if (key === 'parents' && Array.isArray(value)) {
      out[key] = value.map((p) => (typeof p === 'string' ? names.id(p) : p));
    } else if (key === 'nextPageToken') {
      // A page token is an opaque server cursor, and a real one is both
      // useless later and not ours to keep. Its PRESENCE is the fact a replay
      // needs — it drives the pagination loop — so that is what survives.
      out[key] = typeof value === 'string' ? 'page-token' : value;
    } else {
      out[key] = redactBody(value, names);
    }
  }
  return out;
}

/**
 * Wrap a transport so every exchange is recorded, redacted, in order.
 *
 * The wrapper reads each response ONCE and hands the caller a replayable copy —
 * a body can only be consumed once, and a recorder that consumed it would break
 * the very call it is observing.
 */
export function createRecordingTransport(inner: RecordableTransport): {
  transport: RecordableTransport;
  capture: () => DriveCapture;
} {
  const names = new Pseudonyms();
  const exchanges: DriveExchange[] = [];

  const transport: RecordableTransport = async (url, init) => {
    const response = await inner(url, init);

    // JSON or bytes is decided the way the connector decides it: a metadata
    // call is answered as JSON, an `alt=media` or `/export` call as bytes.
    const wantsBytes = url.includes('alt=media') || url.includes('/export');

    if (wantsBytes) {
      const buffer = await response.arrayBuffer();
      const view = new Uint8Array(buffer);
      exchanges.push({
        url: names.scrubUrl(url),
        status: response.status,
        bytes: {
          sha256: createHash('sha256').update(view).digest('hex'),
          byteLength: view.byteLength,
        },
      });
      return {
        ok: response.ok,
        status: response.status,
        json: async () => ({}),
        arrayBuffer: async () => buffer,
        text: async () => '',
      };
    }

    const body = response.ok ? await response.json() : undefined;
    exchanges.push({
      url: names.scrubUrl(url),
      status: response.status,
      ...(body === undefined ? {} : { json: redactBody(body, names) }),
    });
    return {
      ok: response.ok,
      status: response.status,
      json: async () => body,
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
    };
  };

  return {
    transport,
    capture: () => ({
      recordedAt: new Date().toISOString(),
      note:
        'Recorded from a real Google Drive and REDACTED: file and folder names, ids and page ' +
        'tokens are pseudonyms, and export/download bodies are reduced to a sha256 and a ' +
        'length. Structure — mime types, sizes, checksums, timestamps, status codes, envelope ' +
        'shape — is verbatim. This fixture pins that our connector parses what Drive sends; it ' +
        'says nothing about any particular document.',
      exchanges,
    }),
  };
}
