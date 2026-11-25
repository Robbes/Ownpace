// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * READING THE ADDRESSES THAT RECEIVE MAIL, from Graph and from Gmail
 * (workplan 0171 §7.2, T10). The parsing is `@openmig/shared`'s
 * (`addressesFromGraphUser`, `addressesFromGmailSendAs`); this file asks and
 * sorts each answer into the one state the screen can act on.
 *
 * A refusal the person can fix is `not_read`, with what fixes it: a Microsoft
 * connection consented before alpha.20 lacks `User.Read` (D7) and must be
 * reconnected; a Google project without the Gmail API answers
 * `SERVICE_DISABLED` (§12 question 3). Anything else is `failed` in the
 * provider's own words. None of them is an empty list (hard rule 9).
 *
 * READ-ONLY: two GETs. Nothing is written, stored or sent anywhere else.
 */

import {
  addressesFromGmailSendAs,
  addressesFromGraphUser,
  type ReceivingAddresses,
} from '@openmig/shared';
import type { HttpClient } from './dav-http.types.ts';
import { graphRefusalBody } from './graph-refusal.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1';

/** The message of whatever a token provider threw. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Microsoft's sign-in refusing a scope the person never consented to:
 * `AADSTS65001` (*"The user or administrator has not consented"*) and
 * `invalid_scope`/`consent_required` as the token endpoint spells it.
 */
export function isMissingMicrosoftConsent(message: string): boolean {
  return /AADSTS65001|consent_required|invalid_scope|has not consented/i.test(message);
}

/**
 * The mailbox's own user in Graph: `/me` for a delegated connection, or
 * `/users/{mailbox}` under application permissions.
 */
export async function readGraphReceivingAddresses(
  token: () => Promise<string>,
  http: HttpClient,
  options: { readonly mailbox?: string } = {},
): Promise<ReceivingAddresses> {
  let bearer: string;
  try {
    bearer = await token();
  } catch (err) {
    const message = messageOf(err);
    return isMissingMicrosoftConsent(message)
      ? { state: 'not_read', provider: 'Microsoft', why: 'reconnect' }
      : { state: 'failed', provider: 'Microsoft', reason: message };
  }
  const who = options.mailbox === undefined ? 'me' : `users/${encodeURIComponent(options.mailbox)}`;
  let res;
  try {
    res = await http.request({
      url: `${GRAPH}/${who}?$select=mail,userPrincipalName,proxyAddresses`,
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
    });
  } catch (err) {
    return { state: 'failed', provider: 'Microsoft', reason: messageOf(err) };
  }
  if (res.status === 403 || res.status === 401) {
    // A token without the scope for this read: consented before alpha.20.
    return { state: 'not_read', provider: 'Microsoft', why: 'reconnect' };
  }
  if (res.status !== 200) {
    return { state: 'failed', provider: 'Microsoft', reason: `Graph answered ${res.status}: ${graphRefusalBody(res.body)}` };
  }
  try {
    return { state: 'read', provider: 'Microsoft', addresses: addressesFromGraphUser(JSON.parse(res.body)) };
  } catch (err) {
    return { state: 'failed', provider: 'Microsoft', reason: messageOf(err) };
  }
}

/** Google's answer naming an API not enabled on the project. */
export function isGmailApiOff(body: string): boolean {
  return /SERVICE_DISABLED|accessNotConfigured|has not been used in project|it is disabled/i.test(body);
}

/** Gmail's `users.settings.sendAs.list` for the mailbox. */
export async function readGmailReceivingAddresses(
  token: () => Promise<string>,
  http: HttpClient,
  user: string = 'me',
): Promise<ReceivingAddresses> {
  let bearer: string;
  try {
    bearer = await token();
  } catch (err) {
    const message = messageOf(err);
    return /invalid_scope|insufficient/i.test(message)
      ? { state: 'not_read', provider: 'Google', why: 'reconnect' }
      : { state: 'failed', provider: 'Google', reason: message };
  }
  let res;
  try {
    res = await http.request({
      url: `${GMAIL}/users/${encodeURIComponent(user)}/settings/sendAs`,
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
    });
  } catch (err) {
    return { state: 'failed', provider: 'Google', reason: messageOf(err) };
  }
  if (res.status === 403 && isGmailApiOff(res.body)) {
    return { state: 'not_read', provider: 'Google', why: 'api_off' };
  }
  if (res.status === 403 || res.status === 401) {
    return { state: 'not_read', provider: 'Google', why: 'reconnect' };
  }
  if (res.status !== 200) {
    return { state: 'failed', provider: 'Google', reason: `Gmail answered ${res.status}: ${res.body.slice(0, 300)}` };
  }
  try {
    return { state: 'read', provider: 'Google', addresses: addressesFromGmailSendAs(JSON.parse(res.body)) };
  } catch (err) {
    return { state: 'failed', provider: 'Google', reason: messageOf(err) };
  }
}
