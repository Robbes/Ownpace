// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SIGN-IN PAGE IN OUR OWN WORDS (workplan 0135 T6): the languages, and the
 * mails. The brand, T6's third part, is only proposed.
 *
 * THE LANGUAGES.
 * Upstream allows every language it has and defaults to English. The testers
 * are Dutch (the owner's D4), so:
 *
 * - the page allows Dutch and English, and no other;
 * - its default comes from `ZITADEL_DEFAULT_LANGUAGE` in `.env`, nl or en, and an
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
 * It failed on 2026-09-27: nothing set the page's languages.
 *
 * THE MAILS. Upstream's sign-up, address and password-reset mails say
 * "Initialize User", "Verify email" and "Reset password", name no service, and
 * give nobody to write to. A tester who did not expect one cannot tell it from
 * phishing. `deploy/compose/sign-in-mails.json` holds Ownpace's own, in Dutch
 * and English, and `setup-zitadel.sh` writes them on every run. Held here:
 *
 * - **The file.** Both languages, with the same three mails and the seven
 *   fields Zitadel v4.19.4 stores for each (`SetDefault…MessageTextRequest` in
 *   `proto/zitadel/admin.proto`), none empty. Each names Ownpace and the
 *   address to write to, never Zitadel; the Dutch says "u", never "je", and
 *   "migratie", never "verhuizing".
 * - **Zitadel's variables, as Zitadel spells them.** Each text carries
 *   `{{.Code}}`, the one thing a tester must type; the link is the mail's
 *   button, which Zitadel's own template points at the URL, so `{{.URL}}` is
 *   not a variable the text has (`templates.TemplateData` and the senders in
 *   `internal/notification/types` at v4.19.4) and a text that used it would
 *   read `<no value>`. Every `{{…}}` is one of the variables the proto lists for
 *   these three mails.
 * - **Why three, where 0135 §3 names two.** A tester who registers on the
 *   login v1 page with a password gets the init mail, not the verify-email
 *   one: `AddUserHuman(…, allowInitMail=true, …)` in `register_handler.go`,
 *   and `shouldAddInitCode` is true for an address not yet verified. The proto
 *   says the same: it is sent "when a user is created and has either no
 *   password or a non-verified email address". It is the verification mail a
 *   tester gets first; verifyemail follows a changed address.
 * - **The address is the deployment's.** `VITE_SUPPORT_EMAIL` in `.env`, the
 *   one the web's pages show; empty, the service's public support address,
 *   the site's own `SUPPORT_EMAIL`. A value that is not an address stops the
 *   run before anything is written.
 * - **Written, read back, and never fatal.** Each mail is written only when
 *   it differs, with all seven fields, because a field left out is a field
 *   removed (`setDefaultMessageText` in `internal/command`), and read back,
 *   asked again for a moment because that read is a projection Zitadel does
 *   not bring up to date first. A refusal is said loudly, the run goes on and
 *   its summary says which mails keep upstream's words: a mail in the wrong
 *   words is no reason to leave a stack without its app.
 * - **Two more, since 2026-10-16.** `password_change`, which Zitadel sends
 *   after every new password, a reset included, because the instance's
 *   notification policy has `passwordChange` on (`cmd/defaults.yaml` at
 *   v4.19.4, and the script does not touch it). `passwordless_registration`,
 *   the link to add a passkey that a tester signed in to the provider's
 *   console can mail to themselves, since the login policy allows passkeys.
 *   Neither has a code: the proto lists every variable but `Code` for both,
 *   so their texts must not use one.
 * - **And the other five, each left out with its reason.** `admin.proto` at
 *   v4.19.4 has ten mail texts. The five a tester of this stack never gets are
 *   each named in the script's comment, with why, so a later reader does not
 *   take the gap for an oversight.
 *
 * THE ORGANISATION'S NAME (open question 8; the owner, 2026-10-17: *"The
 * sign-in organisation name on live: "Ownpace": yes"*). Upstream names the
 * first organisation `ZITADEL`, and the page and the console show it.
 *
 * - **Live is `Ownpace` from its first start.** `managed.yml` passes
 *   `ZITADEL_ORG_NAME` as `ZITADEL_FIRSTINSTANCE_ORG_NAME`, upstream's
 *   `ZITADEL` when it is empty, and `stand-up-live.sh` writes `Ownpace` into
 *   live's `.env` when the key is empty there, before the provider first
 *   starts. The name is spelled once, as `LIVE_ORG_NAME` in `stack-kind.sh`
 *   beside live's marker, and both scripts read it from there.
 * - **An instance that already stands is renamed by `setup-zitadel.sh`,**
 *   with `PUT /management/v1/orgs/me` (`UpdateOrg` in `management.proto` at
 *   v4.19.4), only when the name differs, since Zitadel refuses a rename to
 *   the same name (`Errors.Org.NotChanged`), and read back. The name wanted is
 *   `ZITADEL_ORG_NAME`, and on live, where the key is empty, `Ownpace`.
 *   Elsewhere an empty key keeps the name: the OTA stack's is not part of the
 *   owner's answer.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

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

  it('keeps the instance’s own default when ZITADEL_DEFAULT_LANGUAGE is empty, and still allows only the two', () => {
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
    expect(said).toContain("ZITADEL_DEFAULT_LANGUAGE is 'de'");
    expect(writes).toEqual([]);
  });

  it('stops, and says to set ZITADEL_DEFAULT_LANGUAGE, when an empty one would leave the default out of the list', () => {
    const { code, said, writes } = run({ default: 'de', allowed: [] }, '');
    expect(code).not.toBe(0);
    expect(said).toContain('Set ZITADEL_DEFAULT_LANGUAGE to nl or en');
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
    const set = code.search(/^set_page_languages "\$\(read_env ZITADEL_DEFAULT_LANGUAGE ''\)"$/m);
    expect(set, 'nothing sets the page’s languages').toBeGreaterThan(0);
    expect(set).toBeGreaterThan(closed);
    const summary = code.slice(code.lastIndexOf('cat <<EOF'));
    expect(summary).toMatch(/^ {2}languages {2}nl, en; \$\{PAGE_DEFAULT_LANGUAGE\} by default/m);
  });
});

