// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REPORT THAT REACHES SUPPORT BY MAIL (workplan 0130; the owner, 2026-09-28).
 *
 * The owner had never seen the report form work: no deployment runs a Zammad,
 * so `/available` answered false everywhere and the link never showed. Their
 * decision for the whole alpha: the form is on (*"yes, we need that. I haven't
 * seen it funcitonal yet."*), and a report goes by mail to the support mailbox
 * through the relay that already sends the product's mail (*"b"*). Zammad stays
 * the long-term plan, so when it is set up it still wins.
 *
 * Driven through the real routes, with the relay faked at its transport (the
 * function `smtpTransport` would have returned) and Zammad at `fetch`. What is
 * asserted:
 *
 * - **where a report goes:** Zammad when both its settings are set, the mail
 *   when they are not and the API's mail is, nowhere when neither is;
 * - **the mail:** from `NOTIFY_FROM`, to `REPORT_MAIL_TO` (or `NOTIFY_TO`),
 *   the ticket's title as Subject, the ticket's lines as the body, the
 *   screenshot attached after the same first-bytes check, and the report
 *   reference the person is answered with;
 * - **who to answer, twice:** the reporter's sign-in address as Reply-To and
 *   as a `Reply to:` line in the body. On live the mail goes from the support
 *   address to itself (0133 T0), where a client may answer to its own To or
 *   a provider may drop the header, and the fake transport cannot see past
 *   either; the line survives both. Reply-To only for one valid address;
 * - **a mail the relay refused:** answered as a Zammad refusal is, a 502 with
 *   a reference, recorded as `report.not-delivered`; and a relay that hangs
 *   is given up on in time, since `sendReportMail` hands the transport
 *   `REPORT_MAIL_TIMEOUTS`;
 * - **the same per-person limit**, and for a link's report the same per-link
 *   one, and a day's cap on every report mail together, since the relay's
 *   login sends the identity provider's sign-in codes too;
 * - **a link's report has no Reply-To at all**: its note would be quoted to
 *   an address somebody typed;
 * - **a recipient set with the mail off is said in the log**, once.
 *
 * What nodemailer makes of the message on the wire, and that it still never
 * logs in over cleartext, is `packages/connectors/src/a-report-that-reaches-support-by-mail.unit.test.ts`.
 */

import { describe, it, expect, vi, afterEach, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations, withTenant, issueMappingLink, expiryFromDays } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { setAppEventSink, type AppEvent, type MailTransport, type SmtpSettings } from '@openmig/shared';
import { buildIdentity } from '@openmig/core';
import { reportMailFor, ticketFor, type ProblemReport } from './problem-report.ts';
import {
  REPORT_MAIL_PER_DAY,
  REPORT_MAIL_TIMEOUTS,
  __forgetWhatWasSaidForTests,
  reportChannel,
  reportMailConfigFrom,
} from './services/report-channel.ts';
import { createKnockLimiter } from './knock-limit.ts';
import { LINK_REPORT_MAIL_WARNING } from './link-report.ts';
import { LINK_REPORT_OVERALL, LINK_REPORT_PER_LINK, linkReportRoutes } from './routes/link-reports.ts';

const TENANT = '0e260000-e29b-41d4-a716-446655440001';

vi.mock('./middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware/auth.ts')>();
  return {
    ...actual,
    // Signed in as the header says; the link doors keep the real middleware.
    authenticate: (req: Record<string, unknown> & { headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.userId = req.headers['x-test-user'] ?? 'user-1';
      req.userEmail = 'someone@example.invalid';
      req.tenantId = TENANT;
      next();
    },
  };
});

const { problemReportRoutes } = await import('./routes/problem-reports.ts');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

/** The API's mail, as a relay's settings look, and a support mailbox of its own. */
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

/** The relay, as the function `smtpTransport` returns: what it was handed, and whether it takes it. */
function relay(fails = false) {
  const settings: SmtpSettings[] = [];
  const timeouts: unknown[] = [];
  const sent: Array<Parameters<MailTransport>[0]> = [];
  const mailTransport = (smtp: SmtpSettings, waits: unknown): MailTransport => {
    settings.push(smtp);
    timeouts.push(waits);
    return async (message) => {
      if (fails) throw new Error('451 the relay is not taking mail just now');
      sent.push(message);
    };
  };
  return { settings, timeouts, sent, mailTransport };
}

