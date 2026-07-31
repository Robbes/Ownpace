/**
 * The ONE construction path for the Trigger.dev API client (workplan 0018 T1).
 *
 * Two env vars, using the SDK's OWN names so nothing here can drift from what
 * the SDK resolves:
 *
 *  - `TRIGGER_API_URL`    — the self-hosted instance. The managed compose
 *    stack sets it (`http://trigger-api:3000` from inside the network).
 *  - `TRIGGER_SECRET_KEY` — the project environment's secret key
 *    (`tr_prod_…`/`tr_dev_…`), minted per project+environment by the
 *    instance's own dashboard.
 *
 * History, recorded so the old names stay dead: this file once passed
 * `accessToken: TRIGGER_DEV_ACCESS_TOKEN` and defaulted the base URL to
 * `http://localhost:3000`. The SDK resolves `accessToken ?? secretKey ??
 * env(TRIGGER_SECRET_KEY)` and `baseURL ?? env(TRIGGER_API_URL)` — so the
 * undefined token fell through to an env var nobody set (the auth error the
 * 2026-07-31 live smoke caught), while the always-truthy localhost default
 * silently OVERRODE the stack's correct `TRIGGER_API_URL`. Three disagreeing
 * namings, two real bugs; 0018 T1 collapsed them to the SDK's pair.
 *
 * Throws at CALL time, not import time, naming exactly what is missing (hard
 * rule 9). Not required at boot, deliberately: the secret key is minted by
 * the very stack it gates — the dashboard cannot be reached before
 * `docker compose up` — so a boot-time requirement would deadlock first
 * bring-up. Every enqueue call site catches this and lands the failure on
 * the run/receipt row a poller reads.
 */

import { TriggerClient } from '@trigger.dev/sdk/v3';

export function getTriggerClient(): TriggerClient {
  const baseURL = process.env.TRIGGER_API_URL;
  const secretKey = process.env.TRIGGER_SECRET_KEY;
  const missing = [
    ...(baseURL ? [] : ['TRIGGER_API_URL']),
    ...(secretKey ? [] : ['TRIGGER_SECRET_KEY']),
  ];
  if (missing.length > 0) {
    throw new Error(
      `Cannot enqueue: ${missing.join(' and ')} not set. TRIGGER_API_URL is the ` +
        'self-hosted Trigger.dev instance (the managed compose stack provides it); ' +
        "TRIGGER_SECRET_KEY is the project environment's secret key from that " +
        "instance's dashboard — see deploy/compose/deploy-tasks.sh for the flow.",
    );
  }
  return new TriggerClient({ baseURL, secretKey });
}