// ------------------------------------------------------------------ the mails

const MAILS_FILE = join(REPO_ROOT, 'deploy/compose/sign-in-mails.json');
const LANGUAGES = ['en', 'nl'];
/** The five mails, by the name in their endpoint, `/admin/v1/text/message/{type}/{language}`. */
const TYPES = ['init', 'password_change', 'passwordless_registration', 'passwordreset', 'verifyemail'];
/** The mails with no code, for which the proto lists no `Code`: one only tells, one is all link. */
const CODELESS = new Set(['password_change', 'passwordless_registration']);
/**
 * Every mail text `admin.proto` at v4.19.4 has, by the same name, and the
 * ones a tester never gets, which the script's comment must name with a reason.
 */
const LEFT_OUT = ['verifyphone', 'verifysmsotp', 'verifyemailotp', 'domainclaimed', 'invite_user'];
/** The seven fields of `SetDefault…MessageTextRequest` at v4.19.4, as protojson names them. */
const FIELDS = ['buttonText', 'footerText', 'greeting', 'preHeader', 'subject', 'text', 'title'];
/**
 * The variables `admin.proto` at v4.19.4 lists for these five mails, which
 * are `mapNotifyUserToArgs` plus `Code` (`internal/notification/types`);
 * `password_change` and `passwordless_registration` have all but `Code`.
 */
const VARIABLES = new Set([
  'Code',
  'UserName',
  'FirstName',
  'LastName',
  'NickName',
  'DisplayName',
  'LastEmail',
  'VerifiedEmail',
  'LastPhone',
  'VerifiedPhone',
  'PreferredLoginName',
  'LoginNames',
  'ChangeDate',
  'CreationDate',
]);
const SUPPORT = /export const SUPPORT_EMAIL = '([^']+)';/.exec(
  readFileSync(join(REPO_ROOT, 'site/prices.mjs'), 'utf8'),
)?.[1];

type Mail = Record<string, string>;
type Mails = Record<string, Record<string, Mail>>;
function mails(): Mails {
  return JSON.parse(readFileSync(MAILS_FILE, 'utf8')) as Mails;
}
const each = (all: Mails) =>
  LANGUAGES.flatMap((lang) => TYPES.map((type) => ({ lang, type, mail: all[lang]?.[type] ?? {} })));
