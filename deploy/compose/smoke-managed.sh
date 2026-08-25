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
#   Offboarding — close a tenant and reopen it, on the throwaway tenant the
#     invitation phase created and deletes. The closure ROW is what is checked,
#     not the response: it is what the purge job reads, and its window is
#     somebody's erasure date.
#   Reports — the four route families no gate had ever asked a running stack
#     for: readiness, shared addresses, the permission report, billing and its
#     invoices. Reads, so they change nothing; asserted on SHAPE, so a 200 that
#     dropped a key fails.
#   Balance — take back what this run added. A prepare that seeds six DAV
#     resources into the demo source, and a sync that copies them into the demo
#     target, used to leave both there for good; this gate runs nightly against
#     a long-lived stack it also measures. Source object, target copy and ledger
#     row are removed together, because any two of the three without the
#     third leaves a record that disagrees with reality. The tombstone stays:
#     net zero minus one erasure per run, by design (ADR-0024).
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
#   SMOKE_TARGET_DAV_USER/PASSWORD (tenant-b-target) the other end of the apply
#                            mapping, so the balance section can take the copies
#                            back out of it.
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
# Tenant B's TARGET account — the other end of the mapping above, and the half
# the balance section takes back. Same source: seed-managed.ts.
TARGET_DAV_USER="${SMOKE_TARGET_DAV_USER:-tenant-b-target}"
TARGET_DAV_PASSWORD="${SMOKE_TARGET_DAV_PASSWORD:-tenant_b_target_pw}"

# Set by the prepare phase when it seeds, read by the balance section at the
# end. Empty means prepare did not run, and then there is nothing to take back —
# which is a state to report, not to paper over.
BALANCE_TAG=""

exec > >(tee "$OUT") 2>&1
echo "########## smoke-managed $(date -u +%FT%TZ) — evidence: $OUT ##########"

fail=0
note() { printf '\n--- %s ---\n' "$*"; }

# WHICH MODE THIS STACK IS IN, read before anything mints a token — the identity
# section far below asks the same question, but the first `mint` happens long
# before it and the answer changes what that token means.
#
# THREE ANSWERS, NOT TWO. `printenv` exits 1 when the variable is not set and
# `docker exec` exits 125+ when it could not run at all, and those are different
# facts: one says this stack has no identity provider configured, the other says
# nothing has been established either way. Collapsing them with `|| true` is how
# "could not ask" gets reported as "not provisioned" — the same shape as the
# curl-that-was-not-there below.
STACK_ISSUER="$(docker exec "$API_CONTAINER" printenv JWT_ISSUER 2>&1)"
STACK_ISSUER_RC=$?
if [ "$STACK_ISSUER_RC" -ge 125 ]; then
  echo "!!! cannot read JWT_ISSUER from '$API_CONTAINER' (exit ${STACK_ISSUER_RC}): ${STACK_ISSUER}"
  echo "!!! nothing below can speak for this stack's sign-in either way."
  STACK_ISSUER=""
  fail=1
elif [ "$STACK_ISSUER_RC" -ne 0 ]; then
  STACK_ISSUER=""
fi

q() { docker exec "$DB_CONTAINER" sh -lc "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Atc \"$1\""; }

# ON A PROVISIONED STACK THE API WILL NOT ACCEPT WHAT THIS MINTS, AND SAYS SO
# ONCE RATHER THAN FIFTEEN TIMES.
#
# `selectAuthMode` returns `managed` the moment JWT_ISSUER is set, and the
# symmetric JWT_SECRET then STOPS BEING USED — deliberately, so that a lingering
# secret (managed.yml used to ship a known default) cannot silently downgrade
# verification to it. Every token minted here is signed with that secret, so
# once the identity provider is provisioned every authenticated assertion below
# is refused, and none of the refusals is about the endpoint it names. E2E
# (managed) #52 is what that reads like: seven checks, seven failures, one cause
# and no mention of it anywhere.
#
# The honest fix is for this script to obtain a real token the way a browser
# does — create the person, POST /v2/sessions with a password check, finalise
# the auth request, exchange the code with PKCE — which is workplan 0099's "what
# is still owed" and is now a measured, working sequence rather than a plan (the
# whole flow was driven against the live provider on 2026-08-23; CreateCallback
# needs IAM_LOGIN_CLIENT on the calling machine user, and the ID token it
# returns carries the `email` claim the API requires).
#
# Until that lands, this states the cause ONCE, up front, and fails — rather
# than letting the reader work backwards from fifteen unrelated-looking 401s.
# It is not a skip: a gate that cannot prove something must say so and be red
# (hard rule 9), not quietly pass.
MINT_WARNED=0
warn_minted_tokens_are_not_verifiable() {
  [ "$MINT_WARNED" = "0" ] || return 0
  MINT_WARNED=1
  [ -n "${STACK_ISSUER:-}" ] || return 0
  # >&2, AND THAT IS NOT A STYLE CHOICE. `mint`'s STDOUT IS THE TOKEN — it is
  # read with `TOK="$(mint …)"`. Written to stdout, these lines are prepended to
  # every JWT the script mints, and the API then answers HTTP 400 with an empty
  # body to a header it cannot parse. That is what E2E (managed) #60 did:
  #
  #   verify: start-http-400   apply: start-http-400
  #   readiness (database): HTTP 400, .database -> '<unreadable>' —
  #
  # It is #523's bug exactly — output that is not the credential ending up in
  # the credential — committed an hour after the test that catches #523 was
  # written. The whole script's output is `tee`d, so stderr still reaches the
  # log and the reader loses nothing.
  {
    echo
    echo "!!! this stack verifies tokens against ${STACK_ISSUER}, and the tokens below"
    echo "!!! are signed with JWT_SECRET, which managed mode does not use. Every"
    echo "!!! authenticated check that follows will be refused, and NONE of those"
    echo "!!! refusals is about the endpoint it names."
    echo "!!! The remedy is workplan 0099's remaining task: get a real token from the"
    echo "!!! provider. Until then this is one true sentence instead of fifteen"
    echo "!!! misleading ones."
    echo
  } >&2
  fail=1
}

# AND WHATEVER COMES OUT OF HERE IS CHECKED FOR THE SHAPE OF A TOKEN BEFORE IT
# IS SENT AS ONE — the durable half of #523's lesson, applied one caller further
# than #523 applied it. A JWT is three dot-separated segments and contains no
# whitespace; a warning, a stack trace, a deprecation notice and an OCI error
# all do. This catches the class regardless of what produces the garbage next.
# ONE RULE, TWO PRESENTATIONS. `looks_like_a_jwt` is the rule and says nothing;
# the two callers below present it differently because they are in different
# positions to fail.
#
# A JWT is three dot-separated segments and contains no whitespace. A warning
# has whitespace; so does a stack trace, a deprecation notice and an OCI error.
# That is the durable half of #523's lesson and it catches the class whatever
# produces the garbage next.
looks_like_a_jwt() { # looks_like_a_jwt <value> — quiet; 0 if it has the shape
  case "$1" in
    ''|*[[:space:]]*) return 1 ;;
  esac
  case "$1" in
    *.*.*) return 0 ;;
    *) return 1 ;;
  esac
}

# At TOP LEVEL, where `fail=1` reaches the verdict.
assert_looks_like_a_jwt() { # assert_looks_like_a_jwt <what> <value>
  looks_like_a_jwt "$2" && return 0
  # >&2 because this is also read from places whose stdout is a value — the
  # same trap as #60, made impossible rather than remembered. The script's own
  # `tee` merges stderr into the evidence log, so nothing is lost by it.
  {
    if [ -z "$2" ]; then
      echo "$1 came back empty — nothing signed it"
    else
      echo "$1 is not a token: a JWT has three dot-separated segments and no whitespace."
      echo "  first 200 bytes: ${2:0:200}"
    fi
  } >&2
  fail=1
  return 1
}

