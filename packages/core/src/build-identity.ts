// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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

export const buildIdentity = (): BuildIdentity => {
  let version = process.env.OPENMIG_VERSION ?? '';
  if (!version) {
    try {
      version =
        (JSON.parse(
          readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8'),
        ) as { version?: string }).version ?? '0.0.0';
    } catch {
      version = '0.0.0';
    }
  }
  return { version, commit: process.env.OPENMIG_COMMIT ?? 'unknown' };
};
