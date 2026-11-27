// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for the Schemathesis report, so its guard can import it.
 *
 * `.mjs` like the other reports here: `schemathesis.yml` runs it with
 * `node scripts/schemathesis-report.mjs`, with no type stripping.
 */

import type { SpawnSyncReturns } from 'node:child_process';

export declare const IMAGE: RegExp;
export declare const API_DESCRIPTION: string;
export declare const NODE_DOCKERFILE: string;
export declare const POSTGRES_DOCKERFILE: string;
export declare const CHECKS: ReadonlyArray<string>;
export declare const BLOCKS_LATER: ReadonlyArray<string>;
export declare const WITHHELD: ReadonlyArray<string>;
export declare const CODES: Readonly<Record<string, string>>;

export interface Fault {
  readonly check: string;
  readonly operation: string;
}
export declare const FIXTURE: { readonly dir: string; readonly faults: ReadonlyArray<Fault> };

export declare const MAX_EXAMPLES: number;
export declare const PHASES: string;
export declare const MIN_OPERATIONS: number;
export declare const API_PORT: number;
export declare const FIXTURE_PORT: number;
export declare const LOOPBACK: string;
export declare const CONTAINERS: { readonly db: string; readonly api: string; readonly fixture: string };
export declare const MEMBERS: ReadonlyArray<{ readonly sub: string; readonly email: string }>;
export declare const PULL_DELAYS: ReadonlyArray<number>;
export declare const READY_POLLS: number;
export declare const CONFIG: string;
export declare const SIGNED_IN_AT: string;
export declare const JOBS_ROLE_SQL: string;
export declare const INSTALL_THE_QUEUES: string;

export declare function fromOf(text: string, file: string, stage?: string | null): string;
export declare function stackImages(read: (file: string) => string): { readonly node: string; readonly postgres: string };

export interface Secrets {
  readonly dbPassword: string;
  readonly appPassword: string;
  readonly jwtSecret: string;
  readonly encryptionKey: string;
  readonly jobsPassword: string;
}
export declare function freshSecrets(random?: (n: number) => Buffer): Secrets;

export declare function scanArgs(
  image: string,
  opts: { root: string; out: string; description: string; port: number; report: string; seed?: string | null; uid?: string },
): string[];

export interface Failure {
  readonly code: string;
  readonly check: string | null;
  readonly title: string;
  readonly count: number;
  readonly operations: ReadonlyArray<string>;
}
export interface Reading {
  readonly stopped?: undefined;
  readonly version: string;
  readonly seed: string;
  readonly tested: number;
  readonly failures: ReadonlyArray<Failure>;
  readonly warnings: unknown;
}
export type Run = Reading | { readonly stopped: string };

export declare function readRun(path: string): Run;
export declare function readReport(report: unknown, seed?: string | null): Run;
export declare function flagged(reading: Reading, check: string): string[];
export declare function unflagged(reading: Reading, faults?: ReadonlyArray<Fault>): Fault[];

export interface Verdict {
  readonly code: 0 | 1;
  readonly lines: string[];
  readonly markdown: string;
}
export declare function report(opts: {
  image?: string;
  event?: string;
  stopped?: string | null;
  proof?: Run | null;
  scan?: Run | null;
}): Verdict;

export declare function signToken(root: string, secret: string, member: { sub: string; email: string }): string;

export type Docker = (args: string[], opts?: { env?: NodeJS.ProcessEnv; input?: string }) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr' | 'error' | 'signal'>;

export declare function run(opts?: {
  root?: string;
  env?: NodeJS.ProcessEnv;
  docker?: Docker;
  wait?: (ms: number) => Promise<unknown>;
  mask?: (value: string) => void;
  read?: (file: string) => string;
  out?: string;
  uid?: string;
}): Promise<Verdict>;
