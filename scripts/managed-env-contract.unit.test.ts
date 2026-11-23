// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Every variable `managed.yml` demands can actually be obtained.
 *
 * ## The failure this comes from
 *
 * `managed.yml` marks a variable it cannot run without as `${VAR:?message}`.
 * Compose interpolates the WHOLE file before running anything, so **one missing
 * variable fails every compose command** — `up`, `ps`, `logs`, all of them,
 * whichever services they name.
 *
 * E2E (managed) #36 reported its `[data]` step — postgres, the pooler's lookup
 * role, pgbouncer — failing with:
 *
 *     error while interpolating services.zitadel.command:
 *     required variable ZITADEL_MASTERKEY is missing a value
 *
 * A true statement about a service that step does not start. The gate had been
 * red since #496 added Zitadel and #497 added the status page's `WEB_URL`: the
 * self-hosted runner's persisted `.env` predated both, which is the ORDINARY
 * condition after any change that adds a service, not an edge case.
 *
 * The workflow had a pre-flight check for exactly this class of problem, and it
 * listed its keys **by hand** — with a comment explaining the hazard in detail,
 * for `PGBOUNCER_AUTH_PASSWORD`. Two later PRs added required variables and
 * neither added them to that list. The lesson was written down; the list was
 * not derived from anything, so writing it down changed nothing.
 *
 * ## What is asserted
 *
 * Every `${VAR:?}` in `managed.yml` must be obtainable from one of the two
 * files that supply values, so the workflow can fill it without a human:
 *
 *   - **generated** by `ensure-env-secrets.sh` — for secrets. That script fills
 *     a MISSING key and refuses to replace a live one, so running it on every
 *     pass is safe. One required key that is not a secret is written there
 *     too: `ZITADEL_PAT_EXPIRY`, the provisioning token's first date, by its
 *     `seed_pat_expiry` call (2026-10-21; a date still ahead is kept).
 *     bootstrap-managed.sh makes the same call before its first compose call,
 *     for `--from` runs (deploy-live.sh runs `--from data`). (A second,
 *     `DOCKER_SOCKET_GID`, the group of the host's Docker socket that
 *     Trigger.dev's socket proxy reached it through, went with the plane in
 *     alpha.18, workplan 0167 T9; the last case here holds that nothing asks
 *     for it or writes it any more.)
 *   - **defaulted** in `managed.env.example` with a NON-EMPTY value — for
 *     configuration that is not secret.
 *
 * A variable in neither is a real gap: it demands something no automated path
 * can produce, and the first anybody hears of it is a red nightly on a runner,
 * pointing at the wrong service. Adding one now fails here instead.
 *
 * The example's empty entries (`ZITADEL_MASTERKEY=`) are deliberately NOT
 * treated as defaults — an empty value satisfies neither compose's `:?` nor a
 * human reading the file for what to set.
 *
 * ## A default the example can switch off by accident (2026-09-24)
 *
 * The other half of the contract is the `${VAR:-default}` a key falls back to,
 * and a `.env` starts life as a byte copy of the example. Compose's dotenv
 * trims the blanks after `=` BEFORE it looks for an inline comment, so
 *
 *     OWNPACE_SELLER_COUNTRY=        # empty = NL
 *
 * is not empty to Compose: `docker compose config` (v5.1.1) hands the api
 * `OWNPACE_SELLER_COUNTRY: '# empty = NL'`, the `:-NL` never applies, and the
 * VAT code takes "# empty = NL" as the seller's member state. Bash `source`
 * reads the same line as empty, which is why every shell-side check agreed
 * with the comment. That line and `VAT_OSS_ACTIVE=  # empty = false` were
 * added to document two api knobs, and nothing noticed. A key that has a
 * default in `managed.yml` now keeps its note on a line of its own.
 *
 * ## NODE_ENV: required, and not the example's on the OTA stack (2026-10-04)
 *
 * `managed.yml` defaulted NODE_ENV to `development`, so a `.env` that did not
 * say its mode ran a development API. It is now `${NODE_ENV:?}` (workplan 0132
 * T4; the owner, 2026-10-04), and the example carries `production`, so a stack
 * copied from it starts in production: fail safe, and what live's stand-up
 * demands. It is the one required key whose value on the OTA stack is NOT the
 * example's: that stack runs development, said explicitly, so its self-signed
 * test mail keeps working. The gate's Fill step writes `NODE_ENV=development`
 * when the key is absent or empty, BEFORE the loop that backfills from the
 * example; `a-stack-that-names-its-mode.unit.test.ts` runs that step to prove
 * the order. A blank example value would fail this file's first rule, and
 * the gate's loop would refuse it as having no default.
 *
 * ## What this cannot do
 *
 * It cannot see a runner's `.env`. A persisted file can still fall behind, and
 * that is the workflow's job — it now derives the same list and backfills from
 * the same two sources. This asserts the sources can answer; it cannot assert
 * anybody asked them.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMPOSE_DIR = fileURLToPath(new URL('../deploy/compose/', import.meta.url));
