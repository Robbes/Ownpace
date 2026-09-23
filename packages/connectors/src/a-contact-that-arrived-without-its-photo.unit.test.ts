// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A CONTACT THAT ARRIVED WITHOUT ITS PHOTO (owner's report, 2026-09-23).
 *
 * A contact copied from Microsoft to Nextcloud "has the data, but not the
 * photo", and the source has one. Every Microsoft contact did the same, for
 * three reasons stacked on each other; any one alone would have lost it:
 *
 *  1. Nothing asked for the photo. The sync wrote the listed card, and the
 *     Graph source's `fetch` was not on the port (`the-loop-writes-the-card-
 *     the-source-completed` in core holds that half).
 *  2. That `fetch` would have REPLACED the listed card with one mapped from the
 *     contact's id alone: a photo, and no name, numbers or addresses.
 *  3. The photo was read as text, which cannot survive a JPEG, and the text
 *     was then written as if it were base64.
 *
 * And the line it would have written, `PHOTO;ENCODING=base64;TYPE=…`, is not
 * how a vCard 4.0 carries an image. Nextcloud reads a 4.0 photo only as a
 * `data:` URI, and would have drawn initials.
 *
 * This file asks those questions of the source, on the client production uses.
 * The photo is a fixed run of bytes including two that are not valid UTF-8, so
 * a text decode anywhere on the way changes them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Token, RawContact, TokenProvider } from '@openmig/shared';
import { GraphContactsSource, imageTypeOf, withPhoto } from './graph-contacts-source.ts';
import type { HttpClient, HttpResponse } from './dav-http.types.ts';

const TOKEN: OAuth2Token = { accessToken: 'token', tokenType: 'Bearer', expiresAt: Date.now() + 3_600_000 };
const tokens: TokenProvider = {
  getToken: vi.fn().mockResolvedValue(TOKEN),
  refresh: vi.fn().mockResolvedValue(TOKEN),
  isTokenValid: vi.fn().mockReturnValue(true),
  getTokenStatus: vi.fn().mockReturnValue({ isValid: true, timeUntilExpiry: 3600 }),
};

/** A JPEG's first bytes, then 0xc3 0x28: not valid UTF-8, so a decode replaces them. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xc3, 0x28]);

/** The card as the listing makes it: every field, and no photo. */
const LISTED_CARD = [
  'BEGIN:VCARD',
  'VERSION:4.0',
  'UID:c-1',
  'FN:Ada Lovelace',
  'N:Lovelace;Ada;;;',
  'TEL;TYPE=cell:+31 6 00000000',
  'EMAIL;TYPE=work:ada@example.invalid',
  'END:VCARD',
].join('\r\n');

const LISTED: RawContact = {
  item: {
    uid: 'c-1',
    type: 'person',
    name: 'Ada Lovelace',
    sourcePath: '/contactFolders/f-1/contacts/c-1',
    vcard: LISTED_CARD,
    version: '4.0',
  },
  vcard: LISTED_CARD,
};

/** A client that answers the photo request with one response, and records what was asked. */
function answering(response: HttpResponse): { client: HttpClient; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    client: {
      request: vi.fn().mockImplementation((options: { url: string }) => {
        urls.push(options.url);
        return Promise.resolve(response);
      }),
    },
  };
}

const photoOf = (vcard: string): Uint8Array | undefined => {
  const line = /\r\nPHOTO:data:[^;]+;base64,([^\r]+)\r\n/.exec(vcard);
  return line ? new Uint8Array(Buffer.from(line[1]!, 'base64')) : undefined;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the photo, read as bytes', () => {
  it('arrives byte for byte through the client production uses', async () => {
    // No client injected: this is the default one, over a stubbed `fetch`.
    // It used to read `response.text()`, and 0xc3 0x28 came back as U+FFFD.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } })),
    );
    const source = new GraphContactsSource(tokens, 'tenant');

    const written = await source.fetch(LISTED);

    expect(photoOf(written.vcard)).toEqual(JPEG);
  });

  it('asks for it where Graph keeps it: the contact, then /photo/$value', async () => {
    const { client, urls } = answering({ status: 200, body: '', bodyBytes: JPEG, headers: {} });
    await new GraphContactsSource(tokens, 'tenant', undefined, { httpClient: client }).fetch(LISTED);

    expect(urls).toEqual(['https://graph.microsoft.com/v1.0/me/contactFolders/f-1/contacts/c-1/photo/$value']);
  });

  it('refuses a client that cannot hand over bytes, rather than writing the card without its photo', async () => {
    const { client } = answering({ status: 200, body: 'ÿØÿà', headers: { 'content-type': 'image/jpeg' } });

    await expect(
      new GraphContactsSource(tokens, 'tenant', undefined, { httpClient: client }).fetch(LISTED),
    ).rejects.toThrow(/no bodyBytes/);
  });
});

describe('the photo is ADDED to the listed card', () => {
  it('keeps every line the listing wrote, and adds one', async () => {
    const { client } = answering({ status: 200, body: '', bodyBytes: JPEG, headers: { 'content-type': 'image/jpeg' } });

    const written = await new GraphContactsSource(tokens, 'tenant', undefined, { httpClient: client }).fetch(LISTED);

    expect(written.vcard.split('\r\n').filter((line) => !line.startsWith('PHOTO:'))).toEqual(LISTED_CARD.split('\r\n'));
    expect(written.item).toMatchObject({ uid: 'c-1', name: 'Ada Lovelace', vcard: written.vcard });
    expect(written.item.photo).toEqual({ data: Buffer.from(JPEG).toString('base64'), mimeType: 'image/jpeg' });
  });

  it('writes it the way vCard 4.0 carries an image: a data: URI, before END:VCARD', async () => {
    const { client } = answering({ status: 200, body: '', bodyBytes: JPEG, headers: { 'content-type': 'image/jpeg' } });

    const written = await new GraphContactsSource(tokens, 'tenant', undefined, { httpClient: client }).fetch(LISTED);

    expect(written.vcard).toContain(`\r\nPHOTO:data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}\r\nEND:VCARD`);
    expect(written.vcard).not.toMatch(/ENCODING=/);
  });
});

describe('a contact without a photo, and a photo Graph would not give', () => {
  it('writes the listed card unchanged when Graph has no photo (404)', async () => {
    const { client } = answering({
      status: 404,
      body: JSON.stringify({ error: { code: 'ErrorItemNotFound', message: "The photo wasn't found." } }),
      headers: {},
    });

    const written = await new GraphContactsSource(tokens, 'tenant', undefined, { httpClient: client }).fetch(LISTED);

    expect(written).toBe(LISTED);
  });

  it('fails the card on any other refusal, so it is tried again with its photo', async () => {
    const { client } = answering({ status: 500, body: '{"error":{"code":"generalException"}}', headers: {} });

    await expect(
      new GraphContactsSource(tokens, 'tenant', undefined, { httpClient: client }).fetch(LISTED),
    ).rejects.toThrow(/contact photo/);
  });
});

describe('what the photo is', () => {
  it('is what Graph says when Graph names an image type', () => {
    expect(imageTypeOf('image/png', JPEG)).toBe('image/png');
    expect(imageTypeOf('image/jpeg; charset=binary', JPEG)).toBe('image/jpeg');
  });

  it('is what the bytes say when Graph does not', () => {
    expect(imageTypeOf('application/octet-stream', JPEG)).toBe('image/jpeg');
    expect(imageTypeOf(undefined, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image/png');
  });

  it('is nothing when neither can tell, and the card is then written without it', async () => {
    const unknown = Uint8Array.from([0x00, 0x01, 0x02, 0x03]);
    expect(imageTypeOf('application/octet-stream', unknown)).toBeUndefined();

    const { client } = answering({ status: 200, body: '', bodyBytes: unknown, headers: {} });
    const written = await new GraphContactsSource(tokens, 'tenant', undefined, { httpClient: client }).fetch(LISTED);
    expect(written).toBe(LISTED);
  });
});

describe('withPhoto', () => {
  it('works on a card with or without a line break before END:VCARD', () => {
    const photo = { data: 'AAAA', mimeType: 'image/png' };
    expect(withPhoto('BEGIN:VCARD\r\nFN:A\r\nEND:VCARD', photo)).toBe(
      'BEGIN:VCARD\r\nFN:A\r\nPHOTO:data:image/png;base64,AAAA\r\nEND:VCARD',
    );
    expect(withPhoto('BEGIN:VCARD\nFN:A\nEND:VCARD\n', photo)).toBe(
      'BEGIN:VCARD\nFN:A\nPHOTO:data:image/png;base64,AAAA\r\nEND:VCARD\n',
    );
  });
});
