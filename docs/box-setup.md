# Box setup — the app, the authorization, the three values

A Box migration (workplan 0056) authenticates with **your own Box platform app** using the
**Client Credentials Grant** — client id + client secret, plus the numeric **user id** of
the account being migrated (one subject per mapping).

**Why no refresh token, unlike Google and Dropbox:** Box rotates refresh tokens on every
use — each refresh answers a new token and invalidates the one just spent. This product
stores credentials once, encrypted, and never writes them back, so a stored Box refresh
token would authenticate exactly one pass and break the second. The Client Credentials
Grant has no rotating state, which is why it is the shape this connector refuses to
deviate from.

## 1. Create the app

[Box Developer Console](https://app.box.com/developers/console) → Create Platform App →
*Custom App* → authentication method **Client Credentials Grant (Server Authentication)**.

On the **Configuration** tab:

- App Access Level: **App + Enterprise Access**
- Application Scopes: **Read all files and folders stored in Box** only — nothing that
  writes. Read-only by construction: with only the read scope this product could not
  write to a Box even if it wanted to.
- Advanced Features: enable **Generate user access tokens** (this is what lets
  `box_subject_type=user` name whose files the token reads).

The **Client ID** and **Client Secret** on this tab are two of the three values.

## 2. Authorize it, once, as a Box admin

CCG apps must be approved by an enterprise admin before any token is minted:
**Admin Console → Apps → Custom Apps Manager → Add app** (by Client ID), then authorize.
Re-authorization is needed after scope changes. An unauthorized app gets Box's
`unauthorized_client` — the connector's refusal names this console because Box's error
does not.

## 3. Find the user id

The third value is the **numeric** user id of the account being migrated — Admin Console →
Users & Groups → the user → the id in the URL or the user details. Not an email address:
`box_subject_id` takes the number, and the token then reads exactly that account's files.

## 4. Configure it

**Appliance** — environment variables + the mapping file:

    BOX_CLIENT_ID=…
    BOX_CLIENT_SECRET=…

    "source": { "type": "box", "userId": "1234567890", "rootFolderId": "0" }

`userId` is required (a token without a subject reads nobody's files). `rootFolderId`
unset means `0` — the account root ("All Files"); a folder id scopes the migration to
that folder (natural keys are relative to it).

**Managed** — pick Box in the wizard: the Client ID and numeric user id go on the source
step; the Client secret rides the credential field on the credentials step, stored
encrypted. The **Test connections** button runs one read-only listing through exactly
what a pass would build.

A folder somebody invited the account to (a **collaborated folder**) sits in the
account's own tree and migrates as ordinary content; root a separate mapping at its
folder id to migrate just it.

## What does not migrate (stated, not implied)

Sharing state, collaborations, comments, tasks, Box Notes rendering guarantees, version
history and **web links** (bookmarks — pointers, not files) stay behind — the feature
matrix rows state each. File bytes, verbatim and sha1-checked, and the folder tree do
migrate.
