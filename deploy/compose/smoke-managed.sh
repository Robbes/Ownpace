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
# (`refused` is a legitimate answer — the gates said no and said why) AND at
# least one runner container having appeared. `failed`, a timeout, a missing
# eligible item, or no runner at all each exit non-zero — the last two used to
# print a remark and pass, which is how the apply half reached the gate's first
# green run (2026-08-18) never once having executed.
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
#   SMOKE_PREPARE_APPLY (0)  1 = seed the demo DAV source and enqueue a sync when
#                            the apply half has nothing to act on. For CI, which
#                            has nobody to prepare the box; OFF by hand, where
#                            manufacturing the fixture would hide the real state.
#   SMOKE_PREPARE_POLLS (60) how long that preparation may wait, in POLL_SLEEPs.
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
# The prepare phase waits on a whole sync pass (runner start + DAV round trips),
# which is a longer thing than polling one already-running verify.
PREP_POLLS="${SMOKE_PREPARE_POLLS:-60}"
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

json_number() { # json_number <body> <key> — first "key":N in the body, or empty
  printf '%s' "$1" | grep -o "\"$2\":[0-9]*" | head -1 | cut -d: -f2
}

# ---------- preflights ----------
note "preflights"
if ! curl -sf "$API/health" >/dev/null; then
  echo "FATAL: API not reachable at $API/health"
  exit 1
fi
# WEB half (2026-08-10): the stack used to pass this smoke with a web
# container whose nginx had no /api proxy — every browser API call got
# index.html back. Assert both that the SPA serves AND that /api through the
# web origin reaches the API (JSON, not the SPA fallback's HTML).
WEB="${SMOKE_WEB:-http://localhost:3123}"
if ! curl -sf "$WEB/" | grep -qi '<html'; then
  echo "FATAL: web app not serving at $WEB/"
  exit 1
fi
web_health="$(curl -sf "$WEB/api/health")" || {
  echo "FATAL: $WEB/api/health unreachable — the web container's /api proxy is not working"
  exit 1
}
case "$web_health" in
  *'"status"'*) ;;
  *)
    echo "FATAL: $WEB/api/health returned something other than the API's health JSON —"
    echo "       the /api proxy is falling through to the SPA fallback. Got: ${web_health:0:120}"
    exit 1
    ;;
esac
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

# ---------- the two services nothing else speaks for (0084) ----------
#
# `minio` and `trigger-tls` are the last two of the original seven that are
# neither probed by a healthcheck nor proven functionally by the rest of this
# run. 0084 asked for healthchecks. They are asserted here instead, and the
# reason is the same rule those healthchecks were chosen under: **a probe runs
# INSIDE the image, so it may only name a binary that image certainly has —
# and under `up -d --wait` a probe naming a missing binary does not misreport,
# it fails the bring-up and takes the gate with it.**
#
# `nextcloud`'s probe could be written because `setup-nextcloud-users.sh` has
# run exactly that curl against exactly that image for months. Nothing in this
# repository has ever executed a command inside `bitnamilegacy/minio` or
# `caddy:2-alpine`, so there is no such evidence for either, and "the image
# probably has curl" is the guess that costs a bring-up.
#
# An assertion here has none of that exposure: it runs from a place whose
# tooling IS proven, and when it is wrong the gate goes red with a sentence
# instead of never starting. What it cannot do is make `docker compose ps` say
# "healthy" — so T7.1's count of services without a healthcheck is unchanged,
# and 0084 says so.
note "minio and trigger-tls (0084 — the last two unasserted services)"

# MINIO is network-internal (no published port), so this goes through a
# container on `open-migrate-network`. The API container, because it is a Node
# image whose own entrypoint is node — the same reasoning the trigger probes
# use — and because this script already execs into it to read JWT_SECRET.
#
# `fetch` resolving is the whole assertion. It settles on ANY HTTP response,
# 403 and 404 included, and rejects only when nothing is listening. That is
# deliberate: `/minio/health/live` is MinIO's documented endpoint, but a probe
# that depends on a named path goes quietly wrong the day an upstream image
# moves it, and "something is serving HTTP on minio:9000" is the claim
# trigger-api actually depends on (OBJECT_STORE_BASE_URL points there).
if docker exec "$API_CONTAINER" node -e \
  "fetch('http://minio:9000/minio/health/live').then(r=>{console.log('minio HTTP '+r.status);process.exit(0)}).catch(e=>{console.log('minio unreachable: '+e.message);process.exit(1)})"
