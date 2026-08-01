#!/usr/bin/env bash
# smoke-managed.sh — the live verify + apply smoke against a running managed
# stack (workplan 0020 T5). This is the scripted form of the hand-run smoke
# that closed 0018 T5, and it is the ACCEPTANCE TEST for every future stack
# change: 0018 proved a green CI says nothing about whether an enqueue
# actually becomes a runner on this machine.
#
# What it does, end to end:
#   VERIFY half — mint a seeded-member token (the membership gate refuses
#     arbitrary subs since 0020 T1), POST verify/start, poll the report to a
#     terminal state, print the verification_run row.
#   APPLY half — pick an eligible ledger item on the apply mapping, fabricate
#     deletion evidence + flip the mapping flag (both retracted afterwards —
#     the retraction is guarded: evidence is only removed if the deletion was
#     NEVER applied, because retracting under an applied receipt would falsify
#     the record), POST apply, poll the receipt to a terminal state.
#   Runner logs — captured live via `docker logs -f` the moment a runner-*
#     container appears, because AutoRemove destroys them at exit (the
#     0018 T5 lesson: silent runner deaths with zero evidence).
#   Stuck rows — a poll that times out lands the row by hand with an
#     explanatory error (never left `running`/`queued` pointing at nothing).
#
# Success = verify `done` AND apply terminal as `applied` or `refused`
# (`refused` is a legitimate answer — the gates said no and said why).
# `failed` or a timeout on either half exits non-zero.
#
# Requirements: the managed stack up (managed.yml), tasks deployed
# (deploy-tasks.sh), the demo seed applied (seed-managed.ts — it creates the
# tenant_member rows the minted tokens rely on), and `pnpm install` done in
# the repo (the JWT is minted with apps/api's own jsonwebtoken).
#
# Everything is overridable via env; defaults match the demo seed:
#   SMOKE_API (http://localhost:3001)   SMOKE_DB_CONTAINER (open-migrate-db)
#   SMOKE_API_CONTAINER (open-migrate-api)
#   SMOKE_VERIFY_TENANT/SUB/MAPPING (demo tenant A, mail)
#   SMOKE_APPLY_TENANT/SUB/MAPPING  (demo tenant B, DAV)
#   SMOKE_POLLS (45) SMOKE_POLL_SLEEP (2) SMOKE_OUT (evidence file path)
#
# NOTE: runner debug logs print the full task environment (DATABASE_URL,
# SECRET_ENCRYPTION_KEY, the tr_prod_ key). The evidence file this script
# writes is therefore SECRET-BEARING — treat it like a credential file.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

API="${SMOKE_API:-http://localhost:3001}"
DB_CONTAINER="${SMOKE_DB_CONTAINER:-open-migrate-db}"
API_CONTAINER="${SMOKE_API_CONTAINER:-open-migrate-api}"
POLLS="${SMOKE_POLLS:-45}"
POLL_SLEEP="${SMOKE_POLL_SLEEP:-2}"
OUT="${SMOKE_OUT:-/tmp/openmig-smoke-managed-$(date -u +%Y%m%dT%H%M%SZ).txt}"

# Demo-seed fixtures (apps/api/src/scripts/seed-managed.ts).
VERIFY_TENANT="${SMOKE_VERIFY_TENANT:-a0000000-0000-4000-8000-000000000001}"
VERIFY_SUB="${SMOKE_VERIFY_SUB:-demo-owner-a}"
VERIFY_MAPPING="${SMOKE_VERIFY_MAPPING:-a0000000-0000-4000-8000-0000000000d1}"
APPLY_TENANT="${SMOKE_APPLY_TENANT:-b0000000-0000-4000-8000-000000000002}"
APPLY_SUB="${SMOKE_APPLY_SUB:-demo-owner-b}"
APPLY_MAPPING="${SMOKE_APPLY_MAPPING:-b0000000-0000-4000-8000-0000000000d1}"

exec > >(tee "$OUT") 2>&1
echo "########## smoke-managed $(date -u +%FT%TZ) — evidence: $OUT ##########"

fail=0
note() { printf '\n--- %s ---\n' "$*"; }

q() { docker exec "$DB_CONTAINER" sh -lc "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Atc \"$1\""; }

mint() { # mint <sub> <tenantId>  — signed with the API container's real secret
  (
    cd "$REPO_ROOT/apps/api" &&
      JWT_SECRET="$JW" SUB="$1" T="$2" node -e "
const jwt=require('jsonwebtoken');
console.log(jwt.sign({sub:process.env.SUB,email:process.env.SUB+'@smoke.local',tenantId:process.env.T,role:'owner'},process.env.JWT_SECRET,{expiresIn:'1h'}));"
  )
}

