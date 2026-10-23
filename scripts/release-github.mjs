#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT THE RELEASE SCRIPTS SHARE: a small GitHub REST client, the fields they
 * keep of what it answers, and the one line format every check prints.
 *
 * The Release workflow (`.github/workflows/release.yml`, `docs/release.md`)
 * runs six scripts: `release-nights.mjs`, `release-preflight.mjs`,
 * `release-upgrade-gates.mjs`, `release-dispatch.mjs`, `release-cut-tag.mjs`
 * and `release-verify.mjs`. Each imports only Node's own modules, because the
 * first of them runs before anything is installed, and each prints its checks
 * as lines of one shape:
 *
 *   pass <check>: <sentence>
 *   refuse <check>: <sentence>
 *   note <check>: <sentence>
 *
 * Inside Actions a refuse is also an `::error::` annotation, and every line
 * can be appended to a JSON-lines file the preflight's verdict reads back.
 *
 * THE CLIENT. GET is retried on a 5xx, and on a 403 or 429 that carries
 * `Retry-After`, because reading twice changes nothing. Nothing else is: a
 * POST that timed out may have happened, and a dispatch sent twice would
 * start two publishers on one tag. The callers look before they write again.
 * The token is sent and never printed.
 *
 * THE FIELDS KEPT. A workflow run as the API answers it carries the commit's
 * whole message (`head_commit`), which on this repository ends in
 * co-author trailers with addresses in them, and the accounts that started
 * it (`actor`, `triggering_actor`); a job carries the runner's name. None of
 * that is read by any check, and the test fixtures are recorded through these
 * same lists, so none of it can reach the repository either.
 */

import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

/** The repository the scripts act on, as Actions names it. */
export const REPOSITORY = process.env.GITHUB_REPOSITORY || 'Robbes/Ownpace';

/** The fields of a workflow run any release check reads. */
export const RUN_FIELDS = [
  'id',
  'run_number',
  'event',
  'status',
  'conclusion',
  'run_attempt',
  'head_sha',
  'head_branch',
  'path',
  'created_at',
  'run_started_at',
  'updated_at',
];

/** The fields of a job, and of a job's step, any release check reads. */
export const JOB_FIELDS = ['name', 'status', 'conclusion'];
export const STEP_FIELDS = ['number', 'name', 'status', 'conclusion'];

/** The fields of a release, and of its assets, the verify reads. */
export const RELEASE_FIELDS = ['tag_name', 'name', 'draft', 'prerelease', 'immutable', 'body'];
export const ASSET_FIELDS = ['name', 'size', 'state', 'browser_download_url'];

/** Keys that never belong in anything recorded from the API. */
export const NEVER_RECORDED = ['head_commit', 'actor', 'triggering_actor', 'runner_name'];

const pick = (object, fields) =>
  Object.fromEntries(fields.filter((f) => object && f in object).map((f) => [f, object[f]]));

/** A workflow run with only the fields a check reads. */
export function slimRun(run) {
  return pick(run, RUN_FIELDS);
}

/** A job with only its name and result, and its steps likewise. */
export function slimJob(job) {
  const slim = pick(job, JOB_FIELDS);
  if (Array.isArray(job?.steps)) slim.steps = job.steps.map((s) => pick(s, STEP_FIELDS));
  return slim;
}

/** A release with only what the verify reads. */
export function slimRelease(release) {
  const slim = pick(release, RELEASE_FIELDS);
  slim.assets = (release?.assets ?? []).map((a) => pick(a, ASSET_FIELDS));
  return slim;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** One check's answer. `kind` is pass, refuse or note. */
export function line(kind, check, sentence) {
  return { kind, check, sentence };
}
export const pass = (check, sentence) => line('pass', check, sentence);
export const refuse = (check, sentence) => line('refuse', check, sentence);
export const note = (check, sentence) => line('note', check, sentence);

/** How many of these lines refuse. */
export const refusals = (lines) => lines.filter((l) => l.kind === 'refuse').length;

/** The text of one line, as the log shows it. */
export function render(l) {
  return `${l.kind} ${l.check}: ${l.sentence}`;
}

/**
 * Print the lines; a refuse is also an `::error::` inside Actions. When
 * `file` is given, append them to it as JSON lines for the verdict.
 */
export function report(lines, { file = process.env.RELEASE_LINES, actions = process.env.GITHUB_ACTIONS === 'true' } = {}) {
  for (const l of lines) {
    console.log(render(l));
    if (actions && l.kind === 'refuse') console.log(`::error::${l.check}: ${l.sentence}`);
  }
  if (file) appendFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
}

/** `GITHUB_OUTPUT`'s `name=value` lines, or the console outside Actions. */
export function output(values, file = process.env.GITHUB_OUTPUT) {
  const text = Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  if (file) appendFileSync(file, `${text}\n`);
  else console.log(text);
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/** An answer the API gave that the caller did not expect. */
export class ApiError extends Error {
  constructor(method, path, status, body) {
    const said = typeof body?.message === 'string' ? `: ${body.message}` : '';
    super(`${method} ${path} answered ${status}${said}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * A REST client for one repository. `fetchImpl` and `sleep` are the seams the
 * guards use. Paths are relative to `repos/<repository>/` unless they start
 * with a slash.
 */
export function github({
  token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
  api = process.env.GITHUB_API_URL || 'https://api.github.com',
  repository = REPOSITORY,
  fetchImpl = fetch,
  sleep = (ms) => delay(ms),
  tries = 4,
} = {}) {
  const url = (path) => (path.startsWith('/') ? `${api}${path}` : `${api}/repos/${repository}/${path}`);
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ownpace-release',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  async function once(method, path, body) {
    const res = await fetchImpl(url(path), {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: globalThis.AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { message: text.slice(0, 200) };
      }
    }
    return { status: res.status, json, retryAfter: res.headers?.get?.('retry-after') ?? null };
  }

  /** GET, retried; a 404 is an answer (null) when `allow404`. */
  async function get(path, { allow404 = false } = {}) {
    let last;
    for (let attempt = 1; attempt <= tries; attempt += 1) {
      last = await once('GET', path);
      if (last.status >= 200 && last.status < 300) return last.json;
      if (last.status === 404 && allow404) return null;
      const limited = (last.status === 403 || last.status === 429) && last.retryAfter !== null;
      if (!(last.status >= 500 || limited) || attempt === tries) break;
      const wait = limited ? Math.min(Number(last.retryAfter) || 30, 120) * 1000 : 5_000 * attempt;
      await sleep(wait);
    }
    throw new ApiError('GET', path, last.status, last.json);
  }

  /** Any other method, sent once. The answer is returned whatever it is. */
  async function send(method, path, body) {
    const answer = await once(method, path, body);
    return { status: answer.status, json: answer.json };
  }

  return { get, send, url };
}

/** The run's address, as a person opens it. */
export function runUrl(id, repository = REPOSITORY, server = process.env.GITHUB_SERVER_URL || 'https://github.com') {
  return `${server}/${repository}/actions/runs/${id}`;
}

/** The first twelve characters of a commit, as the lines print it. */
export const short = (sha) => (typeof sha === 'string' ? sha.slice(0, 12) : String(sha));
