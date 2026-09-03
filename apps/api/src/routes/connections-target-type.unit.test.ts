// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CONNECTIONS DOOR SAYS WHICH TARGET TYPE IT STORES (2026-09-03).
 *
 * `targetConnectionConfig` branches on `targetType` to store the writer's
 * shape — `imap-dav` with user and tls, `jmap` with its baseUrl, `soverin`
 * with its mail face. The Connections page's add door called it with the
 * fields alone, so every target added there was stored without a type, and
 * the owner's first migration to reuse such a row met "Unsupported target
 * type: undefined" at discovery. The wizard's own door always passed it.
 *
 * Pinned by reading the source: the door is a database-bound route a unit
 * test cannot mount, and what matters is exactly this one argument.
 * `mailTargetConfigFromConnection` repairs rows stored before the fix at
 * load time (its own tests); this guard keeps new rows from needing it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'connections.ts'), 'utf8');

describe('POST /api/connections, a target', () => {
  it('builds the stored config WITH the picked type, as the wizard door does', () => {
    expect(source).toContain(
      'targetConnectionConfig({ targetType: type as TargetKind, targetConfig: half } as never)',
    );
    // The old call, the one that dropped the kind: gone.
    expect(source).not.toContain('targetConnectionConfig({ targetConfig: half } as never)');
  });
});
