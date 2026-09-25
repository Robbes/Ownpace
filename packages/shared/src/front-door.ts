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

// Types only: this file has no runtime import, so a root-level guard can read
// it by relative path (scripts/a-proof-that-was-written-down.unit.test.ts).
import type { DiscoveryDomain } from './discovery.ts';
import type { ProviderAccountKind } from './provider-accounts.ts';

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
  //
  // The Microsoft ACCOUNT (workplan 0114) leads its family for the same
  // reason `google` leads its own: one credential, one consent, the faces you
  // tick. The two app-registration methods stay beside it.
  microsoft: 'provider',
  oauth2: 'provider',
  graph: 'provider',
  // The Google ACCOUNT (workplan 0106 T3b) — a provider like the four
  // products below it, and the family's first member because it is the usual
  // choice now: one credential, one consent, the faces you tick.
  google: 'provider',
  gmail: 'provider',
  'google-calendar': 'provider',
  'google-contacts': 'provider',
  'google-drive': 'provider',
  dropbox: 'provider',
  box: 'provider',
  soverin: 'provider',
  // A PROVIDER, not a protocol, even though every face it serves is a
  // protocol this door also lists on its own. The lane answers "what is the
  // person naming?" — and they are naming their Nextcloud, once, rather than
  // three transports (2026-09-07).
  nextcloud: 'provider',
  // The Apple ACCOUNT (workplan 0115) — a provider, and a family of exactly
  // one: there is no `icloud` or `apple-mail` kind beside it to collect,
  // because Apple has never published an API one could have been built on.
  apple: 'provider',
  // The EXPORT ARCHIVE (workplan 0116 T1). The lane took a moment's thought,
  // because an archive is neither a brand nor a wire format — and `provider`
  // is still the honest answer. The protocol lane is "any server that speaks
  // the words", the self-hoster's fallback; an archive is not a server at all,
  // and nobody arrives at it thinking about a transport. They arrive thinking
  // "I want my photos out of Google", which is a provider thought.
  //
  // One entry rather than one per export, for the reason `ARCHIVE_PROVIDERS`
  // exists: which export it is belongs on the connection.
  archive: 'provider',
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
  // The ACCOUNT first, the same rule Google's family follows below: the usual
  // choice leads, and the two app-registration methods stay beside it for the
  // customer who has one (workplan 0114 T5b).
  { id: 'microsoft365', members: ['microsoft', 'oauth2', 'graph'] },
  // The account first — "the usual choice first", the same rule that puts
  // oauth2 before graph. The four single-purpose products stay beside it and
  // are the only way to mail and files until Google's restricted-scope
  // assessment is bought.
  { id: 'google', members: ['google', 'gmail', 'google-calendar', 'google-contacts', 'google-drive'] },
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

/**
 * Whether a source has met a real account (workplan 0131 T2 (a); the owner's
 * D6, *"Label"*).
 *
 * - **proven**: a complete pass has run against a real account of this kind,
 *   and `recorded` says where that run is written down: the date of its row in
 *   the "Live proofs" section of `docs/feature-matrix.md` (0141 T1), or
 *   `PROVEN_BEFORE_THE_RECORD` for a row of that section's second table, the
 *   runs that happened before the record existed and whose counts it does not
 *   hold;
 * - **experimental**: built, and not yet run against a real account.
 *
 * `scripts/a-proof-that-was-written-down.unit.test.ts` holds every proven
 * verdict to a row with its kind and face, and every experimental one to none.
 */
export type SourceProof =
  | { readonly verdict: 'proven'; readonly recorded: string }
  | { readonly verdict: 'experimental' };

/** A proven verdict whose row is in "Proven before this record". */
export const PROVEN_BEFORE_THE_RECORD = 'before the record';

/** The word a Live proofs row uses for Google's whole-domain delegation. */
export const WHOLE_DOMAIN_PROOF_KIND = 'whole-domain';

/** The word a Live proofs row uses for a shared mailbox (Pattern S); its face is email. */
export const SHARED_MAILBOX_PROOF_KIND = 'shared-mailbox';

const PROVEN_EARLIER: SourceProof = { verdict: 'proven', recorded: PROVEN_BEFORE_THE_RECORD };
const EXPERIMENTAL: SourceProof = { verdict: 'experimental' };

