// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The identity provider is actually part of the managed gate (workplan 0099).
 *
 * ## What this is guarding against, which already happened
 *
 * `zitadel` went into `managed.yml` in #496. It was never added to the list of
 * services `bootstrap-managed.sh` starts — that list is explicit, so that a
 * bare `up -d` cannot publish Nextcloud's `change-me` admin panel — and nothing
 * ever invoked `setup-zitadel.sh`, which is documented as a step a person runs
 * by hand.
 *
 * The result held for three weeks: the identity provider was DEFINED, its
 * secrets were REQUIRED by every compose command (which is how E2E (managed)
 * #34–#36 died), and it was never started and never configured. The nightly was
 * green and said nothing whatsoever about whether anybody could sign in.
 *
 * Two hand-maintained lists, neither checked against anything. Same shape as
 * `MOUNTS` (0096), the `pull_request` trigger filters (0097) and the pre-flight
 * env list (0098) — so it gets the same treatment.
 *
 * ## And the three answers
 *
 * The smoke has to exercise accept, decline AND skip, and skip is the one a
 * later edit is most likely to "fix" into a request. It is asserted as an
 * absence: no call is made for the third invitation, and the assertion is that
 * it is still open and still offered afterwards.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMPOSE = fileURLToPath(new URL('../deploy/compose/', import.meta.url));
const read = (name: string): string => readFileSync(COMPOSE + name, 'utf8');

const bootstrap = read('bootstrap-managed.sh');
const smoke = read('smoke-managed.sh');
const managed = read('managed.yml');

describe('the gate starts and configures the identity provider', () => {
  it('read the real scripts', () => {
    // Vacuity guard: every assertion below passes against an empty string.
    expect(bootstrap.length).toBeGreaterThan(2000);
    expect(smoke.length).toBeGreaterThan(2000);
    expect(managed).toContain('zitadel:');
  });

  it('names zitadel in the explicit service list, not just in managed.yml', () => {
    // The list is explicit on purpose (a bare `up -d` would publish the demo
    // Nextcloud's default admin password), which is exactly why a service can
    // be in the compose file and never start.
    // To the closing paren ON ITS OWN LINE. A non-greedy match to the first `)`
    // stops inside the comment above `zitadel`, which cites (ADR-0042) — and
    // then this test passes or fails on punctuation rather than on the list.
    const list = /local services=\(([\s\S]*?)\n\s*\)/.exec(bootstrap)?.[1] ?? '';
    expect(list, 'bootstrap-managed.sh must START the identity provider').toMatch(
      /^[ \t]*zitadel[ \t]*$/m,
    );
  });

  it('provisions BEFORE the web build, or the login page has no client id', () => {
    // Ordering, asserted as ordering. setup-zitadel.sh writes VITE_OIDC_ISSUER
    // and VITE_OIDC_CLIENT_ID, and VITE_ values are baked into the bundle at
    // build time — so provisioning after `up --build` gives every first-ever
    // bring-up a login page that knows no client, correct only from the second
    // run. That is an instruction nobody should have to be given.
    const setup = bootstrap.indexOf('setup-zitadel.sh');
    const build = bootstrap.indexOf('up -d --build --wait "${services[@]}"');
    expect(setup, 'setup-zitadel.sh must be invoked').toBeGreaterThan(-1);
    expect(build, 'the web build must be found').toBeGreaterThan(-1);
    expect(setup, 'provisioning has to happen before the build').toBeLessThan(build);
  });

  it('re-reads .env after provisioning, so the build sees what it wrote', () => {
    // The half that makes the ordering count. Without it the build runs with
    // the environment as it was BEFORE the client id existed, and the ordering
    // is correct on paper and useless in fact.
    const between = bootstrap.slice(
      bootstrap.indexOf('setup-zitadel.sh'),
      bootstrap.indexOf('up -d --build --wait "${services[@]}"'),
    );
    expect(between, 'load_env must run between provisioning and the build').toContain('load_env');
  });

  it('runs setup-zitadel.sh, because starting it is not configuring it', () => {
    // It creates the project and the public PKCE client and writes JWT_ISSUER.
    // Without it the container is up and the stack authenticates nobody.
    expect(bootstrap).toMatch(/\$\{SCRIPT_DIR\}\/setup-zitadel\.sh/);
  });
});

describe('the smoke can tell a configured issuer from a running container', () => {
  it('reads JWT_ISSUER from the API container rather than from .env', () => {
    // What the running service verifies against. A file on the host is at best
    // a claim about that, and this gate exists because a claim was wrong.
    expect(smoke).toMatch(/docker exec "\$API_CONTAINER" printenv JWT_ISSUER/);
  });

  it('asks from INSIDE the API container, not from the host', () => {
    // The difference between a real check and a green that lies.
    // ZITADEL_EXTERNALDOMAIN defaulted to `localhost`, which the host can reach
    // (the port is published) and the API container cannot (there `localhost`
    // is the API). Checked from the host, a stack whose API can verify no token
    // at all passes. The only question worth asking is whether the thing that
    // verifies tokens can reach the keys.
    expect(smoke).toMatch(/docker exec "\$API_CONTAINER".*openid-configuration/s);
    expect(smoke, 'the JWKS fetch must come from there too').toMatch(
      /idp_get "\$JWKS"/,
    );
  });

  it('asks with a client the API image actually HAS', () => {
    // THE IMAGE HAS NO CURL. `apps/api/Dockerfile` builds on `node:24-slim`,
    // and its own HEALTHCHECK is `node -e "fetch(...)"` for exactly this
    // reason. Asked on the running stack:
    //
    //   docker exec ownpace-api sh -lc 'command -v curl'  ->  no curl
    //   docker exec ownpace-api sh -lc 'command -v wget'  ->  no wget
    //   docker exec ownpace-api sh -lc 'command -v node'  ->  /usr/local/bin/node
    //
    // This section used `curl`, so on every run ever made `sh: 1: curl: not
    // found` became the empty string — and the empty string was then REPORTED
    // as "the API cannot reach the issuer at all". A verdict the check had not
    // measured and, with no curl in the image, could never have measured. It
    // happened to be right in E2E (managed) #52 and would have said exactly the
    // same thing about a perfectly reachable issuer.
    const section = smoke.slice(
      smoke.indexOf('note "identity provider"'),
      smoke.indexOf('note "an invitation'),
    );
    expect(section, 'nothing in this section may reach for curl or wget in the API container')
      .not.toMatch(/docker exec "?\$API_CONTAINER"?[^\n]*\b(curl|wget)\b/);
    expect(section).toMatch(/docker exec "\$API_CONTAINER" node -e/);
    expect(section, 'the same client the API verifies tokens with').toContain('fetch(');
  });

  it('keeps "could not ask" apart from "could not reach" apart from "answered"', () => {
    // Hard rule 10: a status must belong to the thing that happened. The probe
    // failing to RUN, the issuer being unreachable, and the issuer answering
    // something unexpected are three facts about three different things, and
    // collapsing them into one empty string is what manufactured #52's
    // diagnosis. The exit codes are curl's own, so they read the same way.
    const section = smoke.slice(
      smoke.indexOf('note "identity provider"'),
      smoke.indexOf('note "an invitation'),
    );
    expect(section, 'the exit status must be kept').toMatch(/DISC_RC=\$\?/);
    expect(section, 'unreachable is its own case').toMatch(/\n\s*7\)/);
    expect(section, 'a non-2xx answer is its own case').toMatch(/\n\s*22\)/);
    expect(section, 'and so is the probe itself failing').toContain('this check could not run');
    // The masking that made the whole thing possible.
    expect(section).not.toMatch(/openid-configuration[^\n]*\|\| true/);
  });

  it('fetches the discovery document and the keys, and FAILS on either', () => {
    expect(smoke).toContain('/.well-known/openid-configuration');
    expect(smoke).toContain('jwks_uri');
    // Not an echo. The whole class of bug here is a check that reports and does
    // not change the verdict — run #6's green said "SKIPPED" and "SMOKE PASS"
    // three lines apart.
    const section = smoke.slice(smoke.indexOf('note "identity provider"'));
    expect(section.slice(0, section.indexOf('note "an invitation'))).toContain('fail=1');
  });

  it('checks the issuer declares its own name, byte for byte', () => {
    // OIDC Discovery §4.3, and the rule both `oidc.ts` and `auth.ts` enforce: a
    // document naming a different issuer is not this issuer.
    expect(smoke).toMatch(/DECLARED/);
    expect(smoke).toContain('declares');
  });
});

