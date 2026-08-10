// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Choices that cannot work are refused, not stored (workplan 0037 T4).
 *
 * Before these refusals, `carddav` + `email` (and friends) sailed through
 * this schema into scope_selection rows the target protocol can never
 * receive — failing later as sync errors the admin cannot connect to a
 * wizard choice — and a garbage cron was stored verbatim, sending the tick
 * worker to its loud-log + default-cadence fallback while the admin's
 * stated cadence was silently ignored.
 *
 * This is the managed edition's half of the contract test. The appliance
 * needs no twin: its config directory is the create path there, and both
 * failure modes are already loud — an unsupported target/domain pairing
 * throws in the per-domain factories at build time, and an invalid cron
 * throws in croner at scheduler registration.
 */
import { describe, it, expect } from 'vitest';
import { CreateMappingSchema } from './index';

function body(over: Record<string, unknown> = {}) {
  return {
    name: 'a migration',
    sourceType: 'imap',
    targetType: 'jmap',
    sourceConfig: { host: 'src.example.nl', port: 993, username: 'a@example.nl' },
    targetConfig: { host: 'dst.example.nl', port: 443, username: 'a@example.nl', password: 'x' },
    syncConfig: { domains: ['email'] },
    ...over,
  };
}

function refusalText(payload: Record<string, unknown>): string {
  const result = CreateMappingSchema.safeParse(payload);
  if (result.success) throw new Error('expected a refusal');
  return result.error.issues.map((i) => i.message).join(' ');
}

describe('target/domain coherence — the server refuses, naming both sides', () => {
  it('refuses carddav + email (the workplan example)', () => {
    const msg = refusalText(
      body({ targetType: 'carddav', syncConfig: { domains: ['email', 'contact'] } }),
    );
    expect(msg).toContain('CardDAV');
    expect(msg).toContain("'email'");
    expect(msg).toContain("carries 'contact' only");
  });

  it('refuses jmap + calendar, naming the parked owner decision (0031 T1)', () => {
    const msg = refusalText(body({ syncConfig: { domains: ['email', 'calendar'] } }));
    expect(msg).toContain('no JMAP calendar target');
    expect(msg).toContain('CalDAV');
  });

  it('accepts every coherent pairing the engines implement', () => {
    const ok = [
      { targetType: 'jmap', domains: ['email', 'contact', 'file'] },
      { targetType: 'imap', domains: ['email'] },
      { targetType: 'caldav', domains: ['calendar'] },
      { targetType: 'carddav', domains: ['contact'] },
      { targetType: 'webdav', domains: ['file'] },
    ] as const;
    for (const { targetType, domains } of ok) {
      const result = CreateMappingSchema.safeParse(
        body({ targetType, syncConfig: { domains: [...domains] } }),
      );
      expect(result.success, `${targetType} + ${domains.join(',')}`).toBe(true);
    }
  });
});

describe('cron schedule — garbage is refused with the reason and the fallback named', () => {
  it('refuses free text, naming the five fields and the silent fallback it prevents', () => {
    const msg = refusalText(body({ syncConfig: { domains: ['email'], schedule: 'every day' } }));
    expect(msg).toContain('five fields');
    expect(msg).toContain('every 15 minutes');
    expect(msg).toContain('silently ignoring');
  });

  it('refuses an out-of-range field with the field named', () => {
    const msg = refusalText(
      body({ syncConfig: { domains: ['email'], schedule: '61 * * * *' } }),
    );
    expect(msg).toContain('minute');
    expect(msg).toContain('0-59');
  });

  it('a valid cron round-trips; an omitted one stays legal (the default applies)', () => {
    const withCron = CreateMappingSchema.safeParse(
      body({ syncConfig: { domains: ['email'], schedule: '0 2 * * *' } }),
    );
    expect(withCron.success).toBe(true);
    if (withCron.success) expect(withCron.data.syncConfig.schedule).toBe('0 2 * * *');

    expect(CreateMappingSchema.safeParse(body()).success).toBe(true);
  });
});
