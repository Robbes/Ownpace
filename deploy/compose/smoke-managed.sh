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

# WHAT THE OPERATOR ACTUALLY SET, READ OUT OF THE FILE.
#
# This script sources no `.env` — by design; see the SMTP_HOST section, which
# greps it and says why. So `${SOME_PORT:-1234}` in here NEVER read the
# operator's setting: the variable is unset in this shell, so it was the
# default wearing a variable's clothes and quietly right only while nobody
# changed anything.
#
# That is not hypothetical. Every published port in managed.yml is a setting,
# and E2E (managed) #84 went red on a healthy stack the first time one of them
# was moved — the catcher had been published on a mesh address and the gate
# still asked localhost, then blamed the mail path. A gate that breaks when a
# documented setting is used is a bug in the gate, and it fails pointing at the
# wrong thing.
smoke_env_value() {   # <key> — the last assignment in .env, or empty
  grep -E "^$1=.+" "${SCRIPT_DIR}/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true
}

api_port="$(smoke_env_value API_PORT)"
API="${SMOKE_API:-http://localhost:${api_port:-3001}}"
DB_CONTAINER="${SMOKE_DB_CONTAINER:-ownpace-db}"
API_CONTAINER="${SMOKE_API_CONTAINER:-ownpace-api}"
POLLS="${SMOKE_POLLS:-45}"
POLL_SLEEP="${SMOKE_POLL_SLEEP:-2}"
# The prepare phase waits on a whole sync pass (runner start + DAV round trips),
# which is a longer thing than polling one already-running verify.
PREP_POLLS="${SMOKE_PREPARE_POLLS:-60}"
OUT="${SMOKE_OUT:-/tmp/openmig-smoke-managed-$(date -u +%Y%m%dT%H%M%SZ).txt}"

# Demo-seed fixtures (apps/api/src/scripts/seed-managed.ts).
#
# The `seed:` prefix is load-bearing and must match that file exactly: it is how
# the support screen knows these subjects were written by the seed rather than
# minted by an identity provider, and so renders them without a console link
# (apps/web/src/services/idp-console.ts, LOCAL_SUBJECT_PREFIXES). A mismatch
# here does not fail loudly — the token is minted for a subject with no
# `tenant_member` row, and every authenticated assertion below comes back 403
# with nothing saying why.
VERIFY_TENANT="${SMOKE_VERIFY_TENANT:-a0000000-0000-4000-8000-000000000001}"
VERIFY_SUB="${SMOKE_VERIFY_SUB:-seed:demo-owner-a}"
VERIFY_MAPPING="${SMOKE_VERIFY_MAPPING:-a0000000-0000-4000-8000-0000000000d1}"
APPLY_TENANT="${SMOKE_APPLY_TENANT:-b0000000-0000-4000-8000-000000000002}"
APPLY_SUB="${SMOKE_APPLY_SUB:-seed:demo-owner-b}"
APPLY_MAPPING="${SMOKE_APPLY_MAPPING:-b0000000-0000-4000-8000-0000000000d1}"
# The address, which is a different fixture from the subject and always was.
APPLY_EMAIL="${SMOKE_APPLY_EMAIL:-owner-b@demo.openmigrate.test}"
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

# WHAT FAILED, NOT MERELY THAT SOMETHING DID.
#
# This script has ONE HUNDRED AND FORTY-SEVEN places that can set the flag and,
# until now, one
# verdict line that said `SMOKE FAIL` and nothing else. The owner ran it on the
# Spark, got a FAIL with `verify: done  apply: applied`, and had to ask which
# assertion had fired — on a phone, against a 3,900-line script and a log of
# several hundred lines. The gate knew the answer and did not say it.
#
# So every site records WHERE it fired instead of only THAT it fired.
# `BASH_LINENO[0]` inside a function is the caller's line, so the call site
# costs nothing: a bare `fail_at` already yields "section, line 1592", which is
# the whole diagnosis for a script whose sections are named after what they
# prove. A sentence may be passed when the line number alone would not be
# enough, and most sites need none — they already `echo` their complaint on the
# line above, and this points at it.
#
# Deliberately a STRING and not an array: `set -u` is on, arrays make an empty
# one a special case at every read, and this is only ever appended to and
# printed once.
SECTION="startup"
FAIL_REASONS=""
fail_at() { # fail_at [reason] — set the flag AND record where it fired
  fail=1
  FAIL_REASONS="${FAIL_REASONS}  - ${SECTION} (line ${BASH_LINENO[0]}): ${1:-see this section in the log above}
"
}

# `note` names the section AND remembers it, so `fail_at` can say which half of
# the run was speaking without every call site repeating it.
note() { SECTION="$*"; printf '\n--- %s ---\n' "$*"; }

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
  fail_at
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
  fail_at
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
  fail_at
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
IDP_SIGNIN_APP=""     # the throwaway OIDC client this gate signs in with, for the take-back
IDP_SIGNIN_CLIENT=""  # its client id
IDP_SMOKE_APP_NAME="Ownpace Smoke $$"

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
    "${STACK_ISSUER%/}/oauth/v2/authorize?client_id=${IDP_SIGNIN_CLIENT}&redirect_uri=${IDP_REDIRECT}&response_type=code&scope=openid%20email%20profile&code_challenge=${challenge}&code_challenge_method=S256" \
    2>/dev/null | tr -d '\r' | sed -n 's/^[Ll]ocation: //p' | awk 'NR==1')"
  ar="$(sed -n 's/.*[?&]authRequest=\([^&]*\).*/\1/p' <<<"$loc")"
  if [ -z "$ar" ]; then
    # THE TWO FAILURES LOOK THE SAME AND ARE NOT. A login v1 redirect carries
    # `authRequestID=` and a bare number; a login v2 one carries `authRequest=`
    # and a `V2_` id. The old message read "started no authorization request"
    # for both, which is false for the first — the provider started one this
    # gate cannot finalise. E2E (managed) #80 spent its whole run on that
    # sentence.
    case "$loc" in
      *authRequestID=*)
        echo "the provider sent $email to the login v1 UI (${loc})." >&2
        echo "  /v2/sessions + CreateCallback finalises V2_ authorization requests only — a v1 one does not exist to it." >&2
        echo "  the client this gate signs in with must carry loginVersion:{loginV2:{}}; ${IDP_SMOKE_APP_NAME} did not get it." >&2 ;;
      *)
        echo "the provider started no authorization request for $email (-> ${loc:-<no redirect>})" >&2 ;;
    esac
    return 1
  fi

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
    --data-urlencode "redirect_uri=${IDP_REDIRECT}" --data-urlencode "client_id=${IDP_SIGNIN_CLIENT}" \
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
#
# AND IT NO LONGER STOPS AT THE PROVIDER, which is the third time that lesson
# has been paid for. Run #68 found eighteen abandoned people AT the provider
# and the database was never looked at; 2026-08-31 found thirty-one probe
# owners on one demo tenant and the sweep below was written for them — but the
# sweep runs at the START OF THE NEXT RUN, so between two runs this gate left
# `tenant_member` rows pointing at people the provider had already deleted
# seconds earlier.
#
# The owner found the third instance on 2026-09-01, from the support screen:
# clicking `smoke-verify-…@smoke.local` opened the identity provider's console
# on a user that no longer existed, and the console answered with its whole
# user list. A membership outliving its account by exactly one run's gap is
# residue with a UI.
#
# So this removes THIS run's own rows, here, in the same trap that removes this
# run's own people. The sweep stays: it is the backstop for a run hard-killed
# before its trap, which is the case it was written for.
idp_take_back() {
  local u
  for u in ${IDP_USERS+"${IDP_USERS[@]}"}; do
    idp_api DELETE "/v2/users/${u}" >/dev/null 2>&1 ||
      echo "[take-back] could not delete user ${u} — the next run's sweep will get them" >&2
  done
  # `%-$$@smoke.local` is exactly the complement of the sweep's own predicate:
  # it takes this run's rows, the sweep takes every other run's. Between them
  # no @smoke.local membership survives a run that reached either.
  q "DELETE FROM tenant_member WHERE email LIKE '%-$$@smoke.local'" >/dev/null 2>&1 ||
    echo "[take-back] could not remove this run's smoke memberships — the next run's sweep will get them" >&2
  if [ -n "${IDP_SIGNIN_APP:-}" ] && [ -n "${IDP_PROJECT:-}" ]; then
    idp_api DELETE "/management/v1/projects/${IDP_PROJECT}/apps/${IDP_SIGNIN_APP}" >/dev/null 2>&1 ||
      echo "[take-back] could not delete the gate's sign-in client ${IDP_SIGNIN_APP} — the next run's sweep will get it" >&2
  fi
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
    [[ "$uname" =~ ^smoke-(verify|apply|invitee|operator)-[0-9]+@smoke\.local$ ]] ||
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

# The other residue a dead run leaves: the throwaway OIDC client it signs in
# with. Same discipline as the humans above and the same reason — a leftover
# client is a standing credential on a real deployment that nobody is rotating.
# Runs after IDP_PROJECT is known, which is why it is not folded into the sweep
# above.
idp_sweep_leftover_clients() {
  local listing id name swept=0
  listing="$(idp_api POST "/management/v1/projects/${IDP_PROJECT}/apps/_search" '{"queries":[]}')" ||
    { echo "could not ask the provider for leftover sign-in clients" >&2; return 1; }
  # The shape is checked before the loop, for the reason the people sweep checks
  # it: a renamed field would read as "nothing to sweep".
  jq -e '[.result[]?] | all(has("id") and has("name"))' >/dev/null <<<"$listing" ||
    { echo "the application listing does not look like one (no id/name) — refusing to guess: $(jq -c '.result[0] // empty' <<<"$listing")" >&2; return 1; }
  while IFS=$'\t' read -r id name; do
    [ -n "$id" ] || continue
    # ONLY the gate's own naming. "Ownpace Web" lives in this project too, and
    # a sweep that took it would delete the sign-in of the running stack.
    [[ "$name" =~ ^Ownpace\ Smoke\ [0-9]+$ ]] || continue
    idp_api DELETE "/management/v1/projects/${IDP_PROJECT}/apps/${id}" >/dev/null ||
      { echo "could not delete leftover client ${name} (${id})" >&2; return 1; }
    echo "  took back ${name} — a dead run left it behind"
    swept=$(( swept + 1 ))
  done <<<"$(jq -r '.result[]? | [.id, .name] | @tsv' <<<"$listing")"
  if [ "$swept" -gt 0 ]; then
    echo "swept ${swept} leftover sign-in client(s) from earlier runs"
  else
    echo "no leftover sign-in clients to sweep"
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
web_port="$(smoke_env_value WEB_PORT)"
WEB="${SMOKE_WEB:-http://localhost:${web_port:-3123}}"
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
  fail_at
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
tls_port="$(smoke_env_value TRIGGER_TLS_PORT)"
TLS_PORT="${TRIGGER_TLS_PORT:-${tls_port:-3443}}"
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
  fail_at
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
registry_port="$(smoke_env_value REGISTRY_PORT)"
REGISTRY_PORT_CHECK="${SMOKE_REGISTRY_PORT:-${registry_port:-5000}}"
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
  fail_at
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
  fail_at
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
    fail_at
  fi

  # The host has the published port, not the network alias the origin names.
  IDP_PORT_ONLY="${STACK_ISSUER##*:}"
  IDP_HOST_ONLY="${STACK_ISSUER#*://}"; IDP_HOST_ONLY="${IDP_HOST_ONLY%%:*}"
  case "$STACK_ISSUER" in *:[0-9]*) IDP_RESOLVE=(--resolve "${IDP_HOST_ONLY}:${IDP_PORT_ONLY}:127.0.0.1") ;; esac

  # Before this run creates anybody: the people a dead run left behind. A
  # sweep that errors fails the RUN, not only itself — an orphan we can name
  # and cannot remove is a finding.
  idp_sweep_leftovers || fail_at

  # The application, asked for rather than assumed — its client id and the
  # redirect URI it will actually accept.
  IDP_PROJECT="$(docker exec "$API_CONTAINER" printenv JWT_AUDIENCE 2>/dev/null || true)"
  IDP_APP="$(idp_api POST "/management/v1/projects/${IDP_PROJECT}/apps/_search" '{"queries":[]}' \
    | jq -r '.result[]? | select(.name=="Ownpace Web") | .id' | awk 'NR==1')"
  IDP_APP_CFG="$(idp_api GET "/management/v1/projects/${IDP_PROJECT}/apps/${IDP_APP}" || true)"
  IDP_CLIENT_ID="$(jq -r '.app.oidcConfig.clientId // empty' <<<"$IDP_APP_CFG")"
  IDP_REDIRECT="$(jq -r '.app.oidcConfig.redirectUris[0] // empty' <<<"$IDP_APP_CFG")"
  # Mirrored onto the gate's own client below: an http redirect URI is refused
  # without it, and whether this stack has one is WEB_URL's business, not a
  # thing to guess at twice.
  IDP_DEV_MODE="$(jq -r '.app.oidcConfig.devMode // false' <<<"$IDP_APP_CFG")"
  if [ -z "$IDP_CLIENT_ID" ] || [ -z "$IDP_REDIRECT" ]; then
    echo "the provider has no 'Ownpace Web' application to sign in to — setup-zitadel.sh has not finished here."
    fail_at
  fi

  # ONE GOOGLE BUTTON ON THE SIGN-IN SCREEN, HOWEVER OFTEN THE APP PHASE RAN
  # (#711). The workflow runs the provider step a second time before this
  # smoke and reads that it added nothing; this counts what the screen shows.
  # A search that could not see what it created added one per run, and the
  # sign-in screen grew a button each time — nine on the owner's box before
  # anybody counted. Only where the gate carries a sign-in pair: with none
  # there is no provider to count, and that is also a correct stack.
  #
  # ON THE SCREEN = ON THE POLICY PEOPLE RESOLVE, AND ACTIVE. Two console
  # switches take a provider off the sign-in screen and keep it: the
  # "available" toggle removes its login-policy link, and deactivation sets
  # IDP_STATE_INACTIVE. The owner used one of them on seven of the eight, and
  # a count of the template list still said 8 (E2E (managed) #131). So a
  # button is a provider of this name that is active (no state on the wire
  # counts as active, the safe direction) AND linked on the login policy the
  # organisation resolves — the one a person is actually sent to.
  #
  # THE RUNNER'S INSTANCE PERSISTS between runs, so more than one is not
  # something this run did: it is what bring-ups before #711 left, and the
  # script never deletes a provider, because a person may be linked to it. It
  # is still a sign-in screen with that many Google buttons, so it fails —
  # with the remedy, which is a person's, once. After that #711 holds it at one.
  if [ -n "$(grep -E '^IDP_GOOGLE_CLIENT_ID=.+' "${SCRIPT_DIR}/.env" 2>/dev/null | tail -1 || true)" ]; then
    policy_json="$(idp_api GET /management/v1/policies/login || true)"
    linked_json="$(jq -c '[.policy.idps[]?.idpId]' <<<"$policy_json" 2>/dev/null || echo '[]')"
    google_idps_json="$(idp_api POST /admin/v1/idps/templates/_search '{}' || true)"
    google_idps="$(jq -r --argjson linked "$linked_json" '[.result[]? | select(.name == "Google" and .state != "IDP_STATE_INACTIVE") | .id as $i | select(($linked | index($i)) != null)] | length' <<<"$google_idps_json" 2>/dev/null || echo unreadable)"
    google_idps_aside="$(jq -r --argjson linked "$linked_json" '[.result[]? | select(.name == "Google" and .state != "IDP_STATE_INACTIVE") | .id as $i | select(($linked | index($i)) == null)] | length' <<<"$google_idps_json" 2>/dev/null || echo 0)"
    google_idps_off="$(jq -r '[.result[]? | select(.name == "Google" and .state == "IDP_STATE_INACTIVE")] | length' <<<"$google_idps_json" 2>/dev/null || echo 0)"
    case "$google_idps" in
      1)
        echo "    one Google button on the sign-in screen, after the provider step ran twice"
        [ "${google_idps_aside:-0}" = "0" ] \
          || echo "    (${google_idps_aside} more named Google exist, taken off the screen — kept, not offered)"
        [ "${google_idps_off:-0}" = "0" ] \
          || echo "    (${google_idps_off} more named Google are deactivated — on the list, off the screen)" ;;
      0|''|unreadable)
        echo "expected ONE Google button on the sign-in screen, found '${google_idps}' — no active provider of that name is on the login policy, or a list could not be read"
        fail_at ;;
      *)
        echo "found ${google_idps} Google buttons on the sign-in screen — ${google_idps} active providers named Google are on the login policy."
        echo "  The provider step ran twice in this run and added nothing (the workflow step read it), so these"
        echo "  are older: every bring-up before #711 added one, and setup-zitadel.sh never deletes a provider,"
        echo "  because a person may be linked to it. Take the extras off the screen, once:"
        echo "    ./deploy/compose/setup-zitadel.sh --offer-one Google      (their links go; every provider stays)"
        echo "  or in the console:"
        echo "    ${STACK_ISSUER}/ui/console  ->  Default settings  ->  Login Behaviour and Security  ->  Identity Providers"
        echo "  the 'available' toggle keeps the provider and takes its button away; deactivating does too. In the"
        echo "  INSTANCE (default) settings, not the organisation's — the bring-up resets an organisation's own login"
        echo "  policy, and a clean-up made there is undone with it. After that, #711 holds it at one."
        fail_at ;;
    esac
  fi

  # ---- the login page a browser is actually sent to ----
  #
  # EVERYTHING ELSE IN THIS GATE SIGNS IN LIKE A MACHINE. `sign_in_as` takes the
  # authorization request straight to /v2/sessions and CreateCallback with a
  # provisioning token — the same mechanism Zitadel's own login UI uses — so it
  # is green whether or not a human could have got through.
  #
  # On 2026-08-25 a human could not. The instance required login v2, a separate
  # application this stack does not run, so every sign-in ended on the
  # gateway's JSON `code: 5, message: "Not Found"` instead of a login form —
  # and this gate was green for the whole of it, because no assertion had ever
  # loaded the page a person is sent to. setup-zitadel.sh now pins the login
  # version; this is what would have said so.
  #
  # THE COOKIE JAR IS NOT OPTIONAL. Zitadel binds an authorization request to
  # the user-agent cookie set on the authorize response and refuses to render a
  # login page for any other agent — `User Agent does not correspond
  # (EVENT-adk13)`. Two curls without a shared jar are two agents, so the
  # second would fail for a reason that has nothing to do with what is being
  # checked here. It is also the answer when a person hits that error: the
  # authorization request in the address bar belongs to a different browser
  # session than the one asking for it.
  login_verifier="$(openssl rand -hex 32)"
  login_challenge="$(printf '%s' "$login_verifier" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=\n')"
  login_jar="$(mktemp)"
  # THE WHOLE HEAD, KEPT. Two questions are answered from this one response —
  # where a browser is sent, and what cookie it is sent with — and asking twice
  # would be two authorization requests with two different answers.
  login_head="$(curl -sS "${IDP_RESOLVE[@]}" -m 15 -o /dev/null -D - -c "$login_jar" \
    "${STACK_ISSUER%/}/oauth/v2/authorize?client_id=${IDP_CLIENT_ID}&redirect_uri=${IDP_REDIRECT}&response_type=code&scope=openid%20email&code_challenge=${login_challenge}&code_challenge_method=S256" \
    2>/dev/null | tr -d '\r')"
  login_loc="$(sed -n 's/^[Ll]ocation: //p' <<<"$login_head" | awk 'NR==1')"

  # ---- the Host header the thing in front of us forwarded ----
  #
  # READ OFF THE COOKIE, because that is the only place the raw Host shows up
  # from out here. Zitadel builds the user-agent cookie's domain from
  # `r.Host` — `domain := strings.Split(host, ":")[0]` in
  # `internal/api/http/cookie.go` — so a proxy that rewrites Host produces a
  # cookie scoped to whatever it rewrote it to.
  #
  # AND A BROWSER THEN REFUSES IT. A site may set cookies only for its own
  # domain or a parent, so a cookie scoped elsewhere is dropped, nothing is
  # stored, every request mints a fresh agent id, and the login page answers
  # `User Agent does not correspond (EVENT-adk13)` — for everyone, every time.
  #
  # NOTHING ELSE NOTICES. Instance resolution reads the FORWARDED name, so the
  # provider's own log says the right host while the cookie says an IP; token
  # verification, the session API and every machine path never touch a cookie.
  # The only thing that breaks is the one path no gate walked, which is how it
  # survived on the reference host until somebody tried to sign in by hand
  # (2026-08-25).
  #
  # SILENT WHEN THERE IS NO DOMAIN AT ALL. A `__Host-` prefixed cookie carries
  # none by definition, and that is the healthy shape — there is nothing for a
  # proxy to get wrong.
  login_cookie_domain="$(sed -n 's/^[Ss]et-[Cc]ookie:.*[Dd]omain=\([^;]*\).*/\1/p' <<<"$login_head" | awk 'NR==1')"
  login_cookie_domain="${login_cookie_domain# }"
  login_cookie_domain="${login_cookie_domain#.}"
  login_issuer_host="${STACK_ISSUER#*://}"
  login_issuer_host="${login_issuer_host%%[:/]*}"
  if [ -n "$login_cookie_domain" ] && [ "$login_cookie_domain" != "$login_issuer_host" ]; then
    echo "the provider scoped its sign-in cookie to '${login_cookie_domain}', not '${login_issuer_host}'."
    echo "  a browser on ${login_issuer_host} REFUSES a cookie scoped to another host, so none is stored,"
    echo "  every request gets a fresh user-agent id, and the login page answers"
    echo "  'User Agent does not correspond (EVENT-adk13)' to everybody, every time."
    echo "  That domain is the raw Host header the provider was given. Something in front of it is"
    echo "  rewriting Host; the ingress has to pass the original through (docs/managed-bring-up.md)."
    fail_at
  fi

  case "$login_loc" in
    '')
      echo "the provider sent a browser nowhere — no Location on the authorization request."
      fail_at ;;
    */ui/v2/login*)
      # The exact failure this section exists for, named rather than left to be
      # read off an HTTP code.
      echo "the provider sends people to login v2 (${login_loc}), and nothing in this stack serves that path."
      echo "  a human would get a JSON 'Not Found' page instead of a login form."
      echo "  setup-zitadel.sh pins {\"loginV2\":{\"required\":false}} — it has not run here, or it did not take."
      fail_at ;;
    *)
      login_url="$login_loc"
      case "$login_url" in http*) ;; *) login_url="${STACK_ISSUER%/}${login_loc}" ;; esac
      login_page="$(curl -sS "${IDP_RESOLVE[@]}" -m 15 -b "$login_jar" -c "$login_jar" \
        -w '\n%{http_code}' "$login_url" 2>/dev/null)"
      login_code="${login_page##*$'\n'}"
      login_page="${login_page%$'\n'*}"
      # WHAT THE PAGE SAYS, not the first 200 characters of its `<head>`.
      #
      # The first version of this check printed exactly that, and E2E (managed)
      # #81 is what it cost: the assertion failed, and the evidence it left was
      # a doctype, a lang attribute and two meta tags — the part of an HTML page
      # that never says anything. Working out WHICH page had been served meant
      # reading upstream templates.
      #
      # So the tags come off and the visible text goes in the message. `<body`
      # onwards, because everything before it is machinery.
      login_text="$(tr '\n' ' ' <<<"$login_page" | sed 's/.*<body[^>]*>//; s/<[^>]*>/ /g; s/  */ /g; s/^ *//')"
      login_title="$(sed -n 's/.*<title>\([^<]*\)<\/title>.*/\1/p' <<<"$login_page" | awk 'NR==1')"

      if [ "$login_code" != "200" ]; then
        echo "the login page answered HTTP ${login_code} at ${login_url}: ${login_page:0:200}"
        fail_at
      # THE GATEWAY'S NOT-FOUND BODY, which is the failure this whole section
      # exists for: a redirect to a login UI nothing serves renders as JSON in
      # the browser. Checked by shape rather than by status, because the
      # gateway answers it with a 200 in some configurations.
      elif ! grep -qi '<html' <<<"$login_page"; then
        echo "the login page at ${login_url} served no HTML at all — a human would see this raw:"
        echo "  ${login_page:0:300}"
        fail_at
      # ZITADEL'S OWN ERROR PAGE, which wears the login theme and carries no
      # form. Recognised by the error id it prints — `ID=QUERY-1kIjX`,
      # `(EVENT-adk13)` — because that is the only thing on it that a template
      # change cannot take away, and it is what a human would be staring at.
      elif grep -qE '(ID=[A-Z]+-|\([A-Z]+-[A-Za-z0-9]{4,}\))' <<<"$login_text"; then
        echo "the login page at ${login_url} is an error page, not a login form:"
        echo "  title: ${login_title:-<none>}"
        echo "  text:  ${login_text:0:400}"
        fail_at
      # A HERE-STRING, NOT A PIPE. `curl … | grep -q` kills the producer with
      # SIGPIPE and `pipefail` then takes the killed producer's status — the
      # repo-wide correction in #556.
      #
      # REPORTED AND NOT FATAL, unlike the two above. A form is what this SHOULD
      # find, but its absence is only evidence: an upstream template change
      # would look identical to a broken sign-in from out here, and the two
      # failures that are unambiguous are already fatal above. Saying it out
      # loud keeps it from becoming a silence.
      elif ! grep -qi '<form' <<<"$login_page"; then
        echo "the login page at ${login_url} answered with a page that carries no form."
        echo "  it is HTML and names no error, so this is not the login-version outage."
        echo "  title: ${login_title:-<none>}"
        echo "  text:  ${login_text:0:400}"
      else
        echo "the login page a browser is sent to renders a form"
      fi ;;
  esac
  rm -f "$login_jar"

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

  # ---- the client this gate signs in with ----
  #
  # NOT "Ownpace Web", AND THAT NEEDS SAYING because it looks like an oversight.
  #
  # `sign_in_as` finalises an authorization request with /v2/sessions and
  # CreateCallback — the only way a script completes a sign-in without driving a
  # login form. That API finalises `V2_`-prefixed authorization requests and no
  # others: `LinkSessionToAuthRequest` loads a write model keyed on `V2_<id>`,
  # and a login v1 request, whose id is a bare number, is
  # `Errors.AuthRequest.NotExisting` to it.
  #
  # WHICH KIND THE AUTHORIZE ENDPOINT MAKES IS THE CLIENT'S PROPERTY —
  # instance-wide `loginV2.required`, or failing that the application's own
  # `loginVersion`. "Ownpace Web" is now pinned to v1, because v1 is the login
  # UI this stack actually serves and a human sent to v2 gets a JSON 404
  # (#566). So one client cannot both carry the humans and be finalised by the
  # session API, and the gate stops trying to make it.
  #
  # E2E (managed) #80 is what this costs when it is left implicit: the moment
  # the instance flag was turned off, every sign-in here returned "the provider
  # started no authorization request" and the whole run failed on an unrelated
  # sentence. Nothing had said the gate depended on that flag.
  #
  # A THROWAWAY, not a second permanent application — the reason the smoke's
  # people are throwaways. A standing test client on a real deployment is a
  # credential nobody is rotating. Same project, so JWT_AUDIENCE still matches
  # and the API accepts its tokens exactly as it accepts the web app's.
  idp_sweep_leftover_clients || fail_at
  smoke_app="$(idp_api POST "/management/v1/projects/${IDP_PROJECT}/apps/oidc" "$(jq -nc \
    --arg n "$IDP_SMOKE_APP_NAME" --arg r "$IDP_REDIRECT" --argjson dm "$IDP_DEV_MODE" \
    '{name:$n,
      redirectUris:[$r],
      responseTypes:["OIDC_RESPONSE_TYPE_CODE"],
      grantTypes:["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"],
      appType:"OIDC_APP_TYPE_USER_AGENT",
      authMethodType:"OIDC_AUTH_METHOD_TYPE_NONE",
      accessTokenType:"OIDC_TOKEN_TYPE_JWT",
      idTokenUserinfoAssertion:true,
      loginVersion:{loginV2:{}},
      devMode:$dm}')")" || true
  IDP_SIGNIN_APP="$(jq -r '.appId // empty' <<<"${smoke_app:-}" 2>/dev/null || true)"
  IDP_SIGNIN_CLIENT="$(jq -r '.clientId // empty' <<<"${smoke_app:-}" 2>/dev/null || true)"
  if [ -z "$IDP_SIGNIN_CLIENT" ]; then
    echo "could not create ${IDP_SMOKE_APP_NAME}, the client this gate signs in with: ${smoke_app:0:200}"
    fail_at
  else
    echo "signing in through ${IDP_SMOKE_APP_NAME} (login v2), not the humans' client (login v1)"
  fi

  # ---------- the policy the HUMANS' login is decided by ----------
  #
  # WHY THIS EXISTS, and it is the line above that makes it necessary. This gate
  # signs in through a client pinned to login v2, deliberately, because
  # `/v2/sessions` + CreateCallback finalises V2_ authorization requests only.
  # A person gets login v1 — `/ui/login/login?authRequestID=<a bare number>` —
  # and the two evaluate the login policy differently.
  #
  # On 2026-08-31 nobody could sign in to the OTA instance for six days. An
  # older `setup-zitadel.sh` had minted a custom ORGANISATION login policy from
  # a three-field body, leaving the five Duration fields at their proto3 default
  # of zero. A `passwordCheckLifetime` of 0 means a password check is valid for
  # no time at all: v1 verified the password, found the verification already
  # stale, and rendered the password step again — 200, the same page, no error.
  # A wrong password still said so, because that path returns first.
  #
  # THIS GATE WAS GREEN THROUGHOUT. Not by bad luck: it walks the door the bug
  # was not on. Driving the v1 UI here would be the complete answer and is not
  # what this block is; what it does is pin the POLICY that decides v1, which is
  # deterministic, costs one call, and fails on the exact state that locked
  # everybody out.
  #
  # `isDefault` matters as much as the number. A custom org policy shadows the
  # instance one wholesale — its lifetimes AND the IdP list `configure_idp`
  # writes — so a healthy instance policy proves nothing while something sits in
  # front of it. That is not hypothetical; it is what happened.
  login_policy="$(idp_api GET /management/v1/policies/login 2>/dev/null || true)"
  if [ -z "$login_policy" ]; then
    echo "the login policy people are decided by: could not read it from the provider"
    fail_at
  else
    policy_default="$(jq -r '.policy.isDefault // false' <<<"$login_policy" 2>/dev/null || echo false)"
    # protojson omits a Duration holding its default, so absent and zero are the
    # same answer here and `// "0s"` collapses them onto it.
    policy_life="$(jq -r '(.policy.passwordCheckLifetime // "0s")' <<<"$login_policy" 2>/dev/null || echo 0s)"
    policy_secs="$(jq -rn --arg d "$policy_life" '($d | sub("s$";"") | tonumber? // 0)' 2>/dev/null || echo 0)"
    if [ "$policy_default" != "true" ]; then
      echo "the login policy people are decided by: the organisation carries one of its OWN"
      echo "    It shadows the instance policy wholesale — the sign-in lifetimes, and the"
      echo "    providers configure_idp put buttons on. Reset it:"
      echo "      curl -sS -X DELETE ${STACK_ISSUER%/}/management/v1/policies/login -H \"Authorization: Bearer \$PAT\""
      echo "    then re-run ./deploy/compose/setup-zitadel.sh, which no longer creates one."
      fail_at
    elif [ "${policy_secs%%.*}" -le 0 ] 2>/dev/null; then
      echo "the login policy people are decided by: passwordCheckLifetime is ${policy_life}"
      echo "    A password check valid for no time is a check that is never valid: the right"
      echo "    password returns 200 to the same sign-in page, with no error, for everybody."
      echo "    This gate signs in through login v2 and would not notice. A person would."
      fail_at
    else
      echo "the login policy people are decided by: instance default, password check ${policy_life}"
    fi
  fi

  IDP_PW='Smoke-Person!42'
  OP_EMAIL="smoke-operator-$$@smoke.local"
  read -r VERIFY_SUBJECT VERIFY_TOKEN <<<"$(sign_in_as "smoke-verify-$$@smoke.local" "$IDP_PW")" || true
  read -r APPLY_SUBJECT APPLY_TOKEN   <<<"$(sign_in_as "smoke-apply-$$@smoke.local" "$IDP_PW")" || true
  read -r INV_SUB INV_TOKEN           <<<"$(sign_in_as "$INV_EMAIL" "$IDP_PW")" || true
  # THE FOURTH PERSON, and the only one who is nobody's member. Created here
  # rather than beside the assertion that uses them, a thousand lines below, so
  # they join the same capture loop and the same sweep as everyone else — the
  # take-back this gate promises is by construction, not by remembering.
  read -r OP_SUBJECT OP_TOKEN         <<<"$(sign_in_as "$OP_EMAIL" "$IDP_PW")" || true

  # THE ARRAY IS FILLED HERE, IN THE PARENT SHELL — never inside sign_in_as.
  # That function runs in a command substitution, and an append made there
  # dies with the subshell. That exact append is how the take-back iterated an
  # empty array for six straight runs while `|| true` kept it quiet — the
  # sweep's first live run (E2E managed #68) found all eighteen people, three
  # per run since sign-in was built. Same class as the fail=1 a subshell
  # swallowed in run #60. A person created but never handed back — sign_in_as
  # failing after its create — still leaks, and the sweep at the next run's
  # start is the backstop for exactly that window.
  for subject_id in "${VERIFY_SUBJECT:-}" "${APPLY_SUBJECT:-}" "${INV_SUB:-}" "${OP_SUBJECT:-}"; do
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

  # ---------- and the memberships from every run before this one ----------
  #
  # THE TAKE-BACK STOPPED AT THE PROVIDER. `idp_take_back` deletes the people
  # and the throwaway client, and the invitee's membership is removed where it
  # is made — but the two rows above were never removed by anything. One owner
  # per demo tenant, per night, for ever.
  #
  # Found by the owner on 2026-08-31, reading the support screen this gate now
  # also exercises: "Demo Tenant A — Acme Families has 31 probe owner users...
  # a bit much!?" Thirty-one nights.
  #
  # Exactly the shape of run #68, where eighteen abandoned people were found at
  # the PROVIDER — that leak was fixed on the provider side and our own database
  # was never looked at. The lesson costs nothing the second time only if it is
  # applied on both sides.
  #
  # SWEPT BEFORE THIS RUN'S OWN ROWS ARE WRITTEN would be wrong — they are
  # written above, and this runs after. So it removes every `@smoke.local`
  # membership that is NOT this run's, keyed on the pid the emails carry. A
  # membership belonging to a person the provider no longer has is residue by
  # definition.
  swept="$(q "DELETE FROM tenant_member
              WHERE email LIKE '%@smoke.local'
                AND email NOT LIKE '%-$$@smoke.local'
              RETURNING 1" | grep -c 1 || true)"
  echo "swept ${swept:-0} membership(s) left behind by earlier runs"
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
    *) echo "no signed-in person for tenant $tenant"; fail_at; return 1 ;;
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
  [ "$VERIFY_RESULT" = "done" ] || fail_at "verify ($VERIFY_LABEL) never reached 'done' — VERIFY_RESULT=$VERIFY_RESULT"

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
  fail_at "verify ($VERIFY_LABEL) reached 'done' having compared nothing — totalItemsSource=0"
