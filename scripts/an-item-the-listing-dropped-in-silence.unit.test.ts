// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ITEM THE LISTING DROPPED, AND NOTHING ANYWHERE COUNTED IT.
 *
 * A source that catches a per-item failure and continues has made a choice on
 * the owner's behalf: this object is not migrating. The mail connector settled
 * when that is honest — *"Skipping is honest exactly when the same object is
 * already accounted for somewhere the owner looks"* (`ports.ts`) — and pays
 * for its own skips with `unkeyable`.
 *
 * The Graph contact, calendar and drive listings did not. Each caught a
 * mapping failure, wrote `log.warn`, and continued. `listSince` is not only
 * what Test measures with: `packages/core/reconcile.ts` and `dav-sync.ts`
 * drive the real pass through it. So a card that failed to map was absent
 * from the pass, absent from the total the customer approves at the confirm
 * screen, and absent from BOTH sides of the verification gate — which then
 * agreed with each other and reported PASS. The owner read "Contacts ✓ 1
 * address book · 0 cards" on 2026-09-06 and could not tell it apart from an
 * address book whose every card failed.
 *
 * So: a listing that swallows a per-item failure counts it. This guard reads
 * the connectors as TEXT and asks, of every `catch` that logs a per-item
 * failure, whether a counter is incremented in the same block.
 *
 * What this guard deliberately does NOT do:
 *
 *  - It does not check that the count REACHES a screen. That is a different
 *    property, in different files, and a guard claiming both would be
 *    trusted for one it cannot see. The port's field is the seam; where the
 *    number surfaces is the reviewer's business.
 *  - It does not judge whether swallowing was right in the first place. Some
 *    failures should throw. That is a design call per source, and a rule
 *    invented here would be a guess.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CONNECTORS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "connectors",
  "src",
);

/** A per-item failure a listing swallowed: the log line names one item. */
const SWALLOWED = /log\.(?:warn|debug|info)\(\s*`Failed to process (\w+) \$\{/g;

/** Counters that pay for a skip. `unkeyable`: still migrated, under a generated key. */
const COUNTERS = ["unreadable", "unkeyable", "unnameable"];

const sources = readdirSync(CONNECTORS).filter(
  (f) =>
    f.endsWith("-source.ts") &&
    !f.includes(".unit.test.") &&
    !f.endsWith(".types.ts"),
);

/** The block a swallowed failure sits in: back to its `catch`, on to the brace. */
const catchBlockAround = (text: string, at: number): string => {
  const opened = text.lastIndexOf("} catch", at);
  const start = opened === -1 ? Math.max(0, at - 400) : opened;
  return text.slice(start, at + 200);
};

describe("a listing that drops an item counts it", () => {
  it("reads the connector sources — the vacuity floor", () => {
    // Every assertion below iterates these files. With none, they would all
    // pass having read nothing.
    expect(sources.length).toBeGreaterThan(5);
  });

  it("every swallowed per-item failure increments a counter", () => {
    const silent: string[] = [];

    for (const file of sources) {
      const text = readFileSync(join(CONNECTORS, file), "utf8");
      for (const match of text.matchAll(SWALLOWED)) {
        const block = catchBlockAround(text, match.index ?? 0);
        if (
          !COUNTERS.some(
            (counter) =>
              block.includes(`${counter} += 1`) ||
              block.includes(`${counter}++`),
          )
        ) {
          silent.push(`${file} (${match[1]})`);
        }
      }
    }

    expect(
      silent,
      `${silent.join(", ")} — a per-item failure is logged and the item is dropped, but ` +
        "nothing counts it. `listSince` feeds the real pass (core/reconcile.ts), so the item " +
        "is not migrated AND not reported: both sides of the verification gate agree on " +
        "nothing and report PASS. Increment `unreadable` in the catch and return it, as " +
        "ports.ts requires.",
    ).toEqual([]);
  });

  it("a counted skip is returned, not just counted", () => {
    // A counter that never leaves the function is the same silence with extra
    // steps. Every source that counts must also hand the number back.
    const kept: string[] = [];

    for (const file of sources) {
      const text = readFileSync(join(CONNECTORS, file), "utf8");
      if (!text.includes("unreadable += 1")) continue;
      if (!text.includes("unreadable } : {}")) kept.push(file);
    }

    expect(
      kept,
      `${kept.join(", ")} counts unreadable items but never returns the number`,
    ).toEqual([]);
  });

  it("the three Graph listings that taught this lesson still report it", () => {
    // Named, so a later edit that quietly drops the reporting fails HERE
    // rather than in a live migration.
    for (const file of [
      "graph-contacts-source.ts",
      "graph-calendar-source.ts",
      "graph-drive-source.ts",
    ]) {
      const text = readFileSync(join(CONNECTORS, file), "utf8");
      expect(text, `${file} must count what it could not read`).toContain(
        "unreadable += 1",
      );
      expect(text, `${file} must return the count`).toContain(
        "unreadable } : {}",
      );
    }
  });
});