/** Zammad, answering ticket 31001 to anything. */
function zammad() {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return { ok: true, status: 201, json: async () => ({ id: 7, number: '31001' }) };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function app(deps: Parameters<typeof problemReportRoutes>[0]) {
  const a = express();
  a.use('/api/problem-reports', problemReportRoutes(deps));
  return a;
}

let events: AppEvent[];
beforeEach(() => {
  vi.stubEnv('OPENMIG_VERSION', '');
  vi.stubEnv('OPENMIG_COMMIT', COMMIT);
  events = [];
  setAppEventSink({ record: async (e) => void events.push(e) });
  __forgetWhatWasSaidForTests();
});
afterEach(() => {
  setAppEventSink(undefined);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('where a report goes', () => {
  it('nowhere when neither a Zammad nor the mail is set up', () => {
    expect(reportChannel({})).toBeUndefined();
  });

  it('to the support mailbox when only the mail is, from the sender every mail has', () => {
    expect(reportChannel(MAIL)).toEqual({
      kind: 'mail',
      mail: {
        smtp: { host: 'smtp.example.invalid', port: 587, secure: false, user: MAIL.SMTP_USER, password: MAIL.SMTP_PASSWORD },
        from: 'ownpace@example.invalid',
        to: ['support@example.invalid'],
      },
    });
  });

  it("to the operator's own address when REPORT_MAIL_TO is empty", () => {
    expect(reportMailConfigFrom({ ...MAIL, REPORT_MAIL_TO: '  ' })?.to).toEqual(['operator@example.invalid']);
    expect(reportMailConfigFrom({ ...MAIL, REPORT_MAIL_TO: 'a@example.invalid, b@example.invalid' })?.to).toEqual([
      'a@example.invalid',
      'b@example.invalid',
    ]);
    // REPORT_MAIL_TO alone is a recipient, but no relay.
    expect(reportMailConfigFrom({ REPORT_MAIL_TO: 'support@example.invalid' })).toBeUndefined();
  });

  it('nowhere when the mail is off the way it is off for every other mail', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Half set: the notifier names what is missing, and nothing is sent.
    expect(reportChannel({ SMTP_HOST: 'smtp.example.invalid', REPORT_MAIL_TO: 'support@example.invalid' })).toBeUndefined();
    // Any certificate accepted, in production: refused.
    expect(reportChannel({ ...MAIL, SMTP_ALLOW_SELF_SIGNED: 'true', NODE_ENV: 'production' })).toBeUndefined();
  });

  it('says so in the log, once, when REPORT_MAIL_TO is set and the mail is off, naming what is missing', () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    // NOTIFY_FROM forgotten: the one the operator in the review left out.
    const { NOTIFY_FROM: _forgotten, ...withoutFrom } = MAIL;
    expect(reportChannel(withoutFrom)).toBeUndefined();
    const lines = said.mock.calls.map((call) => call.join(' '));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('problem reports are switched off');
    expect(lines[0]).toContain('REPORT_MAIL_TO');
    expect(lines[0]).toContain('NOTIFY_FROM');
    // `/available` asks on every signed-in page: the same reason is not said again.
    expect(reportChannel(withoutFrom)).toBeUndefined();
    expect(said).toHaveBeenCalledTimes(1);
    // And nothing is said where nobody asked for reports by mail.
    expect(reportChannel({})).toBeUndefined();
    expect(said).toHaveBeenCalledTimes(1);
  });

  it('to Zammad when it is set up, mail or no mail', () => {
    expect(reportChannel({ ...MAIL, ...ZAMMAD })).toMatchObject({ kind: 'zammad', zammad: { url: ZAMMAD.ZAMMAD_URL } });
  });

  it('nowhere, and said, when a Zammad is set up wrongly: somebody who set both meant a helpdesk', () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(reportChannel({ ...MAIL, ...ZAMMAD, ZAMMAD_URL: 'http://help.example.invalid' })).toBeUndefined();
    expect(said.mock.calls.flat().join(' ')).toContain('problem reports are switched off');
  });
});

