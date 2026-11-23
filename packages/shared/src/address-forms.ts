// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE FORMS AN ADDRESS TAKES, AND THE ADDRESSES NOBODY CAN TAKE ALONG
 * (workplan 0168 §2.5, §6.1, T1; ADR-0055).
 *
 * ## The key
 *
 * `addressKey` is the form two spellings of one address share. It is the
 * address in lower case, trimmed. For Gmail only, dots and a `+suffix` in the
 * local part are dropped and `googlemail.com` is read as `gmail.com`, because
 * Google treats those as one account. On any other domain those characters
 * matter (two Workspace users can be `a.b@` and `ab@`), so nothing else is
 * folded. Microsoft's consumer plus-addressing is not folded either: it has
 * not been measured (0168 §2.5).
 *
 * This is the rule `googleAccountKey` applied in
 * `apps/api/src/routes/migrations/signed-in-account.ts` (workplan 0108 T8),
 * moved here so that the address table (0168 T2) and the change itself
 * (`address-changes.ts`, T3) match on the same key the sign-in binds with.
 *
 * ## The list
 *
 * `NOT_TAKEN_ALONG` is the domains whose addresses belong to the provider
 * being left (0168 §1.1). Each entry is taken from a source that can be cited,
 * named beside it with the date it was read. A domain is never added from
 * memory. The list only proposes a row in the table (0168 §6.1): a person can
 * still say no, or declare an address the list missed.
 *
 * Where a provider publishes its domains, its own page decides. Where it
 * publishes none, as Microsoft and Yahoo do not for their country forms,
 * Thunderbird's ISP database (its configuration for each provider, which
 * lists the domains that provider serves) stands in, and the comment says so.
 * Where a provider's own page lists its domains, a domain only that database
 * still names is left out: it may have lapsed and belong to somebody else.
 * Every domain is written in full and matched whole, so a lookalike such as
 * `hotmail.example.com` never matches.
 *
 * ## One rule beside the list
 *
 * A Microsoft 365 tenant's own domain is a host under `onmicrosoft.com`
 * (`contoso.onmicrosoft.com`), one per organisation, so no list of whole
 * domains can hold them all. They are the one rule beside the list,
 * `UNDER_ONMICROSOFT` (the owner, 2026-11-23: *"Yes, any .onmicrosoft.com"*),
 * read on whole labels: at least one label before `.onmicrosoft.com`, so
 * `onmicrosoft.com` itself, `notonmicrosoft.com` and
 * `onmicrosoft.com.example.com` never match. Its source is cited beside it,
 * as the list's are. The list itself stays whole domains, and nothing else
 * is matched by a suffix.
 */

/** Gmail's two spellings of one domain. */
const GMAIL = 'gmail.com';
const GOOGLEMAIL = 'googlemail.com';

/**
 * What no address holds: white space, a control character (NUL among them,
 * which Postgres refuses to store, 22021) and half of a surrogate pair, which
 * no encoding of an address can carry. A value with one is not an address, so
 * it is refused as one before anything stores it (0168's review, finding 3).
 */
const NOT_IN_AN_ADDRESS = /[\s\p{Cc}\p{Cs}]/u;

/** The local part and domain of an address, lower case, or null when it is not one. */
function partsOf(address: string): { readonly name: string; readonly domain: string } | null {
  const parts = address.trim().toLowerCase().split('@');
  if (parts.length !== 2) return null;
  const [name, domain] = parts as [string, string];
  if (name === '' || domain === '' || NOT_IN_AN_ADDRESS.test(name + domain)) return null;
  return { name, domain };
}

/** The Gmail fold of a local part and domain, or the two as they are elsewhere. */
function folded(name: string, domain: string): { readonly name: string; readonly domain: string } {
  const d = domain === GOOGLEMAIL ? GMAIL : domain;
  if (d !== GMAIL) return { name, domain: d };
  return { name: name.split('+')[0]!.replace(/\./g, ''), domain: d };
}

