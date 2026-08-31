// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A way through to the account, at whatever provider holds it.
 *
 * ## Why this is a variable and not two lines of string concatenation
 *
 * The account-level things an operator sometimes has to do — a password nobody
 * can reset, a second factor lost with a phone, an account to disable — are the
 * identity provider's job and never Ownpace's. ADR-0042's second operative rule
 * is why: the issuer owns identity, `tenant_member` owns tenancy, and the
 * product never calls the provider's user-management API. So the honest help is
 * a link, not a screen.
 *
 * The obvious way to build that link is to take the issuer we already have and
 * append the console path. It would work today, pass every test in the
 * repository, and be exactly the decay ADR-0042's third rule exists to stop —
 * `no-issuer-lock-in.unit.test.ts` says it in its own words: "one hard-coded
 * endpoint path, and switching is a project again rather than a variable.
 * Nobody notices, because everything still works — until the day it has to
 * move." The console path is not an OIDC concept and no two providers agree on
 * it:
 *
 *     Zitadel    /ui/console/users/<sub>
 *     Keycloak   /admin/master/console/#/<realm>/users/<sub>/settings
 *     Authentik  /if/admin/#/identity/users/<sub>
 *
 * None of those belongs in `apps/web/src`. The DEPLOYMENT knows which provider
 * it deployed — `setup-zitadel.sh` writes this variable beside the four that
 * already make the issuer swappable — and the guard now refuses all three
 * shapes in shipped source, so the next person to reach for the convenient
 * version is stopped rather than trusted.
 *
 * ## Unset is a first-class answer
 *
 * A deployment that has not set it gets no link and no broken one. That is the
 * appliance (no issuer at all, hard rule 5), a stack mid-upgrade, and any
 * provider whose console is not addressable per user — three real cases, all of
 * which must render a screen rather than a dead anchor.
 */

export interface ConsoleEnv {
  readonly VITE_IDP_CONSOLE_USER_URL?: string;
}

/**
 * `import.meta.env` IS NOT SHARED BETWEEN MODULES — vitest hands each file its
 * own object, so a test that sets it sets it on the test file and this module
 * never sees it. `oidc.ts` reached the same conclusion and took the same shape:
 * the work is a pure function OF an environment, and only the caller-less
 * default reaches for the build's. Not a testing workaround — it is what makes
 * the value checkable at all.
 */
const buildEnv = (): ConsoleEnv =>
  ((import.meta as unknown as { env?: ConsoleEnv }).env ?? {}) as ConsoleEnv;

/** The token the template must carry, so a link without a subject cannot ship. */
export const SUBJECT_PLACEHOLDER = '{sub}';

/**
 * The provider's page for one account, or null when this deployment cannot say.
 *
 * REFUSES RATHER THAN GUESSES, in all four ways it can be wrong:
 *
 *  - unset, or blank — the deployment has not been told (the ordinary case);
 *  - a template with no `{sub}` — it would send every person to the same page,
 *    which is worse than no link because it looks like it worked;
 *  - a scheme that is not http(s) — this value reaches an `href`, and a
 *    `javascript:` one would run in the operator's session. Build-time config
 *    is not user input, but a refusal here costs nothing and closes it;
 *  - an empty subject — a link to the console's own idea of "no user".
 */
export function idpConsoleUserUrl(
  subject: string,
  source: ConsoleEnv = buildEnv(),
): string | null {
  const template = source.VITE_IDP_CONSOLE_USER_URL?.trim();
  if (!template || !template.includes(SUBJECT_PLACEHOLDER)) return null;
  if (!subject.trim()) return null;

  // `split`/`join` rather than `replaceAll`: the web build's lib target is
  // below es2021, and the convenient method typechecks nowhere here.
  const url = template.split(SUBJECT_PLACEHOLDER).join(encodeURIComponent(subject.trim()));
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    // Not a URL at all. Nothing to render, and nothing to say beyond that —
    // the screen shows the person without a link, which is the same as any
    // deployment that never set it.
    return null;
  }
}