fi

  # AND A DOMAIN THAT WAS SKIPPED WAS NOT CHECKED, whatever the overall status
  # says. The report spells this out itself — every skipped domain carries an
  # issue with id `SKIPPED_<domain>` and the message "this domain was NOT
  # checked" — so the assertion is simply that the ids we require are absent.
  # Matching on that id rather than on the status field because the per-domain
  # blocks contain nested `issues` arrays, which no `[^}]*` grep survives.
  #
  # ABSENT IS NOT THE SAME AS UNSKIPPED, and reading it as such is how this
  # gate would have missed the very defect #750 fixed. Until #750 the report
  # had four domain keys and no `tasks` at all: a `SKIPPED_tasks` grep finds
  # nothing in that report, and "nothing found" was this loop's PASS. So a
  # domain absent from the report is now its own failure, louder than a skip —
  # a skip is a domain the engine declined to check, an absence is a domain
  # the engine does not know exists.
  #
  # The presence probe is `"<domain>":{` because that is the shape the report
  # actually has (`"report":{"<mappingId>":{"mail":{…},"calendar":{…},…}`).
  # Bare `"<domain>"` would match the word anywhere in a nested issue message
  # and hand back the same false pass in a new disguise.
for d in "${REQUIRED_DOMAINS[@]}"; do
  if ! grep -q "\"${d}\":{" <<<"$rbody"; then
    echo ""
    echo "verify ($VERIFY_LABEL) has NO '${d}' domain in its report at all."
    echo "Not skipped — absent. The engine walks VERIFICATION_DOMAINS"
    echo "(packages/shared/src/verification-report.ts) and builds a total record over it,"
    echo "so a missing key means this stack is running an engine that predates the domain."
    echo "That is the shape workplan 0113's fifth fan-out was: four keys, a ticked fifth"
    echo "domain, and canProceedToCutover computed over four fifths of the migration."
    fail_at "verify ($VERIFY_LABEL) report has no '${d}' domain key — the engine never knew about it"
  elif grep -q "SKIPPED_${d}" <<<"$rbody"; then
    echo ""
    echo "verify ($VERIFY_LABEL) SKIPPED the '${d}' domain, which this mapping exists to cover."
    echo "The report says it plainly: 'this domain was NOT checked'. A verify that skips"
    echo "the domain in question is the same lie as an apply half that never runs — the"
    echo "run is green and the thing it was for did not happen."
    echo "Check the mapping's configured domains (seed-managed.ts: DemoTenant.domains)."
    fail_at "verify ($VERIFY_LABEL) SKIPPED the '${d}' domain — see seed-managed.ts DemoTenant.domains"
  else
    echo "verify ($VERIFY_LABEL): '${d}' was actually checked"
  fi
done
}

# Tenant A — mail, against the demo Stalwart.
verify_mapping "$VERIFY_TENANT" "$VERIFY_SUB" "$VERIFY_MAPPING" mail mail

# Tenant B — calendar, contacts, files and tasks, against the demo Nextcloud.
# The same mapping the apply half then acts on.
#
# DELIBERATELY NOT ASSERTED `PASS`, and the reason is this script itself. The
# apply half removes one real item from the target every run and the tombstone
# is permanent, so the target legitimately lacks items the source still lists —
# `missingOnTarget` is EXPECTED here and grows by one per run. Asserting PASS
# would make the gate red for its own correct behaviour. What is asserted is
# the part that was missing: that each domain was CHECKED at all, and that the
# comparison had something in it.
#
# `tasks` joins the required list here, and this is the SIXTH place workplan
# 0113's fan-out reached. #750 made the engine walk every domain and taught
# both self-hosted gates to read every one; this call still named three by
# hand, so the managed gate would have gone on never asking about the task
# domain with a report that finally had the answer in it.
#
# The spelling is the report's, not the tick's: VERIFICATION_DOMAINS says
# `tasks`, the mapping config says `tasks`, the discovery domain says `task`
# and the ledger row says `task`. Four vocabularies, still four (flagged on
# #746, the owner's call) — this line speaks the report's.
verify_mapping "$APPLY_TENANT" "$APPLY_SUB" "$APPLY_MAPPING" dav calendar contacts files tasks

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
# Fresh event 1 is the SCHEDULING CANARY (0103 T2), and the byte-check further
# down reads its copy off the target AFTER this half has run — so the apply
# half must never spend it. It did, once: E2E managed #88 applied a real
# deletion to exactly that item (natural-key hash c52e5949…, the canary event)
# four seconds before the read, and the gate reported its own deletion as an
# unproven byte-check. Five other fresh items per seed stay disposable. The
# prepare wait loop polls pick_disposable itself, so wait and pick carry this
# exclusion by construction, not by agreement (the run-#18 lesson).
CANARY_RE="openmig-demo-event-.+-1[.]ics$"
HREF_EXPR="coalesce(source_ref_href, source_ref->>'href', '')"

