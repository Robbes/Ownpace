// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAKE APPLIANCE AND A FAKE NEXTCLOUD, for the owner-flows gate's own logic
 * (workplan 0179 T6). `owner-flows-lib.unit.test.ts` runs the gate's flows
 * against this, as T2 to T4 ran the managed smoke's sections against a fake
 * API (`scripts/a-door-and-a-grant-the-gate-walks.unit.test.ts`): the shapes
 * the routes answer, and a pass that copies, fails, parks, correlates a move
 * and honours a stop or an ending, as the product's own rules say. It is not
 * the product. The dispatched E2E is the run on the real stack.
 *
 * Each `Mutation` breaks one route or one rule for a moment, so the unit test
 * can show the gate red for that reason.
 */

import { createHash } from 'node:crypto';

export type Mutation =
  | 'retry-leaves-it-parked'
  | 'a-parked-item-is-retried-anyway'
  | 'apply-move-keeps-the-old-copy'
  | 'stop-is-ignored'
  | 'resume-is-ignored'
  | 'an-ended-type-still-copies'
  | 'a-kept-type-stops'
  | 'a-share-applied-twice'
  | 'sharing-applies-before-cutover'
  | 'people-takes-a-person';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const fileKey = (path: string) => sha(`file:${path}`);

interface Row {
  path: string;
  status: 'copied' | 'failed' | 'tombstoned';
  attempts: number;
  parked: boolean;
  content?: string;
  error?: string;
  movedTo?: { path: string; key: string };
  moveApplied?: boolean;
}

interface FakeMapping {
  readonly id: string;
  readonly folder: string;
  readonly calendar: boolean;
  readonly mailbox: boolean;
  started: boolean;
  phase: Record<string, string>;
  stopped: Record<string, boolean>;
  rows: Map<string, Row>;
  calendarCopied: Set<string>;
  lastSynced: Record<string, string>;
  grants: Array<{ id: string; onLabel: string; grantee: string; state: string; verdict: 'clean' }>;
}

export interface FakeWorld {
  readonly fetch: typeof fetch;
  /** Every request the gate made, `METHOD url`, in order. */
  readonly calls: string[];
  /** Shares on the target, as Nextcloud would list them. */
  targetShares(): Array<{ id: number; path: string; share_with: string }>;
}

