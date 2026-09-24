# Google — Drive, Gmail, Calendar, Contacts and Tasks

The Microsoft equivalent of this guide is [the Microsoft guide](microsoft.md).

This guide is for the Google cards in the wizard: the **Google account**, and the four cards that each read one Google product. Where this service has its own Google app, you press **Connect with Google** and approve at Google, and nothing on this page asks you to create anything. The steps to create an app of your own are at the end, under [With your own app](#own-app), for when you would rather use yours.

## What you need {#before}

- The Google account whose data moves, and its sign-in. The wizard's **Connect with Google** button opens Google's own consent screen for that account.
- If the account belongs to somebody else, you do not need their password: [send them a grant link](#grant-link) instead.
- Migrating a whole Workspace with many accounts? Read [domain-wide delegation](#domain-wide-delegation) first — it replaces one consent ceremony per person per product with a single admin action, and it needs a Workspace administrator.

## Connecting {#connect}

Each card asks for the account's address, under **Username**, and for a **Refresh token**, which **Connect with Google** fills in: press it, choose the account at Google, and approve. The token lands in the field by itself. Then **Test and save connections** reads the account once, through exactly what a pass would build, before anything migrates.

### Google account {#google}

One Google account, one sign-in. The line under the card's name says what it carries on this service: calendars, contacts and tasks, or also mail and files. Where it says only the first three, mail and files come through the **Gmail** and **Google Drive** cards below.

### Google Drive {#google-drive}

The token asks for `https://www.googleapis.com/auth/drive.readonly`, and nothing else. A migration reads. The token this product mints cannot create, modify or delete anything in the source Drive, which is a stronger guarantee than a promise in a document — it is enforced by Google.

It is a **delegated** credential: it reads the Drive of the person who consents, including the shared drives that person can see. For a whole Workspace there is a second, opt-in path — **[domain-wide delegation](#domain-wide-delegation)**, at the end of this guide. Per-user tokens stay the default: smallest access, revocable per person, no admin needed.

The **Root folder ID** field roots the migration somewhere other than My Drive — a **shared drive** is named by its own id, and so is a **folder somebody shared with this account**: "Shared with me" is a view, not a folder, so its contents never appear under My Drive's tree — rooting a separate migration at the shared folder's id is how such a folder migrates. To see the ids this credential can reach, use the wizard's **Browse shared drives & folders** button on the source step — a read-only listing through the same connector a migration uses. Loose shared files — shared with you but not inside a folder you can root at — stay out of scope.

**Google Docs, Sheets, Slides and Drawings** have no file to copy, only a rendering Google makes, and the wizard asks what each kind should arrive as. Every choice asks Drive to render the document; nothing is converted here.

- Docs arrive as `.odt` (OpenDocument), `.docx` (Microsoft Office) or `.pdf`.
- Sheets arrive as `.ods`, `.xlsx` or `.pdf`.
- Slides arrive as `.odp`, `.pptx` or `.pdf`.
- Drawings arrive as `.svg` under both document formats, or `.pdf`.

**A Drawing is the odd one.** Drive offers a Drawing only PNG, JPEG, SVG and PDF — there is no ODG and no Office equivalent — so both document choices use SVG. It is the only vector form on offer, it opens in LibreOffice Draw and in Word, and a PNG would be a diagram nobody can edit again.

**Forms, My Maps, Sites, Jamboards and Apps Scripts have no export in any format.** No choice changes that; they are reported one by one with a reason that says so, rather than pointing at a setting that would not help.

The exported file lands under the document's name **plus the extension of whatever was rendered** — a Doc called "Voorbeeldtekst" arrives as `Voorbeeldtekst.odt`. **Leaving them behind is the default**, and still the honest one: nothing is copied and nothing is guessed at, each file is reported by name, and you decide. The trade between the formats is editability: OpenDocument and Office keep a file editable, and PDF is a picture of the document rather than a document anyone can edit again.

### Gmail {#gmail}

**The scope is `https://mail.google.com/`, and there is no narrower choice.** Ownpace reads Gmail over IMAP (XOAUTH2 at `imap.gmail.com:993`), and that is the only scope Google's IMAP endpoint accepts — the granular `gmail.readonly` scopes belong to the REST API and are refused at the IMAP door. The scope reads as full mail access; this product never writes through it (the source connector has no write path, and Gmail is never a migration target), but unlike Drive's `drive.readonly` that is a property of the product, not one Google enforces. It is stated here because pretending otherwise is a lie an audit finds in a minute.

**A Drive-consented token will not work.** A refresh token carries the scopes it was consented with, and one minted for `drive.readonly` answers `invalid_scope` the first time a mail token is requested. **Connect with Google** on the Gmail card asks for the mail scope.

For a **personal** account only, the **App password** field can stand in for the consent. Read [the section on it](#app-password) before choosing it: Google recommends against it, it needs 2-step verification, it does not exist on a Workspace account, and it is the wider credential rather than the narrower one. **Entering both changes nothing** — the consent wins whenever it is complete, so an app password left behind from an earlier attempt cannot quietly take over.

#### A personal Gmail account can use an app password — and Google would rather you did not {#app-password}

For **mail only**, and only on a **personal** Google account, there is a shorter road: an **app password**. Paste it into the wizard's **App password** field and leave the OAuth fields empty. Everything else about the migration is identical: same folders, same messages, same duplicate-detection.

**Google recommends against app passwords, and so do we.** That is not a formality:

- an app password **opens the whole mailbox**, where a consented token opens the one thing it was consented for. It is the wider credential, not the narrower one;
- it needs **2-step verification** on the account before Google will create one at all. Without 2SV there is no app-password screen to find;
- **it does not exist on a Workspace account** — administrators can withdraw it, and Google has been removing it. If the account is in a Workspace, use **Connect with Google** instead.

The one real advantage, and the reason this path is offered at all: **withdrawing it is theirs alone.** One row in the account's own app-password list, deleted, and the access is gone — without touching Ownpace, without an administrator, and without deleting an OAuth client that other migrations may be using. For somebody lending their personal mailbox to a migration for a fortnight, that is worth something real.

If it is used, the daily download ceiling is **exactly the same** — Google enforces it on the IMAP endpoint, not on the credential — so nothing about throughput changes either way.

### Google Calendar and Google Contacts {#google-calendar}

Google still speaks the protocols this product already implements — CalDAV for calendars, CardDAV for contacts — so these sources are the ordinary DAV connectors aimed at Google's endpoints, with one difference: **Google's DAV endpoints take OAuth only**, so requests carry a token minted from your refresh token instead of a password.

Each product has its own scope, and the refresh token must be consented with it:

- Google Calendar: `https://www.googleapis.com/auth/calendar`
- Google Contacts: `https://www.googleapis.com/auth/carddav`
- Google Tasks: `https://www.googleapis.com/auth/tasks.readonly`, on the Google account card only

One consent CAN carry several scopes. A token consented for Drive or mail answers `invalid_scope` here.

### Somebody else's account: send them a link {#grant-link}

If the account belongs to a colleague, a family member or a client, the honest way to get this token is **not** to ask them for their password, and not to sit beside them while they sign in. Open the migration, press **Create grant link**, and send them the link yourself.

They open it, see who is asking and exactly what will be read, sign in to Google on Google's own page, and press one button. The token goes straight into the migration. **You never see it, and neither does anyone else** — it is stored encrypted against that one migration, and not against the connection, so it gives nothing away about any other account.

You choose how long the link works — a day, a week, or a month — and you can revoke it at any moment. A link works once: after somebody grants with it, it is spent. If it goes astray, revoke it and make another; issuing one takes a moment.

**We never send the link.** You do, however you normally reach that person. Ownpace never learns their address, which means Ownpace cannot leak it.

### Domain-wide delegation — one admin action instead of N consents {#domain-wide-delegation}

A Workspace admin can authorise a **service account** to impersonate users, once, for an enumerated list of scopes. Use it when per-user consent ceremonies do not scale; skip it for a handful of accounts. **Read the width before choosing it: the key can read every user in the domain for the authorised scopes.** Each migration still names exactly one account (the subject); what widens is the credential, not any migration.

1. **Create a dedicated service account** (IAM → service accounts) in any Google Cloud project — no roles, nothing else on it. Its only job is this migration.
2. **Generate a JSON key** (keys → add key → JSON). This file is now the most sensitive secret in the migration; treat it like one.
3. **Authorise it in the Admin console**: Admin → Security → Access and data control → API controls → **Domain-wide delegation** → add the service account's client id with ONLY the scopes the chosen products need — never a superset "to be safe":

- Drive: `https://www.googleapis.com/auth/drive.readonly`
- Gmail: `https://mail.google.com/`
- Calendar: `https://www.googleapis.com/auth/calendar`
- Contacts: `https://www.googleapis.com/auth/carddav`
- Tasks: `https://www.googleapis.com/auth/tasks.readonly`

4. **Enter it**: paste the whole key file into the wizard's **Service account key** field and state each migration's account. The refresh-token fields stop being required; the refusals will say so if something is missing.
5. **Revoke at cutover.** Delete the Admin-console delegation entry (and the key) when the migration finishes — the credential's lifetime is the migration's, and this step is as much part of the move as step 3.

## What moves {#what-moves}

**What happens to labels.** Gmail's IMAP surface presents each label as a folder, and those migrate as folders. It also presents three views that contain other folders' messages again — All Mail, Starred and Important. Copying those would duplicate every message once per view it appears in, so Ownpace drops the three views (recognised by Google's own `\All`/`\Flagged`/`\Important` attributes, which survive localisation) and migrates everything real: INBOX, your labels, Sent, Drafts. Trash and Spam are excluded from the copy by default like every other IMAP source, while the bin is still read for deletion evidence. A message carrying several labels appears in several folders, but mail is recognised by its Message-ID, so it is **copied once** — into the folder where a pass first sees it. A later sighting under another label is never re-copied; it can surface in the **Moves** queue as a source-side placement report, which is information, not action. If your labelling is heavy, expect that queue to describe Gmail's labels rather than anything you did.

### What a Drive migration does not do yet {#drive-not-yet}

Stated here rather than discovered:

- **No incremental delta.** Every pass lists every folder. The second pass still copies nothing that is already there — it costs a listing, not a re-copy.
- **Deletions are never taken from Drive's removed signal.** Google sets it for losing access and for sharing changes, which are not deletions. What a pass DOES read is the owner's **bin**: a file found trashed is a deletion the owner performed, reported at once with positive evidence, and the Deletions queue may offer removing the target's copy on it. An emptied bin falls back to absence-counting.
- **A moved or renamed file leaves the old copy on the target.** It is detected and reported; making the target follow it is an action you approve per file, from the Moves queue. A Google Doc, Sheet, Slides deck or Drawing is recognised by its Drive id, so renaming one is reported as a move, never as a deletion, whatever format it is exported in.
- **Two files with the same name in the same folder cannot both be migrated.** A file is known by its path, so two with the same path are a hard stop, not a setting.

### Google Photos, and the device backups {#photos}

**Photos are not migrated, and the reason is Google's, not ours.** Since 31 March 2025 the Photos Library API no longer lets a third-party application read a person's library: an app may see only the items it uploaded itself, or items the person picks by hand in Google's own picker, one selection at a time. A complete, unattended copy of a photo library through the API is therefore not possible for any product, and a connection that offered it would be promising something Google refuses. The complete route Google leaves open is **Google Takeout** — the person exports their library as an archive — which is a snapshot to download rather than an account to read, and so a different kind of migration than the account cards on this page. The **Export archive** card reads a Takeout of Google Photos: [the archive guide](archive.md) says how to ask Google for one, and where it has to be for the card to read it.

**And the obvious hope does not rescue it.** Google publishes a Data Portability API for people in the European Economic Area, built to satisfy the Digital Markets Act, which sounds like exactly the answer. Its full list of scopes was read on 4 September 2026 and **Google Photos is not among them** — nor is Drive, Gmail, Contacts or Calendar. What it carries is search and activity history, Chrome, Maps contributions, Play and YouTube. The two scopes that look like photos are not: one is what you posted on Maps, the other is Street View uploads. So a photo library now has two separate reasons to be out of reach, and Takeout is not a workaround while something better arrives — it is the only complete route there is.

**Device backups** (the "Back-up van apparaat" line in Google's storage overview) are Android's own app-and-settings backups, readable only by an Android device signing in. They are not data this product can or should read, and they stay where they are.

That is why the measured Drive figure on a connection matches Google's own Google Drive line and not the storage total: photos, backups and Gmail are counted by Google under their own headings, and Ownpace measures each face it can reach under its own.

## When the test reports a problem {#when-test-says}

- **`accessNotConfigured`**, naming an API: the Google Cloud project behind the app has that API switched off. Google's sentence names the API and links the exact page, and the test shows that sentence rather than the XML it arrives in. Where this service's app is used, that is a setting of this service: tell whoever runs it. With [your own app](#own-app), switch it on in your project.
- **`invalid_scope`**: the refresh token was consented for another Google product. Connect again from the card you are on.
- **`unauthorized_client`** with a service account key means step 3 of [domain-wide delegation](#domain-wide-delegation) is missing or lists the wrong scope — the error names the client id and scope to add. An `invalid_grant` there usually means the subject is not a user in the domain.
- **`invalid_grant`**: the refresh token has died. **Treat the refresh token as a password.** It grants read access until it is revoked, and it does not expire on its own. It does die if:

1. **the app is External and still in Testing** — Google expires the token after **seven days**, no matter how healthy everything else looks. Check this first: it is the only cause on this list that recurs, and the fix is one dropdown (publishing status → Production);
2. the account's password changes;
3. an admin revokes the app;
4. the OAuth client is deleted;
5. it goes six months unused.

All five produce the same `invalid_grant` from Google, and the error message names them. Connect again to mint a new one.

## Stopping {#leaving}

- A consent given with **Connect with Google** is withdrawn at Google, under the Google account's **Security** settings, in the list of third-party apps with access to the account.
- An **app password** is withdrawn by deleting its row from the account's own app-password list. The access is gone at once, and nothing else is touched.
- A **service account** is withdrawn by deleting its Admin-console delegation entry, and the key.
- With [your own app](#own-app), deleting the OAuth client revokes every token it minted.

## With your own app {#own-app}

This is what you do once, in **your own** Google Cloud project, to let Ownpace read a Google account with a client of your own. It ends with two values — client id and client secret — that go in the wizard's **Use your own Google client** fold, beside **Connect with Google**.

**The same model as for Microsoft, for the same reasons.** The app registration lives in **your** project, registered by you; the credential never leaves your custody; and revoking it is yours — delete the OAuth client and every token dies. The wizard's **Connect with Google** button runs the consent for you against your own client: it opens Google's consent screen with your client ID and secret, and fills the refresh token in for you.

### Start here: whose Google account is it? {#own-app-whose-account}

This one answer decides whether you see security warnings at all. **Get it wrong and everything still works, but with banners, a test-user list, and a token that quietly dies every seven days.**

**A Workspace account, and you are migrating it inside its own organisation.** Choose **Internal** at the consent screen step below. Google skips verification entirely: no "Google hasn't verified this app" warning, no test-user list, no token expiry. This is most readers, and it costs nothing.

**A personal Google account** (`@gmail.com`), or a Workspace account being read from a different organisation. Choose **External** — you have no other option — and then **set the publishing status to Production**. You will see an unverified-app warning once, and click through it. Do **not** leave the app in Testing: Google expires refresh tokens after **seven days** in that state, and a migration that runs for months will fail every week with `invalid_grant`, long after anyone remembers setting it up.

### 1. The project and the API {#own-app-project}

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project (or pick one).
2. **APIs & Services → Library →** enable the API behind every face this client will serve. Each is a separate switch, and a switch left off refuses the first request with `accessNotConfigured`.

- Files: **Google Drive API**, for every Drive request.
- Calendar: **CalDAV API**. Google's CalDAV endpoint is a Cloud API like any other.
- Contacts: **Google Contacts CardDAV API**, the same, for CardDAV.
- Mail: **Gmail API**. IMAP itself needs no API; with this on, the `https://mail.google.com/` scope is listed in the consent screen's scope picker instead of having to be pasted in by hand.
- Tasks: **Google Tasks API**. Google's tasks are not on its CalDAV; the Tasks face reads this API.

A Google account connection whose consent had gone through cleanly has been refused at Test with "CalDAV API has not been used in project … before or it is disabled" — nothing before that point had said the API existed.

### 2. The consent screen {#own-app-consent-screen}

**APIs & Services → OAuth consent screen.**

You made this choice [above](#own-app-whose-account). To restate it in the console's own words:

- **Internal** if the account is in the same Workspace organisation — the right answer for a migration, and it skips Google's verification review entirely.
- **External** only if the source is a personal Google account. Then **set the publishing status to Production** and accept the unverified-app warning. Leaving it in Testing caps you at 100 test users, requires adding the account as a test user, and — the one that actually hurts — **expires every refresh token after seven days**.
- Add the scopes of the products you will read, from the lists above. Add nothing else: an unnecessary scope is a permission somebody has to justify later.

### 3. The OAuth client {#own-app-client}

**APIs & Services → Credentials → Create credentials → OAuth client ID.**

Pick **Web application** and add an authorised redirect URI: the wizard shows the exact value to register when you press **Connect with Google** with your own client, so a mismatch is visible before Google refuses it. It ends in `/api/migrations/google/callback`. The redirect exists only to obtain the refresh token once; migrations use the refresh token directly from then on.

Copy the **client ID** and **client secret**, open **Use your own Google client** in the wizard, enter both, and press **Connect with Google**.

### 4. The refresh token, by hand {#own-app-token}

**Connect with Google does this step for you**, for an account you can sign in to yourself. Manually, using Google's own [OAuth Playground](https://developers.google.com/oauthplayground/), after adding `https://developers.google.com/oauthplayground` as a second redirect URI on the client:

1. Gear icon → **Use your own OAuth credentials** → paste the client ID and secret.
2. In the scope box on the left, enter the scope of the product you will read → **Authorize APIs**, and sign in as the account being migrated.
3. **Exchange authorization code for tokens.** Copy the **refresh token** into the wizard's **Refresh token** field.

The playground is a convenience, not a requirement. Any OAuth2 authorization-code flow against your own client works, as long as it asks for `access_type=offline` — without that Google returns an access token only, which expires in an hour and cannot be renewed.
