// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE TARGET VOCABULARY IS ONE LIST, TYPED OUT IN NINE PLACES.
 *
 * `TARGET_TYPE_DOMAINS` says which target kinds exist and what each can
 * carry. Nine other sites repeat that vocabulary by hand — two zod enums, two
 * `as const` arrays, four inline unions and a React prop — and adding the
 * `nextcloud` kind on 2026-09-07 meant editing every one. Miss one and the
 * failure is silent in the worst way: the door offers a kind the route
 * rejects, or the route accepts a kind no door offers, and nothing says so
 * until somebody tries it.
 *
 * The lists cannot simply be derived — a zod enum needs literals, and
 * `apps/web` does not import the API's schema — so this reads them as TEXT
 * and asks whether each one names exactly the kinds the table declares.
 *
 * What this guard deliberately does NOT do: check the ORDER. `TARGET_KINDS`
 * and the enums happen to agree today, but a list that must match a table's
 * key order is a rule nobody stated, and a guard that invents one gets
 * weakened until it is switched off.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The one table. Read as text: a root-level test cannot resolve workspace imports. */
const TABLE = readFileSync(
  join(ROOT, "packages/shared/src/target-domains.ts"),
  "utf8",
);

/** Kinds the table declares, from the `TARGET_TYPE_DOMAINS` literal. */
const declaredKinds = (): ReadonlyArray<string> => {
  const body = TABLE.split("export const TARGET_TYPE_DOMAINS")[1] ?? "";
  const table = body.slice(0, body.indexOf("\n};"));
  return [...table.matchAll(/^\s{2}([a-z]+):\s*\[/gm)].map(
    (m) => m[1] as string,
  );
};

/** Every site that repeats the vocabulary, and the line that carries it. */
const REPEATS: ReadonlyArray<{
  readonly file: string;
  readonly marker: string;
}> = [
  {
    file: "packages/shared/src/credential-fields.ts",
    marker: "const TARGET_TYPES = [",
  },
  {
    file: "apps/api/src/routes/connections.ts",
    marker: "const TARGET_KINDS = [",
  },
  {
    file: "apps/api/src/routes/migrations/index.ts",
    marker: "targetType: z.enum([",
  },
  {
    file: "apps/web/src/services/mapping-service.ts",
    marker: "targetType: z.enum([",
  },
];

/** The kinds named on the line starting at `marker`. */
const kindsAt = (text: string, marker: string): ReadonlyArray<string> => {
  const at = text.indexOf(marker);
  if (at === -1) return [];
  const segment = text.slice(at, text.indexOf("]", at));
  return [...segment.matchAll(/'([a-z]+)'/g)].map((m) => m[1] as string);
};

describe("every door offers the same target kinds the table declares", () => {
  const kinds = declaredKinds();

  it("reads the table — the vacuity floor", () => {
    // Without this, a parse that yields nothing would make every comparison
    // below trivially true.
    expect(kinds.length, "TARGET_TYPE_DOMAINS parsed as empty").toBeGreaterThan(
      4,
    );
    expect(kinds).toContain("nextcloud");
  });

  it.each(REPEATS)("$file names exactly those kinds", ({ file, marker }) => {
    const found = kindsAt(readFileSync(join(ROOT, file), "utf8"), marker);
    expect(
      found.length,
      `${file}: could not find the list at "${marker}"`,
    ).toBeGreaterThan(0);
    expect(
      [...found].sort(),
      `${file} lists [${found.join(", ")}] but TARGET_TYPE_DOMAINS declares ` +
        `[${kinds.join(", ")}]. A door that offers a kind the route rejects — or a route ` +
        "that accepts one no door offers — fails only when somebody tries it.",
    ).toEqual([...kinds].sort());
  });

  it("every declared kind has a display name and a front-door lane", () => {
    // A kind nobody named renders as its own id, and a kind in no lane lands
    // among providers by fallback rather than by decision. Both are visible
    // in the product, so both are pinned here.
    const fields = readFileSync(
      join(ROOT, "packages/shared/src/credential-fields.ts"),
      "utf8",
    );
    const door = readFileSync(
      join(ROOT, "packages/shared/src/front-door.ts"),
      "utf8",
    );
    const unnamed = kinds.filter(
      (k) => !new RegExp(`^\\s+'?${k}'?:\\s*'`, "m").test(fields),
    );
    const unplaced = kinds.filter(
      (k) =>
        !new RegExp(`^\\s+'?${k}'?:\\s*'(provider|protocol)'`, "m").test(door),
    );

    expect(
      unnamed,
      `${unnamed.join(", ")} have no entry in PROVIDER_DISPLAY_NAMES`,
    ).toEqual([]);
    expect(
      unplaced,
      `${unplaced.join(", ")} are in no front-door lane`,
    ).toEqual([]);
  });
});
