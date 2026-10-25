// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SHARE THE NEW SYSTEM REFUSED, SAID IN OUR WORDS (workplan 0136 T3, a
 * share's refusal on apply).
 *
 * Applying a share asks the target's OCS endpoint to create it
 * (`createNextcloudShare`, `@openmig/connectors`). When it refuses, the refusal
 * used to be the answer: OCS's own message (*"User does not exist"*), or the
 * first 300 characters of the body when OCS sent none. The address is one a
 * tester typed, so the Sharing page's Apply could read aloud whatever answered
 * there, as the Test button could before T3.
 *
 * So the connector carries the refusal's PARTS beside its message, as T3's
 * first step did for a Test (`remote-refusal.ts`): the HTTP status, OCS's own
 * code (`meta.statuscode`, the one fact in the reply that does not depend on
 * the server's language), whether the body was an OCS answer at all, or what
 * kind of failure it was when nothing answered. Never the server's words. The
 * managed API answers from the parts with a sentence of ours, chosen here by
 * what failed, and logs the message whole under the reference its answer ends
 * with (`apps/api/src/share-refusal-answer.ts`). The appliance keeps the
 * message: its only user is its owner.
 *
 * OCS's message is not kept even where it is the sentence a person acts on.
 * OCS is not one of the error documents §3 lists, and a server that is not
 * Nextcloud can put anything in the same field. The code says the same thing
 * in a form nobody can fill with a page.
 *
 * THE DUTCH LIVES BESIDE ITS ENGLISH, in this file, updated together or
 * neither (`docs/i18n-prose-boundary.md`, class 4). On the wire a pair travels
 * as `reason` and `reasonNl`, and the Sharing page shows the half in its
 * reader's language. The Dutch says *u*, and *migratie* for a migration.
 */

import type { Bilingual } from './link-holder-refusals.ts';

/** What one OCS reply came to: its status, OCS's code, and whether it was OCS at all. */
export interface OcsAnswer {
  /** The HTTP status. */
  readonly status: number;
  /** OCS's `meta.statuscode`, when the reply carried one of three digits. */
  readonly ocsStatus?: number;
  /** Whether the body was an OCS reply; a page from anything else is not. */
  readonly ocs: boolean;
  /**
   * How long the server asked us to wait, in seconds, when it sent a
   * `Retry-After` we could read (`retryAfterSecondsOf`). A number of ours,
   * not the server's words. Stock Nextcloud sends none with its 429.
   */
  readonly retryAfterSeconds?: number;
}

/**
 * A share's refusal, in parts:
 *
 * - `answered`: the server answered, and refused;
 * - `notAnAccount`: the server knows no account by that address (OCS 404 on a
 *   user share), and the share by mail it was then asked for was refused as
 *   `byMail` says;
 * - `unreachable`, `certificate`, `insideOurNetwork`, `unknown`: nothing
 *   usable answered, as `whatHappened` sorts a failure (`remote-refusal.ts`);
 * - `noOrigin`: the address this migration stores cannot be read.
 */
export type ShareRefused =
  | ({ readonly kind: 'answered' } & OcsAnswer)
  | { readonly kind: 'notAnAccount'; readonly byMail: OcsAnswer }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'certificate' }
  | { readonly kind: 'insideOurNetwork' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'noOrigin' };

/**
 * THE TARGET'S LIMIT ON NEW SHARES (workplan 0104, Status of 2026-10-25).
 *
 * Nextcloud 31 to 35 let one account create 20 shares in 10 minutes
 * (`ShareAPIController::createShare`, `#[UserRateLimit(limit: 20, period:
 * 600)]`; 36 raises it to 60), failed attempts included, and answer the next
 * one 429 with an empty OCS reply and no `Retry-After`. Each attempt ages out
 * ten minutes after it was made, and a 429 is not counted. A press asks for
 * a user share first and by mail only after a 404, so an outsider's row costs
 * two, and a one-go press over more than about ten of them meets the limit.
 *
 * A 429 is not a refusal of the share: the same request succeeds once the
 * window has passed. So it gets its own sentence, which says when to apply
 * again, and the presses stop at the first one (`applyAllOpenShareGrants`,
 * `@openmig/core`) and leave the rows after it open and untried.
 *
 * `retryAfterSeconds` is what the server asked, when it said.
 */
