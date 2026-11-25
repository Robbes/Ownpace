// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT THE PERSON FILLS ON THEIR GRANT LINK, AND WHAT THE OWNER FIXES
 * (workplan 0174 §5.2, D2).
 *
 * One rule, read by the API (the card on the person's page, and the create
 * door's `forPerson`, which accepts a person-fillable field empty) and by the
 * web (the *Save for {person}* form, which must not demand what the person
 * types). Until both read it here, the door took Infomaniak's sync user name
 * empty for a person and the form still required it.
 *
 * A secret is always the person's. The mailbox's own login (a kind that signs
 * in to its mail apart) is asked only when the owner gave the account a mail
 * server, which the create door demands exactly when mail is copied: an
 * account used for calendars only has no mail password to type. A non-secret
 * field is the owner's, shown when it has a value, and the person's only
 * where `PERSON_MAY_FILL` says so and the owner left it empty.
 */

import { credentialFieldsFor } from './credential-fields.ts';
import type { PasswordKind } from './password-grant-kinds.ts';
import { signsInToMailApart } from './provider-accounts.ts';

/** A field of a password card: the person's to fill, or the owner's to show (0174 §4.1, §5.2). */
export interface PersonField {
  readonly key: string;
  readonly who: 'person' | 'owner';
  readonly labelKey: string;
  readonly hintKey?: string;
  readonly placeholder?: string;
  readonly secret: boolean;
  readonly autoComplete?: 'username' | 'new-password' | 'off';
  readonly revealable?: boolean;
  /** An owner's field only: the value as the owner saved it. */
  readonly value?: string;
}

/**
 * The non-secret fields the person fills when the owner left them empty
 * (0174 §5.2, D2): Infomaniak's sync username, which only the account holder
 * can read at config.infomaniak.com. Every other non-secret field is the
 * owner's.
 */
export const PERSON_MAY_FILL: Readonly<Partial<Record<PasswordKind, ReadonlyArray<string>>>> = {
  infomaniak: ['username'],
};

/** A stored config value as the card shows it, or '' when there is none. */
function shown(stored: Readonly<Record<string, unknown>>, key: string): string {
  const v = stored[key];
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** The card's fields for one kind in one role, from the field table (the rule above). */
export function personFieldsFor(
  role: 'source' | 'target',
  kind: PasswordKind,
  stored: Readonly<Record<string, unknown>>,
): ReadonlyArray<PersonField> {
  const mail = shown(stored, 'mailHost') !== '';
  const out: PersonField[] = [];
  for (const f of credentialFieldsFor(role, kind)) {
    if (f.loginPairedWith !== undefined && signsInToMailApart(kind) && !mail) continue;
    const common = {
      key: f.key,
      labelKey: f.labelKey,
      ...(f.hintKey === undefined ? {} : { hintKey: f.hintKey }),
      ...(f.placeholder === undefined ? {} : { placeholder: f.placeholder }),
      ...(f.autoComplete === undefined ? {} : { autoComplete: f.autoComplete }),
      ...(f.revealable === undefined ? {} : { revealable: f.revealable }),
    };
    if (f.secret === true) {
      out.push({ ...common, who: 'person', secret: true });
      continue;
    }
    const value = shown(stored, f.key);
    if (value !== '') out.push({ ...common, who: 'owner', secret: false, value });
    else if (PERSON_MAY_FILL[kind]?.includes(f.key) === true) out.push({ ...common, who: 'person', secret: false });
  }
  return out;
}

/**
 * The non-secret fields a person's page lets them fill when the owner leaves
 * them empty: what the *Save for {person}* form and the create door's
 * `forPerson` both accept empty. Empty for a kind that is no password kind.
 */
export function personFillableKeys(role: 'source' | 'target', kind: PasswordKind): ReadonlySet<string> {
  return new Set(
    personFieldsFor(role, kind, {})
      .filter((f) => f.who === 'person' && !f.secret)
      .map((f) => f.key),
  );
}
