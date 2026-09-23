// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The version of an Outlook item (`graphItemVersion`): which of Graph's three
 * validators it is, in which order, and nothing when there is none. The
 * behaviour it gives the sync loop is proved across passes in core's
 * `an-outlook-edit-nobody-copied`.
 */
import { describe, expect, it } from 'vitest';
import { graphItemVersion } from './graph-item-version.ts';

const ALL = { changeKey: 'CQAAABYAAAA', '@odata.etag': 'W/"CQAAABYAAAA"', lastModifiedDateTime: '2026-09-23T10:00:00Z' };

describe('the version of an Outlook item', () => {
  it("is Graph's changeKey when there is one", () => {
    expect(graphItemVersion(ALL)).toEqual({ etag: 'changeKey:CQAAABYAAAA' });
  });

  it('is the weak ETag when changeKey is left out', () => {
    const { changeKey: _left, ...rest } = ALL;
    expect(graphItemVersion(rest)).toEqual({ etag: 'odata:W/"CQAAABYAAAA"' });
  });

  it('is the last modification time when neither validator came', () => {
    expect(graphItemVersion({ lastModifiedDateTime: ALL.lastModifiedDateTime })).toEqual({
      etag: 'modified:2026-09-23T10:00:00Z',
    });
  });

  it('is nothing at all when Graph gave none, rather than a constant', () => {
    // A constant would read "unchanged" on every pass with the confidence of
    // a real comparison, which is the defect this exists to end.
    expect(graphItemVersion({})).toEqual({});
    expect(graphItemVersion({ changeKey: '' })).toEqual({});
  });

  it('says which validator it is, so a switch between them reads as a change', () => {
    const byKey = graphItemVersion({ changeKey: 'x' }).etag;
    const byTime = graphItemVersion({ lastModifiedDateTime: 'x' }).etag;
    expect(byKey).not.toBe(byTime);
  });
});
