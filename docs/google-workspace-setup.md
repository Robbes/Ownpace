# Google Workspace setup — Drive, Gmail, Calendar and Contacts as migration sources

The Microsoft equivalent of this guide is [`o365-setup.md`](./o365-setup.md).

This is what you do once, in **your own** Google Cloud project, to let Ownpace read a Google
account. It ends with three values — client id, client secret, refresh token — and one command
that proves they work.

## Start here: whose Google account is it?

This one answer decides whether you see security warnings at all, and it is the question the
rest of this guide assumes you have already answered. **Get it wrong and everything still
works, but with banners, a test-user list, and a token that quietly dies every seven days.**

> **A Workspace account, and you are migrating it inside its own organisation.**
> Choose **Internal** at the consent screen (§2). Google skips verification entirely: no
> "Google hasn't verified this app" warning, no test-user list, no token expiry. This is most
> readers, and it costs nothing.
>
> **A personal Google account** (`@gmail.com`), or a Workspace account being read from a
> different organisation.
> Choose **External** — you have no other option — and then **set the publishing status to
> Production**. You will see an unverified-app warning once, and click through it. Do **not**
> leave the app in *Testing*: Google expires refresh tokens after **seven days** in that state,
> and a migration that runs for months will fail every week with `invalid_grant`, long after
> anyone remembers setting it up.

