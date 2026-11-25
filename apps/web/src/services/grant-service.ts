// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The migrator's two calls for the CREDENTIAL lifetime (workplan 0108 T4).
 *
 * Over `linkClient`, which is a separate axios instance from `api.ts`'s and
 * carries the reasoning for why: no bearer attached, no 401 interpreted, the
 * link in the path is the whole credential. The progress lifetime
 * (`view-service.ts`) shares it, and both must keep sharing it — see that
 * file's header.
 */

import { z } from 'zod';
import { DISCOVERY_DOMAINS, type DiscoveryDomain } from '@openmig/shared';
import type { Locale } from '../i18n/strings.ts';
import { LINK_API_BASE, linkClient as client } from './link-client.ts';
import { LinkAddressChangesField } from './link-address-service.ts';

/**
 * Whose sign-in a link's button opens (workplan 0171 §3.2). An API a release
 * behind does not say, which means Google, the only provider it knew.
 */
const Provider = z.enum(['google', 'microsoft', 'dropbox', 'apple']).default('google');
export type GrantProvider = z.infer<typeof Provider>;

/**
 * Every password kind, by role (workplan 0174 §5.1), as the API's
 * `PASSWORD_SOURCE_KINDS` and `PASSWORD_TARGET_KINDS` name them. A password
 * card's `provider` is one of these; a kind the page has no card for fails the
 * parse rather than drawing a card it cannot word.
 */
export const PASSWORD_KINDS = [
  'imap',
  'apple',
  'caldav',
  'carddav',
  'webdav',
  'jmap',
  'soverin',
  'nextcloud',
  'cirrux',
  'infomaniak',
] as const;
export type PasswordKind = (typeof PASSWORD_KINDS)[number];

/** A person's card names a sign-in provider or a password kind (0174 §4.1). */
const CardProvider = z.enum(['google', 'microsoft', 'dropbox', 'apple', 'cirrux', ...PASSWORD_KINDS]).default('google');
export type CardProvider = z.infer<typeof CardProvider>;

/**
 * One box or one shown value on a password card (0174 §5.2, D2), as the API's
 * `PersonField`: the owner's fields carry their value and are never a box; a
 * secret never carries one.
 */
const PersonFieldSchema = z.object({
  key: z.string(),
  who: z.enum(['person', 'owner']),
  labelKey: z.string(),
  hintKey: z.string().optional(),
  placeholder: z.string().optional(),
  secret: z.boolean(),
  autoComplete: z.enum(['username', 'new-password', 'off']).optional(),
  revealable: z.boolean().optional(),
  value: z.string().optional(),
});
export type PersonField = z.infer<typeof PersonFieldSchema>;

/**
 * Where the password is tried (0174 §5.8, D3). `domains` and
 * `notTheAddressMail` are D3's addition, answered by the route's read (T3,
 * `grant-server-domain.ts`; 0174 §5.3 names them): the registrable domain of
 * each host, in `hosts`' order, which the page sets in bold; and the hosts
 * whose domain is neither the address's own nor one of its MX hosts', which
 * the page warns about. Both optional: absent, the page bolds the whole host
 * and warns of nothing, as for a lookup that failed.
 */
const GrantServerSchema = z.object({
  hosts: z.array(z.string()),
  published: z.boolean(),
  domains: z.array(z.string()).optional(),
  notTheAddressMail: z.array(z.string()).optional(),
});
export type GrantServer = z.infer<typeof GrantServerSchema>;

const SubjectSchema = z.object({
  organisation: z.string(),
  // The name the EU VAT register gave, when the organisation's VAT number was
  // checked and found valid (0108 T8a); null otherwise.
  checkedCompany: z.string().nullable(),
  // Who asked (0108 T8a): the issuing member's sign-in address, or null when
  // they are no longer a member.
  askedBy: z.string().nullable(),
  // The organisation's phone number, when it gave one (optional).
  organisationPhone: z.string().nullable(),
  // Which data types the link reads (workplan 0145 T6). The page words them
  // from its own dictionary, in the reader's language; the server used to
  // send an English sentence instead. A type this page has no words for is a
  // parse failure rather than a shorter list: a consent page must not name
  // less than will be read. Never empty: a link with nothing to ask is not
  // ready, and the server refuses it.
  domains: z.array(z.enum(DISCOVERY_DOMAINS as unknown as [DiscoveryDomain, ...DiscoveryDomain[]])).min(1),
  scope: z.string(),
  // Whether Google itself holds that scope to reading (workplan 0144 T3 (c)).
  // The page says "read-only" only when it is true.
  readOnlyAtProvider: z.boolean(),
  provider: Provider,
  // Where from and where to (workplan 0108 T8a): the account the migration
  // reads, and the kind of server it writes, its host and the account on it.
  // Never null since T8 (b): the grant is bound to that account, so the server
  // answers no page for a migration that names none.
  from: z.string(),
  to: z.object({
    provider: z.string(),
    host: z.string().nullable(),
    account: z.string().nullable(),
  }),
  expiresAt: z.string(),
});
export type GrantSubject = z.infer<typeof SubjectSchema>;