describe('the mail it becomes', () => {
  const report: ProblemReport = {
    description: 'The Moves screen is empty\nafter the last pass',
    page: '/moves',
    reference: '0a1b2c3d',
    category: 'unknown',
    screenshot: { type: 'image/png', data: PNG.toString('base64') },
  };
  const reporter = { email: 'someone@example.invalid', tenantId: TENANT };

  it("says what the ticket says: its title as the Subject, its article as the body, then who to answer and the report's reference", () => {
    const ticket = ticketFor(report, reporter, 'Users');
    const mail = reportMailFor(report, reporter, '9f8e7d6c');
    expect(mail.subject).toBe('Ownpace: The Moves screen is empty');
    expect(mail.subject).toBe(ticket.title);
    expect(mail.body).toBe(
      `${ticket.article.body}\nReply to: someone@example.invalid (sign-in address)\nReport reference: 9f8e7d6c`,
    );
    expect(mail.body.split('\n')).toEqual([
      'The Moves screen is empty',
      'after the last pass',
      '',
      '---',
      'Page: /moves',
      'Reference: 0a1b2c3d',
      'Category: unknown',
      `Organisation: ${TENANT}`,
      `Build: v${buildIdentity().version} · a1b2c3d`,
      'Reply to: someone@example.invalid (sign-in address)',
      'Report reference: 9f8e7d6c',
    ]);
  });

  it('sets Reply-To only for one valid address, and then says in the body why there is none', () => {
    for (const odd of ['me@example.invalid, other@example.invalid', 'me@example.invalid\r\nBcc: other@example.invalid', 'not an address']) {
      const mail = reportMailFor(report, { ...reporter, email: odd }, '9f8e7d6c');
      expect(mail.replyTo).toBeUndefined();
      expect('replyTo' in mail).toBe(false);
      const lines = mail.body.split('\n');
      const line = lines.find((l) => l.startsWith('Reply to: '));
      expect(line).toMatch(/^Reply to: none\. The sign-in address is not one address a reply can go to: /);
      // The odd value is written on its one line, never as a line of its own.
      expect(lines.filter((l) => l.startsWith('Bcc:'))).toEqual([]);
    }
  });

  it("is answered to the reporter's sign-in address, with the screenshot attached as its own type", () => {
    const mail = reportMailFor(report, reporter, '9f8e7d6c');
    expect(mail.replyTo).toBe('someone@example.invalid');
    expect(mail.attachments).toEqual([
      { filename: 'screenshot.png', contentType: 'image/png', base64: PNG.toString('base64') },
    ]);
    expect(reportMailFor({ description: 'x', page: '/' }, reporter, '9f8e7d6c').attachments).toBeUndefined();
  });

  it('keeps the Subject to one line, whatever the first line held', () => {
    const mail = reportMailFor({ description: 'It stopped\rBcc: someone@example.invalid\nmore', page: '/' }, reporter, '9f8e7d6c');
    expect(mail.subject).toBe('Ownpace: It stopped Bcc: someone@example.invalid');
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});

describe('the form, on a service with mail and no Zammad', () => {
  it('is offered with the mail alone, and not with neither', async () => {
    expect((await request(app({ env: MAIL })).get('/api/problem-reports/available')).body).toEqual({ available: true });
    expect((await request(app({ env: {} })).get('/api/problem-reports/available')).body).toEqual({ available: false });
  });

  it('sends one mail to the support mailbox, answered to the reporter, and answers its reference', async () => {
    const { settings, timeouts, sent, mailTransport } = relay();
    const res = await request(app({ env: MAIL, mailTransport }))
      .post('/api/problem-reports')
      .send({
        description: 'It stopped\nafter the second pass',
        page: '/grant/abc.secret/google',
        reference: '0a1b2c3d',
        category: 'unknown',
        screenshot: { data: PNG.toString('base64') },
      });

    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['reference']);
    expect(res.body.reference).toMatch(/^[0-9a-f]{8}$/);
    // The API's own relay, with the settings every other mail uses.
    expect(settings).toEqual([
      { host: 'smtp.example.invalid', port: 587, secure: false, user: MAIL.SMTP_USER, password: MAIL.SMTP_PASSWORD },
    ]);
    // Somebody is waiting: a relay that hangs is given up on before their browser does.
    expect(timeouts).toEqual([REPORT_MAIL_TIMEOUTS]);
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.from).toBe('ownpace@example.invalid');
    expect(mail.to).toEqual(['support@example.invalid']);
    expect(mail.replyTo).toBe('someone@example.invalid');
    expect(mail.subject).toBe('Ownpace: It stopped');
    const lines = mail.body.split('\n');
    expect(lines.slice(0, 2)).toEqual(['It stopped', 'after the second pass']);
    expect(lines).toEqual(
      expect.arrayContaining([
        'Page: /grant/:link/google',
        'Reference: 0a1b2c3d',
        'Category: unknown',
        `Organisation: ${TENANT}`,
        `Build: v${buildIdentity().version} · a1b2c3d`,
        'Reply to: someone@example.invalid (sign-in address)',
        `Report reference: ${res.body.reference}`,
      ]),
    );
    expect(mail.attachments).toEqual([
      { filename: 'screenshot.png', contentType: 'image/png', base64: PNG.toString('base64') },
    ]);
    expect(JSON.stringify(mail)).not.toContain('abc.secret');
    expect(JSON.stringify(res.body)).not.toContain('test-password-not-real');
  });

  it("goes to NOTIFY_TO when REPORT_MAIL_TO is empty", async () => {
    const { sent, mailTransport } = relay();
    await request(app({ env: { ...MAIL, REPORT_MAIL_TO: '' }, mailTransport }))
      .post('/api/problem-reports')
      .send({ description: 'x', page: '/' });
    expect(sent[0]!.to).toEqual(['operator@example.invalid']);
  });

  it('checks a screenshot by its first bytes before anything is sent', async () => {
    const { sent, mailTransport } = relay();
    const res = await request(app({ env: MAIL, mailTransport }))
      .post('/api/problem-reports')
      .send({ description: 'x', page: '/', screenshot: { data: Buffer.from('not a picture').toString('base64') } });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('screenshot');
    expect(sent).toEqual([]);
  });

  it('sends to Zammad instead when it is set up too, and answers its ticket', async () => {
    const { sent, mailTransport } = relay();
    const { calls, fetchImpl } = zammad();
    const res = await request(app({ env: { ...MAIL, ...ZAMMAD }, mailTransport, fetchImpl }))
      .post('/api/problem-reports')
      .send({ description: 'x', page: '/' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ticket: '31001' });
    expect(calls).toEqual(['https://help.example.invalid/api/v1/tickets']);
    expect(sent).toEqual([]);
  });

  it('answers a mail the relay refused as a Zammad refusal is answered, with a reference the log page finds', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));
    const res = await request(app({ env: MAIL, mailTransport: relay(true).mailTransport }))
      .post('/api/problem-reports')
      .send({ description: 'x', page: '/' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('report_not_delivered');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: 'error', event: 'report.not-delivered', tenantId: TENANT });
    expect(res.body.reason).toContain(`Reference ${events[0]!.reference}`);
    expect(res.body.reason).toContain('What you wrote is still in the form');
    expect(lines.join('\n')).toContain(`[ref ${events[0]!.reference}]`);
    expect(lines.join('\n')).toContain('the relay is not taking mail');
  });

  it('allows five reports an hour per person, as with Zammad', async () => {
    const { sent, mailTransport } = relay();
    const limiter = createKnockLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
    const a = app({ env: MAIL, mailTransport, limiter });
    for (let i = 0; i < 5; i += 1) {
      expect((await request(a).post('/api/problem-reports').send({ description: 'x', page: '/' })).status).toBe(201);
    }
    const sixth = await request(a).post('/api/problem-reports').send({ description: 'x', page: '/' });
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
    expect(sent).toHaveLength(5);
  });

  it('gives up on a relay that hangs well before the web client stops waiting at thirty seconds', () => {
    const { connectionMs, greetingMs, socketMs } = REPORT_MAIL_TIMEOUTS;
    for (const wait of [connectionMs, greetingMs, socketMs]) {
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(20_000);
    }
  });
});