describe('the smoke answers an invitation three ways', () => {
  const section = smoke.slice(smoke.indexOf('note "an invitation, answered three ways"'));

  it('accepts one and declines another, over real HTTP', () => {
    expect(section).toMatch(/\/api\/invitations\/\$\{T1\}\/accept/);
    expect(section).toMatch(/\/api\/invitations\/\$\{T2\}\/decline/);
  });

  it('SKIPS the third by making no request at all', () => {
    // The assertion that matters, and the one a later edit would break by
    // "finishing" the pattern. Skipping is the absence of a call; if T3 ever
    // appears in a request URL, skip has stopped being skip.
    expect(section, 'the skipped invitation must never be POSTed to').not.toMatch(
      /\/api\/invitations\/\$\{T3\}\//,
    );
    expect(section, 'and it must be asserted still open').toMatch(/s3.*=.*'invited'|'invited'/);
  });

  it('asserts a refusal names nobody', () => {
    // Migration 0008's WITH CHECK guarantees it; this is the end-to-end reading
    // of that guarantee, and it is the difference between a refusal and a
    // permanent record of who refused.
    expect(section).toContain('pending:*)');
    expect(section).toMatch(/declining BOUND the decliner/);
  });

  it('cleans up the rows it wrote', () => {
    // The gate runs nightly against a long-lived stack. A smoke that leaves
    // rows behind grows the thing it is measuring — 0084's fixture lesson.
    expect(section).toMatch(/DELETE FROM tenant_member WHERE tenant_id=/);
    expect(section).toMatch(/DELETE FROM tenant WHERE id=/);
  });
});

