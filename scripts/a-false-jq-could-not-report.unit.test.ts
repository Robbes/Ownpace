// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A `false` THE READER COULD NOT REPORT.
 *
 * jq's `//` is not "if null" — it fires on `false` as well. So
 *
 *     .policy.allowExternalIdp // empty
 *
 * can NEVER return `false`. On a genuine `false` it returns empty, which is
 * also what it returns when the key is missing, so a boolean setting and an
 * absent one become the same answer. For a flag whose entire domain is true or
 * false, that is a reader that cannot read half of it.
 *
 * IT TOOK THE WHOLE BRING-UP DOWN. E2E (managed) #85 failed at "Bring the
 * stack up" — not at the smoke, at the step everything else waits behind —
 * with:
 *
 *     FATAL: could not set whether a sign-in provider may be offered.
 *     0 provider(s) are configured, so 'External IDP allowed' should be
 *     false — and it is not.
 *
 * on an instance where it HAD just been set to false, correctly, by the PUT
 * three lines above. The refusal was accurate about what it read and wrong
 * about the world.
 *
 * AND IT ONLY BITES ONE WAY, which is why it survived review and a green
 * run. `allowRegister` is read by the same broken expression and has never
 * failed, because it is only ever set to `true` — and `// empty` handles
 * `true` perfectly. The bug is invisible until the day somebody wants the
 * other value, and #576 was that day.
 *
 * `// false` IS NOT THE SAME MISTAKE and is deliberately allowed here.
 * `login_v2_required` uses it to collapse absent and false into one answer,
 * which is the right reading of "no opinion recorded" for that feature. The
 * rule refuses `// empty`, where the two cases must stay distinguishable and
 * do not.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPOSE = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'compose');

/**
 * Comment lines stripped, for the reason this repository keeps relearning: the
 * paragraph above quotes the broken expression verbatim, and a rule that read
 * prose would be satisfied — or here, broken — by its own explanation.
 */
const setup = readFileSync(join(COMPOSE, 'setup-zitadel.sh'), 'utf8')
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

/**
 * Names that are booleans in Zitadel's policy and feature APIs. Named rather
 * than guessed from the value, because the value is not in this file — only
 * the expression that will read it.
 */
const BOOLEAN_KEY = /^(allow[A-Z]\w*|is[A-Z]\w*|has[A-Z]\w*|\w*Verified|\w*Enabled|required)$/;

describe('a boolean setting is read in a way that can report false', () => {
  it('never reads one through jq’s `// empty`', () => {
    const offenders = [...setup.matchAll(/\.(\w+)\s*\/\/\s*empty/g)]
      .map((m) => ({ key: m[1]!, text: m[0]! }))
      .filter((m) => BOOLEAN_KEY.test(m.key));
    expect(
      offenders.map((o) => o.text),
      `these read a boolean setting through jq's \`// empty\`:\n\n` +
        offenders.map((o) => `  ${o.text}`).join('\n') +
        '\n\n`//` fires on `false` as well as on null, so each of these returns\n' +
        'empty for a genuine `false` — indistinguishable from the key being\n' +
        'absent. Any comparison against "false" then fails on a value that IS\n' +
        'false, and the script refuses something it already did correctly.\n\n' +
        'That is what took E2E (managed) #85 down at the bring-up step. Read it\n' +
        'so that false survives — `policy_flag` does, or inline:\n' +
        '  jq -r \'.x | if . == null then "" else tostring end\'',
    ).toEqual([]);
  });

  /**
   * The reader itself, not merely the absence of the bad shape: deleting
   * `policy_flag` and going back to a bare `.policy.x` read would satisfy the
   * rule above while losing the distinction all over again.
   */
  it('keeps a reader that tells false apart from absent', () => {
    expect(
      setup,
      'setup-zitadel.sh no longer defines policy_flag. If the boolean reads\n' +
        'moved somewhere better, point this rule at that instead — but a bare\n' +
        'jq path read cannot distinguish a false from a missing key, and this\n' +
        'file has already shipped that bug once.',
    ).toMatch(/policy_flag\(\)\s*\{/);
    expect(
      setup,
      'policy_flag no longer maps null to the empty string, so an explicit\n' +
        'JSON null now reads back as the string "null" and compares equal to\n' +
        'nothing. Zitadel returns null for a policy an organisation has not\n' +
        'overridden.',
    ).toMatch(/if \. == null then "" else tostring end/);
  });
});