pick_disposable() {
  q "SELECT natural_key_hash FROM item WHERE tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING' AND $ELIGIBLE AND $HREF_EXPR !~ '$FIXTURE_RE' AND $HREF_EXPR !~ '$CANARY_RE' ORDER BY first_seen_at DESC, natural_key_hash LIMIT 1"
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

  # ---------- THE TASK LANE LANDED (workplan 0113 T7) ----------
  #
  # WHY THIS IS AN ASSERTION AND NOT A LINE IN THE INVENTORY. The diagnosis
  # below already groups by `domain`, so a task row would SHOW there — and a
  # run with no task rows at all would show nothing there and stay green,
  # because the apply half takes whichever eligible item it finds and one
  # calendar row satisfies it. That is the shape that has fooled this gate
  # twice: green because the half that mattered never executed.
  #
  # So the task domain is checked BY NAME. What it proves is the whole of
  # 0113 end to end against a real Nextcloud, and none of it is provable by a
  # unit test:
  #   - the source listed a collection declaring VTODO and nothing else (T3a),
  #   - it yielded the VTODOs in it rather than skipping them (T3b),
  #   - the writer created the target collection and PUT them (T4),
  #   - the tick, the ledger domain and the natural key all agree (T5, T2).
  # A regression in any one of those lands here as a count of zero.
  #
  # Scoped to THIS run's tag, so a task row left by an earlier run cannot
  # answer for this one — the same rule the balance section works under.
  # Polled rather than read once, because the sync is a Trigger.dev run and
  # the calendar row the apply half waited for can land before the task one.
  TASK_TAGGED="$HREF_EXPR LIKE '%${BALANCE_TAG}%'"
  TASK_SCOPE="tenant_id='$APPLY_TENANT' AND mapping_id='$APPLY_MAPPING'"
  task_rows=0
  i=0
  while [ $i -lt "$PREP_POLLS" ]; do
    task_rows="$(q "SELECT count(*) FROM item WHERE $TASK_SCOPE AND $TASK_TAGGED AND domain='task' AND status IN ('copied','updated')")"
    [ "${task_rows:-0}" -gt 0 ] && break
    i=$((i + 1))
    sleep "$POLL_SLEEP"
  done
  if [ "${task_rows:-0}" -gt 0 ]; then
    echo "prepare: the task lane landed — ${task_rows} VTODO row(s) copied under tag ${BALANCE_TAG}"
  else
    # Loud, and it FAILS the run. A task list that does not migrate is the
    # defect 0113 exists to stop, and the owner found the last one in his own
    # account rather than here.
    echo "::error::the task domain copied NOTHING under tag ${BALANCE_TAG}."
    echo "The source was seeded with a VTODO-only collection and the mapping selects 'task',"
    echo "so zero copied rows means one of: the source skipped the collection (0113 T3a),"
    echo "it skipped the VTODOs inside it (T3b), the writer refused them (T4), or the tick"
    echo "never reached the domain at all (T5's fan-outs). What the ledger holds per domain"
    echo "is in the inventory below."
    q "SELECT domain, status, count(*) FROM item WHERE $TASK_SCOPE AND $TASK_TAGGED GROUP BY 1,2 ORDER BY 1,2" \
      | sed 's/^/  /'
    fail_at "the task domain copied NOTHING under tag ${BALANCE_TAG} (workplan 0113 T3a/T3b/T4/T5)"
  fi
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
case "$APPLY_RESULT" in applied | refused) : ;; *) fail_at "the apply half neither applied nor refused — APPLY_RESULT=$APPLY_RESULT" ;; esac

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
  fail_at
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
  fail_at
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

  # WHICH ADDRESS THE API ACTUALLY VERIFIES AGAINST, asked before anything is
  # asserted about it.
  #
  # `middleware/auth.ts` resolves the key source as
  # `JWT_JWKS_URI || discoverJwksUri(JWT_ISSUER)` — the variable SHORT-CIRCUITS
  # discovery, so when it is set the API never fetches a discovery document at
  # all. That escape hatch exists for a real topology: on a stack where
  # something fronts the provider, `JWT_ISSUER` is a public https name and
  # `managed.yml` gives the provider a network alias of exactly that name, so
  # from inside the network it resolves to the CONTAINER and a fetch asks for
  # 443 where nothing listens.
  #
  # This check asked for the discovery document regardless, and E2E (managed)
  # #82 is the bill: `connect ECONNREFUSED 172.23.0.11:443`, reported as "the
  # API cannot reach the issuer" on a stack whose API verifies tokens perfectly
  # — and whose readiness endpoint says `ok`, because #567 taught THAT probe the
  # same lesson and this one was left behind.
  #
  # SO EACH HALF IS ASKED FROM THE SIDE THAT CAN ANSWER IT (the correction of
  # #517, again). The key source is proved from the API container, because that
  # is the thing that must reach it. The discovery document is proved from the
  # HOST, because the browser is what reads it — `oidc.ts` fetches it to find
  # the authorization and token endpoints — and the host takes the browser's
  # path. Neither assertion is dropped; both move to a caller in a position to
  # make them.
  API_JWKS="$(docker exec "$API_CONTAINER" printenv JWT_JWKS_URI 2>/dev/null || true)"

  if [ -n "$API_JWKS" ]; then
    idp_get "$API_JWKS" >/dev/null
    JWKS_RC=$?
    if [ "$JWKS_RC" -ne 0 ]; then
      echo "JWT_JWKS_URI '$API_JWKS' is not fetchable from the API (exit ${JWKS_RC}) — no token could be verified."
      fail_at
    else
      echo "jwks:   $API_JWKS (fetchable by the API; JWT_JWKS_URI is set, so discovery is not the API's path)"
    fi

    # The browser's half. `IDP_RESOLVE` is empty unless the issuer names a port,
    # in which case it pins that name to loopback — the same array `sign_in_as`
    # uses, so this takes exactly the route the gate's own sign-ins take.
    HOST_DISC="$(curl -sS "${IDP_RESOLVE[@]}" -m 15 "${ISSUER%/}/.well-known/openid-configuration" 2>&1)" || HOST_DISC=""
    HOST_DECLARED="$(jq -r '.issuer // empty' <<<"$HOST_DISC" 2>/dev/null || true)"
    if [ -z "$HOST_DECLARED" ]; then
      echo "the issuer serves no discovery document at ${ISSUER} from outside the stack:"
      echo "  ${HOST_DISC:0:300}"
      echo "The web app reads its authorization and token endpoints there, so a browser"
      echo "could not begin a sign-in at all."
      fail_at
    elif [ "$HOST_DECLARED" != "${ISSUER%/}" ] && [ "$HOST_DECLARED" != "$ISSUER" ]; then
      echo "the issuer at $ISSUER declares '$HOST_DECLARED' — sign-in would refuse this."
      fail_at
    else
      echo "issuer: $ISSUER (declares its own name, as a browser sees it)"
    fi
  else

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
        fail_at ;;
    22) echo "the issuer at $ISSUER answered, but not with a discovery document:"
        echo "  ${DISCOVERY:0:300}"
        fail_at ;;
    *)  echo "this check could not run: asking the API container failed (exit ${DISC_RC})."
        echo "  ${DISCOVERY:0:300}"
        echo "That is a fact about the probe, not about the issuer — nothing here has been"
        echo "measured either way."
        fail_at ;;
  esac

  DECLARED="$(jq -r '.issuer // empty' <<<"$DISCOVERY" 2>/dev/null || true)"
  JWKS="$(jq -r '.jwks_uri // empty' <<<"$DISCOVERY" 2>/dev/null || true)"

  # Byte for byte, and that is the point: OIDC Discovery §4.3 says a document
  # declaring a different issuer is not this issuer, and both `oidc.ts` and
  # `auth.ts` refuse on a mismatch. A trailing slash is the difference between
  # a working sign-in and a refusal nobody can explain.
  if [ "$DISC_RC" -eq 0 ] && [ "$DECLARED" != "${ISSUER%/}" ] && [ "$DECLARED" != "$ISSUER" ]; then
    echo "the issuer at $ISSUER declares '$DECLARED' (as seen BY THE API) — sign-in would refuse this."
    fail_at
  elif [ "$DISC_RC" -eq 0 ]; then
    echo "issuer: $ISSUER (declares its own name)"
  fi

  # The keys the API verifies every token against. Discovery naming a jwks_uri
  # nothing serves is a stack that authenticates nobody, and it looks healthy.
  if [ "$DISC_RC" -eq 0 ]; then
    if [ -z "$JWKS" ]; then
      echo "the discovery document names no jwks_uri — no token could be verified."
      fail_at
    else
      idp_get "$JWKS" >/dev/null
      JWKS_RC=$?
      if [ "$JWKS_RC" -ne 0 ]; then
        echo "jwks_uri '$JWKS' is not fetchable from the API (exit ${JWKS_RC}) — no token could be verified."
        fail_at
      else
        echo "jwks:   $JWKS (fetchable)"
      fi
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
  fail_at
fi

T1="$(printf '0099%04d-e29b-41d4-a716-44665544%04d' 1 1)"
T2="$(printf '0099%04d-e29b-41d4-a716-44665544%04d' 2 2)"
T3="$(printf '0099%04d-e29b-41d4-a716-44665544%04d' 3 3)"

acc="$(http POST "$API/api/invitations/${T1}/accept" "$INV_TOKEN")"
dec="$(http POST "$API/api/invitations/${T2}/decline" "$INV_TOKEN")"
# T3 IS THE SKIP. Deliberately no request.

echo "accept:  $acc"
echo "decline: $dec"
[ "${acc%% *}" = "200" ] || { echo "accepting an invitation failed"; fail_at; }
[ "${dec%% *}" = "200" ] || { echo "declining an invitation failed"; fail_at; }

s1="$(q "SELECT status FROM tenant_member WHERE tenant_id='${T1}' AND email='${INV_EMAIL}'")"
u1="$(q "SELECT user_id FROM tenant_member WHERE tenant_id='${T1}' AND email='${INV_EMAIL}'")"
s2="$(q "SELECT status FROM tenant_member WHERE tenant_id='${T2}' AND email='${INV_EMAIL}'")"
u2="$(q "SELECT user_id FROM tenant_member WHERE tenant_id='${T2}' AND email='${INV_EMAIL}'")"
s3="$(q "SELECT status FROM tenant_member WHERE tenant_id='${T3}' AND email='${INV_EMAIL}'")"
echo "accepted -> ${s1} (${u1})   declined -> ${s2} (${u2})   skipped -> ${s3}"

[ "$s1" = "active" ] || { echo "accepting did not make the membership active"; fail_at; }
[ "$u1" = "$INV_SUB" ] || { echo "accepting did not bind the subject"; fail_at; }
[ "$s2" = "declined" ] || { echo "declining did not record the refusal"; fail_at; }
# The property migration 0008's WITH CHECK exists to guarantee: a refusal names
# nobody. If this ever reads a real subject, the database stopped enforcing it.
case "$u2" in
  pending:*) ;;
  *) echo "declining BOUND the decliner ($u2) — it must leave the pending id"; fail_at ;;
esac
[ "$s3" = "invited" ] || { echo "the skipped invitation did not stay open (got '$s3')"; fail_at; }

# And it is still OFFERED, which is what makes skipping a deferral rather than a
# quiet loss. One left: the accepted one is a membership now, the declined one
# is answered.
ME_AFTER="$(http GET "$API/api/me" "$INV_TOKEN")"
left="$(printf '%s' "${ME_AFTER#* }" | grep -o '"invitations":\[[^]]*\]' | grep -o '"tenantId"' | wc -l | tr -d ' ')"
echo "still offered after answering: $left"
[ "$left" = "1" ] || { echo "expected exactly the skipped invitation to remain, got $left"; fail_at; }

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
[ "${cls%% *}" = "200" ] || { echo "closing a tenant failed"; fail_at; }

# The ROW, not the response. A 200 describing a closure that was never recorded
# is the shape of failure this whole script exists to catch, and the closure row
# is what the purge job actually reads.
closed="$(q "SELECT count(*) FROM tenant_closure WHERE tenant_id='${T1}'")"
due="$(q "SELECT purge_after > closed_at FROM tenant_closure WHERE tenant_id='${T1}'")"
echo "closure rows: ${closed:-0}   purge_after is after closed_at: ${due:-<none>}"
[ "${closed:-0}" = "1" ] || { echo "the close wrote no closure row — nothing would ever purge"; fail_at; }
# A window that ends before it starts would purge immediately, which is the one
# way this path can quietly become destructive.
[ "${due:-f}" = "t" ] || { echo "purge_after is not after closed_at — that window is not a window"; fail_at; }

reo="$(http POST "$API/api/tenants/${T1}/reopen" "$INV_TOKEN")"
echo "reopen: $reo"
[ "${reo%% *}" = "200" ] || { echo "reopening a closed tenant failed"; fail_at; }
still="$(q "SELECT count(*) FROM tenant_closure WHERE tenant_id='${T1}'")"
echo "closure rows after reopen: ${still:-?}"
# The point of reopen is that the clock STOPS. A reopen that leaves the row
# behind is a tenant that gets erased on schedule despite having been reopened.
[ "${still:-1}" = "0" ] || { echo "reopen left the closure row — the erasure clock is still running"; fail_at; }

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
# empties the catcher would wipe whatever an operator was looking at. What
# makes it unique is SMOKE_MAIL_RUN below, and the note there is about why the
# obvious way to build it is not enough.
note "an access request, and the mail it produces"

# THE BIND IS A SETTING, SO THE ADDRESS IS DERIVED RATHER THAN ASSUMED.
#
# #574 made the publish interface configurable: `MAILPIT_BIND` lets an operator
# reach the catcher over a private mesh without a tunnel every time, and the
# shipped default stays loopback for everybody who does not ask. This line
# hard-coded `localhost` anyway — so the day somebody took the documented
# option, both mail assertions below started answering "mailpit is not
# answering", and E2E (managed) #84 went red on a stack whose mail was fine.
#
# A DOCUMENTED SETTING THAT BREAKS THE GATE IS A BUG IN THE GATE. The failure
# also pointed the wrong way: "the mail path is unproven" reads as the API not
# sending, which is the one thing it was not.
#
# READ OUT OF .env, not out of the environment. This script sources no `.env`
# (see the SMTP_HOST line further down, which says so and does it this way), so
# `${MAILPIT_PORT:-3127}` was never the setting — it was the default wearing a
# variable's clothes, and would have missed a moved PORT exactly as it missed
# the moved BIND.
mailpit_bind="$(smoke_env_value MAILPIT_BIND)"
mailpit_port="$(smoke_env_value MAILPIT_PORT)"
# 0.0.0.0 is every interface, and every interface includes loopback — so it is
# still reachable here. A mesh address is not: that publish replaces loopback
# rather than adding to it, which is the case that went red.
case "$mailpit_bind" in
  '' | 127.0.0.1 | 0.0.0.0 | '[::]') mailpit_host=localhost ;;
  *) mailpit_host="$mailpit_bind" ;;
esac
MAILPIT="${SMOKE_MAILPIT:-http://${mailpit_host}:${mailpit_port:-3127}}"
# AND A PID COMES BACK, WHICH IS WHY THIS IS NOT JUST `$$`. The paragraph above
# promises these addresses name THIS run's mail. `$$` alone does not keep that
# promise: the managed gate deliberately runs against a long-lived stack and
# never does `down -v` (e2e-managed.yml says why), so Mailpit still holds what
# earlier runs sent, and a repeated pid makes a previous run's message answer
# for this one. That is a FALSE PASS in the one assertion written to catch
# "nobody was told" — the gate would be greenest exactly when the mail path had
# broken. A timestamp beside the pid is what BALANCE_TAG already does, for this
# same reason.
SMOKE_MAIL_RUN="$(date -u +%Y%m%d%H%M%S)-$$"
knock="smoke-knock-${SMOKE_MAIL_RUN}@example.invalid"

if ! curl -fsS -o /dev/null "${MAILPIT}/api/v1/messages"; then
  # Not skipped quietly. The catcher is in managed.yml and in the bring-up's
  # service list; if it is not answering, the mail path is unproven and this
  # gate must say so rather than pass by omission.
  echo "mailpit is not answering at ${MAILPIT} — the mail path is unproven"; fail_at
else
  knock_code="$(curl -fsS -o /tmp/knock.$$ -w '%{http_code}' -X POST "${API}/api/access-requests" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg e "$knock" '{email:$e, locale:"en", tier:"Small", organisation:"Smoke BV"}')" \
    || echo 000)"
  [ "$knock_code" = "201" ] ||
    { echo "the front door refused a request: HTTP ${knock_code} $(head -c 200 /tmp/knock.$$ 2>/dev/null)"; fail_at; }
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
    fail_at
  else
    # Not merely "a mail exists". The operator's mail must be the one that
    # arrived, and it must carry the address they have to reply to.
    hit="$(curl -fsS --get "${MAILPIT}/api/v1/search" --data-urlencode "query=${knock}" \
      | jq -r '.messages[0] // empty')"
    subject="$(jq -r '.Subject // empty' <<<"$hit")"
    case "$subject" in
      *"asked for access"*|*"vraagt toegang"*) : ;;
      *) echo "mail arrived but is not the knock: subject '${subject}'"; fail_at ;;
    esac
    # Addressed to NOTIFY_TO, never to the person who asked. Mailing the
    # applicant their own request would leak the operator's channel.
    to_applicant="$(jq -r --arg k "$knock" '[.To[]?.Address] | index($k) // empty' <<<"$hit")"
    [ -z "$to_applicant" ] ||
      { echo "the knock mail was addressed to the applicant (${knock}), not to NOTIFY_TO"; fail_at; }
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
smtp_configured="$(grep -E '^SMTP_HOST=.+' "${SCRIPT_DIR}/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true)"

if [ -z "$smtp_configured" ]; then
  note "the identity provider's own mail: no SMTP_HOST in .env, so nothing to assert"
elif [ -n "${STACK_ISSUER:-}" ] && [ -n "${IDP_PAT:-}" ]; then
  note "the identity provider's own mail"
  idp_mail="smoke-idp-${SMOKE_MAIL_RUN}@example.invalid"
  providers="$(idp_api POST /admin/v1/email/_search '{}' || true)"
  smtp_id="$(jq -r 'first(.result[]? | select(.smtp) | .id) // empty' <<<"${providers:-{\}}")"
  smtp_state="$(jq -r 'first(.result[]? | select(.smtp) | .state) // empty' <<<"${providers:-{\}}")"

  if [ -z "$smtp_id" ]; then
    echo "the identity provider has NO email provider configured."
    echo "  Every verification and email-change mail it composes is dropped, and the"
    echo "  screen still says to check your mail. Run --only app to configure it,"
    echo "  or set SMTP_HOST/NOTIFY_FROM in .env first if they are empty."
    fail_at
  elif [ "$smtp_state" != "EMAIL_PROVIDER_ACTIVE" ]; then
    echo "the identity provider's email provider ${smtp_id} is '${smtp_state}',"
    echo "  not EMAIL_PROVIDER_ACTIVE. An inactive provider drops mail exactly as"
    echo "  silently as no provider at all."
    fail_at
  elif ! curl -fsS -o /dev/null "${MAILPIT}/api/v1/messages"; then
    echo "cannot reach Mailpit at ${MAILPIT} — the provider's mail cannot be read."
    fail_at
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
      fail_at
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
    fail_at
  elif [ -n "${4:-}" ] && [ "$value" != "$4" ]; then
    # The fourth argument is for answers where only ONE is acceptable. Without
    # it a report passes on any answer it manages to produce, which is right for
    # a count (0 addresses is a true answer) and wrong for a health verdict.
    echo "$1: HTTP 200 but $3 -> '$value', expected '$4'"
    fail_at
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
    *) echo "$1: HTTP $code, no '$3' — ${body:0:200}"; fail_at ;;
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
# WHAT THIS DEPLOYMENT SAYS ITS OWN GOOGLE APPLICATION CARRIES (ADR-0041).
#
# The wizard reads this route rather than a compiled-in constant, because
# `GOOGLE_ACCOUNT_SCOPE_CLASS` is set on a running stack and the browser bundle
# was built before anybody set it. So a stack that serves the app and not this
# is a wizard falling back to two ticks for a reason nobody can see — the
# quietest possible failure, and exactly the family this gate exists for.
#
# The ANSWER is not pinned, only that there is one: a stack declaring
# `restricted` and one that has not are both correct, and pinning either would
# make the gate an opinion about somebody's .env. What is pinned is that Google
# is answered for at all.
report_json "provider accounts (google)" "/api/provider-accounts" '.google.domains | length'
# EVERY ADDRESS THIS DEPLOYMENT NEEDS REGISTERED ELSEWHERE (2026-09-01).
#
# The owner met `redirect_uri_mismatch` with the correct string nowhere on
# screen, because API_URL disagreed with what he had registered. This list is
# the surface that answers it, and it is built from the running stack's own
# settings — so a stack that serves the app and not this is an operator with no
# way to check, which is where that evening started.
#
# The VALUES are not pinned, only that there are entries: they are this
# deployment's addresses, and pinning them would make the gate an opinion about
# somebody's .env.
report_json "redirect URIs" "/api/redirect-uris" '.entries | length'

