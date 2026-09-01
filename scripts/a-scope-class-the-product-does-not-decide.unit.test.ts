// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SETTING THE OPERATOR CANNOT FIND, OR THE API NEVER RECEIVES.
 *
 * `GOOGLE_ACCOUNT_SCOPE_CLASS` decides whether one Google account consent may
 * ask for all four faces (ADR-0041, owner decision 2026-09-01). Its BEHAVIOUR
 * is proved next to the code, in
 * `apps/api/src/routes/migrations/google-account-scope-class.unit.test.ts` —
 * this is the other half, and it is the half that has gone wrong here before:
 * a value set in `.env` that nothing forwards to the container, and a setting
 * whose cost is documented somewhere other than where it is set.
 *
 * `docker compose` does not pass the environment to a service unless the
 * service says so. `TRIGGER_ENCRYPTION_KEY` and `DEPLOY_IMAGE_PLATFORM` both
 * cost a live afternoon on 2026-09-01 for shapes of that family.
 *
 * WHY THE SEVEN DAYS ARE PINNED HERE. The setting is only safe if what it
 * costs is read at the moment it is set: in Google's "External + Testing"
 * publishing status, refresh tokens expire after seven days, surfacing weeks
 * later as `invalid_grant` on a migration that was working.
 * `google-token-provider.ts` names that cause first when it fails — this makes
 * sure it is also named before somebody chooses it.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY. A test in `scripts/` cannot
 * import `@openmig/shared`: the workspace aliases are not a substitute for a
 * declared dependency, and this file resolves none (AGENTS.md, and the reason
 * the behaviour half lives beside its code).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SETTING = 'GOOGLE_ACCOUNT_SCOPE_CLASS';

describe('an operator can find the setting', () => {
  it('managed.env.example carries it, with the seven-day cost beside it', () => {
    // The setting is only safe if the thing it costs is read at the same
    // moment it is set. In External + Testing, Google expires refresh tokens
    // after seven days — the cause `google-token-provider.ts` names first when
    // the migration dies weeks later.
    const example = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.env.example'), 'utf8');
    expect(example, 'the setting is not in the example env').toContain(
      SETTING,
    );
    const at = example.indexOf('GOOGLE_ACCOUNT_SCOPE_CLASS');
    const around = example.slice(Math.max(0, at - 1400), at);
    expect(around, 'nothing near it mentions the seven-day expiry').toMatch(/seven days|7 days/);
  });

  it('managed.yml passes it to the API, or the API never sees it', () => {
    // The classic: set in `.env`, read by nothing. `docker compose` does not
    // forward the environment to a container unless the service says so.
    const managed = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8');
    expect(managed, 'the API service does not receive it').toContain(
      SETTING,
    );
  });
});
