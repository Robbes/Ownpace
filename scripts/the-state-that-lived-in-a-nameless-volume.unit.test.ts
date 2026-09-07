// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * STATE IN A NAMELESS VOLUME IS STATE NOBODY CAN FIND AGAIN.
 *
 * The managed stack's `nextcloud` service declared no volume of its own from
 * the day it arrived, and the image declares `VOLUME /var/www/html`. So every
 * account, calendar, address book and file it held lived in an ANONYMOUS
 * volume: a hash Docker made up. That survives `restart` and a container
 * recreate, which is why nobody noticed — and a `docker compose down` orphans
 * it. The next `up` installs Nextcloud again, empty, while the previous data
 * sits on the disk under a name no operator will ever look up.
 *
 * The owner asked the question that found it — "will it be sufficiently
 * persistent for me to check all migrated?" — before trusting a real
 * migration pass to it. Every other stateful service in that file was already
 * named. This one was not a decision; it was an omission with no test
 * watching for the next one.
 *
 * So: a service in the managed compose either MOUNTS something, or is listed
 * below as one that keeps nothing worth keeping, with the reason written
 * down. A new service that stores anything cannot arrive silently — it either
 * names its volume or names itself here, and naming itself here is a claim a
 * reviewer can read and disagree with.
 *
 * What this guard deliberately does NOT do: judge whether a mount is the
 * RIGHT path for that image. It cannot read image manifests, and a regex over
 * container paths would be a guess. That a service's state is addressed at
 * all is the part a machine can own; where it lands stays a reviewer's job.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const COMPOSE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "deploy",
  "compose",
  "managed.yml",
);

/**
 * Services that keep nothing across a restart, and why. A service belongs
 * here only if losing its container loses nothing a person would miss.
 */
const KEEPS_NOTHING: Record<string, string> = {
  api: "the API image is code; its state is Postgres, which has postgres_data",
  web: "the web image is a built bundle served read-only; it stores nothing",
};

interface ComposeFile {
  readonly services: Record<
    string,
    { readonly volumes?: ReadonlyArray<unknown> }
  >;
  readonly volumes?: Record<string, unknown>;
}

const compose = parseYaml(readFileSync(COMPOSE, "utf8")) as ComposeFile;

describe("state in the managed stack is addressed by name", () => {
  it("parses a stack with services to check — the vacuity floor", () => {
    // Every assertion below iterates the services. If the parse ever yields
    // none, they would all pass having checked nothing.
    expect(Object.keys(compose.services ?? {}).length).toBeGreaterThan(5);
  });

  it("every service either mounts something or says it keeps nothing", () => {
    const unaccounted = Object.entries(compose.services)
      .filter(
        ([name, service]) =>
          (service.volumes ?? []).length === 0 && !(name in KEEPS_NOTHING),
      )
      .map(([name]) => name);

    expect(
      unaccounted,
      `${unaccounted.join(", ")} mount no volume and are not listed as keeping nothing. ` +
        "A service that stores anything needs a NAMED volume — an anonymous one is lost " +
        "on the first `docker compose down`. If it truly keeps nothing, add it to " +
        "KEEPS_NOTHING with the reason.",
    ).toEqual([]);
  });

  it("a named volume a service mounts is declared at the top level", () => {
    const declared = new Set(Object.keys(compose.volumes ?? {}));
    const missing: string[] = [];

    for (const [name, service] of Object.entries(compose.services)) {
      for (const mount of service.volumes ?? []) {
        // Short syntax only: `source:target[:mode]`. A bind mount starts with
        // `.` or `/` and needs no declaration; long syntax is an object.
        if (typeof mount !== "string") continue;
        const source = mount.split(":")[0] ?? "";
        if (source.startsWith(".") || source.startsWith("/") || source === "")
          continue;
        if (!declared.has(source)) missing.push(`${name} mounts "${source}"`);
      }
    }

    expect(
      missing,
      `${missing.join("; ")} — not declared under the top-level volumes: key`,
    ).toEqual([]);
  });

  it("the DAV backend keeps its data by name, not by hash", () => {
    // The one this guard was written for, pinned by name so a later edit that
    // drops it back to an anonymous volume fails HERE, saying which service.
    const mounts = compose.services.nextcloud?.volumes ?? [];
    expect(
      mounts.some(
        (m) => typeof m === "string" && m.startsWith("nextcloud_data:"),
      ),
      "nextcloud must mount nextcloud_data — its accounts, calendars, address books and " +
        "files are what a migration pass is checked against",
    ).toBe(true);
  });

  it("every service listed as keeping nothing is still in the file", () => {
    // An exception for a service that no longer exists is a comment claiming
    // to be a rule.
    const gone = Object.keys(KEEPS_NOTHING).filter(
      (name) => !(name in compose.services),
    );
    expect(
      gone,
      `${gone.join(", ")} listed as keeping nothing but not in ${COMPOSE}`,
    ).toEqual([]);
  });
});
