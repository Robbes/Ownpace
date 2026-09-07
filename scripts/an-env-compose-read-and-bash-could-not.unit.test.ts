// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ENV FILE COMPOSE READ AND BASH COULD NOT.
 *
 * E2E (managed) #163 died after 27 seconds with:
 *
 *     deploy/compose/.env: line 286: nextcloud: command not found
 *     Process completed with exit code 127
 *
 * A sentence naming a program nobody invoked, in a file nobody mentioned,
 * before anything the bring-up prints. The runner's `.env` carried the line
 * this repository told the operator to write:
 *
 *     NEXTCLOUD_TRUSTED_DOMAINS=localhost nextcloud 100.97.25.131
 *
 * TWO READERS, ONE FILE, AND ONLY ONE OF THEM MINDS. Compose parses `.env`
 * itself and takes the whole rest of the line as the value, so the container
 * came up healthy and the setting worked — for six hours, on the owner's box.
 * `bootstrap-managed.sh` SOURCES the same file with bash, and there the line
 * assigns `localhost` and then runs `nextcloud` as a command.
 *
 * So the shape is not a typo somebody made. It is the shape this repository
 * PUBLISHED, in `managed.env.example` and in the bring-up guide, and copying
 * it exactly is what broke the gate. That is what this guard is for: the
 * examples must be safe for the stricter of the two readers, because an
 * operator copies them into a file both of them read.
 *
 * WHAT IT DOES NOT DO: it does not police the operator's own `.env`, which is
 * not in the repository and never should be. That file is caught at run time
 * instead, by the check `load_env` now performs before sourcing — and this
 * guard asserts THAT check still exists, because a refusal deleted is a
 * refusal that will not be missed until the next 3am exit 127.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/**
 * A `KEY=value` line bash would mis-read: unquoted, and carrying whitespace
 * before something that is not a comment. Everything else is fine —
 * `KEY=v  # note` is an assignment and a comment, `KEY="a b"` is a value.
 */
const UNSOURCEABLE = /^[A-Za-z_][A-Za-z0-9_]*=[^"'#]*[^"'#\s]\s+[^#\s]/;

/** The same line as an operator meets it in prose: indented under a `#`. */
const stripExampleComment = (line: string): string =>
  line.replace(/^#\s{0,4}/, '').trim();

describe('the env examples are safe for the stricter reader', () => {
  it('managed.env.example has no value bash would run as a command', () => {
    const offenders = read('deploy/compose/managed.env.example')
      .split('\n')
      .map((line, i) => ({ n: i + 1, text: stripExampleComment(line) }))
      .filter(({ text }) => UNSOURCEABLE.test(text))
      .map(({ n, text }) => `line ${n}: ${text}`);

    expect(
      offenders,
      'an operator copies these verbatim into a file bootstrap-managed.sh sources',
    ).toEqual([]);
  });

  /**
   * AND NOT THE GUIDE, deliberately — stated here so the next person does not
   * assume it is covered.
   *
   * `docs/managed-bring-up.md` prints `.env` content and SHELL COMMANDS in
   * the same fenced blocks: `OWNPACE_APP_URL=https://… node site/build.mjs`
   * is a correct command, `TRIGGER_TLS_HOST=10.0.0.5 \` is a continuation,
   * `DROPBOX_OAUTH_CLIENT_ID=<App key>` is a placeholder nobody pastes
   * literally. All three look exactly like the broken shape to a regex, and a
   * rule that flags fourteen correct lines to catch one wrong one gets
   * weakened until it is switched off — the same reasoning
   * `a-domain-the-readme-forgot` gives for not checking prose.
   *
   * The guide's own Nextcloud line was fixed by hand alongside this guard.
   * What covers the guide from here is not a text rule but the run-time check
   * below: it catches the operator's actual file, whatever they copied it
   * from, and names the line.
   */
  it('leaves the guide to the run-time check, which sees the real file', () => {
    // The one line that produced #163, now quoted in the guide too.
    const guide = read('docs/managed-bring-up.md');
    expect(guide).toContain('NEXTCLOUD_TRUSTED_DOMAINS="localhost nextcloud 100.97.25.131"');
    expect(guide).not.toContain('NEXTCLOUD_TRUSTED_DOMAINS=localhost nextcloud');
  });

  it('recognises the exact line that broke the gate, so it is not vacuous', () => {
    // Without this, a regex that matched nothing would pass all three tests
    // above and protect nothing at all.
    expect(UNSOURCEABLE.test('NEXTCLOUD_TRUSTED_DOMAINS=localhost nextcloud 100.97.25.131')).toBe(
      true,
    );
    // ...and leaves the shapes that are already correct alone.
    for (const safe of [
      'NEXTCLOUD_TRUSTED_DOMAINS="localhost nextcloud 100.97.25.131"',
      "SINGLE='a b c'",
      'SMTP_PORT=1025          # a relay is usually 587 (STARTTLS)',
      'LEDGER_RETENTION_DAYS=  # whole days, minimum 1',
      'EMPTY=',
      'PLAIN=value',
    ]) {
      expect(UNSOURCEABLE.test(safe), `flagged a safe line: ${safe}`).toBe(false);
    }
  });
});

describe('the bring-up refuses a .env it cannot source', () => {
  const bootstrap = read('deploy/compose/bootstrap-managed.sh');

  it('checks the file BEFORE sourcing it, and names the fix', () => {
    const loadEnv = bootstrap.slice(bootstrap.indexOf('load_env() {'));
    const body = loadEnv.slice(0, loadEnv.indexOf('\n}\n'));
    const check = body.indexOf('space in it and no quotes');
    const source = body.indexOf('. "$ENV_FILE"');

    expect(check, 'load_env no longer refuses an unsourceable .env').toBeGreaterThan(-1);
    expect(source, 'load_env no longer sources the file at all').toBeGreaterThan(-1);
    expect(check, 'the check must run BEFORE the source, or it explains a crash').toBeLessThan(
      source,
    );
    // The remedy, in the words an operator can act on: the shape to write,
    // and the persisted copy that would otherwise put the old one straight
    // back on the next run.
    expect(body).toContain('KEY="first second"');
    expect(body).toContain('persisted copy');
  });
});
