// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANT LINK'S PASSWORDS, TYPED AGAINST STALWART (workplan 0174 §11, T8).
 *
 * The unit suites record the servers (`a-password-typed-on-a-link`,
 * `a-password-the-link-never-says`), and `a-password-tested-against-stalwart`
 * asks Stalwart whether the TEST tells a right password from a wrong one.
 * This file runs the whole route, `PUT /api/grant/:link/password` and the GET
 * before it, as the managed API mounts them, on the integration tier's real
 * Postgres read as `app_user`, against the Stalwart fixture
 * (`docs/stalwart-integration-fix.md` as written: no accounts in
 * `config.json`; the accounts the harness provisions):
 *
 * - an IMAP SOURCE, a JMAP DESTINATION and an IMAP DESTINATION, saved for a
 *   person as the doors save them (0174 §8.2): per card a wrong password is
 *   refused by Stalwart, nothing is stored and one try is counted; the right
 *   one is stored (a source's on its migrations, a destination's on its
 *   connection with the person named); then the link is spent and both
 *   migrations have a way in on both sides (`hasAWayInOnBothSides`, as Start
 *   judges it: ready to start);
 * - five wrong passwords lock the source's card, and the sixth, the right
 *   one, answers `locked` with no login made, counted at the probe; a new
 *   link starts at zero;
 * - D3's warning (§12) on the GET, for a match and a mismatch;
 * - every password typed, right or wrong, in no response, log line,
 *   `audit_log` row, try row or other row, and each stored one decrypted
 *   exactly once.
 *
 * The CalDAV source and the `nextcloud` destination are in
 * `a-grant-link-against-nextcloud`, because the leg that runs every Nextcloud
 * suite against a second major starts no Stalwart.
 *
 * WHAT IS RECORDED. D3 reads the address's MX hosts through public
 * DNS-over-HTTPS resolvers (`verifyMX`): a test that hung on public DNS would
 * fail for a reason that is not ours, so `verifyMX` answers from a table here,
 * and everything else (the GET, the comparison, the hosts) is the real code.
 * The probe is the real one, wrapped only to count logins.
 *
 * RUNNING IT. Under `pnpm test:integration` the global setup starts Stalwart.
 * With only a database (`./scripts/local-pg.sh up`), the D3 cases run and the
 * Stalwart cases say NOT RUN and run nothing.
 *
 * Every password here is the harness's own placeholder, read from its
 * environment where it sets one, or a sentinel made for this file.
 *
 * UUID family: 0174a800-e29b-41d4-a716-4466554400xx
 */

process.env.SECRET_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.GRANT_PASSWORD_TESTS_PER_HOUR = '1000';
process.env.WEB_URL ??= 'https://app.example';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { isIP } from 'node:net';
import { Pool } from 'pg';
import { withTenant } from '@openmig/ledger';
import {
  card,
  captureOutput,
  clean,
  grantApp,
  mint,
  noPasswordAnywhere,
  person,
  reset,
  secretOf,
  setUp,
  sourceSecretOf,
  triesOf,
  type Organisation,
} from '../__tests__/grant-link-real-servers-fixture.ts';

/** The superuser pool for the rows, and `app_user` for the route, as the managed API reads. */
function databaseFor(): { readonly owner: Pool } {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
  const app = new URL(url);
  app.username = 'app_user';
  app.password = 'app_password';
  process.env.APP_DATABASE_URL = app.toString();
  return { owner: new Pool({ connectionString: url, max: 4 }) };
}

/** Logins the real probe was asked for: the sixth try must not be one. */
const logins = { source: 0, target: 0 };
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  return {
    ...actual,
    probeSourceConnection: (...args: Parameters<typeof actual.probeSourceConnection>) => {
      logins.source += 1;
      return actual.probeSourceConnection(...args);
    },
    probeTargetConnection: (...args: Parameters<typeof actual.probeTargetConnection>) => {
      logins.target += 1;
      return actual.probeTargetConnection(...args);
    },
  };
});

/** D3's MX answers, by domain: recorded, never public DNS (see the header). */
const MX: Record<string, string[]> = {};
vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/core')>();
  return {
    ...actual,
    verifyMX: async (domain: string) => ({
      resolverResults: MX[domain] ? { Recorded: { resolver: 'Recorded', success: true, records: MX[domain] } } : {},
    }),
  };
});

