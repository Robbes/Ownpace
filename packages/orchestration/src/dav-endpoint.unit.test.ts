// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

import { describe, it, expect } from 'vitest';
import { davEndpointFromCreds, fileEndpointFromCreds } from './dav-endpoint.ts';

const creds = { username: 'tenant-b-target', password: 'secret' };

describe('davEndpointFromCreds', () => {
  it('requires both username and password', () => {
    expect(() => davEndpointFromCreds('source', {}, { username: 'a' })).toThrow(/missing credentials/);
  });

  it('resolves the base URL from config.baseUrl', () => {
    const endpoint = davEndpointFromCreds('source', { baseUrl: 'http://nextcloud/remote.php/dav/' }, creds);
    expect(endpoint.url).toBe('http://nextcloud/remote.php/dav/');
    expect(endpoint.username).toBe('tenant-b-target');
  });
});

describe('fileEndpointFromCreds', () => {
  it('appends Nextcloud\'s files/{username}/ convention for a nextcloud-kind connection', () => {
    const endpoint = fileEndpointFromCreds(
      'target',
      { baseUrl: 'http://nextcloud/remote.php/dav/' },
      creds,
      'nextcloud',
    );
    expect(endpoint.url).toBe('http://nextcloud/remote.php/dav/files/tenant-b-target/');
  });

  it('uses config.fileBaseUrl verbatim when set, even for a nextcloud-kind connection', () => {
    const endpoint = fileEndpointFromCreds(
      'target',
      { baseUrl: 'http://nextcloud/remote.php/dav/', fileBaseUrl: 'http://files.example.test/dav/custom/' },
      creds,
      'nextcloud',
    );
    expect(endpoint.url).toBe('http://files.example.test/dav/custom/');
  });

  it('leaves the base URL untouched for a dedicated webdav-kind connection', () => {
    const endpoint = fileEndpointFromCreds(
      'target',
      { baseUrl: 'http://files.example.test/remote.php/dav/files/tenant-b-target/' },
      creds,
      'webdav',
    );
    expect(endpoint.url).toBe('http://files.example.test/remote.php/dav/files/tenant-b-target/');
  });
});
