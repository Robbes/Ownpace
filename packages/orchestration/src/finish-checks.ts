// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * FINISH'S TWO CHECKS, the half both editions share (workplan 0171 §7, T10):
 * the addresses that receive mail, and the MX check. Each edition's door
 * finds the migration's source, its credentials and its destination in its
 * own way (the managed API from rows, the appliance from its mapping file) and
 * hands them here, so the two say the same thing about the same account.
 *
 * READ-ONLY: a Graph or Gmail GET, and three DNS-over-HTTPS questions.
 */

import {
  destinationMx,
  mxReadingOf,
  OLD_PROVIDER_MX,
  ownDomainOf,
  type FinishAddresses,
  type MxReading,
  type ReceivingAddresses,
} from '@openmig/shared';
import {
  GoogleTokenProvider,
  readGmailReceivingAddresses,
  readGraphReceivingAddresses,
  type HttpClient,
} from '@openmig/connectors';
import { verifyMX } from '@openmig/core';
import type { GoogleCredentialsAsFound } from './drive-source-factory.ts';
import { dwdTokenProviderIfConfigured } from './google-dwd.ts';
import { GMAIL_SCOPE } from './gmail-source-factory.ts';
import {
  ENV_GRAPH_FIELD_NAMING,
  type GraphEntraCredsAsFound,
  type GraphFieldNaming,
} from './graph-domain-source-factory.ts';
import { graphProfileTokenFrom } from './graph-profile-token.ts';

/** Which old provider a source is, as far as reading its addresses goes. */
export type AddressFamily = 'microsoft' | 'google' | 'other';

/** What a door hands over to read a source's addresses. */
export type AddressSource =
  | {
      readonly family: 'microsoft';
      /** The Entra tenant the token is minted in; `common` for a person's own account. */
      readonly tenantId: string;
      readonly creds: GraphEntraCredsAsFound;
      readonly naming?: GraphFieldNaming;
    }
  | { readonly family: 'google'; readonly creds: GoogleCredentialsAsFound }
  | { readonly family: 'other' };

/**
 * Read the addresses at the old provider that deliver into `mailbox`.
 *
 * Microsoft: delegated (a refresh token) reads `/me` with `User.Read`;
 * application permissions read `/users/{mailbox}`. Google: OAuth or
 * domain-wide delegation reads `sendAs`; an app password reaches IMAP only, so
 * there is nothing to ask. A builder's refusal (a credential missing) is the
 * same refusal a pass would meet, and is said, not swallowed.
 */
export async function readReceivingAddresses(
  source: AddressSource,
  mailbox: string,
  http: HttpClient,
): Promise<ReceivingAddresses> {
  if (source.family === 'microsoft') {
    const delegated = Boolean(source.creds.refreshToken);
    let token: () => Promise<string>;
    try {
      token = graphProfileTokenFrom(
        { tenantId: source.tenantId, ...(delegated ? {} : { mailbox }) },
        source.creds,
        source.naming ?? ENV_GRAPH_FIELD_NAMING,
      );
    } catch (err) {
      return { state: 'failed', provider: 'Microsoft', reason: err instanceof Error ? err.message : String(err) };
    }
    return readGraphReceivingAddresses(token, http, delegated ? {} : { mailbox });
  }
  if (source.family === 'google') {
    const c = source.creds;
    let provider;
    try {
      provider =
        dwdTokenProviderIfConfigured(c, mailbox, GMAIL_SCOPE, 'Gmail addresses') ??
        (c.clientId && c.clientSecret && c.refreshToken
          ? new GoogleTokenProvider(
              { clientId: c.clientId, clientSecret: c.clientSecret, refreshToken: c.refreshToken },
              { scope: GMAIL_SCOPE },
            )
          : undefined);
    } catch (err) {
      return { state: 'failed', provider: 'Google', reason: err instanceof Error ? err.message : String(err) };
    }
    // An app password opens IMAP and nothing else: Gmail's settings cannot be asked.
    if (provider === undefined) return { state: 'not_readable' };
    const viaDwd = Boolean(c.serviceAccountKey);
    return readGmailReceivingAddresses(
      async () => (await provider.getToken()).accessToken,
      http,
      viaDwd ? mailbox : 'me',
    );
  }
  return { state: 'not_readable' };
}

