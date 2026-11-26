#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * SCHEMATHESIS AGAINST THE API, ON A STACK THIS RUN COMPOSES ITSELF, REPORT
 * ONLY (workplan 0178 T7; the owner's decisions D3 (a) and D4 (a) of
 * 2026-11-26).
 *
 * The API's description, `apps/api/docs/openapi.yaml`, says which operations
 * need sign-in and what each may answer. Nothing else in this repository asks
 * a RUNNING API whether that is so. Schemathesis does: it calls every
 * operation with input generated from the description, valid and invalid,
 * once with a seeded member's token and once without, and checks each answer.
 * `.github/workflows/schemathesis.yml` runs this, nightly on `main` and on
 * dispatch.
 *
 * THE CHECKS (`CHECKS`). Two are the ones plan 0178 step 4 (T8) will one day
 * block on, once `main` has been quiet for 14 nights (`BLOCKS_LATER`):
 *   - `ignored_auth`, an operation the description secures that answers
 *     without a token (0178 §3, class 9, the running half);
 *   - `not_a_server_error`, a 500 on input the description allows or refuses,
 *     an unmasked crash (AGENTS.md rule 9).
 * And two conformance checks, which never block (0178 §7): an answer whose
 * status (`status_code_conformance`) or body (`response_schema_conformance`)
 * the description does not allow. A mismatch there is a fault of the
 * description, fixed in a change of its own.
 *
 * WHAT FAILS THE JOB: ONLY A SCAN THAT DID NOT FINISH (security-scan.yml's
 * rule, 0178 §1). Today nothing it finds fails anything. A scan that did not
 * finish is: an image the run could not check or pull, a stack that did not
 * come up, a report Schemathesis did not write or that says it stopped early,
 * an operation it could not test, or the proof below not holding.
 *
 * THE PROOF COMES FIRST, IN THE SAME RUN (0178 §8 step 3, §10).
 * `scripts/fixtures/schemathesis-known-bad/` is a server of a few lines and
 * its own two-operation description, each with one fault on purpose
 * (`FIXTURE.faults`): one operation declared secured that answers without a
 * token, and one that answers 500. Schemathesis runs against it before the
 * API, with the same checks, and must flag `ignored_auth` on the first and
 * `not_a_server_error` on the second. If it does not, it is not reading what
 * it should, and the API's scan is not believed: the run is red.
 *
 * WHERE IT RUNS (D3 (a), 0178 §6.1). On the GitHub-hosted runner the job
 * takes, never the self-hosted one, and never against the managed E2E's
 * stack, the live service or the acceptance stack. Everything runs in ONE
 * network namespace that has nothing but loopback: Postgres is started with
 * `--network none`, and the API, the fixture and Schemathesis join its
 * namespace (`--network container:…`). So nothing the scan makes the API do,
 * such as testing a connection to a host Schemathesis made up, can reach past
 * the runner: the kernel has no route out to give it.
 *   - Postgres is the stacks' own base, read from
 *     `deploy/compose/postgres/Dockerfile`'s FROM by tag and digest, started
 *     as its postgres user (uid 70) as the integration tests start it
 *     (`scripts/a-database-started-as-root.unit.test.ts`).
 *   - The API runs from this checkout on the base its own image is built on,
 *     read from `apps/api/Dockerfile`'s `FROM … AS base`, with the workspace
 *     the job installed. Both migration chains are applied by the demo seed
 *     (`apps/api/src/scripts/seed-managed.ts`), which also seeds two
 *     organisations, each with its owner. The API then connects as `app_user`
 *     (row security in force), whose password this run sets.
 *   - Local sign-in mode, with a signing secret this run makes for itself
 *     (`freshSecrets`), and the tokens it signs for the seeded members. Nothing
 *     reads a repository secret, and every value made here is masked in the
 *     log before it is used.
 *   - No identity provider, no mail, no outside provider: the API starts with
 *     Postgres alone (measured on 2026-11-26), so no fake was needed. Its
 *     jobs database is that Postgres too (THE JOBS DATABASE, below).
 *
 * WHAT THE SUMMARY NAMES, AND WHAT IT DOES NOT (the maintainer's answer of
 * 2026-11-26: counts, no names). The job's summary is public, as everything a
 * public repository's runs show is. Each check gets a COUNT per run, and no
 * operation of the API is named under any check (`WITHHELD` is every check):
 * one `ignored_auth` flags may be a door that answers without sign-in, and the
 * rest are faults the owner is asked about first. The maintainer reproduces a
 * run from its seed, which the summary gives, on a stack of their own
 * (docs/testing.md says how). The fixture's operations are named: they are
 * faults on purpose.
 *
 * WHICH SCHEMATHESIS. `SCHEMATHESIS_IMAGE` in the workflow, by tag and index
 * digest, which the pin watch's row `schemathesis/schemathesis`
 * (scripts/idp-pin-watch.mjs) reads, since Dependabot reads no workflow env.
 * The image carries the Python it runs on, so the digest pins that too.
 *
 * Its guard is `scripts/a-scan-that-tried-the-running-api.unit.test.ts`.
 */

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