/**
 * The port the provider is published on — and the port it says it is on.
 *
 * E2E (managed) run #38 was the identity provider's FIRST bring-up on the
 * self-hosted runner. It got as far as creating the container and then died:
 *
 *   Bind for 0.0.0.0:8080 failed: port is already allocated
 *
 * Not to anything in this stack. 8080 is simply the port every other thing on
 * a machine wants, and this repository already knew that — `setup-stalwart.sh`
 * publishes JMAP on 18080 rather than 8080 for the same reason, and the E2E
 * (selfhost) gate picks genuinely free ports at run time instead of assuming.
 * The provider is the one service that cannot do that, because its port is
 * baked into every token's `iss`; so it needs a number that is free by
 * convention, and 3126 continues the block this stack already owns.
 *
 * The second half is the pair that must never drift. ZITADEL_PORT is where the
 * stack publishes; ZITADEL_EXTERNALPORT is what goes into `iss`. On a plain
 * bring-up they are one address seen from two sides, and they separate only
 * when something fronts the provider on 443. Two hand-copied numbers is how a
 * stack ends up serving one port and stamping the other — which surfaces as
 * every sign-in failing with a message about signatures.
 */
describe('the identity provider is published somewhere it can actually bind', () => {
  // `- "${SOME_PORT:-1234}:5678"` → [SOME_PORT, 1234, 5678], per compose file.
  //
  // The container side may itself be `${VAR:-N}` — zitadel listens on the same
  // number it publishes, deliberately, because the provider resolves its
  // instance by an origin that includes the PORT. Reading only the literal form
  // made this parser return nothing for that service, and a parser that returns
  // nothing turns every case below green, which is why `read the real compose
  // files` exists.
  const publishes = (yaml: string): { variable: string; host: string; container: string }[] => {
    const found: { variable: string; host: string; container: string }[] = [];
    for (const [line, variable, host, containerRaw] of yaml.matchAll(
      /^\s*-\s*"\$\{([A-Z_]+):-(\d+)\}:(\d+|\$\{[A-Z_]+:-\d+\})"/gm,
    )) {
      // None of the three groups is optional in that pattern, which the
      // compiler cannot see. Defaulting them would invent a port number and
      // every case below would then agree with itself about nothing.
      if (variable === undefined || host === undefined || containerRaw === undefined) {
        throw new Error(`matched a port mapping and could not read it back: ${line}`);
      }
      const container = /(\d+)\}?$/.exec(containerRaw)?.[1];
      if (container === undefined) {
        throw new Error(`matched a container port and could not read it back: ${line}`);
      }
      found.push({ variable, host, container });
    }
    return found;
  };

  const www = read('www.yml');
  const managedPorts = publishes(managed);

  it('read the real compose files', () => {
    // Vacuity guard: a regex that stops matching turns every case below green.
    expect(managedPorts.length).toBeGreaterThan(5);
    expect(publishes(www).length).toBeGreaterThan(0);
  });

  it('does not camp on 8080, or on any other port everything else wants', () => {
    // The literal regression. 8080 is not a port a stack gets to assume.
    const idp = managedPorts.find((p) => p.variable === 'ZITADEL_PORT');
    expect(idp, 'zitadel must publish through ${ZITADEL_PORT:-…}').toBeDefined();
    expect(
      ['80', '443', '3000', '5000', '8000', '8080', '8443', '8888'],
      `ZITADEL_PORT defaults to ${idp?.host}, which is contended on any ordinary machine`,
    ).not.toContain(idp?.host);
  });

  it('gives every service on this host a host port of its own', () => {
    // www.yml is a separate file that deliberately runs on the SAME host (its
    // header says so), so its port counts against the same pool.
    const all = [...managedPorts, ...publishes(www)];
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const p of all) {
      const owner = seen.get(p.host);
      if (owner) clashes.push(`${p.host}: ${owner} and ${p.variable}`);
      else seen.set(p.host, p.variable);
    }
    expect(clashes, 'two services default to the same host port — one of them cannot start').toEqual(
      [],
    );
  });

  it('listens on the very port it publishes, because the origin check includes it', () => {
    // The provider resolves which instance a request is for from the request's
    // ORIGIN — host AND port — and refuses every other one. Measured:
    //
    //   GET http://zitadel:8080/.well-known/openid-configuration
    //     404  unable to set instance using origin &{zitadel:8080 http}
    //          (ExternalDomain is localhost): Instance not found.
    //
    // With a `3126:8080` mapping, `ownpace-idp:3126` reaches nothing from
    // inside the network and `ownpace-idp:8080` is not the origin the instance
    // knows — one address with two meanings, which is the whole bug. So the
    // number is the same on both sides and there is no second place to get it
    // wrong.
    const idp = managedPorts.find((p) => p.variable === 'ZITADEL_PORT');
    expect(idp?.container, 'zitadel must listen on the port it publishes').toBe(idp?.host);
    expect(
      managed,
      "the container's own listen port must come from the same variable",
    ).toContain('ZITADEL_PORT: ${ZITADEL_PORT:-');
  });

  it('derives the issuer port from the published one instead of repeating it', () => {
    // `${ZITADEL_EXTERNALPORT:-${ZITADEL_PORT:-3126}}` — verified against
    // `docker compose config`: setting ZITADEL_PORT alone moves both.
    expect(
      managed,
      'ZITADEL_EXTERNALPORT must fall back to ZITADEL_PORT, not to a second copy of the number',
    ).toContain('ZITADEL_EXTERNALPORT: ${ZITADEL_EXTERNALPORT:-${ZITADEL_PORT:-');
  });

  it('agrees on the fallback everywhere it is written down', () => {
    // Three places compute the same port: the publish, the issuer's fallback,
    // and setup-zitadel.sh (which writes JWT_ISSUER, so its copy is the one
    // that reaches the API). A disagreement here is a stack that provisions an
    // issuer nobody serves.
    const published = managedPorts.find((p) => p.variable === 'ZITADEL_PORT')?.host;
    const issuerFallback = /ZITADEL_EXTERNALPORT:-\$\{ZITADEL_PORT:-(\d+)\}/.exec(managed)?.[1];
    const script = read('setup-zitadel.sh');
    const scriptFallback = /read_env ZITADEL_EXTERNALPORT "\$\(read_env ZITADEL_PORT (\d+)\)"/.exec(
      script,
    )?.[1];

    expect(published).toBeDefined();
    expect(issuerFallback, 'managed.yml lost its ZITADEL_PORT fallback').toBe(published);
    expect(
      scriptFallback,
      'setup-zitadel.sh must chain ZITADEL_EXTERNALPORT → ZITADEL_PORT → the same number',
    ).toBe(published);
  });

  it('agrees with compose on the DOMAIN fallback too, not just the port', () => {
    // Three files compute the issuer, and the one that writes JWT_ISSUER is the
    // script. A disagreement here is a stack that provisions an issuer nobody
    // serves — the same failure the port fallback above exists to prevent, one
    // component to the left.
    const script = read('setup-zitadel.sh');
    const composeDefault = /ZITADEL_EXTERNALDOMAIN: \$\{ZITADEL_EXTERNALDOMAIN:-([^}]+)\}/.exec(
      managed,
    )?.[1];
    const scriptDefault = /read_env ZITADEL_EXTERNALDOMAIN ([^)\s]+)\)/.exec(script)?.[1];
    expect(composeDefault, 'managed.yml must default the domain').toBeDefined();
    expect(scriptDefault, 'setup-zitadel.sh must fall back to the same name').toBe(composeDefault);
    const example = read('managed.env.example');
    expect(
      /^ZITADEL_EXTERNALDOMAIN=(.+)$/m.exec(example)?.[1],
      'and the example an operator copies must ship it too',
    ).toBe(composeDefault);
  });

  it('ships an example whose two ports agree with the fallback and each other', () => {
    // The example is what an operator copies, and what the gate backfills from.
    const example = read('managed.env.example');
    const published = managedPorts.find((p) => p.variable === 'ZITADEL_PORT')?.host;
    const value = (key: string): string | undefined =>
      new RegExp(`^${key}=(\\d+)$`, 'm').exec(example)?.[1];

    expect(value('ZITADEL_PORT'), 'managed.env.example must document the default it ships').toBe(
      published,
    );
    expect(
      value('ZITADEL_EXTERNALPORT'),
      'a browser reaching the published port is the default case — these separate only behind a proxy',
    ).toBe(published);
  });
});

