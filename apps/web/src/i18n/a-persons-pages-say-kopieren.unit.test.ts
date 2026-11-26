// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PERSON'S PAGES SAY KOPIËREN (workplan 0176 D1, D2, D14, T2; the owner,
 * 2026-11-26: *"D1 to D11: ok on the advised"*, and *"D14: yes"*).
 *
 * A person who opens a link has no account of their own. *Migreren* tells
 * that reader their mail goes away; *kopiëren* tells them the original stays,
 * which is the fact they most need. So a person's two pages, their link page
 * and their progress page, say *kopiëren*, and the member's own screens keep
 * *migreren* (`GLOSSARY.md`, the row on how much has arrived).
 *
 * Until step A, 23 of the Dutch sentences those two pages say held a form of
 * *migr-* (§21.3 of the plan), the parts they share with the member's screens
 * said ten more, and the server wrote a few itself. This lists the keys the
 * two pages say, reads the server's sentences for a person's link too, and
 * holds every one of them to the rule. What only an old link's page says is
 * left, by name, below.
 */
import { describe, it, expect } from 'vitest';
import {
  EXCHANGE_FOR_A_PERSONS_LINK,
  NO_NAMED_ACCOUNT_ON_A_PERSONS_LINK,
  PERSON_PAGE_GONE,
  accountNotReady,
  anotherAccountOnAPersonsLink,
  cannotSignInYetOnAPersonsLink,
  noNamedAccountOnAPersonsLinkAt,
  twoClientsAt,
  type Bilingual,
} from '@openmig/shared';
import { STRINGS } from './strings.ts';

const en = STRINGS.en as Record<string, string>;
const nl = STRINGS.nl as Record<string, string>;

/** Any form of *migreren*: *migratie*, *migraties*, *migreert*, *gemigreerd*. */
const MIGR = /migr/i;
/** The member's word for a pass, which a person's page does not say (D14). */
const RONDE = /\bronde/i;

/** Each Dutch sentence of a list that says what it must not, by key. */
function saying(keys: readonly string[], word: RegExp): string[] {
  return keys.filter((k) => nl[k] !== undefined && word.test(nl[k]!)).map((k) => `${k}: ${nl[k]}`);
}

/**
 * THE TWO PAGES' OWN, the 23 of §21.3, as they are named today. One of them
 * leaves (`grant.person.asking`); the rest are said in D1's words.
 */
const THE_TWENTY_THREE = [
  // The link page.
  'grant.person.yourPage',
  'grant.person.keepIt',
  // The progress page's title and frame.
  'view.person.title',
  'view.person.who',
  'view.person.none',
  'view.person.others',
  'view.person.grant.body',
  // Its states and counts.
  'view.state.active',
  'view.state.paused',
  'view.state.done',
  'view.notStarted',
  'view.copied.one',
  'view.copied.many',
  // Its failures.
  'view.failure.quotaExceeded',
  'view.failure.policyRefused',
  'view.failure.tooLarge',
  // Its stop.
  'view.state.withdrawn',
  'view.grant.whatHappens',
  'view.grant.wholeApp',
  // Report this link.
  'linkReport.sentWith',
  'linkReport.next.withdraw',
] as const;

/** The sentences §15 adds to the link page, in step A. */
const THE_LINK_PAGE = [
  'grant.person.ownpace',
  'grant.person.title',
  'grant.person.sender',
  'grant.person.whatOne',
  'grant.person.whatMany',
  'grant.person.fact.stays',
  'grant.person.fact.reads',
  'grant.person.fact.noHurry',
  'grant.person.told',
  'grant.person.yes',
  'grant.person.notYet',
  'grant.person.wait.title',
  'grant.person.wait.ask',
  'grant.person.wait.until',
  'grant.person.wait.unknown',
  'grant.person.accounts.title',
  'grant.person.connectAccount',
  'grant.person.again',
  'grant.person.again.alpha',
  'grant.person.ready.title',
  'grant.person.ready.address',
  'grant.person.ready.password',
  'grant.person.ready.passwordOf',
  'grant.person.ready.typeIt',
  'grant.person.ready.phone',
  'grant.person.ready.code',
  'grant.person.ready.unknownPassword',
  'grant.person.ready.together',
  'grant.person.see.title',
  'grant.person.see.signIn',
  'grant.person.see.warning',
  'grant.person.see.goOn',
  'grant.person.see.onlyHere',
  'grant.person.see.broader',
  'grant.person.see.ticks',
  'grant.person.see.blocked',
  'grant.person.see.stop',
  'grant.person.see.next',
  'grant.person.signIn',
  'grant.person.ratherNot',
  'grant.person.ratherNot.title',
  'grant.person.ratherNot.body',
  'grant.step',
  'grant.step.next',
  'grant.step.back',
] as const;

