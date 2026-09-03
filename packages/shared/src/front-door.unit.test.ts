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
  FAMILY_ICONS,
  FRONT_DOOR_FAMILIES,
  FRONT_DOOR_GROUPS,
  FRONT_DOOR_ICONS,
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

  it('every placed id and every family wears an icon, and the lanes stay visually distinct (0107 T2)', () => {
    for (const [id, group] of Object.entries(FRONT_DOOR_GROUPS)) {
      const icon = FRONT_DOOR_ICONS[id];
      expect(icon, `'${id}' is placed but has no icon — add it to FRONT_DOOR_ICONS`).toBeDefined();
      // Marks on providers only, glyphs on protocols only: a protocol is not
      // a brand, and a brand is not a protocol.
      expect(icon?.kind, `'${id}' (${group}) wears the other lane's icon kind`).toBe(
        group === 'provider' ? 'mark' : 'glyph',
      );
    }
    for (const family of FRONT_DOOR_FAMILIES) {
      expect(FAMILY_ICONS[family.id], `family '${family.id}' has no mark`).toBeDefined();
      expect(FAMILY_ICONS[family.id]?.kind).toBe('mark');
    }
  });

  it('the two Microsoft 365 methods share ONE mark — same account, same face', () => {
    expect(FRONT_DOOR_ICONS.oauth2).toBe(FRONT_DOOR_ICONS.graph);
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
    // The Microsoft ACCOUNT first (workplan 0114), by the same rule that puts
    // `google` first in its own family below and `oauth2` before `graph`: the
    // usual choice leads. The two app-registration methods stay beside it for
    // a customer who already has a registration.
    expect(p.families[0]?.members).toEqual(['microsoft', 'oauth2', 'graph']);
    // The ACCOUNT first (workplan 0106 T3b) — "the usual choice first", the
    // same rule that puts oauth2 before graph. The four single-purpose
    // products stay beside it: they are the only way to mail and files until
    // Google's restricted-scope assessment is bought.
    expect(p.families[1]?.members).toEqual([
      'google',
      'gmail',
      'google-calendar',
      'google-contacts',
      'google-drive',
    ]);
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
