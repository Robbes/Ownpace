// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PUBLISH THAT MOVED AND A CALLER THAT STAYED AT LOCALHOST.
 *
 * The DAV backend published on every interface from the day it arrived, with
 * the shipped `NEXTCLOUD_ADMIN_PASSWORD` on its admin account — an
 * unauthenticated-by-default file store facing whatever could route to the
 * box, on a box that has a public name. It now binds through
 * `NEXTCLOUD_BIND`, loopback by default, exactly as `MAILPIT_BIND` does and
 * for the reason stated there.
 *
 * Making it a setting created the failure this guard is named for. Every
 * host-side caller of that published port assumed `localhost`: the gate's DAV
 * assertions and the demo provisioner. An operator binding it to a private
 * mesh address — the whole point of the setting, so the backend can be
 * browsed over the VPN — would have left them curling a loopback address
 * nothing listens on, and the gate would have reported a TARGET failure that
 * was really a moved port. So the callers read the same variable the publish
 * reads, and that is pinned here.
 *
 * The bind is only half of reachability, and the other half fails differently:
 * Nextcloud answers its "untrusted domain" page to any host header not on
 * `NEXTCLOUD_TRUSTED_DOMAINS`, which looks like a broken deployment rather
 * than a setting. Both shipped names must stay on that list — the gate asks
 * on `localhost`, the app network asks for `nextcloud`.
 *
 * What this guard does NOT do: check that an operator's own `.env` sets the
 * two consistently. It cannot read a deployment's file, and a rule invented
 * about one would be a guess. It pins what ships.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const COMPOSE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "deploy",
  "compose",
);
const MANAGED = join(COMPOSE_DIR, "managed.yml");

interface ComposeFile {
  readonly services: Record<
    string,
    {
      readonly ports?: ReadonlyArray<string>;
      readonly environment?: Record<string, string>;
    }
  >;
}

const compose = parseYaml(readFileSync(MANAGED, "utf8")) as ComposeFile;
const nextcloud = compose.services.nextcloud;

/** Host-side callers of the PUBLISHED port — the ones a moved bind breaks. */
const CALLERS = ["smoke-managed.sh", "setup-managed-demo.sh"] as const;

describe("the DAV backend is published through a setting, and its callers follow it", () => {
  it("the service is in the file — the vacuity floor", () => {
    // Every assertion below reads this service. Without it they would pass
    // having checked nothing.
    expect(nextcloud, "no nextcloud service in managed.yml").toBeDefined();
    expect((nextcloud.ports ?? []).length).toBeGreaterThan(0);
  });

  it("publishes through NEXTCLOUD_BIND with a loopback default", () => {
    const published = (nextcloud.ports ?? []).join("\n");
    expect(
      published,
      'Write it as "${NEXTCLOUD_BIND:-127.0.0.1}:…" — the variable WITH the ' +
        'loopback default. A bare "${NEXTCLOUD_BIND}" publishes every deployment ' +
        "that never set it on all interfaces, which is the same mistake by omission.",
    ).toContain("${NEXTCLOUD_BIND:-127.0.0.1}:");
  });

  it("refuses 0.0.0.0 as the shipped bind", () => {
    // A private mesh address is a legitimate value for NEXTCLOUD_BIND; every
    // interface is not, because "who can route to this box" is not an answer.
    const published = (nextcloud.ports ?? []).join("\n");
    expect(published, "the shipped bind must not be 0.0.0.0").not.toContain(
      "0.0.0.0",
    );
  });

  it("keeps both shipped names on the trusted-domain list", () => {
    const trusted = nextcloud.environment?.NEXTCLOUD_TRUSTED_DOMAINS ?? "";
    expect(
      trusted,
      "NEXTCLOUD_TRUSTED_DOMAINS must stay a variable with a default, so an " +
        "operator can add a mesh address without losing the shipped names",
    ).toContain("${NEXTCLOUD_TRUSTED_DOMAINS:-");
    for (const name of ["localhost", "nextcloud"]) {
      expect(
        trusted,
        `"${name}" must stay in the default list — the gate asks on localhost, ` +
          "the app network asks for nextcloud",
      ).toContain(name);
    }
  });

  it.each(CALLERS)(
    "%s reads the bind rather than assuming localhost",
    (file) => {
      const text = readFileSync(join(COMPOSE_DIR, file), "utf8");
      expect(
        text,
        `${file} calls the published DAV port but never reads NEXTCLOUD_BIND, so an ` +
          "operator who moves the publish leaves it calling an address nothing listens on",
      ).toContain("NEXTCLOUD_BIND");
      expect(
        text.includes("localhost:${nc_port"),
        `${file} still hardcodes localhost for the published DAV port`,
      ).toBe(false);
    },
  );
});
