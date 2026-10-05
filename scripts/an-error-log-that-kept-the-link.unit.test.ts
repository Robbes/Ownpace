// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ERROR LOG THAT KEPT THE LINK, on the web image's nginx (workplan 0108).
 *
 * The access log drops a grant or view link, and a query's values
 * (`a-log-that-kept-the-link`). nginx's ERROR log cannot: each of its lines
 * ends with the raw request line, the upstream's address with the path, and
 * the Referer, and no directive rewrites them. The image kept the error log at
 * its own level, notice, sent to the container's log. So the link was written
 * whole there whenever the API's name did not resolve or the API refused the
 * connection (the api container stopped or restarting), on a timeout, on a
 * premature close, on a body above 8 MB or one nginx kept on disk, and when
 * the page itself was missing from the image. Found by the review of #1495.
 *
 * The owner, 2026-10-05: "critical errors only". So the template's server
 * says `error_log stderr crit;`. This holds it to that, and RUNS it: nginx
 * is made to write each of those lines for a request whose path and Referer
 * carry a link, behind the image's own main level (`./nginx-on-this-machine.ts`),
 * and no log nginx keeps besides the access log may hold the link. The access
 * log still shows every one of those answers, with its status and `:link`.
 *
 * What crit still writes is written whole: a file nginx cannot read for a
 * reason other than its absence, a full disk, no memory, no descriptors or
 * connections left. Each is the machine failing, though a visitor can bring
 * some about (overload, a disk filled by request bodies), and the line then
 * names whichever request met it, link included: 0108's known gap, left to
 * the owner. The run below makes one, without a link, so that the log is
 * shown to be alive and not merely quiet.
 *
 * And the main level, where a request never arrives: a connection logs
 * through its listening socket's log, which is the default server's, and a
 * request through its server's and location's. So the image's main level,
 * left at notice, keeps nginx's own lines: starting and stopping, signals, a
 * worker's exit, a config it refuses, and the resolver's own errors, which
 * name the resolver and no request. Shown below: after the run it names no
 * client.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNginx, type NginxNode } from './nginx-config.ts';
import { aFreePort, nginxBinary, serveTheTemplate, type AppNginx } from './nginx-on-this-machine.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_PATH = 'apps/web/nginx.conf.template';
const TEMPLATE = readFileSync(join(ROOT, TEMPLATE_PATH), 'utf8');
const DOCKERFILE = readFileSync(join(ROOT, 'apps/web/Dockerfile'), 'utf8');
const TOP = parseNginx(TEMPLATE, TEMPLATE_PATH);

/** Every directive and block at every depth. */
function everywhere(nodes: readonly NginxNode[]): NginxNode[] {
  return nodes.flatMap((n) => [n, ...everywhere(n.children ?? [])]);
}

const SERVERS = everywhere(TOP).filter((n) => n.name === 'server');

describe("the web image's nginx writes critical errors only", () => {
  it('has a server to read', () => {
    expect(SERVERS.length).toBeGreaterThan(0);
  });

  it('says so in every server, to the standard error the container log keeps', () => {
    for (const server of SERVERS) {
      const own = (server.children ?? []).filter((n) => n.name === 'error_log').map((n) => n.args.join(' '));
      expect(own, `a server of ${TEMPLATE_PATH} without \`error_log stderr crit;\``).toEqual(['stderr crit']);
    }
  });

  it('says it nowhere else: a location or the level above would set another for the requests it covers', () => {
    const all = everywhere(TOP).filter((n) => n.name === 'error_log');
    expect(all, `${TEMPLATE_PATH} sets an error_log outside its servers`).toHaveLength(SERVERS.length);
  });

  it("keeps the image's own nginx.conf, which the run below reproduces", () => {
    // The template goes where the image renders it into its http block, and
    // nothing replaces the image's main level or that block.
    const runtime = DOCKERFILE.slice(DOCKERFILE.search(/^FROM \S+ AS runtime$/m));
    expect(runtime).toMatch(/^FROM nginx:[\w.-]+ AS runtime$/m);
    expect(runtime).toMatch(/^COPY apps\/web\/nginx\.conf\.template \/etc\/nginx\/templates\/default\.conf\.template$/m);
    expect(runtime).not.toMatch(/\/etc\/nginx\/nginx\.conf/);
  });
});

// ---------------------------------------------------------------------------
// And the real nginx, where the machine has one
// ---------------------------------------------------------------------------

/** The credential in the path, and in the Referer of the page that holds it. */
const LINK = 'lnk-error-log-7Qw2x9';
const REFERER = `https://app.example.test/grant/${LINK}?from=mail`;

/**
 * Each answer that made nginx write an error line at the image's level, and
 * what the access log must hold for it: the request with `:link`, and the
 * status.
 */
