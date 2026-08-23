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
#   SMOKE_API (http://localhost:3001)   SMOKE_DB_CONTAINER (ownpace-db)
#   SMOKE_API_CONTAINER (ownpace-api)
#   SMOKE_VERIFY_TENANT/SUB/MAPPING (demo tenant A, mail)
#   SMOKE_APPLY_TENANT/SUB/MAPPING  (demo tenant B, DAV)
#   SMOKE_POLLS (45) SMOKE_POLL_SLEEP (2) SMOKE_OUT (evidence file path)
#   SMOKE_PREPARE_APPLY (0)  1 = seed the demo DAV source with FRESH natural keys
#                            and enqueue a sync when the apply half has nothing
#                            to act on. For CI, which has nobody to prepare the
#                            box; OFF by hand, where manufacturing the fixture
#                            would hide the real state. Fresh rather than the
#                            fixed demo keys because this script tombstones one
#                            item per pass and a tombstone is never re-copied —
#                            see the prepare phase for what that cost (run #20).
#   SMOKE_PREPARE_POLLS (60) how long that preparation may wait, in POLL_SLEEPs.
#
# NOTE: runner debug logs print the full task environment (DATABASE_URL,
# SECRET_ENCRYPTION_KEY, the tr_prod_ key). The evidence file this script
# writes is therefore SECRET-BEARING — treat it like a credential file.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

API="${SMOKE_API:-http://localhost:3001}"
DB_CONTAINER="${SMOKE_DB_CONTAINER:-ownpace-db}"
API_CONTAINER="${SMOKE_API_CONTAINER:-ownpace-api}"
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
# container on `ownpace-network`. The API container, because it is a Node
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

# ---------- the last two services nothing speaks for (0084 T7.1) ----------
#
# `trigger-registry` and `trigger-docker-proxy` are what is left after the
# healthcheck audit was redone against the gate's own printed list rather than
# memory: FOUR services define no healthcheck, not seven, and `minio` and
# `trigger-tls` are already asserted above. These two were not asserted by
# anything at all.
#
# ASSERTED HERE RATHER THAN PROBED, for exactly the reason the other two were,
# and it is worth restating because the temptation is to "just add a
# healthcheck". A compose probe runs INSIDE the image, so it may only name a
# binary that image certainly has — and under `up -d --wait` a probe naming a
# missing binary does not misreport, it fails the bring-up and takes the whole
# gate with it. **Nothing in this repository has ever executed a command inside
# `registry:2` or `tecnativa/docker-socket-proxy`**, and that evidence cannot be
# gathered from a checkout: it needs a Docker daemon and those images pulled.
# Until somebody has done that, "the image probably has wget" is the guess that
# costs a bring-up, and an assertion from proven tooling is strictly better —
# when it is wrong the gate goes red with a sentence instead of never starting.
#
# What this does NOT do is make `docker compose ps` say "healthy", so the count
# of services without a healthcheck is unchanged at four. That is stated rather
# than glossed: this closes the COVERAGE gap, not the healthcheck one.
note "trigger-registry and trigger-docker-proxy (the last two unasserted services)"

# THE REGISTRY publishes on 127.0.0.1:5000, so the host's own curl reaches it —
# no exec, no assumption about what is inside the image.
#
# Any HTTP status counts, `000` (no response at all) does not. `/v2/` is the
# registry API's documented base and answers 200 or 401, but the assertion is
# deliberately "something is serving HTTP here" rather than a specific code:
# the claim that matters is the one the SUPERVISOR depends on, which is that
# task images can be pushed and pulled. A dead registry means every deploy
# fails, and the failure surfaces as a task that will not start rather than as
# anything naming the registry.
REGISTRY_PORT_CHECK="${SMOKE_REGISTRY_PORT:-5000}"
# NO `|| echo 000` HERE, and the unit test is what found that out. On a refused
# connection curl BOTH prints `000` (that is what `%{http_code}` is when there
# was no response) AND exits non-zero — so the fallback appended a second one,
# `reg_code` became `000000`, and `!= "000"` was true. The assertion could not
# fail. A check that cannot fail is worse than no check, because it reports as
# coverage.
reg_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${REGISTRY_PORT_CHECK}/v2/" 2>/dev/null)"
reg_code="${reg_code:-000}"
if [ "$reg_code" != "000" ]; then
  echo "trigger-registry: serving HTTP $reg_code on 127.0.0.1:${REGISTRY_PORT_CHECK}"