# THE DEPLOYMENT'S OWN GOOGLE CLIENT, AS FACT AND AS REFUSAL (ADR-0041, owner
# decision 2026-09-01; #703–#712). The gate's .env carries a client pair that
# is never followed to Google: the consent route only BUILDS a URL, and nothing
# here opens it. What is asked of the real stack — through PgBouncer, with a
# real issuer token — is the part the unit suites cannot ask:
#
#   the wizard's fact      provider-accounts answers `deployment`
#   the consent's client   a request with no pair gets a URL for THIS id, and
#                          the secret is nowhere in the answer
#   half a pair, twice     a lone clientId is refused at the consent and at the
#                          connection door — before anything is probed or
#                          stored, so the gate stays net-zero
#
# A stack that carries no client is also correct (an appliance never does), and
# then the fact reads `connection` and the consent refuses `no_google_client`,
# which is asserted in its own right rather than skipped.
gate_client_id="$(grep -E '^GOOGLE_OAUTH_CLIENT_ID=.+' "${SCRIPT_DIR}/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true)"
gate_client_secret="$(grep -E '^GOOGLE_OAUTH_CLIENT_SECRET=.+' "${SCRIPT_DIR}/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true)"
if [ -n "$gate_client_id" ] && [ -n "$gate_client_secret" ]; then
  report_json "provider accounts (google client)" "/api/provider-accounts" '.google.client' deployment

  r="$(http POST "$API/api/migrations/google/authorize" "$TOK_R" '{"sourceType":"gmail"}')"
  code="${r%% *}"; body="${r#* }"
  consent_url="$(jq -r '.url // empty' <<<"$body" 2>/dev/null || true)"
  case "$code:$consent_url" in
    "200:"*"client_id=${gate_client_id}"*)
      echo "consent without a pair: HTTP 200, the URL carries the deployment's client id" ;;
    *)
      echo "consent without a pair: HTTP $code, url '${consent_url:0:120}' — ${body:0:200}"
      fail_at ;;
  esac
  case "$body" in
    *"$gate_client_secret"*) echo "the consent answer CARRIES THE CLIENT SECRET"; fail_at ;;
  esac

  r="$(http POST "$API/api/migrations/google/authorize" "$TOK_R" \
    "$(jq -nc --arg c "$gate_client_id" '{sourceType:"gmail", clientId:$c}')")"
  code="${r%% *}"; body="${r#* }"
  if [ "$code" = "400" ] && [ "$(jq -r '.error // empty' <<<"$body")" = "half_client_pair" ]; then
    echo "consent with half a pair: HTTP 400 half_client_pair"
  else
    echo "consent with half a pair: HTTP $code — ${body:0:200} (expected 400 half_client_pair)"
    fail_at
  fi

  r="$(http POST "$API/api/connections" "$TOK_R" \
    "$(jq -nc --arg c "$gate_client_id" \
      '{role:"source", type:"gmail", displayName:"gate: half a pair", values:{username:"gate@example.invalid", clientId:$c}}')")"
  code="${r%% *}"; body="${r#* }"
  if [ "$code" = "400" ] && [ "$(jq -r '.error // empty' <<<"$body")" = "half_client_pair" ]; then
    echo "connection door with half a pair: HTTP 400 half_client_pair, nothing probed or stored"
  else
    echo "connection door with half a pair: HTTP $code — ${body:0:200} (expected 400 half_client_pair)"
    fail_at
  fi
else
  report_json "provider accounts (google client)" "/api/provider-accounts" '.google.client' connection
  r="$(http POST "$API/api/migrations/google/authorize" "$TOK_R" '{"sourceType":"gmail"}')"
  code="${r%% *}"; body="${r#* }"
  if [ "$code" = "400" ] && [ "$(jq -r '.error // empty' <<<"$body")" = "no_google_client" ]; then
    echo "consent without a pair, on a stack without a client: HTTP 400 no_google_client"
  else
    echo "consent without a pair: HTTP $code — ${body:0:200} (expected 400 no_google_client)"
    fail_at
  fi
fi
# THE CALLBACK PAGE, UNDER ITS OWN HEADERS (2026-09-02). The consent popup
# ends on a page the API serves, and the API's defaults — helmet's — deny that
# page its inline script (`script-src 'self'`) and take its opener away
# (`Cross-Origin-Opener-Policy: same-origin`). The owner's walk landed on
# "Handing the result back to the wizard… you can close this window" with
# nothing arriving: the sentence was static, the script never ran, the opener
# was gone. The route now answers with headers derived from the page, proved at
# unit level with helmet mounted; THIS asks the deployed stack, through the web
# origin the browser actually uses, so a proxy that put the defaults back would
# show up here and not on somebody's phone. A bogus state is enough: the
# headers ride every ending, and a bogus state stores nothing and opens nothing.
cb_headers="$(curl -sS -o /dev/null -D - --max-time 15 \
  "${WEB}/api/migrations/google/callback?state=not-a-state" 2>/dev/null || true)"
if grep -q '^HTTP/[0-9.]* 400' <<<"$cb_headers" \
  && grep -qi '^cross-origin-opener-policy: *unsafe-none' <<<"$cb_headers" \
  && grep -qi '^content-security-policy:.*script-src' <<<"$cb_headers" \
  && ! grep -qi "^content-security-policy:.*script-src 'self'" <<<"$cb_headers"; then
  echo "consent callback page: HTTP 400 for a bogus state, served under its own headers (opener kept, script by hash)"
else
  echo "consent callback page: the defaults reached the browser — the popup cannot hand the token back"
  echo "    $(grep -i '^HTTP/\|^cross-origin-opener-policy\|^content-security-policy' <<<"$cb_headers" | tr -d '\r' | paste -sd '|' -)"
  fail_at
fi
# THE DEPLOYMENT'S OWN DROPBOX APP (2026-09-02: Connect with Dropbox), the
# Google block's three questions asked of Dropbox's door: the facts say
# `deployment`; a consent without a pair answers a URL for THIS App key, with
# token_access_type=offline and no secret in it; half a pair is refused. The
# gate's pair is a sentinel that never reaches Dropbox — the URL is built,
# never opened.
gate_dbx_id="$(grep -E '^DROPBOX_OAUTH_CLIENT_ID=.+' "${SCRIPT_DIR}/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true)"
gate_dbx_secret="$(grep -E '^DROPBOX_OAUTH_CLIENT_SECRET=.+' "${SCRIPT_DIR}/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true)"
if [ -n "$gate_dbx_id" ] && [ -n "$gate_dbx_secret" ]; then
  report_json "provider clients (dropbox)" "/api/provider-clients" '.dropbox' deployment

  r="$(http POST "$API/api/migrations/dropbox/authorize" "$TOK_R" '{}')"
  code="${r%% *}"; body="${r#* }"
  dbx_url="$(jq -r '.url // empty' <<<"$body" 2>/dev/null || true)"
  case "$code:$dbx_url" in
    "200:"*"client_id=${gate_dbx_id}"*"token_access_type=offline"*|"200:"*"token_access_type=offline"*"client_id=${gate_dbx_id}"*)
      echo "dropbox consent without a pair: HTTP 200, the URL carries the deployment's App key and offline access" ;;
    *)
      echo "dropbox consent without a pair: HTTP $code, url '${dbx_url:0:120}' — ${body:0:200}"
      fail_at ;;
  esac
  case "$body" in
    *"$gate_dbx_secret"*) echo "the dropbox consent answer CARRIES THE APP SECRET"; fail_at ;;
  esac

  r="$(http POST "$API/api/migrations/dropbox/authorize" "$TOK_R" \
    "$(jq -nc --arg c "$gate_dbx_id" '{clientId:$c}')")"
  code="${r%% *}"; body="${r#* }"
  if [ "$code" = "400" ] && [ "$(jq -r '.error // empty' <<<"$body")" = "half_client_pair" ]; then
    echo "dropbox consent with half a pair: HTTP 400 half_client_pair"
  else
    echo "dropbox consent with half a pair: HTTP $code — ${body:0:200} (expected 400 half_client_pair)"
    fail_at
  fi

  # The folder browse reads the same resolver (the wizard's browse behind
  # rootPath, alive behind the fold since the web half): half a pair is
  # refused before any call to Dropbox — the token below never leaves.
  r="$(http POST "$API/api/migrations/dropbox/shared-folders" "$TOK_R" \
    "$(jq -nc --arg c "$gate_dbx_id" '{clientId:$c, refreshToken:"never-sent-to-dropbox"}')")"
  code="${r%% *}"; body="${r#* }"
  if [ "$code" = "400" ] && [ "$(jq -r '.error // empty' <<<"$body")" = "half_client_pair" ]; then
    echo "dropbox folder browse with half a pair: HTTP 400 half_client_pair, before any call to Dropbox"
  else
    echo "dropbox folder browse with half a pair: HTTP $code — ${body:0:200} (expected 400 half_client_pair)"
    fail_at
  fi
else
  report_json "provider clients (dropbox)" "/api/provider-clients" '.dropbox' connection
fi
# THE DEPLOYMENT'S OWN MICROSOFT APP REGISTRATION (workplan 0114 T8), the
# Google block's three questions asked of Microsoft's door: the facts say
# `deployment`; a consent without a pair answers a URL at Entra's endpoint for
# THIS client id, asking offline_access and exactly the faces named — a face
# nobody ticked is not a scope somebody has to explain to a consent screen —
# with no secret in it; half a pair is refused. The gate's pair is a sentinel
# that never reaches Microsoft: the URL is built, never opened. A stack that
# carries no pair reports `connection` and refuses `no_microsoft_client`,
# asserted in its own right rather than skipped.
gate_ms_id="$(grep -E '^MICROSOFT_OAUTH_CLIENT_ID=.+' "${SCRIPT_DIR}/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true)"
gate_ms_secret="$(grep -E '^MICROSOFT_OAUTH_CLIENT_SECRET=.+' "${SCRIPT_DIR}/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true)"
if [ -n "$gate_ms_id" ] && [ -n "$gate_ms_secret" ]; then
  report_json "provider clients (microsoft)" "/api/provider-clients" '.microsoft' deployment

  r="$(http POST "$API/api/migrations/microsoft/authorize" "$TOK_R" '{"domains":["email","file"]}')"
  code="${r%% *}"; body="${r#* }"
  ms_url="$(jq -r '.url // empty' <<<"$body" 2>/dev/null || true)"
  case "$code:$ms_url" in
    "200:https://login.microsoftonline.com/"*"client_id=${gate_ms_id}"*)
      echo "microsoft consent without a pair: HTTP 200, the URL is Entra's and carries the deployment's client id" ;;
    *)
      echo "microsoft consent without a pair: HTTP $code, url '${ms_url:0:120}' — ${body:0:200}"
      fail_at ;;
  esac
  # The scope is the faces named plus offline_access (the refresh token's own
  # scope), and nothing else: the two faces asked for, present; the three not
  # asked for, absent.
  for want in offline_access Mail.Read Files.Read; do
    case "$ms_url" in
      *"$want"*) ;;
      *) echo "microsoft consent without a pair: the URL does not ask ${want} — '${ms_url:0:160}'"; fail_at ;;
    esac
  done
  case "$ms_url" in
    *Calendars.Read*|*Contacts.Read*|*Tasks.Read*)
      echo "microsoft consent without a pair: the URL asks a face nobody named — '${ms_url:0:160}'"; fail_at ;;
    *) echo "microsoft consent without a pair: the scope is the two faces named and offline_access, nothing more" ;;
  esac
  case "$body" in
    *"$gate_ms_secret"*) echo "the microsoft consent answer CARRIES THE CLIENT SECRET"; fail_at ;;
  esac

  r="$(http POST "$API/api/migrations/microsoft/authorize" "$TOK_R" \
    "$(jq -nc --arg c "$gate_ms_id" '{clientId:$c, domains:["email"]}')")"
  code="${r%% *}"; body="${r#* }"
  if [ "$code" = "400" ] && [ "$(jq -r '.error // empty' <<<"$body")" = "half_client_pair" ]; then
    echo "microsoft consent with half a pair: HTTP 400 half_client_pair"
  else
    echo "microsoft consent with half a pair: HTTP $code — ${body:0:200} (expected 400 half_client_pair)"
    fail_at
  fi
else
  report_json "provider clients (microsoft)" "/api/provider-clients" '.microsoft' connection
  r="$(http POST "$API/api/migrations/microsoft/authorize" "$TOK_R" '{"domains":["email"]}')"
  code="${r%% *}"; body="${r#* }"
  if [ "$code" = "400" ] && [ "$(jq -r '.error // empty' <<<"$body")" = "no_microsoft_client" ]; then
    echo "microsoft consent without a pair, on a stack without a client: HTTP 400 no_microsoft_client"
  else
    echo "microsoft consent without a pair: HTTP $code — ${body:0:200} (expected 400 no_microsoft_client)"
    fail_at
  fi
fi
# The Microsoft callback page, under its own headers — the same page and the
# same `callbackPageHeaders` as Google's (above), asked of the deployed stack
# through the web origin for the same reason: a proxy that put helmet's
# defaults back would take the popup's opener and script away, and this is
# where that shows up rather than on somebody's phone. A bogus state stores
# nothing, exchanges nothing, and opens nothing.
ms_cb_headers="$(curl -sS -o /dev/null -D - --max-time 15 \
  "${WEB}/api/migrations/microsoft/callback?state=not-a-state" 2>/dev/null || true)"
if grep -q '^HTTP/[0-9.]* 400' <<<"$ms_cb_headers" \
  && grep -qi '^cross-origin-opener-policy: *unsafe-none' <<<"$ms_cb_headers" \
  && grep -qi '^content-security-policy:.*script-src' <<<"$ms_cb_headers" \
  && ! grep -qi "^content-security-policy:.*script-src 'self'" <<<"$ms_cb_headers"; then
  echo "microsoft consent callback page: HTTP 400 for a bogus state, served under its own headers (opener kept, script by hash)"
else
  echo "microsoft consent callback page: the defaults reached the browser — the popup cannot hand the token back"
  echo "    $(grep -i '^HTTP/\|^cross-origin-opener-policy\|^content-security-policy' <<<"$ms_cb_headers" | tr -d '\r' | paste -sd '|' -)"
  fail_at
fi
# THE APPLE ACCOUNT KIND, ASSERTED WITHOUT EVER REACHING APPLE (workplan 0115 T9).
#
# Every other provider block above uses a sentinel credential that is built into
# a URL and never followed. Apple has no consent screen and therefore no URL to
# build, so that trick is unavailable — and the obvious alternative, creating a
# sentinel Apple connection, is exactly what must NOT happen here:
# `POST /api/connections` PROBES BEFORE IT STORES, so a sentinel row would fire
# a bogus app-specific password at `caldav.icloud.com` and `imap.mail.me.com` on
# every nightly run. The source config schema carries no `mailHost`, so the mail
# face cannot be pointed at an unroutable host either.
#
# "Never reaches Apple" has to mean PROVABLY, not "the runner happens to have no
# egress". So this block asserts only the two doors that REFUSE BEFORE THE PROBE
# — both refusals are computed from tables, return before any network call, and
# store nothing. Net-zero by construction rather than by hope.
#
# What that buys, and it is the part unit tests cannot: these tables reached the
# DEPLOYED image. `credentialFieldsFor` and the wizard type enum are compiled
# into the API container, and a kind that got dropped from either during a build
# would answer differently here while every unit test stayed green.
r="$(http POST "$API/api/connections" "$TOK_R" \
  '{"role":"target", "type":"apple", "displayName":"gate: apple is not a target", "values":{"username":"gate@example.invalid","password":"never-sent-to-apple"}}')"
code="${r%% *}"; body="${r#* }"
if [ "$code" = "400" ] && [ "$(jq -r '.error // empty' <<<"$body")" = "unknown_type" ]; then
  echo "apple as a TARGET: HTTP 400 unknown_type — Apple is not a place you migrate to, and the deployed image agrees"
else
  echo "apple as a TARGET: HTTP $code — ${body:0:200} (expected 400 unknown_type)"
  fail_at
fi

# And the source door demands the app-specific password BY NAME. This is the
# credential descriptor (0115 T2) proving it survived into the image: if
# `appleAccountFields` were dropped, `credentialFieldsFor` would answer with an
# empty list and this would come back `unknown_type` instead — a different
# refusal, which is why the assertion pins WHICH one.
r="$(http POST "$API/api/connections" "$TOK_R" \
  '{"role":"source", "type":"apple", "displayName":"gate: apple with no password", "values":{"username":"gate@example.invalid"}}')"
code="${r%% *}"; body="${r#* }"
if [ "$code" = "400" ] \
  && [ "$(jq -r '.error // empty' <<<"$body")" = "missing_fields" ] \
  && [ "$(jq -r '[.fields[]? | select(. == "password")] | length' <<<"$body")" = "1" ]; then
  echo "apple source with no app-specific password: HTTP 400 missing_fields naming 'password', before anything is probed or stored"
else
  echo "apple source with no password: HTTP $code — ${body:0:200} (expected 400 missing_fields with 'password' in .fields)"
  fail_at
fi

# ---------- the export archive, and the one gate that costs nothing ----------
#
# THE ONLY SOURCE THIS GATE CAN DRIVE COMPLETELY, and it is worth saying why
# before the assertions (workplan 0116 T1/T7).
#
# Every other provider source here is `uncoverable` in the coverage table for
# one reason: it needs a real account at a real company and a consent screen
# somebody presses. The Apple block above is the extreme case — it can only
# assert the two refusals that return BEFORE any network call, because creating
# a sentinel Apple connection would fire a bogus password at Apple on every
# nightly run.
#
# An archive needs NONE of that. It is a folder of files, so a fixture tree
# written into the API container is a complete and honest stand-in: the same
# bytes a person's export contains, minus the person. No account, no consent, no
# egress — and unlike Apple's block this one is not net-zero, it is net-POSITIVE.
# It creates a connection, tests it against real bytes, and reads the measure
# back off the stored row.
#
# WHAT THAT BUYS over the unit tests, which is the part they cannot: it proves
# the archive reader, the qualifier and the credential descriptor all reached the
# DEPLOYED image, and that the `archive` kind survived into the database's CHECK
# constraint. A kind dropped from any of those during a build answers differently
# here while every unit test stays green.
note "the export archive"

# The smallest Takeout that is still a Takeout: one year folder, two photos with
# DIFFERENT bytes (identical bytes would collapse to one item, correctly, and
# hide what is being counted), and a sidecar so the date range is real.
ARCHIVE_ROOT="/tmp/smoke-takeout"
PHOTOS_DIR="$ARCHIVE_ROOT/Takeout/Google Photos/Photos from 2024"
if docker exec "$API_CONTAINER" sh -lc "
      mkdir -p '$PHOTOS_DIR' &&
      printf 'gate-photo-one'   > '$PHOTOS_DIR/IMG_0001.jpg' &&
      printf 'gate-photo-two'   > '$PHOTOS_DIR/IMG_0002.jpg' &&
      printf 'gate-edit-of-one' > '$PHOTOS_DIR/IMG_0001-edited.jpg' &&
      printf '%s' '{\"photoTakenTime\":{\"timestamp\":\"1700000000\"}}' \
        > '$PHOTOS_DIR/IMG_0001.jpg.supplemental-metadata.json'
    " >/dev/null 2>&1; then
  echo "fixture Takeout written inside '$API_CONTAINER' at $ARCHIVE_ROOT"

  # AN UNREADABLE ARCHIVE IS `unknown`, NEVER AN EMPTY ONE. Asserted FIRST,
  # because it is the property most worth having on a real stack: a truncated
  # 25 GB download is the common case, and answering "you have no photos" to
  # somebody who waited a week for it is the worst sentence this product could
  # produce. `/tmp` exists and is not a Takeout, which is exactly the shape of
  # somebody pointing at the wrong folder.
  r="$(http POST "$API/api/connections" "$TOK_R" \
    '{"role":"source", "type":"archive", "displayName":"gate: not a takeout", "values":{"provider":"google-takeout","path":"/tmp"}}')"
  code="${r%% *}"; body="${r#* }"
  archive_answer="$(jq -r '.qualification.domains.file.answer // empty' <<<"$body")"
  if [ "$code" = "201" ] && [ "$archive_answer" = "unknown" ]; then
    echo "archive we cannot open: file face is 'unknown' with a reason, not a measured 'no'"
  else
    echo "archive we cannot open: HTTP $code, file answer '${archive_answer:-<none>}' — ${body:0:200} (expected 201 and 'unknown')"
    fail_at
  fi

  # AND THE REAL ONE. Three items from four files, because Takeout's sidecar is
  # metadata rather than an item — and the breakdown says which of the three is
  # the edit, which is what stops the total reading as a duplication bug.
  r="$(http POST "$API/api/connections" "$TOK_R" \
    "{\"role\":\"source\", \"type\":\"archive\", \"displayName\":\"gate: takeout fixture\", \"values\":{\"provider\":\"google-takeout\",\"path\":\"$ARCHIVE_ROOT\"}}")"
  code="${r%% *}"; body="${r#* }"
  archive_answer="$(jq -r '.qualification.domains.file.answer // empty' <<<"$body")"
  archive_items="$(jq -r '.qualification.domains.file.volume.items // empty' <<<"$body")"
  archive_edited="$(jq -r '.qualification.domains.file.volume.byKind.edited // empty' <<<"$body")"
  if [ "$code" = "201" ] && [ "$archive_answer" = "yes" ] \
    && [ "$archive_items" = "3" ] && [ "$archive_edited" = "1" ]; then
    echo "archive measured on the real stack: 3 items, 1 of them an edited version, from 4 files"
  else
    echo "archive measure: HTTP $code, answer '${archive_answer:-<none>}', items '${archive_items:-<none>}', edited '${archive_edited:-<none>}' — ${body:0:250} (expected 201, yes, 3, 1)"
    fail_at
  fi

  # A path is not a password: this kind stores NO credential, and the row's
  # secret is the shape that proves it. Read from the database rather than from
  # the API's echo, because the echo is what a route chose to say and this is
  # what was written.
  archive_secret="$(q "SELECT coalesce(secret_ref, '<null>') FROM connection WHERE display_name = 'gate: takeout fixture' LIMIT 1")"
  case "$archive_secret" in
    *'"username"'*|*'"password"'*)
      echo "archive connection stored a credential-shaped secret: ${archive_secret:0:120} (a path is not a password)"
      fail_at ;;
    *) echo "archive connection stored no credential fields, which is this kind's truth" ;;
  esac

  # Left behind on purpose: the fixture is four small files in the container's
  # own /tmp, the container is torn down with the stack, and removing it here
  # would only make a re-run of the block below impossible to debug.