const CASES: Readonly<Record<string, string>> = {
  'the API name does not resolve': '"GET /api/grant/:link HTTP/1.1" 502',
  'the API refuses the connection': '"GET /api/view/:link/status HTTP/1.1" 502',
  'the API closes the connection without an answer': '"GET /api/grant/:link/closed HTTP/1.1" 502',
  'the API answers later than nginx waits': '"GET /api/grant/:link/slow HTTP/1.1" 504',
  'a body above 8 MB': '"POST /api/grant/:link/report HTTP/1.1" 413',
  'a body nginx keeps on disk (a warning)': '"POST /api/grant/:link/report HTTP/1.1" 200',
  'a directory, with a query': '"GET /assets/?... HTTP/1.1" 403',
  // try_files does not report a file that is not there: no error line, before
  // or after. Here for its 404 in the access log.
  'version.json missing': '"GET /version.json?... HTTP/1.1" 404',
  'the page missing from the image': '"GET /grant/:link HTTP/1.1" 500',
};

/** One request, as a browser on the grant page makes it. */
function ask(port: number, method: string, path: string, body?: Buffer): Promise<number> {
  return new Promise((ok, fail) => {
    const req = request(
      { host: '127.0.0.1', port, method, path, headers: { host: 'app.example.test', referer: REFERER } },
      (res) => {
        res.resume();
        res.on('end', () => ok(res.statusCode ?? 0));
      },
    );
    req.on('error', fail);
    req.end(body);
  });
}

/** A body announced and never sent: nginx answers from the header alone. */
function announce(port: number, path: string, length: number): Promise<number> {
  return new Promise((ok, fail) => {
    let got = '';
    const s = connect(port, '127.0.0.1', () => {
      s.write(
        `POST ${path} HTTP/1.1\r\nHost: app.example.test\r\nReferer: ${REFERER}\r\n` +
          `Content-Type: application/json\r\nContent-Length: ${length}\r\n\r\n`,
      );
    });
    s.on('data', (chunk) => {
      got += chunk.toString('latin1');
      const status = /^HTTP\/1\.1 (\d{3}) /.exec(got);
      if (status) {
        s.destroy();
        ok(Number(status[1]));
      }
    });
    s.on('error', fail);
    s.on('close', () => fail(new Error(`no answer for ${path}: ${JSON.stringify(got)}`)));
  });
}

/**
 * Docker's embedded DNS, as the template's `resolver` asks it: the API by its
 * name, `api`. While `known` is false the name does not exist (NXDOMAIN), as
 * when the api container is stopped or gone; then it is this machine.
 */
function aNameServer(): { socket: UdpSocket; refused: () => number; know: () => void } {
  const socket = createSocket('udp4');
  let known = false;
  let refused = 0;
  socket.on('message', (query, from) => {
    let end = 12;
    while (query[end] !== 0) end += query[end]! + 1;
    end += 5;
    const qtype = query.readUInt16BE(end - 4);
    // One A record: the name (a pointer to the question's), A, IN, 30 seconds,
    // four bytes of address. The header copies the query's id, and says an
    // answer (0x8180) or no such name (0x8183).
    const answer =
      known && qtype === 1 ? Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, 127, 0, 0, 1]) : Buffer.alloc(0);
    if (!known) refused++;
    const head = Buffer.alloc(12);
    query.copy(head, 0, 0, 2);
    head.writeUInt16BE(known ? 0x8180 : 0x8183, 2);
    head.writeUInt16BE(1, 4);
    head.writeUInt16BE(answer.length > 0 ? 1 : 0, 6);
    socket.send(Buffer.concat([head, query.subarray(12, end), answer]), from.port, from.address);
  });
  return { socket, refused: () => refused, know: () => (known = true) };
}

const NGINX = nginxBinary();

