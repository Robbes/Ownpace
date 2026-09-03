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

/**
 * WHAT THE DEMO MAPPING ACTUALLY SELECTS, and why it is asserted here.
 *
 * `seed-demo-dav-content.sh` puts calendar, task, contact and file data into
 * the demo Nextcloud source, and the managed gate's whole task assertion rests
 * on the demo mapping SELECTING the task domain — a domain a mapping does not
 * select is never synced, so the gate would seed a VTODO-only collection and
 * then prove nothing about it.
 *
 * Nothing connects those two files but this test. The seeder is bash and the
 * tenant list is TypeScript; neither imports the other, and the compiler has
 * no opinion about whether they agree. Dropping 'task' from the tenant row
 * left every other test in the repository green, which is how this one came to
 * be written (0113 T7, found by breaking).
 */
describe("the demo tenants select the domains their backends are seeded with", () => {
  const seedManaged = readFileSync(
    join(REPO_ROOT, "apps/api/src/scripts/seed-managed.ts"),
    "utf-8",
  );
  const davSeeder = readFileSync(
    join(REPO_ROOT, "deploy/compose/seed-demo-dav-content.sh"),
    "utf-8",
  );

  it("tenant B selects every DAV domain the source is seeded with, tasks included", () => {
    expect(seedManaged).toContain("domains: ['calendar', 'contact', 'file', 'task'],");
  });

  it("and the DAV seeder really seeds each of them — neither side is asserted alone", () => {
    // The control. `toContain` on the tenant row above would pass just as well
    // against a seeder that writes three domains, so the pair is checked: what
    // the mapping selects, and what the source is given.
    expect(davSeeder).toContain("openmig-demo-event-");
    expect(davSeeder).toContain("openmig-demo-task-");
    expect(davSeeder).toContain("openmig-demo-contact-");
    expect(davSeeder).toContain("openmig-demo-file-");
  });

  it("the task fixture is a VTODO, not an event that happens to be named one", () => {
    // A task list seeded with VEVENTs would be carried by the calendar face
    // and the gate would go green having tested nothing new.
    expect(davSeeder).toContain("BEGIN:VTODO");
  });
});

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
