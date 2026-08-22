// Copyright 2026 OpenHands Agent (Apache-2.0)
// JMAP target writer for Stalwart and other JMAP servers.
// Implements TargetWriter interface for mail import with idempotency support.
// T3 from workplan 0001-first-slice-jmap-mail.

import JamClient from "jmap-jam";
import { loadJmapSession } from './jmap-session.ts';
import { fetchWithRateLimitRetry } from './http-rate-limit.ts';
import type {
  TargetWriter,
  TargetReindexer,
  TargetEntry,
  MailFolder,
  RawMessage,
  MailKeyword,
  UpsertResult,
  RemovalResult,
} from "@openmig/shared";
import { contentHash } from "@openmig/shared";
import { log } from '@openmig/shared';

/**
 * Above this many messages already on the target, stop enumerating it up front
 * and go back to probing per item.
 *
 * The snapshot costs one round trip per 100 messages ALREADY THERE, and saves
 * one per message written. For the ordinary case — a fresh or near-empty
 * destination, which is what hard rule 2 assumes — that is one request against
 * hundreds. For a destination already holding a very large mailbox the trade
 * inverts, and enumerating half a million messages to write a thousand is
 * worse than a thousand probes.
 *
 * Deliberately generous: at 50k the enumeration is ~500 requests, still cheap
 * next to any migration big enough to care, and the memory is a few MB of
 * strings.
 */
const SNAPSHOT_MAX_ENTRIES = 50_000;

/**
 * JMAP Mailbox object.
 *
 * `parentId` is RFC 8621's ONLY expression of hierarchy — there is no path
 * property in JMAP at all, which is why `targetSegments` below has to define
 * the mapping from our path strings to a tree. `null` means the mailbox sits at
 * the account root; servers vary between `null` and omitting it, so read both.
 *
 * `path` is ours, not the server's, and is left here only because
 * `MailboxGetResponse` has carried it since this file was written; nothing
 * populates it. Matching is by name-within-parent (see `matchChild`).
 */
interface Mailbox {
  id: string;
  name: string;
  parentId?: string | null;
  path?: string;
  role?: string;
  type?: string;
}

/**
 * JMAP Mailbox set response type.
 */
interface MailboxSetResponse {
  type: string;
  accountId: string;
  created?: Record<string, { id: string }>;
  notCreated?: Record<string, { type: string; description: string }>;
}

/**
 * JMAP Mailbox get response type.
 */
interface MailboxGetResponse {
  type: string;
  accountId: string;
  list: Array<{
    id: string;
    name: string;
    path?: string;
    role?: string;
  }>;
  notFound?: string[];
}

/**
 * JMAP Email/import response type.
 */
interface EmailImportResponse {
  type: string;
  accountId: string;
  created?: Record<string, { id: string; blobId: string }>;
  /**
   * `existingId` rides along on an `alreadyExists` SetError, naming the message
   * the server already had. Optional here because it could not be confirmed
   * against the spec from this environment (rfc-editor.org and
   * datatracker.ietf.org are both blocked by egress policy) and servers vary —
   * `upsertEmail` falls back to asking rather than assuming it is present.
   */
  notCreated?: Record<string, { type: string; description: string; existingId?: string }>;
}

/**
 * JMAP Email/query response type.
 */
interface EmailQueryResponse {
  type: string;
  accountId: string;
  ids: string[];
  total: number;
  queryState?: string;
}

/**
 * JMAP Email/get response type.
 */
interface EmailGetResponse {
  type: string;
  accountId: string;
  list: Array<{
    id: string;
    mailboxIds: Record<string, boolean>;
    headers?: Record<string, string>;
    [key: string]: unknown;
  }>;
  notFound?: string[];
}

/**
 * Configuration for JMAP connection.
 */
export interface JmapTargetConfig {
  baseUrl: string;
  username: string;
  password: string;
  /** Optional well-known discovery path (default: /.well-known/jmap) */
  wellKnownPath?: string;
}

/**
 * Special-use role mapping from our internal type to JMAP roles.
 */
const SPECIAL_USE_ROLE_MAP: Record<
  string,
  "inbox" | "sent" | "drafts" | "archive" | "junk" | "trash" | undefined
> = {
  inbox: "inbox",
  sent: "sent",
  drafts: "drafts",
  archive: "archive",
  junk: "junk",
  trash: "trash",
  normal: undefined,
};

/**
 * JMAP session type from jmap-jam.
 */
interface JmapSession {
  accounts?: Record<string, {
    id?: string;
    name?: string;
    email?: string;
    isPrimary?: boolean;
  }>;
  primaryAccounts?: Record<string, string>;
  apiUrl?: string;
  uploadUrl?: string;
  /**
   * RFC 8620 §2 URI template for blob download, with `{accountId}`, `{blobId}`,
   * `{type}` and `{name}` variables. The PATH SHAPE is server-specific and
   * cannot be guessed — Stalwart's carries a trailing `/{name}` segment that a
   * hand-built `/download/{accountId}/{blobId}` omits, which 404s.
   */
  downloadUrl?: string;
}

/**
 * JMAP target writer implementation.
 */
export class JmapTargetWriter implements TargetWriter, TargetReindexer {
  private readonly config: JmapTargetConfig;
  private client: JamClient | null = null;
  private accountId: string | null = null;
  private apiUrl: string | null = null;
  private authHeader: string | null = null;
  /** The session's `downloadUrl` template, if it advertised one. */
  private downloadUrlTemplate: string | null = null;
  private connectPromise: Promise<void> | null = null;
  /**
   * Message-ID -> target email id for what the account already held, built once
   * and kept current as we write. See `targetKeys()`.
   *
   * Held as a PROMISE so concurrent items coalesce onto one enumeration instead
   * of racing to build it N times. `undefined` inside the promise means "could
   * not be built" — never "the account is empty".
   */
  private keySnapshot: Promise<Map<string, string> | undefined> | null = null;
  /**
   * The account's mailboxes, read once and kept current as we create. See
   * `allMailboxes()`; `null` means "not read yet", never "the account has none".
   */
  private mailboxes: Mailbox[] | null = null;

  constructor(config: JmapTargetConfig) {
    this.config = config;
  }

