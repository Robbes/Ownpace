// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LOG THAT KEPT THE LINK, on the web image's nginx.
 *
 * nginx's default access log writes the request line and the Referer in full.
 * The web image serves the grant and view pages (`/grant/<link>`, where the
 * link is the credential), proxies the API calls those pages make
 * (`/api/grant/<link>/...`), and receives each of them with the page's own URL
 * as its Referer. `apps/web/nginx.conf.template` now logs them through `map`s
 * that keep the route and drop the link and the query, the rule the API's own
 * log follows (`apps/api/src/access-log.ts`).
 *
 * Two logs that must say the same thing drift the way everything duplicated in
 * this repository has drifted. So this runs the TEMPLATE'S OWN `map`s, by
 * nginx's rules, and requires the same answer as the API's functions for every
 * input below. The template was also run on a real nginx (1.24, `nginx -t` and
 * live requests) when it was written; that is in the pull request, and this is
 * what keeps it true afterwards.
 *
 * AND IN ANY CASE (2026-10-05, found by the review of #1495). Every pattern
 * knew `grant`, `view` and `api` in lower case only. But the API routes
 * without regard to case (Express's default), the web app's router opens
 * `/GRANT/<link>` as the grant page, and nginx serves that page for any path.
 * So `/API/GRANT/<link>/x`, `/GRANT/<link>` and a Referer of
 * `https://host/Grant/<link>` were written with the link in full, by both logs
 * and by the problem report's page. The link maps are now `~*`, nginx's
 * caseless match, and this reads that operator and evaluates them as nginx
 * does. The scheme rule stays as it was: a Referer whose scheme is not in
 * lower case was never taken for a URL, by either log, and is written "-".
 * The problem report's page (`reportablePage`, in
 * `apps/web/src/services/problem-report-service.ts`) is held to the API's
 * answer here too.
 *
 * AND IN ANY SPELLING (found by the review of that change). The web app's
 * router decodes a percent escape before it matches, so `/%67rant/<link>`
 * opens the grant page as well. nginx writes `$request_uri` as it came, so
 * each letter of a route word may be its escape, and every pattern reads it so.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loggableReferrer, loggableUrl } from '../apps/api/src/access-log.ts';
import { reportablePage } from '../apps/web/src/services/problem-report-service.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(join(REPO_ROOT, 'apps/web/nginx.conf.template'), 'utf8');

interface NginxMap {
  readonly source: string;
  readonly target: string;
  readonly exact: ReadonlyMap<string, string>;
  readonly regexes: ReadonlyArray<{
    readonly pattern: RegExp;
    readonly value: string;
    /** `~*`: nginx matches it without regard to case. */
    readonly caseless: boolean;
  }>;
  readonly fallback: string;
}

