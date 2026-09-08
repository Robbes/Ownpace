// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A credential nobody can read, and nothing said so.
 *
 * The reference deployment lost about a tenth of every run for several hours on
 * 2026-09-08 to `Authentication failed: encrypted secret may be tampered or
 * encrypted with different key`, once a minute, with nothing naming the
 * connection. `SECRET_ENCRYPTION_KEY` was byte-identical on the host, in the
 * api container and in the task environment — so every configuration check an
 * operator would think to run reported that all was well. The rows were simply
 * older than a rotation nobody has a record of.
 *
 * ## What these tests hold
 *
 *  1. **A wrong key and a corrupt column are told APART.** They have different
 *     remedies — one is "type the credentials again", the other is "look at
 *     the row before you touch anything" — and a check that collapses them
 *     sends an operator to re-enter credentials over a truncated column.
 *  2. **No plaintext ever comes back.** `readSecretAt` returns a verdict, and
 *     the only values this module puts in front of a human are labels and ids
 *     it was handed. An operator tool that prints a credential has put it in a
 *     scrollback buffer, a screen share, and whatever captures CI logs.
 *  3. **Every decryptable column is covered.** The list was arrived at by
 *     asking `information_schema`, not by grepping, and it must stay that way:
 *     a check that covers `connection.secret_ref` alone leaves three columns
 *     rotting, which is the shape of half a check.
 *  4. **"Nothing found" is said out loud.** A report that lists only problems
 *     cannot be told apart from a report that did not run — the rule
 *     `operator.sh check` was already written under.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { encryptSecret, serializeEncryptedSecret } from '@openmig/core/secrets';
import {
  NOT_A_DECRYPTABLE_SECRET,
  readSecretAt,
  SECRET_SITES,
  secretSummary,
  tallySite,
  type SecretSite,
} from './secret-readability.ts';

/** A key of the right shape, so `encryptSecret` will work at all. */
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

/**
 * Encrypt under a named key, whatever key is otherwise in force.
 *
 * Encrypting under ONE key and decrypting under ANOTHER is the entire defect,
 * so the test has to hold two at once. `encryptSecret` and `decryptSecret` both
 * call `getEncryptionKey()` per operation rather than caching it at import, so
 * swapping the environment variable around the call is enough — and if that
 * ever changes, these tests fail rather than quietly encrypting everything
 * under one key and proving nothing.
 */