/** Schemathesis's own image by a release tag and its index digest; the tag is the first group. */
export const IMAGE = /^schemathesis\/schemathesis:(\d+\.\d+\.\d+)@sha256:[0-9a-f]{64}$/;

/** The description the API is scanned from. */
export const API_DESCRIPTION = 'apps/api/docs/openapi.yaml';

/** The files the stack's two other images are read from (WHERE IT RUNS, above). */
export const NODE_DOCKERFILE = 'apps/api/Dockerfile';
export const POSTGRES_DOCKERFILE = 'deploy/compose/postgres/Dockerfile';

/** The checks Schemathesis runs, in the order the summary lists them. */
export const CHECKS = ['ignored_auth', 'not_a_server_error', 'status_code_conformance', 'response_schema_conformance'];

/** The two checks 0178 step 4 (T8) will block on, after 14 quiet nights on `main` (D4). */
export const BLOCKS_LATER = ['ignored_auth', 'not_a_server_error'];

/** The checks whose API operations the public summary counts and never names: all of them. */
export const WITHHELD = CHECKS;

/**
 * Schemathesis's failure codes, by the check that reports each (`st explain
 * --list`, 4.34.0, read on 2026-11-26). A code not here is listed as
 * Schemathesis gave it, under no check.
 */
export const CODES = {
  ST101: 'not_a_server_error',
  ST102: 'not_a_server_error',
  ST103: 'status_code_conformance',
  ST108: 'response_schema_conformance',
  ST401: 'ignored_auth',
};

/** The known-bad fixture, and the fault it must be flagged for (THE PROOF, above). */
export const FIXTURE = {
  dir: 'scripts/fixtures/schemathesis-known-bad',
  faults: [
    { check: 'ignored_auth', operation: 'GET /answers-without-a-token' },
    { check: 'not_a_server_error', operation: 'GET /throws' },
  ],
};

/**
 * The cap on generated cases per operation, and the phases run. Measured on
 * 2026-11-26 against this tree's 200 operations, on one machine with the API
 * beside it: 5 took 33 seconds, 25 took 47, and 100 took 1 minute 53. The
 * plan's aim is under ten minutes nightly (0178 §6.2); the first run on a
 * hosted runner says what 100 takes there.
 */
export const MAX_EXAMPLES = 100;
export const PHASES = 'examples,coverage,fuzzing';

/** The fewest operations a finished scan of the API tests. */
export const MIN_OPERATIONS = 150;

/** Where each piece listens, inside the one namespace. Loopback only. */
export const API_PORT = 3001;
export const FIXTURE_PORT = 3002;
export const LOOPBACK = '127.0.0.1';

/** The containers this run starts, each removed at its end. */
export const CONTAINERS = { db: 'dast-db', api: 'dast-api', fixture: 'dast-fixture' };

/** The demo seed's two owners (`seed-managed.ts`), whose tokens the run signs. */
export const MEMBERS = [
  { sub: 'seed:demo-owner-a', email: 'owner-a@demo.openmigrate.test' },
  { sub: 'seed:demo-owner-b', email: 'owner-b@demo.openmigrate.test' },
];

/** The seconds between pulls of an image, and the polls for a stack to answer. */
export const PULL_DELAYS = [5, 15];
export const READY_POLLS = 60;

