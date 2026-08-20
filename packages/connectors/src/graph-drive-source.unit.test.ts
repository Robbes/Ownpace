// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Graph Drive Source Unit Tests
 * 
 * Tests for Microsoft Graph Drive (OneDrive/SharePoint) file source connector.
 * Covers:
 * - Drive enumeration
 * - Delta query with deltaLink
 * - Delta paging
 * - Rename handling (same GUID, log not duplicate per §11.1)
 * - Path normalization
 * - cTag/quickXorHash change detection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphDriveSource } from './graph-drive-source.ts';
import type { TokenProvider, OAuth2Token, SyncCursor, ThrottleLimiter } from '@openmig/shared';
import type { GraphDriveSourceConfig, GraphDriveItem } from './graph-drive-source.types.ts';

describe('GraphDriveSource', () => {
  let mockTokenProvider: TokenProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Setup mock token provider
    mockTokenProvider = {
      getToken: vi.fn().mockResolvedValue({
        accessToken: 'mock-access-token',
        tokenType: 'Bearer',
        expiresAt: Date.now() / 1000 + 3600,
      } as OAuth2Token),
      refresh: vi.fn(),
      isTokenValid: vi.fn().mockReturnValue(true),
      getTokenStatus: vi.fn(),
    };

    // Setup fetch mock
    fetchMock = vi.fn();
    // vitest 4 loosened vi.fn()'s inferred type; cast to fetch's signature for the global assignment.
    global.fetch = fetchMock as unknown as typeof fetch;
    
    // Mock setTimeout to return immediately for faster tests
    vi.spyOn(global, 'setTimeout').mockImplementation((fn: () => void) => {
      fn();
      return {} as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listFolders', () => {
    it('walks NESTED folders and includes the root — not just the top level', async () => {
      // Until 2026-08-17 this listed /drive/root/children once and returned
      // only top-level folders, with no root entry. The sync loop migrates
      // exactly what listFolders answers, so everything nested and everything
      // sitting in the drive root was never enumerated at all.
      const byUrl: Record<string, unknown> = {
        '/me/drive/root/children': {
          value: [
            {
              id: 'folder1',
              name: 'Documents',
              parentReference: { path: '/drive/root:' },
              folder: { childCount: 5 },
              lastModifiedDateTime: '2024-01-15T00:00:00Z',
              cTag: 'cTag1',
            },
            {
              id: 'file1',
              name: 'report.pdf',
              parentReference: { path: '/drive/root:' },
              file: { mimeType: 'application/pdf' },
              size: 1024,
              lastModifiedDateTime: '2024-01-10T00:00:00Z',
              cTag: 'cTag3',
            },
          ],
        },
        '/me/drive/items/folder1/children': {
          value: [
            {
              id: 'folder2',
              name: 'Invoices',
              parentReference: { path: '/drive/root:/Documents' },
              folder: { childCount: 2 },
              lastModifiedDateTime: '2024-01-16T00:00:00Z',
              cTag: 'cTag2',
            },
          ],
        },
        '/me/drive/items/folder2/children': { value: [] },
      };
      // This mocks `fetch`, whose implementation is SUPPOSED to be async. The
      // void-return complaint comes from the mock's own loose signature, not
      // from anything this code does.
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      fetchMock.mockImplementation(async (url: string) => {
        const match = Object.keys(byUrl).find((k) => String(url).includes(k));
        return {
          status: 200,
          text: async () => JSON.stringify(match ? byUrl[match] : { value: [] }),
          headers: new Map(),
        };
      });

      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const folders = await driveSource.listFolders();

      expect(folders.map((f) => f.path)).toEqual(['', '/Documents', '/Documents/Invoices']);
      // Files are not collections; they arrive through listSince.
      expect(folders.find((f) => f.name === 'report.pdf')).toBeUndefined();
    });

    it('should handle pagination for folder listing', async () => {
      const page1 = {
        value: [
          {
            id: 'folder1',
            name: 'Folder1',
            folder: { childCount: 1 },
            lastModifiedDateTime: '2024-01-01T00:00:00Z',
            cTag: 'cTag1',
          },
        ],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/root/children?page=2',
      };

      const page2 = {
        value: [
          {
            id: 'folder2',
            name: 'Folder2',
            folder: { childCount: 2 },
            lastModifiedDateTime: '2024-01-02T00:00:00Z',
            cTag: 'cTag2',
          },
        ],
      };

      // This mocks `fetch`, whose implementation is SUPPOSED to be async. The
      // void-return complaint comes from the mock's own loose signature, not
      // from anything this code does.
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      fetchMock.mockImplementation(async (url: string) => {
        const u = String(url);
        const body = u.includes('page=2')
          ? page2
          : u.includes('/drive/root/children')
            ? page1
            : { value: [] }; // walking into either folder
        return { status: 200, text: async () => JSON.stringify(body), headers: new Map() };
      });

      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const folders = await driveSource.listFolders();

      // Root + both pages' folders. (Each folder is also walked into, which the
      // default mock answers empty.)
      expect(folders.map((f) => f.path)).toEqual(['', '/Folder1', '/Folder2']);
    });

    it('should throw error on failed listing', async () => {
      fetchMock.mockResolvedValue({
        status: 401,
        text: async () => '{"error": "Unauthorized"}',
        headers: new Map(),
      });

      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      await expect(driveSource.listFolders()).rejects.toThrow('Failed to list drive items');
    });
  });

  describe('listSince - Delta Query', () => {
    it('the natural key carries the FOLDER — two same-named files never collide', async () => {
      // The defect this pins: `GraphDriveItem.path` was a field Graph does not
      // return, so the key fell through to `/${name}` for every file. The whole
      // tree flattened onto the root and these two became ONE key, which the
      // ledger's unique index turns into a hard stop. The fixtures fabricated
      // `path`, so the suite stayed green while no real drive could migrate.
      const delta = {
        value: [
          {
            id: 'w1',
            name: 'notes.txt',
            parentReference: { path: '/drive/root:/Work' },
            file: { mimeType: 'text/plain' },
            size: 10,
            lastModifiedDateTime: '2024-01-01T00:00:00Z',
          },
          {
            id: 'p1',
            name: 'notes.txt',
            parentReference: { path: '/drive/root:/Personal' },
            file: { mimeType: 'text/plain' },
            size: 20,
            lastModifiedDateTime: '2024-01-01T00:00:00Z',
          },
          {
            id: 'r1',
            name: 'top.txt',
            parentReference: { path: '/drive/root:' },
            file: { mimeType: 'text/plain' },
            size: 30,
            lastModifiedDateTime: '2024-01-01T00:00:00Z',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=abc',
      };
      fetchMock.mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify(delta),
        headers: new Map(),
      });
      const driveSource = new GraphDriveSource({
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      });

      const result = await driveSource.listSince({ path: '/' });

      expect(result.items.map((i) => i.item.path)).toEqual([
        '/Work/notes.txt',
        '/Personal/notes.txt',
        // A file sitting in the drive root keeps its bare path.
        '/top.txt',
      ]);
    });

    it('SKIPS a file whose location Graph did not report, rather than guessing a key', async () => {
      // Falling back to the bare name is exactly what flattened the tree. One
      // skipped item is a visible loss; a wrong key silently merges two files.
      const delta = {
        value: [
          {
            id: 'x1',
            name: 'mystery.txt',
            file: { mimeType: 'text/plain' },
            size: 10,
            lastModifiedDateTime: '2024-01-01T00:00:00Z',
          },
          {
            id: 'ok1',
            name: 'fine.txt',
            parentReference: { path: '/drive/root:/Docs' },
            file: { mimeType: 'text/plain' },
            size: 10,
            lastModifiedDateTime: '2024-01-01T00:00:00Z',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=abc',
      };
      fetchMock.mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify(delta),
        headers: new Map(),
      });
      const driveSource = new GraphDriveSource({
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      });

      const result = await driveSource.listSince({ path: '/' });

      expect(result.items.map((i) => i.item.path)).toEqual(['/Docs/fine.txt']);
    });

    it('carries DELETED delta entries up as `removed` ids — the reported evidence class', async () => {
      // The delta answer states outright that items are gone (files AND
      // folders); dropping either here would make a recorded item silently
      // unreportable — the exact silence ADR-0024's evidence classes exist
      // to prevent.
      fetchMock.mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            value: [
              { id: 'gone-file', name: 'old.docx', deleted: {}, file: {} },
              { id: 'gone-folder', name: 'Old', deleted: {}, folder: {} },
              {
                id: 'still-here',
                name: 'kept.txt',
                parentReference: { path: '/drive/root:' },
                file: { mimeType: 'text/plain' },
                lastModifiedDateTime: '2024-01-15T00:00:00Z',
                size: 10,
              },
            ],
            '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=next',
          }),
        headers: new Map(),
      });

      const source = new GraphDriveSource({ tokenProvider: mockTokenProvider, tenantId: 't' });
      const result = await source.listSince({ path: '' });

      expect(result.removed).toEqual(['gone-file', 'gone-folder']);
      expect(result.items.map((i) => i.item.path)).toEqual(['/kept.txt']);
    });

    it('should perform full sync when no cursor provided', async () => {
      const mockDeltaResponse = {
        value: [
          {
            id: 'file1',
            name: 'document.docx',
            parentReference: { path: '/drive/root:/Documents' },
            file: {
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
            lastModifiedDateTime: '2024-01-15T00:00:00Z',
            size: 2048,
            cTag: 'cTag123',
            quickXorHash: 'abc123',
          },
          {
            id: 'file2',
            name: 'image.png',
            parentReference: { path: '/drive/root:/Photos' },
            file: {
              mimeType: 'image/png',
            },
            lastModifiedDateTime: '2024-01-20T00:00:00Z',
            size: 5120,
            quickXorHash: 'xyz789',
          },
          {
            id: 'folder1',
            name: 'Documents',
            parentReference: { path: '/drive/root:' },
            folder: { childCount: 5 },
            lastModifiedDateTime: '2024-01-15T00:00:00Z',
            cTag: 'cTag1',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=abc123',
      };

      // Only mock the delta query - listSince should be metadata-only
      fetchMock.mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify(mockDeltaResponse),
        headers: new Map(),
      });

      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const result = await driveSource.listSince({ path: '/' });

      expect(result.items).toHaveLength(2); // Only files, not folders
      expect(result.items[0]?.item.path).toBe('/Documents/document.docx');
      expect(result.items[0]?.item.contentHash).toBe('abc123');
      expect(result.items[0]?.content).toBeUndefined(); // Metadata-only, no content
      expect(result.items[1]?.item.contentHash).toBe('xyz789');
      expect(result.nextCursor.value).toContain('graph-drive-delta:');
      // The root folder polls the root delta.
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://graph.microsoft.com/v1.0/me/drive/root/delta',
      );
    });

    it('scopes a non-root folder poll to THAT folder\'s delta, not the whole drive', async () => {
      // The 0026 T1 defect: both branches requested /me/drive/root/delta, so a
      // sync over N folders processed every item on the drive N times per pass.
      // The fix addresses the folder by path — Graph then only returns that
      // folder's descendants, so this pins the URL, which IS the scoping.
      fetchMock.mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            value: [
              {
                id: 'file-sub',
                name: 'notes.txt',
                parentReference: { path: '/drive/root:/Team Docs' },
                file: { mimeType: 'text/plain' },
                lastModifiedDateTime: '2024-02-01T00:00:00Z',
                size: 10,
                quickXorHash: 'sub1',
              },
            ],
            '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=sub',
          }),
        headers: new Map(),
      });

      const driveSource = new GraphDriveSource({
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      });

      const result = await driveSource.listSince({ path: '/Team Docs' });

      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://graph.microsoft.com/v1.0/me/drive/root:/Team%20Docs:/delta',
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.item.path).toBe('/Team Docs/notes.txt');
    });

    it('a cursor\'s deltaLink wins over the folder-scoped base URL', async () => {
      // The deltaLink Graph hands back is already scoped to whatever the
      // original request addressed — replaying it verbatim preserves the scope.
      fetchMock.mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({ value: [], '@odata.deltaLink': 'https://g/next' }),
        headers: new Map(),
      });

      const driveSource = new GraphDriveSource({
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      });

      await driveSource.listSince(
        { path: '/Team Docs' },
        { value: 'graph-drive-delta:/Team Docs:https://graph.microsoft.com/v1.0/delta?deltatoken=prev' },
      );

      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://graph.microsoft.com/v1.0/delta?deltatoken=prev',
      );
    });

    it('should fetch file content using fetch method', async () => {
      const mockDeltaResponse = {
        value: [
          {
            id: 'file1',
            name: 'document.docx',
            parentReference: { path: '/drive/root:/Documents' },
            file: {
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
            lastModifiedDateTime: '2024-01-15T00:00:00Z',
            size: 2048,
            quickXorHash: 'abc123',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=abc123',
      };

      // Mock delta query
      fetchMock.mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify(mockDeltaResponse),
        headers: new Map(),
      });

      // Mock content fetch
      fetchMock.mockResolvedValueOnce({
        status: 200,
        text: async () => 'file content here',
        headers: new Map(),
      });

      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      // First get metadata
      const listResult = await driveSource.listSince({ path: '/' });
      expect(listResult.items).toHaveLength(1);
      expect(listResult.items[0]?.content).toBeUndefined();

      // Then fetch content separately
      const item = listResult.items[0]!;
      const fetched = await driveSource.fetch(item.item);
      
      expect(fetched.content).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(fetched.content)).toBe('file content here');
    });

    it('should use deltaLink from cursor for incremental sync', async () => {
      const cursor: SyncCursor = {
        value: 'graph-drive-delta:/path/to/folder:https://graph.microsoft.com/v1.0/delta?deltatoken=existing',
      };

      const mockDeltaResponse = {
        value: [
          {
            id: 'file3',
            name: 'modified.txt',
            parentReference: { path: '/drive/root:/path/to/folder' },
            file: {
              mimeType: 'text/plain',
            },
            lastModifiedDateTime: '2024-01-25T00:00:00Z',
            size: 100,
            quickXorHash: 'newHash123',
            cTag: 'cTag456',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=new456',
      };

      fetchMock
        .mockResolvedValueOnce({
          status: 200,
          text: async () => JSON.stringify(mockDeltaResponse),
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          status: 200,
          text: async () => 'modified content',
          headers: new Map(),
        });

      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const result = await driveSource.listSince({ path: '/path/to/folder' }, cursor);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.item.path).toBe('/path/to/folder/modified.txt');
      expect(result.nextCursor.value).toContain('new456');
    });

    it('should handle invalid cursor and perform full sync', async () => {
      const invalidCursor: SyncCursor = {
        value: 'invalid-cursor-format',
      };

      const mockDeltaResponse = {
        value: [
          {
            id: 'file1',
            name: 'test.txt',
            parentReference: { path: '/drive/root:' },
            file: { mimeType: 'text/plain' },
            size: 50,
            lastModifiedDateTime: '2024-01-01T00:00:00Z',
            cTag: 'cTag1',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=abc',
      };

      fetchMock
        .mockResolvedValueOnce({
          status: 200,
          text: async () => JSON.stringify(mockDeltaResponse),
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          status: 200,
          text: async () => 'test content',
          headers: new Map(),
        });

      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const result = await driveSource.listSince({ path: '/' }, invalidCursor);

      expect(result.items).toHaveLength(1);
    });

    it('should skip deleted items in delta response', async () => {
      const mockDeltaResponse = {
        value: [
          {
            id: 'file1',
            name: 'deleted.txt',
            parentReference: { path: '/drive/root:' },
            deleted: {},
            lastModifiedDateTime: '2024-01-01T00:00:00Z',
            cTag: 'cTag1',
          },
          {
            id: 'file2',
            name: 'kept.txt',
            parentReference: { path: '/drive/root:' },
            file: { mimeType: 'text/plain' },
            size: 100,
            lastModifiedDateTime: '2024-01-02T00:00:00Z',
            cTag: 'cTag2',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=abc',
      };

      fetchMock
        .mockResolvedValueOnce({
          status: 200,
          text: async () => JSON.stringify(mockDeltaResponse),
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          status: 200,
          text: async () => 'kept content',
          headers: new Map(),
        });

      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const result = await driveSource.listSince({ path: '/' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.item.path).toBe('/kept.txt');
    });

    it('should skip folders in delta response', async () => {
      const mockDeltaResponse = {
        value: [
          {
            id: 'folder1',
            name: 'Documents',
            parentReference: { path: '/drive/root:' },
            folder: { childCount: 5 },
            lastModifiedDateTime: '2024-01-01T00:00:00Z',
            cTag: 'cTag1',
          },
          {
            id: 'file1',
            name: 'test.txt',
            parentReference: { path: '/drive/root:' },
            file: { mimeType: 'text/plain' },
            size: 100,
            lastModifiedDateTime: '2024-01-02T00:00:00Z',
            cTag: 'cTag2',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=abc',
      };

      fetchMock
        .mockResolvedValueOnce({
          status: 200,
          text: async () => JSON.stringify(mockDeltaResponse),
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          status: 200,
          text: async () => 'test content',
          headers: new Map(),
        });

      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const result = await driveSource.listSince({ path: '/' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.item.path).toBe('/test.txt');
    });
  });

  describe('Delta Paging', () => {
    it('should handle pagination in delta query results', async () => {
      const page1 = {
        value: [
          {
            id: 'file1',
            name: 'file1.txt',
            parentReference: { path: '/drive/root:' },
            file: { mimeType: 'text/plain' },
            size: 100,
            lastModifiedDateTime: '2024-01-01T00:00:00Z',
            cTag: 'cTag1',
          },
        ],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/delta?page=2',
      };

      const page2 = {
        value: [
          {
            id: 'file2',
            name: 'file2.txt',
            parentReference: { path: '/drive/root:' },
            file: { mimeType: 'text/plain' },
            size: 200,
            lastModifiedDateTime: '2024-01-02T00:00:00Z',
            cTag: 'cTag2',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=abc',
      };

      // listSince is metadata-only: 2 calls for the 2 delta pages
      // Content fetching happens separately via fetch() (not tested here)
      // This mocks `fetch`, whose implementation is SUPPOSED to be async. The
      // void-return complaint comes from the mock's own loose signature, not
      // from anything this code does.
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      fetchMock.mockImplementation(async (url: string) => {
        const body = String(url).includes('page=2') ? page2 : page1;
        return { status: 200, text: async () => JSON.stringify(body), headers: new Map() };
      });

      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const result = await driveSource.listSince({ path: '/' });

      expect(result.items).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(2); // 2 pages, metadata-only
    });

    it('should handle deltaLink in nextLink for continued pagination', async () => {
      const page1 = {
        value: [
          {
            id: 'file1',
            name: 'file1.txt',
            parentReference: { path: '/drive/root:' },
            file: { mimeType: 'text/plain' },
            size: 100,
            lastModifiedDateTime: '2024-01-01T00:00:00Z',
            cTag: 'cTag1',
          },
        ],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=abc',
      };

      const page2 = {
        value: [
          {
            id: 'file2',
            name: 'file2.txt',
            parentReference: { path: '/drive/root:' },
            file: { mimeType: 'text/plain' },
            size: 200,
            lastModifiedDateTime: '2024-01-02T00:00:00Z',
            cTag: 'cTag2',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=def',
      };

      fetchMock
        .mockResolvedValueOnce({
          status: 200,
          text: async () => JSON.stringify(page1),
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          status: 200,
          text: async () => JSON.stringify(page2),
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          status: 200,
          text: async () => 'content1',
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          status: 200,
          text: async () => 'content2',
          headers: new Map(),
        });

      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const result = await driveSource.listSince({ path: '/' });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor.value).toContain('def');
    });
  });

  describe('Rename Handling', () => {
    it('should detect renames (same GUID, different path)', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const oldItem: GraphDriveItem = {
        id: '01AZJL5PMZQXGQKQYJFZHKZQVJQXGQKQYJ',
        name: 'old-name.docx',
        parentReference: { path: '/drive/root:/Documents' },
        lastModifiedDateTime: '2024-01-01T00:00:00Z',
        size: 25600,
        cTag: 'cTag1',
        quickXorHash: 'hash1',
      };

      const newItem: GraphDriveItem = {
        id: '01AZJL5PMZQXGQKQYJFZHKZQVJQXGQKQYJ', // Same GUID
        name: 'new-name.docx',
        parentReference: { path: '/drive/root:/Documents' }, // Different path
        lastModifiedDateTime: '2024-01-15T00:00:00Z',
        size: 25600,
        cTag: 'cTag2',
        quickXorHash: 'hash2',
      };

      expect(driveSource.isRename(oldItem, newItem)).toBe(true);
    });

    it('should not detect as rename when GUID differs', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const oldItem: GraphDriveItem = {
        id: 'old-guid',
        name: 'file.txt',
        parentReference: { path: '/drive/root:' },
        lastModifiedDateTime: '2024-01-01T00:00:00Z',
        size: 100,
        cTag: 'cTag1',
      };

      const newItem: GraphDriveItem = {
        id: 'new-guid', // Different GUID
        name: 'file.txt',
        parentReference: { path: '/drive/root:' },
        lastModifiedDateTime: '2024-01-02T00:00:00Z',
        size: 100,
        cTag: 'cTag2',
      };

      expect(driveSource.isRename(oldItem, newItem)).toBe(false);
    });

    it('a MOVE is a rename; identical name and parent is not', () => {
      // The old test here asserted "name changed, path is the same" — a state
      // Graph cannot produce, and one only expressible while `path` was a
      // fabricated field independent of `name`. What is real: the derived path
      // is parentReference + name, so either half changing is a relocation.
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);
      const at = (parent: string, name: string): GraphDriveItem => ({
        id: 'same-guid',
        name,
        parentReference: { path: parent },
        lastModifiedDateTime: '2024-01-01T00:00:00Z',
        size: 100,
      });

      expect(
        driveSource.isRename(at('/drive/root:/Documents', 'a.txt'), at('/drive/root:/Archive', 'a.txt')),
        'same file, different folder — a move',
      ).toBe(true);
      expect(
        driveSource.isRename(at('/drive/root:/Documents', 'a.txt'), at('/drive/root:/Documents', 'a.txt')),
        'nothing changed',
      ).toBe(false);
    });

    it('never calls it a rename when neither path can be derived', () => {
      // No parentReference means no evidence of WHERE either item is. Guessing
      // "renamed" from that would be a claim about customer data from nothing.
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);
      const bare = (name: string): GraphDriveItem => ({
        id: 'same-guid',
        name,
        lastModifiedDateTime: '2024-01-01T00:00:00Z',
        size: 100,
      });

      expect(driveSource.isRename(bare('a.txt'), bare('b.txt'))).toBe(false);
    });

    it('should log renames as drift, not duplicate (per §11.1)', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const oldItem: GraphDriveItem = {
        id: 'same-guid',
        name: 'old-name.txt',
        parentReference: { path: '/drive/root:/old' },
        lastModifiedDateTime: '2024-01-01T00:00:00Z',
        size: 100,
        cTag: 'cTag1',
      };

      const newItem: GraphDriveItem = {
        id: 'same-guid', // Same GUID
        name: 'new-name.txt',
        parentReference: { path: '/drive/root:/new' }, // Different path
        lastModifiedDateTime: '2024-01-02T00:00:00Z',
        size: 100,
        cTag: 'cTag2',
      };

      // The isRename method should return true for this case
      expect(driveSource.isRename(oldItem, newItem)).toBe(true);
      
      // This indicates the system should log as drift, not create a duplicate
    });
  });

  describe('Path Normalization', () => {
    it('should normalize multiple consecutive slashes', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      expect(driveSource.normalizePath('//a//b//c')).toBe('/a/b/c');
    });

    it('should resolve . (current directory) segments', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      expect(driveSource.normalizePath('/a/./b')).toBe('/a/b');
    });

    it('should resolve .. (parent directory) segments', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      expect(driveSource.normalizePath('/a/b/../c')).toBe('/a/c');
    });

    it('should handle complex path with . and ..', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      expect(driveSource.normalizePath('/a/b/./c/../d')).toBe('/a/b/d');
    });

    it('should remove trailing slashes', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      expect(driveSource.normalizePath('/a/b/c/')).toBe('/a/b/c');
    });

    it('should keep root as single slash', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      expect(driveSource.normalizePath('/')).toBe('/');
      expect(driveSource.normalizePath('')).toBe('/');
    });

    it('should handle paths without leading slash', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      expect(driveSource.normalizePath('a/b/c')).toBe('/a/b/c');
    });

    it('should handle root-level files', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      expect(driveSource.normalizePath('/file.txt')).toBe('/file.txt');
    });

    it('should handle deep nesting', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      expect(driveSource.normalizePath('/a/b/c/d/e/f/g')).toBe('/a/b/c/d/e/f/g');
    });

    it('should handle .. at root level gracefully', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      expect(driveSource.normalizePath('/../a')).toBe('/a');
    });
  });

  describe('parsePath', () => {
    it('should parse a simple file path', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const result = driveSource.parsePath('/Documents/file.txt');
      
      expect(result).toMatchObject({
        root: '/',
        dir: '/Documents',
        base: 'file.txt',
        ext: 'txt',
        name: 'file',
      });
    });

    it('should parse a file without extension', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const result = driveSource.parsePath('/Documents/README');
      
      expect(result).toMatchObject({
        root: '/',
        dir: '/Documents',
        base: 'README',
        ext: '',
        name: 'README',
      });
    });

    it('should parse a root-level file', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const result = driveSource.parsePath('/file.txt');
      
      expect(result).toMatchObject({
        root: '/',
        dir: '',
        base: 'file.txt',
        ext: 'txt',
        name: 'file',
      });
    });

    it('should parse a directory path', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const result = driveSource.parsePath('/Documents/Photos');
      
      expect(result).toMatchObject({
        root: '/',
        dir: '/Documents',
        base: 'Photos',
        ext: '',
        name: 'Photos',
      });
    });
  });

  describe('Change Detection (cTag/quickXorHash)', () => {
    it('should prefer quickXorHash for change detection', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const item: GraphDriveItem = {
        id: 'file1',
        name: 'test.txt',
        parentReference: { path: '/drive/root:' },
        lastModifiedDateTime: '2024-01-01T00:00:00Z',
        size: 100,
        cTag: 'cTag789',
        quickXorHash: 'quickXorHash123',
      };

      const changeHash = driveSource.getChangeHash(item);
      expect(changeHash).toBe('quickXorHash123');
    });

    it('should fallback to cTag when quickXorHash not available', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const item: GraphDriveItem = {
        id: 'file1',
        name: 'test.txt',
        parentReference: { path: '/drive/root:' },
        lastModifiedDateTime: '2024-01-01T00:00:00Z',
        size: 100,
        cTag: 'cTag789',
      };

      const changeHash = driveSource.getChangeHash(item);
      expect(changeHash).toBe('cTag789');
    });

    it('should return undefined when no change hash available', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const item: GraphDriveItem = {
        id: 'file1',
        name: 'test.txt',
        parentReference: { path: '/drive/root:' },
        lastModifiedDateTime: '2024-01-01T00:00:00Z',
        size: 100,
      };

      const changeHash = driveSource.getChangeHash(item);
      expect(changeHash).toBeUndefined();
    });

    it('should use quickXorHash as content hash in listSince', async () => {
      const mockDeltaResponse = {
        value: [
          {
            id: 'file1',
            name: 'test.txt',
            parentReference: { path: '/drive/root:' },
            file: {
              mimeType: 'text/plain',
            },
            size: 100,
            lastModifiedDateTime: '2024-01-01T00:00:00Z',
            quickXorHash: 'abc123xyz',
            cTag: 'cTag123',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=abc',
      };

      fetchMock
        .mockResolvedValueOnce({
          status: 200,
          text: async () => JSON.stringify(mockDeltaResponse),
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          status: 200,
          text: async () => 'test content',
          headers: new Map(),
        });

      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const result = await driveSource.listSince({ path: '/' });

      expect(result.items[0]?.item.contentHash).toBe('abc123xyz');
    });
  });

  describe('Cursor Encoding/Decoding', () => {
    it('should encode cursor with folder path and delta link', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const cursor: SyncCursor = {
        value: 'graph-drive-delta:/Documents:https://graph.microsoft.com/v1.0/delta?deltatoken=abc123',
      };

      const decoded = (driveSource as any).decodeCursor(cursor);
      
      expect(decoded.folderPath).toBe('/Documents');
      expect(decoded.deltaLink).toBe('https://graph.microsoft.com/v1.0/delta?deltatoken=abc123');
    });

    it('should handle delta links with colons', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const cursor: SyncCursor = {
        value: 'graph-drive-delta:/Documents:https://graph.microsoft.com/v1.0/delta?deltatoken=abc:123:xyz',
      };

      const decoded = (driveSource as any).decodeCursor(cursor);
      
      expect(decoded.folderPath).toBe('/Documents');
      expect(decoded.deltaLink).toBe('https://graph.microsoft.com/v1.0/delta?deltatoken=abc:123:xyz');
    });

    it('should throw error on invalid cursor format', () => {
      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSource = new GraphDriveSource(config);

      const invalidCursor: SyncCursor = {
        value: 'invalid-format',
      };

      expect(() => (driveSource as any).decodeCursor(invalidCursor)).toThrow('Invalid cursor format');
    });
  });

  describe('Rate Limiting and Error Handling', () => {
    it('should handle 429 rate limit response', async () => {
      const mockDeltaResponse = {
        value: [
          {
            id: 'file1',
            name: 'test.txt',
            parentReference: { path: '/drive/root:' },
            file: { mimeType: 'text/plain' },
            size: 100,
            lastModifiedDateTime: '2024-01-01T00:00:00Z',
            cTag: 'cTag1',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=abc',
      };

      // First call returns 429, second succeeds
      fetchMock
        .mockResolvedValueOnce({
          status: 429,
          text: async () => '{"error": "Rate limit exceeded"}',
          headers: new Map([['retry-after', '1']]),
        })
        .mockResolvedValueOnce({
          status: 200,
          text: async () => JSON.stringify(mockDeltaResponse),
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          status: 200,
          text: async () => 'content',
          headers: new Map(),
        });

      const mockThrottleLimiter: ThrottleLimiter = {
        handleRateLimited: vi.fn().mockReturnValue(0),
        executeWithThrottling: vi.fn().mockImplementation((tenantId, provider, fn) => fn()),
      } as unknown as ThrottleLimiter;

      const config: GraphDriveSourceConfig = {
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      };
      const driveSourceWithThrottle = new GraphDriveSource(config, mockThrottleLimiter);

      const result = await driveSourceWithThrottle.listSince({ path: '/' });

      // WHAT THIS TEST USED TO SAY, in full:
      //
      //     await expect(driveSourceWithThrottle.listSince({ path: '/' }))
      //       .resolves.toBeDefined();   // "Should not throw"
      //
      // `listSince` returns `{ items, nextCursor }` whether it read a hundred
      // files or gave up on the first 429, so that was true of every outcome
      // this test could possibly produce. Mutation-checked on 2026-08-07:
      // making the source stop recognising 429 ALTOGETHER — no retry,
      // `handleRateLimited` never called, the error body handled as if it were
      // data — passed all 39 tests in this file, including this one. So did
      // ignoring `Retry-After` and retrying instantly against a server that had
      // just asked us to wait.
      //
      // Silent data loss with a green test next to it, on a test named for the
      // one behaviour it did not check.

      // 1. The 429 was RECOGNISED as a rate limit, and the server's own
      //    Retry-After was passed on rather than discarded for a default.
      expect(mockThrottleLimiter.handleRateLimited).toHaveBeenCalledWith(429, '1');

      // 2. The request was actually RETRIED. Without this, "recognised it" is
      //    satisfied by a source that notices the 429 and then gives up.
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

      // 3. The retry's DATA came back. This is the assertion that makes the
      //    other two mean something: a 429 handled by returning an empty list
      //    is a file the migration silently never copies, which is exactly what
      //    §20 verification exists to catch and exactly what a unit test should
      //    catch first.
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.item.path).toBe('/test.txt');
      expect(result.items[0]?.item.sourceRef).toBe('file1');
    });

    it('without a throttle limiter, a 429 FAILS loudly instead of being retried or parsed', async () => {
      // The other half of the same code, and the reason the asymmetry above is
      // safe rather than a bug.
      //
      // `graphRequest` carries the 429/Retry-After logic TWICE — once in
      // `executeRequest` and once in `doRequest` — and the first copy's
      // condition is `(429 || 503) && this.throttleLimiter`, which is
      // unreachable: `executeRequest` is only called when `this.throttleLimiter`
      // is falsy. So a source built with no limiter has no backoff at all.
      //
      // That is survivable ONLY because every caller checks `status !== 200`
      // and throws with the status and body attached, so the 429 arrives as an
      // error naming itself rather than as an empty listing or as an error body
      // parsed into items. Nothing asserted that, and it is the property the
      // dead branch is quietly relying on.
      fetchMock.mockResolvedValueOnce({
        status: 429,
        text: async () => '{"error": "Rate limit exceeded"}',
        headers: new Map([['retry-after', '1']]),
      });

      const bare = new GraphDriveSource({
        tokenProvider: mockTokenProvider,
        tenantId: 'test-tenant-id',
      });

      // Loud, and carrying the server's own words (hard rule 9).
      await expect(bare.listSince({ path: '/' })).rejects.toThrow(/429/);
      // Exactly one attempt: no limiter means no backoff policy, so retrying
      // would be guessing at a rate the caller never chose.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

// Additional fixtures for integration testing reference
export const graphDriveFixtures = {
  // Complete folder listing response
  folderListResponse: {
    '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#drives(\'test-drive-id\')/root/children',
    value: [
      {
        id: '01AZJL5PN6Y2GOVW7725BZO354PWSELRRZ',
        name: 'Documents',
        lastModifiedDateTime: '2024-01-15T00:00:00Z',
        size: 0,
        folder: { childCount: 25 },
        webUrl: 'https://contoso-my.sharepoint.com/personal/user/Documents',
        cTag: 'cTag1',
      },
      {
        id: '01AZJL5PNXQFJWFKQBFZHKZQVJQXGQKQYJ',
        name: 'Photos',
        lastModifiedDateTime: '2024-01-20T00:00:00Z',
        size: 0,
        folder: { childCount: 150 },
        webUrl: 'https://contoso-my.sharepoint.com/personal/user/Photos',
        cTag: 'cTag2',
      },
    ],
  },

  // Delta query response with changes
  deltaQueryResponse: {
    '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#Collection(driveItems)',
    '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?deltatoken=H4sIAAAAAAAA',
    value: [
      {
        id: '01AZJL5PMZQXGQKQYJFZHKZQVJQXGQKQYJ',
        name: 'report.docx',
        lastModifiedDateTime: '2024-01-25T14:30:00Z',
        size: 25600,
        file: {
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        cTag: '"c:{GUID},0"',
        quickXorHash: 'abc123def456ghi789jkl012mno345pqr678=',
      },
    ],
  },

  // Rename scenario
  renameScenario: {
    before: {
      id: '01AZJL5PMZQXGQKQYJFZHKZQVJQXGQKQYJ',
      name: 'old-name.docx',
      parentReference: { path: '/drive/root:/Documents' },
      file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      size: 25600,
      lastModifiedDateTime: '2024-01-01T00:00:00Z',
      cTag: 'cTag1',
    } as GraphDriveItem,
    after: {
      id: '01AZJL5PMZQXGQKQYJFZHKZQVJQXGQKQYJ', // Same GUID
      name: 'new-name.docx',
      parentReference: { path: '/drive/root:/Documents' }, // Different path
      file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      size: 25600,
      lastModifiedDateTime: '2024-01-15T00:00:00Z',
      cTag: 'cTag2',
      quickXorHash: 'hash2',
    } as GraphDriveItem,
  },
};
