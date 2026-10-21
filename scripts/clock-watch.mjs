#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CLOCKS NOBODY ELSE WATCHES (the lifecycle survey of 2026-10-21).
 *
 * Three things the Alpha depends on stop on a date, and nothing warned before
 * the date:
 *
 * - THE PRODUCTION CERTIFICATES. NetBird's reverse proxy ends TLS for
 *   `app.`, `id.` and `status.ownpace.eu`, and for `www.ownpace.eu` once it is
 *   routed to live, and renews their certificates itself. A renewal that fails
 *   (a DNS or CAA change, a fault in the proxy) showed only at expiry. Live's
 *   status rows verify TLS and live's alerts mail the owner, but only after the
 *   certificate has expired, and only for the names they probe.
 * - `security.txt`'s `Expires`, which the site build writes 180 days after the
 *   day it runs (`site/security-txt.mjs`). Only a live deploy rebuilds it.
 * - THE MICROSOFT ENTRA CLIENT SECRET both stacks share. Entra ends every
 *   secret, 24 months after it was made at most, and when it does every
 *   Microsoft connection on both stacks fails its next token refresh at once.
 *   Nothing can read that date from outside, so the owner records it in the
 *   repository variable `CLOCK_WATCH_ENTRA_EXPIRES` (a date, `YYYY-MM-DD`).
 *
 * Once a day, from a GitHub-hosted runner (`.github/workflows/clock-watch.yml`),
 * this reads each clock and keeps ONE issue open while any is inside its
 * window: fewer than 14 whole days left on a production certificate, fewer
 * than 30 on `security.txt`'s `Expires` or on the secret's date. It updates the
 * issue, with a comment, when what is inside the window changes, and closes it
 * when nothing is. The issue's body carries dates, never a count of days, so a
 * day passing writes nothing.
 *
 * 14 DAYS, NOT MORE. Let's Encrypt's default certificate becomes 64 days on
 * 2027-02-10, and an ACME client renews with about a third of the lifetime
 * left, about 21 days. A window of 21 days or more would open the issue on
 * every healthy renewal.
 *
 * WHAT COUNTS. The production names (`PRODUCTION_NAMES`, from the outside
 * probe, so a name added there is watched here). `www.ownpace.eu` and its
 * `security.txt` only when the repository variable `CLOCK_WATCH_SITE` is
 * `required`, which the owner sets once the name is routed to live: until
 * then it points at another host. The OTA names (`OTA_NAMES`) are read and
 * reported, never counted. A clock that counts and could not be read (no
 * answer, no `Expires`, a status other than 200) is never called fine: the run
 * fails, and the issue is not closed on its account. A certificate that does
 * not verify is read anyway, and counts, with its code.
 *
 * ITS LOG IS PUBLIC, so it prints names and dates only: no address, and a
 * failure by its error code, never Node's message, which names the address it
 * failed on (as `exposure-probe.mjs` does). A certificate's subject and issuer
 * are not printed either. Certificate dates are public anyway, in the CT logs,
 * which is why this may run on a schedule where the exposure probe may not.
 *
 * `.mjs` for the reason `audit-advisories.mjs` gives: it runs in a CI step on
 * a bare checkout and needs no type stripping. Its guard,
 * `scripts/a-clock-that-knows-it-is-running-out.unit.test.ts`, runs it with a
 * stubbed network and a fake `gh`.
 *
 * Usage:  node scripts/clock-watch.mjs [--issue]
 * Exit: 0 every clock that counts was read; 1 one could not be read; 2 the
 * configuration is wrong, or the watch stopped.
 */

import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import { connect as tlsConnect } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { OTA_NAMES, PRODUCTION_NAMES, SITE_NAME } from './exposure-probe.mjs';

export const ISSUE_TITLE = 'A clock is running out: a certificate, security.txt or the Entra client secret';
/** A production certificate with fewer whole days left than this is inside its window. */
export const CERTIFICATE_DAYS = 14;
/** security.txt's `Expires`, the same way. */
export const SECURITY_TXT_DAYS = 30;
/** The Entra client secret's recorded date, the same way. */
export const ENTRA_DAYS = 30;
export const SECURITY_TXT_URL = `https://${SITE_NAME}/.well-known/security.txt`;
export const ENTRA_NAME = 'the Microsoft Entra client secret';
export const TLS_PORT = 443;

const DAY_MS = 24 * 60 * 60 * 1000;
const WORKFLOW = '.github/workflows/clock-watch.yml';
const ENTRA_DOC = "docs/managed-bring-up.md, *The deployment's own Entra registration*";

/**
 * The watch's configuration from the environment the workflow hands it, or
 * the reasons it cannot run. No value from the environment is repeated: a
 * repository variable is printed in the log already, and a wrong one may be
 * something that should not have been there at all.
 */
