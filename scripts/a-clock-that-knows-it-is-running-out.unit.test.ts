// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CLOCK THAT KNOWS IT IS RUNNING OUT: nothing warned before a production
 * certificate, the site's `security.txt` or the Microsoft Entra client secret
 * reached its end date.
 *
 * Found on 2026-10-21. NetBird's reverse proxy ends TLS for `app.`, `id.` and
 * `status.ownpace.eu` (and `www.` once it is routed to live) and renews their
 * certificates itself. A renewal that fails, after a DNS or CAA change or a
 * fault in the proxy, showed only at expiry. Live's status rows verify TLS and
 * live's alerts mail the owner, but only once the certificate has expired, and
 * only for the names they probe: `id.` is probed on its container port and
 * `status.` not by its public name at all. Let's Encrypt stopped its expiry
 * mails on 2025-06-04, and any authority's notice would reach NetBird's
 * account, not the owner. Certificates keep getting shorter (CA/B Forum ballot
 * SC-081v3: 200 days since 2026-03-15, 100 from 2027-03-15, 47 from
 * 2029-03-15), so there are more renewals to fail. `security.txt`'s `Expires`
 * is the site build's day plus 180 days (`site/security-txt.mjs`), renewed only
 * by a live deploy. And the Entra client secret both stacks share has an end
 * date nobody had written down: when it passes, every Microsoft connection on
 * both stacks fails its next token refresh at once, while the nightly smoke,
 * which builds the consent URL and never exchanges a token, stays green.
 *
 * `scripts/clock-watch.mjs` now reads each clock once a day from a
 * GitHub-hosted runner and keeps ONE issue open while any clock is inside its
 * window: fewer than 14 days left on a production certificate, fewer than 30
 * on `security.txt`'s `Expires` or on the secret's recorded date. This holds
 * the windows and their arithmetic, which names count and which are only
 * reported, that a clock it could not read is never called fine, the one
 * issue, what the public log may print, and the workflow that runs it. The
 * network is stubbed, and so is `gh`.
 *
 * 14 DAYS, NOT MORE. Let's Encrypt's default certificate becomes 64 days on
 * 2027-02-10, and an ACME client renews with about a third of the lifetime
 * left, about 21 days. A window of 21 days or more would open the issue on
 * every healthy renewal, and an issue that opens for nothing is soon ignored.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import * as probe from './exposure-probe.mjs';
import {
  CERTIFICATE_DAYS,
  ENTRA_DAYS,
  ISSUE_TITLE,
  SECURITY_TXT_DAYS,
  SECURITY_TXT_URL,
  issueBody,
  keepIssue,
  realNetwork,
  runWatch,
  securityTxtExpires,
  watchConfig,
  type Clock,
  type WatchConfig,
  type WatchIo,
} from './clock-watch.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const WORKFLOW_FILE = '.github/workflows/clock-watch.yml';

const DAY = 24 * 60 * 60 * 1000;
/** The run: 2026-10-21, 06:41 UTC, the workflow's own minute. */
const NOW = new Date('2026-10-21T06:41:00Z');

/** A date as OpenSSL prints a certificate's `notAfter`, which is what Node's `valid_to` carries. */
function openSslDate(d: Date): string {
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = String(d.getUTCDate()).padStart(2, ' ');
  const time = d.toISOString().slice(11, 19);
  return `${month} ${day} ${time} ${d.getUTCFullYear()} GMT`;
}
/** A certificate that runs until `days` days (and an hour) after NOW, and verifies. */
const certIn = (days: number) => ({ validTo: openSslDate(new Date(NOW.getTime() + days * DAY + 3600_000)), verified: true });
const isoDay = (days: number) => new Date(NOW.getTime() + days * DAY + 3600_000).toISOString().slice(0, 10);

/** A security.txt as the site build writes it, with `Expires` `days` days after NOW. */
function securityTxtIn(days: number): string {
  const expires = new Date(NOW.getTime() + days * DAY + 3600_000).toISOString();
  return [
    'Contact: https://github.com/Robbes/Ownpace/security/advisories/new',
    'Contact: mailto:support@ownpace.eu',
    `Expires: ${expires}`,
    'Preferred-Languages: en, nl',
    '',
  ].join('\n');
}

const OFF: WatchConfig = { site: false };