else
  echo "could not write the fixture Takeout into '$API_CONTAINER' — the archive gate did not run"
  fail_at
fi

report_json "shared addresses" "/api/shared-addresses" '.addresses | length'
report_markdown "shared-address runbook" "/api/shared-addresses/runbook" "## Before you start"
# A mailbox is required and the demo owner's is the one address this tenant is
# certain to have. The report renders whether or not a scan can read anything —
# it says which categories it could NOT inventory, which is the point of it.
#
# THE OWNER'S ADDRESS, not their subject with a domain glued on. This used to
# read `${APPLY_SUB}@demo.openmigrate.test`, which built `demo-owner-b@…` while
# the seed's owner email has always been `owner-b@…` — a mailbox this tenant is
# NOT certain to have, in the line whose comment says it is. It passed because
# the report renders for any address, so the mismatch cost nothing and proved
# nothing. It would have started costing the moment the subject gained its
# `seed:` prefix and the query carried a colon.
report_markdown "permissions report" \
  "/api/permissions/report?mailbox=${APPLY_EMAIL}" \
  "# Who can see what, and what happens to it"
report_json "billing usage" "/api/billing/usage" '.period'
report_json "invoices" "/api/billing/invoices" '.invoices | length'

# The operator's support surface (workplan 0110 T4), asked with an ORDINARY
# token — and this is the one report whose expected answer is nothing.
#
# These views bypass row security on purpose: an operator has no tenant, so a
# view honouring the tenant policy would be useless to them. That means there
# is NO SECOND NET. Everything rests on one `EXISTS` against `platform_operator`
# inside each view, and the property that matters is the failure direction: a
# signed-in person who is not an operator must see zero organisations, on a real
# stack, with the views owned by the real migrating role.
#
# `support-views.unit.test.ts` proves that against PGlite, and pins the
# precondition it rests on — that the view's owner is a superuser. A gate cannot
# assume the deployment matches the fixture. Here the deployment IS the subject.
#
# Pinned to `0` rather than "any answer": a count that grew would be every
# customer's metadata served to somebody with an account, which is the whole
# thing this surface exists to not do. `$TOK_R` is a demo tenant's token and
# nothing in the seed makes it an operator, so 0 is the true answer — and if the
# seed ever grants one, this line goes red rather than quiet.
report_json "support surface refuses a non-operator" \
  "/api/support/tenants" '.tenants | length' 0