const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);
const firstLine = (text) => String(text ?? '').trim().split('\n')[0].slice(0, 300);
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * The image a Dockerfile's FROM names, by tag and digest: the one FROM, or
 * the one `AS <stage>` when a stage is asked for. Anything else is an error.
 */
export function fromOf(text, file, stage = null) {
  const froms = [...String(text).matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/gim)].map((m) => ({ ref: m[1], stage: m[2] ?? null }));
  const picked = stage ? froms.filter((f) => f.stage === stage) : froms;
  if (picked.length !== 1) throw new Error(`${file} has ${picked.length} FROM${stage ? ` AS ${stage}` : ''} lines, not one`);
  const [{ ref }] = picked;
  if (!/^[a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/.test(ref)) throw new Error(`${file} names ${ref}, not an image by tag and digest`);
  return ref;
}

/** The stack's two other images, read from the files that pin them (WHERE IT RUNS, above). */
export function stackImages(read) {
  return {
    node: fromOf(read(NODE_DOCKERFILE), NODE_DOCKERFILE, 'base'),
    postgres: fromOf(read(POSTGRES_DOCKERFILE), POSTGRES_DOCKERFILE),
  };
}

/** The values this run makes for itself, each masked before it is used. */
export function freshSecrets(random = randomBytes) {
  return {
    dbPassword: random(24).toString('hex'),
    appPassword: random(24).toString('hex'),
    jwtSecret: random(24).toString('hex'),
    encryptionKey: random(32).toString('hex'),
    jobsPassword: random(24).toString('hex'),
  };
}

/**
 * THE JOBS DATABASE (the maintainer's answer of 2026-11-26). The API hands a
 * sync, a cutover and the like to pg-boss, on `JOBS_DATABASE_URL`, and without
 * one answered each of them 500 for want of a queue, every night. So the
 * stack gets the managed bring-up's own: the jobs role and schema from
 * `JOBS_ROLE_SQL`, run as it is, a password of the run's own, and pg-boss's
 * tables and the catalog's queues installed by the worker's own runner, which
 * then stops. Nothing works the jobs: they wait in their queues, as they
 * would for a worker, and the API's answer is the one it gives with a queue.
 */
export const JOBS_ROLE_SQL = 'deploy/compose/jobs-role.sql';

/** The worker's runner, started once to install the schema and declare the catalog's queues, then stopped. */
export const INSTALL_THE_QUEUES =
  "import('@openmig/scheduler/pg-boss').then(async ({ JOB_CATALOG, PgBossJobRunner }) => { " +
  "const worker = new PgBossJobRunner({ connectionString: process.env.JOBS_DATABASE_URL, schema: 'pgboss' }); " +
  'await worker.start(JOB_CATALOG); await worker.stop({ graceful: false }); })';

/** What Schemathesis's config file says: the token from the environment, never on a command line. */
export const CONFIG = 'headers = { Authorization = "Bearer ${DAST_TOKEN}" }\n';

/**
 * The `docker run` of Schemathesis against one description, inside the
 * stack's namespace. `description` is a path from the checkout's root.
 */
export function scanArgs(image, { root, out, description, port, report, seed = null, uid = '1001:1001' }) {
  return [
    'run', '--rm', '--pull', 'never',
    '--network', `container:${CONTAINERS.db}`,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--user', uid,
    '--env', 'DAST_TOKEN',
    // The working directory is the reports' own, so nothing is written into the checkout.
    '--volume', `${root}:/src:ro`, '--volume', `${out}:/out`, '--workdir', '/out',
    image,
    '--config-file', '/out/schemathesis.toml',
    'run', `/src/${description}`,
    '--url', `http://${LOOPBACK}:${port}`,
    '--checks', CHECKS.join(','),
    '--phases', PHASES,
    '--max-examples', String(MAX_EXAMPLES),
    '--request-timeout', '10',
    '--no-color',
    '--generation-database', 'none',
    ...(seed === null ? [] : ['--seed', String(seed)]),
    '--report', 'json', '--report-json-path', `/out/${report}`,
  ];
}

/**
 * What one Schemathesis run left, from its JSON report: the reading, or why
 * there is none (`stopped`). Its exit code says only whether it found
 * something, so the report is what says whether it finished.
 */
