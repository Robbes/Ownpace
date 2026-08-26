// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The live world's Mailpit (workplan 0105 T2): a reader for the ownpace.eu
 * catch-all inbox, so the live-target lane can assert what the hermetic lane
 * asserts — a positive control that MUST arrive, then silence for the tag.
 *
 * HARNESS EQUIPMENT, not product. The catch-all's IMAP credentials live in
 * the Spark's `.env` beside the smoke's other plumbing (rule 3, and 0105's
 * two-credential-kinds rule: the product holds what it needs to MIGRATE, the
 * gate holds what it needs to JUDGE). Nothing here is imported by any app.
 *
 * The config discipline is `notifierFromEnv`'s, copied deliberately:
 *   - nothing set → honestly OFF, naming every variable that would turn it on
 *     (the nightly stands down loudly-but-green on this);
 *   - PARTLY set → OFF naming exactly the missing variables (the nightly goes
 *     red on this — a half-configured checker is a mistake, not a choice).
 *
 * The search casts the widest net a tag allows — to, subject, body — because
 * a silence assertion that only watched the To: header would call a fan-out
 * mail "silence" if the tag rode only in the body (the run-#6 family of
 * mistakes: a check that could not see is not a check that passed).
 */

import { ImapFlow } from 'imapflow';

export type CatchallConfig =
  | {
      readonly on: true;
      readonly host: string;
      readonly port: number;
      readonly user: string;
      readonly password: string;
      readonly mailbox: string;
      /** One line for the run log: ON, to what. */
      readonly announcement: string;
    }
  | {
      readonly on: false;
      /** Distinguishes "deliberately off" from "half-configured, fix it". */
      readonly misconfigured: boolean;
      readonly reason: string;
      readonly announcement: string;
    };

const REQUIRED = ['LIVE_CATCHALL_HOST', 'LIVE_CATCHALL_USER', 'LIVE_CATCHALL_PASSWORD'] as const;

export function catchallFromEnv(env: {
  readonly [key: string]: string | undefined;
}): CatchallConfig {
  const host = env.LIVE_CATCHALL_HOST?.trim();
  const user = env.LIVE_CATCHALL_USER?.trim();
  const password = env.LIVE_CATCHALL_PASSWORD ?? '';

  const touched = Boolean(host || user || password || env.LIVE_CATCHALL_PORT || env.LIVE_CATCHALL_MAILBOX);
  if (!touched) {
    const reason = `the live catch-all is not configured (${REQUIRED.join(', ')})`;
    return { on: false, misconfigured: false, reason, announcement: `live catch-all: OFF — ${reason}` };
  }

  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    const reason =
      `the live catch-all is partly configured and therefore OFF — missing: ${missing.join(', ')}. ` +
      'Set them all, or unset the rest to stand the lane down.';
    return { on: false, misconfigured: true, reason, announcement: `live catch-all: OFF — ${reason}` };
  }

  const parsedPort = Number.parseInt(env.LIVE_CATCHALL_PORT ?? '', 10);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 993;
  const mailbox = env.LIVE_CATCHALL_MAILBOX?.trim() || 'INBOX';
  return {
    on: true,
    host: host!,
    port,
    user: user!,
    password,
    mailbox,
    announcement: `live catch-all: ON — ${user} @ ${host}:${port}/${mailbox}`,
  };
}

/** What a caught mail is to an assertion: enough to say WHO sent WHAT where. */
export interface CaughtMail {
  readonly subject: string;
  readonly from: string;
  readonly to: ReadonlyArray<string>;
  readonly date?: string;
}

/**
 * The slice of ImapFlow the reader touches — injectable, so the assertions
 * are unit-tested against a fake and the live nightly is the only place a
 * socket opens.
 */
export interface CatchallClient {
  connect(): Promise<void>;
  getMailboxLock(mailbox: string): Promise<{ release(): void }>;
  search(query: Record<string, unknown>): Promise<number[] | false>;
  fetchOne(
    seq: number,
    query: { envelope: boolean },
  ): Promise<{ envelope?: EnvelopeLike } | false>;
  logout(): Promise<void>;
}

interface EnvelopeLike {
  readonly subject?: string;
  readonly date?: Date | string;
  readonly from?: ReadonlyArray<{ address?: string }>;
  readonly to?: ReadonlyArray<{ address?: string }>;
  readonly cc?: ReadonlyArray<{ address?: string }>;
}

/**
 * Every mail carrying the tag — in the To, the Subject, or the body — since
 * `since`. One connection per call, deliberately: the poll cadence is tens of
 * seconds and a held-open live IMAP connection is a flake generator.
 */
export async function searchTag(
  config: Extract<CatchallConfig, { on: true }>,
  tag: string,
  since: Date,
  clientFor: (config: Extract<CatchallConfig, { on: true }>) => CatchallClient = imapflowClient,
): Promise<ReadonlyArray<CaughtMail>> {
  const client = clientFor(config);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(config.mailbox);
    try {
      const seqs = await client.search({
        since,
        or: [{ to: tag }, { subject: tag }, { body: tag }],
      });
      if (!seqs || seqs.length === 0) return [];
      const caught: CaughtMail[] = [];
      for (const seq of seqs) {
        const message = await client.fetchOne(seq, { envelope: true });
        const envelope = message === false ? undefined : message.envelope;
        caught.push({
          subject: envelope?.subject ?? '(no subject)',
          from: envelope?.from?.[0]?.address ?? '(unknown sender)',
          to: [...(envelope?.to ?? []), ...(envelope?.cc ?? [])]
            .map((a) => a.address ?? '')
            .filter(Boolean),
          ...(envelope?.date ? { date: String(envelope.date) } : {}),
        });
      }
      return caught;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

/**
 * The positive-control assertion: poll until at least `atLeast` mails carry
 * the tag, or the window closes. Returns what arrived either way — the
 * CALLER decides red/green and prints the evidence, this never throws for
 * "not there yet".
 */
export async function waitForTag(
  config: Extract<CatchallConfig, { on: true }>,
  tag: string,
  options: {
    readonly since: Date;
    readonly atLeast?: number;
    readonly timeoutMs?: number;
    readonly everyMs?: number;
    readonly clientFor?: (config: Extract<CatchallConfig, { on: true }>) => CatchallClient;
    readonly sleep?: (ms: number) => Promise<void>;
  },
): Promise<ReadonlyArray<CaughtMail>> {
  const atLeast = options.atLeast ?? 1;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const everyMs = options.everyMs ?? 10_000;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const clientFor = options.clientFor ?? imapflowClient;

  let waited = 0;
  for (;;) {
    const caught = await searchTag(config, tag, options.since, clientFor);
    if (caught.length >= atLeast) return caught;
    if (waited >= timeoutMs) return caught;
    await sleep(everyMs);
    waited += everyMs;
  }
}

/**
 * The silence assertion is `searchTag` itself: silence is an EMPTY answer
 * from the same search that just proved it can see (the positive control).
 * No separate code path, deliberately — a silence checker with its own
 * narrower query is how "no mail arrived" and "we did not look" become the
 * same sentence.
 */
export const assertableSilence = searchTag;

function imapflowClient(config: Extract<CatchallConfig, { on: true }>): CatchallClient {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
  }) as unknown as CatchallClient;
}
