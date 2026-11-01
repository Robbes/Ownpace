// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RUNTIME ONLY ITS OWN HOST VOUCHED FOR: the `node.exe` every Windows payload
 * ships was checked against a `SHASUMS256.txt` fetched from the same
 * `nodejs.org` release directory as the binary, so whoever could change the one
 * could change the other (workplan 0119 §2.5, 2026-11-01).
 *
 * The payload carries its own Node (ADR-0027), and `windows-payload.yml`
 * attaches it to every release tag. Until 2026-11-01
 * `scripts/package-appliance.mjs` downloaded `SHASUMS256.txt`, took the sum
 * it listed for `win-x64/node.exe`, downloaded `node.exe` from the same
 * directory, and compared the two. A host, or anything between it and the
 * runner, that served a different binary had only to serve a list naming it,
 * and the check passed. No signature was read and no sum was committed; 0119
 * §2.5 named it as a follow-up the day #1773 pinned the Atlas CLI.
 *
 * Now the sum a download must have is committed (`NODE_RUNTIME_SHA256`), per
 * Node version and platform, and is read before anything is fetched. The
 * release's own `SHASUMS256.txt` and `.sig` are committed beside a pinned copy
 * of the Node.js release keyring (`scripts/node-release/`, the keyring from
 * github.com/nodejs/release-keys at a named commit), and the committed sum must
 * be the one that list gives, under a good signature. The host is asked for
 * `node.exe` alone, and its bytes must hash to the committed sum. This holds:
 *
 * - The version `apps/selfhost/Dockerfile` names (the one the payload takes)
 *   has a committed sum for every platform the packager knows, no other
 *   version sits beside it, and the committed list is that version's, signed,
 *   and gives the same sums, checked with the real `gpgv`. So Dependabot's next
 *   Node image pull request fails here until somebody commits the new list and
 *   sums, and a wrong sum fails here, not at the next build. The checker is run
 *   on mutations of its own: a moved Dockerfile, a missing platform, a
 *   malformed sum, a stale second version, one sum for two files, a sum that
 *   is not the signed one, a list of another release.
 * - The download, against a stubbed host: a tampered `node.exe` served with a
 *   list naming it (what the old check passed) is refused, and the host's
 *   list is never asked for; so is a version with no committed sum, a
 *   committed sum the signed list does not give, and a list whose signature
 *   does not verify, each before the host is asked for anything.
 * - The signature, with the real `gpgv` and the committed keyring: good on
 *   the committed list, by the key that signed it; refused with one byte of
 *   the list changed, with an empty keyring, with the signature given twice,
 *   and with no `gpgv` to run. With two throwaway keys (#1780's review): a
 *   list signed by a key BEFORE that key expired is good, on any date after,
 *   since four of the eight keys in the pinned keyring carry an expiry date
 *   and gpgv answers EXPKEYSIG, never GOODSIG, once it has passed; a list
 *   signed after its key's expiry, and one signed by a revoked key, are
 *   refused, each saying so, and neither error calls the list unsigned.
 * - The keyring is the file it says it is: its git blob id is the one
 *   `NODE_RELEASE_KEYS` records for that path at that commit upstream.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NODE_RELEASE_DIR,
  NODE_RELEASE_KEYRING,
  NODE_RELEASE_KEYS,
  NODE_RUNTIMES,
  NODE_RUNTIME_SHA256,
  fetchVerifiedNodeRuntime,
  nodeRuntimeVersion,
  pinnedNodeSha256,
  shaFor,
  signedPinFor,
  verifyNodeReleaseSignature,
  verifySha256,
} from './package-appliance.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = 'apps/selfhost/Dockerfile';
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const SHASUMS = readFileSync(join(NODE_RELEASE_DIR, 'SHASUMS256.txt'));
const SIGNATURE = readFileSync(join(NODE_RELEASE_DIR, 'SHASUMS256.txt.sig'));

type Pins = Record<string, Record<string, string>>;

/**
 * Every way the committed sums can fail to cover the runtime the Dockerfile
 * names, against the committed list in `dir`; empty when they cover it.
 */
