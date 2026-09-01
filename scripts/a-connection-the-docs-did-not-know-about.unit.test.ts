// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SENTENCE IN A DOCUMENT HAS NOTHING CHECKING IT, and this one was wrong for
 * a month.
 *
 * `docs/rls-guide.md` §2 states the deployment's connection contract — which
 * role holds which URL, and what each is for. It is the most consequential
 * paragraph in the documentation, because getting it wrong in the other
 * direction (pointing the app at the owner) silently removes tenant isolation.
 * Until 2026-09-01 it read:
 *
 *     `DATABASE_URL` → the DB owner. **Migrations and the demo seed only.**
 *
 * That stopped being true the day `deploy/compose/operator.sh` was written
 * (workplan 0093 T6): appointing an operator is an act performed at the machine
 * over the owner connection, and it is neither a migration nor a seed. Two more
 * arrived after it — the membership commands and `check`/`clean` — and
 * `set-task-env.sh` had been uploading an owner URL into the task environment
 * the whole time. Nothing went red, because nothing reads a document.
 *
 * WHY THIS PARTICULAR SENTENCE GETS A TEST, when most prose cannot and should
 * not. It states a CLOSED SET — "only" — over a thing that can be enumerated
 * from the repository. That is the narrow shape where a doc claim is checkable
 * at all, and the repository already treats it as a class: see
 * `a-sentence-two-files-must-agree-on.unit.test.ts` and
 * `adr-operative.unit.test.ts`. Prose that describes, motivates or teaches is
 * left alone; prose that enumerates is not.
 *
 * WHAT IT DOES NOT CLAIM: that holding the owner connection is correct in any
 * of these cases. That is a design question and the answer is in each script's
 * own header. This claims only that the document knows the script exists —
 * which is the difference between a reader who is informed and one who is
 * misled.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const RLS_GUIDE = readFileSync(join(REPO_ROOT, 'docs', 'rls-guide.md'), 'utf8');
const RUNBOOK = readFileSync(join(REPO_ROOT, 'docs', 'operator-runbook.md'), 'utf8');

/**
 * Every script under `deploy/compose/` that builds a connection string as the
 * database OWNER.
 *
 * `${POSTGRES_USER` is the tell and it is exact: `${APP_DB_USER` composes the
 * `app_user` URL in the same files, and conflating the two would make this
 * guard demand that the app's own connection be listed as an owner one — the
 * error it exists to prevent, facing the other way.
 */
const ownerConnectionScripts = (): string[] =>
  readdirSync(COMPOSE_DIR)
    .filter((f) => f.endsWith('.sh'))
    .filter((f) => {
      const text = readFileSync(join(COMPOSE_DIR, f), 'utf8');
      // Only real composition, never a line that merely quotes the shape in a
      // comment: `operator.sh`'s header quotes a WRONG recipe on purpose.
      return text
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .some((line) => line.includes('postgresql://${POSTGRES_USER'));
    })
    .sort();

describe('the document knows every script that holds the owner connection', () => {
  const scripts = ownerConnectionScripts();

  it('found some, so the rest of this is not vacuous', () => {
    // If the tell ever changes shape, this goes red rather than the whole file
    // passing by matching nothing — the failure mode a grep-based guard has.
    expect(scripts.length, 'no owner-connection scripts found — has the pattern changed?')
      .toBeGreaterThan(1);
    expect(scripts).toContain('operator.sh');
    expect(scripts).toContain('seed-managed.sh');
  });

  it.each(ownerConnectionScripts().map((s) => [s]))(
    'docs/rls-guide.md names deploy/compose/%s',
    (script) => {
      expect(
        RLS_GUIDE,
        `deploy/compose/${script} composes an owner connection string, and\n` +
          "docs/rls-guide.md §2's list of who holds one does not mention it.\n\n" +
          'That list is the deployment contract. A script missing from it is a way ' +
          'the\nowner connection is used that nobody reading the guide would know ' +
          'about — which\nis how the previous version came to say "migrations and ' +
          'the demo seed only"\nfor a month after that stopped being true.\n\n' +
          'Add a row to the table in §2 saying what it needs the owner for.',
      ).toContain(script);
    },
  );

  it('the runbook agrees with the guide about which scripts they are', () => {
    // TWO DOCUMENTS, ONE FACT. The runbook's "The two database roles" section
    // and the guide's §2 are read by different people at different moments —
    // the operator standing up a box, and whoever is changing the model — and
    // they were already allowed to drift once.
    for (const script of scripts) {
      expect(
        RUNBOOK,
        `docs/operator-runbook.md does not mention ${script} beside the two roles`,
      ).toContain(script.replace(/\.sh$/, ''));
    }
  });

  it('still says the thing that matters most', () => {
    // The sentence this whole paragraph exists for. A rewrite that made the
    // list correct and dropped the warning would be a worse document.
    expect(RLS_GUIDE).toContain('tenant isolation silently disappears');
    expect(RLS_GUIDE, 'and which URL the request path takes').toContain(
      '`APP_DATABASE_URL` → `app_user`',
    );
  });
});
