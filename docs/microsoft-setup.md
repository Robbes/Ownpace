# Microsoft 365 setup — the registration, the radio button, the consent

A Microsoft 365 migration authenticates with an **app registration in Microsoft Entra ID**
and a refresh token consented by the account being migrated. Read-only by construction: the
registration is created with only the four `.Read` delegated permissions, so this product
could not write to the mailbox, calendar, contacts or OneDrive even if it wanted to — an
enforced guarantee, not a promise in a document.

**Most people should not need this page.** Where the deployment you use carries its own
registration (the operator sets it once — see *Configure it*), the wizard and the Connections
page show a **Connect with Microsoft** button, and nothing on this page is your problem. Read
on if you are that operator, or if you would rather use your own registration.

## 1. Create the app registration

[Entra admin centre](https://entra.microsoft.com) → Identity → Applications → **App
registrations** → New registration.

### The radio button that matters more than anything else on this page

**Supported account types.** Choose:

> **Accounts in any organizational directory (Any Microsoft Entra ID tenant —
> Multitenant) and personal Microsoft accounts**

unless you are deliberately building something that serves exactly one organisation.

**This is the setting that fails silently.** A *single-tenant* registration works for you,
works in your testing, works for everyone in your own organisation — and fails for the first
customer in a different one, with:

```
AADSTS700016: Application with identifier '…' was not found in the directory '…'
```

which reads like a typo in the client id and is not one. Nothing in the deployment's
configuration can compensate for it: `MICROSOFT_OAUTH_TENANT` chooses which *authority* the
consent runs against, and no authority will find an application the registration never
offered to that directory.

If you *are* single-tenant on purpose, set `MICROSOFT_OAUTH_TENANT` to your tenant id or
domain so the two halves agree.

### Redirect URI

**Web** platform, and the exact address your deployment answers on:

```
https://<your-api-host>/api/migrations/microsoft/callback
```

The consent route returns this string in its answer and the screen shows it on every attempt,
so you never have to guess — press the button once and register what it prints. It must be
registered **before** the first consent can work.

### Permissions

API permissions → Add a permission → **Microsoft Graph** → **Delegated permissions**. Add
exactly:

| Permission | What it reads |
|---|---|
| `Mail.Read` | the signed-in user's mail |
| `Calendars.Read` | their calendars |
| `Contacts.Read` | their contacts |
| `Files.Read` | their own OneDrive |
| `offline_access` | the refresh token, without which the grant dies in an hour |

**Nothing else, and specifically not the `.All` variants.** `Files.Read.All` would read the
whole tenant's OneDrive; `Files.Read` reads the signed-in user's own. This product migrates
the account in front of it, and a token that cannot reach further is the cheapest guarantee
of that.

**Do not grant admin consent here.** These are delegated permissions — the person being
migrated approves them for themselves, on the consent screen, which is the point of the
button.

### The client secret

Certificates & secrets → New client secret. Copy the **Value** immediately; Entra shows it
once. The **Application (client) ID** on the Overview page is the other half.

## 2. Consent, once, as the migrated account

**The short way: press *Connect with Microsoft*.** It opens Microsoft's consent screen for the
account being migrated, and when that account approves, the refresh token lands in the field
by itself and the connection is saved and tested in one go. Nothing is typed, and the client
secret never leaves the server.

The screen asks **which account** before it asks anything else, deliberately. Without that,
somebody already signed in to the wrong Microsoft account grants that one, silently, and the
migration reads the wrong mailbox — a failure that looks like success until somebody notices
whose mail arrived.

You can still use your own registration instead: open *Use your own app registration instead*
and enter the Application (client) ID and client secret **as a pair**. Half a pair is refused
rather than completed with the deployment's other half, because a client id that is not the
deployment's paired with a secret that is would be refused by Entra at its token endpoint —
hours later, from a sync pass.

### When the consent is refused

Two refusals are a **tenant policy**, not something to try again:

- **`AADSTS65001`** — the user or administrator has not consented. Where the tenant requires
  administrator approval for applications, an administrator must approve this one before the
  person can grant it.
- **`AADSTS90094`** — the tenant does not allow users to consent to applications at all. Only
  an administrator can grant it, and only after your registration is admitted to that tenant.

Both are rendered as sentences rather than codes, so the person reading them knows to ask
somebody rather than to press the button again.

## 3. Configure it (operators)

Set both halves in `deploy/compose/.env` and re-run `set-task-env.sh` — the worker needs them
too, and a deployment where the API knows the registration and the worker does not is the
worst of the possible splits:

```
MICROSOFT_OAUTH_CLIENT_ID=…
MICROSOFT_OAUTH_CLIENT_SECRET=…
MICROSOFT_OAUTH_TENANT=          # leave EMPTY for multi-tenant; see the radio button above
```

**Both or neither.** Half a pair is refused with a sentence naming the missing variable; it is
never completed from somewhere else. With neither set, every customer supplies their own
registration, which works and is exactly what the `Microsoft 365 (Graph API)` and
`Via IMAP` cards already do.

## What this kind is, and what it is not

The **Microsoft 365 account** card is one connection row holding one delegated grant, serving
**four faces** — mail, calendars, contacts and OneDrive — whichever you tick. It sits beside
two older cards that are *not* replaced:

- **Via IMAP** (`oauth2`) and **Microsoft 365 (Graph API)** (`graph`) authenticate with the
  customer's own registration under **application** permissions. That is what an administrator
  migrating *other people's* mailboxes needs, and this delegated grant will never do it.

**Tasks** are Microsoft To Do. Tick them and the consent asks for `Tasks.Read` as well; every
To Do list becomes a task list on the target, and each task keeps its title, notes, status,
importance, due date, checklist and repeat rule.

## Leaving

Microsoft publishes no OAuth revocation endpoint, so deleting our copy of your refresh token
does not withdraw the consent at Microsoft. You remove it yourself:

> [My Account](https://myaccount.microsoft.com) → Privacy → **Apps and services you have given
> access to**

An erasure receipt says this in as many words, because a credential we deleted and a
permission still standing at the provider are two different things.

An **administrator's** consent — the one `oauth2` and `graph` carry — lives somewhere else and
only an administrator can remove it: Entra → Enterprise applications → Permissions.
