// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE INFORMAL LAYER: A PERSON'S OWN PAGES, WITH *JE* (workplan 0176 T7, §11;
 * the owner, 2026-11-26: *"Yes"* to *je* or *u* as the member chooses, and
 * D8 (a), per person).
 *
 * A member chooses, per person, how a person's own pages speak to them:
 * Dutch with *u*, Dutch with *je*, or English. A mother may be *je* and a
 * grandfather *u* in one family. This is the *je*: the twin of every Dutch
 * sentence a person's link page and progress page say to the reader with *u*
 * or *uw*, and of nothing else. A sentence that needs no *u* has no twin
 * (*Leg dit klaar*, *Er is geen haast*, §6): the Dutch says it in both.
 * English has one *you*, and no layer.
 *
 * **Not an area.** It defines no key of its own: each key is a Dutch area's,
 * and the page reads this first when the register is informal, then the
 * Dutch. So it is not composed into `../strings.ts`
 * (`../one-area-per-key.unit.test.ts` leaves it out), and it is the
 * dictionary, not a speaker of it (`../a-word-nobody-says.unit.test.ts`).
 *
 * **How a twin is made (§15's pattern).** *U* becomes *je*, and *uw* becomes
 * *je*; *jouw* only where it carries stress, as in a contrast (*van jouw oude
 * aanbieder, niet van ons*). Where *je* needs more, only that changes: a verb
 * before *je* loses its *-t* (*kunt u* → *kun je*, *gaat u* → *ga je*); the
 * reflexive *zich* after *u* is *je* (*u zich aanmeldt* → *je je aanmeldt*);
 * a *u* that means two people is *jullie* (*als u elkaar ziet* → *als jullie
 * elkaar zien*). Nothing else in a sentence changes, so the owner reads the
 * same sentence twice, and a twin stays the twin of its sentence:
 * `../every-u-has-its-je.unit.test.ts` holds both to that.
 *
 * **A draft until T7's main line.** Nothing reads this yet. The main line
 * stores the register per person, sends it with the link's answer, and has
 * `../index.tsx` read this first for a person whose register is *je*, and
 * `../active-locale.ts` too, which words the answers a report can meet. The
 * server's own sentences on these pages, and its endings after a sign-in,
 * are the main line's as well. The Dutch below is step A's, which the owner
 * read on 2026-11-26 (*"Step A (#2180): ok"*), turned to *je*; the owner
 * reads the twins in their pull request.
 */

import type { StringKey } from '../strings.ts';

export const nl: Readonly<Partial<Record<StringKey, string>>> = {};