export function watchConfig(env) {
  const errors = [];
  const siteValue = (env.CLOCK_WATCH_SITE ?? '').trim();
  if (siteValue !== '' && siteValue !== 'required') errors.push('CLOCK_WATCH_SITE must be empty or required.');
  const entraValue = (env.CLOCK_WATCH_ENTRA_EXPIRES ?? '').trim();
  if (entraValue !== '' && !isCalendarDate(entraValue)) {
    errors.push(
      'CLOCK_WATCH_ENTRA_EXPIRES must be one date, YYYY-MM-DD: the Expires the Entra portal shows beside the client secret. ' +
        'A repository variable is printed in every run of this workflow, so if it holds the secret itself, delete the variable and renew the secret.',
    );
  }
  if (errors.length) return { errors };
  return { config: { site: siteValue === 'required', ...(entraValue ? { entra: entraValue } : {}) }, errors: [] };
}

/** `YYYY-MM-DD` that names a day the calendar has: 2026-02-30 does not. */
function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Whole days from `now` to `expires`; negative once it has passed. */
function daysBetween(now, expires) {
  return Math.floor((expires.getTime() - now.getTime()) / DAY_MS);
}

/**
 * The one `Expires` of a security.txt (RFC 9116 §2.5.5: always present, never
 * twice), or what is wrong with the file. Any case, any line ending.
 */
export function securityTxtExpires(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const values = lines.map((l) => /^expires:[ \t]*(.*?)[ \t]*$/i.exec(l)?.[1]).filter((v) => v !== undefined);
  if (values.length === 0) return { why: 'it has no Expires line' };
  if (values.length > 1) return { why: `it has ${values.length} Expires lines, not one` };
  const value = values[0].toUpperCase();
  const shaped = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value);
  const expires = new Date(value);
  if (!shaped || Number.isNaN(expires.getTime())) return { why: 'its Expires is not a date' };
  return { expires };
}

/** A clock with a date: inside its window, or not. */
function dated(base, expires, now) {
  const daysLeft = daysBetween(now, expires);
  return { ...base, expires: expires.toISOString().slice(0, 10), daysLeft, state: daysLeft < base.window ? 'due' : 'ok' };
}

/** One certificate's clock, from what the network handed back. */
async function certificateClock(io, name, counted, now) {
  const base = { kind: 'certificate', name, counted, window: CERTIFICATE_DAYS };
  const answer = await io.certificate(name);
  const expires = answer.validTo === undefined ? undefined : new Date(answer.validTo);
  if (!expires || Number.isNaN(expires.getTime())) {
    return { ...base, state: 'unread', why: answer.why ?? 'no expiry date in the certificate' };
  }
  const clock = dated(base, expires, now);
  if (answer.verified === false) return { ...clock, state: 'due', verified: false, why: answer.why ?? 'not verified' };
  return { ...clock, verified: true };
}

/**
 * Every clock, in a fixed order: the production names, the site and its
 * security.txt when required, the Entra secret when recorded, the OTA names.
 */
async function readClocks(config, io, now) {
  const clocks = [];
  for (const name of PRODUCTION_NAMES) clocks.push(await certificateClock(io, name, true, now));
  if (config.site) {
    clocks.push(await certificateClock(io, SITE_NAME, true, now));
    const base = { kind: 'security.txt', name: `${SITE_NAME}/.well-known/security.txt`, counted: true, window: SECURITY_TXT_DAYS };
    const answer = await io.securityTxt(SECURITY_TXT_URL);
    if (answer.text === undefined) {
      clocks.push({ ...base, state: 'unread', why: answer.why ?? 'no answer' });
    } else {
      const read = securityTxtExpires(answer.text);
      clocks.push(read.expires ? dated(base, read.expires, now) : { ...base, state: 'due', why: read.why });
    }
  }
  if (config.entra) {
    const base = { kind: 'entra', name: ENTRA_NAME, counted: true, window: ENTRA_DAYS };
    clocks.push(dated(base, new Date(`${config.entra}T00:00:00Z`), now));
  }
  for (const name of OTA_NAMES) clocks.push(await certificateClock(io, name, false, now));
  return clocks;
}

/** `76 days left`, `1 day left`, `expired 2 days ago`. */
function left(daysLeft) {
  if (daysLeft < 0) return `expired ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago`;
  return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
}

