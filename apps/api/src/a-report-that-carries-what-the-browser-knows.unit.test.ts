// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REPORT THAT CARRIES WHAT THE BROWSER KNOWS (workplan 0130 T6, Part B; the
 * owner's "Both parts", 2026-09-28).
 *
 * Part A gave a report the facts our records hold. Some facts only the browser
 * has: the language of the screen, the time zone that turns "at 14:02" into
 * the server's UTC, the width a layout bug depends on, a web app older than
 * the server it talks to, which data type, side and migration the failure
 * line was about, and the reference of a "Something went wrong" the person
 * saw a minute ago, which they had to copy out of a sentence.
 *
 * They arrive as one small object, `browser`, in the report's body and, for
 * the preview, as JSON in its query. Anybody can write that object, so the
 * server takes from it only its own list of keys, each checked for its type,
 * its length and its characters, and writes each as a line under a label of
 * its own list. Everything else is dropped without a word: an unknown key, a
 * value too long, a character a line or a header could be built from. A
 * report is never refused for what the browser said.
 *
 * Driven through the real route with a fake relay and a fake Zammad; the
 * records' facts come from a stub reader, since Part A's guard holds those.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildIdentity } from '@openmig/core';
import type { MailTransport, SmtpSettings } from '@openmig/shared';
import { createKnockLimiter } from './knock-limit.ts';
import { __startTheDayAgainForTests } from './services/report-channel.ts';
import { REPORT_FACT_LABELS } from './problem-report.ts';
import {
  BROWSER_FACT_KEYS,
  MAX_BROWSER_FACTS_QUERY,
  MAX_RECENT_ERRORS,
  parseBrowserFacts,
} from './report-browser-facts.ts';
import type { ReportFacts } from './report-facts.ts';

vi.mock('./middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req.userId = 'user-1';
      req.userEmail = 'someone@example.invalid';
      req.tenantId = TENANT;
      req.userRole = 'admin';
      next();
    },
  };
});

const { problemReportRoutes } = await import('./routes/problem-reports.ts');

// UUID family 0130b0b0-…, unused elsewhere in the repository.
const TENANT = '0130b0b0-e29b-41d4-a716-446655440001';
const MIGRATION = '0130b0b0-e29b-41d4-a716-446655440015';

/** What must never reach a report: a sign-in token, as a failed request would carry it. */
const CANARY = 'canary-token-7c1e0d';

const MAIL = {
  SMTP_HOST: 'smtp.example.invalid',
  SMTP_PORT: '587',
  SMTP_USER: 'relay-user@example.invalid',
  SMTP_PASSWORD: 'test-password-not-real',
  NOTIFY_FROM: 'ownpace@example.invalid',
  NOTIFY_TO: 'operator@example.invalid',
  REPORT_MAIL_TO: 'support@example.invalid',
};
const ZAMMAD = { ZAMMAD_URL: 'https://help.example.invalid', ZAMMAD_TOKEN: 'test-token-not-real' };
const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';

/** The records, as Part A's reader would give them for a page with no migration. */
const RECORDS: ReportFacts = {
  organisation: { status: 'active', closedAt: null, purgeAfter: null },
  hold: { on: false, since: null },
  scheduler: 'running',
};

/** Every fact the form sends, each a value the server takes. */
const EVERY = {
  language: 'nl',
  timeZone: 'America/Argentina/Buenos_Aires',
  windowWidth: 390,
  appVersion: '0.0.9-rc.1',
  appCommit: '1234567890abcdef1234567890abcdef12345678',
  dataType: 'email',
  side: 'target',
  migrationId: MIGRATION,
  recentErrors: [
    { reference: '1a2b3c4d', code: 'list_failed' },
    { reference: '5e6f7a8b', code: 'unhandled' },
  ],
} as const;

