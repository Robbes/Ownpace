# Workplan 0130 — A problem report that reaches a person

> **In one line:** Report a problem on managed: a form that files a ticket on the owner's Zammad via `POST /api/problem-reports`, linked from the `unknown` failure remedy with its `last_error_reference`, the same helpdesk for a grant or progress link's *Report this link*, plus privacy-policy wording.

## Status — 2026-09-28 (update this block at the end of every session)

**2026-09-28: a screenshot the front door lets through.** On managed, a report with a
screenshot above about 750 KB never reached the API. The web image's nginx proxies `/api/` and
set no `client_max_body_size`, so its default of 1 MB answered with its own HTML 413 before the
API's 8 MB limit applied. No ticket was made, nothing was recorded as `report.not-delivered`,
and the form printed *"Request failed with status code 413"*. No test sent a body through the
front: the API's tests call Express directly, and the UI smoke mocks the route. Reproduced on
nginx 1.24 with the template as it was: a 2 MB report got `413 text/html`. Now
`apps/web/nginx.conf.template` sets `client_max_body_size 8m` on `/api/`, named after
`PROBLEM_REPORT_BODY_LIMIT`. On the same nginx, a 2 MB report and the largest the form can send
(a 5 MB screenshot and 5000 characters, 7.0 MB) reach the upstream, and 9 MB is still refused.
When any front answers 413, the form says the screenshot is too large to send and to choose a
smaller one, in English and Dutch (`report.tooLarge`).

With 8 MB let through, the route no longer parses before it knows who is sending. Its parser was
mounted on the whole router, so it read and parsed up to 8 MB before sign-in, and a body that was
not JSON became a 500 *"fault on our side"* recorded as `api.unhandled`. Now sign-in, the
helpdesk, the reply address and the hour's five come first, and a body too large is answered 413
(`report_too_large`) in JSON. Every other refusal the parser makes of what was sent is answered
with its own status as `invalid_report`: not JSON 400, a charset or a `Content-Encoding` it does
not read 415 (the review found `charset=latin1` still answered 500 and recorded as
`api.unhandled`), a body cut short 400. A 5xx the parser raises still goes to the API's handler.
The 8m stays on all of `/api/` on purpose, as the template now says: nginx takes the whole body
before the API asks who is sending, so a location of the report's own would let the same 8 MB in
unsigned.

The public ingress in front of the machine may have a body limit of its own, which this
repository cannot set: `docs/managed-bring-up.md` says to check it allows 8 MB, and 8f's test
report now sends a screenshot close to 5 MB (a request of about 7 MB) through the public name.
The API hands Zammad the same screenshot in a ticket of about 7 MB, so whatever answers on
`ZAMMAD_URL`'s name must take that too. A refusal there is answered with a reference and
recorded as `report.not-delivered`, with `Zammad answered 413` in the API's log line, and 8f now
says which of the two fronts each sign points to. 0131 T5's row for this plan carries the same
check. The form waits two minutes for a report (`REPORT_TIMEOUT_MS`), not the API client's 30
seconds, which needed about 1.9 Mbit/s of upstream for a report that large. When the time runs out,
the form says in English or Dutch that it cannot tell whether the report arrived
(`report.timedOut`), since the front may already have handed it on and sending it again can make
a second ticket. **Two gaps, not handled:** below about 0.6 Mbit/s of upstream a report near
7 MB still runs out of time. And a front that drops the connection instead of answering 413
leaves the form saying *Network Error*, with no hint that the screenshot was the cause. Showing
the too-large hint then would be wrong whenever the network itself was down, so it is not.

Guards: `a-screenshot-the-front-door-lets-through` (15), red on main. It reads every
`express.json`, `.raw`, `.text` and `.urlencoded` in `apps/api/src` and refuses a body read any
other way it could miss (a parser imported by name or from `body-parser`, another body-reading
package, the request stream read by hand). For each route whose parser takes more than nginx's
default, it knows the URI (today the report's alone) and checks the location nginx would choose
for it, in every nginx config under `apps/` and `deploy/`: exact, else the longest prefix unless
`^~` or a regex comes first, nested locations likewise. So 8m on `location = /api/problem-reports`
alone passes too; the guard as first written refused it. It also holds the parser to the
largest report there is, which nothing did: the review found `PROBLEM_REPORT_BODY_LIMIT` at
'6mb' and the form's own `MAX_SCREENSHOT_BYTES` at 10 MB both passing every test. The largest
report `parseProblemReport` takes (a 5 MB screenshot, 5000 characters of description and 2000 of
page, each character one JSON writes as six bytes: 7.03 MB) must fit the route's limit, one byte
or character more in any field must be refused, and the form's `MAX_SCREENSHOT_BYTES` and
description `maxLength` must be the API's. The API's `a-report-that-reaches-a-person` goes from
25 to 35, with a route test that posts the largest report the form sends and gets 201, and the
web app's from 7 to 16. `scripts/lessons.mjs` now indexes `.template`
files and Dockerfiles, so `docs/LESSONS.md` files this guard under the template it protects. 29
mutations, all killed: 11 on the first version, then 5 on the route, 11 on the guard and the
template, 2 on the index. One, the Dutch sentence left in English, died only once a test pinned
the Dutch; another, a nested location's `proxy_pass` counted as its parent's, only once a case
pinned it. The review round added 22 more: 20 killed, among them the limit at '6mb', the form's
screenshot at 10 MB and its `maxLength` at 10000, the page cap at 4000, the 4xx branch gone, a
5xx answered as the sender's, the report's own timeout gone or 30 seconds, and the Dutch left in
English. The two that survived were conditions no test could tell apart (a 400 floor no
body-parser error goes under, and a "not JSON" branch the 4xx one now covers), and both were
removed.

**2026-09-24: a link holder can report too (workplan 0108 T8 (d)).** The owner decided that
*"report this link"* goes to this form's helpdesk. The grant and progress pages offer it when
a Zammad is set up, with no account: what makes the person doubt the link, and an address to
reply to. It becomes an internal note on a ticket, with the facts from the link's own rows.
Three a day per link, thirty an hour for every link. The details are in 0108's status entry of
the day. T4 now covers these reports too: the privacy policy names what they carry.

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

**2026-09-23, T3 built: "send it to us" opens the form.** The `unknown` remedy is followed by
**Send it to us** (*Stuur het ons*), a link to the report form with the page, the category and,
on the progress strip, the failure's reference. The form states all three before anything is
sent, and checks each again. It is on every customer screen that shows the sentence: the
progress strip, a failed item's line, the failure groups and Connections. It is not on the
operator's Support screen, since the operator is who receives the report. The link is offered
only where a report can reach somebody: on managed, when the service takes reports, with the
same cached answer as the link beside Sign out. The appliance has no form. Guards:
`a-failure-that-says-send-it-to-us` in the web app (7); 7 mutations, all killed.

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
| T3 The failure line that says "send it to us" opens the form | ✅ **Built 2026-09-23** (D2) | §3. With the failure's category and reference already filled in, wherever the `unknown` remedy is shown to a customer. |
| T4 The privacy policy names support requests | 📋 **Proposed** | §3. What is sent, where it is kept, for how long. Link reports too (0108 T8 (d)): what the person wrote and, if they want an answer, a reply address, from somebody who has no account. |

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
