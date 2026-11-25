// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT THE PERSON FILLS, ONE RULE FOR THE PAGE, THE DOOR AND THE FORM
 * (workplan 0174 §5.2, D2). Infomaniak's sync user name is the person's when
 * the owner left it empty, and no other non-secret field of any password kind
 * is; a secret is always the person's.
 */
import { describe, it, expect } from 'vitest';
import { PASSWORD_SOURCE_KINDS, PASSWORD_TARGET_KINDS } from './password-grant-kinds.ts';
import { personFieldsFor, personFillableKeys } from './person-fields.ts';

describe('personFillableKeys', () => {
  it('is Infomaniak’s sync user name, and nothing else, in either role', () => {
    expect([...personFillableKeys('target', 'infomaniak')]).toEqual(['username']);
    for (const kind of PASSWORD_SOURCE_KINDS) expect([...personFillableKeys('source', kind)], kind).toEqual([]);
    for (const kind of PASSWORD_TARGET_KINDS) {
      if (kind !== 'infomaniak') expect([...personFillableKeys('target', kind)], kind).toEqual([]);
    }
  });
});

describe('personFieldsFor', () => {
  it('gives the owner the sync user name when the owner filled it', () => {
    const fields = personFieldsFor('target', 'infomaniak', { username: 'AB12345', host: 'sync.infomaniak.com' });
    expect(fields.find((f) => f.key === 'username')).toMatchObject({ who: 'owner', value: 'AB12345' });
    expect(fields.filter((f) => f.secret).every((f) => f.who === 'person' && f.value === undefined)).toBe(true);
  });
});