const read = (name: string): string => readFileSync(COMPOSE_DIR + name, 'utf8');

/** Variables `managed.yml` refuses to start without — `${NAME:?...}`. */
function requiredByCompose(): string[] {
  const yml = read('managed.yml');
  const found = [...yml.matchAll(/\$\{([A-Z_]+):\?/g)].map((m) => m[1]!);
  return [...new Set(found)].sort();
}

/**
 * What `ensure-env-secrets.sh` will write into a `.env` that lacks it: the
 * secrets its `ensure` lines generate, and the provisioning token's first date,
 * which its `seed_pat_expiry` call writes (env-read.sh; not a secret, and so
 * not an `ensure`).
 */
function generatedBySecretsScript(): Set<string> {
  const sh = read('ensure-env-secrets.sh');
  const keys = new Set([...sh.matchAll(/^ensure\s+([A-Z_]+)\s/gm)].map((m) => m[1]!));
  if (/^seed_pat_expiry "\$ENV_FILE"$/m.test(sh)) keys.add('ZITADEL_PAT_EXPIRY');
  return keys;
}

/** Keys `managed.env.example` gives a NON-EMPTY value. An empty one is not a default. */
function defaultedInExample(): Set<string> {
  const example = read('managed.env.example');
  const out = new Set<string>();
  for (const line of example.split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && m[2]!.trim() !== '') out.add(m[1]!);
  }
  return out;
}

const required = requiredByCompose();
const generated = generatedBySecretsScript();
const defaulted = defaultedInExample();

