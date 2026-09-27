// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * CRC-32 (IEEE 802.3), because the runtime may not have one.
 *
 * `node:zlib` grew a `crc32` export recently enough that depending on it broke
 * a deploy: the Trigger.dev task build refused every job file with
 *
 *     The requested module 'node:zlib' does not provide an export named 'crc32'
 *
 * — thirteen of them, on a stack whose own `package.json` asks for Node 24 and
 * gets it locally. The task images are built by the Trigger.dev CLI, which is
 * pinned to the SDK's version, on the base image of the runtime
 * `apps/worker/trigger.config.ts` names. It named none, so the CLI took its
 * default, which in 4.5.16 is Node 21. The config now names `node-24`
 * (workplan 0146 T6), and a version guard holds it to the images' major. This
 * module stays anyway: a Node that lacks an export is not a thing to discover
 * on a deploy, the archive reader is the only caller, it needs twenty lines of
 * table lookup, and a checksum is the last place to want a platform
 * dependency.
 *
 * IT IS NOT A REIMPLEMENTATION OF SOMETHING SUBTLE. CRC-32 is a fixed
 * polynomial (`0xEDB88320`, reflected) and a fixed convention, and zip has
 * used it unchanged since 1989. `a-checksum-the-runtime-did-not-have`
 * asserts this against `node:zlib`'s own answer on every Node that HAS one, so
 * the equivalence is measured rather than asserted from the spec.
 */

/** The reflected polynomial, one entry per byte. Built once. */
const TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * The CRC-32 of `data`, continuing from `value`.
 *
 * Signature and semantics are `zlib.crc32`'s, deliberately: the callers stream
 * a member through in chunks and carry the running value between them, and a
 * drop-in means the call sites say nothing about where the function came from.
 */
export function crc32(data: Uint8Array | string, value = 0): number {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  let crc = (value ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
