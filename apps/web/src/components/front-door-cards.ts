// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The front door's cards — ONE list for both doors (workplan 0107, and the
 * owner's remark of 2026-09-01 that the connections page was "less clean and
 * nice than the migration page, while both show ways to register connections").
 *
 * 0107 T1 put the GROUPING in shared so the wizard and the connections
 * add-form could never group differently. It left the CARDS in the wizard and
 * gave the add-form "the same authority, rendered plainly" — an `<optgroup>`
 * select. That was the minimal step and it produced exactly the asymmetry the
 * owner saw: one door with icons, names, hints and a family heading, the other
 * a drop-down of the same ids.
 *
 * So the cards move here, where both doors can read them. Every id stays —
 * contract vocabulary, the wizard's `sourceType`/`targetType` and the create
 * schema's enums — and `connectableTypes()` in shared already offers exactly
 * these ids per side, which `front-door-cards.unit.test.ts` pins so a kind
 * added on one side cannot arrive without a card.
 */

import type { StringKey } from '../i18n/strings.ts';

export interface FrontDoorCard {
  readonly id: string;
  /** A literal name (a brand or a protocol) — or… */
  readonly name?: string;
  /** …a translated one, for the two Microsoft 365 methods. */
  readonly nameKey?: StringKey;
  readonly hintKey: StringKey;
  /**
   * Offered on the CONNECTIONS page but not in the migration wizard
   * (workplan 0116 T1).
   *
   * The two doors are not the same question. "Add a connection" asks whether
   * this product can reach something; "create a migration" asks it to copy
   * out of it, and a kind can honestly answer the first and not yet the
   * second. The export archive was the first such kind: for one slice it
   * connected, tested and measured — items, bytes, folders, the date range
   * the export covers — while copying items out (0116 T5/T6) was not built
   * and the create route refused an archive source by name. Since T5/T6 it
   * migrates, and no card carries this flag.
   *
   * The flag stays, for the next kind that arrives in that state. A card that
   * walks six steps and ends in a refusal is worse than one that is not
   * there: it spends somebody's attention to tell them no. The Connections
   * page shows it, where every one of its answers is true.
   */
  readonly connectionOnly?: boolean;
}

/**
 * The source cards, grouped through the SHARED front-door placement (workplan
 * 0107 T1): "Your provider" first — the level people arrive thinking in — then
 * "Any server, by protocol", the honest fallback lane and the self-hoster's
 * first language. Only the two Microsoft 365 entries are RENAMED, because
 * "OAuth2" was an auth mechanism wearing a card and said neither "Microsoft"
 * nor "365" — under the family heading each card names its connection method.
 */
export const SOURCE_CARDS = [
  { id: 'imap', name: 'IMAP', hintKey: 'wizard.proto.imap.hint' },
  // The ACCOUNT (workplan 0114), first among the Microsoft cards for the same
  // reason `google` leads its family: it is the usual choice, and it is the
  // only one of the three that a person without an IT department can finish.
  // The two app-registration methods stay beside it for the customer who
  // already has a registration — cohabitation, not replacement.
  { id: 'microsoft', name: 'Microsoft 365 account', hintKey: 'wizard.proto.microsoft.hint' },
  { id: 'oauth2', nameKey: 'wizard.m365.viaImap', hintKey: 'wizard.proto.oauth2.hint' },
  { id: 'graph', nameKey: 'wizard.m365.viaGraph', hintKey: 'wizard.proto.graph.hint' },
  // The ACCOUNT (workplan 0106 T3b), first among the Google cards because
  // `FRONT_DOOR_FAMILIES` puts it first — "the usual choice first". The four
  // product cards stay beside it and are the only way to mail and files on a
  // deployment that has not declared the restricted scope class.
  { id: 'google', name: 'Google account', hintKey: 'wizard.proto.google.hint' },
  { id: 'google-drive', name: 'Google Drive', hintKey: 'wizard.proto.googleDrive.hint' },
  { id: 'gmail', name: 'Gmail', hintKey: 'wizard.proto.gmail.hint' },
  { id: 'google-calendar', name: 'Google Calendar', hintKey: 'wizard.proto.googleCalendar.hint' },
  { id: 'google-contacts', name: 'Google Contacts', hintKey: 'wizard.proto.googleContacts.hint' },
  { id: 'dropbox', name: 'Dropbox', hintKey: 'wizard.proto.dropbox.hint' },
  { id: 'box', name: 'Box', hintKey: 'wizard.proto.box.hint' },
  // The Apple ACCOUNT (workplan 0115). A card on its own, not a family: there
  // is no second Apple method to sit beside it, because Apple publishes no API
  // one could have been built on. Its hint has to do more work than the
  // others' — it is the only source card where the credential is not obvious
  // from the name, and the first question everyone asks is why there is no
  // button.
  { id: 'apple', name: 'Apple account (iCloud)', hintKey: 'wizard.proto.apple.hint' },
  // The EXPORT ARCHIVE (workplan 0116 T1) — one card for both exports, because
  // which export it is (`ARCHIVE_PROVIDERS`) is a field ON the connection and
  // not a kind of its own. Named for what it is rather than for either
  // gatekeeper, so a third export joins it without renaming anything. It was
  // `connectionOnly` for one slice; since T5/T6 the wizard offers it too.
  { id: 'archive', name: 'Export archive', hintKey: 'wizard.proto.archive.hint' },
] as const satisfies ReadonlyArray<FrontDoorCard>;