describe.skipIf(NGINX === undefined)('and the real nginx keeps the link out of every error line', () => {
  let served: AppNginx | undefined;
  let upstream: Server | undefined;
  let names: ReturnType<typeof aNameServer> | undefined;
  /** Each case's status, as nginx answered it. */
  const answers = new Map<string, number>();
  let refusedNames = 0;
  let mainLevel = '';
  let stderr = '';
  let imageAccess = '';
  let access = '';

  beforeAll(async () => {
    names = aNameServer();
    await new Promise<void>((done) => names!.socket.bind(0, '127.0.0.1', done));
    const dnsPort = names.socket.address().port;
    const upstreamPort = await aFreePort();

    served = await serveTheTemplate({
      nginx: NGINX!,
      template: TEMPLATE,
      // The image's API_UPSTREAM is `api:3001`: a name, resolved per request.
      defined: { API_UPSTREAM: `api:${upstreamPort}`, VITE_OIDC_ISSUER: 'https://id.example.test' },
      files: {
        'index.html': '<!doctype html><title>app</title><div id="root"></div>\n',
        'assets/index-abc123.js': 'export {};\n',
        'version.json': '{"version":"0.0.0","commit":""}\n',
      },
      edits: [
        ['resolver 127.0.0.11 valid=10s ipv6=off;', `resolver 127.0.0.1:${dnsPort} valid=10s ipv6=off;`],
        // Five minutes, here one second: the same line, sooner.
        ['proxy_read_timeout 300s;', 'proxy_read_timeout 1s;'],
      ],
    });
    const port = served.port;
    const record = async (what: string, status: Promise<number>): Promise<void> => {
      if (!(what in CASES)) throw new Error(`${what} is not a case`);
      answers.set(what, await status);
    };

    // The api container gone: its name does not resolve.
    await record('the API name does not resolve', ask(port, 'GET', `/api/grant/${LINK}`));
    refusedNames = names.refused();
    // The api container there, and not listening yet: restarting.
    names.know();
    await record('the API refuses the connection', ask(port, 'GET', `/api/view/${LINK}/status`));

    upstream = createServer((req, res) => {
      const url = req.url ?? '';
      if (url.endsWith('/closed')) {
        req.socket.destroy();
        return;
      }
      if (url.endsWith('/slow')) {
        const late = setTimeout(() => res.end('{}'), 3_000);
        res.on('close', () => clearTimeout(late));
        return;
      }
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((done) => upstream!.listen(upstreamPort, '127.0.0.1', done));

    await record('the API closes the connection without an answer', ask(port, 'GET', `/api/grant/${LINK}/closed`));
    await record('the API answers later than nginx waits', ask(port, 'GET', `/api/grant/${LINK}/slow`));
    await record('a body above 8 MB', announce(port, `/api/grant/${LINK}/report`, 9 * 1024 * 1024));
    await record(
      'a body nginx keeps on disk (a warning)',
      ask(port, 'POST', `/api/grant/${LINK}/report`, Buffer.alloc(64 * 1024, 0x20)),
    );
    await record('a directory, with a query', ask(port, 'GET', `/assets/?code=${LINK}`));
    // A critical error, without a link: a directory nginx's workers cannot read.
    mkdirSync(join(served.html, 'unreadable'));
    chmodSync(join(served.html, 'unreadable'), 0);
    await new Promise<void>((ok, fail) => {
      request({ host: '127.0.0.1', port, path: '/unreadable/page', headers: { host: 'app.example.test' } }, (res) => {
        res.resume();
        res.on('end', ok);
      })
        .on('error', fail)
        .end();
    });
    chmodSync(join(served.html, 'unreadable'), 0o755);

    rmSync(join(served.html, 'version.json'));
    await record('version.json missing', ask(port, 'GET', `/version.json?code=${LINK}`));
    rmSync(join(served.html, 'index.html'));
    await record('the page missing from the image', ask(port, 'GET', `/grant/${LINK}`));

    // Stopped, so every line is written before it is read.
    await served.stop();
    mainLevel = served.read(served.mainErrorLog);
    stderr = served.read(served.stderrLog);
    imageAccess = served.read(served.imageAccessLog);
    access = served.read(served.accessLog);
  }, 60_000);

  afterAll(async () => {
    await served?.remove();
    await new Promise<void>((done) => (upstream ? upstream.close(() => done()) : done()));
    names?.socket.close();
  });

  it('made every answer it meant to', () => {
    const status = (logged: string): number => Number(logged.slice(-3));
    expect(Object.fromEntries(answers)).toEqual(
      Object.fromEntries(Object.entries(CASES).map(([what, logged]) => [what, status(logged)])),
    );
    // The first 502 is the name, not the connection.
    expect(refusedNames).toBeGreaterThan(0);
  });

  it("writes the link in no error line: not at the image's level, not at the server's", () => {
    expect(mainLevel, "the image's main-level error log").not.toContain(LINK);
    expect(stderr, "nginx's standard error, where the server's error log goes").not.toContain(LINK);
  });

  it("keeps the image's main level to nginx's own lines: no request reaches it", () => {
    // Read, not vacuous: the main level wrote nginx's start.
    expect(mainLevel).toMatch(/\[notice\] .*start worker process/);
    const naming = mainLevel.split('\n').filter((line) => /, client: |, request: /.test(line));
    expect(naming, 'a line of the main level names a request').toEqual([]);
  });

  it('still writes a critical error, and nothing below one', () => {
    const lines = stderr.split('\n').filter((line) => line !== '');
    expect(lines.some((line) => /\[crit\] .*\/unreadable\/page/.test(line)), stderr).toBe(true);
    for (const line of lines) expect(line).toMatch(/^\S+ \S+ \[(?:crit|alert|emerg)\] /);
  });

  it("writes nothing to the image's own access log, which the template's replaces", () => {
    expect(imageAccess).toBe('');
  });

  it.each(Object.keys(CASES))(
    'shows %s in the access log, with its status and without the link',
    (what) => {
      const logged = CASES[what]!;
      const line = access.split('\n').find((l) => l.includes(logged));
      expect(line, `no access line ${logged}:\n${access}`).toBeDefined();
      expect(line).toContain('"https://app.example.test/grant/:link?..."');
      expect(line).not.toContain(LINK);
    },
  );
});
