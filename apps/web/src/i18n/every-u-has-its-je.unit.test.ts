// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * EVERY *U* HAS ITS *JE* (workplan 0176 T7, §11, §16; the owner, 2026-11-26:
 * *"Yes"* to *je* or *u* as the member chooses, and D8 (a), per person).
 *
 * A member chooses how a person's own pages speak to that person, and a page
 * that says *je* in one sentence and *u* in the next reads as a page somebody
 * else wrote. So every Dutch sentence a person's link page and progress page
 * say to the reader with *u* or *uw* has its *je* twin in the informal layer
 * (`informal.ts`), the layer holds nothing else, no twin says *u* or
 * *uw* to the reader, and no formal sentence of those pages says *je*.
 *
 * WHICH SENTENCES. The keys a person's two pages say are read from the code
 * that draws them, three ways: every key of a person's own areas (the
 * prefixes below: `grant.person.*`, `view.person.*`, the stop, the password
 * card, *Report this link* …); every key named by a file the pages draw
 * whole (the link page's own file, the password card, the new address …);
 * and every key the progress page's file names, but those only an old link's
 * page says. The parts a person's page shares with the member's screens say
 * a person's words inside it (`components/persons-page.tsx`); the few they
 * say there that no prefix or file above holds are listed by name. So a new
 * sentence on either page is a key here at once, and needs its twin.
 *
 * A TWIN IS ITS SENTENCE, TURNED. Word for word the formal sentence, with
 * *u*, *uw* and a reflexive *zich* turned to *je*, *jouw*, *jij* or
 * *jullie*, and a verb before *je* without its *-t* (*kunt u* → *kun je*).
 * Anything more is named below with its reason, and so is every *jouw* or
 * *jij*, which only stand where they carry stress (§15). So a formal sentence
 * changed later, by the owner or anybody, fails here until its twin follows,
 * and every rule a formal sentence is held to (*kopiëren*, *aanbieder*, no
 * *verhuizen*) holds its twin too.
 *
 * QUOTED WORDS ARE SOMEBODY ELSE'S. A *u* inside «…», Google's own words once
 * the owner's hand test has them (T0, §15), does not address the reader, and
 * is not read here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STRINGS } from './strings.ts';
import { DOMAIN_STRING_KEY } from './domain-words.ts';
import { NL_JE } from './informal.ts';

const en = STRINGS.en as Record<string, string>;
const nl = STRINGS.nl as Record<string, string>;
const twins = NL_JE as Record<string, string>;
const KEYS = Object.keys(en);

/**
 * A PERSON'S OWN AREAS. Every key under these is said on a person's link page
 * or progress page, and on no page of the member's alone: the steps of the
 * link page, the password card, the provider's words before its button, the
 * progress page's own lines, its stop and what came after, a destination's
 * password, the new address, *Report this link*, and the two sentences for
 * a link the page could not read or reach (`link.*`, `answer.*`, which a
 * report's answer can meet).
 */
const A_PERSONS_OWN_AREAS = [
  'grant.person.',
  'grant.step',
  'grant.state.',
  'grant.reads.',
  'grant.readOnly',
  'grant.scopeIntro',
  'grant.scope.',
  'grant.signInAs',
  'grant.connecting',
  'grant.cirrux.',
  'grant.password.',
  'grant.apple.',
  'grant.nextcloud.',
  'view.person.',
  'view.state.',
  'view.failure.',
  'view.refresh.',
  'view.stop.',
  'view.stopped.',
  'view.withdrawn.',
  'view.destination.',
  'addresses.grant.',
  'linkReport.',
  'link.',
  'answer.',
  // Step B: how the reader knows the sender (T3), and the link's one page (D15 (a)).
  'sender.',
  'grant.onePage.',
] as const;

