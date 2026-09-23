# Workplan 0130 — A problem report that reaches a person

## Status — 2026-09-23 (update this block at the end of every session)

**2026-09-23: opened from the owner's answers.** The owner asked: *"Is there a way people the use
Ownpace can report issues/bugs? What EU based product do you suggest we use? Creating form
scratch seems not smart. Id like to be able to see the issues, be able to contact a user with
questions/more info, and help out. These might be operational with customer data, so i think
GitHub issues it not the right place... Devs will find there own way to GitHub issues section.
Perhaps something that enables users to register the URL they on, the error they see
(screenshot or similar)"*. The recommendation was Zammad, open source and made in Germany, and
two questions went back. Both were answered (§2).

**2026-09-23, later: T1 and T2 built.** "Report a problem" sits beside Sign out, on the
managed edition, and only when the deployment has a Zammad set up (`ZAMMAD_URL` and
`ZAMMAD_TOKEN`, https). It opens a form that says what goes with the report (the page, without
any link secret; the reference and kind of error when there is one) and which address the reply
goes to, before anything is sent. `POST /api/problem-reports` makes the ticket on the owner's
Zammad with the reporter as its customer, in plain text, with a PNG or JPEG screenshot of at
most 5 MB checked by its own first bytes; five reports an hour per person; its own 8 MB body
limit, ahead of the global parser. A report Zammad refuses is answered with a reference and
recorded as `report.not-delivered` (0129 T1). The appliance does not offer the form yet: it has
no report route, and it will send nothing until its owner points it at a helpdesk (0129 D5).
Set-up is step 8f of `docs/managed-bring-up.md`. Guards: `a-report-that-reaches-a-person` in the
API (23) and the web app (7), and `a-report-link-that-can-reach-someone` (3); 23 mutations, all
killed.

**2026-09-23, T3's first half: the failure line has a reference to carry.** A failed data type's
reference lived only in `app_event`, which the application's role cannot read, so nothing on the
customer's screen could fill the form's reference in. Now the status row keeps the reference its
failure was recorded under (`last_error_reference`, ledger migration 0061), beside the category:
written by both catch sites with the event's own reference, cleared when a pass completes or
pauses, eight hex characters or nothing by CHECK. The progress strip shows it under the error, on
both editions, and a progress link does not carry it: its reader cannot report. The link to the
form is the second half. Guards: `a-failure-with-its-reference` in ledger (6), orchestration
(2), shared (3) and the web app (4), and the stranger guard's fixture names the field.

| Task | Status | Notes |
|---|---|---|
| T1 A report form in the app | ✅ **Built 2026-09-23** (D2) | §3. What the person writes, the page they are on, the error they see, and a screenshot if they add one. |
| T2 The report becomes a Zammad ticket | ✅ **Built 2026-09-23** (D1) | §3. Created by the API on the owner's own Zammad, so a reply reaches the person by email. |
| T3 The failure line that says "send it to us" opens the form | 🟡 **Half built 2026-09-23** (D2) | §3. With the failure's category and reference already filled in. The reference now reaches the strip; the link is next. |
| T4 The privacy policy names support requests | 📋 **Proposed** | §3. What is sent, where it is kept, for how long. |

## 1. What there is today

Nothing a customer can press. The one sentence that sends somebody to us is the `unknown`
failure's remedy, *"if it does not help, send it to us and we will look"*, and it says neither
where nor how. GitHub issues are for developers, and a customer's report can hold operational
detail about their data, which is why the owner wants it elsewhere.

## 2. The owner's decisions (2026-09-23)

- **D1, the product:** *"Zammad self-hosted: yes."*
- **D2, the form:** *"Yes. The 'send it to us' failure line would then link to it."*

## 3. The design

**T1, the form.** *Report a problem*, reachable from every page of a signed-in customer and
from the failure line (T3). It carries:

- what the person writes, in their own words;
- the page they are on, recorded the way the access log records it (0108): a grant or view
  link as `:link`, and no query, so a report never carries a credential;
- the error on the screen: its category and reference number (0129 T1), when there is one;
- a screenshot, if the person adds one: an image file they choose, of a bounded size;
- their email address, so the owner can write back.

The form says what will be sent before it is sent, and to whom.

**T2, the ticket.** The API creates the ticket in Zammad's REST API with a token that lives in
the deployment's secrets, in a group the owner configures, with the customer as the ticket's
customer, so Zammad's own email replies reach them. Nothing is sent from the browser to Zammad
directly, so the token never leaves the server. Signed-in customers only, with a per-person
limit. When Zammad is not configured, the form is not offered, and the failure line keeps its
present sentence. The appliance offers the form only when its owner points it at a Zammad of
their own (0129 D5, the same rule for sending anything).

**T3, the failure line.** The `unknown` remedy links to the form, with the failure's category
and reference filled in, in both languages.

**T4, the privacy policy.** A report is personal data the customer chooses to send: what is in
it, that it is kept on the owner's own Zammad in the EU, and for how long. That sentence goes in
the next pass of the lawyer drafts, like 0110 T6's.

## 4. Order

T2 and T1 together (one PR: the form has nothing to send to without the ticket), then T3, which
needs 0129 T1's reference number. T4 with the next legal pass.
