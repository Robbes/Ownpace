// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The soft lane's executable (workplan 0105 T4) — plumbing only. Every
 * decision lives in `live-target-lane.ts` where it is unit-tested; this file
 * binds the real wires: the catch-all reader, nodemailer for the one control
 * mail, and fetch for the sync triggers.
 *
 * Run by `.github/workflows/e2e-live-target.yml` (the Spark's runner, via
 * tsx), configured entirely from the environment — see the lane module for
 * the exact variables and the stand-down/misconfigured discipline.
 */

import nodemailer from 'nodemailer';
import { catchallFromEnv, searchTag, waitForTag } from './live-catchall.ts';
import {
  apiFromEnv,
  canaryDomain,
  controlFromEnv,
  mintBearer,
  runLane,
  type ApiConfig,
  type ControlConfig,
} from './live-target-lane.ts';

async function main(): Promise<number> {
  const now = new Date();
  const catchall = catchallFromEnv(process.env);
  const settleMinutes = Number.parseInt(process.env.LIVE_SETTLE_MINUTES ?? '', 10);

  const result = await runLane({
    now,
    catchall,
    control: controlFromEnv(process.env),
    api: apiFromEnv(process.env),
    domain: canaryDomain(process.env),
    search: (tag, since) =>
      catchall.on ? searchTag(catchall, tag, since) : Promise.resolve([]),
    wait: (tag, since, timeoutMs) =>
      catchall.on
        ? waitForTag(catchall, tag, { since, timeoutMs })
        : Promise.resolve([]),
    sendControl: async (config: Extract<ControlConfig, { on: true }>, to, tag) => {
      const transport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.port === 465,
        auth: { user: config.user, pass: config.password },
      });
      try {
        await transport.sendMail({
          from: config.from,
          to,
          subject: `Ownpace live-lane positive control ${tag}`,
          text:
            'One mail that must arrive: it proves the target platform can reach ' +
            'the catch-all, so tonight\'s silence assertions mean something. ' +
            'Sent by the e2e-live-target nightly; nobody needs to act on it.',
        });
      } finally {
        transport.close();
      }
    },
    triggerSync: async (config: Extract<ApiConfig, { on: true }>, mappingId) => {
      try {
        const response = await fetch(`${config.url}/api/migrations/${mappingId}/sync`, {
          method: 'POST',
          headers: {
            // Fresh per call in mint mode — a static short-lived token here
            // would 401 every night after its first hour (the smoke's lesson).
            Authorization: `Bearer ${mintBearer(config.auth, new Date())}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ type: 'delta' }),
        });
        if (response.ok) return { ok: true, detail: `${response.status}` };
        const body = await response.text();
        return { ok: false, detail: `${response.status} ${body.slice(0, 300)}` };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
    settle: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    settleMs:
      (Number.isFinite(settleMinutes) && settleMinutes > 0 ? settleMinutes : 10) * 60 * 1000,
    say: (line) => console.log(line),
  });

  console.log(result.verdict);
  return result.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    // A crash is a red with words, never a silent green (rule 9).
    console.error('live-target: RED — the lane itself crashed:', err);
    process.exit(1);
  },
);
