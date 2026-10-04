// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NOTICE BEFORE A PASSWORD (workplan 0135 T5, for 0139 T4).
 *
 * A tester's first account is made on the identity provider's registration
 * page: a name, an address and a password, kept by a service we run (privacy
 * §4.4). Upstream's instance privacy policy ships with no terms and no privacy
 * link (`DefaultInstance.PrivacyPolicy` in `cmd/defaults.yaml` at v4.19.2: both
 * `""`), so that page collected all three with no notice at all, and its
 * footer pointed at upstream's own documentation.
 *
 * Now `setup-zitadel.sh` sets the instance privacy policy on every run:
 *
 * - **Its address is the web build's.** `VITE_LEGAL_SITE_URL` in `.env`, the
 *   key the web app's links and the api's mail links are made from, read the
 *   same way: empty is the production site, a trailing slash is dropped, and
 *   anything but an http(s) origin stops the run before anything is written,
 *   naming the key. For every value, the address here is the one
 *   `apps/web/src/services/legal-links.ts` makes.
 * - **In Dutch, from the site build's table.** Zitadel keeps one link per
 *   field per instance, and the site's two languages do not share a pattern
 *   its `{{.Lang}}` could fill (English at the root, Dutch under `nl/`, and
 *   the Dutch terms named `voorwaarden.html`). The testers are Dutch (0135
 *   D4), so the links are the Dutch pages, which carry a switch to the
 *   English ones. The files are `LEGAL_FILES.nl`'s, which
 *   `a-policy-link-that-answers` holds to what the site build writes.
 * - **The whole policy is written, the rest copied back.** The update
 *   replaces all seven fields (`UpdatePrivacyPolicyToDomain` at v4.19.2), so
 *   the links it does not set go back as they were read. It is written only
 *   when a link differs, because Zitadel refuses an update that changes
 *   nothing (`Errors.Instance.PrivacyPolicy.NotChanged`).
 * - **Read back, twice.** The instance's policy must then hold both links, and
 *   so must what the project's organisation shows: an organisation's own
 *   policy stands in front of the instance's, and its page would show that.
 * - **A fresh instance has them from its first start** (`managed.yml`'s
 *   `ZITADEL_DEFAULTINSTANCE_PRIVACYPOLICY_*`), for a run that stops before
 *   this step.
 *
 * The owner, 2026-10-03, asked how the links behave before the texts are
 * published: *"Always shown"*. So there is no empty value that leaves the
 * page without them: unset is the production site, as for the app.
 *
 * Run, not read, against a stand-in provider that refuses what Zitadel
 * refuses. It failed on the script before this: nothing set the policy.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { LEGAL_FILES, legalSiteFrom, legalUrl } from '../apps/web/src/services/legal-links.ts';

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

const LIFTED = ['legal_site_from', 'sign_in_page_link', 'sign_in_notice_read', 'set_sign_in_notice'];

/** The seven fields of Zitadel's privacy policy, as its API spells them. */
type Policy = Partial<
  Record<'tosLink' | 'privacyLink' | 'helpLink' | 'supportEmail' | 'docsLink' | 'customLink' | 'customLinkText', string>
>;

interface Provider {
  /** The instance's policy. */
  instance: Policy;
  /** The project organisation's own policy, or null where it inherits the instance's. */
  organisation?: Policy | null;
  /** Whether a write the provider accepts takes effect. */
  takes?: boolean;
}

const PREAMBLE = [
  'set -euo pipefail',
  'ISSUER=https://id.example.test',
  'ENV_FILE=/stack/.env',
  'say() { echo "[setup-zitadel] $*"; }',
  'die() { echo "[setup-zitadel] FATAL: $*" >&2; exit 1; }',
];

/**
 * Set the sign-in page's notice from `value` (what `.env` holds for
 * VITE_LEGAL_SITE_URL), against a stand-in provider. Returns what was said,
 * how it ended, every write in order, and the instance's policy after.
 */