mint() { # mint <sub> <tenantId>  — signed with the API container's real secret
  warn_minted_tokens_are_not_verifiable
  # DECLARED, THEN ASSIGNED — `local tok="$(…)"` makes the exit status `local`'s,
  # which is always 0 (#520). And CHECKED HERE, in the callee, rather than at
  # each of the four call sites: fixing the caller and not the callee is how
  # #519 survived in nineteen other places.
  local tok
  tok="$(
    cd "$REPO_ROOT/apps/api" &&
      JWT_SECRET="$JW" SUB="$1" T="$2" node -e "
const jwt=require('jsonwebtoken');
console.log(jwt.sign({sub:process.env.SUB,email:process.env.SUB+'@smoke.local',tenantId:process.env.T,role:'owner'},process.env.JWT_SECRET,{expiresIn:'1h'}));"
  )"
  assert_looks_like_a_jwt "the token minted for '$1'" "$tok" || return 1
  printf '%s' "$tok"
}

# THE CHOKE POINT EVERY AUTHENTICATED CALL GOES THROUGH, WHICH MAKES IT THE ONE
# PLACE A BAD TOKEN IS CAUGHT WHATEVER PRODUCED IT.
#
# `mint` and the invitee's token are both checked where they are made, and that
# is the right place — but it is also exactly what was true of #523's PAT and of
# #60's JWT, and each of them got through anyway, from a producer nobody had
# thought about yet. A per-producer check catches the producers that exist. This
# catches the next one.
#
# It complains at most once: fifteen calls carrying the same bad token is one
# fact, not fifteen, which is the whole argument of the section below.
# ---------------- a token this API will actually accept ----------------------
#
# WHY THIS EXISTS. `selectAuthMode` returns `managed` the moment JWT_ISSUER is
# set, and the symmetric JWT_SECRET then STOPS BEING USED — deliberately, so a
# lingering secret cannot silently downgrade verification. Tokens minted with
# that secret meet an RS256 key set and the provider's own library says exactly
# what it thinks of them:
#
#   401 {"error":"Unauthorized","message":"Token verification failed:
#        Unsupported \"alg\" value for a JSON Web Key Set"}
#
# So the gate signs in for real, the way a browser does — authorization request,
# a session proved with a password, the auth request finalised against that
# session, and the code exchanged with PKCE. Every call below was driven against
# the live provider before it was written here (probes, 2026-08-23).
#
# THREE PEOPLE, ONE MEMBERSHIP EACH, AND THAT IS THE DESIGN. `resolveTenant`
# takes the tenant from a header, a claim, or THE SUBJECT'S SINGLE MEMBERSHIP —
# and a Zitadel token carries no tenant claim. One person in two tenants would
# be ambiguous and would need an X-Tenant-Id on every call site; one person per
# tenant needs none, and reads like what it is: three different people signing
# in to three different places.
IDP_USERS=()          # every human handed back to the PARENT shell, for the take-back
IDP_ROLE_ADDED=0      # whether IAM_LOGIN_CLIENT had to be granted

# The provisioning token, read off the VOLUME rather than out of the provider —
# that image has no shell and no coreutils, which cost E2E (managed) #49-#51.
idp_pat() {
  docker run --rm -v ownpace-managed_zitadel_machinekey:/machinekey:ro \
    busybox:1.37 cat /machinekey/pat.txt 2>/dev/null | tr -d '\r\n'
}

# The origin is a compose network alias: the API container has the name, this
# host has the published port. `curl --resolve` presents the one while
# connecting to the other — the same thing setup-zitadel.sh does, and for the
# same reason.
IDP_RESOLVE=()
idp_api() { # idp_api <method> <path> [json] — body on stdout, "" and rc 1 on refusal
  local out status
  local args=(-sS "${IDP_RESOLVE[@]}" -X "$1" "${STACK_ISSUER%/}$2"
    -H "Authorization: Bearer ${IDP_PAT}" -H "Content-Type: application/json"
    -w '\n%{http_code}')
  [ -n "${3:-}" ] && args+=(-d "$3")
  out="$(curl "${args[@]}" 2>/dev/null)" || { echo "could not reach the provider at $2" >&2; return 1; }
  status="${out##*$'\n'}"; out="${out%$'\n'*}"
  case "$status" in
    2*) printf '%s' "$out"; return 0 ;;
    *)  echo "the provider answered HTTP ${status} to ${1} ${2}: ${out:0:200}" >&2; return 1 ;;
  esac
}

# sign_in_as <email> <password> — prints "<subject> <id token>", or nothing.
#
# The ID token, not the access token: Zitadel puts user info claims in the ID
# token only, and the API requires `email` (ADR-0042). Its audience is
# [client id, PROJECT id] and JWT_AUDIENCE is that project id, so it validates
# exactly as an access token would. `apps/web/src/services/oidc.ts` sends the
# same one for the same reason.
sign_in_as() {
  local email="$1" password="$2"
  local uid verifier challenge loc ar sess sid stok cb code tok idt

  uid="$(idp_api POST /v2/users/human "$(jq -nc --arg e "$email" --arg p "$password" \
    '{username:$e, profile:{givenName:"Smoke",familyName:"Person"},
      email:{email:$e,isVerified:true}, password:{password:$p,changeRequired:false}}')" \
    | jq -r '.userId // empty')"
  [ -n "$uid" ] || { echo "could not create $email at the provider" >&2; return 1; }
  # NO append to IDP_USERS here. This function runs inside a command
  # substitution, and an array append made in that subshell dies with it —
  # the caller appends the subject it reads back, in the parent shell.

  verifier="$(openssl rand -hex 32)"
  challenge="$(printf '%s' "$verifier" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=\n')"
  loc="$(curl -sS "${IDP_RESOLVE[@]}" -m 15 -o /dev/null -D - \
    "${STACK_ISSUER%/}/oauth/v2/authorize?client_id=${IDP_CLIENT_ID}&redirect_uri=${IDP_REDIRECT}&response_type=code&scope=openid%20email%20profile&code_challenge=${challenge}&code_challenge_method=S256" \
    2>/dev/null | tr -d '\r' | sed -n 's/^[Ll]ocation: //p' | head -1)"
  ar="$(sed -n 's/.*authRequest=\([^&]*\).*/\1/p' <<<"$loc")"
  [ -n "$ar" ] || { echo "the provider started no authorization request for $email (-> ${loc:-<no redirect>})" >&2; return 1; }

  sess="$(idp_api POST /v2/sessions "$(jq -nc --arg u "$email" --arg p "$password" \
    '{checks:{user:{loginName:$u},password:{password:$p}}}')")" || return 1
  sid="$(jq -r '.sessionId // empty' <<<"$sess")"
  stok="$(jq -r '.sessionToken // empty' <<<"$sess")"
  [ -n "$sid" ] && [ -n "$stok" ] || { echo "no session for $email" >&2; return 1; }

  cb="$(idp_api POST "/v2/oidc/auth_requests/${ar}" "$(jq -nc --arg s "$sid" --arg t "$stok" \
    '{session:{sessionId:$s,sessionToken:$t}}')")" || return 1
  code="$(jq -r '.callbackUrl // empty' <<<"$cb" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')"
  [ -n "$code" ] || { echo "the provider returned no authorization code for $email" >&2; return 1; }

  tok="$(curl -sS "${IDP_RESOLVE[@]}" -m 15 -X POST "${STACK_ISSUER%/}/oauth/v2/token" \
    --data-urlencode grant_type=authorization_code --data-urlencode "code=${code}" \
    --data-urlencode "redirect_uri=${IDP_REDIRECT}" --data-urlencode "client_id=${IDP_CLIENT_ID}" \
    --data-urlencode "code_verifier=${verifier}" 2>/dev/null)"
  idt="$(jq -r '.id_token // empty' <<<"$tok")"
  [ -n "$idt" ] || { echo "no ID token for $email: ${tok:0:200}" >&2; return 1; }
  printf '%s %s' "$uid" "$idt"
}

