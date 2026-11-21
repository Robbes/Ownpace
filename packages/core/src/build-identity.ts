// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * What build is this? (release-readiness pass, 2026-08-10.) Every support
 * conversation starts with that question, and until the /version endpoints
 * nothing running in a container could answer it — the only build stamp was
 * the Windows launcher's startup log line.
 *
 * Resolution order: explicit env (the packaged appliance's launcher and the
 * container images stamp these) beats the monorepo root package.json, which
 * is present in every launch shape (checkout and image both run from the
 * workspace tree).
 */
import { readFileSync } from 'node:fs';

export interface BuildIdentity {
  version: string;
  commit: string;
}

/**
 * The root package.json's version, read once per process (PERF-1, workplan
 * 0006 L). `GET /version` answers from here on every request, on both
 * editions, and a synchronous file read there holds up every other request
 * for its duration. The file does not change under a running process, so the
 * first answer is the answer; a file that cannot be read answers `0.0.0`, as
 * it always did, and is not tried again.
 */
let packageVersion: string | undefined;

const packageJsonVersion = (): string => {
  if (packageVersion === undefined) {
    try {
      packageVersion =
        (JSON.parse(
          readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8'),
        ) as { version?: string }).version ?? '0.0.0';
    } catch {
      packageVersion = '0.0.0';
    }
  }
  return packageVersion;
};

export const buildIdentity = (): BuildIdentity => ({
  // The env is still read on every call: the launcher and the images stamp it.
  version: process.env.OPENMIG_VERSION || packageJsonVersion(),
  commit: process.env.OPENMIG_COMMIT ?? 'unknown',
});
