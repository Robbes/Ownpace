// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Nextcloud readiness check, and the run it can poison after itself.
 *
 * Nextcloud's brute-force protection counts failed logins per source IP and
 * keeps them for twelve hours. E2E (managed) #117 died on 401 — the password
 * in .env was no longer the one inside the volume — and in dying it banked ten
 * failed attempts against the runner's address. #118 then ran with the
 * password repaired and every container healthy, and died anyway: 429, on
 * #117's attempts. One bad run had cost the next twelve hours.
 *
 * The fix is an allow-list for the private ranges this stack talks over, and
 * the two things that make it work are ORDERING, which no grep can check:
 *
 *   - it must come AFTER the installer finishes, because unlike
 *     trusted_domains (a file) this writes to the appconfig TABLE; and
 *   - it must come BEFORE the first authenticated request, or the request it
 *     exists to protect has already been counted.
 *
 * So docker, curl and sleep are stubbed onto PATH and the script is RUN. The
 * stubs are not the thing under test — the order of the calls it makes is,
 * along with what it says when the readiness poll never succeeds.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO_ROOT, "deploy/selfhost/setup-nextcloud-users.sh");

/**
 * Every stub appends to ONE log, so the interleaving of docker and curl calls
 * survives — which is the whole point, and is exactly what two separate arg
 * files would have thrown away.
 */
const DOCKER_STUB = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "$ARGDIR/calls.log"
case "$*" in
  *"occ status"*) echo '{"installed":true}' ;;
  *status.php*)   echo 200 ;;
esac
exit 0
`;

/**
 * The readiness poll reads a status code off stdout (real curl's
 * \`-o /dev/null -w '%{http_code}'\`). PROPFIND_CODES is the sequence to hand
 * back, one per call; the last value repeats, so '429' means "throttled and
 * it never lets up" without listing it ten times.
 */
const CURL_STUB = `#!/usr/bin/env bash
printf 'curl %s\\n' "$*" >> "$ARGDIR/calls.log"
case "$*" in
  *"OCS-APIRequest"*) echo '<statuscode>100</statuscode>'; exit 0 ;;
  *"Depth: 1"*) exit 0 ;;
esac
n=$(cat "$ARGDIR/propfind.n" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$ARGDIR/propfind.n"
read -r -a codes <<< "$PROPFIND_CODES"
i=$((n - 1))
[ "$i" -ge "\${#codes[@]}" ] && i=$(( \${#codes[@]} - 1 ))
echo "\${codes[$i]}"
exit 0
`;

// The 429 branch deliberately backs off 15s a time. Ten of those is two and a
// half minutes, which is a correct script and an intolerable test.
const SLEEP_STUB = `#!/usr/bin/env bash
exit 0
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nc-users-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  for (const [name, body] of [
    ["docker", DOCKER_STUB],
    ["curl", CURL_STUB],
    ["sleep", SLEEP_STUB],
  ] as const) {
    const p = join(bin, name);
    writeFileSync(p, body);
    chmodSync(p, 0o755);
  }
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(propfindCodes: string) {
  return spawnSync("bash", [SCRIPT], {
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      ARGDIR: dir,
      PROPFIND_CODES: propfindCodes,
      NEXTCLOUD_CONTAINER: "ownpace-nextcloud",
      NEXTCLOUD_HOST_PORT: "8083",
      NEXTCLOUD_ADMIN_PASSWORD: "stub-admin-pw",
      NEXTCLOUD_SOURCE_PASSWORD: "stub-source-pw",
      NEXTCLOUD_TARGET_PASSWORD: "stub-target-pw",
    },
  });
}

function calls(): string[] {
  return readFileSync(join(dir, "calls.log"), "utf-8")
    .split("\n")
    .filter(Boolean);
}

describe("the brute-force allow-list", () => {
  it("is in force before the script makes its first request over HTTP", () => {
    const res = run("207");
    expect(res.status).toBe(0);

    const log = calls();
    const allowed = log.findIndex((l) =>
      l.includes("config:app:set bruteForce whitelist_0"),
    );
    const firstHttp = log.findIndex((l) => l.startsWith("curl "));

    expect(allowed).toBeGreaterThanOrEqual(0);
    expect(firstHttp).toBeGreaterThanOrEqual(0);
    // Not "before the first authenticated one" — before ANY of them. The very
    // first host-side curl this script makes is the readiness PROPFIND, and it
    // carries admin credentials.
    expect(firstHttp).toBeGreaterThan(allowed);
  });

  it("waits for the installer, because appconfig is a table and not a file", () => {
    expect(run("207").status).toBe(0);

    const log = calls();
    const allowed = log.findIndex((l) =>
      l.includes("config:app:set bruteForce whitelist_0"),
    );
    const lastStatusPoll = log
      .map((l) => l.includes("occ status"))
      .lastIndexOf(true);

    expect(lastStatusPoll).toBeGreaterThanOrEqual(0);
    expect(allowed).toBeGreaterThan(lastStatusPoll);
  });

  it("exempts the private ranges only — a public address is still counted", () => {
    expect(run("207").status).toBe(0);

    const ranges = calls()
      .filter((l) => l.includes("config:app:set bruteForce"))
      .map((l) => l.replace(/^.*--value=/, ""));

    expect(ranges).toEqual([
      "127.0.0.1/32",
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
    ]);
  });
});

describe("what the readiness refusal says", () => {
  it("reads a persistent 429 as the previous run throttling this one", () => {
    const res = run("429");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("last PROPFIND status: 429");
    expect(res.stderr).toContain("twelve hours");
    // The remedy, not just the symptom.
    expect(res.stderr).toContain("security:bruteforce:reset");
  });

  it("reads a 401 as the volume disagreeing with .env, and says so alone", () => {
    const res = run("401");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("user:resetpassword");
    // The two have different causes and different remedies. A refusal that
    // offered both would be a refusal that had not diagnosed anything.
    expect(res.stderr).not.toContain("security:bruteforce:reset");
  });

  it("reads a 000 as unreachable rather than as Nextcloud being broken", () => {
    const res = run("000");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("NEXTCLOUD_URL=http://nextcloud/");
    expect(res.stderr).not.toContain("user:resetpassword");
  });

  it("still recovers when the throttle lifts partway through the poll", () => {
    const res = run("429 429 207");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("External DAV ready");
    expect(res.stdout).toContain("Done: source=");
  });
});