export const TARGET_CARDS = [
  { id: 'jmap', name: 'JMAP', hintKey: 'wizard.proto.jmap.hint' },
  { id: 'imap', name: 'IMAP', hintKey: 'wizard.proto.imap.hint' },
  { id: 'caldav', name: 'CalDAV', hintKey: 'wizard.proto.caldav.hint' },
  { id: 'carddav', name: 'CardDAV', hintKey: 'wizard.proto.carddav.hint' },
  { id: 'webdav', name: 'WebDAV', hintKey: 'wizard.proto.webdav.hint' },
  { id: 'soverin', name: 'Soverin', hintKey: 'wizard.proto.soverin.hint' },
] as const satisfies ReadonlyArray<FrontDoorCard>;

export type SourceCard = (typeof SOURCE_CARDS)[number];

/**
 * A source card the migration WIZARD may offer — every card that is not
 * `connectionOnly` (workplan 0116 T1).
 *
 * A type rather than a runtime check alone, and that is the load-bearing half:
 * the wizard's `FormData.sourceType` is `CreateMappingInput['sourceType']`,
 * which the create route's enum defines. While the archive was connection-only
 * that union did not include it, so handing the chooser plain `SourceCard`s
 * made the wizard fail to compile — correctly — because it could then have set
 * a source type the API refuses. The compiler, not a filter somebody could
 * quietly drop, is what keeps the wizard out of a kind in that state.
 */
export type MigratableSourceCard = Exclude<SourceCard, { connectionOnly: true }>;
export type TargetCard = (typeof TARGET_CARDS)[number];

/**
 * The cards for a side — what an "add a connection" form offers.
 *
 * `as const` on the lists above is not decoration: it keeps every `id` a
 * LITERAL, so the wizard's `sourceType` union — the create schema's enum,
 * read back from a picked card — stays a closed set the compiler checks,
 * rather than widening to `string` the moment the cards moved out of that
 * file.
 */
export function frontDoorCards(role: 'source' | 'target'): ReadonlyArray<FrontDoorCard> {
  return role === 'target' ? TARGET_CARDS : SOURCE_CARDS;
}

/**
 * The cards the MIGRATION WIZARD may offer — everything a mapping can be
 * created from (workplan 0116 T1).
 *
 * A function rather than a second list, so the two doors keep reading one
 * table: the connections page shows `frontDoorCards`, the wizard shows this,
 * and the difference between them is a flag somebody wrote down with a reason
 * beside it rather than a card that exists in one file and not the other.
 */
export function migratableSourceCards(): ReadonlyArray<MigratableSourceCard> {
  // `'connectionOnly' in c` rather than `c.connectionOnly`, and the awkwardness
  // is the `as const` earning its keep: each card narrows to its own literal
  // type, so the flag is not a property of the others — and reading it through
  // `in` is what keeps every `id` a LITERAL here. Widening to `FrontDoorCard`
  // would compile and would quietly turn the wizard's `sourceType` back into
  // `string`, which is exactly what that `as const` exists to prevent.
  return SOURCE_CARDS.filter(
    (c): c is MigratableSourceCard => !('connectionOnly' in c && c.connectionOnly),
  );
}