describe('a day of report mails, for every door together', () => {
  it('is capped, so reports cannot use up the relay the sign-in codes share', () => {
    expect(REPORT_MAIL_PER_DAY).toEqual({ windowMs: 24 * 60 * 60 * 1000, max: 50 });
  });

  it('refuses the form once the day is used up, sends nothing, and says so in the log', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sent, mailTransport } = relay();
    const mailCap = createKnockLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 2 });
    const a = app({ env: MAIL, mailTransport, mailCap });
    for (let i = 0; i < 2; i += 1) {
      const res = await request(a).post('/api/problem-reports').set('x-test-user', `user-${i}`).send({ description: 'x', page: '/' });
      expect(res.status).toBe(201);
    }
    // A third person, well inside their own five an hour.
    const third = await request(a).post('/api/problem-reports').set('x-test-user', 'user-3').send({ description: 'x', page: '/' });
    expect(third.status).toBe(429);
    expect(third.body.error).toBe('too_many_reports');
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(60 * 60);
    expect(sent).toHaveLength(2);
    expect(warned.mock.calls.flat().join(' ')).toContain('report mails a day are used up');
  });

  it('does not count what goes to a Zammad', async () => {
    const mailCap = createKnockLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 1 });
    const { fetchImpl } = zammad();
    const a = app({ env: { ...MAIL, ...ZAMMAD }, fetchImpl, mailCap });
    for (let i = 0; i < 3; i += 1) {
      expect((await request(a).post('/api/problem-reports').set('x-test-user', `z-${i}`).send({ description: 'x', page: '/' })).status).toBe(201);
    }
  });
});

