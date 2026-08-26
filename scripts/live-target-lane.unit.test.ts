// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The soft lane's decisions (0105 T4): stand-down loudly-but-green, red on
 * half-configuration, silence never claimed without a positive control, the
 * day-after sweep, and tag families that cannot collide.
 */

import { describe, it, expect } from 'vitest';
import type { CatchallConfig } from './live-catchall.ts';
import {
  apiFromEnv,
  canaryDomain,
  controlFromEnv,
  controlTag,
  liveTag,
  runLane,
  type LaneDeps,
} from './live-target-lane.ts';

const NOW = new Date('2026-08-26T03:30:00Z');

const CATCHALL_ON: CatchallConfig = {
  on: true,
  host: 'imap.example.net',
  port: 993,
  user: 'catchall@ownpace.eu',
  password: 'pw',
  mailbox: 'INBOX',
  announcement: 'live catch-all: ON — test',
};

/** A deps bundle where nothing happens unless a test says so. */
function quietDeps(overrides: Partial<LaneDeps>): { deps: LaneDeps; said: string[] } {
  const said: string[] = [];
  const deps: LaneDeps = {
    now: NOW,
    catchall: CATCHALL_ON,
    control: { on: false, misconfigured: false, reason: 'no control sender configured (X)' },
    api: { on: false, misconfigured: false, reason: 'no live tenant configured yet (Y)' },
    domain: 'ownpace.eu',
    search: async () => [],
    wait: async () => [],
    sendControl: async () => {},
    triggerSync: async () => ({ ok: true, detail: '202' }),
    settle: async () => {},
    settleMs: 1,
    say: (line) => said.push(line),
    ...overrides,
  };
  return { deps, said };
}

describe('the tag families', () => {
  it('are date-stamped, so a tag is never reused by construction', () => {
    expect(liveTag(NOW)).toBe('openmig-live-20260826');
    expect(liveTag(new Date('2026-08-27T00:00:00Z'))).toBe('openmig-live-20260827');
  });

  it('control and canary are DISJOINT — the control mail can never break the silence it proves', () => {
    // The E2E-#88 lesson wearing its live-lane face.
    expect(controlTag(NOW)).toBe('openmig-control-20260826');
    expect(controlTag(NOW).includes(liveTag(NOW))).toBe(false);
    expect(liveTag(NOW).includes(controlTag(NOW))).toBe(false);
  });
});

describe('the config readers keep the notifierFromEnv discipline', () => {
  it('control: half-set names exactly the missing variables', () => {
    const config = controlFromEnv({ LIVE_CONTROL_SMTP_HOST: 'smtp.example.net' });
    expect(config.on).toBe(false);
    if (!config.on) {
      expect(config.misconfigured).toBe(true);
      expect(config.reason).toContain('LIVE_CONTROL_SMTP_USER');
      expect(config.reason).toContain('LIVE_CONTROL_SMTP_PASSWORD');
    }
  });

  it('control: fully set defaults port 465 and from-address to the user', () => {
    const config = controlFromEnv({
      LIVE_CONTROL_SMTP_HOST: 'smtp.example.net',
      LIVE_CONTROL_SMTP_USER: 'box@example.net',
      LIVE_CONTROL_SMTP_PASSWORD: 'pw',
    });
    expect(config).toMatchObject({ on: true, port: 465, from: 'box@example.net' });
  });

  it('api: mappings split on commas; half-set is misconfigured with names', () => {
    const on = apiFromEnv({
      LIVE_TARGET_API_URL: 'https://api.example.net/',
      LIVE_TARGET_API_TOKEN: 't',
      LIVE_TARGET_MAPPINGS: 'a, b ,c',
    });
    expect(on).toMatchObject({ on: true, url: 'https://api.example.net', mappings: ['a', 'b', 'c'] });

    const half = apiFromEnv({ LIVE_TARGET_API_URL: 'https://api.example.net' });
    expect(half.on).toBe(false);
    if (!half.on) {
      expect(half.misconfigured).toBe(true);
      expect(half.reason).toContain('LIVE_TARGET_API_TOKEN');
      expect(half.reason).toContain('LIVE_TARGET_MAPPINGS');
    }
  });

  it('the canary domain defaults to the one we own', () => {
    expect(canaryDomain({})).toBe('ownpace.eu');
    expect(canaryDomain({ LIVE_CANARY_DOMAIN: 'example.org' })).toBe('example.org');
  });
});

