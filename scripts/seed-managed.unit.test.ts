// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The seed, and the password the volume never heard of.
 *
 * Postgres reads POSTGRES_PASSWORD once, when initdb creates the cluster.
 * Change it afterwards and compose keeps handing the container a value the
 * volume has never heard of — and the seed, running on the host against the
 * published port, is usually the first thing to find out. What it said was
 *
 *   Seed failed: password authentication failed for user "openmigrate"
 *
 * which reads like a typo in .env rather than two halves that have drifted,
 * and names neither of them as the one to move. E2E (managed) #120 died there,
 * after the same shape had already cost #117 and #118 on the demo Nextcloud.
 *
 * The script is COPIED into a temp tree so SCRIPT_DIR, and with it ENV_FILE,
 * resolve inside the fixture: a test that wrote deploy/compose/.env would be a
 * test that could destroy a developer's stack configuration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  existsSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REAL_SCRIPT = join(REPO_ROOT, "deploy/compose/seed-managed.sh");

const SECRET = "stub-postgres-password";

/**
 * PROBE_MODE decides what the credential pre-check sees. Only `auth` is a
 * verdict; `other` stands for every failure that is not about credentials, and
 * the script must not read those as drift.
 */
const DOCKER_STUB = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "$ARGDIR/calls.log"
case "$*" in
  *"port postgres"*) echo '0.0.0.0:55432'; exit 0 ;;
esac
exit 0
`;

/**
 * SEED_MODE is what the real seed came back with. `auth` is the drift; `other`
 * stands for every failure that is not about credentials and must not be read
 * as one. SEED_RC proves the script exits with the SEED's status rather than a
 * flat 1 of its own.
 */
const PNPM_STUB = `#!/usr/bin/env bash
printf 'pnpm %s\\n' "$*" >> "$ARGDIR/calls.log"
case "$SEED_MODE" in
  ok) echo 'seeded tenant A, tenant B'; exit 0 ;;
  auth) echo 'Seed failed: password authentication failed for user "openmigrate"'; exit "\${SEED_RC:-1}" ;;
  other) echo 'Seed failed: connect ECONNREFUSED 127.0.0.1:55432'; exit "\${SEED_RC:-1}" ;;
esac
exit 0
`;

let dir: string;
let script: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seed-managed-"));
  const compose = join(dir, "deploy", "compose");
  mkdirSync(compose, { recursive: true });

  script = join(compose, "seed-managed.sh");
  copyFileSync(REAL_SCRIPT, script);
  chmodSync(script, 0o755);

  writeFileSync(
    join(compose, ".env"),
    [
      "POSTGRES_USER=openmigrate",
      `POSTGRES_PASSWORD=${SECRET}`,
      "POSTGRES_DB=openmigrate",
      "JWT_SECRET=stub-jwt-secret",
      "SECRET_ENCRYPTION_KEY=stub-encryption-key",
      "",
    ].join("\n"),
  );

  const bin = join(dir, "bin");
  mkdirSync(bin);
  for (const [name, body] of [
    ["docker", DOCKER_STUB],
    ["pnpm", PNPM_STUB],
  ] as const) {
    const p = join(bin, name);
    writeFileSync(p, body);
    chmodSync(p, 0o755);
  }
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(seedMode: "ok" | "auth" | "other", seedRc = 1) {
  return spawnSync("bash", [script], {
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      ARGDIR: dir,
      SEED_MODE: seedMode,
      SEED_RC: String(seedRc),
    },
  });
}

const calls = () =>
  readFileSync(join(dir, "calls.log"), "utf-8").split("\n").filter(Boolean);

describe("what the seed's own failure is read as", () => {
  it("names the one command that ends the drift", () => {
    const res = run("auth");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("is not the password the role");
    expect(res.stderr).toContain("ALTER ROLE openmigrate PASSWORD :'pw';");
    // Nothing swallowed: the seed's own words are still printed.
    expect(res.stdout).toContain("password authentication failed");
  });

  it("does not read a non-credential failure as drift", () => {
    const res = run("other");
    expect(res.stdout).toContain("ECONNREFUSED");
    expect(res.stderr).not.toContain("ALTER ROLE");
  });

  it("exits with the seed's status, not one of its own", () => {
    // A wrapper that flattened every failure to 1 would hide which failure it
    // was from anything reading the exit code.
    expect(run("other", 7).status).toBe(7);
    expect(run("auth", 3).status).toBe(3);
  });

  it("says nothing extra when the seed succeeds", () => {
    const res = run("ok");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("seeded tenant A");
    expect(res.stdout).toContain("expire in 7 days");
    expect(res.stderr).not.toContain("ALTER ROLE");
  });

  it("never asks Postgres a question the trust line would answer for it", () => {
    run("ok");
    // A `docker exec … psql -h 127.0.0.1` probe passes with any password at
    // all — see scripts/the-check-postgres-never-made.unit.test.ts. This
    // script must not grow one.
    expect(calls().some((l) => l.includes("psql"))).toBe(false);
  });
});
