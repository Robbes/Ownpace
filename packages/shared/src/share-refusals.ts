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
  /**
   * Set when the server sent a `Retry-After` that `retryAfterSecondsOf` did
   * not read as a wait: no form RFC 9110 names, or more than a day. It asked
   * for a wait all the same, so the sentence says *later*, and neither a
   * number nobody can trust nor Nextcloud's ten minutes (`pressAgain`).
   */
  readonly retryAfterNotBelieved?: true;
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
 * The longest wait a `Retry-After` is believed for: one day. A limit on new
 * shares counts minutes; a longer wait is a header gone wrong, and a sentence
 * saying "in about 277777778 hours" helps nobody.
 */
const RETRY_AFTER_MAX_SECONDS = 24 * 60 * 60;

const MONTHS: readonly string[] = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const MONTH = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const TIME = '(\\d{2}):(\\d{2}):(\\d{2})';
/** `Sun, 06 Nov 1994 08:49:37 GMT`: IMF-fixdate, the form a sender uses. */
const IMF_FIXDATE = new RegExp(`^${DAY}, (\\d{2}) ${MONTH} (\\d{4}) ${TIME} GMT$`, 'i');
/** `Sunday, 06-Nov-94 08:49:37 GMT`: RFC 850's form, obsolete, with a two-digit year. */
const RFC850_DATE = new RegExp(
  `^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\\d{2})-${MONTH}-(\\d{2}) ${TIME} GMT$`,
  'i',
);
/** `Sun Nov  6 08:49:37 1994`: C's asctime form, obsolete, which names no zone and means GMT. */
const ASCTIME_DATE = new RegExp(`^${DAY} ${MONTH} ( \\d|\\d{2}) ${TIME} (\\d{4})$`, 'i');

/**
 * The moment an HTTP date names (RFC 9110 §5.6.7), in milliseconds, or
 * undefined when the value is not one of its three forms or names no real
 * moment. Read by hand, never by `Date.parse`: that takes `May 5` or `soon 1`
 * for a date in 2001, and reads the zoneless asctime form in the process's
 * own time zone, where RFC 9110 says GMT.
 */
function httpDateOf(value: string, now: Date): number | undefined {
  const imf = IMF_FIXDATE.exec(value);
  const rfc850 = RFC850_DATE.exec(value);
  const asctime = ASCTIME_DATE.exec(value);
  // Day, month, year, hour, minute and second, wherever each form writes them.
  const parts = imf
    ? imf.slice(1, 7)
    : rfc850
      ? rfc850.slice(1, 7)
      : asctime
        ? [asctime[2], asctime[1], asctime[6], asctime[3], asctime[4], asctime[5]]
        : undefined;
  if (parts === undefined) return undefined;
  const [day, month, written, hour, minute, second] = parts as [string, string, string, string, string, string];
  let year = Number(written);
  if (rfc850) {
    // A two-digit year more than 50 years ahead is the most recent past year
    // with those digits (RFC 9110 §5.6.7).
    const thisYear = now.getUTCFullYear();
    year += Math.floor(thisYear / 100) * 100;
    if (year > thisYear + 50) year -= 100;
  }
  const named = [year, MONTHS.indexOf(month.toLowerCase()), Number(day), Number(hour), Number(minute), Number(second)] as const;
  const at = new Date(Date.UTC(...named));
  // A day or a time that does not exist (31 Feb, 25:00) rolls over in
  // `Date.UTC`: it names no moment, so it is no date.
  const read = [at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds()];
  return read.every((n, i) => n === named[i]) ? at.getTime() : undefined;
}

/**
 * The seconds a `Retry-After` asks for (RFC 9110 §10.2.3): a whole number of
 * seconds, or an HTTP date in one of its three forms (`httpDateOf`), counted
 * from `now`. Undefined when there is no header, it is neither, or it asks
 * for more than `RETRY_AFTER_MAX_SECONDS`, so a sentence never claims a wait
 * nobody asked for, or one nobody meant. A header that was sent and comes to
 * undefined here is said as *later* (`OcsAnswer.retryAfterNotBelieved`).
 */
export function retryAfterSecondsOf(header: string | undefined, now: Date = new Date()): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  const believed = (seconds: number): number | undefined =>
    Number.isSafeInteger(seconds) && seconds <= RETRY_AFTER_MAX_SECONDS ? seconds : undefined;
  if (/^\d+$/.test(value)) return believed(Number(value));
  const at = httpDateOf(value, now);
  if (at === undefined) return undefined;
  return believed(Math.max(0, Math.ceil((at - now.getTime()) / 1000)));
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
 * in minutes; *later* when it asked in a way that is not believed
 * (`retryAfterNotBelieved`), or answered without OCS and asked nothing, as a
 * proxy does; and Nextcloud's own ten minutes only when Nextcloud answered and
 * asked nothing, which is what stock Nextcloud does.
 */