const { owner } = databaseFor();
const app = await grantApp();
const { hasAWayInOnBothSides } = await import('./migrations/withdrawal-hold.ts');
const anna = person(app);
const output = captureOutput();

const U = (n: string) => `0174a800-e29b-41d4-a716-4466554400${n}`;
const TENANT = U('01');
const ANNA = U('41');
const BRAM = U('42');
const C = { imapSource: U('11'), bramsSource: U('13'), jmapTarget: U('21'), imapTarget: U('22'), ownersTarget: U('24') } as const;
const M = { imapToJmap: U('31'), imapToImap: U('32'), bramsToOwners: U('34') } as const;

const STALWART_HOST = process.env.STALWART_IMAP_HOST;
const IMAP_PORT = Number.parseInt(process.env.STALWART_IMAP_PORT ?? '993', 10);
const JMAP_URL = process.env.STALWART_JMAP_URL?.replace(/\/+$/, '');

/** The harness's accounts and their placeholder passwords (`testcontainers-setup.ts`). */
const SOURCE_USER = 'source@dev.local';
const SOURCE_PASSWORD = 'source_password';
const TARGET_USER = process.env.STALWART_JMAP_USERNAME ?? 'target@dev.local';
const TARGET_PASSWORD = process.env.STALWART_JMAP_PASSWORD ?? 'target_password';

/** Wrong passwords, each a sentinel nothing else in the run could contain. */
const WRONG = {
  imapSource: 'SENTINEL-t8-wrong-imap-source',
  jmapTarget: 'SENTINEL-t8-wrong-jmap-target',
  imapTarget: 'SENTINEL-t8-wrong-imap-target',
  lock: 'SENTINEL-t8-wrong-for-the-lock',
} as const;

/**
 * A host a password may be sent to: a name, never a number (§5.8, D3 (a)).
 * Testcontainers names the Docker host `localhost` on a runner; where it
 * names the loopback address instead, that is the same machine by name.
 */
function byName(host: string | undefined): string {
  if (!host) return 'stalwart.example.invalid';
  if (host === '127.0.0.1' || host === '::1') return 'localhost';
  if (isIP(host) !== 0) {
    throw new Error(
      `The harness reaches its containers at ${host}, an address. A grant link never sends a password to an ` +
        'address (server_not_a_name), so this file cannot run against it: point Testcontainers at a host name.',
    );
  }
  return host;
}
const MAIL_HOST = byName(STALWART_HOST);

/**
 * The configs in the shapes `sourceConnectionConfig` and
 * `targetConnectionConfig` build, except that the JMAP rows carry only the
 * `baseUrl` and user they connect with: the card names a JMAP row's server
 * from its `baseUrl` too, which `every-password-kind-has-a-link` pins beside
 * the create door's full shape. Both Stalwart mail rows opt out of
 * verifying its self-signed certificate in writing, as the demo seed's rows
 * do (`seed-managed.ts`).
 */
const imapSourceConfig = (user: string) => ({
  type: 'imap-oauth2', host: MAIL_HOST, port: IMAP_PORT, user, tls: true, useSsl: true, tlsVerify: false,
});
const ORG: Organisation = {
  tenant: TENANT,
  accounts: [
    { id: C.imapSource, role: 'source', kind: 'imap', config: imapSourceConfig(SOURCE_USER), creds: { username: SOURCE_USER }, address: SOURCE_USER },
    {
      id: C.bramsSource, role: 'source', kind: 'imap', config: imapSourceConfig('bram@elsewhere.example'),
      creds: { username: 'bram@elsewhere.example' }, address: 'bram@elsewhere.example',
    },
    {
      id: C.jmapTarget, role: 'target', kind: 'jmap',
      config: { type: 'jmap', baseUrl: JMAP_URL ?? 'https://jmap.example.invalid', user: TARGET_USER },
      creds: { username: TARGET_USER }, address: TARGET_USER,
    },
    {
      id: C.imapTarget, role: 'target', kind: 'imap',
      config: { type: 'imap-dav', host: MAIL_HOST, port: IMAP_PORT, user: TARGET_USER, tls: true, useSsl: true, tlsVerify: false },
      creds: { username: TARGET_USER }, address: TARGET_USER,
    },
    {
      id: C.ownersTarget, role: 'target', kind: 'jmap', connected: true,
      config: { type: 'jmap', baseUrl: 'https://jmap.example.invalid', user: 'owner@example.invalid' },
      creds: { username: 'owner@example.invalid', password: 'fixture-not-a-password' }, address: 'owner@example.invalid',
    },
  ],
  people: [[ANNA, 'Anna'], [BRAM, 'Bram']],
  migrations: [
    [M.imapToJmap, C.imapSource, C.jmapTarget, ['email'], ANNA],
    [M.imapToImap, C.imapSource, C.imapTarget, ['email'], ANNA],
    [M.bramsToOwners, C.bramsSource, C.ownersTarget, ['email'], BRAM],
  ],
};