# ---------- and it ANSWERS an operator, which nothing here had ever checked ----------
#
# The line above proves the door is CLOSED. Until 2026-08-31 that was the whole
# of this gate's opinion about the operator: nothing appointed one, nothing
# signed one in, and `platform_operator` appeared in this file only inside a
# comment. A surface that is only ever tested for refusing is a surface nobody
# has confirmed opens — and the operator is the one person who can grant an
# access request, so "the queue answers nobody" is a deployment that cannot
# take a customer.
#
# It cost the report of 2026-08-31: an operator who had just appointed himself
# found six of eight nav entries signed him out, because every tenant-scoped
# route answers him `403 No active membership for this tenant` and the web app
# read that as a dead session. Unit and browser tests cover that now; this is
# the half that runs against a real stack, with a real subject, through the
# real views.
#
# APPOINTED HERE AND TAKEN BACK BELOW, in the same block. `platform_operator` is
# written over the OWNER connection on purpose — `app_user` has SELECT and
# nothing else (migration 0005) — so `q` is the only way in, and the row must
# not outlive the run: a standing operator in a long-lived demo stack is a
# standing reader of every tenant's metadata.
if [ -n "${STACK_ISSUER:-}" ]; then
  # A STALE ONE FIRST, for the window where a run died between the insert and
  # the delete. Same backstop as idp_sweep_leftovers, same reason.
  q "DELETE FROM platform_operator WHERE email LIKE 'smoke-operator-%@smoke.local'" >/dev/null 2>&1 || true

  # Signed in a thousand lines above, with the other three, so the take-back
  # covers them the same way. What happens here is the appointment, which is
  # ours rather than the provider's, and must not outlive the run.
  if [ -z "${OP_TOKEN:-}" ] || [ -z "${OP_SUBJECT:-}" ]; then
    echo "the operator surface answers an operator: could not sign one in"
    fail_at
  else
    q "INSERT INTO platform_operator (user_id, email, note)
       VALUES ('${OP_SUBJECT}', '${OP_EMAIL}', 'managed gate, removed at the end of this run')
       ON CONFLICT (user_id) DO NOTHING" >/dev/null

    # NO TENANT, AND THAT IS THE POINT. An operator belongs to no organisation
    # by design (0093 T6/T7), so `/api/me` must answer for them WITHOUT one —
    # it runs on `authenticateSubject` for exactly this. A gate that only ever
    # asked as a member could not tell that apart from a broken route.
    r="$(http GET "$API/api/me" "$OP_TOKEN")"; code="${r%% *}"; body="${r#* }"
    op_flag="$(jq -r '.operator // false' <<<"$body" 2>/dev/null || echo false)"
    op_tenants="$(jq -r '.tenants | length' <<<"$body" 2>/dev/null || echo -1)"
    if [ "$code" = "200" ] && [ "$op_flag" = "true" ] && [ "$op_tenants" = "0" ]; then
      echo "an operator holds a session with no organisation: HTTP 200, operator=true, tenants=0"
    else
      echo "an operator holds a session with no organisation: HTTP ${code}, operator=${op_flag}, tenants=${op_tenants} — ${body:0:200}"
      fail_at
    fi

    # AND THE QUEUE THEY CAME FOR OPENS. Pinned to "more than none" rather than
    # to a count: the demo seed's tenant total is not this line's business, and
    # a number here would go red on a seed change rather than on a defect.
    r="$(http GET "$API/api/support/tenants" "$OP_TOKEN")"; code="${r%% *}"; body="${r#* }"
    op_seen="$(jq -r '.tenants | length' <<<"$body" 2>/dev/null || echo -1)"
    if [ "$code" = "200" ] && [ "${op_seen:-0}" -gt 0 ] 2>/dev/null; then
      echo "support surface answers an operator: HTTP 200, .tenants | length -> ${op_seen}"
    else
      echo "support surface answers an operator: HTTP ${code}, .tenants | length -> ${op_seen} — ${body:0:200}"
      echo "    The non-operator line above proves this door refuses. This one proves it OPENS,"
      echo "    and without it a deployment whose operator can see nothing reports green."
      fail_at
    fi


    # ---------- THE QUEUE THEY CAME FOR, AND THE BUTTON THEY PRESS ----------
    #
    # Everything above proves an operator can hold a session and SEE things.
    # Nothing proved they can do the one thing the role exists for: read the
    # access queue and grant somebody an organisation. `platform_operator` is
    # written for that decision and for nothing else, and until now this gate
    # would have gone green on a deployment where granting was broken in every
    # way that does not also break `/api/me`.
    #
    # It is not a small blind spot. Granting is the only path by which this
    # product acquires a customer: three writes in one transaction — a tenant,
    # an owner invitation, and the request marked granted — and a stack that
    # cannot do it cannot be sold to anybody. Covered by unit tests against
    # PGlite and by an integration test against Testcontainers; never once
    # against the real stack, through PgBouncer, with a real issuer's subject.
    #
    # WHAT THIS ADDS TO THE DEMO STACK, AND TAKES BACK. A tenant, a
    # `tenant_member` invitation and an `access_request` row. All three are
    # removed at the end of the block, requests BEFORE tenants: `access_request`
    # points at the tenant with ON DELETE RESTRICT (migration 0007) and carries
    # CHECK ((state = 'granted') = (tenant_id IS NOT NULL)), so a tenant delete
    # that tried to null it would violate the check and the delete would fail
    # naming a constraint on another table. The order is not a style choice.
    GRANT_EMAIL="smoke-grant-${SMOKE_MAIL_RUN}@smoke.local"
    GRANT_ORG="Smoke Grant ${SMOKE_MAIL_RUN}"

    # A STALE SET FIRST, for the window where a run died mid-block. Same
    # backstop and same order as the take-back below.
    q "DELETE FROM access_request WHERE email LIKE 'smoke-grant-%@smoke.local'" >/dev/null 2>&1 || true
    q "DELETE FROM tenant WHERE name LIKE 'Smoke Grant %'" >/dev/null 2>&1 || true

    # Knock, unauthenticated, exactly as the public form does.
    gk="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${API}/api/access-requests" \
      -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg e "$GRANT_EMAIL" '{email:$e, locale:"en", organisation:"Smoke Grant BV"}')" \
      || echo 000)"
    [ "$gk" = "201" ] || { echo "the front door refused the gate's own knock: HTTP ${gk}"; fail_at; }

    # AND AGAIN, WHICH MUST NOT BECOME A SECOND ROW. Migration 0020 forbids two
    # OPEN requests per address with a partial unique index; the route answers
    # the duplicate identically so a stranger cannot learn an address is known.
    # Both halves matter and they pull opposite ways — the answer must be the
    # same, the row count must not be. Proved against PGlite and Testcontainers;
    # this is the first time a real Postgres behind PgBouncer has been asked.
    gk2="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${API}/api/access-requests" \
      -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg e "$GRANT_EMAIL" '{email:$e, locale:"en"}')" || echo 000)"
    open_rows="$(q "SELECT count(*) FROM access_request WHERE email = '${GRANT_EMAIL}' AND state = 'open'" 2>/dev/null || echo '?')"
    if [ "$gk2" = "$gk" ] && [ "$open_rows" = "1" ]; then
      echo "a second knock is answered the same (HTTP ${gk2}) and is not a second row (open=${open_rows})"
    else
      echo "the duplicate knock: HTTP ${gk2} (first was ${gk}), open rows for the address = ${open_rows}, expected 1"
      echo "    Two open requests from one address become two organisations if both are granted,"
      echo "    and /api/me then returns two tenants for somebody who asked once and pressed twice."
      fail_at
    fi

    # THE QUEUE OPENS FOR THE OPERATOR. Read through the route rather than the
    # database: the row being there proves the knock, and this proves the
    # decision surface — `operator_may_read` on a connection with no tenant.
    r="$(http GET "$API/api/access-requests" "$OP_TOKEN")"; code="${r%% *}"; body="${r#* }"
    req_id="$(jq -r --arg e "$GRANT_EMAIL" '.requests[]? | select(.email == $e and .state == "open") | .id' <<<"$body" 2>/dev/null | awk 'NR==1')"
    if [ "$code" = "200" ] && [ -n "$req_id" ]; then
      echo "the access queue answers an operator, and carries the knock: ${req_id}"
    else
      echo "the access queue: HTTP ${code}, no open request for ${GRANT_EMAIL} — ${body:0:200}"
      echo "    This is the queue platform_operator exists for. A stack that cannot serve it"
      echo "    cannot take a customer, however healthy everything else reports."
      fail_at
    fi

    # AND THE BUTTON WORKS. One press, three writes, one transaction.
    if [ -n "$req_id" ]; then
      r="$(http POST "$API/api/access-requests/${req_id}/grant" "$OP_TOKEN" \
        "$(jq -nc --arg n "$GRANT_ORG" '{organisationName:$n}')")"
      code="${r%% *}"; body="${r#* }"
      new_tenant="$(jq -r '.tenantId // empty' <<<"$body" 2>/dev/null || true)"
      if [ "$code" = "201" ] && [ -n "$new_tenant" ]; then
        echo "granting created an organisation: ${new_tenant}"
      else
        echo "granting: HTTP ${code} — ${body:0:240}"; fail_at
      fi

      # WHAT IT ACTUALLY WROTE, asked of the database rather than of the reply.
      # A route that answered 201 and wrote nothing would pass every line above.
      # The owner is an INVITATION, not a member: the person has no subject
      # until they sign in, so `user_id` is a `pending:` placeholder and
      # `claimInvitations` replaces it on first arrival. Asserting `active`
      # here would demand a person who has not been asked yet.
      if [ -n "$new_tenant" ]; then
        made="$(q "SELECT
            (SELECT count(*) FROM tenant WHERE id = '${new_tenant}' AND name = '${GRANT_ORG}')
          ||'/'|| (SELECT count(*) FROM tenant_member WHERE tenant_id = '${new_tenant}'
                     AND role = 'owner' AND status = 'invited' AND user_id LIKE 'pending:%')
          ||'/'|| (SELECT count(*) FROM access_request WHERE id = '${req_id}'
                     AND state = 'granted' AND tenant_id = '${new_tenant}')" 2>/dev/null || echo '?')"
        if [ "$made" = "1/1/1" ]; then
          echo "the three writes landed together: organisation/owner-invitation/settled-request = ${made}"
        else
          echo "the three writes: organisation/owner-invitation/settled-request = ${made}, expected 1/1/1"
          echo "    They are one fact. A tenant nobody asked for, or a request pointing at an"
          echo "    organisation that does not exist, are both worse than a failure."
          fail_at
        fi
      fi

      # ---------- AND THE REFUSAL THE OPERATOR CAN ANSWER ----------
      #
      # The queue's second decision, and the one with a wrong answer that
      # cannot be taken back. Granting an address that already owns an
      # organisation creates a SECOND one with that person as owner of both;
      # `/api/me` then returns two tenants, `resolveTenant` refuses to guess,
      # and the app has to ask somebody which they meant on every sign-in —
      # for a person who asked once and pressed twice. The owner found exactly
      # that in their own queue on 2026-08-31.
      #
      # So the route refuses, names what they already own, and says which field
      # means it anyway. Every part of that was proved against PGlite and in the
      # browser against a mocked API. Nothing had ever asked the real route, and
      # the refusal reads through `support_tenant_members` — a view whose whole
      # protection is one EXISTS against `platform_operator`, on a transaction
      # scoped to a tenant that does not exist yet. That is not a shape a unit
      # test can stand up.
      #
      # The first knock is granted by now, so migration 0020's index allows
      # another: it forbids two OPEN at once, never a second ask after a
      # decision. Those are different things and 0002 was right about the second.
      gk3="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${API}/api/access-requests" \
        -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg e "$GRANT_EMAIL" '{email:$e, locale:"en"}')" || echo 000)"
      [ "$gk3" = "201" ] ||
        { echo "asking again after a decision was refused: HTTP ${gk3} — 0020 forbids two OPEN, not a second ask"; fail_at; }

      r="$(http GET "$API/api/access-requests" "$OP_TOKEN")"; body="${r#* }"
      again_id="$(jq -r --arg e "$GRANT_EMAIL" '.requests[]? | select(.email == $e and .state == "open") | .id' <<<"$body" 2>/dev/null | awk 'NR==1')"

      if [ -z "$again_id" ]; then
        echo "the second ask never reached the queue — nothing to refuse"; fail_at
      else
        # IT REFUSES, AND IT NAMES THEM. A bare "already owns one" sends an
        # operator off to go and look; the names are what they weigh.
        r="$(http POST "$API/api/access-requests/${again_id}/grant" "$OP_TOKEN" \
          "$(jq -nc --arg n "$GRANT_ORG 2" '{organisationName:$n}')")"
        code="${r%% *}"; body="${r#* }"
        conf="$(jq -r '.confirmWith // empty' <<<"$body" 2>/dev/null || true)"
        named="$(jq -r --arg o "$GRANT_ORG" '[.organisations[]?] | index($o) // empty' <<<"$body" 2>/dev/null || true)"
        # Counted BEFORE the override, so the number below means something.
        before="$(q "SELECT count(*) FROM tenant WHERE name LIKE 'Smoke Grant %'" 2>/dev/null || echo '?')"
        if [ "$code" = "409" ] && [ "$conf" = "alsoCreateSecondOrganisation" ] && [ -n "$named" ]; then
          echo "granting a second time is refused, and names what they own: HTTP 409, confirmWith=${conf}"
        else
          echo "the already-owns refusal: HTTP ${code}, confirmWith='${conf}', names the first org: '${named}' — ${body:0:240}"
          echo "    Without it, one address pressed twice becomes an owner of two organisations"
          echo "    and every later sign-in has to ask them which they meant."
          fail_at
        fi

        # AND IT WROTE NOTHING WHILE REFUSING. The check runs before the insert
        # precisely so nothing half-happens; a refusal that had already made the
        # tenant would be worse than no refusal at all.
        during="$(q "SELECT count(*) FROM tenant WHERE name LIKE 'Smoke Grant %'" 2>/dev/null || echo '?')"
        if [ "$during" = "$before" ]; then
          echo "the refusal provisioned nothing: organisations before/after = ${before}/${during}"
        else
          echo "the refusal PROVISIONED something: organisations before/after = ${before}/${during}"; fail_at
        fi

        # THE OVERRIDE, WHICH IS THE HALF THAT HAD NO WAY TO BE SENT AT ALL
        # until the screen grew a button today. `z.literal(true)`, so the field
        # is present or absent and never `false`: a flag that can say no invites
        # a client to send it by default and turns a deliberate second press
        # into a checkbox nobody reads.
        r="$(http POST "$API/api/access-requests/${again_id}/grant" "$OP_TOKEN" \
          "$(jq -nc --arg n "$GRANT_ORG 2" '{organisationName:$n, alsoCreateSecondOrganisation:true}')")"
        code="${r%% *}"; body="${r#* }"
        second_tenant="$(jq -r '.tenantId // empty' <<<"$body" 2>/dev/null || true)"
        after="$(q "SELECT count(*) FROM tenant WHERE name LIKE 'Smoke Grant %'" 2>/dev/null || echo '?')"
        # INTEGERS OR NOTHING. `q` answers '?' when psql could not run, and
        # `$(( ? + 1 ))` is a bash syntax error that prints noise and leaves the
        # comparison opaque — an unreadable count would look like a specific
        # disagreement. Anything non-numeric becomes -1, which fails the test
        # below and reports the value it actually got.
        case "$before" in ''|*[!0-9]*) before=-1 ;; esac
        case "$after"  in ''|*[!0-9]*) after=-1  ;; esac
        if [ "$code" = "201" ] && [ -n "$second_tenant" ] && [ "$second_tenant" != "$new_tenant" ] &&
           [ "$before" -ge 0 ] && [ "$after" = "$((before + 1))" ]; then
          echo "meaning it anyway creates the second organisation: ${second_tenant} (organisations ${before} -> ${after})"
        else
          echo "the override: HTTP ${code}, tenantId='${second_tenant}' (first was '${new_tenant}'), organisations ${before} -> ${after}"
          echo "    The refusal names this field as the way to mean it. If the field does not work,"
          echo "    the refusal is a dead end and the only way past it is a hand-written POST."
          fail_at
        fi
      fi

      # ---------- FINDING A PERSON, AND THE LOG THAT SAYS YOU DID ----------
      #
      # `GET /api/support/people` crosses every organisation at once — the one
      # read on this surface that is not scoped to a tenant the operator
      # already chose. It exists because an operator with an email address and
      # nothing else could not answer "who is this?", and it is the widest
      # question this product can be asked.
      #
      # So the accountability half is not decoration. Every read writes a
      # `support_read` row against the operator's SUBJECT, inside the same
      # transaction as the read itself, so a read that happened cannot fail to
      # be logged and a log entry cannot describe a read that did not. Nothing
      # anywhere checked that the row appears. A regression there is invisible
      # by construction: the screen still works, the operator still sees the
      # person, and the only thing missing is the record that they looked.
      #
      # ASKED ABOUT THE PERSON THIS RUN JUST CREATED, not about the demo seed.
      # The granted organisation above has exactly one member, whose address
      # this block chose, so the expected count is 1 rather than whatever the
      # seed happens to hold — a number that would go red on a seed change
      # rather than on a defect. It also means the search is answered by a row
      # that did not exist sixty seconds ago, which is the part a fixture
      # cannot prove.
      if [ -n "${new_tenant:-}" ]; then
        # THE FLOOR FIRST. One character matches most of a customer list, and
        # "every person we have" is not an answer to a blank box.
        r="$(http GET "$API/api/support/people?q=a" "$OP_TOKEN")"; code="${r%% *}"
        if [ "$code" = "400" ]; then
          echo "a one-character search is refused: HTTP 400"
        else
          echo "a one-character search: HTTP ${code}, expected 400 — it would match most of a customer list"
          fail_at
        fi

        r="$(http GET "$API/api/support/people?q=${GRANT_EMAIL}" "$OP_TOKEN")"
        code="${r%% *}"; body="${r#* }"
        found="$(jq -r --arg e "$GRANT_EMAIL" '[.people[]? | select(.email == $e)] | length' <<<"$body" 2>/dev/null || echo -1)"
        # EVERY ORGANISATION THIS RUN CREATED, not a count.
        #
        # The block above deliberately makes a SECOND one for this same address
        # — that is what the override is — so the person owns two by now, and a
        # search that returned only one would be failing at the only job this
        # route has. Asking for both is therefore stronger than asking for a
        # number, and it does not go red when the block above changes how many
        # it makes. MEASURED THE HARD WAY: this asserted `1`, and E2E (managed)
        # #104 answered `matches=2` — the product being right.
        in_first="$(jq -r --arg e "$GRANT_EMAIL" --arg t "$new_tenant" \
          '[.people[]? | select(.email == $e and .tenant_id == $t)] | length' <<<"$body" 2>/dev/null || echo 0)"
        in_second="$(jq -r --arg e "$GRANT_EMAIL" --arg t "${second_tenant:-}" \
          '[.people[]? | select(.email == $e and .tenant_id == $t)] | length' <<<"$body" 2>/dev/null || echo 0)"
        if [ "$code" = "200" ] && [ "$in_first" = "1" ] && [ "$in_second" = "1" ]; then
          echo "the search crosses organisations: the person is found in both this run created (${found} rows)"
        else
          echo "the people search: HTTP ${code}, matches=${found}, in first=${in_first}, in second=${in_second}"
          echo "    A search scoped to one organisation cannot answer 'who is this?', which is the"
          echo "    only question this route exists for."
          fail_at
        fi

        # THE LOG SAYS WHAT WAS ASKED AND WHAT CAME BACK. `view_name` alone
        # answers neither: an operator who searched for one address and one who
        # listed everybody would leave the same row, and the point of keeping
        # the query text is that those are different reads.
        # result_count AGAINST WHAT CAME BACK, not against a constant. The
        # column exists to record what the operator actually saw, so comparing
        # it to the answer is the assertion — and it catches a route that logs
        # a fixed number, which a hardcoded expectation here could not.
        logged="$(q "SELECT count(*) FROM support_read
                      WHERE operator_user_id = '${OP_SUBJECT}' AND view_name = 'people'
                        AND query = '${GRANT_EMAIL}' AND result_count = ${found}" 2>/dev/null || echo '?')"
        if [ "$logged" = "1" ]; then
          echo "the search was written to support_read with its query and its count"
        else
          echo "support_read rows for this search: ${logged}, expected 1"
          echo "    A read that is not logged is the failure this table exists to prevent, and it"
          echo "    is invisible from the screen: the operator still sees the person either way."
          fail_at
        fi

        # AND OPENING ONE IS ITS OWN READ. A different view_name, scoped to the
        # tenant, because "searched for an address" and "opened that account"
        # are different things to anybody reading the log afterwards.
        found_user="$(jq -r --arg e "$GRANT_EMAIL" '.people[]? | select(.email == $e) | .user_id' <<<"$body" 2>/dev/null | awk 'NR==1')"
        if [ -n "$found_user" ]; then
          r="$(http POST "$API/api/support/people/${new_tenant}/${found_user}/opened" "$OP_TOKEN" '{}')"
          code="${r%% *}"
          opened="$(q "SELECT count(*) FROM support_read
                        WHERE operator_user_id = '${OP_SUBJECT}' AND view_name = 'person'
                          AND tenant_id = '${new_tenant}'" 2>/dev/null || echo '?')"
          if [ "$code" = "204" ] && [ "$opened" = "1" ]; then
            echo "opening the person is recorded separately: HTTP 204, support_read view_name=person"
          else
            echo "opening the person: HTTP ${code}, support_read person rows = ${opened}, expected 204 and 1"
            fail_at
          fi
        else
          echo "the search answered without a user_id, so there was nobody to open"; fail_at
        fi

        # NOTHING SWEEPS support_read, DELIBERATELY. It is the record of what
        # this run's operator looked at, and a gate that erased its own audit
        # trail would be demonstrating the failure the table exists to catch.
        # The rows outlive the tenant on purpose: `tenant_id` carries no
        # foreign key (migration 0009), so the take-back below cannot be
        # blocked by them and the log keeps describing a read that happened.
        :
      fi
    fi

    # TAKE IT BACK. Requests first, then tenants — see the header above.
    q "DELETE FROM access_request WHERE email LIKE 'smoke-grant-%@smoke.local'" >/dev/null 2>&1 || true
    q "DELETE FROM tenant WHERE name LIKE 'Smoke Grant %'" >/dev/null 2>&1 || true
    g_left="$(q "SELECT (SELECT count(*) FROM access_request WHERE email LIKE 'smoke-grant-%@smoke.local')
              ||'/'|| (SELECT count(*) FROM tenant WHERE name LIKE 'Smoke Grant %')" 2>/dev/null || echo '?')"
    if [ "$g_left" = "0/0" ]; then
      echo "the gate's organisation was taken back: requests/tenants left = ${g_left}"
    else
      echo "the gate's organisation was NOT taken back: requests/tenants left = ${g_left}"
      echo "    A tenant per nightly run accumulates in the stack this same script measures."
      fail_at
    fi


    # ---------- THE OTHER DECISION, AND THE MAIL THAT DOES OR DOES NOT GO ----------
    #
    # Granting is covered above. Declining was not, and it is the decision an
    # operator makes far more often: the front door is public and rate-limited
    # but still public, so junk reaches this queue and most of what arrives
    # there is answered `no`.
    #
    # It carries the only outward-facing act on this surface. A grant's mail is
    # a courtesy to somebody who asked; a DECLINE's mail goes to an address a
    # stranger typed, and mailing a forged one means mailing an uninvolved
    # person. That is why `notify` exists, why it is EXPLICIT rather than
    # defaulted, and why `skipped` and `off` are different words: one is a
    # choice a human made, the other is a deployment that cannot send and hands
    # them a manual step. A gate that collapsed those would tell an operator to
    # go and email somebody they deliberately ignored.
    #
    # Both halves are asked here, and the quiet one is asked as a NEGATIVE:
    # not "the API said skipped" but "no mail reached the catcher". The API's
    # own word for what it did is exactly what a broken send would also say.
    DECLINE_LOUD="smoke-decline-loud-${SMOKE_MAIL_RUN}@smoke.local"
    DECLINE_QUIET="smoke-decline-quiet-${SMOKE_MAIL_RUN}@smoke.local"

    q "DELETE FROM access_request WHERE email LIKE 'smoke-decline-%@smoke.local'" >/dev/null 2>&1 || true

    decline_one() { # decline_one <email> <notify true|false> -> prints "<code> <notified> <state>"
      local email="$1" notify="$2" id code body notified state
      curl -sS -o /dev/null -X POST "${API}/api/access-requests" -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg e "$email" '{email:$e, locale:"en"}')" || true
      id="$(q "SELECT id FROM access_request WHERE email = '${email}' AND state = 'open'" 2>/dev/null | awk 'NR==1')"
      [ -n "$id" ] || { printf '%s %s %s\n' "no-request" "-" "-"; return 0; }
      body="$(http POST "$API/api/access-requests/${id}/decline" "$OP_TOKEN" \
        "$(jq -nc --argjson n "$notify" '{note:"smoke: not a real applicant", notify:$n}')")"
      code="${body%% *}"; body="${body#* }"
      notified="$(jq -r '.notified // empty' <<<"$body" 2>/dev/null || true)"
      state="$(q "SELECT state FROM access_request WHERE id = '${id}'" 2>/dev/null || echo '?')"
      printf '%s %s %s\n' "$code" "${notified:--}" "$state"
    }

    # HOW THE MAIL IS COUNTED, which E2E (managed) #105 had to teach this block.
    # A Mailpit search on an address matches every message that MENTIONS it, and
    # the knock above sends the operator a mail naming the applicant — so
    # `messages_count` for a quiet decline came back 1 with nothing whatsoever
    # having been sent to that person. Counting by RECIPIENT is the only count
    # that answers the question this block is asking.
    mail_to_count() { # mail_to_count <address> -> caught messages ADDRESSED to it
      curl -fsS --get "${MAILPIT}/api/v1/search" --data-urlencode "query=$1" \
        | jq -r --arg a "$1" '[.messages[]? | select([.To[]?.Address] | index($a))] | length' \
        2>/dev/null || echo '?'
    }

    # THE QUIET ONE GOES FIRST, and that ordering IS part of the assertion.
    # "No mail arrived" is worth nothing unless a mail could have arrived in the
    # same window: asked on its own it passes just as happily on a dead SMTP
    # pipe. Declining quietly first and reading the answer only once the loud
    # one's mail has landed makes that arrival the positive control for this
    # negative — the same shape as the canary check further down.
    read -r qd_code qd_notified qd_state <<<"$(decline_one "$DECLINE_QUIET" false)"
    if [ "$qd_code" = "200" ] && [ "$qd_notified" = "skipped" ] && [ "$qd_state" = "declined" ]; then
      echo "a quiet decline is recorded: HTTP 200, notified=skipped, state=declined"
    else
      echo "declining quietly: HTTP ${qd_code}, notified=${qd_notified}, state=${qd_state} (expected 200/skipped/declined)"
      fail_at
    fi

    read -r d_code d_notified d_state <<<"$(decline_one "$DECLINE_LOUD" true)"
    if [ "$d_code" = "200" ] && [ "$d_notified" = "sent" ] && [ "$d_state" = "declined" ]; then
      echo "a decline is recorded and the applicant is told: HTTP 200, notified=sent, state=declined"
    else
      echo "declining loudly: HTTP ${d_code}, notified=${d_notified}, state=${d_state} (expected 200/sent/declined)"
      echo "    'off' or 'failed' here means this deployment could not send and the operator is"
      echo "    now the only person who can tell them — which is a different problem from a refusal."
      fail_at
    fi

    # AND IT REACHED THE APPLICANT, not the operator's own channel. The knock
    # mail goes to NOTIFY_TO and must never go to the person; this one is the
    # exact opposite, and the two are easy to wire the wrong way round.
    d_to=0
    for _ in $(seq 1 20); do
      d_to="$(mail_to_count "$DECLINE_LOUD")"
      [ "${d_to:-0}" != "0" ] && break
      sleep 1
    done
    if [ "${d_to:-0}" != "0" ] && [ "${d_to}" != "?" ]; then
      echo "the refusal was addressed to the applicant, as a refusal must be (${d_to} mail)"
    else
      echo "nobody told ${DECLINE_LOUD} they were declined: ${d_to} addressed to them within 20s"
      echo "    A message that merely MENTIONS them is the operator's copy of the knock, not"
      echo "    their refusal — which is why this counts recipients."
      fail_at
    fi

    # AND NOW the negative, standing on that arrival.
    qd_seen="$(mail_to_count "$DECLINE_QUIET")"
    if [ "${qd_seen:-1}" = "0" ]; then
      echo "and the quiet one was left alone: 0 addressed to them, in the window that delivered the other"
    else
      echo "a quiet decline still mailed ${DECLINE_QUIET}: ${qd_seen} message(s) addressed to them"
      echo "    Unticking the box is a decision about a person who may not exist. A mail sent"
      echo "    anyway reaches whoever really owns that address."
      fail_at
    fi

    q "DELETE FROM access_request WHERE email LIKE 'smoke-decline-%@smoke.local'" >/dev/null 2>&1 || true
    d_left="$(q "SELECT count(*) FROM access_request WHERE email LIKE 'smoke-decline-%@smoke.local'" 2>/dev/null || echo '?')"
    [ "$d_left" = "0" ] ||
      { echo "the gate's declined requests were NOT taken back: ${d_left} left"; fail_at; }

    # ---------- THE SAME BUTTONS, PRESSED BY SOMEBODY WHO IS NOT AN OPERATOR ----------
    #
    # Every block above is a positive: an operator presses, the product answers.
    # The property all of them rest on is the negative, and it is the one that
    # has never been pressed on a real stack.
    #
    # The support views bypass row security ON PURPOSE — an operator has no
    # tenant, so a view honouring the tenant policy would be useless to them —
    # which means there is NO SECOND NET. One
    # `EXISTS (SELECT 1 FROM platform_operator WHERE user_id = app.current_user)`
    # inside each view is the entire boundary. A deployment where that predicate
    # was dropped, mis-owned, or shadowed by a re-created view serves every
    # customer's metadata to anybody who can sign in, and every check above it
    # would stay green while it did.
    #
    # `$TOK_R` is the right instrument for it, and deliberately not a stranger:
    # it belongs to a real signed-in person who IS A MEMBER of `$APPLY_TENANT`.
    # A support route that quietly fell back to tenant scope would answer 200
    # here — and a test that only ever asked about organisations the caller has
    # nothing to do with would never find out.
    BOUNDARY_EMAIL="smoke-boundary-${SMOKE_MAIL_RUN}@smoke.local"
    q "DELETE FROM access_request WHERE email LIKE 'smoke-boundary-%@smoke.local'" >/dev/null 2>&1 || true

    # THE INSTRUMENT IS WHAT THIS CLAIMS IT IS, asked of the database rather
    # than assumed. Every line below reads as a pass if `$TOK_R` were an
    # operator with no membership: 404 everywhere, zero rows, nothing written.
    # The two counts are what make the refusals mean refusal.
    b_isop="$(q "SELECT count(*) FROM platform_operator WHERE user_id = '${APPLY_SUBJECT}'" 2>/dev/null || echo '?')"
    b_member="$(q "SELECT count(*) FROM tenant_member
                    WHERE tenant_id = '${APPLY_TENANT}' AND user_id = '${APPLY_SUBJECT}'" 2>/dev/null || echo '?')"
    if [ "$b_isop" = "0" ] && [ "$b_member" = "1" ]; then
      echo "the boundary is asked by a member who is not an operator: operator=0, membership=1"
    else
      echo "the non-operator instrument is wrong: platform_operator=${b_isop}, tenant_member=${b_member} (expected 0/1)"
      echo "    Everything below would pass for the wrong reason, so nothing below is asked."
      fail_at
    fi

    if [ "$b_isop" = "0" ] && [ "$b_member" = "1" ]; then
      b_ghost="$(q "SELECT gen_random_uuid()" 2>/dev/null || echo '')"
      b_ghost_real="$(q "SELECT count(*) FROM tenant WHERE id = '${b_ghost}'" 2>/dev/null || echo '?')"
      [ "$b_ghost_real" = "0" ] ||
        { echo "the invented organisation id is not invented: ${b_ghost} matches ${b_ghost_real} row(s)"; fail_at; }

      # THE CONTROL FIRST. A 404 proves nothing if the route answers 404 to
      # everybody — a mis-typed path, a dropped view, a stack that never wired
      # this surface at all would all read as a boundary holding.
      b_op="$(http GET "$API/api/support/tenants/${APPLY_TENANT}" "$OP_TOKEN")"
      b_op_code="${b_op%% *}"
      if [ "$b_op_code" = "200" ]; then
        echo "the organisation is readable through the operator's window: HTTP 200"
      else
        echo "the operator cannot read ${APPLY_TENANT} either: HTTP ${b_op_code} — the refusals below prove nothing"
        fail_at
      fi

      # AND NOW THE SAME ID, THE SAME ROUTE, THE OTHER TOKEN.
      b_real="$(http GET "$API/api/support/tenants/${APPLY_TENANT}" "$TOK_R")"
      b_real_code="${b_real%% *}"; b_real_body="${b_real#* }"
      b_fake="$(http GET "$API/api/support/tenants/${b_ghost}" "$TOK_R")"
      b_fake_code="${b_fake%% *}"; b_fake_body="${b_fake#* }"
      if [ "$b_real_code" = "404" ]; then
        echo "a member of that organisation still cannot read it through the operator's window: HTTP 404"
      else
        echo "THE SUPPORT SURFACE ANSWERED A NON-OPERATOR: HTTP ${b_real_code} for ${APPLY_TENANT}"
        echo "    ${b_real_body:0:200}"
        echo "    This is every customer's metadata, served to anybody with an account."
        fail_at
      fi

      # AND IT DOES NOT SAY WHICH KIND OF NOTHING. The route's own comment
      # promises a non-operator cannot tell whether an id exists; that promise
      # is only kept if the two answers are indistinguishable, which is a
      # comparison and not a status code.
      if [ "$b_real_code" = "$b_fake_code" ] && [ "$b_real_body" = "$b_fake_body" ]; then
        echo "a real organisation and an invented one are answered identically: ${b_fake_code}, same body"
      else
        echo "the refusal leaks which ids exist: real -> ${b_real_code} ${b_real_body:0:80}"
        echo "                                   invented -> ${b_fake_code} ${b_fake_body:0:80}"
        fail_at
      fi

      # THE AUDIT LOG IS NOT WRITABLE BY THE PERSON IT IS ABOUT. `/opened` is
      # the one operator route whose whole purpose is to write a row, and it is
      # asked here about a membership that genuinely exists — so a route that
      # recorded first and checked afterwards would leave a row claiming a
      # non-operator read somebody's account.
      b_reads_before="$(q "SELECT count(*) FROM support_read WHERE operator_user_id = '${APPLY_SUBJECT}'" 2>/dev/null || echo '?')"
      b_open="$(http POST "$API/api/support/people/${APPLY_TENANT}/${APPLY_SUBJECT}/opened" "$TOK_R" '{}')"
      b_open_code="${b_open%% *}"
      b_reads_after="$(q "SELECT count(*) FROM support_read WHERE operator_user_id = '${APPLY_SUBJECT}'" 2>/dev/null || echo '?')"
      if [ "$b_open_code" = "404" ] && [ "$b_reads_after" = "$b_reads_before" ]; then
        echo "a non-operator cannot open a person, nor write that they did: HTTP 404, support_read unchanged (${b_reads_after})"
      else
        echo "opening a person as a non-operator: HTTP ${b_open_code}, support_read ${b_reads_before} -> ${b_reads_after}"
        echo "    A row here says somebody read an account. Written by the wrong hand it is worse"
        echo "    than no row at all, because the log is what a later question gets answered from."
        fail_at
      fi

      # THE QUEUE, AND THE DECISION. Both asked against a request that really is
      # open at this moment, because "no rows" and "no such row" are the same
      # answer to somebody who cannot see any.
      #
      # One more knock on a public, rate-limited door. The cap is 60 an hour and
      # — with `TRUST_PROXY` unset — service-wide rather than per caller, so it
      # is worth keeping in mind: this gate's knocks are still in single figures
      # and the API container is recreated at every bring-up, which resets the
      # window anyway. If a later block pushes the total near the cap, the
      # failure will appear as a 429 on somebody else's line, not on this one.
      curl -sS -o /dev/null -X POST "${API}/api/access-requests" -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg e "$BOUNDARY_EMAIL" '{email:$e, locale:"en"}')" || true
      b_id="$(q "SELECT id FROM access_request WHERE email = '${BOUNDARY_EMAIL}' AND state = 'open'" 2>/dev/null | awk 'NR==1')"
      queue_len() { # queue_len <token> -> how many requests that token is shown
        local r
        r="$(http GET "$API/api/access-requests" "$1")"
        # A 500 answered as "0 requests" would read as the boundary holding.
        [ "${r%% *}" = "200" ] || { echo "?"; return 0; }
        jq -r '.requests | length' <<<"${r#* }" 2>/dev/null || echo '?'
      }
      b_op_sees="$(queue_len "$OP_TOKEN")"
      b_sees="$(queue_len "$TOK_R")"
      case "$b_op_sees" in ''|*[!0-9]*) b_op_sees=-1 ;; esac
      if [ -n "$b_id" ] && [ "$b_op_sees" -ge 1 ] && [ "$b_sees" = "0" ]; then
        echo "the queue is invisible to a non-operator while it is not empty: operator sees ${b_op_sees}, they see 0"
      else
        echo "the access queue as a non-operator: id='${b_id:-<none>}', operator sees ${b_op_sees}, they see ${b_sees}"
        echo "    Expected a knock to exist, the operator to see it, and them to see none."
        fail_at
      fi

      if [ -n "$b_id" ]; then
        b_dec="$(http POST "$API/api/access-requests/${b_id}/decline" "$TOK_R" \
          '{"note":"smoke: a decision that is not theirs to make","notify":false}')"
        b_dec_code="${b_dec%% *}"
        b_after="$(q "SELECT state FROM access_request WHERE id = '${b_id}'" 2>/dev/null || echo '?')"
        if [ "$b_dec_code" = "404" ] && [ "$b_after" = "open" ]; then
          echo "and they cannot answer it: HTTP 404, the request is still open"
        else
          echo "DECIDING SOMEBODY ELSE'S REQUEST: HTTP ${b_dec_code}, state is now '${b_after}' (expected 404/open)"
          echo "    A refusal that went through silently is the one failure the reply cannot show:"
          echo "    the applicant is told no by somebody who was never given that button."
          fail_at
        fi
      fi
    fi

    q "DELETE FROM access_request WHERE email LIKE 'smoke-boundary-%@smoke.local'" >/dev/null 2>&1 || true
    b_left="$(q "SELECT count(*) FROM access_request WHERE email LIKE 'smoke-boundary-%@smoke.local'" 2>/dev/null || echo '?')"
    [ "$b_left" = "0" ] ||
      { echo "the boundary block's request was NOT taken back: ${b_left} left"; fail_at; }

    # ---------- THE DECISION THAT WAS ALREADY MADE ----------
    #
    # Two operators looking at the same queue, or one who clicked twice on a
    # slow connection. Both routes check `state != 'open'` INSIDE the
    # transaction that would otherwise write — the only place that check means
    # anything — and both answer 409. What a gate has to prove is not the
    # status code but what did NOT happen behind it.
    #
    # Granting twice makes a second organisation with one person owning both,
    # and every later sign-in has to ask them which they meant; the route's own
    # 409 names it — "either create a second organisation or lose the first".
    # Declining twice mails somebody a refusal they have already read. Granting
    # something that was declined turns a no into an organisation.
    #
    # And a decision is a RECORD, not only a state. `decided_by`, `decided_at`
    # and `decision_note` say who said it and why, and a second press that
    # quietly re-stamped them would write the first operator out of the queue's
    # own history while the state stayed exactly right — the kind of defect
    # that surfaces months later, in an argument about who decided what.
    #
    # `mail_to_count` comes from the decline block above: the same question,
    # asked for the same reason. Named here rather than assumed, because a
    # missing function in bash is an empty answer, and an empty answer is what
    # this block would read as "no second mail was sent".
    if ! declare -F mail_to_count >/dev/null 2>&1; then
      echo "mail_to_count is gone — this block cannot tell a second mail from none"; fail_at
    fi

    DECIDED_NO="smoke-decided-no-${SMOKE_MAIL_RUN}@smoke.local"
    DECIDED_YES="smoke-decided-yes-${SMOKE_MAIL_RUN}@smoke.local"
    DECIDED_ORG="Smoke Decided ${SMOKE_MAIL_RUN}"
    q "DELETE FROM access_request WHERE email LIKE 'smoke-decided-%@smoke.local'" >/dev/null 2>&1 || true
    q "DELETE FROM tenant WHERE name LIKE 'Smoke Decided %'" >/dev/null 2>&1 || true

    knock_open() { # knock_open <email> -> the id of the open request, or empty
      curl -sS -o /dev/null -X POST "${API}/api/access-requests" -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg e "$1" '{email:$e, locale:"en"}')" || true
      # `awk 'NR==1'` rather than `head -1`: head stops reading and psql takes the
      # SIGPIPE. At most one row can come back anyway — migration 0020 forbids two
      # OPEN requests per address — so this is about the pipe, not the count.
      q "SELECT id FROM access_request WHERE email = '$1' AND state = 'open'" 2>/dev/null | awk 'NR==1'
    }

    # ---- SAID NO, THEN ASKED AGAIN ----
    dn_id="$(knock_open "$DECIDED_NO")"
    if [ -z "$dn_id" ]; then
      echo "the gate could not file a request to decide twice: no open row for ${DECIDED_NO}"; fail_at
    else
      dn_first="$(http POST "$API/api/access-requests/${dn_id}/decline" "$OP_TOKEN" \
        '{"note":"smoke: the first decision, and the one that stands","notify":true}')"
      [ "${dn_first%% *}" = "200" ] ||
        { echo "the first decline was refused: HTTP ${dn_first%% *}"; fail_at; }

      # THE FIRST MAIL IS THE CONTROL for the second one's absence, exactly as
      # in the decline block: "no further mail" on a dead pipe is not a finding.
      dn_mail=0
      for _ in $(seq 1 20); do
        dn_mail="$(mail_to_count "$DECIDED_NO")"
        [ "${dn_mail:-0}" != "0" ] && break
        sleep 1
      done
      [ "${dn_mail:-0}" = "1" ] ||
        { echo "the first refusal did not reach ${DECIDED_NO}: ${dn_mail} addressed to them"; fail_at; }

      # WHO DECIDED IT, before anybody presses anything a second time.
      dn_was="$(q "SELECT decided_by ||'|'|| coalesce(decision_note,'') ||'|'|| decided_at
                     FROM access_request WHERE id = '${dn_id}'" 2>/dev/null || echo '?')"

      dn_again="$(http POST "$API/api/access-requests/${dn_id}/decline" "$OP_TOKEN" \
        '{"note":"smoke: a second note that must not land","notify":true}')"
      dn_now="$(q "SELECT decided_by ||'|'|| coalesce(decision_note,'') ||'|'|| decided_at
                     FROM access_request WHERE id = '${dn_id}'" 2>/dev/null || echo '??')"
      dn_state="$(q "SELECT state FROM access_request WHERE id = '${dn_id}'" 2>/dev/null || echo '?')"
      dn_mail2="$(mail_to_count "$DECIDED_NO")"
      if [ "${dn_again%% *}" = "409" ] && [ "$dn_state" = "declined" ] &&
         [ "$dn_now" = "$dn_was" ] && [ "$dn_mail2" = "$dn_mail" ]; then
        echo "a refusal is answered once: HTTP 409, the first decision and its note stand, still ${dn_mail2} mail"
      else
        echo "deciding a declined request again: HTTP ${dn_again%% *}, state=${dn_state}, mail ${dn_mail} -> ${dn_mail2}"
        echo "    record before: ${dn_was}"
        echo "    record after:  ${dn_now}"
        echo "    A second press that re-stamps decided_by writes the first operator out of the"
        echo "    queue's history, and a second mail tells somebody twice that they were refused."
        fail_at
      fi

      # AND THE OTHER BUTTON, on the same decided row. This is the one whose
      # wrong answer creates an organisation out of a refusal.
      dn_tenants_before="$(q "SELECT count(*) FROM tenant WHERE name LIKE 'Smoke Decided %'" 2>/dev/null || echo '?')"
      dn_grant="$(http POST "$API/api/access-requests/${dn_id}/grant" "$OP_TOKEN" \
        "$(jq -nc --arg n "$DECIDED_ORG" '{organisationName:$n}')")"
      dn_tenants_after="$(q "SELECT count(*) FROM tenant WHERE name LIKE 'Smoke Decided %'" 2>/dev/null || echo '?')"
      if [ "${dn_grant%% *}" = "409" ] && [ "$dn_tenants_after" = "$dn_tenants_before" ]; then
        echo "and a no cannot be turned into an organisation: HTTP 409, organisations ${dn_tenants_after}"
      else
        echo "granting a DECLINED request: HTTP ${dn_grant%% *}, organisations ${dn_tenants_before} -> ${dn_tenants_after}"
        fail_at
      fi
    fi

    # ---- SAID YES, THEN ASKED AGAIN ----
    dy_id="$(knock_open "$DECIDED_YES")"
    if [ -z "$dy_id" ]; then
      echo "the gate could not file a request to grant and then re-decide: no open row for ${DECIDED_YES}"; fail_at
    else
      dy_grant="$(http POST "$API/api/access-requests/${dy_id}/grant" "$OP_TOKEN" \
        "$(jq -nc --arg n "$DECIDED_ORG" '{organisationName:$n}')")"
      dy_tenant="$(jq -r '.tenantId // empty' <<<"${dy_grant#* }" 2>/dev/null || true)"
      [ "${dy_grant%% *}" = "201" ] && [ -n "$dy_tenant" ] ||
        { echo "the gate's second grant failed: HTTP ${dy_grant%% *} — ${dy_grant#* }"; fail_at; }

      dy_mail=0
      for _ in $(seq 1 20); do
        dy_mail="$(mail_to_count "$DECIDED_YES")"
        [ "${dy_mail:-0}" != "0" ] && break
        sleep 1
      done

      dy_again="$(http POST "$API/api/access-requests/${dy_id}/decline" "$OP_TOKEN" \
        '{"note":"smoke: taking back an organisation by declining it","notify":true}')"
      dy_state="$(q "SELECT state FROM access_request WHERE id = '${dy_id}'" 2>/dev/null || echo '?')"
      dy_still="$(q "SELECT (SELECT count(*) FROM tenant WHERE id = '${dy_tenant:-00000000-0000-4000-8000-000000000000}')
                    ||'/'|| (SELECT count(*) FROM tenant_member
                               WHERE tenant_id = '${dy_tenant:-00000000-0000-4000-8000-000000000000}'
                                 AND role = 'owner' AND status = 'invited')" 2>/dev/null || echo '?')"
      dy_mail2="$(mail_to_count "$DECIDED_YES")"
      if [ "${dy_again%% *}" = "409" ] && [ "$dy_state" = "granted" ] &&
         [ "$dy_still" = "1/1" ] && [ "$dy_mail2" = "$dy_mail" ]; then
        echo "a grant is not undone by pressing the other button: HTTP 409, organisation/invitation = ${dy_still}"
      else
        echo "declining a GRANTED request: HTTP ${dy_again%% *}, state=${dy_state}, organisation/invitation=${dy_still}, mail ${dy_mail} -> ${dy_mail2}"
        echo "    A decline that landed here would leave an organisation nobody is the owner of,"
        echo "    or tell somebody their access was refused after they had already been let in."
        fail_at
      fi
    fi

    # TAKE IT BACK. Requests first, then tenants — ON DELETE RESTRICT again.
    q "DELETE FROM access_request WHERE email LIKE 'smoke-decided-%@smoke.local'" >/dev/null 2>&1 || true
    q "DELETE FROM tenant WHERE name LIKE 'Smoke Decided %'" >/dev/null 2>&1 || true
    dd_left="$(q "SELECT (SELECT count(*) FROM access_request WHERE email LIKE 'smoke-decided-%@smoke.local')
              ||'/'|| (SELECT count(*) FROM tenant WHERE name LIKE 'Smoke Decided %')" 2>/dev/null || echo '?')"
    [ "$dd_left" = "0/0" ] ||
      { echo "the twice-decided requests were NOT taken back: requests/tenants left = ${dd_left}"; fail_at; }

    # ---------- HOW FAR AN OPERATOR CAN WALK, AND WHAT THE LOG SAYS AT EACH STEP ----------
    #
    # Three levels, and deliberately no fourth. The list names organisations,
    # one organisation names its connections, migrations, invoices, members and
    # usage, one migration names its domains — and it stops there, because a
    # screen that lists ITEMS is a screen that shows subject lines. The
    # metadata boundary is the product's promise, and it is the kind of promise
    # that erodes one convenient field at a time.
    #
    # Each level writes a `support_read` row, and the ROW IS THE POINT. This
    # surface bypasses tenant row security, so the log is the only record of
    # what a person with that power actually looked at. Two details in it are
    # easy to get wrong and invisible from the screen either way:
    #
    #   - the list and the retained-invoices screen record a NULL tenant, on
    #     purpose: there is no organisation to name. A route that attributed
    #     them to some tenant would put a read in that customer's history that
    #     never happened.
    #   - a 404 writes NOTHING. Logging one would put organisations in the
    #     record that the operator never saw — and an id they guessed wrong is
    #     not a read of anybody's data.
    #
    # Counted as DELTAS rather than totals: the boundary block above already
    # reads one organisation as its control, so a total of 1 was never the
    # right expectation and pinning one would break the moment another block
    # looks at anything.
    #
    # NOTHING SWEEPS THESE ROWS, for the reason the people block gives: a gate
    # that erased its own audit trail would be demonstrating the failure the
    # table exists to catch.
    reads_of() { # reads_of <view_name> [tenant predicate] -> how many this operator has
      q "SELECT count(*) FROM support_read
          WHERE operator_user_id = '${OP_SUBJECT}' AND view_name = '$1'
            AND ${2:-true}" 2>/dev/null || echo '?'
    }
    delta_ok() { # delta_ok <before> <after> -> did exactly one row appear
      case "$1" in ''|*[!0-9]*) return 1 ;; esac
      case "$2" in ''|*[!0-9]*) return 1 ;; esac
      [ "$(( $2 - $1 ))" = "1" ]
    }

    # ---- LEVEL 1: every organisation, attributed to none of them ----
    l1_before="$(reads_of tenants 'tenant_id IS NULL')"
    l1="$(http GET "$API/api/support/tenants" "$OP_TOKEN")"
    l1_count="$(jq -r '.tenants | length' <<<"${l1#* }" 2>/dev/null || echo '?')"
    l1_after="$(reads_of tenants 'tenant_id IS NULL')"
    # `-ge` on a non-number is a bash error, not a failed comparison, and the
    # `&&` chain would then fall through to the right branch for the wrong
    # reason with noise on stderr. Sanitised to a number that cannot pass.
    case "$l1_count" in ''|*[!0-9]*) l1_count=-1 ;; esac
    if [ "${l1%% *}" = "200" ] && [ "$l1_count" -ge 1 ] &&
       delta_ok "$l1_before" "$l1_after"; then
      echo "level 1 — the list of organisations: HTTP 200, ${l1_count} of them, logged against no tenant"
    else
      echo "level 1: HTTP ${l1%% *}, organisations=${l1_count}, null-tenant reads ${l1_before} -> ${l1_after}"
      echo "    A list read attributed to one organisation is a read in that customer's history"
      echo "    that never happened; one not logged at all is the record this table exists to be."
      fail_at
    fi

    # ---- LEVEL 2: one organisation, and every section of it ----
    l2_before="$(reads_of tenant "tenant_id = '${APPLY_TENANT}'")"
    l2="$(http GET "$API/api/support/tenants/${APPLY_TENANT}" "$OP_TOKEN")"
    l2_body="${l2#* }"
    # `has` rather than a length: an empty connections list is a true answer for
    # an organisation with none, and a MISSING key is a screen with a hole in it.
    l2_shape="$(jq -r '[.tenant, .connections, .migrations, .invoices, .members, .usage]
                       | map(. != null) | all' <<<"$l2_body" 2>/dev/null || echo false)"
    l2_id="$(jq -r '.tenant.tenant_id // empty' <<<"$l2_body" 2>/dev/null || true)"
    l2_after="$(reads_of tenant "tenant_id = '${APPLY_TENANT}'")"
    if [ "${l2%% *}" = "200" ] && [ "$l2_shape" = "true" ] && [ "$l2_id" = "$APPLY_TENANT" ] &&
       delta_ok "$l2_before" "$l2_after"; then
      echo "level 2 — one organisation, all six sections, logged against that organisation"
    else
      echo "level 2: HTTP ${l2%% *}, every section present=${l2_shape}, tenant='${l2_id}',"
      echo "         reads for this tenant ${l2_before} -> ${l2_after}"
      fail_at
    fi

    # ---- AND A 404 WRITES NOTHING ----
    l2_ghost="$(q "SELECT gen_random_uuid()" 2>/dev/null || echo '')"
    l2_miss_before="$(reads_of tenant 'true')"
    l2_miss="$(http GET "$API/api/support/tenants/${l2_ghost}" "$OP_TOKEN")"
    l2_miss_after="$(reads_of tenant 'true')"
    if [ "${l2_miss%% *}" = "404" ] && [ "$l2_miss_after" = "$l2_miss_before" ]; then
      echo "an organisation that does not exist is not written into anybody's history: HTTP 404, no row"
    else
      echo "reading a missing organisation: HTTP ${l2_miss%% *}, tenant reads ${l2_miss_before} -> ${l2_miss_after}"
      echo "    A logged 404 puts organisations in the record the operator never saw."
      fail_at
    fi

    # ---- LEVEL 3: one migration, attributed to ITS OWN organisation ----
    l3_before="$(reads_of migration "tenant_id = '${APPLY_TENANT}'")"
    l3="$(http GET "$API/api/support/migrations/${APPLY_MAPPING}" "$OP_TOKEN")"
    l3_body="${l3#* }"
    l3_id="$(jq -r '.migration.mapping_id // empty' <<<"$l3_body" 2>/dev/null || true)"
    l3_domains="$(jq -r '.domains | length' <<<"$l3_body" 2>/dev/null || echo '?')"
    l3_after="$(reads_of migration "tenant_id = '${APPLY_TENANT}'")"
    case "$l3_domains" in ''|*[!0-9]*) l3_domains=-1 ;; esac
    if [ "${l3%% *}" = "200" ] && [ "$l3_id" = "$APPLY_MAPPING" ] &&
       [ "$l3_domains" -ge 1 ] && delta_ok "$l3_before" "$l3_after"; then
      echo "level 3 — one migration and its ${l3_domains} domain(s), logged against the migration's own organisation"
    else
      echo "level 3: HTTP ${l3%% *}, mapping='${l3_id}', domains=${l3_domains},"
      echo "         reads for this tenant ${l3_before} -> ${l3_after}"
      echo "    The tenant is read back from the view rather than taken from the request —"
      echo "    there is no path for an operator to name who a read gets attributed to."
      fail_at
    fi

    # ---- AND THERE IS NO LEVEL FOUR ----
    #
    # MEASURED THE HARD WAY. This first looked for a real `natural_key` — the
    # href or UID — reasoning that the only convincing version of "it does not
    # show items" is that a string identifying one is absent from the answer.
    # E2E (managed) #109 answered `key=''`, and the product was right: the
    # ledger writes `naturalKey: ''` and keeps only the hash. There is no
    # plaintext item identifier stored to leak, which is a better fact than the
    # one the check was reaching for.
    #
    # So the boundary is asked two ways, and neither can go vacuous:
    #
    #   THE SHAPE — exactly two keys at the top, and no item-level name
    #   anywhere in the body. This is the one that cannot be satisfied by
    #   accident: a level four would have to introduce a key to hold it.
    #
    #   A NEEDLE THAT EXISTS — this tenant's own `natural_key_hash`, which IS
    #   what identifies an item in this schema. Absent from the answer, or the
    #   run fails; and an empty needle fails rather than matching everything.
    l4_top="$(jq -r 'keys | join(",")' <<<"$l3_body" 2>/dev/null || echo '?')"
    l4_named="$(jq -r '[paths | .[] | select(type == "string")] | unique
                       | map(select(. == "items" or . == "item" or . == "natural_key"
                                    or . == "natural_key_hash" or . == "source_ref"
                                    or . == "target_ref" or . == "href" or . == "subject"
                                    or . == "summary" or . == "collection"))
                       | length' <<<"$l3_body" 2>/dev/null || echo '?')"
    if [ "$l4_top" = "domains,migration" ] && [ "$l4_named" = "0" ]; then
      echo "and no fourth level: the migration screen carries ${l4_top}, and no item-level field"
    else
      echo "the migration screen's shape: top-level keys='${l4_top}', item-level names=${l4_named}"
      echo "    Level 3 is the last one on purpose. A screen that lists items is a screen that"
      echo "    shows subject lines, and a fourth level has to introduce a key to hold them."
      fail_at
    fi

    #
    # `$ELIGIBLE` rather than a filter of this block's own: every item query in
    # this script uses the one definition, and `smoke-managed-verdict` refuses
    # any that does not — eligibility open-coded twice is eligibility that
    # drifts. It also happens to be what this needle wants, since it guarantees
    # a real target handle rather than a row that was never copied.
    l4_key="$(q "SELECT natural_key_hash FROM item
                  WHERE tenant_id = '${APPLY_TENANT}' AND mapping_id = '${APPLY_MAPPING}'
                    AND $ELIGIBLE ORDER BY natural_key_hash LIMIT 1" 2>/dev/null || echo '')"
    if [ ${#l4_key} -lt 8 ]; then
      echo "no item was available to prove the metadata boundary with (key='${l4_key}')"
      echo "    Not a pass: the check below would compare against an empty string and match"
      echo "    everything, so it is refused rather than reported."
      fail_at
    else
      case "$l3_body" in
        *"$l4_key"*)
          echo "THE MIGRATION SCREEN NAMED AN ITEM: it carries ${l4_key}"
          fail_at
          ;;
        *)
          echo "and it names none of this organisation's items: the key that identifies one is absent"
          ;;
      esac
    fi

    # ---- THE ONE SCREEN THAT IS NOT ABOUT A CUSTOMER ----
    #
    # Logged EVEN WHEN EMPTY, which is the whole assertion: an operator on a
    # platform that has erased nobody and a non-operator who may see nothing
    # produce the same empty list, and only the row tells them apart.
    ri_before="$(reads_of retained_invoices 'tenant_id IS NULL')"
    ri="$(http GET "$API/api/support/retained-invoices" "$OP_TOKEN")"
    ri_is_list="$(jq -r '.invoices | type' <<<"${ri#* }" 2>/dev/null || echo '?')"
    ri_after="$(reads_of retained_invoices 'tenant_id IS NULL')"
    if [ "${ri%% *}" = "200" ] && [ "$ri_is_list" = "array" ] && delta_ok "$ri_before" "$ri_after"; then
      echo "the invoices an erasure kept: HTTP 200, and the read is logged whether or not there are any"
    else
      echo "retained invoices: HTTP ${ri%% *}, .invoices is a ${ri_is_list}, null-tenant reads ${ri_before} -> ${ri_after}"
      fail_at
    fi

    q "DELETE FROM platform_operator WHERE user_id = '${OP_SUBJECT}'" >/dev/null
    left="$(q "SELECT count(*) FROM platform_operator WHERE user_id = '${OP_SUBJECT}'" 2>/dev/null || echo '?')"
    if [ "$left" = "0" ]; then
      echo "the gate's operator was taken back: 0 rows left"
    else
      echo "the gate's operator was NOT taken back (count=${left}) — a standing reader of every tenant"
      fail_at
    fi

    # ---------- AND WHEN THE APPOINTMENT ENDS, SO DOES THE SESSION ----------
    #
    # The row above has just been deleted. The TOKEN has not: it is the same
    # unexpired JWT that read every organisation on this stack a few seconds
    # ago, and nothing about it changed.
    #
    # That is the whole question. Being an operator is a row in a table, not a
    # claim in a token — a deliberate choice (0093 T6), and the reason for it is
    # exactly this moment: an appointment can be ended, and the person who ended
    # it needs that to be true NOW, not when a token expires an hour later or a
    # cache happens to turn over. Anything that read the flag once and kept it —
    # a memoised `isPlatformOperator`, a per-connection GUC set at sign-in, a
    # view materialised anywhere — would serve every customer's metadata to
    # somebody whose access was revoked, and would do it silently.
    #
    # Only a real stack can answer this. A unit test with a fresh fixture per
    # case cannot even ask it: there is no "before" for the caching to survive.
    if [ "$left" = "0" ]; then
      rv_reads_before="$(q "SELECT count(*) FROM support_read WHERE operator_user_id = '${OP_SUBJECT}'" 2>/dev/null || echo '?')"

      # THE CONTROL, and it has to come first. Four refusals in a row prove
      # nothing if the token simply stopped working — an expired or rejected
      # bearer produces the same shape of silence. `/api/me` answers 200 for
      # anybody signed in, so a 200 here says the session is alive, and
      # `operator=false` on the same reply says the ONE thing that changed is
      # the thing that was deleted.
      rv_me="$(http GET "$API/api/me" "$OP_TOKEN")"
      rv_flag="$(jq -r '.operator // false' <<<"${rv_me#* }" 2>/dev/null || echo '?')"
      if [ "${rv_me%% *}" = "200" ] && [ "$rv_flag" = "false" ]; then
        echo "the session outlives the appointment, and knows it: HTTP 200, operator=false"
      else
        echo "after the take-back /api/me answered HTTP ${rv_me%% *}, operator=${rv_flag} (expected 200/false)"
        echo "    A token that stopped working would make every refusal below meaningless, and a"
        echo "    flag still reading true is the cached-permission defect this block is here for."
        fail_at
      fi

      rv_list="$(http GET "$API/api/support/tenants" "$OP_TOKEN")"
      rv_seen="$(jq -r '.tenants | length' <<<"${rv_list#* }" 2>/dev/null || echo '?')"
      rv_one="$(http GET "$API/api/support/tenants/${APPLY_TENANT}" "$OP_TOKEN")"
      rv_queue="$(http GET "$API/api/access-requests" "$OP_TOKEN")"
      rv_q_seen="$(jq -r '.requests | length' <<<"${rv_queue#* }" 2>/dev/null || echo '?')"
      rv_reads_after="$(q "SELECT count(*) FROM support_read WHERE operator_user_id = '${OP_SUBJECT}'" 2>/dev/null || echo '??')"

      # The SAME organisation the three-levels block read with this token, and
      # the same 404 a stranger gets: invisible and absent are one answer here.
      if [ "$rv_seen" = "0" ] && [ "${rv_one%% *}" = "404" ] && [ "$rv_q_seen" = "0" ] &&
         [ "$rv_reads_after" = "$rv_reads_before" ]; then
        echo "and it can no longer read anything: organisations 0, that organisation 404, queue 0, nothing logged"
      else
        echo "after the take-back: organisations=${rv_seen}, that organisation HTTP ${rv_one%% *},"
        echo "                    queue=${rv_q_seen}, support_read ${rv_reads_before} -> ${rv_reads_after}"
        echo "    Each of these answered for this exact token minutes ago. Revocation that waits"
        echo "    for a token to expire is not revocation, and a row written now would record a"
        echo "    read by somebody who is no longer an operator."
        fail_at
      fi
    else
      echo "the appointment was not taken back, so what a revoked session can still do was not asked"
      fail_at
    fi
  fi
fi

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
# ---------- the mail nobody should get (0103 T2 / ADR-0043) ----------
#
# Fresh event 1 carried an ORGANIZER and an ATTENDEE, tag-addressed, and the
# demo target's SMTP points at the catcher — so the fan-out path is ARMED and
# silence is falsifiable, not true by inability. Two assertions here, one
# after the take-back further down:
#
#   1. THE BYTES. The copy on the target carries SCHEDULE-AGENT=CLIENT on both
#      properties: the writer's neutralising observed on a real server's copy
#      of a real synced event, not on a unit fake.
#   2. THE SILENCE. Nothing addressed to the canary reached the catcher during
#      seed or sync. (And nothing after removal — the CANCEL side — checked
#      after balance below.)
#
# WHAT THIS DOES AND DOES NOT PROVE. The canary's organiser is a third party,
# as most of a migrated mailbox's meetings are; the owner-as-organiser case on
# an armed server is T3's per-target measurement, not this fixture. And on a
# run where prepare seeded nothing there is no canary, so the checks say so
# and stand down — the writer-side rules in CI cover every run regardless.
# MEASURED, NOT TRUSTED (0103 T3). One OPTIONS request asks the target
# whether it runs RFC 6638 auto-scheduling at all — the compliance class is
# required to be advertised in the DAV header. No object written, no mail
# risked, nothing but the API: the same question the product can ask any
# customer target. "unknown" is reported as unmeasured, never as safe.
nc_port="$(smoke_env_value NEXTCLOUD_PORT)"
sched_dav_header="$(curl -fsS -o /dev/null -D - -X OPTIONS \
  -u "${TARGET_DAV_USER}:${TARGET_DAV_PASSWORD}" \
  "http://localhost:${nc_port:-8083}/remote.php/dav/calendars/${TARGET_DAV_USER}/personal/" 2>/dev/null \
  | tr -d '\r' | grep -i '^dav:' || true)"
if [ -z "$sched_dav_header" ]; then
  echo "target scheduling: UNKNOWN — OPTIONS answered no DAV header (unmeasured, not safe)"
elif grep -qiE '(^|[,\ ])calendar-auto-schedule([,\ ]|$)' <<<"$sched_dav_header"; then
  echo "target scheduling: auto-schedule ADVERTISED — the neutralising below is load-bearing here"
else
  echo "target scheduling: not advertised — RFC 6638 fan-out cannot happen on this target"
fi

if [ -n "$BALANCE_TAG" ]; then
  note "the mail nobody should get"

  # THE PIPE, PROVED FIRST (0104 T2 first stage; the owner's question,
  # 2026-08-26: "was Nextcloud at all able to mail?"). Until this control, no
  # run had ever shown a mail LEAVING the target and ARRIVING at the catcher —
  # so every silence assertion below was one SMTP typo away from
  # silence-by-inability, the exact disease 0103 exists to end, one layer
  # deeper. The control: the target account writes its own tag-named file and
  # shares it BY MAIL — the same OCS channel a cutover-moment announcement
  # will ride (0104 T0) — and that mail must actually arrive. Tag-addressed
  # both ways, cleaned up after, independent of what the sync copied or the
  # apply half consumed.
  mailproof_file="openmig-mailproof-${BALANCE_TAG}.txt"
  mailproof_addr="openmig-mailproof-${BALANCE_TAG}@example.invalid"
  put_code="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT \
    -u "${TARGET_DAV_USER}:${TARGET_DAV_PASSWORD}" \
    --data-binary "the mail-pipe proof for tag ${BALANCE_TAG}" \
    "http://localhost:${nc_port:-8083}/remote.php/dav/files/${TARGET_DAV_USER}/${mailproof_file}")"
  share_id=""
  share_code="(not attempted)"
  if [ "$put_code" = "201" ] || [ "$put_code" = "204" ]; then
    share_out="$(curl -sS -X POST -H 'OCS-APIRequest: true' -H 'Accept: application/json' \
      -u "${TARGET_DAV_USER}:${TARGET_DAV_PASSWORD}" \
      --data-urlencode "path=/${mailproof_file}" \
      --data-urlencode "shareType=4" \
      --data-urlencode "shareWith=${mailproof_addr}" \
      -w $'\n%{http_code}' \
      "http://localhost:${nc_port:-8083}/ocs/v2.php/apps/files_sharing/api/v1/shares")"
    share_code="${share_out##*$'\n'}"
    share_id="$(jq -r '.ocs.data.id // empty' <<<"${share_out%$'\n'*}" 2>/dev/null || true)"
  fi
  if [ -z "$share_id" ]; then
    echo "the mail-pipe control could not create its share (file PUT ${put_code}, OCS ${share_code})"
    echo "— sharebymail off, or OCS refused. Remedy: occ app:enable sharebymail. Until a"
    echo "mail can LEAVE the target, the silence assertions below are unfalsifiable."
    fail_at
  else
    pipe_mail=0
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      pipe_mail="$(curl -fsS --get "${MAILPIT}/api/v1/search" \
        --data-urlencode "query=${mailproof_addr}" | jq -r '.messages_count // 0')"
      [ "${pipe_mail:-0}" -ge 1 ] && break
      sleep 3
    done
    if [ "${pipe_mail:-0}" -ge 1 ]; then
      echo "the pipe is live: the target's own mailer delivered a share mail to the catcher"
    else
      echo "Nextcloud accepted the share (id ${share_id}) but its mail NEVER reached the"
      echo "catcher — the SMTP pipe is broken (SMTP_* env, or mailpit unreachable from the"
      echo "target), and every silence below would be silence-by-inability. Fix the pipe,"
      echo "then trust the quiet."
      fail_at
    fi
    share_del="$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE -H 'OCS-APIRequest: true' \
      -u "${TARGET_DAV_USER}:${TARGET_DAV_PASSWORD}" \
      "http://localhost:${nc_port:-8083}/ocs/v2.php/apps/files_sharing/api/v1/shares/${share_id}")"
    case "$share_del" in 200|404) ;; *) echo "mailproof share ${share_id} not cleaned up (HTTP ${share_del})"; fail_at ;; esac
  fi
  file_del="$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE \
    -u "${TARGET_DAV_USER}:${TARGET_DAV_PASSWORD}" \
    "http://localhost:${nc_port:-8083}/remote.php/dav/files/${TARGET_DAV_USER}/${mailproof_file}")"
  case "$file_del" in 204|200|404) ;; *) echo "mailproof file not cleaned up (HTTP ${file_del})"; fail_at ;; esac

  sched_href="remote.php/dav/calendars/${TARGET_DAV_USER}/personal/openmig-demo-event-${BALANCE_TAG}-1.ics"
  # Through the PUBLISHED port, as any real DAV client would — the product
  # itself only ever has the API, and the gate should walk through the same
  # door (owner's point, 2026-08-25). nc_port read above, from .env.
  sched_copy="$(curl -fsS -u "${TARGET_DAV_USER}:${TARGET_DAV_PASSWORD}" \
    "http://localhost:${nc_port:-8083}/${sched_href}" 2>/dev/null || true)"
  if [ -z "$sched_copy" ]; then
    echo "could not read the canary copy at ${sched_href} — the byte half of this"
    echo "gate is unproven. Either the sync never copied it, or the writer re-homed"
    echo "the collection; the apply half cannot have consumed it (pick_disposable"
    echo "excludes the canary — the E2E #88 lesson)."
    fail_at
  else
    if grep -q "SCHEDULE-AGENT=CLIENT" <<<"$sched_copy" \
       && grep -q "openmig-attendee-${BALANCE_TAG}@example.invalid" <<<"$sched_copy"; then
      echo "target copy carries SCHEDULE-AGENT=CLIENT and the attendee — the writer neutralised on real bytes"
    else
      echo "the canary copy on the target is MISSING the neutralising or the attendee:"
      grep -E "ATTENDEE|ORGANIZER" <<<"$sched_copy" | awk 'NR<=4 {print "    " $0}'
      echo "  every ATTENDEE and ORGANIZER the writer PUTs must carry SCHEDULE-AGENT=CLIENT"
      echo "  (0103 T1, ADR-0043) — an RFC 6638 target without it MAILS these people."
      fail_at
    fi
  fi
  sched_mail="$(curl -fsS --get "${MAILPIT}/api/v1/search" \
    --data-urlencode "query=openmig-attendee-${BALANCE_TAG}" | jq -r '.messages_count // 0')"
  if [ "${sched_mail:-0}" -gt 0 ]; then
    echo "THE MIGRATION SENT MAIL: ${sched_mail} message(s) mention the canary attendee."
    echo "  Importing a calendar must never invite its attendees (ADR-0043)."
    fail_at
  else
    echo "nothing addressed to the canary reached the catcher during seed or sync"
  fi

  # ---------- the moment, pressed (0104 T2, final stage) ----------
  # The gate now presses the REAL thing: the rescan discovers the source
  # share the seed created, one press applies every open clean row through
  # the target's own share API, and the target's mail — the announcement —
  # must arrive carrying the note only the press writes. The seed's own
  # share-by-mail sent one mail at seed time (the seed's act, tag-addressed,
  # caught like everything else); the press's mail is told apart by that
  # note. The mapping is put into 'done' for exactly the press and restored
  # straight after — the same fabricate-and-retract shape the apply half
  # uses — because a share applied before cutover is the wrong announcement
  # from the right channel, and the gate must not normalise it. The applied
  # share_grant row STAYS in the ledger, one per run, deliberately: it is
  # the record of a mail that really went to a real address.
  note "the moment, pressed"
  rescan_out="$(curl -sS -X POST -H "Authorization: Bearer $APPLY_TOKEN" -w $'\n%{http_code}' \
    "$API/api/migrations/$APPLY_MAPPING/sharing/rescan")"
  echo "rescan: HTTP ${rescan_out##*$'\n'}"
  press_open="$(jq -r '.open // 0' <<<"${rescan_out%$'\n'*}" 2>/dev/null || echo 0)"
  if [ "${press_open:-0}" -lt 1 ]; then
    echo "the rescan found no open sharing rows — the seeded source share was not"
    echo "discovered (scanNextcloudShares, or the seed's ocs() share: one of the two)."
    fail_at
  else
    prior_status="$(q "SELECT status FROM mailbox_mapping WHERE id='$APPLY_MAPPING'")"
    q "UPDATE mailbox_mapping SET status='done' WHERE id='$APPLY_MAPPING'" >/dev/null
    press_out="$(curl -sS -X POST -H "Authorization: Bearer $APPLY_TOKEN" -H 'Content-Type: application/json' \
      -d "{\"note\":\"Everything moved for run ${BALANCE_TAG}.\"}" -w $'\n%{http_code}' \
      "$API/api/migrations/$APPLY_MAPPING/sharing/apply-all")"
    q "UPDATE mailbox_mapping SET status='${prior_status}' WHERE id='$APPLY_MAPPING'" >/dev/null
    echo "press: HTTP ${press_out##*$'\n'}"
    press_applied="$(jq -r '.applied | length' <<<"${press_out%$'\n'*}" 2>/dev/null || echo 0)"
    if [ "${press_applied:-0}" -lt 1 ]; then
      echo "the press applied nothing:"
      jq -r '.refused // .reason // .' <<<"${press_out%$'\n'*}" 2>/dev/null | awk 'NR<=6 {print "    " $0}'
      fail_at
    else
      echo "press applied ${press_applied} grant(s) — the target announces them itself"
      press_mail=0
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        press_mail="$(curl -fsS --get "${MAILPIT}/api/v1/search" \
          --data-urlencode "query=\"Everything moved for run ${BALANCE_TAG}\"" | jq -r '.messages_count // 0')"
        [ "${press_mail:-0}" -ge 1 ] && break
        sleep 3
      done
      if [ "${press_mail:-0}" -ge 1 ]; then
        echo "the announcement arrived: the target's own mail carries the press's note"
      else
        echo "the press applied but its mail never reached the catcher — the announcement"
        echo "path is broken between the target's share-by-mail and delivery."
        fail_at
      fi
    fi
  fi
