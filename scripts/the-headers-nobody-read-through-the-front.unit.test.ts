// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE HEADERS NOBODY READ THROUGH THE FRONT (workplan 0158 T4).
 *
 * Since 2026-10-05 the app's nginx (`apps/web/nginx.conf.template`) sends a
 * policy and four headers on every page (0158 T1). They were held in three
 * places, and none was where a tester's browser gets them: the template's
 * reading and a run on a real nginx (`what-a-browser-may-do-with-the-app`),
 * the UI suite under them, and the smoke, which asks the image over plain http
 * on loopback, on the OTA stack. Live is reached through NetBird's proxy,
 * which ends TLS, and `deploy-live.sh` asked `/version.json` there and threw
 * the headers away. So nothing proved that the front passes them on, or that
 * HSTS, which a browser takes over TLS alone, arrives over TLS.
 *
 * `scripts/app-headers.mjs` says what the page must carry, from the template
 * alone, as the image renders it, and holds an answer to it: each header
 * once, with the template's value. Two callers read it through the front:
 * `deploy-live.sh` after every deploy (`a-deploy-from-a-named-tag`), and the
 * outside probe from a GitHub-hosted runner (`exposure-probe`). This guard
 * holds the reader: that it reads the template as nginx-config.mjs does and
 * names no value of its own, that a template stating no policy or no HSTS is
 * refused rather than passing everything, that curl's `-D` output is read
 * from its last block, that its command line answers 0, 1 or 2 and never
 * prints a value that arrived, and that it runs from a directory of its own
 * beside nginx-config.mjs, as the deploy runs it for a tag cut before it.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_TEMPLATE, REQUIRED_HEADERS, expectedAppHeaders, headerFindings, parseHeaderBlock } from './app-headers.mjs';
import { envsubst, headersFor, parseNginx } from './nginx-config.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const READER = join(REPO_ROOT, 'scripts', 'app-headers.mjs');
const TEMPLATE_FILE = join(REPO_ROOT, APP_TEMPLATE);
const TEMPLATE = readFileSync(TEMPLATE_FILE, 'utf8');
const ISSUER = 'https://id.ownpace.eu';

/** curl's `-D` output for these headers: a status line, CRLF, a blank line at the end. */
const block = (headers: ReadonlyArray<readonly [string, string]>, status = 'HTTP/2 200'): string =>
  [status, ...headers.map(([n, v]) => `${n}: ${v}`), '', ''].join('\r\n');

function cli(args: string[], cwd = REPO_ROOT, reader = READER) {
  const r = spawnSync(process.execPath, [reader, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'app-headers-'));
}

describe("what the template states for the app's page", () => {
  it('is what nginx-config.mjs reads for `/`, with the issuer substituted, and nothing of its own', () => {
    const { headers, errors } = expectedAppHeaders(TEMPLATE, ISSUER);
    expect(errors).toEqual([]);
    const byNginx = headersFor(parseNginx(envsubst(TEMPLATE, { VITE_OIDC_ISSUER: ISSUER, API_UPSTREAM: 'api:3001' }), APP_TEMPLATE), '/')!;
    expect(headers).toEqual(byNginx.map(({ name, value }) => ({ name, value })));
    for (const want of REQUIRED_HEADERS) expect(headers.map((h) => h.name)).toContain(want);
    const policy = headers.find((h) => h.name === 'Content-Security-Policy')!.value;
    expect(policy).toContain(`connect-src 'self' ${ISSUER};`);
    expect(policy).not.toContain('${');
  });

  it('follows the template: a line changed there is the line expected', () => {
    const changed = TEMPLATE.replaceAll('max-age=31536000; includeSubDomains', 'max-age=600');
    expect(changed).not.toBe(TEMPLATE);
    const hsts = expectedAppHeaders(changed, ISSUER).headers.find((h) => h.name === 'Strict-Transport-Security');
    expect(hsts?.value).toBe('max-age=600');
  });

  it.each(REQUIRED_HEADERS)('a template that states no %s for the page is refused, not passed', (name) => {
    const cut = TEMPLATE.replace(new RegExp(`^\\s*add_header ${name} .*\\n`, 'gm'), '');
    expect(cut).not.toBe(TEMPLATE);
    const { errors } = expectedAppHeaders(cut, ISSUER);
    expect(errors).toEqual([`${APP_TEMPLATE} states no ${name} for the app's page, so an answer without one would pass`]);
  });

  it('a template that does not parse is refused, with the reason', () => {
    const { headers, errors } = expectedAppHeaders('server { location / {', ISSUER);
    expect(headers).toEqual([]);
    expect(errors[0]).toMatch(/could not be read as nginx reads it: .*a block that never closes/);
  });
});