export function readRun(path) {
  if (!existsSync(path)) return { stopped: 'Schemathesis wrote no report' };
  const text = readFileSync(path, 'utf8');
  let d;
  try {
    d = JSON.parse(text);
  } catch (e) {
    return { stopped: `Schemathesis's report is not JSON (${firstLine(e instanceof Error ? e.message : e)})` };
  }
  // The seed is a 128-bit integer, which JSON.parse rounds: read it as written.
  return readReport(d, /"seed":\s*(\d+)/.exec(text)?.[1] ?? null);
}

/** readRun's reading of a parsed report; `seed`, the seed as the report wrote it. */
export function readReport(d, seed = null) {
  if (!d || typeof d !== 'object' || typeof d.operations !== 'object' || !Array.isArray(d.failures) || !Array.isArray(d.errors)) {
    return { stopped: "Schemathesis's report has no operations, failures and errors, the shape it writes" };
  }
  if (d.complete !== true || d.stop_reason !== 'completed') {
    return { stopped: `Schemathesis stopped before the end (${String(d.stop_reason ?? 'no reason given')})` };
  }
  const ops = d.operations;
  if (ops.errored > 0 || d.errors.length > 0) {
    return { stopped: `Schemathesis could not test ${plural(Math.max(ops.errored ?? 0, d.errors.length), 'operation')}` };
  }
  if (!Number.isInteger(ops.tested) || ops.tested !== ops.selected) {
    return { stopped: `Schemathesis tested ${ops.tested} of the ${ops.selected} operations it selected` };
  }
  const failures = [];
  for (const f of d.failures) {
    if (!f || typeof f.code !== 'string' || !Array.isArray(f.operations)) {
      return { stopped: `Schemathesis's report holds a failure without a code and operations: ${JSON.stringify(f).slice(0, 300)}` };
    }
    failures.push({ code: f.code, check: own(CODES, f.code) ?? null, title: String(f.title ?? ''), count: Number(f.count ?? 0), operations: f.operations.map(String) });
  }
  return { version: String(d.schemathesis_version ?? ''), seed: seed ?? String(d.seed ?? ''), tested: ops.tested, failures, warnings: d.warnings ?? {} };
}

/** The operations a reading's failures name under one check, sorted and once each. */
export function flagged(reading, check) {
  return [...new Set(reading.failures.filter((f) => f.check === check).flatMap((f) => f.operations))].sort();
}

/**
 * Whether the proof holds: every fault the fixture carries flagged by its
 * check. The faults not flagged, empty when it holds.
 */
export function unflagged(reading, faults = FIXTURE.faults) {
  return faults.filter((f) => !flagged(reading, f.check).includes(f.operation));
}

/**
 * The verdict, the summary and the log's lines. Exit 1 only when the scan
 * did not finish (`stopped`, the proof's or the API's), else 0, whatever was
 * found (WHAT FAILS THE JOB, above).
 */
