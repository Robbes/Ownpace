// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * HOW A PERSON'S PAGE SPEAKS TO THEM, AS THE API ANSWERS IT (workplan 0176
 * §11, T7; D8 (a)): the language the member chose for the person, which the
 * page opens in until the reader picks another with the switch, and the
 * register of its Dutch, *u* or *je*. The link page's answer
 * (`grant-service.ts`) and the progress page's (`view-service.ts`) carry both,
 * read here once.
 *
 * Absent, from a server before alpha.21's step B, or a value this page does
 * not know: no language, so the browser's, with *u*, as before.
 */
import { z } from 'zod';

export const PageVoiceFields = {
  language: z.enum(['nl', 'en']).nullable().optional().catch(null),
  register: z.enum(['formal', 'informal']).optional().catch('formal'),
};
