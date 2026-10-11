#!/usr/bin/env bash
# moneybird-money-back-proof.sh — the calls of workplan 0111, slice 7d (second
# half), tried by hand in the SANDBOX administration and in Mollie's TEST
# mode, exactly as packages/managed/src/money-back.ts and mollie-refunds.ts
# make them. With no argument, the two Moneybird calls:
#
#   CALL 1  PATCH sales_invoices/{credit}/register_payment_creditinvoice
#           a credit note of 4.00 set against an OPEN invoice of 12.00
#           expected: the credit note paid; the invoice open with 8.00 unpaid
#
#   CALL 2  POST sales_invoices/{credit}/payments  with price -4.00
#           a refund of 4.00 booked on the credit note of an invoice paid
#           through Mollie, on the Mollie account, under a refund id
#           expected: HTTP 201, the credit note paid, the refund id on it
#
# With `refund`, the refund itself, through Mollie, then booked as CALL 2:
#
#   CALL 3  a test payment of 12.00 that the owner pays on Mollie's test
#           checkout, booked on a Moneybird invoice; a credit note of 4.00;
#           then POST payments/{id}/refunds at Mollie, with the credit
#           note's reference as the Idempotency-Key and in the metadata
#           expected: HTTP 201 and a refund of 4.00; the same request again
#           answers the same refund, and the payment holds one refund for
#           the credit note; booked on the credit note under the refund id
#
# Without an argument it makes 2 invoices and 2 credit notes, with `refund`
# 1 and 1, of the sandbox's 50 a month, all sent by hand (no e-mail), to
# Ownpace's proof contact. It reads this checkout's .env, so run it from the
# OTA checkout, whose MONEYBIRD_* name the SANDBOX administration, after
# MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE is set (`operator.sh moneybird check`
# lists the ids); `refund` also needs MOLLIE_API_KEY, a TEST key (test_...),
# and refuses any other. The test payment names no webhook, so no stack hears
# of it, and nothing in the database changes. It refuses a .env with NODE_ENV
# production or none, which is how live's reads; the OTA stack runs
# development. Never on live.
#
#   ./deploy/compose/moneybird-money-back-proof.sh          # in the OTA checkout
#   ./deploy/compose/moneybird-money-back-proof.sh refund   # the same, with a test key
#
# Needs curl and jq. The Moneybird calls proved is one of the owner's steps
# before invoices reach customers (docs/ending-the-alpha.md).
set -euo pipefail

MODE="${1:-books}"
case "$MODE" in
  books|refund) ;;
  *) echo "usage: $0 [refund]" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
[ -f "$ENV_FILE" ] || { echo "FATAL: $ENV_FILE not found: run this from the OTA checkout" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a
: "${MONEYBIRD_API_TOKEN:?not set in .env}"
: "${MONEYBIRD_ADMINISTRATION_ID:?not set in .env}"
: "${MONEYBIRD_WORKFLOW_ID:?not set in .env}"
: "${MONEYBIRD_TAX_RATE_ID_DOMESTIC:?not set in .env}"
: "${MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE:?not set in .env: set it first (operator.sh moneybird check lists the ids)}"
if [ "${NODE_ENV:-}" = "production" ] || [ -z "${NODE_ENV:-}" ]; then
  echo "FATAL: NODE_ENV is '${NODE_ENV:-}': this .env may be live's. Run it on the sandbox stack only." >&2
  exit 1
fi
if [ "$MODE" = refund ]; then
  : "${MOLLIE_API_KEY:?not set in .env: a TEST key (test_...) from Mollie, Developers > API keys}"
  case "$MOLLIE_API_KEY" in
    test_*) ;;
    *) echo "FATAL: MOLLIE_API_KEY is not a test key (test_...): this proof refunds in Mollie's test mode only." >&2; exit 1 ;;
  esac
fi

API="https://moneybird.com/api/v2/${MONEYBIRD_ADMINISTRATION_ID}"
TODAY="$(date -u +%Y-%m-%d)"
STAMP="$(date -u +%Y%m%d%H%M%S)"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

# mb METHOD PATH [JSON] -> prints the HTTP status; the body is in $OUT
mb() {
  curl -sS -o "$OUT" -w '%{http_code}' -X "$1" "${API}$2" \
    -H "Authorization: Bearer ${MONEYBIRD_API_TOKEN}" \
    -H 'Accept: application/json' -H 'Content-Type: application/json' \
    ${3:+--data "$3"}
}
# mollie METHOD PATH [JSON] [IDEMPOTENCY-KEY] -> prints the HTTP status; the body is in $OUT
mollie() {
  local args=(-sS -o "$OUT" -w '%{http_code}' -X "$1" "https://api.mollie.com/v2$2"
    -H "Authorization: Bearer ${MOLLIE_API_KEY}" -H 'Accept: application/json')
  if [ -n "${3:-}" ]; then args+=(-H 'Content-Type: application/json' --data "$3"); fi
  if [ -n "${4:-}" ]; then args+=(-H "Idempotency-Key: $4"); fi
  curl "${args[@]}"
}
need() { # need STATUS-GOT STATUS-WANTED... WHAT
  local got="$1"; shift; local what="${*: -1}"; local ok=0
  for want in "${@:1:$#-1}"; do [ "$got" = "$want" ] && ok=1; done
  if [ "$ok" = 0 ]; then echo "FAILED: $what: HTTP $got"; jq -c . "$OUT" 2>/dev/null || cat "$OUT"; exit 1; fi
}

