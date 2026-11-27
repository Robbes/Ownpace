#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A KNOWN-BAD SERVER, FOR A SCANNER'S PROOF ONLY (workplan 0178 T7).
 *
 * Nothing ships this, and nothing in apps/ or packages/ imports it: it lives
 * under `scripts/fixtures/`, which no image copies a use of and no workspace
 * package depends on. `scripts/schemathesis-report.mjs` starts it on the
 * runner's loopback and runs Schemathesis against it, with `openapi.yaml`
 * beside it, BEFORE it scans the real API. Each operation carries one fault on
 * purpose, and the scan must flag both, or it is not reading what it should
 * and the run is red:
 *
 *   GET /answers-without-a-token  declared secured, answers without one
 *                                 (Schemathesis's `ignored_auth`)
 *   GET /throws                   answers 500 to every request
 *                                 (`not_a_server_error`)
 *
 * The real API is the subject of the scan; this is the scan's known-bad case.
 *
 *   node scripts/fixtures/schemathesis-known-bad/server.mjs <port>
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? '');
if (!Number.isInteger(port) || port <= 0) {
  console.error('usage: server.mjs <port>');
  process.exit(2);
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (req.method === 'GET' && path === '/answers-without-a-token') {
    // THE FAULT: the description says bearerAuth, and the token is never read.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'GET' && path === '/throws') {
    // THE FAULT: a crash on input the description allows.
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('a known-bad fixture fails here on purpose');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

// The runner's loopback only, never another interface.
server.listen(port, '127.0.0.1', () => {
  console.log(`known-bad fixture listening on 127.0.0.1:${port}`);
});