function pressAgain(a: OcsAnswer): Bilingual {
  const retryAfterSeconds = a.retryAfterSeconds;
  if (retryAfterSeconds === undefined && a.retryAfterNotBelieved) {
    return {
      en: 'apply again later, as the new system asked.',
      nl: 'u kunt het later opnieuw toepassen, zoals het nieuwe systeem vroeg.',
    };
  }
  if (retryAfterSeconds === undefined && !a.ocs) {
    return {
      en: 'apply again later; the new system did not say when.',
      nl: 'u kunt het later opnieuw toepassen; het nieuwe systeem zei niet wanneer.',
    };
  }
  if (retryAfterSeconds === undefined) {
    return {
      en:
        'apply again in ten minutes. Nextcloud counts every share an account asked for in the last ten ' +
        'minutes, those that failed included, unless whoever runs it chose another period.',
      nl:
        'u kunt het over tien minuten opnieuw toepassen. Nextcloud telt elk deelrecht dat een account in de ' +
        'laatste tien minuten aanvroeg, ook de mislukte, tenzij de beheerder een andere periode koos.',
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
      'this migration uses there has reached that limit ({status}). This share was not refused, nothing ' +
      'more was shared, and the row stays open: {when}',
    nl:
      'Het nieuwe systeem beperkt hoeveel deelrechten één account in korte tijd mag aanmaken, en het ' +
      'account dat deze migratie daar gebruikt, heeft die limiet bereikt ({status}). Dit deelrecht is niet ' +
      'geweigerd, er is verder niets gedeeld, en de regel blijft open: {when}',
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
  const when = pressAgain(answer);
  return {
    en: sentence.en.replace('{status}', status).replace('{when}', when.en),
    nl: sentence.nl.replace('{status}', status).replace('{when}', when.nl),
  };
}

/**
 * The kinds of refusal that spent nothing of the target's limit on new
 * shares: nothing answered, or nothing was asked, or the sign-in was refused
 * before the share was reached. A refusal of any other kind was a share call
 * the target answered, and counted.
 */
const SPENT_NOTHING: ReadonlySet<ShareRefusalKind> = new Set<ShareRefusalKind>([
  'signIn',
  'unreachable',
  'certificate',
  'insideOurNetwork',
  'noOrigin',
  'unknown',
]);

/**
 * Whether a share refused as `kind` counted toward the target's limit on new
 * shares. A refusal of no kind is one the edition made before asking the
 * target anything (a row with nobody to share with), and counted nothing.
 */
export function spentTheLimit(kind: ShareRefusalKind | undefined): boolean {
  return kind !== undefined && !SPENT_NOTHING.has(kind);
}

/** What a press was refused before it met the target's limit (`limitAfterRefusals`). */
export interface RefusedBeforeTheLimit {
  /** Rows the target refused, each a share call it counted (`spentTheLimit`). */
  readonly refused: number;
  /** Whether it refused this migration's sign-in on any row. */
  readonly signIn: boolean;
}

/**
 * WHAT A PRESS ADDS TO THE LIMIT'S SENTENCE (workplan 0104 T5, after review).
 *
 * A refused row stays open and unchanged, and a press tries the open rows in
 * the same order every time, so the rows refused before the limit are asked
 * for again before the rows that waited, and Nextcloud counts every attempt,
 * failed ones included. Fifteen outsiders, the first ten refused: those ten
 * spend the twenty calls on every press, and the last five are never tried.
 * So when a press met the limit after refusals, its sentence says to settle
 * the refused rows first.
 *
 * A refused sign-in is said apart: Nextcloud answers 429 for up to half an
 * hour after more than ten failed sign-ins from one address
 * (`OC\Security\Bruteforce\Throttler`, before it reads the password), so the
 * limit may be that, and a corrected password does not lift it at once.
 *
 * Undefined when the press was refused nothing before the limit.
 */
export function limitAfterRefusals(before: RefusedBeforeTheLimit): Bilingual | undefined {
  const said: Bilingual[] = [];
  if (before.refused === 1) {
    said.push({
      en:
        'Before the limit, the new system refused 1 share this press asked for, and that attempt counts ' +
        'toward the same limit. A press asks for it again before the rows that wait, so correct that row, ' +
        'skip it or mark it done before applying again, or it spends part of the limit again.',
      nl:
        'Vóór de limiet weigerde het nieuwe systeem 1 deelrecht waar deze actie om vroeg, en die poging telt ' +
        'mee voor dezelfde limiet. Opnieuw toepassen vraagt het eerst weer aan, vóór de regels die wachten: ' +
        'pas die regel dus eerst aan, sla hem over of vink hem af, anders gaat er opnieuw een deel van de ' +
        'limiet aan op.',
    });
  } else if (before.refused > 1) {
    said.push({
      en:
        `Before the limit, the new system refused ${before.refused} shares this press asked for, and those ` +
        'attempts count toward the same limit. A press asks for them again before the rows that wait, so ' +
        'correct those rows, skip them or mark them done before applying again, or they spend the limit again.',
      nl:
        `Vóór de limiet weigerde het nieuwe systeem ${before.refused} deelrechten waar deze actie om vroeg, en ` +
        'die pogingen tellen mee voor dezelfde limiet. Opnieuw toepassen vraagt ze eerst weer aan, vóór de ' +
        'regels die wachten: pas die regels dus eerst aan, sla ze over of vink ze af, anders gaat de limiet ' +
        'er opnieuw aan op.',
    });
  }
  if (before.signIn) {
    said.push({
      en:
        'During this press the new system also refused the sign-in this migration uses for it, and after ' +
        'too many failed sign-ins Nextcloud answers this way for up to half an hour: check the password of ' +
        'the destination account on the Accounts page first, and allow that half hour before applying again.',
      nl:
        'Tijdens deze actie weigerde het nieuwe systeem ook de aanmelding van deze migratie, en na te veel ' +
        'mislukte aanmeldingen antwoordt Nextcloud tot een half uur lang zo: controleer eerst het wachtwoord ' +
        'van het doelaccount op de pagina Accounts, en wacht dat half uur af voordat u het opnieuw toepast.',
    });
  }
  if (said.length === 0) return undefined;
  return { en: said.map((s) => s.en).join(' '), nl: said.map((s) => s.nl).join(' ') };
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
