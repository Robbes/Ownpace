// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The provider setup checklist's definitions (workplan 0061). What these hold:
 *
 *  1. Step KEYS are identities stored in the ledger — a rename silently
 *     orphans every tick a customer has made, so they are pinned here.
 *  2. "Nothing to set up" is a real answer, distinct from a missing provider.
 *  3. `complete` counts a SKIPPED step as settled, or a checklist whose every
 *     row is answered would read as unfinished forever.
 *  4. `blockedOnOthers` counts only OPEN admin steps — that is the number that
 *     answers "why is this stuck?", and a done one does not block anything.
 */

import { describe, it, expect } from 'vitest';
import {
  providersWithSetup,
  setupStepsFor,
  summariseSetup,
  type SetupSide,
  type SetupStepStatus,
} from './provider-setup.ts';
import type { ProviderClientFacts } from './provider-clients.ts';
import { connectableTypes } from './credential-fields.ts';

const status = (
  key: string,
  state: 'open' | 'done' | 'skipped',
  needsAnotherPerson = false,
): SetupStepStatus => ({
  step: { key, titleKey: `t.${key}`, detailKey: `d.${key}`, needsAnotherPerson },
  state,
});

describe('the step definitions', () => {
  it('pins the stored KEYS for Box — renaming one orphans a customer\'s ticks', () => {
    expect(setupStepsFor('source', 'box').map((s) => s.key)).toEqual([
      'create_app',
      'configure_access',
      'admin_authorize',
      'subject_user_id',
    ]);
  });

  it('marks the steps that need somebody else, which is why a setup stalls', () => {
    const box = setupStepsFor('source', 'box');
    expect(box.find((s) => s.key === 'admin_authorize')?.needsAnotherPerson).toBe(true);
    expect(box.find((s) => s.key === 'create_app')?.needsAnotherPerson).toBeUndefined();
  });

  it('gives the four Google sources ONE flow — they share an OAuth client', () => {
    const drive = setupStepsFor('source', 'google-drive');
    for (const type of ['gmail', 'google-calendar', 'google-contacts']) {
      expect(setupStepsFor('source', type)).toBe(drive);
    }
  });

  it('answers an empty list for a provider with no prerequisites — a real answer', () => {
    expect(setupStepsFor('source', 'not-a-provider')).toEqual([]);
    // ...and the side matters: a target webdav has steps, a source webdav does not.
    expect(setupStepsFor('target', 'webdav').length).toBeGreaterThan(0);
    expect(setupStepsFor('source', 'webdav')).toEqual([]);
  });

  it('lists the providers each side can offer', () => {
    expect(providersWithSetup('source')).toContain('box');
    expect(providersWithSetup('target')).toContain('jmap');
    expect(providersWithSetup('target')).not.toContain('box');
  });
});

/**
 * NO STEP THAT CREATES AN APP WHERE THE DEPLOYMENT CARRIES ONE (workplan 0148
 * T2 (b), owner decision D2: "Stop the false hints on managed").
 *
 * The facts are `providerClientFacts()`'s, passed by the managed route; the
 * appliance's route passes none and keeps every step. What is asserted is the
 * filter, not the edition: the same call with Google's fact `connection`
 * keeps Google's steps.
 */