/**
 * Is this value an address the key can be taken of? One `@`, a local part and
 * a domain, no white space or control character, and for Gmail a local part
 * that is not empty once folded (`+x@gmail.com` names nobody).
 */
export function isAddress(address: string): boolean {
  const p = partsOf(address);
  return p !== null && folded(p.name, p.domain).name !== '';
}

/**
 * The domain of an address, lower case, as it follows the `@`, or null when
 * the value is not an address (`isAddress`). No Gmail fold: `googlemail.com`
 * stays itself.
 */
export function domainOf(address: string): string | null {
  const p = partsOf(address);
  return p === null || !isAddress(address) ? null : p.domain;
}

/**
 * The matching key of an address (0168 §2.5): lower case and trimmed, and for
 * Gmail only, dots and a `+suffix` dropped and `googlemail.com` read as
 * `gmail.com`.
 *
 * A value that is not an address (`isAddress` false) gets its trimmed lower
 * case and no fold, so it can never share a key with an address it is not.
 */
export function addressKey(address: string): string {
  const p = partsOf(address);
  if (p === null) return address.trim().toLowerCase();
  const f = folded(p.name, p.domain);
  if (f.name === '') return address.trim().toLowerCase();
  return `${f.name}@${f.domain}`;
}

/** One domain whose addresses stay with its provider. */
export interface NotTakenAlong {
  /** The domain, lower case, as it follows the `@`. */
  readonly domain: string;
  /** The provider the domain belongs to, as a person would name it. */
  readonly provider: string;
}

/** A provider's domains as entries of the list, in the order their source gives them. */
function servedBy(provider: string, domains: ReadonlyArray<string>): NotTakenAlong[] {
  return domains.map((domain) => ({ domain, provider }));
}

/**
 * The domains whose addresses cannot be taken along (0168 §1.1, D10).
 *
 * Every group names its source and the date it was read. A provider that lets
 * a person keep the address for a while, or for a fee, keeps its domains here
 * all the same, and the group says so: the address still cannot come along to
 * the new provider, the list only proposes, and the person can answer No.
 * What was looked for and left out is in workplan 0168's Status block.
 */
