<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!-- DRAFT — v0.2, 2026-09-28. The list behind «SUBPROCESSORS_URL» (privacy §7,
     DPA §8/Annex C). Not published or linked yet; 0139 T10 renders it, and it
     then needs a Dutch text with the same version (scripts/legal-docs.unit.test.ts
     holds every rendered legal document to one). The rule this file must keep:
     NOTHING is listed as current unless it is actually processing customer
     personal data today — a planned provider is listed as planned, and the
     README's OVH warning applies here with full force.

     What changed in v0.2, with privacy v1.2:
     - Proton AG, in Switzerland, sends the service's mail and holds the
       support mailbox (0133 Status, 2026-09-28: "I was hoping to reuse my
       proton SMTP"). It fills what «EMAIL_PROVIDER» and «EMAIL_REGION»
       stood for. "Every entry processes in the EU" no longer holds.
     - During the Alpha the service runs on a machine the owner runs (0139 D5;
       T0 fact 6: "site will first be hosted on this machine during alpha"),
       so there is no hosting row. The machine's country stays
       «HOSTING_REGION».
     - A row for the service in front of the machine that ends TLS for the
       production names, with «INGRESS_PROVIDER» and «INGRESS_REGION», as in
       privacy §7. The repository says the mesh provider terminates TLS
       (managed.yml: "netbird terminating TLS on 443"; 0091; 0132 T1e), and a
       DNS lookup found the OTA names at its hosted ingress (0139 T0 fact 1).
       The row goes if the owner says TLS ends on the machine.
     - The links name the rendered pages (.html); the DPA is not linked until
       it is published.

     Open for the owner: whether any company houses or can reach the machine,
     which would be a row here; the ingress row's entity and region, or that
     TLS ends on the machine (0139 T0 fact 1); and whether Proton's
     data-processing agreement covers the account behind support@ownpace.eu,
     and where it says Proton processes. Open for the lawyer: the adequacy wording for
     Switzerland; and Google's role for the Alpha's list of test users
     (privacy §6, §8), which decides whether Google belongs in the table, in
     the list at the bottom, or in neither. -->

# Sub-processors

**Version:** 0.2 (draft — not yet published)
**Last updated:** 2026-09-28

The parties that process personal data on Ownpace's behalf, per the
[privacy policy](./privacy.html) §7 and the data-processing agreement §8. Business customers are
notified before this list changes, with the right to object the DPA gives them; everyone else
gets the privacy policy's §13 change notice. Each entry processes in the region its row names.
Proton AG is in Switzerland, for which the European Commission has decided that it protects
personal data adequately (privacy §8).

## Current

During the Alpha no hosting provider processes data for us: the service, its databases, its
sign-in service and the website run on a machine we run ourselves, in «HOSTING_REGION»
(privacy §7). A hosting provider the service moves to after the Alpha is listed here before any
data goes there.

| Sub-processor | What they process, and why | Where |
|---|---|---|
| «INGRESS_PROVIDER» | Every request to app.ownpace.eu, id.ownpace.eu, status.ownpace.eu and www.ownpace.eu, which it carries through to our machine. It ends the encryption (TLS) of those connections, so what passes through them, sign-ins included, passes through it readable | «INGRESS_REGION» |
| Proton AG | Recipient addresses and the contents of the mail the service sends — sign-in codes, answers to requests for access, progress summaries, and notices a customer asks us to send, such as those to people files were shared with — and the support mailbox support@ownpace.eu, with everything sent to it, including problem reports and link reports during the Alpha | Switzerland (EU adequacy decision) |

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