export function fakeWorld(options: {
  baseUrl: string;
  nextcloudUrl: string;
  sourceUser: string;
  targetUser: string;
  mappings: ReadonlyArray<{ id: string; folder: string; calendar?: boolean; mailbox?: boolean }>;
  mutation?: Mutation;
}): FakeWorld {
  const { baseUrl, nextcloudUrl, sourceUser, targetUser, mutation } = options;
  const calls: string[] = [];
  /** Each account's files: path -> bytes, or a directory. */
  const files: Record<string, Map<string, string | { dir: true }>> = {
    [sourceUser]: new Map(),
    [targetUser]: new Map(),
  };
  /** Each account's calendar objects: `<calendar>/<name>` -> ics. */
  const calendars: Record<string, Map<string, string>> = { [sourceUser]: new Map(), [targetUser]: new Map() };
  const shares: Record<string, Array<{ id: number; path: string; share_with: string; share_type: number }>> = {
    [sourceUser]: [],
    [targetUser]: [],
  };
  let shareIds = 100;
  let clock = Date.UTC(2026, 10, 28, 12, 0, 0);
  const tick = () => new Date((clock += 1000)).toISOString();

  const mappings = new Map<string, FakeMapping>(
    options.mappings.map((m) => [
      m.id,
      {
        id: m.id,
        folder: m.folder,
        calendar: m.calendar ?? false,
        mailbox: m.mailbox ?? false,
        started: false,
        phase: { file: 'active', ...(m.calendar ? { calendar: 'active' } : {}) },
        stopped: {},
        rows: new Map(),
        calendarCopied: new Set(),
        lastSynced: {},
        grants: [],
      },
    ]),
  );

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function copies(m: FakeMapping, domain: string): boolean {
    if (m.stopped[domain] && mutation !== 'stop-is-ignored') return false;
    if (m.phase[domain] === 'done' && mutation !== 'an-ended-type-still-copies') return false;
    if (m.phase[domain] === 'continuous' && mutation === 'a-kept-type-stops') return false;
    return true;
  }

  function pass(m: FakeMapping): void {
    if (!m.started) return;
    const src = files[sourceUser]!;
    const dst = files[targetUser]!;
    const prefix = `${m.folder}/`;
    if (copies(m, 'file')) {
      const listed = new Map<string, string>();
      for (const [p, v] of src) if (p.startsWith(prefix) && typeof v === 'string') listed.set(p.slice(prefix.length), v);
      const arrivals: Array<{ path: string; content: string }> = [];
      for (const [rel, content] of listed) {
        const key = fileKey(rel);
        const row = m.rows.get(key);
        if (row?.status === 'copied' && row.content === content) continue;
        if (row?.status === 'failed' && row.parked && mutation !== 'a-parked-item-is-retried-anyway') continue;
        if (typeof dst.get(prefix + rel) === 'object') {
          const attempts = (row?.attempts ?? 0) + 1;
          m.rows.set(key, {
            path: rel,
            status: 'failed',
            attempts,
            parked: attempts >= 5,
            error: `PUT ${rel}: 405 a folder is in the way`,
          });
          continue;
        }
        dst.set(prefix + rel, content);
        if (!row) arrivals.push({ path: rel, content });
        m.rows.set(key, { path: rel, status: 'copied', attempts: 0, parked: false, content });
      }
      for (const row of m.rows.values()) {
        if (row.status !== 'copied' || listed.has(row.path) || row.movedTo) continue;
        const at = arrivals.findIndex((a) => a.content === row.content);
        if (at < 0) continue;
        const [arrival] = arrivals.splice(at, 1);
        row.movedTo = { path: arrival!.path, key: fileKey(arrival!.path) };
      }
      m.lastSynced.file = tick();
    }
    if (m.calendar && copies(m, 'calendar')) {
      for (const [name, ics] of calendars[sourceUser]!) {
        calendars[targetUser]!.set(name, ics);
        m.calendarCopied.add(name);
      }
      m.lastSynced.calendar = tick();
    }
  }

  /** The migration's roll-up, roughly as the ledger's: draft before Start, done once every type is. */
  function statusOf(m: FakeMapping): string {
    if (!m.started) return 'draft';
    const phases = Object.values(m.phase);
    if (phases.every((p) => p === 'done')) return 'done';
    if (phases.includes('continuous')) return 'continuous';
    return 'active';
  }

  function appliance(method: string, path: string, body: Record<string, unknown>): Response {
    if (method === 'GET' && path === '/status') {
      return json(200, {
        status: 'ok',
        mappings: [...mappings.values()].map((m) => ({
          mappingId: m.id,
          migrationStatus: statusOf(m),
          ...(m.started
            ? { endings: Object.entries(m.phase).map(([domain, phase]) => ({ domain, phase, stopped: Boolean(m.stopped[domain]), offers: [] })) }
            : {}),
          domains: Object.keys(m.phase).map((d) => ({
            domain: d,
            state: 'completed',
            itemsSynced: [...m.rows.values()].filter((r) => r.status === 'copied').length,
            itemsFailed: [...m.rows.values()].filter((r) => r.status === 'failed').length,
            ...(m.lastSynced[d] ? { lastSyncedAt: m.lastSynced[d] } : {}),
          })),
        })),
      });
    }
    if (method === 'GET' && path === '/failures') {
      const out: Record<string, unknown> = {};
      for (const m of mappings.values()) {
        const failed = [...m.rows.entries()].filter(([, r]) => r.status === 'failed');
        const entry = ([key, r]: [string, Row]) => ({
          domain: 'file',
          naturalKeyHash: key,
          attempts: r.attempts,
          lastError: r.error,
          needsDecision: r.parked,
          displayName: r.path,
        });
        out[m.id] = {
          needsDecision: failed.filter(([, r]) => r.parked).map(entry),
          retrying: failed.filter(([, r]) => !r.parked).map(entry),
        };
      }
      return json(200, out);
    }
    if (method === 'GET' && path === '/moves') {
      const out: Record<string, unknown> = {};
      for (const m of mappings.values()) {
        const open = [...m.rows.entries()]
          .filter(([, r]) => r.movedTo && !r.moveApplied)
          .map(([key, r]) => ({ domain: 'file', naturalKeyHash: key, from: '', to: '', toNaturalKeyHash: r.movedTo!.key }));
        out[m.id] = { open, acknowledged: [] };
      }
      return json(200, out);
    }
    if (method === 'GET' && path === '/people') {
      return json(200, {
        people: [
          {
            id: 'implicit',
            implicit: true,
            migrations: [...mappings.values()].map((m) => ({ id: m.id, status: statusOf(m) })),
          },
        ],
        unassigned: [],
      });
    }
    if (method === 'POST' && (path === '/people' || /^\/people\/[^/]+\/migrations$/.test(path))) {
      if (mutation === 'people-takes-a-person') return json(201, { id: 'someone' });
      return json(409, { error: 'one_person_here', message: 'This appliance moves one person.' });
    }
    const hit = /^\/mappings\/([^/]+)\/(.+)$/.exec(path);
    const m = hit ? mappings.get(decodeURIComponent(hit[1]!)) : undefined;
    if (!hit || !m) return json(404, { error: 'unknown mapping' });
    const rest = hit[2]!;
    if (method === 'POST' && rest === 'start') {
      const activated = !m.started;
      m.started = true;
      return json(200, { activated });
    }
    if (method === 'POST' && rest === 'run') {
      pass(m);
      return json(200, { status: 'ok' });
    }
    let r: RegExpExecArray | null;
    if (method === 'POST' && (r = /^failures\/([^/]+)\/retry$/.exec(rest))) {
      const row = m.rows.get(r[1]!);
      if (!row || row.status !== 'failed') return json(404, { error: 'no unresolved failure under that natural key' });
      if (mutation !== 'retry-leaves-it-parked') {
        row.parked = false;
        row.attempts = 0;
      }
      return json(200, { status: 'ok', action: 'retry', naturalKeyHash: r[1] });
    }
    if (method === 'POST' && (r = /^moves\/([^/]+)\/apply$/.exec(rest))) {
      const row = m.rows.get(r[1]!);
      if (!row) return json(404, { error: 'not_found' });
      if (row.moveApplied) return json(404, { error: 'already_applied' });
      if (!row.movedTo) return json(404, { error: 'not_relocated' });
      if (mutation !== 'apply-move-keeps-the-old-copy') files[targetUser]!.delete(`${m.folder}/${row.path}`);
      row.moveApplied = true;
      row.status = 'tombstoned';
      return json(200, { status: 'ok', action: 'apply', naturalKeyHash: r[1], kind: 'binned' });
    }
    if (method === 'POST' && (r = /^domains\/([^/]+)\/(stop|resume|end|keep)$/.exec(rest))) {
      const domain = r[1]!;
      const action = r[2]!;
      if (!(domain in m.phase)) return json(409, { error: `${action}_refused`, refused: 'not_a_path' });
      if (!m.started) return json(409, { error: `${action}_refused`, refused: 'not_running' });
      if (action === 'stop' || action === 'resume') {
        const stop = action === 'stop';
        // The door's two refusals (`decidePathStop`): an ended type neither
        // stops nor resumes, and the last type copying is not stopped.
        if (m.phase[domain] === 'done') return json(409, { error: `${action}_refused`, refused: 'not_stoppable' });
        if (stop && !m.stopped[domain]) {
          const others = Object.keys(m.phase).filter((d) => d !== domain && m.phase[d] !== 'done' && !m.stopped[d]);
          if (others.length === 0) return json(409, { error: 'stop_refused', refused: 'last_one_copying' });
        }
        const changed = Boolean(m.stopped[domain]) !== stop;
        if (!(action === 'resume' && mutation === 'resume-is-ignored')) m.stopped[domain] = stop;
        return json(200, { id: m.id, domain, stopped: stop, changed });
      }
      const to = action === 'end' ? 'done' : 'continuous';
      if (action === 'keep' && m.stopped[domain]) return json(409, { error: 'keep_refused', refused: 'stopped' });
      const from = m.phase[domain]!;
      if (from === to) return json(200, { id: m.id, domain, ending: action, changed: false, phase: to });
      m.phase[domain] = to;
      if (action === 'end') m.stopped[domain] = false;
      return json(200, { id: m.id, domain, ending: action, changed: true, from, to, slotsTaken: false });
    }
    if (method === 'POST' && rest === 'sharing/rescan') {
      if (!m.mailbox) return json(409, { error: 'address_unstated' });
      for (const s of shares[sourceUser]!) {
        const on = s.path.replace(/^\//, '');
        if (m.grants.some((g) => g.onLabel === on && g.grantee === s.share_with)) continue;
        m.grants.push({ id: `g${m.grants.length + 1}`, onLabel: on, grantee: s.share_with, state: 'open', verdict: 'clean' });
      }
      return json(200, { open: m.grants.filter((g) => g.state === 'open').length, blindSpots: [] });
    }
    if (method === 'GET' && rest === 'sharing') {
      return json(200, { migrationStatus: 'active', grants: m.grants });
    }
    const pastCutover = () => ['cutover', 'done', 'continuous'].includes(m.phase.file!) || mutation === 'sharing-applies-before-cutover';
    const share = (g: { onLabel: string }, grantee: string) => {
      shares[targetUser]!.push({ id: shareIds++, path: `/${g.onLabel}`, share_with: grantee, share_type: 0 });
    };
    if (method === 'POST' && (r = /^sharing\/([^/]+)\/decision$/.exec(rest))) {
      const g = m.grants.find((x) => x.id === r![1]);
      if (!g) return json(404, { error: 'not_found' });
      if (g.state !== 'open') return json(409, { error: 'already_settled' });
      if (body.action !== 'apply') return json(400, { error: 'unknown action' });
      if (!pastCutover()) return json(409, { error: 'not_cut_over', reason: 'Not cut over yet.' });
      share(g, typeof body.grantee === 'string' ? body.grantee : g.grantee);
      g.state = 'applied';
      return json(200, { status: 'ok', grant: g });
    }
    if (method === 'POST' && rest === 'sharing/apply-all') {
      const applied = [];
      for (const g of m.grants) {
        if (g.state === 'open' || (mutation === 'a-share-applied-twice' && g.state === 'applied')) {
          share(g, 'e2e-source');
          g.state = 'applied';
          applied.push(g);
        }
      }
      return json(200, { status: 'ok', applied, refused: [] });
    }
    return json(404, { error: `the fake has no ${method} ${path}` });
  }

  function nextcloud(method: string, url: URL, headers: Headers, body: string): Response {
    const user = (headers.get('authorization') ?? '').startsWith('Basic ')
      ? Buffer.from(headers.get('authorization')!.slice(6), 'base64').toString().split(':')[0]!
      : '';
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/ocs/v2.php/apps/files_sharing/api/v1/shares')) {
      const mine = shares[user]!;
      const id = /\/shares\/(\d+)$/.exec(p);
      if (method === 'DELETE' && id) {
        const at = mine.findIndex((s) => s.id === Number(id[1]));
        if (at >= 0) mine.splice(at, 1);
        return json(200, { ocs: { meta: { statuscode: 200 }, data: [] } });
      }
      if (method === 'POST') {
        const form = new URLSearchParams(body);
        const s = { id: shareIds++, path: form.get('path')!, share_with: form.get('shareWith')!, share_type: 0 };
        mine.push(s);
        return json(200, { ocs: { meta: { statuscode: 200 }, data: s } });
      }
      const path = url.searchParams.get('path');
      return json(200, { ocs: { meta: { statuscode: 200 }, data: mine.filter((s) => !path || s.path === path) } });
    }
    let r: RegExpExecArray | null;
    if ((r = /^\/remote\.php\/dav\/files\/([^/]+)\/(.*)$/.exec(p))) {
      const tree = files[r[1]!]!;
      const path = r[2]!.replace(/\/$/, '');
      const at = tree.get(path);
      if (method === 'PUT') {
        tree.set(path, body);
        return new Response(null, { status: 201 });
      }
      if (method === 'MKCOL') {
        if (at !== undefined) return new Response(null, { status: 405 });
        tree.set(path, { dir: true });
        return new Response(null, { status: 201 });
      }
      if (method === 'DELETE') {
        if (at === undefined) return new Response(null, { status: 404 });
        for (const k of [...tree.keys()]) if (k === path || k.startsWith(`${path}/`)) tree.delete(k);
        return new Response(null, { status: 204 });
      }
      if (method === 'MOVE') {
        if (typeof at !== 'string') return new Response(null, { status: 404 });
        const dest = decodeURIComponent(new URL(headers.get('destination')!).pathname).replace(/^\/remote\.php\/dav\/files\/[^/]+\//, '');
        tree.delete(path);
        tree.set(dest, at);
        return new Response(null, { status: 201 });
      }
      if (at === undefined) return new Response(null, { status: 404 });
      if (method === 'GET') return typeof at === 'string' ? new Response(at, { status: 200 }) : new Response(null, { status: 405 });
      if (method === 'PROPFIND') {
        const kind = typeof at === 'string' ? '' : '<d:resourcetype><d:collection/></d:resourcetype>';
        return new Response(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${url.pathname}</d:href>${kind}</d:response></d:multistatus>`, { status: 207 });
      }
    }
    if ((r = /^\/remote\.php\/dav\/calendars\/([^/]+)\/?(.*)$/.exec(p))) {
      const objects = calendars[r[1]!]!;
      const rest = r[2]!.replace(/\/$/, '');
      const home = `/remote.php/dav/calendars/${r[1]}/`;
      if (method === 'PUT') {
        objects.set(rest, body);
        return new Response(null, { status: 201 });
      }
      if (method === 'DELETE') return new Response(null, { status: objects.delete(rest) ? 204 : 404 });
      if (method === 'GET') {
        const ics = objects.get(rest);
        return ics === undefined ? new Response(null, { status: 404 }) : new Response(ics, { status: 200 });
      }
      if (method === 'PROPFIND') {
        const hrefs =
          rest === ''
            ? [home, `${home}personal/`]
            : [`${home}${rest}/`, ...[...objects.keys()].filter((k) => k.startsWith(`${rest}/`)).map((k) => `${home}${k}`)];
        return new Response(
          `<d:multistatus xmlns:d="DAV:">${hrefs.map((h) => `<d:response><d:href>${h}</d:href></d:response>`).join('')}</d:multistatus>`,
          { status: 207 },
        );
      }
    }
    return new Response(`the fake has no ${method} ${p}`, { status: 501 });
  }

  const parseBody = (body: string): Record<string, unknown> => {
    try {
      return body ? (JSON.parse(body) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url.href}`);
    const body = typeof init?.body === 'string' ? init.body : '';
    if (url.href.startsWith(baseUrl)) {
      return appliance(method, url.pathname + url.search, parseBody(body));
    }
    if (url.href.startsWith(nextcloudUrl)) return nextcloud(method, url, new Headers(init?.headers), body);
    return new Response('nowhere', { status: 502 });
  }) as typeof fetch;

  return {
    fetch: fakeFetch,
    calls,
    targetShares: () => shares[targetUser]!.map(({ id, path, share_with }) => ({ id, path, share_with })),
  };
}
