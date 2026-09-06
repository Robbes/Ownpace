// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOOR THE FRONT DOOR OFFERS MUST HAVE A CHECK BEHIND IT.
 *
 * On 2026-09-06 the owner connected a Microsoft 365 account through the grant
 * button, pressed Test, and read "No check exists for a microsoft connection
 * yet; that is our gap, not your credentials." The consent worked, the faces
 * were wired for the passes (0114 T5a), the kind sat in fourteen tables (T5b)
 * — and the probe module's `default` arm was the one table nobody had
 * listed. The badges stayed `?` for the same reason one function over: no
 * qualifier claimed the kind.
 *
 * That is the family this repository keeps meeting — a new kind must reach
 * every table, and the tables that GATE are the ones whose absence is
 * invisible — so this asks the question directly, for every provider account
 * kind there is: does a probe answer something other than the gap sentence,
 * and does a qualifier claim it? No network: `fetch` throws here, so a probe
 * that answers has answered from its own credential checks, which is exactly
 * where a kind with no arm falls through.
 *
 * Asked AT THE DOOR EACH KIND IS OFFERED THROUGH. `soverin` is the target-side
 * account (0106 T4a): the source door never lists it and the target probe
 * carries its arm, so asking the source probe about it would report a gap the
 * product does not have. The doors decide — `connectableTypes(role)` — and a
 * kind neither door lists fails here too, since a kind with no door is a
 * table drift of its own.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PROVIDER_ACCOUNT_KINDS, connectableTypes } from '@openmig/shared';
import { probeSourceConnection, probeTargetConnection } from './probe-connection.ts';
import { isDropboxKind, isGoogleGrantKind, isQualifiableKind } from './account-qualification.ts';
import { isMicrosoftGrantKind } from './microsoft-account-test.ts';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('this guard reaches no network');
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('every provider account kind', () => {
  it('is more than one kind, so the loop below is not vacuous', () => {
    expect(PROVIDER_ACCOUNT_KINDS.length).toBeGreaterThan(2);
  });

  it.each([...PROVIDER_ACCOUNT_KINDS])('%s is offered through exactly one door', (kind) => {
    // The account kinds share their word with the wizard type on both sides
    // (`sourceKindFor` says so for each), which is what lets the doors be
    // read for the kind directly.
    const doors = (['source', 'target'] as const).filter((role) => connectableTypes(role).includes(kind));
    expect(doors, `'${kind}' is offered through ${doors.length} doors; the probe below needs one`).toHaveLength(1);
  });

  it.each([...PROVIDER_ACCOUNT_KINDS])('%s has a probe arm, never the gap sentence', async (kind) => {
    const config = { user: 'someone@example.test' };
    const result = connectableTypes('source').includes(kind)
      ? await probeSourceConnection(kind, config, {})
      : await probeTargetConnection(kind as Parameters<typeof probeTargetConnection>[0], config, {});
    expect(
      result.outcome.code,
      `Test on a '${kind}' connection answers "no check exists" — the kind fell to the probe's ` +
        'default arm. Add its case beside the other account kinds in probe-connection.ts.',
    ).not.toBe('noProbe');
  });

  it.each([...PROVIDER_ACCOUNT_KINDS])('%s is claimed by a qualifier', (kind) => {
    expect(
      isQualifiableKind(kind) || isGoogleGrantKind(kind) || isMicrosoftGrantKind(kind) || isDropboxKind(kind),
      `no qualifier claims '${kind}', so its badges stay '?' after every Test.`,
    ).toBe(true);
  });
});