/** The lines those give, in their order, after the request's own `Browser:` line. */
const EVERY_LINES = [
  'Screen language: Dutch',
  'Time zone: America/Argentina/Buenos_Aires',
  'Window width: 390 px',
  "App build in the browser: v0.0.9-rc.1 · 1234567, not the server's",
  `Failure line: email, target side, migration ${MIGRATION}`,
  'Recent error: 1a2b3c4d, list_failed',
  'Recent error: 5e6f7a8b, unhandled',
];

/** The labels only the browser's facts are written under. */
const BROWSER_LABELS = ['Screen language', 'Time zone', 'Window width', 'App build in the browser', 'Failure line', 'Recent error'];

function relay() {
  const sent: Array<Parameters<MailTransport>[0]> = [];
  const mailTransport = (_smtp: SmtpSettings, _waits: unknown): MailTransport => async (message) => {
    sent.push(message);
  };
  return { sent, mailTransport };
}

function zammad() {
  const tickets: Array<{ article: { body: string } }> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    tickets.push(JSON.parse(String(init.body)));
    return { ok: true, status: 201, json: async () => ({ id: 7, number: '31001' }) };
  }) as unknown as typeof fetch;
  return { tickets, fetchImpl };
}

function app(deps: Parameters<typeof problemReportRoutes>[0] = {}) {
  const a = express();
  a.use(
    '/api/problem-reports',
    problemReportRoutes({
      env: MAIL,
      readFacts: async () => RECORDS,
      limiter: createKnockLimiter({ windowMs: 60_000, max: 1000 }),
      previewLimiter: createKnockLimiter({ windowMs: 60_000, max: 1000 }),
      mailCap: createKnockLimiter({ windowMs: 60_000, max: 1000 }),
      ...deps,
    }),
  );
  return a;
}

/** Send a report from `/moves` carrying `browser`, and answer the mail's body. */
async function mailed(browser: unknown): Promise<string> {
  const { sent, mailTransport } = relay();
  await request(app({ mailTransport }))
    .post('/api/problem-reports')
    .set('User-Agent', BROWSER)
    .send({ description: 'It stopped', page: '/moves', browser })
    .expect(201);
  expect(sent).toHaveLength(1);
  return sent[0]!.body;
}

/** The facts a mail carries: the lines between its `---` and its `Reply to:`. */
function factsOf(body: string): string[] {
  const lines = body.split('\n');
  return lines.slice(lines.indexOf('---') + 1, lines.findIndex((l) => l.startsWith('Reply to: ')));
}

/** The lines written under the browser's own labels. */
function browserLines(lines: readonly string[]): string[] {
  return lines.filter((l) => BROWSER_LABELS.some((label) => l.startsWith(`${label}: `)));
}

const preview = (browser: string | undefined) =>
  request(app())
    .get('/api/problem-reports/preview')
    .query({ page: '/moves', ...(browser === undefined ? {} : { browser }) })
    .set('User-Agent', BROWSER);

beforeEach(() => {
  __startTheDayAgainForTests();
});