/** A network that answers each name from `certs` (anything missing does not resolve) and records what was asked. */
function fakeIo(certs: Record<string, ReturnType<typeof certIn> | { why: string } | { validTo: string; verified: false; why: string }>, site?: { text?: string; why?: string }) {
  const asked: string[] = [];
  const io: WatchIo = {
    certificate: async (name) => {
      asked.push(name);
      return certs[name] ?? { why: 'ENOTFOUND' };
    },
    securityTxt: async (url) => {
      asked.push(url);
      return site ?? { why: 'ENOTFOUND' };
    },
  };
  return { io, asked };
}

/** Every production and OTA name with a certificate `days` days from expiry. */
function allIn(days: number) {
  return Object.fromEntries([...probe.PRODUCTION_NAMES, ...probe.OTA_NAMES, probe.SITE_NAME].map((n) => [n, certIn(days)]));
}

type Issue = { number: number; title: string; body: string; state: 'open' | 'closed' };

/**
 * A `gh` that answers `issue list` and `issue view` as the real one would,
 * records those reads in `reads`, and records every other call in `calls`.
 */
function fakeGh(issues: Issue[]) {
  const calls: string[][] = [];
  const reads: string[][] = [];
  const pick = (issue: Issue, args: string[]) =>
    Object.fromEntries((args[args.indexOf('--json') + 1] ?? '').split(',').map((f) => [f, issue[f as keyof Issue]]));
  const gh = (args: string[]) => {
    if (args[0] === 'issue' && args[1] === 'list') {
      reads.push(args);
      const state = args[args.indexOf('--state') + 1];
      return JSON.stringify(issues.filter((i) => state === 'all' || i.state === state).map((i) => pick(i, args)));
    }
    if (args[0] === 'issue' && args[1] === 'view') {
      reads.push(args);
      const issue = issues.find((i) => String(i.number) === args[2]);
      if (!issue) throw new Error(`no issue ${args[2]}`);
      return JSON.stringify(pick(issue, args));
    }
    calls.push(args);
    return '';
  };
  return { gh, calls, reads };
}

const OTHER: Issue = { number: 7, title: 'Something else', body: 'x', state: 'open' };

