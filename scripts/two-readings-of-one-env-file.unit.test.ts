// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE .env, READ THREE DIFFERENT WAYS, AND THE THIRD WAS NOBODY'S JOB.
 *
 * `managed.env.example` documents thirteen of its keys with a comment on the
 * same line as the value:
 *
 *     SMTP_PORT=1025          # a relay is usually 587 (STARTTLS), or 465 …
 *     SMTP_SECURE=            # true = implicit TLS on connect
 *
 * Every consumer that SOURCES the file (`set -a; . .env`) gets `1025` and ``,
 * because that is what a shell does with a `#` after whitespace. Every consumer
 * that READS it as data with `grep … | cut -d= -f2-` gets
 * `1025          # a relay is usually 587 …` — the comment glued to the value.
 * Both kinds of consumer are in this repository, and they disagreed for as long
 * as the example has shipped that way.
 *
 * What it looked like when it finally bit, on 2026-09-01, during an identity
 * provider reprovision:
 *
 *     jq: invalid JSON text passed to --argjson
 *     FATAL: POST /admin/v1/email/smtp answered HTTP 400:
 *       invalid AddEmailProviderSMTPRequest.SenderAddress: value length must
 *       be between 1 and 200 runes, inclusive
 *
 * `SMTP_SECURE` came back as `false   # true = implicit TLS on connect`, which
 * is not JSON, so `jq -nc --argjson tls` produced nothing at all, so the POST
 * body was empty, so the provider complained about a sender address nobody had
 * touched. Three hops from the cause, and none of them mentions a comment.
 *
 * ## The fix that expired, and what replaced it
 *
 * The answer then was a trim — `| sed 's/[[:space:]].*$//'` on the end of every
 * one of those greps — and this file used to REQUIRE that trim, in those exact
 * characters, in at least ten places. The trim was provably lossless because
 * `env-upsert.sh` refused any value containing whitespace, so everything from
 * the first space onward could only be a comment.
 *
 * On 2026-09-08 that premise expired. `check-env-agreement.sh` shipped, and it
 * tells an operator whose value contains a space or an ampersand to SINGLE-QUOTE
 * it — the one form neither Compose's dotenv nor bash's `source` expands. The
 * first deployment it ran against refused five values, four of them secrets, and
 * the owner quoted them exactly as instructed.
 *
 * At which point the trim was no longer lossless, because it had never heard of
 * quotes. `KEY='swordfish'` read back as `'swordfish'`, two characters longer
 * than the secret; `KEY='localhost nextcloud'` read back as `'localhost`. The
 * first thing that would have broken is `setup-zitadel.sh` writing the Microsoft
 * identity provider's client secret with the quotes still on it — a sign-in
 * failure hours later, naming nothing. The remedy for two parsers had silently
 * broken a third that nobody had counted.
 *
 * So the twenty-two hand-rolled readers are gone, replaced by one
 * `env_value` in `deploy/compose/env-read.sh` that understands both forms the
 * checker permits. This file now holds the property that matters:
 *
 *  1. NO shipped script reads a value out of `.env` by hand any more — a
 *     twenty-third copy of that pipeline is how the first twenty-two happened;
 *  2. the readers that replaced them exist, and reach the scripts an operator
 *     actually runs;
 *  3. a script that CALLS `env_value` also SOURCES it — calling an undefined
 *     function in bash is a runtime failure, and these scripts run at 03:30;
 *  4. `env_value` still answers the four original cases exactly as `source`
 *     does, and now the quoted ones too;
 *  5. the writer, the checker and the reader agree: whatever `env-upsert.sh`
 *     writes, `check-env-agreement.sh` accepts and `env_value` reads back
 *     BYTE FOR BYTE. That round trip is the whole contract, and it is run
 *     against the values that caused the trouble.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["deploy/compose", "deploy/selfhost"];
const READER = join(REPO_ROOT, "deploy/compose/env-read.sh");
const UPSERT = join(REPO_ROOT, "deploy/compose/env-upsert.sh");
const CHECKER = join(REPO_ROOT, "deploy/compose/check-env-agreement.sh");

type Line = { file: string; line: number; text: string };