export interface ShareLimit {
  readonly retryAfterSeconds?: number;
}

/**
 * The seconds a `Retry-After` asks for (RFC 9110 §10.2.3): a whole number of
 * seconds, or an HTTP date counted from `now`. Undefined when there is no
 * header or it is neither, so a sentence never claims a wait nobody asked for.
 */
export function retryAfterSecondsOf(header: string | undefined, now: Date = new Date()): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  // Every form of an HTTP date names its month and its zone in letters. A
  // bare number of another shape (`-5`, `1.5`) is no date, though `Date.parse`
  // reads one as a year.
  if (!/[a-z]/i.test(value)) return undefined;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

/** Whether one reply is the target's limit: a 429, as a status or as OCS's code. */
function isLimit(a: OcsAnswer): boolean {
  return a.status === 429 || (a.ocs && a.ocsStatus === 429);
}

/**
 * The limit a refusal met, or undefined when it is a refusal of another kind.
 * The share by mail after "no such account" meets the same limit, and is the
 * second of the two calls an outsider's row costs.
 */
export function shareLimitOf(said: ShareRefused): ShareLimit | undefined {
  const answer = said.kind === 'answered' ? said : said.kind === 'notAnAccount' ? said.byMail : undefined;
  if (answer === undefined || !isLimit(answer)) return undefined;
  return answer.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: answer.retryAfterSeconds };
}

/**
 * When to apply again, as the limit's sentence ends: what the server asked,
 * in minutes, or Nextcloud's own ten minutes when it asked nothing.
 */
function pressAgain(retryAfterSeconds: number | undefined): Bilingual {
  if (retryAfterSeconds === undefined) {
    return {
      en:
        'apply again in ten minutes. Nextcloud counts the shares an account created in the last ten ' +
        'minutes, unless whoever runs it chose another period.',
      nl:
        'u kunt het over tien minuten opnieuw toepassen. Nextcloud telt de deelrechten die een account ' +
        'in de laatste tien minuten aanmaakte, tenzij de beheerder een andere periode koos.',
    };
  }
  if (retryAfterSeconds <= 60) {
    return {
      en: 'apply again in a minute, as the new system asked.',
      nl: 'u kunt het over een minuut opnieuw toepassen, zoals het nieuwe systeem vroeg.',
    };
  }
  const minutes = Math.ceil(retryAfterSeconds / 60);
  if (minutes < 120) {
    return {
      en: `apply again in about ${minutes} minutes, as the new system asked.`,
      nl: `u kunt het over ongeveer ${minutes} minuten opnieuw toepassen, zoals het nieuwe systeem vroeg.`,
    };
  }
  const hours = Math.ceil(minutes / 60);
  return {
    en: `apply again in about ${hours} hours, as the new system asked.`,
    nl: `u kunt het over ongeveer ${hours} uur opnieuw toepassen, zoals het nieuwe systeem vroeg.`,
  };
}

/** The status as a sentence says it, with OCS's code where it differs. */
function statusOf(a: OcsAnswer): string {
  return a.ocs && a.ocsStatus !== undefined && a.ocsStatus !== a.status
    ? `status ${a.status}, OCS ${a.ocsStatus}`
    : `status ${a.status}`;
}

/**
 * Every sentence, in both languages. `{status}` is the status as `statusOf`
 * says it, the only part of a reply a sentence repeats.
 */