fi

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
    fail_at
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
    fail_at
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
      fail_at
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
# THE CANCEL SIDE (0103 T2). The take-back just DELETEd the organiser copy on
# an armed target — under RFC 6638 exactly the write that fans out CANCEL.
#
# DRAIN THE QUEUE, THEN TRUST THE QUIET (the owner's question, 2026-08-26:
# "how do you know Nextcloud doesn't queue mails to send out later?"). For
# iMIP we know structurally: SCHEDULE-AGENT=CLIENT means the server never
# COMPOSES a message, so there is nothing to queue. But Nextcloud does have
# genuinely queued mail channels — activity digests, calendar reminders —
# they ride background jobs, and this demo runs no cron. A queued mail would
# not send "later"; it would sit until something ran the jobs, invisible to
# a gate that already said PASS. So the gate runs the jobs ITSELF and only
# then believes the silence: "no queue fired yet" becomes "the queue was
# drained and still nothing".
if [ -n "$BALANCE_TAG" ]; then
  if ! docker exec -u www-data "${NEXTCLOUD_CONTAINER:-ownpace-nextcloud}" php -f /var/www/html/cron.php >/dev/null 2>&1; then
    echo "the queue drain itself failed — the silence below is UN-drained, and a queued"
    echo "mail could still be sitting behind it (docker exec … php -f cron.php)."
    fail_at
  fi
  sched_mail_after="$(curl -fsS --get "${MAILPIT}/api/v1/search" \
    --data-urlencode "query=openmig-attendee-${BALANCE_TAG}" | jq -r '.messages_count // 0')"
  if [ "${sched_mail_after:-0}" -gt 0 ]; then
    echo "THE TAKE-BACK SENT MAIL: ${sched_mail_after} message(s) mention the canary"
    echo "  attendee after removal — deleting a migrated copy must not CANCEL its"
    echo "  attendees (ADR-0043; Schedule-Reply and the neutralised copy are the guards)."
    fail_at
  else
    echo "and nothing after the take-back either — no CANCEL fan-out"
  fi
