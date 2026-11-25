// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANT LINK'S PASSWORDS, TYPED AGAINST NEXTCLOUD (workplan 0174 §11, T8).
 *
 * `a-grant-link-against-stalwart`'s twin for the Nextcloud fixture (the image
 * and account of `deploy/compose/dev.yml`'s, as the harness starts it), kept
 * apart because the leg that runs every Nextcloud suite against a second
 * major (`nextcloud-second-major.yml`) starts no Stalwart; this file runs
 * there too, and so is proved against both majors.
 *
 * A person's CalDAV SOURCE and their `nextcloud` DESTINATION, saved for them
 * as the doors save them (0174 §8.2): per card a wrong password refused by
 * Nextcloud (an HTTP 401 at the DAV address), nothing stored and one try
 * counted; the right one stored; then the link spent and the migration with a
 * way in on both sides (`hasAWayInOnBothSides`: ready to start); and every
 * password typed in no response, log line, `audit_log` row, try row or other
 * row. The route, the GET and the probe are the real ones, as the managed API
 * mounts them, on the tier's Postgres read as `app_user`. D3's lookup is
 * answered from a table (no account here is an address on a domain with
 * mail; `a-grant-link-against-stalwart` proves the comparison).
 *
 * Two wrong logins are made, which Nextcloud's brute-force guard notes for
 * this address and delays the next logins by a little.
 *
 * Without Nextcloud (`./scripts/local-pg.sh`, `SKIP_NEXTCLOUD`), this says NOT
 * RUN and runs nothing.
 *
 * UUID family: 0174a810-e29b-41d4-a716-4466554400xx
 */

process.env.SECRET_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.GRANT_PASSWORD_TESTS_PER_HOUR = '1000';
process.env.WEB_URL ??= 'https://app.example';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { withTenant } from '@openmig/ledger';
import {
  card,
  captureOutput,
  clean,
  databaseFor,
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

vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/core')>();
  return { ...actual, verifyMX: async () => ({ resolverResults: {} }) };
});

/**
 * The DAV base, by name: a password is never sent to an address (§5.8, D3
 * (a)), and where the harness names the loopback address, `localhost` is the
 * same machine by name.
 */
const DAV = process.env.NEXTCLOUD_WEBDAV_URL?.replace(/^(https?:\/\/)(127\.0\.0\.1|\[::1\])(?=[:/])/, '$1localhost');
const USER = process.env.NEXTCLOUD_USERNAME;
const PASSWORD = process.env.NEXTCLOUD_PASSWORD;
const nextcloud = Boolean(DAV && USER && PASSWORD);
if (!nextcloud) {
  console.warn(
    '[a-grant-link-against-nextcloud] NOT RUN: no NEXTCLOUD_WEBDAV_URL / NEXTCLOUD_USERNAME / NEXTCLOUD_PASSWORD. ' +
      'Under `pnpm test:integration` the global setup provides them, so seeing this there means Nextcloud did not start.',
  );
}

const U = (n: string) => `0174a810-e29b-41d4-a716-4466554400${n}`;
const TENANT = U('01');
const ANNA = U('41');
const SOURCE = U('11');
const TARGET = U('21');
const MAPPING = U('31');
const WRONG = { source: 'SENTINEL-t8-wrong-caldav-source', target: 'SENTINEL-t8-wrong-nextcloud-target' } as const;

describe.skipIf(!nextcloud)('a person’s password, typed on their link, against Nextcloud', () => {
  const { owner } = databaseFor();
  const output = captureOutput();
  let anna: ReturnType<typeof person>;
  // The DAV base, as the door stores a URL; the login is the encrypted credential's.
  const ORG: Organisation = {
    tenant: TENANT,
    accounts: [
      { id: SOURCE, role: 'source', kind: 'caldav', config: { url: DAV }, creds: { username: USER! }, address: 'calendar@example.invalid' },
      { id: TARGET, role: 'target', kind: 'nextcloud', config: { url: DAV }, creds: { username: USER! }, address: 'files@example.invalid' },
    ],
    people: [[ANNA, 'Anna']],
    migrations: [[MAPPING, SOURCE, TARGET, ['calendar'], ANNA]],
  };

  beforeAll(async () => {
    anna = person(await grantApp());
    await clean(owner, TENANT);
    await setUp(owner, ORG);
  }, 60_000);

  afterAll(async () => {
    await clean(owner, TENANT);
    await owner.end();
  });

  beforeEach(() => output.arm());
  afterEach(() => output.disarm());

  it('refuses each wrong password at Nextcloud, storing nothing and counting one try; stores each right one; spends the link; the migration ready', async () => {
    const { hasAWayInOnBothSides } = await import('./migrations/withdrawal-hold.ts');
    const ready = () => withTenant(owner, TENANT, (db) => hasAWayInOnBothSides(db, TENANT, MAPPING));
    await reset(owner, ORG);
    const { token, id } = await mint(owner, TENANT, ANNA);
    const cards = await anna.cards(token);
    expect(cards.filter((c) => c.way === 'password')).toHaveLength(2);
    const host = new URL(DAV!).hostname;
    for (const c of cards) expect(c.server?.hosts, JSON.stringify(c)).toEqual([host]);
    expect(await ready()).toBe(false);

    for (const [role, kind, wrongPassword] of [
      ['source', 'caldav', WRONG.source],
      ['target', 'nextcloud', WRONG.target],
    ] as const) {
      const c = card(cards, role, kind);
      const wrong = await anna.put(token, c.ref, wrongPassword);
      expect(wrong.status, `${kind}: ${wrong.text}`).toBe(422);
      expect(wrong.body, kind).toEqual({ error: 'refused_login', tries: { left: 4, locked: false } });
      expect((await triesOf(owner, id, c.ref))?.refused, kind).toBe(1);
      if (role === 'source') expect(await sourceSecretOf(owner, MAPPING), 'nothing stored').toEqual({});
      else expect((await secretOf(owner, TARGET)).password, 'nothing stored').toBeUndefined();

      const right = await anna.put(token, c.ref, PASSWORD!);
      expect(right.status, `${kind}: ${right.text}`).toBe(200);
      expect(right.body.connected, kind).toBe(true);
      expect((await triesOf(owner, id, c.ref))?.refused, kind).toBe(1);
    }

    expect((await sourceSecretOf(owner, MAPPING)).password).toBe(PASSWORD);
    expect((await secretOf(owner, TARGET)).password).toBe(PASSWORD);
    expect((await secretOf(owner, SOURCE)).password).toBeUndefined();
    const granted = await owner.query('SELECT connection_id, person_id FROM person_granted_connection WHERE tenant_id = $1', [TENANT]);
    expect(granted.rows).toEqual([{ connection_id: TARGET, person_id: ANNA }]);
    const [link] = (await owner.query('SELECT used_at FROM person_link WHERE id = $1', [id])).rows;
    expect(link.used_at).not.toBeNull();
    expect((await anna.open(token)).status).toBe(401);
    expect(await ready()).toBe(true);
  }, 240_000);

  it('found no password, right or wrong, in any response, log line, audit row, try row or other row', async () => {
    await noPasswordAnywhere(owner, TENANT, [...Object.values(WRONG), PASSWORD!], anna.said, output.written);
  });
});
