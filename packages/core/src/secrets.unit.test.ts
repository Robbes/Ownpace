// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AES-GCM envelope for every stored credential.
 *
 * These verify:
 * 1. Round-trip encryption/decryption preserves data
 * 2. Tampered ciphertext/authTag throws
 * 3. Two encryptions of the same plaintext differ (per-call nonce)
 * 4. A missing or short key fails at startup
 *
 * **This file was named `secrets.test.ts` until 2026-08-07, and no vitest
 * project collected it.** The `unit` project matches only names carrying the
 * `.unit.` infix; `integration` and `e2e` want their own. So 245 lines of tests
 * over credential encryption ran in no suite, on no machine, in no CI job — and
 * nothing said so, because an uncollected file reports nothing at all rather
 * than reporting zero.
 *
 * Renamed, seven of twenty-two failed at once. None of them was a product
 * defect; all were rot that a single run would have caught:
 *
 *   - the `validateSecretKey` block sets `SECRET_ENCRYPTION_KEY` to deliberately
 *     BAD values and never restores it, so every test declared after it ran with
 *     an 8-character key. It restores in `finally` now, and the key is set per
 *     test rather than once for the file;
 *   - two assertions matched `/must be exactly 32 bytes/`; the product says
 *     "must be 32 bytes";
 *   - `parseEncryptedSecret('')` was expected to complain that the input is not
 *     an object. `''` is a string, so it goes to `JSON.parse` and fails as
 *     malformed JSON — the not-an-object branch needs a non-object that is not
 *     a string, e.g. `null`.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  validateSecretKey,
  parseEncryptedSecret,
  serializeEncryptedSecret,
  type EncryptedSecret,
} from './secrets.ts';

