// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SECOND DOOR, WITH THE LINKING DECIDED FIRST (workplan 0102 T2).
 *
 * Federation is CONFIGURATION, not code. ADR-0042's third operative rule keeps
 * provider names out of the product, and `no-issuer-lock-in.unit.test.ts`
 * enforces it by scanning `apps/api/src`, `apps/web/src` and `packages` — so a
 * "Login with Google" button in the web app is the one implementation CI
 * rejects, and correctly. The permitted shape puts the upstream inside Zitadel:
 * Zitadel still mints the token, `iss` is still ours, `sub` is still a Zitadel
 * subject, and `tenant_member` never learns anybody used Google.
 *
 * THE ORDER MATTERED. ADR-0042's amended invariant is that
 * `tenant_member.user_id` IS the token's `sub`. A flow that preserves `sub` is
 * safe; one that mints a NEW `sub` orphans a membership — somebody who signed
 * up by email in March and presses a provider button in April is a different
 * subject unless something links the two, and finds themselves locked out of an
 * organisation they are still a member of. Which is why 0102 T2 said the
 * linking decision comes BEFORE the second method is offered, and why these
 * rules pin the decision rather than only the wiring.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = join(REPO_ROOT, 'deploy/compose');

/** Shell source with comment-only lines removed — a rule must not forbid its
 *  own explanation. */