/** What one clock says, after its tag: names, dates and codes only. */
function words(clock) {
  if (clock.state === 'unread') {
    return clock.kind === 'certificate' ? `${clock.name}: certificate not read (${clock.why})` : `${clock.name}: not read (${clock.why})`;
  }
  if (clock.expires === undefined) return `${clock.name}: ${clock.why}`;
  const what =
    clock.kind === 'certificate'
      ? `certificate valid until ${clock.expires}`
      : clock.kind === 'security.txt'
        ? `Expires ${clock.expires}`
        : `expires ${clock.expires} (CLOCK_WATCH_ENTRA_EXPIRES)`;
  const inside = clock.state === 'due' && clock.daysLeft >= 0 && clock.daysLeft < clock.window ? `, fewer than ${clock.window}` : '';
  const unverified = clock.verified === false ? `, and it does not verify (${clock.why})` : '';
  return `${clock.name}: ${what}, ${left(clock.daysLeft)}${inside}${unverified}`;
}

/** The log: a line per clock, what was not asked and why, and the count. */
function report(config, clocks) {
  const lines = [
    `clock-watch: a production certificate warns with fewer than ${CERTIFICATE_DAYS} days left; security.txt and ${ENTRA_NAME} with fewer than ${SECURITY_TXT_DAYS}`,
  ];
  for (const clock of clocks) {
    if (!clock.counted) lines.push(`note  ${words(clock)}; the OTA stack's, reported and not counted`);
    else if (clock.state === 'ok') lines.push(`ok    ${words(clock)}`);
    else if (clock.state === 'due') lines.push(`DUE   ${words(clock)}`);
    else lines.push(`FAIL  ${words(clock)}`);
  }
  if (!config.site) {
    lines.push(
      `note  ${SITE_NAME}: not asked; CLOCK_WATCH_SITE is not required (set it once the name is routed to live, docs/managed-bring-up.md)`,
    );
  }
  if (!config.entra) lines.push(`note  ${ENTRA_NAME}: no date; CLOCK_WATCH_ENTRA_EXPIRES is not set (${ENTRA_DOC})`);
  const due = clocks.filter((c) => c.counted && c.state === 'due').length;
  const unread = clocks.filter((c) => c.counted && c.state === 'unread').length;
  lines.push(`clock-watch: ${due} inside the window, ${unread} not read`);
  return lines;
}

/**
 * The watch. `io` is the network: `certificate(name)` and `securityTxt(url)`.
 * Returns every clock, the log's lines and the exit code.
 */
export async function runWatch(config, io, now) {
  const clocks = await readClocks(config, io, now);
  const code = clocks.some((c) => c.counted && c.state === 'unread') ? 1 : 0;
  return { clocks, lines: report(config, clocks), code };
}

/** One line of the issue per clock: its name and its date, never a count of days. */
function issueLine(clock) {
  if (clock.kind === 'certificate') {
    const unverified = clock.verified === false ? ` and does not verify (\`${clock.why}\`)` : '';
    return `- **${clock.name}**: its certificate runs until **${clock.expires}**${unverified}.`;
  }
  if (clock.kind === 'security.txt') {
    return clock.expires === undefined
      ? `- **${clock.name}**: ${clock.why}.`
      : `- **${clock.name}**: its \`Expires\` is **${clock.expires}**.`;
  }
  return `- **${ENTRA_NAME}** expires on **${clock.expires}**, as \`CLOCK_WATCH_ENTRA_EXPIRES\` records it.`;
}

const ROUTES = {
  certificate:
    "**A certificate.** NetBird's reverse proxy ends TLS for these names and renews their certificates itself. An ACME client renews with about a third of the lifetime left, so a certificate with fewer than " +
    `${CERTIFICATE_DAYS} days left has missed its renewal. Look at the name's route in NetBird, and at the DNS records the certificate authority checks before it issues: the name's own record and the domain's CAA record. A certificate that does not verify is read anyway; its code says why.`,
  'security.txt':
    "**security.txt.** The site build writes `Expires` 180 days after the day it runs (`site/security-txt.mjs`), and every live deploy rebuilds the site. Deploy live again, the next release tag or the one it runs: `./deploy/compose/deploy-live.sh <tag>`, as docs/managed-bring-up.md's *`ownpace-live`: a release tag, with `deploy-live.sh`* says, hold and drain included.",
  entra:
    "**The Entra client secret.** Both stacks share it, and it stops on both at once. Renew it as docs/managed-bring-up.md says (*The deployment's own Entra registration*): a new secret beside the old one, the OTA stack, then live, the old one deleted last. Then set the repository variable `CLOCK_WATCH_ENTRA_EXPIRES` to the new date.",
};

/** What the issue says: each clock inside its window, and the route for each kind. */
export function issueBody(clocks) {
  const due = clocks.filter((c) => c.counted && c.state === 'due');
  const kinds = ['certificate', 'security.txt', 'entra'].filter((k) => due.some((c) => c.kind === k));
  return [
    `These clocks are inside their window: a production certificate with fewer than ${CERTIFICATE_DAYS} days left, or security.txt's \`Expires\` or ${ENTRA_NAME} with fewer than ${SECURITY_TXT_DAYS}.`,
    '',
    ...due.map(issueLine),
    '',
    ...kinds.flatMap((k) => [ROUTES[k], '']),
    `This issue is kept by \`${WORKFLOW}\`, which reads every clock once a day. It is updated when what is inside the window changes, and closed when nothing is.`,
  ].join('\n');
}

