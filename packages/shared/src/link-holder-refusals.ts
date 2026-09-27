// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What the server says to somebody holding a link, in both languages
 * (workplan 0145 T6).
 *
 * A grant link and a progress link are read by somebody with no account: a
 * family member or a colleague a tester asked for access. Their page is
 * rendered from the dictionary, in the language they chose, and every refusal
 * on it came from the server, in English only. A Dutch reader met *"This link
 * cannot be used"* under *"Verbind uw account"*, and the page that follows
 * Google's consent was English from top to bottom.
 *
 * This is the class-4 pattern from `docs/i18n-prose-boundary.md`, the one
 * `credential-refusals.ts` follows: **the Dutch lives beside its English, in
 * this file, updated together or neither.** The web dictionary cannot hold
 * these, because the server writes them; the JSON answers carry both halves
 * (`reason` and `reasonNl`, or `message` and `messageNl`), and the page shows
 * the one in its language. The endings the API renders read the half the
 * authorize call asked for.
 *
 * ## The frame is translated, the finding is not
 *
 * What Google said (`access_denied`), an address somebody signed in with, and
 * the operator's own sentence that a sign-in wrapper forwards are findings:
 * they arrive verbatim inside both halves. The rest is ours, and is written
 * for a reader who cannot fix anything, so each sentence says what is wrong
 * and, where somebody else has to act, whom to tell.
 *
 * `a-refusal-the-link-holder-can-read.unit.test.ts` finds every pair this file
 * exports and holds both halves to being there, being different, and the
 * Dutch one being Dutch. The owner reads the Dutch before it ships (0144 D1).
 */

import type { RefusalLocale } from './credential-refusals.ts';

/** One sentence, in both languages. */
export interface Bilingual {
  readonly en: string;
  readonly nl: string;
}

/** The half a reader asked for. */
export function inLocale(text: Bilingual, locale: RefusalLocale): string {
  return locale === 'nl' ? text.nl : text.en;
}

/**
 * The language a request named: Dutch only when it says exactly `nl`.
 * Anything else, or nothing, is English, the language every sentence here
 * was first written in.
 */
export function localeOf(raw: unknown): RefusalLocale {
  return raw === 'nl' ? 'nl' : 'en';
}

/** A pair as a JSON answer carries it: `reason` as before, and `reasonNl` beside it. */
export function reasonPair(text: Bilingual): { readonly reason: string; readonly reasonNl: string } {
  return { reason: text.en, reasonNl: text.nl };
}

/** Said at the end of every sentence whose remedy is somebody else's. */
const TELL = {
  en: 'please tell the person who sent you the link.',
  nl: 'laat het de persoon weten die u de link stuurde.',
} as const;

// ---------------------------------------------------------------------------
// The link itself
// ---------------------------------------------------------------------------

/**
 * The ONE sentence for a link that is unknown, forged, expired, revoked or
 * already used (`@openmig/ledger`'s `MAPPING_LINK_REFUSAL` is its English
 * half). It names the remedy that is true in every one of those cases, and
 * never the cause: telling them apart would tell a forger which part failed.
 */
export const LINK_REFUSAL: Bilingual = {
  en:
    'This link cannot be used. It may have been used already, it may have expired, or the ' +
    'person who sent it may have withdrawn it. Ask them for a fresh link — issuing one takes ' +
    'them a moment.',
  nl:
    'Deze link kan niet worden gebruikt. Misschien is hij al gebruikt, verlopen of ingetrokken ' +
    'door wie hem stuurde. Vraag om een nieuwe link; die is zo gemaakt.',
};

/** The check itself could not run: ours, and nothing to do with the link. */
export const LINK_CHECK_UNAVAILABLE: Bilingual = {
  en:
    'We could not check this link just now. Nothing is wrong with it as far as we know — ' +
    'please try again in a moment.',
  nl:
    'We konden deze link zojuist niet controleren. Voor zover wij weten is er niets mis mee; ' +
    'probeer het zo meteen opnieuw.',
};