then
  echo "minio: reachable from the API container on the stack network"
else
  echo "FAIL: nothing is serving HTTP on minio:9000."
  echo "      trigger-api's OBJECT_STORE_BASE_URL points there, so any task"
  echo "      payload over the inline limit fails — silently, until one is big"
  echo "      enough. This is the state the service existed to fix."
  fail=1
fi

# TRIGGER-TLS publishes a port, so the host's own curl is enough — no exec, no
# assumption about what is inside the Caddy image.
#
# BY IP, NOT BY NAME, and that is load-bearing. The Caddyfile's site address is
# `{$TRIGGER_TLS_HOST}:3443`, which on a real box is the machine's VPN address,
# so a request to `https://localhost:3443/` sends an SNI that matches no site
# and can die in the handshake. curl sends no SNI for an IP literal, which is
# exactly the case `default_sni` exists for — rule 2 in trigger-tls.Caddyfile,
# learned the hard way on 2026-08-01.
#
# `-k` because the certificate is internally minted on purpose: no public CA
# signs a private IP. A status code — ANY status code — means TLS terminated
# and Caddy answered. `000` is curl for "no response at all".
TLS_PORT="${TRIGGER_TLS_PORT:-3443}"
tls_code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 \
  "https://127.0.0.1:${TLS_PORT}/" 2>/dev/null || echo 000)"
if [ "$tls_code" != "000" ]; then
  echo "trigger-tls: TLS terminated on 127.0.0.1:${TLS_PORT} (HTTP ${tls_code})"
else
  echo "FAIL: nothing answered https://127.0.0.1:${TLS_PORT}/."
  echo "      That front is how a browser reaches the Trigger dashboard at all —"
  echo "      its production-mode Secure cookies make plain http unusable from"
  echo "      anything but localhost. If this is red, the dashboard is"
  echo "      unreachable for every operator who is not sitting at the machine."
  fail=1
fi

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

# A VERIFY THAT CHECKED NOTHING IS NOT A PASS.
#
# The same shape as the apply half's skip-that-passed, and it was still here
# after that one was fixed: `state: done` says the run finished, not that it
# compared anything. On a mailbox with no mail, verify reports
# `sourceCount: 0, targetCount: 0, PASS` — perfectly true, and worth nothing.
#
# It has never fired on the Spark because that box happens to hold three
# messages somebody put there by hand years into the demo's life. Nothing in
# this repository seeds them (0084's remaining gap), so on any other machine
# this half has been vacuous and green. Better to say so loudly than to keep
# reporting a pass over an empty mailbox.
VERIFIED_ITEMS="$(json_number "$rbody" totalItemsSource)"
if [ "$VERIFY_RESULT" = "done" ] && [ "${VERIFIED_ITEMS:-0}" = "0" ]; then
  echo ""
  echo "verify reached 'done' but compared NOTHING: totalItemsSource=0."
  echo "FAILING rather than passing: an empty mailbox verifies clean by definition, and a"
  echo "gate that accepts it is reporting the absence of data as the absence of problems."
  echo "The demo's mail source needs seeding — see 0084's 'what is still owed'. Until then"
  echo "this half can only be honest by refusing."
  fail=1
fi

