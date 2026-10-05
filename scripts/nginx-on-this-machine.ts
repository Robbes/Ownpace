// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE APP'S NGINX, RUN ON THIS MACHINE, for the guards that ask a real nginx
 * what the web image does with `apps/web/nginx.conf.template`.
 *
 * Written for `what-a-browser-may-do-with-the-app.unit.test.ts` (workplan
 * 0158) and moved here when a second guard needed it
 * (`an-error-log-that-kept-the-link.unit.test.ts`, workplan 0108): importing
 * a `*.unit.test.ts` would register its tests a second time.
 *
 * The template is rendered as the image renders it (`envsubst`), inside the
 * image's own main level and http block, and pointed at this machine: the
 * lines that name the container's own places are replaced, each found exactly
 * once, so a template that stops saying one of them fails here and is not
 * served from the container's paths.
 *
 * THE IMAGE'S OWN LEVELS (added with the second guard). The web image is
 * `nginx:1.31-alpine`, which installs nginx.org's package and its
 * `/etc/nginx/nginx.conf` (nginx/pkg-oss, `rpm/SOURCES/nginx.conf`; the
 * alpine package is built from the same repository). Its main level says
 * `error_log /var/log/nginx/error.log notice;`, and its http block a `main`
 * format with the request line and the Referer whole, written to
 * `/var/log/nginx/access.log`. The image links those two files to the
 * container's stderr and stdout (nginx/docker-nginx,
 * `mainline/alpine-slim/Dockerfile`, "forward request and error logs to
 * docker log collector"). The template is included in that http block. So the
 * same lines are written here, to files of their own, and what nginx writes
 * to its own stderr is kept in a third: in the container all three are the
 * one log Docker keeps.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { envsubst } from './nginx-config.ts';

/** The nginx binary, on the PATH or where Debian and Ubuntu put it. */
export function nginxBinary(): string | undefined {
  const onPath = spawnSync('sh', ['-c', 'command -v nginx'], { encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim() !== '') return onPath.stdout.trim();
  return existsSync('/usr/sbin/nginx') ? '/usr/sbin/nginx' : undefined;
}

/** A port the OS hands out, so two runs at once do not meet. */
export function aFreePort(): Promise<number> {
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

export interface ServeOptions {
  /** The nginx binary to run. */
  readonly nginx: string;
  /** The template as written. */
  readonly template: string;
  /** The variables the image defines, which its template step substitutes. */
  readonly defined: Readonly<Record<string, string>>;
  /** Files of the built app, by their path under the document root. */
  readonly files: Readonly<Record<string, string>>;
  /** More lines to replace, each found exactly once, after the three every run replaces. */
  readonly edits?: ReadonlyArray<readonly [from: string, to: string]>;
}

export interface AppNginx {
  /** The loopback port it listens on. */
  readonly port: number;
  /** The document root, where `files` were written. */
  readonly html: string;
  /** The template's own access log. */
  readonly accessLog: string;
  /** The image's main-level error log, at the image's level: notice. */
  readonly mainErrorLog: string;
  /** The image's http-level access log, in its `main` format. */
  readonly imageAccessLog: string;
  /** What nginx wrote to its standard error. */
  readonly stderrLog: string;
  /** A log's text, or nothing when nginx never wrote it. */
  read(log: string): string;
  /** Stops nginx gracefully, so every line is written. Safe to call twice. */
  stop(): Promise<void>;
  /** Stops it and removes everything it was given. */
  remove(): Promise<void>;
}

/** The template, served by the real nginx on a loopback port, once it answers. */
export async function serveTheTemplate(options: ServeOptions): Promise<AppNginx> {
  const dir = mkdtempSync(join(tmpdir(), 'ownpace-web-nginx-'));
  // Readable by nginx's workers, which drop to `nobody` when the test runs as root.
  chmodSync(dir, 0o755);
  const html = join(dir, 'html');
  mkdirSync(html);
  for (const [path, content] of Object.entries(options.files)) {
    mkdirSync(dirname(join(html, path)), { recursive: true });
    writeFileSync(join(html, path), content);
  }
  const port = await aFreePort();
  const accessLog = join(dir, 'access.log');
  const mainErrorLog = join(dir, 'error.log');
  const imageAccessLog = join(dir, 'image-access.log');
  const stderrLog = join(dir, 'stderr.log');

  let conf = envsubst(options.template, options.defined);
  for (const [from, to] of [
    ['listen 80;', `listen 127.0.0.1:${port};`],
    ['root /usr/share/nginx/html;', `root ${html};`],
    ['access_log /var/log/nginx/access.log ownpace_combined;', `access_log ${accessLog} ownpace_combined;`],
    ...(options.edits ?? []),
  ] as const) {
    if (conf.split(from).length !== 2) throw new Error(`the template no longer says \`${from}\` once`);
    conf = conf.replace(from, to);
  }
  writeFileSync(
    join(dir, 'nginx.conf'),
    [
      `pid ${join(dir, 'nginx.pid')};`,
      `error_log ${mainErrorLog} notice;`,
      'daemon off;',
      'events { worker_connections 64; }',
      'http {',
      '  types { text/html html; text/javascript js; application/json json; text/css css; }',
      '  default_type application/octet-stream;',
      `  log_format main '$remote_addr - $remote_user [$time_local] "$request" '`,
      `    '$status $body_bytes_sent "$http_referer" '`,
      `    '"$http_user_agent" "$http_x_forwarded_for"';`,
      `  access_log ${imageAccessLog} main;`,
      ...['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map((t) => `  ${t}_temp_path ${join(dir, t)};`),
      conf,
      '}',
      '',
    ].join('\n'),
  );

  const read = (log: string): string => (existsSync(log) ? readFileSync(log, 'utf8') : '');
  const args = ['-p', dir, '-c', join(dir, 'nginx.conf'), '-e', mainErrorLog];
  const check = spawnSync(options.nginx, ['-t', ...args], { encoding: 'utf8' });
  if (check.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`nginx -t refused the rendered template:\n${check.stderr}`);
  }
  // Its standard error goes to a file, as the container's goes to Docker's log.
  const stderr = openSync(stderrLog, 'a');
  let nginx: ChildProcess | undefined = spawn(options.nginx, args, { stdio: ['ignore', 'ignore', stderr] });
  closeSync(stderr);

  const stop = async (): Promise<void> => {
    const running = nginx;
    nginx = undefined;
    if (!running) return;
    if (running.exitCode === null && running.signalCode === null) {
      const exited = new Promise((done) => running.once('exit', done));
      running.kill('SIGQUIT');
      await exited;
    }
  };

  const until = Date.now() + 10_000;
  for (;;) {
    try {
      await new Promise<void>((ok, fail) => {
        get({ host: '127.0.0.1', port, path: '/', headers: { host: 'app.example.test' } }, (res) => {
          res.resume();
          res.on('end', ok);
        }).on('error', fail);
      });
      break;
    } catch (err) {
      if (Date.now() > until) {
        await stop();
        const logs = `${read(mainErrorLog)}${read(stderrLog)}`;
        rmSync(dir, { recursive: true, force: true });
        throw new Error(`nginx did not answer:\n${logs}`, { cause: err });
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  return {
    port,
    html,
    accessLog,
    mainErrorLog,
    imageAccessLog,
    stderrLog,
    read,
    stop,
    remove: async () => {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
