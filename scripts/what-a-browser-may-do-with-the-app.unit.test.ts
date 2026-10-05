// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A BROWSER MAY DO WITH THE APP (workplan 0158).
 *
 * The web image's nginx (`apps/web/nginx.conf.template`) served the app with
 * no Content-Security-Policy, no Strict-Transport-Security, nothing against
 * framing, no `nosniff` and no Referrer-Policy. The API sent all of them on
 * its own answers (helmet, `apps/api/src/index.ts`), and the public site has
 * had a strict policy since 2026-08-20 (`deploy/compose/www-nginx.conf`). The
 * app, which keeps the sign-in in the browser's storage, had none. Found by
 * the public-readiness audit (finding sec-spa-no-csp-token-in-localstorage).
 *
 * So the template now names one policy and four more headers, and repeats
 * them in each location that serves the app, as the site's file does: nginx
 * inherits `add_header` only into a level that sets none of its own. This
 * reads the template as nginx reads it (`./nginx-config.ts`) and asks, for
 * every kind of address the app is opened at:
 *
 * - **the app's pages, its assets and `version.json`** carry exactly the five
 *   headers below and no other (`version.json` its `Cache-Control` too), each
 *   with `always`, so an error page carries them too;
 * - **`/api/` carries none of them.** helmet already sends each one there, and
 *   the consent callback pages replace helmet's policy with one that allows
 *   their own inline script by hash (`callbackPageHeaders`). A second policy
 *   from nginx would be enforced beside it and block that script, which is
 *   the 2026-09-02 defect again. Nor does nginx hide one of the API's;
 * - **nothing the reading cannot see.** An `if` block or an `error_page`
 *   changes which headers an answer gets, and `./nginx-config.ts` reads
 *   neither. So the template has none, and this fails the day it gains one,
 *   on a machine without nginx too;
 * - **the policy is the one written here, word for word.** Loosening it means
 *   changing this file too, where the reason has to be said;
 * - **the two headers both halves send say the same thing** as helmet does,
 *   so a browser is not told two things about one host;
 * - **every `${NAME}` in the template is defined in the image**, where the
 *   template is rendered: an undefined one reaches nginx as written, and nginx
 *   refuses to start;
 * - **the image refuses what the policy cannot serve**: an issuer with a path,
 *   and an API anywhere but this origin (`VITE_API_URL` that is not a path).
 *   Either built, the page could not reach it, and nothing said so until a
 *   person tried to sign in.
 *
 * AND IT IS RUN, where the machine has nginx. The template is rendered as the
 * image renders it, served by the real nginx in front of an upstream that
 * runs helmet as the API does, and the answers' headers are read off the wire.
 * Hosted Ubuntu runners have nginx installed; a machine without it skips that
 * part, as `a-database-without-a-container` skips a cluster it cannot start.
 *
 * What a browser does under the policy is `test/ui/managed-ui.ui.test.ts`'s
 * question: it serves the built app with the headers this file reads, and
 * fails on any `securitypolicyviolation`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, get, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callbackPageHeaders } from '../apps/api/src/routes/migrations/google-consent.ts';
import { chooseLocation, envsubst, headersFor, parseNginx, type NginxNode } from './nginx-config.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const TEMPLATE_PATH = 'apps/web/nginx.conf.template';
const TEMPLATE = read(TEMPLATE_PATH);
const DOCKERFILE = read('apps/web/Dockerfile');

/** The sign-in host the bundle was built with, which the policy lets the page fetch from. */
const ISSUER = 'VITE_OIDC_ISSUER';