else
  echo "FAIL: nothing is serving HTTP on 127.0.0.1:${REGISTRY_PORT_CHECK}."
  echo "      The supervisor pushes and pulls task images through this registry, so a"
  echo "      dead one means every deploy fails — as a task that never starts, with"
  echo "      nothing in the message naming the registry."
  fail=1
fi

# THE DOCKER PROXY publishes no port; it is reachable only on the stack network,
# so this goes through the API container exactly as the minio assertion does —
# a Node image whose own entrypoint is node, which this script already execs
# into to read JWT_SECRET.
#
# `tcp://trigger-docker-proxy:2375` is the address managed.yml gives the
# supervisor as DOCKER_HOST, and `/_ping` is the Docker API's own liveness
# endpoint. `fetch` resolving is the assertion: it settles on ANY HTTP response
# and rejects only when nothing is listening.
#
# This is the service whose failure mode workplan 0018 spent itself on: the
# supervisor creates every runner container through this proxy, so when it is
# down an enqueue never becomes a runner — and that is invisible in a green CI,
# which is the entire reason this script exists.
if docker exec "$API_CONTAINER" node -e \
  "fetch('http://trigger-docker-proxy:2375/_ping').then(r=>{console.log('trigger-docker-proxy HTTP '+r.status);process.exit(0)}).catch(e=>{console.log('trigger-docker-proxy unreachable: '+e.message);process.exit(1)})"
then
  echo "trigger-docker-proxy: reachable from the API container on the stack network"
else
  echo "FAIL: the supervisor's DOCKER_HOST (tcp://trigger-docker-proxy:2375) answers nothing."
  echo "      Every runner container is created through this proxy, so an enqueue will"
  echo "      never become a runner — the exact failure 0018 T5 spent itself finding,"
  echo "      and the one a green CI hides."
  fail=1
fi

