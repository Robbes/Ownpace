// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOMAIN THE MAPPING TICKED THAT NEVER RAN.
 *
 * On 2026-09-03 the task domain shipped (workplan 0113). `DomainsConfig` grew
 * a `tasks` key, `runAllDomains` grew a `task` entry that read
 * `config.domains?.tasks?.enabled`, and the e2e fixture ticked it. The parser
 * BETWEEN them — `parseDomainsConfig` in `@openmig/shared` — kept its four
 * hand-written `if` blocks: mail, calendar, contacts, files.
 *
 * So the appliance read a mapping that said
 *
 *     "tasks": { "enabled": true, "source": …, "target": … }
 *
 * and produced a config with no `tasks` at all. Nothing threw. Nothing
 * compiled red: an optional key the parser never assigns is legal TypeScript,
 * and a missing key reads as `enabled: false`, which is spelled `skipped` —
 * a word that means "your call, nobody checked". The status endpoint said
 *
 *     { "domain": "task", "state": "skipped", "itemsSynced": 0 }
 *
 * for a domain the owner had explicitly asked for, and the run log listed two
 * lanes, `email | calendar+contact+file`, with no fifth domain in either. It
 * took the self-hosted gate five minutes of timeout to notice, once that gate
 * could run at all.
 *
 * ## What is actually pinned
 *
 * Not "tasks parse" — that is one line and the next domain would repeat the
 * whole story. The chain is generated from `DISCOVERY_DOMAINS`, so a SIXTH
 * domain that no reader below can see fails here, in the package that owns the
 * decision, rather than in somebody's migration.
 *
 * The two halves are tested together on purpose. Each is fine alone: the
 * parser produces a block, the reader reads a block. The defect lived in the
 * gap — they disagreed about which keys exist — and a test of either half
 * passes while a mapping quietly migrates nothing.
 */

import { describe, it, expect } from 'vitest';
import {
  parseMappingConfig,
  ConfigError,
  DISCOVERY_DOMAINS,
  DOMAIN_CONFIG_KEY,
  DOMAIN_CONFIG_KEYS,
  type DiscoveryDomain,
} from '@openmig/shared';
import { domainsFromConfig } from './orchestration.ts';

/**
 * A DAV block, which every domain but mail accepts. The type differs per
 * domain in a real mapping (`caldav`/`carddav`/`webdav`); `caldav` parses for
 * all of them and nothing here depends on the connector it would build.
 */
const davBlock = {
  enabled: true,
  source: {
    type: 'caldav',
    url: 'https://cloud.example.net/remote.php/dav',
    user: 'source',
    auth: { kind: 'login', passwordFromEnv: 'SOURCE_DAV_PASSWORD' },
  },
  target: {
    type: 'caldav',
    url: 'https://cloud.example.net/remote.php/dav',
    user: 'target',
    auth: { kind: 'login', passwordFromEnv: 'TARGET_DAV_PASSWORD' },
  },
};

const mailBlock = {
  enabled: true,
  source: {
    type: 'imap-oauth2',
    host: 'imap.example.net',
    port: 993,
    user: 'source@example.net',
    auth: { kind: 'login', passwordFromEnv: 'SOURCE_IMAP_PASSWORD' },
  },
  target: {
    type: 'jmap',
    baseUrl: 'https://mail.example.net',
    user: 'target@example.net',
    auth: { kind: 'basic', passwordFromEnv: 'TARGET_JMAP_PASSWORD' },
  },
};

const blockFor = (domain: DiscoveryDomain) => (domain === 'email' ? mailBlock : davBlock);

/** A mapping carrying exactly the `domains` block it is handed. */
const mapping = (domains: Record<string, unknown>) => ({
  tenantId: '00000000-0000-4000-8000-000000000001',
  mappingId: '11111111-1111-4111-8111-111111111111',
  // A DAV source at the top level, so the "no domains block ⇒ mail only"
  // fallback cannot be what switches a domain on in any case below.
  source: {
    type: 'caldav',
    url: 'https://cloud.example.net/remote.php/dav',
    user: 'source',
    auth: { kind: 'login', passwordFromEnv: 'SOURCE_DAV_PASSWORD' },
  },
  target: {
    type: 'caldav',
    url: 'https://cloud.example.net/remote.php/dav',
    user: 'target',
    auth: { kind: 'login', passwordFromEnv: 'TARGET_DAV_PASSWORD' },
  },
  domains,
});

const enabledIn = (config: ReturnType<typeof parseMappingConfig>): DiscoveryDomain[] =>
  domainsFromConfig(config)
    .filter((d) => d.enabled)
    .map((d) => d.name);