function pinProblems(dockerfileText: string, pins: Pins, dir = NODE_RELEASE_DIR): string[] {
  const version = nodeRuntimeVersion(dockerfileText);
  const problems: string[] = [];
  for (const platform of Object.keys(NODE_RUNTIMES)) {
    try {
      signedPinFor(version, platform, { pins, dir });
    } catch (e) {
      problems.push(`${version} ${platform}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  for (const other of Object.keys(pins).filter((v) => v !== version)) {
    problems.push(`${other} is pinned beside ${version}, which the Dockerfile names: one version only`);
  }
  const forVersion = Object.hasOwn(pins, version) ? pins[version]! : {};
  for (const extra of Object.keys(forVersion).filter((p) => !Object.hasOwn(NODE_RUNTIMES, p))) {
    problems.push(`${version} ${extra} is pinned, and the packager knows no such platform`);
  }
  const sums = Object.values(forVersion);
  if (new Set(sums).size !== sums.length) problems.push(`${version}: one sum is pinned for two files`);
  return problems;
}

describe('the runtime the Dockerfile names has a committed sum, and it is the signed one', () => {
  const dockerfile = readFileSync(join(REPO, DOCKERFILE), 'utf-8');
  const version = nodeRuntimeVersion(dockerfile);

  it(`for every platform, for ${DOCKERFILE}'s version only, as the committed signed list gives it`, () => {
    expect(pinProblems(dockerfile, NODE_RUNTIME_SHA256)).toEqual([]);
    expect(Object.keys(NODE_RUNTIME_SHA256)).toEqual([version]);
    expect(Object.keys(NODE_RUNTIME_SHA256[version]!).sort()).toEqual(Object.keys(NODE_RUNTIMES).sort());
  });

  it('fails a Node move that did not move the sums, and every other gap (mutations)', () => {
    const moved = dockerfile.replace(/^FROM node:\d+\.\d+\.\d+-/m, 'FROM node:26.99.0-');
    expect(moved).not.toBe(dockerfile);
    const movedProblems = pinProblems(moved, NODE_RUNTIME_SHA256).join('\n');
    expect(movedProblems).toContain('No SHA-256 is committed for Node v26.99.0 win-x64');
    expect(movedProblems).toContain(`${version} is pinned beside v26.99.0`);
    // The sums moved and the list did not: the old list vouches for nothing.
    const movedPins = { 'v26.99.0': NODE_RUNTIME_SHA256[version]! };
    expect(pinProblems(moved, movedPins).join('\n')).toContain('is not the list of Node v26.99.0');

    const good = NODE_RUNTIME_SHA256[version]!;
    const flip = (s: string) => (s[0] === '0' ? '1' : '0') + s.slice(1);
    const mutations: Record<string, Pins> = {
      'a platform with no sum': { [version]: { 'win-x64': good['win-x64']! } },
      'no entry at all': {},
      'a sum one character short': { [version]: { ...good, 'win-x64': good['win-x64']!.slice(1) } },
      'a sum in capitals': { [version]: { ...good, 'win-x64': good['win-x64']!.toUpperCase() } },
      'a win-x64 sum that is not the signed one': { [version]: { ...good, 'win-x64': flip(good['win-x64']!) } },
      'a win-arm64 sum that is not the signed one': { [version]: { ...good, 'win-arm64': flip(good['win-arm64']!) } },
      "the release's zip in place of node.exe": {
        [version]: { ...good, 'win-x64': shaFor(SHASUMS.toString('utf-8'), `node-${version}-win-x64.zip`)! },
      },
      'a stale version beside': { [version]: good, 'v24.22.1': { 'win-x64': 'ab'.repeat(32), 'win-arm64': 'cd'.repeat(32) } },
      'one sum for both files': { [version]: { 'win-x64': good['win-x64']!, 'win-arm64': good['win-x64']! } },
      'a platform the packager does not know': { [version]: { ...good, 'linux-x64': 'ef'.repeat(32) } },
    };
    for (const [name, pins] of Object.entries(mutations)) {
      expect(pinProblems(dockerfile, pins), name).not.toEqual([]);
    }
  });

  it('refuses a version with no sum, saying how to move Node, and never reads a prototype key as one', () => {
    expect(() => pinnedNodeSha256('v26.99.0', 'win-x64')).toThrow(/release-keys\.kbx" scripts\/node-release\/SHASUMS256\.txt\.sig/);
    for (const key of ['__proto__', 'constructor', 'toString']) {
      expect(() => pinnedNodeSha256(key, 'win-x64')).toThrow(/No SHA-256 is committed/);
      expect(() => pinnedNodeSha256(version, key)).toThrow(/No SHA-256 is committed/);
    }
  });
});

describe('nothing the host serves can change what passes (a stubbed nodejs.org)', () => {
  const VERSION = 'v26.0.0-test';
  const RUNTIME = Buffer.from('the node.exe this repository pins');
  const TAMPERED = Buffer.from('a node.exe somebody else built');
  const PINS: Pins = { [VERSION]: { 'win-x64': sha256(RUNTIME), 'win-arm64': 'ab'.repeat(32) } };
  const list = (sum: string) =>
    `${'cd'.repeat(32)}  node-${VERSION}-win-x64.zip\n${'ef'.repeat(32)}  node-${VERSION}.tar.gz\n${sum}  win-x64/node.exe\n`;

  /** A committed list in a directory of its own; the signature check is stubbed beside it. */
  function committed(text: string) {
    const dir = mkdtempSync(join(tmpdir(), 'openmig-node-release-'));
    writeFileSync(join(dir, 'SHASUMS256.txt'), text);
    writeFileSync(join(dir, 'SHASUMS256.txt.sig'), 'a signature the stub accepts');
    return dir;
  }
  /** A host serving `files` by name under the release directory, recording what was asked. */
  function host(files: Record<string, Buffer | string>) {
    const asked: string[] = [];
    const fetchImpl = async (url: string) => {
      const name = url.replace(`https://nodejs.org/dist/${VERSION}/`, '');
      asked.push(name);
      const body = files[name];
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(typeof body === 'string' ? body : new Uint8Array(body));
    };
    return { asked, fetchImpl: fetchImpl as unknown as typeof fetch };
  }
  const signed = () => 'TESTKEY';
  async function run(
    h: ReturnType<typeof host>,
    { text = list(sha256(RUNTIME)), platform = 'win-x64', version = VERSION, verifySignature = signed } = {},
  ) {
    const dir = committed(text);
    try {
      return await fetchVerifiedNodeRuntime(version, platform, { fetchImpl: h.fetchImpl, pins: PINS, dir, verifySignature });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('stages the pinned bytes, asking the host for node.exe alone', async () => {
    const h = host({ 'win-x64/node.exe': RUNTIME });
    const got = await run(h);
    expect(Buffer.compare(got.bytes, RUNTIME)).toBe(0);
    expect(got.sha256).toBe(sha256(RUNTIME));
    expect(got.signer).toBe('TESTKEY');
    expect(h.asked).toEqual(['win-x64/node.exe']);
  });

  it('refuses a tampered node.exe served with a list that names it, which the old check passed', async () => {
    const forged = list(sha256(TAMPERED));
    // The check before 2026-11-01, on the host's two files: it said yes.
    expect(() => verifySha256(TAMPERED, shaFor(forged, 'win-x64/node.exe')!, 'the old check')).not.toThrow();

    const h = host({ 'SHASUMS256.txt': forged, 'SHASUMS256.txt.sig': 'sig', 'win-x64/node.exe': TAMPERED });
    await expect(run(h)).rejects.toThrow(/Checksum mismatch[\s\S]*never a warning/);
    expect(h.asked).toEqual(['win-x64/node.exe']);
  });

  it('refuses before asking the host anything: no committed sum, an unknown platform, a sum the signed list does not give, a list not signed', async () => {
    const h = host({ 'win-x64/node.exe': RUNTIME });
    await expect(run(h, { version: 'v26.99.0' })).rejects.toThrow(/No SHA-256 is committed for Node v26\.99\.0/);
    await expect(run(h, { platform: 'linux-x64' })).rejects.toThrow(/Unknown --with-node platform/);
    await expect(run(h, { text: list(sha256(TAMPERED)) })).rejects.toThrow(
      /lists [0-9a-f]{64} for win-x64\/node\.exe, and scripts\/package-appliance\.mjs pins/,
    );
    await expect(run(h, { text: `${sha256(RUNTIME)}  win-x64/node.pdb\n${'ee'.repeat(32)}  node-${VERSION}.tar.gz\n` })).rejects.toThrow(
      /lists nothing for win-x64\/node\.exe/,
    );
    await expect(run(h, { text: list(sha256(RUNTIME)).replaceAll(VERSION, 'v26.0.1-test') })).rejects.toThrow(
      /is not the list of Node v26\.0\.0-test/,
    );
    const unsigned = () => {
      throw new Error("SHASUMS256.txt's signature does not verify");
    };
    await expect(run(h, { verifySignature: unsigned })).rejects.toThrow(/does not verify/);
    expect(h.asked).toEqual([]);
  });

  it('refuses a host that answers 404', async () => {
    await expect(run(host({}))).rejects.toThrow(/win-x64\/node\.exe: HTTP 404/);
  });
});

describe('the release keys are pinned, and gpgv checks with them alone', () => {
  it(`is ${NODE_RELEASE_KEYS.path} at ${NODE_RELEASE_KEYS.repo}@${NODE_RELEASE_KEYS.commit.slice(0, 8)}, by its git blob id`, () => {
    const bytes = readFileSync(NODE_RELEASE_KEYRING);
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    expect(blob).toBe(NODE_RELEASE_KEYS.blob);
    expect(NODE_RELEASE_KEYS.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('verifies the committed list, and names the key that signed it', () => {
    expect(verifyNodeReleaseSignature(SHASUMS, SIGNATURE)).toMatch(/^[0-9A-F]{40}$/);
  });

  it('refuses one byte changed, a keyring without the signer, two signatures, and no gpgv', () => {
    const text = SHASUMS.toString('utf-8');
    const changed = Buffer.from(text.replace(/^([0-9a-f])/, (c) => (c === '0' ? '1' : '0')));
    expect(changed.equals(SHASUMS)).toBe(false);
    expect(() => verifyNodeReleaseSignature(changed, SIGNATURE)).toThrow(/does not verify[\s\S]*\[GNUPG:\] BADSIG /);

    const dir = mkdtempSync(join(tmpdir(), 'openmig-empty-keyring-'));
    try {
      mkdirSync(join(dir, 'k'));
      const empty = join(dir, 'k', 'empty.kbx');
      writeFileSync(empty, '');
      expect(() => verifyNodeReleaseSignature(SHASUMS, SIGNATURE, { keyring: empty })).toThrow(/\[GNUPG:\] NO_PUBKEY /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(() => verifyNodeReleaseSignature(SHASUMS, Buffer.concat([SIGNATURE, SIGNATURE]))).toThrow(/does not verify/);
    expect(() => verifyNodeReleaseSignature(SHASUMS, SIGNATURE, { gpgv: join(REPO, 'no-such-gpgv') })).toThrow(
      /Could not run .*no-such-gpgv[\s\S]*not optional/,
    );
  });

  /**
   * Two throwaway keys, made for this test with `gpg --faked-system-time` and
   * their secret halves discarded (#1780's review): EXPIRED, created 2024-01-01
   * and given an expiry of 2025-01-31, which signed LIST on 2024-06-01 (before)
   * and on 2025-03-01 (after; the key had no expiry yet when it signed, and was
   * given one later); and REVOKED, which signed LIST on 2024-06-01 and was then
   * revoked. Today gpgv says EXPKEYSIG, or REVKEYSIG, with exit 0, a VALIDSIG
   * and `Good signature` for all three, and GOODSIG for none.
   */
  const THROWAWAY_KEYS = Buffer.from(
    'mDMEZZIAgBYJKwYBBAHaRw8BAQdAUIyx5ng6CmTCCojiaRmHuW2Flxa98wla+qCGn0zf7cq0KkV4cGlyZWQgVGVzdCBLZXkgPGV4cGlyZWRAZXhhbXBsZS5pbnZhbGlkPoiZBBMWCgBBAhsDBQsJCAcCAiICBhUKCQgLAgQWAgMBAh4HAheAFiEEBKJdra091n4j5NE/qXkxZ3Y8GAEFAmWTUgAFCQIKusAACgkQqXkxZ3Y8GAE4MQEAiLeb4tAzuMq/k61UUlEGEF2XPPx8C2ywpjTNB2PhhRgBALYpn147YZcS1Eh9yHdCrxA8R4zy8A3qlFXyPnyqSnMAmDMEZZIAgBYJKwYBBAHaRw8BAQdAMDrS825jwfCYJCfSJloVZncbbT9TWyyFmtOQkuuanlaIeAQgFgoAIBYhBGW37LHsUYxgAdwgwGfQroYBhnSaBQJlkgCAAh0AAAoJEGfQroYBhnSaylUA/R0QEiAwMdIHfq2/VJwMDwYNPz1KXxhUvGaxEnZb/u8gAQDwjSawq0YBr5VI3ttJVdTRErVZZdmduZlmVZvnapLcCLQqUmV2b2tlZCBUZXN0IEtleSA8cmV2b2tlZEBleGFtcGxlLmludmFsaWQ+iJMEExYKADsWIQRlt+yx7FGMYAHcIMBn0K6GAYZ0mgUCZZIAgAIbAwULCQgHAgIiAgYVCgkICwIEFgIDAQIeBwIXgAAKCRBn0K6GAYZ0mnElAQDvOjkGdnk6AKvoBHkCZPSPriA6Jv6DluYLhQwTTniOGAD/ZDZWHV2zpn5ZHuWfdKTovWDbn+Ss9qIf8nH1hCp9SAA=',
    'base64',
  );
  const EXPIRED = '04A25DADAD3DD67E23E4D13FA9793167763C1801';
  const REVOKED = '65B7ECB1EC518C6001DC20C067D0AE860186749A';
  const LIST = Buffer.from(`${'ab'.repeat(32)}  node-v0.0.0-test.tar.gz\n`);
  const SIGNED = {
    before: 'iHUEABYKAB0WIQQEol2trT3WfiPk0T+peTFndjwYAQUCZlpkgAAKCRCpeTFndjwYASaOAQC8p6Bc1BvlQVGw3e0OO5HO4C9eFJOZVkOsjUJueR33wgD/ZlLNaxCXkDLKI/8gIorKwiVs3fGfnspq08tRNXrLfAc=',
    after: 'iHUEABYKAB0WIQQEol2trT3WfiPk0T+peTFndjwYAQUCZ8JOAAAKCRCpeTFndjwYAaWoAQDRokLt2j5xMJ9n+216KnvUirs5PbrFWy8akiRW0OR5qwEA3EwyZ8VrbHh8IFEAVabTEfrZP8SKLKYL+A8o5pokMQo=',
    revoked: 'iHUEABYKAB0WIQRlt+yx7FGMYAHcIMBn0K6GAYZ0mgUCZlpkgQAKCRBn0K6GAYZ0mvhCAQCZlqPJY+MbfH9iRi1SXRGy23fZMuTmXYPdY/zxi62ybwEAnHUqkNyCwalZwvAn4fWh6Pzhna3kogKPJ+0aRktxHg0=',
  };

  it('takes a list signed before its key expired, and refuses one signed after, or by a revoked key, saying which', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openmig-throwaway-keyring-'));
    try {
      const keyring = join(dir, 'throwaway.gpg');
      writeFileSync(keyring, THROWAWAY_KEYS);
      const check = (which: keyof typeof SIGNED, list = LIST) =>
        () => verifyNodeReleaseSignature(list, Buffer.from(SIGNED[which], 'base64'), { keyring });
      // Signed 2024-06-01, expired 2025-01-31: good on every date after, as it was the day it was made.
      expect(check('before')()).toBe(EXPIRED);
      expect(check('before', Buffer.from(LIST.toString().replace('ab', 'ac')))).toThrow(/does not verify[\s\S]*\[GNUPG:\] BADSIG /);
      expect(check('after')).toThrow(
        new RegExp(`made 2025-03-01T00:00:00\\.000Z by ${EXPIRED}, whose key in .* expired 2025-01-31T12:00:00\\.000Z: not before its expiry[\\s\\S]*\\[GNUPG:\\] EXPKEYSIG `),
      );
      expect(check('revoked')).toThrow(new RegExp(`signed by a key .* holds as revoked[\\s\\S]*\\[GNUPG:\\] REVKEYSIG [\\s\\S]*${REVOKED}`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
