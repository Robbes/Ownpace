# Rehearsing billing on the OTA stack

> **In one line:** the whole billing chain, walked once on the OTA stack against Moneybird's sandbox and Mollie's test mode, before live invoices anybody.

Each piece of the chain has its tests, and Moneybird's and Mollie's calls passed one by one in the sandbox
([managed-bring-up.md](./managed-bring-up.md), *8i*, step 6). What none of that shows is the chain as a
customer meets it: a tier ordered in the app, the month invoiced, numbered by Moneybird, paid through
Mollie, booked, downloaded, a year bought, and a withdrawal that credits and refunds it all. This is that
walk, run by hand, on the OTA stack, in about two hours of mostly waiting for the hourly tasks.

It ends the alpha on the OTA stack for the length of the walk, the way
[ending-the-alpha.md](./ending-the-alpha.md) will on live, so it rehearses the switch too. Step 9 puts
it back.

## Before you start

- **The OTA stack runs a release with the year in it** (workplan 0111 T11, slices Y1 to Y3): the
  Billing page has a card *A year ahead*.
- **Its books and payments are set**, as *8i* steps 1 to 5 say: a Moneybird **sandbox** administration,
  `MONEYBIRD_DELIVERY` empty or `manual` (the sandbox sends ten mails a month), Mollie's `test_` key, the
  account Mollie pays out from, and `./deploy/compose/operator.sh moneybird check` ending
  `RESULT: ready`.
- **Mollie can reach the stack:** `API_URL` is a public https address. Mollie confirms each payment
  there; if it cannot, a payment stays open in the app, and that is a finding of this walk, not a step
  to skip.
- **Mail is caught:** on the OTA stack every mail lands in Mailpit (*Mail: caught, not delivered* in
  [managed-bring-up.md](./managed-bring-up.md)), and `NOTIFY_TO` is set. The order confirmations and the
  operator's mails are part of what you check, there.
- **Two organisations of your own on the stack**, each with you as owner: *Walk A*, which will order
  month by month and then a year, and *Walk B*, which buys a year straight from Free. Neither may be a
  tester's.

Write down the time you start: every step below says which hourly task it waits for. The month task
runs at **:23** past the hour, the push at **:41**.

## 1. Out of the alpha, on the OTA stack only