# ---------- VERIFY half ----------
#
# TWO MAPPINGS, and until 2026-08-19 only one of them was ever verified.
#
# The demo seed splits the domains across two tenants because `connection` has
# exactly one source + one target row per tenant, so a single tenant cannot
# point at Stalwart AND Nextcloud at once: tenant A is mail, tenant B is
# calendar/contact/file. This half ran against tenant A alone, so every managed
# run has reported `calendar/contacts/files: SKIPPED — verification was
# disabled in the config` and nobody read it as a gap. **No run had ever
# verified a calendar, a contact or a file on the managed stack** — the three
# domains were exercised by the sync (that is where the apply half's eligible
# item comes from) and checked by nothing.
verify_mapping() { # verify_mapping <tenant> <sub> <mapping> <label> <required-domains...>
  local tenant="$1" sub="$2" mapping="$3" label="$4"
  shift 4
  # GLOBALS on purpose, not sloppiness: `smoke-managed-verdict.unit.test.ts`
  # extracts these two guards out of this file and RUNS them, which is the only
  # way a shell decision gets tested rather than restated. A `local` is a syntax
  # error outside a function, so declaring them here would make the real lines
  # unextractable and the tests would have to paraphrase — which is exactly the
  # drift that let the apply half's skip-that-passed survive review.
  REQUIRED_DOMAINS=("$@")
  VERIFY_LABEL="$label"

  note "VERIFY ($label) — mapping $mapping (tenant $tenant, sub $sub)"
  local tok vcode vbody i rcode state
  tok="$(mint "$sub" "$tenant")"
  read -r vcode vbody <<<"$(http POST "$API/api/migrations/$mapping/verify/start" "$tok")"
  echo "verify/start: HTTP $vcode"
  echo "$vbody"
  VERIFY_RESULT="not-started"
  rbody=""
  if [ "$vcode" = "202" ] || [ "$vcode" = "200" ]; then
    i=0
    while [ $i -lt "$POLLS" ]; do
      sleep "$POLL_SLEEP"
      i=$((i + 1))
      read -r rcode rbody <<<"$(http GET "$API/api/migrations/$mapping/verify/report" "$tok")"
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
      q "UPDATE verification_run SET state='failed', finished_at=now(), error='smoke-managed: landed by hand after $((POLLS * POLL_SLEEP))s poll timeout' WHERE tenant_id='$tenant' AND mapping_id='$mapping' AND state='running'"
    fi
  else
    VERIFY_RESULT="start-http-$vcode"
  fi
  echo "latest verification_run row:"
  q "SELECT state, started_at, finished_at, left(coalesce(error,''),120) FROM verification_run WHERE tenant_id='$tenant' AND mapping_id='$mapping' ORDER BY started_at DESC LIMIT 1"
  [ "$VERIFY_RESULT" = "done" ] || fail=1

  # A VERIFY THAT CHECKED NOTHING IS NOT A PASS.
  #
  # The same shape as the apply half's skip-that-passed, and it was still here
  # after that one was fixed: `state: done` says the run finished, not that it
  # compared anything. On a mailbox with no mail, verify reports
  # `sourceCount: 0, targetCount: 0, PASS` — perfectly true, and worth nothing.
VERIFIED_ITEMS="$(json_number "$rbody" totalItemsSource)"
if [ "$VERIFY_RESULT" = "done" ] && [ "${VERIFIED_ITEMS:-0}" = "0" ]; then
  echo ""
  echo "verify ($VERIFY_LABEL) reached 'done' but compared NOTHING: totalItemsSource=0."
  echo "FAILING rather than passing: an empty source verifies clean by definition, and a"
  echo "gate that accepts it is reporting the absence of data as the absence of problems."
  echo "The source for this mapping needs seeding: mail comes from"
  echo "test/e2e/seed-imap-source.mjs, DAV from deploy/compose/seed-demo-dav-content.sh."
  fail=1
fi

  # AND A DOMAIN THAT WAS SKIPPED WAS NOT CHECKED, whatever the overall status
  # says. The report spells this out itself — every skipped domain carries an
  # issue with id `SKIPPED_<domain>` and the message "this domain was NOT
  # checked" — so the assertion is simply that the ids we require are absent.
  # Matching on that id rather than on the status field because the per-domain
  # blocks contain nested `issues` arrays, which no `[^}]*` grep survives.
for d in "${REQUIRED_DOMAINS[@]}"; do
  if printf '%s' "$rbody" | grep -q "SKIPPED_${d}"; then
    echo ""
    echo "verify ($VERIFY_LABEL) SKIPPED the '${d}' domain, which this mapping exists to cover."
    echo "The report says it plainly: 'this domain was NOT checked'. A verify that skips"
    echo "the domain in question is the same lie as an apply half that never runs — the"
    echo "run is green and the thing it was for did not happen."
    echo "Check the mapping's configured domains (seed-managed.ts: DemoTenant.domains)."
    fail=1
  else
    echo "verify ($VERIFY_LABEL): '${d}' was actually checked"
  fi
done
}

# Tenant A — mail, against the demo Stalwart.
verify_mapping "$VERIFY_TENANT" "$VERIFY_SUB" "$VERIFY_MAPPING" mail mail

# Tenant B — calendar, contacts and files, against the demo Nextcloud. The same
# mapping the apply half then acts on.
#
# DELIBERATELY NOT ASSERTED `PASS`, and the reason is this script itself. The
# apply half removes one real item from the target every run and the tombstone
# is permanent, so the target legitimately lacks items the source still lists —
# `missingOnTarget` is EXPECTED here and grows by one per run. Asserting PASS
# would make the gate red for its own correct behaviour. What is asserted is
# the part that was missing: that the three domains were CHECKED at all, and
# that the comparison had something in it.
verify_mapping "$APPLY_TENANT" "$APPLY_SUB" "$APPLY_MAPPING" dav calendar contacts files

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
# WHICH item, and why it must be a DISPOSABLE one.
#
# The apply half really deletes what it selects, and deliberately does NOT undo
# it: the cleanup below retracts the fabricated evidence only when the deletion
# was NOT applied, because retracting an applied one would leave a receipt
# pointing at an item claiming no deletion was ever reported -- a falsified
# record. The deleted key is then TOMBSTONED, and classifyKnownItem refuses
# forever to re-create a tombstoned natural key (it cannot tell a change of mind
# from an erasure request).
#
# So every run permanently consumed one item, and `ORDER BY natural_key_hash`
# meant that item was whichever FIXED demo fixture sorted first. Observed live
# 2026-08-20 across three runs of one stack: four tombstones, and the DAV verify
# degrading 66/66 -> 65/66 files and 3/3 -> 1/3 calendar until it FAILED. The
# gate was poisoning the fixtures its own other half measures, and no re-seed
# could repair it, because the keys were tombstoned.
#
# This is fixture exhaustion, the same class of failure as E2E (managed) #20 --
# and `seed-demo-dav-content.sh --fresh` was built by that fix precisely to mint
# keys NO TOMBSTONE CAN ALREADY OWN. So: prefer an item that came from a
# `--fresh` seed. Fixed fixtures are `openmig-demo-<type>-<n>.<ext>`; fresh ones
# carry a tag between the type and the index, so "digits immediately followed by
# the extension" identifies exactly the fixtures and nothing else.
ELIGIBLE="status IN ('copied','updated') AND coalesce(target_ref->>'id','') <> ''"
FIXTURE_RE="openmig-demo-(event|contact|file)-[0-9]+[.][a-z]+$"
HREF_EXPR="coalesce(source_ref_href, source_ref->>'href', '')"