# Everything this section added, taken back — the same rule the balance section
# below applies to DAV resources. A crash before this leaves a human with no
# membership and possibly a lingering IAM_LOGIN_CLIENT on the provisioning
# user; the sweep below reclaims the humans on the next run, and the role is
# warned about where it is granted — the gate does not remove what it did not
# add, because an operator may have put it there on purpose.
#
# A failed delete here is SAID, not swallowed. It cannot fail the run — this
# fires in the EXIT trap, after the verdict — but `|| true` was hiding the one
# fact the next reader needs: that the take-back this comment promises did not
# actually happen.
idp_take_back() {
  local u
  for u in ${IDP_USERS+"${IDP_USERS[@]}"}; do
    idp_api DELETE "/v2/users/${u}" >/dev/null 2>&1 ||
      echo "[take-back] could not delete user ${u} — the next run's sweep will get them" >&2
  done
  if [ "$IDP_ROLE_ADDED" = "1" ] && [ -n "${IDP_SETUP_USER:-}" ]; then
    idp_api PUT "/admin/v1/members/${IDP_SETUP_USER}" \
      "$(jq -nc --argjson r "${IDP_ROLES_BEFORE:-[]}" '{roles:$r}')" >/dev/null 2>&1 ||
      echo "[take-back] could not restore the provisioning user's roles — IAM_LOGIN_CLIENT may linger" >&2
  fi
}

# The people a dead run leaves behind. Every run deletes its own three humans
# in that EXIT trap — but a hard-killed run (runner loss, SIGKILL, power)
# never reaches its trap, and its people linger in the provider, invisible
# unless somebody opens the console. Runs on this runner are serialised, so at
# the START of a run anybody matching the gate's own naming is a leftover by
# definition, never a colleague's live session.
#
# Two fences before anything is deleted, because deleting PEOPLE on a loose
# match is the worst kind of thorough. The provider is asked only for
# addresses ending in @smoke.local; each hit must then match the exact shape
# sign_in_as creates. And a leftover this sweep can SEE but cannot DELETE
# fails the sweep: an orphan named and left standing is a finding, not a
# shrug.
idp_sweep_leftovers() {
  local listing
  listing="$(idp_api POST /v2/users \
    '{"queries":[{"emailQuery":{"emailAddress":"@smoke.local","method":"TEXT_QUERY_METHOD_ENDS_WITH"}}]}')" ||
    { echo "could not ask the provider for leftover smoke people" >&2; return 1; }
  # The shape is checked before the loop: a renamed field would otherwise read
  # as "no leftovers", which is the silent lie this sweep exists to end.
  jq -e '[.result[]?] | all(has("userId") and has("username"))' >/dev/null <<<"$listing" ||
    { echo "the user listing does not look like one (no userId/username) — refusing to guess: $(jq -c '.result[0] // empty' <<<"$listing")" >&2; return 1; }
  local swept=0 uid uname
  while IFS=$'\t' read -r uid uname; do
    [ -n "$uid" ] || continue
    [[ "$uname" =~ ^smoke-(verify|apply|invitee)-[0-9]+@smoke\.local$ ]] ||
      { echo "leaving ${uname} alone — @smoke.local, but not a name this gate creates" >&2; continue; }
    idp_api DELETE "/v2/users/${uid}" >/dev/null ||
      { echo "could not delete leftover ${uname} (${uid})" >&2; return 1; }
    echo "  took back ${uname} — a dead run left them behind"
    swept=$(( swept + 1 ))
  done <<<"$(jq -r '.result[]? | [.userId, .username] | @tsv' <<<"$listing")"
  if [ "$swept" -gt 0 ]; then
    echo "swept ${swept} leftover(s) from earlier runs"
  else
    echo "no leftover smoke people to sweep"
  fi
}

# http <method> <url> <token> [json] — prints "<code> <body>" on one line
#
# THE BODY ARGUMENT EXISTS BECAUSE A CALL THAT NEEDS ONE WAS SENDING NONE. The
# close endpoint requires `windowDays` (0, 7, 30 or 90 — days before erasure)
# and answered `400 bad_window` to the smoke's empty POST. That had been true
# since the check was written and was invisible: every earlier run failed
# authentication first, so the request never reached the validation behind it.
# A gate that cannot get past the door cannot tell you the room is on fire.
http() {
  local body code
  # AND IT REFUSES TO SEND ONE THAT IS NOT A TOKEN, in the VALUE rather than in
  # a variable. This runs inside `$( )` at every call site, so `fail=1` set here
  # would be set in a subshell and lost — the check would print and the run
  # would still pass, which is the masking hard rule 9 is about. Answering `000`
  # instead makes every caller's own assertion fail on a code that is not an
  # HTTP status, and those callers ARE at top level.
  if ! looks_like_a_jwt "$3"; then
    echo "refusing to send $1 $2: that is not a token (${3:0:60}…)" >&2
    printf '%s %s\n' "000" "refused before sending — the bearer is not a token"
    return 0
  fi
  local args=(-sS -X "$1" -H "Authorization: Bearer $3" -w '\n%{http_code}' "$2")
  [ -n "${4:-}" ] && args+=(-H "Content-Type: application/json" -d "$4")
  body="$(curl "${args[@]}")"
  code="${body##*$'\n'}"
  body="${body%$'\n'*}"
  printf '%s %s\n' "$code" "$body"
}

json_state() { # crude but dependency-free: first "state":"..." in the body
  grep -o '"state":"[a-z-]*"' <<<"$1" | awk 'NR==1' | cut -d'"' -f4
}

