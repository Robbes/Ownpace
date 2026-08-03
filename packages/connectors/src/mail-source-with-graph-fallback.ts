// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The runtime IMAP→Graph mail fallback (workplan 0023 T3 — the "runtime
 * detection" half of ADR-0006's promise).
 *
 * Wraps the IMAP source and, when its FIRST folder listing fails with an
 * authentication-class error, probes the Graph mail source; if Graph answers,
 * the run continues on Graph — loudly. The detection is deliberately
 * self-verifying rather than string-parsing Microsoft's error prose: O365
 * answers a disabled-IMAP mailbox and a wrong credential with near-identical
 * "AUTHENTICATE failed" responses, so instead of guessing which one happened,
 * we prove whether the alternative transport works. A false positive on the
 * classifier costs exactly one Graph probe.
 *
 * Deliberate boundaries:
 * - The fallback triggers ONLY at `listFolders()` — the first source call of
 *   every pass and of discovery. `listSince`/`fetch` never switch mid-flight:
 *   folders listed by one transport are meaningless to the other, and a
 *   mixed-transport pass would be incoherent.
 * - The switch is per-CONNECTOR-INSTANCE (in practice: per run). Nothing
 *   rewrites the mapping config — the config is the owner's (§11.2); the log
 *   line tells them how to make the switch permanent.
 * - Idempotency across the switch is carried by the natural key (the same
 *   RFC 5322 Message-ID on both transports), so no duplicates. Two honest
 *   caveats, logged when the fallback engages: folder PATHS differ between
 *   transports ("INBOX" vs "Inbox"), so a mid-migration switch re-baselines
 *   per-folder cursors (a full, still-idempotent re-listing) and may surface
 *   move reports; and the ledger records Graph-listed items under Graph's
 *   folder paths.
 * - A non-auth failure (network, TLS, throttling) propagates untouched — the
 *   fallback is for "this mailbox will never answer IMAP", not for retries.
 * - If the Graph probe ALSO fails, the thrown error carries BOTH failures
 *   (rule 9): the operator sees the whole picture, not just the second half.
 */

import type { SourceConnector, MailFolder, MailItem, RawMessage, SyncCursor } from '@openmig/shared';
import { log } from '@openmig/shared';

/**
 * Authentication-class IMAP failures, incl. the shapes O365 answers for a
 * mailbox whose IMAP protocol is disabled. Broader than ImapSource's private
 * token-refresh classifier ON PURPOSE — that one gates a credential refresh
 * (a false positive burns a token round-trip on every retry), this one gates
 * a single Graph probe.
 */
export function isImapAuthFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('authentication failed') ||
    message.includes('authenticate failed') ||
    message.includes('login failed') ||
    message.includes('no supported authentication method') ||
    message.includes('unauthorized') ||
    message.includes('xoauth2') ||
    message.includes('invalid token') ||
    message.includes('token expired') ||
    message.includes('401')
  );
}

export class MailSourceWithGraphFallback implements SourceConnector {
  private active: SourceConnector;
  private fellBack = false;

  /**
   * @param imap the primary transport
   * @param buildGraph LAZY constructor for the fallback — not called unless
   *   the IMAP listing fails with an auth-class error, so a mapping whose
   *   IMAP works never pays for (or validates) the Graph credentials.
   */
  constructor(
    private readonly imap: SourceConnector,
    private readonly buildGraph: () => SourceConnector,
  ) {
    this.active = imap;
  }

  /** True once a run has switched to the Graph transport. Exposed for tests/telemetry. */
  get usingGraphFallback(): boolean {
    return this.fellBack;
  }

  async listFolders(): Promise<ReadonlyArray<MailFolder>> {
    if (this.fellBack) return this.active.listFolders();

    try {
      return await this.imap.listFolders();
    } catch (imapError) {
      if (!isImapAuthFailure(imapError)) throw imapError;

      let graph: SourceConnector;
      let folders: ReadonlyArray<MailFolder>;
      try {
        graph = this.buildGraph();
        folders = await graph.listFolders();
      } catch (graphError) {
        // Both transports failed — report both, lead with the primary. The
        // probe's error rides along as `cause`; the IMAP failure is the
        // headline because it is the transport the mapping asked for.
        throw new Error(
          `mail: IMAP authentication failed AND the Graph fallback probe failed. ` +
            `IMAP: ${messageOf(imapError)} | Graph: ${messageOf(graphError)}`,
          { cause: graphError },
        );
      }

      log.warn(
        'mail: IMAP authentication failed but Microsoft Graph answered — continuing this run over Graph ' +
          '(ADR-0006 fallback). If IMAP is disabled for this mailbox, make the switch permanent by setting ' +
          "the mail source type to 'graph-mail'. Note: folder paths differ between transports, so a " +
          'mid-migration switch re-baselines per-folder cursors (a full, still-idempotent re-listing) ' +
          'and may surface move reports.',
      );
      this.active = graph;
      this.fellBack = true;
      return folders;
    }
  }

  listSince(
    folder: MailFolder,
    cursor?: SyncCursor,
  ): ReturnType<SourceConnector['listSince']> {
    return this.active.listSince(folder, cursor);
  }

  fetch(item: MailItem): Promise<RawMessage> {
    return this.active.fetch(item);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