describe('what the browser says, as lines of the report', () => {
  it('writes each fact the form sends as a line of its own, after the browser, in the mail', async () => {
    const facts = factsOf(await mailed(EVERY));
    const browser = facts.indexOf(`Browser: ${BROWSER}`);
    expect(browser, 'the browser line is gone').toBeGreaterThan(-1);
    expect(facts.slice(browser + 1)).toEqual(EVERY_LINES);
  });

  it('shows the same lines in the preview, asked with the facts as JSON', async () => {
    const shown = await preview(JSON.stringify(EVERY)).expect(200);
    const facts = factsOf(await mailed(EVERY));
    expect(shown.body.lines).toEqual(facts);
    expect(browserLines(shown.body.lines)).toEqual(EVERY_LINES);
  });

  it('carries the same lines in the Zammad article', async () => {
    const { tickets, fetchImpl } = zammad();
    await request(app({ env: ZAMMAD, fetchImpl }))
      .post('/api/problem-reports')
      .set('User-Agent', BROWSER)
      .send({ description: 'It stopped', page: '/moves', browser: EVERY })
      .expect(201);
    expect(browserLines(tickets[0]!.article.body.split('\n'))).toEqual(EVERY_LINES);
  });

  it('says English, and the failure line with only what it had', async () => {
    const facts = factsOf(await mailed({ language: 'en', migrationId: MIGRATION }));
    expect(browserLines(facts)).toEqual(['Screen language: English', `Failure line: migration ${MIGRATION}`]);
    expect(browserLines(factsOf(await mailed({ dataType: 'file' })))).toEqual(['Failure line: file']);
    expect(browserLines(factsOf(await mailed({ side: 'source' })))).toEqual(['Failure line: source side']);
  });

  it("writes the app's build in the browser only when it is not the server's", async () => {
    const server = buildIdentity();
    const same = factsOf(await mailed({ appVersion: server.version }));
    expect(browserLines(same), 'the same version, and no commit to compare').toEqual([]);
    const other = factsOf(await mailed({ appVersion: `${server.version}.1` }));
    expect(browserLines(other)).toEqual([`App build in the browser: v${server.version}.1, not the server's`]);
  });

  it('writes nothing of the browser when it sent nothing', async () => {
    expect(browserLines(factsOf(await mailed(undefined)))).toEqual([]);
    expect(browserLines((await preview(undefined).expect(200)).body.lines)).toEqual([]);
  });

  it('writes every line under a label of its own list', async () => {
    for (const label of BROWSER_LABELS) expect(REPORT_FACT_LABELS).toContain(label);
    const facts = factsOf(await mailed(EVERY));
    for (const line of facts) {
      expect(
        REPORT_FACT_LABELS.some((label) => line.startsWith(`${label}: `)),
        `"${line}" starts with no label of REPORT_FACT_LABELS`,
      ).toBe(true);
    }
  });
});