export const NOT_TAKEN_ALONG: ReadonlyArray<NotTakenAlong> = Object.freeze([
  // Google for Developers, "Manage offline conversions" (Google Ads API),
  // https://developers.google.com/google-ads/api/docs/conversions/upload-offline,
  // read 2026-11-22: "Apply domain-specific normalization (`gmail.com` and
  // `googlemail.com` only)". And "Format user data" (Data Manager API),
  // https://developers.google.com/data-manager/api/devguides/concepts/formatting,
  // read 2026-11-22: "If the email address has the `gmail.com` or
  // `googlemail.com` domain: Remove all dots".
  { domain: GMAIL, provider: 'Google' },
  { domain: GOOGLEMAIL, provider: 'Google' },

  // Microsoft Support, "Subscription features in Outlook.com for Microsoft 365 subscribers",
  // https://support.microsoft.com/en-us/outlook/premium-features-in-outlook-com-for-microsoft-365-subscribers,
  // read 2026-11-23: "Outlook.com accounts have email addresses ending in
  // @outlook.com, @hotmail.com, @live.com, and @msn.com."
  ...servedBy('Microsoft', ['outlook.com', 'hotmail.com', 'live.com', 'msn.com']),
  // Microsoft Support, "My username and password have stopped working",
  // https://support.microsoft.com/en-us/accounts-billing/manage/my-username-and-password-have-stopped-working,
  // read 2026-11-23: "Microsoft offers different country domains for Hotmail,
  // Outlook and Live accounts, such as .com and .co.uk". Its "Help with the
  // Microsoft account recovery form" names "@outlook.co.uk" the same day.
  // Microsoft publishes no list of its country domains.
  ...servedBy('Microsoft', ['hotmail.co.uk', 'live.co.uk', 'outlook.co.uk']),
  // ONLY THUNDERBIRD'S ISP DATABASE names these, in its Outlook.com entry,
  // https://autoconfig.thunderbird.net/v1.1/hotmail.com, read 2026-11-23:
  // every domain it lists but those above and `olc.protection.outlook.com`,
  // the name of a mail server. English Wikipedia's "Outlook.com" also names
  // `windowslive.com` as Microsoft's, kept but no longer offered.
  ...servedBy('Microsoft', [
    'windowslive.com', 'outlook.at', 'outlook.be', 'outlook.cl', 'outlook.cz', 'outlook.de', 'outlook.dk',
    'outlook.es', 'outlook.fr', 'outlook.hu', 'outlook.ie', 'outlook.in', 'outlook.it', 'outlook.jp',
    'outlook.kr', 'outlook.lv', 'outlook.my', 'outlook.ph', 'outlook.pt', 'outlook.sa', 'outlook.sg',
    'outlook.sk', 'outlook.co.id', 'outlook.co.il', 'outlook.co.th', 'outlook.com.ar', 'outlook.com.au',
    'outlook.com.br', 'outlook.com.gr', 'outlook.com.tr', 'outlook.com.vn', 'hotmail.be', 'hotmail.ca',
    'hotmail.cl', 'hotmail.cz', 'hotmail.de', 'hotmail.dk', 'hotmail.es', 'hotmail.fi', 'hotmail.fr',
    'hotmail.gr', 'hotmail.hu', 'hotmail.it', 'hotmail.lt', 'hotmail.lv', 'hotmail.my', 'hotmail.nl',
    'hotmail.no', 'hotmail.ph', 'hotmail.rs', 'hotmail.se', 'hotmail.sg', 'hotmail.sk', 'hotmail.co.id',
    'hotmail.co.il', 'hotmail.co.in', 'hotmail.co.jp', 'hotmail.co.kr', 'hotmail.co.th', 'hotmail.co.za',
    'hotmail.com.ar', 'hotmail.com.au', 'hotmail.com.br', 'hotmail.com.hk', 'hotmail.com.tr',
    'hotmail.com.tw', 'hotmail.com.vn', 'live.at', 'live.be', 'live.ca', 'live.cl', 'live.cn', 'live.de',
    'live.dk', 'live.fi', 'live.fr', 'live.hk', 'live.ie', 'live.in', 'live.it', 'live.jp', 'live.nl',
    'live.no', 'live.ru', 'live.se', 'live.co.jp', 'live.co.kr', 'live.co.za', 'live.com.ar', 'live.com.au',
    'live.com.mx', 'live.com.my', 'live.com.ph', 'live.com.pt', 'live.com.sg', 'livemail.tw',
  ]),

  // Apple Support, "About your @icloud.com, @me.com, and @mac.com email addresses",
  // https://support.apple.com/en-us/118230, read 2026-11-23 (published
  // 2025-01-29): "your iCloud email addresses and aliases may end with
  // @icloud.com, @me.com, or @mac.com domains".
  ...servedBy('Apple', ['icloud.com', 'me.com', 'mac.com']),

  // Yahoo Help, "Identify your domain extension in Yahoo Mail" (SLN2153),
  // https://help.yahoo.com/kb/SLN2153.html, read 2026-11-23: "While Yahoo
  // accounts can end in "@yahoo.com" or "@myyahoo.com", some older accounts
  // may have a different extension depending on the location where they were
  // created", "like "@yahoo.co.uk" or "@yahoo.fr"". It lists no others.
  ...servedBy('Yahoo', ['yahoo.com', 'myyahoo.com', 'yahoo.co.uk', 'yahoo.fr']),
  // Yahoo Help, "Sign in or out of Yahoo" (SLN3407),
  // https://help.yahoo.com/kb/SLN3407.html, read 2026-11-23: "If your account
  // uses a non-Yahoo, ymail, or rocketmail email address, enter the full email
  // address". The page writes no `.com`; Thunderbird's ISP database (its Yahoo
  // entry) and English Wikipedia's "Yahoo Mail" spell the two domains so.
  ...servedBy('Yahoo', ['ymail.com', 'rocketmail.com']),
  // ONLY THUNDERBIRD'S ISP DATABASE names these, in its Yahoo entry,
  // https://autoconfig.thunderbird.net/v1.1/yahoo.com, read 2026-11-23: every
  // domain it lists but those above, the names of Yahoo's mail servers
  // (`yahoodns.net` and two under it), and `cox.net`, an internet provider's
  // own. English Wikipedia's "Yahoo Mail" also names `yahoo.it`.
  ...servedBy('Yahoo', [
    'yahoo.ca', 'yahoo.de', 'yahoo.it', 'yahoo.es', 'yahoo.se', 'yahoo.co.in', 'yahoo.co.nz', 'yahoo.com.au',
    'yahoo.com.ar', 'yahoo.com.br', 'yahoo.com.mx',
  ]),

  // Ziggo, "IMAP-, POP-, SMTP-instellingen",
  // https://www.ziggo.nl/klantenservice/e-mail/serverinstellingen, read
  // 2026-11-23: "De POP- en IMAP-instellingen werken voor de volgende
  // e-maildomeinen:" these seven. Ziggo offers no way to keep one: its
  // "Ziggo Mail - webmail" page, the same day, "Kan ik mijn Ziggo e-mailadres
  // houden als ik opzeg of overstap naar een andere provider? Nee, dat gaat
  // niet." Eight more domains in Thunderbird's ISP database are not on Ziggo's
  // page, so they are left out.
  ...servedBy('Ziggo', ['ziggo.nl', 'quicknet.nl', 'home.nl', 'casema.nl', 'upcmail.nl', 'chello.nl', 'a2000.nl']),

  // KPN, "E-mail instellen op je pc of Mac",
  // https://www.kpn.com/service/ugs/instellen-e-mail-laptop-pc, read
  // 2026-11-23: "Je kan e-mailadressen instellen die eindigen op:" these
  // eighteen, the same as Thunderbird's ISP database. KPN SELLS A WAY TO KEEP
  // ONE: its "E-mail only abonnement" page, the same day, "Met een E-mail Only
  // abonnement van KPN kan je het e-mailadres blijven gebruiken", if asked for
  // within six months of ending the internet subscription.
  ...servedBy('KPN', [
    'kpnmail.nl', 'kpnplanet.nl', 'planet.nl', 'wxs.nl', 'hetnet.nl', 'freeler.nl', 'snelnet.net', 'on.nl',
    'onsbrabantnet.nl', 'onsmail.nl', 'onsnet.nu', 'onsneteindhoven.nl', 'onsnetnuenen.nl', 'xs4all.nl',
    'telfort.nl', 'tip.nl', 'tiscali.nl', 'tiscalimail.nl',
  ]),

  // Telenet, "Je e-mail",
  // https://www2.telenet.be/residential/nl/klantenservice/internet/e-mail.html,
  // read 2026-11-23: one signs in to its webmail "met je Telenet e-mailadres",
  // and its example ends in `@telenet.be`. Thunderbird's ISP database has no
  // Telenet entry. TELENET KEEPS THE ADDRESS AFTER THE CONTRACT ENDS: its
  // general terms of 1 November 2024, "Bijzondere voorwaarden mailbox", 1.1,
  // "De mailbox en de bijbehorende e-mailadressen blijven beschikbaar, zelfs
  // nadat de Overeenkomst is beëindigd", and Telenet may delete a mailbox
  // that sends nothing for two years.
  ...servedBy('Telenet', ['telenet.be']),

  // Proximus, "E-mail van Proximus: hulp, toegang en wachtwoord",
  // https://www.proximus.be/support/nl/id_sfaqr_mail_global/particulieren/support/internet/e-mails-en-website/problemen-met-je-mailbox/vragen-over-proximus-mail.html,
  // read 2026-11-23: "log je in op webmail via webmail.proximus.be met je
  // e-mailadres (proximus.be, skynet.be of belgacom.net)". PROXIMUS KEEPS THE
  // MAILBOX FOR A WHILE: its internet terms (V.20210816), 20.4, "tot 18
  // maanden na de afsluiting van het internetabonnement", free. Thunderbird's
  // ISP database also names `kidcity.be`, which Proximus's page does not, so
  // it is left out.
  ...servedBy('Proximus', ['proximus.be', 'skynet.be', 'belgacom.net']),
]);