  /**
   * Lazily establish the JMAP session on first use (single-flight). The `TargetWriter`
   * interface has no `connect()`, and the sync path (`runShadowPass`/`runDomainSync`) never
   * calls the concrete `connect()` — so, like `ImapSource` which self-connects on every
   * `listFolders`/`listSince`, this writer must self-connect. Without it every write threw
   * "Not connected to JMAP server" in the real (non-test) path. Concurrent callers share one
   * in-flight connect; a failed connect is not cached, so the next call retries.
   */
  private async ensureConnected(): Promise<void> {
    if (this.accountId && this.client && this.apiUrl && this.authHeader) return;
    if (!this.connectPromise) {
      this.connectPromise = this.connect().catch((err) => {
        this.connectPromise = null;
        throw err;
      });
    }
    await this.connectPromise;
  }

  /**
   * Connect to the JMAP server and discover the session.
   */
  async connect(): Promise<void> {
    // Use basic auth - JMAP typically uses bearer tokens
    this.authHeader = `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}`;

    const sessionUrl = `${this.config.baseUrl}${this.config.wellKnownPath || "/.well-known/jmap"}`;

    // Load the session directly
    // `loadJmapSession`, NOT `JamClient.loadSession`. That helper never checks
    // `response.ok`, so a 401 carrying a JSON body resolves as a session with no
    // accounts — and the guard below then blames account resolution for what was
    // only ever a rejected credential. No data was ever at risk (the guard does
    // its job); the DIAGNOSIS was wrong, which costs the reader time exactly
    // when a connection is broken. See `jmap-session.ts`.
    const session = await loadJmapSession(sessionUrl, this.authHeader) as JmapSession;
    
    // Use the base URL + /jmap as the API URL
    // Stalwart's JMAP API is typically at /jmap endpoint
    this.apiUrl = this.config.baseUrl.endsWith('/')
      ? `${this.config.baseUrl}jmap`
      : `${this.config.baseUrl}/jmap`;

    // Keep the session's download template. Its PATH is server-specific and we
    // cannot invent it; its HOST is unreliable on Stalwart (same reason
    // uploadBlob ignores `uploadUrl`), so `blobDownloadUrl` below keeps the
    // path and re-bases it on the origin we know works.
    this.downloadUrlTemplate = typeof session.downloadUrl === 'string' ? session.downloadUrl : null;

    // CRITICAL: Resolve accountId by matching the configured target email against session accounts
    // NEVER take the first account blindly - this caused emails to be written to the wrong account
    let resolvedAccountId: string | null = null;
    
    if (session.accounts) {
      // Try to find the account that matches the configured username (full email address)
      for (const [accountId, accountInfo] of Object.entries(session.accounts)) {
        const accountEmail = accountInfo.email || accountInfo.name;
        
        // Match by exact email or by name if email is not available
        if (accountEmail === this.config.username || 
            (accountInfo.email === this.config.username) ||
            (accountInfo.name && this.config.username.includes(accountInfo.name + '@'))) {
          resolvedAccountId = accountId;
          break;
        }
      }
    }
    
    // If no match found, try primaryAccounts as fallback
    if (!resolvedAccountId && session.primaryAccounts?.['urn:ietf:params:jmap:mail']) {
      resolvedAccountId = session.primaryAccounts['urn:ietf:params:jmap:mail'];
    }
    
    // HARD FAIL if we couldn't resolve an accountId
    if (!resolvedAccountId) {
      throw new Error(
        `Failed to resolve accountId for target account '${this.config.username}'. ` +
        `JMAP session has ${session.accounts ? Object.keys(session.accounts).length : 0} accounts. ` +
        `This is a critical error - refusing to proceed without a valid accountId to prevent ` +
        `writing emails to the wrong account.`
      );
    }
    
    // Verify the resolved account matches expected target
    const resolvedAccountInfo = session.accounts?.[resolvedAccountId];
    if (resolvedAccountInfo) {
      const resolvedEmail = resolvedAccountInfo.email || resolvedAccountInfo.name;
      
      // Hard fail if the resolved account doesn't match the configured target
      if (resolvedEmail !== this.config.username && 
          !this.config.username.includes(resolvedAccountInfo.name + '@') &&
          resolvedAccountInfo.email !== this.config.username) {
        throw new Error(
          `Account mismatch: configured target is '${this.config.username}' but resolved account ` +
          `'${resolvedAccountId}' has email/name '${resolvedEmail}'. This is a critical safety check ` +
          `to prevent writing emails to the wrong account.`
        );
      }
    }
    
    this.accountId = resolvedAccountId;
    
    // Create the client with the session
    this.client = new JamClient({
      bearerToken: this.authHeader,
      sessionUrl,
    });
  }

  /**
   * `fetch`, but a target that answers "too many requests" gets waited out
   * instead of turning into a failed item.
   *
   * Every JMAP call here went straight to `fetch` with no throttle handling at
   * all. A ~500-message run at concurrency 8 found the consequence: Stalwart
   * answered 429 to blob uploads and to the `Email/query` existence lookup, and
   * because the lookup is deliberately not allowed to fall back to "not
   * present" (that would append a duplicate -- hard rule 1), eight messages
   * failed outright. A 429 is the server asking for a pause, not an error; the
   * only correct response is to pause.
   *
   * The waiting itself lives in `http-rate-limit.ts`, shared with the session
   * loader -- see that file for why a server's `Retry-After` is treated as an
   * upper bound on urgency rather than as a sleep instruction.
   */
  private async fetchWithRateLimitRetry(url: string, init: RequestInit): Promise<Response> {
    return fetchWithRateLimitRetry(url, init, 'jmap');
  }

