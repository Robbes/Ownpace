// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MIGRATED PERSON'S OWN ADDRESS CHANGE, BY THEIR LINK (workplan 0168 §4.4,
 * D6; ADR-0035, ADR-0055).
 *
 * A person who has a link and no account confirms their row of the address
 * changes on the pages they already reach: the grant page and the progress
 * page, each of which says *Your new address: ‹address›. Is that right?*. The
 * link is the credential, so this goes through `linkClient`, never the
 * signed-in client.
 *
 * The person's payload of `GET /api/grant/{link}` and `GET /api/view/{link}`
 * carries `addressChanges`: the rows linked to this person and nobody else's,
 * each `oldKey`, `oldAddress`, `newAddress` and `state`
 * (`apps/api/src/routes/link-address-changes.ts`, `LinkAddressChange` in
 * `openapi.yaml`). `PUT /api/{grant|view}/{link}/address-changes/{oldKey}`
 * takes `{ state }` and nothing else, and answers the row in the same shape.
 * The field is optional here, so a server a release behind, which does not
 * send it, leaves the pages saying nothing about an address.
 */

import { z } from 'zod';
import { linkClient as client } from './link-client.ts';

export const LinkAddressChangeSchema = z.object({
  oldKey: z.string(),
  oldAddress: z.string(),
  newAddress: z.string(),
  state: z.enum(['proposed', 'confirmed']),
});
export type LinkAddressChange = z.infer<typeof LinkAddressChangeSchema>;

/** The person's rows, where the payload carries them; absent from a server that does not. */
export const LinkAddressChangesField = z.array(LinkAddressChangeSchema).optional();

/**
 * *Yes* confirms the row as the person's own; *Not right?* sends a confirmed
 * one back to proposed, where it changes nothing and waits for whoever set it
 * up. Answers the row as it is now.
 */
export async function answerAddressChangeByLink(
  door: 'grant' | 'view',
  link: string,
  oldKey: string,
  state: 'proposed' | 'confirmed',
): Promise<LinkAddressChange> {
  const res = await client.put(
    `/${door}/${encodeURIComponent(link)}/address-changes/${encodeURIComponent(oldKey)}`,
    { state },
  );
  return LinkAddressChangeSchema.parse(res.data);
}
