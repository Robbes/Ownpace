# Microsoft 365 — the account, the consent, the registration

The **Microsoft 365 account** card authenticates with an **app registration in Microsoft Entra ID** and a refresh token consented by the account being migrated. That card is read-only by construction: the consent asks only for the `.Read` delegated permissions listed under [With your own app](#own-app), so this product could not write to the mailbox, calendar, contacts or OneDrive even if it wanted to — an enforced guarantee, not a promise in a document. The **Via the Graph API** and **Via IMAP** cards work differently, with an administrator's registration: see [the registration these two cards need](#application).

**Most people need only the first card.** Where this service has its own registration, the wizard and the Connections page show a **Connect with Microsoft** button, and nothing under [With your own app](#own-app) is your problem. Read it if you would rather use your own registration.

## What you need {#before}

- The Microsoft account whose data moves, and its sign-in: a work or school account, or a personal Microsoft account.
- Where the organisation requires an administrator to approve applications, that administrator. The consent says so if it is needed: see [When the test reports a problem](#when-test-says).
- For the **Via IMAP** and **Via the Graph API** cards: an app registration in your own tenant, with an administrator's consent. See [the registration they need](#application).

## Connecting {#connect}

### Microsoft 365 account {#microsoft}

One Microsoft 365 account, one sign-in: mail, calendars, contacts and OneDrive, whichever you tick.

**The short way: press Connect with Microsoft.** It opens Microsoft's consent screen for the account being migrated, and when that account approves, the refresh token lands in the **Refresh token** field by itself and the connection is saved and tested in one go. Nothing is typed, and the client secret never leaves the server.

The screen asks **which account** before it asks anything else, deliberately. Without that, somebody already signed in to the wrong Microsoft account grants that one, silently, and the migration reads the wrong mailbox — a failure that looks like success until somebody notices whose mail arrived.

You can still use your own registration instead: open **Use your own app registration** and enter the Application (client) ID and client secret **as a pair**. Half a pair is refused rather than completed with this service's other half, because a client id that is not this service's paired with a secret that is would be refused by Entra at its token endpoint — hours later, from a sync pass. [With your own app](#own-app) has the steps.

#### What Test shows {#what-test-shows}

Test reads the consent back from Microsoft before it reaches anything, so the badges on the connection say which faces the account actually granted. A face you ticked lists its calendars, folders, address books or lists and shows a count; a face you did not tick shows the scope it would need and the tick that adds it — connect the account again with that face ticked. The Measured line carries what is cheap to know: the OneDrive space in use, the number of messages across the mailbox's folders, and the number of contacts per address book.

### Via the Graph API {#graph}

**Via IMAP** and **Via the Graph API** authenticate with your own registration under **application** permissions, granted by an administrator in your own tenant. That is what an administrator migrating other people's mailboxes needs, and the Microsoft 365 account card's delegated grant will never do it. The wizard asks for the mailbox address, under **Username**, and for the **Tenant ID**, the **Client ID (application ID)** and the **Client secret** of that registration.

Both cards read one mailbox's mail. Calendars, contacts, OneDrive and To Do come through the **Microsoft 365 account** card.

This card reads the mailbox through Microsoft Graph, with one Microsoft Graph permission: [Via the Graph API: the Microsoft Graph permission](#application-graph).

### Via IMAP {#oauth2}

The same four fields as **Via the Graph API**; this card reads the mailbox over IMAP. Its permission is not a Microsoft Graph one. IMAP belongs to Exchange Online, so the permission and the mailbox are given there: [Via IMAP: the Exchange Online permission](#application-imap).

### The registration these two cards need {#application}

These two cards always take a registration of your own, whatever this service carries, so its steps sit here rather than under [With your own app](#own-app). An administrator of your Microsoft 365 organisation does them once. The screens are named as Microsoft's admin centres name them in English.

1. [Entra admin centre](https://entra.microsoft.com) → Identity → Applications → **App registrations** → New registration. Choose **Accounts in this organizational directory only**, leave the redirect address empty, and register.
2. On the Overview page, copy the **Application (client) ID** and the **Directory (tenant) ID**. They go in the wizard's **Client ID (application ID)** and **Tenant ID** fields.
3. **Certificates & secrets** → New client secret. Copy the **Value** at once, because Entra shows it only once. It goes in the wizard's **Client secret** field.
4. Add the permission of the card you use, and consent to it as an administrator: the two sections below have the steps. An application permission has no signed-in person to ask, so it works only once an administrator has consented.

No refresh token is involved: these cards sign in as the application itself, and the wizard asks for none.

#### Via the Graph API: the Microsoft Graph permission {#application-graph}

**API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**. Add:

- `Mail.Read` — "Read mail in all mailboxes": the mailbox's folders and its messages, each message as Microsoft stores it.

Nothing else: the card reads mail, and this one permission covers it. Then **Grant admin consent for** your organisation, and confirm.

**Read the width before you grant it.** As an application permission, `Mail.Read` can read every mailbox in the organisation, not only the one you type in the wizard. This service reads only the mailbox the connection names, and never writes to it. Exchange Online can instead give an application `Mail.Read` over named mailboxes only; Microsoft documents this as Role Based Access Control for Applications in Exchange Online. That replaces this step rather than narrowing it: a `Mail.Read` consented here reaches every mailbox whatever Exchange says, so an administrator who wants the narrower route does not grant `Mail.Read` here, and assigns Exchange's application role with a scope instead.

#### Via IMAP: the Exchange Online permission {#application-imap}

This card signs in to Exchange Online's IMAP server as the application. Such a token carries only permissions given on **Office 365 Exchange Online**, so a Microsoft Graph permission, whatever its name, does nothing for it.

1. **API permissions** → **Add a permission** → **APIs my organization uses** → search for **Office 365 Exchange Online** → **Application permissions**. Add:

- `IMAP.AccessAsApp` — IMAP access to mailboxes, as the application.

2. **Grant admin consent for** your organisation, and confirm.
3. Register the application in Exchange Online. An Exchange administrator does this in Exchange Online PowerShell, after `Install-Module -Name ExchangeOnlineManagement` once:

```
Connect-ExchangeOnline -UserPrincipalName <your administrator address>
New-ServicePrincipal -AppId <Application (client) ID> -ObjectId <Object ID of the enterprise application>
```

The Object ID is the one on the Overview page of the application under **Enterprise applications**, not the one under **App registrations**. With the wrong one, the card's sign-in fails.

4. Give the application the mailbox the card reads. `Get-ServicePrincipal | fl` shows the service principal you just registered and its identity:

```
Add-MailboxPermission -Identity <the mailbox address> -User <the service principal's identity> -AccessRights FullAccess
```

Repeat step 4 for each mailbox the card should read. FullAccess is the permission Microsoft documents for this, and it would let an application change the mailbox as well as read it. So for this card, read-only is a property of this service, not something Microsoft enforces. For **Via the Graph API** Microsoft does enforce it: `Mail.Read` can only read.

## What moves {#what-moves}

The **Microsoft 365 account** card is one connection holding one delegated grant, serving **four faces** — mail, calendars, contacts and OneDrive — whichever you tick.

**Tasks** are Microsoft To Do. Tick them and the consent asks for `Tasks.Read` as well; every To Do list becomes a task list on the target, and each task keeps its title, notes, status, importance, due date, checklist and repeat rule.

## When the test reports a problem {#when-test-says}

Two refusals are a **tenant policy**, not something to try again:

- **`AADSTS65001`** — the user or administrator has not consented. Where the tenant requires administrator approval for applications, an administrator must approve this one before the person can grant it.
- **`AADSTS90094`** — the tenant does not allow users to consent to applications at all. Only an administrator can grant it, and only after the registration is admitted to that tenant.

Both are rendered as sentences rather than codes, so the person reading them knows to ask somebody rather than to press the button again.

With your own registration, **`AADSTS700016`** — "Application with identifier '…' was not found in the directory '…'" — is the [supported account types](#own-app-account-types) setting, not a typo in the client id.

## Stopping {#leaving}

Microsoft publishes no OAuth revocation endpoint, so deleting our copy of your refresh token does not withdraw the consent at Microsoft. You remove it yourself: [My Account](https://myaccount.microsoft.com) → Privacy → **Apps and services you have given access to**.

An erasure receipt says this in as many words, because a credential we deleted and a permission still standing at the provider are two different things.

An **administrator's** consent — the one **Via IMAP** and **Via the Graph API** carry — lives somewhere else and only an administrator can remove it: Entra → Enterprise applications → Permissions.

For **Via IMAP**, an Exchange administrator also takes the mailbox back with `Remove-MailboxPermission`, and removes the application from Exchange Online with `Remove-ServicePrincipal`. Deleting the app registration stops the application from signing in at all.

## With your own app {#own-app}

### The Microsoft 365 account card, with your own registration {#own-app-account}

[Entra admin centre](https://entra.microsoft.com) → Identity → Applications → **App registrations** → New registration.

#### The radio button that matters more than anything else here {#own-app-account-types}

**Supported account types.** Choose **Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant) and personal Microsoft accounts**, unless you are deliberately building something that serves exactly one organisation.

**This is the setting that fails silently.** A single-tenant registration works for you, works in your testing, works for everyone in your own organisation — and fails for the first account in a different one, with:

```
AADSTS700016: Application with identifier '…' was not found in the directory '…'
```

which reads like a typo in the client id and is not one.

If your registration is single-tenant on purpose, type its Directory (tenant) ID in the wizard's **Tenant ID** field, so the consent runs against your directory. Leave it empty otherwise.

#### Redirect URI {#own-app-redirect}

**Web** platform, and the exact address this service answers on. It ends in:

```
/api/migrations/microsoft/callback
```

The screen shows the whole address on every attempt, so you never have to guess — press the button once and register what it prints. It must be registered **before** the first consent can work.

#### Permissions {#own-app-permissions}

API permissions → Add a permission → **Microsoft Graph** → **Delegated permissions**. Add exactly:

- `Mail.Read` — the signed-in user's mail
- `Calendars.Read` — their calendars
- `Contacts.Read` — their contacts
- `Files.Read` — their own OneDrive
- `Tasks.Read` — their Microsoft To Do lists, asked for only when Tasks is ticked
- `offline_access` — the refresh token, without which the grant dies in an hour

**Nothing else, and specifically not the `.All` variants.** `Files.Read.All` would read the whole tenant's OneDrive; `Files.Read` reads the signed-in user's own. This product migrates the account in front of it, and a token that cannot reach further is the cheapest guarantee of that.

**Do not grant admin consent here.** These are delegated permissions — the person being migrated approves them for themselves, on the consent screen, which is the point of the button.

#### The client secret {#own-app-secret}

Certificates & secrets → New client secret. Copy the **Value** immediately; Entra shows it once. The **Application (client) ID** on the Overview page is the other half. Enter both in **Use your own app registration**, and press **Connect with Microsoft**.