const whole = (mail: Mail) => FIELDS.map((f) => mail[f] ?? '').join('\n');

describe('the mails, in the repository', () => {
  it('has Dutch and English, each with the same five mails and the same seven fields, none empty', () => {
    const all = mails();
    expect(Object.keys(all).sort()).toEqual(LANGUAGES);
    for (const lang of LANGUAGES) {
      expect(Object.keys(all[lang] ?? {}).sort(), lang).toEqual(TYPES);
      for (const type of TYPES) {
        const mail = all[lang]?.[type] ?? {};
        expect(Object.keys(mail).sort(), `${lang} ${type}`).toEqual(FIELDS);
        for (const f of FIELDS) expect(mail[f]?.trim(), `${lang} ${type} ${f}`).toBeTruthy();
      }
    }
  });

  it('each names Ownpace, in its subject and its text, and never the provider', () => {
    for (const { lang, type, mail } of each(mails())) {
      expect(mail.subject, `${lang} ${type}`).toContain('Ownpace');
      expect(mail.text, `${lang} ${type}`).toContain('Ownpace');
      expect(whole(mail), `${lang} ${type}`).not.toMatch(/zitadel/i);
    }
  });

  it('each says who to write to, as a placeholder the bring-up fills, and no other', () => {
    for (const { lang, type, mail } of each(mails())) {
      expect(mail.text, `${lang} ${type}`).toContain('{support}');
      const single = whole(mail).replace(/\{\{[^}]*\}\}/g, '').match(/\{[^}]*\}/g) ?? [];
      expect(single.filter((p) => p !== '{support}'), `${lang} ${type}`).toEqual([]);
    }
  });

  it('each text carries the code as Zitadel spells it, uses only its variables, and leaves the link to the button', () => {
    for (const { lang, type, mail } of each(mails())) {
      if (CODELESS.has(type)) expect(whole(mail), `${lang} ${type}`).not.toContain('Code');
      else expect(mail.text, `${lang} ${type}`).toContain('{{.Code}}');
      const used = [...whole(mail).matchAll(/\{\{(.*?)\}\}/g)].map((m) => m[1] ?? '');
      for (const v of used) {
        expect(/^\.([A-Za-z]+)$/.exec(v)?.[1], `${lang} ${type}: {{${v}}}`).toSatisfy(
          (name: string | undefined) =>
            name !== undefined && VARIABLES.has(name) && !(CODELESS.has(type) && name === 'Code'),
        );
      }
      expect(whole(mail), `${lang} ${type}`).not.toContain('URL');
    }
  });

  it('the Dutch says u, never je, and never verhuizing (migratie is the word)', () => {
    for (const type of TYPES) {
      const text = whole(mails().nl?.[type] ?? {});
      expect(text, type).toMatch(/\b(u|uw)\b/);
      expect(text, type).not.toMatch(/\b(je|jij|jou|jouw)\b/i);
      expect(text, type).not.toMatch(/verhuiz/i);
    }
  });
});

interface Held {
  /** The seven fields the instance holds for `{type}/{language}`. */
  [key: string]: Mail;
}

/** Upstream's own texts, as a fresh instance answers them: no footer, the rest from its i18n files. */
function upstream(): Held {
  const held: Held = {};
  for (const lang of LANGUAGES)
    for (const type of TYPES)
      held[`${type}/${lang}`] = {
        title: 'Verify email',
        preHeader: 'Verify email',
        subject: 'Verify email',
        greeting: 'Hello {{.DisplayName}},',
        text: 'Please use the button below. (Code {{.Code}})',
        buttonText: 'Verify email',
      };
  return held;
}

interface Provider {
  held: Held;
  /** `{type}/{language}`s whose write the provider refuses. */
  refuses?: string[];
  /** Whether a write the provider accepts takes effect. */
  takes?: boolean;
  /** How many reads after a write still answer the old text, as a projection behind its events does. */
  lag?: number;
  /**
   * `{type}/{language}`s whose every read rides out a 502 from the front first:
   * `api` says so on stderr, as `curl_read_retrying` does, and then answers.
   */
  blips?: string[];
  /** `{type}/{language}`s whose read the front never gets through: `api` dies on a lasting 502. */
  unreachable?: string[];
}