export function report({ image = '', event = '', stopped = null, proof = null, scan = null }) {
  const lines = [];
  const md = ['## Schemathesis against the API (report only)', ''];
  md.push(`Image \`${image || 'not set'}\`${event ? `, on \`${event}\`` : ''}. Nothing here blocks yet: the job fails only when the scan did not finish (workplan 0178 T7; T8 blocks \`${BLOCKS_LATER.join('` and `')}\` after 14 quiet nights).`, '');
  const fail = (why) => {
    lines.push(`::error::The scan did not finish: ${why}`);
    md.push(`**The scan did not finish:** ${why}`, '');
    return { code: 1, lines, markdown: `${md.join('\n')}\n` };
  };
  if (stopped) return fail(stopped);
  if (!proof) return fail('the proof against the known-bad fixture did not run');
  if (proof.stopped) return fail(`the proof against the known-bad fixture: ${proof.stopped}`);
  const missed = unflagged(proof);
  md.push('### The proof: the known-bad fixture', '');
  for (const f of FIXTURE.faults) {
    const seen = flagged(proof, f.check).includes(f.operation);
    md.push(`- \`${f.check}\` on \`${f.operation}\`: ${seen ? 'flagged' : '**not flagged**'}`);
  }
  md.push('');
  if (missed.length) {
    return fail(`Schemathesis did not flag ${missed.map((f) => `\`${f.check}\` on the fixture's \`${f.operation}\``).join(' or ')}, so it is not reading what it should, and its scan of the API is not believed`);
  }
  if (!scan) return fail('the scan of the API did not run');
  if (scan.stopped) return fail(`the scan of the API: ${scan.stopped}`);
  if (scan.tested < MIN_OPERATIONS) return fail(`the scan of the API tested ${plural(scan.tested, 'operation')}, fewer than the ${MIN_OPERATIONS} a finished scan of ${API_DESCRIPTION} tests`);
  md.push(`### The API: ${plural(scan.tested, 'operation')} tested, Schemathesis ${scan.version}, seed \`${scan.seed}\``, '');
  md.push('| Check | Operations flagged | Blocks |', '|---|---|---|');
  for (const check of CHECKS) {
    md.push(`| \`${check}\` | ${flagged(scan, check).length} | ${BLOCKS_LATER.includes(check) ? 'Not yet (T8)' : 'Never'} |`);
  }
  const other = scan.failures.filter((f) => f.check === null);
  for (const f of other) md.push(`| ${f.code} ${f.title} | ${f.operations.length} | Never |`);
  md.push('');
  const counted = CHECKS.filter((c) => WITHHELD.includes(c) && flagged(scan, c).length);
  if (counted.length || other.length) {
    md.push('**No operation of the API is named here, under any check.** This summary is public: an operation `ignored_auth` flags may be a door that answers without sign-in, and the rest are put to the owner first. Reproduce the run with its seed on a stack of your own (docs/testing.md, *Schemathesis*) and hand what it finds to the maintainer privately.', '');
  }
  for (const check of counted) lines.push(`::warning::${check}: ${plural(flagged(scan, check).length, 'operation')} flagged; see the summary`);
  lines.push(`Schemathesis tested ${plural(scan.tested, 'operation')}; ${CHECKS.map((c) => `${c} ${flagged(scan, c).length}`).join(', ')}`);
  return { code: 0, lines, markdown: `${md.join('\n')}\n` };
}

