// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RECIPE THAT DELETES WHAT ONLY ONE PHASE KNOWS HOW TO RESTORE.
 *
 * `setup-zitadel.sh` printed a reprovision recipe ending in itself:
 *
 *     docker volume rm ownpace-managed_zitadel_machinekey
 *     ./deploy/compose/setup-zitadel.sh
 *
 * A volume Docker has just recreated is owned by root, and this provider's
 * image declares a USER — `ghcr.io/zitadel/zitadel` runs as uid 1000. So first
 * init cannot write its own token, and says so once:
 *
 *     migration failed  name=03_default_instance
 *       err.parent="open /machinekey/pat.txt: permission denied"
 *
 * `prepare_machinekey_volume` in `bootstrap-managed.sh` is the only thing in
 * this repository that fixes that: it reads the image's own `Config.User`,
 * resolves a name to a uid through the image's own passwd rather than guessing,
 * and chowns the volume before anything starts. `phase_app` calls it.
 * `setup-zitadel.sh` does not. So the documented procedure was guaranteed to
 * fail on the volume it had just told the operator to delete.
 *
 * It also fails twice and hides the first one. Init registers the instance
 * domain, hits the permission error, and exits `setup failed, skipping
 * cleanup`. `restart: unless-stopped` brings it back, and every later attempt
 * reports `Errors.Instance.Domain.AlreadyExists` — its own leftover, not a
 * cause. Run 2026-09-01 spent an hour on that second message.
 *
 * So: any instruction that removes the machinekey volume must hand the rebuild
 * to the phase that prepares it.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const COMPOSE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "deploy",
  "compose",
);

const scripts = readdirSync(COMPOSE_DIR)
  .filter((f) => f.endsWith(".sh"))
  .map((f) => ({
    file: f,
    lines: readFileSync(join(COMPOSE_DIR, f), "utf8").split("\n"),
  }));

/** Every place that tells somebody to delete the machinekey volume. */
function deletions() {
  const out: { file: string; line: number; after: string }[] = [];
  for (const { file, lines } of scripts) {
    lines.forEach((text, i) => {
      if (!/volume rm/.test(text) || !/zitadel_machinekey/.test(text)) return;
      // The rebuild instruction follows within a few lines in every shape this
      // repo uses — a die() heredoc, or a comment block.
      out.push({
        file,
        line: i + 1,
        after: lines.slice(i + 1, i + 4).join("\n"),
      });
    });
  }
  return out;
}

describe("every instruction that deletes the machinekey volume", () => {
  it("exists — the scan must not pass by finding nothing", () => {
    expect(deletions().length).toBeGreaterThanOrEqual(3);
  });

  it("hands the rebuild to the phase that prepares the volume", () => {
    const wrong = deletions()
      .filter((d) => !/bootstrap-managed\.sh --only app/.test(d.after))
      .map((d) => `${d.file}:${d.line}`);

    expect(wrong).toEqual([]);
  });

  it("does not send the operator straight back to setup-zitadel.sh", () => {
    // The trap is specific: setup-zitadel.sh is a perfectly good next step on a
    // volume that already has the right owner, and useless on a fresh one.
    const wrong = deletions()
      .filter((d) => /setup-zitadel\.sh\s*"?\s*;?;?\s*$/m.test(d.after))
      .map((d) => `${d.file}:${d.line}`);

    expect(wrong).toEqual([]);
  });
});

describe("the phase that prepares it", () => {
  it("still exists, and is still called from phase_app", () => {
    const bootstrap = readFileSync(
      join(COMPOSE_DIR, "bootstrap-managed.sh"),
      "utf8",
    );
    expect(bootstrap).toContain("prepare_machinekey_volume()");
    // Called, not merely defined — a definition nobody invokes prepares nothing.
    const calls = bootstrap
      .split("\n")
      .filter((l) => /^\s*prepare_machinekey_volume\s*$/.test(l));
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("reads the uid from the image rather than hard-coding one", () => {
    const bootstrap = readFileSync(
      join(COMPOSE_DIR, "bootstrap-managed.sh"),
      "utf8",
    );
    // E2E (managed) #45: the image reported `zitadel`, a NAME, and a hardcoded
    // 1000 would have chowned the token directory to whoever uid 1000 happens
    // to be on the host.
    expect(bootstrap).toContain(
      "docker image inspect \"$image\" --format '{{.Config.User}}'",
    );
  });
});