describe('managed.yml cannot demand a variable nothing can supply', () => {
  it('read all three files, with real content in each', () => {
    // The vacuity guard. Every assertion below passes trivially against empty
    // sets, and a moved file or a changed script idiom produces exactly that.
    expect(required.length, 'no `${VAR:?}` found in managed.yml').toBeGreaterThan(5);
    expect(generated.size, 'no `ensure` lines found in ensure-env-secrets.sh').toBeGreaterThan(5);
    expect(defaulted.size, 'no populated keys found in managed.env.example').toBeGreaterThan(20);
  });

  it('supplies every required variable from the generator or the example', () => {
    // The whole point. A variable in neither is one no automated path can
    // produce, and the first report of it is a red nightly naming the wrong
    // service — see this file's header.
    const orphans = required.filter((key) => !generated.has(key) && !defaulted.has(key));
    expect(
      orphans,
      'required by managed.yml but neither generated by ensure-env-secrets.sh nor ' +
        'given a non-empty default in managed.env.example — so no runner can obtain it',
    ).toEqual([]);
  });

  it('generates the secrets rather than shipping them as defaults', () => {
    // The other direction, and it is a secrets rule rather than a plumbing one
    // (hard rule 3): a generated secret must not ALSO have a value sitting in
    // a file in the repository, because that value is not a secret and a
    // deployment that keeps it has published its own keys.
    const shipped = [...generated].filter((key) => defaulted.has(key)).sort();
    expect(shipped, 'ensure-env-secrets.sh generates these, so the example must leave them EMPTY').toEqual(
      [],
    );
  });

  it("no longer asks for the Docker socket's group, or writes it: nothing reaches the socket since alpha.18 (0167 T9)", () => {
    // trigger-docker-proxy ran as uid 99 and reached the socket through its group (workplan 0119,
    // 2026-11-20); it went with Trigger.dev's plane. A key still demanded would fail every compose call.
    expect(required).not.toContain('DOCKER_SOCKET_GID');
    expect(read('managed.yml')).not.toContain('DOCKER_SOCKET_GID');
    expect(read('ensure-env-secrets.sh')).not.toMatch(/^\s*seed_docker_socket_gid\b/m);
    expect(read('bootstrap-managed.sh')).not.toMatch(/^\s*seed_docker_socket_gid\b/m);
    expect(read('env-read.sh')).not.toMatch(/^seed_docker_socket_gid\(\) \{/m);
  });

  it('seeds the jobs role\'s password before every compose call of a bring-up, `--from` runs too, that key alone (ADR-0054)', () => {
    // No service reads JOBS_DB_PASSWORD yet; the data phase sets it on ownpace_jobs every run, and
    // the worker that will put it in JOBS_DATABASE_URL is a later change. So it is in the generator
    // and in the example, empty, and load_env fills it in when a deploy (`--from data`) finds it missing.
    expect(generated.has('JOBS_DB_PASSWORD'), 'ensure-env-secrets.sh does not generate JOBS_DB_PASSWORD').toBe(true);
    expect(/^JOBS_DB_PASSWORD=$/m.test(read('managed.env.example')), 'managed.env.example does not ship JOBS_DB_PASSWORD empty').toBe(true);
    const boot = read('bootstrap-managed.sh');
    const loadEnv = /^load_env\(\) \{[\s\S]*?\n\}/m.exec(boot)?.[0] ?? '';
    const seed = loadEnv.indexOf('  seed_jobs_db_password\n');
    expect(seed, 'load_env no longer seeds JOBS_DB_PASSWORD').toBeGreaterThan(-1);
    expect(seed, 'load_env sources the .env before it seeds the key').toBeLessThan(loadEnv.indexOf('. "$ENV_FILE"'));
    expect(seed, 'load_env asks Compose before it seeds the key').toBeLessThan(loadEnv.indexOf('"${COMPOSE[@]}" config'));
    const fn = /^seed_jobs_db_password\(\) \{[\s\S]*?\n\}/m.exec(boot)?.[0] ?? '';
    // Only when it is missing, and only that key: a whole run there would generate the database
    // passwords that load_env refuses as missing on a real address a few lines further on.
    expect(fn).toContain('[ -z "$(env_get JOBS_DB_PASSWORD)" ] || return 0');
    expect(fn).toContain('"${SCRIPT_DIR}/ensure-env-secrets.sh" --only JOBS_DB_PASSWORD');
    expect(read('ensure-env-secrets.sh')).toMatch(/^ONLY_KEYS=' JOBS_DB_PASSWORD '$/m);
  });

  it('keeps ZITADEL_MASTERKEY on the never-replace list', () => {
    // Not plumbing either. It is the key the identity provider encrypts its own
    // data with, so regenerating it on an instance that holds users strands
    // them — which is precisely what the workflow's new "persist the .env back"
    // step exists to prevent, and this is the other half of that guarantee.
    const sh = read('ensure-env-secrets.sh');
    const guard = /needs_rotation_procedure\(\)[\s\S]*?\n}/.exec(sh)?.[0] ?? '';
    expect(guard, 'ensure-env-secrets.sh must refuse to replace a live ZITADEL_MASTERKEY').toContain(
      'ZITADEL_MASTERKEY',
    );
  });
});