# ---------- APPLY half ----------
note "APPLY — mapping $APPLY_MAPPING (tenant $APPLY_TENANT, sub $APPLY_SUB)"
APPLY_RESULT="skipped-no-item"
# `target_ref` is `jsonb NOT NULL DEFAULT '{}'` (schema-pg.ts), so the
# `target_ref IS NOT NULL` this used to say was true of every row ever written
# — a predicate that read like "and it landed somewhere on the target" and
# filtered nothing. The ledger stores the handle as `{"id": "..."}`, so that is
# what has to be non-empty.
# ELIGIBILITY MIRRORS THE PRODUCT'S OWN GATE, which is `copied` OR `updated`
# — see `ownershipCheck` in packages/core/src/apply-deletion.ts, whose comment
# insists the same list be an equality rather than an approximation.
#
# It asked for `copied` alone until run #18, and that is how the gate came to
# print an eligible item inside its own diagnosis and then declare there was
# none: `file|updated|1|1` — one updated file, with a target_ref id, which the
# apply path would have accepted. `updated` means WE wrote over a copy we had
# written before; `copied` means we created it. Both are ours to remove. Only
# `adopted` is not, and the product refuses that one for a reason worth keeping
# separate: those bytes were the account owner's before we arrived.
#
# `smoke-managed-verdict.unit.test.ts` reads that function and fails if these
# two lists ever stop agreeing, in either direction.
HASH="$(q "SELECT natural_key_hash FROM item WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING' AND status IN ('copied','updated') AND coalesce(target_ref->>'id','') <> '' ORDER BY natural_key_hash LIMIT 1")"
# ---------- optional: make the precondition exist, rather than wait for it ----------
# OFF by default. Run by hand, this script is an ACCEPTANCE test: it reports what
# the stack is, and manufacturing its own fixture would be the same class of lie
# as the skip-that-passed. In CI there is nobody to prepare the box, so the gate
# sets SMOKE_PREPARE_APPLY=1 and the preparation happens here — visibly, as its
# own narrated phase, and still ending in the same honest check.
#
# Both halves are needed and neither is enough alone:
#   the demo DAV source may have no content, and the scheduler's own cadence for
#   a mapping with no schedule is DEFAULT_SYNC_SCHEDULE = */15, which is far
#   longer than a gate should sit waiting. So: seed the source, then enqueue the
#   sync directly.
#
# THE SEEDING IS NOW A FALLBACK, not the only path. `setup-managed-demo.sh`
# seeds the DAV source at bring-up, beside the accounts it fills (0084) — so on
# a stack brought up since 2026-08-19 this call finds the same fixed resources
# already there and overwrites them, which is a no-op in every sense that
# matters. It stays because a stack older than that change, or one whose demo
# was reprovisioned by hand, still needs it, and because a prepare phase that
# assumes its precondition would be the same mistake in a different place.
if [ -z "$HASH" ] && [ "${SMOKE_PREPARE_APPLY:-0}" = "1" ]; then
  note "prepare (SMOKE_PREPARE_APPLY=1) — give the apply half something real to act on"

  if "$SCRIPT_DIR/seed-demo-dav-content.sh"; then
    echo "prepare: DAV source seeded"
  else
    echo "prepare: SEEDING FAILED — the diagnosis below will say what the ledger holds."
  fi

  TOK_P="$(mint "$APPLY_SUB" "$APPLY_TENANT")"
  # An explicit JSON body: the endpoint runs req.body through zod, and an absent
  # body is not the same thing as an empty object.
  sync_out="$(curl -sS -X POST -H 'Content-Type: application/json' -d '{"type":"delta"}' \
    -H "Authorization: Bearer $TOK_P" -w '\n%{http_code}' \
    "$API/api/migrations/$APPLY_MAPPING/sync")"
  echo "prepare: sync enqueue -> HTTP ${sync_out##*$'\n'}"
  echo "prepare: ${sync_out%$'\n'*}"

  # Poll for the row the apply half needs. A sync is a Trigger.dev run: a runner
  # container has to start before anything is written, so seconds, not instants.
  i=0
  while [ $i -lt "$PREP_POLLS" ]; do
    sleep "$POLL_SLEEP"
    i=$((i + 1))
    HASH="$(q "SELECT natural_key_hash FROM item WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING' AND status IN ('copied','updated') AND coalesce(target_ref->>'id','') <> '' ORDER BY natural_key_hash LIMIT 1")"
    if [ -n "$HASH" ]; then
      echo "prepare: an eligible item appeared after $((i * POLL_SLEEP))s"
      break
    fi
  done
  [ -n "$HASH" ] || echo "prepare: still nothing after $((PREP_POLLS * POLL_SLEEP))s — see the diagnosis below."
fi

