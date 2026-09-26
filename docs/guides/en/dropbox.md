# Dropbox — the consent, and the app

A Dropbox migration authenticates with a Dropbox app — this service's, where it has one, or your own — and a refresh token consented by the account being migrated. Read-only by construction: the app asks only for the read scopes, so this product could not write to the Dropbox even if it wanted to — an enforced guarantee, not a promise in a document.

## What you need {#before}

- The Dropbox account whose files move, and its sign-in.
- If only one folder should move: its path, such as `/Team Docs`.

## Connecting {#connect}

### Dropbox {#dropbox}

The wizard asks for the account's address, under **Username**, and for a **Refresh token**, which the button fills in.

**The short way: press Connect with Dropbox.** Where this service carries its own Dropbox app, the wizard and the Connections page show a **Connect with Dropbox** button beside the token field. It opens Dropbox's consent screen for the account being migrated, and when that account approves, the refresh token lands in the field by itself and the connection is saved and tested in one go. Nothing is typed, and the App secret never leaves the server. You can still use your own app instead: open **Use your own Dropbox app** and enter the **App key** and the **Client secret** as a pair. [With your own app](#own-app) has the steps.

The **Root folder path** field left empty migrates the whole Dropbox; a path scopes the migration to that folder, and the same tree lands the same way either way.

A **mounted shared folder** lives in the account's tree and migrates like any other folder — its path is a valid root folder path. The wizard's **Browse shared folders…** button lists what the account can see, paths included; an unmounted share has no path until the account adds it to its Dropbox.

Test asks Dropbox for the top level of the root folder only, so it answers in seconds on a Dropbox of any size; the migration itself walks every folder. Beside the folder count, the Measured line says how much the Dropbox holds, from Dropbox's own space-usage figure.

## What moves {#what-moves}

File bytes and the folder tree. Sharing state, file requests, Paper docs and version history stay behind. Deletions are detected by absence-counting (two clean passes); a Dropbox "rewind" or deleted-entry read is not yet supported.

## When the test reports a problem {#when-test-says}

- A test that does not answer within 20 seconds says so and keeps the connection, so it can be tested again.
- The shared-folder browse refuses with Dropbox's own words, naming the `sharing.read` scope, when the app was created without it. Migrations work unchanged; only the browse needs it.

## Stopping {#leaving}

A consent is withdrawn at Dropbox, in the account's settings under **Connected apps**. With [your own app](#own-app), deleting the app in the App Console withdraws every consent given to it.

## With your own app {#own-app}

### 1. Create the app {#own-app-create}

[Dropbox App Console](https://www.dropbox.com/developers/apps) → Create app → **Scoped access** → **Full Dropbox** (or **App folder** if the migration should only ever see one folder). On the **Permissions** tab enable exactly:

- `files.metadata.read`
- `files.content.read`
- `sharing.read` — optional, read-only too: it powers the wizard's **Browse shared folders…** button. Without it migrations work unchanged; the browse gets Dropbox's own refusal, naming the scope.

Nothing else. The **App key** and **App secret** on the Settings tab go in the wizard's **Use your own Dropbox app** fold, as a pair: the App key under **App key**, the App secret under **Client secret**.

### 2. The redirect address {#own-app-redirect}

For the button to work with your own app, the app must know where to send the browser back: **Settings → OAuth 2 → Redirect URIs**. Press **Connect with Dropbox** once with your App key and App secret entered, and the wizard shows the exact address to register under the button. It ends in `/api/migrations/dropbox/callback`.

### 3. Consent, once, as the migrated account {#own-app-consent}

Press **Connect with Dropbox**. The account being migrated approves on Dropbox's own screen, and the refresh token lands in the field by itself. Access tokens are minted from it per run; nothing long-lived is stored beyond the App key, the App secret and that token.
