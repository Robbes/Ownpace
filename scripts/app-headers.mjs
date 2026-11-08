#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A BROWSER GETS FROM THE APP, READ WHERE THE BROWSER READS IT (workplan
 * 0158 T4).
 *
 * The app's nginx (`apps/web/nginx.conf.template`) states a policy and four
 * headers on every page (0158 T1). Its guard reads the template, the UI suite
 * runs the built app under them, and the smoke asks the image for them over
 * plain http on loopback, on the OTA stack. Nothing read them where a tester's
 * browser gets them: at live's https address, through the front that ends TLS
 * (NetBird's proxy). So nothing proved that the front passes them on, or that
 * HSTS arrives over TLS, where a browser takes it.
 *
 * This says what the app's page must carry, from the template alone, and
 * whether an answer carries exactly that. Nothing here holds a value of its
 * own: the template is the one source, read as the nginx image renders it
 * (`envsubst` with the issuer, then `headersFor` of `nginx-config.mjs`, which
 * applies nginx's rule of inheritance).
 *
 * - `expectedAppHeaders(template, issuer)`: the `add_header` lines nginx
 *   applies to `/`. Refused when they hold no Content-Security-Policy or no
 *   Strict-Transport-Security: a template that states neither would let any
 *   answer pass.
 * - `headerFindings(expected, received)`: each expected header exactly once,
 *   with the template's value; the name's case aside, as HTTP has it. A
 *   finding names the header, never the value that arrived, so it can go into
 *   a public log.
 * - `parseHeaderBlock(text)`: the header lines of curl's `-D` output, the last
 *   block when there are several.
 *
 * Two callers, each through the front:
 *
 * - `deploy-live.sh`, after each deploy, from the machine, at the origin in
 *   `WEB_URL`, against the tag's template and live's `VITE_OIDC_ISSUER`:
 *
 *       node scripts/app-headers.mjs <template> <issuer> <curl -D file>
 *
 *   exit 0 with one line naming what arrived as stated, 1 with one finding a
 *   line, 2 when the template or the file cannot be read.
 * - `exposure-probe.mjs`, from a GitHub-hosted runner, at
 *   `https://app.ownpace.eu/`, against the template at the commit live's own
 *   `/version.json` names.
 *
 * `scripts/the-headers-nobody-read-through-the-front.unit.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envsubst, headersFor, parseNginx } from './nginx-config.mjs';

/** The app's nginx template, from the repository root. */
export const APP_TEMPLATE = 'apps/web/nginx.conf.template';

/** The two a template must state for the app's page, or nothing is checked. */
export const REQUIRED_HEADERS = ['Content-Security-Policy', 'Strict-Transport-Security'];

/**
 * The headers nginx adds to the app's page, `/`, as the image renders the
 * template with `issuer` as `VITE_OIDC_ISSUER`. `API_UPSTREAM`, the image's
 * other variable, is named only so the rendering is the image's; no header
 * reads it.
 */
export function expectedAppHeaders(template, issuer) {
  let sent;
  try {
    const top = parseNginx(envsubst(template, { VITE_OIDC_ISSUER: issuer, API_UPSTREAM: 'api:3001' }), APP_TEMPLATE);
    sent = headersFor(top, '/');
  } catch (e) {
    return { headers: [], errors: [`${APP_TEMPLATE} could not be read as nginx reads it: ${e?.message ?? e}`] };
  }
  const headers = (sent ?? []).map(({ name, value }) => ({ name, value }));
  const errors = REQUIRED_HEADERS.filter((want) => !headers.some((h) => h.name.toLowerCase() === want.toLowerCase())).map(
    (want) => `${APP_TEMPLATE} states no ${want} for the app's page, so an answer without one would pass`,
  );
  return { headers, errors };
}

/**
 * What differs between the headers the template states and those that
 * arrived (`[name, value]` pairs, in order, a repeated header twice). Empty
 * when each expected header arrived exactly once with the template's value.
 */
export function headerFindings(expected, received) {
  const findings = [];
  for (const { name, value } of expected) {
    const got = received.filter(([n]) => n.toLowerCase() === name.toLowerCase()).map(([, v]) => v.trim());
    if (got.length === 0) findings.push(`${name}: not sent`);
    else if (got.length > 1) findings.push(`${name}: sent ${got.length} times, where the template states it once`);
    else if (got[0] !== value) findings.push(`${name}: not the value the template states`);
  }
  return findings;
}

/**
 * The header lines of curl's `-D` output as `[name, value]` pairs: the last
 * block (curl writes one per response it read, a `100 Continue` included),
 * without its status line.
 */
export function parseHeaderBlock(text) {
  const blocks = text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .filter((b) => /^HTTP\//.test(b.trimStart()));
  const last = blocks.at(-1) ?? '';
  return last
    .trimStart()
    .split('\n')
    .slice(1)
    .map((line) => {
      const colon = line.indexOf(':');
      return colon > 0 ? [line.slice(0, colon).trim(), line.slice(colon + 1).trim()] : undefined;
    })
    .filter((pair) => pair !== undefined);
}

function main(argv) {
  const [templateFile, issuer, headersFile] = argv;
  if (templateFile === undefined || issuer === undefined || headersFile === undefined) {
    console.log('usage: node scripts/app-headers.mjs <template> <issuer> <curl -D file>');
    return 2;
  }
  let template;
  let block;
  try {
    template = readFileSync(templateFile, 'utf8');
    block = readFileSync(headersFile, 'utf8');
  } catch (e) {
    console.log(`could not read ${e?.path === headersFile ? 'the answer' : APP_TEMPLATE} (${e?.code ?? 'error'})`);
    return 2;
  }
  const { headers, errors } = expectedAppHeaders(template, issuer);
  if (errors.length) {
    for (const e of errors) console.log(e);
    return 2;
  }
  const findings = headerFindings(headers, parseHeaderBlock(block));
  if (findings.length) {
    for (const f of findings) console.log(f);
    return 1;
  }
  console.log(`${headers.map((h) => h.name).join(', ')}, as the template states them`);
  return 0;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
