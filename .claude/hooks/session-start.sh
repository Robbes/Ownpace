#!/bin/bash
#
# Make the gates runnable before the agent's first turn.
#
# WHY THIS EXISTS. A Claude Code on the web session starts from a container image
# whose node_modules is not guaranteed to match this repo's lockfile. On
# 2026-08-14 that cost two separate detours in one session: the root guard tests
# failed with "Cannot find package 'yaml'", and later `pnpm typecheck` failed on a
# CLEAN checkout of main with "Cannot find module 'yaml'" from apps/api. Both
# cleared instantly with an install. The second one looked like a repo defect for
# long enough to be worth preventing — `yaml` is declared correctly in both
# package.json files, so the tree was fine and only the install was short.
#
# An incomplete install does not announce itself. It surfaces as a module
# resolution error in whatever file happens to import the missing package, which
# reads exactly like a broken repository.
#
# Idempotent: with a complete install this is a fast no-op.

set -euo pipefail

# Local checkouts manage their own dependencies; only the remote container needs
# this. Running a workspace-wide install on somebody's laptop uninvited is rude.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --frozen-lockfile, deliberately: it refuses to edit pnpm-lock.yaml, so a
# session can never start by silently mutating a tracked file. Unlike `npm ci` it
# does NOT delete node_modules first, so an already-good container stays warm and
# this costs seconds.
if pnpm install --frozen-lockfile; then
  echo "[session-start] pnpm install --frozen-lockfile: workspace ready"
  exit 0
fi

# Loud rather than silent. A degraded session that looks healthy is the failure
# mode this hook exists to prevent, so say plainly what broke and what to do.
cat <<'MSG'
[session-start] WARNING: `pnpm install --frozen-lockfile` FAILED.

The workspace may be missing dependencies. Expect `pnpm lint`, `pnpm typecheck`
and `pnpm test` to fail with module-resolution errors that look like repository
defects but are not.

Most likely cause: pnpm-lock.yaml is out of step with a package.json. Run
`pnpm install` by hand and inspect the lockfile diff before trusting any gate.
MSG
# Exit 0 on purpose: the session should still start. The message above is the
# signal — failing the hook here would replace one confusing failure with another.
exit 0
