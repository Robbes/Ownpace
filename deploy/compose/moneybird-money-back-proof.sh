#!/usr/bin/env bash
# moneybird-money-back-proof.sh — the two Moneybird calls of workplan 0111,
# slice 7d (second half), tried by hand in the SANDBOX administration, exactly
# as packages/managed/src/money-back.ts makes them:
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
# It makes 2 invoices and 2 credit notes (4 of the sandbox's 50 a month), all
# sent by hand (no e-mail), to Ownpace's proof contact. It reads this
# checkout's .env, so run it from the OTA checkout, whose MONEYBIRD_* name the
# SANDBOX administration, after MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE is set
# (`operator.sh moneybird check` lists the ids). It talks to Moneybird alone:
# no Mollie key is needed, and nothing in the database changes. It refuses a
# .env with NODE_ENV production or none, which is how live's reads; the OTA
# stack runs development. Never on live.
#
#   ./deploy/compose/moneybird-money-back-proof.sh   # in the OTA checkout
#
# Needs curl and jq. Both calls proved is one of the owner's steps before
# invoices reach customers (docs/ending-the-alpha.md).
set -euo pipefail

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
