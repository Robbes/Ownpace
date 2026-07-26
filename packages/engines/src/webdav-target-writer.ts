/**
 * WebDAV Target Writer Implementation
 * 
 * Implements FileTargetWriter interface for WebDAV file synchronization.
 * Uses rclone for bulk operations and direct WebDAV API calls for individual operations.
 * Follows the idempotency pattern with ledger fast-path and target-side existence checks.
 */

import type {
  FileTargetWriter,
  FileFolder,
  RawFileItem,
  UpsertResult,
  Ledger,
  TenantId,
  MappingId,
} from '@openmig/shared';
import { fileNaturalKeyHash, fileContentHash } from '@openmig/shared';

/**
 * Configuration for WebDAV target writer
 */
export interface WebDAVTargetConfig {
  /** WebDAV endpoint URL */
  url: string;
  /** Authentication username */
  username: string;
  /** Authentication password or token */
  password: string;
  /** Root path for file storage */
  rootPath?: string;
  /** Use chunked uploads for large files */
  chunkedUploads?: boolean;
  /** Chunk size for chunked uploads (in bytes) */
  chunkSize?: number;
}

/**
 * WebDAV target writer implementation
 */
export class WebDAVTargetWriter implements FileTargetWriter {
  private readonly config: WebDAVTargetConfig;
  private readonly ledger: Ledger;
  private readonly tenantId: TenantId;
  private readonly mappingId: MappingId;
  private readonly httpClient: HttpClient;

  constructor(
    config: WebDAVTargetConfig,
    deps: {
      ledger: Ledger;
      tenantId: TenantId;
      mappingId: MappingId;
      httpClient?: HttpClient;
    },
  ) {
    this.config = config;
    this.ledger = deps.ledger;
    this.tenantId = deps.tenantId;
    this.mappingId = deps.mappingId;
    this.httpClient = deps.httpClient ?? createDefaultHttpClient();
  }

  /**
   * Ensure a directory exists with the given folder metadata.
   * Returns the directory ID (a path relative to this writer's own root) for use in
   * subsequent operations.
   *
   * `folder.path` is root-relative to the *source's* connection (see
   * `WebdavFileSource.toRelativePath`) -- it is never this writer's own absolute URL, so it can
   * be resolved directly against this writer's own root via `buildUrl`/`directoryExists`
   * without any translation. The empty string denotes the sync root itself (the account's file
   * storage root), which always exists already and needs no PROPFIND/MKCOL round trip.
   */
  async ensureDirectory(folder: FileFolder): Promise<string> {
    const directoryPath = this.normalizeRelativePath(folder.path);
    if (directoryPath === '') {
      return '';
    }

    // Check if directory already exists via PROPFIND
    const exists = await this.directoryExists(directoryPath);
    if (exists) {
      return directoryPath;
    }

    // Create new directory using MKCOL
    await this.createDirectory(directoryPath, folder);
    return directoryPath;
  }

  /**
   * Idempotently write a file to the target.
   * Uses ledger fast-path and target-side existence check to ensure idempotency.
   */
  async upsertFile(
    _parentId: string,
    raw: RawFileItem,
  ): Promise<UpsertResult> {
    // The natural key (raw.item.path) is already root-relative and self-contained (see
    // WebdavFileSource.toRelativePath) -- it includes any containing subfolder itself, so it
    // resolves directly against this writer's own root. `parentId` (the source-relative
    // directory path from ensureDirectory) is not needed here: concatenating it with an
    // already-full relative path would double the prefix.
    const naturalKey = raw.item.path;
    const naturalKeyHash = fileNaturalKeyHash(naturalKey);

    // LEDGER FAST-PATH: Check if already migrated
    const known = await this.ledger.find(this.tenantId, this.mappingId, 'file', naturalKeyHash);
    if (known) {
      return { targetId: known.targetId, created: false };
    }

    // Compute content hash for change detection (only for files with content, not directories)
    const contentHashValue = raw.content ? fileContentHash(raw.content) : fileContentHash(new Uint8Array(0));

    // Check if file already exists on target
    const existingId = await this.findFileByNaturalKey(_parentId, naturalKey);
    if (existingId) {
      // Record in ledger if not present (adopt existing)
      await this.ledger.recordIfAbsent({
        tenantId: this.tenantId,
        itemType: 'file',
        mappingId: this.mappingId,
        naturalKeyHash,
        contentHash: contentHashValue,
        targetId: existingId,
        createdAt: new Date().toISOString(),
      });
      return { targetId: existingId, created: false };
    }

    // Upload the file to the target
    const fileId = await this.uploadFile(raw);

    // RECORD IN LEDGER
    await this.ledger.recordIfAbsent({
      tenantId: this.tenantId,
        itemType: 'file',
      mappingId: this.mappingId,
      naturalKeyHash,
      contentHash: contentHashValue,
      targetId: fileId,
      createdAt: new Date().toISOString(),
    });

    return { targetId: fileId, created: true };
  }