json_number() { # json_number <body> <key> — first "key":N in the body, or empty
  grep -o "\"$2\":[0-9]*" <<<"$1" | awk 'NR==1' | cut -d: -f2
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
web_root="$(curl -sf "$WEB/" || true)"
if ! grep -qi '<html' <<<"$web_root"; then
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

# AND THE BUNDLE'S OWN KNOWLEDGE, WHICH NOTHING HAD EVER ASKED FOR.
#
# The two checks above prove the SPA is served and its /api proxy works. Neither
# says anything about what the JavaScript was BUILT with, and that is the gap
# that shipped a login page with no sign-in button: VITE_OIDC_ISSUER was written
# into .env, reloaded before the build, and never declared as a build arg — so
# Vite read nothing, `oidcConfig()` returned null, and Login.tsx offered the
# paste box alone. Correct behaviour, given what it had been told.
#
# EVERY GATE PROVED SIGN-IN WORKS AND NONE OF THEM USED THE SCREEN. This one
# drives the provider's endpoints with curl; the browser suite mocks
# `oidcConfig` and pastes a token. So the question is asked of the artefact a
# browser actually downloads.
#
# Asserted only when the stack HAS an issuer: without one the paste box is the
# right screen, and demanding otherwise would fail a bring-up that has simply
# not run the identity setup yet.
if [ -n "${STACK_ISSUER:-}" ]; then
  # Vite emits `import.meta.env` as a static object, so a configured issuer is a
  # string literal somewhere in the entry chunk. Its ORIGIN is matched rather
  # than the whole URL — a trailing slash is not a disagreement.
  idp_origin="${STACK_ISSUER%/}"
  web_assets="$(grep -oE '/assets/[A-Za-z0-9._-]+\.js' <<<"$web_root" | sort -u)"
  if [ -z "$web_assets" ]; then
    echo "FATAL: no /assets/*.js in the page at $WEB/ — cannot tell what the bundle knows"
    exit 1
  fi
  bundle_knows=0
  for asset in $web_assets; do
    # Read into a variable and grep a HERE-STRING, never `curl | grep -q`:
    # `-q` exits at the first match and SIGPIPEs curl, so under `pipefail` the
    # pipeline reports the status of the producer this consumer just killed.
    # That is the defect `no-pipeline-its-own-consumer-can-kill` exists for, and
    # the first version of this block walked straight into it.
    asset_js="$(curl -sf "${WEB}${asset}" || true)"
    if grep -qF "$idp_origin" <<<"$asset_js"; then bundle_knows=1; break; fi
  done
  if [ "$bundle_knows" -eq 0 ]; then
    echo "FATAL: the web bundle does not carry the issuer ${idp_origin}."
    echo "       The API verifies against it, so this stack HAS one — but the bundle was"
    echo "       built without VITE_OIDC_ISSUER, which means oidcConfig() is null and the"
    echo "       login page shows the paste box with NO sign-in button. Check that"
    echo "       managed.yml passes VITE_OIDC_ISSUER as a build arg and that"
    echo "       apps/web/Dockerfile declares it, then rebuild: --only app"
    exit 1
  fi
  echo "the bundle was built knowing its issuer (${idp_origin})"
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

# ---------- whoever this stack is willing to believe ----------
#
# In MANAGED mode the tokens below come from the provider, through a real
# sign-in. With no JWT_ISSUER — self-host, or a managed stack before
# setup-zitadel.sh has run — `selectAuthMode` uses JWT_SECRET and a minted token
# is exactly the right thing, so that is what it uses. Which of the two is not a
# preference: it is what the running API verifies against.
note "signing in"

VERIFY_SUBJECT="$VERIFY_SUB"
APPLY_SUBJECT="$APPLY_SUB"
INV_EMAIL="smoke-invitee-$$@smoke.local"
INV_SUB="smoke-invitee-$$"

if [ -z "$STACK_ISSUER" ]; then
  echo "no JWT_ISSUER — this API verifies with JWT_SECRET, so these are minted"
  VERIFY_TOKEN="$(mint "$VERIFY_SUB" "$VERIFY_TENANT")"
  APPLY_TOKEN="$(mint "$APPLY_SUB" "$APPLY_TENANT")"
  INV_TOKEN="$(
    cd "$REPO_ROOT/apps/api" &&
      JWT_SECRET="$JW" SUB="$INV_SUB" EM="$INV_EMAIL" node -e "
const jwt=require('jsonwebtoken');
console.log(jwt.sign({sub:process.env.SUB,email:process.env.EM,email_verified:true},process.env.JWT_SECRET,{expiresIn:'1h'}));"
  )"
  assert_looks_like_a_jwt "the invitee's token" "$INV_TOKEN" || true
