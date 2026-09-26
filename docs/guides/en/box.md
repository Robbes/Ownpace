# Box — the app, the authorization, the three values

A Box migration authenticates with **your own Box platform app** using the **Client Credentials Grant** — client id + client secret, plus the numeric **user id** of the account being migrated (one subject per migration).

**Why no refresh token, unlike Google and Dropbox:** Box rotates refresh tokens on every use — each refresh answers a new token and invalidates the one just spent. This product stores credentials once, encrypted, and never writes them back, so a stored Box refresh token would authenticate exactly one pass and break the second. The Client Credentials Grant has no rotating state, which is why it is the shape this connector refuses to deviate from.

## What you need {#before}

- Access to the [Box Developer Console](https://app.box.com/developers/console), to create the app.
- A **Box administrator** of the enterprise, who authorises the app once.
- The numeric user id of the account being migrated, which an administrator can read.

## Connecting {#connect}

### 1. Create the app {#create-app}

[Box Developer Console](https://app.box.com/developers/console) → Create Platform App → **Custom App** → authentication method **Client Credentials Grant (Server Authentication)**.

On the **Configuration** tab:

- App Access Level: **App + Enterprise Access**
- Application Scopes: **Read all files and folders stored in Box** only — nothing that writes. Read-only by construction: with only the read scope this product could not write to a Box even if it wanted to.
- Advanced Features: enable **Generate user access tokens** (this is what lets the token name whose files it reads).

The **Client ID** and **Client Secret** on this tab are two of the three values.

### 2. Authorize it, once, as a Box admin {#authorize}

CCG apps must be approved by an enterprise admin before any token is minted: **Admin Console → Apps → Custom Apps Manager → Add app** (by Client ID), then authorize. Re-authorization is needed after scope changes.

### 3. Find the user id {#user-id}

The third value is the **numeric** user id of the account being migrated — Admin Console → Users & Groups → the user → the id in the URL or the user details. Not an email address: the field takes the number, and the token then reads exactly that account's files.

### 4. Enter it {#box}

Pick Box in the wizard. Everything goes on the source step: the account's address under **Username**, the number from step 3 under **Box user ID (numeric)**, and the two values from step 1 under **Client ID (application ID)** and **Client secret**, the secret stored encrypted. The **Test and save connections** button runs one read-only listing through exactly what a pass would build.

The **Root folder ID** field left empty means `0` — the account root ("All Files"); a folder id scopes the migration to that folder.

A folder somebody invited the account to (a **collaborated folder**) sits in the account's own tree and migrates as ordinary content; root a separate migration at its folder id to migrate just it.

## What moves {#what-moves}

File bytes, verbatim and sha1-checked, and the folder tree do migrate. Sharing state, collaborations, comments, tasks, Box Notes rendering guarantees, version history and **web links** (bookmarks — pointers, not files) stay behind.

### The trash, and why it matters {#trash}

Each pass reads the account's trash, read-only. An item the owner deleted is found where they put it, which is **positive** deletion evidence — the only kind that may gate removing the target's copy. Absence alone is never enough by design, so with no trash the Deletions queue can only tell the owner what to delete by hand.

Two enterprise settings therefore change what the owner can do, not just what they see:

- **Trash retention** (Admin Console → Enterprise Settings → Content & Sharing). Box's default keeps deleted items ~30 days. Deletions older than the window have left the bin, and those fall back to absence-counting.
- **Trash disabled** (permanent delete on). Nothing is ever in the bin, so every Box deletion stays `inferred` and the apply action is withheld by design.

Neither is a misconfiguration to fix — they are the customer's retention policy, and the migration reports honestly under both.

## When the test reports a problem {#when-test-says}

- **`unauthorized_client`**: the app has not been authorized in the enterprise, or its scopes changed since. The refusal names the **Custom Apps Manager** because Box's error does not: see [step 2](#authorize).

## Stopping {#leaving}

A Box administrator removes the app where it was authorized, in **Admin Console → Apps → Custom Apps Manager**. Deleting the app in the Developer Console ends its access for good.