export const SHARE_REFUSAL = {
  signIn: {
    en:
      'The new system did not accept the sign-in this migration uses for it ({status}), so nothing ' +
      'was shared. Check the password of the destination account on the Accounts page, then apply again.',
    nl:
      'Het nieuwe systeem accepteerde de aanmelding van deze migratie niet ({status}), dus er is niets ' +
      'gedeeld. Controleer het wachtwoord van het doelaccount op de pagina Accounts en pas het daarna opnieuw toe.',
  },
  serverError: {
    en: 'The new system had an error of its own ({status}), so nothing was shared. Apply again later.',
    nl: 'Het nieuwe systeem had zelf een fout ({status}), dus er is niets gedeeld. Pas het later opnieuw toe.',
  },
  notNextcloud: {
    en:
      "The new system answered ({status}), but not as Nextcloud's sharing does, so nothing was shared. " +
      'Sharing from here works with a Nextcloud destination only: share this item by hand there, then ' +
      'mark the row done.',
    nl:
      'Het nieuwe systeem antwoordde ({status}), maar niet zoals Nextcloud bij delen antwoordt, dus er is ' +
      'niets gedeeld. Delen vanaf hier werkt alleen met Nextcloud als bestemming: deel dit item daar zelf ' +
      'en vink de regel daarna af.',
  },
  notFound: {
    en:
      'The new system could not find this item, or anybody with that address to share it with ' +
      '({status}), so nothing was shared. Check that the item is on the new system and that the address is right, ' +
      'then apply again.',
    nl:
      'Het nieuwe systeem vond dit item niet, of niemand met dat adres om het mee te delen ({status}), dus ' +
      'er is niets gedeeld. Controleer of het item op het nieuwe systeem staat en of het adres klopt, en ' +
      'pas het daarna opnieuw toe.',
  },
  noAccountNoMail: {
    en:
      'The new system has no account with that address, and refused to share this item by mail ' +
      '({status}), so nothing was shared. Correct the address, or ask whoever runs the new system to ' +
      'allow sharing by mail.',
    nl:
      'Het nieuwe systeem heeft geen account met dat adres en weigerde dit item per mail te delen ' +
      '({status}), dus er is niets gedeeld. Pas het adres aan, of vraag de beheerder van het nieuwe ' +
      'systeem om delen per mail toe te staan.',
  },
  forbidden: {
    en:
      'The new system refused this share ({status}): it may be shared there already, or the destination ' +
      'account may not share this item. Check the item on the new system; if it is shared already, mark ' +
      'the row done.',
    nl:
      'Het nieuwe systeem weigerde dit delen ({status}): het is daar misschien al gedeeld, of het doelaccount ' +
      'mag dit item niet delen. Controleer het item op het nieuwe systeem; is het al gedeeld, vink de regel ' +
      'dan af.',
  },
  badRequest: {
    en:
      'The new system did not accept this share as it was asked ({status}), so nothing was shared. ' +
      'Share the item by hand on the new system, then mark the row done.',
    nl:
      'Het nieuwe systeem accepteerde dit verzoek om te delen niet ({status}), dus er is niets gedeeld. ' +
      'Deel het item zelf op het nieuwe systeem en vink de regel daarna af.',
  },
  limited: {
    en:
      'The new system limits how many shares one account may create in a short time, and the account ' +
      'this migration uses there has reached that limit ({status}). Nothing was refused and nothing more ' +
      'was shared, and the row stays open: {when}',
    nl:
      'Het nieuwe systeem beperkt hoeveel deelrechten één account in korte tijd mag aanmaken, en het ' +
      'account dat deze migratie daar gebruikt, heeft die grens bereikt ({status}). Er is niets geweigerd ' +
      'en verder niets gedeeld, en de regel blijft open: {when}',
  },
  other: {
    en:
      'The new system refused this share ({status}), and what it said is not shown here. Nothing was ' +
      'shared, and the row stays open.',
    nl:
      'Het nieuwe systeem weigerde dit delen ({status}); wat het zei, wordt hier niet getoond. Er is niets ' +
      'gedeeld, en de regel blijft open.',
  },
  unreachable: {
    en:
      "Nothing answered at the new system's address, so nothing was shared: the name did not resolve, the " +
      "connection was refused, or a timeout. Apply again later, or check the destination's address on the " +
      'Accounts page.',
    nl:
      'Op het adres van het nieuwe systeem antwoordde niets, dus er is niets gedeeld: de naam werd niet ' +
      'gevonden, de verbinding werd geweigerd, of er kwam een timeout. Pas het later opnieuw toe, of ' +
      'controleer het adres van de bestemming op de pagina Accounts.',
  },
  certificate: {
    en: "The new system's certificate did not verify for its name, or has expired, so nothing was shared.",
    nl: 'Het certificaat van het nieuwe systeem kwam niet overeen met de naam of is verlopen, dus er is niets gedeeld.',
  },
  insideOurNetwork: {
    en:
      "The new system's address is inside this service's own network, or the server sent the request on " +
      'to one that is, so we did not connect to it and nothing was shared. Give the address the server has ' +
      'on the internet, on the Accounts page.',
    nl:
      'Het adres van het nieuwe systeem ligt binnen het eigen netwerk van deze dienst, of de server stuurde ' +
      'het verzoek door naar een adres dat daar ligt: er is geen verbinding gemaakt en niets gedeeld. ' +
      'Gebruik op de pagina Accounts het adres dat de server op internet heeft.',
  },
  noOrigin: {
    en:
      "The new system's address, as this migration stores it, cannot be read, so nothing was shared. " +
      "Check the destination's address on the Accounts page.",
    nl:
      'Het adres van het nieuwe systeem, zoals deze migratie het bewaart, is niet te lezen, dus er is niets ' +
      'gedeeld. Controleer het adres van de bestemming op de pagina Accounts.',
  },
  unknown: {
    en:
      'Sharing on the new system failed, and what came back is not shown here. Nothing was shared, and ' +
      'the row stays open.',
    nl:
      'Delen op het nieuwe systeem is mislukt; wat er terugkwam, wordt hier niet getoond. Er is niets ' +
      'gedeeld, en de regel blijft open.',
  },
} as const satisfies Record<string, Bilingual>;