/** The sentences §15 adds to the progress page, in step A: its first line, its refresh, its stop. */
const THE_PROGRESS_PAGE = [
  'view.person.first.nothingToDo',
  'view.person.first.renew',
  'view.person.first.stopped',
  'view.refresh.at',
  'view.refresh.failed',
  'view.person.account.only',
  'view.person.account.only.inSentence',
  'view.person.account',
  'view.grant.withdraw',
  'view.grant.withdrawing',
  'view.stop.title',
  'view.stop.body',
  'view.stop.body.anywhere',
  'view.stop.final',
  'view.stop.no',
  'view.stop.yes',
  'view.stopped.title',
  'view.stopped.confirmed',
  'view.stopped.notConfirmed',
  'view.stopped.nothingDeleted',
  'view.stopped.nothingDeleted.anywhere',
  'view.stopped.nothingToDo',
  'view.stopped.allowed',
  'view.stopped.later',
  'view.stopped.readsNothing',
  'view.withdrawn.check',
] as const;

/**
 * THE TEN SHARED, AND THE SEVEN *RONDE*S (§21.3, D14): what the member's
 * screens say, and the key a person's page says in its place. The member's
 * screens keep theirs.
 */
const A_PERSONS_FORM: ReadonlyArray<readonly [member: string, person: string]> = [
  ['state.stage.not_started', 'view.person.stage.not_started'],
  ['state.stage.paused', 'view.person.stage.paused'],
  ['state.stage.copying', 'view.person.stage.copying'],
  ['state.stage.kept_in_step', 'view.person.stage.kept_in_step'],
  ['state.stage.ready_to_switch', 'view.person.stage.ready_to_switch'],
  ['state.stage.switching', 'view.person.stage.switching'],
  ['state.stage.done', 'view.person.stage.done'],
  ['confirm.progress.totalNotKnown', 'view.person.line.totalNotKnown'],
  ['confirm.progress.noneFound', 'view.person.line.noneFound'],
  ['people.line.lastPass', 'view.person.line.lastPass'],
  ['timeLeft.copying.days', 'view.person.time.days'],
  ['timeLeft.copying.hours', 'view.person.time.hours'],
  ['timeLeft.copying.upToDays', 'view.person.time.upToDays'],
  ['timeLeft.copying.upToHours', 'view.person.time.upToHours'],
  ['timeLeft.afterThreePasses', 'view.person.time.notYet'],
  ['pause.ceiling', 'view.person.pause.ceiling'],
  ['pause.ceiling.unknown', 'view.person.pause.ceiling.unknown'],
  ['pause.ceiling.why', 'view.person.pause.ceiling.why'],
  ['pause.dataCeiling', 'view.person.pause.dataCeiling'],
  ['pause.dataCeiling.why', 'view.person.pause.dataCeiling.why'],
  ['pause.hold.default', 'view.person.pause.hold.default'],
  ['pause.hold.why', 'view.person.pause.hold.why'],
];

/**
 * LEFT AS THEY ARE, each for its reason (§21.3). Only an old link's page,
 * made for one migration before 2026-10-03, says these; the owner read
 * `grant.asking` on 2026-11-26.
 */
const ONLY_AN_OLD_LINKS_PAGE = ['grant.asking', 'view.who', 'view.title', 'view.notStarted.why'] as const;

