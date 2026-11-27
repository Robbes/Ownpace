// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SOVERIN ROW WITH NO KIND, MEASURED ONCE BY ITS NEXT PASS (workplan 0175
 * D6 (a), §5.4, T8).
 *
 * A row tested before 0175 has no `qualification.soverin`. Its next pass
 * measures the kind once, before its DAV faces, remembers it on the row, and
 * writes where that kind names. A row with a record is not measured again by
 * a pass: the Test is where a person measures it again.
 */

import { describe, it, expect } from 'vitest';
import type { SoverinRecord } from '@openmig/shared';
import { soverinTargetForPass } from './soverin-pass.ts';

const AT = '2026-11-27T10:00:00.000Z';
const ROW = {
  kind: 'soverin',
  id: 'conn-1',
  config: { host: 'caldav.soverin.net', port: 443, mailHost: 'imap.soverin.net', mailPort: 993 },
  creds: { username: '<mailbox>', password: 'mailbox-password' },
};
const PERSONAL: SoverinRecord = {
  kind: 'personal',
  davRoot: 'https://caldav.soverin.net:443/',
  principal: '/principals/<mailbox>/',
  measuredAt: AT,
};

describe('a pass into a soverin destination, before its DAV faces', () => {
  it('a row with no kind is measured once, remembered on the row, and written where the kind names', async () => {
    const measured: unknown[] = [];
    const remembered: SoverinRecord[] = [];
    const out = await soverinTargetForPass(
      { ...ROW, qualification: { domains: { calendar: { answer: 'yes', detail: '' } } } },
      {
        measure: async (config, login) => {
          measured.push({ config, login });
          return PERSONAL;
        },
        remember: async (record) => {
          remembered.push(record);
        },
      },
    );
    expect(measured).toEqual([{ config: ROW.config, login: { username: '<mailbox>', password: 'mailbox-password' } }]);
    expect(remembered).toEqual([PERSONAL]);
    expect(out.config).toEqual({ url: PERSONAL.davRoot, mailHost: 'imap.soverin.net', mailPort: 993 });
    expect(out.creds).toEqual(ROW.creds);
  });

  it('a row with a kind is not measured by a pass, and goes to its recorded root', async () => {
    let asked = 0;
    const out = await soverinTargetForPass(
      { ...ROW, qualification: { domains: {}, soverin: PERSONAL } },
      {
        measure: async () => {
          asked += 1;
          return PERSONAL;
        },
        remember: async () => {
          asked += 1;
        },
      },
    );
    expect(asked).toBe(0);
    expect(out.config).toMatchObject({ url: PERSONAL.davRoot });
    expect(out.config.host).toBeUndefined();
  });

  it('a kind measured unknown is remembered, and the pass writes where the row was tested, as it did before', async () => {
    const unknown: SoverinRecord = { kind: 'unknown', reason: "Soverin's personal server did not answer: 503", measuredAt: AT };
    const remembered: SoverinRecord[] = [];
    const out = await soverinTargetForPass(
      { ...ROW, qualification: { domains: {} } },
      { measure: async () => unknown, remember: async (r) => void remembered.push(r) },
    );
    expect(remembered).toEqual([unknown]);
    expect(out.config).toEqual(ROW.config);
  });

  it('any other kind passes through untouched, and nothing is measured', async () => {
    let asked = 0;
    const row = { ...ROW, kind: 'nextcloud', qualification: null };
    const out = await soverinTargetForPass(row, {
      measure: async () => {
        asked += 1;
        return PERSONAL;
      },
      remember: async () => {
        asked += 1;
      },
    });
    expect(asked).toBe(0);
    expect(out).toEqual(row);
  });

  it("a Suite record signs the DAV faces in with the Suite login, and refuses by name when none is stored", async () => {
    const suite: SoverinRecord = { kind: 'suite', davRoot: 'https://suite.example/remote.php/dav/', measuredAt: AT };
    const withLogin = await soverinTargetForPass(
      {
        ...ROW,
        creds: { ...ROW.creds, suiteUsername: 'user-code', suitePassword: 'suite-app-password' },
        qualification: { soverin: suite },
      },
      { measure: async () => suite, remember: async () => undefined },
    );
    expect(withLogin.creds).toMatchObject({ username: 'user-code', password: 'suite-app-password' });
    await expect(
      soverinTargetForPass(
        { ...ROW, qualification: { soverin: suite } },
        { measure: async () => suite, remember: async () => undefined },
      ),
    ).rejects.toThrow(/Suite app password/);
  });
});
