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

describe('source-type / credential coherence — the app registration is demanded by name (0037 T6)', () => {
  it('refuses a graph source without its app registration, naming the missing fields and the fix', () => {
    const msg = refusalText(
      body({
        sourceType: 'graph',
        sourceConfig: { username: 'mailbox@example.nl' },
      }),
    );
    expect(msg).toContain('Entra app registration');
    expect(msg).toContain('tenantId, clientId, clientSecret');
    expect(msg).toContain('docs/o365-setup.md');
  });

  it('refuses an oauth2 source missing only the client secret, naming exactly that', () => {
    const msg = refusalText(
      body({
        sourceType: 'oauth2',
        sourceConfig: {
          username: 'mailbox@example.nl',
          tenantId: 'contoso.example',
          clientId: 'app-id',
        },
      }),
    );
    expect(msg).toContain('missing clientSecret');
    expect(msg).not.toContain('tenantId,');
  });

  it('accepts a graph source carrying the full registration, with no host at all', () => {
    const result = CreateMappingSchema.safeParse(
      body({
        sourceType: 'graph',
        sourceConfig: {
          username: 'mailbox@example.nl',
          tenantId: 'contoso.example',
          clientId: 'app-id',
          clientSecret: 'shh',
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('refuses an imap source without a server, naming host and port', () => {
    const msg = refusalText(body({ sourceConfig: { username: 'a@example.nl' } }));
    expect(msg).toContain("An 'imap' source connects to a server");
    expect(msg).toContain('host and port');
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

describe('a google-drive source (workplan 0042) — the same doors, its own refusals', () => {
  const drive = (over: Record<string, unknown> = {}) =>
    body({
      sourceType: 'google-drive',
      targetType: 'webdav',
      sourceConfig: {
        username: 'owner@example.nl',
        clientId: 'cid.apps.googleusercontent.com',
        clientSecret: 'cs',
        refreshToken: 'rt',
        ...((over.sourceConfig as Record<string, unknown>) ?? {}),
      },
      syncConfig: { domains: ['file'] },
      ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'sourceConfig')),
    });

  it('accepts the coherent shape: drive → webdav, file domain, three credentials', () => {
    expect(CreateMappingSchema.safeParse(drive()).success).toBe(true);
  });

  it('refuses a missing refresh token, pointing at the setup doc', () => {
    const msg = refusalText(
      drive({ sourceConfig: { refreshToken: undefined } }),
    );
    expect(msg).toContain('refreshToken');
    expect(msg).toContain('google-workspace-setup.md');
  });

  it('refuses non-file domains — the credential reads the Drive API only', () => {
    const msg = refusalText(drive({ syncConfig: { domains: ['file', 'email'] } }));
    expect(msg).toContain("'email'");
    expect(msg).toContain('Drive API only');
    expect(msg).toContain('separate mapping');
  });

  it('refuses a nativeFilePolicy the shared parser refuses, in ITS words (hard rule 5)', () => {
    // The exact sentence the appliance prints for the same mistake in a
    // mapping file — one authority, both editions.
    const msg = refusalText(
      drive({ sourceConfig: { nativeFilePolicy: 'export-html' } }),
    );
    expect(msg).toContain('nativeFilePolicy');
    expect(msg).toMatch(/refuse|export-office|export-pdf/);
  });

  it('still refuses an incoherent TARGET for the file domain', () => {
    const msg = refusalText(drive({ targetType: 'caldav' }));
    expect(msg).toContain('CalDAV');
    expect(msg).toContain("'file'");
  });
});

describe('a gmail source (workplan 0044) — the Drive credential shape, the mail domain', () => {
  const gmail = (over: Record<string, unknown> = {}) =>
    body({
      sourceType: 'gmail',
      targetType: 'jmap',
      sourceConfig: {
        username: 'owner@gmail.com',
        clientId: 'cid.apps.googleusercontent.com',
        clientSecret: 'cs',
        refreshToken: 'rt',
        ...((over.sourceConfig as Record<string, unknown>) ?? {}),
      },
      syncConfig: { domains: ['email'] },
      ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'sourceConfig')),
    });

  it('accepts the coherent shape: gmail → jmap, email domain, three credentials', () => {
    expect(CreateMappingSchema.safeParse(gmail()).success).toBe(true);
  });

  it('refuses a missing refresh token, naming the MAIL scope the consent must carry', () => {
    // The operator most likely here already set up Drive with the same OAuth
    // client — and a Drive-consented token answers invalid_scope at mint time.
    const msg = refusalText(gmail({ sourceConfig: { refreshToken: undefined } }));
    expect(msg).toContain('refreshToken');
    expect(msg).toContain('https://mail.google.com/');
    expect(msg).toContain('google-workspace-setup.md');
  });

  it('refuses non-email domains — the credential reads mail only', () => {
    const msg = refusalText(gmail({ syncConfig: { domains: ['email', 'file'] } }));
    expect(msg).toContain("'file'");
    expect(msg).toContain('mail only');
    expect(msg).toContain('separate mapping');
  });

  it('still refuses an incoherent TARGET for the email domain', () => {
    const msg = refusalText(gmail({ targetType: 'webdav' }));
    expect(msg).toContain('WebDAV');
    expect(msg).toContain("'email'");
  });
});

describe('the google-calendar and google-contacts sources (workplan 0045)', () => {
  const googleDav = (
    sourceType: 'google-calendar' | 'google-contacts',
    over: Record<string, unknown> = {},
  ) =>
    body({
      sourceType,
      targetType: sourceType === 'google-calendar' ? 'caldav' : 'carddav',
      sourceConfig: {
        username: 'owner@example.com',
        clientId: 'cid.apps.googleusercontent.com',
        clientSecret: 'cs',
        refreshToken: 'rt',
        ...((over.sourceConfig as Record<string, unknown>) ?? {}),
      },
      syncConfig: { domains: [sourceType === 'google-calendar' ? 'calendar' : 'contact'] },
      ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'sourceConfig')),
    });

  it('accepts the coherent shapes: calendar → caldav, contacts → carddav', () => {
    expect(CreateMappingSchema.safeParse(googleDav('google-calendar')).success).toBe(true);
    expect(CreateMappingSchema.safeParse(googleDav('google-contacts')).success).toBe(true);
  });

  it('refuses a missing refresh token naming the product\'s OWN scope', () => {
    const cal = refusalText(googleDav('google-calendar', { sourceConfig: { refreshToken: undefined } }));
    expect(cal).toContain('auth/calendar');
    const card = refusalText(googleDav('google-contacts', { sourceConfig: { refreshToken: undefined } }));
    expect(card).toContain('auth/carddav');
  });

  it('refuses domains beyond the pinned one — the consent reads one product', () => {
    const msg = refusalText(googleDav('google-calendar', { syncConfig: { domains: ['calendar', 'email'] } }));
    expect(msg).toContain('Google Calendar');
    expect(msg).toContain("'email'");
    expect(msg).toContain('separate mapping');
  });
});

describe('targetFolderPrefix — refused in the shared parser\'s words (hard rule 5)', () => {
  it('accepts a clean prefix and the empty default', () => {
    expect(CreateMappingSchema.safeParse(body({ targetFolderPrefix: 'Gmail' })).success).toBe(true);
    expect(CreateMappingSchema.safeParse(body()).success).toBe(true);
  });

  it("refuses '..' with the sentence the appliance's config loader uses", () => {
    const msg = refusalText(body({ targetFolderPrefix: 'a/../b' }));
    expect(msg).toContain('targetFolderPrefix');
    expect(msg).toContain('escape');
  });

  it('refuses a backslash, naming the separator rule', () => {
    const msg = refusalText(body({ targetFolderPrefix: 'Gmail\\INBOX' }));
    expect(msg).toContain('separator');
  });
});

describe("throttleConfig — refused in the shared parser's words (hard rule 5)", () => {
  it('accepts a clean config and the omitted default', () => {
    expect(
      CreateMappingSchema.safeParse(
        body({ throttleConfig: { maxConcurrent: 2, requestsPerSecond: 5 } }),
      ).success,
    ).toBe(true);
    expect(CreateMappingSchema.safeParse(body()).success).toBe(true);
  });

  it('refuses a non-integer field with the field named — the appliance sentence', () => {
    const msg = refusalText(body({ throttleConfig: { maxConcurrent: 'fast' } }));
    expect(msg).toContain('maxConcurrent');
  });
});

describe('domain-wide delegation (ADR-0033) — a key selects the second flow', () => {
  const KEY = '{"type":"service_account","client_email":"m@p.iam.gserviceaccount.com","private_key":"---"}';

  it('accepts a google source with ONLY a service-account key and a username — no OAuth trio', () => {
    const result = CreateMappingSchema.safeParse(
      body({
        sourceType: 'gmail',
        targetType: 'jmap',
        sourceConfig: { username: 'anna@example.nl', serviceAccountKey: KEY },
        syncConfig: { domains: ['email'] },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('a drive DWD source without a username is refused — one subject per mapping', () => {
    const msg = refusalText(
      body({
        sourceType: 'google-drive',
        targetType: 'webdav',
        sourceConfig: { username: '', serviceAccountKey: KEY },
        syncConfig: { domains: ['file'] },
      }),
    );
    expect(msg).toContain('NAMED user');
    expect(msg).toContain('one subject per mapping');
  });

  it('without a key, the refresh-token refusals still fire unchanged', () => {
    const msg = refusalText(
      body({
        sourceType: 'gmail',
        targetType: 'jmap',
        sourceConfig: { username: 'anna@example.nl' },
        syncConfig: { domains: ['email'] },
      }),
    );
    expect(msg).toContain('refreshToken');
  });
});

describe("a dropbox source (workplan 0055) — the trio shape, Dropbox's words in the refusal", () => {
  const dropbox = (over: Record<string, unknown> = {}) =>
    body({
      sourceType: 'dropbox',
      targetType: 'webdav',
      sourceConfig: {
        username: 'owner@example.nl',
        clientId: 'app-key',
        clientSecret: 'app-secret',
        refreshToken: 'rt',
        ...((over.sourceConfig as Record<string, unknown>) ?? {}),
      },
      syncConfig: { domains: ['file'] },
      ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'sourceConfig')),
    });

  it('accepts the coherent shape: dropbox → webdav, file domain, three credentials', () => {
    expect(CreateMappingSchema.safeParse(dropbox()).success).toBe(true);
  });

  it("refuses a missing refresh token, naming Dropbox's own vocabulary and the doc", () => {
    const msg = refusalText(dropbox({ sourceConfig: { refreshToken: undefined } }));
    expect(msg).toContain('refreshToken');
    expect(msg).toContain('App key');
    expect(msg).toContain('dropbox-setup.md');
  });

  it('refuses non-file domains — the credential reads the Dropbox API only', () => {
    const msg = refusalText(dropbox({ syncConfig: { domains: ['file', 'email'] } }));
    expect(msg).toContain("'email'");
    expect(msg).toContain('Dropbox API only');
  });

  it('still refuses an incoherent TARGET for the file domain', () => {
    const msg = refusalText(dropbox({ targetType: 'caldav' }));
    expect(msg).toContain('CalDAV');
    expect(msg).toContain("'file'");
  });
});

describe('a box source (workplan 0056) — the CCG shape: NO refresh token, a numeric subject', () => {
  const box = (over: Record<string, unknown> = {}) =>
    body({
      sourceType: 'box',
      targetType: 'webdav',
      sourceConfig: {
        username: 'owner@example.nl',
        clientId: 'box-client-id',
        clientSecret: 'box-client-secret',
        userId: '1234567890',
        ...((over.sourceConfig as Record<string, unknown>) ?? {}),
      },
      syncConfig: { domains: ['file'] },
      ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'sourceConfig')),
    });

  it('accepts the coherent shape: box → webdav, file domain, id + secret + subject', () => {
    expect(CreateMappingSchema.safeParse(box()).success).toBe(true);
  });

  it('does NOT demand a refresh token — Box rotates them, so none is stored', () => {
    // The same body with no refreshToken anywhere must parse; a schema that
    // quietly demanded the trio here would re-create the break-on-second-pass
    // failure the CCG choice exists to avoid.
    const parsed = CreateMappingSchema.safeParse(box());
    expect(parsed.success).toBe(true);
  });

  it('refuses a missing subject user id, naming the doc', () => {
    const msg = refusalText(box({ sourceConfig: { userId: undefined } }));
    expect(msg).toContain('userId');
    expect(msg).toContain('NUMERIC Box user id');
    expect(msg).toContain('box-setup.md');
  });

  it('refuses non-file domains — the credential reads the Box API only', () => {
    const msg = refusalText(box({ syncConfig: { domains: ['file', 'calendar'] } }));
    expect(msg).toContain("'calendar'");
    expect(msg).toContain('Box API only');
  });
});