/** The files a person's pages draw whole: every key they name is said there. */
const DRAWN_WHOLE = [
  '../pages/PersonGrant.tsx',
  '../components/GrantPasswordCard.tsx',
  '../components/YourNewAddress.tsx',
  '../components/ReportThisLink.tsx',
  '../services/link-refusal.ts',
  '../components/TimeBeforeStartLine.tsx',
  '../components/AccessibilityLink.tsx',
  '../components/LanguageSwitch.tsx',
  // Step B: the sender's box (T3, T6), and everything on one page (D15 (a)).
  '../components/TheSender.tsx',
  '../pages/PersonGrantOnePage.tsx',
] as const;

/**
 * The progress page's own file draws a migration's own page too: a link made
 * for one migration before 2026-10-03 (§3.2). What only that page says is
 * no person's, and keeps its *u* until those links run out (§21.3; the
 * owner's A2, 2026-11-26).
 */
const THE_PROGRESS_PAGE = '../pages/View.tsx';
const ONLY_AN_OLD_LINKS_PAGE = ['view.title', 'view.who', 'view.notStarted.why', 'view.grant.body', 'view.moved'] as const;

/**
 * What the parts shared with the member's screens say on a person's page,
 * where no area or file above names it: the frame around a person's link
 * while it loads or is refused (`Grant.tsx`), a provider's page that was not
 * its own (`grant-parts.tsx`), the line under a stage (`MigrationLines.tsx`),
 * how long while copying (`TimeWhileCopyingLine.tsx`), a fold, and the data
 * types by their names.
 */
const SHARED_ON_A_PERSONS_PAGE = [
  'grant.title',
  'grant.loading',
  'account.consent.notTheProvider',
  'confirm.progress.ofAbout',
  'confirm.progress.listedButEmpty.one',
  'confirm.progress.listedButEmpty.many',
  'people.line.leftAsIs',
  'people.line.checkPassed',
  'timeLeft.slowedBy',
  'fold.why',
  ...Object.values(DOMAIN_STRING_KEY),
] as const;

