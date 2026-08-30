<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!--
  DRAFT FOR LEGAL REVIEW — v0.1, 2026-08-30. Not published, not linked from
  the site, not yet offered to anyone. English only on purpose: the DPA is a
  business instrument (privacy §3 carries the household case in the policy
  itself), and business customers of an NL entity operating EU-wide sign the
  English text. This file is the draft behind the "available on request"
  sentence in privacy §3 and terms §4; 0086 T5 owns publishing it.

  Questions for the reviewing lawyer:

  1. §12 — we claim no third-country transfers by us, ever, so no SCCs and
     no transfer annex. Is stating the negative enough, or does the DPA need
     the conditional machinery anyway?
  2. §8 — general written authorisation for sub-processors with a published
     list and prior notice. Right choice for a service this small, or should
     specific authorisation be offered as an option?
  3. §10 — "return of data" is answered structurally: content was never
     warehoused, and the controller already holds the only copy that exists,
     in their own target account. Does that satisfy Art. 28(3)(g) as worded,
     or does the clause need a formal return-on-request limb regardless?
  4. §11 — the audit clause leans on the source being public plus written
     answers, with on-site audits at cost. Proportionate and valid?
  5. §4 — special categories: not sought, but a mailbox contains what it
     contains; we transfer without inspecting. Is the incidental-transit
     sentence the right way to carry Art. 9 exposure in a processor DPA?
  6. §13 — liability follows the terms' cap. Confirm that referencing the
     commercial agreement's cap is sound beside Art. 82's own allocation.
  7. Annex B mirrors privacy §11 and the codebase's actual measures. Anything
     a controller's DPO will expect that is missing?
-->

# Data-processing agreement

**Status:** draft v0.1 (for legal review — not yet published or offered; see `site/legal/README.md`)
**Last updated:** 2026-08-30

This data-processing agreement ("DPA") forms part of the agreement between
«LEGAL_ENTITY», «REGISTERED_ADDRESS» ("Ownpace", the **processor**) and the business customer
accepting the [terms of service](./terms.md) (the **controller**), for the processing of
personal data described in Annex A. It applies to business customers only: for a private
individual's migration, the [privacy policy](./privacy.md) §3 states the roles and carries
these commitments directly.

## 1. Subject matter, duration, nature and purpose

Ownpace migrates the controller's mail, contacts, calendars and files from source accounts the
controller designates to target accounts the controller designates, keeps the copy in step
until cutover, and records what moved. Processing lasts as long as the agreement does, plus
the retention periods in Annex A. The processing operations are: reading the source, writing
the target, keeping the migration ledger (metadata, not content), and reporting progress to
the controller.

## 2. Instructions

Ownpace processes the personal data only on the controller's documented instructions. The
migrations the controller configures in the product **are** those documented instructions —
scope, source, target, timing and per-item approvals are all recorded configuration. Written
instructions beyond the product go to support@ownpace.eu. If an instruction in Ownpace's view
infringes the GDPR or other EU or member-state data-protection law, Ownpace informs the
controller immediately and may suspend that instruction until it is confirmed or withdrawn.

## 3. What Ownpace will not do, restated as obligations

The promises the product makes to everyone bind Ownpace here contractually: nothing is
deleted at the source; nothing flows back to the source; content is transferred, not
warehoused — no copy is kept after a migration ends; content is never used for advertising,
profiling, sale, or the training of any model; and no human reads it except on the
controller's own request for specific items, for security or legal necessity, or as
aggregated figures identifying nobody.

## 4. Categories of data — Annex A, and one honest sentence

The categories of data subjects and personal data are in Annex A. Ownpace does not seek
special categories of data (Art. 9), but a mailbox contains what it contains: such data may
pass through the migration **in transit, uninspected**, to the target the controller chose.
Ownpace applies the same protections to all content and never processes it beyond the
transfer itself.

## 5. Confidentiality

Persons authorised to process the personal data are bound by confidentiality obligations.
Access by Ownpace's own personnel to anything customer-visible is itself **logged and
reviewable** — the support read-log exists so that "we do not look" is checkable rather than
asserted.

## 6. Security

Ownpace implements the technical and organisational measures in **Annex B**, maintains them
against the state of the art, and may improve but not weaken them. The software is open
source, so the implementation of most of Annex B can be read rather than believed.

## 7. Personal-data breaches

Ownpace notifies the controller **without undue delay after becoming aware** of a personal
data breach affecting the controller's data, with the information Art. 33(3) requires as far
as it is available, supplemented as it becomes available, and assists the controller with the
controller's own notification obligations. Notification is not an acknowledgement of fault.

## 8. Sub-processors