# http <method> <url> <token> — prints "<code> <body>" on one line
http() {
  local body code
  body="$(curl -sS -X "$1" -H "Authorization: Bearer $3" -w '\n%{http_code}' "$2")"
  code="${body##*$'\n'}"
  body="${body%$'\n'*}"
  printf '%s %s\n' "$code" "$body"
}

json_state() { # crude but dependency-free: first "state":"..." in the body
  printf '%s' "$1" | grep -o '"state":"[a-z-]*"' | head -1 | cut -d'"' -f4
}

# ---------- preflights ----------
note "preflights"
if ! curl -sf "$API/health" >/dev/null; then
  echo "FATAL: API not reachable at $API/health"
  exit 1
fi
if ! docker exec "$DB_CONTAINER" true 2>/dev/null; then
  echo "FATAL: cannot exec into DB container '$DB_CONTAINER'"
  exit 1
fi
if [ ! -d "$REPO_ROOT/apps/api/node_modules/jsonwebtoken" ]; then
  echo "FATAL: apps/api/node_modules/jsonwebtoken missing — run: pnpm install"
  exit 1
fi
JW="$(docker exec "$API_CONTAINER" printenv JWT_SECRET)" || {
  echo "FATAL: cannot read JWT_SECRET from '$API_CONTAINER'"
  exit 1
}
echo "preflights OK (API up, db reachable, jsonwebtoken present, secret read)"

# ---------- runner-log capture (before anything can AutoRemove) ----------
RUNNER_LOG_DIR="$(mktemp -d /tmp/openmig-runner-logs.XXXXXX)"
(
  # Capture every runner-* container's log stream the moment it appears.
  # The parent's exit ends this watcher via the PID check.
  while kill -0 $$ 2>/dev/null; do
    for c in $(docker ps --format '{{.Names}}' 2>/dev/null | grep '^runner-' || true); do
      if [ ! -f "$RUNNER_LOG_DIR/$c.log" ]; then
        touch "$RUNNER_LOG_DIR/$c.log"
        docker logs -f "$c" >"$RUNNER_LOG_DIR/$c.log" 2>&1 &
      fi
    done
    sleep 1
  done
) &
WATCHER_PID=$!
trap 'kill "$WATCHER_PID" 2>/dev/null || true' EXIT

# ---------- VERIFY half ----------
note "VERIFY — mapping $VERIFY_MAPPING (tenant $VERIFY_TENANT, sub $VERIFY_SUB)"
TOK_V="$(mint "$VERIFY_SUB" "$VERIFY_TENANT")"
read -r vcode vbody <<<"$(http POST "$API/api/migrations/$VERIFY_MAPPING/verify/start" "$TOK_V")"
echo "verify/start: HTTP $vcode"
echo "$vbody"
VERIFY_RESULT="not-started"
if [ "$vcode" = "202" ] || [ "$vcode" = "200" ]; then
  i=0
  while [ $i -lt "$POLLS" ]; do
    sleep "$POLL_SLEEP"
    i=$((i + 1))
    read -r rcode rbody <<<"$(http GET "$API/api/migrations/$VERIFY_MAPPING/verify/report" "$TOK_V")"
    state="$(json_state "$rbody")"
    if [ "$state" = "done" ] || [ "$state" = "failed" ]; then
      echo "[poll $i] $rbody"
      VERIFY_RESULT="$state"
      break
    fi
  done
  if [ "$VERIFY_RESULT" = "not-started" ]; then
    VERIFY_RESULT="timeout"
    echo "TIMEOUT after $((POLLS * POLL_SLEEP))s — landing the stuck row by hand (never leave 'running' pointing at nothing):"
    q "UPDATE verification_run SET state='failed', finished_at=now(), error='smoke-managed: landed by hand after $((POLLS * POLL_SLEEP))s poll timeout' WHERE tenant_id='$VERIFY_TENANT' AND mapping_id='$VERIFY_MAPPING' AND state='running'"
  fi
else
  VERIFY_RESULT="start-http-$vcode"
fi
echo "latest verification_run row:"
q "SELECT state, started_at, finished_at, left(coalesce(error,''),120) FROM verification_run WHERE tenant_id='$VERIFY_TENANT' AND mapping_id='$VERIFY_MAPPING' ORDER BY started_at DESC LIMIT 1"
[ "$VERIFY_RESULT" = "done" ] || fail=1