/** A quoted nginx string as the parser reads it: only `\"`, `\'` and `\\` unescape. */
function unquote(token: string): string {
  return token.startsWith('"') ? token.slice(1, -1).replace(/\\(["'\\])/g, '$1') : token;
}

function mapsOf(conf: string): NginxMap[] {
  const out: NginxMap[] = [];
  // To the brace that closes the block on its own line: a value's `${name}`
  // holds braces too.
  for (const block of conf.matchAll(/^map\s+\$(\w+)\s+\$(\w+)\s*\{\n([\s\S]*?)\n\}/gm)) {
    const exact = new Map<string, string>();
    const regexes: Array<{ pattern: RegExp; value: string; caseless: boolean }> = [];
    let fallback = '';
    const lines = block[3]!.split('\n').map((l) => l.trim());
    for (const line of lines.filter((l) => l !== '' && !l.startsWith('#'))) {
      const entry = line.match(/^("(?:[^"\\]|\\.)*"|\S+)\s+("(?:[^"\\]|\\.)*"|\S+);$/);
      expect(entry, `a map entry this reader cannot parse: ${line}`).not.toBeNull();
      const key = unquote(entry![1]!);
      const value = unquote(entry![2]!);
      if (entry![1] === 'default') fallback = value;
      else if (key.startsWith('~*')) regexes.push({ pattern: new RegExp(key.slice(2), 'i'), value, caseless: true });
      else if (key.startsWith('~')) regexes.push({ pattern: new RegExp(key.slice(1)), value, caseless: false });
      else exact.set(key, value);
    }
    out.push({ source: block[1]!, target: block[2]!, exact, regexes, fallback });
  }
  return out;
}

/** `$name` and `${name}` in a map value, from its captures and the variables so far. */
function expand(value: string, vars: Readonly<Record<string, string>>): string {
  return value.replace(/\$\{(\w+)\}|\$(\w+)/g, (_m, braced: string, bare: string) => {
    return vars[braced ?? bare] ?? '';
  });
}

/**
 * nginx's map: an exact key first, then the regexes in order, then the default.
 * And NO regex for an empty value: `ngx_http_map_find` tries them only when the
 * value has a length, which a real nginx showed when an empty Referer skipped a
 * pattern that matches the empty string.
 */
function evaluate(maps: ReadonlyArray<NginxMap>, inputs: Record<string, string>) {
  const vars: Record<string, string> = { ...inputs };
  for (const map of maps) {
    const source = vars[map.source] ?? '';
    let result: string | undefined = map.exact.has(source) ? map.exact.get(source) : undefined;
    if (result === undefined && source !== '') {
      for (const { pattern, value } of map.regexes) {
        const matched = source.match(pattern);
        if (matched) {
          result = expand(value, { ...vars, ...(matched.groups ?? {}) });
          break;
        }
      }
    }
    vars[map.target] = result ?? expand(map.fallback, vars);
  }
  return vars;
}

const MAPS = mapsOf(TEMPLATE);
const nginxLogs = (requestUri: string, referer = '') =>
  evaluate(MAPS, { request_uri: requestUri, http_referer: referer });

const REQUESTS = [
  '/grant/q7Rk-link',
  '/grant/q7Rk-link?from=mail',
  '/view/v13w-link',
  '/api/grant/q7Rk-link',
  '/api/grant/q7Rk-link/google/authorize',
  '/api/grant/q7Rk-link/google/authorize?x=1',
  '/api/view/v13w-link',
  '/api/migrations/google/callback?code=4/0Ab-code&state=s1gned',
  '/api/connections',
  '/api/grants/abc',
  '/grant/',
  '/',
  '/assets/index.js',
  // The route words in any case: Express and the web app's router both match
  // them so.
  '/GRANT/q7Rk-link',
  '/Grant/q7Rk-link?from=mail',
  '/View/v13w-link',
  '/API/GRANT/q7Rk-link/x',
  '/Api/View/v13w-link',
  '/api/Grant/q7Rk-link/google/authorize',
  '/API/GRANTS/abc',
  // A route word with escapes: the web app's router decodes them and opens
  // the page. Every letter's escape, in lower and in upper case.
  '/%67rant/q7Rk-link',
  '/gr%61nt/q7Rk-link/x?y=1',
  '/%47RANT/q7Rk-link',
  '/%76iew/v13w-link',
  '/api/%67rant/q7Rk-link/google/authorize',
  '/%61%70%69/%67%72%61%6e%74/q7Rk-link',
  '/%41%50%49/%47%52%41%4E%54/q7Rk-link',
  '/%76%69%65%77/v13w-link',
  '/%56%49%45%57/v13w-link',
  // Encoded twice, or not a route word: no link page opens.
  '/%2567rant/abc',
  '/%67rants/abc',
];

const REFERERS = [
  '',
  'https://app.example.test/grant/q7Rk-link?from=mail',
  'https://app.example.test/grant/q7Rk-link',
  'https://app.example.test/view/v13w-link/x?y=1',
  'http://localhost:3123/api/grant/q7Rk-link',
  'https://app.example.test/migrations?tab=files',
  'https://app.example.test/',
  'android-app://com.example.mail/',
  'not a url q7Rk-link',
  'https://app.example.test/Grant/q7Rk-link',
  'https://app.example.test/API/VIEW/v13w-link?y=1',
  // The host in any case, as it always was; a scheme not in lower case is not
  // a URL to either log, as it never was.
  'https://APP.example.test/grant/q7Rk-link',
  'HTTPS://app.example.test/Grant/q7Rk-link',
  // The page at `/%67rant/<link>` makes its calls with this Referer.
  'https://app.example.test/%67rant/q7Rk-link',
  'https://app.example.test/%56IEW/v13w-link?y=1',
];

describe("the web image's access log", () => {
  it('reads the four maps it writes the log from', () => {
    expect(MAPS.map((m) => `${m.source} -> ${m.target}`)).toEqual([
      'request_uri -> ownpace_log_uri_path',
      'ownpace_log_uri_path -> ownpace_log_uri',
      'http_referer -> ownpace_log_referer_path',
      'ownpace_log_referer_path -> ownpace_log_referer',
    ]);
  });

  it.each(REQUESTS)('logs %s exactly as the API does', (uri) => {
    expect(nginxLogs(uri).ownpace_log_uri).toBe(loggableUrl(uri));
  });

  it.each(REFERERS)('logs the Referer %j exactly as the API does', (referer) => {
    expect(nginxLogs('/api/connections', referer).ownpace_log_referer).toBe(
      loggableReferrer(referer),
    );
  });

  it('keeps no link and no query value', () => {
    for (const uri of REQUESTS) {
      for (const referer of REFERERS) {
        const logged = nginxLogs(uri, referer);
        for (const field of [logged.ownpace_log_uri!, logged.ownpace_log_referer!]) {
          expect(field).not.toMatch(/q7Rk|v13w|code=|state=|from=|tab=|y=1|x=1/);
        }
      }
    }
  });

  it('drops the link whatever the case of the route, and keeps the route as it came', () => {
    expect(nginxLogs('/API/GRANT/q7Rk-link/x').ownpace_log_uri).toBe('/API/GRANT/:link/x');
    expect(nginxLogs('/Api/View/v13w-link').ownpace_log_uri).toBe('/Api/View/:link');
    expect(nginxLogs('/GRANT/q7Rk-link').ownpace_log_uri).toBe('/GRANT/:link');
    expect(nginxLogs('/', 'https://app.example.test/Grant/q7Rk-link').ownpace_log_referer).toBe(
      'https://app.example.test/Grant/:link',
    );
  });

  it('drops the link of a route word written with escapes, and keeps the route as it came', () => {
    expect(nginxLogs('/%67rant/q7Rk-link').ownpace_log_uri).toBe('/%67rant/:link');
    expect(nginxLogs('/api/%47RANT/q7Rk-link/x').ownpace_log_uri).toBe('/api/%47RANT/:link/x');
    expect(nginxLogs('/', 'https://app.example.test/%67rant/q7Rk-link').ownpace_log_referer).toBe(
      'https://app.example.test/%67rant/:link',
    );
  });

  it('matches a link route without regard to case (~*), as nginx reads the operator', () => {
    const linkRules = MAPS.flatMap((m) => m.regexes).filter((r) => /<ownpace_(?:uri|referer)_route>/.test(r.pattern.source));
    expect(linkRules).toHaveLength(2);
    for (const rule of linkRules) expect(rule.caseless, `${rule.pattern.source} is ~, not ~*`).toBe(true);
  });

  it('records the page of a problem report as the API does, in any case', () => {
    for (const uri of REQUESTS) {
      expect(reportablePage(uri), uri).toBe(loggableUrl(uri));
      expect(reportablePage(uri), uri).not.toMatch(/q7Rk|v13w|from=|x=1/);
    }
  });

  it('writes the request and the Referer only in their loggable forms', () => {
    const format = TEMPLATE.match(/log_format\s+ownpace_combined\s+([^;]+);/)?.[1] ?? '';
    expect(format).toContain('$ownpace_log_uri ');
    expect(format).toContain('$ownpace_log_referer"');
    // The raw forms, any of which would put the link or the query back.
    for (const raw of ['$request ', '$request_uri', '$uri', '$args', '$query_string', '$http_referer']) {
      expect(format, `${raw} in the log format`).not.toContain(raw);
    }
  });

  it('logs with that format, and nowhere else', () => {
    const accessLogs = [...TEMPLATE.matchAll(/^\s*access_log\s+([^;]+);/gm)].map((m) => m[1]);
    expect(accessLogs).toEqual(['/var/log/nginx/access.log ownpace_combined']);
  });

  it('names every capture so no environment variable can be substituted into it', () => {
    // The image renders this file with envsubst over the DEFINED variables, so
    // a capture named like one would be overwritten before nginx read it.
    const captures = [...TEMPLATE.matchAll(/\(\?<(\w+)>/g)].map((m) => m[1]!);
    expect(captures.length).toBeGreaterThan(0);
    for (const name of captures) expect(name).toMatch(/^ownpace_/);
  });
});