describe('the own-app steps, against what the deployment carries (0148 T2 (b))', () => {
  const facts = (over: Partial<ProviderClientFacts>): ProviderClientFacts => ({
    google: 'connection',
    dropbox: 'connection',
    microsoft: 'connection',
    ...over,
  });

  it("leaves out every Google step where the deployment carries Google's app", () => {
    for (const type of ['google-drive', 'gmail', 'google-calendar', 'google-contacts', 'google']) {
      expect(setupStepsFor('source', type, facts({ google: 'deployment' })), type).toEqual([]);
    }
  });

  it('without facts the list is unchanged — the appliance keeps every step', () => {
    const drive = setupStepsFor('source', 'google-drive');
    expect(drive.map((s) => s.key)).toEqual(['create_oauth_client', 'enable_api', 'consent_scope']);
    expect(setupStepsFor('source', 'google-drive', facts({}))).toEqual(drive);
    // Another provider's app changes nothing about Google's steps.
    expect(setupStepsFor('source', 'google-drive', facts({ dropbox: 'deployment' }))).toEqual(drive);
  });

  it('gives the Google account card the same profile as the four products', () => {
    expect(setupStepsFor('source', 'google')).toBe(setupStepsFor('source', 'google-drive'));
  });

  it("keeps Dropbox's manual consent and exchange without facts — the appliance has no button", () => {
    // The appliance's route passes no facts, serves no Connect with Dropbox,
    // and its operator gets the refresh token by hand: the owner consents
    // (somebody else, so it counts as waiting), then the code is exchanged.
    // `redirect_uri` is added for the button; no key left the file.
    const manual = setupStepsFor('source', 'dropbox');
    expect(manual.map((s) => s.key)).toEqual([
      'create_app',
      'scopes',
      'redirect_uri',
      'consent',
      'exchange_code',
    ]);
    const byKey = new Map(manual.map((s) => [s.key, s]));
    expect(byKey.get('consent')?.needsAnotherPerson).toBe(true);
    expect(byKey.get('exchange_code')?.yieldsKey).toBe('setup.dropbox.exchange_code.yields');
    // A deployment WITH facts but without Dropbox's app keeps them too: the
    // person brings an app, and the button or the hand does the consent.
    expect(setupStepsFor('source', 'dropbox', facts({}))).toEqual(manual);
    expect(setupStepsFor('source', 'dropbox', facts({ dropbox: 'deployment' }))).toEqual([]);
  });

  it('marks exactly the own-app steps, and no step of a provider without an app', () => {
    for (const step of setupStepsFor('source', 'google-drive')) {
      expect(step.ownAppOnly, step.key).toBe('google');
    }
    for (const step of setupStepsFor('source', 'dropbox')) {
      expect(step.ownAppOnly, step.key).toBe('dropbox');
    }
    for (const step of setupStepsFor('source', 'box')) {
      expect(step.ownAppOnly, `box has no deployment app: ${step.key}`).toBeUndefined();
    }
    expect(setupStepsFor('source', 'box', facts({ google: 'deployment', dropbox: 'deployment' })))
      .toHaveLength(4);
  });
});

/**
 * THE CHECKLIST SAYS WHAT MUST BE DONE FIRST (workplan 0148 T5 (a)).
 *
 * Five cards a tester is offered opened a checklist that said *"Nothing to set
 * up in advance; go straight to the wizard"*: Apple, which wants an
 * app-specific password made at Apple first; Nextcloud and Soverin, whose
 * account has to exist and whose password is typed into the wizard; and the
 * two cards T5 (b) is about. So every card both doors offer has a profile, or
 * stands on the list below with the reason it has none. Nothing is hidden on
 * managed (D10), so "offered on managed" is every connectable type.
 *
 * The list only shrinks: an entry whose card has a profile fails, so the
 * excuse goes when T5 (b) lands.
 */
