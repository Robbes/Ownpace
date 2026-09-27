// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROBE THAT DOES NOT READ ALOUD (workplan 0136 T3).
 *
 * The managed Test button connects to whatever address a tester types, and it
 * answered with whatever came back there. A DAV source put the response body
 * into its refusal and the refusal was the answer, the qualification put the
 * same sentence on every face it could not measure, and a socket error named
 * the address and port it tried. So any member of any organisation could
 * point the button at an address inside our network and read what answered:
 * an admin page, a JSON document, the fact that a port was open (0136 §1,
 * *What the answer shows the person*).
 *
 * WHAT THIS HOLDS, through the real doors with the real probe and the real
 * qualifier, against servers on this machine:
 *
 * - a server that answers 500 with HTML, 200 with JSON of another shape, or
 *   403 with plain text: the answer says the status, and none of the bytes, on
 *   the Test door, the connection doors (the headline and every face) and the
 *   permission report;
 * - a GData 403, a Google JSON 400 and a Sabre 500 keep their code and message,
 *   because they are error documents of a kind we know;
 * - a port where nothing answers: `unreachable`, and not the address;
 * - an IMAP server's `NO` is its words; an IMAP port that answers with
 *   something else says nothing of it;
 * - with the rule switched on (0136 T1), an address inside our network is
 *   refused at every door before anything connects, with the outcome
 *   `insideOurNetwork`; and a host the rule admitted that redirects inward is
 *   answered the same way, without the address it redirected to;
 * - and the operator keeps the full text: the log line carries the bytes the
 *   answer does not, under the reference the answer ends with. That is also
 *   the control, the proof that each case reached the server it asks.
 *
 * It fails if the answer carries the remote's body.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { log } from '@openmig/shared';
import { refuseInternalAddresses } from '@openmig/shared/reachable-host';
import { SecretStore } from '@openmig/core/secret-store';

process.env.SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** A string no answer may carry, planted in every hostile body. */
const MARKER = 'an-internal-admin-page-7f3a';

const h = vi.hoisted(() => ({
  /** The stored row the connection doors and the permission report read. */
  row: {} as Record<string, unknown>,
}));

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: 'a-tenant', userId: 'a-user', userRole: 'owner' });
      next();
    },
    // Every database call answers with the stored row; nothing is written.
    withTenantDb: vi.fn(async () => [h.row]),
    getDbPool: () => ({}),
  };
});

// The permission report's own pool: the organisation's DAV target, and
// nothing else it asks for.
vi.mock('pg', () => ({
  Pool: class {
    async query(text: string) {
      if (text.includes("role = 'target'")) {
        return {
          rows: [{ kind: h.row.kind, config: h.row.config, secret_ref: h.row.secretRef }],
        };
      }
      return { rows: [] };
    }
    async end() {}
  },
}));

const { default: connectionRoutes } = await import('./connections.ts');
const { default: migrationRoutes } = await import('./migrations/index.ts');
const { default: permissionRoutes } = await import('./permissions.ts');

const app = express();
app.use(express.json());
app.use('/api/connections', connectionRoutes);
app.use('/api/migrations', migrationRoutes);
app.use('/api/permissions', permissionRoutes);

// ---------------------------------------------------------------------------
// The servers a tester could name
// ---------------------------------------------------------------------------

/** What the HTTP server answers every request with, case by case. */
let answer: { status: number; type: string; body: string; location?: string } = { status: 500, type: 'text/html', body: '' };
/** How many requests reached the HTTP server. */
let reached = 0;
let davServer: http.Server;
let davBase = '';
let closedPort = 0;
let imapRefusing: net.Server;
let imapOther: net.Server;
/** Every socket the IMAP stubs were handed, so the end of the file can close them. */
const sockets = new Set<net.Socket>();

