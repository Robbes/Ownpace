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
 * The subjects THIS SYSTEM writes, which no identity provider ever minted.
 *
 * ONE LIST, and the link is refused for every entry in it — so adding a third
 * kind cannot accidentally ship a link to a user that does not exist. That is
 * the failure going the safe way round, which matters because the failure is
 * invisible from here: the console answers an unknown id with its whole user
 * list and an error, which reads as a broken product rather than as a subject
 * nobody has.
 *
 *   pending — granted but not yet claimed. `members.ts` and the access-request
 *             grant both write `pending:${randomUUID()}` into a NOT NULL column
 *             because the person has not signed in and there is no subject to
 *             bind to; claiming replaces it with the real one. Found in live
 *             use on 2026-08-31.
 *   seed    — the demo fixtures `seed-managed.ts` writes. There is no person
 *             behind them at all and there never will be. Found in live use on
 *             2026-09-01, the same way and by the same person: the owner
 *             clicked `owner-a@demo.openmigrate.test` on the support screen and
 *             landed on the provider's user list.
 */
export const LOCAL_SUBJECT_PREFIXES = {
  pending: 'pending:',
  seed: 'seed:',
} as const;

/** Which kind of ours-not-theirs a subject is, or null when it is a real one. */
export type LocalSubjectKind = keyof typeof LOCAL_SUBJECT_PREFIXES;

/**
 * Is this one of ours, and which?
 *
 * Exported so the screen can say WHICH kind of "no link" this is. Absent
 * because a deployment never configured a console, absent because the person
 * has not signed in, and absent because there is no person, look identical on
 * the page and mean three different things: one is a setting, one is a fact
 * about somebody that changes by itself the moment they arrive, and one never
 * changes at all.
 */
export function localSubjectKind(subject: string): LocalSubjectKind | null {
  const sub = subject.trim();
  for (const [kind, prefix] of Object.entries(LOCAL_SUBJECT_PREFIXES)) {
    if (sub.startsWith(prefix)) return kind as LocalSubjectKind;
  }
  return null;
}

/**
 * Is this an invitation nobody has answered yet, rather than an account?
 *
 * Kept as its own name because it is the one the screen has a sentence for —
 * "has not signed in yet" is true of a `pending:` subject and false of a
 * seeded one, and collapsing them would put the wrong sentence beside a demo
 * fixture.
 */
export function isPendingSubject(subject: string): boolean {
  return localSubjectKind(subject) === 'pending';
}

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
 *  - an empty subject — a link to the console's own idea of "no user";
 *  - a LOCAL subject — one of ours, which no provider ever minted. A console
 *    link for one necessarily lands on a page about a user that does not
 *    exist, and the console answers that with its full user list and an error,
 *    which reads like a broken link rather than like a person who has simply
 *    not arrived (`pending:`) or was never a person at all (`seed:`). Both
 *    were found in live use, on 2026-08-31 and 2026-09-01. See
 *    LOCAL_SUBJECT_PREFIXES.
 */
export function idpConsoleUserUrl(
  subject: string,
  source: ConsoleEnv = buildEnv(),
): string | null {
  const template = source.VITE_IDP_CONSOLE_USER_URL?.trim();
  if (!template || !template.includes(SUBJECT_PLACEHOLDER)) return null;
  const sub = subject.trim();
  if (!sub) return null;
  // Ours, not the provider's — see LOCAL_SUBJECT_PREFIXES. Every place that
  // mints one is in this repository, so the prefix is a fact about this system
  // rather than a guess about somebody else's identity provider. Asked as
  // "is it any of ours" rather than "is it pending", so a prefix added later
  // is refused a link by default instead of by remembering.
  if (localSubjectKind(sub) !== null) return null;

  // `split`/`join` rather than `replaceAll`: the web build's lib target is
  // below es2021, and the convenient method typechecks nowhere here.
  const url = template.split(SUBJECT_PLACEHOLDER).join(encodeURIComponent(sub));
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