pick_disposable() {
  q "SELECT natural_key_hash FROM item WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING' AND $ELIGIBLE AND $HREF_EXPR !~ '$FIXTURE_RE' ORDER BY first_seen_at DESC, natural_key_hash LIMIT 1"
}
pick_fixture() {
  q "SELECT natural_key_hash FROM item WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING' AND $ELIGIBLE ORDER BY natural_key_hash LIMIT 1"
}

HASH="$(pick_disposable)"
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
#
# `--fresh`, AND WHY THE PLAIN CALL COULD NOT WORK HERE (run #20, 2026-08-19).
# The apply half below applies a REAL deletion, and `applyDeletion` writes
# `status='tombstoned'`. `classifyKnownItem` then refuses forever to re-create a
# tombstoned natural key — deliberately: it cannot tell a change of mind from an
# erasure request. The bring-up seed writes FIXED keys (`openmig-demo-event-1`
# and friends), so one green run spent one of exactly six items and re-seeding
# could never give it back. Run #19 spent the last one; run #20, on a commit
# whose PR was green and whose self-hosted e2e was green, failed with "no
# eligible item" against 73 rows that were all `tombstoned` or `adopted`. The
# gate was eating its own fixture, one run at a time, and nothing about it was
# self-correcting.
#
# So prepare asks for keys the ledger has NEVER seen. That is the one kind a
# tombstone cannot already own, and it is still an honest fixture: it goes into
# the SOURCE, and a real sync has to copy it before anything here is eligible.
if [ -z "$HASH" ] && [ "${SMOKE_PREPARE_APPLY:-0}" = "1" ]; then
  note "prepare (SMOKE_PREPARE_APPLY=1) — give the apply half something real to act on"

  if "$SCRIPT_DIR/seed-demo-dav-content.sh" --fresh; then
    echo "prepare: DAV source seeded with fresh, never-tombstoned natural keys"
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
    HASH="$(pick_disposable)"
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
  # Told apart from a copy failure, because the fixes have nothing in common.
  # See the TOMBSTONE branch below.
  SPENT="$(q "SELECT count(*) FROM item WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING' AND status='tombstoned'")"
  echo ""

  # THE FIXTURES ARE STILL THERE, and we refused them on purpose. Checked FIRST
  # because it is the only branch where eligible items exist and the gate
  # declined them: every branch below explains an ABSENCE, and reading this
  # state as one of those sends the reader hunting a sync bug again — which is
  # precisely how run #20 was misread.
  FIXTURE_HASH="$(pick_fixture)"
  if [ -n "$FIXTURE_HASH" ]; then
    echo "DIAGNOSIS: eligible items exist, but only the FIXED demo fixtures — and this"
    echo "gate now REFUSES to spend one. Applying a deletion tombstones its natural key,"
    echo "classifyKnownItem never re-creates it, and the verify half measures those same"
    echo "fixtures. Spending one to make this run green degrades every later run: three"
    echo "runs of one stack on 2026-08-20 took files 66/66 -> 65/66 and calendar 3/3 ->"
    echo "1/3 doing exactly that, until verify FAILED. Passing here at that price is the"
    echo "same trade this script exists to refuse."
    echo "  ./deploy/compose/seed-demo-dav-content.sh --fresh   # keys no tombstone owns"
    echo "  # then let a sync tick copy them, and re-run this smoke"
    echo "(CI needs no hand-holding: SMOKE_PREPARE_APPLY=1 seeds --fresh in prepare.)"
  elif [ "${TOTAL:-0}" = "0" ]; then
    echo "DIAGNOSIS: the mapping has no items at all — nothing has ever synced here."
    echo "The demo seed creates tenants, connections and mappings but NO items, and"
    echo "setup-nextcloud-users.sh provisions ACCOUNTS with no calendar, contact or"
    echo "file content in them. Content comes from seed-demo-dav-content.sh, which"
    echo "setup-managed-demo.sh now runs at bring-up — so seeing this on a freshly"
    echo "bootstrapped stack means THAT step did not run or did not take."
    echo "  ./deploy/compose/seed-demo-dav-content.sh --verify   # is the content there?"
    echo "  ./deploy/compose/seed-demo-dav-content.sh            # put it there"
    echo "  # then let the scheduler's sync tick copy it, and re-run this smoke"
  elif [ "${COPIED:-0}" = "0" ] && [ "${SPENT:-0}" != "0" ]; then
    # THE RUN #20 FAILURE, and the reason it is not the branch below.
    #
    # This half applies a real deletion, `applyDeletion` writes
    # `status='tombstoned'`, and `classifyKnownItem` refuses forever to
    # re-create a tombstoned natural key. The bring-up seed writes FIXED keys,
    # so every green run spent one of six items and re-seeding could not give it
    # back. Run #19 spent the last; run #20 found nothing eligible and reported
    # "a product fault" — which sent the next reader hunting a copy bug in a
    # sync that had never once failed.
    echo "DIAGNOSIS: this mapping's fixture is SPENT, not broken. ${SPENT} of ${TOTAL:-0} items"
    echo "are 'tombstoned' — removed by an apply, which is what THIS SCRIPT does to one"
    echo "item every time it passes. A tombstoned natural key is never re-copied"
    echo "(classifyKnownItem: it cannot tell a change of mind from an erasure request),"
    echo "so re-seeding the FIXED demo keys cannot restore eligibility. Seed keys the"
    echo "ledger has never seen instead — which is what the prepare phase above does,"
    echo "and seeing this line means that phase did not run or did not take:"
    echo "  ./deploy/compose/seed-demo-dav-content.sh --fresh   # new UIDs and paths"
    echo "  # then enqueue a sync on this mapping and re-run this smoke"
  elif [ "${COPIED:-0}" = "0" ]; then
    echo "DIAGNOSIS: items exist, none is 'copied' or 'updated', and none is a spent"
    echo "tombstone either — a sync ran and the copying did not succeed. This is a"
    echo "product fault, not a missing fixture; the breakdown above says which domain"
    echo "and status it stalled in."
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

