<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!-- DRAFT — v0.2, 2026-09-28. The list behind «SUBPROCESSORS_URL» (DPA §8/Annex C). Not
     published or linked. The rule this file must keep: NOTHING is listed as current unless it
     is actually processing customer personal data today — a planned provider is listed as
     planned, and the README's OVH warning applies here with full force.

     UNPUBLISHED UNTIL THE FIRST BUSINESS CUSTOMER (the owner, 2026-09-28,
     rec-subprocessors-url (a)). During the Alpha, privacy §7's table is the complete list of
     sub-processors, and says so. This file is published with the DPA, when the first business
     customer arrives (0086 T5; dpa-unpublished-until-business (a)). It then needs a Dutch text
     with the same version (scripts/legal-docs.unit.test.ts holds every rendered legal document
     to one), and 0139 T10 renders it.

     What changed in v0.2, with privacy v1.2:
     - Proton AG, in Switzerland, sends the service's mail and holds the support mailbox (0133
       Status, 2026-09-28: "I was hoping to reuse my proton SMTP"). It fills what
       «EMAIL_PROVIDER» and «EMAIL_REGION» stood for. "Every entry processes in the EU" no
       longer holds.
     - During the Alpha the service runs on a machine the owner runs (0139 D5; T0 fact 6: "site
       will first be hosted on this machine during alpha"), so there is no hosting row.
     - A row for the service in front of the machine that ends TLS for the production names
       (managed.yml: "netbird terminating TLS on 443"; 0091; 0132 T1e).
     - The links name the rendered pages (.html); the DPA is not linked until it is published.

     The owner's answers of 2026-09-28, applied the same day. v0.2 is edited in place, as the
     other drafts are; the owner reviews it in the pull request.
     - The machine is in the Netherlands ("app/site hosting is in The Netherlands"). No company
       houses it or can reach it: the owner keeps and runs it for Archico B.V.
       (subprocessors-machine-housed (a)). No hosting row.
     - NetBird GmbH, in Germany ("through NetBird (Germany) delivers the forward proxy"). Its
       data-processing agreement is accepted (dpa-netbird-agreement (a); the date not given).
       The owner: "NetBird GmbH ("NetBird") terminates the TLS, and uses WireGuard tunnel with
       the backend towards the hosting provider." The row says it carries connections on
       through an encrypted tunnel (WireGuard), as privacy §7's row does. NetBird's own
       documentation (github.com/netbirdio/docs, manage/reverse-proxy) says the same: an HTTP
       service's TLS ends at the proxy, which forwards through a WireGuard tunnel.
     - NetBird's own log (ops-trust-proxy: the row gains it in every option). NetBird's
       documentation (manage/reverse-proxy/access-logs) lists what it logs for each request:
       the source IP address, a location derived from it, the host and path, the status, sizes
       and timing. The path holds a grant or progress link's secret. It says NetBird's cloud
       keeps these logs for 7 days. The row names the log, as privacy §7's does; the period is
       not in either text yet.
     - Proton: "yes"; the agreement is accepted for the account behind support@ownpace.eu,
       which is Archico B.V.'s, and Proton keeps the service's sent mail in it, which the row
       says. How long those copies stay is privacy §9's: the support-mail rule, until resolved
       and then 6 months (privacy-sent-mail-copies (b)). Nothing prunes them yet.
     - The opening names the adequacy decision for Switzerland (Art. 45 GDPR; Commission
       Decision 2000/518/EC), as privacy §8 does (privacy-switzerland-wording (b)).

     Open for the owner, before this file is published:
     - NetBird: the date its agreement was accepted, and where the agreement or the dashboard
       says the proxy and its log run. On 2026-09-28 app., id. and status.ownpace.eu resolved
       to NetBird's cluster eu1.netbird.services. The name suggests the EU; the country is not
       confirmed. www.ownpace.eu did not resolve to NetBird that day, although the row names
       it (0132 T1e routes it).
     - NetBird's own sub-processors, at https://trust.netbird.io. That page loads its content
       from a host the egress proxy refuses, and netbird.io is refused too. Search results
       name Apollo, Auth0, AWS, Azure, Datadog and GCP, with no locations. Check that none of
       them takes the proxy's traffic or its log outside the EU.
     - Proton: where its agreement says it processes (the Where column says Switzerland).

     Open for the lawyer:
     - Google's role for the Alpha's list of test users (privacy §6, §8), which decides whether
       Google belongs in the table, in the list at the bottom, or in neither. Left for the
       lawyer's pass (privacy-google-testlist-basis (a), 2026-09-28).
     - GitHub, for a vulnerability report sent through our form there. Privacy §8 names it as
       a route the reader chooses (privacy-other-transfers (b)); it is not listed here.
     - The adequacy wording for Switzerland (DPA question 1). -->

# Sub-processors

**Version:** 0.2 (draft — not yet published)
**Last updated:** 2026-09-28

The parties that process personal data on Ownpace's behalf, per the
[privacy policy](./privacy.html) §7 and the data-processing agreement §8. Business customers are
notified before this list changes, with the right to object the DPA gives them; everyone else
gets the privacy policy's §13 change notice. Each entry processes in the region its row names.
Proton AG is in Switzerland, for which the European Commission has decided that it protects
personal data adequately (Art. 45 GDPR; Commission Decision 2000/518/EC; privacy §8).

## Current

During the Alpha no hosting provider processes data for us: the service, its databases, its
sign-in service and the website run on a machine we run ourselves, in the Netherlands
(privacy §7). A hosting provider the service moves to after the Alpha is listed here before any
data goes there.

| Sub-processor | What they process, and why | Where |
|---|---|---|
| NetBird GmbH | Every request to app.ownpace.eu, id.ownpace.eu, status.ownpace.eu and www.ownpace.eu, which it carries through to our machine. It ends the encryption (TLS) of those connections, so what passes through them, sign-ins included, passes through it readable. It carries them on to our machine through an encrypted tunnel (WireGuard). It keeps its own log of each request, with the IP address and the page asked for, including the secret part of a link | Germany (EU) |
| Proton AG | Recipient addresses and the contents of the mail the service sends — sign-in codes, answers to requests for access, progress summaries, and notices a customer asks us to send, such as those to people files were shared with — and the support mailbox support@ownpace.eu, with everything sent to it, including problem reports and link reports during the Alpha, and a copy of each mail the service sends | Switzerland (EU adequacy decision) |

## Planned — listed before they are live, live before the first byte

| Sub-processor | What they will process | Where | When |
|---|---|---|---|
| Moneybird B.V. | Invoice data: the buyer's name, address, country and — for businesses — VAT number, as bookkeeping and invoicing system | Netherlands (EU) | Before the first real invoice is issued; this row moves up on that day |

## Parties that are not sub-processors, listed so nobody wonders

- **Mollie B.V.** (Netherlands, EU) — payments. A licensed payment institution processing your
  payment data under its own responsibility and privacy policy: an independent controller, not
  a processor acting for us.
- **Your migration's source and target providers** — your own accounts; your relationship with
  them is yours. Writing to the target you designated is your instruction, not sub-processing.
- **VIES** (the European Commission's VAT-number validation service) — when a business
  customer's VAT number is checked, that number is submitted to VIES and the answer stored as
  evidence. A public-authority service consulted under a legal framework, not a processor of
  ours.