# The proof contact (customer id ownpace-proof), made by `operator.sh moneybird proof`.
s=$(mb GET "/contacts.json?query=ownpace-proof"); need "$s" 200 "find the proof contact"
CONTACT=$(jq -r '[.[] | select(.customer_id == "ownpace-proof")][0].id // empty' "$OUT")
if [ -z "$CONTACT" ]; then
  s=$(mb POST /contacts.json '{"contact":{"company_name":"Ownpace proof","customer_id":"ownpace-proof","country":"NL"}}')
  need "$s" 201 "make the proof contact"; CONTACT=$(jq -r .id "$OUT")
fi
echo "contact: $CONTACT"

# invoice REF DESCRIPTION -> sends an invoice of 12.00 by hand, prints its id
invoice() {
  local body s id
  body=$(jq -nc --arg c "$CONTACT" --arg r "$1" --arg w "$MONEYBIRD_WORKFLOW_ID" --arg d "$2" --arg t "$MONEYBIRD_TAX_RATE_ID_DOMESTIC" \
    '{sales_invoice:{contact_id:$c, reference:$r, workflow_id:$w, prices_are_incl_tax:true,
      details_attributes:[{description:$d, price:"12.00", amount:1, tax_rate_id:$t}]}}')
  s=$(mb POST /sales_invoices.json "$body"); need "$s" 201 "make invoice $1"; id=$(jq -r .id "$OUT")
  s=$(mb PATCH "/sales_invoices/$id/send_invoice.json" '{"sales_invoice_sending":{"delivery_method":"Manual"}}')
  need "$s" 200 "send invoice $1"; echo "$id"
}

# credit ORIGINAL REF -> Moneybird's credit copy, filled with -4.00, sent by hand; prints its id
credit() {
  local s id body
  s=$(mb PATCH "/sales_invoices/$1/duplicate_creditinvoice.json" '{}'); need "$s" 200 201 "copy $1 as a credit invoice"
  id=$(jq -r .id "$OUT")
  body=$(jq -c --arg r "$2" --arg t "$MONEYBIRD_TAX_RATE_ID_DOMESTIC" \
    '{sales_invoice:{reference:$r, details_attributes:(([.details[].id | {id:., _destroy:true}]) +
      [{description:"Proof 7d: 4.00 of 12.00 credited", price:"-4.00", amount:1, tax_rate_id:$t}])}}' "$OUT")
  s=$(mb PATCH "/sales_invoices/$id.json" "$body"); need "$s" 200 "fill credit $2"
  s=$(mb PATCH "/sales_invoices/$id/send_invoice.json" '{"sales_invoice_sending":{"delivery_method":"Manual"}}')
  need "$s" 200 "send credit $2"; echo "$id"
}

show() { # show ID LABEL
  local s; s=$(mb GET "/sales_invoices/$1.json"); need "$s" 200 "read $2"
  jq -c --arg l "$2" '{($l): {number: .invoice_id, state, total: .total_price_incl_tax, unpaid: .total_unpaid,
    payments: [.payments[]? | {price, transaction_identifier}]}}' "$OUT"
}

if [ "$MODE" = books ]; then
echo; echo "== CALL 1: a credit note set against an open invoice (register_payment_creditinvoice)"
A=$(invoice "ownpace-proof-7d-open-$STAMP" "Proof 7d: open, credited in part")
CA=$(credit "$A" "ownpace-proof-7d-open-$STAMP-credit")
s=$(mb PATCH "/sales_invoices/$CA/register_payment_creditinvoice.json" '{}')
echo "CALL 1 answered HTTP $s: $(jq -c . "$OUT" 2>/dev/null | cut -c1-300)"
show "$A" "invoice (expected: open, unpaid 8.0)"
show "$CA" "credit note (expected: paid)"

echo; echo "== CALL 2: a refund booked on the credit note of an invoice paid through Mollie (payments, -4.00)"
B=$(invoice "ownpace-proof-7d-paid-$STAMP" "Proof 7d: paid through Mollie, credited in part")
body=$(jq -nc --arg d "$TODAY" --arg a "$MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE" --arg t "tr_proof7d_$STAMP" \
  '{payment:{payment_date:$d, price:"12.00", financial_account_id:$a, transaction_identifier:$t}}')