fi

note "the status page"

status_port="$(smoke_env_value STATUS_PORT)"
STATUS="${SMOKE_STATUS:-http://localhost:${status_port:-3124}}"
if curl -fsS -o /dev/null -m 10 "${STATUS}/health"; then
  echo "status page: answering at ${STATUS}/health"
else
  # Not skipped quietly, for the same reason as mailpit above: gatus is in
  # managed.yml and in the bring-up's service list, so silence here means a
  # service the stack starts is not serving.
  echo "the status page is not answering at ${STATUS}/health"
  echo "  It has no container healthcheck by design (scratch image), so this"
  echo "  probe is the only thing that speaks for it."
  fail_at
fi

# ---------- verdict ----------
note "verdict"
echo "verify: $VERIFY_RESULT   apply: $APPLY_RESULT"
if [ "$fail" = "0" ]; then
  echo "SMOKE PASS — evidence in $OUT"
else
  echo "SMOKE FAIL — evidence in $OUT"
  # THE LIST IS THE POINT. Printed after the FAIL line and before the exit, so
  # the last thing on the terminal is what to go and look at rather than an
  # invitation to search a log. Every entry names the section, the line in this
  # file, and the sentence the site chose to add.
  echo ""
  echo "what failed:"
  printf '%s' "$FAIL_REASONS"
  echo ""
  echo "Each line above points at deploy/compose/smoke-managed.sh, and the log"
  echo "of that section in $OUT carries the detail."
fi
exit "$fail"