/** An IMAP server that refuses the login, as Gmail and Dovecot word it. */
function refusingImap(socket: net.Socket): void {
  sockets.add(socket);
  socket.write('* OK [CAPABILITY IMAP4rev1] ready\r\n');
  let pending = '';
  socket.on('data', (chunk) => {
    pending += chunk.toString('utf8');
    let end: number;
    while ((end = pending.indexOf('\r\n')) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 2);
      const [tag = '*', command = ''] = line.split(' ');
      switch (command.toUpperCase()) {
        case 'CAPABILITY':
          socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`);
          break;
        case 'LOGIN':
          socket.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n`);
          break;
        case 'LOGOUT':
          socket.end(`* BYE\r\n${tag} OK bye\r\n`);
          break;
        default:
          socket.write(`${tag} BAD not here\r\n`);
      }
    }
  });
  socket.on('error', () => {});
}

async function listening(server: net.Server): Promise<number> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
}

beforeAll(async () => {
  davServer = http.createServer((req, res) => {
    reached += 1;
    req.resume();
    req.on('end', () => {
      res.writeHead(answer.status, {
        'Content-Type': answer.type,
        ...(answer.location ? { Location: answer.location } : {}),
      });
      res.end(answer.body);
    });
  });
  davBase = `http://127.0.0.1:${await listening(davServer)}/remote.php/dav/`;
  const gone = net.createServer();
  closedPort = await listening(gone);
  await new Promise<void>((done) => gone.close(() => done()));
  imapRefusing = net.createServer(refusingImap);
  imapOther = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.end(`HTTP/1.1 400 Bad Request\r\nServer: ${MARKER}\r\n\r\n<html>${MARKER}</html>\r\n`);
  });
  await listening(imapRefusing);
  await listening(imapOther);
});