  /**
   * Make a JMAP API request using the stored apiUrl.
   */
  private async apiRequest<T>(method: string, args: Record<string, unknown>): Promise<T> {
    if (!this.apiUrl || !this.authHeader) {
      throw new Error("Not connected to JMAP server");
    }

    const response = await this.fetchWithRateLimitRetry(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
        methodCalls: [[method, args, 'c1']],
      }),
    });

    if (!response.ok) {
      // Read as text first. A gateway, a proxy or a rate limiter answers with
      // HTML or plain text, and `response.json()` then threw a parse error that
      // said nothing about the status the server actually returned — the real
      // failure replaced by a misleading one (hard rule 9).
      const body = await response.text().catch(() => '');
      let detail = body.slice(0, 500);
      try {
        const parsed = JSON.parse(body) as { type?: string; detail?: string; description?: string };
        detail = `${parsed.type ?? 'unknown'} - ${parsed.description ?? parsed.detail ?? 'no description'}`;
      } catch {
        // Not JSON; the truncated body is the best description available.
      }
      throw new Error(`JMAP ${method} failed: HTTP ${response.status} - ${detail}`);
    }

    const result = await response.json() as { methodResponses?: Array<unknown[]> };
    const firstResponse = result.methodResponses?.[0];
    if (!firstResponse || !Array.isArray(firstResponse) || firstResponse.length < 2) {
      throw new Error('Invalid JMAP response format');
    }

    // A method-level error comes back as ["error", {type, description}, callId]
    // inside methodResponses, with HTTP 200 (RFC 8620 §3.6.2). Returning
    // `firstResponse[1]` blindly handed that error object back AS IF it were the
    // result — so an Email/query that the server rejected produced
    // `{ ids: undefined }`, listEntries yielded nothing, and verification read
    // the target as EMPTY. A silently empty target is reported as total data
    // loss, which is the worst possible way to fail (hard rule 9).
    if (firstResponse[0] === 'error') {
      const err = firstResponse[1] as { type?: string; description?: string };
      throw new Error(
        `JMAP ${method} failed: ${err?.type ?? 'unknown'}` +
          (err?.description ? ` - ${err.description}` : ''),
      );
    }

    return firstResponse[1] as T;
  }

  /**
   * Upload a blob (email message) to the JMAP server.
   */
  private async uploadBlob(accountId: string, blob: Blob): Promise<{ blobId: string }> {
    if (!this.apiUrl || !this.authHeader) {
      throw new Error("Not connected to JMAP server");
    }

    // Stalwart often returns an incorrect uploadUrl (e.g. https://localhost), so we
    // construct the upload endpoint from the resolved apiUrl instead. The session's
    // own uploadUrl is therefore never used — don't pay for a loadSession round-trip
    // per blob just to discard the result.
    const uploadUrl = `${this.apiUrl}/upload/${accountId}`;

    const response = await this.fetchWithRateLimitRetry(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'message/rfc822',
      },
      body: blob,
    });

    if (!response.ok) {
      const error = await response.text().catch(() => '');
      log.error(`[jmap-target] Blob upload failed: HTTP ${response.status}`, error);
      throw new Error(`Blob upload failed: HTTP ${response.status} - ${error.slice(0, 500)}`);
    }

    const result = await response.json() as { blobId: string };
    return result;
  }

  /**
   * Ensure a mailbox exists, creating it and any missing ancestors.
   * Returns the mailbox ID.
   *
   * **A ROLE is matched before a NAME, because a role is unique per account and
   * a name is not.** RFC 8621 §2 allows at most one mailbox per role, and
   * Stalwart enforces it: a source "Sent" written into an account that already
   * holds "Sent Items" with `role: "sent"` earned
   * `invalidProperties … "A mailbox with role 'sent' already exists."`, which
   * threw out of `ensureMailbox` and took the whole email domain down with it
   * (observed live, Soverin → Stalwart, after 2 messages). The name lookup
   * could never have found it — the roles carry the SAME meaning under
   * different words, and the words are the server's, sometimes localised.
   *
   * **But only for a folder that lands at the account ROOT.** A role is the
   * account's one Sent; a folder nested under a prefix is a folder that happens
   * to be called Sent, and asking for the role there is asking for the
   * collision above. See `targetSegments`.
   */
  async ensureMailbox(folder: MailFolder): Promise<string> {
    await this.ensureConnected();

    const segments = targetSegments(folder);
    const role = SPECIAL_USE_ROLE_MAP[folder.specialUse];

    // Walk the tree top-down, adopting what is there and creating what is not.
    // `parentId` stays null until the first level is settled, which is how a
    // root mailbox is expressed in JMAP.
    let parentId: string | null = null;
    let id = '';
    for (const [index, name] of segments.entries()) {
      const isLeaf = index === segments.length - 1;
      // The role belongs to a leaf sitting at the root, and to nothing else.
      const wanted = isLeaf && index === 0 ? role : undefined;
      id = await this.ensureOneLevel(name, parentId, wanted);
      parentId = id;
    }
    return id;
  }

  /**
   * One level of the tree: the mailbox called `name` under `parentId`, created
   * if it is not there.
   */
  private async ensureOneLevel(
    name: string,
    parentId: string | null,
    role: string | undefined,
  ): Promise<string> {
    const mailboxes = await this.allMailboxes();

    if (role) {
      const byRole = mailboxes.find((m) => m.role?.toLowerCase() === role.toLowerCase());
      if (byRole) return byRole.id;
    }
    const existing = matchChild(mailboxes, name, parentId, role);
    if (existing) return existing.id;

    return await this.createMailbox(name, parentId, role);
  }

  /**
   * Every mailbox in the account, read once per writer and kept current as we
   * create.
   *
   * `ids: null` rather than a `Mailbox/query` name filter, for the reason
   * `trashMailboxId` already gives: the filter is a CONTAINS match over a name
   * the server chooses and may localise, so it answers "Sent Items" for "Sent"
   * and nothing for "Verzonden". Reading them all is one round trip and the
   * only way to see `role` and `parentId` at all.
   *
   * Cached because `ensureMailbox` runs per folder and now walks a level at a
   * time, and the previous shape paid a query AND a get for each. A cache can
   * go stale against another client creating a mailbox underneath us; that
   * costs nothing, because `createMailbox` re-reads on either collision the
   * server can report.
   */
  private async allMailboxes(refresh = false): Promise<Mailbox[]> {
    if (!refresh && this.mailboxes) return this.mailboxes;
    const response = await this.apiRequest<MailboxGetResponse>('Mailbox/get', {
      accountId: this.accountId,
      ids: null,
    });
    const list = (response as { list?: Mailbox[] }).list ?? [];
    this.mailboxes = list;
    return list;
  }

  /**
   * Create one mailbox under `parentId`.
   *
   * `parentId` is sent explicitly, `null` included: omitting it entirely is not
   * the same request, and a server is entitled to read the absence as "no
   * opinion" rather than "at the root".
   */
  private async createMailbox(
    name: string,
    parentId: string | null,
    role?: string,
  ): Promise<string> {
    const mailboxSetResponse = await this.apiRequest<MailboxSetResponse>('Mailbox/set', {
      accountId: this.accountId!,
      create: {
        "0": {
          name,
          parentId,
          role,
          sortOrder: 0,
        },
      },
    });

    
    const mailboxResponse = mailboxSetResponse as {
      created?: Record<string, { id: string }>;
      notCreated?: Record<string, { type: string; description: string }>;
    };
    // `created["0"].id` — the SERVER's id, keyed by the creation id we sent.
    // This read was `Object.keys(created)[0]`, which is the creation id: every
    // mailbox this function made came back as the literal string "0", and the
    // very next thing the caller does with it is `mailboxIds: { [id]: true }`
    // on an Email/import. Adopted mailboxes were fine (they return a real id),
    // which is why it survived: nothing had successfully CREATED one on a live
    // server. `Email/import` four hundred lines below already reads its own
    // `created["0"]?.id` correctly (RFC 8620 §5.3).
    const createdId = (mailboxResponse.created ?? {})["0"]?.id;
    
    if (!createdId) {
      // Check if it already exists
      const notCreated = mailboxResponse.notCreated || {};
      if (Object.keys(notCreated).length > 0) {
        const errors = Object.values(notCreated);
        if (errors.length > 0 && errors[0]?.type === 'alreadyExists') {
          // Extract existingId from the description - format: "existingId: \"a\""
          const match = errors[0].description.match(/existingId:\s*"([^"]+)"/);
          if (match && match[1]) {
            return match[1];
          }
          // What used to stand here was a second regex, `/'([a-z0-9]+)'/i`,
          // described as "try to find the ID in the description". It finds the
          // first quoted word, which in `Mailbox 'Sent' already exists` is the
          // NAME — returned as a mailbox id, and then written into
          // `mailboxIds` by the caller. Guessing an identifier out of a
          // sentence a server is free to reword is not a fallback; the
          // re-read below asks the server instead, and answers with an id it
          // actually gave us.
        }
        // The mailbox we asked for exists under another NAME holding the role
        // we asked for, or under this same parent already. The cache we decided
        // from is a pass old — or another client created it — so re-read and
        // adopt. Two servers word this differently and neither names an id, so
        // the recovery is a fresh read rather than a parse of the sentence.
        const conflict = errors.find(
          (e) => e?.type === 'invalidProperties' || e?.type === 'alreadyExists',
        );
        if (conflict) {
          const fresh = await this.allMailboxes(true);
          const adopted =
            (role
              ? fresh.find((m) => m.role?.toLowerCase() === role.toLowerCase())
              : undefined) ?? matchChild(fresh, name, parentId, role);
          if (adopted) {
            log.info(
              `[jmap-target] adopting existing mailbox ${JSON.stringify(adopted.name)}` +
                (adopted.role ? ` (role ${adopted.role})` : '') +
                ` rather than creating ${JSON.stringify(name)}: ${conflict.description}`,
            );
            return adopted.id;
          }
        }
      }
      log.error('[jmap-target] Mailbox not created, notCreated:', JSON.stringify(mailboxResponse.notCreated));
      throw new Error("Failed to create mailbox: " + JSON.stringify(mailboxResponse.notCreated));
    }

    // Keep the cache current so the next folder in this pass does not re-read,
    // and so the next LEVEL of this same path can find the parent we just made.
    // A server that assigned something other than what we asked for is
    // corrected by the refresh a collision forces.
    if (this.mailboxes) {
      this.mailboxes = [
        ...this.mailboxes,
        { id: createdId, name, parentId, ...(role ? { role } : {}) },
      ];
    }

    return createdId;
  }

  /**
   * What the target account already holds, keyed the way we key it.
   *
   * `upsertEmail` asked the server "is this message already here?" with an
   * `Email/query` PER MESSAGE. That is the same round trip the DAV writers
   * stopped paying, and mail is where it hurts most: the query is a header
   * search across the whole account, so its cost grows with the account. Run
   * #36 measured 119 ms an item at 202 items; run #38 measured 219 ms at 506.
   * The work per item was going UP as the migration progressed.
   *
   * `listEntries` already enumerates exactly this, 100 at a time, and is the
   * same call the ledger reindex and §20 verification use — so reusing it (as
   * opposed to a second enumeration written alongside) is what guarantees the
   * snapshot's keys are the keys everything else compares against.
   *
   * Account-wide, with no mailbox filter, because that is precisely what the
   * per-item probe did: the natural key is unique per MAPPING, not per folder,
   * so a message already filed anywhere on the target must be adopted rather
   * than written a second time (ADR-0020 — even a wiped ledger cannot produce
   * duplicates).
   *
   * Returns `undefined`, not an empty map, when the account cannot be
   * enumerated. The difference is the whole ballgame: an empty map reads as
   * "the target holds nothing", which would make us rewrite everything. The
   * caller falls back to the per-item probe instead — slower, still correct.
   */
  private async targetKeys(): Promise<Map<string, string> | undefined> {
    this.keySnapshot ??= this.buildKeySnapshot();
    return this.keySnapshot;
  }

  private async buildKeySnapshot(): Promise<Map<string, string> | undefined> {
    const keys = new Map<string, string>();
    try {
      for await (const entry of this.listEntries()) {
        keys.set(entry.naturalKey, entry.targetId);
        if (keys.size > SNAPSHOT_MAX_ENTRIES) {
          log.warn(
            `[jmap] target holds more than ${SNAPSHOT_MAX_ENTRIES} messages; ` +
              `checking each message individually instead of enumerating the account`,
          );
          return undefined;
        }
      }
      return keys;
    } catch (err) {
      // Say why. A silent fallback here looks identical to a fast target and
      // would hide a real problem behind nothing but a slower run (hard rule 9).
      const message = err instanceof Error ? err.message : String(err);
      log.warn(
        `[jmap] could not enumerate the target account (${message}); ` +
          `falling back to a per-message existence check`,
      );
      return undefined;
    }
  }

  /**
   * Check if an email with the given Message-ID already exists in the mailbox.
   */
  async findByNaturalKey(
    mailboxId: string,
    naturalKey: string,
  ): Promise<string | undefined> {
    await this.ensureConnected();

    try {
      // Query emails by Message-ID header
      // JMAP header filter format: [headerName, headerValue]
      //
      // No `properties`: RFC 8621 §4.4 does not define it for Email/query (it
      // belongs to Email/get), and RFC 8620 §3.2 says a server MUST answer an
      // unknown argument with `invalidArguments`. This is the same defect that
      // was fixed in `listEntries` and left here — Stalwart tolerates it, a
      // stricter server would reject every existence check in the migration.
      const response = await this.apiRequest<EmailQueryResponse>('Email/query', {
        accountId: this.accountId,
        filter: {
          header: ["Message-ID", naturalKey],
        },
      });


      const ids = (response as { ids?: string[] }).ids || [];
      const found = ids.length > 0 ? ids[0] : undefined;
      return found;
    } catch (err) {
      // A failed lookup is NOT "not found". upsertEmail reads `undefined` as
      // "this message isn't on the target yet" and APPENDs — so swallowing a
      // transient Email/query failure here silently creates a duplicate, which
      // breaks the one property the whole product rests on (hard rule 1;
      // hard rule 9 forbids turning failures into empty results).
      //
      // Failing loudly is safe and resumable: the pass aborts, the folder keeps
      // its old cursor, and the next pass re-scans from the same point.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Email/query lookup failed for Message-ID ${naturalKey} in mailbox ${mailboxId}; ` +
          `refusing to treat this as "not present" because that would append a duplicate. ` +
          `Cause: ${message}`,
        { cause: err },
      );
    }
  }

  /**
   * List all entries from the target, streaming them as an async iterable.
   * 
   * This method is used for reindexing - it enumerates all existing emails
   * on the target server and yields their natural keys (Message-ID) along
   * with target IDs. This allows rebuilding the ledger from the target's state.
   * 
   * @param mailboxId - Optional mailbox ID to filter entries. If not provided,
   *                    lists all emails across all mailboxes.
   * @returns Async iterable of TargetEntry objects
   */
  async *listEntries(mailboxId?: string): AsyncIterable<TargetEntry> {
    await this.ensureConnected();

    const LIMIT = 100; // Number of emails to fetch per page
    let position = 0;


    while (true) {
      // Build the query arguments
      // No `properties` here: RFC 8621 §4.4 defines Email/query's arguments as
      // accountId/filter/sort/position/anchor/anchorOffset/limit/calculateTotal
      // /collapseThreads — `properties` belongs to Email/get. A spec-following
      // server MUST answer an unknown argument with `invalidArguments`
      // (RFC 8620 §3.2), which this code then treated as a result: `ids` came
      // back undefined, the loop broke immediately, and the target listed as
      // empty. Email/query returns ids; the properties are fetched below.
      const queryArgs: Record<string, unknown> = {
        accountId: this.accountId,
        limit: LIMIT,
        position: position,
      };

      // Add mailbox filter if provided
      if (mailboxId) {
        queryArgs.filter = {
          inMailbox: mailboxId,
        };
      }


      const response = await this.apiRequest<EmailQueryResponse>('Email/query', queryArgs);
      const ids = (response as { ids?: string[] }).ids || [];


      if (ids.length === 0) {
        break;
      }

      // Fetch details for each email to get the Message-ID header
      // JMAP Email/get can fetch multiple emails at once
      const getResponse = await this.apiRequest<EmailGetResponse>('Email/get', {
        accountId: this.accountId,
        // `size` comes free with the metadata fetch (RFC 8621 §4.1.1) and is
        // what lets verification report totalBytesTarget as a real measurement
        // instead of null. Still no body: enumeration stays metadata-only.
        ids: ids,
        properties: ["id", "mailboxIds", "headers", "size"],
      });

      const emails = (getResponse as { list?: EmailGetResponse['list'] }).list || [];

      for (const email of emails) {
        // Extract Message-ID from headers
        // JMAP returns headers as an array of {name, value} objects
        let messageId = '';
        if (Array.isArray(email.headers)) {
          const messageIdHeader = email.headers.find(h => h.name.toLowerCase() === 'message-id');
          if (messageIdHeader) {
            messageId = messageIdHeader.value.trim();
          }
        } else if (email.headers) {
          // Fallback: try record format (name: value)
          messageId = (email.headers as Record<string, string>)['Message-ID'] || (email.headers as Record<string, string>)['message-id'] || '';
        }
        
        // If no Message-ID, skip this email (it won't have a natural key)
        if (!messageId) {
          continue;
        }

        // Determine the mailbox ID
        // If mailboxId was provided, use it; otherwise infer from the email's mailboxIds
        const entryMailboxId = mailboxId || Object.keys(email.mailboxIds || {})[0] || '';

        if (!entryMailboxId) {
          continue;
        }

        // Yield the entry. No contentHash: a headers-only fetch cannot produce
        // one. `contentHashFor` below reads the blob for sampled items only.
        const size = (email as { size?: unknown }).size;
        yield {
          naturalKey: messageId,
          targetId: email.id,
          mailboxId: entryMailboxId,
          ...(typeof size === 'number' ? { sizeBytes: size } : {}),
        };

      }

      // Paginate on the ID COUNT alone. A short page is the end; a full page
      // means ask again, and a query past the end returns none (handled above).
      //
      // This used to also break on `totalFetched >= total`, where `total` came
      // from the Email/query response. Two things were wrong with that, and
      // together they capped every mail target at exactly one page:
      //
      //  1. RFC 8621 §4.4 computes `total` only when `calculateTotal: true` is
      //     requested, and it defaults to false. We never asked, so `total` was
      //     absent and `?? 0` made it 0 — so `totalFetched >= 0` was true after
      //     the very first page and the loop always stopped at 100 items. Seen
      //     live at SEED_COUNT=150: `targetCount: 100` against `sourceCount:
      //     150`, reporting 50 perfectly healthy messages as MISSING and
      //     failing the cutover gate on a complete migration.
      //  2. `totalFetched` counts entries YIELDED, not ids seen — messages with
      //     no Message-ID or no mailbox are skipped — so even with a real
      //     `total` it compares two different quantities.
      if (ids.length < LIMIT) {
        break;
      }

      // Move to next page
      position += LIMIT;
    }
  }

  /**
   * Hash a sampled message as it is stored on the target (§20 checksum leg).
   *
   * Mail is the easy case: a JMAP blob is the message as submitted, so hashing
   * it with the same `contentHash` the sync path used on the source is a
   * like-for-like comparison of the actual bytes.
   *
   * This used to add that "CalDAV/CardDAV deliberately do not implement this —
   * servers re-serialize iCalendar and vCard, so every item would look
   * corrupt". CORRECTED 2026-08-05: that WAS the position (#143), and it was
   * reversed, because the consequence was that §20's content leg silently
   * stopped running for two of four domains — 9 of 10 samples came back
   * `checksumUnavailable` on the first real run. Both DAV writers implement it
   * now, against a CANONICAL fingerprint (`dav-canonical.ts`) rather than the
   * returned bytes, precisely so re-serialization does not read as corruption.
   * See `dav-reindexers.unit.test.ts`, "DAV writers hash content canonically".
   *
   * Called only for sampled items, so the two extra round trips are bounded by
   * the sample size, not the mailbox size. Returns undefined when the blob
   * cannot be read: the sample is then counted as unavailable, never as a
   * mismatch — absence of evidence is not evidence of corruption.
   */
  async contentHashFor(entry: TargetEntry): Promise<string | undefined> {
    await this.ensureConnected();
    if (!this.apiUrl || !this.authHeader || !this.accountId) return undefined;

    const getResponse = await this.apiRequest<EmailGetResponse>('Email/get', {
      accountId: this.accountId,
      ids: [entry.targetId],
      properties: ['id', 'blobId'],
    });
    const email = ((getResponse as { list?: Array<{ blobId?: string }> }).list ?? [])[0];
    const blobId = email?.blobId;
    if (!blobId) {
      log.warn(`[jmap] no blobId for ${entry.targetId}; cannot content-verify it`);
      return undefined;
    }

    const url = this.blobDownloadUrl(blobId);
    const response = await this.fetchWithRateLimitRetry(url, {
      headers: { Authorization: this.authHeader },
    });
    if (!response.ok) {
      // Log it. Returning undefined silently made every mail sample come back
      // `checksumUnavailable` with no indication why, so §20's content leg was
      // reported as "not exercised" run after run and nothing said the download
      // was failing (hard rule 9).
      log.warn(`[jmap] blob download failed: GET ${url} -> ${response.status}`);
      return undefined;
    }

    return contentHash(new Uint8Array(await response.arrayBuffer()));
  }

  /**
   * Where to GET a blob.
   *
   * Prefers the session's RFC 8620 §2 `downloadUrl` template, because the path
   * shape is the server's to define and cannot be guessed: Stalwart's ends in a
   * `/{name}` segment, so the hand-built `/download/{accountId}/{blobId}` this
   * used to send was a 404 every time — which is why all ten mail samples in
   * the first full verification run came back `checksumUnavailable`.
   *
   * The template's HOST is not trusted. Stalwart advertises unreachable hosts
   * (e.g. `https://localhost`) in its session object, which is why `uploadBlob`
   * ignores `uploadUrl` and builds from the resolved `apiUrl`. So take the
   * template's path and query, and re-base them on the origin already proven to
   * work. Falls back to the old shape when no template is advertised.
   */
  private blobDownloadUrl(blobId: string): string {
    const origin = new URL(this.apiUrl!).origin;

    if (this.downloadUrlTemplate) {
      const filled = this.downloadUrlTemplate
        .replace(/{accountId}/g, encodeURIComponent(this.accountId!))
        .replace(/{blobId}/g, encodeURIComponent(blobId))
        // `name` is a download filename hint and `type` the requested content
        // type; both are required by the template but neither affects the bytes.
        .replace(/{name}/g, 'message.eml')
        .replace(/{type}/g, encodeURIComponent('application/octet-stream'));
      // Resolve against the origin: an absolute template keeps its own path and
      // gets the trusted host, a relative one is rooted correctly.
      const resolved = new URL(filled, origin);
      resolved.protocol = new URL(origin).protocol;
      resolved.host = new URL(origin).host;
      return resolved.toString();
    }

    return `${this.apiUrl}/download/${encodeURIComponent(this.accountId!)}/${encodeURIComponent(blobId)}`;
  }

  /**
   * Idempotently write a message into the target mailbox.
   * 
   * Uses the Email/import method (RFC 8621 §4.4.2) which is the recommended
   * approach for importing raw RFC822 messages into JMAP servers like Stalwart.
   * 
   * Process:
   * 1. Upload the raw RFC822 message as a blob
   * 2. Use Email/import to parse and create the email from the blob
   * 
   * This avoids the complexity of manually constructing EmailBodyPart objects
   * and ensures proper parsing of the raw message by the server.
   * 
   * @see https://www.rfc-editor.org/rfc/rfc8621.html#section-4.4.2
   */
  async upsertEmail(
    mailboxId: string,
    raw: RawMessage,
    keywords: ReadonlyArray<MailKeyword>,
  ): Promise<UpsertResult> {
    await this.ensureConnected();

    // Extract Message-ID from raw RFC822
    const messageId = this.extractMessageIdFromRfc822(raw.rfc822);

    // Check if email already exists — against the account snapshot when we
    // could build one, otherwise by asking about this message specifically.
    const snapshot = messageId ? await this.targetKeys() : undefined;
    if (messageId) {
      const existingId = snapshot
        ? snapshot.get(messageId)
        : await this.findByNaturalKey(mailboxId, messageId);
      if (existingId) {
        // Already on the target under our natural key: not written, ADOPTED.
        // Distinct from a ledger fast-path skip — see UpsertResult.adopted.
        return { targetId: existingId, created: false, adopted: true };
      }
    }

    // Parse headers from raw message to get receivedAt date
    const headers = this.parseRfc822Headers(raw.rfc822);

    // Step 1: Upload the raw RFC822 message as a blob
    // The Blob/upload endpoint expects BodyInit (Blob, File, ArrayBuffer, string, etc.)
    // Note: blobFileName is computed but not used - uploadBlob doesn't require a filename
    
    // Convert Uint8Array to Blob for upload
    // Pass Uint8Array directly - it's a valid BlobPart
    const arrayBuffer = raw.rfc822.buffer.slice(
      raw.rfc822.byteOffset,
      raw.rfc822.byteOffset + raw.rfc822.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: 'message/rfc822' });
    
    const blobUploadResponse = await this.uploadBlob(
      this.accountId!,
      blob
    );

    if (!blobUploadResponse.blobId) {
      throw new Error("Failed to upload blob: no blobId returned");
    }

    const blobId = blobUploadResponse.blobId;

    
    // Parse the date from headers and convert to ISO 8601 UTC format for JMAP
    let receivedAt: string;
    if (headers.date) {
      const parsedDate = new Date(headers.date);
      receivedAt = !isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString();
    } else {
      receivedAt = new Date().toISOString();
    }
    
    // Step 2: Import the email from the blob using Email/import
    const importRequest = {
      accountId: this.accountId,
      emails: {
        "0": {
          blobId,
          mailboxIds: { [mailboxId]: true },
          keywords: this.mapKeywords(keywords),
          receivedAt,
        },
      },
    };
    const importResponse = await this.apiRequest<EmailImportResponse>('Email/import', importRequest);


    // Check if import was successful
    if (importResponse.notCreated && Object.keys(importResponse.notCreated).length > 0) {
      const error = importResponse.notCreated["0"];

      // `alreadyExists` means the server already holds this message and
      // declined to make a second copy. That is not a failure — it is the
      // outcome we wanted, reached by the server rather than by our check.
      //
      // It matters more now than it did: the snapshot above is taken once per
      // pass, so the window between "not in the snapshot" and the import is a
      // whole pass wide rather than milliseconds. This is the JMAP counterpart
      // of `If-None-Match: *` on the DAV writes — the server, not our snapshot,
      // is what actually guarantees hard rule 2 here.
      //
      // Adopting requires an ID we can stand behind. Prefer the SetError's own
      // `existingId`; failing that, ask. Never invent one — a fabricated
      // targetId in the ledger is worse than a failed item.
      if (error?.type === 'alreadyExists') {
        const existingId =
          error.existingId ??
          (messageId ? await this.findByNaturalKey(mailboxId, messageId) : undefined);
        if (existingId) {
          if (messageId) snapshot?.set(messageId, existingId);
          return { targetId: existingId, created: false, adopted: true };
        }
      }

      throw new Error(
        `Failed to import email: ${error?.type} - ${error?.description || 'Unknown error'}`
      );
    }

    if (!importResponse.created || Object.keys(importResponse.created).length === 0) {
      throw new Error("Failed to create email: no created ID in response");
    }

    // `importResponse.created` is keyed by OUR OWN local creation id (the "0"
    // in the `emails: { "0": {...} }` request above) — that key is never a
    // real email id, only the server-assigned `.id` on the VALUE is. Reading
    // `Object.keys(...)[0]` returned the literal string "0" as `targetId` for
    // every mail item ever migrated, silently: nothing downstream fed that id
    // back into a further JMAP call until `removeItem()` (ADR-0024) did,
    // which sent Stalwart `Email/set` updates for an id named "0" and got
    // `notFound` back — the self-host e2e's Apply-Deletion Gate is what
    // finally surfaced this, five rounds of a differently-wrong fix in.
    const createdId = importResponse.created["0"]?.id;
    if (!createdId) {
      throw new Error('Failed to create email: created response is missing the server-assigned id');
    }
    // Keep the snapshot true, so a repeat within the same pass costs nothing
    // and cannot be written twice.
    if (messageId) snapshot?.set(messageId, createdId);
    return { targetId: createdId, created: true };
  }

  /**
   * Map our keywords to JMAP keywords.
   */
  private mapKeywords(
    keywords: ReadonlyArray<MailKeyword>,
  ): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const keyword of keywords) {
      result[kindToJmapKeyword(keyword)] = true;
    }
    return result;
  }

  /**
   * Extract Message-ID from raw RFC822 message.
   */
  private extractMessageIdFromRfc822(rfc822: Uint8Array): string | null {
    const headers = this.parseRfc822Headers(rfc822);
    const messageId = headers["message-id"] || null;
    return messageId;
  }

  /**
   * Parse RFC822 headers from raw message.
   */
  private parseRfc822Headers(rfc822: Uint8Array): Record<string, string> {
    const headers: Record<string, string> = {};
    const headerText = new TextDecoder().decode(rfc822);
    
    // Find the end of headers (blank line separates headers from body)
    // Handle both \r\n\r\n and \n\n line endings
    let headerEnd = headerText.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      headerEnd = headerText.indexOf("\n\n");
    }
    
    const headerSection = headerEnd > 0 ? headerText.slice(0, headerEnd) : headerText;

    // Split by either \r\n or \n
    const lines = headerSection.split(/\r?\n/);
    
    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).toLowerCase().trim();
        const value = line.slice(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    return headers;
  }

  /**
   * Remove a message this writer wrote (implements `TargetRemover`).
   *
   * The only destructive operation this writer has, reached solely through an
   * explicit owner decision in core's `applyDeletion` — see that function for the
   * seven gates in front of it.
   *
   * MOVES TO THE TRASH MAILBOX where the account has one, which is what makes the
   * outcome `binned`: the owner can still get the message back for as long as their
   * server keeps it, and the target genuinely stops showing it. Only when there is
   * no `trash`-role mailbox does this destroy the message outright. That ordering is
   * the point — a recoverable removal and an unrecoverable one are different
   * promises, and the caller is told which it got.
   *
   * `expectedTargetVersion` is accepted for interface symmetry and not used: JMAP
   * gives no per-message ETag, so `upsertEmail` records none and there is nothing to
   * compare. Mail is also the domain where it matters least — a message is immutable
   * apart from its flags and mailbox membership, so "the owner edited our copy" is
   * not a state this domain really reaches.
   */
  async removeItem(targetId: string): Promise<RemovalResult> {
    await this.ensureConnected();

    const trashId = await this.trashMailboxId();
    if (trashId) {
      // `mailboxIds` PATCHED per-key (`mailboxIds/<id>`: true|null) rather than
      // assigned as one whole-map value.
      //
      // A NOTE ON WHY, because the history here is misleading. Earlier versions
      // of this comment blamed the server: several e2e runs showed `Email/set`
      // answering `updated` while the message stayed in its original mailbox,
      // and that was read as "this server does not honour whole-value
      // replacement". It was not. Every one of those runs was sending the
      // literal id `"0"` — see the created-id bug fixed in `upsertEmail` above —
      // so the server was simply being asked about a message that does not
      // exist. Whole-value assignment (RFC 8620 §5.3) would very likely work
      // fine now.
      //
      // The patch form is kept anyway, on its own merits rather than as a
      // workaround: it states each mailbox membership explicitly, so a message
      // filed under several mailboxes has every one of them cleared by name
      // instead of relying on one replacement to sweep them away. That is
      // easier to verify against the read-back below, and it is the form
      // (RFC 8621 §4.3) mail clients use to move messages between mailboxes.
      const current = await this.apiRequest<EmailGetResponse>('Email/get', {
        accountId: this.accountId,
        ids: [targetId],
        properties: ['mailboxIds'],
      });
      const existing = current.list?.[0]?.mailboxIds ?? {};

      const patch: Record<string, boolean | null> = { [`mailboxIds/${trashId}`]: true };
      for (const mailboxId of Object.keys(existing)) {
        if (mailboxId !== trashId) patch[`mailboxIds/${mailboxId}`] = null;
      }

      interface EmailSetUpdateResponse {
        notUpdated?: Record<string, { type: string; description?: string }>;
      }
      const response = await this.apiRequest<EmailSetUpdateResponse>('Email/set', {
        accountId: this.accountId,
        update: { [targetId]: patch },
      });
      // The response is HTTP 200 either way (RFC 8620 §3.6.2) — a per-item
      // failure comes back in `notUpdated`, not as a transport error, and the
      // previous code never looked. That let a message the server refused to
      // move stay sitting in its original mailbox while `apply` reported
      // success and the ledger recorded it as tombstoned (hard rule 9: never
      // mask errors).
      const failure = response.notUpdated?.[targetId];
      if (failure) {
        throw new Error(
          `JMAP Email/set could not move ${targetId} to the trash mailbox: ${failure.type}` +
            (failure.description ? ` - ${failure.description}` : ''),
        );
      }

      // READ BACK rather than trust the response at face value: fetch the
      // mailboxIds the server now actually reports, and refuse unless they are
      // EXACTLY the trash mailbox alone.
      //
      // Worth keeping even though the `"0"` id bug that motivated it is fixed.
      // `apply` is the one operation in this product that destroys something,
      // and the ledger tombstones the row on its say-so — so "the server said
      // it worked" is not a good enough basis for that write. This check is
      // also what finally produced a usable diagnosis: it turns a silent false
      // success into an error naming the mailboxes still attached (hard rule 9).
      const after = await this.apiRequest<EmailGetResponse>('Email/get', {
        accountId: this.accountId,
        ids: [targetId],
        properties: ['mailboxIds'],
      });
      const resultingMailboxIds = after.list?.[0]?.mailboxIds ?? {};
      const resultingIds = Object.keys(resultingMailboxIds).filter((id) => resultingMailboxIds[id]);
      if (resultingIds.length !== 1 || resultingIds[0] !== trashId) {
        throw new Error(
          `JMAP Email/set reported success moving ${targetId} to the trash mailbox (${trashId}), ` +
            `but Email/get now reports mailboxIds ${JSON.stringify(resultingMailboxIds)} — the move ` +
            'did not actually take effect the way the server claimed.',
        );
      }
      return { kind: 'binned' };
    }

    interface EmailSetDestroyResponse {
      notDestroyed?: Record<string, { type: string; description?: string }>;
    }
    const response = await this.apiRequest<EmailSetDestroyResponse>('Email/set', {
      accountId: this.accountId,
      destroy: [targetId],
    });
    const failure = response.notDestroyed?.[targetId];
    if (failure) {
      throw new Error(
        `JMAP Email/set could not destroy ${targetId}: ${failure.type}` +
          (failure.description ? ` - ${failure.description}` : ''),
      );
    }
    return { kind: 'deleted' };
  }

  /**
   * The account's trash mailbox, by RFC 8621 role rather than by name.
   *
   * Read FRESH every time (`refresh`), unlike `ensureMailbox`'s use of the same
   * helper. This is the destructive path: a cached list naming a trash mailbox
   * the owner has since deleted would send a removal somewhere that no longer
   * exists, and a cached list MISSING one the owner has since created would
   * destroy a message outright that should only have been binned.
   */
  private async trashMailboxId(): Promise<string | undefined> {
    const mailboxes = await this.allMailboxes(true);
    return mailboxes.find((m) => m.role?.toLowerCase() === 'trash')?.id;
  }

  /**
   * Close the connection.
   */
  async disconnect(): Promise<void> {
    this.client = null;
    this.accountId = null;
  }
}