/** Every non-comment line in a shipped shell script, with its location. */
function shellLines(): Line[] {
  const out: Line[] = [];
  for (const dir of DIRS) {
    for (const f of readdirSync(join(REPO_ROOT, dir)).filter((n) =>
      n.endsWith(".sh"),
    )) {
      const rel = `${dir}/${f}`;
      readFileSync(join(REPO_ROOT, rel), "utf8")
        .split("\n")
        .forEach((text, i) => {
          // A comment can legitimately QUOTE a wrong command — operator.sh's
          // header does exactly that, about this very shape. Quoting a mistake
          // is how the repo explains it; rewriting the quote would erase the
          // lesson.
          if (/^\s*#/.test(text)) return;
          out.push({ file: rel, line: i + 1, text });
        });
    }
  }
  return out;
}

describe("reading a value out of .env", () => {
  it("is never done by hand, in any shipped script", () => {
    // Not "must be trimmed" any more: must not exist. A hand-rolled reader
    // cannot be trimmed into correctness once a value may be quoted, and the
    // twenty-third copy of it would be written by someone who never read this.
    const offenders = shellLines()
      .filter((l) => l.text.includes("cut -d= -f2-"))
      .map((l) => `${l.file}:${l.line}`);

    expect(
      offenders,
      "These read a value straight out of .env. Use env_value from\n" +
        "deploy/compose/env-read.sh, which understands the quoting that\n" +
        "check-env-agreement.sh tells operators to apply.",
    ).toEqual([]);
  });

  it("is actually done somewhere — the scan must not pass on an empty set", () => {
    // A guard that would also pass if every reader were deleted is a guard that
    // has stopped watching anything.
    const readers = shellLines().filter((l) => /\benv_value\b/.test(l.text));
    expect(readers.length).toBeGreaterThanOrEqual(15);

    // And it must reach the scripts an operator actually runs by hand.
    const files = new Set(readers.map((l) => l.file));
    for (const f of [
      "deploy/compose/bootstrap-managed.sh",
      "deploy/compose/setup-zitadel.sh",
      "deploy/compose/zitadel-db-password.sh",
      "deploy/compose/ensure-env-secrets.sh",
      "deploy/compose/smoke-managed.sh",
    ]) {
      expect(files.has(f), `${f} no longer reads .env through env_value`).toBe(
        true,
      );
    }
  });

  it("is sourced by every script that calls it", () => {
    // `env_value: command not found` under `set -e` is a script that stops
    // dead, at 03:30, in the middle of a bring-up. The function has to be in
    // scope wherever it is called — directly, or through trigger-cli-lib.sh,
    // which sources it for its own callers.
    const byFile = new Map<string, string>();
    for (const dir of DIRS) {
      for (const f of readdirSync(join(REPO_ROOT, dir)).filter((n) =>
        n.endsWith(".sh"),
      )) {
        byFile.set(`${dir}/${f}`, readFileSync(join(REPO_ROOT, dir, f), "utf8"));
      }
    }

    for (const [rel, text] of byFile) {
      if (rel.endsWith("/env-read.sh")) continue;
      // Ignore the word inside comments; only a real call needs the source.
      const calls = text
        .split("\n")
        .filter((l) => !/^\s*#/.test(l))
        .some((l) => /\benv_value\b/.test(l));
      if (!calls) continue;

      // A MENTION is not a source. The first draft of this test looked for the
      // string "env-read.sh" anywhere in the file, and passed happily on a
      // script whose only remaining reference was the comment above the call —
      // which is a script that dies with `env_value: command not found`. Only a
      // real `. …/env-read.sh` line counts, or `. …/trigger-cli-lib.sh`, which
      // sources it for its callers.
      const sourced = text
        .split("\n")
        .filter((l) => !/^\s*#/.test(l))
        .some((l) => /^\s*\.\s+.*(env-read|trigger-cli-lib)\.sh"?\s*$/.test(l));
      expect(sourced, `${rel} calls env_value without sourcing env-read.sh`).toBe(
        true,
      );
    }
  });
});

/** Run the real env_value over a real file. */
function envValue(envText: string, key: string, fallback = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "env-read-"));
  try {
    const file = join(dir, ".env");
    writeFileSync(file, envText);
    const res = spawnSync(
      "bash",
      [
        "-c",
        `set -euo pipefail; . "$1"; env_value "$2" "$3" "$4"`,
        "sh",
        READER,
        file,
        key,
        fallback,
      ],
      { encoding: "utf-8" },
    );
    return res.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("what env_value does to a real line", () => {
  // The four cases the hand-rolled trim was written for. They must survive the
  // replacement unchanged, or this was a rewrite that lost the original bug.
  it("drops an inline comment and keeps the value", () => {
    // Verbatim from managed.env.example:110.
    expect(
      envValue(
        "SMTP_PORT=1025          # a relay is usually 587 (STARTTLS)\n",
        "SMTP_PORT",
      ),
    ).toBe("1025");
  });

  it("reads a commented-but-unset key as unset, the way the shell does", () => {
    // managed.env.example:111. Read without the trim this is the string
    // "            # true = implicit TLS on connect", which `jq --argjson`
    // rejects and which is emphatically not `false`.
    expect(
      envValue(
        "SMTP_SECURE=            # true = implicit TLS on connect\n",
        "SMTP_SECURE",
      ),
    ).toBe("");
  });

  it("leaves an ordinary value alone", () => {
    expect(envValue("POSTGRES_USER=openmigrate\n", "POSTGRES_USER")).toBe(
      "openmigrate",
    );
  });

  it("takes the last assignment, as Compose and `source` both do", () => {
    // One reader used to take the FIRST (`awk 'NR==1'`), which would have
    // reported a value the running stack did not have.
    expect(
      envValue("WEB_URL=http://a\nWEB_URL=http://b   # moved\n", "WEB_URL"),
    ).toBe("http://b");
  });

  // And the cases that did not exist until the checker told operators to quote.
  it("strips the single quotes the checker tells operators to add", () => {
    expect(envValue("ZITADEL_ADMIN_PASSWORD='sw0rdf!sh'\n", "ZITADEL_ADMIN_PASSWORD")).toBe(
      "sw0rdf!sh",
    );
  });

  it("keeps the spaces inside a quoted value", () => {
    // The trim returned `'localhost` here — truncated at the first space, with
    // a leading quote, and Nextcloud would have refused every request.
    expect(
      envValue(
        "NEXTCLOUD_TRUSTED_DOMAINS='localhost nextcloud 100.97.25.131'\n",
        "NEXTCLOUD_TRUSTED_DOMAINS",
      ),
    ).toBe("localhost nextcloud 100.97.25.131");
  });

  it("drops a comment after a quoted value, and not before it", () => {
    expect(envValue("K='a b'   # a note\n", "K")).toBe("a b");
  });

  it("reads an exported key, since both parsers accept one", () => {
    expect(envValue("export TRIGGER_ENV=prod\n", "TRIGGER_ENV")).toBe("prod");
  });

  it("falls back when the key is absent or empty", () => {
    expect(envValue("OTHER=1\n", "MISSING", "fallback")).toBe("fallback");
    expect(envValue("MISSING=\n", "MISSING", "fallback")).toBe("fallback");
  });

  it("does not match a key that merely ends with the one asked for", () => {
    expect(envValue("MY_PORT=9\nPORT=1\n", "PORT")).toBe("1");
  });
});

describe("the writer, the checker and the reader are one rule", () => {
  // The contract in one loop: env-upsert.sh writes it, check-env-agreement.sh
  // accepts it, env_value reads it back unchanged. Anything that breaks the
  // loop breaks a deployment quietly, which is how all of this started.
  const VALUES: ReadonlyArray<readonly [string, string]> = [
    ["hex, the ordinary case", "0123456789abcdef0123456789abcdef"],
    ["a URL", "https://app.ota.ownpace.eu"],
    ["a hostname list with spaces", "localhost nextcloud 100.97.25.131"],
    ["a console URL with a placeholder", "https://idp.x/ui/console/users/{sub}"],
    ["a secret with punctuation", "aB3~x?y&z.q_-Qw"],
    ["a secret with a dollar", "pa$$w0rd"],
    ["a secret with a hash", "no#comment"],
    ["a value with a double quote", 'say "hi"'],
    ["a value with a backslash", "a\\nb"],
  ];

  for (const [what, value] of VALUES) {
    it(`round-trips ${what}`, () => {
      const dir = mkdtempSync(join(tmpdir(), "env-round-"));
      try {
        const file = join(dir, ".env");
        writeFileSync(file, "LOG_LEVEL=info\n");

        const wrote = spawnSync("bash", [UPSERT, file, `SECRETY=${value}`], {
          encoding: "utf-8",
        });
        expect(
          wrote.status,
          `env-upsert refused a value it has to be able to store:\n${wrote.stderr}`,
        ).toBe(0);

        const checked = spawnSync("bash", [CHECKER, file], {
          encoding: "utf-8",
        });
        expect(
          checked.status,
          "The one script that writes this file wrote a line the checker refuses.\n" +
            "That is the two of them giving an operator opposite instructions about\n" +
            `the same line:\n${checked.stderr}`,
        ).toBe(0);

        const read = spawnSync(
          "bash",
          ["-c", `set -euo pipefail; . "$1"; env_value "$2" SECRETY`, "sh", READER, file],
          { encoding: "utf-8" },
        );
        expect(
          read.stdout,
          "The reader gave back something other than the bytes that were stored.\n" +
            "For a client secret that is a sign-in failure hours later, naming nothing.",
        ).toBe(value);

        // And what a shell makes of the same line, since half the consumers
        // source it rather than read it.
        const sourced = spawnSync(
          "bash",
          ["-c", 'set -a; . "$1"; set +a; printf %s "$SECRETY"', "sh", file],
          { encoding: "utf-8" },
        );
        expect(
          sourced.stdout,
          "`set -a; . .env` disagrees with env_value about this line — which is\n" +
            "the api container and the task containers holding different values.",
        ).toBe(value);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("refuses the one value that cannot be represented", () => {
    // A single quote inside has no form both parsers read identically, so the
    // refusal is honest rather than a gap: the value itself has to change.
    const dir = mkdtempSync(join(tmpdir(), "env-round-"));
    try {
      const file = join(dir, ".env");
      writeFileSync(file, "LOG_LEVEL=info\n");
      const wrote = spawnSync("bash", [UPSERT, file, "APOS=it's"], {
        encoding: "utf-8",
      });
      expect(wrote.status).not.toBe(0);
      expect(wrote.stderr).toContain("single quote");
      expect(
        readFileSync(file, "utf8"),
        "A refused write must leave the file alone.",
      ).toBe("LOG_LEVEL=info\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