describe('a person’s link page and progress page say kopiëren (D1)', () => {
  it('in none of the 23 sentences that said a form of migreren', () => {
    for (const key of THE_TWENTY_THREE) expect(nl[key], `${key} is gone from the dictionary`).toBeDefined();
    expect(saying(THE_TWENTY_THREE, MIGR)).toEqual([]);
  });

  it('and the two that leave are gone from both languages', () => {
    // The first screen says it in D1's words now (§15), and asks a question (§5.1).
    expect(en['grant.person.asking']).toBeUndefined();
    expect(nl['grant.person.asking']).toBeUndefined();
    // What the provider did not confirm, said once for both pages (`view.stopped.notConfirmed`).
    expect(en['view.person.withdrawn.notConfirmed']).toBeUndefined();
    expect(nl['view.person.withdrawn.notConfirmed']).toBeUndefined();
  });

  it('in every sentence §15 adds, which are in both languages', () => {
    const added = [...THE_LINK_PAGE, ...THE_PROGRESS_PAGE];
    expect(added.filter((k) => en[k] === undefined || nl[k] === undefined)).toEqual([]);
    expect(saying(added, MIGR)).toEqual([]);
  });

  it('and the stop says Kopiëren stoppen, and nothing on these pages says Toegang intrekken (D2)', () => {
    expect(en['view.grant.withdraw']).toBe('Stop copying');
    expect(nl['view.grant.withdraw']).toBe('Kopiëren stoppen');
    const all = [...THE_TWENTY_THREE, ...THE_LINK_PAGE, ...THE_PROGRESS_PAGE];
    expect(saying(all, /toegang intrekken/i)).toEqual([]);
    // The stop's question and its answers are §15's.
    expect(nl['view.stop.no']).toBe('Nee, niet stoppen');
    expect(nl['view.stop.yes']).toBe('Ja, stoppen');
  });

  it('and no sentence of step A promises the ten minutes that step C builds (§9.1)', () => {
    const all = [...THE_TWENTY_THREE, ...THE_LINK_PAGE, ...THE_PROGRESS_PAGE];
    expect(all.filter((k) => /10 minut|ten minut|tien minut/i.test(`${en[k] ?? ''} ${nl[k] ?? ''}`))).toEqual([]);
  });

  it('leaves what only an old link’s page says, as the owner read it', () => {
    for (const key of ONLY_AN_OLD_LINKS_PAGE) expect(nl[key]).toMatch(MIGR);
  });
});

describe('the parts a person’s page shares with the member’s screens (D14)', () => {
  it('have a person’s form of each, in both languages', () => {
    expect(A_PERSONS_FORM.filter(([, p]) => en[p] === undefined || nl[p] === undefined).map(([, p]) => p)).toEqual([]);
  });

  it('which says no form of migreren, and no ronde', () => {
    const forms = A_PERSONS_FORM.map(([, p]) => p);
    expect(saying(forms, MIGR)).toEqual([]);
    expect(saying(forms, RONDE)).toEqual([]);
  });

  it('while the member’s screens keep their own words', () => {
    expect(nl['state.stage.copying']).toBe('Wordt gemigreerd');
    expect(nl['people.line.lastPass']).toMatch(/laatste ronde/);
    expect(nl['pause.dataCeiling.moveUp']).toMatch(/€/);
  });

  it('and a pause at the data ceiling names no price, no package and no Billing page on a person’s page', () => {
    for (const key of ['view.person.pause.dataCeiling', 'view.person.pause.dataCeiling.why']) {
      expect(`${en[key] ?? ''} ${nl[key] ?? ''}`, key).not.toMatch(/€|\{tier\}|\{monthly\}|\{price\}|billing|facturering/i);
    }
    expect(en['view.person.pause.dataCeiling']).toBe('Copying waits for a choice by {who}. Nothing is lost.');
    expect(nl['view.person.pause.dataCeiling']).toBe('Het kopiëren wacht op een keuze van {who}. Er gaat niets verloren.');
  });
});

/** A server sentence, read in both halves. */
const both = (said: Bilingual): string => `${said.en} ${said.nl}`;

describe('what the server writes for a person’s link (§21.3, written by the server)', () => {
  const sentences: ReadonlyArray<readonly [string, () => Bilingual]> = [
    ['a person’s page that is gone', () => PERSON_PAGE_GONE],
    ['an account that is not ready', () => accountNotReady({ en: 'its Google app is not set up yet', nl: 'de Google-app ervan is nog niet ingesteld' })],
    ['a sign-in the server cannot take yet', () => cannotSignInYetOnAPersonsLink('google', 'the detail')],
    ['an application Google turned down', () => EXCHANGE_FOR_A_PERSONS_LINK.refused],
    ['permissions left unticked', () => EXCHANGE_FOR_A_PERSONS_LINK.scope_missing],
    ['no account named, at Google', () => NO_NAMED_ACCOUNT_ON_A_PERSONS_LINK],
    ['no account named, at Microsoft', () => noNamedAccountOnAPersonsLinkAt('microsoft')],
    ['another account signed in', () => anotherAccountOnAPersonsLink('google', 'b@example.com', 'a@example.com')],
    ['two applications for one account', () => twoClientsAt('google')],
  ];

  for (const [what, said] of sentences) {
    it(`${what}: no form of migreren, in either language`, () => {
      expect(both(said())).not.toMatch(MIGR);
    });
  }

  it('and a sign-in the server cannot take yet names the provider that was asked', () => {
    expect(both(cannotSignInYetOnAPersonsLink('microsoft', 'the detail'))).toMatch(/Microsoft/);
    expect(both(cannotSignInYetOnAPersonsLink('microsoft', 'the detail'))).not.toMatch(/Google/);
  });
});
