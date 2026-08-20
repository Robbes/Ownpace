<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->

# Privacy policy

**Applies to:** the Ownpace **managed service** at `ownpace.eu`.
**Version:** 1.0 (draft — not yet published; see `site/legal/README.md`)
**Last updated:** 2026-08-20

> **If you run Ownpace yourself**, this policy does not apply to you and there is nothing for
> us to state: the software runs on your infrastructure, your data never reaches us, and we
> receive nothing — no telemetry, no usage counts, no error reports. The source is public and
> that claim is checkable rather than promised.

---

## 1. Who we are

«LEGAL_ENTITY», «REGISTERED_ADDRESS», «COMPANY_NUMBER», «VAT_NUMBER».

**Contact for anything in this policy, including your rights under the GDPR:
support@ownpace.eu.** A person reads that address. We aim to answer within five working days
and are bound by the GDPR's one-month limit for rights requests.

## 2. What Ownpace does, because it decides everything below

Ownpace moves your mail, contacts, calendars and files from one provider to another, and keeps
the copy in step until you decide to switch over. It reads your source account, writes to your
target account, and keeps a record of what it has moved so that running it again does not
duplicate anything.

**We are not a storage service.** Your messages and files pass through the migration in order
to be written to the target you chose. We do not warehouse them, and we do not keep a copy
after a migration ends.

## 3. Two roles, and which one we are

For the **content of your migration** — your mail, files, contacts and calendar entries — you
(or, for an organisation, your administrator) are the **controller** and we are the
**processor**. We act on your instructions, which are the migrations you configure. Our
data-processing agreement is at `«DPA_URL»` and forms part of the contract for business
customers.

For your **account with us** — sign-in, billing, support correspondence — we are the
**controller**.

## 4. What we actually hold

Stated at the level the software actually works at, because a vaguer answer would be less
useful and no more honest.

### 4.1 Credentials for your accounts

Whatever is needed to read the source and write the target: an OAuth refresh token, or a
username with an app password, or a service-account key. **Encrypted at rest with AES-256-GCM**
under a key held separately from the database.

We ask for the narrowest access each provider offers. Where a provider offers nothing narrow —
Google's IMAP endpoint accepts only a scope that reads as full mail access — we say so rather
than implying otherwise. The connectors that read your mail, contacts and calendars have **no
write path to the source** at all.

You can revoke our access at your provider at any time, without asking us, and the migration
stops.

### 4.2 The migration ledger — metadata, not content

For every item we move we keep a row recording: an identifier the source already assigned it
(for mail, the `Message-Id` header), a hash of that identifier, a hash of the content, the
size in bytes, the folder or collection it lives in, timestamps, and whether the copy
succeeded. This is what makes a second run converge instead of duplicating your mailbox.

**The ledger holds no message bodies, no attachments, no file contents.** It does hold
metadata that can be revealing on its own — folder names, and hashes derived from content —
and we would rather say that plainly than describe it as "technical data".

### 4.3 What a preflight keeps

A free preflight reads your source to count what is there. It stores **counts, sizes and
per-folder aggregates** — not an inventory of individual items. Item identifiers reach the
ledger only when a real migration starts.

### 4.4 Your account and billing

Your email address, the tenant you belong to, your role, sign-in timestamps. Invoices and the
usage figures behind them — how many migrations ran at once, and how much data was moved.
Payments are handled by our payment provider (§7); **we never see or store your card details**.

### 4.5 Support and operational logs

Anything you send us at support@ownpace.eu, and server logs recording that requests happened —
timestamps, IP addresses, error codes. Logs are written so that **credentials, folder names and
message subjects do not appear in them.**

## 5. Why we hold it, in GDPR terms

| What | Purpose | Lawful basis |
|---|---|---|
| Credentials, ledger, preflight counts | Performing the migration you asked for | Contract (Art. 6(1)(b)); processed on your instructions as processor |
| Account, invoices, usage figures | Providing and billing for the service | Contract; legal obligation for invoice retention (Art. 6(1)(c)) |
| Operational logs | Keeping the service secure and working | Legitimate interests (Art. 6(1)(f)) |
| Support correspondence | Answering you | Contract / legitimate interests |

