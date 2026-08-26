// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The front door's placement lock (workplan 0107 T1).
 *
 * What must hold: every id a connection form can offer is PLACED — provider
 * lane or protocol lane — so a waking kind (`proton`, one day) turns this
 * suite red until somebody decides where it belongs; families only collect
 * provider-lane ids and never share a member; and both doors partition
 * through ONE algorithm, whose ordering and lone-member folding are pinned
 * here rather than re-derived per door.
 */

import { describe, it, expect } from 'vitest';
import { connectableTypes } from './credential-fields.ts';
import {
  FAMILY_DISPLAY_NAMES,
  FRONT_DOOR_FAMILIES,
  FRONT_DOOR_GROUPS,
  frontDoorFamilyOf,
  partitionFrontDoor,
} from './front-door.ts';

describe('every connectable id is placed', () => {
  it('source and target vocabularies both resolve to a lane', () => {
    for (const role of ['source', 'target'] as const) {
      for (const id of connectableTypes(role)) {
        expect(
          FRONT_DOOR_GROUPS[id],
          `'${id}' (${role}) is offered but not placed — decide its lane in FRONT_DOOR_GROUPS`,
        ).toBeDefined();
      }
    }
  });

  it('families collect provider-lane ids only, and never share a member', () => {
    const seen = new Set<string>();
    for (const family of FRONT_DOOR_FAMILIES) {
      expect(FAMILY_DISPLAY_NAMES[family.id], `family '${family.id}' has no display name`).toBeDefined();
      for (const member of family.members) {
        expect(FRONT_DOOR_GROUPS[member], `family member '${member}' is unplaced`).toBe('provider');
        expect(seen.has(member), `'${member}' appears in two families`).toBe(false);
        seen.add(member);
      }
    }
  });

  it('frontDoorFamilyOf answers for members and stays silent for standalones', () => {
    expect(frontDoorFamilyOf('oauth2')).toBe('microsoft365');
    expect(frontDoorFamilyOf('google-drive')).toBe('google');
    expect(frontDoorFamilyOf('dropbox')).toBeUndefined();
    expect(frontDoorFamilyOf('soverin')).toBeUndefined();
    expect(frontDoorFamilyOf('imap')).toBeUndefined();
  });
});

describe('partitionFrontDoor — the one algorithm both doors render', () => {
  const ids = (xs: ReadonlyArray<string>) => partitionFrontDoor(xs, (x) => x);

  it('splits the source vocabulary into families, standalones and protocols, order kept', () => {
    const p = ids(connectableTypes('source'));
    expect(p.families.map((f) => f.id)).toEqual(['microsoft365', 'google']);
    expect(p.families[0]?.members).toEqual(['oauth2', 'graph']);
    expect(p.families[1]?.members).toEqual(['gmail', 'google-calendar', 'google-contacts', 'google-drive']);
    expect(p.providers).toEqual(['box', 'dropbox']);
    expect(p.protocols).toEqual(['imap']);
  });

  it('splits the target vocabulary: the account kind is the provider lane, the five protocols the other', () => {
    const p = ids(connectableTypes('target'));
    expect(p.providers).toEqual(['soverin']);
    expect(p.families).toEqual([]);
    expect(p.protocols).toEqual(['jmap', 'imap', 'caldav', 'carddav', 'webdav']);
  });

  it('a family with one present member folds into standalones — no heading over a single card', () => {
    const p = ids(['graph', 'dropbox', 'imap']);
    expect(p.families).toEqual([]);
    expect(p.providers).toEqual(['graph', 'dropbox']);
    expect(p.protocols).toEqual(['imap']);
  });

  it('an unplaced id lands visibly among providers rather than disappearing', () => {
    const p = ids(['imap', 'someday-a-kind']);
    expect(p.providers).toEqual(['someday-a-kind']);
  });
});