/** Finish's answer about addresses: read only when the mailbox is on the person's own domain. */
export async function finishAddresses(
  address: string | undefined,
  read: () => Promise<ReceivingAddresses>,
): Promise<FinishAddresses> {
  const ownDomain = ownDomainOf(address);
  return {
    address: address ?? null,
    ownDomain,
    receiving: ownDomain === null ? null : await read(),
  };
}

/** What a door hands over for the MX check. */
export interface MxCheckInput {
  /** The mailbox's own address. */
  readonly address: string | undefined;
  /** The old provider, for the `old` line. */
  readonly family: AddressFamily;
  /** The destination's connection kind and its own mail host, for the `ok` line. */
  readonly destinationKind: string;
  readonly destinationMailHost: string | undefined;
}

/** The answer of `POST …/finish/mx-check`. */
export type MxCheckAnswer =
  | { readonly domain: string; readonly reading: MxReading }
  | { readonly domain: null; readonly reason: 'not_own_domain' };

/** Check MX for the mailbox's domain (§7.3, D8 (a)). */
export async function checkMx(
  input: MxCheckInput,
  ask: typeof verifyMX = verifyMX,
): Promise<MxCheckAnswer> {
  const domain = ownDomainOf(input.address);
  if (domain === null) return { domain: null, reason: 'not_own_domain' };
  const result = await ask(domain);
  const old = input.family === 'other' ? undefined : OLD_PROVIDER_MX[input.family];
  return {
    domain,
    reading: mxReadingOf(result.resolverResults, destinationMx(input.destinationKind, input.destinationMailHost), old),
  };
}

/**
 * The destination's own mail host, from a target's config as either edition
 * stores it: an IMAP `host`, a JMAP `baseUrl`/`url`. Undefined when none is
 * written (a provider kind whose host is its own).
 */
export function mailHostOfTarget(config: unknown): string | undefined {
  if (typeof config !== 'object' || config === null) return undefined;
  const c = config as { host?: unknown; imapHost?: unknown; baseUrl?: unknown; url?: unknown };
  for (const v of [c.imapHost, c.host]) if (typeof v === 'string' && v.trim() !== '') return v.trim();
  for (const v of [c.baseUrl, c.url]) {
    if (typeof v !== 'string' || v.trim() === '') continue;
    try {
      return new URL(v).hostname;
    } catch {
      // Not a URL: the next field, and with none the host is not known. The
      // check then shows what it finds for the person to judge (D8).
    }
  }
  return undefined;
}

/** An appliance mapping's source, as its file says it (`config.ts`). */
interface ApplianceSource {
  readonly type: string;
  readonly user?: string;
  readonly mailbox?: string;
  readonly tenantId?: string;
}

/**
 * The appliance's half: the mailbox's address and the source's credentials,
 * from the mapping file and the environment, the same variables its passes
 * read (`build-deps.ts`). An IMAP source signing in with a password names no
 * Microsoft registration, so there is nothing to ask.
 */
export function applianceAddressSource(
  source: ApplianceSource,
  env: NodeJS.ProcessEnv = process.env,
): { readonly address: string | undefined; readonly source: AddressSource } {
  const graphCreds: GraphEntraCredsAsFound = {
    clientId: env.OAUTH2_CLIENT_ID,
    clientSecret: env.OAUTH2_CLIENT_SECRET,
    refreshToken: env.OAUTH2_REFRESH_TOKEN,
  };
  if (source.type === 'imap-oauth2') {
    const tenantId = env.OAUTH2_TENANT_ID;
    return {
      address: source.user,
      source: tenantId && env.OAUTH2_CLIENT_ID ? { family: 'microsoft', tenantId, creds: graphCreds } : { family: 'other' },
    };
  }
  if (source.type === 'graph-mail') {
    return {
      address: source.mailbox,
      source: { family: 'microsoft', tenantId: source.tenantId ?? env.OAUTH2_TENANT_ID ?? 'common', creds: graphCreds },
    };
  }
  if (source.type === 'gmail') {
    return {
      address: source.user,
      source: {
        family: 'google',
        creds: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          refreshToken: env.GOOGLE_MAIL_REFRESH_TOKEN,
          serviceAccountKey: env.GOOGLE_SERVICE_ACCOUNT_KEY,
          appPassword: env.GOOGLE_MAIL_APP_PASSWORD,
        },
      },
    };
  }
  return { address: source.user ?? source.mailbox, source: { family: 'other' } };
}