/**
 * A FUNCTION WHOSE STDOUT IS A CREDENTIAL MAY NOT SAY ANYTHING ON STDOUT.
 *
 * E2E (managed) #60, and it was self-inflicted an hour after the test that
 * catches #523 was written. A warning was added at the top of `mint`, printed
 * with a bare `echo` — and `mint`'s stdout IS the token, read with
 * `TOK="$(mint …)"`. So every JWT the smoke minted arrived with eight lines of
 * prose in front of it, and the API answered a header it could not parse the
 * only way it can:
 *
 *   verify: start-http-400   apply: start-http-400
 *   readiness (database): HTTP 400, .database -> '<unreadable>' —
 *
 * An empty body and a 400, which says nothing about tokens at all. Exactly
 * #523's shape — output that is not the credential ending up in the credential
 * — one caller further along.
 */
describe('nothing but the token comes out of the thing that mints tokens', () => {
  const mintBody = /\nmint\(\) \{[\s\S]*?\n\}/.exec(smoke)?.[0] ?? '';

  it('read the real function', () => {
    // Vacuity guard: an empty body passes every case below.
    expect(mintBody).toContain('jwt.sign');
  });

  it('the warning goes to stderr, because stdout is the token', () => {
    const warn = /warn_minted_tokens_are_not_verifiable\(\) \{[\s\S]*?\n\}/.exec(smoke)?.[0] ?? '';
    expect(warn, 'the warning function must be readable').toContain('!!!');
    expect(warn, 'every line of it must be redirected').toMatch(/\}\s*>&2/);
  });

  it('mint itself prints the token and nothing else', () => {
    const chatty = mintBody
      .split('\n')
      .filter((l) => /^\s*echo\b/.test(l) && !/>&2/.test(l));
    expect(chatty, 'a bare echo here is prepended to the credential').toEqual([]);
  });

  it('and the CHOKE POINT checks it too, whatever produced it', () => {
    // A per-producer check catches the producers that exist. Both #523's PAT
    // and #60's JWT were produced by something nobody had thought about yet, so
    // the one place every authenticated call passes through checks as well —
    // and complains at most once, because fifteen calls carrying the same bad
    // token is one fact, not fifteen.
    const httpBody = /\nhttp\(\) \{[\s\S]*?\n\}/.exec(smoke)?.[0] ?? '';
    expect(httpBody, 'the http helper must be readable').toContain('Authorization: Bearer');
    expect(httpBody).toContain('looks_like_a_jwt');
    // AND IT REFUSES IN THE VALUE, not in a variable. Every call site reads this
    // with `r="$(http …)"`, so `fail=1` set inside would be set in a SUBSHELL
    // and lost — the check would print and the run would still pass, which is
    // the masking hard rule 9 is about. Answering `000` makes each caller's own
    // assertion fail, and those callers are at top level.
    expect(httpBody, 'the refusal has to travel in the answer').toMatch(/printf '%s %s\\n' "000"/);
    expect(httpBody, 'and it must not try to set the verdict from a subshell').not.toMatch(
      /^\s*fail=1/m,
    );
    // Defined before it is used, or the check is a no-op.
    expect(smoke.indexOf('looks_like_a_jwt() {')).toBeLessThan(smoke.indexOf('\nhttp() {'));
  });

  it('and whatever comes out is checked for the SHAPE of a token', () => {
    // The durable half of #523's lesson: a JWT has three dot-separated segments
    // and no whitespace. A warning has whitespace; so does a stack trace, a
    // deprecation notice and an OCI error. This catches the class whatever
    // produces the garbage next.
    expect(smoke).toContain('assert_looks_like_a_jwt');
    // One rule, two presentations: the quiet predicate holds the rule, and the
    // two callers differ only in how they are placed to fail.
    const rule = /\nlooks_like_a_jwt\(\) \{[\s\S]*?\n\}/.exec(smoke)?.[0] ?? '';
    expect(rule, 'whitespace is what an error message has and a token does not').toContain(
      '*[[:space:]]*',
    );
    expect(rule, 'and three segments is what a JWT is').toContain('*.*.*');
    const check = /assert_looks_like_a_jwt\(\) \{[\s\S]*?\n\}/.exec(smoke)?.[0] ?? '';
    expect(check, 'the loud one is built on the quiet one').toContain('looks_like_a_jwt "$2"');
    expect(check, 'and it speaks on stderr, because its readers capture stdout').toMatch(
      /\}\s*>&2/,
    );
    // In the callee, not at each call site — fixing the caller and not the
    // callee is how #519 survived in nineteen other places.
    expect(mintBody).toContain('assert_looks_like_a_jwt');
    // And the one token not minted by `mint` gets the same check.
    expect(smoke).toMatch(/assert_looks_like_a_jwt "the invitee's token" "\$INV_TOKEN"/);
  });
});