function encryptWith(key: string, plaintext: string): string {
  const previous = process.env.SECRET_ENCRYPTION_KEY;
  process.env.SECRET_ENCRYPTION_KEY = key;
  try {
    return serializeEncryptedSecret(encryptSecret(plaintext));
  } finally {
    if (previous === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
    else process.env.SECRET_ENCRYPTION_KEY = previous;
  }
}

describe('a wrong key and a corrupt column are different findings', () => {
  beforeAll(() => {
    process.env.SECRET_ENCRYPTION_KEY = KEY_A;
  });
  afterAll(() => {
    delete process.env.SECRET_ENCRYPTION_KEY;
  });

  it('reads a secret written under the key we hold', () => {
    expect(readSecretAt(encryptWith(KEY_A, 'hunter2'))).toBe('readable');
  });

  it('calls a secret written under a DIFFERENT key wrong-key, not malformed', () => {
    // The whole incident, in one assertion. The envelope is perfectly well
    // formed — right version, right nonce length, right tag length, valid
    // base64 — and only the GCM tag says otherwise.
    expect(
      readSecretAt(encryptWith(KEY_B, 'hunter2')),
      'A rotation leaves a VALID envelope that will not open. Reporting it as\n' +
        'malformed would send an operator looking for corruption that is not there.',
    ).toBe('wrong-key');
  });

  it('calls a column that is not an envelope malformed, not wrong-key', () => {
    for (const notAnEnvelope of [
      'not json at all',
      '{}',
      '{"v":1}',
      JSON.stringify({ v: 1, n: 'AAA', t: 'AAA' }),
      '',
    ]) {
      expect(
        readSecretAt(notAnEnvelope),
        `${JSON.stringify(notAnEnvelope)} is not an encryption envelope, so the remedy is\n` +
          'to look at the row — never to re-enter credentials, which would write a good\n' +
          'value over a broken one and destroy the evidence.',
      ).toBe('malformed');
    }
  });

  it('calls a well-shaped envelope with a mangled tag malformed rather than wrong-key', () => {
    // A tag of the wrong LENGTH is refused by the shape check before GCM ever
    // sees it, and that is corruption rather than a rotation.
    const envelope = JSON.parse(encryptWith(KEY_A, 'hunter2')) as Record<string, unknown>;
    envelope.t = 'AA';
    expect(readSecretAt(JSON.stringify(envelope))).toBe('malformed');
  });
});

describe('nothing this module produces carries a plaintext', () => {
  beforeAll(() => {
    process.env.SECRET_ENCRYPTION_KEY = KEY_A;
  });
  afterAll(() => {
    delete process.env.SECRET_ENCRYPTION_KEY;
  });

  const SECRET = 'correct-horse-battery-staple';

  it('returns a verdict and not the value, for a secret it CAN read', () => {
    // The readable case is the dangerous one: that is where a plaintext exists
    // to leak. `readSecretAt` returns a string either way, so assert on it.
    const verdict: string = readSecretAt(encryptWith(KEY_A, SECRET));
    expect(verdict).toBe('readable');
    expect(verdict).not.toContain(SECRET);
  });

  it('puts no plaintext in a tally, even when every row decrypts', () => {
    const site = SECRET_SITES[0]!;
    const tally = tallySite(site, [
      { id: 'c-1', label: 'Acme — mail (imap, source)', ref: encryptWith(KEY_A, SECRET) },
    ]);
    expect(JSON.stringify(tally)).not.toContain(SECRET);
    expect(tally.unreadable).toHaveLength(0);
    expect(tally.checked).toBe(1);
  });

  it('puts no ciphertext in a finding either', () => {
    const site = SECRET_SITES[0]!;
    const ref = encryptWith(KEY_B, SECRET);
    const tally = tallySite(site, [{ id: 'c-1', label: 'Acme — mail (imap, source)', ref }]);
    const rendered = JSON.stringify(tally);
    expect(tally.unreadable).toHaveLength(1);
    expect(tally.unreadable[0]!.verdict).toBe('wrong-key');
    // The label and the id are what an operator needs; the envelope is not.
    expect(rendered).toContain('Acme');

    // THE CIPHERTEXT FIELD, not the whole envelope, and the difference is the
    // entire assertion. `ref` is JSON, so once it is embedded and stringified
    // again its quotes are backslash-escaped and the raw string is no longer a
    // substring of the output — `not.toContain(ref)` therefore passes whatever
    // the code does. Found by breaking this test: leaking `row.ref` into the
    // remedy left all seventeen green. `c` is base64, survives escaping
    // unchanged, and is the part that actually matters.
    const ciphertext = (JSON.parse(ref) as { c: string }).c;
    expect(ciphertext.length).toBeGreaterThan(8);
    expect(
      rendered,
      'The stored ciphertext is not evidence an operator can act on, and printing it\n' +
        'puts the encrypted credential somewhere a screen share can reach.',
    ).not.toContain(ciphertext);
  });
});

describe('every column that can rot is covered', () => {
  it('names all four decryptable columns', () => {
    // Arrived at by asking information_schema for %secret%/%credential% on a
    // real migrated database, not by grepping the source. If a migration adds
    // a fifth, this list and this number move together — deliberately, so the
    // addition is a decision somebody makes rather than one they forget.
    expect(SECRET_SITES.map((s) => s.at).sort()).toEqual([
      'backup_target.secret_ref',
      'connection.encrypted_credentials',
      'connection.secret_ref',
      'mailbox_mapping.source_secret_ref',
    ]);
  });

  it('keeps the legacy column in the list rather than skipping it', () => {
    const legacy = SECRET_SITES.find((s) => s.at === 'connection.encrypted_credentials');
    expect(
      legacy?.legacy,
      'Nothing writes this column any more, but revoke-stored-credentials.ts READS it.\n' +
        'A row that cannot be decrypted there is a token an erasure reported revoking\n' +
        'and did not — which is a privacy failure, not housekeeping.',
    ).toBe(true);
  });

  it('excludes the hash column, which has no key and cannot rot', () => {
    expect(NOT_A_DECRYPTABLE_SECRET).toContain('mapping_link.secret_hash');
    expect(
      SECRET_SITES.map((s) => s.at),
      'mapping_link.secret_hash holds a HASH. Including it would report every link as\n' +
        'unreadable forever — a check that cries wolf about something working correctly.',
    ).not.toContain('mapping_link.secret_hash');
  });

  it('only ever looks at rows that actually hold a secret', () => {
    for (const site of SECRET_SITES) {
      expect(
        site.find,
        `${site.at} must exclude nulls. Several connection kinds legitimately store no\n` +
          'secret — the credential is a location, or the deployment carries the client —\n' +
          'and counting those as unreadable buries the real ones in noise.',
      ).toMatch(/IS NOT NULL/);
    }
  });

  it('every site returns exactly the three columns the runner reads', () => {
    for (const site of SECRET_SITES) {
      for (const column of [' AS id', ' AS label', ' AS ref']) {
        expect(site.find, `${site.at} must select${column}`).toContain(column);
      }
    }
  });

  it('names a remedy that acts on the label, never on a value', () => {
    for (const site of SECRET_SITES) {
      const remedy = site.remedy('Acme — mail (imap, source)');
      expect(remedy).toContain('Acme');
      expect(remedy.length).toBeGreaterThan(20);
    }
  });
});

describe('the summary says the good news out loud', () => {
  const site: SecretSite = SECRET_SITES[0]!;

  it('reports all-clear rather than printing nothing', () => {
    const summary = secretSummary([{ site, checked: 7, unreadable: [] }]);
    expect(
      summary,
      'A report that lists only problems cannot be told apart from a report that did\n' +
        'not run. This is the rule operator.sh check was already written under.',
    ).toContain('All 7');
  });

  it('distinguishes an empty deployment from a clean one', () => {
    expect(secretSummary([{ site, checked: 0, unreadable: [] }])).toContain('No stored secrets');
  });

  it('counts the wrong-key findings separately, because only those are unrecoverable', () => {
    const summary = secretSummary([
      {
        site,
        checked: 3,
        unreadable: [
          { at: site.at, id: 'a', label: 'A', verdict: 'wrong-key', remedy: 'x' },
          { at: site.at, id: 'b', label: 'B', verdict: 'malformed', remedy: 'y' },
        ],
      },
    ]);
    expect(summary).toContain('2 of 3');
    expect(summary).toContain('1 of those failed the authentication tag');
  });

  it('says so when nothing is a wrong-key failure, so a rotation is not blamed', () => {
    const summary = secretSummary([
      {
        site,
        checked: 2,
        unreadable: [{ at: site.at, id: 'a', label: 'A', verdict: 'malformed', remedy: 'x' }],
      },
    ]);
    expect(summary).toContain('corruption rather than a rotation');
  });
});
