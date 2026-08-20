// Copyright 2026 The Ownpace authors (Apache-2.0)
import { naturalKeyHash, type RunReindex } from '@openmig/shared';

/**
 * Reindex / adopt existing target items into the ledger — workplan 0001, T9 (ADR-0020).
 *
 * Rebuilds idempotency state FROM THE TARGET so a fresh install (empty ledger) does not re-copy
 * what is already there. Non-destructive: reads the target, writes only the ledger.
 */
export const reindexFromTarget: RunReindex = async (deps) => {
  const { tenantId, mappingId, reindexer, ledger } = deps;
  // 'email' by default for the callers that predate the domain field; the
  // reindexer handed in decides what is actually being read either way.
  const domain = deps.domain ?? 'email';
  let scanned = 0;
  let adopted = 0;
  let alreadyKnown = 0;

  for await (const entry of reindexer.listEntries()) {
    scanned++;
    const nkh = naturalKeyHash(entry.naturalKey);
    const known = await ledger.find(tenantId, mappingId, domain, nkh);
    if (known) {
      alreadyKnown++;
      continue;
    }
    await ledger.recordIfAbsent({
      tenantId,
      itemType: domain,
      mappingId,
      naturalKeyHash: nkh,
      contentHash: entry.contentHash ?? '',
      targetId: entry.targetId,
      createdAt: new Date().toISOString(),
    });
    adopted++;
  }

  return { scanned, adopted, alreadyKnown };
};
