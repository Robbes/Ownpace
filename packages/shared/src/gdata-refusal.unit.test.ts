// Copyright 2026 The Ownpace authors (Apache-2.0)

import { describe, it, expect } from 'vitest';
import { davRefusalBody } from './gdata-refusal.ts';

const GOOGLE_403 =
  '<?xml version="1.0" encoding="UTF-8"?>\n<errors xmlns="http://schemas.google.com/g/2005">' +
  '<error><domain>GData</domain><code>accessNotConfigured</code><internalReason>CalDAV API ' +
  'has not been used in project 123 before or it is disabled. Enable it by visiting ' +
  'https://console.developers.google.com/apis/api/caldav.googleapis.com/overview?project=123 ' +
  'then retry.</internalReason></error></errors>';

describe("Google's GData refusal, read without its envelope (2026-09-02)", () => {
  it("keeps Google's code and reason, in Google's words, and drops the markup", () => {
    const out = davRefusalBody(GOOGLE_403);
    expect(out).toBe(
      'accessNotConfigured — CalDAV API has not been used in project 123 before or it is ' +
        'disabled. Enable it by visiting ' +
        'https://console.developers.google.com/apis/api/caldav.googleapis.com/overview?project=123 ' +
        'then retry.',
    );
    expect(out).not.toContain('<');
  });

  it('passes any other body through untouched — a Nextcloud refusal is not ours to reshape', () => {
    const nextcloud =
      '<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
      '<s:exception>Sabre\\DAV\\Exception\\NotAuthenticated</s:exception></d:error>';
    expect(davRefusalBody(nextcloud)).toBe(nextcloud);
    expect(davRefusalBody('Forbidden')).toBe('Forbidden');
    expect(davRefusalBody('')).toBe('');
  });

  it('a GData document with nothing readable in it stays as it came — better a wall than nothing', () => {
    const empty = '<errors xmlns="http://schemas.google.com/g/2005"></errors>';
    expect(davRefusalBody(empty)).toBe(empty);
  });
});