const Domain = z.enum(DISCOVERY_DOMAINS as unknown as [DiscoveryDomain, ...DiscoveryDomain[]]);

/**
 * What a PERSON'S link opens (ADR-0035, amended 2026-09-29; workplan 0153
 * T5 (b)): who asked, once, then each Google account the person's migrations
 * read, what its one consent asks for, where each of its migrations goes, and
 * whether it is connected already, or connected and asked for again (`again`,
 * a link made while every account was connected). No migration id: the button
 * names the account. A data type this page has no words for fails the parse,
 * as above.
 */
const PersonSubjectSchema = z.object({
  kind: z.literal('person'),
  organisation: z.string(),
  checkedCompany: z.string().nullable(),
  askedBy: z.string().nullable(),
  organisationPhone: z.string().nullable(),
  accounts: z
    .array(
      z.object({
        // The card's name in the password route, never the address (0174
        // §4.1). An API a release behind sends none, and only sign-in cards.
        ref: z.string().default(''),
        role: z.enum(['source', 'target']).default('source'),
        way: z.enum(['sign-in', 'password']).default('sign-in'),
        account: z.string(),
        provider: CardProvider,
        // Password cards only (0174 §5.2, §5.5, §5.8).
        server: GrantServerSchema.nullable().optional(),
        fields: z.array(PersonFieldSchema).optional(),
        tries: z.object({ left: z.number().int(), locked: z.boolean() }).nullable().optional(),
        granted: z.boolean(),
        // An API a release behind does not say it, which means no.
        again: z.boolean().default(false),
        domains: z.array(Domain),
        scope: z.string().nullable(),
        readOnlyAtProvider: z.boolean(),
        // Why this account cannot be asked, in both languages, or null.
        notReady: z.object({ reason: z.string(), reasonNl: z.string() }).nullable(),
        migrations: z
          .array(
            z.object({
              domains: z.array(Domain).min(1),
              to: z.object({ provider: z.string(), host: z.string().nullable(), account: z.string().nullable() }),
              // Where it comes from, which a destination's card names (0174 §4.1).
              from: z.object({ provider: z.string(), account: z.string().nullable() }).optional(),
              granted: z.boolean(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  expiresAt: z.string(),
  // The person's own rows of the address changes (0168 §4.4), where sent.
  addressChanges: LinkAddressChangesField,
});
export type PersonGrantSubject = z.infer<typeof PersonSubjectSchema>;
export type PersonGrantCard = PersonGrantSubject['accounts'][number];

/**
 * How `PUT /api/grant/:link/password` answered (0174 §5.3, §5.7), as the page
 * words it. The categories are the only words of a refusal it ever shows; the
 * server's own text for a password the person typed never reaches it.
 */
export type PasswordAnswer =
  | { readonly kind: 'connected'; readonly faces: ReadonlyArray<DiscoveryDomain> }
  | { readonly kind: 'refused_login'; readonly left: number | null }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'face_missing'; readonly faces: ReadonlyArray<DiscoveryDomain> }
  | { readonly kind: 'locked' }
  /** Any other refusal, with the server's sentence for the link when it sent one (`message`/`reason`, both languages). */
  | { readonly kind: 'refusal'; readonly sentence: { readonly en: string; readonly nl: string } | null }
  /** No answer at all: the connection dropped, or it timed out. */
  | { readonly kind: 'no_answer' };

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** The data types an answer names, the ones this page has words for. */
function facesOf(v: unknown): DiscoveryDomain[] {
  return Array.isArray(v) ? v.filter((d): d is DiscoveryDomain => (DISCOVERY_DOMAINS as readonly unknown[]).includes(d)) : [];
}

/**
 * The answer's body, read exactly as the route answers (0174 §5.3, settled
 * on one branch with T3's route): `connected` and `faces` on success; 422
 * `{ error, tries: { left, locked }, faces? }`; 423 `{ error: 'locked' }`;
 * 409 `{ error: 'already_connected' }`, read as connected. Every other answer
 * is a refusal with the server's sentence when it sent one: the link refused
 * at the door (401, `message`/`messageNl`), revoked while the test ran (401
 * `link_spent`, `reason`/`reasonNl`), a server named by a number (409
 * `server_not_a_name`, `reason`/`reasonNl`); a body the route could not take
 * (400, 413, 415) carries no sentence, and the page says its own. Exported
 * for the tests.
 */
export function passwordAnswerOf(status: number, body: unknown): PasswordAnswer {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (status >= 200 && status < 300 && b.connected === true) return { kind: 'connected', faces: facesOf(b.faces) };
  const code = nonEmpty(b.error) ? b.error : '';
  // Connected through this link already (a second tab, a replay): nothing was tried, and it is connected.
  if (status === 409 && code === 'already_connected') return { kind: 'connected', faces: [] };
  if (status === 423) return { kind: 'locked' };
  if (status === 422 && code === 'refused_login') {
    const tries = b.tries && typeof b.tries === 'object' ? (b.tries as Record<string, unknown>) : {};
    if (tries.locked === true) return { kind: 'locked' };
    const left = typeof tries.left === 'number' ? tries.left : null;
    return left === 0 ? { kind: 'locked' } : { kind: 'refused_login', left };
  }
  if (status === 422 && code === 'unreachable') return { kind: 'unreachable' };
  if (status === 422 && code === 'face_missing') return { kind: 'face_missing', faces: facesOf(b.faces) };
  const en = nonEmpty(b.message) ? b.message : nonEmpty(b.reason) ? b.reason : null;
  const nl = nonEmpty(b.messageNl) ? b.messageNl : nonEmpty(b.reasonNl) ? b.reasonNl : null;
  return { kind: 'refusal', sentence: en === null ? null : { en, nl: nl ?? en } };
}

/** How long a password test may take before the page says it got no answer: the route's own deadline and some. */
const PASSWORD_TIMEOUT_MS = 60_000;

/** Whether the page opened a person's link rather than a migration's. */
export const isPersonSubject = (s: GrantSubject | PersonGrantSubject): s is PersonGrantSubject =>
  'kind' in s && s.kind === 'person';

export const grantApi = {
  /** What this page must be able to say before the button. Changes nothing. */
  read: async (link: string): Promise<GrantSubject | PersonGrantSubject> => {
    const res = await client.get(`/grant/${encodeURIComponent(link)}`);
    return (res.data as { kind?: unknown } | undefined)?.kind === 'person'
      ? PersonSubjectSchema.parse(res.data)
      : SubjectSchema.parse(res.data);
  },

  /**
   * Where the button goes. Answers a URL to follow, never a redirect.
   * `locale` is the language the page is in, so the ending after Google is in
   * it too (workplan 0145 T6); the server keeps it and never puts it in the
   * redirect.
   */
  authorize: async (
    link: string,
    locale: Locale,
    provider: GrantProvider = 'google',
    account?: string,
  ): Promise<{ url: string }> => {
    // At the button's provider (workplan 0171 §3.2); for a person's link,
    // the account whose button was pressed.
    const res = await client.post(`/grant/${encodeURIComponent(link)}/${provider}/authorize`, {
      locale,
      ...(account === undefined ? {} : { account }),
    });
    return z.object({ url: z.string() }).parse(res.data);
  },

  /**
   * Where a destination's sign-in button goes (workplan 0174 §4.4, T5):
   * Cirrux Drive, today the one. The card is named by its `ref`, since Cirrux
   * vouches for no address. Answers a URL to follow, never a redirect; the
   * page follows it only to `CONSENT_HOSTS.cirrux`.
   */
  authorizeDrive: async (link: string, ref: string, locale: Locale): Promise<{ url: string }> => {
    const res = await client.post(`/grant/${encodeURIComponent(link)}/cirrux/authorize`, { ref, locale });
    return z.object({ url: z.string() }).parse(res.data);
  },

  /**
   * The person's own password for one card (workplan 0174 §5.3): `PUT` with a
   * JSON body, by `fetch`, never a form and never a query string, so the
   * password is in no URL, history entry or referrer. The values go only into
   * the body; nothing here keeps them, logs them or hands them back.
   */
  putPassword: async (
    link: string,
    ref: string,
    values: Readonly<Record<string, string>>,
    locale: Locale,
  ): Promise<PasswordAnswer> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PASSWORD_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${LINK_API_BASE}/grant/${encodeURIComponent(link)}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ref, values, locale }),
        // The link in the path is the whole credential (`link-client.ts`).
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
    } catch {
      return { kind: 'no_answer' };
    } finally {
      clearTimeout(timer);
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // A proxy's page, or no body: the status alone decides below.
    }
    return passwordAnswerOf(res.status, body);
  },
};
