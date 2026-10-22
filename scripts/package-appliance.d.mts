// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Types for `package-appliance.mjs`.
 *
 * The packager is JavaScript on purpose — it is the thing that BUILDS the
 * TypeScript, so it cannot depend on the build having happened. Its unit test
 * imports three pure helpers out of it, and without this the import is an
 * implicit `any` that silently stops checking the very assertions the test
 * exists to make.
 *
 * Only the three exports the test consumes are declared. The rest of the module
 * is a script, not an API.
 */

/**
 * The Node version the Windows payload ships, as `v<x.y.z>`, read from a
 * Dockerfile's `FROM node:<x.y.z>-…` line. Throws when there is no such line.
 */
export function nodeRuntimeVersion(dockerfileText: string): string;

/** Look up a file's expected SHA-256 in a SHASUMS-format listing. */
export function shaFor(shasumsText: string, remotePath: string): string | undefined;

/** Throw unless `bytes` hashes to `expected`. `what` names the artefact. */
export function verifySha256(bytes: Uint8Array, expected: string, what: string): void;
