// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE APP SCREEN ON THE HOME PAGE (workplan 0152 T3; the owner, 2026-10-05:
 * *"yes! but it will have to move along with changes in text in the
 * future"*).
 *
 * The site's home page shows one person's page of the app: its head, and the
 * card of their migrations (`data-app-screen` in `apps/web/src/pages/Person.tsx`).
 * This file is what the two ends of that agree on:
 *
 *  - the person, and the API's answers the page is drawn from
 *    (`appScreenAnswers`), at one fixed moment (`APP_SCREEN_NOW`), so *last
 *    pass 2 minutes ago* says the same on every run;
 *  - the words of the screen (`appScreenText`): every text in the two parts,
 *    in order. They depend on neither the width nor the fonts, so one text
 *    per language holds for the wide picture and the phone's.
 *
 * `scripts/shoot-the-app-screen.mjs` takes the pictures and records the words
 * in `site/app-screen/screen.json`. `managed-ui.ui.test.ts` opens the same page
 * and compares them: a word of the app's that changes on that screen fails CI
 * until the pictures are taken again.
 *
 * Nobody in it is real: the names are the fixtures' own, and the providers
 * are the ones the app offers.
 */
import type { Page } from 'playwright-core';

/** The moment every picture is taken at, and the page's clock is held to. */
export const APP_SCREEN_NOW = new Date('2026-10-05T10:00:00.000Z');

const TENANT = '0152a5c0-e29b-41d4-a716-446655440001';
/** The person whose page the home page shows. */
export const APP_SCREEN_PERSON = '0152a5c0-e29b-41d4-a716-446655440041';
const migration = (n: string): string => `0152a5c0-e29b-41d4-a716-4466554430${n}`;

const ago = (ms: number): string => new Date(APP_SCREEN_NOW.getTime() - ms).toISOString();
const daysFrom = (d: number): string => new Date(APP_SCREEN_NOW.getTime() + d * 86_400_000).toISOString();
const GB = 1024 ** 3;

/** The languages the site has, and the screen is photographed in. */
export type AppScreenLocale = 'en' | 'nl';

/**
 * Anna's three migrations. Their names are what a person typed, so they are
 * in the screen's language: a Dutch page reading *Gmail to Soverin* would be
 * the site's slip, not the app's.
 */
const migrations = (locale: AppScreenLocale) => {
  const to = locale === 'nl' ? 'naar' : 'to';
  const rows: Array<[string, string, string, string, string[], string | null]> = [
    ['31', `Anna — Gmail ${to} Soverin`, 'gmail', 'soverin', ['email'], ago(120_000)],
    ['32', `Anna — Google ${to} Soverin`, 'google', 'soverin', ['calendar', 'contact'], ago(600_000)],
    ['33', `Anna — Dropbox ${to} Nextcloud`, 'dropbox', 'nextcloud', ['file'], null],
  ];
  return rows.map(([n, name, sourceType, targetType, domains, lastSyncAt]) => ({
    id: migration(n),
    tenantId: TENANT,
    name,
    sourceType,
    targetType,
    status: 'active',
    mode: 'mirror',
    pattern: null,
    domains,
    lastSyncAt,
    createdAt: daysFrom(-6),
    updatedAt: daysFrom(-1),
  }));
};

const line = (domain: string, over: Record<string, unknown> = {}) => ({
  domain,
  state: 'completed',
  phase: 'active',
  itemsSynced: 0,
  bytesTransferred: 0,
  ...over,
});

/** Nothing waits on anybody: a migration that runs by itself. */
const quiet = (mappingId: string) => ({
  mappingId,
  pendingDecisions: 0,
  deletionsWaiting: 0,
  movesWaiting: 0,
  failuresWaiting: 0,
  readyForCutover: false,
  autoApplied: 0,
  sharingOpen: 0,
});

/**
 * What the API answers for the person's page in `locale`, keyed `METHOD /path`
 * as the UI smoke's fixtures are. A copy each call, so a caller that edits one
 * changes nothing for the next.
 */
export function appScreenAnswers(locale: AppScreenLocale): Record<string, unknown> {
  const mappings = migrations(locale);
  const ids = mappings.map((m) => m.id);
  return structuredClone({
    'GET /api/people': {
      people: [
        {
          id: APP_SCREEN_PERSON,
          implicit: false,
          displayName: 'Anna Jansen',
          email: null,
          createdAt: daysFrom(-6),
          migrations: ids.map((id) => ({ id, status: 'active' })),
          counts: { paused: 0, active: ids.length, cutover: 0, done: 0, continuous: 0 },
        },
      ],
      unassigned: [],
    },
    'GET /api/migrations': { mappings },
    'GET /api/migrations/progress': {
      mappings: [
        {
          mappingId: ids[0],
          check: { state: 'not_run' },
          domains: [line('email', { itemsSynced: 18_234, itemsFound: 19_000, lastSyncedAt: ago(120_000) })],
        },
        {
          mappingId: ids[1],
          check: { state: 'not_run' },
          domains: [
            line('calendar', { state: 'in_progress', itemsSynced: 1_204, itemsFound: 2_000 }),
            line('contact', { itemsSynced: 612, itemsFound: 612, lastSyncedAt: ago(600_000) }),
          ],
        },
        {
          mappingId: ids[2],
          check: { state: 'not_run' },
          domains: [
            line('file', {
              state: 'in_progress',
              itemsSynced: 900,
              itemsFound: 3_000,
              bytesTransferred: 12.4 * GB,
              bytesFound: 38 * GB,
            }),
          ],
        },
      ],
    },
    'GET /api/attention': { mappings: ids.map(quiet) },
    'GET /api/migrations/pace': { leastMinutesBetweenPasses: 0, nextPassAt: {} },
    [`GET /api/people/${APP_SCREEN_PERSON}/links`]: { links: [] },
    [`GET /api/people/${APP_SCREEN_PERSON}/awaiting-grant`]: { migrations: [] },
  });
}

/** The parts of the person's page the home page shows. */
export const APP_SCREEN_PARTS = '[data-app-screen]';

/** Drawn once every line of every migration is: the page has stopped changing. */
export const APP_SCREEN_READY = '[data-app-screen="migrations"] [data-domain][data-stage]';

/** Every text in the parts, in document order, each trimmed, with one space between. */
export async function appScreenText(page: Page): Promise<string> {
  return page.evaluate((selector) => {
    const words: string[] = [];
    for (const part of document.querySelectorAll(selector)) {
      const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text) words.push(text);
      }
    }
    return words.join(' ');
  }, APP_SCREEN_PARTS);
}
