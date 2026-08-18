// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The demo's DAV content, and the two ways seeding it goes quietly wrong.
 *
 * `setup-nextcloud-users.sh` provisions accounts and no content — grep it for
 * PUT and nothing comes back. So the demo DAV source has always been empty,
 * every sync of demo tenant B has correctly copied nothing, and `item` has
 * never held a `copied` row for that mapping. That is what e2e-managed run #7
 * found the moment a skipped apply half was allowed to fail instead of pass.
 *
 * Docker and Nextcloud are stubbed here, and the stub is not the thing under
 * test: what is tested is the argv this script builds and the paths it tries,
 * both of which were wrong in the first draft in ways that produce a plausible
 * HTTP error rather than a crash.
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
const SEEDER = join(REPO_ROOT, "deploy/compose/seed-demo-dav-content.sh");

/**
 * A Nextcloud that answers 207 only for the collection spellings it really
 * uses. Nextcloud's layout is NOT symmetric — calendars live under
 * `calendars/<user>/` but address books under `addressbooks/users/<user>/` —
 * so a script that assumes one spelling for both gets a 404 that reads exactly
 * like "the account has no calendar".
 */
const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" >> "$ARGDIR/all.args"
printf '%s\\n' "$@" > "$ARGDIR/last.args"
args=("$@"); i=1; [ "\${args[1]}" = "-i" ] && i=2
case "\${args[$((i+1))]}" in true|sh) exit 0 ;; esac
url="\${args[\${#args[@]}-1]}"
for ((j=0;j<\${#args[@]};j++)); do [ "\${args[$j]}" = "-X" ] && m="\${args[$((j+1))]}"; done
if [ "$m" = "PROPFIND" ]; then
  case "$url" in
    *"/calendars/$NCUSER/personal/"*|*"/addressbooks/users/$NCUSER/contacts/"*|*"/files/$NCUSER/"*)
      printf '%s\\n' "\${args[@]}" | grep -q 'Depth: 1' && { echo "$VERIFY_ANSWER"; exit 0; }
      echo -n 207 ;;
    *) echo -n 404 ;;
  esac
  exit 0
fi
cat >/dev/null 2>&1; echo -n 201
`;

let dir: string;
function run(env: Record<string, string> = {}) {
  return spawnSync("bash", [SEEDER], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      ARGDIR: dir,
      NCUSER: "tenant-b-source",
      VERIFY_ANSWER:
        "openmig-demo-event-1 openmig-demo-contact-1 openmig-demo-file-1",
      ...env,
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "davseed-"));
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "docker"), STUB);
  chmodSync(join(dir, "bin", "docker"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the requests it builds", () => {
  it("sends Content-Type as ONE argument, not three", () => {
    // A header whose value contains `;` is the argv mistake this kind of
    // script invites, and curl does not complain about it — Nextcloud simply
    // stores the wrong content type, and the sync then copies an item that
    // reads as the wrong kind. Pinned because it fails silently, not loudly.
    const r = run();
    expect(r.status).toBe(0);
    const args = readFileSync(join(dir, "all.args"), "utf8").split("\n");
    const headers = args.filter((a) => a.startsWith("Content-Type:"));
    expect(headers).toContain("Content-Type: text/calendar; charset=utf-8");
    expect(headers).toContain("Content-Type: text/vcard; charset=utf-8");
    // The split form would leave a bare `Content-Type:` with the value elsewhere.
    expect(args).not.toContain("Content-Type:");
  });

  it("seeds all three domains the demo mapping selects", () => {
    run();
    const all = readFileSync(join(dir, "all.args"), "utf8");
    expect(all).toMatch(/openmig-demo-event-\d\.ics/);
    expect(all).toMatch(/openmig-demo-contact-\d\.vcf/);
    expect(all).toMatch(/openmig-demo-file-\d\.txt/);
  });
});

describe("Nextcloud's asymmetric collection layout", () => {
  it("finds both spellings rather than assuming one", () => {
    const r = run();
    expect(r.stdout).toContain("calendars/tenant-b-source/personal/");
    // `addressbooks/users/<user>/` — the spelling that differs from calendars.
    expect(r.stdout).toContain("addressbooks/users/tenant-b-source/contacts/");
  });

  it("refuses when the account has no collections at all", () => {
    const r = run({ NCUSER: "somebody-else" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/does the account exist|no personal calendar/);
  });
});

describe("it reports what is true, not what it attempted", () => {
  it("PUTs returning 201 are not enough — it re-reads and refuses if empty", () => {
    const r = run({ VERIFY_ANSWER: "" });
    // Every PUT still answered 201 in this run.
    expect(r.stdout).toContain("HTTP 201");
    expect(r.stdout).toContain("events:0 contacts:0 files:0");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("seeding did not stick");
  });

  it("succeeds only when the re-read finds the content", () => {
    expect(run().status).toBe(0);
  });
});

describe("it never hands the smoke its precondition", () => {
  it("writes to the DAV source, never to the ledger", () => {
    // Inserting `status='copied'` rows directly would satisfy the apply half
    // and prove nothing — worse, it would be a claim that a copy happened, in
    // the table whose whole job is recording copies that did.
    const text = readFileSync(SEEDER, "utf8");
    expect(text).not.toMatch(/INSERT\s+INTO/i);
    expect(text).not.toMatch(/UPDATE\s+\w+\s+SET/i);
    expect(text).not.toMatch(/DELETE\s+FROM/i);
    // It does mention the ledger — but only to tell the operator how to WATCH
    // the rows arrive. Every SQL statement in the file is a SELECT.
    const sql = text.match(/\b(SELECT|INSERT|UPDATE|DELETE)\b/gi) ?? [];
    expect(new Set(sql.map((k) => k.toUpperCase()))).toEqual(
      new Set(["SELECT"]),
    );
  });
});
