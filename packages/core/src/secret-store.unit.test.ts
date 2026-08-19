// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * SecretStore: the envelope every stored credential goes through.
 *
 * **This file was named `secret-store.test.ts` until 2026-08-07, and no vitest
 * project collected it.** The `unit` project matches only names carrying the
 * `.unit.` infix; `integration` and `e2e` want their own. So 129 lines of tests over
 * credential encryption ran in no suite, on no machine, in no CI job — and
 * nothing said so, because a test file that is never collected reports nothing
 * at all rather than reporting zero.
 *
 * Renamed, nine of eleven failed at once. Not because the product broke: because
 * `should throw without key` DELETED `SECRET_ENCRYPTION_KEY` from the
 * environment and never put it back, so every test declared after it ran with
 * no key. An ordering leak that would have been caught the first time anyone
 * ran the file. It restores the key now, in a `finally`, so it holds even if
 * the assertion itself throws.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { SecretStore, initSecretStore } from './secret-store.ts';

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('SecretStore', () => {
  // Per test, not once for the file. A single test that changes the environment
  // must not be able to decide what the rest of the file is testing.
  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    delete process.env.SECRET_ENCRYPTION_KEY;
  });

  describe('initSecretStore', () => {
    it('should succeed with valid key', () => {
      expect(() => initSecretStore()).not.toThrow();
    });

    it('should throw without key', () => {
      delete process.env.SECRET_ENCRYPTION_KEY;
      try {
        expect(() => initSecretStore()).toThrow(/SECRET_ENCRYPTION_KEY.*required/i);
      } finally {
        process.env.SECRET_ENCRYPTION_KEY = TEST_KEY;
      }
    });
  });

  describe('SecretStore.encrypt', () => {
    it('should encrypt a string', () => {
      const result = SecretStore.encrypt('my-secret');
      expect(result).toHaveProperty('encrypted');
      expect(result).toHaveProperty('encryptedAt');
      expect(result.encrypted.v).toBe(1);
    });

    it('should produce different blobs for same input (nonce randomness)', () => {
      const enc1 = SecretStore.encrypt('same-input');
      const enc2 = SecretStore.encrypt('same-input');
      expect(enc1.encrypted.n).not.toBe(enc2.encrypted.n);
      expect(enc1.encrypted.c).not.toBe(enc2.encrypted.c);
    });
  });

  describe('SecretStore.decrypt', () => {
    it('should decrypt to original value', () => {
      const original = 'my-super-secret-credential';
      const encrypted = SecretStore.encrypt(original);
      const decrypted = SecretStore.decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should decrypt from string input', () => {
      const original = 'test-credential';
      const encrypted = SecretStore.encrypt(original);
      const jsonString = JSON.stringify(encrypted.encrypted);
      const decrypted = SecretStore.decrypt(jsonString);
      expect(decrypted).toBe(original);
    });

    it('should throw on tampered data', () => {
      const encrypted = SecretStore.encrypt('secret');
      const tampered = {
        ...encrypted.encrypted,
        c: Buffer.from('tampered').toString('base64'),
      };
      expect(() => SecretStore.decrypt(tampered)).toThrow(/authentication failed|Decryption failed/i);
    });
  });

  describe('SecretStore.encryptCredentials / decryptCredentials', () => {
    it('should encrypt and decrypt credential object', () => {
      const credentials = {
        username: 'user@example.com',
        password: 'super-secret-password',
        token: 'oauth2-token-abc123',
      };

      const encrypted = SecretStore.encryptCredentials(credentials);
      const decrypted = SecretStore.decryptCredentials(encrypted);

      expect(decrypted).toEqual(credentials);
    });

    it('should handle complex credential structures', () => {
      const credentials = {
        imap_host: 'imap.example.com',
        imap_port: '993',
        oauth2_token: 'ya29.a0AfH6SMB...',
        oauth2_refresh_token: '1//0g...',
        expires_at: '2024-12-31T23:59:59Z',
      };

      const encrypted = SecretStore.encryptCredentials(credentials);
      const decrypted = SecretStore.decryptCredentials(encrypted);

      expect(decrypted).toEqual(credentials);
    });

    it('should throw on invalid JSON after decryption', () => {
      // This used to corrupt the ciphertext and expect a JSON parse failure.
      // It cannot work: AES-GCM authenticates before it decrypts, so tampered
      // bytes are rejected as `Authentication failed` and `JSON.parse` is never
      // reached. The test asserted an error message the product cannot produce
      // that way — invisible while the file was uncollected.
      //
      // The reachable case is a blob that decrypts PERFECTLY and simply is not
      // JSON: a row written by `encrypt()` and read back by
      // `decryptCredentials()`, which is a real mix-up between the single-value
      // and object forms and the one this branch exists for.
      const notJson = SecretStore.encrypt('not-json-data');
      expect(() => SecretStore.decryptCredentials(notJson)).toThrow(
        /Failed to parse decrypted credentials/i,
      );
      // …and the same bytes still come back intact through the single-value
      // path, so the failure above is about SHAPE and not about the envelope.
      expect(SecretStore.decrypt(notJson)).toBe('not-json-data');
    });

    it('rejects tampered ciphertext before it ever parses', () => {
      // The property the test above was reaching for. GCM's tag is checked
      // first, so a modified blob fails as a forgery rather than as bad JSON —
      // which matters, because "bad JSON" reads like a data problem and this is
      // an integrity failure on a stored credential.
      const encrypted = SecretStore.encryptCredentials({ token: 'abc' });
      // The INNER blob, not the envelope. `decrypt` reads `.encrypted` when it
      // is present, so spreading the envelope and adding a stray `c` alongside
      // it changes nothing and the test passes while proving nothing — which is
      // exactly what the first version of this assertion did.
      const tampered = {
        ...encrypted.encrypted,
        c: Buffer.from('invalid').toString('base64'),
      };
      expect(() => SecretStore.decryptCredentials(tampered)).toThrow(/authentication failed/i);
    });
  });

  describe('Cross-tenant isolation', () => {
    it('should encrypt/decrypt independently for different tenants', () => {
      const tenantACreds = { token: 'tenant-a-token' };
      const tenantBCreds = { token: 'tenant-b-token' };

      const encryptedA = SecretStore.encryptCredentials(tenantACreds);
      const encryptedB = SecretStore.encryptCredentials(tenantBCreds);

      const decryptedA = SecretStore.decryptCredentials(encryptedA);
      const decryptedB = SecretStore.decryptCredentials(encryptedB);

      expect(decryptedA).toEqual(tenantACreds);
      expect(decryptedB).toEqual(tenantBCreds);
      expect(decryptedA).not.toEqual(decryptedB);
    });
  });
});