describe('an answer, held to it', () => {
  const stated = expectedAppHeaders(TEMPLATE, ISSUER).headers;
  const pairs = stated.map((h): [string, string] => [h.name.toLowerCase(), h.value]);

  it('passes each header once with its value, whatever the case of its name', () => {
    expect(headerFindings(stated, pairs)).toEqual([]);
    expect(headerFindings(stated, stated.map((h): [string, string] => [h.name.toUpperCase(), ` ${h.value} `]))).toEqual([]);
  });

  it('names each header that is missing, sent twice, or not the template\'s, and nothing that arrived', () => {
    const odd = "default-src 'self' https://odd.example";
    const received: Array<[string, string]> = [
      ...pairs.filter(([n]) => n !== 'strict-transport-security' && n !== 'x-frame-options'),
      ['content-security-policy', odd],
      ['x-frame-options', 'SAMEORIGIN'],
    ];
    const findings = headerFindings(stated, received);
    expect(findings).toEqual([
      'Content-Security-Policy: sent 2 times, where the template states it once',
      'Strict-Transport-Security: not sent',
      'X-Frame-Options: not the value the template states',
    ]);
    expect(findings.join('\n')).not.toContain(odd);
    expect(findings.join('\n')).not.toContain('SAMEORIGIN');
  });

  it("reads curl's -D output from its last block, without its status line", () => {
    const text = `HTTP/1.1 100 Continue\r\n\r\n${block([['strict-transport-security', 'max-age=1'], ['content-security-policy', "connect-src 'self' https://id.ownpace.eu"]], 'HTTP/1.1 200 OK')}`;
    expect(parseHeaderBlock(text)).toEqual([
      ['strict-transport-security', 'max-age=1'],
      ['content-security-policy', "connect-src 'self' https://id.ownpace.eu"],
    ]);
    expect(parseHeaderBlock('')).toEqual([]);
  });
});

describe('the command line deploy-live.sh runs', () => {
  const stated = expectedAppHeaders(TEMPLATE, ISSUER).headers.map((h): [string, string] => [h.name.toLowerCase(), h.value]);

  it('exits 0 and names what arrived as stated, 1 with a finding a line, 2 when it cannot say', () => {
    const dir = tempDir();
    try {
      const good = join(dir, 'good');
      writeFileSync(good, block(stated));
      const ok = cli([TEMPLATE_FILE, ISSUER, good]);
      expect(ok).toEqual({
        status: 0,
        out: 'Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, as the template states them\n',
      });

      const odd = 'max-age=1; preload';
      const bad = join(dir, 'bad');
      writeFileSync(bad, block(stated.map(([n, v]): [string, string] => [n, n === 'strict-transport-security' ? odd : v]).filter(([n]) => n !== 'referrer-policy')));
      const found = cli([TEMPLATE_FILE, ISSUER, bad]);
      expect(found.status).toBe(1);
      expect(found.out).toBe('Strict-Transport-Security: not the value the template states\nReferrer-Policy: not sent\n');
      expect(found.out).not.toContain(odd);

      // Another issuer than the image's: the policy is not the one stated.
      expect(cli([TEMPLATE_FILE, 'https://id.ota.ownpace.eu', good])).toEqual({
        status: 1,
        out: 'Content-Security-Policy: not the value the template states\n',
      });

      const bare = join(dir, 'bare.template');
      writeFileSync(bare, TEMPLATE.replace(/^\s*add_header Strict-Transport-Security .*\n/gm, ''));
      const refused = cli([bare, ISSUER, good]);
      expect(refused.status).toBe(2);
      expect(refused.out).toContain('states no Strict-Transport-Security');

      expect(cli([TEMPLATE_FILE, ISSUER, join(dir, 'missing')])).toEqual({ status: 2, out: 'could not read the answer (ENOENT)\n' });
      expect(cli([TEMPLATE_FILE, ISSUER]).status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs from a directory of its own beside nginx-config.mjs, as the deploy runs it for a tag cut before it', () => {
    const dir = tempDir();
    try {
      for (const f of ['app-headers.mjs', 'nginx-config.mjs']) copyFileSync(join(REPO_ROOT, 'scripts', f), join(dir, f));
      const answer = join(dir, 'answer');
      writeFileSync(answer, block(stated));
      const r = cli([TEMPLATE_FILE, ISSUER, answer], dir, join(dir, 'app-headers.mjs'));
      expect(r.status, r.out).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is what deploy-live.sh runs, with the tag\'s template and live\'s VITE_OIDC_ISSUER, at the origin in WEB_URL', () => {
    const script = readFileSync(join(REPO_ROOT, 'deploy', 'compose', 'deploy-live.sh'), 'utf8');
    expect(script).toContain('reader="${REPO_ROOT}/scripts/app-headers.mjs"');
    expect(script).toContain('out="$(node "$reader" "${REPO_ROOT}/apps/web/nginx.conf.template" "$issuer" "$hdr")" || rc=$?');
    expect(script).toContain('issuer="$(env_value "$ENV_FILE" VITE_OIDC_ISSUER)"');
    expect(script).toContain('app_headers_check "$app_origin" "$started_at"');
    expect(script).toContain('scripts/app-headers.mjs scripts/nginx-config.mjs | tar -x -C "$tmp"');
  });
});
