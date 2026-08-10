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

**Owner decision 2026-08-04:** add `Calendars.Read`, and **do not** add
`Files.Read.All`. The reasoning is in *[Two scopes, one
granted](#two-scopes-one-granted)* below; the short version is that the access
policy in step 4 narrows the first and cannot narrow the second.

**Practice on the coders' tenant first.** Every step here can be rehearsed
consequence-free on a synthetic tenant where you are Global Administrator —
see `docs/test-tenant.md` (owner decision 2026-08-10, two-tenant strategy).
The run that closes 0027 T0 is the one on the real tenant.

---

## What you are granting, in plain terms

An application permission is not "this app can act for the user who signed in".
It is "this app can act **without any user**, against the whole tenant". That
is why the Application Access Policy in step 4 is not optional here: it is what
turns *the whole tenant* into *these few mailboxes*.

Concretely, after step 3 and before step 4, the app registration can read every
mailbox in the tenant. After step 4 it can read only the members of the mail-
enabled security group you name. **Do not stop after step 3.**

Everything below is read-only. No permission here grants write access, and the
product does not write to the source in any case (hard rule 2).

---

## 0. Starting from zero: creating the registration

*(The guide-from-zero section promised by the 2026-08-09 per-customer model
decision — 0026 T3 row 14. Skip to §1 if your tenant already has an
Open-Migrate registration. The owner validates this section against their own
tenant; until that validation is recorded here, treat it as written-but-unproven.)*

Under the per-customer model **you register the app in your own tenant** —
there is no Open-Migrate-published app to consent to, no publisher
verification wall, and the credential never leaves your custody. Deleting the
registration is your kill switch.

**Create it:** Azure portal → **Microsoft Entra ID** → **App registrations**
→ **New registration**. Name it (e.g. `Open-Migrate`), choose **Accounts in
this organizational directory only (single tenant)**, leave the redirect URI
empty, and register. From the Overview page note the **Application (client)
ID** and **Directory (tenant) ID**.

**Two credential flows exist; grant only what your path uses:**

1. **Application (client-credentials)** — the product signs in as the app
   itself, no user present. This is what shared-mailbox reading (§2–§5) and
   the managed edition's o365 sources use. Credential: **Certificates &
   secrets → New client secret** — copy the value immediately, it is shown
   once. Permissions: the application permissions in §2, narrowed by the
   Application Access Policy in §4.
2. **Delegated (a user signs in)** — the product acts as one signed-in user,
   reading `/me/...`. Used for single-user migrations where no admin-consent
   footprint is wanted. Permissions: **API permissions → Microsoft Graph →
   Delegated** → `IMAP.AccessAsUser.All` (mail over IMAP with the user's
   context) plus `offline_access` (the refresh token that keeps a headless
   run signed in). No Application Access Policy applies — the user's own
   mailbox boundary is the scope.

**Where each value lands, per edition:**

| Value | Managed edition | Self-host appliance |
|---|---|---|
| Tenant ID, Client ID | CreateMapping wizard, source step (oauth2/graph source types) | `OAUTH2_TENANT_ID` / `OAUTH2_CLIENT_ID` in `deploy/selfhost/.env` (Docker) or `C:\ProgramData\OpenMigrate\config\secrets.cmd` (Windows) |
| Client secret | wizard, credentials step — encrypted at rest (`SecretStore`), masked on read-back | `OAUTH2_CLIENT_SECRET`, same files; mappings reference secrets **by env-var name**, never inline |
| Refresh token (delegated flow) | not collected by the wizard yet (the wizard's o365 path is client-credentials) | `OAUTH2_REFRESH_TOKEN`, same files |

Exact variable names and a from-scratch walkthrough with screenshots-level
detail: `docs/o365-setup.md`. The rest of this document is the
shared-mailbox/application-permissions half.

## 1. The app registration

If the tenant already has one — it is what an existing OAuth connection uses —
reuse it; a second registration means a second consent and a second set of
credentials to rotate. Starting cold, §0 above creates it.

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
| `Calendars.Read` | Read who a calendar is shared with | the permission inventory (0029 T1) |

Add nothing else. If a step later seems to need a further permission, that is
worth a conversation rather than a click — every extra application permission
is tenant-wide until an access policy narrows it, and `Mail.ReadWrite` in
particular would hand this app the ability to modify the system you are
migrating away from.

### Two scopes, one granted

0029's permission inventory can read two kinds of sharing through Graph:
calendar shares and OneDrive/SharePoint shares. They need one scope each, and
**only the first was granted** (owner decision, 2026-08-04). The asymmetry is
not about how useful the findings are — it is about what step 4 can reach.

`Calendars.Read` is an **Exchange-family** permission, so the Application
Access Policy below narrows it to exactly the same mailbox group that narrows
`Mail.Read`. It is not new reach; it is one more data type over mailboxes the
app can already read.

`Files.Read.All` is **not**. Application Access Policy is an Exchange
mechanism and does not apply to SharePoint or OneDrive, and `Files.Read.All`
has no narrowed variant — it is read over every file in every OneDrive and
every site collection in the tenant, with nothing here able to fence it in.
(SharePoint's own scoping mechanism, `Sites.Selected`, is a different
permission with a per-site grant model that this code is not written against.)
That is a large standing grant to buy one section of a handover report.

So the drive-sharing section of the permission report stays a **stated blind
spot**, alongside mailbox delegation, which Graph cannot read at all. Both are
named in the report rather than omitted from it — the reader is told what was
not looked at, which is the point (hard rule 9). The moment to revisit this is
when the drive migration itself needs file access, because then the grant pays
for the migration rather than for a report about it.

## 3. Grant admin consent

Still on **API permissions**: **Grant admin consent for {tenant}**, then
confirm. All four rows should show *Granted for {tenant}* with a green tick.

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

## 6. Prove that *this product* can read

Step 5 proves the **policy**. It does not prove that Open Migrate can read
anything — the client secret could be wrong, the consent could sit on a
different app registration, a permission could have been added and never
consented. Every one of those looks identical from PowerShell.

```bash
export OAUTH2_CLIENT_ID="00000000-0000-0000-0000-000000000000"
export OAUTH2_CLIENT_SECRET="…"        # never commit this (hard rule 3)

pnpm exec tsx apps/worker/src/cli/index.ts check-access \
  --tenant yourtenant.onmicrosoft.com \
  --mailbox gedeeld@yourtenant.nl
```

It asks Graph one question per consented permission — one record each, nothing
written, no database — and prints a line per capability:

```
OK    List the tenant’s mailboxes  (User.Read.All)
OK    List mail-enabled groups  (Group.Read.All)
OK    Read a shared mailbox’s mail  (Mail.Read)
OK    Read a mailbox’s calendar sharing  (Calendars.Read)
```

Read the lines, not the summary. Three properties are worth knowing:

- **Each permission is reported separately**, because they are consented
  separately and fail separately. `Group.Read.All` working while `Mail.Read` is
  refused is a real state, and one that a single verdict would send you to the
  wrong step over.
- **Omitting `--mailbox` reports the two mailbox-scoped permissions as NOT
  tested, and that counts as a failure**, not a pass. Running it without one is
  still useful — it tells you whether consent landed at all.
- **A failure prints Graph's own words**, including the `AADSTS…` or
  `Authorization_RequestDenied` code. Where a status has more than one meaning,
  it says so rather than picking one: a 403 on `/users` is usually the Access
  Policy excluding this app, and can also be a permission that was added in
  step 2 and never consented in step 3.

Exit status is non-zero unless every capability answered, so this can gate a
setup script rather than only being read by a person.

**If it fails here, nothing downstream will work** — discovery, drift detection
and the permission report will each run on schedule and honestly report that
they could not look, which is correct but is not what you set this up for.

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

and remove the four application permissions in the portal. Revoking consent
takes effect on the app's next token; tokens already issued remain valid until
they expire (up to an hour), which is worth knowing if you are revoking in a
hurry.

## What this does NOT grant

- **No write access.** All four permissions are read. This product never
  writes to the source (hard rule 2).
- **No access to mailboxes outside the group**, once step 4 has taken effect
  and step 5 has proven it. `Calendars.Read` is inside that fence with the
  rest; the access policy covers Exchange data, and a calendar is Exchange
  data.
- **No access to files.** `Files.Read.All` was considered and declined —
  see *[Two scopes, one granted](#two-scopes-one-granted)*. Drive sharing is
  reported as uninventoried, not as absent.
- **Nothing on the target side.** The destination is reached with its own
  credentials and is operated by whoever runs it (ADR-0011).

## Status of the code that uses this

The connector side is **built and unit-tested** (workplan 0027 T0): all four
Graph sources take an optional mailbox and address `/users/{address}` when
given one. What has **not** happened is a live read against a real tenant with
a real policy in place — that is the proof this runbook exists to make
possible, and 0027 T0 stays open until it is done.

Three features are waiting on exactly that and nothing else, and all three
already run on schedule against every tenant today:

| Feature | Where | What it does until consent lands |
|---|---|---|
| Shared-address discovery (0027 T1) | 06:30 daily | Records nothing; warns, every run, that the directory could not be read |
| New-mailbox drift detection (0028 T2) | 07:00 daily | Raises nothing; states the blind spot per tenant |
| The permission report (0029) | on demand, from Finish | Renders, with every section an honest *not inventoried* |

None of them needs another line of code to become real. **Step 6 is how you
find that out in thirty seconds** instead of waiting for 06:30 the next morning
and reading a log.