/** Two issue bodies are the same text, whatever line endings GitHub hands back. */
function sameText(a, b) {
  const plain = (text) => String(text ?? '').replace(/\r\n/g, '\n').trim();
  return plain(a) === plain(b);
}

/**
 * Keeps one issue open while a clock that counts is inside its window: opens
 * it, or brings the one already open up to date, with a comment, since an edit
 * notifies nobody. Closes it once every clock that counts was read and none is
 * inside its window; a clock that could not be read keeps it as it is. `gh`
 * takes the arguments of the GitHub CLI and returns its output.
 */
export function keepIssue(clocks, gh) {
  const counted = clocks.filter((c) => c.counted);
  const due = counted.filter((c) => c.state === 'due');
  const listed = JSON.parse(gh(['issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,title,body']) || '[]');
  const open = listed.filter((issue) => issue.title === ISSUE_TITLE);
  if (due.length > 0) {
    const body = issueBody(due);
    if (open.length === 0) {
      gh(['issue', 'create', '--title', ISSUE_TITLE, '--body', body]);
      return 'opened';
    }
    const [issue] = open;
    if (sameText(issue.body, body)) return 'unchanged';
    const number = String(issue.number);
    gh(['issue', 'edit', number, '--body', body]);
    gh(['issue', 'comment', number, '--body', ['The clocks inside their window are now:', '', ...due.map(issueLine)].join('\n')]);
    return 'updated';
  }
  if (open.length > 0 && counted.every((c) => c.state === 'ok')) {
    for (const issue of open) {
      gh(['issue', 'close', String(issue.number), '--comment', 'Every clock is outside its window again.']);
    }
    return 'closed';
  }
  return 'untouched';
}

/** A verification error to print: a code such as CERT_HAS_EXPIRED, never a sentence. */
function codeOf(value) {
  const text = String(value ?? '');
  return /^[A-Z][A-Z0-9_]*$/.test(text) ? text : 'not verified';
}

/**
 * The real network, with its timeouts. `connect` is `tls.connect`, replaceable
 * for the guard. Nothing here reads an error's message.
 */
export function realNetwork({ tlsMs = 10000, fetchMs = 15000, connect = tlsConnect } = {}) {
  return {
    /**
     * The certificate the name serves on 443, asked by the name itself. It is
     * read even when it does not verify (`rejectUnauthorized: false`), since an
     * expired certificate is the one this exists to see; whether it verified,
     * and the code if not, travels with its date. Nothing is sent.
     */
    certificate(name) {
      return new Promise((done) => {
        let settled = false;
        const socket = connect({ host: name, port: TLS_PORT, servername: name, rejectUnauthorized: false });
        const finish = (answer) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          done(answer);
        };
        socket.setTimeout(tlsMs, () => finish({ why: 'timeout' }));
        socket.once('secureConnect', () => {
          const validTo = socket.getPeerCertificate()?.valid_to;
          if (typeof validTo !== 'string' || validTo === '') return finish({ why: 'no certificate' });
          finish(socket.authorized ? { validTo, verified: true } : { validTo, verified: false, why: codeOf(socket.authorizationError) });
        });
        socket.once('error', (e) => finish({ why: e?.code ?? 'error' }));
      });
    },

    /** security.txt as a visitor's first request gets it: no redirect followed, a 200 or its status. */
    async securityTxt(url) {
      try {
        const res = await fetch(url, { redirect: 'manual', signal: globalThis.AbortSignal.timeout(fetchMs) });
        const text = await res.text();
        return res.status === 200 ? { text } : { why: `HTTP ${res.status}` };
      } catch (e) {
        return { why: e?.cause?.code ?? e?.name ?? 'error' };
      }
    },
  };
}

async function main(argv) {
  const { config, errors } = watchConfig(process.env);
  if (!config) {
    for (const e of errors) console.log(`clock-watch: ${e}`);
    return 2;
  }
  const { clocks, lines, code } = await runWatch(config, realNetwork(), new Date());
  for (const line of lines) console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `## Clock watch\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
  if (argv.includes('--issue')) {
    // gh's own complaints go straight to the log; its answers come back here.
    const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    console.log(`issue: ${keepIssue(clocks, gh)}`);
  }
  return code;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      // The code only: a message may name the address it failed on.
      console.log(`clock-watch: stopped (${e?.code ?? e?.name ?? 'error'})`);
      process.exitCode = 2;
    },
  );
}