# ---------- the identity provider, and the three answers to an invitation ----------
#
# WHY THIS SECTION EXISTS. Zitadel was added to managed.yml in #496 and was not
# in the bring-up's service list, so for three weeks it was defined, required in
# .env, interpolated by every compose command — and never started. Nothing
# invoked setup-zitadel.sh either. The gate went green the whole time and said
# precisely nothing about whether anybody could sign in (workplan 0099).
#
# WHAT THIS DOES NOT DO, said plainly because a gate that overstates itself is
# worse than one that is narrow. It does NOT drive a browser sign-in. Getting a
# real token out of Zitadel means its session API and an OIDC authorization code
# exchange, and that is worth doing — see 0099's "what is still owed". What is
# here is the half that can be asserted honestly: the issuer is RUNNING and
# serving the exact document `oidc.ts` and `auth.ts` both read, and the
# product's own invitation logic is exercised end to end through real HTTP.
note "identity provider"

# Read out of the API CONTAINER, the way JWT_SECRET is above — not out of .env.
# The question is what the running service verifies tokens against, and a file
# on the host is at best a claim about that.
ISSUER="$(docker exec "$API_CONTAINER" printenv JWT_ISSUER 2>/dev/null || true)"
if [ -z "$ISSUER" ]; then
  # Not a warning. JWT_ISSUER is written by setup-zitadel.sh, which the bring-up
  # now runs — its absence means that step did not happen, and a stack whose
  # sign-in was never configured is exactly what this section exists to catch.
  echo "the API has no JWT_ISSUER — setup-zitadel.sh has not provisioned this stack."
  fail=1
