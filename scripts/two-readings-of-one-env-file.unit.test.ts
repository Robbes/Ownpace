// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE .env, READ TWO DIFFERENT WAYS.
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
 * THE TRIM IS PROVABLY LOSSLESS, which is why it can be applied everywhere
 * rather than key by key. `env-upsert.sh` refuses any value containing
 * whitespace — `*[[:space:]]* | *\"* | *\'* | *\$* | *\`* | *\\*` — precisely
 * because the file is executed by a shell, so no value this repo writes can
 * contain a space. Everything from the first whitespace onward is therefore a
 * comment or padding, never data.
 *
 * The trim cuts at the FIRST whitespace rather than taking the first
 * whitespace-delimited field, and the difference is a line like
 * `SMTP_SECURE=            # true = …`: `awk '{print $1}'` skips the leading
 * spaces and returns `#`, where the shell returns nothing. The first draft of
 * this fix used awk, and the fourth test below is what caught it.
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

const TRIMMED = /cut -d= -f2-\s*\|\s*sed 's\/\[\[:space:\]\].*\$\/\/'/;

describe("reading a value out of .env", () => {
  it("never stops at cut, anywhere in the shipped scripts", () => {
    const offenders = shellLines()
      .filter((l) => l.text.includes("cut -d= -f2-"))
      .filter((l) => !TRIMMED.test(l.text))
      .map((l) => `${l.file}:${l.line}`);

    expect(offenders).toEqual([]);
  });

  it("is actually done somewhere — the scan must not pass on an empty set", () => {
    // A guard that would also pass if every reader were deleted is a guard that
    // has stopped watching anything.
    const trimmed = shellLines().filter((l) => TRIMMED.test(l.text));
    expect(trimmed.length).toBeGreaterThanOrEqual(10);

    // And it must reach the scripts an operator actually runs by hand.
    const files = new Set(trimmed.map((l) => l.file));
    for (const f of [
      "deploy/compose/bootstrap-managed.sh",
      "deploy/compose/setup-zitadel.sh",
      "deploy/compose/zitadel-db-password.sh",
      "deploy/compose/ensure-env-secrets.sh",
      "deploy/compose/smoke-managed.sh",
    ]) {
      expect(files.has(f), `${f} reads .env without trimming`).toBe(true);
    }
  });
});

describe("what the trim does to a real line", () => {
  const read = (envText: string, key: string) => {
    const dir = mkdtempSync(join(tmpdir(), "env-read-"));
    try {
      writeFileSync(join(dir, ".env"), envText);
      const res = spawnSync(
        "bash",
        [
          "-c",
          `set -o pipefail; grep -E "^${key}=" "$1" | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true`,
          "sh",
          join(dir, ".env"),
        ],
        { encoding: "utf-8" },
      );
      return res.stdout.replace(/\n$/, "");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("drops an inline comment and keeps the value", () => {
    // Verbatim from managed.env.example:110.
    expect(
      read(
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
      read(
        "SMTP_SECURE=            # true = implicit TLS on connect\n",
        "SMTP_SECURE",
      ),
    ).toBe("");
  });

  it("leaves an ordinary value alone", () => {
    expect(read("POSTGRES_USER=openmigrate\n", "POSTGRES_USER")).toBe(
      "openmigrate",
    );
  });

  it("takes the last assignment, as every reader here does", () => {
    expect(
      read("WEB_URL=http://a\nWEB_URL=http://b   # moved\n", "WEB_URL"),
    ).toBe("http://b");
  });
});