else
  echo "issuer: $STACK_ISSUER — signing in for real"
  IDP_PAT="$(idp_pat)"
  # A PAT IS NOT A JWT — it is opaque, so `looks_like_a_jwt` is the wrong rule
  # for it. What #523 established still holds: no whitespace, and long enough
  # to be a credential rather than an error message.
  case "${IDP_PAT}" in ''|*[[:space:]]*) IDP_PAT="" ;; esac
  if [ "${#IDP_PAT}" -lt 20 ]; then
    echo "no usable provisioning token on the machinekey volume — cannot sign anybody in."
    echo "  read it by hand with:"
    echo "    docker run --rm -v ownpace-managed_zitadel_machinekey:/m:ro busybox:1.37 cat /m/pat.txt"
    fail=1
  fi

  # The host has the published port, not the network alias the origin names.
  IDP_PORT_ONLY="${STACK_ISSUER##*:}"
  IDP_HOST_ONLY="${STACK_ISSUER#*://}"; IDP_HOST_ONLY="${IDP_HOST_ONLY%%:*}"
  case "$STACK_ISSUER" in *:[0-9]*) IDP_RESOLVE=(--resolve "${IDP_HOST_ONLY}:${IDP_PORT_ONLY}:127.0.0.1") ;; esac

  # Before this run creates anybody: the people a dead run left behind. A
  # sweep that errors fails the RUN, not only itself — an orphan we can name
  # and cannot remove is a finding.
  idp_sweep_leftovers || fail=1

  # The application, asked for rather than assumed — its client id and the
  # redirect URI it will actually accept.
  IDP_PROJECT="$(docker exec "$API_CONTAINER" printenv JWT_AUDIENCE 2>/dev/null || true)"
  IDP_APP="$(idp_api POST "/management/v1/projects/${IDP_PROJECT}/apps/_search" '{"queries":[]}' \
    | jq -r '.result[]? | select(.name=="Ownpace Web") | .id' | head -1)"
  IDP_APP_CFG="$(idp_api GET "/management/v1/projects/${IDP_PROJECT}/apps/${IDP_APP}" || true)"
  IDP_CLIENT_ID="$(jq -r '.app.oidcConfig.clientId // empty' <<<"$IDP_APP_CFG")"
  IDP_REDIRECT="$(jq -r '.app.oidcConfig.redirectUris[0] // empty' <<<"$IDP_APP_CFG")"
  if [ -z "$IDP_CLIENT_ID" ] || [ -z "$IDP_REDIRECT" ]; then
    echo "the provider has no 'Ownpace Web' application to sign in to — setup-zitadel.sh has not finished here."
    fail=1
  fi

  # FINALISING AN AUTH REQUEST AGAINST A SESSION NEEDS `IAM_LOGIN_CLIENT`, which
  # is the role Zitadel's own login UI holds — so this is the provider's normal
  # mechanism, not a way round it. Without it CreateCallback answers
  # `No matching permissions found (AUTH-AWfge)`.
  #
  # It is added to the PROVISIONING user and taken off again, rather than given
  # to a machine user of the gate's own — one credential under
  # setup-zitadel.sh's rotation policy instead of a second standing account
  # with the right to impersonate. A crash can leave the role behind; the
  # grant below says so out loud when it finds it already present, and
  # removes nothing it did not add.
  IDP_SETUP_USER="$(idp_api GET /auth/v1/users/me | jq -r '.user.id // empty')"
  IDP_ROLES_BEFORE="$(idp_api POST /admin/v1/members/_search '{}' \
    | jq -c --arg u "$IDP_SETUP_USER" '[.result[]? | select(.userId==$u) | .roles[]?]')"
  if ! jq -e 'index("IAM_LOGIN_CLIENT")' >/dev/null <<<"${IDP_ROLES_BEFORE:-[]}"; then
    idp_api PUT "/admin/v1/members/${IDP_SETUP_USER}" \
      "$(jq -nc --argjson r "${IDP_ROLES_BEFORE:-[]}" '{roles:($r + ["IAM_LOGIN_CLIENT"] | unique)}')" >/dev/null \
      && IDP_ROLE_ADDED=1
  else
    # Already there before this run granted anything: a crashed run's leftover,
    # or an operator's own choice — indistinguishable from here. Said, not
    # swept: contrast the humans above, which are unambiguously ours.
    echo "IAM_LOGIN_CLIENT was already on the provisioning user before this run granted it" >&2
  fi
  # ONE TRAP, BOTH JOBS. There is already an EXIT trap above for the runner
  # watcher, and `trap … EXIT` REPLACES the handler rather than adding to it —
  # so a second one here silently leaks that process for the rest of the run.
  # Caught by looking, not by it going wrong, which is the cheaper way round.
  trap 'idp_take_back; kill "$WATCHER_PID" 2>/dev/null || true' EXIT

  IDP_PW='Smoke-Person!42'
  read -r VERIFY_SUBJECT VERIFY_TOKEN <<<"$(sign_in_as "smoke-verify-$$@smoke.local" "$IDP_PW")" || true
  read -r APPLY_SUBJECT APPLY_TOKEN   <<<"$(sign_in_as "smoke-apply-$$@smoke.local" "$IDP_PW")" || true
  read -r INV_SUB INV_TOKEN           <<<"$(sign_in_as "$INV_EMAIL" "$IDP_PW")" || true

  # THE ARRAY IS FILLED HERE, IN THE PARENT SHELL — never inside sign_in_as.
  # That function runs in a command substitution, and an append made there
  # dies with the subshell. That exact append is how the take-back iterated an
  # empty array for six straight runs while `|| true` kept it quiet — the
  # sweep's first live run (E2E managed #68) found all eighteen people, three
  # per run since sign-in was built. Same class as the fail=1 a subshell
  # swallowed in run #60. A person created but never handed back — sign_in_as
  # failing after its create — still leaks, and the sweep at the next run's
  # start is the backstop for exactly that window.
  for subject_id in "${VERIFY_SUBJECT:-}" "${APPLY_SUBJECT:-}" "${INV_SUB:-}"; do
    [ -n "$subject_id" ] || continue
    IDP_USERS+=("$subject_id")
  done

  for t in "the verify half:$VERIFY_TOKEN" "the apply half:$APPLY_TOKEN" "the invitee:$INV_TOKEN"; do
    assert_looks_like_a_jwt "${t%%:*}'s token" "${t#*:}" || true
  done

  # A REAL SUBJECT NEEDS A REAL MEMBERSHIP. The token proves who signed in; the
  # `tenant_member` row is what says they belong here, and `authenticate` reads
  # the ROLE from that row and never from the token (0020 T1). One tenant each,
  # so `resolveTenant` has a single membership to resolve and no call site needs
  # a tenant header.
  if [ -n "${VERIFY_TOKEN:-}" ]; then
    q "INSERT INTO tenant_member (tenant_id, user_id, email, role, status, invited_at, joined_at)
       VALUES ('${VERIFY_TENANT}', '${VERIFY_SUBJECT}', 'smoke-verify-$$@smoke.local', 'owner', 'active', now(), now())
       ON CONFLICT DO NOTHING" >/dev/null
  fi
  if [ -n "${APPLY_TOKEN:-}" ]; then
    q "INSERT INTO tenant_member (tenant_id, user_id, email, role, status, invited_at, joined_at)
       VALUES ('${APPLY_TENANT}', '${APPLY_SUBJECT}', 'smoke-apply-$$@smoke.local', 'owner', 'active', now(), now())
       ON CONFLICT DO NOTHING" >/dev/null
  fi
  echo "signed in: verify=${VERIFY_SUBJECT:-<none>}  apply=${APPLY_SUBJECT:-<none>}  invitee=${INV_SUB:-<none>}"
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
  # Whoever this stack is willing to believe for this tenant — see "signing in".
  # `$sub` stays the label it always was; the token's real subject is whatever
  # signed in, and the membership row seeded up there is what makes it belong.
  case "$tenant" in
    "$VERIFY_TENANT") tok="$VERIFY_TOKEN" ;;
    "$APPLY_TENANT")  tok="$APPLY_TOKEN" ;;
    *) echo "no signed-in person for tenant $tenant"; fail=1; return 1 ;;
  esac
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
  if grep -q "SKIPPED_${d}" <<<"$rbody"; then
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

  # THE TAG IS CHOSEN HERE rather than left to the seeder's default, because
  # what this run created is what the balance section has to take back, and it
  # cannot take back a name it never learned. `--fresh` on its own mints a
  # timestamp+pid inside a subprocess and prints it; parsing that back out of
  # the log would be a second source of truth for one string.
  BALANCE_TAG="smoke-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  if "$SCRIPT_DIR/seed-demo-dav-content.sh" --fresh "$BALANCE_TAG"; then
    echo "prepare: DAV source seeded with fresh, never-tombstoned natural keys (tag ${BALANCE_TAG})"
  else
    echo "prepare: SEEDING FAILED — the diagnosis below will say what the ledger holds."
  fi

  TOK_P="$APPLY_TOKEN"
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
    # Paste-safe, for the reason bootstrap-managed.sh's remedy documents: the
    # names resolve INSIDE the container or not at all. The SQL carries single
    # quotes around the tenant id, so it goes in through a heredoc rather than
    # `-c` — nesting it in the `sh -c '...'` would end that quoting early.
    echo "  docker exec -i $DB_CONTAINER sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At' <<'SQL'"
    echo "  SELECT level,message,at FROM run_event"
    echo "   WHERE tenant_id='$APPLY_TENANT'"
    echo "   ORDER BY at DESC LIMIT 20;"
    echo "SQL"
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

  TOK_A="$APPLY_TOKEN"
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
# on the host is at best a claim about that. Read ONCE, at the top of this
# script, because the first token is minted long before this section runs.
ISSUER="$STACK_ISSUER"
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
  # ASKED WITH THE CLIENT THE API ITSELF USES, because the API image has neither
  # curl nor wget. It is `node:24-slim`: node and little else, which is why the
  # image's own HEALTHCHECK is `node -e "fetch(...)"` (apps/api/Dockerfile).
  #
  # This check used `curl`, with `2>/dev/null || true` around it. So on every run
  # ever made, `sh: 1: curl: not found` became the empty string, the empty string
  # became an empty `.issuer`, and the empty `.issuer` was reported as "the API
  # cannot reach the issuer at all" — a conclusion this check had not measured
  # and, with no curl in the image, could never have measured. It was right by
  # accident in run #52 and would have said the same thing had the issuer been
  # perfectly reachable.
  #
  # THREE OUTCOMES, KEPT APART. "The probe could not run", "the issuer could not
  # be reached" and "the issuer answered X" are three different facts about three
  # different things, and only the last one is about the issuer (hard rule 10).
  idp_get() { # idp_get <url> — body on stdout; 0 ok, 22 non-2xx, 7 unreachable, else the exec failed
    docker exec "$API_CONTAINER" node -e '
      fetch(process.argv[1], { signal: AbortSignal.timeout(10000) })
        .then(async (r) => {
          process.stdout.write(await r.text());
          process.exit(r.ok ? 0 : 22);
        })
        .catch((e) => {
          process.stderr.write(`${e.name}: ${e.message}` + (e.cause ? ` / ${e.cause}` : ""));
          process.exit(7);
        });
    ' "$1" 2>&1
  }

  DISCOVERY="$(idp_get "${ISSUER%/}/.well-known/openid-configuration")"
  DISC_RC=$?
  case "$DISC_RC" in
    0) ;;
    7)  echo "the API cannot reach the issuer at $ISSUER — the fetch never got an answer:"
        echo "  $DISCOVERY"
        echo "The usual cause is an issuer whose ORIGIN the API can never present."
        echo "ZITADEL_EXTERNALDOMAIN=localhost makes it http://localhost:3126, which the"
        echo "host reaches through the published port and the API container cannot: there,"
        echo "localhost is the API. It has to be an address BOTH a browser and the API"
        echo "resolve, AND the one the provider was initialised with — Zitadel answers 404"
        echo "'Instance not found' to any other origin, so an internal shortcut is not one."
        fail=1 ;;
    22) echo "the issuer at $ISSUER answered, but not with a discovery document:"
        echo "  ${DISCOVERY:0:300}"
        fail=1 ;;
    *)  echo "this check could not run: asking the API container failed (exit ${DISC_RC})."
        echo "  ${DISCOVERY:0:300}"
        echo "That is a fact about the probe, not about the issuer — nothing here has been"
        echo "measured either way."
        fail=1 ;;
  esac

  DECLARED="$(jq -r '.issuer // empty' <<<"$DISCOVERY" 2>/dev/null || true)"
  JWKS="$(jq -r '.jwks_uri // empty' <<<"$DISCOVERY" 2>/dev/null || true)"

  # Byte for byte, and that is the point: OIDC Discovery §4.3 says a document
  # declaring a different issuer is not this issuer, and both `oidc.ts` and
  # `auth.ts` refuse on a mismatch. A trailing slash is the difference between
  # a working sign-in and a refusal nobody can explain.
  if [ "$DISC_RC" -eq 0 ] && [ "$DECLARED" != "${ISSUER%/}" ] && [ "$DECLARED" != "$ISSUER" ]; then
    echo "the issuer at $ISSUER declares '$DECLARED' (as seen BY THE API) — sign-in would refuse this."
    fail=1
  elif [ "$DISC_RC" -eq 0 ]; then
    echo "issuer: $ISSUER (declares its own name)"
  fi

  # The keys the API verifies every token against. Discovery naming a jwks_uri
  # nothing serves is a stack that authenticates nobody, and it looks healthy.
  if [ "$DISC_RC" -eq 0 ]; then
    if [ -z "$JWKS" ]; then
      echo "the discovery document names no jwks_uri — no token could be verified."
      fail=1
    else
      idp_get "$JWKS" >/dev/null
      JWKS_RC=$?
      if [ "$JWKS_RC" -ne 0 ]; then
        echo "jwks_uri '$JWKS' is not fetchable from the API (exit ${JWKS_RC}) — no token could be verified."
        fail=1
      else
        echo "jwks:   $JWKS (fetchable)"
      fi
    fi
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
# INV_EMAIL, INV_SUB and INV_TOKEN are all set by "signing in" above, from a
# real sign-in where this stack has an issuer and from a minted token where it
# does not. The invitations below are addressed to that same email, which is
# what `pendingInvitations` matches on.

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