The controller grants **general written authorisation** for the sub-processors listed at
`«SUBPROCESSORS_URL»` (until published: [the current list](./subprocessors.md), also available
on request). Ownpace gives notice **before** adding or replacing a sub-processor; the
controller may object on reasonable data-protection grounds within 30 days, and if no
workable alternative exists, terminate the affected service as the terms provide. Every
sub-processor is bound in writing to obligations no weaker than this DPA's, and Ownpace
remains fully liable to the controller for their performance. All sub-processors process in
the **European Union** (§12).

## 9. Assistance

Taking into account the nature of the processing, Ownpace assists the controller with
appropriate technical and organisational measures for responding to data-subject requests
(Arts. 15–22), and with the controller's obligations under Arts. 32–36. Where a data subject
approaches Ownpace directly about the controller's migration content, Ownpace refers the
request to the controller without undue delay. Assistance beyond what the product already
provides is charged at reasonable cost where the GDPR permits.

## 10. End of processing

At the end of the services, at the controller's choice, Ownpace deletes or returns the
personal data. The structure of the product answers most of this already: **the migrated
content exists in exactly one place Ownpace can point to — the controller's own target
account** — so "return" is a state the controller is already in, and what remains with
Ownpace (credentials, the ledger) is **deleted**: credentials destroyed and grants revoked
where the provider supports it, the ledger deleted in full. Ownpace's offboarding produces an
**erasure receipt** recording what was removed. Invoices and the usage figures under them are
retained only as EU or member-state law requires (Annex A).

## 11. Audits

Ownpace makes available the information necessary to demonstrate compliance with Art. 28:
written answers to reasonable audit questionnaires, the erasure receipts, the published
security posture — and the source code itself, which is public. The controller (or a mandated
auditor who is not a competitor) may audit on at least 30 days' notice, during business
hours, at most once per year absent a concrete indication of non-compliance, each party
bearing its own costs.

## 12. No third-country transfers

Ownpace processes and sub-processes the controller's personal data **in the European Union
only** and transfers none of it to a third country. No transfer mechanism is therefore relied
on. Writing to a migration **target** outside the EU happens only where the controller
designated that target; that is the controller's own instruction and the controller's own
transfer, shown before anything is written.

## 13. Liability, precedence, duration

Liability follows the agreement the terms establish, including its cap, to the extent the
GDPR's own allocation (Art. 82) permits. Where this DPA and the terms conflict about the
processing of personal data, **this DPA prevails**. This DPA lasts as long as the processing
does and §10 survives its end.

## Annex A — details of the processing

| | |
|---|---|
| **Data subjects** | The controller's users whose accounts are migrated; their correspondents; any person appearing in migrated content |
| **Personal data — content in transit** | Mail (bodies, attachments, headers), contacts, calendar entries, files — transferred source → target, never warehoused |
| **Personal data — held** | Account credentials for source and target (encrypted, Annex B); the migration ledger: source-assigned identifiers, hashes of identifier and content, sizes, folder and collection names, timestamps, outcomes; preflight counts and per-folder aggregates |
| **Special categories** | Not sought; may occur inside migrated content and pass through uninspected (§4) |
| **Processing operations** | Read source, write target, keep the ledger, report progress |
| **Duration & retention** | Credentials: until the migration ends or is deleted, then destroyed. Ledger: deleted with the migration. Preflight counts: 30 days if no customer relationship follows. Invoices and underlying usage figures: 7 years (Dutch tax law) |
| **Location** | European Union only |

## Annex B — technical and organisational measures

- Credentials encrypted at rest with **AES-256-GCM** under a key held separately from the
  database.
- **TLS 1.3** to the major providers; TLS 1.2 with modern ciphers as the floor elsewhere; the
  negotiated version reported, not assumed.
- Tenant isolation enforced **in the database itself** through row-level security, not only in
  application code; database roles hold least privilege, with mutation rights revoked where a
  record's integrity demands it (append-only evidence logs; issued invoices).
- Source connectors hold **no write path to the source**; deletion at the target only through
  an opt-in, per-item approval path.
- The migration ledger holds **metadata, not content**: no bodies, no attachments, no file
  contents.
- Logs written to exclude credentials, folder names and message subjects; support access to
  customer-visible data is itself logged (§5).
- A **forget-me** path removes a tenant's data and produces an erasure receipt; an
  end-of-service procedure exists in the repository before it is needed.
- The software is **open source (Apache-2.0)**: the measures above are inspectable in code.

## Annex C — sub-processors

The list at `«SUBPROCESSORS_URL»`; until published, [subprocessors.md](./subprocessors.md) in
this repository, and on request at support@ownpace.eu.