/**
 * A link's report, from a page opened with no account. On PGlite as
 * `app_user`, as `a-link-that-can-be-reported` runs it, so the link is
 * authenticated and the facts read by the product's own code.
 */
describe("a link's report, on a service with mail and no Zammad", () => {
  // UUID family d8a20000-…, unused elsewhere in the repo.
  const LINK_TENANT = 'd8a20000-e29b-41d4-a716-446655440801';
  const SOURCE_CONN = 'd8a20000-e29b-41d4-a716-446655440811';
  const TARGET_CONN = 'd8a20000-e29b-41d4-a716-446655440812';
  const SOURCE_BOX = 'd8a20000-e29b-41d4-a716-446655440821';
  const TARGET_BOX = 'd8a20000-e29b-41d4-a716-446655440822';
  const MAPPING = 'd8a20000-e29b-41d4-a716-446655440831';
  let driver: LedgerDriver;

  const sql = async (text: string, params: unknown[] = []) => {
    const conn = await driver.acquire();
    try {
      await conn.query(text, params);
    } finally {
      await conn.release();
    }
  };
  const mintLink = (purpose: 'grant' | 'view') =>
    withTenant(driver, LINK_TENANT, (db) =>
      issueMappingLink(db, { tenantId: LINK_TENANT, mappingId: MAPPING, purpose, createdBy: 'pat', expiresAt: expiryFromDays(7) }),
    );
  const linkApp = (deps: Parameters<typeof linkReportRoutes>[1]) => {
    const shared = {
      perLink: createKnockLimiter(LINK_REPORT_PER_LINK),
      overall: createKnockLimiter(LINK_REPORT_OVERALL),
      ...deps,
      source: () => driver,
    };
    const a = express();
    a.use(express.json());
    a.use('/api/grant', linkReportRoutes('grant', shared));
    a.use('/api/view', linkReportRoutes('view', shared));
    return a;
  };

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await sql('INSERT INTO tenant (id, name) VALUES ($1, $2)', [LINK_TENANT, 'Acme Legal']);
    await sql('INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1, $2, $3)', [
      LINK_TENANT,
      'pat',
      'owner@example.org',
    ]);
    await sql(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, 'source', 'gmail', 'g', '{"user":"someone@example.invalid"}'::jsonb, 'connected')`,
      [SOURCE_CONN, LINK_TENANT],
    );
    await sql(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, 'target', 'nextcloud', 'nc', '{"host":"cloud.example.org","port":443}'::jsonb, 'connected')`,
      [TARGET_CONN, LINK_TENANT],
    );
    for (const [box, conn] of [
      [SOURCE_BOX, SOURCE_CONN],
      [TARGET_BOX, TARGET_CONN],
    ]) {
      await sql(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1, $2, $3, 'user', 'm@example.invalid')`,
        [box, LINK_TENANT, conn],
      );
    }
    await sql(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, target_config_override, status)
       VALUES ($1, $2, $3, $4, '{"user":"dest@example.org"}'::jsonb, 'paused')`,
      [MAPPING, LINK_TENANT, SOURCE_BOX, TARGET_BOX],
    );
  }, 30_000);

  afterAll(async () => {
    await driver.end?.();
  });

  const REPORT = { description: 'I do not know this organisation.', replyTo: 'reporter@example.invalid' };

  it('is offered with the mail alone, and not with neither', async () => {
    const { token } = await mintLink('grant');
    expect((await request(linkApp({ env: MAIL })).get(`/api/grant/${token}/report`)).body).toEqual({ available: true });
    expect((await request(linkApp({ env: {} })).get(`/api/grant/${token}/report`)).body).toEqual({ available: false });
  });

  it("sends the note to the support mailbox with no Reply-To, the reporter's address in the body, and answers its reference", async () => {
    const link = await mintLink('grant');
    const { sent, timeouts, mailTransport } = relay();
    const res = await request(linkApp({ env: MAIL, mailTransport })).post(`/api/grant/${link.token}/report`).send(REPORT);

    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['reference']);
    expect(sent).toHaveLength(1);
    expect(timeouts).toEqual([REPORT_MAIL_TIMEOUTS]);
    const mail = sent[0]!;
    expect(mail.from).toBe('ownpace@example.invalid');
    expect(mail.to).toEqual(['support@example.invalid']);
    // Reply would quote the note (who issued the link, the accounts, the ids)
    // to an address somebody typed. The owner writes a new mail instead.
    expect('replyTo' in mail).toBe(false);
    expect(mail.subject).toBe('Ownpace: a grant link was reported');
    expect(mail.attachments).toBeUndefined();
    const lines = mail.body.split('\n');
    expect(lines[0]).toBe(LINK_REPORT_MAIL_WARNING);
    expect(LINK_REPORT_MAIL_WARNING).toContain('Reply does not reach the reporter');
    expect(lines).toEqual(
      expect.arrayContaining([
        `Link: ${link.id} (grant link)`,
        `Organisation: Acme Legal (${LINK_TENANT})`,
        'Access: not given',
        'Reply to: reporter@example.invalid (typed by the reporter, not verified)',
        `Report reference: ${res.body.reference}`,
      ]),
    );
    expect(mail.body.endsWith(`\n\nWhat they wrote:\n${REPORT.description}`)).toBe(true);
    const secret = link.token.slice(link.token.indexOf('.') + 1);
    expect(JSON.stringify(mail)).not.toContain(secret);
  });

  it('has no Reply-To when the reporter gave no address either, and its note says nobody can be answered', async () => {
    const link = await mintLink('view');
    const { sent, mailTransport } = relay();
    const res = await request(linkApp({ env: MAIL, mailTransport }))
      .post(`/api/view/${link.token}/report`)
      .send({ description: 'x', replyTo: '  ' });
    expect(res.status).toBe(201);
    expect(sent[0]!.replyTo).toBeUndefined();
    expect('replyTo' in sent[0]!).toBe(false);
    expect(sent[0]!.subject).toBe('Ownpace: a progress link was reported');
    expect(sent[0]!.body.split('\n')).toContain('Reply to: none. The reporter left no address, so nobody can be answered');
  });

  it('goes to Zammad instead when it is set up too', async () => {
    const link = await mintLink('grant');
    const { sent, mailTransport } = relay();
    const { calls, fetchImpl } = zammad();
    const res = await request(linkApp({ env: { ...MAIL, ...ZAMMAD }, mailTransport, fetchImpl }))
      .post(`/api/grant/${link.token}/report`)
      .send(REPORT);
    expect(res.body).toEqual({ ticket: '31001' });
    expect(calls).toEqual(['https://help.example.invalid/api/v1/tickets']);
    expect(sent).toEqual([]);
  });

  it('answers a mail the relay refused with a 502 and a reference, and counts it against the link as a refused ticket is counted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const link = await mintLink('grant');
    const a = linkApp({ env: MAIL, mailTransport: relay(true).mailTransport });
    const res = await request(a).post(`/api/grant/${link.token}/report`).send(REPORT);
    expect(res.status).toBe(502);
    expect(events[0]).toMatchObject({ event: 'report.not-delivered', tenantId: LINK_TENANT });
    expect(res.body.reason).toContain(`Reference ${events[0]!.reference}`);
    // The per-link limit is the same whichever way the report travels.
    await request(a).post(`/api/grant/${link.token}/report`).send(REPORT);
    await request(a).post(`/api/grant/${link.token}/report`).send(REPORT);
    expect((await request(a).post(`/api/grant/${link.token}/report`).send(REPORT)).status).toBe(429);
  });

  it("counts against the same day's cap as the signed-in form, and sends nothing past it", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mailCap = createKnockLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 1 });
    const { sent, mailTransport } = relay();
    // The signed-in form uses the day's one mail...
    expect(
      (await request(app({ env: MAIL, mailTransport, mailCap })).post('/api/problem-reports').send({ description: 'x', page: '/' }))
        .status,
    ).toBe(201);
    // ...so a link's report, on a fresh link well inside its own limits, is refused.
    const link = await mintLink('view');
    const res = await request(linkApp({ env: MAIL, mailTransport, mailCap })).post(`/api/view/${link.token}/report`).send(REPORT);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('too_many_reports');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(sent).toHaveLength(1);
  });
});