function directives(path: string): string {
  return readFileSync(join(COMPOSE, path), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

const setup = directives('setup-zitadel.sh');

describe('the linking decision is configured, not left to a default', () => {
  it('prompts to link on a verified email rather than merging silently', () => {
    /**
     * `AUTO_LINKING_OPTION_EMAIL` is Zitadel's *prompt* — "is this you?" — on a
     * match of the upstream's VERIFIED email. The proto is explicit that when
     * several users match, no prompt is shown at all, which is the ambiguous
     * case failing closed rather than guessing. Leaving this unset
     * (`UNSPECIFIED`) means every provider sign-in silently creates a second
     * account.
     */
    expect(
      setup,
      'no auto-linking option is set, so a provider sign-in by somebody who\n' +
        'already has an account creates a SECOND one — and orphans their\n' +
        'membership, which is keyed on the subject.',
    ).toMatch(/AUTO_LINKING_OPTION_EMAIL/);
  });

  it('leaves auto-update OFF, so an upstream cannot move somebody\'s address', () => {
    /**
     * Workplan 0102 T3 makes `tenant_member.email` follow the verified claim on
     * every sign-in. With `isAutoUpdate` on, those two chain: the upstream
     * asserts a different address, Zitadel rewrites the account, `/api/me`
     * rewrites the membership label, and an organisation's members table
     * follows Google. The membership survives — it is keyed on `sub` — but the
     * address colleagues see would not be ours to explain.
     */
    expect(setup, 'isAutoUpdate is on: an upstream can move a member label').toMatch(
      /isAutoUpdate:\s*false/,
    );
  });

  it('never treats an unproven address as verified', () => {
    /**
     * Zitadel's own note on the Azure field: "Azure AD doesn't send if the email
     * has been verified. Enable this if the user email should always be added
     * verified in Zitadel (no verification emails will be sent)."
     *
     * `email_verified` is what binds an invitation (migration 0006) and what
     * moves a membership label (0102 T3). An address asserted but never proved
     * would be enough to answer an invitation addressed to somebody else.
     */
    expect(
      setup,
      'the Microsoft provider marks addresses verified without verifying them.\n' +
        'That is enough to answer somebody else’s invitation.',
    ).toMatch(/emailVerified:\s*false/);
  });
});

describe('and a provider that is configured is a provider somebody can see', () => {
  it('adds each one to the login policy, not only to the instance', () => {
    // Creating the IdP configures it; adding it to the login policy is what
    // puts the button on the sign-in screen. Skipping the second leaves a stack
    // that looks configured from the API and offers a person nothing.
    expect(setup).toMatch(/\/admin\/v1\/policies\/login\/idps/);
  });

  it('turns external sign-in on exactly when a provider exists', () => {
    /**
     * A third way to have a stack that looks configured and shows nothing:
     * `allowExternalIdp` false. It follows what is configured rather than being
     * a knob of its own — on with providers, off without — so a deployment that
     * removes its last one has it turned back off on the next run.
     */
    expect(setup, 'nothing derives whether providers may be offered').toMatch(/WANT_EXTERNAL=/);
    expect(setup, 'the login policy does not carry that decision').toMatch(
      /allowExternalIdp:\$x/,
    );
  });

  it('reads the setting back, because the answer to the write names no field', () => {
    expect(setup).toMatch(/read_allow_external/);
  });

  it('offers nothing, and says so, when no provider is configured', () => {
    // Not a warning: a deployment with no upstream is the ordinary case, and
    // this line is what tells an operator the absence was noticed.
    expect(setup).toMatch(/none configured/);
  });
});

describe('and the credentials stay where credentials go', () => {
  it('reads every provider secret from the environment', () => {
    for (const key of [
      'IDP_GOOGLE_CLIENT_SECRET',
      'IDP_MICROSOFT_CLIENT_SECRET',
      'IDP_GITHUB_CLIENT_SECRET',
      'IDP_APPLE_PRIVATE_KEY',
    ]) {
      expect(setup, `${key} is not read from the environment`).toMatch(
        new RegExp(`read_env ${key}`),
      );
    }
  });

  it('carries no client id or secret of its own', () => {
    /**
     * Hard rule 3. A provider credential in the repository is a credential in
     * every clone of it, and these are the ones that let somebody mint sign-ins
     * as this deployment.
     */
    const raw = readFileSync(join(COMPOSE, 'setup-zitadel.sh'), 'utf8');
    expect(raw, 'something that looks like a Google client id is in the script').not.toMatch(
      /\d{10,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com/,
    );
    expect(raw, 'a PEM private key block is in the script').not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });

  it('documents every one of them in the env example', () => {
    const example = readFileSync(join(COMPOSE, 'managed.env.example'), 'utf8');
    for (const key of [
      'IDP_GOOGLE_CLIENT_ID',
      'IDP_MICROSOFT_CLIENT_ID',
      'IDP_MICROSOFT_TENANT',
      'IDP_GITHUB_CLIENT_ID',
      'IDP_APPLE_CLIENT_ID',
      'IDP_APPLE_TEAM_ID',
      'IDP_APPLE_KEY_ID',
      'IDP_APPLE_PRIVATE_KEY',
    ]) {
      expect(example, `${key} is read but never documented`).toContain(`${key}=`);
    }
  });

  it('names the callback Apple needs, which is not the one the others need', () => {
    /**
     * Apple POSTS its answer, so Zitadel hands it
     * `/ui/login/login/externalidp/callback/form` while everyone else gets
     * `/ui/login/login/externalidp/callback`. Registering the wrong one at
     * Apple fails at the last step of a flow that looked fine, which is the
     * expensive kind of wrong.
     */
    const example = readFileSync(join(COMPOSE, 'managed.env.example'), 'utf8');
    expect(example).toContain('/ui/login/login/externalidp/callback');
    expect(example, 'the form-post callback Apple needs is not documented').toContain(
      '/ui/login/login/externalidp/callback/form',
    );
  });
});

describe('and none of it reached the product', () => {
  it('names no provider in the web app or the API', () => {
    /**
     * `no-issuer-lock-in.unit.test.ts` is the rule that enforces this and it
     * runs on every unit pass. This case exists so that THIS change is read as
     * having respected it: everything above is deployment configuration, and
     * the buttons appear because Zitadel renders them, not because we wrote
     * one.
     */
    const lock = readFileSync(
      join(REPO_ROOT, 'apps/api/src/middleware/no-issuer-lock-in.unit.test.ts'),
      'utf8',
    );
    expect(lock, 'the lock-in rule is gone — that is what kept this honest').toMatch(
      /apps\/web\/src|apps\/api\/src/,
    );
  });

  /**
   * AND IT DOES NOT CLAIM TO HAVE CHECKED WHAT IT HAS NOT.
   *
   * `configure_idp` finds an existing provider by NAME — "Google" — and that
   * is all it establishes. It compares no client id, no secret, no option
   * against what `.env` now says, and a secret cannot be read back to compare
   * even if it tried. So "already configured" was a claim about the world made
   * from a match on a constant.
   *
   * The SMTP block a few hundred lines up is the pattern this one missed: it
   * matches on `.smtp.host`, the relay address out of `.env`, so changing
   * SMTP_HOST and re-running genuinely moves the mail. Matching on a name that
   * never changes cannot converge on anything.
   *
   * WHAT THAT COSTS SOMEBODY: mistype a secret, fix it in `.env`, re-run, and
   * the old one stays. Every button still fails and the log says the provider
   * is configured. The rule keeps the line honest about which of those two
   * things it actually knows — the full fix needs update endpoints whose
   * behaviour on an omitted secret is not established, and this file's job is
   * to stop the message drifting back to the comfortable version meanwhile.
   */
  it('does not report an unchecked provider as configured', () => {
    const claim = /say\s+"\s*\$\{name\}:\s*already configured/;
    expect(
      setup,
      'configure_idp reports an existing provider as "already configured".\n\n' +
        'It matched on the provider NAME and nothing else — not the client id,\n' +
        'not the secret, not one option. Somebody who fixes a mistyped secret\n' +
        'in .env and re-runs gets that line and an unchanged provider, so every\n' +
        'button still fails while the log says it is configured.\n\n' +
        'Say what was established (a provider of this name exists, left as it\n' +
        'is) or make the claim true by reconciling the configuration.',
    ).not.toMatch(claim);
  });

  it('tells somebody how to change a credential, since a re-run will not', () => {
    expect(
      setup,
      'the existing-provider branch no longer says that the credentials in\n' +
        '.env are not re-sent. That sentence is the whole remedy: without it,\n' +
        'the only way to discover that a re-run changed nothing is to watch a\n' +
        'sign-in keep failing.',
    ).toMatch(/NOT re-sent/);
  });

  /**
   * AND THE OPERATOR GUIDE KEEPS UP WITH THE KEYS.
   *
   * The provider section of docs/managed-bring-up.md is the operator guide for
   * this feature — console table, both return URIs, the .env half, rotation,
   * removal. Three of its claims are load-bearing enough to pin:
   *
   * The KEYS rule is derived from managed.env.example rather than listed here,
   * for the reason a-port-the-gate-assumed derives its ports from managed.yml:
   * add IDP_FACEBOOK_CLIENT_ID tomorrow and the guide must name it the same
   * day, without anybody remembering this file exists.
   *
   * The ROTATION sentence mirrors the script-side rule above: the script may
   * not claim an unchecked provider is configured, and the guide must carry
   * the consequence — a re-run never re-sends credentials — because the guide
   * is where an operator looks BEFORE they are stuck, and the script's line is
   * what they see after.
   */
  const bringUp = readFileSync(join(REPO_ROOT, 'docs/managed-bring-up.md'), 'utf8');
  const sectionStart = bringUp.indexOf('#### Offering Google');
  const guide =
    sectionStart >= 0
      ? bringUp.slice(sectionStart, bringUp.indexOf('\n#### ', sectionStart + 1))
      : '';

  it('still has an operator guide to hold to account', () => {
    expect(
      sectionStart,
      'docs/managed-bring-up.md no longer has the "Offering Google…" provider\n' +
        'section. If the guide moved, point these rules at the new home — the\n' +
        'keys, the two return URIs and the rotation caveat still need a page.',
    ).toBeGreaterThan(-1);
  });

  it('names every provider key the stack accepts', () => {
    const example = readFileSync(
      join(REPO_ROOT, 'deploy/compose/managed.env.example'),
      'utf8',
    );
    const keys = [...example.matchAll(/^(IDP_[A-Z0-9_]+)=/gm)].map((m) => m[1]!);
    expect(keys.length, 'managed.env.example declares no IDP_ keys').toBeGreaterThan(0);
    for (const key of keys) {
      expect(
        guide,
        `managed.env.example accepts ${key} and the operator guide never names\n` +
          'it. An operator copying key names out of the guide silently skips\n' +
          'this one, and the provider it belongs to is then "not offered" with\n' +
          'no error anywhere.',
      ).toContain(key);
    }
  });

  it('shows both return URIs, because Apple is not like the others', () => {
    expect(
      guide,
      'the guide no longer shows the plain /callback return URI.',
    ).toMatch(/externalidp\/callback(?!\/form)/);
    expect(
      guide,
      "the guide no longer shows Apple's /callback/form return URI. Apple\n" +
        'POSTS its answer instead of redirecting, so registering the plain\n' +
        'callback there fails at the last step of setup with an error that\n' +
        'names neither the URI nor Apple.',
    ).toContain('externalidp/callback/form');
  });

  it('warns that a re-run never re-sends credentials', () => {
    expect(
      guide,
      'the guide no longer says a re-run never re-sends credentials. That is\n' +
        'the one lifecycle fact an operator cannot guess: fixing a secret in\n' +
        '.env and re-running looks like the obvious remedy, does nothing, and\n' +
        'the script only says so after they are already stuck.',
    ).toMatch(/never re-sends credentials/);
  });
});
