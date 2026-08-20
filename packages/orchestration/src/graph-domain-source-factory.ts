// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The three Graph domain sources, finally wired (workplan 0054).
 *
 * `GraphCalendarSource`, `GraphContactsSource` and `GraphDriveSource` have
 * existed in `@openmig/connectors` — implemented, unit-tested, exported — with
 * ZERO production call sites: config types that parsed (`graph-calendar`,
 * `graph-contacts`) fell through to the DAV endpoint resolver, which demands
 * a URL and a password a Graph config does not have, and OneDrive
 * (`graph-drive`) had no config type at all. The feature matrix listed the
 * first two as working; the matrix's own rule ("when this document and the
 * code disagree, the code is right") applied to itself.
 *
 * This factory is the missing seam, shaped exactly like the mail one
 * (`buildGraphMailSourceFrom`): the same Entra app registration, the same two
 * flows chosen by what is set — a refresh token selects the delegated
 * per-product scope, a client secret selects client-credentials with
 * `.default` — and the same refusal when a `mailbox` (a /users/{address}
 * read, application permissions only) is combined with the delegated flow.
 */

import { delegatedFlowCannotReadMailbox, entraClientIdMissing, entraFlowNotChosen } from '@openmig/shared';
import type {
  CalendarSource,
  ContactSource,
  FileSource,
  ThrottleLimiter,
} from '@openmig/shared';
import {
  GraphCalendarSource,
  GraphContactsSource,
  GraphDriveSource,
  createTokenProvider,
} from '@openmig/connectors';

/** Where the read is aimed: the tenant, and optionally WHOSE store (/users). */
export interface GraphDomainEndpoint {
  readonly tenantId: string;
  readonly baseUrl?: string | undefined;
  readonly mailbox?: string | undefined;
}

/** The Entra registration's values, as the caller found them. */
export interface GraphEntraCredsAsFound {
  readonly clientId?: string | undefined;
  readonly clientSecret?: string | undefined;
  readonly refreshToken?: string | undefined;
}

/** The delegated scope per product; client-credentials always uses `.default`. */
const DELEGATED_SCOPES = {
  calendar: 'https://graph.microsoft.com/Calendars.Read offline_access',
  contacts: 'https://graph.microsoft.com/Contacts.Read offline_access',
  drive: 'https://graph.microsoft.com/Files.Read offline_access',
} as const;

function graphTokenProviderFor(
  product: keyof typeof DELEGATED_SCOPES,
  productLabel: string,
  endpoint: GraphDomainEndpoint,
  creds: GraphEntraCredsAsFound,
) {
  if (!creds.clientId) {
    throw entraClientIdMissing(productLabel, 'OAUTH2_CLIENT_ID');
  }
  if (!creds.clientSecret && !creds.refreshToken) {
    throw entraFlowNotChosen(productLabel, 'OAUTH2_CLIENT_SECRET', 'OAUTH2_REFRESH_TOKEN');
  }
  // The mail factory's lesson, verbatim in spirit: a /users/{address} read is
  // only possible under application permissions, and with a refresh token
  // present Graph answers an access-denied that says nothing about the cause.
  if (endpoint.mailbox !== undefined && creds.refreshToken) {
    // One sentence, not two. This said the same thing as the mail factory's
    // refusal in slightly different words — "the DELEGATED flow can only read"
    // against "that is the DELEGATED flow and can only read" — which is the
    // drift a shared contract exists to stop. `store` stays a parameter
    // because it genuinely differs: this factory also serves calendar,
    // contacts and drive, where "mailbox" would be wrong.
    throw delegatedFlowCannotReadMailbox({
      subject: productLabel,
      mailbox: endpoint.mailbox,
      refreshTokenField: 'OAUTH2_REFRESH_TOKEN',
      clientSecretField: 'OAUTH2_CLIENT_SECRET',
      store: 'store',
    });
  }
  return createTokenProvider({
    tokenEndpoint: `https://login.microsoftonline.com/${endpoint.tenantId}/oauth2/v2.0/token`,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: creds.refreshToken,
    tenantId: endpoint.tenantId,
    scope: creds.refreshToken ? DELEGATED_SCOPES[product] : 'https://graph.microsoft.com/.default',
  });
}

export function buildGraphCalendarSourceFrom(
  endpoint: GraphDomainEndpoint,
  creds: GraphEntraCredsAsFound,
  throttleLimiter?: ThrottleLimiter,
): CalendarSource {
  const tokenProvider = graphTokenProviderFor('calendar', 'graph-calendar source', endpoint, creds);
  return new GraphCalendarSource(tokenProvider, endpoint.tenantId, {
    ...(endpoint.baseUrl === undefined ? {} : { baseUrl: endpoint.baseUrl }),
    ...(throttleLimiter === undefined ? {} : { throttleLimiter }),
    ...(endpoint.mailbox === undefined ? {} : { mailbox: endpoint.mailbox }),
  });
}

export function buildGraphContactsSourceFrom(
  endpoint: GraphDomainEndpoint,
  creds: GraphEntraCredsAsFound,
  throttleLimiter?: ThrottleLimiter,
): ContactSource {
  const tokenProvider = graphTokenProviderFor('contacts', 'graph-contacts source', endpoint, creds);
  return new GraphContactsSource(tokenProvider, endpoint.tenantId, {
    ...(endpoint.baseUrl === undefined ? {} : { baseUrl: endpoint.baseUrl }),
    ...(throttleLimiter === undefined ? {} : { throttleLimiter }),
    ...(endpoint.mailbox === undefined ? {} : { mailbox: endpoint.mailbox }),
  });
}

/** OneDrive/SharePoint (workplan 0054): the drive connector's different ctor shape, same seam. */
export function buildGraphDriveSourceFrom(
  endpoint: GraphDomainEndpoint,
  creds: GraphEntraCredsAsFound,
  throttleLimiter?: ThrottleLimiter,
): FileSource {
  const tokenProvider = graphTokenProviderFor('drive', 'graph-drive source', endpoint, creds);
  return new GraphDriveSource(
    {
      tokenProvider,
      tenantId: endpoint.tenantId,
      ...(endpoint.baseUrl === undefined ? {} : { baseUrl: endpoint.baseUrl }),
      ...(endpoint.mailbox === undefined ? {} : { mailbox: endpoint.mailbox }),
    },
    throttleLimiter,
  );
}

/** The env-specific half, shared by the three appliance build sites. */
export function graphEntraCredsFromEnv(): GraphEntraCredsAsFound {
  return {
    clientId: process.env.OAUTH2_CLIENT_ID,
    clientSecret: process.env.OAUTH2_CLIENT_SECRET,
    refreshToken: process.env.OAUTH2_REFRESH_TOKEN,
  };
}
