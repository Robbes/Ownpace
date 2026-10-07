// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE NAME THE RELAY WOULD NOT ACCEPT.
 *
 * Two senders, one relay, two shapes of "from".
 *
 * The API sends through nodemailer, which accepts a full From line —
 * `"Ownpace [no-reply]" <no-reply@ownpace.eu>` — and quotes the display name
 * into the header properly. `deploy/compose/.env` carries that form precisely
 * so the mail a user receives shows a name and not a bare mailbox.
 *
 * The identity provider has its own mail path, and it has TWO fields where the
 * API has one: `senderAddress` is the envelope, and `senderName` is stamped
 * into the From header VERBATIM AND UNQUOTED. `setup-zitadel.sh` used to hand
 * the whole From line to `senderAddress`, so the envelope carried the brackets
 * and the angle brackets too. Proton checks that the header's address matches
 * the envelope, decides it does not, and refuses the mail:
 *
 *     5.7.26 Submission not allowed for messages in which MAIL FROM
 *     <no-reply@ownpace.eu> does not match header From
 *     <Ownpace [no-reply] <no-reply@ownpace.eu>>
 *
 * Which is a worse failure than it sounds: Zitadel's mail is the verification
 * link, the password reset, the invitation to set a first password. Those fail
 * with the account created and the screen telling the user to check mail that
 * will never arrive.
 *
 * So the From line is split: the address out of the angle brackets for the
 * envelope, and a name for the header that is PLAIN ENOUGH TO SURVIVE UNQUOTED.
 * A name carrying brackets, parentheses, commas or quotes is dropped in favour
 * of the stack's own name, because a name the relay chokes on is not a name
 * anybody receives.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SETUP = join(REPO_ROOT, 'deploy/compose/setup-zitadel.sh');

/** Pull `split_from_line` out of the script so the test runs the real body. */
function splitter(): string {
  const src = readFileSync(SETUP, 'utf8');
  const start = src.indexOf('split_from_line() {');
  expect(start, 'setup-zitadel.sh defines no split_from_line()').toBeGreaterThan(-1);
  const end = src.indexOf('\n}\n', start);
  expect(end, 'split_from_line() is not closed').toBeGreaterThan(start);
  return src.slice(start, end + 3);
}

function split(from: string): { addr: string; name: string } {
  const dir = mkdtempSync(join(tmpdir(), 'split-from-'));
  const file = join(dir, 'split.sh');
  writeFileSync(file, `${splitter()}\nsplit_from_line "$1"\nprintf '%s\\n%s' "$SMTP_SENDER_ADDR" "$SMTP_SENDER_NAME"\n`);
  const r = spawnSync('bash', [file, from], { encoding: 'utf8' });
  expect(r.status, `split_from_line failed on: ${from}\n${r.stderr}`).toBe(0);
  const [addr, name] = r.stdout.split('\n');
  return { addr: addr ?? '', name: name ?? '' };
}

describe('the From line is split for a provider with two fields', () => {
  it('puts the bare address in the envelope, whatever the From line looks like', () => {
    // The envelope is what the relay compares against, and it must be an
    // address and nothing else.
    for (const from of [
      'no-reply@ownpace.eu',
      'Ownpace <no-reply@ownpace.eu>',
      '"Ownpace" <no-reply@ownpace.eu>',
      '"Ownpace [no-reply]" <no-reply@ownpace.eu>',
      'Ownpace (no-reply) <no-reply@ownpace.eu>',
    ]) {
      expect(split(from).addr, `envelope address for: ${from}`).toBe('no-reply@ownpace.eu');
    }
  });

  it('keeps a plain display name', () => {
    expect(split('Ownpace <no-reply@ownpace.eu>').name).toBe('Ownpace');
    expect(split('"Ownpace" <no-reply@ownpace.eu>').name).toBe('Ownpace');
    expect(split('Ownpace Support <no-reply@ownpace.eu>').name).toBe('Ownpace Support');
  });

  it('drops a name the relay would refuse, in favour of the stack name', () => {
    // The header is written unquoted, so these arrive as a header whose address
    // the relay cannot match to the envelope — 5.7.26, and the mail is gone.
    expect(split('"Ownpace [no-reply]" <no-reply@ownpace.eu>').name).toBe('Ownpace');
    expect(split('Ownpace (no-reply) <no-reply@ownpace.eu>').name).toBe('Ownpace');
    expect(split('Ownpace, Inc. <no-reply@ownpace.eu>').name).toBe('Ownpace');
  });

  it('falls back to the stack name for a bare address', () => {
    // No display name to carry, and an empty senderName is not what Zitadel
    // had before: the stack's own name is what every mail said.
    expect(split('no-reply@ownpace.eu').name).toBe('Ownpace');
  });
});

describe('and the split is what reaches the provider', () => {
  const setup = readFileSync(SETUP, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('sends senderAddress from the split, not the raw NOTIFY_FROM', () => {
    // Handing the raw line to senderAddress is the bug: the envelope then
    // carries the whole quoted form and the relay refuses it. The jq body binds
    // `$from`, so what matters is what `--arg from` is fed.
    const bindings = [...setup.matchAll(/--arg\s+from\s+"(\$[A-Za-z_]+)"/g)].map((m) => m[1]);
    expect(bindings.length, 'no senderAddress binding found').toBeGreaterThan(0);
    expect(
      bindings.filter((b) => b !== '$SMTP_SENDER_ADDR'),
      'senderAddress is fed the raw From line; the envelope must carry the bare address',
    ).toEqual([]);
  });

  it('sends senderName from the split, not a hardcoded string', () => {
    // Hardcoding "Ownpace" throws away a display name the relay would happily
    // carry, so the two senders show different names for the same stack.
    const bindings = [...setup.matchAll(/--arg\s+name\s+"(\$[A-Za-z_]+)"/g)].map((m) => m[1]);
    expect(bindings.length, 'senderName is hardcoded; a plain display name is thrown away').toBeGreaterThan(0);
    expect(
      bindings.filter((b) => b !== '$SMTP_SENDER_NAME'),
      'senderName is fed something other than the split name',
    ).toEqual([]);
  });
});