s=$(mb POST "/sales_invoices/$B/payments.json" "$body"); need "$s" 201 "book the Mollie payment on $B"
CB=$(credit "$B" "ownpace-proof-7d-paid-$STAMP-credit")
body=$(jq -nc --arg d "$TODAY" --arg a "$MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE" --arg t "re_proof7d_$STAMP" \
  '{payment:{payment_date:$d, price:"-4.00", financial_account_id:$a, transaction_identifier:$t}}')
s=$(mb POST "/sales_invoices/$CB/payments.json" "$body")
echo "CALL 2 answered HTTP $s: $(jq -c . "$OUT" 2>/dev/null | cut -c1-300)"
show "$B" "invoice (expected: paid)"
show "$CB" "credit note (expected: paid, a payment of -4.0 under re_proof7d_$STAMP)"
exit 0
fi

echo; echo "== CALL 3: a refund through Mollie (test mode), booked on the credit note"
# A test payment of 12.00 on Mollie's hosted checkout. It names no webhook, so no stack hears of it.
body=$(jq -nc --arg d "Ownpace proof 7d $STAMP" \
  '{amount:{currency:"EUR", value:"12.00"}, description:$d, redirectUrl:"https://www.ownpace.eu/"}')
s=$(mollie POST /payments "$body"); need "$s" 201 "make a test payment at Mollie"
TR=$(jq -r .id "$OUT")
echo "payment: $TR"
echo "Open this in a browser, pick any method and choose the status Paid:"
echo "  $(jq -r ._links.checkout.href "$OUT")"
echo "Waiting up to 10 minutes for Mollie to call it paid ..."
STATUS=open
for _ in $(seq 1 120); do
  s=$(mollie GET "/payments/$TR"); need "$s" 200 "read the payment $TR"
  STATUS=$(jq -r .status "$OUT")
  case "$STATUS" in
    paid) break ;;
    failed|canceled|expired) echo "FAILED: the test payment is $STATUS: run it again and choose Paid"; exit 1 ;;
  esac
  sleep 5
done
if [ "$STATUS" != paid ]; then echo "FAILED: the test payment is still $STATUS after 10 minutes"; exit 1; fi
echo "payment $TR: paid"

C=$(invoice "ownpace-proof-7d-refund-$STAMP" "Proof 7d: paid through Mollie in test mode, refunded in part")
body=$(jq -nc --arg d "$TODAY" --arg a "$MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE" --arg t "$TR" \
  '{payment:{payment_date:$d, price:"12.00", financial_account_id:$a, transaction_identifier:$t}}')
s=$(mb POST "/sales_invoices/$C/payments.json" "$body"); need "$s" 201 "book the Mollie payment on $C"
REF="ownpace-proof-7d-refund-$STAMP-credit"
CC=$(credit "$C" "$REF")

# The refund as createRefund asks it: the credit note's reference as the key and in the metadata.
body=$(jq -nc --arg r "$REF" \
  '{amount:{currency:"EUR", value:"4.00"}, description:"Ownpace proof 7d, a credit note of 4.00", metadata:{creditNote:$r}}')
s=$(mollie POST "/payments/$TR/refunds" "$body" "$REF")
echo "CALL 3a (the refund) answered HTTP $s: $(jq -c '{id, amount, status, metadata}' "$OUT" 2>/dev/null || cat "$OUT")"
need "$s" 201 200 "refund 4.00 of $TR"
RE=$(jq -r .id "$OUT")
s=$(mollie POST "/payments/$TR/refunds" "$body" "$REF")
echo "CALL 3b (the same refund asked again, the same key) answered HTTP $s: $(jq -c '{id, status}' "$OUT" 2>/dev/null || cat "$OUT")"
echo "  expected: $RE again, no second refund"
s=$(mollie GET "/payments/$TR/refunds?limit=250"); need "$s" 200 "list the refunds of $TR"
jq -c --arg r "$REF" '{refunds_on_the_payment: [._embedded.refunds[] | {id, amount: .amount.value, status, creditNote: .metadata.creditNote}],
  for_this_credit_note: ([._embedded.refunds[] | select(.metadata.creditNote == $r)] | length)}' "$OUT"
echo "  expected: for_this_credit_note 1"

body=$(jq -nc --arg d "$TODAY" --arg a "$MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE" --arg t "$RE" \
  '{payment:{payment_date:$d, price:"-4.00", financial_account_id:$a, transaction_identifier:$t}}')
s=$(mb POST "/sales_invoices/$CC/payments.json" "$body")
echo "CALL 3c (the refund booked) answered HTTP $s: $(jq -c '{id, price, transaction_identifier}' "$OUT" 2>/dev/null || cat "$OUT")"
show "$C" "invoice (expected: paid, 12.0 under $TR)"
show "$CC" "credit note (expected: paid, a payment of -4.0 under $RE)"
