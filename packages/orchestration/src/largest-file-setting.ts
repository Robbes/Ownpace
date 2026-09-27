// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE LARGEST FILE A MANAGED PASS COPIES (workplan 0143 T4 (a)), from
 * `LARGEST_FILE_MB`, a task-environment setting that `set-task-env.sh` uploads.
 *
 * The rule behind the number: the largest file must finish inside one pass at
 * the slowest rate this machine sees. A pass stops taking new work at 50
 * minutes and is killed at 60 (`pass-deadline.ts`), so 10 GB needs about 25 to
 * 30 Mbit/s, sustained from source to target. A slower file is killed with the
 * pass and starts again on the next one; counting those attempts is T4's half
 * after the alpha. The owner chose the number on 2026-09-27: *"Max it at 10 GB
 * per file."* T9's rehearsal measures the rate.
 *
 * Only `build-deps-from-mapping.ts` reads it, which only the managed tasks run:
 * the appliance passes no limit and refuses nothing.
 */

const MB = 1024 * 1024;

/** The owner's number, 2026-09-27: 10 GB. */
export const DEFAULT_LARGEST_FILE_MB = 10 * 1024;

/**
 * The limit in bytes. Unset or empty is the default. Anything but a whole
 * number of megabytes, at least 1, is refused loudly, as
 * `LEDGER_RETENTION_DAYS` is: an operator who wrote `10GB` believes the limit
 * is ten gigabytes, and quietly holding another number is found out by a
 * tester.
 */
export function largestFileBytesFromEnv(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_LARGEST_FILE_MB * MB;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `LARGEST_FILE_MB must be a whole number of megabytes, at least 1 — got ${JSON.stringify(raw)}. ` +
        `Leave it unset for the default of ${DEFAULT_LARGEST_FILE_MB} (10 GB).`,
    );
  }
  return n * MB;
}
