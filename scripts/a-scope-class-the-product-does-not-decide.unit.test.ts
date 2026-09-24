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
 * THE SAME SHAPE, FOUND AGAIN (2026-09-24). `GRAPH_FILES_READ_CONSENTED` is
 * the other scope a deployment decides for itself: whether it holds
 * `Files.Read.All`, which turns on the drive section of the permission report
 * (`apps/api/src/routes/permissions.ts`). `managed.env.example` carried it
 * with a whole paragraph of explanation, and `managed.yml` never passed it to
 * the api service. A deployment that had granted the scope and set the flag
 * got the "not inventoried" blind spot anyway, with nothing saying why.
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

describe('the drive-sharing scope reaches the API too', () => {
  const DRIVE = 'GRAPH_FILES_READ_CONSENTED';

  it('the API reads it, so forwarding it is not decoration', () => {
    // If the permission report stops asking, this rule has lost its subject
    // and should be rewritten or removed, not left passing on a string.
    const route = readFileSync(join(REPO_ROOT, 'apps/api/src/routes/permissions.ts'), 'utf8');
    expect(route).toContain('driveSharingAvailability(process.env)');
  });

  it('managed.env.example carries it', () => {
    const example = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.env.example'), 'utf8');
    expect(example).toMatch(new RegExp(`^${DRIVE}=`, 'm'));
  });

  it('managed.yml passes it to the API, or setting it does nothing', () => {
    // The api service's own block, and a mapping entry in it: a comment
    // naming the variable, or another service receiving it, forwards nothing
    // to the process that reads it. Sliced by indentation rather than parsed,
    // to stay on node builtins (above).
    const managed = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8');
    const start = managed.indexOf('\n  api:\n');
    expect(start, 'managed.yml has no top-level api service').toBeGreaterThan(-1);
    const rest = managed.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
    const api = next === -1 ? rest : rest.slice(0, next + 1);
    expect(
      api,
      `the api service is not handed ${DRIVE}: a deployment that set it in .env still ` +
        'gets the drive section reported as not inventoried. Add ' +
        `"${DRIVE}: \${${DRIVE}:-}" to the api environment block.`,
    ).toMatch(new RegExp(`^ {6}${DRIVE}: \\$\\{${DRIVE}:-\\}$`, 'm'));
  });
});