describe('runLane: the postures', () => {
  it('unconfigured stands down loudly-but-GREEN', async () => {
    const { deps } = quietDeps({
      catchall: {
        on: false,
        misconfigured: false,
        reason: 'the live catch-all is not configured (…)',
        announcement: 'live catch-all: OFF — …',
      },
    });
    const result = await runLane(deps);
    expect(result.ok).toBe(true);
    expect(result.verdict).toContain('STAND-DOWN');
  });

  it('a half-configured catch-all is RED — a mistake, not a choice', async () => {
    const { deps } = quietDeps({
      catchall: {
        on: false,
        misconfigured: true,
        reason: 'missing: LIVE_CATCHALL_PASSWORD',
        announcement: 'live catch-all: OFF — …',
      },
    });
    const result = await runLane(deps);
    expect(result.ok).toBe(false);
    expect(result.verdict).toContain('LIVE_CATCHALL_PASSWORD');
  });

  it('silence without a control is reported UNPROVEN, and stays green only because nothing else failed', async () => {
    const { deps, said } = quietDeps({});
    const result = await runLane(deps);
    expect(result.ok).toBe(true);
    expect(said.join('\n')).toContain('UNPROVEN');
    expect(result.verdict).toContain('control=unproven');
    expect(result.verdict).toContain('silence=silent-but-unproven');
  });

  it('a control that never arrives is RED — every silence would be vacuous', async () => {
    const { deps } = quietDeps({
      control: { on: true, host: 'smtp', port: 465, user: 'u', password: 'p', from: 'u' },
      wait: async () => [],
    });
    const result = await runLane(deps);
    expect(result.ok).toBe(false);
    expect(result.verdict).toContain('control never arrived');
  });

  it('the day-after sweep asks for YESTERDAY\'s tag and reds on a hit, with evidence said', async () => {
    const searched: string[] = [];
    const { deps, said } = quietDeps({
      search: async (tag) => {
        searched.push(tag);
        return tag === 'openmig-live-20260825'
          ? [{ subject: 'Invitation: standup', from: 'cal@prov.example', to: ['x@ownpace.eu'] }]
          : [];
      },
    });
    const result = await runLane(deps);
    expect(searched).toContain('openmig-live-20260825'); // yesterday
    expect(searched).toContain('openmig-live-20260826'); // today
    expect(result.ok).toBe(false);
    expect(result.verdict).toContain('sweep caught 1');
    expect(said.join('\n')).toContain('cal@prov.example');
  });

  it('a broken silence today is RED with the evidence said, and the sync half rides the verdict', async () => {
    const { deps, said } = quietDeps({
      control: { on: true, host: 'smtp', port: 465, user: 'u', password: 'p', from: 'u' },
      wait: async () => [{ subject: 'control', from: 'u', to: ['openmig-control-20260826@ownpace.eu'] }],
      api: { on: true, url: 'https://api', token: 't', mappings: ['m1'] },
      search: async (tag) =>
        tag === 'openmig-live-20260826'
          ? [{ subject: 'Uitnodiging', from: 'soverin@prov.example', to: ['a@b.example'] }]
          : [],
    });
    const result = await runLane(deps);
    expect(result.ok).toBe(false);
    expect(result.verdict).toContain('silence=1 caught');
    expect(result.verdict).toContain('sync=1/1');
    expect(said.join('\n')).toContain('soverin@prov.example');
  });

  it('the full green run: control arrived, both sweeps silent, syncs triggered — PASS', async () => {
    const settled: number[] = [];
    const { deps } = quietDeps({
      control: { on: true, host: 'smtp', port: 465, user: 'u', password: 'p', from: 'u' },
      wait: async () => [{ subject: 'control', from: 'u', to: ['openmig-control-20260826@ownpace.eu'] }],
      api: { on: true, url: 'https://api', token: 't', mappings: ['m1', 'm2'] },
      settle: async (ms) => {
        settled.push(ms);
      },
      settleMs: 600000,
    });
    const result = await runLane(deps);
    expect(result.ok).toBe(true);
    expect(result.verdict).toContain('control=arrived');
    expect(result.verdict).toContain('sync=2/2');
    expect(result.verdict).toContain('silence=silent');
    expect(result.verdict).toContain('PASS');
    // The settle window ran before the silence check believed anything.
    expect(settled).toEqual([600000]);
  });

  it('a refused sync trigger is RED and names the mapping', async () => {
    const { deps } = quietDeps({
      api: { on: true, url: 'https://api', token: 't', mappings: ['m1'] },
      triggerSync: async () => ({ ok: false, detail: '409 not_cut_over' }),
    });
    const result = await runLane(deps);
    expect(result.ok).toBe(false);
    expect(result.verdict).toContain('sync m1 refused');
  });
});
