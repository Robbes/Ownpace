// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SIGN-IN PAGE IN OUR OWN WORDS (workplan 0135 T6), its first half: the
 * languages. The mails the page sends come with T6's second half, and join
 * this file then.
 *
 * Upstream allows every language it has and defaults to English. The testers
 * are Dutch (the owner's D4), so:
 *
 * - the page allows Dutch and English, and no other;
 * - its default comes from `IDP_DEFAULT_LANGUAGE` in `.env`, nl or en, and an
 *   empty one keeps the instance's own; any other value stops the run before
 *   anything is written;
 * - the default is set first and the list second, each only when it differs,
 *   and both are read back.
 *
 * The stand-in provider refuses what Zitadel v4.17.3 refuses
 * (`internal/command`): a default the allowed list leaves out, a list that
 * leaves out the default, and a default set to the value it already has. So a
 * script that wrote in the wrong order, or wrote what was already there, fails
 * here as it would against the real one. Run, not read.
 *
 * It fails today: nothing sets the page's languages.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const setup = readFileSync(join(REPO_ROOT, 'deploy/compose/setup-zitadel.sh'), 'utf8');

/** Shell source with comment-only lines removed: a rule must not be satisfied by its own explanation. */
const directives = (text: string) =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

/**
 * A function of the real script, lifted whole, so the text under test is the
 * text that ships. A one-line function ends on its own line.
 */
function fn(name: string): string {
  const at = setup.indexOf(`\n${name}() {`);
  if (at < 0) return '';
  const first = setup.slice(at + 1, setup.indexOf('\n', at + 1));
  if (first.trimEnd().endsWith('}')) return `${first}\n`;
  return setup.slice(at + 1, setup.indexOf('\n}\n', at) + 3);
}

interface Instance {
  /** The instance's default language. */
  default: string;
  /** The allowed list; empty allows every language, as upstream's default does. */
  allowed: string[];
  /** Whether a write the provider accepts takes effect. */
  takes?: boolean;
}

/**
 * Set the page's languages against a stand-in provider that holds `instance`
 * and refuses what Zitadel refuses. Returns what was said, how it ended, and
 * every write in order.
 */
function run(instance: Instance, wantDefault: string) {
  const home = mkdtempSync(join(tmpdir(), 'pagelang-'));
  try {
    const state = join(home, 'state.json');
    const writes = join(home, 'writes');
    writeFileSync(state, JSON.stringify({ default: instance.default, allowed: instance.allowed }));
    writeFileSync(writes, '');
    const takes = instance.takes === false ? 'false' : 'true';
    const program = [
      'set -euo pipefail',
      'ISSUER=https://id.example.test',
      'ENV_FILE=/stack/.env',
      'say() { echo "[setup-zitadel] $*"; }',
      'die() { echo "[setup-zitadel] FATAL: $*" >&2; exit 1; }',
      `STATE="${state}"`,
      `WRITES="${writes}"`,
      `TAKES=${takes}`,
      'refuse() { echo "[setup-zitadel] FATAL: $1 $2 answered HTTP 400: $3" >&2; exit 1; }',
      'api() {',
      '  local s; s="$(cat "$STATE")"',
      '  case "$1 $2" in',
      '    "GET /admin/v1/languages/default") jq -c \'{language: .default}\' <<<"$s" ;;',
      '    "GET /admin/v1/restrictions") jq -c \'if (.allowed | length) > 0 then {allowedLanguages: .allowed} else {} end\' <<<"$s" ;;',
      '    "PUT /admin/v1/languages/default/"*)',
      '      local want="${2##*/}"',
      '      echo "$1 $2" >> "$WRITES"',
      '      [ "$(jq -r .default <<<"$s")" != "$want" ] || refuse "$1" "$2" "Errors.Instance.NotChanged"',
      '      jq -e --arg w "$want" \'(.allowed | length) == 0 or (.allowed | index($w))\' >/dev/null <<<"$s" || refuse "$1" "$2" "Errors.Restrictions.DefaultLanguageMustBeAllowed"',
      '      [ "$TAKES" = true ] && jq -c --arg w "$want" \'.default = $w\' <<<"$s" > "$STATE"',
      '      echo \'{"details":{}}\' ;;',
      '    "PUT /admin/v1/restrictions")',
      '      echo "$1 $2 $3" >> "$WRITES"',
      '      local list; list="$(jq -c \'.allowedLanguages.list\' <<<"$3")"',
      '      jq -e --argjson l "$list" \'.default as $d | $l | index($d)\' >/dev/null <<<"$s" || refuse "$1" "$2" "Errors.Restrictions.DefaultLanguageMustBeAllowed"',
      '      [ "$TAKES" = true ] && jq -c --argjson l "$list" \'.allowed = $l\' <<<"$s" > "$STATE"',
      '      echo \'{"details":{}}\' ;;',
      '    *) echo "unexpected call: $1 $2" >&2; exit 1 ;;',
      '  esac',
      '}',
      fn('page_default_language'),
      fn('page_allowed_languages'),
      fn('set_page_languages'),
      `set_page_languages '${wantDefault}'`,
    ].join('\n');
    const r = spawnSync('bash', ['-c', program], { encoding: 'utf8' });
    return {
      code: r.status ?? -1,
      said: `${r.stdout ?? ''}${r.stderr ?? ''}`,
      writes: readFileSync(writes, 'utf8').trim().split('\n').filter(Boolean),
      after: JSON.parse(readFileSync(state, 'utf8')) as { default: string; allowed: string[] },
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const LIST = 'PUT /admin/v1/restrictions {"allowedLanguages":{"list":["nl","en"]}}';

describe('the page’s languages', () => {
  it('on a fresh instance: nl made the default first, then Dutch and English allowed', () => {
    const { code, said, writes, after } = run({ default: 'en', allowed: [] }, 'nl');
    expect(code, said).toBe(0);
    expect(writes).toEqual(['PUT /admin/v1/languages/default/nl', LIST]);
    expect(after).toEqual({ default: 'nl', allowed: ['nl', 'en'] });
    expect(said).toContain('the sign-in page speaks Dutch and English, nl by default');
  });

  it('keeps the instance’s own default when IDP_DEFAULT_LANGUAGE is empty, and still allows only the two', () => {
    const { code, writes, after } = run({ default: 'en', allowed: [] }, '');
    expect(code).toBe(0);
    expect(writes).toEqual([LIST]);
    expect(after).toEqual({ default: 'en', allowed: ['nl', 'en'] });
  });

  it('writes nothing when both are already right, in whatever order the list is kept', () => {
    const { code, said, writes } = run({ default: 'nl', allowed: ['en', 'nl'] }, 'nl');
    expect(code, said).toBe(0);
    expect(writes).toEqual([]);
  });

  it('moves the default between the two without touching the list', () => {
    const { code, writes, after } = run({ default: 'nl', allowed: ['nl', 'en'] }, 'en');
    expect(code).toBe(0);
    expect(writes).toEqual(['PUT /admin/v1/languages/default/en']);
    expect(after.default).toBe('en');
  });

  it('stops before writing anything for a language the page does not offer', () => {
    const { code, said, writes } = run({ default: 'en', allowed: [] }, 'de');
    expect(code).not.toBe(0);
    expect(said).toContain("IDP_DEFAULT_LANGUAGE is 'de'");
    expect(writes).toEqual([]);
  });

  it('stops, and says to set IDP_DEFAULT_LANGUAGE, when an empty one would leave the default out of the list', () => {
    const { code, said, writes } = run({ default: 'de', allowed: [] }, '');
    expect(code).not.toBe(0);
    expect(said).toContain('Set IDP_DEFAULT_LANGUAGE to nl or en');
    expect(writes).toEqual([]);
  });

  it('stops, naming it, when the list does not take', () => {
    const { code, said } = run({ default: 'en', allowed: [], takes: false }, '');
    expect(code).not.toBe(0);
    expect(said).toContain('could not limit the sign-in page to Dutch and English');
  });

  it('stops, naming it, when the default does not take', () => {
    const { code, said } = run({ default: 'en', allowed: ['nl', 'en'], takes: false }, 'nl');
    expect(code).not.toBe(0);
    expect(said).toContain("could not make nl the sign-in page's default language");
  });
});

describe('the bring-up', () => {
  it('sets them on every run, from .env, after the organisation form is closed, and says so in its summary', () => {
    const code = directives(setup);
    const closed = code.search(/^close_public_org_registration$/m);
    const set = code.search(/^set_page_languages "\$\(read_env IDP_DEFAULT_LANGUAGE ''\)"$/m);
    expect(set, 'nothing sets the page’s languages').toBeGreaterThan(0);
    expect(set).toBeGreaterThan(closed);
    const summary = code.slice(code.lastIndexOf('cat <<EOF'));
    expect(summary).toMatch(/^ {2}languages {2}nl, en; \$\{PAGE_DEFAULT_LANGUAGE\} by default/m);
  });
});
