# Dropbox setup — the app, the consent, the three values

**Operator and self-host document.** The customer guide is [the Dropbox guide](guides/en/dropbox.md), served in the app at `/docs/dropbox`.

A Dropbox migration authenticates with **your own Dropbox app** and a
refresh token consented by the account being migrated. Read-only by construction: create
the app with only the read scopes and this product could not write to the Dropbox even if
it wanted to — an enforced guarantee, not a promise in a document.

## 1. Create the app

[Dropbox App Console](https://www.dropbox.com/developers/apps) → Create app → *Scoped
access* → *Full Dropbox* (or *App folder* if the migration should only ever see one
folder). On the **Permissions** tab enable exactly:

- `files.metadata.read`
- `files.content.read`
- `sharing.read` — optional, read-only too: it powers the shared-folder **browse**
  (**Show shared folders**, on *Start a migration*'s **Connect your accounts**, and
  `scripts/list-dropbox-shared-folders.ts`).
  Without it migrations work unchanged; the browse gets Dropbox's own refusal, naming
  the scope. *Connect with Dropbox* does not ask for it, so a token from the button
  cannot browse even where the app has it; a token consented the long way below can
  (workplan 0140 T7 (b); whether the button should ask for it is that plan's open
  question 5).

Nothing else. The **App key** and **App secret** on the Settings tab are two of the three
values.

## 2. Consent, once, as the migrated account

**The short way: press *Connect with Dropbox*.** Where the deployment you use carries its own
Dropbox app (the operator sets it once — see *Configure it* below), *Start a migration* and
the **Accounts** page show a **Connect with Dropbox** button under the address. It opens
Dropbox's consent screen for the account being migrated, and when that account approves, the
refresh token lands in the field by itself and the connection is saved and tested in one go.
Nothing is typed, and the App secret never leaves the server. You can still use your own app
instead: open *Use your own Dropbox app* and enter the App key and App secret as a pair.

The button asks Dropbox for `files.metadata.read`, `files.content.read` and
`account_info.read`, and nothing else, whichever app it runs on (workplan 0140 T7 (b),
2026-09-26). The third is the one Dropbox keeps on every app, and *Test* needs it for the
space-usage figure below: Dropbox grants only the scopes the button names. As Dropbox documents
the `scope` parameter, that is a subset of the app's permissions and cannot widen them. What
comes back is still read: a grant carrying any scope outside those three and `sharing.read` is
refused, naming the scope, and nothing is stored. Take that scope off the app and press the
button again.

*Test* asks Dropbox for the top level of the root folder only, so it answers in seconds on a
Dropbox of any size; the migration itself walks every folder. Beside the folder count, the
*Measured* line says how much the Dropbox holds, from Dropbox's own space-usage figure. A test
that does not answer within 20 seconds says so and keeps the connection, so it can be tested
again.

For the button to work, the app must know where to send the browser back: **Settings → OAuth
2 → Redirect URIs**, add `https://<your app's address>/api/migrations/dropbox/callback` — the
exact string is listed on the app's *Redirect URIs* page so it can be copied, not retyped.

**The long way, by hand**, when there is no button or you prefer it:

Send the account owner through the consent URL (replace `APP_KEY`):

    https://www.dropbox.com/oauth2/authorize?client_id=APP_KEY&response_type=code&token_access_type=offline

`token_access_type=offline` is what makes Dropbox return a **refresh token**. Exchange the
resulting code once:

    curl https://api.dropboxapi.com/oauth2/token \
      -d code=THE_CODE -d grant_type=authorization_code \
      -d client_id=APP_KEY -d client_secret=APP_SECRET

The `refresh_token` in the answer is the third value. Access tokens are minted from it per
run; nothing long-lived is stored beyond these three.

## 3. Configure it

**Appliance** — environment variables, mapping file names the source:

    DROPBOX_APP_KEY=…
    DROPBOX_APP_SECRET=…
    DROPBOX_REFRESH_TOKEN=…

    "source": { "type": "dropbox", "rootPath": "/Team" }

`rootPath` unset migrates the whole Dropbox; a path scopes the migration to that folder
(natural keys are relative to it, so the same tree lands the same way either way).

A **mounted shared folder** lives in the account's tree and migrates like any other
folder — its path is a valid `rootPath`. `scripts/list-dropbox-shared-folders.ts` (or, on
managed, **Show shared folders**) lists what the account can see, paths included; an
unmounted share has no path until the account adds it to its Dropbox.

**Paper docs** arrive in the format the mapping names, and are refused by name while it names
none (workplan 0150):

    "source": { "type": "dropbox", "rootPath": "/Team", "nativeFilePolicies": { "paper": "markdown" } }

`markdown` or `html` asks Dropbox to export each Paper doc and template, and it arrives under
its own name with the suffix appended: `Notes.paper` becomes `Notes.paper.md`, which
Nextcloud's Text app opens. `refuse`, the default, reports each one as not migrated, with a
reason. Any other value, or a Google kind such as `document`, stops the mapping file from
loading, and the refusal names the key. A format changed later copies each Paper doc again
under its new name. The copy in the old format stays, and the Deletions screen lists it as an
earlier export, never as a deletion. The managed edition takes the same setting as
`sourceConfig.nativeFilePolicies.paper` on the migration routes (`apps/api/docs/openapi.yaml`):
*Start a migration* asks for it on every Dropbox migration, as **Dropbox Paper docs** under
**Files** on **What moves?**, with Markdown suggested, and the migration's page changes it
under **Export format for Paper docs**.

**Managed** — tick **Dropbox** on *Start a migration*'s **Which account are you leaving?**. On
**Connect your accounts**, its form takes the App key, App secret and refresh token, stored
encrypted, and **Check the sign-in** runs one read-only listing through exactly what a pass
would build. The **Accounts** page's Dropbox form takes the same, with **Add and test**.

**Managed, with the deployment's own app** — the operator sets the App key and App secret
once, in the deployment's environment:

    DROPBOX_OAUTH_CLIENT_ID=<App key>
    DROPBOX_OAUTH_CLIENT_SECRET=<App secret>

and registers the redirect URI above on that app. From then on every Dropbox connection needs
only the consent: the pair is read at the moment a token is minted and is stored on no
connection, so rotating the secret is one edit rather than one per connection. A connection
that carries its own App key and secret keeps using them; half a pair — an App key without
its secret, or the reverse — is refused where it is entered rather than completed with the
deployment's other half.

## What does not migrate (stated, not implied)

Sharing state, file requests and version history stay behind —
`docs/feature-matrix.md` carries the full per-type picture.

**Paper docs are refused by name unless the migration names a format** (workplan 0150).
Dropbox hands a Paper doc over only as an export, in a format §3 chooses. With none chosen,
each one is refused on its first attempt, before any download, and parked on the Failures
page as a decision, whose sentence names the setting that exports it. The confirm screen
counts them before Start, while the format can still be chosen. The rest of the tree carries
on. Any other file Dropbox marks as not downloadable is refused and parked the same
way: a document Dropbox keeps in a format of its own and offers an export for reads as a
Paper doc does, and one it offers no export for says there is no file to copy. Paper docs kept outside the Dropbox file tree, on an account with legacy Paper, are never
listed at all, so they stay behind without a line (0150 T7).

Deletions: Dropbox's own tombstones are read (`include_deleted`) as positive deletion
evidence, and absence-counting (two clean passes) covers what they do not say. A Dropbox
"rewind" is not read.
