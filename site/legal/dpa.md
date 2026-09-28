<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!--
  DRAFT FOR LEGAL REVIEW — v0.2, 2026-09-28 (v0.1, 2026-08-30). Not published,
  not linked from the site, not yet offered to anyone. English only on purpose: the DPA is a
  business instrument (privacy §3 carries the household case in the policy
  itself), and business customers of an NL entity operating EU-wide sign the
  English text. This file is the draft behind the "available on request"
  sentence in privacy §3 and terms §4; 0086 T5 owns publishing it.

  NOT PART OF THE ALPHA. The Alpha admits households only ("tester:
  households only for now.", workplan 0139 open question 6, 2026-09-28), so
  this agreement is part of no Alpha contract, and nothing here blocks the
  first invitation.

  UNPUBLISHED UNTIL THE FIRST BUSINESS CUSTOMER (the owner, 2026-09-28,
  dpa-unpublished-until-business (a)). If a business asks during the Alpha,
  the answer is that businesses cannot join yet. Before the first business
  customer, one pass: fix the known errors below, settle the lawyer's
  questions, add a Version line, and publish it with the sub-processor list
  (subprocessors.md, rec-subprocessors-url (a)).

  What changed in v0.2 (2026-09-28), from decided facts only:

  - Annex A's retention. Credentials are kept until the connection or the
    migration that holds them is deleted; after the account closes nothing
    uses them, and they are destroyed when its data is erased (the owner, 0139
    open question 3 (a): "keep until deleted or closes"; the terms §11 and the
    Alpha conditions §10 say the same). It said "until the migration ends".
    "After the account closes nothing uses them" is not yet fully true, and is
    on the list below. Preflight counts go with their migration, as privacy
    §4.3 and the code say. It said "30 days if no customer relationship
    follows".
  - The service's mail goes through a provider in Switzerland, which has an
    EU adequacy decision (workplan 0133: Proton AG, which also hosts the
    support mailbox). §8, §12 and Annex A said "EU only"; §12 is retitled.
  - Annex B: deletion at the target names auto-applying relocations
    (ADR-0031), as terms §2 does since v1.3.

  The owner's answers of 2026-09-28, applied the same day. v0.2 is edited in
  place, as the other drafts are; the owner reviews it in the pull request.

  - The parties (fact-vat (a), fact-trademark (b)): Archico B.V., trading as
    Ownpace, KvK 73922706, VAT NL8597.110.06.B01 (written as the owner gave
    it). The address stays the token «REGISTERED_ADDRESS», not rendered:
    rec-address (c) leaves it out of privacy §1 and terms §1 and §15 during
    the Alpha only, and this DPA is for business customers, who come after
    it (the comment beside the parties). The trade name: the owner's option
    says the KvK extract lists it; not checked here.
  - §4 (dpa-q5 (b)): special categories can also appear in the item names the
    ledger keeps. Those names are protected like the rest, used to recognise
    each item across passes and to show which item a record is about, and
    deleted with the migration (item.display_name and natural_key sit under
    the item table's row security and go with the migration:
    packages/ledger/migrations/0050, and privacy §4.2 and §9). A file has no
    display_name: its path is its key, and the hash derived from it is the
    handle for every lookup (0050). Annex A's rows say the same.
  - §10 (dpa-q3 (c)): a short return clause. On request before deletion, the
    controller gets the migration records first. The app has no export, so
    this is made by hand. The owner: "We need to add a workplan that builds
    this feature". Workplan 0155 builds it (docs/workplans/0155-the-
    migration-records-handed-over.md).
  - §11 (dpa-q4 (b)): written answers are free; the controller pays Ownpace's
    reasonable costs of an on-site audit.
  - §12 (dpa-q1 (c)): names Proton AG and the adequacy decision (Art. 45;
    Commission Decision 2000/518/EC, as privacy §8 now cites it,
    privacy-switzerland-wording (b)), and adds a clause: any later transfer
    outside the EU gets notice under §8 and the standard contractual clauses
    first. A new mail provider now means a change to this DPA, not only to
    the list.
  - §13 (dpa-q6 (a)): data-protection claims between the parties fall under
    the terms' cap for business customers, as terms §10 now says; the data
    subjects keep their rights in full.
  - Annex B (dpa-q7 (b)): four items drafted for the lawyer: the machine,
    administrative access, incidents, and copies. Each says only what the
    repository or the owner's facts prove; "Open" marks the rest.
  - §8 unchanged: general written authorisation, as drafted (dpa-q2 (a)).
  - NetBird (dpa-netbird (a), dpa-netbird-agreement (a)): no wording change.
    Recorded: NetBird GmbH ends TLS in front of the machine, and its
    data-processing agreement is accepted (the owner, 2026-09-28; the date
    of acceptance not given). The owner: "NetBird GmbH ("NetBird")
    terminates the TLS, and uses WireGuard tunnel with the backend towards
    the hosting provider." There is no hosting provider: the owner keeps and
    runs the machine for Archico B.V. (subprocessors-machine-housed (a)).
    NetBird GmbH is in Germany (the owner; its imprint: Berlin), and
    subprocessors.md lists it. §8's and §12's sentences, that sub-processors
    process in the EU, hold for NetBird only once where its proxy and its
    access log run is recorded: no NetBird source read on 2026-09-28 states
    it (the to-do on NetBird, below).

  Still to do, in the one pass before a business customer is admitted:

  - Annex B, the NetBird line (dpa-netbird (a)): connections to the service
    are encrypted up to NetBird, which ends TLS and carries them on to our
    machine through an encrypted tunnel (WireGuard). NetBird's documentation
    says so for HTTP services: "The proxy terminates TLS at the edge", then
    "forwarded through an encrypted NetBird tunnel to the target peer"
    (https://docs.netbird.io/manage/reverse-proxy). Its certificates:
    "NetBird Cloud issues certificates through ZeroSSL on all shared proxy
    clusters, and ZeroSSL certificates are signed by Sectigo"
    (manage/reverse-proxy/custom-domains). Who holds the certificate's key,
    and where, is not stated. Its trust center's "TLS 1.2 or newer" is a
    company-wide control that does not name the proxy, so the line claims
    no TLS version for NetBird's side.
  - Annex B against privacy §11 as its own pass words it, and against the
    code: row security binds the application's requests and, since #1323
    (d0138607, merged into this branch in c1413b53), the per-tenant background
    tasks, not yet the scheduled jobs that span organisations (workplan 0138
    T2 and T3 step 2 move them, on a branch of their own, not merged); the
    support views pass it by design, each with an operator check. Annex B's
    "Tenant isolation enforced in the database itself" says none of these
    limits yet, and its "database roles hold least privilege" does not hold
    for those jobs, which connect as the database owner, a superuser, nor for
    any task run, which still receives the owner's connection string and opens
    its audit key's pool on it, until 0138 T3 step 2 (SECURITY.md;
    deploy/compose/set-task-env.sh; apps/worker/src/jobs/task-pools.ts). The
    API's migrations and its audit key's pool also connect as the owner
    (docs/rls-guide.md, "Where row security holds today"). The encryption key
    is held apart from the database, but on the same machine; logs can hold
    folder and file names, addresses and provider error text; no code was
    found that reports the negotiated TLS version.
  - Annex B's drafted items: settle each "Open", or take its sentence out.
  - §5 against privacy §4.5: the owner's direct access to the database is
    not recorded (the owner confirmed privacy §4.5's sentence, 2026-09-28,
    privacy-db-access-sentence (a)). §5 must say which access is logged.
  - Annex A's held data, beside the item names it now has: the provider's
    error text, the list of what was shared (other people's addresses; it
    goes with its migration once privacy-sharing-list (b) is built), and the
    audit log.
  - "After the account closes nothing uses them" (Annex A): since #1320
    (d7868276, 2026-09-28), merged into this branch in c1413b53, nothing new
    starts once the account is closed. Work already running is not all
    stopped: a sync pass or a discovery stops before its next data type, and
    a verification or a confirmation already running reads to its end with
    the stored access (terms briefing, precondition B, not fully done).
  - The Status line becomes a Version line the site build can read (0139
    T2), «REGISTERED_ADDRESS» is filled with the address privacy §1 and
    terms §1 print by then, and «SUBPROCESSORS_URL» loses its backticks,
    before 0086 T5 publishes this.
  - NetBird, for §8, §12 and subprocessors.md: privacy's to-do on NetBird,
    questions (a) to (e): the date its agreement was accepted; its
    data-processing agreement (a PDF on https://trust.netbird.io, not
    restricted, not downloadable from here), read for the proxy, its
    sub-processors and how a new one is announced; the country and provider
    of the proxy and its access log; whether any of NetBird's own
    sub-processors receives either; and no NetBird sign-in on app., id.,
    status. and www.ownpace.eu. On 2026-09-28 app., id. and
    status.ownpace.eu resolved to NetBird's cluster eu1.netbird.services;
    NetBird's documentation calls the cluster "eu" and names no country,
    and its terms §3.1 promise no "specific geographic routing". Its trust
    center lists 18 sub-processor entries, each with no location. If the
    proxy, its log or one of those sub-processors reaches a third country,
    §12 names it.
  - The export the return clause in §10 needs: workplan 0155 (the owner's
    note on dpa-q3), before the first business customer.

  Questions for the reviewing lawyer. The owner chose on 2026-09-28; what is
  left is the lawyer's reading.

  1. §12 (dpa-q1: (c), Proton named, a clause for later transfers). Is the
     adequacy decision enough for Proton, and is the clause right? It says
     standard contractual clauses for any later transfer, also to a country
     with an adequacy decision.
  2. §8 (dpa-q2: (a), general written authorisation). Confirm it for a
     service this small. Are NetBird's and Proton's agreements "no weaker
     than this DPA's"? NetBird's is a PDF on https://trust.netbird.io; the
     owner downloads it for this review, because it could not be read here.
  3. §10 (dpa-q3: (c), a return clause). Does it meet Art. 28(3)(g)?
  4. §11 (dpa-q4: (b), the controller pays for an on-site audit). Are the
     costs limited enough that the right to audit stays real?
  5. §4 (dpa-q5: (b), reworded). Is this the right way to carry Art. 9 in a
     processor DPA, now that subjects and titles are stored? The household
     side is privacy's question on legal bases (privacy-bases-special-
     category (a), left for the lawyer).
  6. §13 (dpa-q6: (a), one cap). Confirm the cap on data-protection claims
     between the parties beside Art. 82.
  7. Annex B (dpa-q7: (b), four items drafted). Review them. Anything else a
     controller's DPO will expect?
