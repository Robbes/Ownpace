// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE PERMISSION A GRANT LINK ASKS FOR, IN WORDS (the owner, 2026-10-14).
 *
 * The grant page showed the scope string Google records, and only that:
 * `https://mail.google.com/ openid https://www.googleapis.com/auth/userinfo.email`,
 * in monospace, under *Google will record this permission as:*. A tester reads
 * three addresses. ADR-0041 (*Decision* 4) asks for the scopes shown AS
 * scopes, not a paraphrase like *connect your account*, and its own example is
 * a sentence per scope: *"Ownpace wants to read your contacts"*. So each scope
 * the link asks for is said here as what the permission allows, the way
 * Google's own screen describes it a click later (*read, send and permanently
 * delete*), and the page keeps the exact string in a closed *Technical
 * details* fold, where it can still be compared with the account afterwards.
 *
 * What the permission ALLOWS, not what Ownpace does: Ownpace only reads, and
 * the box above says so (`grant.readsOnly`, `grant.readOnly`). The glossary
 * keeps the two apart (*only reads* / *read-only*).
 *
 * A scope this table has no words for is never dropped: it is said as
 * *another permission*, pointing at the fold that names it (hard rule 9). The
 * scopes come from `GOOGLE_DOMAIN_SCOPES` in orchestration (asked, and the
 * broader ones also accepted) and `SIGNED_IN_ACCOUNT_SCOPES` in the API;
 * `calendar.readonly` is here ahead of the calendar asking for it.
 */

import type { StringKey } from './strings.ts';

const SCOPE_WORDS: ReadonlyMap<string, StringKey> = new Map<string, StringKey>(Object.entries({
  'https://mail.google.com/': 'grant.scope.mail',
  'https://www.googleapis.com/auth/calendar': 'grant.scope.calendar',
  'https://www.googleapis.com/auth/calendar.readonly': 'grant.scope.calendarReadOnly',
  'https://www.googleapis.com/auth/carddav': 'grant.scope.contacts',
  'https://www.googleapis.com/auth/drive': 'grant.scope.drive',
  'https://www.googleapis.com/auth/drive.readonly': 'grant.scope.driveReadOnly',
  'https://www.googleapis.com/auth/tasks': 'grant.scope.tasks',
  'https://www.googleapis.com/auth/tasks.readonly': 'grant.scope.tasksReadOnly',
  // Who signed in, which the link checks against the account it names.
  openid: 'grant.scope.account',
  email: 'grant.scope.account',
  'https://www.googleapis.com/auth/userinfo.email': 'grant.scope.account',
} satisfies Record<string, StringKey>));

/**
 * The dictionary keys that say a space-separated scope string, in the order
 * the scopes come, each once. A scope with no words adds
 * `grant.scope.other`, once.
 */
export function scopeWordKeys(scope: string): StringKey[] {
  const keys: StringKey[] = [];
  for (const one of scope.split(/\s+/).filter((s) => s !== '')) {
    const key = SCOPE_WORDS.get(one) ?? 'grant.scope.other';
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}