/**
 * Which sources have met a real account: one table, beside the families,
 * because both doors and the wizard's data-type step read it and none of them
 * may say something the others do not (0131 T2).
 *
 * The screen reads this; `docs/feature-matrix.md` stays the long-form record.
 * A verdict flips to proven in the same pull request that records its run in
 * the matrix's Live proofs table (0141 T1), and a face whose connector is
 * rebuilt goes back to experimental in the pull request that rebuilds it.
 *
 * Its first content is 0131 §1's list, read against 0141 §1's table, which
 * says what each verdict rests on. Where the two plans are silent:
 *
 * - `oauth2` and `graph` are experimental. The matrix marks them ✅, and no run
 *   behind that mark is recorded anywhere (0141 §1; 0008 T7's acceptance was
 *   never met). The owner has run *Via IMAP* once, unrecorded, and keeps the
 *   card tagged until the next run is (0148 D5).
 * - The Microsoft 365 account's mail face is experimental with its other four:
 *   0114's Test measured it, and a measurement is not a pass (0141 §1).
 * - The Google account's file face is proven: the owner's live migration reads
 *   Drive through it, and its Sharing defect of 2026-09-17 was found there
 *   (`apps/api/src/routes/permissions.ts`). Its mail face is experimental: no
 *   run through the account is recorded, only through the `gmail` card.
 * - `soverin` as a source is experimental. It is not offered at either door;
 *   0105 T5 parked it. Its faces have verdicts because orchestration builds
 *   them, and a face with no verdict is what
 *   `packages/orchestration/src/a-face-that-arrives-without-a-verdict.unit.test.ts`
 *   refuses.
 * - The export archive is experimental, and offered at both doors on both
 *   editions: CI imports a fixture Takeout, and no import of a real export is
 *   recorded (0116). The owner chose to label it on managed rather than hide
 *   it (0148 D10). That a managed pass cannot yet read the path its form asks
 *   for is said by the refusal 0136 T5 adds, not by this table.
 */
export const SOURCE_PROOFS: {
  /** One verdict for each source card that is not an account kind. */
  readonly kinds: Readonly<Record<string, SourceProof>>;
  /** For each account kind, one verdict for each face it can ever claim. */
  readonly faces: Readonly<
    Record<ProviderAccountKind, Readonly<Partial<Record<DiscoveryDomain, SourceProof>>>>
  >;
  /** Google's whole-domain delegation (ADR-0033), an option on every Google card. */
  readonly wholeDomain: SourceProof;
  /**
   * A shared mailbox (Pattern S, SAD §14.1), read as `/users/{address}` with
   * application permissions. Not a card: the scope manifest's "Shared
   * mailboxes" row sits under *Partial* while this is experimental and under
   * *Migrates* once it is proven (0141 T10,
   * `a-shared-mailbox-promise-with-its-proof.unit.test.ts`).
   */
  readonly sharedMailbox: SourceProof;
} = {
  kinds: {
    // Against the Stalwart the appliance nightly runs: "proven on a server we
    // run", and the Live proofs row says so (0141 T1, point 2).
    imap: PROVEN_EARLIER,
    // Via IMAP: run once by the owner, unrecorded, and tagged until the next
    // run is recorded (0148 D5).
    oauth2: EXPERIMENTAL,
    graph: EXPERIMENTAL,
    // The owner's own Google account, routinely, for weeks (the matrix's note
    // of 2026-09-22). One account: a second is 0141 T6.
    gmail: PROVEN_EARLIER,
    'google-calendar': PROVEN_EARLIER,
    'google-contacts': PROVEN_EARLIER,
    'google-drive': PROVEN_EARLIER,
    dropbox: EXPERIMENTAL,
    box: EXPERIMENTAL,
    // Offered and labelled on both editions, managed included (0148 D10).
    archive: EXPERIMENTAL,
  },
  faces: {
    google: {
      email: EXPERIMENTAL,
      calendar: PROVEN_EARLIER,
      contact: PROVEN_EARLIER,
      file: PROVEN_EARLIER,
      // 0126 T8, the owner's sitting, is 0141 T5.
      task: EXPERIMENTAL,
    },
    soverin: { email: EXPERIMENTAL, calendar: EXPERIMENTAL, contact: EXPERIMENTAL, task: EXPERIMENTAL },
    // All five in one sitting, calendar first: a "no" there is a rebuild (0141 T2).
    microsoft: {
      email: EXPERIMENTAL,
      calendar: EXPERIMENTAL,
      contact: EXPERIMENTAL,
      file: EXPERIMENTAL,
      task: EXPERIMENTAL,
    },
    // Part 1 of `docs/apple-supervised-run.md` and its first pass (0141 T4).
    apple: { email: EXPERIMENTAL, calendar: EXPERIMENTAL, contact: EXPERIMENTAL, task: EXPERIMENTAL },
  },
  // Parked until a Workspace the owner administers, or a tester who asks (0141 T6).
  wholeDomain: EXPERIMENTAL,
  // Nobody has copied a real one. 0027 T0's consent run on the test tenant,
  // then one Pattern S copy recorded by 0141 T1's rule, is what flips it
  // (0141 T10 (b)); the Microsoft 365 account's delegated grant cannot.
  sharedMailbox: EXPERIMENTAL,
};

/** True when the id is an account kind, whose verdicts are per face. */
function isAccountKindWithFaces(id: string): id is keyof typeof SOURCE_PROOFS.faces {
  return Object.prototype.hasOwnProperty.call(SOURCE_PROOFS.faces, id);
}

/**
 * Does this source card carry the tag?
 *
 * A single-purpose card answers with its own verdict. An account card is
 * tagged only when EVERY face it has is experimental: the Google account's
 * calendar and contacts have run, so its card is plain and its Tasks face is
 * tagged in the data-type step instead. An id with no verdict (a target, or a
 * kind that has none yet) is not tagged; that every source card has one is
 * pinned by the web guard.
 */
