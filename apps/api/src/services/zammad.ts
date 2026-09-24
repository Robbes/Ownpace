// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE OWNER'S ZAMMAD (workplan 0130 D1): where a problem report becomes a
 * ticket the owner can see, answer and follow up.
 *
 * Three variables, and no defaults for the first two:
 *
 * - `ZAMMAD_URL`: the helpdesk's address, https (or `http://localhost`, to
 *   develop against a local one);
 * - `ZAMMAD_TOKEN`: an API token allowed to create tickets, kept in the
 *   deployment's secrets. Sent from this server only, never to a browser;
 * - `ZAMMAD_GROUP`: the group a new ticket lands in, `Users` when unset
 *   (the group a fresh Zammad starts with).
 *
 * Without the first two, the form is not offered at all.
 */

import { log } from '@openmig/shared';

export interface ZammadConfig {
  readonly url: string;
  readonly token: string;
  readonly group: string;
}

/** Zammad is configured, but not in a way this server may use. */
export class ZammadMisconfigured extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZammadMisconfigured';
  }
}

/** Zammad answered, and not with a ticket. */
export class ZammadRefused extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Zammad answered ${status}`);
    this.name = 'ZammadRefused';
    this.status = status;
  }
}

/** The configuration, undefined when reporting is not set up, or a refusal to use a bad one. */
export function zammadConfigFrom(env: NodeJS.ProcessEnv = process.env): ZammadConfig | undefined {
  const url = env.ZAMMAD_URL?.trim();
  const token = env.ZAMMAD_TOKEN?.trim();
  if (!url || !token) return undefined;
  // The token travels with every request; over plain http anybody on the path
  // could read it and open tickets, or read them, as the owner.
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url)) {
    throw new ZammadMisconfigured(
      'ZAMMAD_URL must be an https address (http is accepted for localhost only): the API ' +
        'token is sent with every ticket, and over plain http it can be read on the way.',
    );
  }
  return { url: url.replace(/\/+$/, ''), token, group: env.ZAMMAD_GROUP?.trim() || 'Users' };
}

/**
 * The configuration a door may send with, or undefined when reporting is not
 * set up or is set up wrongly, and then said in the log. Every door asks this
 * and nothing else: the signed-in form (0130) and a link's report (0108 T8 (d)).
 */
export function reportingConfig(env: NodeJS.ProcessEnv | undefined): ZammadConfig | undefined {
  try {
    return zammadConfigFrom(env);
  } catch (err) {
    log.error(`[api] problem reports are switched off: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * The helpdesk's own user: the one the API token belongs to
 * (`GET /api/v1/users/me`). A link report sent without a reply address is
 * filed under it (the owner, 2026-09-24): Zammad needs a customer for every
 * ticket, and this one is the owner's own, so nothing is sent to an address
 * nobody gave.
 */
export async function zammadOwnUserId(config: ZammadConfig, fetchImpl: typeof fetch = fetch): Promise<number> {
  const response = await fetchImpl(`${config.url}/api/v1/users/me`, {
    method: 'GET',
    headers: { Authorization: `Token token=${config.token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new ZammadRefused(response.status);
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== 'number') throw new ZammadRefused(response.status);
  return body.id;
}

/** Create the ticket, and answer its number. */
export async function createZammadTicket(
  config: ZammadConfig,
  ticket: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${config.url}/api/v1/tickets`, {
    method: 'POST',
    headers: {
      Authorization: `Token token=${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(ticket),
    // A helpdesk that does not answer must not hold the person's request
    // open indefinitely.
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new ZammadRefused(response.status);
  const body = (await response.json()) as { number?: unknown };
  if (typeof body.number !== 'string' && typeof body.number !== 'number') {
    throw new ZammadRefused(response.status);
  }
  return String(body.number);
}