/**
 * ONE SUFFIX RULE BESIDE THE LIST: A MICROSOFT 365 TENANT'S OWN DOMAIN (the
 * owner, 2026-11-23: *"Yes, any .onmicrosoft.com"*, *"One suffix rule beside
 * the list, matched on a whole label, so a lookalike never matches"*). Its
 * provider is the one the list's Microsoft entries name.
 *
 * Microsoft Support, "What's the difference between a Microsoft account and a
 * work or school account?",
 * https://support.microsoft.com/en-us/accounts-billing/manage/what-s-the-difference-between-a-microsoft-account-and-a-work-or-school-account,
 * read 2026-11-23: "When you first sign up for a Microsoft business product
 * like Microsoft 365 for business, you get an email address that ends with
 * .onmicrosoft.com. You can use that address or customize it by adding your
 * own domain". Microsoft Support, "What is my user ID and why do I need it for
 * Office 365 for business?",
 * https://support.microsoft.com/en-us/office/lifecycle/what-is-my-user-id-and-why-do-i-need-it-for-office-365-for-business,
 * read 2026-11-23: "The domain part of the user ID is either the
 * onmicrosoft.com domain that you chose when you signed up for Microsoft 365
 * for business or another domain—for example, your organization’s custom
 * domain". And the one that says it ends with the tenant: Microsoft Learn,
 * "Domains FAQ",
 * https://learn.microsoft.com/en-us/microsoft-365/admin/setup/domains-faq,
 * read 2026-11-23: "Microsoft 365 creates a domain for you, like
 * contoso.onmicrosoft.com, when you sign up with the service", and "You can't
 * remove your onmicrosoft.com domain. Microsoft 365 needs to keep the
 * onmicrosoft.com domain because it's used behind the scenes for your
 * subscription."
 */