const ready = (m: string) => withTenant(owner, TENANT, (db) => hasAWayInOnBothSides(db, TENANT, m));

beforeAll(async () => {
  await clean(owner, TENANT);
  await setUp(owner, ORG);
}, 60_000);

afterAll(async () => {
  await clean(owner, TENANT);
  await owner.end();
});

beforeEach(() => output.arm());
afterEach(() => output.disarm());

describe('D3: the server beside the address’s own mail (§5.8, §12 D3)', () => {
  it('says the server matches when it is one of the address’s MX hosts’ domains', async () => {
    MX['dev.local'] = [`10 ${MAIL_HOST}.`];
    await reset(owner, ORG);
    const { token } = await mint(owner, TENANT, ANNA);
    const source = card(await anna.cards(token), 'source', 'imap');
    expect(source.way).toBe('password');
    expect(source.server).toMatchObject({ hosts: [MAIL_HOST], published: false, notTheAddressMail: [] });
  });

  it('names the server when it is neither on the address’s domain nor its mail’s, as a warning that refuses nothing', async () => {
    MX['elsewhere.example'] = ['10 mx1.mailhost.example.', '20 mx2.mailhost.example.'];
    const { token } = await mint(owner, TENANT, BRAM);
    const bram = card(await anna.cards(token), 'source', 'imap');
    expect(bram.server).toMatchObject({ hosts: [MAIL_HOST], published: false, notTheAddressMail: [MAIL_HOST] });
    // A warning only: the card is still a password card, with its tries and its box.
    expect(bram.way).toBe('password');
    expect(bram.tries).toEqual({ left: 5, locked: false });
    expect(bram.fields?.filter((f) => f.who === 'person').map((f) => f.key)).toEqual(['password']);
  });
});

const stalwart = Boolean(STALWART_HOST && JMAP_URL);
if (!stalwart) {
  console.warn(
    '[a-grant-link-against-stalwart] the Stalwart cases are NOT RUN: no STALWART_IMAP_HOST / STALWART_JMAP_URL. ' +
      'Under `pnpm test:integration` the global setup provides both, so seeing this there means Stalwart did not start.',
  );
}

