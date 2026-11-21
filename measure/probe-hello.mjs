// MEASUREMENT ONLY, on a branch that is never merged.
//
// The probe branch's own TLS hello (realNetwork().certificate) and its issuer
// check (fromCaddyLocalCa), against the dashboard's TLS front as main builds
// and configures it, on loopback: what the probe decides when a forward from
// the front reaches the dashboard on a listed port. The front here is a
// container on the runner, with a documentation address or a made-up name.
//
// Usage: node measure/probe-hello.mjs <checkout of the probe branch> <port>

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const probe = await import(pathToFileURL(resolve(process.argv[2], 'scripts/exposure-probe.mjs')).href);
const port = Number(process.argv[3]);
let answer = { untried: 'not asked' };
for (let i = 0; i < 30; i++) {
  answer = await probe.realNetwork({ tlsMs: 2000 }).certificate('127.0.0.1', port);
  if (answer.kind === 'tls') break;
  await new Promise((wait) => setTimeout(wait, 1000));
}
const caddy = answer.kind === 'tls' && probe.fromCaddyLocalCa(answer.issuer);
console.log(`the probe branch's hello on the dashboard's front: ${JSON.stringify(answer)}; Caddy's local CA, so it fails: ${caddy}`);
if (!caddy) process.exitCode = 1;