**We do not use your data for advertising, we do not profile you, and we do not sell or rent
anything to anybody.** There is no analytics tracker on the application.

## 6. Google user data — the specific commitments

Ownpace's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the **Limited Use** requirements. Concretely, and in our own words:

- We use Google user data **only** to provide the migration you configured — reading your
  source account and writing it to the target you chose — and to show you its progress.
- We **do not transfer** Google user data to anyone, except to the migration target you
  yourself selected, and except where the law requires it.
- We **do not use** Google user data for advertising of any kind.
- We **do not allow humans to read** Google user data. The exceptions are the ones the policy
  permits and no others: your own explicit request for specific items, what is necessary for
  security or to comply with the law, and aggregated figures that identify nobody.
- We do not use Google user data to train any machine-learning or AI model, general or
  otherwise.

**Google is never a migration target.** Data flows out of Google and never back in.

You can revoke Ownpace's access to your Google account at any time at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions), or by deleting
the app password you issued.

## 7. Who else touches it

| Sub-processor | What for | Where |
|---|---|---|
| «HOSTING_PROVIDER» | Running the service and its database | «HOSTING_REGION» (EU) |
| Mollie B.V. | Card and direct-debit payments | Netherlands (EU) |
| «EMAIL_PROVIDER» | Sending your progress summaries and account mail | «EMAIL_REGION» (EU) |

The current list is maintained at `«SUBPROCESSORS_URL»`. Business customers are notified before
a sub-processor is added, with the right to object as set out in the DPA.

**Your migration's source and target providers are not our sub-processors** — they are your
own accounts, and your relationship with them is yours.

## 8. Where it is, and where it is not

The service runs in the **European Union**, and so does everything in the table above. **There
is no transfer of your data to the United States or any other third country by us.**

That is the point of the product rather than a compliance line: the reason to move off a
US-hosted provider is undermined by a migration tool that is itself US-hosted, so we are not
one.

If your migration's **target** is outside the EU, your data goes there because you told it to.
We show you the target before anything is written.

## 9. How long we keep it

| What | Kept for |
|---|---|
| Credentials | Until the migration ends or you delete it — then destroyed, and the grant revoked where the provider supports it |
| The migration ledger | Until you delete the migration; deleted with it, in full |
| Preflight counts, if you never become a customer | **30 days**, then deleted automatically |
| Account and sign-in data | While your account exists, then 30 days |
| Invoices and their underlying usage figures | **7 years**, because Dutch tax law requires it |
| Operational logs | «LOG_RETENTION» |

Ownpace ships a **forget-me** path that removes a tenant's data, and an end-of-service
procedure that says what happens to everything if the service ever closes
(`docs/selfhost-ending-the-service.md`). We wrote the exit before we needed it.

## 10. Your rights

Access, rectification, erasure, restriction, portability, objection, and withdrawal of consent
where consent is the basis. Write to **support@ownpace.eu**; we will not charge you and we will
not make you explain why.

**Portability deserves a note.** This whole product exists because moving your own data between
providers is harder than it should be. If you want your data out of Ownpace, you already have
it — it is in the target account we wrote it to.

You may complain to a supervisory authority. In the Netherlands that is the **Autoriteit
Persoonsgegevens** (autoriteitpersoonsgegevens.nl).

## 11. Security

Credentials encrypted with AES-256-GCM under a separately held key. TLS 1.3 to the major
providers, TLS 1.2 with modern ciphers as the floor for everything else, with the negotiated
version reported rather than assumed. Tenant isolation enforced in the database itself through
row-level security, not only in application code. Logs written to exclude credentials and
message content.

No system is perfect. If you find a vulnerability, please write to **support@ownpace.eu**; we
will not threaten you for telling us.

## 12. Children

The service is not directed at children under 16 and we do not knowingly create accounts for
them.

## 13. Changes

Material changes are notified by email to account holders at least **30 days** before they take
effect, and every version of this policy stays available at «PRIVACY_HISTORY_URL» so you can
see what changed. The version number and date at the top of this page are the record.
