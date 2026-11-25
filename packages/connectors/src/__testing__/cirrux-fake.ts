// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAKE CIRRUX, AS STRICT AS ITS DOCUMENTATION (workplan 0160 T5).
 *
 * `api.cirrux.co` is not reachable from where this repository is tested, so
 * every Cirrux behaviour is proven against this: the OAuth token endpoint, the
 * user, workspace and Drive routes, and Cirrux's storage behind the presigned
 * part URLs. It is written from `https://cirrux.co/help/api` and
 * `https://cirrux.co/help/api/drive` (read 2026-11-19), and it is STRICT where
 * the page is:
 *
 * - **A refresh token works once.** Each refresh retires it and issues a
 *   successor; a retired one presented again SIGNS THE PERSON OUT, which here
 *   retires the successor too, so every later refresh fails. `presented`
 *   records every token the endpoint was shown, so a test can say none was
 *   shown twice.
 * - **Names are unique among live siblings, ignoring case and Unicode form**,
 *   files among files and folders among folders (`https://cirrux.co/help/drive`:
 *   "Two files in the same folder can't share a name, and neither can two
 *   folders"); a clash is `422 name_taken`.
 * - **A replace under `base_ctag`** answers `409 version_conflict` when the
 *   file's content has moved on.
 * - **`complete` decrypts what arrived** with `decryptCxdrv2`, which is written
 *   here FROM THE PAGE and shares no code with `cirrux-drive-format.ts`, so a
 *   round trip through the two is a test of one reading against another
 *   rather than of a function against itself. Cirrux decrypts the first chunk;
 *   this decrypts every one, so a stored file is the plaintext it decrypted.
 * - **Permanent deletes are recorded**, so a test can say none was sent.
 */

import { createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { RotatingGrantStore, RotationOutcome } from '../cirrux-token-provider.ts';
import { cirruxDriveNotConnected } from '../cirrux-token-provider.ts';

// ---------------------------------------------------------------------------
// The store's contract, in memory
// ---------------------------------------------------------------------------

/**
 * `RotatingGrantStore` in memory, with the contract the database's holds: one
 * rotation at a time (a promise chain is the lock), the token read under it,
 * the outcome acted on before it is released. `writes` counts what was stored,
 * `asked` how often `holdsGrant` was asked. A disconnect is
 * `refreshToken = undefined`, as the database's removes the key.
 */
export class MemoryRotatingGrantStore implements RotatingGrantStore {
  refreshToken: string | undefined;
  writes = 0;
  asked = 0;
  /** The connection, for `forgetCirruxAccess`; absent unless a test names one. */
  readonly connection: string | undefined;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(refreshToken: string | undefined, connection?: string) {
    this.refreshToken = refreshToken;
    this.connection = connection;
  }

  async holdsGrant(): Promise<boolean> {
    this.asked += 1;
    return typeof this.refreshToken === 'string' && this.refreshToken.trim() !== '';
  }

  rotate<T>(use: (refreshToken: string) => Promise<RotationOutcome<T>>): Promise<T> {
    const run = this.tail.then(async () => {
      const stored = this.refreshToken;
      if (!stored) throw cirruxDriveNotConnected();
      const outcome = await use(stored);
      if (outcome.kind === 'rotated') {
        // Compare-and-swap on what was read, as the database's does.
        if (this.refreshToken !== stored) throw new Error('the stored grant changed under the lock');
        this.refreshToken = outcome.refreshToken;
        this.writes += 1;
        return outcome.value;
      }
      if (outcome.kind === 'spent') {
        if (this.refreshToken === stored) this.refreshToken = undefined;
        this.writes += 1;
      }
      throw outcome.error;
    });
    // The next rotation waits for this one to settle; its failure is the caller's, through `run`.
    this.tail = Promise.allSettled([run]);
    return run;
  }
}

// ---------------------------------------------------------------------------
// The format, read from the page (never imported from the writer's side)
// ---------------------------------------------------------------------------

/**
 * Decrypt a `CXDRV2` object, as `https://cirrux.co/help/api/drive` describes
 * it: a 16-byte header (`CXDRV2`, two zero bytes, version 1, algorithm 1,
 * the chunk size as a little-endian u32, two zero bytes), then chunks of a
 * 12-byte IV, ciphertext and a 16-byte tag, each authenticated with 56 bytes
 * of AAD: the file's UUID as 16 raw bytes, the chunk index, the chunk count
 * and the chunk's plaintext size as little-endian u32s, zero padding.
 *
 * The chunk index starts at `firstIndex`, which the page does not state: a
 * test may ask both readings of one object.
 */
export function decryptCxdrv2(p: {
  readonly object: Uint8Array;
  readonly key: Uint8Array;
  readonly fileUuid: string;
  readonly plaintextSizeBytes: number;
  readonly firstIndex?: number;
  /** Only the first chunk, as Cirrux's `complete` checks. */
  readonly firstChunkOnly?: boolean;
}): Uint8Array {
  const o = Buffer.from(p.object);
  if (o.length < 16) throw new Error('shorter than the header');
  if (o.subarray(0, 6).toString('latin1') !== 'CXDRV2' || o[6] !== 0 || o[7] !== 0) throw new Error('not CXDRV2');
  if (o[8] !== 1) throw new Error(`format version ${o[8]}`);
  if (o[9] !== 1) throw new Error(`algorithm ${o[9]}`);
  if (o[14] !== 0 || o[15] !== 0) throw new Error('header padding is not zero');
  const chunkSize = o.readUInt32LE(10);
  const count = p.plaintextSizeBytes === 0 ? 0 : Math.ceil(p.plaintextSizeBytes / chunkSize);
  const uuid = Buffer.from(p.fileUuid.replace(/-/g, ''), 'hex');
  if (uuid.length !== 16) throw new Error('the file uuid is not 16 bytes');
  const out: Buffer[] = [];
  let at = 16;
  for (let i = 0; i < count; i++) {
    const size = i === count - 1 ? p.plaintextSizeBytes - chunkSize * (count - 1) : chunkSize;
    const iv = o.subarray(at, at + 12);
    const ciphertext = o.subarray(at + 12, at + 12 + size);
    const tag = o.subarray(at + 12 + size, at + 12 + size + 16);
    if (tag.length !== 16) throw new Error(`chunk ${i} is cut short`);
    const aad = Buffer.alloc(56);
    uuid.copy(aad, 0);
    aad.writeUInt32LE((p.firstIndex ?? 0) + i, 16);
    aad.writeUInt32LE(count, 20);
    aad.writeUInt32LE(size, 24);
    // The tag's length is named, as the encoder names it, so Node itself
    // refuses a shorter tag at setAuthTag and not only the check above
    // (workplan 0166 T2, Semgrep's gcm-no-tag-length).
    const decipher = createDecipheriv('aes-256-gcm', p.key, iv, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    out.push(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
    at += 12 + size + 16;
    if (p.firstChunkOnly) return Uint8Array.from(out[0]!);
  }
  if (at !== o.length) throw new Error(`${o.length - at} bytes after the last chunk`);
  return Uint8Array.from(Buffer.concat(out));
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

export interface FakeFile {
  uuid: string;
  folder_uuid?: string;
  name: string;
  content_type: string;
  bytes: Uint8Array;
  trashed: boolean;
  ctag: number;
  version: number;
  content_modified_at: string | null;
  upload_status: 'uploading' | 'completed';
}

export interface FakeFolder {
  uuid: string;
  parent_uuid?: string;
  name: string;
  trashed: boolean;
}

interface Staged {
  readonly fileUuid: string;
  readonly kind: 'replace' | 'upload';
  readonly key: Uint8Array;
  readonly plaintextSize: number;
  readonly chunkSize: number;
  readonly chunkCount: number;
  readonly ciphertextSize: number;
  readonly contentType?: string;
  readonly contentModifiedAt?: string | null;
  readonly folderUuid?: string | null;
  readonly name?: string;
  readonly parts: Map<number, Uint8Array>;
}

export interface FakeRequest {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly authorization?: string;
}

const API = 'https://api.cirrux.co/public_api/v1';
const TOKEN = 'https://api.cirrux.co/oauth/token';
const STORAGE = 'https://storage.fake.invalid';

const nameKey = (name: string) => name.trim().normalize('NFC').toLowerCase();

export class FakeCirrux {
  /** Every refresh token the token endpoint has been shown, in order. */
  readonly presented: string[] = [];
  /** Every API request, in order (the token endpoint and storage apart). */
  readonly requests: FakeRequest[] = [];
  /** Every storage PUT, in order. */
  readonly partPuts: Array<{ url: string; bytes: number }> = [];
  readonly files = new Map<string, FakeFile>();
  readonly folders = new Map<string, FakeFolder>();
  /** The token that works, and every one that was retired. */
  liveRefresh: string | undefined;
  readonly retired = new Set<string>();
  signedOut = false;
  private readonly liveAccess = new Set<string>();
  readonly accessSeconds: number;
  chunkSize: number;
  poolBytes = 20 * 1000 * 1000 * 1000;
  usedBytes = 1000;
  /** Answer `429` this many times more, to whichever route asks next. */
  rateLimitNext = 0;
  rateLimitTokenNext = 0;
  retryAfterSeconds = '2';
  /** One-shot faults on the token endpoint. */
  tokenFault: 'none' | 'reset' | 'refused-connection' | 'no-successor' | 'server-error' = 'none';
  /** The workspace `/user/profile` names (workplan 0174 T5): a test signs in to another by changing it. */
  workspaceUuid = '0c9b4a8e-2222-4a2b-8c3d-000000000002';
  /** How long the token endpoint takes, so two refreshes can overlap. */
  tokenDelayMs = 5;
  /** The simple upload's cap: 100 MB, as the page says, unless a test says otherwise. */
  simpleUploadMaxBytes = 100 * 1000 * 1000;
  /** Answer the next PUTs to storage `403`, as a presigned URL past its hour does. */
  refuseNextPartPuts = 0;
  /** Called at every storage PUT, so a test can see how far the source was read by then. */
  onPartPut: ((partNumber: number) => void) | undefined;
  /** What the next consent grants, as the token answer's `scope` says it. */
  grantedScope = 'user.profile workspace.read drive.read drive.create drive.update drive.delete';
  /** Every authorization code exchanged, in order, whether it was accepted or not. */
  readonly exchangedCodes: string[] = [];
  private readonly codes = new Map<string, { readonly challenge: string; readonly redirectUri: string; readonly scope: string }>();
  private readonly staged = new Map<string, Staged>();

  constructor(p: { refreshToken?: string; accessSeconds?: number; chunkSize?: number } = {}) {
    this.liveRefresh = p.refreshToken ?? 'rt-0';
    this.accessSeconds = p.accessSeconds ?? 900;
    this.chunkSize = p.chunkSize ?? 5 * 1024 * 1024;
  }

  /** The Drive's root folder listing and every route, as a `fetch`. */
  readonly fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === TOKEN) return this.token(init);
    if (url.startsWith(STORAGE)) return this.storagePut(url, init);
    if (!url.startsWith(API)) return json(404, { error: 'not_found', error_description: `fake has no ${url}` });
    return this.api(url.slice(API.length), init);
  }) as typeof fetch;

  /** The presigned part URLs' own client. */
  readonly partFetch = (url: string, init: RequestInit): Promise<Response> => this.storagePut(url, init);

  /** What Cirrux would show of a file. */
  fileAt(path: string): FakeFile | undefined {
    const segments = path.split('/');
    const name = segments.pop()!;
    let parent: string | undefined;
    for (const s of segments) {
      const f = [...this.folders.values()].find((x) => !x.trashed && x.parent_uuid === parent && x.name === s);
      if (!f) return undefined;
      parent = f.uuid;
    }
    return [...this.files.values()].find((x) => !x.trashed && x.folder_uuid === parent && x.name === name);
  }

  /** Put a folder in place, as the person might have. */
  addFolder(name: string, parent?: string): FakeFolder {
    const folder: FakeFolder = { uuid: randomUUID(), name, trashed: false, ...(parent ? { parent_uuid: parent } : {}) };
    this.folders.set(folder.uuid, folder);
    return folder;
  }

  /** Put a file in place, as the person might have. */
  addFile(name: string, bytes: Uint8Array, folder?: string): FakeFile {
    const file: FakeFile = {
      uuid: randomUUID(),
      name,
      content_type: 'application/octet-stream',
      bytes,
      trashed: false,
      ctag: 0,
      version: 1,
      content_modified_at: null,
      upload_status: 'completed',
      ...(folder ? { folder_uuid: folder } : {}),
    };
    this.files.set(file.uuid, file);
    return file;
  }

  /** Edit a file's content as the person would in Cirrux: its ctag moves on. */
  editInCirrux(uuid: string, bytes: Uint8Array): void {
    const f = this.files.get(uuid)!;
    f.bytes = bytes;
    f.ctag += 1;
    f.version += 1;
  }

  /** Every access token issued so far stops working, as fifteen minutes would. */
  expireAccessTokens(): void {
    this.liveAccess.clear();
  }

  /**
   * What Cirrux's consent screen does once the person allows: a single-use
   * code, bound to the PKCE challenge and the redirect it was asked under.
   */
  issueCode(p: { readonly challenge: string; readonly redirectUri: string }): string {
    const code = `code-${randomBytes(6).toString('hex')}`;
    this.codes.set(code, { ...p, scope: this.grantedScope });
    return code;
  }

  // -- the token endpoint -----------------------------------------------

  private async token(init?: RequestInit): Promise<Response> {
    const form = new URLSearchParams(String(init?.body ?? ''));
    const presented = form.get('refresh_token') ?? '';
    await new Promise((r) => setTimeout(r, this.tokenDelayMs));
    if (this.tokenFault === 'refused-connection') {
      this.tokenFault = 'none';
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    }
    if (this.rateLimitTokenNext > 0) {
      this.rateLimitTokenNext -= 1;
      return json(429, { error: 'rate_limited', error_description: 'Too many requests.' }, { 'Retry-After': this.retryAfterSeconds });
    }
    if (this.tokenFault === 'server-error') {
      this.tokenFault = 'none';
      return json(503, { error: 'internal_server_error', error_description: 'Something went wrong.' });
    }
    if (form.get('grant_type') === 'authorization_code') return this.exchangeCode(form);
    this.presented.push(presented);
    if (form.get('grant_type') !== 'refresh_token' || !form.get('client_id')) {
      return json(400, { error: 'invalid_request', error_description: 'refresh_token and client_id are required.' });
    }
    if (this.retired.has(presented)) {
      // A retired token presented again: the person is signed out.
      this.signedOut = true;
      if (this.liveRefresh) this.retired.add(this.liveRefresh);
      this.liveRefresh = undefined;
      return json(400, { error: 'invalid_grant', error_description: 'The refresh token was already used.' });
    }
    if (presented !== this.liveRefresh) {
      return json(400, { error: 'invalid_grant', error_description: 'Unknown refresh token.' });
    }
    this.retired.add(presented);
    const successor = `rt-${this.retired.size}-${randomBytes(4).toString('hex')}`;
    this.liveRefresh = successor;
    const access = `at-${randomBytes(6).toString('hex')}`;
    this.liveAccess.add(access);
    if (this.tokenFault === 'reset') {
      // Cirrux did the refresh; the answer never arrived.
      this.tokenFault = 'none';
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
    }
    if (this.tokenFault === 'no-successor') {
      this.tokenFault = 'none';
      return json(200, { access_token: access, token_type: 'Bearer', expires_in: this.accessSeconds });
    }
    return json(200, { access_token: access, refresh_token: successor, token_type: 'Bearer', expires_in: this.accessSeconds });
  }

  /** The code exchange, as strict as RFC 7636 asks: the verifier must hash to the challenge. */
  private exchangeCode(form: URLSearchParams): Response {
    const code = form.get('code') ?? '';
    this.exchangedCodes.push(code);
    const issued = this.codes.get(code);
    this.codes.delete(code);
    if (!issued || !form.get('client_id')) {
      return json(400, { error: 'invalid_grant', error_description: 'The authorization code is unknown or was already used.' });
    }
    const verifier = form.get('code_verifier') ?? '';
    if (createHash('sha256').update(verifier, 'ascii').digest('base64url') !== issued.challenge) {
      return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed.' });
    }
    if (form.get('redirect_uri') !== issued.redirectUri) {
      return json(400, { error: 'invalid_grant', error_description: 'The redirect_uri does not match.' });
    }
    const refresh = `rt-consent-${randomBytes(4).toString('hex')}`;
    if (this.liveRefresh) this.retired.add(this.liveRefresh);
    this.liveRefresh = refresh;
    const access = `at-${randomBytes(6).toString('hex')}`;
    this.liveAccess.add(access);
    return json(200, {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: this.accessSeconds,
      scope: issued.scope,
    });
  }

  // -- storage, behind the presigned URLs -----------------------------------

  private async storagePut(url: string, init?: RequestInit): Promise<Response> {
    const m = /\/part\/([^/]+)\/(\d+)$/.exec(new URL(url).pathname);
    const staged = m ? this.staged.get(m[1]!) : undefined;
    if (!m || !staged || init?.method !== 'PUT') return new Response('NoSuchUpload', { status: 404 });
    this.onPartPut?.(Number(m[2]));
    if (this.refuseNextPartPuts > 0) {
      this.refuseNextPartPuts -= 1;
      await new Response(init.body as ConstructorParameters<typeof Response>[0]).arrayBuffer();
      return new Response('<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>', { status: 403 });
    }
    const bytes = new Uint8Array(await new Response(init.body as ConstructorParameters<typeof Response>[0]).arrayBuffer());
    staged.parts.set(Number(m[2]), bytes);
    this.partPuts.push({ url, bytes: bytes.byteLength });
    return new Response(null, { status: 200, headers: { ETag: `"etag-${m[2]}-${bytes.byteLength}"` } });
  }

  // -- the API ----------------------------------------------------------

  private async api(pathAndQuery: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const authorization = headers.get('authorization') ?? undefined;
    let body: unknown;
    if (init?.body !== undefined && init.body !== null) {
      const text = await new Response(init.body as ConstructorParameters<typeof Response>[0]).text();
      body = text === '' ? undefined : (JSON.parse(text) as unknown);
    }
    const [path, query = ''] = pathAndQuery.split('?');
    this.requests.push({ method, path: path!, ...(body !== undefined ? { body } : {}), ...(authorization ? { authorization } : {}) });

    if (this.rateLimitNext > 0) {
      this.rateLimitNext -= 1;
      return json(429, { error: 'rate_limited', error_description: 'Over the API rate limit.' }, { 'Retry-After': this.retryAfterSeconds });
    }
    const bearer = authorization?.replace(/^Bearer /, '') ?? '';
    if (!this.liveAccess.has(bearer)) {
      return json(401, { error: 'invalid_request', error_description: 'The access token is unknown, expired or revoked.' });
    }
    const params = new URLSearchParams(query);
    const b = (body ?? {}) as Record<string, unknown>;

    if (method === 'GET' && path === '/user/profile') {
      return json(200, {
        user: { object: 'user', uuid: '0c9b4a8e-1111-4a2b-8c3d-000000000001', username: 'ada', first_name: 'Ada', last_name: null },
        workspace: { object: 'workspace', uuid: this.workspaceUuid, name: 'Test Workspace', type: 'personal' },
      });
    }
    if (method === 'GET' && path === '/workspace/storage') {
      return json(200, { object: 'workspace_storage', used_bytes: this.usedBytes, pool_bytes: this.poolBytes });
    }
    if (method === 'GET' && path === '/drive/files') {
      const folder = params.get('folder_uuid') ?? undefined;
      if (folder && !this.liveFolder(folder)) return json(404, { error: 'folder_not_found' });
      return json(200, {
        object: 'list',
        folders: [...this.folders.values()].filter((f) => f.parent_uuid === folder && !f.trashed).map(folderView),
        files: [...this.files.values()].filter((f) => f.folder_uuid === folder && !f.trashed).map(fileView),
      });
    }
    if (method === 'POST' && path === '/drive/folders') {
      const name = String(b.name ?? '');
      const parent = (b.parent_uuid as string | null | undefined) ?? undefined;
      if (parent && !this.liveFolder(parent)) return json(404, { error: 'folder_not_found' });
      if ([...this.folders.values()].some((f) => !f.trashed && f.parent_uuid === parent && nameKey(f.name) === nameKey(name))) {
        return json(422, { error: 'name_taken', error_description: 'A live item with that name already exists in the folder.' });
      }
      return json(201, folderView(this.addFolder(name.trim(), parent)));
    }
    if (method === 'POST' && path === '/drive/files') {
      const name = String(b.name ?? '').trim();
      const folder = (b.folder_uuid as string | null | undefined) ?? undefined;
      if (typeof b.data !== 'string') return json(400, { error: 'invalid_body' });
      const bytes = Uint8Array.from(Buffer.from(b.data, 'base64'));
      if (bytes.byteLength > this.simpleUploadMaxBytes) return json(413, { error: 'file_too_large', max_size: this.simpleUploadMaxBytes });
      if (folder && !this.liveFolder(folder)) return json(404, { error: 'folder_not_found' });
      if (this.usedBytes + bytes.byteLength > this.poolBytes) return json(422, { error: 'storage_limit_exceeded', pool_bytes: this.poolBytes });
      if (this.nameTaken(name, folder)) return json(422, { error: 'name_taken' });
      const file = this.addFile(name, bytes, folder);
      file.content_type = String(b.content_type ?? 'application/octet-stream');
      file.content_modified_at = typeof b.content_modified_at === 'string' ? new Date(b.content_modified_at).toISOString() : null;
      this.usedBytes += bytes.byteLength;
      return json(201, fileView(file));
    }
    if (method === 'POST' && path === '/drive/uploads') return this.uploadInit(b);
    const uploadRoute = /^\/drive\/uploads\/([0-9a-f-]{36})\/(part_urls|complete|abort)$/.exec(path!);
    if (method === 'POST' && uploadRoute) {
      const [, uuid, step] = uploadRoute;
      const staged = this.staged.get(uuid!);
      if (!staged || staged.kind !== 'upload') return json(404, { error: 'not_found' });
      if (step === 'part_urls') return this.partUrls(uuid!, b);
      if (step === 'complete') return this.complete(uuid!, b);
      this.staged.delete(uuid!);
      this.files.delete(uuid!);
      return json(200, { object: 'upload', aborted: true });
    }
    const fileRoute = /^\/drive\/files\/([0-9a-f-]{36})(\/.*)?$/.exec(path!);
    if (fileRoute) {
      const file = this.files.get(fileRoute[1]!);
      const tail = fileRoute[2] ?? '';
      if (method === 'DELETE' && tail === '') {
        // Recorded so a test can say this product never sends one.
        if (!file) return json(404, { error: 'not_found' });
        this.files.delete(file.uuid);
        return new Response(null, { status: 204 });
      }
      if (!file) return json(404, { error: 'not_found' });
      if (method === 'GET' && tail === '') return json(200, fileView(file));
      if (method === 'GET' && tail === '/download') {
        return json(200, { uuid: file.uuid, name: file.name, size: file.bytes.byteLength, data: Buffer.from(file.bytes).toString('base64url') });
      }
      if (method === 'POST' && tail === '/trash') {
        file.trashed = true;
        file.version += 1;
        return json(200, fileView(file));
      }
      if (method === 'POST' && tail === '/replace') return this.replaceInit(file, b);
      if (method === 'POST' && tail === '/replace/part_urls') return this.partUrls(file.uuid, b);
      if (method === 'POST' && tail === '/replace/complete') return this.complete(file.uuid, b);
      if (method === 'POST' && tail === '/replace/abort') {
        this.staged.delete(file.uuid);
        return json(200, { object: 'upload', aborted: true });
      }
    }
    return json(404, { error: 'not_found', error_description: `fake has no ${method} ${path}` });
  }

  private liveFolder(uuid: string): boolean {
    const f = this.folders.get(uuid);
    return f !== undefined && !f.trashed;
  }

  private nameTaken(name: string, folder: string | undefined, except?: string): boolean {
    return [...this.files.values()].some(
      (f) => f.uuid !== except && !f.trashed && f.folder_uuid === folder && nameKey(f.name) === nameKey(name),
    );
  }

  /** `POST /drive/uploads`: the file is listed as `uploading` until complete. */
  private uploadInit(b: Record<string, unknown>): Response {
    const name = String(b.name ?? '').trim();
    const size = Number(b.plaintext_size_bytes);
    const folder = (b.folder_uuid as string | null | undefined) ?? undefined;
    if (!name || typeof b.content_type !== 'string' || !Number.isInteger(size) || size < 0) {
      return json(400, { error: 'invalid_body' });
    }
    if (size > 2 * 1024 ** 3) return json(413, { error: 'file_too_large', max_size: 2 * 1024 ** 3 });
    if (folder && !this.liveFolder(folder)) return json(404, { error: 'folder_not_found' });
    if (this.usedBytes + size > this.poolBytes) return json(422, { error: 'storage_limit_exceeded', pool_bytes: this.poolBytes });
    if (this.nameTaken(name, folder)) return json(422, { error: 'name_taken' });
    const file = this.addFile(name, new Uint8Array(0), folder);
    file.content_type = b.content_type;
    file.upload_status = 'uploading';
    const key = randomBytes(32);
    const count = Math.ceil(size / this.chunkSize);
    const staged: Staged = {
      fileUuid: file.uuid,
      kind: 'upload',
      key,
      plaintextSize: size,
      chunkSize: this.chunkSize,
      chunkCount: count,
      ciphertextSize: 16 + count * 28 + size,
      contentType: b.content_type,
      contentModifiedAt: typeof b.content_modified_at === 'string' ? new Date(b.content_modified_at).toISOString() : null,
      ...(folder ? { folderUuid: folder } : {}),
      name,
      parts: new Map(),
    };
    this.staged.set(file.uuid, staged);
    return json(200, {
      file_uuid: file.uuid,
      version_uuid: randomUUID(),
      data_key: key.toString('base64'),
      chunk_size_bytes: staged.chunkSize,
      chunk_count: staged.chunkCount,
      plaintext_size_bytes: size,
      ciphertext_size_bytes: staged.ciphertextSize,
      s3_upload_id: randomBytes(8).toString('hex'),
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      upload_status: 'uploading',
    });
  }

  private replaceInit(file: FakeFile, b: Record<string, unknown>): Response {
    const size = Number(b.plaintext_size_bytes);
    if (!Number.isInteger(size) || size < 0) return json(422, { error: 'invalid_file_size' });
    if (size > 2 * 1024 ** 3) return json(413, { error: 'file_too_large', max_size: 2 * 1024 ** 3 });
    if (b.base_ctag !== undefined && b.base_ctag !== file.ctag) {
      return json(409, { error: 'version_conflict', error_description: 'The file has a newer version.', ctag: file.ctag });
    }
    if (this.staged.has(file.uuid)) return json(409, { error: 'upload_in_progress' });
    const contentModifiedAt = typeof b.content_modified_at === 'string' ? new Date(b.content_modified_at).toISOString() : null;
    if (size === 0) {
      file.bytes = new Uint8Array(0);
      file.ctag += 1;
      file.content_modified_at = contentModifiedAt;
      return json(200, { file_uuid: file.uuid, upload_status: 'completed', chunk_count: 0, plaintext_size_bytes: 0, ciphertext_size_bytes: 16 });
    }
    const key = randomBytes(32);
    const count = Math.ceil(size / this.chunkSize);
    const staged: Staged = {
      fileUuid: file.uuid,
      kind: 'replace',
      key,
      plaintextSize: size,
      chunkSize: this.chunkSize,
      chunkCount: count,
      ciphertextSize: 16 + count * 28 + size,
      ...(typeof b.content_type === 'string' ? { contentType: b.content_type } : {}),
      contentModifiedAt,
      parts: new Map(),
    };
    this.staged.set(file.uuid, staged);
    return json(200, {
      file_uuid: file.uuid,
      version_uuid: randomUUID(),
      data_key: key.toString('base64'),
      chunk_size_bytes: staged.chunkSize,
      chunk_count: staged.chunkCount,
      plaintext_size_bytes: size,
      ciphertext_size_bytes: staged.ciphertextSize,
      s3_upload_id: randomBytes(8).toString('hex'),
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      upload_status: 'uploading',
    });
  }

  private partUrls(uuid: string, b: Record<string, unknown>): Response {
    if (!this.staged.has(uuid)) return json(409, { error: 'no_upload_in_progress' });
    const numbers = Array.isArray(b.part_numbers) ? (b.part_numbers as number[]) : [];
    if (numbers.length === 0 || numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 10000)) {
      return json(422, { error: 'invalid_part_numbers' });
    }
    return json(200, { part_urls: numbers.map((n) => ({ part_number: n, url: `${STORAGE}/part/${uuid}/${n}` })) });
  }

  private complete(uuid: string, b: Record<string, unknown>): Response {
    const staged = this.staged.get(uuid);
    if (!staged) return json(409, { error: 'no_upload_in_progress' });
    const parts = Array.isArray(b.parts) ? (b.parts as Array<{ part_number: number; etag: string }>) : [];
    const ordered = [...parts].sort((x, y) => x.part_number - y.part_number);
    const chunks: Uint8Array[] = [];
    for (const part of ordered) {
      const bytes = staged.parts.get(part.part_number);
      if (!bytes || part.etag !== `"etag-${part.part_number}-${bytes.byteLength}"`) return json(422, { error: 'invalid_parts' });
      chunks.push(bytes);
    }
    const object = Uint8Array.from(Buffer.concat(chunks));
    this.staged.delete(uuid);
    // A failed complete discards the upload: a new file goes with it.
    const discard = (error: string) => {
      if (staged.kind === 'upload') this.files.delete(uuid);
      return json(422, { error });
    };
    if (object.byteLength !== staged.ciphertextSize) return discard('upload_size_mismatch');
    let plaintext: Uint8Array;
    try {
      decryptCxdrv2({ object, key: staged.key, fileUuid: uuid, plaintextSizeBytes: staged.plaintextSize, firstChunkOnly: true });
      plaintext = decryptCxdrv2({ object, key: staged.key, fileUuid: uuid, plaintextSizeBytes: staged.plaintextSize });
    } catch {
      return discard('undecryptable_content');
    }
    const file = this.files.get(uuid)!;
    this.usedBytes += Math.max(0, plaintext.byteLength - file.bytes.byteLength);
    file.bytes = plaintext;
    if (staged.kind === 'upload') {
      // A new file: completed at its first version, `ctag` 0.
      file.upload_status = 'completed';
      file.content_modified_at = staged.contentModifiedAt ?? null;
      return json(200, fileView(file));
    }
    file.ctag += 1;
    file.version += 1;
    file.content_modified_at = staged.contentModifiedAt ?? null;
    if (staged.contentType) file.content_type = staged.contentType;
    return json(200, fileView(file));
  }
}

function fileView(f: FakeFile): Record<string, unknown> {
  return {
    object: 'drive_file',
    uuid: f.uuid,
    ...(f.folder_uuid ? { folder_uuid: f.folder_uuid } : {}),
    name: f.name,
    content_type: f.content_type,
    file_size_bytes: f.bytes.byteLength,
    upload_status: f.upload_status,
    trashed: f.trashed,
    version: f.version,
    ctag: f.ctag,
    content_modified_at: f.content_modified_at,
  };
}

function folderView(f: FakeFolder): Record<string, unknown> {
  return { object: 'drive_folder', uuid: f.uuid, ...(f.parent_uuid ? { parent_uuid: f.parent_uuid } : {}), name: f.name, trashed: f.trashed };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
