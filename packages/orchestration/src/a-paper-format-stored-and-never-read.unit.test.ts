// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAPER FORMAT STORED AND NEVER READ (workplan 0150 T3 (c)).
 *
 * The doors keep a migration's format for Paper docs; the API's
 * `a-paper-format-a-migration-keeps` holds that. This holds the other half:
 * each edition's builder hands the format to the Dropbox source, so a Paper
 * doc is listed under the name its format gives it. A builder that dropped
 * the key would list every Paper doc under its own name and refuse it by
 * name, while the migration's page shows the format that was chosen.
 *
 * Nothing leaves the process: `fetch` answers the token refresh and one
 * listing.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { parseMappingConfig, type FileSource } from '@openmig/shared';
import { buildDropboxSourceFrom, type DropboxEndpoint } from './dropbox-source-factory.ts';
import { buildFileSourceFromConnection } from './build-deps-from-mapping.ts';

const PAPER_DOC = {
  '.tag': 'file',
  id: 'id:0150-paper-doc',
  name: 'Notes.paper',
  path_display: '/Notes.paper',
  size: 100,
  server_modified: '2026-09-25T10:00:00Z',
  content_hash: 'hash-notes',
  is_downloadable: false,
  export_info: { export_as: 'markdown', export_options: ['markdown', 'html'] },
};

/** Dropbox as far as a listing goes: a token, and a root holding one Paper doc. */
function dropbox() {
  const listed: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).endsWith('/oauth2/token')) {
        return new Response(
          JSON.stringify({ access_token: 'unused', expires_in: 14400, token_type: 'bearer' }),
          { status: 200 },
        );
      }
      listed.push(JSON.parse(init?.body ?? '{}').path);
      return new Response(JSON.stringify({ entries: [PAPER_DOC], cursor: 'end', has_more: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return { listed };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const names = async (source: FileSource) =>
  (await source.listSince({ path: '' })).items.map((raw) => raw.item.path);

/** The appliance: a mapping file, read by the shared reader, built from the environment's credentials. */
function appliance(source: Record<string, unknown>): FileSource {
  const parsed = parseMappingConfig({
    tenantId: 't',
    mappingId: 'm',
    source: { type: 'dropbox', ...source },
    target: {
      type: 'webdav',
      url: 'https://cloud.example.invalid/remote.php/dav/files/someone/',
      user: 'someone',
      auth: { kind: 'login', passwordFromEnv: 'UNUSED_IN_THIS_TEST' },
    },
  });
  return buildDropboxSourceFrom(parsed.source as DropboxEndpoint, {
    appKey: 'k',
    appSecret: 's',
    refreshToken: 'rt',
  });
}

/** The managed edition: a stored connection row's config, built from its stored credentials. */
function managed(config: Record<string, unknown>): FileSource {
  return buildFileSourceFromConnection(
    { kind: 'dropbox', config, creds: { clientId: 'k', clientSecret: 's', refreshToken: 'rt' } },
    undefined,
  );
}

const refusalOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected a refusal, and nothing was refused');
};

describe('the appliance, from its mapping file', () => {
  it('lists a Paper doc under the format the file names', async () => {
    dropbox();
    expect(await names(appliance({ nativeFilePolicies: { paper: 'markdown' } }))).toEqual([
      'Notes.paper.md',
    ]);
    expect(await names(appliance({ nativeFilePolicies: { paper: 'html' } }))).toEqual([
      'Notes.paper.html',
    ]);
  });

  it('lists it under its own name when the file names no format, which refuses it by name (D1)', async () => {
    dropbox();
    expect(await names(appliance({}))).toEqual(['Notes.paper']);
    expect(await names(appliance({ nativeFilePolicies: { paper: 'refuse' } }))).toEqual([
      'Notes.paper',
    ]);
  });

  it('refuses a Google kind in the file by name, rather than reading it as nothing', () => {
    const message = refusalOf(() => appliance({ nativeFilePolicies: { document: 'export-office' } }));
    expect(message).toContain('source.nativeFilePolicies: unknown kind "document" for a Dropbox source');
  });

  it('refuses Drive’s one format for every kind, and names the key that works', () => {
    // Written by analogy with a Drive mapping, it would be read as nothing and
    // every Paper doc refused for a reason the file does not show.
    const message = refusalOf(() => appliance({ nativeFilePolicy: 'markdown' }));
    expect(message).toContain('source.nativeFilePolicy: a Dropbox source has no single format');
    expect(message).toContain('{ "paper": "markdown" }');
  });

  it('refuses a bare format where the kinds belong, and says the shape it wants', () => {
    for (const value of ['markdown', ['markdown'], null]) {
      const message = refusalOf(() => appliance({ nativeFilePolicies: value }));
      expect(message, JSON.stringify(value)).toContain(
        'source.nativeFilePolicies: expected an object naming a format for Paper docs',
      );
    }
  });
});

describe('the managed edition, from a stored connection', () => {
  it('lists a Paper doc under the stored format, and an empty root still means the whole account', async () => {
    const { listed } = dropbox();
    expect(await names(managed({ rootPath: '', nativeFilePolicies: { paper: 'markdown' } }))).toEqual([
      'Notes.paper.md',
    ]);
    // The probe stores the root as '' for the whole account; the shared
    // reader would refuse an empty string, so the builder reads it raw.
    expect(listed).toEqual(['']);
  });

  it('lists it under its own name when nothing is stored, as every Dropbox row before this does', async () => {
    dropbox();
    expect(await names(managed({ rootPath: '' }))).toEqual(['Notes.paper']);
  });

  it('reads the Paper kind alone, so a Google format left on the row from before is ignored, as it always was', async () => {
    // Until the update door asked which source a format is for, it merged
    // Drive's formats into any migration's row. On a Dropbox row they were
    // never read; refused here, they would stop every pass.
    dropbox();
    expect(
      await names(managed({ rootPath: '', nativeFilePolicy: 'export-pdf', nativeFilePolicies: { document: 'export-office' } })),
    ).toEqual(['Notes.paper']);
    expect(
      await names(managed({ rootPath: '', nativeFilePolicies: { document: 'export-office', paper: 'html' } })),
    ).toEqual(['Notes.paper.html']);
  });

  it('refuses a stored value it does not know at build time, naming the key, before any request', () => {
    const { listed } = dropbox();
    const message = refusalOf(() => managed({ rootPath: '', nativeFilePolicies: { paper: 'pdf' } }));
    // The shared reader's words, not the source's: the key a person can find.
    expect(message).toContain('source.nativeFilePolicies.paper: unsupported "pdf"');
    expect(listed).toEqual([]);
  });
});
