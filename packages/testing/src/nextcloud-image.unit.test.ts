// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The rules `testcontainers-setup.ts` applies to a Nextcloud asked for by name
 * (`nextcloud-image.ts`; workplan 0119, Status of 2026-10-25): which image was
 * asked for, the version its tag names, and whether the server that answered
 * is that version. The setup itself needs Docker; these do not.
 */

import { describe, it, expect } from 'vitest';
import {
  isTheVersionNamed,
  nextcloudImageAsked,
  versionTheTagNames,
  versionstringOf,
  wrongServer,
} from './nextcloud-image.ts';

/** `status.php` as Nextcloud 35.0.1 answers it, trimmed to the fields read. */
const STATUS_35 = JSON.stringify({ installed: true, versionstring: '35.0.1', productname: 'Nextcloud' });
const STATUS_34 = JSON.stringify({ installed: true, versionstring: '34.0.5', productname: 'Nextcloud' });
const PINNED_35 = 'nextcloud:35.0.1-apache@sha256:8f2f0e93aca5e9457019933936dea1f313052e72c696b4aecb31580a208b859f';

describe('which Nextcloud the integration tier starts', () => {
  it('starts the default when NEXTCLOUD_IMAGE is unset or blank', () => {
    expect(nextcloudImageAsked({})).toBeUndefined();
    expect(nextcloudImageAsked({ NEXTCLOUD_IMAGE: '' })).toBeUndefined();
    expect(nextcloudImageAsked({ NEXTCLOUD_IMAGE: '   ' })).toBeUndefined();
  });

  it('starts the image NEXTCLOUD_IMAGE names, trimmed', () => {
    expect(nextcloudImageAsked({ NEXTCLOUD_IMAGE: ` ${PINNED_35}\n` })).toBe(PINNED_35);
  });
});

describe('the version a tag names', () => {
  it.each([
    [PINNED_35, '35.0.1'],
    ['nextcloud:35.0.1-apache', '35.0.1'],
    ['nextcloud:35-apache', '35'],
    ['nextcloud:35.0', '35.0'],
    ['nextcloud:34-apache', '34'],
    ['docker.io/library/nextcloud:35.0.2-fpm', '35.0.2'],
    ['registry.example:5000/nextcloud:35.0.2-apache', '35.0.2'],
  ])('%s names %s', (ref, version) => {
    expect(versionTheTagNames(ref)).toBe(version);
  });

  it.each([
    'nextcloud:latest',
    'nextcloud:apache',
    'nextcloud:stable-apache',
    'nextcloud',
    'nextcloud@sha256:8f2f0e93aca5e9457019933936dea1f313052e72c696b4aecb31580a208b859f',
    // A registry port is not a tag.
    'registry.example:5000/nextcloud',
  ])('%s names no version', (ref) => {
    expect(versionTheTagNames(ref)).toBeUndefined();
  });
});

describe('whether the server that answered is the version named', () => {
  it('matches the whole version, or a prefix of it that ends at a dot', () => {
    expect(isTheVersionNamed('35.0.1', '35.0.1')).toBe(true);
    expect(isTheVersionNamed('35.0', '35.0.1')).toBe(true);
    expect(isTheVersionNamed('35', '35.0.1')).toBe(true);
  });

  it('never inside a number', () => {
    expect(isTheVersionNamed('35.0.1', '35.0.10')).toBe(false);
    expect(isTheVersionNamed('3', '35.0.1')).toBe(false);
    expect(isTheVersionNamed('35', '34.0.5')).toBe(false);
    expect(isTheVersionNamed('35.0.2', '35.0.1')).toBe(false);
  });

  it("reads status.php's versionstring, and nothing from a body that is not its JSON", () => {
    expect(versionstringOf(STATUS_35)).toBe('35.0.1');
    expect(versionstringOf('<html>Internal Server Error</html>')).toBeUndefined();
    expect(versionstringOf(JSON.stringify({ installed: true }))).toBeUndefined();
    expect(versionstringOf(JSON.stringify({ versionstring: 35 }))).toBeUndefined();
  });
});

describe('a server that is not the one asked for is refused', () => {
  it('passes the version the tag names', () => {
    expect(wrongServer(PINNED_35, STATUS_35)).toBeUndefined();
    expect(wrongServer('nextcloud:35-apache', STATUS_35)).toBeUndefined();
  });

  it('refuses another version, naming both', () => {
    const said = wrongServer(PINNED_35, STATUS_34);
    expect(said).toContain('35.0.1');
    expect(said).toContain('Nextcloud 34.0.5');
  });

  it('refuses a status.php that says no version, since nothing then proves which server ran', () => {
    expect(wrongServer(PINNED_35, '<html>Internal Server Error</html>')).toContain('said no version');
  });

  it('holds nothing when no image was asked for, or its tag names no version', () => {
    expect(wrongServer(undefined, STATUS_34)).toBeUndefined();
    expect(wrongServer('nextcloud:latest', STATUS_34)).toBeUndefined();
  });
});
