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
import { linkClient as client } from './link-client.ts';

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
        account: z.string(),
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
              granted: z.boolean(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  expiresAt: z.string(),
});
export type PersonGrantSubject = z.infer<typeof PersonSubjectSchema>;

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
  authorize: async (link: string, locale: Locale, account?: string): Promise<{ url: string }> => {
    // For a person's link, the account whose button was pressed.
    const res = await client.post(`/grant/${encodeURIComponent(link)}/google/authorize`, {
      locale,
      ...(account === undefined ? {} : { account }),
    });
    return z.object({ url: z.string() }).parse(res.data);
  },
};