-->

# Data-processing agreement

**Status:** draft v0.2 (for legal review — not yet published or offered; see `site/legal/README.md`)
**Last updated:** 2026-09-28

<!-- «REGISTERED_ADDRESS» stays here, not rendered, like «SUBPROCESSORS_URL». rec-address (c)
     (the owner, 2026-09-28) leaves the address out of privacy §1 and terms §1 and §15 during the
     Alpha only. This DPA is for business customers, who come after the Alpha, when the address
     returns (before the first paid tier, after the lawyer's pass). The token is filled before
     0086 T5 publishes this. -->

This data-processing agreement ("DPA") forms part of the agreement between Archico B.V.,
trading as Ownpace, «REGISTERED_ADDRESS», registered under KvK number 73922706, VAT number
NL8597.110.06.B01 ("Ownpace", the **processor**), and the business customer accepting the
[terms of service](./terms.md) (the **controller**), for the processing of personal data
described in Annex A. This DPA applies to business customers only: for a private individual's
migration, the [privacy policy](./privacy.md) §3 states the roles and carries these commitments
directly.

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

## 4. Categories of data, and special categories

The categories of data subjects and personal data are in Annex A. Ownpace does not seek
special categories of data (Art. 9). But a mailbox contains what it contains. Such data may
pass through the migration **in transit, uninspected**, to the target the controller chose.

It can also appear in the **name of an item** that the migration ledger keeps: a message's
subject, an event's or task's title, a contact's name, a file's name or path. Ownpace protects
those names like all other personal data it holds (Annex B). It uses them to recognise each
item across passes and to show the controller which item a record is about, and deletes them
with the migration (Annex A).
Ownpace does not process content beyond the transfer itself.

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
the **European Union**, except the provider that sends the service's mail, which is in
**Switzerland** (§12).

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
where the provider supports it, the ledger deleted in full.

<!-- dpa-q3 (c), the owner, 2026-09-28. The app has no export yet: Ownpace makes these records
     by hand from the database. Workplan 0155 builds the export (the owner's note), before the
     first business customer. Terms §11 promises the same records if the service is
     discontinued. -->

**If the controller asks before the deletion, Ownpace first sends the controller its
migration records**: what was copied, what could not be, and why. Ownpace then deletes
everything as above.

Ownpace's offboarding produces an **erasure receipt** recording what was removed. Invoices and
the usage figures under them are retained only as EU or member-state law requires (Annex A).

## 11. Audits

Ownpace makes available the information necessary to demonstrate compliance with Art. 28:
written answers to reasonable audit questionnaires, the erasure receipts, the published
security posture — and the source code itself, which is public. **These cost the controller
nothing.**

The controller (or a mandated auditor who is not a competitor) may also audit on site, on at
least 30 days' notice, during business hours, at most once per year absent a concrete
indication of non-compliance. For an on-site audit, the controller bears its own costs and
**pays Ownpace's reasonable costs**.

## 12. Transfers outside the European Union

Ownpace processes and sub-processes the controller's personal data in the **European Union**,
with one exception. **Proton AG**, which sends the service's mail and hosts its support
mailbox, is in **Switzerland**. The European Commission has decided that Switzerland protects
personal data adequately (Art. 45 GDPR; Commission Decision 2000/518/EC). That decision is the
basis for that transfer, and no other transfer mechanism is relied on. Ownpace transfers none
of the controller's personal data to any other third country.

**Before any later transfer outside the European Union**, Ownpace gives the controller notice
under §8, and puts the standard contractual clauses adopted by the European Commission in
place with the recipient.

Writing to a migration **target** outside the EU happens only where the controller designated
that target. That is the controller's own instruction and the controller's own transfer, shown
before anything is written.

## 13. Liability, precedence, duration

Liability between the parties follows the terms, including their cap for business customers:
the amount the controller paid Ownpace in the twelve months before the claim (terms §10). That
cap **also applies to claims about data protection** between the parties. It does not limit
the rights the GDPR gives data subjects (Art. 82), or any liability the law does not allow to
be limited. Where this DPA and the terms conflict about the processing of personal data,
**this DPA prevails**. This DPA lasts as long as the processing does and §10 survives its end.

## Annex A — details of the processing

| | |
|---|---|
| **Data subjects** | The controller's users whose accounts are migrated; their correspondents; any person appearing in migrated content |
| **Personal data — content in transit** | Mail (bodies, attachments, headers), contacts, calendar entries, files — transferred source → target, never warehoused |
| **Personal data — held** | Account credentials for source and target (encrypted, Annex B); the migration ledger: source-assigned identifiers, hashes of identifier and content, sizes, folder and collection names, each item's name (a message's subject, an event's or task's title, a contact's name, a file's name or path), timestamps, outcomes; preflight counts and per-folder aggregates |
| **Special categories** | Not sought; may occur inside migrated content and pass through uninspected, and may appear in the item names the ledger keeps (§4) |
| **Processing operations** | Read source, write target, keep the ledger, report progress |
| **Duration & retention** | Credentials: until the controller deletes the connection or the migration that holds them; after the account is closed nothing uses them, and they are destroyed when its data is erased, at the end of the period the controller chose. Ledger, item names included: deleted with the migration. Preflight counts: with the migration they were counted for. Invoices and underlying usage figures: 7 years (Dutch tax law) |
| **Location** | European Union; the service's mail through Proton AG, in Switzerland, on an EU adequacy decision (§12) |

## Annex B — technical and organisational measures

- Credentials encrypted at rest with **AES-256-GCM** under a key held separately from the
  database.
- **TLS 1.3** to the major providers; TLS 1.2 with modern ciphers as the floor elsewhere; the
  negotiated version reported, not assumed.
- Tenant isolation enforced **in the database itself** through row-level security, not only in
  application code; database roles hold least privilege, with mutation rights revoked where a
  record's integrity demands it (append-only evidence logs; issued invoices).
- Source connectors hold **no write path to the source**. Deletion at the target only through
  opt-in paths: a per-item approval, and, only where the controller also opts in, the
  unattended removal of the old copy of a file moved at the source, after strict checks.
  Deletions are never applied unattended.
- The migration ledger holds **metadata, not content**: no bodies, no attachments, no file
  contents.
- Logs written to exclude credentials, folder names and message subjects; support access to
  customer-visible data is itself logged (§5).
- A **forget-me** path removes a tenant's data and produces an erasure receipt; an
  end-of-service procedure exists in the repository before it is needed.
- The software is **open source (Apache-2.0)**: the measures above are inspectable in code.

<!-- Drafted 2026-09-28 for the lawyer's review (dpa-q7 (b), the owner). Each item says only
     what the repository or the owner's facts prove. "Open" marks what is not proven: settle it,
     or take the sentence out, before this DPA is offered. Sources: the machine, the owner's
     answers of 2026-09-28 (subprocessors-machine-housed (a); the Netherlands); ports,
     docs/managed-bring-up.md ("Which address a port answers on") and
     scripts/a-port-published-on-purpose.unit.test.ts; one administrator, docs/incident-runbook.md
     (0142 D1: "Nobody else is on the machine or the mesh"); direct database access, privacy §4.5
     (privacy-db-access-sentence (a)); incidents, docs/breach-procedure.md (§5: "A business
     tester under the data-processing agreement is the controller of its own people's data:
     tell it, and it decides about its people (the agreement's §7).") and
     docs/incident-runbook.md; the copy, privacy §9 and rec-copies (a), not built yet. -->

**Drafted for review: the machine, administrative access, incidents, copies.**

- **The machine.** The service runs on one machine in the Netherlands. Ownpace keeps and runs
  it itself; no hosting company houses it or can log in to it. The database, the API's
  internal port and the task runner's API answer only on the machine itself. Other ports
  answer only where a public name, or the administrator's own private network, needs them.
  *Open:* whether the machine's disks are encrypted, and how the place it stands in is
  secured; that the live machine's settings match the setup guide on the ports.
- **Administrative access.** One person administers the machine, the sign-in service and the
  private network the machine is on. The support screens record each look at a customer's
  account (§5). Direct access to the database, to run and repair the service, is not
  recorded. *Open:* how the administrator's own accounts are protected, such as a second
  factor, and key-only access to the machine.
- **Incidents.** A written procedure covers a suspected personal-data breach: contain it, keep
  the evidence, assess it, notify, and register every breach. For a business customer, the
  procedure tells the controller, which decides about its own people (§7). A status page
  watches each part of the service, and can mail an alert when a part stays down for three
  minutes. *Open:* a timing and a template for the notice to a controller: the procedure's
  template is for a tester, and the step that tells a controller is the one for a high risk,
  while §7 covers every breach that affects the controller's data; that the alert is switched
  on for the live service.
- **Copies.** There are no backups. Right before an update, one copy of the databases is made,
  to undo a failed update. It stays on the machine, and is deleted once the update works, and
  never later than 7 days. *Open:* the script that makes and deletes this copy is not built;
  until it is, this is done by hand.

## Annex C — sub-processors

The list at `«SUBPROCESSORS_URL»`; until published, [subprocessors.md](./subprocessors.md) in
this repository, and on request at support@ownpace.eu.