/**
 * Write the mails against a stand-in provider that answers as Zitadel does:
 * the seven fields under `customText`, an empty one left out, and a write
 * that replaces all seven. Returns what was said, how it ended, every write in
 * order with its body, what the instance holds after, and the summary's words.
 */
function send(provider: Provider, supportSetting: string) {
  const home = mkdtempSync(join(tmpdir(), 'mails-'));
  try {
    const state = join(home, 'state.json');
    const writes = join(home, 'writes');
    const lagFile = join(home, 'lag');
    writeFileSync(state, JSON.stringify(provider.held));
    writeFileSync(writes, '');
    writeFileSync(lagFile, '0');
    const program = [
      'set -euo pipefail',
      'ISSUER=https://id.example.test',
      'ENV_FILE=/stack/.env',
      'say() { echo "[setup-zitadel] $*"; }',
      'die() { echo "[setup-zitadel] FATAL: $*" >&2; exit 1; }',
      `SIGN_IN_MAILS="${MAILS_FILE}"`,
      `STATE="${state}"`,
      `WRITES="${writes}"`,
      `LAG_FILE="${lagFile}"`,
      `LAG=${provider.lag ?? 0}`,
      `TAKES=${provider.takes === false ? 'false' : 'true'}`,
      `REFUSES=' ${(provider.refuses ?? []).join(' ')} '`,
      `BLIPS=' ${(provider.blips ?? []).join(' ')} '`,
      `UNREACHABLE=' ${(provider.unreachable ?? []).join(' ')} '`,
      'sleep() { :; }',
      'api() {',
      '  local key="${2#/admin/v1/text/message/}"',
      '  case "$1 $2" in',
      '    "GET /admin/v1/text/message/"*)',
      '      case "$BLIPS$UNREACHABLE" in *" $key "*) echo "[setup-zitadel] GET $2: the front answered HTTP 502 without reaching the provider — attempt 1 of 4, retrying in 2s" >&2 ;; esac',
      '      case "$UNREACHABLE" in *" $key "*) printf \'[setup-zitadel] FATAL: GET %s answered HTTP 502:\\n    <!DOCTYPE html><title>Connection Error</title>\\n\' "$2" >&2; exit 1 ;; esac',
      '      local left; left="$(cat "$LAG_FILE")"',
      '      if [ "$left" -gt 0 ]; then echo $(( left - 1 )) > "$LAG_FILE"; jq -c --arg k "$key" \'{customText: .[$k]}\' "$STATE.before"; return 0; fi',
      '      jq -c --arg k "$key" \'{customText: (.[$k] | with_entries(select(.value != "")))}\' "$STATE" ;;',
      '    "PUT /admin/v1/text/message/"*)',
      '      echo "$1 $2 $3" >> "$WRITES"',
      '      case "$REFUSES" in *" $key "*) echo "[setup-zitadel] FATAL: PUT $2 answered HTTP 400: Errors.Internal" >&2; exit 1 ;; esac',
      '      cp "$STATE" "$STATE.before"; echo "$LAG" > "$LAG_FILE"',
      '      [ "$TAKES" = true ] && jq -c --arg k "$key" --argjson b "$3" \'.[$k] = ({title:"",preHeader:"",subject:"",greeting:"",text:"",buttonText:"",footerText:""} + $b)\' "$STATE" > "$STATE.new" && mv "$STATE.new" "$STATE"',
      '      echo \'{"details":{}}\' ;;',
      '    *) echo "unexpected call: $1 $2" >&2; exit 1 ;;',
      '  esac',
      '}',
      // The list of mails, as the script ships it.
      /^SIGN_IN_MAIL_TYPES=\(.*\)$/m.exec(setup)?.[0] ?? '',
      fn('sign_in_mail_support'),
      fn('sign_in_mail_wanted'),
      fn('sign_in_mail_read'),
      fn('set_sign_in_mails'),
      `SIGN_IN_MAIL_SUPPORT="$(sign_in_mail_support '${supportSetting}')"`,
      'set_sign_in_mails "$SIGN_IN_MAIL_SUPPORT"',
      'echo "SUMMARY ${SIGN_IN_MAILS_SAID}"',
    ].join('\n');
    const r = spawnSync('bash', ['-c', program], { encoding: 'utf8' });
    return {
      code: r.status ?? -1,
      said: `${r.stdout ?? ''}${r.stderr ?? ''}`,
      writes: readFileSync(writes, 'utf8').trim().split('\n').filter(Boolean),
      after: JSON.parse(readFileSync(state, 'utf8')) as Held,
      summary: /^SUMMARY (.*)$/m.exec(r.stdout ?? '')?.[1] ?? '',
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** What the instance should hold, from the file, with `{support}` filled. */
function wanted(address: string): Held {
  const held: Held = {};
  for (const { lang, type, mail } of each(mails()))
    held[`${type}/${lang}`] = Object.fromEntries(
      FIELDS.map((f) => [f, (mail[f] ?? '').replaceAll('{support}', address)]),
    );
  return held;
}

describe('the mails, at the provider', () => {
  it('the fallback address is the site’s own support address, never a copy of its own', () => {
    expect(SUPPORT).toBe('support@ownpace.eu');
    expect(fn('sign_in_mail_support')).toContain(`'${SUPPORT}'`);
  });

  it('on a fresh instance: all ten written, whole, with the address from VITE_SUPPORT_EMAIL, and read back', () => {
    const { code, said, writes, after, summary } = send({ held: upstream() }, 'help@example.test');
    expect(code, said).toBe(0);
    expect(writes).toHaveLength(10);
    for (const w of writes) {
      const [, path = '', body = ''] = /^PUT (\S+) (.*)$/.exec(w) ?? [];
      expect(path).toMatch(
        /^\/admin\/v1\/text\/message\/(init|verifyemail|passwordreset|password_change|passwordless_registration)\/(nl|en)$/,
      );
      expect(Object.keys(JSON.parse(body) as Mail).sort()).toEqual(FIELDS);
    }
    expect(after).toEqual(wanted('help@example.test'));
    expect(JSON.stringify(after)).not.toContain('{support}');
    expect(summary).toBe('nl, en; they name help@example.test');
  });

  it('writes nothing on a second run, when all ten are already Ownpace’s', () => {
    const { code, said, writes } = send({ held: wanted('help@example.test') }, 'help@example.test');
    expect(code, said).toBe(0);
    expect(writes).toEqual([]);
    expect(said).toContain('name help@example.test');
  });

  it('unset, names the service’s public support address; spaces around a set one are dropped', () => {
    expect(send({ held: upstream() }, '').after).toEqual(wanted('support@ownpace.eu'));
    expect(send({ held: upstream() }, '  help@example.test ').after).toEqual(wanted('help@example.test'));
  });

  it('rewrites only the mail that differs, such as one an operator changed in the console', () => {
    const held = wanted('support@ownpace.eu');
    held['passwordreset/nl'] = { ...held['passwordreset/nl'], subject: 'Wachtwoord resetten' };
    const { code, writes } = send({ held }, '');
    expect(code).toBe(0);
    expect(writes.map((w) => w.split(' ')[1])).toEqual(['/admin/v1/text/message/passwordreset/nl']);
  });

  it('a new address reaches all ten', () => {
    const { writes, after } = send({ held: wanted('support@ownpace.eu') }, 'help@example.test');
    expect(writes).toHaveLength(10);
    expect(after).toEqual(wanted('help@example.test'));
  });

  it('stops before writing anything for a VITE_SUPPORT_EMAIL that is not an address', () => {
    for (const bad of ['not an address', 'help@', '{{.Code}}@example.test']) {
      const { code, said, writes } = send({ held: upstream() }, bad);
      expect(code, bad).not.toBe(0);
      expect(said, bad).toContain('VITE_SUPPORT_EMAIL');
      expect(writes, bad).toEqual([]);
    }
  });

  it('asks again while the read lags the write, and is content once it shows', () => {
    const { code, said, summary } = send({ held: upstream(), lag: 2 }, '');
    expect(code, said).toBe(0);
    expect(said).not.toContain('still');
    expect(summary).toBe('nl, en; they name support@ownpace.eu');
  });

  it('a refused mail is said, the others are still written, and the run goes on', () => {
    const { code, said, writes, after, summary } = send(
      { held: upstream(), refuses: ['init/nl'] },
      '',
    );
    expect(code, said).toBe(0);
    expect(writes).toHaveLength(10);
    expect(said).toContain('REFUSED');
    expect(said).toContain('Errors.Internal');
    expect(after['init/en']).toEqual(wanted('support@ownpace.eu')['init/en']);
    expect(summary).toContain('NOT all set');
    expect(summary).toContain('init/nl');
  });

  it('a read that rode out a 502 from the front is READ: the retry line goes to the log, not into the answer', () => {
    // `sign_in_mail_read` wants die's words when the read fails, so it
    // captured `api`'s stderr too — and with `2>&1` the retry line stood in
    // front of the JSON, jq refused it, and a mail that WAS read was "left as
    // it is". #263's 502 was ridden out everywhere else and not here.
    const { code, said, writes, after, summary } = send({ held: upstream(), blips: ['init/nl'] }, '');
    expect(code, said).toBe(0);
    expect(said).not.toContain('could not read');
    expect(said).toContain('GET /admin/v1/text/message/init/nl: the front answered HTTP 502');
    expect(writes).toHaveLength(10);
    expect(after).toEqual(wanted('support@ownpace.eu'));
    expect(summary).toBe('nl, en; they name support@ownpace.eu');
  });

  it('a mail the front never reaches is said with die\'s words, the others are still written, and the run goes on', () => {
    const { code, said, writes, summary } = send({ held: upstream(), unreachable: ['init/nl'] }, '');
    expect(code, said).toBe(0);
    expect(said).toMatch(
      /could not read the init mail in nl, so it is left as it is:\n\[setup-zitadel\] {3}\[setup-zitadel\] FATAL: GET \/admin\/v1\/text\/message\/init\/nl answered HTTP 502:/,
    );
    expect(writes).toHaveLength(9);
    expect(summary).toContain('NOT all set');
    expect(summary).toContain('init/nl');
  });

  it('a write that does not take is said, and the run goes on', () => {
    const { code, said, summary } = send({ held: upstream(), takes: false }, '');
    expect(code, said).toBe(0);
    expect(said).toContain('still reads');
    expect(summary).toContain('NOT all set');
  });
});

describe('the bring-up, its mails', () => {
  it('sends them on every run, from the file and VITE_SUPPORT_EMAIL, after the notice, and says so in its summary', () => {
    const code = directives(setup);
    expect(code).toMatch(/^SIGN_IN_MAILS="\$\{SCRIPT_DIR\}\/sign-in-mails\.json"$/m);
    const notice = code.search(/^set_sign_in_notice "\$SIGN_IN_SITE"$/m);
    // An assignment first: inside an argument, the refusal of a bad address
    // would be a subshell's exit that set -e never sees.
    const support = code.search(
      /^SIGN_IN_MAIL_SUPPORT="\$\(sign_in_mail_support "\$\(read_env VITE_SUPPORT_EMAIL ''\)"\)"$/m,
    );
    const sent = code.search(/^set_sign_in_mails "\$SIGN_IN_MAIL_SUPPORT"$/m);
    expect(sent, 'nothing sends the mails').toBeGreaterThan(0);
    expect(support).toBeGreaterThan(notice);
    expect(sent).toBeGreaterThan(support);
    const summary = code.slice(code.lastIndexOf('cat <<EOF'));
    expect(summary).toMatch(/^ {2}mails {6}\$\{SIGN_IN_MAILS_SAID\}$/m);
  });

  it('writes to the five endpoints of the pinned version, by the path the proto declares', () => {
    const proto =
      'GET and PUT /admin/v1/text/message/{init,verifyemail,passwordreset,password_change,passwordless_registration}/{language}';
    const body = fn('set_sign_in_mails') + fn('sign_in_mail_read');
    expect(body, proto).toContain('/admin/v1/text/message/${type}/${lang}');
    expect(body, proto).toContain('/admin/v1/text/message/${2}/${1}');
    expect(setup).toMatch(
      /^SIGN_IN_MAIL_TYPES=\(init verifyemail passwordreset password_change passwordless_registration\)$/m,
    );
  });

  it('asks a code of every mail but the password-changed notice and the passkey link, which have none', () => {
    const wantedFn = fn('sign_in_mail_wanted');
    expect(wantedFn).toContain('{{.Code}}');
    for (const type of CODELESS) expect(wantedFn, type).toContain(`"${type}"`);
  });

  it('names each mail it leaves to upstream, with the reason, in its comment', () => {
    const at = setup.indexOf('# ------------------------------------------------- the mails a tester gets --');
    const comment = setup.slice(at, setup.indexOf('\nSIGN_IN_MAILS=', at));
    expect(at, 'the section is gone').toBeGreaterThan(0);
    for (const type of LEFT_OUT) expect(comment, type).toMatch(new RegExp(`^# ${type}: \\S`, 'm'));
  });
});

// ---------------------------------------------------- the organisation's name

/**
 * Name the organisation `want` against a stand-in provider that holds `name`
 * and refuses a rename to the name it already has.
 */
function rename(name: string, want: string, takes = true) {
  const home = mkdtempSync(join(tmpdir(), 'orgname-'));
  try {
    const state = join(home, 'state.json');
    const writes = join(home, 'writes');
    writeFileSync(state, JSON.stringify({ name }));
    writeFileSync(writes, '');
    const program = [
      'set -euo pipefail',
      'ISSUER=https://id.example.test',
      'say() { echo "[setup-zitadel] $*"; }',
      'die() { echo "[setup-zitadel] FATAL: $*" >&2; exit 1; }',
      `STATE="${state}"`,
      `WRITES="${writes}"`,
      `TAKES=${takes}`,
      'refuse() { echo "[setup-zitadel] FATAL: $1 $2 answered HTTP 412: $3" >&2; exit 1; }',
      'api() {',
      '  local s; s="$(cat "$STATE")"',
      '  case "$1 $2" in',
      '    "GET /management/v1/orgs/me") jq -c \'{org: {id: "310000000000000001", name: .name, state: "ORG_STATE_ACTIVE", primaryDomain: "\\(.name | ascii_downcase).id.example.test"}}\' <<<"$s" ;;',
      '    "PUT /management/v1/orgs/me")',
      '      echo "$1 $2 $3" >> "$WRITES"',
      '      local n; n="$(jq -r .name <<<"$3")"',
      '      [ "$(jq -r .name <<<"$s")" != "$n" ] || refuse "$1" "$2" "Errors.Org.NotChanged"',
      '      [ "$TAKES" = true ] && jq -c --arg n "$n" \'.name = $n\' <<<"$s" > "$STATE"',
      '      echo \'{"details":{}}\' ;;',
      '    *) echo "unexpected call: $1 $2" >&2; exit 1 ;;',
      '  esac',
      '}',
      fn('organisation_name'),
      fn('name_the_organisation'),
      'name_the_organisation "$WANT"',
      'echo "said: ${ORG_NAME_SAID}"',
    ].join('\n');
    const r = spawnSync('bash', ['-c', program], { encoding: 'utf8', env: { ...process.env, WANT: want } });
    return {
      code: r.status ?? -1,
      said: `${r.stdout ?? ''}${r.stderr ?? ''}`,
      writes: readFileSync(writes, 'utf8').trim().split('\n').filter(Boolean),
      after: (JSON.parse(readFileSync(state, 'utf8')) as { name: string }).name,
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** The name the script wants, from a `.env` holding `lines`, with the real readers of that file. */
function nameWanted(lines: string[]): { code: number; name: string; said: string } {
  const home = mkdtempSync(join(tmpdir(), 'orgname-env-'));
  try {
    const envFile = join(home, '.env');
    writeFileSync(envFile, `${lines.join('\n')}\n`);
    const compose = join(REPO_ROOT, 'deploy/compose');
    const program = [
      'set -euo pipefail',
      `. "${compose}/env-read.sh"`,
      `. "${compose}/stack-kind.sh"`,
      `ENV_FILE="${envFile}"`,
      fn('read_env'),
      fn('wanted_organisation_name'),
      'printf "%s" "$(wanted_organisation_name)"',
    ].join('\n');
    const r = spawnSync('bash', ['-c', program], { encoding: 'utf8' });
    return { code: r.status ?? -1, name: r.stdout ?? '', said: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const LIVE_MARKER = 'STACK_KIND=production';

describe('the organisation’s name (open question 8)', () => {
  it('on live, with ZITADEL_ORG_NAME empty or absent, is Ownpace', () => {
    for (const lines of [[LIVE_MARKER], [LIVE_MARKER, 'ZITADEL_ORG_NAME=']]) {
      const got = nameWanted(lines);
      expect(got.code, got.said).toBe(0);
      expect(got.name).toBe('Ownpace');
    }
  });

  it('elsewhere, with the key empty, is nobody’s to change: the OTA stack keeps its name', () => {
    const got = nameWanted(['COMPOSE_PROJECT_NAME=ownpace-managed']);
    expect(got.code, got.said).toBe(0);
    expect(got.name).toBe('');
  });

  it('is ZITADEL_ORG_NAME where the key is set, on any stack', () => {
    expect(nameWanted(['ZITADEL_ORG_NAME=Ownpace']).name).toBe('Ownpace');
    expect(nameWanted([LIVE_MARKER, 'ZITADEL_ORG_NAME=Ownpace']).name).toBe('Ownpace');
  });

  it('renames an organisation that stands under upstream’s name, once, and reads it back', () => {
    const { code, said, writes, after } = rename('ZITADEL', 'Ownpace');
    expect(code, said).toBe(0);
    expect(writes).toEqual(['PUT /management/v1/orgs/me {"name":"Ownpace"}']);
    expect(after).toBe('Ownpace');
    expect(said).toContain('said: Ownpace');
  });

  it('writes nothing when it is already named so, which Zitadel would refuse as NotChanged', () => {
    const { code, said, writes } = rename('Ownpace', 'Ownpace');
    expect(code, said).toBe(0);
    expect(writes).toEqual([]);
  });

  it('with nothing wanted, writes nothing and says the name it keeps', () => {
    const { code, said, writes } = rename('ZITADEL', '');
    expect(code, said).toBe(0);
    expect(writes).toEqual([]);
    expect(said).toContain('said: ZITADEL');
    expect(said).toContain('ZITADEL_ORG_NAME');
  });

  it('stops, naming it, when the rename does not take', () => {
    const { code, said } = rename('ZITADEL', 'Ownpace', false);
    expect(code).not.toBe(0);
    expect(said).toContain('could not name the organisation Ownpace');
  });
});

describe('the bring-up, the organisation’s name', () => {
  it('names it after the lockout and before the summary reads its domain, and says it in its summary', () => {
    const code = directives(setup);
    const locked = code.search(/^set_sign_in_lockout "\$SIGN_IN_LOCKOUT_PASSWORDS"$/m);
    const named = code.search(/^name_the_organisation "\$\(wanted_organisation_name\)"$/m);
    const domain = code.search(/^org_me="\$\(api GET \/management\/v1\/orgs\/me/m);
    expect(named, 'nothing names the organisation').toBeGreaterThan(0);
    expect(named).toBeGreaterThan(locked);
    expect(domain).toBeGreaterThan(named);
    const summary = code.slice(code.lastIndexOf('cat <<EOF'));
    expect(summary).toMatch(/^ {2}organisation \$\{ORG_NAME_SAID\}$/m);
  });

  it('a fresh instance takes ZITADEL_ORG_NAME at its first start, and upstream’s name when it is empty', () => {
    const compose = parseYaml(readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8')) as {
      services: Record<string, { environment?: Record<string, unknown> }>;
    };
    expect(compose.services.zitadel?.environment?.ZITADEL_FIRSTINSTANCE_ORG_NAME).toBe('${ZITADEL_ORG_NAME:-ZITADEL}');
  });

  it('live’s first bring-up writes Ownpace into live’s .env when the key is empty, before the provider first starts', () => {
    const live = directives(readFileSync(join(REPO_ROOT, 'deploy/compose/stand-up-live.sh'), 'utf8'));
    const written = live.search(/ZITADEL_ORG_NAME=\$\{LIVE_ORG_NAME\}/);
    const bringUp = live.search(/^\s*bring_up --only preflight$/m);
    expect(written, 'stand-up-live.sh never writes the name').toBeGreaterThan(0);
    expect(written).toBeLessThan(bringUp);
    // Spelled once, beside live's marker, for both scripts.
    const kind = directives(readFileSync(join(REPO_ROOT, 'deploy/compose/stack-kind.sh'), 'utf8'));
    expect(kind).toMatch(/^LIVE_ORG_NAME=Ownpace$/m);
    expect(directives(setup)).not.toMatch(/^LIVE_ORG_NAME=/m);
  });
});
