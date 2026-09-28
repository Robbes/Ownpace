// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SCREENSHOT THE FRONT DOOR LETS THROUGH (workplan 0130).
 *
 * The report form takes a screenshot of up to 5 MB and sends it as base64
 * inside JSON, a third larger again, and the API parses that one route with a
 * limit of its own: `PROBLEM_REPORT_BODY_LIMIT`, 8 MB, in
 * `apps/api/src/problem-report.ts`. But on managed the browser never talks to
 * the API. It talks to the web image's nginx, which proxies `/api/`
 * (`apps/web/nginx.conf.template`), and that block set no
 * `client_max_body_size`, so nginx's default of 1 MB applied. Every screenshot
 * above about 750 KB, which is an ordinary full-screen PNG, was refused by nginx
 * with an HTML 413 before the API saw a byte. No ticket was made and no
 * `report.not-delivered` was recorded, and the form printed "Request failed with
 * status code 413". The API's tests call Express directly and the UI smoke mocks
 * the route, so nothing in the repository ever sent a body through the front.
 * Found by reading on 2026-09-28, and reproduced on nginx 1.24 with the template
 * as it was: a 2 MB report was answered `413 text/html`, and a 30-byte one
 * reached the upstream.
 *
 * So this reads both sides and compares them:
 *
 * - **The API's body parsers.** Every call of `express.json`, `.raw`, `.text`
 *   or `.urlencoded` under `apps/api/src`, each with its `limit`: a literal, a
 *   constant resolved to the value it is declared with, or body-parser's
 *   default of 100 kB where it names none. A call whose options this cannot
 *   read fails the test rather than being skipped. So does a body read any
 *   other way this could miss: a parser imported by name or from
 *   `body-parser` (`import { raw } from 'express'`), Express under another
 *   name, another body-reading package, or a route reading the request stream
 *   itself (`req.on('data')`, `req.pipe`, `for await (… of req)`). A reader
 *   hidden past all of those, behind a helper that takes the request under
 *   another name, is not seen.
 * - **Which URI each large parser serves.** A parser that takes more than
 *   nginx's default of 1 MB is one a front refuses unless told otherwise, so
 *   this must know the URI its route is sent to (`ROUTE_URIS`); one it does
 *   not know fails. Today that is the report route alone.
 * - **The location nginx chooses for that URI**, in every server of every
 *   nginx config under `apps/` and `deploy/`, chosen as nginx chooses: an
 *   exact `=` match, else the longest prefix, and that prefix unless it is `^~`
 *   or a regex matches first, in order; nested locations the same way inside
 *   the chosen one. Where the chosen location proxies, the
 *   `client_max_body_size` that applies there, by nginx's inheritance (the
 *   location's own, else an enclosing block's, else the file's top level; none
 *   at all is nginx's 1 MB), must be at least what the route's parser takes.
 *   So a tighter setup passes too: 8m on `location = /api/problem-reports`
 *   only, with nginx's default on the rest of `/api/`. The config the web
 *   image copies in (`apps/web/Dockerfile`) must send the report to a location
 *   that proxies it, so the test cannot pass by finding nothing.
 *
 * What it does not cover, and why:
 *
 * - A front that sets a limit BELOW nginx's default, on a URI whose parser
 *   takes 1 MB or less, is not looked for: those URIs are not listed here.
 * - The public site's `deploy/compose/www-nginx.conf` proxies nothing: it is
 *   read and chooses no location that proxies the report.
 * - The Caddy in front of the Trigger.dev dashboard (`trigger-tls.Caddyfile`)
 *   proxies Trigger.dev, not this API, and Caddy sets no body limit unless told.
 * - The appliance serves its screens and its API from one Node process, with
 *   no front, and has no report route.
 * - **The public ingress in front of the machine** (a mesh provider's, on the
 *   reference machine) is not in this repository. Its own limit is a line in
 *   `docs/managed-bring-up.md`, checked by 8f's test report with a screenshot
 *   near 5 MB, and the form says what a 413 means whichever front sends it
 *   (`apps/web/src/pages/ReportProblem.tsx`).
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROBLEM_REPORT_BODY_LIMIT } from '../apps/api/src/problem-report.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