note "closing a tenant, and changing your mind"
#
# OFFBOARDING, which nothing in either gate had ever exercised — and it is the
# path with the most weight behind it: a closure starts an erasure clock, and
# `purge_after` is the date somebody's data stops existing. `close` and `reopen`
# were shipped with integration tests and nothing that ran them against a live
# stack, RLS, and a real tenant row.
#
# It runs on T1 — the tenant the invitation above ACCEPTED, so the subject is an
# active owner there, which is what `requireRole('owner')` wants — and it is
# reopened immediately. The tenant is deleted a few lines below either way, so
# this borrows a fixture that was already being taken back rather than inventing
# one that needs its own cleanup.
# SEVEN DAYS, not zero. `windowDays: 0` erases at the next purge and cannot be
# undone — so the one value that would make the reopen below meaningless is the
# one this must never send. Seven also gives the `purge_after > closed_at`
# assertion an actual window to check.
cls="$(http POST "$API/api/tenants/${T1}/close" "$INV_TOKEN" '{"windowDays":7}')"
echo "close:  $cls"
[ "${cls%% *}" = "200" ] || { echo "closing a tenant failed"; fail=1; }

# The ROW, not the response. A 200 describing a closure that was never recorded
# is the shape of failure this whole script exists to catch, and the closure row
# is what the purge job actually reads.
closed="$(q "SELECT count(*) FROM tenant_closure WHERE tenant_id='${T1}'")"
due="$(q "SELECT purge_after > closed_at FROM tenant_closure WHERE tenant_id='${T1}'")"
echo "closure rows: ${closed:-0}   purge_after is after closed_at: ${due:-<none>}"
[ "${closed:-0}" = "1" ] || { echo "the close wrote no closure row — nothing would ever purge"; fail=1; }
# A window that ends before it starts would purge immediately, which is the one
# way this path can quietly become destructive.
[ "${due:-f}" = "t" ] || { echo "purge_after is not after closed_at — that window is not a window"; fail=1; }

reo="$(http POST "$API/api/tenants/${T1}/reopen" "$INV_TOKEN")"
echo "reopen: $reo"
[ "${reo%% *}" = "200" ] || { echo "reopening a closed tenant failed"; fail=1; }
still="$(q "SELECT count(*) FROM tenant_closure WHERE tenant_id='${T1}'")"
echo "closure rows after reopen: ${still:-?}"
# The point of reopen is that the clock STOPS. A reopen that leaves the row
# behind is a tenant that gets erased on schedule despite having been reopened.
[ "${still:-1}" = "0" ] || { echo "reopen left the closure row — the erasure clock is still running"; fail=1; }

# Clean up after itself. This gate runs nightly against a long-lived stack, and
# a smoke that leaves rows behind grows the thing it is measuring.
for t in "$T1" "$T2" "$T3"; do
  q "DELETE FROM tenant_member WHERE tenant_id='${t}' AND email='${INV_EMAIL}'" >/dev/null
  q "DELETE FROM tenant WHERE id='${t}'" >/dev/null
done

# ---------- the knock, and the mail nobody was getting ----------
#
# WHY THIS SECTION EXISTS. `POST /api/access-requests` inserted a row, wrote one
# log line and told nobody: there was no `access_requested` event at all, and
# SMTP was unconfigured on top of that. Somebody filled in the form on the live
# site and heard nothing, which was correct behaviour and useless behaviour at
# once (workplan 0099). No gate had ever asserted that this product can send a
# single email — the rendering is unit-tested exhaustively, and the wire was
# never exercised.
#
# WHAT MAKES IT ASSERTABLE. `mailpit` catches everything this stack sends and
# delivers nothing outward, so the gate can read what was sent without any run
# ever reaching a real inbox. The API shapes below are read from Mailpit's own
# source rather than guessed: `GET /api/v1/search?query=…` answers with
# `messages_count` and a `messages` array whose items carry Go field names —
# `Subject`, `To`, `Snippet` — because `MessageSummary` declares no JSON tags.
#
# The address is unique per run so this asserts on THIS request's mail, not on
# something a previous run left behind, and nothing is deleted: a smoke that
# empties the catcher would wipe whatever an operator was looking at.
note "an access request, and the mail it produces"

# Same shape as SMOKE_API at the top: an explicit override, else the port
# from .env if it was exported, else the documented default.
MAILPIT="${SMOKE_MAILPIT:-http://localhost:${MAILPIT_PORT:-3127}}"
# $$ — the same per-run uniqueness INV_EMAIL uses above, so this asserts on
# THIS run's mail rather than on something a previous one left behind.
knock="smoke-knock-$$@example.invalid"

if ! curl -fsS -o /dev/null "${MAILPIT}/api/v1/messages"; then
  # Not skipped quietly. The catcher is in managed.yml and in the bring-up's
  # service list; if it is not answering, the mail path is unproven and this
  # gate must say so rather than pass by omission.
  echo "mailpit is not answering at ${MAILPIT} — the mail path is unproven"; fail=1
else
  knock_code="$(curl -fsS -o /tmp/knock.$$ -w '%{http_code}' -X POST "${API}/api/access-requests" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg e "$knock" '{email:$e, locale:"en", tier:"Small", organisation:"Smoke BV"}')" \
    || echo 000)"
  [ "$knock_code" = "201" ] ||
    { echo "the front door refused a request: HTTP ${knock_code} $(head -c 200 /tmp/knock.$$ 2>/dev/null)"; fail=1; }
  rm -f "/tmp/knock.$$"

  # The send happens inside the request, so one look would usually do — but a
  # mail server is a network hop and a gate that flakes gets ignored. Bounded,
  # and it reports the wait it actually did rather than a number in a comment.
  caught=0
  for _ in $(seq 1 20); do
    caught="$(curl -fsS --get "${MAILPIT}/api/v1/search" --data-urlencode "query=${knock}" \
      | jq -r '.messages_count // 0')"
    [ "${caught:-0}" != "0" ] && break
    sleep 1
  done

  if [ "${caught:-0}" = "0" ]; then
    # The exact failure this section was written for: a request recorded, and
    # nobody told. Names where to look, because "no mail" is the symptom of at
    # least three different causes.
    echo "nobody was told about ${knock}: no mail reached mailpit within 20s."
    echo "  Check SMTP_HOST/NOTIFY_FROM/NOTIFY_TO in .env, and the api container's log"
    echo "  for '[access-request] nobody was told' — the request itself is recorded."
    fail=1
  else
    # Not merely "a mail exists". The operator's mail must be the one that
    # arrived, and it must carry the address they have to reply to.
    hit="$(curl -fsS --get "${MAILPIT}/api/v1/search" --data-urlencode "query=${knock}" \
      | jq -r '.messages[0] // empty')"
    subject="$(jq -r '.Subject // empty' <<<"$hit")"
    case "$subject" in
      *"asked for access"*|*"vraagt toegang"*) : ;;
      *) echo "mail arrived but is not the knock: subject '${subject}'"; fail=1 ;;
    esac
    # Addressed to NOTIFY_TO, never to the person who asked. Mailing the
    # applicant their own request would leak the operator's channel.
    to_applicant="$(jq -r --arg k "$knock" '[.To[]?.Address] | index($k) // empty' <<<"$hit")"
    [ -z "$to_applicant" ] ||
      { echo "the knock mail was addressed to the applicant (${knock}), not to NOTIFY_TO"; fail=1; }
    echo "    the operator was told: '${subject}'"
  fi
