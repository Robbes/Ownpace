// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MAIL THAT NAMED A UUID.
 *
 * Every mail Ownpace sends about one migration opens with a line saying which:
 *
 *     Migration: 0cc9a844-4075-4d65-a562-374df8299b77
 *
 * That identifier appears on NO screen the reader has. They named this
 * migration "Gmail to Nextcloud" in the wizard; the UUID is our handle for the
 * row. So the one line whose whole job is to say which migration needs them
 * said nothing at all (owner report, 2026-09-14, on the weekly digest).
 *
 * The digest was fixed first, and fixing it alone is what makes this file
 * worth having: the fix lived in the digest's own renderer, so the five EVENT
 * mails — the ones sent the moment something happens, which is when a person
 * is most likely to act on one — kept printing the UUID. Two renderers, one
 * question, one of them answered.
 *
 * There is one rule now (`mappingLabel`) and both callers use it. These tests
 * pin that, and pin the three ways the rule can be got wrong:
 *
 *   - `??` instead of `||`, which lets a name of spaces through and produces
 *     `Migration: ` with nothing after the colon — worse than the UUID,
 *     because it reads like a value went missing;
 *   - a fallback that drops the id when there is no name, leaving the reader
 *     with no identifier at all;
 *   - the two renderers drifting, so the same migration is called two
 *     different things by two mails that arrive the same morning.
 */

import { describe, it, expect } from 'vitest';
import {
  mappingLabel,
  renderDigest,
  renderEvent,
  createFailureStreakGate,
  type MappingAttention,
  type NotificationEvent,
  type NotificationLocale,
} from './notifications.ts';
import { parseMappingConfig } from './config.ts';

const UUID = '0cc9a844-4075-4d65-a562-374df8299b77';
const NAME = 'Gmail to Nextcloud';

/** Every event that carries a mapping, built over the same ref. */
function mappingEvents(mapping: { id: string; name?: string | null }): NotificationEvent[] {
  return [
    { kind: 'runs_failing', mapping, consecutiveFailures: 3, lastError: 'ECONNRESET' },
    { kind: 'verification_finished', mapping, passed: false },
    { kind: 'migration_finished', mapping },
    { kind: 'rollback_finished', mapping, reason: 'the target rejected 4% of messages' },
    { kind: 'decision_raised', mapping, summary: 'a folder was renamed' },
  ];
}

const LOCALES: NotificationLocale[] = ['en', 'nl'];

describe('the label rule', () => {
  it('prefers the name', () => {
    expect(mappingLabel({ id: UUID, name: NAME })).toBe(NAME);
  });

  it('falls back to the id when there is no name', () => {
    // The id is a poor name, but it IS an identifier. Answering '' here would
    // leave the reader with nothing to match against the app at all.
    expect(mappingLabel({ id: UUID })).toBe(UUID);
    expect(mappingLabel({ id: UUID, name: null })).toBe(UUID);
  });

  it('treats a name of whitespace as no name', () => {
    // `??` passes this through; `||` does not. The difference on screen is
    // `Migration: ` against `Migration: 0cc9a844-...`.
    expect(mappingLabel({ id: UUID, name: '   ' })).toBe(UUID);
    expect(mappingLabel({ id: UUID, name: '' })).toBe(UUID);
  });

  it('trims a name somebody typed with a trailing space', () => {
    expect(mappingLabel({ id: UUID, name: ' Gmail to Nextcloud ' })).toBe(NAME);
  });
});

describe('every event mail names the migration', () => {
  for (const locale of LOCALES) {
    it(`prints the name, never the id, when the migration has one (${locale})`, () => {
      for (const event of mappingEvents({ id: UUID, name: NAME })) {
        const { body } = renderEvent(event, locale);
        expect(body, event.kind).toContain(NAME);
        // Not "also the UUID": the whole point is that it is not there to be
        // read past.
        expect(body, event.kind).not.toContain(UUID);
      }
    });

    it(`falls back to the id, never to an empty line (${locale})`, () => {
      for (const name of [undefined, null, '  ']) {
        for (const event of mappingEvents({ id: UUID, name })) {
          const { body } = renderEvent(event, locale);
          expect(body, `${event.kind} / ${String(name)}`).toContain(UUID);
          // The failure this catches: `Migration: ` followed by nothing.
          // Anchored to THAT line — other lines end in a colon on purpose
          // ("The last error was:" introduces the error beneath it).
          expect(body, `${event.kind} / ${String(name)}`).not.toMatch(
            /^(Migration|Migratie): *$/m,
          );
        }
      }
    });
  }

  it('says it on its own line, first, so it is read before the news', () => {
    const { body } = renderEvent(
      { kind: 'migration_finished', mapping: { id: UUID, name: NAME } },
      'en',
    );
    expect(body.split('\n')[0]).toBe(`Migration: ${NAME}`);
  });

  it('leaves the line out of a decision with no mapping, rather than printing a blank one', () => {
    // `decision_raised` is the one event that can be tenant-wide.
    const { body } = renderEvent({ kind: 'decision_raised', summary: 'a folder was renamed' }, 'en');
    expect(body).not.toContain('Migration:');
    expect(body).toContain('a folder was renamed');
  });
});