export type ShareRefusalKind = keyof typeof SHARE_REFUSAL;

/**
 * The sentence one reply gets, by what failed. A sign-in first, since a
 * proxy in front of the server answers 401 without OCS; then the server's own
 * error, a gateway's page among them; then a reply that is not OCS at all;
 * then OCS's code, or the status when OCS gave none.
 */
function answeredKind(a: OcsAnswer): ShareRefusalKind {
  // The target's limit first, whoever answered it: a proxy in front of the
  // server limiting requests asks the same of us (`ShareLimit`).
  if (isLimit(a)) return 'limited';
  if (a.status === 401 || a.ocsStatus === 997) return 'signIn';
  if (a.status >= 500 || a.ocsStatus === 996) return 'serverError';
  if (!a.ocs) return 'notNextcloud';
  const code = a.ocsStatus ?? a.status;
  if (code === 404) return 'notFound';
  if (code === 403) return 'forbidden';
  if (code === 400) return 'badRequest';
  return 'other';
}

/** Which sentence a refusal gets. */
export function shareRefusalKind(said: ShareRefused): ShareRefusalKind {
  switch (said.kind) {
    case 'answered':
      return answeredKind(said);
    case 'notAnAccount': {
      // Nothing found by mail either says what a 404 says: the item, or the
      // person. A sign-in, an error of the server's own or its limit is said
      // as such: the share by mail was not refused, it was not made.
      const byMail = answeredKind(said.byMail);
      return byMail === 'notFound' || byMail === 'signIn' || byMail === 'serverError' || byMail === 'limited'
        ? byMail
        : 'noAccountNoMail';
    }
    default:
      return said.kind;
  }
}

/** The sentence a refusal gets, in both languages: ours, never the server's. */
export function shareRefusalSaid(said: ShareRefused): Bilingual {
  const sentence = SHARE_REFUSAL[shareRefusalKind(said)];
  const answer = said.kind === 'answered' ? said : said.kind === 'notAnAccount' ? said.byMail : undefined;
  if (answer === undefined) return sentence;
  const status = statusOf(answer);
  const when = pressAgain(answer.retryAfterSeconds);
  return {
    en: sentence.en.replace('{status}', status).replace('{when}', when.en),
    nl: sentence.nl.replace('{status}', status).replace('{when}', when.nl),
  };
}

/**
 * A row that names nobody to share with: a link or a domain share. Ours, and
 * said before anything is asked of the server.
 */
export const NO_GRANTEE_TO_SHARE_WITH: Bilingual = {
  en:
    'This grant names no grantee address (a link or domain share) — there is nobody to share with. ' +
    'Handle it by hand and mark the row done.',
  nl:
    'Dit recht noemt geen adres om mee te delen (een link of een domein): er is niemand om mee te delen. ' +
    'Regel het zelf en vink de regel daarna af.',
};
