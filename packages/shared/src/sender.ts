// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHO SENT A PERSON THEIR LINK (workplan 0176 §7, T3; D7, D11; the owner,
 * 2026-11-26: *"Yes"* to the page naming the member who asks, and *"Yes, good
 * idea. And we can store/show the phone number."*).
 *
 * A person who opens a link was taught never to trust one. The page cannot
 * ask for that trust; it gives them something to check (R6): who sent it, by
 * the name they know them by, how they know them, and a number. Each is the
 * member's own to give, and each is held to a shape here, because the page
 * shows it under Ownpace's name.
 *
 * ## A name, as the people they send a link to know them
 *
 * Stored on the member (`tenant_member.display_name`, managed migration
 * 0067), written only by that member, on Team or where they make a person's
 * link. A name's characters only: letters of any script and the marks that go
 * with them, spaces, and `' ’ - .`, at most 60 characters, at least one
 * letter. No digit, no `@`, no `/`, no `:`, so the name cannot carry *call
 * 0800 …*, an address or a web address (`bank.example`: a dot between two
 * words of two letters or more), which is what a free field under Ownpace's
 * name would be used for. Initials keep their dots: *J.P. de Wit*. The number has its own field, held to
 * its own shape.
 *
 * ## How the reader knows them (D7)
 *
 * A fixed list (`SENDER_RELATIONS`), chosen by the member about themselves,
 * per link (`person_link.relation`), or none. Free text under Ownpace's name
 * is where an impersonator would write *your bank*. A code here; the page says
 * it in the reader's language and voice (`sender.relation.*`).
 *
 * ## A number to check (D11)
 *
 * The member's own (`tenant_member.phone`), held to the organisation's
 * number's shape (`contactPhoneFrom`), and where they gave none, the
 * organisation's. The page says whose it is, and never that it proves
 * anything: a false page would print a number too.
 *
 * ## Read again when read
 *
 * The migration holds both columns to a shape of its own, and the reader
 * (`senderOnAPage`) passes what it reads through the same verdicts the writer
 * does, as `readTenantContactPhone` does: a value that would be refused now is
 * shown as none, never as it is.
 */

import { contactPhoneFrom } from './tenant-contact.ts';

/**
 * How a person knows the member who sent their link (D7), as the member says
 * it of themselves: *your daughter*, …, *a family member*, *someone you know*,
 * *your colleague*. The migration's CHECK holds the column to this list, and
 * `who-sends-the-link.unit.test.ts` (`packages/managed`) holds the two equal.
 */
export const SENDER_RELATIONS = [
  'daughter',
  'son',
  'child',
  'granddaughter',
  'grandson',
  'grandchild',
  'partner',
  'brother',
  'sister',
  'father',
  'mother',
  'family',
  'acquaintance',
  'colleague',
] as const;
export type SenderRelation = (typeof SENDER_RELATIONS)[number];

export function isSenderRelation(value: unknown): value is SenderRelation {
  return typeof value === 'string' && (SENDER_RELATIONS as readonly string[]).includes(value);
}

/** The longest name accepted, in characters, as Postgres counts them (`char_length`). */
export const SENDER_NAME_MAX_LENGTH = 60;

/** Letters and their marks, spaces, and the four signs a name is written with. */
const NAME_CHARACTERS = /^[\p{L}\p{M}' ’.-]+$/u;
const A_LETTER = /\p{L}/u;
/**
 * A dot between two words of two letters or more: a web address
 * (`bank.example`), never a name. Initials keep their dots: *J.P. de Wit*.
 */
const A_DOMAIN = /\p{L}{2,}\.\p{L}{2,}/u;

/** Why a name or a number was refused, as a code the member's screen words in its own language. */
export type SenderRefusalCode = 'sender_name_refused' | 'sender_phone_refused';

export type SenderNameVerdict =
  | { readonly ok: true; readonly name: string | null }
  | { readonly ok: false; readonly code: 'sender_name_refused'; readonly reason: string };

/**
 * What the member typed, as the name to store, or why it cannot be one. Empty
 * means "no name": the page then names them by their address, as before.
 * Runs of spaces are folded, as for the organisation's number.
 */
export function senderNameFrom(input: string | null | undefined): SenderNameVerdict {
  const typed = (input ?? '').trim().replace(/\s+/g, ' ');
  if (typed === '') return { ok: true, name: null };
  if (
    [...typed].length > SENDER_NAME_MAX_LENGTH ||
    !NAME_CHARACTERS.test(typed) ||
    !A_LETTER.test(typed) ||
    A_DOMAIN.test(typed)
  ) {
    return {
      ok: false,
      code: 'sender_name_refused',
      reason:
        `That is not a name a person's page can show: use letters, spaces and ' - . only, ` +
        `at most ${SENDER_NAME_MAX_LENGTH} characters. Leave it empty to be named by your address.`,
    };
  }
  return { ok: true, name: typed };
}

export type SenderPhoneVerdict =
  | { readonly ok: true; readonly phone: string | null }
  | { readonly ok: false; readonly code: 'sender_phone_refused'; readonly reason: string };

/** The member's own number, by the organisation's number's rule (`contactPhoneFrom`). */
export function senderPhoneFrom(input: string | null | undefined): SenderPhoneVerdict {
  const verdict = contactPhoneFrom(input);
  return verdict.ok ? verdict : { ok: false, code: 'sender_phone_refused', reason: verdict.reason };
}

/**
 * The sender, as a person's page may show them (§7): the name they gave, how
 * the reader knows them, and their own number. Each null when not given. The
 * address is the link page's `askedBy`, beside this, and never on the
 * progress page.
 */
export interface SenderOnAPage {
  readonly name: string | null;
  readonly relation: SenderRelation | null;
  readonly phone: string | null;
}

/** What is stored, as the page may show it: each value read through the writer's own verdict. */
export function senderOnAPage(stored: {
  readonly name: unknown;
  readonly relation: unknown;
  readonly phone: unknown;
}): SenderOnAPage {
  const name = typeof stored.name === 'string' ? senderNameFrom(stored.name) : null;
  const phone = typeof stored.phone === 'string' ? senderPhoneFrom(stored.phone) : null;
  return {
    name: name?.ok ? name.name : null,
    relation: isSenderRelation(stored.relation) ? stored.relation : null,
    phone: phone?.ok ? phone.phone : null,
  };
}