/**
 * `trap … EXIT` REPLACES THE HANDLER. IT DOES NOT ADD TO IT.
 *
 * A second `trap … EXIT` anywhere in a script silently disables the first, and
 * the symptom is a leak nobody notices: here, the runner-log watcher would have
 * been left running for the rest of the smoke by a cleanup trap added a hundred
 * lines below it.
 *
 * So every EXIT trap in these scripts has to name every job. Checked by reading
 * rather than by waiting for a leak to be noticed.
 */
describe('an EXIT trap does not quietly replace the one above it', () => {
  const trapLines = (text: string) =>
    text
      .split('\n')
      .map((line, i) => ({ n: i + 1, line }))
      .filter(({ line }) => /^\s*trap\s+.*\bEXIT\b/.test(line));

  it('read the real script', () => {
    expect(trapLines(smoke).length).toBeGreaterThan(0);
  });

  it('the last EXIT trap in the smoke does every job the earlier ones did', () => {
    // A PLAIN RULE, NOT A CLEVER ONE. The first version of this extracted
    // "commands" with a lookahead for `;`, `'` or end-of-line — and
    // `kill "$WATCHER_PID" 2>/dev/null` is followed by none of those, so the
    // one job it existed to protect was the one job it could not see. It stayed
    // green when the break was put in. Over-matching and under-matching parsers
    // have each cost an hour tonight; this one just splits the handler on `;`.
    const handler = (line: string) => /trap\s+'([^']*)'/.exec(line)?.[1] ?? '';
    const traps = trapLines(smoke);
    if (traps.length < 2) return; // one trap cannot shadow anything
    const last = handler(traps[traps.length - 1]!.line);
    expect(last, 'the final EXIT handler must be readable').not.toBe('');

    const earlier = traps
      .slice(0, -1)
      .flatMap(({ line }) => handler(line).split(';'))
      .map((c) => c.trim())
      .filter(Boolean);
    const missing = earlier.filter((c) => !last.includes(c));
    expect(
      missing,
      `the final EXIT trap drops: ${missing.join(' | ')} — trap EXIT replaces, it does not add`,
    ).toEqual([]);
  });
});

