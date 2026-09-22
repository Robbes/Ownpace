// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NUMBER THE SCREEN NEVER RECEIVED, AND A NUMBER NOBODY READ.
 *
 * `DiscoveryCounts` has rendered "N Google Docs will not be copied" since
 * 0118, on the confirm screen, deliberately: *"while the choice is still open
 * — and not as a queue full of failure rows after the first pass"*.
 *
 * On the managed edition it rendered nothing, ever. `DiscoveryRecordSchema`
 * in `mapping-service.ts` did not list `refusedNative`, and zod strips what a
 * schema does not name — so the field was parsed away between the API (which
 * always sent it) and the component (which has always known how to show it).
 * The appliance reads its own route and was unaffected, which is how one
 * component, fed the same data, could be right on one edition and blank on the
 * other. The comment directly above that schema warns about exactly this:
 * *"the schema below still has to list it to survive parsing"*.
 *
 * And a number on a screen is not a number somebody read. The owner ran a full
 * migration past this line on 2026-09-22 and met its consequence afterwards,
 * so the count now carries a tick-box and Start waits for it — a tick-box, not
 * a block, because refusing to export is a legitimate answer and the product
 * has no business pushing anybody off it.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiscoveryRecordSchema } from '../../services/mapping-service.ts';
import {
  RefusedNativeAcknowledgement,
  needsAcknowledgement,
  refusedByKind,
  refusedTotal,
} from './native-refusals.tsx';

const row = (refusedNative?: Record<string, number>) => ({
  domain: 'file' as const,
  collections: 1,
  items: 42,
  discoveredAt: '2026-09-22T10:00:00Z',
  ...(refusedNative ? { refusedNative } : {}),
});

describe('the field survives the managed client', () => {
  it('parses refusedNative instead of stripping it', () => {
    const parsed = DiscoveryRecordSchema.parse(row({ document: 12, spreadsheet: 5 }));
    expect(parsed.refusedNative).toEqual({ document: 12, spreadsheet: 5 });
  });

  it('still accepts a row without one — every other source sends none', () => {
    expect(DiscoveryRecordSchema.parse(row()).refusedNative).toBeUndefined();
  });
});

describe('what the tick-box is counting', () => {
  it('totals across domains, commonest kind first', () => {
    const domains = [row({ document: 2 }), row({ presentation: 1, document: 10 })];
    expect(refusedByKind(domains)).toEqual([
      ['document', 12],
      ['presentation', 1],
    ]);
    expect(refusedTotal(domains)).toBe(13);
  });

  it('asks for no acknowledgement when nothing is refused', () => {
    // The quiet case has to stay quiet: a migration with nothing to warn about
    // must start exactly as it did, with no extra click invented for it.
    expect(needsAcknowledgement([row()])).toBe(false);
    expect(needsAcknowledgement([row({ document: 0 })])).toBe(false);
    expect(needsAcknowledgement([row({ document: 1 })])).toBe(true);
  });
});

describe('the tick-box itself', () => {
  it('renders nothing at all when nothing is refused', () => {
    const { container } = render(
      <RefusedNativeAcknowledgement domains={[row()]} checked={false} onChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('names the kinds and the count, never "some files"', () => {
    // "3 items will not be copied" sends somebody hunting through their Drive.
    render(
      <RefusedNativeAcknowledgement
        domains={[row({ document: 12, spreadsheet: 5 })]}
        checked={false}
        onChange={() => {}}
      />,
    );
    const label = screen.getByRole('checkbox').closest('label');
    expect(label?.textContent).toContain('12');
    expect(label?.textContent).toContain('5');
    expect(label?.textContent).toContain('17');
  });

  it('reports the press, so the screen above it can hold Start', () => {
    const seen: boolean[] = [];
    render(
      <RefusedNativeAcknowledgement
        domains={[row({ document: 1 })]}
        checked={false}
        onChange={(next) => seen.push(next)}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(seen).toEqual([true]);
  });
});
