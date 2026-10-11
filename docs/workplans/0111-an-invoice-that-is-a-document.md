# Workplan 0111 — an invoice that is a document

> **In one line:** The invoice as a legal document, numbered and rendered by Moneybird: `billing_party` buyer data, VIES checks in `vat_consultation`, VAT treatment and OSS, the Moneybird adapter and mirror, an immutability trigger, credit notes and VAT-inclusive prices.

## Status — 2026-10-11 (update this block at the end of every session)

**2026-10-11, T10: on erasure the copies go and the numbers stay** (ADR-0044; the owner, 2026-10-03:
*"delete the copy, keep the numbers"*, and 2026-10-11: *"yes, tidy the table and build T10"*). The
purge of an erased organisation (`purgeTenant`, `offboarding.ts`) now deletes each invoice and
credit note the books hold (a `moneybird_id`), credit notes first, and each draft, and keeps their
Moneybird numbers on the erasure record (`erasure_record.invoice_numbers`, managed 0054); an issued
invoice the books do not hold, one from before them, is the only record of itself and is still
detached and kept. Only an erasure deletes an invoice: 0054's trigger holds the service's two roles,
`app_user` and the tasks' system role, to an organisation that is `deleting` and a copy the books
hold or a draft, which also closes the DELETE `app_user` held since 0001 (§"The refusal, designed"
left it to T10). The system role gets DELETE on `invoice` and reads only `kind`, `moneybird_id` and
`invoice_number` besides what it read; still never an amount, a payment or a line, and no SECURITY
DEFINER function. The operator's screen (`/support/retained-invoices`) lists the numbers per
erasure, by its hash, above the invoices the books do not hold (`support_erased_invoice_numbers`).
Privacy 1.5 §9 says it in both languages, for the lawyer's read (workplan 0139). ADR-0044's
*Pending* is folded in.

