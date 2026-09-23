# Workplan 0130 — A problem report that reaches a person

## Status — 2026-09-23 (update this block at the end of every session)

**2026-09-23: opened from the owner's answers.** The owner asked: *"Is there a way people the use
Ownpace can report issues/bugs? What EU based product do you suggest we use? Creating form
scratch seems not smart. Id like to be able to see the issues, be able to contact a user with
questions/more info, and help out. These might be operational with customer data, so i think
GitHub issues it not the right place... Devs will find there own way to GitHub issues section.
Perhaps something that enables users to register the URL they on, the error they see
(screenshot or similar)"*. The recommendation was Zammad, open source and made in Germany, and
two questions went back. Both were answered (§2). Nothing is built yet.

| Task | Status | Notes |
|---|---|---|
| T1 A report form in the app | 📋 **Decided 2026-09-23** (D2) | §3. What the person writes, the page they are on, the error they see, and a screenshot if they add one. |
| T2 The report becomes a Zammad ticket | 📋 **Decided** (D1) | §3. Created by the API on the owner's own Zammad, so a reply reaches the person by email. |
| T3 The failure line that says "send it to us" opens the form | 📋 **Decided** (D2) | §3. With the failure's category and reference already filled in. |
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