// Test encryption key (32 bytes / 256 bits in hex = 64 chars)
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Secret Encryption', () => {
  // Per test, not once for the file: the key-validation block below deliberately
  // installs broken keys, and no test may decide what the next one is testing.
  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    delete process.env.SECRET_ENCRYPTION_KEY;
  });

  describe('encryptSecret', () => {
    it('should encrypt a plaintext secret', () => {
      const plaintext = 'my-super-secret-credential';
      const encrypted = encryptSecret(plaintext);

      expect(encrypted).toEqual({
        v: expect.any(Number),
        n: expect.any(String),
        t: expect.any(String),
        c: expect.any(String),
      });

      // Verify base64 encoding
      expect(() => Buffer.from(encrypted.n, 'base64')).not.toThrow();
      expect(() => Buffer.from(encrypted.t, 'base64')).not.toThrow();
      expect(() => Buffer.from(encrypted.c, 'base64')).not.toThrow();
    });

    it('should generate DIFFERENT nonces for each encryption (proves per-call randomness)', () => {
      const plaintext = 'same-plaintext';
      
      const encrypted1 = encryptSecret(plaintext);
      const encrypted2 = encryptSecret(plaintext);
      const encrypted3 = encryptSecret(plaintext);

      // Nonces MUST be different (probability of collision is negligible with 96-bit random)
      expect(encrypted1.n).not.toBe(encrypted2.n);
      expect(encrypted2.n).not.toBe(encrypted3.n);
      expect(encrypted1.n).not.toBe(encrypted3.n);

      // Ciphertexts should also be different (due to different nonces)
      expect(encrypted1.c).not.toBe(encrypted2.c);
      expect(encrypted2.c).not.toBe(encrypted3.c);

      // But all should decrypt to the same plaintext
      expect(decryptSecret(encrypted1)).toBe(plaintext);
      expect(decryptSecret(encrypted2)).toBe(plaintext);
      expect(decryptSecret(encrypted3)).toBe(plaintext);
    });

    it('should include version byte in encrypted blob', () => {
      const encrypted = encryptSecret('test');
      expect(encrypted.v).toBe(1);
    });
  });

  describe('decryptSecret', () => {
    it('should decrypt to original plaintext (round-trip)', () => {
      const testCases = [
        'simple-password',
        'oauth2-token-abc123',
        '{"complex": "json-object"}',
        'unicode-🔐-characters',
        ''.padEnd(1000, 'x'), // Large secret
      ];

      for (const plaintext of testCases) {
        const encrypted = encryptSecret(plaintext);
        const decrypted = decryptSecret(encrypted);
        expect(decrypted).toBe(plaintext);
      }
    });

    it('should throw on tampered ciphertext', () => {
      const plaintext = 'secret';
      const encrypted = encryptSecret(plaintext);

      // Tamper with ciphertext
      const tampered: EncryptedSecret = {
        ...encrypted,
        c: Buffer.from('tampered', 'base64').toString('base64'),
      };

      expect(() => decryptSecret(tampered)).toThrow(/authentication failed|Decryption failed/i);
    });

    it('should throw on tampered auth tag', () => {
      const plaintext = 'secret';
      const encrypted = encryptSecret(plaintext);

      // Tamper with auth tag
      const tampered: EncryptedSecret = {
        ...encrypted,
        t: Buffer.from('tampered', 'base64').toString('base64'),
      };

      expect(() => decryptSecret(tampered)).toThrow(/authentication failed|Decryption failed/i);
    });

    it('should throw on tampered nonce', () => {
      const plaintext = 'secret';
      const encrypted = encryptSecret(plaintext);

      // Tamper with nonce
      const tampered: EncryptedSecret = {
        ...encrypted,
        n: Buffer.from('tampered', 'base64').toString('base64'),
      };

      expect(() => decryptSecret(tampered)).toThrow(/Decryption failed/i);
    });

    it('should throw on wrong version', () => {
      const encrypted = encryptSecret('test');
      
      const wrongVersion: EncryptedSecret = {
        ...encrypted,
        v: 999,
      };

      expect(() => decryptSecret(wrongVersion)).toThrow(/Unsupported encryption version/i);
    });

    it('should throw on missing fields', () => {
      expect(() => decryptSecret({ v: 1, n: '', t: '', c: '' })).toThrow(/missing nonce, tag, or ciphertext/i);
      expect(() => decryptSecret({ v: 1, n: 'test', t: '', c: '' } as EncryptedSecret)).toThrow(/missing nonce, tag, or ciphertext/i);
      expect(() => decryptSecret({} as EncryptedSecret)).toThrow(/missing version/i);
    });
  });

  describe('validateSecretKey', () => {
    it('should succeed with valid 32-byte key (hex)', () => {
      process.env.SECRET_ENCRYPTION_KEY = TEST_KEY;
      expect(() => validateSecretKey()).not.toThrow();
    });

    it('should succeed with valid 32-byte key (base64)', () => {
      const keyBase64 = Buffer.from(TEST_KEY, 'hex').toString('base64');
      process.env.SECRET_ENCRYPTION_KEY = keyBase64;
      expect(() => validateSecretKey()).not.toThrow();
    });

    it('should throw if key is missing', () => {
      delete process.env.SECRET_ENCRYPTION_KEY;
      expect(() => validateSecretKey()).toThrow(/SECRET_ENCRYPTION_KEY.*required/i);
    });

    it('should throw if key is too short', () => {
      process.env.SECRET_ENCRYPTION_KEY = 'short-key';
      expect(() => validateSecretKey()).toThrow(/must be 32 bytes/i);
    });

    it('should throw if key is wrong length (hex)', () => {
      process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef'; // 8 bytes = 16 hex chars
      expect(() => validateSecretKey()).toThrow(/must be 32 bytes/i);
    });

    it('should throw if key is wrong length (base64)', () => {
      process.env.SECRET_ENCRYPTION_KEY = 'YWJjZGVm'; // 6 bytes = 8 base64 chars
      expect(() => validateSecretKey()).toThrow(/must be 32 bytes/i);
    });

    it('names the length it got, so an operator can see what is wrong', () => {
      // Hard rule 9. "must be 32 bytes" alone leaves someone comparing an
      // invisible env var against a spec; the count is the whole diagnosis.
      process.env.SECRET_ENCRYPTION_KEY = 'abc';
      expect(() => validateSecretKey()).toThrow(/Got 3 characters/);
    });
  });

  describe('parseEncryptedSecret', () => {
    it('should parse JSON string', () => {
      const encrypted = encryptSecret('test');
      const json = serializeEncryptedSecret(encrypted);
      
      const parsed = parseEncryptedSecret(json);
      expect(parsed).toEqual(encrypted);
    });

    it('should parse object directly', () => {
      const encrypted = encryptSecret('test');
      const parsed = parseEncryptedSecret(encrypted);
      expect(parsed).toEqual(encrypted);
    });

    it('should throw on invalid JSON', () => {
      expect(() => parseEncryptedSecret('not-json')).toThrow(/Failed to parse encrypted secret JSON/i);
    });

    it('should throw on non-object input', () => {
      // Not `''`: a string goes to `JSON.parse` and fails as malformed JSON
      // long before the not-an-object branch, so the original assertion here
      // could never have passed. `null` and a bare number are the inputs that
      // actually reach it — `null` in particular, because `typeof null` is
      // 'object' and only the leading falsiness check catches it.
      expect(() => parseEncryptedSecret(null as unknown as object)).toThrow(/must be an object/i);
      expect(() => parseEncryptedSecret(7 as unknown as object)).toThrow(/must be an object/i);
      // …and via the string path, where JSON.parse succeeds and yields a
      // non-object. This is the case a stored column of `"null"` produces.
      expect(() => parseEncryptedSecret('null')).toThrow(/must be an object/i);
    });

    it('should throw on missing fields', () => {
      expect(() => parseEncryptedSecret({ v: 1 })).toThrow(/missing or invalid fields/i);
    });
  });

  describe('what the envelope does NOT do: separate tenants', () => {
    /**
     * This block was called "RLS-scoped secrets (cross-tenant isolation)" and
     * its one test encrypted two different strings, decrypted each, and
     * asserted the blobs were not equal. That is true of ANY two encryptions of
     * anything — no tenant is involved anywhere in it, and the per-call nonce
     * test three blocks up already proves the blobs differ. It was a vacuous
     * test wearing the name of the property the managed edition rests on.
     *
     * Worse than vacuous: actively misleading. `getEncryptionKey()` reads ONE
     * `SECRET_ENCRYPTION_KEY` for the whole process, so every tenant's
     * credentials are sealed under the same key and cryptography separates
     * nothing here. Isolation is Postgres RLS's job — see
     * `packages/ledger/src/rls.integration.test.ts`, which asserts it against a
     * real database. Writing that down is the point of this block.
     */
    it('seals every tenant under the SAME key, by design', () => {
      const a = encryptSecret('tenant-a-credential');

      // Anyone holding the process key reads any tenant's blob. Demonstrated
      // rather than described, because a reader who believes otherwise will
      // build on a guarantee that is not here.
      expect(decryptSecret(a)).toBe('tenant-a-credential');

      // Change the key and the same blob is unreadable — which is what makes
      // the statement above about the KEY rather than about the blob.
      process.env.SECRET_ENCRYPTION_KEY =
        'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
      expect(() => decryptSecret(a)).toThrow();
    });
  });

  describe('Key rotation readiness', () => {
    it('should include version byte for future key rotation', () => {
      const encrypted = encryptSecret('test');
      expect(encrypted.v).toBe(1);

      // Version enables migration: decrypt with old key, re-encrypt with new key
      // This test documents the pattern without implementing full rotation
      expect(typeof encrypted.v).toBe('number');
    });
  });
});
