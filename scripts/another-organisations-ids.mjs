#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ANOTHER ORGANISATION'S IDS, ASKED AT EVERY DOOR (workplan 0178 T10, §6.3;
 * the owner's decision D7 (a) of 2026-11-26).
 *
 * Row security holds one organisation's rows away from another's at the
 * database. Nothing asked a RUNNING API whether its doors hold them apart
 * too, where a connection that is not under row security could open them
 * (the class `scripts/a-route-that-opened-the-owners-pool.unit.test.ts`
 * guards statically). This asks: with the demo seed's two organisations,
 * every operation of the description that takes an id is called with the
 * FIRST organisation's ids and the SECOND organisation's owner's token, and
 * must refuse.
 *
 * TWO WAYS TO NAME THE FIRST ORGANISATION, both asked (`VIA`):
 *   - `path`: its ids in the operation's path parameters, the second member's
 *     own organisation chosen as usual;
 *   - `header`: the same, and the organisation header (`x-ownpace-tenant`)
 *     naming the first organisation, which the second member is no member of.
 * The second is asked of every secured operation this can fill, ids or none.
 *
 * WHAT COUNTS (`classify`, `verdictOf`). 401, 403 and 404 are a refusal. A
 * 2xx or 3xx whose body carries one of the first organisation's ids or its
 * owner's address (`FIRST_IDS`'s values) is a LEAK, the fault this looks for:
 * a door that served the second member the first organisation's data. A 2xx
 * or 3xx without any of them is ANSWERED: no refusal, and nothing of the
 * first organisation's in it (measured on 2026-11-26, such doors answer with
 * the caller's own organisation, or with a list that is empty for them).
 * Anything else (400, 409, 422, 429, a 5xx) is OTHER: it refused nothing by
 * identity and served nothing either.
 *
 * WHICH IDS. Only those the seed makes for the first organisation, by the
 * parameter's name (`ID_PARAMS`), and a value from the parameter's own enum
 * where it has one. An operation with a path parameter this cannot fill is
 * not asked, and is counted as not asked with the parameter it lacked, so
 * the reach of the check is in its summary and never assumed.
 *
 * It runs inside the stack's namespace (`scripts/schemathesis-report.mjs`
 * starts it there), with the token in `OTHER_TOKEN` and the ids in
 * `FIRST_IDS`, and writes its reading as JSON on its output:
 *
 *   node scripts/another-organisations-ids.mjs <description> <port>
 *
 * Its guard is `scripts/a-scan-that-tried-the-running-api.unit.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/** The header that picks an organisation (`TENANT_HEADER` in apps/api/src/middleware/auth.ts). */
export const TENANT_HEADER = 'x-ownpace-tenant';

/** The two ways each operation is asked. */
export const VIA = ['path', 'header'];

/**
 * Which of the first organisation's ids fills a path parameter, by its name,
 * and for `{id}`, by the path it is in. Each value names a key of `FIRST_IDS`.
 */
export const ID_PARAMS = {
  tenantId: 'tenantId',
  mappingId: 'mappingId',
  memberId: 'memberId',
  personId: 'personId',
};
export const ID_BY_PREFIX = { '/api/connections/': 'connectionId' };

const METHODS = ['get', 'put', 'post', 'delete', 'patch'];

/** What an answer's status says: `refused`, `answered` (the fault), or `other`. */
export function classify(status) {
  if (status === 401 || status === 403 || status === 404) return 'refused';
  if (status >= 200 && status < 400) return 'answered';
  return 'other';
}

/** Whether an operation is secured: its own `security`, else the description's. */
function secured(doc, op) {
  const security = op.security ?? doc.security ?? [];
  return Array.isArray(security) && security.some((s) => s && Object.keys(s).length > 0);
}

/**
 * Every ask this description makes, and every operation not asked, with why.
 * `ids` is the first organisation's, by the keys `ID_PARAMS` names.
 */
export function asksFor(doc, ids) {
  const asks = [];
  const notAsked = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = item?.[method];
      if (!op) continue;
      const operation = `${method.toUpperCase()} ${path}`;
      if (!secured(doc, op)) continue;
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])].filter((p) => p?.in === 'path');
      const names = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      let url = path;
      let lacking = null;
      let takesAnId = false;
      for (const name of names) {
        const key = Object.hasOwn(ID_PARAMS, name)
          ? ID_PARAMS[name]
          : name === 'id'
            ? Object.entries(ID_BY_PREFIX).find(([prefix]) => path.startsWith(prefix))?.[1]
            : undefined;
        let value = key && typeof ids[key] === 'string' && ids[key] ? ids[key] : null;
        if (value) takesAnId = true;
        if (!value) {
          const schema = params.find((p) => p.name === name)?.schema;
          if (Array.isArray(schema?.enum) && schema.enum.length) value = String(schema.enum[0]);
        }
        if (!value) {
          lacking = name;
          break;
        }
        url = url.replace(`{${name}}`, encodeURIComponent(value));
      }
      if (lacking) {
        notAsked.push({ operation, why: `no id of the first organisation for {${lacking}}` });
        continue;
      }
      const body = ['post', 'put', 'patch'].includes(method) ? '{}' : null;
      if (takesAnId) asks.push({ operation, via: 'path', method: method.toUpperCase(), url, body });
      asks.push({ operation, via: 'header', method: method.toUpperCase(), url, body });
    }
  }
  return { asks, notAsked };
}

/**
 * What one ask came to: `refused`, `leak`, `answered` or `other`. `carries`
 * says whether the answer's body held a value of the first organisation's.
 */
export function verdictOf({ status, carries }) {
  const c = classify(status);
  if (c === 'answered') return carries ? 'leak' : 'answered';
  return c;
}

/**
 * Asks each in turn with the second member's token: each answer's status and
 * whether its body carried any of `markers`, or why there was no answer.
 */
export async function askAll(asks, { base, token, tenant, markers = [], fetchImpl = fetch }) {
  const asked = [];
  for (const a of asks) {
    const headers = { authorization: `Bearer ${token}` };
    if (a.via === 'header') headers[TENANT_HEADER] = tenant;
    if (a.body !== null) headers['content-type'] = 'application/json';
    try {
      const res = await fetchImpl(`${base}${a.url}`, { method: a.method, headers, body: a.body ?? undefined, redirect: 'manual' });
      const text = await res.text().catch(() => '');
      const carries = markers.some((m) => m && text.toLowerCase().includes(String(m).toLowerCase()));
      asked.push({ operation: a.operation, via: a.via, status: res.status, carries });
    } catch (e) {
      asked.push({ operation: a.operation, via: a.via, status: 0, carries: false, error: String(e instanceof Error ? e.message : e).slice(0, 200) });
    }
  }
  return asked;
}

async function main() {
  const [description, port] = process.argv.slice(2);
  const token = process.env.OTHER_TOKEN ?? '';
  const ids = JSON.parse(process.env.FIRST_IDS ?? '{}');
  if (!description || !port || !token || typeof ids.tenantId !== 'string') {
    throw new Error('usage: OTHER_TOKEN=… FIRST_IDS={"tenantId":…} another-organisations-ids.mjs <description> <port>');
  }
  const doc = parseYaml(readFileSync(description, 'utf8'));
  const { asks, notAsked } = asksFor(doc, ids);
  const markers = Object.values(ids).filter((v) => typeof v === 'string' && v.length >= 8);
  const asked = await askAll(asks, { base: `http://127.0.0.1:${port}`, token, tenant: ids.tenantId, markers });
  process.stdout.write(`${JSON.stringify({ asked, notAsked })}\n`);
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`another-organisations-ids stopped: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