/**
 * THE POLICY, as the template must write it. What each part allows, and the
 * evidence that the built app needs it (workplan 0158 D1):
 *
 * - `default-src 'none'`: no font, frame, media, object or manifest. The app
 *   loads none.
 * - `script-src 'self'`: its own module scripts only. No inline script, no
 *   eval: zod's eval probe is switched off at the entry
 *   (`apps/web/src/zod-without-eval.ts`).
 * - `style-src 'self'`: its one stylesheet. React's `style` props go through
 *   the CSSOM, which the policy does not govern.
 * - `img-src data:`: the favicon, inline in `index.html`. No other image.
 * - `connect-src 'self' <issuer>`: the API at the same origin, and the sign-in
 *   host's discovery document and token endpoint (`services/oidc.ts`).
 * - `worker-src 'none'`: no worker. Said here because a worker does not fall
 *   back to `default-src`: it falls back to `script-src`, so without this line
 *   any script of the app's own origin could run as one. The app starts none.
 * - `base-uri 'none'`, `form-action 'none'`: no `<base>`, and every form the
 *   app has is sent by script, never submitted.
 * - `frame-ancestors 'none'`: no page may frame the app.
 */
const POLICY = (issuer: string): string =>
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; " +
  `connect-src 'self' ${issuer}; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

/** Every header the app's answers carry, by name, for the issuer the template is rendered with. */
const APP_HEADERS = (issuer: string): Readonly<Record<string, string>> => ({
  'Content-Security-Policy': POLICY(issuer),
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
});

/** Headers the app must never send: each breaks something it does (workplan 0158 D9). */
const NEVER = ['Cross-Origin-Opener-Policy', 'Cross-Origin-Embedder-Policy'];

/** Addresses the app is opened at, or loads, through `location /` or `= /version.json`. */
const APP_URIS = [
  '/',
  '/index.html',
  '/login',
  '/request-access',
  '/grant/a-link',
  '/view/a-link',
  // The router opens the grant page for these too (0108): any case, and nginx
  // matches on the decoded path.
  '/GRANT/a-link',
  '/Grant/a-link',
  '/report',
  '/docs',
  '/assets/index-abc123.js',
  '/assets/index-abc123.css',
  '/version.json',
  '/no/such/page',
];

/** Addresses nginx hands to the API. */
const API_URIS = [
  '/api/health',
  '/api/version',
  '/api/grant/a-link',
  '/api/view/a-link/withdraw',
  '/api/migrations/google/callback',
  '/api/problem-reports',
];

/** The sign-in host the template is rendered with here, as the image renders it with the stack's. */
const TEST_ISSUER = 'https://id.example.test';

/** The template as written, for what it says. */
const TOP = parseNginx(TEMPLATE, TEMPLATE_PATH);
/** The template as the image renders it, for what nginx sends. */
const RENDERED = parseNginx(envsubst(TEMPLATE, { API_UPSTREAM: 'api:3001', [ISSUER]: TEST_ISSUER }), TEMPLATE_PATH);

/** The headers nginx adds for a URI, by name. */
function sentFor(uri: string): Map<string, { value: string; always: boolean }> {
  const headers = headersFor(RENDERED, uri);
  if (headers === undefined) throw new Error(`${TEMPLATE_PATH} chooses no location for ${uri}`);
  const out = new Map<string, { value: string; always: boolean }>();
  for (const h of headers) {
    if (out.has(h.name.toLowerCase())) throw new Error(`${uri}: ${h.name} is added twice`);
    out.set(h.name.toLowerCase(), { value: h.value, always: h.always });
  }
  return out;
}

/** The server block's own directives. */
const SERVER = TOP.find((n) => n.name === 'server')?.children ?? [];

/** The location blocks at every depth. */
function locations(nodes: readonly NginxNode[]): NginxNode[] {
  return nodes.flatMap((n) => (n.name === 'location' ? [n, ...locations(n.children ?? [])] : locations(n.children ?? [])));
}

/** Every directive and block at every depth. */
function everywhere(nodes: readonly NginxNode[]): NginxNode[] {
  return nodes.flatMap((n) => [n, ...everywhere(n.children ?? [])]);
}

/** Whether the location nginx chooses for a URI hands it to the API. */
function proxied(uri: string): boolean {
  const chosen = chooseLocation(SERVER, uri)?.path.at(-1);
  return (chosen?.children ?? []).some((n) => n.name === 'proxy_pass');
}

// helmet as the API loads it, from the API's own dependencies.
type Middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;
const helmet = createRequire(join(ROOT, 'apps/api/package.json'))('helmet') as () => Middleware;

/** What helmet, with the API's defaults, puts on a response. */
function helmetHeaders(): Map<string, string> {
  const set = new Map<string, string>();
  const res = {
    setHeader: (name: string, value: string) => set.set(name.toLowerCase(), String(value)),
    removeHeader: (name: string) => set.delete(name.toLowerCase()),
  } as unknown as ServerResponse;
  let called = false;
  helmet()({} as IncomingMessage, res, (err) => {
    if (err) throw err as Error;
    called = true;
  });
  if (!called) throw new Error('helmet did not hand the request on');
  return set;
}

describe("the template's reading", () => {
  it('finds every location the file writes, so a short parse cannot pass', () => {
    const written = TEMPLATE.split('\n').filter((l) => /^\s*location\b/.test(l)).length;
    expect(written).toBeGreaterThan(2);
    expect(locations(TOP)).toHaveLength(written);
  });

  it('chooses the API location for the API and no other', () => {
    for (const uri of API_URIS) expect(proxied(uri), uri).toBe(true);
    for (const uri of APP_URIS) expect(proxied(uri), uri).toBe(false);
  });
});

describe('the app is served with what a browser may do with it', () => {
  it('names the policy once, at the server, word for word', () => {
    const sets = SERVER.filter((n) => n.name === 'set' && n.args[0] === '$ownpace_csp');
    expect(sets, `${TEMPLATE_PATH} names no $ownpace_csp`).toHaveLength(1);
    expect(sets[0]!.args[1]).toBe(POLICY(`\${${ISSUER}}`));
  });

  it.each(APP_URIS)('%s carries the five headers and no other, each with always', (uri) => {
    const sent = sentFor(uri);
    for (const [name, value] of Object.entries(APP_HEADERS(TEST_ISSUER))) {
      const h = sent.get(name.toLowerCase());
      expect(h, `${uri} is sent without ${name}`).toBeDefined();
      expect(h!.value, `${uri}: ${name}`).toBe(value);
      expect(h!.always, `${uri}: ${name} without always, so an error page goes without it`).toBe(true);
    }
    // No sixth: a second, looser policy in report-only mode, or a header that
    // opens the page to another origin, would pass every line above.
    const expected = Object.keys(APP_HEADERS('')).map((n) => n.toLowerCase());
    if (uri === '/version.json') expected.push('cache-control');
    expect([...sent.keys()].sort(), `${uri} is sent with a header this file does not name`).toEqual(expected.sort());
  });

  it('keeps version.json from a cache, beside the five', () => {
    expect(sentFor('/version.json').get('cache-control')?.value).toBe('no-cache');
  });

  it('sends no opener or embedder policy anywhere: the consent window needs its opener', () => {
    // `services/consent-window.ts`: the popup hands its result back over
    // postMessage, which `Cross-Origin-Opener-Policy: same-origin` cuts.
    const added = locations(TOP)
      .concat(SERVER)
      .flatMap((n) => [n, ...(n.children ?? [])])
      .filter((n) => n.name === 'add_header')
      .map((n) => n.args[0]!.toLowerCase());
    for (const name of NEVER) expect(added, name).not.toContain(name.toLowerCase());
  });
});

describe('the policy says what it must', () => {
  const directives = new Map(
    POLICY('https://id.example.test')
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .map(([name, ...values]) => [name!, values] as const),
  );

  it('runs no script but its own: no inline, no eval, no other host', () => {
    expect(directives.get('script-src')).toEqual(["'self'"]);
    expect(directives.get('default-src')).toEqual(["'none'"]);
    expect(POLICY('')).not.toMatch(/unsafe-|strict-dynamic|nonce-|\*/);
  });

  it('lets nothing frame the app, set its base, or submit a form', () => {
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'none'"]);
  });

  it('does not upgrade requests: on plain http at an address that is not loopback, the app would stop loading its own scripts', () => {
    expect(directives.has('upgrade-insecure-requests')).toBe(false);
  });

  it('starts no worker: a worker falls back to script-src, not to default-src', () => {
    expect(directives.get('worker-src')).toEqual(["'none'"]);
  });

  it('sends to no host but its own and the sign-in host', () => {
    expect(directives.get('connect-src')).toEqual(["'self'", 'https://id.example.test']);
    expect(directives.get('img-src')).toEqual(['data:']);
  });
});

describe('the API keeps its own headers, and only its own', () => {
  it.each(API_URIS)('nginx adds nothing to %s', (uri) => {
    expect([...sentFor(uri).keys()]).toEqual([]);
  });

  it('adds nothing at the server or above it, where /api/ would inherit it', () => {
    expect(SERVER.filter((n) => n.name === 'add_header')).toEqual([]);
    expect(TOP.filter((n) => n.name === 'add_header')).toEqual([]);
  });

  it("hides none of the API's own headers", () => {
    // `proxy_hide_header Content-Security-Policy` in /api/ would strip
    // helmet's policy, and the consent callback's with it, and nothing above
    // would notice: nginx adds nothing there either way.
    const helmets = [...helmetHeaders().keys()];
    expect(helmets).toContain('content-security-policy');
    const hidden = everywhere(TOP)
      .filter((n) => n.name === 'proxy_hide_header')
      .map((n) => (n.args[0] ?? '').toLowerCase());
    for (const name of helmets) expect(hidden, `${TEMPLATE_PATH} hides ${name} from the API's answers`).not.toContain(name);
  });

  it("gives HSTS and the Referrer-Policy the values helmet gives the API's answers on the same host", () => {
    // A browser keeps the last HSTS it was sent for a host. The page and its
    // own API calls must not reset each other's.
    const api = helmetHeaders();
    const app = APP_HEADERS('');
    expect(app['Strict-Transport-Security']).toBe(api.get('strict-transport-security'));
    expect(app['Referrer-Policy']).toBe(api.get('referrer-policy'));
    expect(app['X-Content-Type-Options']).toBe(api.get('x-content-type-options'));
  });
});

