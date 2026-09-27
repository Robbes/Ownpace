// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * TEST FIXTURES DESTROYED ON A JMAP SERVER, BY ID, NEVER THROUGH `removeItem`.
 *
 * Since workplan 0149 T3 a target removes nothing without the version it
 * recorded when it wrote the item: removal fails closed (the owner's D1). An
 * integration suite that clears out what an earlier test, or an earlier run,
 * left behind has no such version, because it only listed what is there, and
 * the product is right to refuse it. A suite's own fixtures are not anybody's
 * data, so the cleanup asks the server itself, as a harness does, and the
 * product's removal path stays the only one, with its check.
 *
 * Addressed exactly as the targets address the server: the account matched by
 * name before `primaryAccounts`, and `<base>/jmap` rather than the session's
 * `apiUrl`, which Stalwart advertises as an unroutable address.
 */

import { loadJmapSession } from '../jmap-session.ts';

const CAPABILITY = {
  ContactCard: 'urn:ietf:params:jmap:contacts',
  FileNode: 'urn:ietf:params:jmap:filenode',
} as const;

export async function destroyJmapFixtures(options: {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  readonly type: keyof typeof CAPABILITY;
  readonly ids: readonly string[];
}): Promise<void> {
  if (options.ids.length === 0) return;
  const capability = CAPABILITY[options.type];
  const authorization = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`;
  const session = (await loadJmapSession(`${options.baseUrl}/.well-known/jmap`, authorization)) as {
    readonly accounts?: Record<string, { readonly name?: string; readonly email?: string }>;
    readonly primaryAccounts?: Record<string, string>;
  };
  const accountId =
    Object.entries(session.accounts ?? {}).find(
      ([, account]) => account.email === options.username || account.name === options.username,
    )?.[0] ?? session.primaryAccounts?.[capability];
  if (!accountId) throw new Error(`No JMAP account for ${options.username} to clean fixtures out of.`);

  const apiUrl = options.baseUrl.endsWith('/') ? `${options.baseUrl}jmap` : `${options.baseUrl}/jmap`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', capability],
      methodCalls: [[`${options.type}/set`, { accountId, destroy: options.ids }, 'c1']],
    }),
  });
  if (!response.ok) {
    throw new Error(`Destroying ${options.type} fixtures failed: HTTP ${response.status}`);
  }
}