/**
 * A CALL THAT NEEDS A BODY SENDS ONE — AND NOT THE IRREVERSIBLE VALUE.
 *
 * `POST /api/tenants/:id/close` requires `windowDays` ∈ {0, 7, 30, 90}. The
 * smoke posted nothing, so the API answered `400 bad_window`, and that had been
 * true since the check was written: every earlier run failed AUTHENTICATION
 * first, so the request never reached the validation behind it. A gate that
 * cannot get past the door cannot tell you the room is on fire — which is the
 * argument for fixing auth before believing anything else this script says.
 *
 * And `0` is the one value it must never send: it erases at the next purge and
 * cannot be undone, so it would make the reopen two lines later meaningless and
 * destroy a tenant on a live stack (hard rule 2).
 */
describe('the close call sends a window, and never the irreversible one', () => {
  const closeCall = /http POST "\$API\/api\/tenants\/\$\{T1\}\/close"[^\n]*/.exec(smoke)?.[0] ?? '';

  it('read the real call', () => {
    expect(closeCall).toContain('/close');
  });

  it('sends a windowDays the endpoint accepts', () => {
    const window = /"windowDays":\s*(\d+)/.exec(closeCall)?.[1];
    expect(window, 'the close endpoint refuses a body without windowDays').toBeDefined();
    expect([7, 30, 90], 'must be one of the allowed windows, and not 0').toContain(Number(window));
  });

  it('the http helper can carry a body at all', () => {
    const httpBody = /\nhttp\(\) \{[\s\S]*?\n\}/.exec(smoke)?.[0] ?? '';
    expect(httpBody).toMatch(/\$\{4:-\}/);
    expect(httpBody, 'and declare its content type when it does').toContain('Content-Type: application/json');
  });
});