export function sourceCardIsExperimental(id: string): boolean {
  if (isAccountKindWithFaces(id)) {
    const faces = Object.values(SOURCE_PROOFS.faces[id]);
    return faces.length > 0 && faces.every((p) => p?.verdict === 'experimental');
  }
  return SOURCE_PROOFS.kinds[id]?.verdict === 'experimental';
}

/**
 * Does this face of the chosen source carry the tag in the data-type step?
 *
 * An account kind answers per face. Any other source has one verdict for
 * whatever it carries, so its faces answer with the card's.
 */
export function sourceFaceIsExperimental(id: string, face: DiscoveryDomain): boolean {
  if (isAccountKindWithFaces(id)) return SOURCE_PROOFS.faces[id][face]?.verdict === 'experimental';
  return SOURCE_PROOFS.kinds[id]?.verdict === 'experimental';
}

/**
 * The front door's icons (workplan 0107 T2), one registry on the same ids.
 *
 * Provider-lane entries carry a MARK — a brand-colored tile with the
 * provider's initial. That is the deliberate floor: recognition without a
 * trademark question, shipped for every provider on day one. A real brand
 * SVG is a per-provider CONTENT swap behind the owner's nod, reviewed for
 * that brand's usage terms — never a code change, and never a prerequisite.
 * Protocol-lane entries carry a generic GLYPH on purpose: a protocol is not
 * a brand, and drawing it like one would re-mix the levels T1 separated.
 * The lanes stay visually distinct because the invariant is pinned: marks
 * on providers only, glyphs on protocols only.
 */
export type FrontDoorIcon =
  | { readonly kind: 'mark'; readonly initial: string; readonly background: string }
  | {
      readonly kind: 'glyph';
      readonly glyph: 'mail' | 'server' | 'calendar' | 'contacts' | 'files';
    };

const M365_MARK: FrontDoorIcon = { kind: 'mark', initial: 'M', background: '#0067b8' };
const GOOGLE_MARK: FrontDoorIcon = { kind: 'mark', initial: 'G', background: '#4285f4' };

export const FRONT_DOOR_ICONS: Readonly<Record<string, FrontDoorIcon>> = {
  // Protocols — one honest generic glyph each.
  imap: { kind: 'glyph', glyph: 'mail' },
  jmap: { kind: 'glyph', glyph: 'server' },
  caldav: { kind: 'glyph', glyph: 'calendar' },
  carddav: { kind: 'glyph', glyph: 'contacts' },
  webdav: { kind: 'glyph', glyph: 'files' },
  // Microsoft 365's two methods share the provider's one mark — same
  // account, same face; the card text says how it connects.
  //
  // The ACCOUNT wears the same mark, for the reason spelled out under `google`
  // below: it is not a third method, it is the account the other two reach.
  microsoft: M365_MARK,
  oauth2: M365_MARK,
  graph: M365_MARK,
  // The Google products keep the G and wear their product's own color —
  // the four colors are what makes them tell apart at a glance.
  //
  // The ACCOUNT wears the FAMILY's mark (workplan 0106 T3b), the one Google
  // blue, because it is not a product: it is the account the four products
  // all live in, and giving it a fifth colour would put it beside them as a
  // sixth thing to choose between rather than above them as the usual door.
  google: GOOGLE_MARK,
  gmail: { kind: 'mark', initial: 'G', background: '#ea4335' },
  'google-calendar': { kind: 'mark', initial: 'G', background: '#4285f4' },
  'google-contacts': { kind: 'mark', initial: 'G', background: '#1a73e8' },
  'google-drive': { kind: 'mark', initial: 'G', background: '#0f9d58' },
  dropbox: { kind: 'mark', initial: 'D', background: '#0061ff' },
  box: { kind: 'mark', initial: 'B', background: '#0061d5' },
  // Neutral slate until Soverin's own brand color is confirmed — a wrong
  // brand color would be a small guess, and this file does not guess.
  soverin: { kind: 'mark', initial: 'S', background: '#334155' },
  // Nextcloud's own blue, which the project publishes and uses everywhere —
  // no guess needed, unlike the slate above.
  nextcloud: { kind: 'mark', initial: 'N', background: '#0082c9' },
  apple: { kind: 'mark', initial: 'A', background: '#1d1d1f' },
  // A MARK, because the invariant below is pinned: marks on providers, glyphs
  // on protocols, and mixing them is what re-mixes the levels T1 separated.
  // But not a BRAND mark — this one card stands for a Google export and an
  // Apple export at once, so wearing either company's colour would promise the
  // wrong one to half the people who click it. Neutral slate and an E for
  // Export, which is the same answer `soverin` gets and for a related reason:
  // this file does not guess at a brand it has no right to.
  archive: { kind: 'mark', initial: 'E', background: '#475569' },
};

/** The mark a family HEADING wears — the provider's face over its methods. */
export const FAMILY_ICONS: Readonly<Record<string, FrontDoorIcon>> = {
  microsoft365: M365_MARK,
  google: GOOGLE_MARK,
};

export function frontDoorIconOf(id: string): FrontDoorIcon | undefined {
  return FRONT_DOOR_ICONS[id];
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