Migrating a whole Workspace with many accounts? Read
[domain-wide delegation](#domain-wide-delegation--one-admin-action-instead-of-n-consents)
first — it replaces one consent ceremony per person per product with a single admin action.

## Why you register the client and not us

**The same model as O365, for the same reasons.** The app registration lives in **your**
project, registered by you; the credential never leaves your custody; and revoking it is yours
— delete the OAuth client and every token dies.

That is a deliberate trade, and it is the reason this guide exists at all rather than a
**Connect with Google** button: an appliance is software you run, so a button backed by *our*
OAuth client would mean shipping our client secret to everyone who downloads it. What we can
do — and have not built yet — is run the consent step for you against **your** client, which
removes §3's redirect URI and all of §4. That is
[workplan 0089](./workplans/0089-a-consent-you-can-click.md), and who may own an OAuth client
is [ADR-0041](./adr/0041-who-owns-the-oauth-client.md).

---

## What the token can do

`https://www.googleapis.com/auth/drive.readonly`, and nothing else. A migration reads. The
token this product mints cannot create, modify or delete anything in the source Drive, which
is a stronger guarantee than a promise in a document — it is enforced by Google.

It is a **delegated** credential: it reads the Drive of the person who consents, including the
shared drives that person can see. For a whole Workspace there is a second, opt-in path —
**[domain-wide delegation](#domain-wide-delegation--one-admin-action-instead-of-n-consents)**,
at the end of this guide. Per-user tokens stay the default: smallest access, revocable per
person, no admin needed.

## 1. The project and the API

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project (or pick one).
2. **APIs & Services → Library →** enable **Google Drive API**. Nothing works before this, and
   the error when it is missing (`accessNotConfigured`) does not say which API.

## 2. The consent screen

**APIs & Services → OAuth consent screen.**

You made this choice at the top of this guide. To restate it in the console's own words:

- **Internal** if the account is in the same Workspace organisation — the right answer for a
  migration, and it skips Google's verification review entirely.
- **External** only if the source is a personal Google account. Then **set the publishing
  status to Production** and accept the unverified-app warning. Leaving it in *Testing* caps
  you at 100 test users, requires adding the account as a test user, and — the one that
  actually hurts — **expires every refresh token after seven days**.
- Add the scope `https://www.googleapis.com/auth/drive.readonly`. Add nothing else: an
  unnecessary scope is a permission somebody has to justify later.

## 3. The OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID.**

Pick **Web application** and add `https://developers.google.com/oauthplayground` as an
authorised redirect URI. That is only to obtain the refresh token in step 4; Ownpace
never redirects anywhere, because it uses the refresh token directly from then on.

Copy the **client ID** and **client secret**.

## 4. The refresh token

The one value that cannot be read out of a console. Using Google's own
[OAuth Playground](https://developers.google.com/oauthplayground/):

1. Gear icon → **Use your own OAuth credentials** → paste the client ID and secret.
2. In the scope box on the left, enter `https://www.googleapis.com/auth/drive.readonly` →
   **Authorize APIs**, and sign in as the account whose Drive is being migrated.
3. **Exchange authorization code for tokens.** Copy the **refresh token**.

> The playground is a convenience, not a requirement. Any OAuth2 authorization-code flow
> against your own client works, as long as it asks for `access_type=offline` — without that
> Google returns an access token only, which expires in an hour and cannot be renewed.

**Treat the refresh token as a password.** It grants read access to that Drive until it is
revoked, and it does not expire on its own. It does die if:

1. **the app is External and still in *Testing*** — Google expires the token after **seven
   days**, no matter how healthy everything else looks. Check this first: it is the only cause
   on this list that recurs, and the fix is one dropdown (publishing status → Production);
2. the account's password changes;
3. an admin revokes the app;
4. the OAuth client is deleted;
5. it goes six months unused.

All five produce the same `invalid_grant` from Google, and the error message names them.

## 5. Configure it

Appliance — in `.env`:

```sh
GOOGLE_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=…
GOOGLE_REFRESH_TOKEN=…
```

Managed — the same three, entered in the create-mapping wizard (a **Google Drive** source:
client ID on the source step; client secret and refresh token on the credentials step). They
are stored encrypted on the source connection under exactly these names: `clientId`,
`clientSecret`, `refreshToken`.

Then the mapping's file domain:

```json
"domains": {
  "files": {
    "enabled": true,
    "source": { "type": "google-drive" },
    "target": { "…": "your file target" }
  }
}
```

`"rootFolderId"` roots the migration somewhere other than My Drive — a **shared drive** is
named by its own id, and so is a **folder somebody shared with this account**:
"Shared with me" is a view, not a folder, so its contents never appear under My
Drive's tree — rooting a separate mapping at the shared folder's id is how such a folder
migrates. To see the ids this credential can reach, run
use the wizard's **Browse shared drives & folders** button on the credentials step — a
read-only listing through the same connector a migration uses. (Running from configuration
files instead? `pnpm exec tsx scripts/list-shared-drives.ts` and
`pnpm exec tsx scripts/list-shared-folders.ts` answer the same question.) Loose shared *files* — shared with you but not inside a folder you
can root at — stay out of scope, stated in `docs/feature-matrix.md`. `"nativeFilePolicy"` decides what happens to Google Docs; read the next
section before setting it.

## 6. Prove it, before migrating anything

```sh
pnpm exec tsx scripts/drive-export-stability.ts
```

Read-only, writes nothing, and answers two things at once:

- **Do the credentials work?** It mints a token and reports the scope Google actually granted,
  which can be narrower than the one requested.
- **Is a Google Doc export byte-stable?** It exports the same unchanged document twice and
  compares the bytes.

That second question is the one that decides whether `nativeFilePolicy` may be set to
`export-office` / `export-pdf` at all. A Google Doc has no bytes; exporting one produces a
rendering, and this product hashes what it writes. **If two exports of an unchanged document
differ, every pass sees a changed document and re-copies all of them, forever, with every
write succeeding and nothing looking wrong.** Until that has been measured on a real tenant,
the default is `refuse`: each Doc is reported as un-migratable, one by one, with the reason,
and the rest of the folder migrates.

Run it for `export-office` and for `export-pdf` — different renderers — and ideally against a
Doc, a Sheet and a Slide. Then keep a note of what you found — the answer decides whether exporting Google Docs is
safe to turn on at all.

### Recording a fixture while you are there

Google Drive cannot be containerised, so the connector cannot be gated in CI the way the
WebDAV one is. The substitute is a **recording** of what Drive really answered, replayed in
CI forever. Add one variable and the same run produces it:

```sh
DRIVE_CAPTURE_FILE=./drive-capture.json pnpm exec tsx scripts/drive-export-stability.ts
```

**What lands in that file is redacted**, because a fixture ends up in a public repository:
file and folder names, ids and page tokens become pseudonyms (`f1.pdf`, `folder-1`, `id-1`),
and export bodies become a sha256 and a byte length. Mime types, sizes, checksums,
timestamps, status codes and the shape of every response are kept exactly as Google sent
them — that is what a replay checks. `packages/testing/src/drive-capture.ts` states the
rule and its tests enforce it.

So the recording pins that this product parses what Drive actually sends. It says nothing
about any particular document of yours — the byte-stability verdict above is the part that
speaks to that, and it is printed rather than stored.

**Point it at a folder that has a subfolder with files in it.** When capturing, the script
also walks the folder tree and lists the first subfolder, because a Drive file has no path —
only an id and a name — so the natural key the whole ledger turns on is *composed* by this
product. That composition is the thing most likely to be wrong, and a recording of one flat
listing of the root cannot gate it. The script says so if it finds no subfolder.

---

## Gmail as a mail source

The same project, the same consent screen, the same OAuth client — steps 1–3 above are done
once and serve both. What differs is the **consent** the refresh token carries and the name
it is stored under.

**The scope is `https://mail.google.com/`, and there is no narrower choice.** Ownpace
reads Gmail over IMAP (XOAUTH2 at `imap.gmail.com:993`), and that is the only scope Google's
IMAP endpoint accepts — the granular `gmail.readonly` scopes belong to the REST API and are
refused at the IMAP door. The scope *reads as* full mail access; this product never writes
through it (the source connector has no write path, and Gmail is never a migration target),
but unlike Drive's `drive.readonly` that is a property of the product, not one Google
enforces. It is stated here because pretending otherwise is a lie an audit finds in a minute.

Mint the refresh token exactly as in step 4, with two changes:

1. The scope box gets `https://mail.google.com/` instead of the Drive scope.
2. Sign in as the **Gmail account being migrated**.

**A Drive-consented token will not work.** A refresh token carries the scopes it was
consented with, and one minted for `drive.readonly` answers `invalid_scope` the first time a
mail token is requested. That is why Ownpace stores the mail token under its own name:

```sh
GOOGLE_CLIENT_ID=…apps.googleusercontent.com   # the same client as Drive
GOOGLE_CLIENT_SECRET=…                          # the same secret as Drive
GOOGLE_MAIL_REFRESH_TOKEN=…                     # the MAIL-consented token
```

Managed — the same three, entered in the create-mapping wizard (a **Gmail** source: client ID
on the source step; client secret and refresh token on the credentials step). Stored
encrypted on the source connection as `clientId`, `clientSecret`, `refreshToken`.

The mapping needs only the address, because everything else is fixed by Google:

```json
"source": { "type": "gmail", "user": "owner@example.com" }
```

**What happens to labels.** Gmail's IMAP surface presents each label as a folder, and those
migrate as folders. It also presents three *views* that contain other folders' messages
again — All Mail, Starred and Important. Copying those would duplicate every message once
per view it appears in, so Ownpace drops the three views (recognised by Google's own
`\All`/`\Flagged`/`\Important` attributes, which survive localisation) and migrates
everything real: INBOX, your labels, Sent, Drafts. Trash and Spam are excluded from the copy
by default like every other IMAP source, while the bin is still read for deletion evidence.
A message carrying several labels appears in several folders, but the ledger keys mail by
Message-ID, so it is **copied once** — into the folder where a pass first sees it. A later
sighting under another label is never re-copied; it can surface in the **Moves** queue as a
source-side placement report, which is information, not action. If your labelling is heavy,
expect that queue to describe Gmail's labels rather than anything you did.

## Calendar and Contacts as sources

The same project, consent screen and OAuth client again. Google still speaks the protocols
this product already implements — CalDAV for calendars, CardDAV for contacts — so these
sources are the ordinary DAV connectors aimed at Google's endpoints, with one difference:
**Google's DAV endpoints take OAuth only**, so requests carry a Bearer token minted from your
refresh token instead of a password.

Each product has its own scope, and the refresh token must be consented with it:

| source | scope | appliance variable |
|---|---|---|
| Google Calendar | `https://www.googleapis.com/auth/calendar` | `GOOGLE_CALENDAR_REFRESH_TOKEN` |
| Google Contacts | `https://www.googleapis.com/auth/carddav` | `GOOGLE_CONTACTS_REFRESH_TOKEN` |

Mint each token exactly as in step 4, entering the scope above. One consent CAN carry
several scopes — if you authorize calendar and carddav together, the same refresh token
value goes in both variables — but the variables stay separate so "which consent is this"
is visible in the config. A token consented for Drive or mail answers `invalid_scope` here.

The mapping needs only the address, like Gmail:

```json
"domains": {
  "calendar": {
    "enabled": true,
    "source": { "type": "google-calendar", "user": "owner@example.com" },
    "target": { "…": "your CalDAV target" }
  }
}
```

(`"type": "google-contacts"` for the contacts domain, with a CardDAV or JMAP target.)
Managed — the **Google Calendar** / **Google Contacts** wizard cards: client ID on the source
step, client secret and refresh token on the credentials step, stored encrypted as
`clientId`, `clientSecret`, `refreshToken`.

**What only a real account can prove** (owner runbook, Stage 6): that Google's principal
URLs answer this connector's discovery walk and that its sync-token behaviour matches the
RFC 6578 path this product uses everywhere else. The connectors are proven against
RFC-shaped servers; Google's dialect is the thing to verify once before trusting a schedule.

## What a Drive migration does not do yet

Stated here rather than discovered:

- **No incremental delta.** Every pass lists every folder. The ledger still makes the second
  pass copy nothing — it costs a listing, not a re-copy. (Drive's `changes.list` reports the
  whole drive, and using it per folder would reproduce a defect this product has already paid
  for once.)
- **Deletions are never taken from Drive's `removed` signal.** Google sets it for losing
  access and for sharing changes, which are not deletions, and this product treats a reported
  removal as *known* rather than suspected — so a Drive source still reports none of those.
  What it DOES read is the owner's **bin**: a file found trashed is a deletion the owner
  performed, reported at once with positive evidence, and the Deletions queue may offer
  removing the target's copy on it. An emptied bin falls back to absence-counting.
- **A moved or renamed file leaves the old copy on the target.** It is detected and reported;
  making the target follow it is an action you approve per file, from the Moves queue.
- **Two files with the same name in the same folder cannot both be migrated.** The natural key
  is the path, and the ledger's unique index on it makes that a hard stop, not a setting.

---

## Domain-wide delegation — one admin action instead of N consents

A Workspace admin can authorise a **service account** to impersonate users, once, for an
enumerated list of scopes. Use it when per-user consent ceremonies do not scale; skip it
for a handful of accounts. **Read the width before choosing it: the key can read every
user in the domain for the authorised scopes.** Each mapping still names exactly one
account (the subject); what widens is the credential, not any mapping.

1. **Create a dedicated service account** (IAM → service accounts) in any Google Cloud
   project — no roles, nothing else on it. Its only job is this migration.
2. **Generate a JSON key** (keys → add key → JSON). This file is now the most sensitive
   secret in the migration; treat it like one.
3. **Authorise it in the Admin console**: Admin → Security → Access and data control →
   API controls → **Domain-wide delegation** → add the service account's *client id* with
   ONLY the scopes the chosen products need — never a superset "to be safe":

   | product | scope |
   |---|---|
   | Drive | `https://www.googleapis.com/auth/drive.readonly` |
   | Gmail | `https://mail.google.com/` |
   | Calendar | `https://www.googleapis.com/auth/calendar` |
   | Contacts | `https://www.googleapis.com/auth/carddav` |

4. **Configure it**: paste the whole key file into the wizard's "Service account key"
   field and state each migration's account. (If you run Ownpace yourself from
   configuration files, the same key goes in `GOOGLE_SERVICE_ACCOUNT_KEY`, with each
   mapping's account as `user` — for Drive too.) The
   refresh-token fields stop being required; the refusals will say so if something is
   missing.
5. **Revoke at cutover.** Delete the Admin-console delegation entry (and the key) when the
   migration finishes — the credential's lifetime is the migration's, and this step is as
   much part of the runbook as step 3.

A mint-time `unauthorized_client` means step 3 is missing or lists the wrong scope — the
error names the client id and scope to add. An `invalid_grant` usually means the subject
is not a user in the domain.