describe('the clocks it reads', () => {
  it("watches the outside probe's names, so a name added there is watched here too", async () => {
    const source = read('scripts/clock-watch.mjs');
    expect(source).toMatch(/import \{[^}]*\bPRODUCTION_NAMES\b[^}]*\} from '\.\/exposure-probe\.mjs'/);
    expect(source).toMatch(/import \{[^}]*\bOTA_NAMES\b[^}]*\} from '\.\/exposure-probe\.mjs'/);
    const { io, asked } = fakeIo(allIn(60));
    await runWatch(OFF, io, NOW);
    expect(asked).toEqual([...probe.PRODUCTION_NAMES, ...probe.OTA_NAMES]);
  });

  it("asks www.ownpace.eu and its security.txt only when CLOCK_WATCH_SITE is required", async () => {
    const off = fakeIo(allIn(60), { text: securityTxtIn(120) });
    const quiet = await runWatch(OFF, off.io, NOW);
    expect(off.asked).not.toContain(probe.SITE_NAME);
    expect(off.asked).not.toContain(SECURITY_TXT_URL);
    expect(quiet.lines.join('\n')).toMatch(/www\.ownpace\.eu: not asked; CLOCK_WATCH_SITE is not required/);

    const on = fakeIo(allIn(60), { text: securityTxtIn(120) });
    const { clocks } = await runWatch({ site: true }, on.io, NOW);
    expect(SECURITY_TXT_URL).toBe(`https://${probe.SITE_NAME}/.well-known/security.txt`);
    expect(on.asked).toContain(probe.SITE_NAME);
    expect(on.asked).toContain(SECURITY_TXT_URL);
    expect(clocks.filter((c) => c.counted).map((c) => `${c.kind} ${c.name}`)).toEqual([
      ...probe.PRODUCTION_NAMES.map((n) => `certificate ${n}`),
      `certificate ${probe.SITE_NAME}`,
      `security.txt ${probe.SITE_NAME}/.well-known/security.txt`,
    ]);
  });

  it('warns 14 days ahead of a certificate, and 30 ahead of security.txt and the Entra secret', () => {
    expect(CERTIFICATE_DAYS).toBe(14);
    expect(SECURITY_TXT_DAYS).toBe(30);
    expect(ENTRA_DAYS).toBe(30);
  });

  it('calls a certificate with 14 whole days left fine, and one with 13 inside its window', async () => {
    const { io } = fakeIo({ 'app.ownpace.eu': certIn(14), 'id.ownpace.eu': certIn(13), 'status.ownpace.eu': certIn(90) });
    const { clocks, lines } = await runWatch(OFF, io, NOW);
    const byName = (n: string) => clocks.find((c) => c.name === n)!;
    expect(byName('app.ownpace.eu')).toMatchObject({ state: 'ok', daysLeft: 14, expires: isoDay(14) });
    expect(byName('id.ownpace.eu')).toMatchObject({ state: 'due', daysLeft: 13, expires: isoDay(13) });
    expect(byName('status.ownpace.eu').state).toBe('ok');
    expect(lines).toContain(`DUE   id.ownpace.eu: certificate valid until ${isoDay(13)}, 13 days left, fewer than 14`);
  });

  it("reads Node's own shape of a date, a single-digit day padded with a space", async () => {
    const { io } = fakeIo({
      'app.ownpace.eu': { validTo: 'Nov  2 23:59:59 2026 GMT', verified: true },
      'id.ownpace.eu': certIn(60),
      'status.ownpace.eu': certIn(60),
    });
    const { clocks } = await runWatch(OFF, io, NOW);
    expect(clocks[0]).toMatchObject({ name: 'app.ownpace.eu', expires: '2026-11-02', daysLeft: 12, state: 'due' });
  });

  it('counts an expired certificate, and one that does not verify, with its code; the date is still read', async () => {
    const { io } = fakeIo({
      'app.ownpace.eu': { validTo: openSslDate(new Date(NOW.getTime() - 2 * DAY)), verified: false, why: 'CERT_HAS_EXPIRED' },
      'id.ownpace.eu': { ...certIn(60), verified: false, why: 'ERR_TLS_CERT_ALTNAME_INVALID' } as const,
      'status.ownpace.eu': certIn(60),
    });
    const { clocks, lines, code } = await runWatch(OFF, io, NOW);
    expect(clocks[0]).toMatchObject({ state: 'due', daysLeft: -2, verified: false, why: 'CERT_HAS_EXPIRED' });
    expect(clocks[1]).toMatchObject({ state: 'due', daysLeft: 60, verified: false, why: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    expect(lines.join('\n')).toMatch(/DUE {3}app\.ownpace\.eu: certificate valid until \S+, expired 2 days ago, and it does not verify \(CERT_HAS_EXPIRED\)/);
    expect(lines.join('\n')).toMatch(/DUE {3}id\.ownpace\.eu: certificate valid until \S+, 60 days left, and it does not verify \(ERR_TLS_CERT_ALTNAME_INVALID\)/);
    expect(code, 'a clock inside its window is the issue\'s to say, not a red run').toBe(0);
  });

  it('never calls a production certificate it could not read fine: the run fails, and says why by its code', async () => {
    const { io } = fakeIo({ 'app.ownpace.eu': certIn(60), 'id.ownpace.eu': certIn(60) });
    const { clocks, lines, code } = await runWatch(OFF, io, NOW);
    expect(clocks.find((c) => c.name === 'status.ownpace.eu')).toMatchObject({ state: 'unread', why: 'ENOTFOUND' });
    expect(lines).toContain('FAIL  status.ownpace.eu: certificate not read (ENOTFOUND)');
    expect(code).toBe(1);
  });

  it("reports the OTA names and counts none of them: inside the window, or not read, it fails nothing", async () => {
    const certs: Record<string, ReturnType<typeof certIn> | { why: string }> = { ...allIn(60), 'app.ota.ownpace.eu': certIn(3) };
    delete certs['id.ota.ownpace.eu'];
    const { io } = fakeIo(certs);
    const { clocks, lines, code } = await runWatch(OFF, io, NOW);
    const ota = clocks.filter((c) => (probe.OTA_NAMES as readonly string[]).includes(c.name));
    expect(ota.map((c) => c.counted)).toEqual([false, false, false]);
    expect(lines.join('\n')).toMatch(/^note {2}app\.ota\.ownpace\.eu: certificate valid until \S+, 3 days left, fewer than 14; the OTA stack's, reported and not counted$/m);
    expect(lines.join('\n')).toMatch(/^note {2}id\.ota\.ownpace\.eu: certificate not read \(ENOTFOUND\); the OTA stack's, reported and not counted$/m);
    expect(code).toBe(0);
    const { gh, calls } = fakeGh([]);
    expect(keepIssue(clocks, gh)).toBe('untouched');
    expect(calls).toEqual([]);
  });
});

describe("security.txt's Expires", () => {
  it('is fine with 30 whole days left, and inside its window with 29', async () => {
    for (const [days, state] of [
      [30, 'ok'],
      [29, 'due'],
    ] as const) {
      const { io } = fakeIo(allIn(60), { text: securityTxtIn(days) });
      const { clocks } = await runWatch({ site: true }, io, NOW);
      expect(clocks.find((c) => c.kind === 'security.txt')).toMatchObject({ state, daysLeft: days, expires: isoDay(days) });
    }
  });

  it('reads the field whatever its case and whatever line endings the file has', () => {
    const text = 'Contact: mailto:support@ownpace.eu\r\nexpires: 2027-04-19T00:00:00.000z\r\n';
    expect(securityTxtExpires(text)).toEqual({ expires: new Date('2027-04-19T00:00:00.000Z') });
  });

  it("counts a file with no Expires, with two, or with one that is not a date: RFC 9116 requires exactly one", () => {
    expect(securityTxtExpires('Contact: mailto:support@ownpace.eu\n')).toEqual({ why: 'it has no Expires line' });
    expect(securityTxtExpires('Expires: 2027-04-19T00:00:00.000Z\nExpires: 2027-05-19T00:00:00.000Z\n')).toEqual({ why: 'it has 2 Expires lines, not one' });
    expect(securityTxtExpires('Expires: next spring\n')).toEqual({ why: 'its Expires is not a date' });
  });

  it('counts a file that says nothing, and fails the run on one it could not fetch', async () => {
    const empty = fakeIo(allIn(60), { text: '<html>a parked domain</html>' });
    const counted = await runWatch({ site: true }, empty.io, NOW);
    expect(counted.clocks.find((c) => c.kind === 'security.txt')).toMatchObject({ state: 'due', why: 'it has no Expires line' });
    expect(counted.code).toBe(0);

    const gone = fakeIo(allIn(60), { why: 'HTTP 404' });
    const failed = await runWatch({ site: true }, gone.io, NOW);
    expect(failed.clocks.find((c) => c.kind === 'security.txt')).toMatchObject({ state: 'unread', why: 'HTTP 404' });
    expect(failed.lines).toContain(`FAIL  ${probe.SITE_NAME}/.well-known/security.txt: not read (HTTP 404)`);
    expect(failed.code).toBe(1);
  });
});

describe("the Entra client secret's date", () => {
  it('is only what the repository variable records: none set is said, and asks nothing', async () => {
    const { config } = watchConfig({});
    expect(config).toEqual({ site: false });
    const { io, asked } = fakeIo(allIn(60));
    const { lines, clocks } = await runWatch(config!, io, NOW);
    expect(asked).not.toContain('entra');
    expect(clocks.some((c) => c.kind === 'entra')).toBe(false);
    expect(lines.join('\n')).toMatch(/the Microsoft Entra client secret: no date; CLOCK_WATCH_ENTRA_EXPIRES is not set/);
  });

  it('is inside its window with 29 whole days left, and fine with 30: the date is read as its first moment, UTC', async () => {
    // From 2026-10-21 06:41 UTC, 2026-11-20 00:00 UTC is 29 days and 17 hours away.
    for (const [date, state, left] of [
      ['2026-11-21', 'ok', 30],
      ['2026-11-20', 'due', 29],
      ['2026-10-20', 'due', -2],
    ] as const) {
      const { config } = watchConfig({ CLOCK_WATCH_ENTRA_EXPIRES: ` ${date} ` });
      const { io, asked } = fakeIo(allIn(60));
      const { clocks } = await runWatch(config!, io, NOW);
      expect(clocks.find((c) => c.kind === 'entra'), date).toMatchObject({ counted: true, expires: date, daysLeft: left, state });
      expect(asked, 'the date is the variable, and nothing is asked for it').toEqual([...probe.PRODUCTION_NAMES, ...probe.OTA_NAMES]);
    }
  });

  it('refuses a value that is not one calendar date, and repeats none of it: a variable is printed in the log', () => {
    for (const value of ['2026-02-30', '20261120', '21/04/2027', 'n0t~a.date-but-a-secret-value']) {
      const { config, errors } = watchConfig({ CLOCK_WATCH_ENTRA_EXPIRES: value });
      expect(config, value).toBeUndefined();
      expect(errors.join(' '), value).toMatch(/CLOCK_WATCH_ENTRA_EXPIRES must be one date, YYYY-MM-DD/);
      expect(errors.join(' ')).toMatch(/if it holds the secret itself, delete the variable and renew the secret/);
      expect(errors.join(' '), value).not.toContain(value);
    }
  });

  it("takes CLOCK_WATCH_SITE as empty or required, and refuses anything else rather than guess", () => {
    expect(watchConfig({ CLOCK_WATCH_SITE: '' }).config).toEqual({ site: false });
    expect(watchConfig({ CLOCK_WATCH_SITE: 'required' }).config).toEqual({ site: true });
    const { config, errors } = watchConfig({ CLOCK_WATCH_SITE: 'yes' });
    expect(config).toBeUndefined();
    expect(errors).toEqual(['CLOCK_WATCH_SITE must be empty or required.']);
  });
});

describe('what the public log may print', () => {
  it('names and dates: no address, no subject, no issuer, whatever the network handed back', async () => {
    const { io } = fakeIo({
      ...allIn(60),
      'app.ownpace.eu': { why: 'ECONNREFUSED' },
    });
    const { lines } = await runWatch({ site: true, entra: '2027-03-14' }, io, NOW);
    const text = lines.join('\n');
    expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(text).not.toMatch(/CN=|O=|issuer|subject/i);
  });

  it("asks over TLS by the name itself, and reads a certificate that does not verify instead of refusing it", async () => {
    const options: Array<Record<string, unknown>> = [];
    const socket = (behave: (s: FakeSocket) => void) => (o: Record<string, unknown>) => {
      options.push(o);
      const s = new FakeSocket();
      queueMicrotask(() => behave(s));
      return s;
    };
    const expired = realNetwork({
      connect: socket((s) => {
        s.authorized = false;
        s.authorizationError = 'CERT_HAS_EXPIRED';
        s.cert = { valid_to: 'Oct 19 06:00:00 2026 GMT', subject: { CN: 'app.ownpace.eu' } };
        s.emit('secureConnect');
      }),
    });
    expect(await expired.certificate('app.ownpace.eu')).toEqual({ validTo: 'Oct 19 06:00:00 2026 GMT', verified: false, why: 'CERT_HAS_EXPIRED' });
    expect(options[0]).toMatchObject({ host: 'app.ownpace.eu', servername: 'app.ownpace.eu', port: 443, rejectUnauthorized: false });

    const fine = realNetwork({
      connect: socket((s) => {
        s.authorized = true;
        s.cert = { valid_to: 'Dec 30 06:00:00 2026 GMT' };
        s.emit('secureConnect');
      }),
    });
    expect(await fine.certificate('id.ownpace.eu')).toEqual({ validTo: 'Dec 30 06:00:00 2026 GMT', verified: true });
  });

  it("keeps an error's code and never Node's message, which names the address it failed on", async () => {
    const refused = realNetwork({
      connect: () => {
        const s = new FakeSocket();
        queueMicrotask(() => s.emit('error', Object.assign(new Error('connect ECONNREFUSED 192.0.2.10:443'), { code: 'ECONNREFUSED' })));
        return s;
      },
    });
    const answer = await refused.certificate('app.ownpace.eu');
    expect(answer).toEqual({ why: 'ECONNREFUSED' });
    expect(JSON.stringify(answer)).not.toContain('192.0.2.10');

    const worded = realNetwork({
      connect: () => {
        const s = new FakeSocket();
        queueMicrotask(() => {
          s.authorized = false;
          s.authorizationError = "Hostname/IP does not match certificate's altnames: IP: 192.0.2.10";
          s.cert = { valid_to: 'Dec 30 06:00:00 2026 GMT' };
          s.emit('secureConnect');
        });
        return s;
      },
    });
    expect(await worded.certificate('app.ownpace.eu')).toEqual({ validTo: 'Dec 30 06:00:00 2026 GMT', verified: false, why: 'not verified' });
  });

  describe("security.txt, fetched as a visitor's first request", () => {
    let server: Server | undefined;
    afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
    const serve = (status: number, body: string, headers: Record<string, string> = {}) =>
      new Promise<string>((done) => {
        server = createServer((_req, res) => {
          res.writeHead(status, headers);
          res.end(body);
        }).listen(0, '127.0.0.1', () => {
          const address = server!.address();
          done(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/.well-known/security.txt`);
        });
      });

    it('hands back the text of a 200', async () => {
      const url = await serve(200, securityTxtIn(100));
      expect(await realNetwork({ fetchMs: 3000 }).securityTxt(url)).toEqual({ text: securityTxtIn(100) });
    });

    it('follows no redirect and says the status of anything but a 200', async () => {
      expect(await realNetwork({ fetchMs: 3000 }).securityTxt(await serve(301, '', { Location: 'https://example.org/' }))).toEqual({ why: 'HTTP 301' });
      server!.close();
      server = undefined;
      expect(await realNetwork({ fetchMs: 3000 }).securityTxt(await serve(404, 'no'))).toEqual({ why: 'HTTP 404' });
    });
  });
});

describe('the one issue', () => {
  const due = (over: Partial<Clock> = {}): Clock => ({
    kind: 'certificate',
    name: 'id.ownpace.eu',
    counted: true,
    window: CERTIFICATE_DAYS,
    state: 'due',
    expires: '2026-11-01',
    daysLeft: 11,
    verified: true,
    ...over,
  });
  const ok = (name: string): Clock => ({ kind: 'certificate', name, counted: true, window: CERTIFICATE_DAYS, state: 'ok', expires: '2027-01-05', daysLeft: 76, verified: true });
  const watch = (body: string, state: Issue['state'] = 'open'): Issue => ({ number: 42, title: ISSUE_TITLE, body, state });

  it('opens one when a clock is inside its window and none is open', () => {
    const clocks = [ok('app.ownpace.eu'), due()];
    const { gh, calls } = fakeGh([OTHER, watch(issueBody([due()]), 'closed')]);
    expect(keepIssue(clocks, gh)).toBe('opened');
    expect(calls).toEqual([['issue', 'create', '--title', ISSUE_TITLE, '--body', issueBody([due()])]]);
  });

  it('writes nothing on the next day: the body carries dates, never a count of days left', () => {
    const today = [due({ daysLeft: 47, verified: false, why: 'ERR_TLS_CERT_ALTNAME_INVALID' })];
    const tomorrow = [due({ daysLeft: 46, verified: false, why: 'ERR_TLS_CERT_ALTNAME_INVALID' })];
    expect(issueBody(tomorrow)).toBe(issueBody(today));
    expect(issueBody(today)).not.toMatch(/\b4[67]\b/);
    for (const body of [issueBody(today), issueBody(today).replace(/\n/g, '\r\n') + '\r\n']) {
      const { gh, calls } = fakeGh([OTHER, watch(body)]);
      expect(keepIssue(tomorrow, gh)).toBe('unchanged');
      expect(calls).toEqual([]);
    }
  });

  it('brings the open one up to date when what is inside its window changes, and says so in a comment', () => {
    const before = [due()];
    const after = [due(), due({ name: 'app.ownpace.eu', expires: '2026-11-03' })];
    const { gh, calls } = fakeGh([OTHER, watch(issueBody(before))]);
    expect(keepIssue(after, gh)).toBe('updated');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(['issue', 'edit', '42', '--body', issueBody(after)]);
    expect(calls[1]!.slice(0, 3)).toEqual(['issue', 'comment', '42']);
    expect(calls[1]![4]).toContain('**app.ownpace.eu**');
  });

  it('closes it once every clock was read and none is inside its window, and leaves every other issue alone', () => {
    const { gh, calls } = fakeGh([OTHER, watch(issueBody([due()]))]);
    expect(keepIssue([ok('app.ownpace.eu'), ok('id.ownpace.eu')], gh)).toBe('closed');
    expect(calls).toEqual([['issue', 'close', '42', '--comment', 'Every clock is outside its window again.']]);
  });

  it('closes nothing while a clock could not be read: not knowing is not "fine"', () => {
    const unread: Clock = { kind: 'certificate', name: 'id.ownpace.eu', counted: true, window: CERTIFICATE_DAYS, state: 'unread', why: 'ETIMEDOUT' };
    const { gh, calls } = fakeGh([OTHER, watch(issueBody([due()]))]);
    expect(keepIssue([ok('app.ownpace.eu'), unread], gh)).toBe('untouched');
    expect(calls).toEqual([]);
  });

  it('leaves the open one as it is while a clock could not be read, even when another is inside its window', () => {
    // app. and id. are both inside their window and the issue lists both; the
    // next day id. times out. Dropping it would edit and comment twice over a
    // network blip, and for a day not name a clock that is still running out.
    const app = due({ name: 'app.ownpace.eu', expires: '2026-11-03' });
    const unread: Clock = { kind: 'certificate', name: 'id.ownpace.eu', counted: true, window: CERTIFICATE_DAYS, state: 'unread', why: 'ETIMEDOUT' };
    const { gh, calls } = fakeGh([OTHER, watch(issueBody([app, due()]))]);
    expect(keepIssue([app, unread], gh)).toBe('untouched');
    expect(calls).toEqual([]);
  });

  it('still opens one for a clock inside its window while another could not be read, when none is open', () => {
    const unread: Clock = { kind: 'certificate', name: 'app.ownpace.eu', counted: true, window: CERTIFICATE_DAYS, state: 'unread', why: 'ETIMEDOUT' };
    const { gh, calls } = fakeGh([OTHER]);
    expect(keepIssue([unread, due()], gh)).toBe('opened');
    expect(calls).toEqual([['issue', 'create', '--title', ISSUE_TITLE, '--body', issueBody([due()])]]);
  });

  it('lists the open issues by number and title only, and reads the one body it compares', () => {
    // A list with every body grows with every issue anyone opens, past the
    // buffer the run reads it into; a title is at most 256 characters.
    const { gh, calls, reads } = fakeGh([OTHER, watch(issueBody([due()]))]);
    expect(keepIssue([due()], gh)).toBe('unchanged');
    expect(calls).toEqual([]);
    const list = reads.find((r) => r[1] === 'list')!;
    expect(list[list.indexOf('--json') + 1]).toBe('number,title');
    expect(reads.filter((r) => r[1] === 'view')).toEqual([['issue', 'view', '42', '--json', 'body']]);

    const quiet = fakeGh([OTHER, watch(issueBody([due()]))]);
    expect(keepIssue([ok('app.ownpace.eu'), ok('id.ownpace.eu')], quiet.gh)).toBe('closed');
    expect(quiet.reads.filter((r) => r[1] === 'view'), 'closing reads no body').toEqual([]);
  });

  it('names each clock and its date, the window, and the route for each kind it lists', () => {
    const body = issueBody([
      due({ verified: false, why: 'CERT_HAS_EXPIRED', expires: '2026-10-19', daysLeft: -2 }),
      { kind: 'security.txt', name: 'www.ownpace.eu/.well-known/security.txt', counted: true, window: 30, state: 'due', expires: '2027-04-19', daysLeft: 20 },
      { kind: 'entra', name: 'the Microsoft Entra client secret', counted: true, window: 30, state: 'due', expires: '2027-03-14', daysLeft: 25 },
    ]);
    expect(body).toContain('**id.ownpace.eu**');
    expect(body).toContain('**2026-10-19**');
    expect(body).toContain('`CERT_HAS_EXPIRED`');
    expect(body).toContain('**2027-04-19**');
    expect(body).toContain('**2027-03-14**');
    expect(body).toMatch(/NetBird/);
    expect(body).toMatch(/deploy-live\.sh/);
    expect(body).toMatch(/CLOCK_WATCH_ENTRA_EXPIRES/);
    expect(body).toMatch(/docs\/managed-bring-up\.md/);
    expect(body).toContain('`.github/workflows/clock-watch.yml`');

    const certOnly = issueBody([due()]);
    expect(certOnly).not.toMatch(/deploy-live\.sh|CLOCK_WATCH_ENTRA_EXPIRES/);
  });

  it('never lists a clock that is only reported', () => {
    const ota = due({ name: 'app.ota.ownpace.eu', counted: false });
    expect(issueBody([due(), ota])).not.toContain('app.ota.ownpace.eu');
    const { gh, calls } = fakeGh([]);
    expect(keepIssue([ok('app.ownpace.eu'), ota], gh)).toBe('untouched');
    expect(calls).toEqual([]);
  });
});

describe(`${WORKFLOW_FILE}`, () => {
  const workflow = parseYaml(read(WORKFLOW_FILE)) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<string, { 'runs-on': string; steps: Array<{ run?: string; env?: Record<string, string>; with?: Record<string, unknown>; uses?: string }> }>;
  };

  it('runs once a day off the hour, and on demand, and never on a pull request or a push', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    const crons = (workflow.on.schedule as Array<{ cron: string }>).map((s) => s.cron);
    expect(crons).toHaveLength(1);
    const [minute, hour, dayOfMonth, month, dayOfWeek] = crons[0]!.trim().split(/\s+/);
    expect(minute, 'off the hour: GitHub delays the runs scheduled on it').toMatch(/^([1-9]|[1-5]\d)$/);
    expect(hour).toMatch(/^\d{1,2}$/);
    expect([dayOfMonth, month, dayOfWeek], 'every day').toEqual(['*', '*', '*']);
  });

  it('may read the code and write issues, and nothing else', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', issues: 'write' });
  });

  it('runs on a GitHub-hosted runner, from where a tester stands, with the two variables and no secret', () => {
    const jobs = Object.values(workflow.jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!['runs-on']).toMatch(/^ubuntu-/);
    const runs = jobs[0]!.steps.filter((s) => s.run);
    expect(runs.map((s) => s.run!.trim())).toEqual(['node scripts/clock-watch.mjs --issue']);
    expect(runs[0]!.env).toEqual({
      GH_TOKEN: '${{ github.token }}',
      GH_REPO: '${{ github.repository }}',
      CLOCK_WATCH_SITE: '${{ vars.CLOCK_WATCH_SITE }}',
      CLOCK_WATCH_ENTRA_EXPIRES: '${{ vars.CLOCK_WATCH_ENTRA_EXPIRES }}',
    });
    expect(read(WORKFLOW_FILE)).not.toMatch(/secrets\./);
    const checkout = jobs[0]!.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });
});

describe('the docs that set the two variables', () => {
  it("the site's switch-on sets CLOCK_WATCH_SITE=required where it routes www.ownpace.eu to live", () => {
    const bringUp = read('docs/managed-bring-up.md');
    const step = bringUp.slice(bringUp.indexOf('4. Route `www.ownpace.eu` to live'));
    expect(step.slice(0, 1200)).toMatch(/`CLOCK_WATCH_SITE` to `required`/);
  });

  it("the Entra registration says the secret expires, and records its date in CLOCK_WATCH_ENTRA_EXPIRES", () => {
    const bringUp = read('docs/managed-bring-up.md');
    const section = bringUp.slice(bringUp.indexOf("#### The deployment's own Entra registration"), bringUp.indexOf('### 8f.'));
    // The cap is the portal's: a secret made through Graph or PowerShell can
    // run longer unless an app-management policy caps it.
    expect(section.replace(/\s+/g, ' ')).toMatch(/made in the portal[^.]*24 months at most/);
    expect(section).toMatch(/`CLOCK_WATCH_ENTRA_EXPIRES`/);
    expect(section).toMatch(/stores neither half/);
    const setup = read('docs/microsoft-setup.md');
    const secret = setup.slice(setup.indexOf('### The client secret'), setup.indexOf('## 2. Consent'));
    expect(secret.replace(/\s+/g, ' ')).toMatch(/made in the portal[^.]*24 months at most/);
    expect(secret).toMatch(/30 days/);
  });

  it("the renewal's OTA step writes the persisted .env whatever the checkout has, and the checkout's own copy too", () => {
    // The nightly reads the persisted file; an OTA checkout may keep a copy of
    // its own (*The OTA stack: the nightly gate, or a pull*), which a hand-run
    // compose call reads. A STOP on a copy left the owner no route.
    const bringUp = read('docs/managed-bring-up.md');
    const section = bringUp.slice(bringUp.indexOf("#### The deployment's own Entra registration"), bringUp.indexOf('### 8f.'));
    const ota = section.slice(section.indexOf('2. The OTA stack'), section.indexOf('3. Live'));
    expect(ota).not.toMatch(/STOP/);
    expect(ota).toMatch(/env-upsert\.sh --stdin ~\/\.persistent\/ownpace-managed\/\.env/);
    expect(ota.replace(/\s+/g, ' ')).toMatch(/`a copy`.*`deploy\/compose\/\.env` in place of the persisted path/);
  });

  it("docs/testing.md says what keeps the issue open: a window, a certificate that does not verify, a security.txt without one Expires", () => {
    const testing = read('docs/testing.md');
    const start = testing.indexOf('- `clock-watch.yml`');
    const bullet = testing.slice(start, testing.indexOf('\n- ', start + 1));
    expect(bullet).toMatch(/fewer than 14/);
    expect(bullet).toMatch(/does not verify/);
    expect(bullet).toMatch(/exactly one `Expires`/);
  });
});

/** Enough of a TLS socket for the reader: its events, its verdict and its certificate. */
class FakeSocket extends EventEmitter {
  authorized = false;
  authorizationError: string | undefined;
  cert: Record<string, unknown> = {};
  destroyed = false;
  setTimeout() {
    return this;
  }
  getPeerCertificate() {
    return this.cert;
  }
  destroy() {
    this.destroyed = true;
    return this;
  }
}