describe('every card has a checklist, or a reason it has none (0148 T5)', () => {
  /** `side:type` → why that card has no profile yet, and whose it is. */
  const WITHOUT_A_PROFILE: Readonly<Record<string, string>> = {
    'source:microsoft':
      "Nothing in advance where the deployment carries Microsoft's registration: Connect with Microsoft. " +
      'Its own-app profile, for a deployment without one, is 0148 T5 (b), after the first invitation.',
    'source:archive':
      '0148 T5 (b), after the first invitation: request the export, which takes minutes to days at ' +
      'Google and up to seven days at Apple, and download it before the date the provider shows.',
  };

  const SIDES: ReadonlyArray<SetupSide> = ['source', 'target'];

  it('every card both doors offer has steps, or is on the list with its reason', () => {
    const missing = SIDES.flatMap((side) =>
      connectableTypes(side)
        .filter((type) => setupStepsFor(side, type).length === 0)
        .map((type) => `${side}:${type}`)
        .filter((card) => !(card in WITHOUT_A_PROFILE)),
    );
    expect(missing, 'cards whose checklist says there is nothing to prepare').toEqual([]);
  });

  it('the list only shrinks: each entry is a real card, still without a profile, with a reason', () => {
    for (const [card, reason] of Object.entries(WITHOUT_A_PROFILE)) {
      const [side, type] = card.split(':') as [SetupSide, string];
      expect(connectableTypes(side), card).toContain(type);
      expect(setupStepsFor(side, type), `${card} has a profile now: take it off the list`).toEqual([]);
      expect(reason.trim().length, card).toBeGreaterThan(0);
    }
  });

  const keys = (side: SetupSide, type: string) => setupStepsFor(side, type).map((s) => s.key);

  it('pins the stored KEYS of the three new profiles', () => {
    expect(keys('source', 'apple')).toEqual(['app_password']);
    expect(keys('target', 'nextcloud')).toEqual(['account_exists', 'app_password', 'dav_url']);
    expect(keys('target', 'soverin')).toEqual(['account_exists', 'password', 'mail_server']);
  });

  it('says what each new step yields, where it yields something to type', () => {
    const yields = (side: SetupSide, type: string) =>
      Object.fromEntries(setupStepsFor(side, type).map((s) => [s.key, s.yieldsKey]));
    expect(yields('source', 'apple')).toEqual({ app_password: 'setup.apple.app_password.yields' });
    expect(yields('target', 'nextcloud')).toMatchObject({
      app_password: 'setup.nextcloud.app_password.yields',
      dav_url: 'setup.nextcloud.dav_url.yields',
    });
    expect(yields('target', 'soverin')).toMatchObject({ password: 'setup.soverin.password.yields' });
  });

  it('no deployment app replaces any of them: each is kept whatever the service carries', () => {
    const everyApp: ProviderClientFacts = { google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' };
    for (const [side, type] of [
      ['source', 'apple'],
      ['target', 'nextcloud'],
      ['target', 'soverin'],
    ] as const) {
      const all = setupStepsFor(side, type);
      expect(all.length, `${side}:${type}`).toBeGreaterThan(0);
      expect(setupStepsFor(side, type, everyApp), `${side}:${type}`).toEqual(all);
    }
  });
});

/**
 * EACH MICROSOFT REGISTRATION CARD GETS THE RECIPE IT NEEDS (0148 T5 (a),
 * found under T8 on 2026-09-26).
 *
 * *Via IMAP* (`oauth2`) and *Via the Graph API* (`graph`) shared one profile,
 * whose permission step said to add Microsoft Graph permissions "for mail,
 * calendar, contacts or files". Both cards read one mailbox's mail, and the
 * IMAP card's token carries only what is given on Office 365 Exchange Online:
 * `IMAP.AccessAsApp`, a service principal registered in Exchange Online and the
 * mailbox given to it (the Microsoft guide's `{#application-imap}`). So the two
 * share the registration and its secret, word for word, and each has its own
 * permission. The IMAP card's steps are new KEYS: a tick given against the
 * Graph text is not a tick for the Exchange permission, and the old
 * `api_permissions` rows of `oauth2` are left harmlessly behind.
 */
describe('each Microsoft registration card gets the recipe it needs (0148 T5 (a))', () => {
  const keys = (type: string) => setupStepsFor('source', type).map((s) => s.key);
  const byKey = (type: string) => new Map(setupStepsFor('source', type).map((s) => [s.key, s]));

  it('Via the Graph API: the registration, its secret, then one Microsoft Graph permission', () => {
    expect(keys('graph')).toEqual(['app_registration', 'client_secret', 'api_permissions']);
  });

  it('Via IMAP: the same registration and secret, then what Exchange Online wants', () => {
    expect(keys('oauth2')).toEqual([
      'app_registration',
      'client_secret',
      'exchange_permission',
      'service_principal',
      'mailbox_permission',
    ]);
    expect(setupStepsFor('source', 'oauth2')).not.toBe(setupStepsFor('source', 'graph'));
  });

  it('the two share the registration and secret steps, and nothing else', () => {
    const graph = byKey('graph');
    const imap = byKey('oauth2');
    expect(imap.get('app_registration')).toBe(graph.get('app_registration'));
    expect(imap.get('client_secret')).toBe(graph.get('client_secret'));
    expect(imap.has('api_permissions'), 'the Graph permission is not the IMAP card’s').toBe(false);
    expect(graph.has('exchange_permission')).toBe(false);
  });

  it('marks every consent and Exchange step as an administrator’s', () => {
    expect(byKey('graph').get('api_permissions')?.needsAnotherPerson).toBe(true);
    for (const key of ['exchange_permission', 'service_principal', 'mailbox_permission']) {
      expect(byKey('oauth2').get(key)?.needsAnotherPerson, key).toBe(true);
    }
  });

  it("keeps every step where the deployment carries Microsoft's registration: these cards take their own", () => {
    const microsoft: ProviderClientFacts = { google: 'connection', dropbox: 'connection', microsoft: 'deployment' };
    for (const type of ['graph', 'oauth2']) {
      expect(setupStepsFor('source', type, microsoft), type).toEqual(setupStepsFor('source', type));
    }
  });
});

describe('progress', () => {
  it('counts a SKIPPED step as settled — else an answered list never completes', () => {
    const progress = summariseSetup([status('a', 'done'), status('b', 'skipped')]);

    expect(progress).toMatchObject({ total: 2, done: 1, skipped: 1, open: 0, complete: true });
  });

  it('is not complete while anything is open', () => {
    expect(summariseSetup([status('a', 'done'), status('b', 'open')]).complete).toBe(false);
  });

  it('an empty checklist is not "complete" — there was nothing to complete', () => {
    expect(summariseSetup([]).complete).toBe(false);
  });

  it('counts only OPEN admin steps as blocked on somebody else', () => {
    const progress = summariseSetup([
      status('waiting', 'open', true),
      status('alreadyDone', 'done', true),
      status('mine', 'open'),
    ]);

    expect(progress.open).toBe(2);
    expect(progress.blockedOnOthers, 'a done admin step blocks nothing').toBe(1);
  });
});