In the OTA checkout, as [ending-the-alpha.md](./ending-the-alpha.md) *The switch* does on live: empty
`OWNPACE_STAGE`, name this month as the first invoiced, and bring the change to every part that reads
it. The web bundle bakes the stage in, so its image is rebuilt; the API reads it when it starts; the
tasks only from `set-task-env.sh`.

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env OWNPACE_STAGE=
./deploy/compose/env-upsert.sh deploy/compose/.env OWNPACE_BILLING_FROM="$(date -u +%Y-%m)"
GIT_SHA=$(git rev-parse --short HEAD) docker compose -f deploy/compose/managed.yml build web
docker compose -f deploy/compose/managed.yml up -d --wait web
docker compose -f deploy/compose/managed.yml up -d --force-recreate api
./deploy/compose/set-task-env.sh   # says: deleted OWNPACE_STAGE
```

**Check:** the app's sign-in page shows no Alpha note, and the Billing page's cards have buttons.

## 2. Walk A orders Small, month by month

Signed in as Walk A's owner, on the Billing page:

1. Fill in the **invoice details** as a consumer. With `MONEYBIRD_DELIVERY` manual, Moneybird mails
   nobody, whatever the invoice address.
2. In *Pick a tier*, press **Pick Small**, read the question, and press **Order with obligation to pay**.

**Check:**
- the page says Small is yours, and *What this month bills* says Small;
- the order's confirmation is in Mailpit, to the signed-in address, with the 14 days to withdraw and
  the request to begin;
- the withdrawal card is there, open.

## 3. The month is invoiced, numbered and downloaded (:23, then :41)

After **:23**, under *Invoices*: one draft for Small, this month, €5.00, with no number and no *Pay*.
After **:41**: the same invoice with Moneybird's number and date, and *Pay*.

**Check:**
- **PDF** downloads Moneybird's document, with the line *Ownpace Small, {month}: het pakket dat u koos*
  (or the English, by the organisation's language) and the Dutch VAT;
- the invoice is in the sandbox administration under the same number, and no mail went out
  (`MONEYBIRD_DELIVERY` manual).

## 4. Paid through Mollie, booked in the books (:41)

Press **Pay**, and on Mollie's test checkout choose a method and the status **Paid**. Mollie sends you
back to the app.

**Check:**
- within a minute the invoice says *Paid*: Mollie confirmed it at `API_URL`;
- after the next **:41**, the invoice in the sandbox is paid, by a payment on the account of *8i* step 4
  under Mollie's payment id.

## 5. Walk A buys a year of Medium

In *A year ahead*, the card says a year would start **next month**: this month is billed. Press **A year
of Medium**, read the question (it says this is a pick of Medium too), and order it.

**Check:**
- the card says the credit left (€72.00) and the months at half price, next month to the same month
  next year;
- the confirmation mail names the year, its months and €72.00, and that it is credit and not refunded;
- at once, the year's invoice, €72.00, as a draft; after **:23**, Medium for this month, €7.00 (the move
  up, at the full price: this month is not one of the year's);
- after **:41**, both numbered. Pay the year as in step 4.

## 6. Walk B buys a year straight from Free (:23, :41)

Signed in as Walk B's owner: invoice details first, then in *A year ahead* a year of **Small**. The card
says it starts **this month**: nothing was billed for it.

**Check:**
- at once, the year's invoice, €30.00, as a draft, and the card says *Credit left: €30.00*;
- after **:23**, **no** invoice for this month: the month was paid from the credit, €2.50, half of
  Small. The card now says *Credit left: €27.50* and that this month is one of the year's;
- after **:41**, the year numbered. Pay it through Mollie, unless you will do step 8.

## 7. Walk A withdraws (within the 14 days)

On Walk A's Billing page, in the withdrawal card, press **Withdraw from contract here** and confirm.

**Check:**
- the organisation is on Free from that moment, and the confirmation mail says so, with the credit
  notes;
- under *Invoices*, a credit note for each invoice of the contract: Small for the days not used,
  Medium's €7.00 for the days not used, and the year **in full** (it had not started);
- after **:41**, the credit notes numbered in the sandbox, and for each invoice paid through Mollie, a
  refund of what was paid above what is owed, booked negative on its credit note under the refund's id;
- the hourly runs after it follow each refund until Mollie says it ended. In test mode a refund usually
  ends *refunded* quickly; nothing reaches *Money to give back*.

## 8. Money owed back by hand (optional)

To see the operator's side, Walk B's year must be paid by bank transfer, so leave it unpaid in step 6.
In the sandbox, register a payment for its whole amount on the year's invoice, by hand, as a transfer
would arrive. After the next **:41** the app shows it paid: the books' read-back. Then withdraw Walk B
in the app.

**Check:** after the next **:41**, the year's credit note numbered, a mail to `NOTIFY_TO` in Mailpit
(*money owed back to a customer*), and the support screen's *Money to give back* listing the credit
note as *paid, but not through Mollie*. Mark it given back there; the mark carries your name and the
time.

## 9. Back into the alpha

```bash
./deploy/compose/env-upsert.sh deploy/compose/.env OWNPACE_STAGE=alpha
./deploy/compose/env-upsert.sh deploy/compose/.env OWNPACE_BILLING_FROM=
GIT_SHA=$(git rev-parse --short HEAD) docker compose -f deploy/compose/managed.yml build web
docker compose -f deploy/compose/managed.yml up -d --wait web
docker compose -f deploy/compose/managed.yml up -d --force-recreate api
./deploy/compose/set-task-env.sh
```

**Check:** the sign-in page shows the Alpha note again, and the next **:23** says nobody is invoiced
during the alpha. What the walk made stays in the sandbox and on the two organisations, which invoice
nothing while the alpha lasts.

## What the walk does not show

- **The email a month before a year's credit runs out** (0111 T11, slice Y3) comes in a year's
  twelfth month, or after a move up that leaves too little for the next month. Nothing in two
  hours gets there; `a-credit-running-out.unit.test.ts` and
  `a-credit-running-out-told-once.unit.test.ts` show it, month by month, on a real database.
- **A month's own invoice e-mailed by Moneybird:** the sandbox sends ten a month, so the walk
  keeps `MONEYBIRD_DELIVERY` manual. Live sends each one (*8i*).

## What to write down

For each step: passed, or what you saw instead, with the time and the invoice or credit note number.
Anything that did not happen on the hour it should have is in the task's run on the Trigger.dev
dashboard and on the operator's log page. Record the walk in workplan 0111's Status, as the proofs of
2026-10-11 were.
