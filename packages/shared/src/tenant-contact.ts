// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The organisation's phone number (workplan 0108 T8a).
 *
 * The owner, 2026-09-23: *"If there is no phone number, then add it, but
 * leave optional: we show it at grant-migration-page, but it's not required to
 * have in the tenant profile."* The grant page exists so that the person being
 * asked can tell who is asking. A number they can call is the most direct way
 * to check, and it is the organisation's to give or to leave out.
 *
 * ## Why the shape is checked, twice
 *
 * The number is the one thing on the consent page an organisation writes
 * itself, and the page is the one a stranger could dress up. A free-text field
 * there would carry *"Call IT on …, they know about this"* as easily as a
 * number. So only a phone number's characters are accepted: digits, spaces,
 * and `+ ( ) - . /`, with between 6 and 15 digits, the most E.164 allows.
 *
 * It is checked when it is SET (`contactPhoneFrom`, the route refuses anything
 * else with a sentence) and again when it is READ (`readTenantContactPhone`
 * shows nothing that does not pass), because `tenant.settings` is one JSON
 * object with other writers. The reader is what the grant page and the
 * settings screen both use, so neither can show what the other would refuse.
 *
 * Stored as the owner typed it, with runs of spaces folded: a number is read
 * by a person, and `+31 20 123 4567` is easier to read back than a canonical
 * `+31201234567`.
 */

/** The longest number accepted, in characters: E.164's 15 digits and room to space them. */
export const CONTACT_PHONE_MAX_LENGTH = 32;

const PHONE_CHARACTERS = /^\+?[0-9 ()./-]+$/;

export type ContactPhoneVerdict =
  | { readonly ok: true; readonly phone: string | null }
  | { readonly ok: false; readonly reason: string };

/**
 * What the owner typed, as the number to store, or why it cannot be one.
 * Empty means "show no number": the field is optional.
 */
export function contactPhoneFrom(input: string | null | undefined): ContactPhoneVerdict {
  const typed = (input ?? '').trim().replace(/\s+/g, ' ');
  if (typed === '') return { ok: true, phone: null };
  const digits = typed.replace(/[^0-9]/g, '').length;
  if (
    typed.length > CONTACT_PHONE_MAX_LENGTH ||
    !PHONE_CHARACTERS.test(typed) ||
    digits < 6 ||
    digits > 15
  ) {
    return {
      ok: false,
      reason:
        'That is not a phone number this page can show: use digits, spaces and + ( ) - . / ' +
        'only, with 6 to 15 digits. Leave it empty to show no number.',
    };
  }
  return { ok: true, phone: typed };
}

/** The stored number, or null — including when what is stored is not a phone number. */
export function readTenantContactPhone(settings: unknown): string | null {
  const stored =
    settings !== null && typeof settings === 'object'
      ? (settings as { contactPhone?: unknown }).contactPhone
      : undefined;
  if (typeof stored !== 'string') return null;
  const verdict = contactPhoneFrom(stored);
  return verdict.ok ? verdict.phone : null;
}

/**
 * The settings with this number in them, or without one. MERGED, not
 * replaced: `settings` also holds the slug and the notification preferences,
 * and saving a number must not drop them.
 */
export function withTenantContactPhone(
  settings: unknown,
  phone: string | null,
): Record<string, unknown> {
  const next: Record<string, unknown> =
    settings !== null && typeof settings === 'object' ? { ...(settings as Record<string, unknown>) } : {};
  if (phone === null) delete next.contactPhone;
  else next.contactPhone = phone;
  return next;
}