describe('the template holds nothing the reading cannot see', () => {
  // `./nginx-config.ts` reads locations and `add_header`. An `if` block with
  // its own `add_header` replaces the location's for the requests it matches,
  // and an `error_page` answers from another location with that location's
  // headers. The run on a real nginx below would catch either, but it skips
  // on a machine without nginx. So the template has neither until the reading
  // learns them.
  it.each(['if', 'error_page'])('has no %s', (name) => {
    expect(
      everywhere(TOP).filter((n) => n.name === name),
      `${TEMPLATE_PATH} uses ${name}, which ./nginx-config.ts does not read: teach headersFor first`,
    ).toEqual([]);
  });
});

describe('the image defines what the template names', () => {
  const runtime = DOCKERFILE.slice(DOCKERFILE.search(/^FROM \S+ AS runtime$/m));
  const build = DOCKERFILE.slice(0, DOCKERFILE.search(/^FROM \S+ AS runtime$/m));

  /**
   * The one RUN line of a stage that reads `$name`, run as Docker runs it:
   * `sh -c`, with the argument in the environment. Its exit status for a value.
   */
  function theCheckOf(stage: string, name: string): (value: string) => number | null {
    const checks = stage.split('\n').filter((l) => l.startsWith('RUN ') && l.includes(`$${name}`));
    expect(checks, `the stage has no RUN line of its own that reads ${name}`).toHaveLength(1);
    return (value) =>
      spawnSync('sh', ['-c', checks[0]!.slice('RUN '.length)], {
        env: { PATH: process.env.PATH, [name]: value },
        encoding: 'utf8',
      }).status;
  }

  it('has a runtime stage to read', () => {
    expect(runtime.startsWith('FROM ')).toBe(true);
  });

  it('defines every ${NAME} the template is rendered with', () => {
    const named = [...new Set([...TEMPLATE.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map((m) => m[1]!))];
    expect(named).toContain(ISSUER);
    for (const name of named) {
      expect(runtime, `${name} is in the template and no ENV of the runtime stage`).toMatch(
        new RegExp(`^ENV ${name}=`, 'm'),
      );
    }
  });

  it('takes the issuer from the same build argument the bundle was built with', () => {
    // So the page and the policy name one sign-in host, and cannot disagree.
    expect(runtime).toMatch(new RegExp(`^ARG ${ISSUER}=$`, 'm'));
    expect(runtime).toMatch(new RegExp(`^ENV ${ISSUER}=\\$${ISSUER}$`, 'm'));
  });

  it('refuses an issuer with a path when the image is built, and takes one without', () => {
    // A policy source with a path matches that one path, so the policy would
    // let sign-in fetch nothing at all. The line is run here as Docker runs a
    // RUN line, with the argument in the environment.
    const run = theCheckOf(runtime, ISSUER);
    for (const fine of ['', TEST_ISSUER, 'https://id.example.test:8443', 'https://id.example.test/']) {
      expect(run(fine), `"${fine}" refused`).toBe(0);
    }
    for (const withAPath of ['https://id.example.test/oidc', 'http://localhost:8080/realms/ownpace/']) {
      expect(run(withAPath), `"${withAPath}" let through`).not.toBe(0);
    }
  });

  it('refuses an API anywhere but this origin when the bundle is built', () => {
    // connect-src is this origin and the sign-in host. A bundle built to call
    // its API at another address could reach nothing: the sign-in page offered
    // no way in, and nothing said why until a person tried.
    const run = theCheckOf(build, 'VITE_API_URL');
    for (const fine of ['', '/api', '/', '/ownpace/api']) {
      expect(run(fine), `"${fine}" refused`).toBe(0);
    }
    for (const elsewhere of [
      'http://localhost:3001/api',
      'https://api.example.test/api',
      '//api.example.test/api',
      'api',
    ]) {
      expect(run(elsewhere), `"${elsewhere}" let through`).not.toBe(0);
    }
  });

  it('names its own variables so no environment variable can be substituted into them', () => {
    const own = [...TEMPLATE.matchAll(/\bset\s+\$(\w+)/g)].map((m) => m[1]!);
    for (const name of own) expect(name).toMatch(/^(?:ownpace_|api_upstream$)/);
  });
});

// ---------------------------------------------------------------------------
// And the real nginx, where the machine has one
// ---------------------------------------------------------------------------

/** The nginx binary, on the PATH or where Debian and Ubuntu put it. */
function nginxBinary(): string | undefined {
  const onPath = spawnSync('sh', ['-c', 'command -v nginx'], { encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim() !== '') return onPath.stdout.trim();
  return existsSync('/usr/sbin/nginx') ? '/usr/sbin/nginx' : undefined;
}

/** A port the OS hands out, so two runs at once do not meet. */
function aFreePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createNetServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const port = typeof a === 'object' && a ? a.port : 0;
      s.close(() => ok(port));
    });
  });
}