if [ -z "$HASH" ]; then
  # NOT a skip. Found in the gate's first green run (e2e-managed #6, 2026-08-18):
  # this branch printed "SKIPPED", left `fail` untouched, and the verdict below
  # said "apply: skipped-no-item" and "SMOKE PASS" three lines apart. The header
  # of this file has always said success is verify `done` AND apply terminal —
  # so the code contradicted its own contract, and the half this script exists
  # to cover had never once run under CI.
  #
  # The precondition is nobody's accident: seed-managed.ts creates tenants,
  # connections and mappings but NO items. Only a real sync produces one.
  echo "no eligible item (status 'copied' or 'updated' with a target_ref id) on this mapping."
  echo "FAILING rather than skipping: an apply half that never ran proves nothing"
  echo "about the path it exists to cover, and a pass here would make this script"
  echo "the very thing it was written to catch."
  echo ""

  # SAY WHICH of the three it is. This message used to be one paragraph for
  # every way of having nothing to act on, and the three have entirely
  # different fixes — so telling them apart meant going and querying the box by
  # hand, which across runs #7, #8 and #9 is exactly what it cost. A refusal
  # that names a symptom and not a state is only half a refusal (rule 9).
  echo "what IS on this mapping:"
  TOTAL="$(q "SELECT count(*) FROM item WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING'")"
  COPIED="$(q "SELECT count(*) FROM item WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING' AND status IN ('copied','updated')")"
  q "SELECT domain, status, count(*), count(*) FILTER (WHERE coalesce(target_ref->>'id','') <> '') AS with_target_id FROM item WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING' GROUP BY 1,2 ORDER BY 1,2" \
    | sed 's/^/  /'
  echo "  (total ${TOTAL:-0}, eligible ${COPIED:-0} — status copied or updated)"
  echo ""

  if [ "${TOTAL:-0}" = "0" ]; then
    echo "DIAGNOSIS: the mapping has no items at all — nothing has ever synced here."
    echo "The demo seed creates tenants, connections and mappings but NO items, and"
    echo "setup-nextcloud-users.sh provisions ACCOUNTS with no calendar, contact or"
    echo "file content in them. Content comes from seed-demo-dav-content.sh, which"
    echo "setup-managed-demo.sh now runs at bring-up — so seeing this on a freshly"
    echo "bootstrapped stack means THAT step did not run or did not take."
    echo "  ./deploy/compose/seed-demo-dav-content.sh --verify   # is the content there?"
    echo "  ./deploy/compose/seed-demo-dav-content.sh            # put it there"
    echo "  # then let the scheduler's sync tick copy it, and re-run this smoke"
  elif [ "${COPIED:-0}" = "0" ]; then
    echo "DIAGNOSIS: items exist but NONE is 'copied' or 'updated' — a sync ran and"
    echo "the copying did not succeed. This is a product fault, not a missing"
    echo "fixture; the breakdown above says which domain and status it stalled in."
    echo "  docker exec $DB_CONTAINER psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Atc \\"
    echo "    \"SELECT level,message,at FROM run_event WHERE tenant_id='$APPLY_TENANT' ORDER BY at DESC LIMIT 20\""
  else
    echo "DIAGNOSIS: there ARE eligible items, but none carries a target_ref id."
    echo "Something wrote the ledger row without the handle the target returned,"
    echo "which leaves an item that cannot be acted on and cannot be traced back."
    echo "That is a bug in the sync's ledger write, not a missing precondition."
  fi
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

fi
# Outside the `if` on purpose — see the comment in its empty branch. Every
# APPLY_RESULT is judged here, `skipped-no-item` among them.
case "$APPLY_RESULT" in applied | refused) : ;; *) fail=1 ;; esac

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
if [ "$found_logs" != "1" ]; then
  # 0018 T5's entire lesson, restated as an assertion rather than a remark:
  # an enqueue that never becomes a runner container on this machine is the
  # failure a green CI hides. This used to be an echo, so the one thing this
  # script was written to detect could happen without changing its verdict.
  #
  # Caveat worth knowing before blaming the stack: the watcher above polls
  # `docker ps` once a second, so a runner that lived under a second could be
  # missed. For a real verify task that would itself be worth investigating —
  # and if it ever proves flaky, the fix is an event-based capture, not a
  # softer assertion.
  echo "NO runner containers appeared during this smoke."
  fail=1
fi

# ---------- verdict ----------
note "verdict"
echo "verify: $VERIFY_RESULT   apply: $APPLY_RESULT"
if [ "$fail" = "0" ]; then
  echo "SMOKE PASS — evidence in $OUT"
else
  echo "SMOKE FAIL — evidence in $OUT"
fi
exit "$fail"