- **Guards:** `a-copy-deleted-its-number-kept.unit.test.ts` (the purge as the system role: the
  copies the books hold go and their numbers stay, a draft goes, an invoice the books do not hold is
  detached; `app_user` and the system role are refused an invoice of an organisation not being
  erased, and one the books do not hold even then; the owner's connection is not held to it; the
  numbers shown to an operator only); `support-routes.unit.test.ts` (the numbers served by the
  erasure's hash, nothing to a non-operator); the system role's pins in
  `a-system-role-that-is-not-the-owner.integration.test.ts` (its grants, and a real delete
  refused); the support-view list.

**2026-10-11, last: each refund followed to its end** (T7, slice 7d; the owner: *"yes, add the
refund status check"*). Mollie accepting a refund is not Mollie paying it out: it keeps one `queued`
until its balance covers it, then `pending` and `processing`, and only `refunded` means the money
went back; a refund can end `failed` or `canceled` instead. So each hour, before the refunds are
booked, the push reads the payment's refunds for each refund that has not ended
(`refund-follow.ts`, managed 0053) and writes Mollie's word down: `refund_status`, `refund_ended_at`
when it ends, written once. A refund that ended failed or canceled is said to the operator once, for
a transfer by hand within the 14 days, and is not booked in the books if it was not yet (the
message says to take its payment off the credit note if it was). One still going seven days after it
was made, half of the fourteen, is said once (`refund_late_said_at`). One paid out ends quietly, and
is asked after no more. Mollie's calls only, so outside the books' budget, at most 50 refunds per
organisation per run.

- **Guards:** `a-refund-followed-to-its-end.unit.test.ts` (Mollie's word read from the payment's
  refunds; late at seven days and never once ended; Mollie down, a refund not listed, a word not
  known, each said; each new word written once, an end stamped and then nothing moves; the late
  word once; a failed or canceled refund never booked; the database refuses a status without a
  refund, an end without an ending word, and any change to either); `money-back-once.unit.test.ts`
  (the hourly run: a refund failed before the books were told is said once and never booked; one
  still queued a week on is said once, then ends quietly and is asked after no more). The column
  pins list the three columns.

**2026-10-11, later still: Mollie's refund, proved in test mode.** The owner ran
`moneybird-money-back-proof.sh refund` from the OTA checkout with a `test_` key, and paid the test
payment of 12.00 on Mollie's checkout. The refund of 4.00, asked as `createRefund` asks it (the
credit note's reference as the `Idempotency-Key` and in the metadata), answered HTTP 201 with a
refund `re_…` of `{ value: "4.00", currency: "EUR" }`, status `pending`, the reference in its
metadata. The same request again, under the same key, answered HTTP 201 with the same refund:
Mollie made no second. The payment's refunds then listed that one refund for the credit note, which
`creditNoteRefundOf` adopts (only `failed` and `canceled` are passed over). Booked on the credit
note as a payment of -4.00 under the refund id, it answered HTTP 201, and the books held the
invoice paid under Mollie's payment id and the credit note paid under its refund id. Every answer
is one `createRefund` (200 or 201), `listRefunds` and `registerPayment` read as done. The script's
test payment now returns the browser to the stack's own `WEB_URL`, not to the site.

**2026-10-11, later: slice 7d's two Moneybird calls, proved in the owner's sandbox.** The owner
ran `deploy/compose/moneybird-money-back-proof.sh` from the OTA checkout, on a hand-made account as
`MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE`. `register_payment_creditinvoice` on a credit note of 4.00
against an open invoice of 12.00 answered HTTP 200: the books then held the invoice open with 8.00
unpaid and the credit note paid, a payment of 4.00 on the one and of -4.00 on the other, neither
with a transaction identifier. A payment of -4.00 on the credit note of an invoice paid through
Mollie, on that account under a refund id, answered HTTP 201 with the payment as sent: the credit
note paid, the refund id on its payment. Both are answers `registerCreditInvoicePayment` (any 2xx)
and `registerPayment` (200 or 201) take as done, and the read-back (5f) already leaves alone an
invoice its credit notes take off in full, which the books call paid. Mollie's refund itself was
proved after (above): `moneybird-money-back-proof.sh refund` tries it in Mollie's test mode, with a
`test_` key and nothing else: a test payment the owner pays on Mollie's checkout, booked on a
sandbox invoice, a credit note of 4.00, then the refund as `createRefund` asks it (the credit
note's reference as the idempotency key and in the metadata), asked twice to show one refund, and
booked on the credit note under Mollie's refund id.

**2026-10-11: slice 7d, its second half — money back for a credit note** (T7; terms §7: *"whatever
you paid above it we refund within 14 days, by the means of payment you used"*). Once the books
have numbered a credit note, the hourly push makes its amount real, one way, once
(`money-back.ts`, managed 0052): what was paid through Mollie above what is owed now (the total
less every credit note on it) goes back as a Mollie refund of that payment, never more than the
credit note, never more than was paid, less what went back before; then the refund is booked on
the credit note in the books, negative, on `MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE`, under the
refund's id. A credit note with nothing paid above (the invoice unpaid, or paid only what was left
after it, slice 7d's first half) is set against its invoice in the books
(`register_payment_creditinvoice`), and no money moves. One whose invoice was paid by transfer (the
books saw it, slice 5f) is said to the operator once, with the amount, for a transfer by hand.
Never twice: claimed with the push's lease; the refund carries the credit note's reference as
Mollie's idempotency key and in its metadata, and a refund found on the payment with that
reference is adopted, never made again; a credit invoice the books hold paid is written down, not
settled again; and the database writes the outcome once (0052's trigger) and only on a credit note.
The refunds use the API's own `MOLLIE_API_KEY`, which `set-task-env.sh` now hands to the tasks;
unset, a refund waits and each run says so.

- **Guards:** `money-back-for-a-credit-note.unit.test.ts` (what is given back, in five cases and
  three bounds; refunded once with the reference as key and metadata; adopted; waiting without a
  key; settled once; by hand asking nobody; the refund booked negative on Mollie's account, once;
  a second money back refused, and any on an invoice); `money-back-once.unit.test.ts` (the hourly
  run: refunded and booked, then nothing; waiting, said; by hand said once). The column pins and
  the fetch guard list the new columns and `mollie-refunds.ts`.
- **In the owner's sandbox:** Moneybird's two calls here, `register_payment_creditinvoice` on a
  credit invoice crediting part of an open invoice and a negative payment on a credit invoice,
  were proved on 2026-10-11 (above) with `deploy/compose/moneybird-money-back-proof.sh`, which
  makes both from the OTA checkout and prints what Moneybird answered. Mollie's refund was proved
  the same day in test mode (above), with the same script's `refund` and a `test_` key.

**2026-10-11: slice 7e — the yes that asks to begin, without a tick box** (T7; terms §6, §7, 1.5;
the owner: *"i do not want the tickbox, everyone who agrees with the terms would normally start
within 14 days"*). Every yes is given at an order button that says *Order with obligation to pay*
(*Bestelling met betalingsverplichting*), the words of article 8(2): the data ceiling's and
*Start*'s said *Yes, I agree* until now, and only a pick said them. While a yes begins within a
consumer's withdrawal window (on Free, or within the fourteen days; never for a business, nor
after them: `yesAsksToBegin`, read by `GET /api/billing/withdrawal`), one sentence stands beside
the button: *By ordering, you ask us to begin at once, within your 14 days to withdraw. If you then
withdraw, you pay for the part already provided, in proportion to the agreed price, and no more.*
The yes then sends `beginNow`, and the server records it with the yes (`began_on_request`,
managed 0051) when the yes does begin within a window; a page that did not say it asks nothing.
The window reads the request from the yes that concluded the contract, and a withdrawal after it
bills the days used, as slice 7b already prices them. After each order, its confirmation goes by
email to the signed-in address, in the organisation's language (`order_confirmed`): what, at
which price, when; while the fourteen days run, until when and how to withdraw, and the request in
the button's words, or that the days used cost nothing; and the terms' address. A mail that did not
go leaves the order standing and is logged for the operator. Terms 1.5 says §7 this way, in both
languages, and names the withdrawal function by the app's own words; terms precondition C is built.

- **Guards:** `a-yes-that-asks-to-begin.unit.test.ts` (who is asked; the request recorded and read
  from the concluding yes; a withdrawal after it bills three days of thirty-one);
  `an-order-that-asks-to-begin.unit.test.ts` (the three buttons over a real database: recorded for
  a consumer who was told, not for one who was not, never for a business; the confirmation, in
  Dutch and English, with and without the withdrawal; a pick that orders nothing confirms nothing;
  a mail not sent leaves the order); `notifications.unit.test.ts` (the mail, word for word in
  Dutch); `DataCeiling`, `PathsAtStart` and `TierPick` tests (the sentence beside the order button
  and `beginNow` sent only when said; a kept pick asks nothing). Two mutants, both red: the server
  recording the request without `beginNow`, and the window reading any yes's request.
- **The lawyer agreed** (the owner, 2026-10-11: *"Lawyer agreed"*), on the questions in
  terms.md's briefing for 1.5: whether one sentence beside an order button is an express request
  under articles 7(3) and 8(8), and the proportionate amount read pro rata temporis (CJEU
  C-641/19).

**2026-10-11: the owner's answers of the day.**

- **Paid and late, read back (5f):** *"OK on 1 and 2: Ownpace follows Mollie, and Ownpace asks
  every invoice changed since last hour."* (1) A payment Mollie confirms is booked on its invoice
  in Moneybird, on the financial account Mollie pays out from, under Mollie's payment id.
  (2) Every hour, paid and late are read back from Moneybird. The account's id goes in each
  stack's `.env` as `MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE`; *"The .env already contains the ID
  or you ask me to set an ID there"*: no key carried it, so this slice adds that one.
- **Paying for what was used before a withdrawal (T7, slice 7e):** the owner quoted the rule
  (*"kunt u verplicht zijn te betalen voor het reeds geleverde deel, mits de onderneming u
  hierover vooraf correct heeft geïnformeerd"*) and asked how Ownpace keeps anyone from moving
  half the room and then withdrawing all that was paid. The proportionate amount is in principle
  by time (CJEU C-641/19, *PE Digital*), which terms §7 already says and slice 7b already bills,
  once the consumer asked to begin within the fourteen days. On asking: *"i do not want the
  tickbox, everyone who agrees with the terms would normally start within 14 days."* So 7e puts
  the request in one sentence at the order button and in the order's confirmation, not in a
  tick box; terms §7 changes with it (terms 1.5, the owner's and the lawyer's to read). Until 7e
  is built, every withdrawal is credited in full (`docs/ending-the-alpha.md`).

**2026-10-11: slice 5f, its second half — paid and late, read back from the books.** What
Mollie never sees, the books do: a bank transfer, and Moneybird's own judgement that an invoice is
late. Every hour, once every organisation has been pushed, the run asks Moneybird one question
(`books-read-back.ts`): every invoice it changed in the last day and two hours that is late,
reminded or paid, over an explicit period (Moneybird's default is this year alone), a page of 100
at a time, at most 20 pages a run. Each answer names its organisation in our own reference, and is
written in that organisation's scope, forwards only: `late` and `reminded` move a sent invoice to
overdue; `paid` moves a sent or overdue one to paid, on Moneybird's day, noting that the books
hold it, so the first half never books it again. A credit note, another administration's
invoice, one without our reference (a proof, the nightly's) and one its credit notes take off in
full are left alone: Moneybird calls that settled, and nobody paid it. Asked about a day every
hour, a change is seen within the hour, and a night the worker did not run is caught up the next
morning, with nothing kept between runs.

- **Guards:** `paid-and-late-read-back.unit.test.ts` (the question asked, its pages and when
  more waits; the organisation from the reference only; overdue and paid, once each, on the
  books' day; never backwards, never a credit note, another administration's or another
  organisation's; credited in full left, credited in part paid);
  `paid-and-late-read-back-hourly.unit.test.ts` (one question per run, each change in its own
  scope, the next hour moving nothing; Moneybird unavailable said and nothing read). Two
  mutants, both red: the credited-in-full guard, and the invoices-only condition on late.

**2026-10-11: slice 5f, its first half — a payment through Mollie, booked in the books.** When
Mollie's webhook moves an invoice to paid, it now notes what Mollie took (`paid_cents`, managed
0050: after a credit note decided before the payment, less than the total). Each hour, after an
organisation's documents, the push books each such payment on its invoice in Moneybird
(`payment-book.ts`): on `MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE`, under Mollie's payment id, for
what Mollie took, on the day it was paid, and writes down when the books held it
(`moneybird_paid_at`). Once, whatever happens between: the invoice is claimed by the push's lease,
and read first; a payment there already under Mollie's id, or the invoice paid in the books by
other means, is written down as held and never booked again. Unset, nothing is booked, and the
run says so. `operator.sh moneybird check` lists the administration's financial accounts with
their ids, and fails when the account set is not there or not active. The second half is the
hourly read-back of paid and late.

- **Guards:** `a-payment-booked-in-the-books.unit.test.ts` (claimed once, never a credit note, a
  bank payment or another organisation's; booked with the account, Mollie's id, the cents and
  the day; held when booked before or paid in the books; another administration refused before
  anything is asked; written once); `a-payment-booked-once.unit.test.ts` (the hourly run books
  once, then asks nothing; nothing without the account; a refusal said and tried again);
  `what-mollie-took.unit.test.ts`; `moneybird-check.unit.test.ts`; `moneybird-config.unit.test.ts`;
  the column pins in `invoice-refusal-under-rls.unit.test.ts`. Three mutants, all red: the
  booked-before check, the account guard, the claim's lease.

**2026-10-11: slice 7d, its first half — nothing paid that was credited.** An invoice a
withdrawal credits may not have been paid yet. The pay route now asks Mollie for its total less
what its credit notes take off (`creditedCents`, credit-note.ts: every credit note recorded for
it that is not void, issued or still a draft, since a credit decided is a credit owed), and
refuses with 409, asking Mollie nothing, when nothing is left. The invoice list returns the same
amount per row (`credited`), so the Billing page offers *Pay* only on what is left and says
*Credited in full: nothing left to pay.* / *Volledig gecrediteerd: er is niets meer te betalen.*,
or *€4.00 credited; €8.00 left to pay.* The second half is the money back for an invoice already
paid: a refund through Mollie under the credit note's reference as its idempotency key (the
client takes one, `@mollie/api-client` 4.6), and an unpaid one settled against its credit note
in the books (`register_payment_creditinvoice`, read from Moneybird's own description); a
payment that did not come through Mollie is said to the operator for a transfer by hand.

- **Guards:** `a-draft-is-not-paid.unit.test.ts` (credited in full: 409 and Mollie asked
  nothing; credited 400 of 1200 by a credit note still a draft: Mollie asked for 800);
  `Billing.unit.test.tsx` (no *Pay* and the sentence on an invoice credited in full; *Pay* and
  what is left on one credited in part). Four mutants, all red: the refusal, the amount, a draft
  credit not counted, *Pay* on a credited invoice.

**2026-10-11: slice 7c — the withdrawal function on the Billing page** (T7; 0152 T6 (f); terms
§7). While a consumer may withdraw (`GET /api/billing/withdrawal` open), the Billing page shows a
card above the invoices: the last day, and the button in article 11a's words, *Withdraw from
contract here* / *Hier de overeenkomst herroepen* (the owner, 2026-10-05). It opens the second
step, with the focus on it: the name (filled in from the invoice details), the contract said
(*Ownpace Small, concluded on October 1, 2026*), the address the confirmation goes to (filled in
from the signed-in address), and *Confirm withdrawal* / *Herroeping bevestigen*. Then the card
says when it was withdrawn, that the organisation is on Free, and where the confirmation went, or
that it could not be sent and goes by hand; the tier, the pace, the picks and the invoices are
read again. A refusal is said in the server's words, and the form stays. On Free, for a business
and after the fourteen days, there is no card. The invoice list says a credit note as one
(*Credit note 2026-0008* / *Creditnota*), offers its document, and never *Pay*.

- **Guards:** `Withdrawal.unit.test.tsx` (the last day and the button; the second step with the
  focus on it, the name, the contract and the address; what was confirmed sent, trimmed, and what
  followed said; a mail not sent, in Dutch; a refusal in the server's words; no card when closed);
  `Billing.unit.test.tsx` (a credit note named as one, with its document and no *Pay*). Four
  mutants, all red: *Pay* on a credit note, the card when closed, the focus, the name trimmed.
- **Walked in a real browser, the same day, and one fault found.** The card kept what was
  withdrawn in its own state, and the card is drawn anew whenever the Billing page draws itself as
  loading: a usage read that had failed and is tried again after the withdrawal does that. Coming
  back from another page draws it anew too. Either way the sentence was gone, and the card
  offered the button again from the open window the app keeps for five minutes. Now what was
  withdrawn is kept in the query cache, per organisation, and the window is read again with the
  rest. Guards in `Billing.unit.test.tsx`: the sentence stays after a failed read is tried again;
  the button is not offered to someone who comes back; and another organisation is not told it
  withdrew. All three were red on the card as it was, and the last one also fails with the
  organisation dropped from the key.

**2026-10-11: slice 7b — the withdrawal, back to Free** (T7; decision 15; terms §7). A consumer
withdraws from the paid contract through `POST /api/billing/withdrawal`, the second step of the
withdrawal function (article 11a of the Consumer Rights Directive): the name and the address the
person confirmed. The contract is the paid one, concluded by the first yes after Free (each yes,
at the data ceiling, at *Start* or by a pick above the agreed tier, is a `data_allowance` row);
it may be withdrawn from until the end of the fourteenth day after the day it was concluded,
moved past a Saturday or Sunday to the end of the Monday, in UTC days, which end later than
Dutch ones. A business has no right of withdrawal; an organisation without invoice details is
treated as a consumer. `withdraw` (`withdrawal.ts`) runs in one transaction, under the locks a yes
and a month's invoice take: an append-only `contract_withdrawal` row (managed 0049: the name, the
address, the contract's start and tier, the language, whether we were asked to begin early), and
a credit note for each invoice of the contract (slice 7a), for the days it paid for and were not
used, in the organisation's language. From that moment every reader of the tier reads Free: the
two stores everything reads the tier through count only the yeses and picks after the latest
withdrawal (`since-a-withdrawal.ts`), so the Billing page, the month's invoice (nothing more this
month, nothing next), the pace and the tick all follow, and a yes after it counts again as a new
contract. After the commit the acknowledgement goes to the address given, in the organisation's
language (`contract_withdrawn`): what was sent and when, that the organisation is on Free with its
account and migrations, that what was invoiced is credited, and the refund within 14 days. A mail
that does not go leaves the withdrawal standing, is said in the answer, and is logged for the
operator to send by hand.

**The days used are not billed yet, on purpose.** Terms §7 bills them only when the consumer asked
us to begin before the fourteen days were over, and article 14(4)(a)(ii) of the directive lets a
consumer who did not ask bear no cost. No yes asks that yet, so every invoice of a withdrawn
contract is credited in full, and `began_on_request` is recorded false. The proportion is built
and tested (`creditShare`: the days from the step to the end of its month, the day of the
withdrawal counted as used) and comes alive with the yes that asks (slice 7e). Terms §7 says the
app asks *"before your first migration starts"*; with Free first, the paid contract begins at a
yes, which is where the question belongs. The wording is the owner's and the lawyer's to settle.

- **Guards:** `withdrawal.unit.test.ts` (the fourteen days, a Saturday's and a Sunday's moved to
  the Monday; open for a consumer at the highest tier said yes to, and for an organisation without
  details; closed on Free, for a business, and after; the share in full without a request, and the
  days not used with one, a move up's from its day; the words in both languages, without `Intl`);
  `a-withdrawal-back-to-free.unit.test.ts` (PGlite: recorded with what was given, the month
  credited in full in Dutch, Free from then on for the tier the month bills, the month's invoice
  this month and next, and the window; a second withdrawal closed and nothing written; a yes after
  it a new contract with its own fourteen days; a business and a late consumer closed; a pick
  above the agreed tier no floor after it; the row neither changed nor removed by the app; the
  system role reads when, never the name or the address); `a-withdrawal-from-the-billing-page.unit.test.ts` (the routes: open with what the form
  fills in; a missing name or a bad address refused; recorded, credited and told in the
  organisation's language; closed after, with a sentence; a mail that failed leaves it standing);
  `notifications.unit.test.ts` (the acknowledgement, word for word in Dutch, and in English with
  the days used billed; nothing invoiced; no "open the app"). The spec documents both routes, the
  purge deletes the rows, and the system role's grant is pinned. Each arm proved by breaking it
  once: nine mutants (both stores' filter, the weekend, a business, the past, the request to begin,
  the mail, the system role's columns, the app's UPDATE and DELETE), all red.

**2026-10-11: slice 7a — a credit note, as a document** (T7, the document's half; the owner,
2026-10-11: *"Credit notes and the withdrawal button (T7): go ahead"*). A credit note is our row
first (`credit-note.ts`): a draft, `kind = 'credit_note'`, naming the invoice it corrects, under
the invoice's reference with `-c-` for `-m-`, so an invoice has one credit note at the most and
recording it twice records it once. It says what share it credits (`numerator` of `denominator`:
for a withdrawal, the days not used of the days paid for) and why, and its words name the
invoice by `{invoice}`. The hourly push takes it after the drafts, once the invoice it corrects
is numbered, with the same lease, pace and budget (`managed-invoice-push.ts`), and
`moneybird-credit-push.ts` makes it Moneybird's own credit invoice:
`duplicate_creditinvoice` copies the invoice (so the books link the two), the copy's id is written
onto our row before anything else is done with it, the copy is filled with one line, the share
of the invoice's lines as issued, at minus, rounded once, at the invoice's rate, naming its
number and, for a reverse charge, its VIES evidence again; checked; sent like an invoice; read
back; and written back `sent`, negative, numbered. The copy takes no reference, so before it
asks for one the push looks for the id it wrote down, for ours by reference, and for a draft of
the buyer's against the same invoice that a dead run left, which it adopts; two such drafts are
refused by name. A credit note is not paid: the pay route refuses it before Mollie is asked
anything. Moneybird's calls were read from its own OpenAPI description
(`github.com/moneybird/openapi`, `openapi.json`, 2026-10-11), which is reachable from here, unlike
developer.moneybird.com. Two things the description does not settle are said in the code: whether
the list's `period` (the invoice date) matches a draft, which the search for a lost copy relies on,
and how the copy's lines look; the first credit note on the OTA stack is their check. Nothing
records a credit note yet: the withdrawal (slice 7b) is its first writer.

- **Guards:** `moneybird-credit-push.unit.test.ts` (the order: looked for, copied, written down,
  then filled, sent and read back; the fill's one line and rate; a second run sends nothing, by
  the id written down or by reference; a run that died after the copy finds it again, one credit
  invoice in all; two lost copies, or one under another reference, refused; a total that is not
  the credit not sent; a copy of another invoice neither written down nor filled; a 429; a share
  of nothing asks nothing); `a-credit-note-for-an-issued-invoice.unit.test.ts` (PGlite: recorded
  once, under `-c-`; a void invoice, a credit note, another organisation's invoice and a share of
  nothing refused; claimed only once its invoice is numbered, by one push; the id written once and
  never another; written back negative and then frozen by 0045's trigger; another administration
  refused; said behind after two days); `a-credit-note-pushed-once.unit.test.ts` (the hourly run
  numbers the invoice and then its credit note, and the next run asks nothing; another
  administration's invoice refused without a request); `a-draft-is-not-paid.unit.test.ts` (a
  credit note: 409, and Mollie asked nothing). Each arm proved by breaking it once: eight mutants,
  all red. The fetch guard counts the new client's four calls.

**2026-10-10: slice 6 — Moneybird's PDF in the app** (T6). An invoice Moneybird has numbered
offers *Download the invoice* / *Factuur downloaden* on the Billing page, and the file is the
books' own document, named `Ownpace-invoice-{number}.pdf`: `GET
/api/billing/invoices/:id/pdf` reads the row in the organisation's own scope, asks Moneybird for
its PDF by the invoice's Moneybird id, and hands it on with `Cache-Control: private, no-store`,
keeping no copy (`moneybird-documents.ts`). `download_pdf` answers with a redirect to a link that
lives about thirty seconds; the redirect is read and the link fetched bare, over HTTPS only, so the
token goes to Moneybird's API and nowhere else. What is not a PDF, or is over 10 MB, is not handed
on. A draft has no document and is refused by name (`no_document_yet`), as is an invoice whose
books are not the ones configured, or one Moneybird does not hand over (`document_unavailable`,
with a sentence to act on); a failed download says why beside the button, in the server's words,
which arrive as bytes and are read back. The redirect's shape was read from Moneybird's API as
mirrored; the first download on the OTA stack is its check.

- **Guards:** `moneybird-documents.unit.test.ts` (the redirect read and the link fetched without
  the token; a document served straight away; plain HTTP, not a PDF and over 10 MB refused; 404,
  401, 500 and 429 each said); `an-invoice-document-from-the-books.unit.test.ts` (on PGlite with
  every migration: the PDF handed on under its number, uncached; a draft refused and Moneybird asked
  nothing; another organisation's invoice not found; Moneybird off, or other books, said in a
  sentence; a document not handed over is a sentence, never a broken file); `Billing.unit.test.tsx`
  (the file saved under the server's name; the failure beside the button; no button on a draft);
  `billing-service.unit.test.ts` (a refusal that arrived as bytes read back to its sentence). The
  spec says the route; the fetch guard counts the new client.

**2026-10-10: slice 5d — the nightly's sandbox invoice** (decision 12, the nightly's half).
`operator.sh moneybird nightly`, run by the managed nightly gate (`smoke-managed.sh`, before the
verdict), makes one invoice a night the whole way round (`moneybird-nightly.ts`): under
`ownpace-nightly-{YYYY-MM-DD}`, to the proof contact without an e-mail address, sent by hand, paid
by a registered payment for what is still to pay (`registerPayment`, `POST
sales_invoices/{id}/payments`, which replaced `register_payment`), and read back as `paid`. It
counts the month's invoices first, a page of 100 at a time since Moneybird gives no total
(`countSalesInvoicesThisMonth`, `filter=period:this_month,state:all`), and from 40 of the
sandbox's 50 it makes none and says so. A second run the same night finds the invoice and pays
nothing twice. It refuses live and e-mail delivery as the proof does; with Moneybird off it skips,
and the gate lists the books as not proven rather than failing, until the owner gives the nightly
stack the sandbox's keys. The payment and list endpoints were read from Moneybird's API as
mirrored, not from its own pages, which this environment could not reach: the first night with
keys is their check.

- **Guards:** `moneybird-nightly.unit.test.ts` (with a sandbox of its own: live and e-mail delivery
  refuse before a request; off skips and passes; from 40 the night makes none, after one list
  request; the count goes page by page and stops where asked; the night's invoice is made to a
  contact without an e-mail address, sent `Manual`, paid `1.00` on the night's date and read back
  as paid; a second run writes nothing; a refused payment and an invoice that stays `open` fail the
  night; the token in no line). The fetch guard counts the adapter's two new requests.

**2026-10-10: slice 5c — `operator.sh moneybird proof`** (decision 12, the operator's half). One
invoice a month, made by hand to prove the books: it goes through `pushInvoice` the way the hourly
push does, under the reference `ownpace-proof-{YYYY-MM}`, to Ownpace's own proof contact
(`customer_id` `ownpace-proof`, which no organisation's `ownpace-{uuid}` can take, and no e-mail
address), at €1.00 with domestic VAT, sent by hand, and prints the number, date and total
Moneybird gave it (`moneybird-proof.ts`). Run again that month, it answers that the invoice exists
and asks Moneybird to write nothing, so a repeated command spends nothing of the sandbox's 50 a
month. Before asking Moneybird anything it refuses a stack that runs `NODE_ENV=production`, as
live does, one that names no `NODE_ENV`, e-mail delivery, and Moneybird off or half set. The
bring-up guide says when to run it.

- **Guards:** `moneybird-proof.unit.test.ts` (with a sandbox of its own: each refusal asks
  nothing; the month's proof is made to a contact without an e-mail address, sent `Manual`, and
  says its number; again that month it exists and nothing is written; the next month is a new
  proof; a draft that does not add up is said and not sent; a 429 stops it; the token in no line).
- **Not yet:** the nightly sandbox invoice (5d, above); reading back `paid` and `late` for the
  organisations' own invoices (5f).

**2026-10-10: slice 5e — an invoice address, and invoice details before a paid tier** (decisions
11 and 14). Managed 0048 adds `billing_party.invoice_email`, checked loosely by the column and by
the route alike (one `@` with something on either side: whether the mailbox exists is the
delivery's to find out), and purged with the rest of the row. The Invoice details card asks for it
as *Invoice e-mail address* / *E-mailadres voor facturen*, required, prefilled with the address
the person signed in with until details are saved, and says it may be the bookkeeping's. The push
hands it to Moneybird's contact when Moneybird is to e-mail the invoice, and only then: under
`Manual`, on the sandbox and the OTA stack, a tester's address stays out of the books. The three
doors a paid tier is agreed through (the yes at the data ceiling, the yes at *Start*, a pick of a
paid tier) refuse with 409 `invoice_details_first` while there are no invoice details, inside the
yes's own lock and before anything is recorded; a pick of Free charges nothing and is not asked,
and the Alpha's refusal still comes first. Each door says so in the page's language, with *Add
your invoice details* linking to `/billing#invoice-details`. The card brings itself into view
and focus to its heading, from another page and from the Billing page alike, once every read on
the page has answered, since the cards above it load after it is drawn and would push it back
down. The OpenAPI spec says the field and the refusal.

- **Guards:** `a-yes-that-asks-for-invoice-details-first.unit.test.ts` (on PGlite with every
  migration: each door refuses and records nothing; Free is not asked; an address that is not one
  is refused by the route and by the column's check; the details and the address are stored and
  served back, the pick is then taken, and empty clears the address); the three yes tests seed
  invoice details; `a-draft-numbered-by-the-books.unit.test.ts` (the address handed over for
  e-mail delivery, kept out under `Manual`); `Billing.unit.test.tsx` (prefilled with the
  signed-in address and sent; a stored address seeds the field; opened at the anchor, nothing
  moves while a read above is held open, then the card is scrolled to once and its heading has
  focus; without the anchor nothing moves); `TierPick.unit.test.tsx` (the refusal in English and
  Dutch, with its link).

**2026-10-10: slice 5b — the Billing page names an invoice by its number.** Once Moneybird has
numbered it, an invoice is *Invoice 2026-0001*, with *Invoice date: October 1, 2026 · due date:
October 15, 2026* under its period (`GET /api/billing/invoices` serves the number and the date; the
days are read in UTC, so the day is the one written wherever the browser is). A draft is *Being
prepared* / *Wordt opgemaakt* (the chip's word for `draft`, the glossary's too) and has no Pay
button: the API refuses to pay a draft since slice 3, and the page no longer offers it. An invoice
from before the books keeps its id.

- **Guards:** `Billing.unit.test.tsx` (an issued invoice by its number, with both dates and Pay; a
  draft *Being prepared*, without an id, dates or Pay).

**2026-10-06, later: slice 5a — each draft numbered by Moneybird.** `managed-invoice-push`, hourly
at :41, takes each active organisation's drafts to the books and writes back what Moneybird made
of them (`invoice-push.ts`). A push claims its draft first, for one attempt, in an update only one
claim can win (managed 0047, `push_lease_until`), so one writer talks to Moneybird about a draft at
a time. What is sent is decided before Moneybird is asked anything: no invoice details is refused
by name, and so is e-mail delivery while there is no invoice address (decision 11); the treatment
comes from the buyer's details and the latest VIES answer for the number as stored
(`vat-standing.ts`, moved from the API so the task reads it too); a consumer is addressed by their
full name, a business by its name and VAT number, and a reverse-charge line ends with *Btw verlegd
/ VAT reverse charged. VIES {number}, {date}* (decision 10). In the update that issues it, the row
takes Moneybird's number, date, due date and ids, the treatment, the rate (a fraction, as the
column has held it), the lines as invoiced and the totals (in cents, as every invoice row holds
them: the pay route asks Mollie for `total` in cents), and gives its lease back. At most 60 a run, one every 25 seconds, under
Moneybird's 150 requests in 5 minutes; a 429 stops the run. Off as the month task is, and while no
`MONEYBIRD_*` key reaches the tasks; `set-task-env.sh` uploads them, and `OWNPACE_SELLER_COUNTRY`
and `VAT_OSS_ACTIVE`, and deletes each one emptied. Decision 6's alert is here: an organisation
with a draft still a draft two days after it was made is said as an error, by reference, every run.

- **Guards:** `a-draft-numbered-by-the-books.unit.test.ts` (the plan: refusals, consumer and
  business, VIES's evidence with and without a consultation number, an invalid number charged like
  a consumer; on PGlite as `app_user`: claimed once while the lease holds, proved by taking the
  lease out of the claim, which turns that case red, and again after it runs out; never once
  issued, never from another organisation's scope; the write-back once; a draft behind after two
  days); `a-draft-pushed-once.unit.test.ts` (the run's half with a Moneybird of
  its own: a consumer's draft numbered and written back, the next run asking Moneybird nothing; a
  reverse-charge draft at €9,92 with its evidence; no details asks nothing and is said, with the
  alert; a 429 stops the run). The column pin knows `push_lease_until` (lifecycle) and the grant
  pin the two columns 0047 grants. The split-job guard has six, the task count seventeen, and the
  runbook's switch table a row for the push.
- **Not yet:** the Billing page showing the legal number and paying only an issued invoice (5b, above);
  reading back `paid` and `late`; the invoice e-mail address and invoice details before leaving
  Free (decisions 11 and 14: slice 5e, above); `operator.sh moneybird proof` and the nightly sandbox invoice
  (decision 12).

**2026-10-06: slice 4b — each month invoiced in advance.** `managed-month-invoices`, hourly at
:23, keeps each active organisation's month in step with what it bills (`readBilledNow`, the
rule the Billing page reads): on the month's first day a draft for the tier it starts on, and
after a move up a draft for the difference, each under `ownpace-{organisation}-m-{YYYY-MM}-{tier}`
(`month-invoice.ts`). It trues the month's peak up first, since the invoice is the moment that
prices; it prices a tier at the latest yes or pick naming it, else at the list's price; Free
makes no row, a second run none, and a voided step is never made again. Each draft carries the
evidence its line quotes and the line in the organisation's language (`month-invoice-words.ts`,
decision 8): *Ownpace Medium, oktober 2026: 12 migraties tegelijk op 3 oktober*. It is a split
job (0138 T2): the list of active organisations on the system role, everything else in each
organisation's scope as `app_user`, so no grant changes. It is off while `OWNPACE_BILLING_FROM`
is empty (decision 7), during the Alpha, and before that month; `set-task-env.sh` uploads the
switch and deletes it when empty ([ending-the-alpha.md](../ending-the-alpha.md) says when to
set it). Two cases decision 8 has no words for are written and put to the owner: the month
billing the tier agreed to while what was used went past it, and a difference step. Nothing
numbers or sends a draft yet: slice 5.

- **Guards:** `a-month-invoiced-in-advance.unit.test.ts` (the rule, the price, the reference; on
  PGlite as `app_user`: Free makes nothing; the first day's draft carries its evidence and Dutch
  line; a second run makes nothing; a move up makes the difference, adding up to Medium; the next
  month opens whole; a standing fleet's peak is trued up, proved by removing the true-up, which
  takes the day off the line and turns the case red; a pick says the pick, at its price; and
  another organisation's month is neither read nor written); `month-invoice-words.unit.test.ts` (both languages; an amount never printed
  on or under the ceiling below); `billing-from.unit.test.ts`;
  `a-month-invoiced-in-its-own-words.unit.test.ts` (the switch before anything about anybody;
  the organisation's language, English where it names none). The job is on the split-job guard
  (`a-pass-that-opened-the-owners-pool`, five jobs), the task count
  (`a-run-that-kept-a-testers-words`, sixteen), the upload guard
  (`a-knob-the-tasks-can-never-see`) and the runbook's switch table
  (`the-end-of-the-alpha-names-every-switch`).
- **Not yet, and said:** a move up in the hour before a close is not invoiced, since a closed
  organisation is no longer visited (in the customer's favour; decision 13). Decision 6's alert
  for a month two days behind belongs with slice 5, which knows what is issued.

**2026-10-05, late: slice 4a — the retired generator goes.** Slice 4 is split in two. This half
removes what the month's invoice replaces: the metered generator (`invoice-generation.ts`), the
`POST /invoices/generate` route that refused with a 409 since 0109 T0, the refusal's module and
its trip-wire, and the route's OpenAPI entry. Managed 0046 drops the (tenant_id, period_start)
key, so a month invoiced in advance can carry one invoice per step up, kept apart by their
references (0045). Managed retention now clamps each organisation to its newest issued invoice
for a month that is OVER, since an invoice made in advance names a month still running. The
guards that read the generator's text (`a-month-billed-as-one-pass`,
`a-screen-that-quoted-a-retired-price`, `a-rate-that-must-not-spread`) lose the cases about it.
Slice 4b is the month task itself.

- **Guards:** `invoice-refusal-under-rls.unit.test.ts` (a month with two invoices under two
  references, proved by running it without 0046: a duplicate key on the old constraint);
  the integration tests (the old door is no route, three calls write nothing, and a paid invoice
  on the books is untouched; an admin passes the role guard on the pay route).

**2026-10-05, night: slice 3 is built — the mirror and its refusal** (managed 0045). The invoice
row gains our reference (unique), its kind and the invoice a credit note corrects, the evidence
its line quotes, the treatment, rate and lines the push writes while it is a draft, and Moneybird's
administration, id, legal number and date, written once at issue. 0014's trigger learns them:
draft → sent needs Moneybird's number and id; Moneybird's facts never change once written; a row
is born without a number; past draft every column the document is made of is frozen, the new ones
included. A check keeps Moneybird's facts together, a draft unnumbered, and a pushed row carrying
our reference. The pay route no longer issues a draft by asking for money: it refuses a draft with
409 before Mollie is asked anything, leaves an issued invoice `sent` for the webhook, and adds to
the metadata instead of replacing it. Not yet: the (tenant_id, period_start) key goes with the
retired generator in slice 4, and that a row is born a draft is left to its writers (fixtures
insert issued rows).

- **Guards:** `invoice-refusal-under-rls.unit.test.ts` (draft → sent without a number refused, by
  name; the number written once, even by the owner; a draft carries no number; the new columns
  frozen past draft; a row born with a number refused; one reference per row; a credit note names
  its invoice; and the column pin: every column of the table in exactly one class, and every
  column an issued invoice is made of in the trigger's freeze — proved by taking `lines` out, which
  turns two cases red); `a-draft-is-not-paid.unit.test.ts` (the pay route over PGlite: a draft is
  refused and Mollie asked nothing — without the refusal it answers 200 and asks Mollie for money;
  an issued invoice is paid once, for its total, stays `sent`, and keeps its metadata).

**2026-10-05, night: slice 2 is built — the adapter, complete, proved with stubs.** One request
layer for every Moneybird call (`moneybird-http.ts`), with a 429 as its own outcome, `slow_down`,
carrying `Retry-After`. Every create states the workflow and whether prices include VAT. An
invoice under our reference for another contact is refused, never adopted. A contact that says
something else is brought in step, because a reverse-charge invoice without the buyer's VAT number
is not one. A send happens only from `draft`, with no default delivery, and totals are read in
whole cents; a figure finer than a cent is refused, never rounded. `line-price.ts` holds the money:
reverse charge and outside-EU take the Dutch VAT out at the administration's own rate (decision 9:
Medium €12,00 → €9,92). `pushInvoice` (`moneybird-push.ts`) runs rate, contact, invoice by
reference, a check of the draft's total against its lines, the send and the read back; a second run
sends nothing and answers `issued`, adopted. Nothing calls it yet: slice 5's task will. Decision
10's VIES words belong to the line text, which the caller builds (slices 4 and 5).

- **Guards:** `moneybird-sales-invoices.unit.test.ts` (another contact refused; the workflow and the
  VAT setting stated even when false; a send of anything but a draft makes no request; a contact
  brought in step, only what differs); `line-price.unit.test.ts` (the four agreed reverse-charge
  prices, from the tier table; integers only; a sub-cent figure refused); `moneybird-push.unit.test.ts`
  (a second run sends nothing; a draft that disagrees is never sent; a missing rate refuses before
  anything is made; a 429 stops the push); `moneybird-http.unit.test.ts`.

**2026-10-05, night: slice 1 is built — the configuration, and a check that reads.**
`moneybird-config.ts` reads `MONEYBIRD_*` as off, on, or refused by key name; ids stay strings of
digits. `moneybird-http.ts` is the one read the two lists go through, and `moneybird-workflows.ts`
reads the workflows and refuses a missing, estimate or archived one by name.
`./deploy/compose/operator.sh moneybird check` makes two reads, one more than planned: the
workflow id is required, and only the API lists it. It prints each rate and workflow with its id,
what each treatment resolves to, and whether the workflow's prices include VAT, and exits 1 while
something is named. With only the token and the administration set, it lists the ids to pick
from, which is how the sandbox's workflow id is found. Compose passes the keys optional, the
example lists them, and the API warns at start on half a set
([managed-bring-up.md](../managed-bring-up.md), *8i. The books and payments*).

- **Guards:** `moneybird-config.unit.test.ts` (off with the example's empty keys; an 18-digit id
  kept exact, where `Number` would make it another id; half a set named by keys, never values);
  `moneybird-http.unit.test.ts`; `moneybird-workflows.unit.test.ts`; `moneybird-check.unit.test.ts`
  (off asks nothing; on makes exactly the two reads; outside-EU refused by name without failing;
  no line carries the token); the sandbox's reverse-charge row in
  `moneybird-tax-rates.unit.test.ts`; `config-guards.unit.test.ts`; the fixed-host guard counts
  `moneybird-workflows.ts`.
- **Still to see:** the check on the OTA stack, once the owner has set the keys there: the
  sandbox's rates, domestic and reverse charge resolved, outside-EU refused by name, and the
  Ownpace sandbox workflow named with its prices including VAT.

**2026-10-05, evening: the owner answered decisions 6 to 15.** Eight are taken as recommended
(*"ok"*), two of them with a question answered below, and so are the four defaults (*"Yes,
good."*). One is changed and one widened:

- **6, in advance** (*"no, please invoice in advance of the month"*). What a month bills does
  not change: its peak, or a higher tier picked, never past a yes (ADR-0014). When it is
  invoiced does. A month is invoiced on its first day (UTC), at the tier it starts on. If it
  moves up during the month (a yes, a pick, or more at the same time within a tier already
  agreed), the difference is invoiced within a day. So a month's invoices always add up to what
  it bills, and nothing is settled after it. Free makes none, and leaving Free is a move up.
  The terms said *monthly in arrears* (§8) and relied on it in §7; both now say in advance, in
  both languages, for the owner's reading (question 29 of their briefing). Three things follow
  for the build: references gain the tier (`ownpace-{organisation}-m-{YYYY-MM}-{tier}`, one per
  step); managed retention, which reads the newest issued invoice's `period_end`, must read only
  months that are over; and the alert is for a month whose invoices are two days behind what it
  bills, no longer for one unsent on the 10th.
- **7** (*"ok, so first we leave this empty, and no one gat an invoice?"*): yes. While
  `OWNPACE_BILLING_FROM` is empty, nobody is invoiced, whatever runs. Set at the switch, the first
  invoices are made on the first day of that month.
- **11** (*"will it send invoice from ownpace.eu address or something from moneybird?"*):
  Moneybird sends it, from its own servers. By default the sender is an address Moneybird makes
  from the administration's verified sender address, at `deliver.moneybird.com`. With Moneybird's
  own-domain setting, one NS record that hands a subdomain of ownpace.eu to Moneybird, which
  serves the SPF and DKIM records there, the customer sees only the ownpace.eu address. This is a
  step for live's administration before charging starts. (Moneybird's help center, articles
  207868 and 620556, and an NS-record article, as search results showed them on 2026-10-05;
  the help center itself cannot be reached from here, so check the steps in Moneybird's settings
  when doing them.)
- **12, widened** (*"can we do some kind of smoke test in the nightly, like adding an invoice,
  paying it, but not sending out the invoice (skipping the limit of 10?)"*): yes. The nightly
  managed run makes one invoice in the sandbox. Its contact has no e-mail address, it is sent with
  delivery `Manual` (it gets its number and no e-mail goes out, so the limit of 10 stays
  untouched), a payment is registered for its total, and it is read back as `paid`. One a night
  is about 31 of the sandbox's 50 a month, so the lane counts the month's invoices first and,
  past 40, skips and says so. No per-PR check makes an invoice. Built with slice 5.
- **8, 9, 10, 13, 14, 15**: as recommended. With 6, decision 13 reads: the closing month was
  invoiced at its start, a move up before the close is invoiced like any other, and nothing
  after the close. Decision 15's credit note takes the unused days off the month's invoice,
  which, invoiced in advance, always exists.

So no slice waits on a decision any more. Slice 1 (the configuration and the check) is in
progress.

**2026-10-05, later: the build, sliced.** Read against the code: the adapter's core seam
(`moneybird-sales-invoices.ts`), the tax-rate resolver, the VAT treatment, the VIES log, the tier
evidence (`currentTier`, `billedTierOf`, `pickedFloorOf`, `readBilledNow`) and migration 0014's
refusal all exist and have tests, and **nothing calls them**. No `MONEYBIRD_*` key is read
anywhere, nothing closes a month, and the only invoice writer is the retired metered generator
behind the 409. §"The build, sliced" below is the order, seven PR-sized slices; the first three
need no owner decision. The ten questions they raise are open decisions 6 to 15. One finding
already settled: the reverse-charge rate's `percentage: null` is parsed and accepted
(`moneybird-tax-rates.ts:100-104`), and only a test of the wire row is missing.

**2026-10-05: the foreign-VAT test passed, in a Moneybird sandbox administration, and T4's
wiring is no longer gated on the owner.** Moneybird offers sandbox administrations for building
against its API: free, every feature, a watermark on every PDF, at most 50 invoices and 10
e-mails a month. So the build and the OTA stack use a sandbox, and the real administration is
live's: its token, its rate ids and its subscription come when charging starts. The owner ran the
test there:
- a German consumer invoice at 19%, on a rate added through Moneybird's *Unieregeling* (OSS)
  route, which the API returns with `country: "DE"`, appears nowhere in the Dutch btw-aangifte;
- the btw-overzicht lists it on its own, under the Unieregeling, with its base and VAT: the
  figures an OSS return is filed from, at the Belastingdienst's portal;
- a 21% control invoice to a Dutch buyer in the same quarter lands in rubriek 1a, so the sandbox
  computes the return and the German line's absence is the route working.

So the risk recorded on 2026-08-28 (§"What the Moneybird API actually gives us") is closed:
OSS-era invoicing can live in Moneybird. One fact for T3's resolver: a fresh administration ships
no reverse-charge sales rate, and *Dienst binnen EU (btw verlegd)* (NL/3b, a service, not
*Product binnen EU*) is added for `MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE`. The outside-EU rate stays
unset, so a non-EU buyer is refused as designed until the accountant confirms the rate.

**2026-08-30:** two artefacts for the gated tail. T5/T7's immutability mechanism is now
**designed** — §"The refusal, designed" below: a state-conditional trigger plus narrowed
column grants, shaped around the three writers the code actually has (one of which can
rewrite a *sent* invoice's amounts today). And the consumer-terms draft for the lawyer is
open as PR #661 — open decision 5's artefact, so the sign-off conversation starts from a
document instead of a blank page. **Later the same day: the entity is decided** — the
owner's existing **Archico B.V., KvK 73922706** runs Ownpace; open decision 4 halves
(name/KvK/court filled in the legal drafts and #661's successors; the btw-id and the
printed address remain), and `VIES_REQUESTER_MEMBER_STATE` is now certainly `NL`. Also
merged the same day: privacy v1.1 (#663, the household-controller branch) and the DPA +
sub-processor drafts (#664) — the lawyer package is complete.

**T1–T3 are built (2026-08-29): the buyer exists as data, their VAT number can be
actually checked, and the treatment is a decision, not a constant.** Managed migration
0012 creates `billing_party` (consumer-shaped first); migration 0013 adds the
append-only `vat_consultation` log with the VIES client and check surface
(`VIES_REQUESTER_*` now waiting only on Archico B.V.'s btw-id); `vat-treatment.ts` +
`moneybird-tax-rates.ts` decide what an invoice carries and resolve it to the books'
own `tax_rate_id` — the legacy constant is contained by a repo-scan guard and survives
only for the usage estimate until T4/T8 rewire it. T4 (the adapter) is next and needs
the Moneybird trial + the foreign-VAT gating test. Earlier the same day: three more
owner decisions landed. T9 (billing shape),
the erasure-mirror question and the OSS timing are now decided — rows and §"What this
changes about erasure" updated; ADR-0044 records T0's operative rules. Still open: the
btw-id and printed address (the entity itself is decided — Archico B.V.) and the
sign-off (open decisions 4–5). Earlier: revised 2026-08-28 after the owner's second round —
**T0 decided (Moneybird)**, the market **consumer-primary, not B2B-primary**, and one claim
in the first draft corrected — see §"Who is the controller".

**The one-line summary of the finding:** the `invoice` table has amounts and no identity.
There is no invoice number, no seller, no buyer, no address, no VAT number and no line
items — and `tenant` carries only `name`, `status` and `settings`, so **the buyer does not
exist as data anywhere in this product**. Migration 0001 already says the first half of this
in a comment; the second half is new and is the harder one, because a VAT treatment cannot be
decided without knowing who and where the customer is.

**Not legal advice, and this plan should not be the last word.** It is written from the EU
VAT Directive (2006/112/EC art. 226 — what an invoice must contain), the Dutch
implementation (Wet OB 1968 art. 35a), the place-of-supply rules for digital services, and
GDPR art. 2(2)(c) with recital 18. **Consumers being the primary market pulls consumer
contract law and a GDPR question into scope that an invoicing plan should not be deciding
alone** — see §"Who is the controller" and the cross-reference to 0086 T5.

| Task | Status | Evidence |
|---|---|---|
| T0 Pick the bookkeeping system | ✅ **Decided 2026-08-28: Moneybird** | Dutch, EU-hosted. **API on every tier including Compact**, ICP-aangifte on every tier, Peppol sending on every tier. Its OpenAPI spec (`github.com/moneybird/openapi`, read 2026-08-28) covers everything T4–T7 need. Runner-up e-Boekhouden (€7.95/mo) on cost alone. ADR: [ADR-0044](../adr/0044-the-books-are-not-ours.md) (2026-08-29) — the operative rules the build must uphold; the comparative analysis is a business record per ADR-0009. Still needs the accountant's read. |
| T1 The buyer, as data | ✅ **Built 2026-08-29** | Managed migration 0012: `billing_party`, one row per tenant, **`kind` defaults to `consumer` and the business case is the variant** — the database itself refuses a consumer carrying a VAT number (`billing_party_vat_number_check`), and a business without one stays legal. `GET/PUT /api/billing/party` (owner/admin; the PUT is an upsert a retry converges on), the billing page's "Invoice details" card in both languages, and erasure updated: the purge stamps the **buyer's** name onto detached invoices, then purges the row (`PURGED_TABLES` — a consumer's row is a person's name and home address). Deliberately absent, per the plan: VAT-number validation (T2) and the country *decision* (T3 — what is stored is the customer's statement). |
| T2 A VAT number that was actually checked | ✅ **Built 2026-08-29** | Managed migration 0013: `vat_consultation`, an **append-only** evidence log — `app_user` holds INSERT and SELECT only (UPDATE/DELETE revoked; evidence that can be edited proves nothing). `POST /api/billing/party/check-vat` consults VIES's REST API and stores the answer; **a row is always an answer** — an unreachable VIES (MS_UNAVAILABLE and friends, tested against a fault that carries `valid:false` beside its error code) answers 503 and stores nothing. The check is **qualified** — consultation number issued — once `VIES_REQUESTER_MEMBER_STATE`/`VIES_REQUESTER_VAT_NUMBER` carry the seller's own number (entity decided 2026-08-30 — Archico B.V., so `MEMBER_STATE=NL`; blocked now only on its btw-id; until then checks run unqualified and the screen says so). VIES geography handled: EL not GR, XI exists, GB refused as never-checkable. The GET join speaks only for the number as currently stored; the billing card shows the verdict, auto-checks a newly saved business number, and renders VIES's own refusal sentences. Still open here: whether the consultation should also ride onto the Moneybird document — noted for T4. |
| T3 VAT treatment: decided, recorded, never a constant | ✅ **Built 2026-08-29** | `vat-treatment.ts`: the decision as a pure, total function — domestic buyers domestic; EU B2B **reverse charge only with a valid VIES consultation** (without one, charged like a consumer *on purpose*: over-charging is the buyer's money and a credit note fixes it, under-charging is the seller's liability); EU consumers at the seller rate until `VAT_OSS_ACTIVE` flips (owner's threshold decision); non-EU an export — GB stays outside even with an XI number (services, not goods). `moneybird-tax-rates.ts`: treatment → the administration's own `tax_rate_id`, **operator-configured and validated against the real list** (a deleted/archived/purchase rate refuses by name) — no percentage is ever consulted for selection. `GET /api/billing/party` serves the decision; the billing card says it in both languages. The legacy constant survives ONLY for the usage-screen estimate, pinned by `scripts/a-rate-that-must-not-spread.unit.test.ts` (a new caller fails CI). Remaining for T4/T8: point the resolver at the real administration and rewire the estimate/price page. |
| T4 The Moneybird adapter | ✅ **Core seam built 2026-08-29** — wiring + live proof against a sandbox administration, no longer gated on the owner (2026-10-05); **configuration and its check built 2026-10-05** (slice 1), **the adapter completed and one push function built 2026-10-05** (slice 2) | `moneybird-sales-invoices.ts`: `ensureContact` (found by OUR `customer_id` key, matched exactly against the fuzzy search), `ensureSalesInvoiceByReference` (look-then-create; an existing invoice is returned **as it stands, never patched** — the correction instrument is T7's credit note), and `sendSalesInvoice` (the moment Moneybird assigns the legal number). The sharpest pin: **an uncertain lookup never falls through to create** — a 500 on `find_by_reference` is `unavailable` with zero POSTs, because "could not look" read as "not found" is how a flaky afternoon double-invoices a customer. Lines carry `tax_rate_id` and nothing else (a test asserts the wire body never contains "percentage"). Injectable fetch throughout; config is parameters, no env reads. **The owner's gate cleared 2026-10-05**: a sandbox administration on the OTA stack with its rate ids, and the German-19% test passed (Status). **Built since**: the reverse-charge line says its VIES consultation, number and date (decision 10, `invoice-push.ts`), and the hourly push takes 0109's tiers to the books (slices 4 and 5, 2026-10-06 to 2026-10-11). |
| T5 The mirror, and the number that is not ours | ✅ **The mirror BUILT 2026-10-05** (managed 0045, slice 3), **filled by the push since 2026-10-06** (slice 5: each draft numbered, dated and sent by Moneybird; paid and late read back, 5f) — **immutability BUILT 2026-08-30** (migration 0014, ahead of the reshape) | `invoice` becomes a MIRROR carrying the legal number. Moneybird owns `invoice_sequence_id`; the schema must make it impossible to drift into numbering a document we do not own. The refusal is already installed on the current table — T5's migration only extends 0014's column lists when the mirror columns arrive (§"The refusal, designed"). |
| T6 Delivery: the email and the download | ✅ **The download built 2026-10-10** (slice 6; the e-mail is Moneybird's, decision 11) | `GET /sales_invoices/{id}/download_pdf`. Serves **their** PDF, never one we render. Two documents for one sale is the failure this task exists to prevent. |
| T7 Credit notes | ✅ **Built 2026-10-11** (Status): the credit note as a document and the withdrawal (7a, 7b), the withdrawal's button (7c), its money back, refunded, settled or by hand, each refund followed to its end (7d), and the yes that asks to begin (7e, terms 1.5) — **database refusal BUILT 2026-08-30** | `PATCH /sales_invoices/{id}/duplicate_creditinvoice`. The database half is done ahead of schedule: migration 0014 installs the state-machine trigger + narrowed grants (§"The refusal, designed"), the generation upsert regenerates drafts only, the webhook path passes by construction, and a failed payment no longer voids the document. The credit note itself followed: Moneybird's `duplicate_creditinvoice` (7a) and the Billing page's withdrawal that issues it (7c). |
| T8 The price page stops promising 21% | ✅ **First slice built 2026-08-29** — per-country display waits on OSS | The row's own premise corrected by the build: the site never computed VAT — it showed bare `€n` with **no statement at all**, and toward consumers a displayed price legally IS the final, VAT-inclusive price. The slice says it out loud ("All prices include VAT." / "Alle prijzen zijn inclusief btw.") on the landing, pricing and calculator pages, with a structural guard: any page rendering tier prices without the label goes red. Deliberately **no rate in the copy** — which country's VAT sits inside the price is T3's per-invoice decision, so nothing drifts when OSS activates or a rate changes. Remaining for full T8: per-country inclusive display once `VAT_OSS_ACTIVE` flips, and reconciling the retired server model's ex-VAT arithmetic in 0109's tier rebuild. |
| T9 Billing frequency, decided rather than defaulted | ✅ **Decided 2026-08-29: monthly AND annual, annual discounted** | The owner's framing decides it: the service is not a one-shot move but *"an operational exit strategy waiting for the cutover"*, sometimes used serially to move a family one person at a time — so a subscription is honest, and the discounted annual is the fee-efficient path (one charge ≈0.3% vs ≈3.4% monthly, §below) offered rather than imposed. T4's invoice shape: recurring, both cadences. **Invoiced in advance (2026-10-05, decision 6):** a month on its first day, at the tier it starts on, and a move up within a day, for the difference. |
| T10 Retention, revisited now that we are not the record | ✅ **Decided 2026-08-29: purge the mirror on erasure, keep the pointer; built 2026-10-11** (managed 0054, Status; privacy 1.5 §9) | On erasure the mirror rows go; `erasure_record` keeps only the Moneybird invoice numbers, and the operator's answer becomes "these numbers, held in Moneybird". Retires most of #652's screen — the honest outcome §"What this changes about erasure" predicted. |

## Why this exists

`POST /api/billing/invoices/generate` has answered `409 billing_model_retired` since
2026-08-27 (0109 T0). Nothing mints a bill today, which means **there is no compliance
problem in production right now** — and also no way to charge anybody. 0109 is rebuilding
*what the invoice says about usage*. This plan is about everything else on the page.

The split is worth stating because the two plans will land near each other:

- **0109 owns the LINE.** Which tier, what peak, on what date, with what evidence.
- **0111 owns the DOCUMENT.** Who issued it, to whom, under which number, with which VAT
  treatment, in what format, kept for how long, and how it is corrected.

An invoice can be perfectly right about usage and still not be an invoice.

## The decided ground (owner, 2026-08-28)

1. **Customers are EU consumers first, businesses second.** The owner's words: families —
   *"a dad or mom that migrates themselves and kids along the way"* — rationalising onto EU
   services. The first draft assumed B2B-primary and was rewritten.
2. **An external bookkeeping system is the legal system of record.** It issues, numbers,
   renders and files. Ownpace feeds it and mirrors the result.
3. **That system is Moneybird** (T0).
4. **The customer gets a PDF, by email and in the app.**
5. **Credit notes are in scope now**, not later.
6. **Mollie stays** for payment. It is already built (0086 T6) and at these amounts is the
   cheapest option available — see §"Billing frequency".

Three more, 2026-08-29:

7. **Billing shape: monthly and annual, annual discounted** (T9 — the reasoning is in that
   row: a standing exit posture, not a one-shot move).
8. **On erasure the invoice mirror is purged; only the Moneybird numbers remain** (T10).
9. **OSS waits for the threshold**: Dutch 21% to every EU consumer until a quarter's
   forecast crosses €10k cross-border; T3 is built so the switch is a config change and a
   date.

## Three vocabularies, and why they keep colliding

The owner asked, correctly: *"do you see them as operator, or are we mixing up with the
managed overall operator and 'Owner' of accounts?"* Three independent vocabularies use
overlapping words, and this plan touches all three:

| Vocabulary | Terms | What it governs |
|---|---|---|
| **Product roles** | `platform_operator`; tenant `owner` / `admin` / `member` / `viewer` | what a signed-in person can *do in the app* |
| **Commercial** | seller ↔ customer | who pays, and whose name is on the invoice |
| **Data protection** | controller / processor / data subject | who is legally accountable for personal data |

**"Operator" in this repo means the platform operator** — the support role of workplan 0110,
cross-tenant, and nothing to do with GDPR. **A tenant `owner` is a product role and does not
make somebody a GDPR controller.** A parent can hold `owner`, control everything in the
product and pay every invoice, and still not be a controller in law. Nothing below should
reuse "operator" or "owner" when it means "controller".

## Who is the controller — a correction

The first draft of this plan said Ownpace *"becomes the controller"* for consumer customers.
**That was too broad and is corrected here.** `site/legal/privacy.md` §3 already splits it,
and the split is right:

- **Account data** — sign-in, billing, support correspondence: **Ownpace is controller.**
  Already true for every customer. Consumers change nothing here.
- **Migration content**: the customer is controller, Ownpace the processor.

The narrower thing that genuinely does not hold for families is the **processor** half. It
assumes a controller on the other side who is subject to the GDPR. For a household customer
there is not one:

- **Art. 2(2)(c)** exempts processing *"by a natural person in the course of a purely
  personal or household activity"*. A parent moving the family's mail is outside the
  Regulation and carries no controller obligations.
- **Recital 18** confirms the exemption does **not** reach the provider: the Regulation still
  applies to those who provide the means for such processing.

So Ownpace cannot describe itself as acting *"on the controller's instructions"* when the
instructing person has no controllership to give — and in practice Ownpace determines the
purposes and means anyway: it designs the service, sets retention, chooses sub-processors
and decides the security posture. The likely correct reading is **controller for content
too, in the household case**, on Art. 6(1)(b) contract.

**This is 0086 T5's territory, not this plan's, and it is on that plan's critical path.**
Specifically it needs:

- `site/legal/privacy.md` §3 gains a **third branch** — a private individual migrating their
  own or their family's mail. The current parenthetical *"(or, for an organisation, your
  administrator)"* cannot carry that case.
- `site/legal/README.md`'s summary line — *"We are a processor for migration content, a
  controller for the account"* — becomes true-for-business and incomplete-for-consumers.
- The **DPA stays a business instrument.** A family neither gets nor needs one, which means
  the privacy policy has to carry what the DPA would have said.
- **Third parties in the mailbox.** A child's mail contains messages from teachers, friends
  and other families who never contracted with anybody. The parent's household exemption
  covers the parent; it covers nothing for Ownpace. This is the sharpest reason the
  provider-side analysis matters, and it wants a lawyer's eye rather than this plan's.

## What consumers change beyond VAT

Also 0086 T5's, listed here because they were found while writing this and would otherwise
be found after launch:

- **Prices must be shown including VAT to consumers.** That makes 0088's calculator a
  legally-required field rather than a courtesy, and under OSS the inclusive figure differs
  per country.
- **Right of withdrawal.** Consumers get 14 days. For a digital service that starts
  immediately, the customer must explicitly consent to begin *and* acknowledge losing the
  right. Without that captured, somebody can have their mail migrated and then withdraw.
- **Consumer terms are not business terms.** Unfair-terms rules apply, and the current terms
  are written business-shaped.

## The design

### Ownpace is upstream of the record, and a mirror of it

```
  Ownpace                          Moneybird
  ───────                          ─────────
  billable period  ──── push ───▶  assigns the NUMBER (invoice_sequence_id)
  (who, where, what,               applies the tax rate we selected
   which tier, amount)             renders the PDF
                                   files it (7 yr NL / 10 yr OSS)
  mirror  ◀──── pull ────────────  number, issue date, PDF, status
    │
    ├── shows it on the billing page
    ├── emails it
    └── shows it to an operator (0110)
```

**Ownpace must never render its own PDF.** With an external system of record, a
self-rendered document is a second artefact for one sale — a different layout, possibly a
different number, certainly a different total the moment a rounding rule differs. When a
customer forwards "the invoice" to their bookkeeper, exactly one document must exist. T6 is
written to make that structural rather than a habit.

**Ownpace must never assign a number.** Sequential, gapless numbering is the thing auditors
check and the thing that is hard to get right under concurrency, retries and rollbacks. We
chose not to own it; the schema should make it impossible to drift into owning it (T5).

What Ownpace *does* own, and cannot delegate, is **knowing the customer**. Moneybird can
apply a tax rate but cannot decide one: it does not know whether the buyer is a business,
where they are, or what evidence we hold for that. That is T1–T3, and it is the substance of
this plan.

### What the Moneybird API actually gives us

Read from `github.com/moneybird/openapi` on 2026-08-28 rather than from documentation prose,
so T4–T7 are designed against the real surface:

| Need | Endpoint |
|---|---|
| Create the invoice | `POST /{administration_id}/sales_invoices` |
| **Idempotency** | set `reference` on create; `GET /sales_invoices/find_by_reference/{reference}` |
| Send it | `PATCH /sales_invoices/{id}/send_invoice` |
| The PDF (T6) | `GET /sales_invoices/{id}/download_pdf` |
| Credit note (T7) | `PATCH /sales_invoices/{id}/duplicate_creditinvoice` |
| Tax rates (T3) | `GET /tax_rates` |
| Mirror efficiently (T5) | `GET /sales_invoices/synchronization` |
| Payment state | `PATCH /sales_invoices/{id}/register_payment` |
| ViDA later | `GET /sales_invoices/{id}/download_ubl` |

Two things worth carrying into the tasks. **`reference` plus `find_by_reference` is the
idempotency key** — a period key we choose, looked up before creating, so a retried push
cannot mint a second invoice. And **the spec never mentions reverse charge or OSS**, because
those live in tax rates configured in the administration. That is the right seam: T3 selects
a `tax_rate_id` and no percentage is ever written in our code.

**Known risk, recorded now.** Moneybird's support for *foreign* VAT rates is reported as
weak — extra rates are described as a hidden feature, and it is called out as not
necessarily the best answer when you owe VAT in several EU states. Irrelevant below the
threshold, and precisely the axis that matters above it for a consumer-primary business.
**T3 should begin by testing it**: create a German consumer invoice at 19% in a trial
administration and see whether the OSS overview picks it up. If that is painful, the switch
to e-Boekhouden or Exact is cheap while there are few invoices — and expensive later.
**Tested 2026-10-05, in a sandbox administration: it passed** (Status).

### The buyer, consumer-first

For a digital service supplied electronically:

- **Consumer or business in the Netherlands** → 21%, ordinary domestic invoice.
- **Consumer in another EU state** → VAT at **their** country's rate, declared through
  **OSS**. Below a **€10,000/year EU-wide threshold** — counting cross-border B2C only, not
  Dutch sales — a small supplier may keep charging Dutch VAT instead. Above it, OSS is not
  optional.
- **Business in another EU state, with a valid VAT number** → reverse charge. Invoice shows
  0%, the customer's VAT number, and *"btw verlegd / VAT reverse charged"*. Also on the
  quarterly **opgaaf ICP**, which applies at any turnover.
- **Outside the EU** → outside the scope of EU VAT, with wording to say so.

**At €9.99/month the threshold is roughly 85 non-Dutch consumers billed for a year.** If the
first families are Dutch there is real runway; if they are spread across the EU, OSS arrives
early. T3 must therefore be built so that crossing the threshold is a configuration change
and a date, not a rewrite.

**A consumer's country has to be evidenced, not asked.** The VAT Implementing Regulation
(282/2011 art. 24b) wants **two non-contradictory pieces of evidence** — typically billing
address plus IP country, or the bank/card country. One self-declared dropdown is not enough,
and a customer whose declared country contradicts everything else is a case the code must
have an answer for rather than silently trusting the form.

**Retention is seven years, except where it is ten.** The Dutch general obligation
(`fiscale bewaarplicht`) is seven. **OSS records are ten**, counted from 31 December of the
transaction year, and the obligation survives deregistration — so the retention promise
changes length at the same threshold that changes the VAT treatment. Verified 2026-08-28; it
was written as seven throughout the first draft, which was wrong.

### The party snapshot, which 0110 already started

Migration 0001 added `billed_to_name` for a narrow reason: an erased tenant's invoice had to
be able to say who it was for. That instinct generalises, and this plan should finish it
rather than invent a parallel mechanism.

Everything the document asserts about either party is **captured at issue time and never
re-read**: seller name, address, KvK, VAT number; buyer name, address, country, VAT number
where there is one, and the treatment applied with the evidence behind it. A customer who
moves house must not silently rewrite invoices already issued — and after an erasure there is
nothing left to read it from anyway.

The seller half comes from the `«PLACEHOLDER»` tokens 0086 T5 already tracks
(`«LEGAL_ENTITY»`, `«REGISTERED_ADDRESS»`, `«COMPANY_NUMBER»`, `«VAT_NUMBER»`). This plan
consumes that mechanism rather than duplicating it: the same facts, one source, and the
existing guard that fails on an unfilled one.

### Billing frequency is the biggest number in this plan

At a €9.99 base fee, **fixed per-transaction costs dominate and the payment provider barely
matters**:

| Method | Fee | On €9.99 |
|---|---|---|
| Mollie iDEAL | €0.32 | 3.2% |
| Mollie SEPA Direct Debit | €0.35 | 3.5% |
| Mollie EU consumer card | 1.80% + €0.25 | 4.3% |
| Stripe SEPA Direct Debit | 0.8% + €0.30 | 3.8% |

Mollie is cheapest at this size, is Dutch, is iDEAL-native — which is what NL consumers
actually use — and is already built. **Keep it.**

The lever is not the provider. **One annual charge of €119.88 costs €0.35 — about 0.3%
instead of 3.4%,** and removes eleven failed-payment and dunning opportunities per customer
per year. And the model itself deserves the question: a family rationalising onto EU services
migrates **once**. If the engagement is finite, charging once or a few times collapses
payment fees, dunning, churn admin and bank-transaction count at the same time. **T9 decides
this before T4 is built**, because the invoice shape follows from it.

One operational note: Mollie settles in **batched payouts**, so Moneybird sees one bank
transaction per payout rather than per customer payment. With weekly payouts that is four or
five a month plus Ownpace's own costs — comfortably inside Start's twenty, for a long time.
Worth setting deliberately rather than leaving on the default.

### Credit notes

An issued invoice is immutable. That is not a convention, it is the reason numbering means
anything. A correction is a **creditfactuur**: its own number from the same sequence, a
reference to the document it corrects, and the correction stated rather than the original
edited. Moneybird owns that too, via `duplicate_creditinvoice`.

What Ownpace must add is the **refusal**: no code path may update an invoice that has been
issued. Today `invoice.status` is mutable and nothing stops an `UPDATE`. T7 should close that
at the database, the way the rest of this repo does it, rather than by everyone remembering.
How, exactly, is now designed — the next section.

### The refusal, designed — immutability at the database (T5/T7, written 2026-08-30)

~~Design only; it lands with T5's migration~~ — **landed the same day, on the CURRENT
table, by owner decision** ("do 3", 2026-08-30): the sent-amounts hole below was live, and
closing it needed nothing from Moneybird. Managed migration
`0014_an_update_the_invoice_refuses.sql` carries the trigger and the grants exactly as
designed; `invoice-refusal-under-rls.unit.test.ts` is the guard, each arm proved by
breaking it once. T5's migration now only **extends the column lists** when the mirror
columns (the legal number, the Moneybird id, the buyer snapshot) arrive — the mechanism is
in place, and T7 builds on a table that already refuses.

**Two corrections the implementation surfaced**, recorded here so the design note stays
honest: (1) the webhook's `failed/canceled/expired → void` mapping was retired — a failed
PAYMENT is not a failed INVOICE, and with void FINAL in the machine it would have stranded
every expired payment's invoice unpayable; the document stays `sent` and payable, and
voiding becomes a deliberate bookkeeping act (T7's territory). (2) The pay route refuses
`paid`/`void` invoices with a 409 **before** creating a Mollie payment — the trigger would
have refused the `→ sent` write anyway, but after real money had started moving.

**Issued means numbered.** The moment `sendSalesInvoice` (T4) gets Moneybird to assign the
legal number, the row stops being working state and becomes the mirror of a document. In the
mirror's state machine that moment is `draft → sent`. Everything below hangs off that line.

**Who actually writes the row today** — the design is shaped around the writers the code
has, not the ones it ought to have:

| Writer | Columns it sets | Notes |
|---|---|---|
| Generation upsert (`invoice-generation.ts`) | `subtotal`, `tax_rate`, `tax_amount`, `total`, `metadata`, `updated_at` | Regenerating a period rewrites a draft's amounts — legitimate. But its `setWhere` skips only `paid`/`void`, so **a `sent` invoice's amounts can be rewritten today**. That is the exact hole, live. |
| Pay route (`billing/index.ts`) | `status → sent`, `payment_id`, `metadata`, `updated_at` | The customer starts paying. |
| Mollie webhook (`billing/webhooks.ts`) | `status`, `paid_at`, `updated_at` | Terminal states already no-op in code; that stays as the polite first line, not the rule. |
| Erasure detach (`offboarding.ts`) | `billed_to_name`, `tenant_id → NULL` | Owner-path by construction — it must see across tenants and leave rows tenant-less, which no RLS-scoped `app_user` context can. T10's decision (purge, keep pointer) retires it. |

**Two layers, because neither suffices alone.** Column-level grants are unconditional per
role — they cannot say "amounts may change while draft, never after". A trigger can say
that, but a trigger alone leaves the whole column surface formally writable and invisible in
the catalog. So: grants close what *no* app path may ever touch, the trigger decides what
the remaining columns may do *per state*.

**Layer 1 — narrowed grants**, the T1/T2 style (catalog-visible, so a guard can pin it):

    REVOKE UPDATE ON invoice FROM app_user;
    GRANT UPDATE (status, subtotal, tax_rate, tax_amount, total,
                  payment_method, payment_id, paid_at, sent_at,
                  metadata, updated_at)
      ON invoice TO app_user;

Never app-writable after this: `id`, `tenant_id`, `billed_to_name`, `period_start`,
`period_end`, `currency`, `due_date`, `created_at`. T5's new mirror columns (the Moneybird
invoice id, the legal number, what the document said — including `due_date` if it moves to
being read off the document) join the *granted* set instead, because the issue moment itself
is an UPDATE: the `draft → sent` statement stamps them. Write-once is the trigger's job, not
the grant's.

**Layer 2 — one `BEFORE UPDATE` trigger** enforcing two things:

1. *The status machine.* `draft → {sent, void}`; `sent → {paid, overdue, void}`;
   `overdue → {paid, void}`; `paid → ∅`; `void → ∅`. Same-to-same passes (idempotent
   re-deliveries and lifecycle-only touches must not throw). `paid → void` is deliberately
   absent: undoing a paid document is T7's credit note, never a status flip.
2. *The document freeze.* Once `OLD.status <> 'draft'`, any change to the document columns —
   amounts, tax fields, `due_date`, the mirror columns — refuses, with an error message that
   names the instrument: *issued invoices are corrected by credit note (T7), never edited.*
   Carved out: the lifecycle columns (`status`, `payment_*`, `paid_at`, `sent_at`,
   `metadata`, `updated_at`) and — until T10 lands — `billed_to_name`/`tenant_id` for the
   erasure detach.

The trigger fires for **every role**, owner included. A future repair that genuinely must
edit an issued row does it by dropping the trigger inside its own migration — a visible,
reviewable act — not through a quiet role exception.

**What changes for the writers.** The webhook and pay route pass untouched: everything they
set is granted, and their transitions are legal — the Mollie path keeps working by
construction, not by exemption. The generation upsert tightens: its `setWhere` widens from
"not paid/void" to `status = 'draft'`, aligning the app with the rule it already believed,
and the trigger backstops the day it drifts. Re-pricing a sent-but-unpaid invoice becomes a
credit note plus a new invoice — ADR-0044 working as intended, and a real behaviour change
to say out loud. `DELETE` stays as-is here: the only legitimate deleter is T10's purge on
the owner path, and whether `app_user` should lose DELETE outright is T10's edit, decided
where its guard lands.

**The guard sketch** (integration, the `withTenant`/owner split the suite already uses):
as `app_user`, updating `total` on a `sent` invoice refuses citing credit notes; updating
`period_start` on *any* invoice is a column-privilege refusal; `sent → draft` and
`paid →` anything refuse; a regeneration-shaped update on a `draft` passes; a
webhook-shaped `sent → paid` passes. As owner, a detach-shaped update passes (until T10).
And a catalog pin: `information_schema.column_privileges` for `app_user` on `invoice`
equals the granted list exactly, both directions — a new column added without deciding its
class goes red, the `a-rate-that-must-not-spread` style. Each arm proved by breaking it
once before merge.

### What this changes about erasure

**This partly undoes work merged on 2026-08-28, and it should be decided deliberately rather
than discovered.**

0110's retained-invoice screen (and managed migration 0011) exists because Ownpace keeps
invoices after erasing a tenant, under the GDPR art. 17(3)(b) carve-out, for tax retention.
That justification assumed **Ownpace is the record**.

Moneybird is the record. It holds the invoice for the full retention period, and Ownpace's
copy is a convenience mirror. Keeping detached invoices here after erasure is then **no
longer required by the retention obligation** — and personal data kept without a current
justification is exactly what an erasure is supposed to remove. The cleaner posture may be:
purge the mirror on erasure, and let the operator's answer to *"what were we obliged to
keep"* be a link into Moneybird.

**Decided 2026-08-29: purge the mirror, keep the pointer.** On erasure the mirror rows go
and `erasure_record` retains only the Moneybird invoice numbers — a number identifies a
document without identifying a person, so the erasure stays an erasure and the
administrative answer stays answerable. T10 reshapes #652's screen accordingly.

## The build, sliced (2026-10-05)

In order: 1, then 2 and 3 side by side, then 4, 5, and 6 with 7. Migrations take the next managed
numbers (0045 to 0047 when this was written; re-check at merge). T10's purge-with-pointer follows
slice 5. The annual credit is not in this chain (decision 6).

1. **The configuration, and a check that reads.** `moneybird-config.ts`: all or none of
   `MONEYBIRD_API_TOKEN`, `_ADMINISTRATION_ID`, `_TAX_RATE_ID_DOMESTIC`,
   `_TAX_RATE_ID_REVERSE_CHARGE` and `_WORKFLOW_ID`; `_TAX_RATE_ID_OUTSIDE_EU` optional; `_DELIVERY`
   `manual` unless `email`. Ids are digits and stay strings (an 18-digit id must never pass through
   a number). A refusal names the key, never the value. Compose passes them optional (`:-`, never
   `:?`), the example lists them, and `operator.sh moneybird check` makes two reads, the rates and
   the workflows, and prints each treatment's rate and the workflow's VAT setting. Done when it
   prints the sandbox's two rates and refuses outside-EU by name: two requests, no invoice, no
   e-mail. No owner decision, no migration. **Built 2026-10-05** (Status).
2. **The adapter, complete, proved with stubs.** One request helper for both modules (bearer
   token, a timeout, a 429 as its own outcome with `Retry-After`). `workflowId` and
   `pricesAreInclTax` required on every invoice, never defaulted: under the sandbox's workflow a
   line entered without it would gain 21% on top. A send only from `draft`, so a retry never mails
   twice; no default delivery method. An existing invoice under our reference but another contact
   is refused. Totals parsed to integer cents. The push in one function: rate, contact, invoice by
   reference, send, read back. Reverse charge as decided in 9 and 10. **Built 2026-10-05**
   (Status), with the draft's total checked before it is sent.
3. **The mirror and its refusal** (T5, the database half). The invoice row gains Moneybird's id
   and administration, the legal number and date (written once, at issue), our reference (the
   unique key, replacing `(tenant_id, period_start)`), the kind and the credited invoice, the
   treatment, the rate, the lines and the evidence (frozen once past draft). The trigger learns
   them: issued means numbered (`draft → sent` needs a number and Moneybird's id), and a row is born
   a draft with no number. A pin classifies every column, so a new one can never stay editable
   after issue unnoticed. The pay route stops moving a draft to `sent` without a number and stops
   replacing `metadata` whole. No owner decision. **Built 2026-10-05** (managed 0045, Status).
4. **The month opens on a tier line** (0109 T5; in advance, decision 6). One rule for what a
   month bills so far, from the peak so far, the data counted, the yeses and the pick, shared with
   the Billing page's *What this month bills*, so the page and the invoices cannot disagree. A
   daily task keeps each month's invoices equal to it: on the first day a draft for the tier the
   month starts on, after a move up a draft for the difference, each under its own reference;
   Free makes no row; a second run makes no second row. Retention's clamp reads only months that
   are over. The metered generator, its route and its trip-wire go (**done 2026-10-05**, slice
   4a, with managed 0046 and the retention clamp). Switched on by 7, in the words of 8. **The
   month task built 2026-10-06** (slice 4b, Status): hourly, so a month opens in its first hour.
5. **Moneybird numbers it.** A daily task pushes each draft, one writer by construction, a lease
   on the row, paced under the 150-requests-per-5-minutes limit, then reads the state back
   (`paid`, `late`). **The push built 2026-10-06** (slice 5a, managed 0047, hourly, Status). The Billing page shows the legal number and date; Pay shows only where an
   invoice can be paid: **built 2026-10-10** (slice 5b, Status). `operator.sh moneybird proof` makes one invoice in the sandbox, by hand,
   never by e-mail, and running it again answers that it exists (**built 2026-10-10**, slice 5c); the nightly managed run makes one
   with a payment registered (12; **built 2026-10-10**, slice 5d). Invoice details first (14): **built
   2026-10-10** (slice 5e, managed 0048, Status).
6. **Moneybird's PDF in the app** (T6). The app streams Moneybird's own document and keeps no
   copy; a draft has none. Delivery as decided in 11. **Built 2026-10-10** (slice 6, Status).
7. **Credit notes, and the withdrawal button** (T7, 0152 T6 (f)). A credit note is our row first,
   then Moneybird's draft under its own reference, so a retry adopts the draft instead of making a
   second. The withdrawal is recorded append-only and read where the tier is read, as decided
   in 15. **The credit note built 2026-10-11** (slice 7a, Status), and **the withdrawal** (slice 7b,
   Status): recorded, read where the tier is read, its credit notes and its acknowledgement; **the
   button** (slice 7c), **nothing paid that was credited** (slice 7d's first half), and **the yes
   that asks to begin** before the fourteen days are over, from which the days used are billed,
   with the order button at every yes and the order's confirming email (slice 7e, terms 1.5), and
   **the money back** (slice 7d's second half): refunded through Mollie and booked, settled
   against its invoice in the books, or said for a transfer by hand.

**What the build holds to.** A retried push never mints a second invoice: only a 404 creates, one
writer, a lease, and the reference fixed once used. Nothing after issue is editable, the new
columns included. A closed organisation's months after its close bill nothing, and the purge
pushes an unbilled month first. The sandbox's caps hold: no per-PR check makes an invoice, the
nightly counts the month's invoices before it makes its one, nothing in a test, a proof or the
nightly has a contact e-mail, and delivery is `Manual` off live. The token is in no log line, no
refusal and no artifact.

## Where the cost is

| | |
|---|---|
| **T1–T3 (the buyer and the VAT treatment)** | The bulk, and more than the first draft assumed: consumer-primary means OSS, per-country rates and the evidence rule are load-bearing rather than edge cases. |
| **T4–T7 (the adapter)** | Smaller than expected. The API covers every need directly, and idempotency comes free with `reference`. |
| **T9 (billing frequency)** | Nearly no code, and the largest financial effect in the plan. |
| **T10 (retention)** | Small in code, but it revisits a decision and may retire a screen. Cheap to do, expensive to leave ambiguous. |
| **T8 (the price page)** | Small, easy to forget, and now legally required rather than cosmetic. |

## Not in this plan

- **Payment.** Mollie exists and stays; 0086 T6 owns the journey.
- **What the line says about usage.** 0109 T5.
- **The consumer-law and controller items.** Named here because they were found here; they
  belong to **0086 T5**, which is already the critical path.
- **Dunning, reminders, collections.** A separate concern and a separate tone of voice.
- **Peppol/UBL structured e-invoicing.** The owner chose PDF, and Moneybird sends via Peppol
  on every tier with `download_ubl` available — so when EU ViDA makes intra-EU B2B
  e-invoicing mandatory around July 2030 this is a call, not a migration.
- **Filing the VAT return.** Moneybird's job, and the accountant's.

## Still open — owner decisions this plan cannot make

1. ~~Billing frequency~~ **Decided 2026-08-29** — T9 row.
2. ~~Erasure mirror~~ **Decided 2026-08-29: purge, keep pointer** — T10 row.
3. ~~OSS~~ **Decided 2026-08-29: under the threshold, register when a quarter's forecast
   crosses** — T3 ships the under-threshold path first, switch-ready.
4. **The four seller facts — half-decided 2026-08-30: the entity is Archico B.V.,
   KvK 73922706** (the owner's existing BV; seat Wijhe → competent court Overijssel).
   `«LEGAL_ENTITY»`, `«COMPANY_NUMBER»` and `«COURT_DISTRICT»` are filled in the legal
   drafts. Still open, still 0086 T5's to track: `«REGISTERED_ADDRESS»` (the printed form
   is the owner's call) and `«VAT_NUMBER»` — the btw-id, which also qualifies T2's VIES
   checks. End-to-end tests still wait on that last fact.
5. **Who signs this off?** The accountant on the VAT and the retention; a lawyer on the
   controller question and the consumer terms. Both cheaper before T1 than after the first
   invoice.

Raised by §"The build, sliced" (2026-10-05), each with the recommendation, and all ten answered
by the owner the same evening (Status):

6. ~~Cadence~~ **Decided 2026-10-05: in advance** (*"no, please invoice in advance of the
   month"*; recommended was after the month). A month is invoiced on its first day (UTC), at the
   tier it starts on, and a move up during it is invoiced for the difference within a day, so its
   invoices always add up to what it bills: its peak, or a higher tier picked, never past a yes.
   An alert when a month's invoices are two days behind what it bills. A year bought upfront
   (0152 T6 (e)) needs its own purchase and a credit balance: a follow-up, not this chain. Shapes
   slices 4 and 5.
7. ~~The first billable month~~ **Decided 2026-10-05: as recommended.** An explicit
   `OWNPACE_BILLING_FROM=YYYY-MM`; empty means nobody is invoiced, whatever runs (the owner asked,
   and that is the answer). Set at the switch (`docs/ending-the-alpha.md`); the tasks also refuse
   during the Alpha. End the Alpha on the 1st of a month. Switches slices 4 and 5 on.
8. ~~The line's words~~ **Decided 2026-10-05: as recommended**, in the organisation's language:
   *Ownpace Medium, oktober 2026: 12 migraties tegelijk op 3 oktober* / *…: 1,6 TB gemigreerd in
   totaal* / *…: het pakket dat u koos*; a top-up *Extra ruimte: 500 GB bij Small, eenmalig*.
   Invoiced in advance, the date is the month's first day or the day of the move up.
9. ~~The reverse-charge price~~ **Decided 2026-10-05: as recommended.** The published price
   without the Dutch VAT in it (Small €4,13, Medium €9,92, Large €33,06, Extra large €66,12), as
   the drafted terms sentence says, computed from the administration's own domestic rate at run
   time and never from a constant here.
10. ~~The VIES evidence on the document~~ **Decided 2026-10-05: as recommended.** *Btw verlegd /
    VAT reverse charged. VIES {number}, {date}* in the line text: the latest valid answer for the
    stored number. The accountant reads the words.
11. ~~Delivery~~ **Decided 2026-10-05: as recommended.** Moneybird e-mails the invoice to an
    invoice address the Invoice details card asks for; `Manual` on the sandbox and the OTA stack;
    the app offers Moneybird's PDF. The sender: Status.
12. ~~The gate~~ **Decided 2026-10-05, widened by the owner:** no invoice in a per-PR check; a
    read-only check when the keys are set; an operator's proof command; and the nightly managed
    run makes one sandbox invoice, sent `Manual`, paid by a registered payment and read back as
    `paid`, counting the month's invoices first. Slice 5.
13. ~~Closing an account~~ **Decided 2026-10-05: as recommended.** The closing month bills its
    peak up to the close, nothing after; invoiced in advance, it was invoiced at its start and a
    move up before the close like any other.
14. ~~Invoice details before leaving Free~~ **Decided 2026-10-05: as recommended.** A yes or a
    pick that leaves Free asks for them first.
15. ~~The withdrawal~~ **Decided 2026-10-05: as recommended.** Back to Free from that moment,
    account and migrations kept; the days used billed in proportion, the excess credited with a
    credit note; a confirmation e-mail in the organisation's language; the money back through the
    payment provider, or a transfer until there is one. Legal text: the owner's to read closely.

Taken, the owner said yes (2026-10-05): the agreed `price_eur` when a month bills a tier said yes
to; references `ownpace-{organisation}-m-{YYYY-MM}-{tier}`, one per step in a month (`-t-` a
top-up, `-c-` a credit note); no buyer address in the mirror, Moneybird's contact holds it; the
retired generate route removed.
