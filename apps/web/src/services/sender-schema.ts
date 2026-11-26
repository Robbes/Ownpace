// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHO SENT A PERSON THEIR LINK, AS THE API ANSWERS IT (workplan 0176 §7, T3
 * and T6): the name the member gave, how the person knows them, and their own
 * number, each null when not given. The link page's answer (`grant-service.ts`)
 * and the progress page's (`view-service.ts`) carry the same shape, so it is
 * read in one place.
 *
 * A relation this page has no words for reads as none, rather than failing a
 * page whose question is still worth asking.
 */
import { z } from 'zod';
import { isSenderRelation, type SenderRelation } from '@openmig/shared';

export const SenderSchema = z.object({
  name: z.string().nullable(),
  relation: z
    .string()
    .nullable()
    .transform((r): SenderRelation | null => (isSenderRelation(r) ? r : null)),
  phone: z.string().nullable(),
});
export type Sender = z.infer<typeof SenderSchema>;
