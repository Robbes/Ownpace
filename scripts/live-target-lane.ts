// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The soft lane's decision logic (workplan 0105 T4) — everything the nightly
 * decides, with every wire injectable so the decisions are unit-tested and
 * `live-target-nightly.ts` is only plumbing.
 *
 * The lane's posture, in one line each:
 *   - UNCONFIGURED stands down loudly-but-green: red would train everybody
 *     to ignore the lane before it exists; silent green would claim a proof
 *     nobody ran.
 *   - HALF-CONFIGURED is red, naming exactly the missing variables: a
 *     checker somebody started to set up and left is a mistake, not a choice.
 *   - Silence without a positive control is UNPROVEN, and says so: a check
 *     that could not see is not a check that passed (the run-#6 lesson).
 *   - The control's tag family (`openmig-control-…`) and the canary family
 *     (`openmig-live-…`) are DISJOINT, so the control mail can never count
 *     against the silence it exists to make meaningful (the E2E-#88 lesson:
 *     the disposable pool never overlaps the measurement fixtures).
 *   - The drain's substitutes are TIME: a settle window after a sync, and
 *     the day-after sweep — every nightly also queries YESTERDAY's tag, so
 *     every run gets a 24-hour queue window for free. Date-stamped tags are
 *     never reused by construction.
 */

import { createHmac } from 'node:crypto';
import type { CatchallConfig, CaughtMail } from './live-catchall.ts';

/** The canary tag for a run day — what a migrated fixture would carry. */
export function liveTag(date: Date): string {
  return `openmig-live-${date.toISOString().slice(0, 10).replaceAll('-', '')}`;
}

/** The positive control's tag — DISJOINT from the canary family, see above. */
export function controlTag(date: Date): string {
  return `openmig-control-${date.toISOString().slice(0, 10).replaceAll('-', '')}`;
}

const CONTROL_REQUIRED = [
  'LIVE_CONTROL_SMTP_HOST',
  'LIVE_CONTROL_SMTP_USER',
  'LIVE_CONTROL_SMTP_PASSWORD',
] as const;

/**
 * The positive control's SENDING half: the target platform's own submission
 * server (for Soverin, Soverin's SMTP), because the mail must ORIGINATE at
 * the target's MTA to prove the target → internet → catch-all pipe — a mail
 * we sent from anywhere else would prove somebody else's pipe.
 */
export type ControlConfig =
  | {
      readonly on: true;
      readonly host: string;
      readonly port: number;
      readonly user: string;
      readonly password: string;
      readonly from: string;
    }
  | { readonly on: false; readonly misconfigured: boolean; readonly reason: string };

export function controlFromEnv(env: {
  readonly [key: string]: string | undefined;
}): ControlConfig {
  const host = env.LIVE_CONTROL_SMTP_HOST?.trim();
  const user = env.LIVE_CONTROL_SMTP_USER?.trim();
  const password = env.LIVE_CONTROL_SMTP_PASSWORD ?? '';
  const touched = Boolean(host || user || password || env.LIVE_CONTROL_SMTP_PORT || env.LIVE_CONTROL_FROM);
  if (!touched) {
    return {
      on: false,
      misconfigured: false,
      reason: `no control sender configured (${CONTROL_REQUIRED.join(', ')})`,
    };
  }
  const missing = CONTROL_REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    return {
      on: false,
      misconfigured: true,
      reason:
        `the control sender is partly configured and therefore OFF — missing: ${missing.join(', ')}. ` +
        'Set them all, or unset the rest.',
    };
  }
  const parsedPort = Number.parseInt(env.LIVE_CONTROL_SMTP_PORT ?? '', 10);
  return {
    on: true,
    host: host!,
    port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 465,
    user: user!,
    password,
    from: env.LIVE_CONTROL_FROM?.trim() || user!,
  };
}

/**
 * How the nightly authenticates to the product API. Two modes, because the
 * smoke's own lesson applies here nightly: the stack's tokens EXPIRE.
 *
 *   - `mint`: sign a fresh 1-hour owner token per run with the stack's
 *     JWT_SECRET — exactly what `smoke-managed.sh`'s `mint()` does, and
 *     proven nightly by the hermetic gate. This is the mode for today's
 *     Spark stack; the secret is already gate-side plumbing (rule 3).
 *   - `token`: a static bearer, verbatim — for a stack that verifies against
 *     a real issuer and can hand out a long-lived credential. A SHORT-lived
 *     token pasted here would 401 every night after the first hour, which is
 *     precisely why this is not the only mode.
 */
export type ApiAuth =
  | { readonly mode: 'token'; readonly token: string }
  | { readonly mode: 'mint'; readonly jwtSecret: string; readonly tenantId: string; readonly sub: string };