/** A progress link whose migration has since been deleted. */
export const MIGRATION_GONE: Bilingual = {
  en:
    'This migration no longer exists, so there is nothing to show. Nothing you can do from ' +
    `here will fix that; ${TELL.en}`,
  nl:
    'Deze migratie bestaat niet meer, dus er valt niets te tonen. U kunt dat vanaf hier niet ' +
    `oplossen; ${TELL.nl}`,
};

// ---------------------------------------------------------------------------
// Before the button: a migration that is not ready
// ---------------------------------------------------------------------------

/**
 * Why a migration is not ready, as the frame below completes it, one per
 * refusal `grantLinkAsk` can give (`grant-link-readiness.ts` in the API). The
 * owner was told the remedy when issuing; this reader cannot act on any of
 * them.
 */
export const NOT_READY_BECAUSE = {
  no_source_connection: { en: 'it no longer exists', nl: 'die bestaat niet meer' },
  source_not_google: {
    en: 'it does not connect to a Google account',
    nl: 'die is niet gekoppeld aan een Google-account',
  },
  no_named_account: {
    en: 'it does not name the Google account it reads',
    nl: 'die noemt niet welk Google-account ze leest',
  },
  no_target: { en: 'it has no destination to copy to', nl: 'die heeft geen bestemming om naartoe te kopiëren' },
  nothing_to_ask: { en: 'it has nothing to copy at the moment', nl: 'die heeft op dit moment niets om te kopiëren' },
  client_not_configured: {
    en: 'its Google application is not set up yet',
    nl: 'de Google-app ervan is nog niet ingesteld',
  },
  restricted_scope: {
    en: 'its Google application may not ask for mail or files',
    nl: 'de Google-app ervan mag niet om e-mail of bestanden vragen',
  },
} as const satisfies Readonly<Record<string, Bilingual>>;

/** The frame around a `NOT_READY_BECAUSE` reason, written to be forwarded. */
export function notReady(what: Bilingual): Bilingual {
  return {
    en: `This migration is not ready to be connected — ${what.en}. Nothing you can do from here will fix that; ${TELL.en}`,
    nl: `Deze migratie is nog niet klaar om te verbinden: ${what.nl}. U kunt dat vanaf hier niet oplossen; ${TELL.nl}`,
  };
}

/**
 * The operator's own refusal of a callback address (a raw IP, or loopback
 * behind a public name), wrapped for somebody who cannot act on it. The
 * detail stays as the operator reads it: it is what they will need once this
 * is forwarded to them.
 */
export function cannotSignInYet(detail: string): Bilingual {
  return {
    en:
      'This migration cannot use a Google sign-in yet, because of how the server is reached. ' +
      `Please forward this to the person who sent you the link: ${detail}`,
    nl:
      'Deze migratie kan nog geen Google-aanmelding gebruiken, door de manier waarop de server ' +
      `bereikbaar is. Stuur dit door naar de persoon die u de link stuurde: ${detail}`,
  };
}

// ---------------------------------------------------------------------------
// After Google: the grant link's ending
// ---------------------------------------------------------------------------

/**
 * Why the code exchange failed, worded from its code for somebody who holds no
 * client (`ExchangeRefusalCode` in the API). None of these reached the link.
 */
export const EXCHANGE_FOR_THE_LINK_HOLDER = {
  unreachable: {
    en: 'Google could not be reached just now, so your permission did not arrive.',
    nl: 'Google was zojuist niet bereikbaar, dus uw toestemming is niet aangekomen.',
  },
  refused: {
    en:
      "Google turned down this migration's own application, so your permission did not arrive. " +
      `Nothing you can do from here will fix that; ${TELL.en}`,
    nl:
      'Google heeft de eigen app van deze migratie geweigerd, dus uw toestemming is niet ' +
      `aangekomen. U kunt dat vanaf hier niet oplossen; ${TELL.nl}`,
  },
  code_rejected: {
    en:
      'Google did not accept the sign-in when it came back, which happens when it took too long ' +
      'or was sent twice.',
    nl:
      'Google accepteerde de aanmelding niet toen die terugkwam. Dat gebeurt als het te lang ' +
      'duurde of als die twee keer is verstuurd.',
  },
  scope_missing: {
    en:
      'Some of the permissions this migration asks for were left unticked at Google. Open your ' +
      'link again and leave every one of them ticked.',
    nl:
      'Bij Google zijn enkele toestemmingen die deze migratie vraagt niet aangevinkt. Open uw ' +
      'link opnieuw en laat ze allemaal aangevinkt.',
  },
  no_refresh_token: {
    en:
      'Google would not give lasting access to this account, which usually means its ' +
      'administrator does not allow it. Please tell the person who sent you the link.',
    nl:
      'Google wilde geen blijvende toegang tot dit account geven. Meestal staat de beheerder ' +
      'van het account dat niet toe. Laat het de persoon weten die u de link stuurde.',
  },
} as const satisfies Readonly<Record<string, Bilingual>>;

