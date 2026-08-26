// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The front door's grouping (workplan 0107 T1): which level each connectable
 * type lives on, and which types are ONE account to the person choosing.
 *
 * The wizard's choosers mixed four vocabularies at one level — products
 * (Gmail, Dropbox), an API (Microsoft Graph), a protocol (IMAP) and an auth
 * mechanism ("OAuth2", which meant "Microsoft 365 over IMAP+XOAUTH2" and said
 * neither word). People arrive thinking in providers; protocols are the
 * honest fallback lane for the long tail and the self-hoster's first
 * language. Separating the levels is a TAXONOMY fix, so it lives here as
 * data: the wizard's two choosers and the connections page's add-form are
 * separate doors, and one hand-written grouping per door is one drift away
 * from the doors disagreeing — the same argument that put
 * `TARGET_TYPE_DOMAINS` in shared.
 *
 * Presentation only. Nothing here carries an endpoint, a host or a prefill —
 * the provider DIRECTORY (0106 T5) stays parked behind the never-guess rule,
 * and nothing may ride an endpoint in through a group entry. Ids, schemas
 * and stored kinds do not move.
 */

/** Which lane a connectable type is offered in. */
export type FrontDoorGroup = 'provider' | 'protocol';

/**
 * Placement for every id `connectableTypes()` can offer, source and target.
 * A test pins that no connectable id is missing here — so a waking kind
 * (`proton`, one day) must be PLACED, never silently orphaned into whatever
 * the renderer does with the unknown.
 */
export const FRONT_DOOR_GROUPS: Readonly<Record<string, FrontDoorGroup>> = {
  // Protocols — any server that speaks the words.
  imap: 'protocol',
  jmap: 'protocol',
  caldav: 'protocol',
  carddav: 'protocol',
  webdav: 'protocol',
  // Providers — a named place people migrate from or to.
  oauth2: 'provider',
  graph: 'provider',
  gmail: 'provider',
  'google-calendar': 'provider',
  'google-contacts': 'provider',
  'google-drive': 'provider',
  dropbox: 'provider',
  box: 'provider',
  soverin: 'provider',
};

/**
 * A family collects the types that are ONE account to the person: Microsoft
 * 365 is two connection methods, not two providers; Google is four products
 * on one credential (and 0106 T1b will make it one grant-qualified
 * connection). Members keep their own cards and ids — the family is a
 * heading, never a collapse.
 */
export interface FrontDoorFamily {
  readonly id: string;
  readonly members: ReadonlyArray<string>;
}

export const FRONT_DOOR_FAMILIES: ReadonlyArray<FrontDoorFamily> = [
  { id: 'microsoft365', members: ['oauth2', 'graph'] },
  { id: 'google', members: ['gmail', 'google-calendar', 'google-contacts', 'google-drive'] },
];

/** Brand names — rendered verbatim in every language, like the type names. */
export const FAMILY_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  microsoft365: 'Microsoft 365',
  google: 'Google',
};

/** The family an id belongs to, or undefined for standalone types. */
export function frontDoorFamilyOf(id: string): string | undefined {
  return FRONT_DOOR_FAMILIES.find((f) => f.members.includes(id))?.id;
}

export interface FrontDoorPartition<T> {
  /** Families with at least TWO present members, in declaration order —
   *  a sub-heading over a single card would be noise, so a lone member
   *  folds into `providers`. */
  readonly families: ReadonlyArray<{ id: string; label: string; members: ReadonlyArray<T> }>;
  /** Standalone provider entries, in the caller's order. */
  readonly providers: ReadonlyArray<T>;
  /** Protocol entries, in the caller's order. */
  readonly protocols: ReadonlyArray<T>;
}

/**
 * Partition a door's own entries into render order — the one algorithm both
 * doors share, so the wizard's cards and the add-form's options can never
 * group differently. `idOf` lets a door pass rich entries (cards) or bare
 * ids alike. An id with no placement lands VISIBLY in `providers` rather
 * than disappearing (the lock test makes that unreachable for real ids; a
 * gap you can see is a bug report, a gap you cannot is a mystery).
 */
export function partitionFrontDoor<T>(
  entries: ReadonlyArray<T>,
  idOf: (entry: T) => string,
): FrontDoorPartition<T> {
  const protocols = entries.filter((e) => FRONT_DOOR_GROUPS[idOf(e)] === 'protocol');
  const providerEntries = entries.filter((e) => FRONT_DOOR_GROUPS[idOf(e)] !== 'protocol');
  const families: Array<{ id: string; label: string; members: T[] }> = [];
  const inRenderedFamily = new Set<string>();
  for (const family of FRONT_DOOR_FAMILIES) {
    // Members render in the FAMILY's declared order — it encodes "the usual
    // choice first" (oauth2 before graph), which a caller's alphabetical
    // list would scramble.
    const members = family.members
      .map((id) => providerEntries.find((e) => idOf(e) === id))
      .filter((e): e is T => e !== undefined);
    if (members.length < 2) continue;
    families.push({ id: family.id, label: FAMILY_DISPLAY_NAMES[family.id] ?? family.id, members });
    for (const m of members) inRenderedFamily.add(idOf(m));
  }
  const providers = providerEntries.filter((e) => !inRenderedFamily.has(idOf(e)));
  return { families, providers, protocols };
}