describe('what the browser says, checked by the server', () => {
  it('takes a fixed list of keys, and nothing else', () => {
    expect([...BROWSER_FACT_KEYS].sort()).toEqual(
      ['appCommit', 'appVersion', 'dataType', 'language', 'migrationId', 'recentErrors', 'side', 'timeZone', 'windowWidth'].sort(),
    );
    const parsed = parseBrowserFacts({ ...EVERY, token: CANARY, url: `/mappings?token=${CANARY}` });
    expect(Object.keys(parsed ?? {}).sort()).toEqual([...BROWSER_FACT_KEYS].sort());
    expect(JSON.stringify(parsed)).not.toContain(CANARY);
  });

  it('drops a key it does not know, and never writes it, in the mail or the preview', async () => {
    const planted = {
      ...EVERY,
      token: CANARY,
      config: { headers: { Authorization: `Bearer ${CANARY}` } },
      url: `/mappings?token=${CANARY}`,
      recentErrors: [{ reference: '1a2b3c4d', code: 'list_failed', authorization: `Bearer ${CANARY}` }],
    };
    const body = await mailed(planted);
    expect(body).not.toContain(CANARY);
    expect(browserLines(factsOf(body))).toContain('Recent error: 1a2b3c4d, list_failed');
    const shown = await preview(JSON.stringify(planted)).expect(200);
    expect(JSON.stringify(shown.body)).not.toContain(CANARY);
  });

  it.each([
    ['a language it does not have', { language: 'de' }],
    ['a time zone too long', { timeZone: `Europe/${'A'.repeat(64)}` }],
    ['a time zone with a character a line could be built from', { timeZone: `Europe/Amsterdam\nReply-To: ${CANARY}` }],
    ['a time zone with a character of markup', { timeZone: `<b>${CANARY}</b>` }],
    ['a width that is text', { windowWidth: '390' }],
    ['a width no window has', { windowWidth: 1_000_000 }],
    ['a width that is not whole', { windowWidth: 390.5 }],
    ['a version too long', { appVersion: `1.${'0'.repeat(64)}` }],
    ['a version with a space', { appVersion: `1.0 ${CANARY}` }],
    ['a commit that is not one', { appCommit: CANARY }],
    ['a data type it does not have', { dataType: CANARY }],
    ['a side it does not have', { side: 'left' }],
    ['a migration id that is not one', { migrationId: CANARY }],
    ['a recent error whose reference is not one', { recentErrors: [{ reference: CANARY, code: 'list_failed' }] }],
    ['a recent error whose code is not one', { recentErrors: [{ reference: '1a2b3c4d', code: `Bearer ${CANARY}` }] }],
    ['a recent error whose code is too long', { recentErrors: [{ reference: '1a2b3c4d', code: `x${'_'.repeat(48)}` }] }],
    [
      'more recent errors than the form keeps',
      { recentErrors: Array.from({ length: MAX_RECENT_ERRORS + 1 }, () => ({ reference: '1a2b3c4d', code: 'list_failed' })) },
    ],
    ['recent errors that are not a list', { recentErrors: { reference: '1a2b3c4d', code: 'list_failed' } }],
  ] as const)('drops %s, and keeps the rest', async (_what, bad) => {
    // Beside a fact the server takes, which is written; never the same key.
    const kept = 'language' in bad ? { dataType: 'task', line: 'Failure line: task' } : { language: 'en', line: 'Screen language: English' };
    const { line, ...fact } = kept;
    const body = await mailed({ ...fact, ...bad });
    expect(body).not.toContain(CANARY);
    expect(browserLines(factsOf(body))).toEqual([line]);
  });

  it.each([
    ['a text that is not JSON', CANARY],
    ['a list', JSON.stringify([EVERY])],
    ['a number', '42'],
    ['null', 'null'],
  ] as const)('drops the whole object when it is %s, in the body or the preview', async (_what, said) => {
    expect(browserLines(factsOf(await mailed(said)))).toEqual([]);
    const shown = await preview(said).expect(200);
    expect(browserLines(shown.body.lines)).toEqual([]);
    expect(JSON.stringify(shown.body)).not.toContain(CANARY);
  });

  it('drops a preview asked with more than the form ever sends, and still answers', async () => {
    const long = JSON.stringify({ ...EVERY, padding: CANARY.repeat(MAX_BROWSER_FACTS_QUERY / CANARY.length + 1) });
    expect(long.length).toBeGreaterThan(MAX_BROWSER_FACTS_QUERY);
    const shown = await preview(long).expect(200);
    expect(browserLines(shown.body.lines)).toEqual([]);
    // What the form sends at most fits: every fact at its longest.
    const longest = JSON.stringify({
      language: 'en',
      timeZone: `A/${'b'.repeat(62)}`,
      windowWidth: 20_000,
      appVersion: '1'.repeat(40),
      appCommit: 'f'.repeat(40),
      dataType: 'calendar',
      side: 'source',
      migrationId: MIGRATION,
      recentErrors: Array.from({ length: MAX_RECENT_ERRORS }, () => ({ reference: 'ffffffff', code: `x${'_'.repeat(47)}` })),
    });
    expect(longest.length).toBeLessThanOrEqual(MAX_BROWSER_FACTS_QUERY);
    expect(browserLines((await preview(longest).expect(200)).body.lines)).toHaveLength(5 + MAX_RECENT_ERRORS);
  });

  it('never refuses a report for what the browser said', async () => {
    const { sent, mailTransport } = relay();
    await request(app({ mailTransport }))
      .post('/api/problem-reports')
      .send({ description: 'It stopped', page: '/moves', browser: { language: CANARY, windowWidth: -1, recentErrors: 'all' } })
      .expect(201);
    expect(sent[0]!.body).not.toContain(CANARY);
  });
});