else
  # FROM INSIDE THE API CONTAINER, and this is the whole point of the check.
  #
  # Curling from the host would prove the wrong thing. `ZITADEL_EXTERNALDOMAIN`
  # defaults to `localhost`, so `JWT_ISSUER` becomes http://localhost:3126 —
  # which the HOST can reach, because the port is published, and which the API
  # container cannot, because there `localhost` is the API itself. A host-side
  # check would go green against a stack whose API can verify no token at all.
  #
  # The question is only ever "can the thing that verifies tokens reach the keys",
  # so it is asked from there.
  DISCOVERY="$(docker exec "$API_CONTAINER" sh -lc "curl -sS --max-time 10 '${ISSUER%/}/.well-known/openid-configuration'" 2>/dev/null || true)"
  DECLARED="$(printf '%s' "$DISCOVERY" | jq -r '.issuer // empty' 2>/dev/null || true)"
  JWKS="$(printf '%s' "$DISCOVERY" | jq -r '.jwks_uri // empty' 2>/dev/null || true)"

  # Byte for byte, and that is the point: OIDC Discovery §4.3 says a document
  # declaring a different issuer is not this issuer, and both `oidc.ts` and
  # `auth.ts` refuse on a mismatch. A trailing slash is the difference between
  # a working sign-in and a refusal nobody can explain.
  if [ "$DECLARED" != "${ISSUER%/}" ] && [ "$DECLARED" != "$ISSUER" ]; then
    echo "the issuer at $ISSUER declares '$DECLARED' (as seen BY THE API) — sign-in would refuse this."
    echo "If DECLARED is empty, the API cannot reach the issuer at all. The usual cause is"
    echo "ZITADEL_EXTERNALDOMAIN=localhost: reachable from the host, and the API container"
    echo "itself from inside. It has to be an address BOTH a browser and the API resolve."
    fail=1
  else
    echo "issuer: $ISSUER (declares its own name)"
  fi

  # The keys the API verifies every token against. Discovery naming a jwks_uri
  # nothing serves is a stack that authenticates nobody, and it looks healthy.
  if [ -z "$JWKS" ] || ! docker exec "$API_CONTAINER" sh -lc "curl -sf --max-time 10 '$JWKS'" >/dev/null 2>&1; then
    echo "jwks_uri '$JWKS' is not fetchable — no token could be verified."
    fail=1
  else
    echo "jwks:   $JWKS (fetchable)"
  fi
fi

note "an invitation, answered three ways"
#
# Accept, decline and SKIP, against the real API over real HTTP. Skip is the one
# worth stating: it makes NO call at all, so what is asserted is that an
# unanswered invitation is still there afterwards and still offered. A test that
# "skipped" by doing something would be testing the wrong thing.
#
# The tokens are minted with the API's own JWT_SECRET, like every other check in
# this script — this section is about the product's invitation logic, not about
# Zitadel's token endpoint. `email_verified` is asserted because the claim is
# what the policies key on: without it there is nothing to answer.
INV_EMAIL="smoke-invitee-$$@smoke.local"
INV_SUB="smoke-invitee-$$"
INV_TOKEN="$(
  cd "$REPO_ROOT/apps/api" &&
    JWT_SECRET="$JW" SUB="$INV_SUB" EM="$INV_EMAIL" node -e "
const jwt=require('jsonwebtoken');
console.log(jwt.sign({sub:process.env.SUB,email:process.env.EM,email_verified:true},process.env.JWT_SECRET,{expiresIn:'1h'}));"
)"

# Three open invitations, written the way granting an access request writes one:
# addressed to an email, holding a `pending:` placeholder nobody owns yet.
for n in 1 2 3; do
  q "INSERT INTO tenant (id, name, status) VALUES ('$(printf '0099%04d-e29b-41d4-a716-44665544%04d' "$n" "$n")', 'Smoke Org ${n}', 'active') ON CONFLICT (id) DO NOTHING" >/dev/null
  q "INSERT INTO tenant_member (tenant_id, user_id, email, role, status, invited_at)
     VALUES ('$(printf '0099%04d-e29b-41d4-a716-44665544%04d' "$n" "$n")', 'pending:smoke-$$-${n}', '${INV_EMAIL}', 'owner', 'invited', now())
     ON CONFLICT DO NOTHING" >/dev/null