/**
 * The target tree position a source folder maps to, top level first.
 *
 * **`path` before `name`, which is the whole of the merge-or-subfolder fix.**
 * `reconcile.ts` composes the mapping's `targetFolderPrefix` into `path` only
 * (`applyTargetFolderPrefix`), leaving `name` as the source's own leaf. This
 * function read `name || path`, so the prefix was dropped on the floor: with
 * `targetFolderPrefix: "Gmail"`, a source "Sent" arrived as
 * `{path: "Gmail/Sent", name: "Sent"}` and landed in the account's ROOT Sent,
 * while "Projects" was created at the root with no `Gmail` above it. The wizard
 * offered a choice (owner decision 2026-08-16) that this connector silently
 * ignored, while the IMAP and WebDAV targets — which read `path` first —
 * honoured it. That asymmetry is the bug; the order is the fix.
 *
 * **Split on `/`, and only on `/`.** JMAP has no path property at all (RFC 8621
 * expresses hierarchy as `parentId`), so the mapping from our path strings to a
 * tree is ours to define, and `/` is the only separator we actually control:
 * `parseTargetFolderPrefix` enforces it for the prefix and rejects a backslash.
 * A SOURCE path uses the source server's own delimiter, which no part of this
 * codebase records — `MailFolder` has no delimiter field and `ImapFlowSource`
 * passes `box.path` through verbatim. So a Gmail or Dovecot-with-`/` source
 * nests properly, and a Dovecot-with-`.` source yields one level whose name
 * contains dots: what the source called it, which is truthful and no worse than
 * the flattening this replaces.
 *
 * That flattening was its own bug, incidentally: `name || path` made a source
 * `Archive/2024` into a ROOT mailbox called `2024`, so two folders of the same
 * leaf name under different parents collided into one.
 */