/** The URI the report form posts to, through whichever front there is. */
const REPORT_URI = '/api/problem-reports';
/** The report route's own file: its parser must be among those found. */
const REPORT_ROUTE = 'apps/api/src/routes/problem-reports.ts';
/**
 * The URI each route with a parser larger than nginx's default is sent to.
 * A parser that large on a route not listed here fails, until it is.
 */
const ROUTE_URIS: ReadonlyMap<string, string> = new Map([[REPORT_ROUTE, REPORT_URI]]);
/** body-parser's limit where a parser names none. */
const BODY_PARSER_DEFAULT = '100kb';
/** nginx's `client_max_body_size` where nothing sets one. */
const NGINX_DEFAULT = '1m';

/** The files under these directories, tracked or new, never ignored ones. */
function filesUnder(...dirs: string[]): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...dirs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f !== '');
}

// ---------------------------------------------------------------------------
// Sizes, each as its own reader reads it
// ---------------------------------------------------------------------------

const KIB = 1024;

/**
 * A body-parser limit in bytes, as its `bytes` package reads one: a bare
 * number is bytes, and a unit is 1024 of the one below it.
 */
function bodyParserBytes(limit: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(limit.trim());
  if (!m) throw new Error(`a body-parser limit this test cannot read: ${limit}`);
  const unit = { b: 1, kb: KIB, mb: KIB ** 2, gb: KIB ** 3 }[(m[2] ?? 'b').toLowerCase() as 'b' | 'kb' | 'mb' | 'gb'];
  return Math.floor(Number(m[1]) * unit);
}

/**
 * An nginx size in bytes: a number with `k`, `m` or `g`, each 1024 of the one
 * below it. `0` switches the check off, which lets anything through.
 */
function nginxBytes(size: string): number {
  const m = /^(\d+)([kmg]?)$/i.exec(size);
  if (!m) throw new Error(`an nginx size this test cannot read: ${size}`);
  const n = Number(m[1]);
  if (n === 0) return Number.POSITIVE_INFINITY;
  return n * { '': 1, k: KIB, m: KIB ** 2, g: KIB ** 3 }[m[2]!.toLowerCase() as '' | 'k' | 'm' | 'g'];
}

// ---------------------------------------------------------------------------
// The API's side
// ---------------------------------------------------------------------------

interface BodyParser {
  readonly file: string;
  readonly call: string;
  readonly limit: string;
  readonly bytes: number;
}