describe('the people a dead run leaves behind get taken back', () => {
  /**
   * Every run deletes its own three humans in the EXIT trap — and a
   * hard-killed run never reaches its trap, so its people lingered in the
   * provider with nothing looking for them. The sweep reclaims them at the
   * start of the next run; what is pinned here is that it cannot silently do
   * either too little (run after the sign-ins, swallow its own failures) or
   * too much (match anybody the gate did not create).
   */
  const sweep = /idp_sweep_leftovers\(\) \{[\s\S]*?\n\}/.exec(smoke)?.[0] ?? '';
  const takeBack = /idp_take_back\(\) \{[\s\S]*?\n\}/.exec(smoke)?.[0] ?? '';

  it('read the real functions', () => {
    expect(sweep.length).toBeGreaterThan(200);
    expect(takeBack.length).toBeGreaterThan(100);
  });

  it('sweeps BEFORE this run creates anybody, and a failed sweep fails the run', () => {
    const call = smoke.indexOf('idp_sweep_leftovers || fail=1');
    const firstPerson = smoke.indexOf('sign_in_as "smoke-verify');
    expect(call).toBeGreaterThan(-1);
    expect(firstPerson).toBeGreaterThan(-1);
    expect(call).toBeLessThan(firstPerson);
  });

  it('asks the provider only for the gate\'s own domain, then re-checks each hit', () => {
    // Server-side fence: the search itself is scoped to @smoke.local.
    expect(sweep).toContain('"emailQuery"');
    expect(sweep).toContain('@smoke.local');
    expect(sweep).toContain('ENDS_WITH');
  });

  it('deletes exactly the names sign_in_as creates — proven against those very names', () => {
    // The guard regex is EXTRACTED from the script and run against the three
    // creation emails also extracted from the script, so the two cannot drift
    // apart without this failing: a fourth person added to the sign-in section
    // is not swept until the guard learns their name.
    const guardSrc = /=~ (\^smoke-[^ ]+) \]\]/.exec(sweep)?.[1] ?? '';
    expect(guardSrc).not.toBe('');
    const guard = new RegExp(guardSrc);
    const created = [...new Set([...smoke.matchAll(/smoke-[a-z]+-\$\$@smoke\.local/g)].map((m) => m[0]))];
    expect(created.length).toBe(3);
    for (const email of created) {
      expect(email.replace('$$', '12345'), `${email} is not matched by the sweep guard`).toMatch(guard);
    }
    // And the fences hold: a person, and a shape the gate never makes.
    expect('real-person@smoke.local').not.toMatch(guard);
    expect('smoke-verify-abc@smoke.local').not.toMatch(guard);
  });

  it('a leftover it can see but not delete fails the sweep, never a shrug', () => {
    expect(sweep).toContain('could not delete leftover');
    expect(sweep).toMatch(/could not delete leftover[^\n]*\n?[^\n]*return 1/);
  });

  it('checks the listing has the shape of one before concluding "no leftovers"', () => {
    // A renamed field would otherwise read as an empty result — the exact
    // silent lie the curl-that-does-not-exist bug taught this gate about.
    expect(sweep).toContain('has("userId") and has("username")');
  });

  it('the take-back says when it fails, instead of || true-ing the failure away', () => {
    expect(takeBack).not.toContain('|| true');
    expect(takeBack).toContain('could not delete user');
    expect(takeBack).toContain('could not restore the provisioning user');
  });

  it('a role that was already there is announced, and never removed', () => {
    expect(smoke).toContain('IAM_LOGIN_CLIENT was already on the provisioning user');
    // The take-back restores roles only when THIS run added the grant.
    expect(takeBack).toContain('"$IDP_ROLE_ADDED" = "1"');
  });
});
