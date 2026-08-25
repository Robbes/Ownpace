// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SENTENCE TWO FILES MUST AGREE ON, AND NOTHING MADE THEM.
 *
 * `apps/web/src/services/api.ts` logs somebody out when the API refuses them
 * for having no membership — and it recognises that refusal by comparing the
 * server's sentence, character for character:
 *
 *     error.response?.data?.message === 'No active membership for this tenant'
 *
 * That comparison is doing real work. Its own comment records why it exists: a
 * valid token whose subject has no active `tenant_member` row 403s on EVERY
 * route forever, and before this the UI stayed "logged in" rendering a wall of
 * red reads. It is deliberately narrow — a role refusal (a member opening
 * Billing) is also a 403 and must pass through to the screen that knows how to
 * say it — so it cannot be widened to "any 403" and the sentence is the whole
 * mechanism.
 *
 * NOTHING TIED IT TO THE API. The string is written out five times: twice in
 * `middleware/auth.ts` where the refusal is built, twice more in that
 * middleware's own tests, and once here in the browser.
 *
 * MEASURED, NOT ASSUMED (2026-08-25). Reword the API's message and update the
 * API-side tests — which is simply what making that change looks like — and
 * the whole suite goes green with the browser still matching the old sentence.
 * The run that established this failed exactly one test,
 * `apps/api/src/middleware/auth-verify.unit.test.ts`, and after fixing that the
 * gap is silent. The next dead-membership session then never logs out, which is
 * the precise bug the comparison was added to fix, restored by a rename that
 * looked complete.
 *
 * A CONSTANT SHARED BETWEEN THE TWO WOULD BE BETTER and is not available here:
 * `apps/web` and `apps/api` are separate packages, and the edition rule (hard
 * rule 5) keeps the dependency from being invented for one string. So the
 * agreement is enforced the way `status-page.unit.test.ts` enforces gatus's
 * `[BODY].signIn` against `ready.ts` — by a rule that reads both files, which
 * is the established answer in this repository for two files that must say the
 * same thing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const webClient = readFileSync(join(ROOT, 'apps/web/src/services/api.ts'), 'utf8');
const apiAuth = readFileSync(join(ROOT, 'apps/api/src/middleware/auth.ts'), 'utf8');

describe('the sentence the browser watches for is one the API says', () => {
  /** What `api.ts` compares the server's `message` against, if anything. */
  const watched = /data\?\.message\s*===\s*'([^']+)'/.exec(webClient);

  it('still recognises a refusal by its sentence', () => {
    expect(
      watched,
      "apps/web/src/services/api.ts no longer compares the server's message.\n" +
        'If the dead-membership logout now works some better way — a code, a\n' +
        'typed error — rewrite this rule for it. If it was simply dropped, the\n' +
        'bug it fixed is back: a subject with no active membership 403s on every\n' +
        'route and the UI stays "logged in" rendering a wall of red reads.',
    ).toBeTruthy();
  });

  it('watches for a sentence the API actually produces', () => {
    const sentence = watched![1]!;
    // `message:` and not merely the text: prose about the refusal is not the
    // refusal, and this file's own comments discuss it.
    expect(
      apiAuth,
      `the browser logs somebody out when the API answers exactly:\n\n` +
        `    "${sentence}"\n\n` +
        'and apps/api/src/middleware/auth.ts never sends that. The comparison\n' +
        'therefore never fires, and a subject with no active membership stays\n' +
        '"logged in" 403ing on every route — the exact bug it was added to fix.\n\n' +
        'This is what a reword looks like from the browser side: the API tests\n' +
        'fail loudly and get updated, and this one line is left behind because\n' +
        'nothing points at it.',
    ).toContain(`message: '${sentence}'`);
  });

  /**
   * BOTH REFUSAL SITES, not just whichever one is found first. `auth.ts` builds
   * this refusal in two places — `resolveTenant`, for somebody who belongs
   * nowhere, and the membership check, for somebody who named a tenant they are
   * not in. The browser's single comparison has to cover both, so a reword that
   * changed one and missed the other would leave half the sessions stuck.
   */
  it('says it the same way everywhere it says it', () => {
    const sentence = watched![1]!;
    const sites = apiAuth.split(`message: '${sentence}'`).length - 1;
    const refusals = apiAuth.split("error: 'Forbidden',").length - 1;
    expect(
      sites,
      `auth.ts sends ${refusals} Forbidden refusals but only ${sites} carry the\n` +
        `sentence the browser watches for ("${sentence}").\n\n` +
        'That is fine if the others are role refusals — those must pass through\n' +
        'to the screen that explains them. It is NOT fine if a membership\n' +
        'refusal was reworded in one place and not the other, which leaves half\n' +
        'of these sessions unable to log themselves out. Check which this is.',
    ).toBeGreaterThanOrEqual(2);
  });
});