describe('the digest and the event agree', () => {
  const attention: MappingAttention = {
    mappingId: UUID,
    name: NAME,
    pendingDecisions: 0,
    deletionsWaiting: 0,
    movesWaiting: 0,
    failuresWaiting: 34,
    readyForCutover: false,
    autoApplied: 0,
    sharingOpen: 0,
  };

  for (const locale of LOCALES) {
    it(`calls the same migration the same thing in both mails (${locale})`, () => {
      // Two renderers, one question. They answered it differently for three
      // days, which is the whole reason `mappingLabel` exists.
      const digest = renderDigest([attention], locale, 'weekly');
      const event = renderEvent(
        { kind: 'migration_finished', mapping: { id: UUID, name: NAME } },
        locale,
      );
      // `renderDigest` answers `undefined` when nothing is waiting. This
      // fixture has 34 failures waiting, so an absent digest is a defect in
      // the fixture and worth failing on rather than asserting past.
      expect(digest, 'the fixture wants attention, so there is a digest').toBeDefined();
      expect(digest?.body).toContain(NAME);
      expect(digest?.body).not.toContain(UUID);
      expect(event.body).toContain(NAME);
      expect(event.body).not.toContain(UUID);
    });
  }

  it('both fall back to the id, rather than one of them going blank', () => {
    const unnamed = { ...attention, name: undefined };
    const digest = renderDigest([unnamed], 'en', 'weekly');
    expect(digest).toBeDefined();
    expect(digest?.body).toContain(UUID);
    expect(
      renderEvent({ kind: 'migration_finished', mapping: { id: UUID } }, 'en').body,
    ).toContain(UUID);
  });
});

describe('the streak gate carries the label to the mail it causes', () => {
  it('produces an event that names the migration', () => {
    const gate = createFailureStreakGate(1);
    const event = gate.record({ id: UUID, name: NAME }, 'failed', 'ECONNRESET');
    expect(event).toBeDefined();
    expect(renderEvent(event!, 'en').body).toContain(NAME);
  });

  it('still counts one outage once when the migration is renamed mid-outage', () => {
    // Keyed by id. Keyed by label, the rename would reset the streak and send
    // a second mail about an outage already reported.
    const gate = createFailureStreakGate(2);
    expect(gate.record({ id: UUID, name: NAME }, 'failed', 'boom')).toBeUndefined();
    expect(gate.record({ id: UUID, name: 'Gmail naar Nextcloud' }, 'failed', 'boom')).toBeDefined();
  });
});

describe('the appliance can name a migration without re-keying it', () => {
  const base = {
    tenantId: '00000000-0000-4000-8000-000000000001',
    mappingId: '11111111-1111-4111-8111-111111111111',
    source: {
      type: 'imap-oauth2',
      host: 'outlook.office365.com',
      port: 993,
      user: 'you@example.com',
      auth: { kind: 'xoauth2', tokenFromEnv: 'SOURCE_OAUTH_TOKEN' },
    },
    target: {
      type: 'jmap',
      baseUrl: 'https://mail.example.net',
      user: 'you@example.net',
      auth: { kind: 'basic', passwordFromEnv: 'TARGET_JMAP_PASSWORD' },
    },
  };

  it('accepts an optional name and leaves the seed alone', () => {
    // The mappingId is hashed into the row id and matched to claim a legacy
    // row, so it cannot be edited to read better. `name` is the way out that
    // costs nobody their history.
    const config = parseMappingConfig({ ...base, name: 'Rob to Nextcloud' });
    expect(config.name).toBe('Rob to Nextcloud');
    expect(config.mappingId).toBe(base.mappingId);
  });

  it('is optional — a config without one parses and carries no name', () => {
    expect(parseMappingConfig(base).name).toBeUndefined();
  });

  it('refuses a name that is not a non-empty string, rather than ignoring it', () => {
    // Silently dropping it would leave somebody wondering why their mail still
    // says the UUID after they thought they had fixed it.
    expect(() => parseMappingConfig({ ...base, name: '' })).toThrow(/name/);
    expect(() => parseMappingConfig({ ...base, name: 42 })).toThrow(/name/);
  });
});