describe('NODE_ENV: every stack names its mode (workplan 0132 T4)', () => {
  it('is required, and the example supplies production, so a copied stack fails safe', () => {
    expect(required, 'managed.yml defaults NODE_ENV again').toContain('NODE_ENV');
    expect(generated.has('NODE_ENV'), 'a mode is a decision, not a secret to generate').toBe(false);
    const lines = read('managed.env.example')
      .split('\n')
      .filter((l) => /^NODE_ENV=/.test(l));
    expect(lines).toEqual(['NODE_ENV=production']);
  });

  it("the gate writes the OTA stack's development before its backfill from the example", () => {
    // Text only, as a pointer: the order is proven by running the step, in
    // a-stack-that-names-its-mode.unit.test.ts.
    const gate = readFileSync(fileURLToPath(new URL('../.github/workflows/e2e-managed.yml', import.meta.url)), 'utf8');
    const write = gate.indexOf('./deploy/compose/env-upsert.sh deploy/compose/.env NODE_ENV=development');
    const loop = gate.indexOf('backfilled ${key} from managed.env.example');
    expect(write, 'the gate no longer writes NODE_ENV=development').toBeGreaterThan(-1);
    expect(loop, "the gate's backfill loop is no longer recognisable").toBeGreaterThan(-1);
    expect(write, 'the write comes after the loop, which has then backfilled production').toBeLessThan(loop);
  });
});

describe("the example hands the job worker no note as a value (workplan 0167 T7)", () => {
  // The worker receives each key its service names, and a `.env` copied from
  // the example hands Compose `KEY=   # note` as the value "# note", where
  // set-task-env.sh, which sources the file, uploads nothing for it. A
  // retention of "# run LOGS" stops the retention job; a URL of "# default"
  // points the tick at nothing. So no key the worker reads may carry its note
  // on its own line in the example, whether or not managed.yml defaults it.
  const managed = read('managed.yml');
  const block = /^ {2}worker:\n([\s\S]*?)(?=^ {2}[a-z][a-z0-9-]*:\n|^[a-z])/m.exec(managed)?.[1] ?? '';
  const keys = new Set([...block.matchAll(/\$\{([A-Z_][A-Z0-9_]*)[:}]/g)].map((m) => m[1]!));

  it('found the keys the worker reads (vacuity)', () => {
    expect(keys.size, 'no ${VAR} in managed.yml\'s worker service').toBeGreaterThan(30);
    expect(keys.has('LEDGER_RETENTION_DAYS')).toBe(true);
  });

  it('leaves none of them empty with a comment on the same line', () => {
    const glued = read('managed.env.example')
      .split('\n')
      .flatMap((line) => {
        const m = /^([A-Z_][A-Z0-9_]*)=[ \t]+#/.exec(line);
        return m && keys.has(m[1]!) ? [m[1]!] : [];
      });
    expect(
      glued,
      'managed.env.example leaves these empty with a comment on the same line, and the worker receives the comment ' +
        'as the value: move the comment to a line of its own and leave `KEY=` bare',
    ).toEqual([]);
  });
});

describe('the example cannot switch a compose default off', () => {
  // `${VAR:-default}` with a NON-EMPTY default: the keys whose fallback a
  // copied example could silently replace. An empty default (`${SMTP_SECURE:-}`)
  // has nothing to lose, so it is not this rule's business.
  const defaults = new Set(
    [...read('managed.yml').matchAll(/\$\{([A-Z_][A-Z0-9_]*):-([^}]+)\}/g)].map((m) => m[1]!),
  );

  it('found the defaults it is about', () => {
    // Vacuity guard: a changed interpolation idiom would empty the set and
    // pass the assertion below against nothing.
    expect(defaults.size, 'no `${VAR:-default}` found in managed.yml').toBeGreaterThan(20);
    expect(defaults.has('OWNPACE_SELLER_COUNTRY')).toBe(true);
  });

  it('never ships a defaulted key as blanks and a comment', () => {
    // `KEY=   # note` is the value "# note" to Compose (see the header), so
    // the default the note describes is exactly what does NOT apply.
    const glued = read('managed.env.example')
      .split('\n')
      .flatMap((line) => {
        const m = /^([A-Z_][A-Z0-9_]*)=[ \t]+#/.exec(line);
        return m && defaults.has(m[1]!) ? [m[1]!] : [];
      });
    expect(
      glued,
      'managed.env.example leaves these empty with a comment on the same line. Compose ' +
        "reads the comment as the value, so managed.yml's default never applies: move " +
        'the comment to a line of its own and leave `KEY=` bare',
    ).toEqual([]);
  });
});