describe('a domain the mapping ticked reaches the run', () => {
  for (const domain of DISCOVERY_DOMAINS) {
    const key = DOMAIN_CONFIG_KEY[domain];

    it(`${domain}: ticked under domains.${key}, and the run sees it`, () => {
      // Ticked ALONE, which is the shape that catches a dropped branch: with
      // the other four beside it the run still has work to do and the domain's
      // absence looks like an ordinary quiet pass.
      const parsed = parseMappingConfig(mapping({ [key]: blockFor(domain) }));

      expect(
        parsed.domains?.[key],
        `parseMappingConfig discarded domains.${key} — the mapping asked for ` +
          `${domain} and the appliance will report it 'skipped' with nothing migrated ` +
          'and no error anywhere',
      ).toBeDefined();
      expect(parsed.domains?.[key]?.enabled).toBe(true);
      expect(enabledIn(parsed)).toEqual([domain]);
    });

    it(`${domain}: NOT ticked stays off`, () => {
      // The control. A parser that answered "enabled" for everything would
      // pass every assertion above and migrate four domains nobody asked for.
      const parsed = parseMappingConfig(mapping({ [key]: { ...blockFor(domain), enabled: false } }));
      expect(parsed.domains?.[key]?.enabled).toBe(false);
      expect(enabledIn(parsed)).toEqual([]);
    });
  }

  it('runs all five when all five are ticked — the self-hosted gate’s own shape', () => {
    const parsed = parseMappingConfig(
      mapping(Object.fromEntries(DISCOVERY_DOMAINS.map((d) => [DOMAIN_CONFIG_KEY[d], blockFor(d)]))),
    );
    expect(enabledIn(parsed)).toEqual([...DISCOVERY_DOMAINS]);
  });

  it('keeps the per-domain source and target, not just the tick', () => {
    // A branch that set `enabled` and dropped the endpoints would pass every
    // test above and then build the domain against the top-level connection —
    // which is how a calendar server ends up being asked for mail.
    const parsed = parseMappingConfig(
      mapping({ tasks: { ...davBlock, source: { ...davBlock.source, user: 'tasks-source' } } }),
    );
    expect(parsed.domains?.tasks?.source).toMatchObject({ user: 'tasks-source' });
    expect(parsed.domains?.tasks?.target).toMatchObject({ user: 'target' });
  });
});

describe('the config keys and the domains are one list', () => {
  it('gives every domain a key, and every key to one domain', () => {
    // `DOMAIN_CONFIG_KEY` is `Record<DiscoveryDomain, …>`, so a sixth domain
    // is a compile error there. This asserts the other direction: no two
    // domains share a key, which would make one of them unreachable.
    expect(DOMAIN_CONFIG_KEYS).toHaveLength(DISCOVERY_DOMAINS.length);
    expect(new Set(DOMAIN_CONFIG_KEYS).size).toBe(DISCOVERY_DOMAINS.length);
  });

  it('lists the keys in domain order, so a refusal reads like the wizard', () => {
    expect([...DOMAIN_CONFIG_KEYS]).toEqual(DISCOVERY_DOMAINS.map((d) => DOMAIN_CONFIG_KEY[d]));
  });
});

describe('a domains key that names no domain is refused, not ignored', () => {
  it('refuses the singular typo, and says what the keys are', () => {
    // `task` for `tasks` is the same silence by another route: a key nobody
    // reads. The root of the config ignores unknown keys on purpose (a mapping
    // may carry its own notes); nothing under `domains` is a note.
    let error: unknown;
    try {
      parseMappingConfig(mapping({ task: davBlock }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toContain('domains.task');
    for (const key of DOMAIN_CONFIG_KEYS) {
      expect((error as Error).message).toContain(key);
    }
  });

  it('still accepts every real key', () => {
    expect(() =>
      parseMappingConfig(
        mapping(Object.fromEntries(DOMAIN_CONFIG_KEYS.map((k) => [k, { ...davBlock, enabled: false }]))),
      ),
    ).not.toThrow();
  });
});

describe('the mapping with no domains block at all', () => {
  it('still runs mail only from an IMAP source', () => {
    // The pre-domains shape, unchanged: it predates the block and there are
    // deployments running it.
    const parsed = parseMappingConfig({
      tenantId: '00000000-0000-4000-8000-000000000001',
      mappingId: '11111111-1111-4111-8111-111111111111',
      source: mailBlock.source,
      target: mailBlock.target,
    });
    expect(enabledIn(parsed)).toEqual(['email']);
  });

  it('runs nothing from a DAV source, which has no mail to fall back to', () => {
    const parsed = parseMappingConfig(mapping({}));
    expect(enabledIn(parsed)).toEqual([]);
  });

  it('never adds mail to a mapping that ticked something else', () => {
    // The fallback is for configs written BEFORE the domains block existed. A
    // mapping that has one has already answered the question, and an IMAP
    // address at the top level is not a second answer — widening the fallback
    // would migrate a mailbox nobody ticked.
    const parsed = parseMappingConfig({
      tenantId: '00000000-0000-4000-8000-000000000001',
      mappingId: '11111111-1111-4111-8111-111111111111',
      source: mailBlock.source,
      target: mailBlock.target,
      domains: { calendar: davBlock },
    });
    expect(enabledIn(parsed)).toEqual(['calendar']);
  });
});