/** One answer: its status and every header line as sent, duplicates kept. */
interface Answer {
  readonly status: number;
  readonly lines: ReadonlyArray<readonly [string, string]>;
  all(name: string): string[];
}

function ask(port: number, path: string): Promise<Answer> {
  return new Promise((ok, fail) => {
    const req = get({ host: '127.0.0.1', port, path, headers: { host: 'app.example.test' } }, (res) => {
      res.resume();
      res.on('end', () => {
        const lines: Array<readonly [string, string]> = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2) lines.push([res.rawHeaders[i]!, res.rawHeaders[i + 1]!]);
        ok({
          status: res.statusCode ?? 0,
          lines,
          all: (name) => lines.filter(([n]) => n.toLowerCase() === name.toLowerCase()).map(([, v]) => v),
        });
      });
    });
    req.on('error', fail);
  });
}

const NGINX = nginxBinary();
const CALLBACK_HTML = '<!doctype html><html><body><script>window.close()</script></body></html>';

describe.skipIf(NGINX === undefined)('and the real nginx sends them', () => {
  let dir = '';
  let nginx: ChildProcess | undefined;
  let upstream: Server | undefined;
  let port = 0;
  let nginxLog = '';

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ownpace-web-nginx-'));
    // Readable by nginx's workers, which drop to `nobody` when the test runs as root.
    chmodSync(dir, 0o755);
    const html = join(dir, 'html');
    mkdirSync(join(html, 'assets'), { recursive: true });
    writeFileSync(join(html, 'index.html'), '<!doctype html><title>app</title><div id="root"></div>\n');
    writeFileSync(join(html, 'assets', 'index-abc123.js'), 'export {};\n');
    writeFileSync(join(html, 'version.json'), '{"version":"0.0.0","commit":""}\n');

    // The API's place: helmet as the API mounts it, and the consent callback
    // page under the headers the API gives it.
    upstream = createServer((req, res) => {
      helmet()(req, res, () => {
        if ((req.url ?? '').startsWith('/api/migrations/google/callback')) {
          for (const [name, value] of Object.entries(callbackPageHeaders(CALLBACK_HTML))) res.setHeader(name, value);
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
          res.end(CALLBACK_HTML);
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"status":"ok"}');
      });
    });
    await new Promise<void>((done) => upstream!.listen(0, '127.0.0.1', done));
    const a = upstream.address();
    const upstreamPort = typeof a === 'object' && a ? a.port : 0;
    port = await aFreePort();

    // The template as the image renders it, then pointed at this machine: the
    // three lines that name the container's own places, each found exactly once.
    let conf = envsubst(TEMPLATE, { API_UPSTREAM: `127.0.0.1:${upstreamPort}`, [ISSUER]: TEST_ISSUER });
    for (const [from, to] of [
      ['listen 80;', `listen 127.0.0.1:${port};`],
      ['root /usr/share/nginx/html;', `root ${html};`],
      ['access_log /var/log/nginx/access.log ownpace_combined;', `access_log ${join(dir, 'access.log')} ownpace_combined;`],
    ] as const) {
      expect(conf.split(from).length, `the template no longer says \`${from}\` once`).toBe(2);
      conf = conf.replace(from, to);
    }
    nginxLog = join(dir, 'error.log');
    writeFileSync(
      join(dir, 'nginx.conf'),
      [
        `pid ${join(dir, 'nginx.pid')};`,
        `error_log ${nginxLog};`,
        'daemon off;',
        'events { worker_connections 64; }',
        'http {',
        '  types { text/html html; text/javascript js; application/json json; text/css css; }',
        '  default_type application/octet-stream;',
        ...['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map((t) => `  ${t}_temp_path ${join(dir, t)};`),
        conf,
        '}',
        '',
      ].join('\n'),
    );
    const args = ['-p', dir, '-c', join(dir, 'nginx.conf'), '-e', nginxLog];
    const check = spawnSync(NGINX!, ['-t', ...args], { encoding: 'utf8' });
    expect(check.status, `nginx -t refused the rendered template:\n${check.stderr}`).toBe(0);
    nginx = spawn(NGINX!, args, { stdio: 'ignore' });
    const until = Date.now() + 10_000;
    for (;;) {
      try {
        await ask(port, '/version.json');
        break;
      } catch (err) {
        if (Date.now() > until) {
          throw new Error(`nginx did not answer:\n${readFileSync(nginxLog, 'utf8')}`, { cause: err });
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }, 30_000);

  afterAll(async () => {
    nginx?.kill('SIGQUIT');
    if (nginx && nginx.exitCode === null) await new Promise((done) => nginx!.once('exit', done));
    await new Promise<void>((done) => (upstream ? upstream.close(() => done()) : done()));
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** The five, each exactly once and as the template says, on one answer. */
  function expectTheFive(answer: Answer, what: string): void {
    for (const [name, value] of Object.entries(APP_HEADERS(TEST_ISSUER))) {
      expect(answer.all(name), `${what}: ${name}`).toEqual([value]);
    }
    for (const name of NEVER) expect(answer.all(name), `${what}: ${name}`).toEqual([]);
  }

  it.each(['/', '/login', '/grant/a-link', '/view/a-link', '/GRANT/a-link', '/index.html', '/assets/index-abc123.js'])(
    '%s: 200, with the five',
    async (path) => {
      const answer = await ask(port, path);
      expect(answer.status).toBe(200);
      expectTheFive(answer, path);
    },
  );

  it('/version.json: 200 with the five and no-cache, and its 404 with the five too', async () => {
    const found = await ask(port, '/version.json');
    expect(found.status).toBe(200);
    expectTheFive(found, '/version.json');
    expect(found.all('cache-control')).toEqual(['no-cache']);
    rmSync(join(dir, 'html', 'version.json'));
    const missing = await ask(port, '/version.json');
    expect(missing.status).toBe(404);
    expectTheFive(missing, '/version.json missing');
  });

  it("nginx's own redirect carries them too (always)", async () => {
    const answer = await ask(port, '/assets');
    expect(answer.status).toBe(301);
    expectTheFive(answer, '/assets');
  });

  it("/api/health: helmet's headers alone, one of each", async () => {
    const answer = await ask(port, '/api/health');
    expect(answer.status).toBe(200);
    const api = helmetHeaders();
    for (const name of ['content-security-policy', 'strict-transport-security', 'x-frame-options', 'referrer-policy', 'x-content-type-options']) {
      expect(answer.all(name), name).toEqual([api.get(name)]);
    }
  });

  it("the consent callback: its own policy alone, so its script runs, and its opener kept", async () => {
    const answer = await ask(port, '/api/migrations/google/callback?state=not-a-state');
    expect(answer.status).toBe(400);
    const own = callbackPageHeaders(CALLBACK_HTML);
    expect(answer.all('content-security-policy')).toEqual([own['Content-Security-Policy']]);
    expect(answer.all('cross-origin-opener-policy')).toEqual([own['Cross-Origin-Opener-Policy']]);
  });

  it('/api, without its slash: the 301 nginx makes from the API\'s location, with none of the five', async () => {
    // Found by this run: the reading above chose `location /` for it, and
    // nginx answers from `location /api/` (a proxied prefix ending in a slash
    // redirects the same address without one). The browser follows it to the API.
    const answer = await ask(port, '/api');
    expect(answer.status).toBe(301);
    expect(answer.all('location')[0]).toMatch(/\/api\/$/);
    for (const name of Object.keys(APP_HEADERS(''))) expect(answer.all(name), name).toEqual([]);
  });

  it.each(API_URIS)('%s: one policy, the API\'s', async (uri) => {
    const answer = await ask(port, uri);
    expect(answer.all('content-security-policy'), uri).toHaveLength(1);
    expect(answer.all('content-security-policy')[0], uri).not.toBe(POLICY(TEST_ISSUER));
    expect(answer.all('strict-transport-security'), uri).toHaveLength(1);
  });

  it("answers the app's addresses as the reading above says", async () => {
    // The reading and the server, held to each other: a template this file
    // misreads fails here and not on somebody's browser.
    for (const uri of APP_URIS) {
      const answer = await ask(port, uri);
      const read = sentFor(uri);
      for (const name of Object.keys(APP_HEADERS(''))) {
        const expected = read.get(name.toLowerCase());
        expect(answer.all(name), `${uri}: ${name}`).toEqual(expected ? [expected.value] : []);
      }
    }
  });
});
