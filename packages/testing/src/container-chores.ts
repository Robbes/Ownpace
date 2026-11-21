// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Two chores of the integration tier's set-up, each with the one failure it
 * may let go and nothing else (workplan 0006 §K, ERR-1 of 2026-11-21).
 *
 * - `appendToTestLog`: a container's log lines go to `test-logs/`, from a
 *   stream's event handlers, where a throw would end the whole run. A write
 *   that fails is not thrown; it is said, once per file, so a log that stops
 *   short says why instead of looking like a container that fell silent.
 * - `removeContainerOrGone`: the forced removal of a Stalwart container that
 *   would not go. One already gone is what was wanted. Any other failure is
 *   thrown: the next Stalwart would share its data volume, and RocksDB's lock
 *   allows one (docs/stalwart-integration-fix.md).
 */

import { appendFileSync } from 'node:fs';

const said = new Set<string>();

/** Append `text` to the log file at `path`; a failure is said once per file, never thrown. */
export function appendToTestLog(path: string, text: string, append: typeof appendFileSync = appendFileSync): void {
  try {
    append(path, text);
  } catch (err) {
    if (said.has(path)) return;
    said.add(path);
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[TestLogs] Could not write ${path}, so it stops short here: ${msg}`);
  }
}

/** What `execFile` rejects with: the error, and what the command said on stderr. */
type ExecFailure = Error & { stderr?: string | Buffer };

/** `docker rm -f <id>`; a container already gone is let go, anything else thrown. */
export async function removeContainerOrGone(
  id: string,
  exec: (file: string, args: string[]) => Promise<unknown>,
): Promise<void> {
  try {
    await exec('docker', ['rm', '-f', id]);
  } catch (err) {
    const stderr = String((err as ExecFailure).stderr ?? '');
    if (/No such container/i.test(stderr)) return;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `docker rm -f ${id} failed, and the container may still hold the Stalwart data volume: ${stderr.trim() || msg}`,
      { cause: err },
    );
  }
}
