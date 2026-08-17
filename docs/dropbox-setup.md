# Dropbox setup — the app, the consent, the three values

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
  (the wizard's "Browse shared folders" button and `scripts/list-dropbox-shared-folders.ts`).
  Without it migrations work unchanged; the browse gets Dropbox's own refusal, naming
  the scope.

Nothing else. The **App key** and **App secret** on the Settings tab are two of the three
values.

## 2. Consent, once, as the migrated account

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
folder — its path is a valid `rootPath`. `scripts/list-dropbox-shared-folders.ts` (or
the wizard's browse) lists what the account can see, paths included; an unmounted share
has no path until the account adds it to its Dropbox.

**Managed** — pick Dropbox in the wizard: the App key goes in the key field on the source
step; the App secret and refresh token ride the credential fields on the credentials step,
stored encrypted. The **Test connections** button runs one read-only listing through
exactly what a pass would build.

## What does not migrate (stated, not implied)

Sharing state, file requests, Paper docs and version history stay behind —
`docs/feature-matrix.md` carries the full per-type picture. Deletions are detected by
absence-counting (two clean passes); a Dropbox "rewind"/deleted-entry read is not
yet supported.
