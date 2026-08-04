# Migrating a shared mailbox (SAD §14.1, Pattern S)

A shared address works one of two ways, and they migrate differently:

- **Pattern S — a shared mailbox.** Several people jointly handle **one
  store**. There is a folder tree, with Sent and Drafts and Archive, and it
  has to be copied. This document is about that.
- **Pattern D — a distribution list.** Several people each receive the mail
  in their **own** mailbox. There is usually no store at all, so there is
  nothing to copy; what migrates is the list and its members, by hand. See
  the runbook at `GET /shared-addresses/runbook` (both editions), and
  workplan 0027 T2.

If you are not sure which one an address is, do not guess — discovery raises
it as a decision, and the **Needs a decision** screen asks you in those
words. Both wrong guesses cost real work: treating a shared mailbox as a
list silently leaves a mailbox full of mail behind, and treating a list as a
shared mailbox copies nothing and recreates no group, so mail sent to the
address after cutover reaches nobody.

## What makes it Pattern S, mechanically

**Nothing about the copy is different.** The full folder tree is copied
idempotently by the ordinary mail path, with the same natural keys, the same
re-run convergence, and the same verification. That is the whole point of
§14.1's Pattern S: a shared mailbox becomes an ordinary mapping.

The one thing that differs is **whose mailbox is read**. A shared store has
no interactive user to sign in as, so it cannot be reached as `/me`. It is
read as `/users/{address}`, which requires **application permissions and
admin consent** on the source tenant — see
[`o365-application-access.md`](./o365-application-access.md), including the
Application Access Policy that limits the app to the named mailboxes.

## Writing the mapping

```json
{
  "tenantId": "…",
  "mappingId": "acme-info-shared",
  "pattern": "shared_s",
  "source": {
    "type": "graph-mail",
    "tenantId": "contoso.onmicrosoft.com",
    "mailbox": "info@acme.nl"
  },
  "target": {
    "type": "jmap",
    "baseUrl": "https://…",
    "user": "info@sovereign.example",
    "auth": { "kind": "basic", "passwordFromEnv": "OPENMIG_INFO_APP_PASSWORD" }
  }
}
```

Two fields carry it:

- **`source.mailbox`** — the shared address on the source. This is what turns
  the read into `/users/{address}`. It is validated before any request is
  built: a value that is not a usable user principal name is refused with the
  reason, because an empty or malformed one would aim the request at the
  tenant's user *collection* instead of one mailbox.
- **`pattern: "shared_s"`** — optional, and a **declaration checked against
  the source**, not a switch. A mapping that declares it while its source
  names no mailbox is refused at startup: without the address the source
  reads `/me`, whoever the stored credentials belong to, and would copy the
  wrong person's mailbox into the shared target — and report success.
  Omitting `pattern` is fine; a source naming a mailbox is recorded as
  Pattern S either way.

`"pattern": "distribution_d"` is **refused**. It is a legal value in the
ledger, where `group_def` records that an address *is* a distribution list,
and an illegal one here, where a mapping for it would find no store and
report a clean, empty, successful migration.

## The target: a dedicated mailbox

The convention, per §14.1:

- **One dedicated mailbox on the target**, at its own address. Not a folder
  inside somebody's personal mailbox — a shared store that lives inside one
  person's account stops being shared the day that person leaves.
- **Team access by app passwords.** Each person who needs the shared mailbox
  gets their own app password for it, so access can be withdrawn per person
  without changing anything for the others. How people authenticate to the
  target suite afterwards is the target platform's business, not this tool's
  (SAD §2, non-goals).
- **Send-As** on the target platform, so replies leave from the shared
  address rather than from whoever typed them.
- Set the target password through `passwordFromEnv`, like every other
  mapping. Nothing here changes the secrets rules (hard rule 3).

## What to check afterwards

1. The **Check** screen (verification) compares counts and samples content
   for this mapping like any other — a shared mailbox is not exempt, and an
   unverified domain blocks cutover.
2. Send one message to the shared address on the **target** and confirm each
   person who should see it does.
3. Reply from it and confirm the reply leaves from the shared address, not
   from an individual.

## Limits worth knowing before you start

- **Discovery cannot see shared addresses over IMAP at all.** IMAP has no
  directory; it addresses one account's folders and messages. An IMAP source
  reports that it could not look rather than reporting nothing found, and
  shared addresses on such a source have to be written by hand.
- **Permissions on the source mailbox are not migrated.** Who had FullAccess
  or Send-As on the O365 side is inventoried and guided, not translated —
  §14.2, workplan 0029.
- **Nothing here is destructive.** The source is read-only throughout, and
  the target is never modified or emptied to make room (hard rule 2).