fi

# ---------- the mail the ISSUER could not send ----------
#
# THERE ARE TWO SENDERS ON THIS STACK AND ONLY ONE WAS EVER WIRED.
#
# The section above proves the API can send. Zitadel's mail is its own and never
# touches the API: the verification link on a new account, an email-change
# confirmation, a password reset, the invitation to set a first password. Until
# setup-zitadel.sh configured an email provider, this instance had none at all,
# so every one of those was composed and dropped.
#
# THAT FAILURE IS INVISIBLE FROM BOTH ENDS, which is why it needs a gate rather
# than a look. The account is created, the screen says to check your mail, and
# Mailpit stays empty — indistinguishable from a product whose mail is broken.
# Nothing in a log says the provider had nowhere to send.
#
# TESTED BY ID, NOT BY SETTINGS. `/email/smtp/_test` takes a full config in the
# request and would pass against settings this instance does not use — a green
# that proves the relay is reachable and says nothing about whether Zitadel will
# ever send through it. `/email/smtp/{id}/_test` uses the STORED config, which
# is the thing under test. An inactive provider is the same silence as no
# provider, so its state is asserted too.
#
# AND EMPTY STILL MEANS OFF, HERE TOO. `.env` decides whether this stack has a
# relay at all, and a deployment that has not chosen one is not broken — so this
# asks the file rather than demanding a provider unconditionally. Read from the
# file and not from the environment because this script sources no `.env`: the
# caller exports what it exports, and on the nightly that is not this key.
# Without it, a stack whose operator never configured mail would fail a gate for
# a channel they never asked for, which is a gate inventing a requirement.
smtp_configured="$(grep -E '^SMTP_HOST=.+' "${SCRIPT_DIR}/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true)"

if [ -z "$smtp_configured" ]; then
  note "the identity provider's own mail: no SMTP_HOST in .env, so nothing to assert"
elif [ -n "${STACK_ISSUER:-}" ] && [ -n "${IDP_PAT:-}" ]; then
  note "the identity provider's own mail"
  idp_mail="smoke-idp-$$@example.invalid"
  providers="$(idp_api POST /admin/v1/email/_search '{}' || true)"
  smtp_id="$(jq -r 'first(.result[]? | select(.smtp) | .id) // empty' <<<"${providers:-{\}}")"
  smtp_state="$(jq -r 'first(.result[]? | select(.smtp) | .state) // empty' <<<"${providers:-{\}}")"

  if [ -z "$smtp_id" ]; then
    echo "the identity provider has NO email provider configured."
    echo "  Every verification and email-change mail it composes is dropped, and the"
    echo "  screen still says to check your mail. Run --only app to configure it,"
    echo "  or set SMTP_HOST/NOTIFY_FROM in .env first if they are empty."
    fail=1
  elif [ "$smtp_state" != "EMAIL_PROVIDER_ACTIVE" ]; then
    echo "the identity provider's email provider ${smtp_id} is '${smtp_state}',"
    echo "  not EMAIL_PROVIDER_ACTIVE. An inactive provider drops mail exactly as"
    echo "  silently as no provider at all."
    fail=1
  elif ! curl -fsS -o /dev/null "${MAILPIT}/api/v1/messages"; then
    echo "cannot reach Mailpit at ${MAILPIT} — the provider's mail cannot be read."
    fail=1
  else
    # A real send through the stored config, then read from the catcher. Not
    # "the API returned 200": Zitadel answers the test call before delivery
    # completes, so the proof is the message arriving.
    # The DEPRECATED path, deliberately: v4.17.1 declares the modern
    # `/email/smtp/{id}/_test` and does not implement it (HTTP 501, gRPC
    # UNIMPLEMENTED). Only `TestSMTPConfigById` and `TestSMTPConfig` have
    # implementations, both on `/smtp`. It still tests the STORED config, which
    # is the property that matters.
    idp_api POST "/admin/v1/smtp/${smtp_id}/_test" \
      "$(jq -nc --arg r "$idp_mail" '{receiverAddress:$r}')" >/dev/null || true
    landed=""
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      landed="$(curl -fsS --get "${MAILPIT}/api/v1/search" \
        --data-urlencode "query=${idp_mail}" | jq -r '.messages_count // 0')"
      [ "${landed:-0}" -gt 0 ] && break
      sleep 1
    done
    if [ "${landed:-0}" -gt 0 ]; then
      echo "    the issuer's mail reached Mailpit (${idp_mail})"
    else
      echo "the identity provider accepted the test send and NOTHING reached Mailpit"
      echo "  at ${MAILPIT}. Its email provider is configured and active, so the"
      echo "  relay address it holds is wrong or unreachable from its container."
      fail=1
    fi
  fi
fi

# ---------- the reports nothing had ever opened ----------
#
# COVERAGE, plainly. Grep either gate before this and `shared-addresses`,
# `permissions`, `billing` and `invoices` return nothing at all: four route
# families the product ships, sells and renders screens for, and no gate had
# ever asked the running stack for one of them. They are reads, so they cost a
# few HTTP round trips and change nothing — which is exactly why there was no
# excuse for their absence.
#
# WHAT IS ASSERTED, and what deliberately is not. Each must answer 200 AND
# return the shape its route documents. What is NOT asserted is the CONTENT:
# the demo tenants have no shared addresses and no invoices, so `0 addresses` is
# the true answer and pretending otherwise would mean seeding fixtures for the
# sake of a bigger number. `null`, a missing key or a 500 all fail; an honest
# empty list passes.
note "reports nothing had ever opened"

TOK_R="$APPLY_TOKEN"

report_json() { # report_json <label> <path> <jq filter> [value it must equal]
  local r code body value
  r="$(http GET "$API$2" "$TOK_R")"
  code="${r%% *}"; body="${r#* }"
  value="$(printf '%s' "$body" | jq -r "$3" 2>/dev/null || true)"
  if [ "$code" != "200" ] || [ -z "$value" ] || [ "$value" = "null" ]; then
    echo "$1: HTTP $code, $3 -> '${value:-<unreadable>}' — ${body:0:200}"
    fail=1
  elif [ -n "${4:-}" ] && [ "$value" != "$4" ]; then
    # The fourth argument is for answers where only ONE is acceptable. Without
    # it a report passes on any answer it manages to produce, which is right for
    # a count (0 addresses is a true answer) and wrong for a health verdict.
    echo "$1: HTTP 200 but $3 -> '$value', expected '$4'"
    fail=1
  else
    echo "$1: HTTP 200, $3 -> $value"
  fi
}

