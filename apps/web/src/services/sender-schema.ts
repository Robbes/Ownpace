// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHO SENT A PERSON THEIR LINK, AS THE API ANSWERS IT (workplan 0176 §7, T3
 * and T6): the name the member gave and their own number, each null when not
 * given. The link page's answer (`grant-service.ts`) and the progress page's
 * (`view-service.ts`) carry the same shape, so it is read in one place.
 *
 * Nothing of how the person knows the member (D7, reversed by the owner on
 * 2026-11-26): a field the answer might still carry is not read.
 */
import { z } from 'zod';

export const SenderSchema = z.object({
  name: z.string().nullable(),
  phone: z.string().nullable(),
});
export type Sender = z.infer<typeof SenderSchema>;
