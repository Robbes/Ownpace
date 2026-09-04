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
