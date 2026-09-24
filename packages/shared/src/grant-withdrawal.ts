// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANT TAKEN BACK (workplan 0108 T8 (c); the owner, 2026-09-23: *"C: yes,
 * after B. Also: if we cannot revoke at the sources, we do revoke/remove in our
 * system and tell the person that revokes."*).
 *
 * The person who granted a migration access through a link can take it back
 * from their progress page. The token is revoked at Google where Google will,
 * and deleted here whatever Google answers; the person is told which of the
 * two happened.
 *
 * What is written down here is what both sides of that are told, and the one
 * refusal every reader of the source meets afterwards: while a mapping's grant
 * is withdrawn, nothing reads the account, on that token or on any other
 * credential the connection holds. The person said no to being read; a pass
 * that fell back to the organisation's own credential would read them anyway,
 * and nobody would notice.
 */

import type { BilingualRefusal } from './credential-refusals.ts';

/**
 * What Google said when it was asked to revoke the token.
 *
 * `revoked` includes a token Google reports was already invalid: the state is
 * what matters (it does not work), and sending somebody to remove an access
 * that is not there wastes the one thing they came to do.
 */
export type WithdrawalAtGoogle = 'revoked' | 'not_confirmed';

/** The progress page's answer to a withdrawal. */
export interface GrantWithdrawal {
  /** When it was withdrawn here, which is also when nothing reads the account any more. */
  readonly withdrawnAt: string;
  readonly atGoogle: WithdrawalAtGoogle;
}

/** The day a withdrawal is named by: its UTC date, which reads the same in both languages. */
function day(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Why nothing reads a migration's source: the person took the grant back.
 *
 * Written for the OWNER, who is the one who can act on it: the pass's run
 * log, a preflight, and the refusals of Start and Sync now all say this. The
 * person being migrated reads their own sentence on the progress page.
 */
export function grantWithdrawnRefusal(at: Date): BilingualRefusal {
  return {
    code: 'grant_withdrawn',
    fields: [],
    en:
      `The person being migrated withdrew their permission on ${day(at)}, so nothing reads ` +
      'their account. Send them a new grant link if they agree to continue.',
    nl:
      `Degene die gemigreerd wordt heeft op ${day(at)} de toegang ingetrokken, dus er wordt ` +
      'niets meer uit het account gelezen. Stuur een nieuwe toegangslink als die persoon ' +
      'akkoord is om verder te gaan.',
  };
}
