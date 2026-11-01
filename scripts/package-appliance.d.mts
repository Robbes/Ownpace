// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for `package-appliance.mjs`.
 *
 * The packager is JavaScript on purpose — it is the thing that BUILDS the
 * TypeScript, so it cannot depend on the build having happened. Its unit test
 * and `a-runtime-only-its-own-host-vouched-for` import helpers out of it, and
 * without this the import is an implicit `any` that silently stops checking
 * the very assertions the tests exist to make.
 *
 * Only the exports the tests consume are declared. The rest of the module is a
 * script, not an API.
 */

/**
 * The Node version the Windows payload ships, as `v<x.y.z>`, read from a
 * Dockerfile's `FROM node:<x.y.z>-…` line. Throws when there is no such line.
 */
export function nodeRuntimeVersion(dockerfileText: string): string;

/** Look up a file's expected SHA-256 in a SHASUMS-format listing. */
export function shaFor(shasumsText: string, remotePath: string): string | null;

/** Throw unless `bytes` hashes to `expected`. `what` names the artefact. */
export function verifySha256(bytes: Uint8Array, expected: string, what: string): void;

/** Each platform `--with-node` takes: its path under a release on nodejs.org, and its name in the payload. */
export const NODE_RUNTIMES: Readonly<Record<string, { remote: string; local: string }>>;

/** The committed SHA-256 of each runtime, by Node version (`v<x.y.z>`) and platform. */
export const NODE_RUNTIME_SHA256: Readonly<Record<string, Readonly<Record<string, string>>>>;

/** The committed SHA-256 for one runtime. Throws when none is committed, or it is not 64 lowercase hex. */
export function pinnedNodeSha256(
  version: string,
  platform: string,
  pins?: Readonly<Record<string, Readonly<Record<string, string>>>>,
): string;

/** The Node.js release keyring committed in this repository. */
export const NODE_RELEASE_KEYRING: string;

/** Where that keyring comes from upstream, and its git blob id there. */
export const NODE_RELEASE_KEYS: { readonly repo: string; readonly commit: string; readonly path: string; readonly blob: string };

/**
 * Verify a detached signature over a `SHASUMS256.txt` with `gpgv` and a
 * keyring; returns the signer's primary key fingerprint, or throws. A key
 * that expired after it signed is good; one that expired before, or was
 * revoked, is refused.
 */
export function verifyNodeReleaseSignature(
  shasums: Uint8Array,
  signature: Uint8Array,
  options?: { keyring?: string; gpgv?: string },
): string;

/** The directory holding the committed, signed `SHASUMS256.txt` and the release keyring. */
export const NODE_RELEASE_DIR: string;

/** What the tests may swap out of the signed-pin check and the download. */
export interface NodeRuntimeCheckOptions {
  pins?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  dir?: string;
  keyring?: string;
  verifySignature?: (shasums: Uint8Array, signature: Uint8Array, options: { keyring: string }) => string;
}

/**
 * Check that the committed, signed `SHASUMS256.txt` is the list of `version`
 * and gives the committed sum for `platform`; returns the signer's fingerprint.
 */
export function signedPinFor(version: string, platform: string, options?: NodeRuntimeCheckOptions): string;

/**
 * Fetch one runtime and return its bytes once the committed sum, the committed
 * signed `SHASUMS256.txt` and the bytes agree; throws otherwise.
 */
export function fetchVerifiedNodeRuntime(
  nodeVersion: string,
  platform: string,
  options?: NodeRuntimeCheckOptions & { fetchImpl?: typeof fetch },
): Promise<{ bytes: Buffer; sha256: string; signer: string }>;