afterAll(async () => {
  // Keep-alive connections from the probes would hold `close` open.
  davServer.closeAllConnections();
  for (const socket of sockets) socket.destroy();
  for (const server of [davServer, imapRefusing, imapOther]) {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

/** Every line the operator's log got while a case ran. */
let logged: string[];

beforeEach(() => {
  logged = [];
  vi.spyOn(log, 'warn').mockImplementation((...args: unknown[]) => void logged.push(args.join(' ')));
  h.row = {
    id: 'conn-1',
    tenantId: 'a-tenant',
    role: 'target',
    kind: 'nextcloud',
    displayName: 'the organisation’s Nextcloud',
    config: { url: davBase },
    secretRef: JSON.stringify(SecretStore.encryptCredentials({ username: 'u', password: 'p' }).encrypted),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The doors, each asked the same address
// ---------------------------------------------------------------------------

const CREDS = { username: 'u', password: 'p' };

/** Every door that tests a typed address, and what each answered, as text. */
async function everyDoor(): Promise<Array<{ door: string; status: number; body: string; reason?: string }>> {
  const test = await request(app)
    .post('/api/migrations/test-connection')
    .send({ side: 'target', targetType: 'nextcloud', targetConfig: { url: davBase, ...CREDS } });
  const add = await request(app)
    .post('/api/connections')
    .send({ role: 'target', type: 'nextcloud', displayName: 'ours', values: { url: davBase, ...CREDS } });
  const retest = await request(app).post('/api/connections/conn-1/test').send({});
  const rotate = await request(app)
    .put('/api/connections/conn-1/credentials')
    .send({ values: { url: davBase, ...CREDS } });
  const report = await request(app).get('/api/permissions/report?mailbox=someone@example.test');
  return [
    { door: 'POST /api/migrations/test-connection', status: test.status, body: JSON.stringify(test.body), reason: test.body.reason },
    { door: 'POST /api/connections', status: add.status, body: JSON.stringify(add.body), reason: add.body.reason },
    { door: 'POST /api/connections/:id/test', status: retest.status, body: JSON.stringify(retest.body), reason: retest.body.reason },
    { door: 'PUT /api/connections/:id/credentials', status: rotate.status, body: JSON.stringify(rotate.body), reason: rotate.body.reason },
    { door: 'GET /api/permissions/report', status: report.status, body: report.text },
  ];
}

/** The faces the connection doors measured, as each was answered. */
async function facesOfAnAdd(): Promise<Record<string, { detail: string }>> {
  const add = await request(app)
    .post('/api/connections')
    .send({ role: 'target', type: 'nextcloud', displayName: 'ours', values: { url: davBase, ...CREDS } });
  return add.body.qualification.domains;
}

describe('a server that answers with something that is not an error document', () => {
  it.each([
    ['500 with an HTML page', 500, 'text/html', `<!doctype html><html><body><h1>Admin</h1><p>${MARKER}</p></body></html>`],
    ['200 with JSON of another shape', 200, 'application/json', JSON.stringify({ service: MARKER, version: '9.1' })],
    ['403 with plain text', 403, 'text/plain', `Forbidden: ${MARKER} is for the office network only`],
  ])('%s: every door says the status and none of the bytes', async (_what, status, type, body) => {
    answer = { status, type, body };
    for (const door of await everyDoor()) {
      expect(door.body, `${door.door} read the server's answer aloud`).not.toContain(MARKER);
      expect(door.body, `${door.door} named the address it tried`).not.toContain('127.0.0.1');
      if (door.reason !== undefined) {
        expect(door.reason, door.door).toMatch(
          new RegExp(`^The server answered ${status} with something that is not a DAV, JMAP or IMAP error\\. Reference [0-9a-f]{8}\\.$`),
        );
      }
    }
    // The report says it too, from the same parts.
    const report = (await everyDoor())[4];
    expect(report?.body).toContain(`the server answered ${status} with something that is not a DAV, JMAP or IMAP error`);
    // The operator has the bytes, under the references the answers carried.
    expect(logged.some((line) => line.includes(MARKER) && /\[ref [0-9a-f]{8}\]/.test(line))).toBe(true);
  });

  it('every face the connection door measured says it the same way', async () => {
    answer = { status: 500, type: 'text/html', body: `<html><body>${MARKER}</body></html>` };
    const faces = await facesOfAnAdd();
    for (const name of ['calendar', 'task', 'contact', 'file'] as const) {
      expect(faces[name]?.detail, name).toMatch(
        /^Unmeasured — the server answered 500 with something that is not a DAV, JMAP or IMAP error\. Reference [0-9a-f]{8}\.$/,
      );
    }
    expect(JSON.stringify(faces)).not.toContain(MARKER);
    expect(JSON.stringify(faces), 'the parts are the answer’s, not the record’s').not.toContain('"said"');
  });
});

describe('an error document of a kind we know keeps its words', () => {
  it.each([
    [
      'a GData 403',
      403,
      'application/xml',
      '<?xml version="1.0" encoding="UTF-8"?><errors xmlns="http://schemas.google.com/g/2005"><error>' +
        '<domain>GData</domain><code>accessNotConfigured</code><internalReason>CalDAV API has not been ' +
        'used in project 1 before or it is disabled.</internalReason></error></errors>',
      'The server answered 403: accessNotConfigured — CalDAV API has not been used in project 1 before or it is disabled.',
    ],
    [
      'a Google JSON 400',
      400,
      'application/json',
      JSON.stringify({ error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } }),
      'The server answered 400: INVALID_ARGUMENT — Request contains an invalid argument.',
    ],
    [
      'a Sabre 500',
      500,
      'application/xml',
      '<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
        '<s:sabredav-version>4.6.0</s:sabredav-version><s:exception>Sabre\\DAV\\Exception</s:exception>' +
        '<s:message>An exception occurred while executing a query</s:message></d:error>',
      'The server answered 500: Sabre\\DAV\\Exception — An exception occurred while executing a query.',
    ],
  ])('%s: its code and its message', async (_what, status, type, body, said) => {
    answer = { status, type, body };
    const res = await request(app)
      .post('/api/migrations/test-connection')
      .send({ side: 'target', targetType: 'nextcloud', targetConfig: { url: davBase, ...CREDS } });
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toMatch(new RegExp(`^${said.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Reference [0-9a-f]{8}\\.$`));
  });
});

describe('where nothing answers', () => {
  it("says so, with the outcome 'unreachable', and not the address", async () => {
    const res = await request(app)
      .post('/api/migrations/test-connection')
      .send({
        side: 'target',
        targetType: 'nextcloud',
        targetConfig: { url: `http://127.0.0.1:${closedPort}/remote.php/dav/`, ...CREDS },
      });
    expect(res.body.ok).toBe(false);
    expect(res.body.outcome).toEqual({ code: 'unreachable' });
    expect(res.body.reason).toMatch(/^Nothing answered at that address/);
    expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
    expect(JSON.stringify(res.body)).not.toContain(String(closedPort));
  });
});

describe('an IMAP host', () => {
  const imapTarget = (port: number) => ({
    side: 'target',
    targetType: 'imap',
    targetConfig: { host: '127.0.0.1', port, useSsl: false, ...CREDS },
  });

  it("a refused login: the server's NO line is its words, its response code with them", async () => {
    const res = await request(app)
      .post('/api/migrations/test-connection')
      .send(imapTarget((imapRefusing.address() as AddressInfo).port));
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toMatch(
      /^The mail server answered: NO \[AUTHENTICATIONFAILED\] Invalid credentials \(Failure\)\. Reference [0-9a-f]{8}\.$/,
    );
    expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
  });

  it('the Test door says it for a source too', async () => {
    const res = await request(app)
      .post('/api/migrations/test-connection')
      .send({
        side: 'source',
        sourceType: 'imap',
        sourceConfig: {
          host: '127.0.0.1',
          port: (imapRefusing.address() as AddressInfo).port,
          useSsl: false,
          ...CREDS,
        },
      });
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toMatch(/^The mail server answered: NO \[AUTHENTICATIONFAILED\] Invalid credentials/);
    expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
  });

  it('a port that answers with something else says nothing of it', async () => {
    const res = await request(app)
      .post('/api/migrations/test-connection')
      .send(imapTarget((imapOther.address() as AddressInfo).port));
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
    expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
  });
});

describe('with the rule switched on (0136 T1)', () => {
  it("an address inside our network: refused at every door before it connects, as 'insideOurNetwork'", async () => {
    answer = { status: 500, type: 'text/html', body: `<html>${MARKER}</html>` };
    reached = 0;
    const off = refuseInternalAddresses();
    try {
      const test = await request(app)
        .post('/api/migrations/test-connection')
        .send({ side: 'target', targetType: 'nextcloud', targetConfig: { url: davBase, ...CREDS } });
      expect(test.body.ok).toBe(false);
      expect(test.body.outcome).toEqual({ code: 'insideOurNetwork' });
      expect(test.body.reason).toMatch(/inside this service's own network.* Reference [0-9a-f]{8}\.$/);
      for (const door of await everyDoor()) {
        expect(door.body, `${door.door} named the address`).not.toContain('127.0.0.1');
        expect(door.body, door.door).not.toContain(MARKER);
        if (door.reason !== undefined) expect(door.reason, door.door).toMatch(/inside this service's own network/);
      }
      const imap = await request(app)
        .post('/api/migrations/test-connection')
        .send({
          side: 'target',
          targetType: 'imap',
          targetConfig: { host: '127.0.0.1', port: (imapRefusing.address() as AddressInfo).port, useSsl: false, ...CREDS },
        });
      expect(imap.body.outcome).toEqual({ code: 'insideOurNetwork' });
      expect(JSON.stringify(imap.body)).not.toContain('127.0.0.1');
    } finally {
      off();
    }
    expect(reached, 'nothing reached the server').toBe(0);
  });

  it('a host the rule admitted that redirects inward: the same answer, and not the address it redirected to', async () => {
    const port = (davServer.address() as AddressInfo).port;
    answer = { status: 302, type: 'text/plain', body: '', location: `http://127.0.0.1:${port}/${MARKER}/` };
    reached = 0;
    const off = refuseInternalAddresses({
      allow: ['dav.admitted.test'],
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    });
    try {
      const res = await request(app)
        .post('/api/migrations/test-connection')
        .send({
          side: 'target',
          targetType: 'nextcloud',
          targetConfig: { url: `http://dav.admitted.test:${port}/remote.php/dav/`, ...CREDS },
        });
      expect(res.body.ok).toBe(false);
      expect(res.body.outcome).toEqual({ code: 'insideOurNetwork' });
      expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
      expect(JSON.stringify(res.body)).not.toContain(MARKER);
    } finally {
      off();
    }
    // The admitted host was reached; the address it redirected to was not.
    expect(reached).toBeGreaterThan(0);
    expect(logged.some((line) => line.includes('127.0.0.1') && /\[ref [0-9a-f]{8}\]/.test(line))).toBe(true);
  });
});