const API_BASE_REQUIRED = ['LIVE_TARGET_API_URL', 'LIVE_TARGET_MAPPINGS'] as const;
const API_MINT_REQUIRED = ['LIVE_TARGET_JWT_SECRET', 'LIVE_TARGET_TENANT', 'LIVE_TARGET_SUB'] as const;
const API_AUTH_SENTENCE =
  'either LIVE_TARGET_API_TOKEN, or all of ' + API_MINT_REQUIRED.join('+');

/** The product half: the persistent T1 tenant's API and its mapping ids. */
export type ApiConfig =
  | {
      readonly on: true;
      readonly url: string;
      readonly auth: ApiAuth;
      readonly mappings: ReadonlyArray<string>;
    }
  | { readonly on: false; readonly misconfigured: boolean; readonly reason: string };

export function apiFromEnv(env: { readonly [key: string]: string | undefined }): ApiConfig {
  const url = env.LIVE_TARGET_API_URL?.trim();
  const token = env.LIVE_TARGET_API_TOKEN?.trim() ?? '';
  const mappings = (env.LIVE_TARGET_MAPPINGS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const mintTouched = API_MINT_REQUIRED.some((name) => env[name]?.trim());
  const touched = Boolean(url || token || mappings.length > 0 || mintTouched);
  if (!touched) {
    return {
      on: false,
      misconfigured: false,
      reason: `no live tenant configured yet (${API_BASE_REQUIRED.join(', ')}, plus ${API_AUTH_SENTENCE})`,
    };
  }
  const missing: string[] = API_BASE_REQUIRED.filter((name) => !env[name]?.trim());
  const mintMissing = API_MINT_REQUIRED.filter((name) => !env[name]?.trim());
  // One complete auth is required. A static token wins when both are set —
  // deterministic, and the mode a real issuer will eventually need.
  const auth: ApiAuth | undefined = token
    ? { mode: 'token', token }
    : mintMissing.length === 0
      ? {
          mode: 'mint',
          jwtSecret: env.LIVE_TARGET_JWT_SECRET!.trim(),
          tenantId: env.LIVE_TARGET_TENANT!.trim(),
          sub: env.LIVE_TARGET_SUB!.trim(),
        }
      : undefined;
  if (!auth) {
    // Half a mint config names ITS missing halves; no auth at all names the
    // whole either-or — both are exact remedies, not categories.
    missing.push(mintTouched ? mintMissing.join(', ') : API_AUTH_SENTENCE);
  }
  if (missing.length > 0) {
    return {
      on: false,
      misconfigured: true,
      reason:
        `the live tenant is partly configured and therefore OFF — missing: ${missing.join(', ')}. ` +
        'Set them all, or unset the rest.',
    };
  }
  return { on: true, url: url!.replace(/\/$/, ''), auth: auth!, mappings };
}

/**
 * The bearer for one run. Mint mode signs the same claims the managed
 * smoke's `mint()` signs — {sub, email, tenantId, role: 'owner'}, HS256,
 * one hour — with `node:crypto` so the harness needs no JWT dependency.
 * The same caveat as the smoke's, worth restating: a stack that verifies
 * ONLY against a real issuer refuses these; that stack wants `token` mode.
 */
export function mintBearer(auth: ApiAuth, now: Date): string {
  if (auth.mode === 'token') return auth.token;
  const b64url = (value: string): string => Buffer.from(value).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const iat = Math.floor(now.getTime() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub: auth.sub,
      email: auth.sub.includes('@') ? auth.sub : `${auth.sub}@live.local`,
      tenantId: auth.tenantId,
      role: 'owner',
      iat,
      exp: iat + 3600,
    }),
  );
  const signature = createHmac('sha256', auth.jwtSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** The canary/control address domain — the one we own. */
export function canaryDomain(env: { readonly [key: string]: string | undefined }): string {
  return env.LIVE_CANARY_DOMAIN?.trim() || 'ownpace.eu';
}

export interface LaneDeps {
  readonly now: Date;
  readonly catchall: CatchallConfig;
  readonly control: ControlConfig;
  readonly api: ApiConfig;
  readonly domain: string;
  /** `searchTag` bound to the ON catch-all config. */
  search(tag: string, since: Date): Promise<ReadonlyArray<CaughtMail>>;
  /** `waitForTag` bound likewise; timeout decided here. */
  wait(tag: string, since: Date, timeoutMs: number): Promise<ReadonlyArray<CaughtMail>>;
  /** Send the one control mail through the target's own submission server. */
  sendControl(config: Extract<ControlConfig, { on: true }>, to: string, tag: string): Promise<void>;
  /** POST the sync trigger for one mapping; refusals come back as words. */
  triggerSync(
    config: Extract<ApiConfig, { on: true }>,
    mappingId: string,
  ): Promise<{ readonly ok: boolean; readonly detail: string }>;
  settle(ms: number): Promise<void>;
  readonly settleMs: number;
  say(line: string): void;
}

export interface LaneVerdict {
  readonly ok: boolean;
  /** The one summary line, in the E2E verdict-line tradition. */
  readonly verdict: string;
}

function evidence(caught: ReadonlyArray<CaughtMail>): string[] {
  return caught.map((m) => `  · from ${m.from} to ${m.to.join(', ')} — "${m.subject}"`);
}

/** One nightly, decided. Returns rather than throws: the exit code is the caller's. */
export async function runLane(deps: LaneDeps): Promise<LaneVerdict> {
  const { say } = deps;
  say(deps.catchall.announcement);

  if (!deps.catchall.on) {
    if (deps.catchall.misconfigured) {
      return { ok: false, verdict: `live-target: RED — ${deps.catchall.reason}` };
    }
    // Loudly-but-green: the lane exists, says exactly what would arm it, and
    // blocks nothing until somebody does.
    return { ok: true, verdict: 'live-target: STAND-DOWN — unconfigured, and says so' };
  }

  const failures: string[] = [];
  const today = liveTag(deps.now);
  const yesterday = liveTag(new Date(deps.now.getTime() - 24 * 60 * 60 * 1000));

  // The day-after sweep FIRST: yesterday's run ended before a slow queue
  // would have drained; this is its 24-hour window closing.
  const swept = await deps.search(yesterday, new Date(deps.now.getTime() - 48 * 60 * 60 * 1000));
  if (swept.length > 0) {
    say(`day-after sweep: ${swept.length} mail(s) carry YESTERDAY's tag ${yesterday}:`);
    for (const line of evidence(swept)) say(line);
    failures.push(`sweep caught ${swept.length}`);
  } else {
    say(`day-after sweep: silent for ${yesterday}`);
  }

  // The positive control, before any silence is allowed to mean anything.
  let controlState: 'arrived' | 'unproven' | 'failed';
  if (!deps.control.on) {
    if (deps.control.misconfigured) {
      say(deps.control.reason);
      failures.push('control misconfigured');
      controlState = 'failed';
    } else {
      say(
        `control: OFF — every silence this run is UNPROVEN (${deps.control.reason}). ` +
          'The lane grows teeth when the sender is configured.',
      );
      controlState = 'unproven';
    }
  } else {
    const tag = controlTag(deps.now);
    const to = `${tag}@${deps.domain}`;
    try {
      await deps.sendControl(deps.control, to, tag);
      const arrived = await deps.wait(tag, new Date(deps.now.getTime() - 60 * 60 * 1000), 5 * 60 * 1000);
      if (arrived.length > 0) {
        say(`control: arrived at ${to} — the target → catch-all pipe is proven for this run`);
        controlState = 'arrived';
      } else {
        say(`control: NEVER ARRIVED at ${to} — every silence below would be vacuous`);
        failures.push('control never arrived');
        controlState = 'failed';
      }
    } catch (err) {
      say(`control: the send itself failed — ${err instanceof Error ? err.message : String(err)}`);
      failures.push('control send failed');
      controlState = 'failed';
    }
  }

  // The product half: trigger the persistent mappings, then let the world settle.
  let synced = 0;
  if (!deps.api.on) {
    if (deps.api.misconfigured) {
      say(deps.api.reason);
      failures.push('api misconfigured');
    } else {
      say(`sync: OFF — ${deps.api.reason}`);
    }
  } else {
    for (const mappingId of deps.api.mappings) {
      const result = await deps.triggerSync(deps.api, mappingId);
      if (result.ok) {
        synced += 1;
        say(`sync: triggered ${mappingId}`);
      } else {
        say(`sync: ${mappingId} refused — ${result.detail}`);
        failures.push(`sync ${mappingId} refused`);
      }
    }
    if (synced > 0) {
      say(`settling ${Math.round(deps.settleMs / 60000)} min before the silence check…`);
      await deps.settle(deps.settleMs);
    }
  }

  // Today's silence — the assertion the whole lane exists for. The control's
  // tag family never matches this search (disjoint prefixes, see header).
  const caught = await deps.search(today, new Date(deps.now.getTime() - 26 * 60 * 60 * 1000));
  if (caught.length > 0) {
    say(`silence BROKEN: ${caught.length} mail(s) carry today's tag ${today}:`);
    for (const line of evidence(caught)) say(line);
    failures.push(`silence broken by ${caught.length}`);
  } else {
    say(`silence: nothing carries ${today}`);
  }

  const verdict =
    `live-target: control=${controlState} sweep=${swept.length === 0 ? 'silent' : `${swept.length} caught`} ` +
    `sync=${deps.api.on ? `${synced}/${deps.api.on ? deps.api.mappings.length : 0}` : 'off'} ` +
    `silence=${caught.length === 0 ? (controlState === 'arrived' ? 'silent' : 'silent-but-unproven') : `${caught.length} caught`} — ` +
    (failures.length === 0 ? 'PASS' : `RED (${failures.join('; ')})`);
  return { ok: failures.length === 0, verdict };
}