/**
 * Google's own `error` on the way back. Cancel is the person's own choice and
 * needs nobody else; any other word is passed on as Google said it.
 */
export function stoppedAtGoogle(said: string): Bilingual {
  if (said === 'access_denied') {
    return { en: 'Permission was not given at Google.', nl: 'Bij Google is geen toestemming gegeven.' };
  }
  return {
    en: `Google stopped before permission was given, and said "${said}". Please tell the person who sent you the link.`,
    nl: `Google stopte voordat er toestemming was gegeven, en meldde "${said}". Laat het de persoon weten die u de link stuurde.`,
  };
}

/** Google came back with neither a code nor an error. */
export const NOTHING_CAME_BACK: Bilingual = {
  en: 'Google sent nothing back, so your permission did not arrive.',
  nl: 'Google stuurde niets terug, dus uw toestemming is niet aangekomen.',
};

/** Our own fault while storing: the claim rolled back with it. */
export const NOT_KEPT: Bilingual = {
  en:
    'Your permission was given, but something on our side went wrong storing it, so it was not ' +
    'kept. Nothing is connected yet. Please tell the person who sent you the link — this one is ' +
    'ours to fix, not yours.',
  nl:
    'Uw toestemming is gegeven, maar bij ons ging er iets mis met het opslaan, dus die is niet ' +
    'bewaard. Er is nog niets verbonden. Laat het de persoon weten die u de link stuurde; dit ' +
    'moeten wij oplossen, niet u.',
};

/**
 * The link could not be claimed at the moment the grant landed: used,
 * expired or withdrawn, the same sentence for each, like `LINK_REFUSAL`.
 */
export const LINK_SPENT: Bilingual = {
  en:
    'This link can no longer be used — it may have been used already, it may have expired, or ' +
    'the person who sent it may have withdrawn it. Nothing was stored.',
  nl:
    'Deze link kan niet meer worden gebruikt. Misschien is hij al gebruikt, verlopen of ' +
    'ingetrokken door wie hem stuurde. Er is niets opgeslagen.',
};

/**
 * The migration names no account a sign-in can be compared with
 * (`signed-in-account.ts` in the API, 0108 T8 (b)).
 */
export const NO_NAMED_ACCOUNT: Bilingual = {
  en:
    'This migration no longer names the Google account it reads, so your permission could not ' +
    'be checked against it. Please tell the person who sent you the link.',
  nl:
    'Deze migratie noemt niet langer welk Google-account ze leest, dus uw toestemming kon niet ' +
    'met dat account worden vergeleken. Laat het de persoon weten die u de link stuurde.',
};

/** Google did not say who signed in. The named account is shown as it is. */
export function unconfirmedAccount(named: string): Bilingual {
  return {
    en:
      `Google did not confirm which account you signed in with, so it could not be checked ` +
      `against ${named}. Open your link again and sign in as ${named}.`,
    nl:
      `Google heeft niet bevestigd met welk account u bent ingelogd, dus dat kon niet worden ` +
      `vergeleken met ${named}. Open uw link opnieuw en log in als ${named}.`,
  };
}

/** Somebody signed in with another account. Both addresses are shown as they are. */
export function anotherAccount(signedInAs: string, named: string): Bilingual {
  return {
    en:
      `You signed in to Google as ${signedInAs}, but this migration reads ${named}. Open your ` +
      `link again and choose ${named} at Google.`,
    nl:
      `U bent bij Google ingelogd als ${signedInAs}, maar deze migratie leest ${named}. Open uw ` +
      `link opnieuw en kies ${named} bij Google.`,
  };
}