function run(provider: Provider, value: string) {
  const home = mkdtempSync(join(tmpdir(), 'notice-'));
  try {
    const state = join(home, 'state.json');
    const writes = join(home, 'writes');
    writeFileSync(state, JSON.stringify({ instance: provider.instance, organisation: provider.organisation ?? null }));
    writeFileSync(writes, '');
    const program = [
      ...PREAMBLE,
      `STATE="${state}"`,
      `WRITES="${writes}"`,
      `TAKES=${provider.takes === false ? 'false' : 'true'}`,
      'refuse() { echo "[setup-zitadel] FATAL: $1 $2 answered HTTP 400: $3" >&2; exit 1; }',
      // protojson leaves an empty string out, as it leaves out a `false`.
      'present() { jq -c \'with_entries(select(.value != ""))\'; }',
      'api() {',
      '  local s; s="$(cat "$STATE")"',
      '  case "$1 $2" in',
      '    "GET /admin/v1/policies/privacy") jq -c \'{policy: ((.instance | with_entries(select(.value != ""))) + {isDefault: true})}\' <<<"$s" ;;',
      '    "GET /management/v1/policies/privacy")',
      '      jq -c \'if .organisation == null then {policy: ((.instance | with_entries(select(.value != ""))) + {isDefault: true})} else {policy: (.organisation | with_entries(select(.value != "")))} end\' <<<"$s" ;;',
      '    "PUT /admin/v1/policies/privacy")',
      '      echo "$1 $2 $3" >> "$WRITES"',
      // The update replaces all seven: a field left out is a field emptied.
      '      local next; next="$(jq -c \'{tosLink: (.tosLink // ""), privacyLink: (.privacyLink // ""), helpLink: (.helpLink // ""), supportEmail: (.supportEmail // ""), docsLink: (.docsLink // ""), customLink: (.customLink // ""), customLinkText: (.customLinkText // "")} | with_entries(select(.value != ""))\' <<<"$3")"',
      '      [ "$(jq -cS .instance <<<"$s")" != "$(jq -cS . <<<"$next")" ] || refuse "$1" "$2" "Errors.Instance.PrivacyPolicy.NotChanged"',
      '      [ "$TAKES" = true ] && jq -c --argjson n "$next" \'.instance = $n\' <<<"$s" > "$STATE"',
      '      echo \'{"details":{}}\' ;;',
      '    *) echo "unexpected call: $1 $2" >&2; exit 1 ;;',
      '  esac',
      '}',
      ...LIFTED.map(fn),
      'SIGN_IN_SITE="$(legal_site_from "$VALUE")"',
      'set_sign_in_notice "$SIGN_IN_SITE"',
    ].join('\n');
    const r = spawnSync('bash', ['-c', program], { encoding: 'utf8', env: { ...process.env, VALUE: value } });
    return {
      code: r.status ?? -1,
      said: `${r.stdout ?? ''}${r.stderr ?? ''}`,
      writes: readFileSync(writes, 'utf8').trim().split('\n').filter(Boolean),
      after: (JSON.parse(readFileSync(state, 'utf8')) as { instance: Policy }).instance,
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** The two links the script makes from a value, or its refusal. */
function linksFrom(value: string): { code: number; said: string; privacy: string; terms: string } {
  const program = [
    ...PREAMBLE,
    fn('legal_site_from'),
    fn('sign_in_page_link'),
    'site="$(legal_site_from "$VALUE")"',
    'printf \'%s\\n%s\\n\' "$(sign_in_page_link privacy "$site")" "$(sign_in_page_link terms "$site")"',
  ].join('\n');
  const r = spawnSync('bash', ['-c', program], { encoding: 'utf8', env: { ...process.env, VALUE: value } });
  const [privacy = '', terms = ''] = (r.stdout ?? '').split('\n');
  return { code: r.status ?? -1, said: `${r.stdout ?? ''}${r.stderr ?? ''}`, privacy, terms };
}

const OTA_SITE = 'https://www.ota.ownpace.eu';
/** The web's addresses for the Dutch pages, from the same value. */
const web = (value: string) => ({
  privacy: legalUrl('privacy', 'nl', { VITE_LEGAL_SITE_URL: value }),
  terms: legalUrl('terms', 'nl', { VITE_LEGAL_SITE_URL: value }),
});
/** Upstream's fresh instance: no links of ours, its own documentation in the footer. */
const UPSTREAM: Policy = { docsLink: 'https://zitadel.com/docs' };

describe('the links, from the key the web build reads', () => {
  it.each([
    ['unset', ''],
    ['blank', '   '],
    ['the OTA test site', OTA_SITE],
    ['the OTA test site, with a trailing slash', `${OTA_SITE}/`],
    ['written in capitals', 'HTTPS://WWW.OTA.OWNPACE.EU'],
    ['a port, kept', 'http://localhost:8080'],
    ['the default port, dropped', 'https://www.ota.ownpace.eu:443'],
  ])('%s: the Dutch pages, at the address the web app links', (_name, value) => {
    const got = linksFrom(value);
    expect(got.code, got.said).toBe(0);
    expect({ privacy: got.privacy, terms: got.terms }).toEqual(web(value));
  });

  it('are the Dutch files of the site build’s table, never names of their own', () => {
    // LEGAL_FILES is held to what the site build writes by a-policy-link-that-answers.
    const site = legalSiteFrom({});
    const got = linksFrom('');
    expect(got.privacy).toBe(`${site}/${LEGAL_FILES.nl.privacy}`);
    expect(got.terms).toBe(`${site}/${LEGAL_FILES.nl.terms}`);
  });

  it.each([
    ['a scheme that is not http(s)', 'javascript:alert(1)'],
    ['a scheme that is not http(s), before a host', 'ftp://www.ownpace.eu'],
    ['no scheme at all', 'www.ownpace.eu'],
    ['a path, where the site writes its pages at the root', `${OTA_SITE}/legal/`],
    ['a query', `${OTA_SITE}/?lang=nl`],
  ])('refuse %s, as the web build does, naming the key', (_name, value) => {
    expect(() => legalSiteFrom({ VITE_LEGAL_SITE_URL: value })).toThrow();
    const got = linksFrom(value);
    expect(got.code, `the script took ${value}, which the web build refuses`).not.toBe(0);
    expect(got.said).toContain('VITE_LEGAL_SITE_URL');
  });
});

describe('the instance’s privacy policy', () => {
  const want = web(OTA_SITE);

  it('on a fresh instance: both links written, the rest copied back as they were', () => {
    const { code, said, writes, after } = run({ instance: { ...UPSTREAM, helpLink: 'https://help.example.test' } }, OTA_SITE);
    expect(code, said).toBe(0);
    expect(writes).toHaveLength(1);
    const body = JSON.parse(writes[0]!.replace(/^PUT \/admin\/v1\/policies\/privacy /, '')) as Policy;
    expect(body).toEqual({
      tosLink: want.terms,
      privacyLink: want.privacy,
      helpLink: 'https://help.example.test',
      supportEmail: '',
      docsLink: 'https://zitadel.com/docs',
      customLink: '',
      customLinkText: '',
    });
    expect(after.privacyLink).toBe(want.privacy);
    expect(after.tosLink).toBe(want.terms);
    expect(said).toContain(want.privacy);
    expect(said).toContain(want.terms);
  });

  it('writes nothing when both links are already right, which Zitadel would refuse as NotChanged', () => {
    const { code, said, writes } = run({ instance: { ...UPSTREAM, tosLink: want.terms, privacyLink: want.privacy } }, OTA_SITE);
    expect(code, said).toBe(0);
    expect(writes).toEqual([]);
  });

  it('moves links that point elsewhere, such as another site’s', () => {
    const elsewhere = web('');
    const { code, writes, after } = run(
      { instance: { tosLink: elsewhere.terms, privacyLink: elsewhere.privacy } },
      OTA_SITE,
    );
    expect(code).toBe(0);
    expect(writes).toHaveLength(1);
    expect(after).toMatchObject({ tosLink: want.terms, privacyLink: want.privacy });
  });

  it('unset, links the production site: there is no value that leaves the page without them', () => {
    const { code, after } = run({ instance: UPSTREAM }, '');
    expect(code).toBe(0);
    expect(after).toMatchObject({ tosLink: web('').terms, privacyLink: web('').privacy });
  });

  it('stops before writing anything for a value the web build refuses', () => {
    const { code, said, writes } = run({ instance: UPSTREAM }, 'www.ownpace.eu');
    expect(code).not.toBe(0);
    expect(said).toContain('VITE_LEGAL_SITE_URL');
    expect(writes).toEqual([]);
  });

  it('stops, naming it, when the write does not take', () => {
    const { code, said } = run({ instance: UPSTREAM, takes: false }, OTA_SITE);
    expect(code).not.toBe(0);
    expect(said).toContain('could not link the privacy policy and the terms on the sign-in page');
  });

  it('stops, naming it, when the organisation’s own policy shows other links', () => {
    const { code, said } = run({ instance: UPSTREAM, organisation: { docsLink: 'https://zitadel.com/docs' } }, OTA_SITE);
    expect(code).not.toBe(0);
    expect(said).toContain('own privacy policy');
    expect(said).toContain('/management/v1/policies/privacy');
  });

  it('is content with an organisation whose own policy already shows both', () => {
    const { code, said } = run(
      { instance: UPSTREAM, organisation: { tosLink: want.terms, privacyLink: want.privacy } },
      OTA_SITE,
    );
    expect(code, said).toBe(0);
  });
});

describe('the bring-up', () => {
  it('sets it on every run, from VITE_LEGAL_SITE_URL in .env, after the page’s languages, and says so in its summary', () => {
    const code = directives(setup);
    const languages = code.search(/^set_page_languages "\$\(read_env ZITADEL_DEFAULT_LANGUAGE ''\)"$/m);
    const site = code.search(/^SIGN_IN_SITE="\$\(legal_site_from "\$\(read_env VITE_LEGAL_SITE_URL ''\)"\)"$/m);
    const set = code.search(/^set_sign_in_notice "\$SIGN_IN_SITE"$/m);
    expect(site, 'nothing reads VITE_LEGAL_SITE_URL for the sign-in page').toBeGreaterThan(0);
    expect(set, 'nothing sets the sign-in page’s privacy policy').toBeGreaterThan(site);
    expect(site).toBeGreaterThan(languages);
    const summary = code.slice(code.lastIndexOf('cat <<EOF'));
    expect(summary).toMatch(/^ {2}notice {5}\$\(sign_in_page_link privacy "\$SIGN_IN_SITE"\)/m);
  });

  it('a fresh instance has both links from its first start, from the same key and the same files', () => {
    const compose = parseYaml(readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8')) as {
      services: Record<string, { environment?: Record<string, unknown> }>;
    };
    const env = compose.services.zitadel?.environment ?? {};
    const origin = `\${VITE_LEGAL_SITE_URL:-${legalSiteFrom({})}}`;
    expect(env.ZITADEL_DEFAULTINSTANCE_PRIVACYPOLICY_PRIVACYLINK).toBe(`${origin}/${LEGAL_FILES.nl.privacy}`);
    expect(env.ZITADEL_DEFAULTINSTANCE_PRIVACYPOLICY_TOSLINK).toBe(`${origin}/${LEGAL_FILES.nl.terms}`);
  });
});