# ---------- APPLY half ----------
note "APPLY — mapping $APPLY_MAPPING (tenant $APPLY_TENANT, sub $APPLY_SUB)"
APPLY_RESULT="skipped-no-item"
HASH="$(q "SELECT natural_key_hash FROM item WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING' AND status='copied' AND target_ref IS NOT NULL ORDER BY natural_key_hash LIMIT 1")"
if [ -z "$HASH" ]; then
  echo "no eligible item (status='copied' with a target_ref) — apply half SKIPPED."
  echo "Run a sync on the apply mapping first (the demo scheduler does this on its own)."
else
  echo "eligible item hash: $HASH"
  echo "flag on + fabricate deletion evidence (both retracted below):"
  q "UPDATE mailbox_mapping SET allow_apply_deletions=true WHERE tenant_id='$APPLY_TENANT' AND id='$APPLY_MAPPING'"
  q "UPDATE item SET deletion_reported_at=now() WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING' AND natural_key_hash='$HASH' AND deletion_reported_at IS NULL"

  TOK_A="$(mint "$APPLY_SUB" "$APPLY_TENANT")"
  read -r acode abody <<<"$(http POST "$API/api/migrations/$APPLY_MAPPING/deletions/$HASH/apply" "$TOK_A")"
  echo "apply: HTTP $acode"
  echo "$abody"
  if [ "$acode" = "202" ] || [ "$acode" = "200" ]; then
    i=0
    APPLY_RESULT="timeout"
    while [ $i -lt "$POLLS" ]; do
      sleep "$POLL_SLEEP"
      i=$((i + 1))
      read -r rcode rbody <<<"$(http GET "$API/api/migrations/$APPLY_MAPPING/deletions/$HASH/receipt" "$TOK_A")"
      state="$(json_state "$rbody")"
      if [ "$state" = "applied" ] || [ "$state" = "refused" ] || [ "$state" = "failed" ]; then
        echo "[poll $i] $rbody"
        APPLY_RESULT="$state"
        break
      fi
    done
    if [ "$APPLY_RESULT" = "timeout" ]; then
      echo "TIMEOUT after $((POLLS * POLL_SLEEP))s — landing the stuck receipt by hand:"
      q "UPDATE apply_receipt SET state='failed', finished_at=now(), reason='smoke-managed: landed by hand after $((POLLS * POLL_SLEEP))s poll timeout' WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING' AND natural_key_hash='$HASH' AND state='queued'"
    fi
  else
    # A synchronous refusal (403/404) is the evaluator answering — legitimate.
    APPLY_RESULT="start-http-$acode"
  fi

  note "apply cleanup — flag off; retract evidence ONLY if never applied"
  q "UPDATE mailbox_mapping SET allow_apply_deletions=false WHERE tenant_id='$APPLY_TENANT' AND id='$APPLY_MAPPING'"
  # If the deletion WAS applied, the evidence must stand — retracting it would
  # leave an applied receipt pointing at an item that claims no deletion was
  # ever reported (a falsified record).
  q "UPDATE item SET deletion_reported_at=NULL WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING' AND natural_key_hash='$HASH' AND NOT EXISTS (SELECT 1 FROM apply_receipt r WHERE r.tenant_id='$APPLY_TENANT' AND r.mapping_id='$APPLY_MAPPING' AND r.natural_key_hash='$HASH' AND r.state='applied')"

  echo "receipts for this item:"
  q "SELECT left(natural_key_hash,12), state, coalesce(kind,''), coalesce(code,''), left(coalesce(reason,''),80) FROM apply_receipt WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING' AND natural_key_hash='$HASH' ORDER BY requested_at DESC LIMIT 3"

  case "$APPLY_RESULT" in applied | refused) : ;; *) fail=1 ;; esac
fi

# ---------- runner logs ----------
note "runner logs captured before AutoRemove"
sleep 2
found_logs=0
for f in "$RUNNER_LOG_DIR"/*.log; do
  [ -e "$f" ] || continue
  found_logs=1
  echo "== $f =="
  head -c 4000 "$f"
  echo
done
[ "$found_logs" = "1" ] || echo "(no runner containers appeared)"

# ---------- verdict ----------
note "verdict"
echo "verify: $VERIFY_RESULT   apply: $APPLY_RESULT"
if [ "$fail" = "0" ]; then
  echo "SMOKE PASS — evidence in $OUT"
else
  echo "SMOKE FAIL — evidence in $OUT"
fi
exit "$fail"