  /**
   * Find a file by its natural key (path).
   * Returns the file ID if found, undefined otherwise.
   */
  async findFileByNaturalKey(
    _parentId: string,
    naturalKey: string,
  ): Promise<string | undefined> {
    // naturalKey is already root-relative and self-contained; resolve it directly (see upsertFile).
    const filePath = this.normalizeRelativePath(naturalKey);

    try {
      const response = await this.httpClient.request({
        method: 'PROPFIND',
        url: this.buildUrl(filePath),
        headers: {
          Depth: '0',
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
      });

      if (response.status === 207 || response.status === 200) {
        return filePath;
      }
    } catch {
      // File doesn't exist
    }

    return undefined;
  }

  // Private helper methods

  /** Normalize a root-relative path: no leading/trailing slashes, forward slashes only. */
  private normalizeRelativePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }

  private async directoryExists(path: string): Promise<boolean> {
    try {
      const response = await this.httpClient.request({
        method: 'PROPFIND',
        url: this.buildUrl(path),
        headers: {
          Depth: '0',
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
      });
      return response.status === 207 || response.status === 200;
    } catch {
      return false;
    }
  }

  private async createDirectory(path: string, _folder: FileFolder): Promise<void> {
    await this.requestWithRetry({
      method: 'MKCOL',
      url: this.buildUrl(path),
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      },
    });
  }

  /**
   * Retry a write request a few times on a transient 5xx before giving up. Needed for the
   * demo/self-host Nextcloud backend, which uses SQLite by default -- a single-writer database
   * that genuinely returns "SQLSTATE[HY000]: General error: 5 database is locked" under
   * concurrent domain writes (confirmed live for the sibling CalDAV/CardDAV target writers,
   * same server). The lock is transient by nature, so a short backoff is the standard mitigation
   * rather than requiring every demo deployment to run a concurrent-safe database.
   */
  private async requestWithRetry(
    options: HttpRequestOptions,
    attempts = 3,
    backoffMs = 250,
  ): Promise<HttpResponse> {
    let lastResponse: HttpResponse | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const response = await this.httpClient.request(options);
      if (response.status < 500 || attempt === attempts) {
        return response;
      }
      lastResponse = response;
      await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    }
    // Unreachable in practice (the loop always returns on its last iteration), but keeps
    // TypeScript happy about a guaranteed return value.
    return lastResponse as HttpResponse;
  }

  private async uploadFile(raw: RawFileItem): Promise<string> {
    // raw.item.path is root-relative and self-contained (see WebdavFileSource.toRelativePath);
    // resolve it directly instead of re-deriving it from a parent directory id.
    const filePath = this.normalizeRelativePath(raw.item.path);

    // Check if file is large and should use chunked upload
    const useChunked = this.config.chunkedUploads &&
                      raw.content && raw.content.length > (this.config.chunkSize || 10 * 1024 * 1024);

    if (useChunked && raw.content) {
      return await this.uploadFileChunked(filePath, raw.content);
    }

    // Simple PUT for small files - only if content exists
    if (raw.content) {
      const response = await this.requestWithRetry({
        method: 'PUT',
        url: this.buildUrl(filePath),
        body: raw.content,
        headers: {
          'Content-Type': raw.item.mimeType || 'application/octet-stream',
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
      });
      // RFC 4918 §9.7.1: PUT returns 201 (created) or 204 (existing resource replaced). Without
      // this check a failed write (e.g. the parent collection doesn't actually exist) was
      // silently treated as success, and the ledger recorded a false "copied" status that then
      // permanently blocked retries via its own fast-path (confirmed live).
      if (response.status !== 201 && response.status !== 204) {
        throw new Error(`PUT failed for ${filePath} with status ${response.status}: ${response.body}`);
      }
    }

    return filePath;
  }

  private async uploadFileChunked(
    filePath: string,
    content: Uint8Array,
  ): Promise<string> {
    const chunkSize = this.config.chunkSize || 10 * 1024 * 1024; // 10MB default
    const totalChunks = Math.ceil(content.length / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, content.length);
      const chunk = content.slice(start, end);

      const range = `bytes=${start}-${end - 1}/${content.length}`;

      const response = await this.requestWithRetry({
        method: 'PUT',
        url: this.buildUrl(filePath),
        body: chunk,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': range,
          Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
        },
      });
      if (response.status !== 200 && response.status !== 201 && response.status !== 204) {
        throw new Error(`Chunked PUT failed for ${filePath} with status ${response.status}: ${response.body}`);
      }
    }

    return filePath;
  }

  private buildUrl(path: string): string {
    const baseUrl = this.config.url.replace(/\/$/, '');
    const normalizedPath = path.replace(/^\/+/, '');
    return `${baseUrl}/${normalizedPath}`;
  }
}

/**
 * HTTP client interface for WebDAV requests
 */
export interface HttpClient {
  request(options: HttpRequestOptions): Promise<HttpResponse>;
}

export interface HttpRequestOptions {
  method: string;
  url: string;
  body?: string | Buffer | Uint8Array;
  headers?: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * Create a default HTTP client using Node.js fetch
 */
function createDefaultHttpClient(): HttpClient {
  return {
    async request(options: HttpRequestOptions): Promise<HttpResponse> {
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
      });

      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        body,
        headers,
      };
    },
  };
}