const PARSER_CALL = /\bexpress\.(?:json|raw|text|urlencoded)\(/g;
const PARSER_NAMES = new Set(['json', 'raw', 'text', 'urlencoded']);
/** Packages that read a request body, with limits of their own this does not read. */
const OTHER_BODY_READERS = new Set(['body-parser', 'raw-body', 'co-body', 'multer', 'busboy', 'formidable']);

/**
 * Every way the API's source reads a body that `bodyParsersIn` would not see,
 * as a sentence each. A parser this cannot see is one whose limit nothing
 * compares with the front, so it is refused rather than missed.
 */
function bodyReadersThisCannotRead(sources: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [file, source] of sources) {
    // Code, not what a comment says about it: block comments and whole-line ones.
    const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of text.matchAll(/(?:\bfrom\s*|\brequire\(\s*|\bimport\(\s*)(['"])([^'"]+)\1/g)) {
      if (OTHER_BODY_READERS.has(m[2]!)) {
        out.push(`${file}: reads bodies with ${m[2]}, whose limit this guard does not read; use express.json, .raw, .text or .urlencoded.`);
      }
    }
    for (const m of text.matchAll(/^\s*import\s+(?!type\b)([^;]*?)\s+from\s*(['"])express\2/gm)) {
      const clause = m[1]!.trim();
      if (clause.startsWith('*')) out.push(`${file}: imports Express as a namespace (\`${clause}\`); import it as \`express\`.`);
      const own = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause)?.[1];
      if (own !== undefined && own !== 'express') out.push(`${file}: imports Express as \`${own}\`; import it as \`express\`.`);
      for (const named of /\{([^}]*)\}/.exec(clause)?.[1]?.split(',') ?? []) {
        if (/^\s*type\s/.test(named)) continue;
        const name = named.trim().split(/\s+as\s+/)[0]!;
        if (PARSER_NAMES.has(name)) out.push(`${file}: imports the parser \`${name}\` by name; call it as \`express.${name}(...)\`.`);
      }
    }
    for (const m of text.matchAll(/\bexpress\.(?:json|raw|text|urlencoded)\b(?!\s*\()/g)) {
      out.push(`${file}: passes \`${m[0]}\` on without calling it there; call it where it is mounted.`);
    }
    for (const m of text.matchAll(/\breq\.(?:on|once)\(\s*['"]data['"]|\breq\.pipe\(|\bof\s+req\b/g)) {
      out.push(`${file}: reads the request stream itself (\`${m[0]}\`), with no limit this guard can compare.`);
    }
  }
  return out;
}

/** Every body parser the API's source mounts, with the limit it parses with. */
function bodyParsersIn(sources: ReadonlyMap<string, string>): BodyParser[] {
  // A constant is found by name wherever it is declared; a name declared twice
  // with two values is not guessed at.
  const constants = new Map<string, string | null>();
  for (const text of sources.values()) {
    for (const m of text.matchAll(/\bconst\s+(\w+)\s*=\s*(['"`])([^'"`]*)\2/g)) {
      const prior = constants.get(m[1]!);
      constants.set(m[1]!, prior === undefined || prior === m[3] ? m[3]! : null);
    }
  }
  const out: BodyParser[] = [];
  for (const [file, text] of sources) {
    const calls = [...text.matchAll(/\bexpress\.(?:json|raw|text|urlencoded)\(([^()]*)\)/g)];
    const opened = [...text.matchAll(PARSER_CALL)].length;
    if (calls.length !== opened) {
      throw new Error(
        `${file}: ${opened - calls.length} body parser(s) whose options this test cannot read. ` +
          'Name the limit as a literal or a string constant, so it can be compared with the front.',
      );
    }
    for (const call of calls) {
      const named = /\blimit\s*:\s*([^,}\s]+)/.exec(call[1]!)?.[1];
      let limit: string;
      if (named === undefined) limit = BODY_PARSER_DEFAULT;
      else if (/^(['"`]).*\1$/.test(named)) limit = named.slice(1, -1);
      else if (/^\d+$/.test(named)) limit = named;
      else {
        const value = constants.get(named);
        if (value === undefined || value === null) {
          throw new Error(`${file}: \`${call[0]}\` names a limit this test cannot resolve: ${named}`);
        }
        limit = value;
      }
      out.push({ file, call: call[0], limit, bytes: bodyParserBytes(limit) });
    }
  }
  return out;
}

function apiSources(): Map<string, string> {
  const files = filesUnder('apps/api/src').filter((f) => f.endsWith('.ts') && !/\.test\.ts$/.test(f));
  return new Map(files.map((f) => [f, read(f)]));
}

// ---------------------------------------------------------------------------
// The front's side: nginx, parsed
// ---------------------------------------------------------------------------

interface NginxNode {
  readonly name: string;
  readonly args: readonly string[];
  readonly children?: NginxNode[];
}

/**
 * An nginx config as its directives and blocks. Comments are `#` to the end of
 * the line at the start of a word; a quoted word keeps its braces; and
 * `${name}`, which the image's template step substitutes and nginx reads as a
 * variable, is part of the word around it rather than a block. Anything this
 * cannot parse throws: a config that does not parse is one nothing checked.
 */
function parseNginx(conf: string, file: string): NginxNode[] {
  const top: NginxNode[] = [];
  const stack: NginxNode[][] = [top];
  let words: string[] = [];
  const fail = (why: string): never => {
    throw new Error(`${file}: ${why}. It does not parse, so nothing in it was checked: fix the config, not this test.`);
  };
  let i = 0;
  while (i < conf.length) {
    const c = conf[i]!;
    if (c === '#') {
      while (i < conf.length && conf[i] !== '\n') i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === ';') {
      if (words.length === 0) fail('an empty directive');
      stack.at(-1)!.push({ name: words[0]!, args: words.slice(1) });
      words = [];
      i++;
    } else if (c === '{') {
      if (words.length === 0) fail('a block with no name');
      const node: NginxNode = { name: words[0]!, args: words.slice(1), children: [] };
      stack.at(-1)!.push(node);
      stack.push(node.children!);
      words = [];
      i++;
    } else if (c === '}') {
      if (words.length > 0) fail(`\`${words.join(' ')}\` has no semicolon`);
      if (stack.length === 1) fail('a closing brace with no block open');
      stack.pop();
      i++;
    } else if (c === '"' || c === "'") {
      let word = '';
      let j = i + 1;
      while (j < conf.length && conf[j] !== c) {
        if (conf[j] === '\\' && j + 1 < conf.length) {
          word += conf[j + 1];
          j += 2;
        } else {
          word += conf[j++];
        }
      }
      if (j >= conf.length) fail('a quote that never closes');
      words.push(word);
      i = j + 1;
    } else {
      let word = '';
      while (i < conf.length && !/[\s;{}]/.test(conf[i]!)) {
        if (conf[i] === '$' && conf[i + 1] === '{') {
          const end = conf.indexOf('}', i);
          if (end < 0) fail('a `${` that never closes');
          word += conf.slice(i, end + 1);
          i = end + 1;
        } else {
          word += conf[i++];
        }
      }
      words.push(word);
    }
  }
  if (stack.length !== 1) fail('a block that never closes');
  if (words.length > 0) fail(`\`${words.join(' ')}\` has no semicolon`);
  return top;
}

interface Location {
  readonly node: NginxNode;
  readonly modifier: '=' | '^~' | '~' | '~*' | '';
  readonly pattern: string;
}

/** A location block's modifier and pattern, written apart or together (`= /x`, `=/x`). A named one is none. */
function locationOf(node: NginxNode): Location | undefined {
  if (node.name !== 'location' || node.children === undefined) return undefined;
  const [first, second] = node.args;
  if (first === undefined || first.startsWith('@')) return undefined;
  for (const modifier of ['=', '^~', '~*', '~'] as const) {
    if (first === modifier) return second === undefined ? undefined : { node, modifier, pattern: second };
    if (first.startsWith(modifier)) return { node, modifier, pattern: first.slice(modifier.length) };
  }
  return { node, modifier: '', pattern: first };
}

/**
 * The location nginx chooses for a URI among one level's blocks, as the path
 * of locations from that level down to the one chosen
 * (`ngx_http_core_find_location`): an exact `=` match ends the search; else
 * the longest prefix is remembered and its nested locations searched the same
 * way; unless that prefix is `^~`, the level's regexes are then tried in
 * order, and the first that matches wins over it. `final` is whether an exact
 * or a regex match ended the search, which a level above must not override.
 */
function chooseLocation(level: readonly NginxNode[], uri: string): { path: NginxNode[]; final: boolean } | undefined {
  const locations = level.map(locationOf).filter((l): l is Location => l !== undefined);
  const exact = locations.find((l) => l.modifier === '=' && l.pattern === uri);
  if (exact) return { path: [exact.node], final: true };
  let prefix: Location | undefined;
  for (const l of locations) {
    if ((l.modifier === '' || l.modifier === '^~') && uri.startsWith(l.pattern)) {
      if (prefix === undefined || l.pattern.length > prefix.pattern.length) prefix = l;
    }
  }
  let found: { path: NginxNode[]; final: boolean } | undefined;
  if (prefix) {
    const inner = chooseLocation(prefix.node.children!, uri);
    if (inner?.final) return { path: [prefix.node, ...inner.path], final: true };
    found = { path: [prefix.node, ...(inner?.path ?? [])], final: false };
    if (prefix.modifier === '^~') return found;
  }
  for (const l of locations) {
    if (l.modifier !== '~' && l.modifier !== '~*') continue;
    if (new RegExp(l.pattern, l.modifier === '~*' ? 'i' : '').test(uri)) {
      return { path: [l.node, ...(chooseLocation(l.node.children!, uri)?.path ?? [])], final: true };
    }
  }
  return found;
}

/** Whether this location itself proxies: its own `proxy_pass`, or one in an `if` inside it, never a nested location's. */
function proxies(node: NginxNode): boolean {
  return (node.children ?? []).some(
    (n) => n.name === 'proxy_pass' || (n.children !== undefined && n.name !== 'location' && proxies(n)),
  );
}

interface Front {
  readonly location: string;
  /** The `client_max_body_size` that applies there, or undefined for nginx's default. */
  readonly limit: string | undefined;
}

/**
 * In each server of a config, the location nginx chooses for this URI, where
 * it proxies, with the body limit nginx applies there: its own, else the
 * nearest enclosing block's, else the file's top level (the `http` context a
 * `conf.d` file is included into). A server whose chosen location serves
 * files, or that chooses none, does not carry the request to the API.
 */
function frontsFor(top: readonly NginxNode[], uri: string): Front[] {
  const own = (nodes: readonly NginxNode[]): string | undefined =>
    nodes.filter((n) => n.name === 'client_max_body_size').at(-1)?.args[0];
  const out: Front[] = [];
  const walk = (nodes: readonly NginxNode[], scopes: ReadonlyArray<readonly NginxNode[]>): void => {
    for (const node of nodes) {
      if (node.children === undefined || node.name === 'location') continue;
      const inner = [...scopes, node.children];
      if (node.name !== 'server') {
        walk(node.children, inner);
        continue;
      }
      const chosen = chooseLocation(node.children, uri)?.path;
      const last = chosen?.at(-1);
      if (chosen === undefined || last === undefined || !proxies(last)) continue;
      const blocks = [...inner, ...chosen.map((l) => l.children!)];
      const limit = [...blocks].reverse().map(own).find((v) => v !== undefined);
      out.push({ location: `location ${last.args.join(' ')}`, limit });
    }
  };
  walk(top, [top]);
  return out;
}

/** The nginx configs under `apps/` and `deploy/`. */
function nginxConfigs(): string[] {
  return filesUnder('apps', 'deploy').filter((f) => {
    if (/nginx/i.test(f.split('/').at(-1)!)) return true;
    return /\.conf(\.template)?$/.test(f) && /^\s*(?:server|http)\s*\{/m.test(read(f));
  });
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('the readers this guard compares with', () => {
  it("read sizes as body-parser and nginx do, 1024 to a unit", () => {
    expect(bodyParserBytes('8mb')).toBe(8 * 1024 * 1024);
    expect(bodyParserBytes('100kb')).toBe(100 * 1024);
    expect(bodyParserBytes('1048576')).toBe(1048576);
    expect(nginxBytes('8m')).toBe(8 * 1024 * 1024);
    expect(nginxBytes('1024k')).toBe(1024 * 1024);
    expect(nginxBytes('1g')).toBe(1024 ** 3);
    expect(nginxBytes('0')).toBe(Number.POSITIVE_INFINITY);
  });

  it("apply nginx's inheritance: the location's own, else the server's, else the top, else none", () => {
    const at = (conf: string) => frontsFor(parseNginx(conf, 'example'), REPORT_URI).map((l) => l.limit);
    const api = 'location /api/ { proxy_pass http://api; }';
    expect(at(`server { ${api} }`)).toEqual([undefined]);
    expect(at(`client_max_body_size 2m; server { ${api} }`)).toEqual(['2m']);
    expect(at(`http { client_max_body_size 2m; server { ${api} } }`)).toEqual(['2m']);
    expect(at(`client_max_body_size 2m; server { client_max_body_size 3m; ${api} }`)).toEqual(['3m']);
    expect(at(`server { client_max_body_size 3m; location /api/ { client_max_body_size 1m; proxy_pass http://api; } }`)).toEqual(['1m']);
    expect(
      at('server { location /api/ { client_max_body_size 4m; location /api/problem { proxy_pass http://api; } } }'),
    ).toEqual(['4m']);
    // A location that serves files is not the door the report comes through.
    expect(at('server { location / { try_files $uri /index.html; } }')).toEqual([]);
    // Nor one for another path, nor one whose only proxy is a nested location for another path.
    expect(at('server { location /other/ { proxy_pass http://api; } }')).toEqual([]);
    expect(at('server { location /api/ { location /api/other/ { proxy_pass http://api; } } }')).toEqual([]);
  });

  it('choose the location nginx would: exact, else the longest prefix unless ^~ or a regex comes first', () => {
    const chosen = (conf: string, uri = REPORT_URI) =>
      chooseLocation(parseNginx(conf, 'example'), uri)?.path.map((l) => l.args.join(' '));
    // The longest prefix, wherever it is written.
    expect(chosen('location /api/ {} location /api/problem {} location / {}')).toEqual(['/api/problem']);
    // An exact match wins, and matches only the URI itself.
    expect(chosen('location /api/problem-reports {} location = /api/problem-reports {}')).toEqual(['= /api/problem-reports']);
    expect(chosen('location /api/ {} location =/api/problem-reports {}')).toEqual(['=/api/problem-reports']);
    expect(chosen('location /api/ {} location = /api/problem-reports {}', '/api/problem-reports/x')).toEqual(['/api/']);
    // A regex wins over the longest prefix, the first in order, unless the prefix is ^~.
    expect(chosen('location /api/problem-reports {} location ~ ^/api/ {} location ~ problem {}')).toEqual(['~ ^/api/']);
    expect(chosen('location ^~ /api/ {} location ~ ^/api/ {}')).toEqual(['^~ /api/']);
    expect(chosen('location /api/ {} location ~* ^/API/PROBLEM {}')).toEqual(['~* ^/API/PROBLEM']);
    // A nested location is chosen inside the one around it, and a regex inside ends the search.
    expect(chosen('location /api/ { location /api/problem-reports {} } location ~ ^/api {}')).toEqual(['~ ^/api']);
    expect(chosen('location /api/ { location ~ reports$ {} } location ~ ^/api {}')).toEqual(['/api/', '~ reports$']);
    // A named location is never chosen for a URI.
    expect(chosen('location @api {}')).toBeUndefined();
  });

  it('pass the tighter setup: 8m on the report route alone, and the default on the rest of /api/', () => {
    const conf =
      'server { location /api/ { proxy_pass http://api; } ' +
      'location = /api/problem-reports { client_max_body_size 8m; proxy_pass http://api; } }';
    expect(frontsFor(parseNginx(conf, 'example'), REPORT_URI)).toEqual([
      { location: 'location = /api/problem-reports', limit: '8m' },
    ]);
  });

  it('keep quoted braces and ${name} inside the word they belong to', () => {
    const top = parseNginx(
      'map $a $b { "~^(?<x>[^?]*)\\?" "${x}?..."; default $a; }\n' +
        'server { location /api/ { set $u http://${API_UPSTREAM}; proxy_pass $u; } }',
      'example',
    );
    expect(top.map((n) => n.name)).toEqual(['map', 'server']);
    expect(frontsFor(top, REPORT_URI)).toEqual([{ location: 'location /api/', limit: undefined }]);
  });

  it('read a parser without a limit as body-parser does, and resolve a named one', () => {
    const parsers = bodyParsersIn(
      new Map([
        ['a.ts', "export const BIG = '8mb';\napp.use(express.json());"],
        ['b.ts', "router.use(express.json({ limit: BIG }));\napp.use(express.urlencoded({ extended: false }));"],
      ]),
    );
    expect(parsers.map((p) => p.limit)).toEqual(['100kb', '8mb', '100kb']);
    expect(() => bodyParsersIn(new Map([['c.ts', 'router.use(express.json({ limit: size() }));']]))).toThrow(
      /cannot read/,
    );
  });

  it('refuse a body read any way they cannot see', () => {
    const refused = (text: string) => bodyReadersThisCannotRead(new Map([['x.ts', text]]));
    expect(refused("import express, { Router } from 'express';\nimport type { Request } from 'express';")).toEqual([]);
    expect(refused("import { Router, type Response } from 'express';")).toEqual([]);
    expect(refused("import { raw } from 'express';\nrouter.use(raw({ limit: '50mb' }));")).toHaveLength(1);
    expect(refused("import express, { json as parse } from 'express';")).toHaveLength(1);
    expect(refused("import e from 'express';")).toHaveLength(1);
    expect(refused("import * as e from 'express';")).toHaveLength(1);
    expect(refused("import bodyParser from 'body-parser';")).toHaveLength(1);
    expect(refused("const multer = require('multer');")).toHaveLength(1);
    expect(refused('const parse = express.json;')).toHaveLength(1);
    expect(refused("req.on('data', (c) => chunks.push(c));")).toHaveLength(1);
    // What a comment says is not a read.
    expect(refused("/**\n * express.json's 100kb, and req.pipe(x)\n */\n// import { raw } from 'express';")).toEqual([]);
    expect(refused('req.pipe(file);')).toHaveLength(1);
    expect(refused('for await (const chunk of req) size += chunk.length;')).toHaveLength(1);
  });
});

describe('a screenshot the front door lets through', () => {
  it("finds the report route's own parser among the API's, at the limit it runs with", () => {
    const parsers = bodyParsersIn(apiSources());
    const report = parsers.filter((p) => p.file === REPORT_ROUTE);
    expect(report.map((p) => p.limit), `${REPORT_ROUTE} parses with no limit this test found`).toEqual([
      PROBLEM_REPORT_BODY_LIMIT,
    ]);
  });

  it('reads every body the API reads, or refuses the way it is read', () => {
    expect(
      bodyReadersThisCannotRead(apiSources()),
      'A body read this way has a limit nothing compares with the front, so a front can refuse it unseen:',
    ).toEqual([]);
  });

  it('finds the config the web image ships, and nginx sends the report to a location that proxies it', () => {
    const shipped = /^COPY\s+(\S+)\s+\/etc\/nginx\/templates\//m.exec(read('apps/web/Dockerfile'))?.[1];
    expect(shipped, 'apps/web/Dockerfile copies no nginx template in').toBeDefined();
    expect(nginxConfigs()).toContain(shipped);
    expect(frontsFor(parseNginx(read(shipped!), shipped!), REPORT_URI).length).toBeGreaterThan(0);
  });

  it("knows the URI of every route whose parser takes more than nginx's default", () => {
    const unknown = bodyParsersIn(apiSources())
      .filter((p) => p.bytes > nginxBytes(NGINX_DEFAULT) && !ROUTE_URIS.has(p.file))
      .map((p) => `${p.file}: ${p.call} takes ${p.limit}`);
    expect(
      unknown,
      `A front refuses a body above ${NGINX_DEFAULT} unless told otherwise. Add the URI this route is sent to ` +
        'to ROUTE_URIS, so the location nginx chooses for it is checked:',
    ).toEqual([]);
  });

  it('lets through every body a route takes, at the location nginx chooses for it, on every nginx front', () => {
    const parsers = bodyParsersIn(apiSources());
    const failures: string[] = [];
    for (const [route, uri] of ROUTE_URIS) {
      const own = parsers.filter((p) => p.file === route);
      expect(own.length, `${route} mounts no body parser this test found`).toBeGreaterThan(0);
      const largest = own.reduce((a, b) => (b.bytes > a.bytes ? b : a));
      for (const file of nginxConfigs()) {
        for (const { location, limit } of frontsFor(parseNginx(read(file), file), uri)) {
          if (nginxBytes(limit ?? NGINX_DEFAULT) >= largest.bytes) continue;
          failures.push(
            `${file}, ${location} (chosen for ${uri}): ` +
              (limit === undefined
                ? `no client_max_body_size, so nginx's default of ${NGINX_DEFAULT} applies`
                : `client_max_body_size ${limit}`) +
              `, and ${route} takes up to ${largest.limit} (${largest.call}).`,
          );
        }
      }
    }
    expect(
      failures,
      'A report with a screenshot is refused by the front with an HTML 413 before the API sees it, and ' +
        "nothing is recorded. Set client_max_body_size in the location nginx chooses to at least the route's " +
        'body limit (PROBLEM_REPORT_BODY_LIMIT in apps/api/src/problem-report.ts):\n' +
        failures.join('\n'),
    ).toEqual([]);
  });
});