export const UNDER_ONMICROSOFT: Readonly<{ readonly parent: string; readonly provider: string }> = Object.freeze({
  parent: 'onmicrosoft.com',
  provider: 'Microsoft',
});

/**
 * Whether a domain is one Microsoft 365 tenant's, a host under
 * `onmicrosoft.com` (`UNDER_ONMICROSOFT`), read on whole labels: one label or
 * more before `.onmicrosoft.com`, none of them empty. So
 * `contoso.onmicrosoft.com` and `contoso.mail.onmicrosoft.com` are, and
 * `onmicrosoft.com` itself, `notonmicrosoft.com`,
 * `onmicrosoft.com.example.com` and `onmicrosoft.co` are not.
 */
export function isMicrosoftTenantDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  const suffix = `.${UNDER_ONMICROSOFT.parent}`;
  return d.endsWith(suffix) && d.slice(0, -suffix.length).split('.').every((label) => label !== '');
}

const BY_DOMAIN: ReadonlyMap<string, NotTakenAlong> = new Map(NOT_TAKEN_ALONG.map((e) => [e.domain, e]));

/**
 * Whether an address belongs to a provider that keeps it, and which one, or
 * null when it does not or is not an address. Only the domain is read: a
 * domain on the list, matched whole, or a host under `onmicrosoft.com`
 * (`UNDER_ONMICROSOFT`).
 */
export function cannotTakeAlong(address: string): { readonly provider: string } | null {
  const p = partsOf(address);
  if (p === null) return null;
  const entry = BY_DOMAIN.get(p.domain);
  if (entry !== undefined) return { provider: entry.provider };
  return isMicrosoftTenantDomain(p.domain) ? { provider: UNDER_ONMICROSOFT.provider } : null;
}