describe.skipIf(!stalwart)('a person’s password, typed on their link, against Stalwart', () => {
  const CARDS = [
    { role: 'source', kind: 'imap', right: SOURCE_PASSWORD, wrong: WRONG.imapSource },
    { role: 'target', kind: 'jmap', right: TARGET_PASSWORD, wrong: WRONG.jmapTarget },
    { role: 'target', kind: 'imap', right: TARGET_PASSWORD, wrong: WRONG.imapTarget },
  ] as const;

  it('refuses each wrong password at Stalwart, storing nothing and counting one try; stores each right one; spends the link; both migrations ready', async () => {
    await reset(owner, ORG);
    const { token, id } = await mint(owner, TENANT, ANNA);
    const cards = await anna.cards(token);
    expect(cards.filter((c) => c.way === 'password')).toHaveLength(CARDS.length);
    for (const c of cards) expect(c.server?.hosts, JSON.stringify(c)).toEqual([MAIL_HOST]);
    for (const m of [M.imapToJmap, M.imapToImap]) expect(await ready(m), `${m} before`).toBe(false);

    for (const want of CARDS) {
      const c = card(cards, want.role, want.kind);
      const label = `${want.role} ${want.kind}`;

      const wrong = await anna.put(token, c.ref, want.wrong);
      expect(wrong.status, `${label}: ${wrong.text}`).toBe(422);
      expect(wrong.body, label).toEqual({ error: 'refused_login', tries: { left: 4, locked: false } });
      expect((await triesOf(owner, id, c.ref))?.refused, label).toBe(1);
      if (want.role === 'target') {
        const stored = await secretOf(owner, want.kind === 'jmap' ? C.jmapTarget : C.imapTarget);
        expect(stored.password, `${label}: nothing stored`).toBeUndefined();
      } else {
        for (const m of [M.imapToJmap, M.imapToImap]) expect(await sourceSecretOf(owner, m), `${label}: ${m}`).toEqual({});
      }

      const right = await anna.put(token, c.ref, want.right);
      expect(right.status, `${label}: ${right.text}`).toBe(200);
      expect(right.body.connected, label).toBe(true);
      // A login that worked spends no try: the wrong one stays the one counted.
      expect((await triesOf(owner, id, c.ref))?.refused, label).toBe(1);
    }

    // Where each was stored (§4.3, §5.3 step 7), and the owner's source row holds none of hers.
    expect((await sourceSecretOf(owner, M.imapToJmap)).password).toBe(SOURCE_PASSWORD);
    expect((await sourceSecretOf(owner, M.imapToImap)).password).toBe(SOURCE_PASSWORD);
    expect((await secretOf(owner, C.jmapTarget)).password).toBe(TARGET_PASSWORD);
    expect((await secretOf(owner, C.imapTarget)).password).toBe(TARGET_PASSWORD);
    expect((await secretOf(owner, C.imapSource)).password).toBeUndefined();
    const granted = await owner.query(
      'SELECT connection_id, person_id FROM person_granted_connection WHERE tenant_id = $1 ORDER BY connection_id',
      [TENANT],
    );
    expect(granted.rows).toEqual([C.jmapTarget, C.imapTarget].sort().map((connection_id) => ({ connection_id, person_id: ANNA })));

    // The link is spent, and opens no more.
    const [link] = (await owner.query('SELECT used_at FROM person_link WHERE id = $1', [id])).rows;
    expect(link.used_at).not.toBeNull();
    expect((await anna.open(token)).status).toBe(401);

    // Ready to start: both sides of both migrations have a way in.
    for (const m of [M.imapToJmap, M.imapToImap]) expect(await ready(m), `${m} after`).toBe(true);
  }, 240_000);

  it('locks the card after five refused logins and never tests the sixth, even with the right password', async () => {
    await reset(owner, ORG);
    const { token, id } = await mint(owner, TENANT, ANNA);
    const source = card(await anna.cards(token), 'source', 'imap');
    const before = logins.source;
    for (const left of [4, 3, 2, 1, 0]) {
      const res = await anna.put(token, source.ref, WRONG.lock);
      expect(res.status, res.text).toBe(422);
      expect(res.body).toEqual({ error: 'refused_login', tries: { left, locked: left === 0 } });
    }
    expect(logins.source - before, 'five logins at Stalwart').toBe(5);

    const sixth = await anna.put(token, source.ref, SOURCE_PASSWORD);
    expect(sixth.status).toBe(423);
    expect(sixth.body).toEqual({ error: 'locked' });
    expect(logins.source - before, 'the sixth made no login').toBe(5);

    const tries = await triesOf(owner, id, source.ref);
    expect(tries?.refused).toBe(5);
    expect(tries?.locked_at).not.toBeNull();
    for (const m of [M.imapToJmap, M.imapToImap]) expect(await sourceSecretOf(owner, m)).toEqual({});

    // The owner's remedy: a new link starts at zero, and the right password connects.
    const fresh = await mint(owner, TENANT, ANNA);
    const again = card(await anna.cards(fresh.token), 'source', 'imap');
    expect(again.tries).toEqual({ left: 5, locked: false });
    expect((await anna.put(fresh.token, again.ref, SOURCE_PASSWORD)).status).toBe(200);
  }, 120_000);

  it('found no password, right or wrong, in any response, log line, audit row, try row or other row', async () => {
    await noPasswordAnywhere(owner, TENANT, [...Object.values(WRONG), SOURCE_PASSWORD, TARGET_PASSWORD], anna.said, output.written);
    // And where it belongs: decrypted, exactly once in each record that holds
    // it (the lock case's new link stored the source's, last), and no wrong one anywhere.
    const once = (record: Record<string, string>, p: string) => Object.values(record).filter((v) => v === p).length;
    for (const m of [M.imapToJmap, M.imapToImap]) expect(once(await sourceSecretOf(owner, m), SOURCE_PASSWORD)).toBe(1);
    for (const w of Object.values(WRONG)) {
      for (const c of Object.values(C)) expect(Object.values(await secretOf(owner, c))).not.toContain(w);
      for (const m of Object.values(M)) expect(Object.values(await sourceSecretOf(owner, m))).not.toContain(w);
    }
  });
});