function targetSegments(folder: MailFolder): ReadonlyArray<string> {
  const raw = folder.path || folder.name || '';
  const segments = raw
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (segments.length === 0) {
    // Never silently invent one (hard rule 9): a folder with no name is a
    // source bug, and guessing here would write mail somewhere arbitrary.
    throw new Error(
      `Cannot place a mailbox for a folder with no path or name: ${JSON.stringify(folder)}`,
    );
  }
  return segments;
}

/**
 * The mailbox called `name` directly under `parentId`, or undefined.
 *
 * Name matching is EXACT (case-insensitively) and scoped to one parent, rather
 * than the account-wide search this replaced. Both halves matter: JMAP's own
 * `Mailbox/query` name filter is a CONTAINS match, which answers "Sent Items"
 * for a query of "Sent"; and an account-wide match would adopt the root "Sent"
 * for a `Gmail/Sent` that is supposed to be a different mailbox.
 *
 * `parentId` is compared with `?? null` on both sides because servers differ on
 * whether a root mailbox reports `parentId: null` or omits the property, and
 * those are the same fact.
 *
 * A name match on a mailbox holding a DIFFERENT role is refused: a source
 * "Archive" must not land in a mailbox that is the account's Sent and merely
 * happens to be called Archive. A ROLELESS source folder named like a role
 * mailbox is a different case and IS adopted — `ImapFlowSource` reports
 * `specialUse` from the server's LIST attributes only, so a server advertising
 * no SPECIAL-USE gives us 'normal' for its own "Sent", and refusing that would
 * create a second one beside it.
 */
function matchChild(
  mailboxes: readonly Mailbox[],
  name: string,
  parentId: string | null,
  role?: string,
): Mailbox | undefined {
  const wanted = name.toLowerCase();
  return mailboxes.find(
    (m) =>
      (m.parentId ?? null) === parentId &&
      m.name?.toLowerCase() === wanted &&
      !(m.role && role && m.role.toLowerCase() !== role.toLowerCase()),
  );
}

/**
 * Convert our MailKeyword format to JMAP keyword format.
 */
function kindToJmapKeyword(keyword: MailKeyword): string {
  // JMAP uses $seen, $flagged, etc. directly
  return keyword;
}
