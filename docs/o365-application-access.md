# Reading shared mailboxes: application permissions on the O365 tenant

**Who this is for:** the person with Global Administrator on the Microsoft 365
tenant being migrated *away from*. It takes about fifteen minutes, most of it
waiting for a policy to take effect.

**Why it is needed.** Every connector in this product reads `/me/...` — the
mailbox of the user who signed in. A **shared mailbox has no user to sign in
as**, and a distribution list has no mailbox at all. Reading them means asking
Graph for `/users/{address}/...`, which requires *application* permissions and
an administrator's consent (SAD §14.3, ADR-0006).

**Owner decision 2026-08-03:** grant these on the **test tenant**, scoped by an
Application Access Policy to named mailboxes. Not tenant-wide.

---

## What you are granting, in plain terms

An application permission is not "this app can act for the user who signed in".
It is "this app can act **without any user**, against the whole tenant". That
is why the Application Access Policy in step 4 is not optional here: it is what
turns *the whole tenant* into *these three mailboxes*.

Concretely, after step 3 and before step 4, the app registration can read every
mailbox in the tenant. After step 4 it can read only the members of the mail-
enabled security group you name. **Do not stop after step 3.**

Everything below is read-only. No permission here grants write access, and the
product does not write to the source in any case (hard rule 2).

---

## 1. The app registration

You almost certainly already have one — it is what the existing OAuth
connection uses. Reuse it; a second registration means a second consent and a
second set of credentials to rotate.

Azure portal → **Microsoft Entra ID** → **App registrations** → your app.
Note the **Application (client) ID** and the **Directory (tenant) ID**.

## 2. Add the application permissions

**API permissions** → **Add a permission** → **Microsoft Graph** →
**Application permissions**. Add exactly:

| Permission | What it is for | Needed by |
|---|---|---|
| `Mail.Read` | Read the shared mailbox's messages | Pattern S (0027 T3) |
| `Group.Read.All` | Enumerate distribution lists and mail-enabled groups, with their members | Pattern D (0027 T2), discovery (0027 T1) |
| `User.Read.All` | Enumerate mailboxes, so a NEW one can be noticed | the `new_mailbox` detector (0028 T2) |

Add nothing else. If a step later seems to need a further permission, that is
worth a conversation rather than a click — every extra application permission
is tenant-wide until an access policy narrows it, and `Mail.ReadWrite` in
particular would hand this app the ability to modify the system you are
migrating away from.

## 3. Grant admin consent

Still on **API permissions**: **Grant admin consent for {tenant}**, then
confirm. The three rows should show *Granted for {tenant}* with a green tick.

**At this moment the app can read every mailbox in the tenant.** Continue
directly to step 4.

## 4. Scope it down — the Application Access Policy

This is the step that makes the grant safe. It is PowerShell only; there is no
portal equivalent.

```powershell
# One-time: the Exchange Online module, and a connection as an admin.
Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser
Connect-ExchangeOnline -UserPrincipalName you@yourtenant.nl

# 4a. A mail-enabled security group naming the mailboxes the app may read.
#     Membership of THIS group is the app's entire reach.
New-DistributionGroup -Name "OpenMigrate Scope" `
  -Alias openmigrate-scope `
  -Type Security `
  -Members "gedeeld@yourtenant.nl","info@yourtenant.nl"

# 4b. The policy itself. AppId is the Application (client) ID from step 1.
New-ApplicationAccessPolicy `
  -AppId "00000000-0000-0000-0000-000000000000" `
  -PolicyScopeGroupId openmigrate-scope@yourtenant.nl `
  -AccessRight RestrictAccess `
  -Description "Open Migrate: read only the mailboxes in OpenMigrate Scope"
```

**Give it up to an hour.** The policy is evaluated by Exchange Online and does
not apply instantly. Testing in the first minutes will show the *pre-policy*
behaviour, which is exactly the thing you do not want to conclude is fine.

## 5. Prove both halves

Prove the policy **allows** what it should and **refuses** what it should not.
One test without the other proves nothing:

```powershell
# Should return AccessCheckResult: Granted
Test-ApplicationAccessPolicy -Identity gedeeld@yourtenant.nl `
  -AppId "00000000-0000-0000-0000-000000000000"

# Should return AccessCheckResult: Denied  ← the half people skip
Test-ApplicationAccessPolicy -Identity someone.else@yourtenant.nl `
  -AppId "00000000-0000-0000-0000-000000000000"
```

If the second returns *Granted*, the policy has not taken effect yet (wait) or
the group membership is wider than you think (check it). Do not proceed until
a mailbox outside the group is denied.

---

## Configuring the migration

A mapping reads a shared mailbox by naming it. The connectors take an optional
`mailbox` address; leaving it unset keeps the existing delegated `/me`
behaviour, which is what every current mapping does.

```json
{
  "source": {
    "type": "graph-mail",
    "tenantId": "yourtenant.onmicrosoft.com",
    "mailbox": "gedeeld@yourtenant.nl"
  }
}
```

`graph-calendar` and `graph-contacts` take the same field. Omit `mailbox`
entirely to keep the delegated `/me` behaviour — that is what every mapping
written before this feature does, and it is unchanged.

**The two flows are not interchangeable, and naming a mailbox picks one.** The
worker builds a delegated token when `OAUTH2_REFRESH_TOKEN` is set and an
application token from `OAUTH2_CLIENT_SECRET` otherwise. A mapping that names
a mailbox while a refresh token is present is **refused at build time**, with
the reason and a pointer back to this document — because the alternative is a
bare `403` from Graph that says nothing about which flow you are on.

The address is validated before any request is built (`graph-scope.ts`): a
value that is empty or does not look like a user principal name is refused with
the reason, rather than becoming a URL that addresses the tenant's user
collection instead of one mailbox.

## Taking it back

```powershell
Remove-ApplicationAccessPolicy -Identity "<policy identity>"
```

and remove the three application permissions in the portal. Revoking consent
takes effect on the app's next token; tokens already issued remain valid until
they expire (up to an hour), which is worth knowing if you are revoking in a
hurry.

## What this does NOT grant

- **No write access.** All three permissions are read. This product never
  writes to the source (hard rule 2).
- **No access to mailboxes outside the group**, once step 4 has taken effect
  and step 5 has proven it.
- **Nothing on the target side.** The destination is reached with its own
  credentials and is operated by whoever runs it (ADR-0011).

## Status of the code that uses this

The connector side is **built and unit-tested** (workplan 0027 T0): all four
Graph sources take an optional mailbox and address `/users/{address}` when
given one. What has **not** happened is a live read against a real tenant with
a real policy in place — that is the proof this runbook exists to make
possible, and 0027 T0 stays open until it is done.