/** Every key a file names: quoted, and as a plural (`plural('view.copied', n)`). */
function keysNamedIn(file: string): string[] {
  const code = readFileSync(join(import.meta.dirname, file), 'utf8');
  const named = new Set<string>();
  for (const m of code.matchAll(/['"`]([a-zA-Z]+(?:\.[A-Za-z0-9_-]+)+)['"`]/g)) named.add(m[1]!);
  for (const m of code.matchAll(/plural\(\s*['"]([A-Za-z0-9_.-]+)['"]/g)) {
    named.add(`${m[1]}.one`);
    named.add(`${m[1]}.many`);
  }
  return [...named].filter((key) => key in en);
}

/**
 * WHAT THE MEMBER'S SCREEN SAYS IN THE PERSON'S VOICE (§11: *the message of
 * §12*). The message the member sends with a link is drawn on the member's
 * own screen, and worded as the person's pages are: with *je* where they say
 * *je* (`MappingLinksPanel.tsx`).
 */
const IN_THEIR_VOICE_ON_THE_MEMBERS_SCREEN = ['message.toPerson'] as const;

/** The keys a person's two pages say, in the dictionary's order. */
const A_PERSONS_PAGES: readonly string[] = (() => {
  const said = new Set<string>([
    ...KEYS.filter((key) => A_PERSONS_OWN_AREAS.some((area) => key.startsWith(area))),
    ...DRAWN_WHOLE.flatMap(keysNamedIn),
    ...keysNamedIn(THE_PROGRESS_PAGE).filter((key) => !(ONLY_AN_OLD_LINKS_PAGE as readonly string[]).includes(key)),
    ...SHARED_ON_A_PERSONS_PAGE,
    ...IN_THEIR_VOICE_ON_THE_MEMBERS_SCREEN,
  ]);
  return KEYS.filter((key) => said.has(key));
})();

/** Somebody else's words, quoted: not the page speaking to its reader. */
const unquoted = (s: string): string => s.replace(/«[^»]*»/g, '');
/** *U*, *uw* or *uzelf*, as a word: the page speaking to its reader formally. */
const FORMAL = /(?<![\p{L}\p{N}])(u|uw|uzelf)(?![\p{L}\p{N}])/iu;
/** *Je*, *jij*, *jou*, *jouw*, *jullie* or *jezelf*, as a word: the page speaking informally. */
const INFORMAL = /(?<![\p{L}\p{N}])(je|jij|jou|jouw|jullie|jezelf)(?![\p{L}\p{N}])/iu;
const addressesTheReader = (s: string): boolean => FORMAL.test(unquoted(s));

/**
 * WHERE *JE* NEEDS MORE THAN THE PRONOUN, with its reason. The formal words,
 * and what the twin says in their place; the rest of the sentence is turned
 * as any other.
 */
const MORE_THAN_THE_PRONOUN: Readonly<Record<string, { readonly formal: string; readonly twin: string; readonly why: string }>> = {
  'grant.person.wait.ask': {
    formal: 'als u elkaar ziet',
    twin: 'als jullie elkaar zien',
    why: 'This u is two people, the reader and {who}: informal Dutch says jullie, and its verb is plural.',
  },
  'message.toPerson': {
    formal: 'Bel mij als u wilt beginnen',
    twin: 'Bel me als je wilt beginnen',
    why: 'The sender speaks here, not the page: with je, they say me, as §15 gives the message.',
  },
};

/** WHERE *JOUW* OR *JIJ* CARRIES STRESS (§15: *jouw only where it carries stress*). Everywhere else, *je*. */
const WHERE_IT_CARRIES_STRESS: Readonly<Record<string, string>> = {
  'view.person.pause.ceiling.why': 'A contrast: the limit is the old provider’s, not ours (van jouw oude aanbieder, niet van ons).',
};

/** A sentence as words: its placeholders, its words with their hyphens and apostrophes, and each other sign. */
const words = (s: string): string[] => s.toLocaleLowerCase('nl').match(/\{[^}]*\}|[\p{L}\p{N}’'-]+|[^\s\p{L}\p{N}]/gu) ?? [];
const FORMAL_PRONOUN = new Set(['u', 'uw', 'zich']);
const INFORMAL_PRONOUN = new Set(['je', 'jouw', 'jij', 'jullie']);
/** A verb before *je*, as *je* says it: *kunt* → *kun*, *ziet* → *zie*, *gaat* → *ga*. */
function beforeJe(verb: string): string {
  if (!verb.endsWith('t')) return verb;
  const stem = verb.slice(0, -1);
  return /(aa|ee|oo|uu)$/.test(stem) ? stem.slice(0, -1) : stem;
}

/** Where a twin is more than its sentence turned: the first place they part, or null where they do not. */
function parting(formal: string, twin: string): string | null {
  const f = words(formal);
  const t = words(twin);
  if (f.length !== t.length) return `${f.length} words became ${t.length}`;
  for (let i = 0; i < f.length; i++) {
    if (f[i] === t[i]) continue;
    if (FORMAL_PRONOUN.has(f[i]!) && INFORMAL_PRONOUN.has(t[i]!)) continue;
    const inverted = f[i + 1] === 'u' && (t[i + 1] === 'je' || t[i + 1] === 'jij');
    if (inverted && t[i] === beforeJe(f[i]!)) continue;
    return `«${f[i]}» became «${t[i]}»`;
  }
  return null;
}

describe('the sentences a person’s two pages say', () => {
  it('are read from the code that draws them, so an empty walk cannot pass', () => {
    for (const key of [
      'grant.person.title',
      'grant.person.see.blocked',
      'grant.password.noPhone',
      'grant.scope.mail',
      'view.person.who',
      'view.stop.title',
      'view.failure.side.source',
      'timeLeft.gmailDays',
      'linkReport.intro',
      'addresses.grant.yours',
      'answer.fault',
      'domain.email',
    ]) {
      expect(A_PERSONS_PAGES, `the walk missed ${key}`).toContain(key);
    }
    for (const area of A_PERSONS_OWN_AREAS) {
      expect(KEYS.some((key) => key.startsWith(area)), `no key is in ${area} any more`).toBe(true);
    }
  });

  it('are each in both languages', () => {
    expect(A_PERSONS_PAGES.filter((key) => en[key] === undefined || nl[key] === undefined)).toEqual([]);
  });

  it('leave out what only an old link’s page says, and what the member’s screens alone say', () => {
    for (const key of ONLY_AN_OLD_LINKS_PAGE) expect(A_PERSONS_PAGES, key).not.toContain(key);
    for (const key of ['grant.asking', 'grant.check', 'state.stage.copying', 'timeLeft.copying.days', 'pause.ceiling.why']) {
      expect(A_PERSONS_PAGES, key).not.toContain(key);
    }
  });

  it('say no je in their formal Dutch (§11)', () => {
    expect(A_PERSONS_PAGES.filter((key) => INFORMAL.test(unquoted(nl[key]!))).map((key) => `${key}: ${nl[key]}`)).toEqual([]);
  });
});

describe('every u has its je (§11, §16)', () => {
  const needed = A_PERSONS_PAGES.filter((key) => addressesTheReader(nl[key]!));

  it('every sentence of a person’s pages that says u or uw to the reader has its twin', () => {
    expect(needed.filter((key) => twins[key] === undefined).map((key) => `${key}: ${nl[key]}`)).toEqual([]);
  });

  it('and the layer holds nothing else: a key those pages say, whose Dutch needs a twin', () => {
    expect(Object.keys(twins).filter((key) => !needed.includes(key))).toEqual([]);
  });

  it('in the dictionary’s order, so a key is at the same place in both', () => {
    expect(Object.keys(twins)).toEqual(KEYS.filter((key) => key in twins));
  });

  it('no twin says u or uw where it addresses the reader', () => {
    expect(Object.entries(twins).filter(([, twin]) => addressesTheReader(twin)).map(([key, twin]) => `${key}: ${twin}`)).toEqual([]);
  });

  it('each twin is its sentence with the pronouns turned, and nothing more but what is named', () => {
    const parted: string[] = [];
    for (const [key, twin] of Object.entries(twins)) {
      const formal = nl[key];
      if (formal === undefined) continue;
      const more = MORE_THAN_THE_PRONOUN[key];
      if (more && !formal.includes(more.formal)) {
        parted.push(`${key}: the formal no longer says «${more.formal}»`);
        continue;
      }
      const turned = more ? formal.replace(more.formal, more.twin) : formal;
      const where = parting(turned, twin);
      if (where !== null) parted.push(`${key}: ${where}\n  formal: ${formal}\n  twin:   ${twin}`);
    }
    expect(parted).toEqual([]);
  });

  it('and says jouw or jij only where it carries stress, each with its reason', () => {
    const stressed = Object.keys(twins).filter((key) => /(?<![\p{L}\p{N}])(jouw|jij)(?![\p{L}\p{N}])/iu.test(twins[key]!));
    expect(stressed).toEqual(Object.keys(WHERE_IT_CARRIES_STRESS));
  });

  it('turns a verb before je as je says it', () => {
    expect(['kunt', 'ziet', 'gaat', 'doet', 'wilt', 'hoeft', 'stopt', 'kent', 'twijfelt'].map(beforeJe)).toEqual([
      'kun',
      'zie',
      'ga',
      'doe',
      'wil',
      'hoef',
      'stop',
      'ken',
      'twijfel',
    ]);
    // A verb whose stem ends in t keeps it before je (weet u → weet je): the word does not change.
    expect(parting('Weet u het niet?', 'Weet je het niet?')).toBeNull();
    expect(parting('Kunt u dit?', 'Kun je dit?')).toBeNull();
    // A t dropped anywhere else is a change, and so is a word changed beside a pronoun.
    expect(parting('Het kopiëren wacht.', 'Het kopiëren wach.')).not.toBeNull();
    expect(parting('U kunt deze pagina sluiten.', 'Je kan deze pagina sluiten.')).not.toBeNull();
  });
});