function realDocker(args, opts = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

const why = (ran) => (ran.error ? `docker could not be run (${ran.error.code ?? ran.error.message})` : `docker exited ${ran.status}${firstLine(ran.stderr) ? `: ${firstLine(ran.stderr)}` : ''}`);

async function pull(image, docker, wait) {
  let last = '';
  for (let attempt = 1; attempt <= PULL_DELAYS.length + 1; attempt += 1) {
    const ran = docker(['pull', '--quiet', image]);
    if (!ran.error && ran.status === 0) return null;
    last = why(ran);
    if (attempt <= PULL_DELAYS.length) await wait(PULL_DELAYS[attempt - 1] * 1000);
  }
  return `${image} was not pulled in ${PULL_DELAYS.length + 1} attempts (the last: ${last})`;
}

/** Polls `args` (a `docker exec`) until it succeeds; null once it did, or why not. */
async function until(docker, wait, args, what) {
  let last = '';
  for (let i = 0; i < READY_POLLS; i += 1) {
    const ran = docker(args);
    if (!ran.error && ran.status === 0) return null;
    last = why(ran);
    await wait(1000);
  }
  return `${what} did not answer in ${READY_POLLS} seconds (the last: ${last})`;
}

/** A `docker run -d` of node from the checkout, in the stack's namespace. */
function nodeArgs(images, { root, name, env, uid, workdir, command }) {
  return [
    'run', '-d', '--pull', 'never', '--name', name,
    '--network', `container:${CONTAINERS.db}`,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--user', uid,
    ...env.flatMap((e) => ['--env', e]),
    '--volume', `${root}:${root}:ro`, '--workdir', workdir,
    images.node, 'node', ...command,
  ];
}

/** A token for a seeded member, signed with the run's secret by apps/api's own jsonwebtoken. */
export function signToken(root, secret, member) {
  const require = createRequire(join(root, 'apps/api/package.json'));
  const jwt = require('jsonwebtoken');
  return jwt.sign({ sub: member.sub, email: member.email, email_verified: true }, secret, { expiresIn: '2h' });
}

/**
 * One run: the images checked and pulled, the stack composed, the proof,
 * then the API's scan, then the stack removed. `docker`, `wait` and `mask`
 * are the guard's to stub.
 */
export async function run({
  root = REPO_ROOT,
  env = process.env,
  docker = realDocker,
  wait = sleep,
  mask = (v) => console.log(`::add-mask::${v}`),
  read = (f) => readFileSync(join(root, f), 'utf8'),
  out = join(env.RUNNER_TEMP || tmpdir(), 'schemathesis-report'),
  uid = `${process.getuid?.() ?? 1001}:${process.getgid?.() ?? 1001}`,
} = {}) {
  const image = env.SCHEMATHESIS_IMAGE ?? '';
  const event = env.GITHUB_EVENT_NAME ?? '';
  const base = { image, event };
  if (!IMAGE.test(image)) {
    return report({ ...base, stopped: `SCHEMATHESIS_IMAGE is ${image ? `\`${image}\`` : 'not set'}, not schemathesis/schemathesis:<x.y.z>@sha256:<index digest>` });
  }
  let images;
  try {
    images = stackImages(read);
  } catch (e) {
    return report({ ...base, stopped: e instanceof Error ? e.message : String(e) });
  }
  const secrets = freshSecrets();
  for (const v of Object.values(secrets)) mask(v);
  mkdirSync(out, { recursive: true });
  chmodSync(out, 0o777);
  for (const f of ['fixture.json', 'api.json', 'schemathesis.toml']) rmSync(join(out, f), { force: true });
  writeFileSync(join(out, 'schemathesis.toml'), CONFIG);

  const remove = () => docker(['rm', '-f', ...Object.values(CONTAINERS)]);
  remove();
  try {
    for (const ref of [images.postgres, images.node, image]) {
      const pulled = await pull(ref, docker, wait);
      if (pulled) return report({ ...base, stopped: pulled });
    }
    const db = docker(
      ['run', '-d', '--pull', 'never', '--name', CONTAINERS.db, '--network', 'none', '--user', '70:70',
        '--env', 'POSTGRES_USER=ownpace', '--env', 'POSTGRES_DB=ownpace', '--env', 'POSTGRES_PASSWORD', images.postgres],
      { env: { ...process.env, POSTGRES_PASSWORD: secrets.dbPassword } },
    );
    if (db.error || db.status !== 0) return report({ ...base, stopped: `Postgres did not start (${why(db)})` });
    const dbReady = await until(docker, wait, ['exec', CONTAINERS.db, 'pg_isready', '-h', LOOPBACK, '-U', 'ownpace'], 'Postgres');
    if (dbReady) return report({ ...base, stopped: dbReady });

    const owner = `postgresql://ownpace:${secrets.dbPassword}@${LOOPBACK}:5432/ownpace`;
    const app = `postgresql://app_user:${secrets.appPassword}@${LOOPBACK}:5432/ownpace`;
    const apiEnv = { DATABASE_URL: owner, JWT_SECRET: secrets.jwtSecret, SECRET_ENCRYPTION_KEY: secrets.encryptionKey, NODE_ENV: 'development' };
    const workdir = join(root, 'apps/api');
    // The seed applies both chains and seeds the two organisations. What it
    // prints (its own demo tokens among it) is kept out of the log.
    const seed = docker(
      ['run', '--rm', '--pull', 'never', '--network', `container:${CONTAINERS.db}`, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--user', uid, ...Object.keys(apiEnv).flatMap((k) => ['--env', k]), '--volume', `${root}:${root}:ro`, '--workdir', workdir,
        images.node, 'node', 'src/scripts/seed-managed.ts'],
      { env: { ...process.env, ...apiEnv } },
    );
    if (seed.error || seed.status !== 0) return report({ ...base, stopped: `the seed did not finish (${seed.error ? why(seed) : `node exited ${seed.status}`}; its output is not shown, since it prints tokens)` });
    // app_user's password, set by this run, through stdin and not a command line.
    const role = docker(['exec', '-i', CONTAINERS.db, 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-U', 'ownpace', '-d', 'ownpace'], {
      input: `ALTER ROLE app_user PASSWORD '${secrets.appPassword}';\n`,
      env: { ...process.env },
    });
    if (role.error || role.status !== 0) return report({ ...base, stopped: `app_user's password was not set (${why(role)})` });

    // The jobs database (THE JOBS DATABASE, above): the bring-up's file as it
    // is, its role's password, then the worker's runner installs the queues.
    const jobsRole = docker(['exec', '-i', CONTAINERS.db, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'ownpace', '-d', 'ownpace'], {
      input: read(JOBS_ROLE_SQL),
      env: { ...process.env },
    });
    if (jobsRole.error || jobsRole.status !== 0) return report({ ...base, stopped: `the jobs role was not made from ${JOBS_ROLE_SQL} (${why(jobsRole)})` });
    const jobsPassword = docker(['exec', '-i', CONTAINERS.db, 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-U', 'ownpace', '-d', 'ownpace'], {
      input: `ALTER ROLE ownpace_jobs PASSWORD '${secrets.jobsPassword}';\n`,
      env: { ...process.env },
    });
    if (jobsPassword.error || jobsPassword.status !== 0) return report({ ...base, stopped: `the jobs role's password was not set (${why(jobsPassword)})` });
    const jobs = `postgresql://ownpace_jobs:${secrets.jobsPassword}@${LOOPBACK}:5432/ownpace`;
    const queues = docker(
      ['run', '--rm', '--pull', 'never', '--network', `container:${CONTAINERS.db}`, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--user', uid, '--env', 'JOBS_DATABASE_URL', '--volume', `${root}:${root}:ro`, '--workdir', workdir,
        images.node, 'node', '--input-type=module', '-e', INSTALL_THE_QUEUES],
      { env: { ...process.env, JOBS_DATABASE_URL: jobs } },
    );
    if (queues.error || queues.status !== 0) return report({ ...base, stopped: `the jobs queues were not installed (${queues.error ? why(queues) : `node exited ${queues.status}: ${firstLine(queues.stderr)}`})` });

    const started = docker(
      nodeArgs(images, { root, name: CONTAINERS.api, uid, workdir, env: [...Object.keys(apiEnv), 'APP_DATABASE_URL', 'JOBS_DATABASE_URL', `API_PORT=${API_PORT}`], command: ['src/index.ts'] }),
      { env: { ...process.env, ...apiEnv, APP_DATABASE_URL: app, JOBS_DATABASE_URL: jobs } },
    );
    if (started.error || started.status !== 0) return report({ ...base, stopped: `the API did not start (${why(started)})` });
    const fixture = docker(nodeArgs(images, { root, name: CONTAINERS.fixture, uid, workdir: root, env: [], command: [join(FIXTURE.dir, 'server.mjs'), String(FIXTURE_PORT)] }));
    if (fixture.error || fixture.status !== 0) return report({ ...base, stopped: `the fixture did not start (${why(fixture)})` });
    const probe = (port, path) => ['exec', CONTAINERS.fixture, 'node', '-e', `fetch('http://${LOOPBACK}:${port}${path}').then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))`];
    for (const [port, path, what] of [[API_PORT, '/health', 'The API'], [FIXTURE_PORT, '/answers-without-a-token', 'The fixture']]) {
      const ready = await until(docker, wait, probe(port, path), what);
      if (ready) return report({ ...base, stopped: ready });
    }

    const token = signToken(root, secrets.jwtSecret, MEMBERS[0]);
    mask(token);
    const scanEnv = { env: { ...process.env, DAST_TOKEN: token } };
    docker(scanArgs(image, { root, out, uid, description: join(FIXTURE.dir, 'openapi.yaml'), port: FIXTURE_PORT, report: 'fixture.json' }), scanEnv);
    const proof = readRun(join(out, 'fixture.json'));
    if (proof.stopped || unflagged(proof).length) return report({ ...base, proof });
    const seedValue = env.SCHEMATHESIS_SEED && /^\d+$/.test(env.SCHEMATHESIS_SEED) ? env.SCHEMATHESIS_SEED : null;
    docker(scanArgs(image, { root, out, uid, description: API_DESCRIPTION, port: API_PORT, report: 'api.json', seed: seedValue }), scanEnv);
    return report({ ...base, proof, scan: readRun(join(out, 'api.json')) });
  } finally {
    remove();
  }
}

async function main() {
  const out = await run();
  for (const line of out.lines) console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, out.markdown);
  return out.code;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.log(`::error::schemathesis-report stopped: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    },
  );
}