done

ME="$(http GET "$API/api/me" "$INV_TOKEN")"
offered="$(printf '%s' "${ME#* }" | grep -o '"tenantId"' | wc -l | tr -d ' ')"
echo "offered: $offered invitation(s) before answering"
if [ "${ME%% *}" != "200" ] || [ "$offered" -lt 3 ]; then
  # Reporting, not claiming: /api/me used to BIND every invitation on sight,
  # which is the behaviour 0099 removed. Three written, three offered.
  echo "expected /api/me to OFFER three invitations, got: $ME"
  fail=1
fi

T1="$(printf '0099%04d-e29b-41d4-a716-44665544%04d' 1 1)"
T2="$(printf '0099%04d-e29b-41d4-a716-44665544%04d' 2 2)"
T3="$(printf '0099%04d-e29b-41d4-a716-44665544%04d' 3 3)"

acc="$(http POST "$API/api/invitations/${T1}/accept" "$INV_TOKEN")"
dec="$(http POST "$API/api/invitations/${T2}/decline" "$INV_TOKEN")"
# T3 IS THE SKIP. Deliberately no request.

echo "accept:  $acc"
echo "decline: $dec"
[ "${acc%% *}" = "200" ] || { echo "accepting an invitation failed"; fail=1; }
[ "${dec%% *}" = "200" ] || { echo "declining an invitation failed"; fail=1; }

s1="$(q "SELECT status FROM tenant_member WHERE tenant_id='${T1}' AND email='${INV_EMAIL}'")"
u1="$(q "SELECT user_id FROM tenant_member WHERE tenant_id='${T1}' AND email='${INV_EMAIL}'")"
s2="$(q "SELECT status FROM tenant_member WHERE tenant_id='${T2}' AND email='${INV_EMAIL}'")"
u2="$(q "SELECT user_id FROM tenant_member WHERE tenant_id='${T2}' AND email='${INV_EMAIL}'")"
s3="$(q "SELECT status FROM tenant_member WHERE tenant_id='${T3}' AND email='${INV_EMAIL}'")"
echo "accepted -> ${s1} (${u1})   declined -> ${s2} (${u2})   skipped -> ${s3}"

[ "$s1" = "active" ] || { echo "accepting did not make the membership active"; fail=1; }
[ "$u1" = "$INV_SUB" ] || { echo "accepting did not bind the subject"; fail=1; }
[ "$s2" = "declined" ] || { echo "declining did not record the refusal"; fail=1; }
# The property migration 0008's WITH CHECK exists to guarantee: a refusal names
# nobody. If this ever reads a real subject, the database stopped enforcing it.
case "$u2" in
  pending:*) ;;
  *) echo "declining BOUND the decliner ($u2) — it must leave the pending id"; fail=1 ;;
esac
[ "$s3" = "invited" ] || { echo "the skipped invitation did not stay open (got '$s3')"; fail=1; }

# And it is still OFFERED, which is what makes skipping a deferral rather than a
# quiet loss. One left: the accepted one is a membership now, the declined one
# is answered.
ME_AFTER="$(http GET "$API/api/me" "$INV_TOKEN")"
left="$(printf '%s' "${ME_AFTER#* }" | grep -o '"invitations":\[[^]]*\]' | grep -o '"tenantId"' | wc -l | tr -d ' ')"
echo "still offered after answering: $left"
[ "$left" = "1" ] || { echo "expected exactly the skipped invitation to remain, got $left"; fail=1; }

# Clean up after itself. This gate runs nightly against a long-lived stack, and
# a smoke that leaves rows behind grows the thing it is measuring.
for t in "$T1" "$T2" "$T3"; do
  q "DELETE FROM tenant_member WHERE tenant_id='${t}' AND email='${INV_EMAIL}'" >/dev/null
  q "DELETE FROM tenant WHERE id='${t}'" >/dev/null
done

# ---------- verdict ----------
note "verdict"
echo "verify: $VERIFY_RESULT   apply: $APPLY_RESULT"
if [ "$fail" = "0" ]; then
  echo "SMOKE PASS — evidence in $OUT"
else
  echo "SMOKE FAIL — evidence in $OUT"
fi
exit "$fail"
