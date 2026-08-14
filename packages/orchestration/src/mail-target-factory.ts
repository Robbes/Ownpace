// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * One mail target construction, two ways in (workplan 0041 T3).
 *
 * The last of the three pairs, and the least symmetric: `buildTargetWriter`
 * (self-host) is roughly twice the length of `buildTargetWriterFromCredentials`
 * (managed). The workplan said to read it before assuming it was the same kind
 * of duplicate as the other two, and that was right — most of the difference is
 * real work the managed path does not do, not a copy.
 *
 * WHERE THE LENGTH GOES. Self-host resolves a password by branching on the
 * mapping's declared auth kind (`basic`/`bearer` for JMAP, `login`/`xoauth2`
 * for IMAP/DAV), then refuses naming the exact environment variable that was
 * empty. Managed reads one of a few credential keys and refuses naming the
 * credential store. Neither belongs to the other, for the same reason the graph
 * validation did not collapse in #389: telling a managed operator to check an
 * env var that has no effect there is worse than the duplication it removes.
 *
 * WHAT IS ACTUALLY THE SAME is what happens once a password exists — the config
 * object and the writer constructed from it, in both cases identical down to the
 * field order. That is what lives here.
 *
 * The TLS default is the reason this is worth doing at all. It was written twice
 * for the target (and twice more for the source, until #390), and it encodes an
 * asymmetry that must not drift between editions: being wrong one way costs a
 * connection error, being wrong the other way puts a password on the wire.
 */

import type { TargetWriter } from '@openmig/shared';
import {
  JmapTargetWriter,
  ImapFlowDavMailTarget,
  type ImapDavTargetConfig,
} from '@openmig/connectors';

/** Where the JMAP target is, with no trace of whether a file or a row said so. */
export interface JmapTargetEndpoint {
  readonly baseUrl: string;
  readonly user: string;
}

/**
 * Build the JMAP target writer from an endpoint and an already-resolved password.
 *
 * The password is passed in rather than resolved here: each edition finds it
 * differently and refuses differently, and both refusals name something only
 * that edition has.
 */
export function buildJmapTargetFrom(
  endpoint: JmapTargetEndpoint,
  password: string,
): TargetWriter {
  return new JmapTargetWriter({
    baseUrl: endpoint.baseUrl,
    username: endpoint.user,
    password,
  });
}

/** Where the IMAP/DAV target is, with no trace of whether a file or a row said so. */
export interface ImapDavTargetEndpoint {
  readonly host: string;
  readonly port: number;
  readonly tls?: boolean;
  readonly tlsVerify?: boolean;
  readonly user: string;
}

/**
 * Build the IMAP/DAV target writer from an endpoint and an already-resolved
 * password (or access token — the connector treats them the same on this path).
 */
export function buildImapDavTargetFrom(
  endpoint: ImapDavTargetEndpoint,
  password: string,
): TargetWriter {
  const imapConfig: ImapDavTargetConfig = {
    host: endpoint.host,
    port: endpoint.port,
    // Same rule as the source; see ImapTlsSetting in packages/shared/src/config.ts.
    // TLS unless the mapping says otherwise — being wrong this way costs a
    // connection error, being wrong the other way puts a password on the wire.
    tls: endpoint.tls ?? true,
    // Certificate verification rides beside the tls flag, same default, same
    // asymmetry argument. Undefined here lets the connector's own `?? true` be
    // the single place the default lives.
    rejectUnauthorized: endpoint.tlsVerify,
    username: endpoint.user,
    password,
  };

  // CUT OVER TO `imapflow` on 2026-08-06 (workplan 0032 T3) — the WRITE path,
  // and the half that can lose data. Rests on
  // `imap-target-parity.integration.test.ts`, which drove both writers through
  // the same script against a real Stalwart and compared the outcomes:
  // ensureMailbox, every upsert's created/adopted/targetId shape, a SECOND pass,
  // findByNaturalKey, listEntries (by COUNT, because a writer can report
  // `adopted` and have appended anyway) and every content hash against the bytes
  // that went in.
  return new ImapFlowDavMailTarget(imapConfig);
}