report_markdown() { # report_markdown <label> <path> <heading it must carry>
  local r code body
  r="$(http GET "$API$2" "$TOK_R")"
  code="${r%% *}"; body="${r#* }"
  # A heading rather than a length: an error page is also several hundred bytes,
  # and `serverFault` renders JSON that would sail past a size check.
  case "$code:$body" in
    "200:"*"$3"*) echo "$1: HTTP 200, carries '$3'" ;;
    *) echo "$1: HTTP $code, no '$3' — ${body:0:200}"; fail=1 ;;
  esac
}

# The readiness endpoint, which exists to be asked and which nothing asked. Its
# `signIn` half is deliberately NOT pinned to `up`: the issuer is unreachable
# from inside the API container until ZITADEL_EXTERNALDOMAIN names an address
# both a browser and that container resolve, the identity section above says so
# in as many words, and duplicating that verdict here would just report the same
# outage twice. The database half has no such excuse.
report_json "readiness (database)" "/api/ready" '.database' up
report_json "readiness (verdict)" "/api/ready" '.status'
report_json "shared addresses" "/api/shared-addresses" '.addresses | length'
report_markdown "shared-address runbook" "/api/shared-addresses/runbook" "## Before you start"
# A mailbox is required and the demo owner's is the one address this tenant is
# certain to have. The report renders whether or not a scan can read anything —
# it says which categories it could NOT inventory, which is the point of it.
report_markdown "permissions report" \
  "/api/permissions/report?mailbox=${APPLY_SUB}@demo.openmigrate.test" \
  "# Who can see what, and what happens to it"
report_json "billing usage" "/api/billing/usage" '.period'
report_json "invoices" "/api/billing/invoices" '.invoices | length'

# ---------- balance ----------
#
# WHY THIS EXISTS. This gate runs nightly against a LONG-LIVED stack, and every
# green run used to leave more behind than it found: `--fresh` seeds six DAV
# resources into the demo SOURCE, a real sync copies them into the demo TARGET,
# and nothing ever took either set away. Six objects a night, in the two accounts
# this same script measures — a measurement changing the thing it measures, and
# the same shape as run #20's fixture exhaustion running the other way.
#
# So the run takes back what it added, and it does so in the only unit that stays
# truthful: source object, target copy and ledger row TOGETHER. Removing the
# ledger row alone would destroy the record of objects that still exist.
# Removing the objects alone would leave the ledger describing things that are
# gone — and `pick_disposable` would hand a later run an item whose target
# vanished, which is a failure with no visible cause.
#
# ONE ROW SURVIVES ON PURPOSE. The tombstone the apply half wrote says a natural
# key was erased and `classifyKnownItem` must never re-create it (ADR-0024, hard
# rule 2). Deleting it to make a number come out at zero would be exactly the
# trade this script exists to refuse. So: net zero MINUS one tombstone per run,
# and the counts below say which is which rather than asserting a round number.
note "balance — take back what this run added"

if [ -z "$BALANCE_TAG" ]; then
  # Not a failure and not a silence. Prepare only seeds when nothing eligible
  # exists, so on a run that found an item already there this is the honest
  # state — and saying so is what stops "balanced" from meaning "did nothing".
  echo "prepare did not seed this run, so this run added no DAV resources — nothing to take back."
else
  echo "tag: $BALANCE_TAG"
  TAGGED="$HREF_EXPR LIKE '%${BALANCE_TAG}%'"
  SCOPE="tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING'"
  echo "ledger rows carrying this tag before removal:"
  q "SELECT status, count(*) FROM item WHERE $SCOPE AND $TAGGED GROUP BY 1 ORDER BY 1" | sed 's/^/  /'

  # THE TARGET FIRST, and through the same script that wrote the names into the
  # source. The natural key IS the name — `openmig-demo-event-<tag>-1` is the
  # VEVENT UID, and the writers record `targetId: written.path`, an href built
  # from that UID — so the copies land under the same names in the target's own
  # collections. `--remove` deletes them and then PROPFINDs to prove nothing
  # tagged is left, which is the part that makes this an assertion rather than
  # an assumption: if the copies live somewhere else, this says so and fails.
  objects_gone=1
  if DAV_USER="$TARGET_DAV_USER" DAV_PASSWORD="$TARGET_DAV_PASSWORD" \
     "$SCRIPT_DIR/seed-demo-dav-content.sh" --remove "$BALANCE_TAG"; then
    echo "target: the copies this run's sync made are gone"
  else
    echo "target: REMOVAL FAILED — this run's copies are still in ${TARGET_DAV_USER}."
    echo "If the message above is about a missing personal calendar or address book,"
    echo "the target writer re-homed the collection under a different slug"
    echo "(caldav-target-writer.ts ensureCalendar) and this removal is looking in the"
    echo "wrong place — not a sync bug."
    objects_gone=0
    fail=1
  fi

  # Then the source, with the script's own defaults (tenant B's source account).
  # Attempted even when the target removal failed: they are two accounts, and
  # skipping the second because the first went wrong would leave more behind and
  # tell us less.
  if "$SCRIPT_DIR/seed-demo-dav-content.sh" --remove "$BALANCE_TAG"; then
    echo "source: the set this run seeded is gone"
  else
    echo "source: REMOVAL FAILED — this run's seeded set is still in the demo source."
    objects_gone=0
    fail=1
  fi

  # The ledger LAST, AND ONLY IF THE OBJECTS REALLY WENT. A row deleted while
  # its object is still there is the one move this section must never make: it
  # destroys the record of something that exists, and the next sync would then
  # meet the resource as brand new. Ordering alone does not give that — it has
  # to be a condition, which is what this is.
  if [ "$objects_gone" = "1" ]; then
    # Everything except the tombstone, which is the record of an erasure and
    # outlives its fixture on purpose.
    echo "ledger: $(q "DELETE FROM item WHERE $SCOPE AND $TAGGED AND status <> 'tombstoned'")"
    left="$(q "SELECT count(*) FROM item WHERE $SCOPE AND $TAGGED AND status <> 'tombstoned'")"
    kept="$(q "SELECT count(*) FROM item WHERE $SCOPE AND $TAGGED AND status = 'tombstoned'")"
    echo "ledger: ${left:-?} row(s) carrying this tag remain, ${kept:-0} tombstone(s) kept deliberately"
    # Asserted, not trusted. A DELETE that removed nothing prints "DELETE 0" and
    # reads exactly like one that worked.
    [ "${left:-1}" = "0" ] || {
      echo "the ledger still carries ${left} non-tombstone row(s) for this run's tag"
      fail=1
    }
  else
    echo "ledger: rows LEFT IN PLACE on purpose — the objects they describe are still"
    echo "there, and this run has no business deleting the record of things that exist."
    echo "Take them back by hand once the removal above is fixed:"
    echo "  ./deploy/compose/seed-demo-dav-content.sh --remove ${BALANCE_TAG}"
  fi
fi

# ---------- the status page answers ----------
#
# gatus has NO container healthcheck, and cannot have one: its image is
# `FROM scratch` — no wget, no curl, no shell, and no CLI subcommand. The one
# that used to be there marked a healthy container `unhealthy` forever and was
# the only red thing in E2E (managed) #77.
#
# So the question is asked from here, where curl exists and the port is
# published. This asserts only that gatus is SERVING — not that its lamps are
# green, which depends on STATUS_WEB_URL being an address its container can
# reach and is the operator's call, not this gate's.
note "the status page"

STATUS="${SMOKE_STATUS:-http://localhost:${STATUS_PORT:-3124}}"
if curl -fsS -o /dev/null -m 10 "${STATUS}/health"; then
  echo "status page: answering at ${STATUS}/health"
else
  # Not skipped quietly, for the same reason as mailpit above: gatus is in
  # managed.yml and in the bring-up's service list, so silence here means a
  # service the stack starts is not serving.
  echo "the status page is not answering at ${STATUS}/health"
  echo "  It has no container healthcheck by design (scratch image), so this"
  echo "  probe is the only thing that speaks for it."
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
