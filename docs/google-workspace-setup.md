# Google Workspace setup — Drive, Gmail, Calendar and Contacts as migration sources

**Reference:** workplan 0042 (Drive), workplan 0044 (Gmail), workplan 0045 (Calendar &
Contacts). The Microsoft equivalent is [`o365-setup.md`](./o365-setup.md).

This is what an operator does once, in the customer's own Google Cloud project, to let
Open-Migrate read a Google Drive. It ends with three values that go in `.env` (appliance) or
the connection's stored credentials (managed), and one command that proves they work.

**The same model as O365, for the same reasons.** The app registration lives in the
**customer's** project, registered by them; the credential never leaves their custody; and
revoking it is theirs — delete the OAuth client and every token dies.

---

## What the token can do

`https://www.googleapis.com/auth/drive.readonly`, and nothing else. A migration reads. The
token this product mints cannot create, modify or delete anything in the source Drive, which
is a stronger guarantee than a promise in a document — it is enforced by Google.

It is a **delegated** credential: it reads the Drive of the person who consents, including the
shared drives that person can see. There is no service-account / domain-wide-delegation path
yet; that would read every user's Drive from one credential and needs the same explicit
scoping decision `o365-setup.md` records for Microsoft's equivalent.

---

## 1. The project and the API

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project (or pick one).
2. **APIs & Services → Library →** enable **Google Drive API**. Nothing works before this, and
   the error when it is missing (`accessNotConfigured`) does not say which API.

## 2. The consent screen

**APIs & Services → OAuth consent screen.**

- **Internal** if the account is in the same Workspace organisation — the right answer for a
  migration, and it skips Google's verification review entirely.
- **External** only if the source is a personal Google account. Add that account as a **test
  user**, or consent fails.
- Add the scope `https://www.googleapis.com/auth/drive.readonly`. Add nothing else: an
  unnecessary scope is a permission somebody has to justify later.

## 3. The OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID.**

Pick **Web application** and add `https://developers.google.com/oauthplayground` as an
authorised redirect URI. That is only to obtain the refresh token in step 4; the appliance
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
revoked, and it does not expire on its own. It does die if: the account's password changes,
an admin revokes the app, the OAuth client is deleted, or it goes six months unused. All four
produce the same `invalid_grant` from Google, and the appliance's error message names them.

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
named by its own id, and so is a **folder somebody shared with this account** (workplan
0051): "Shared with me" is a view, not a folder, so its contents never appear under My
Drive's tree — rooting a separate mapping at the shared folder's id is how such a folder
migrates. To see the ids this credential can reach, run
`pnpm exec tsx scripts/list-shared-drives.ts` and `pnpm exec tsx scripts/list-shared-folders.ts`
(appliance) or use the wizard's **Browse shared drives & folders** button on the
credentials step (managed) — all read-only listings through the same connector a pass uses
(workplans 0049, 0051). Loose shared *files* — shared with you but not inside a folder you
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
Doc, a Sheet and a Slide. Then record what you found in
[`workplans/0042-google-drive-source.md`](./workplans/0042-google-drive-source.md) (T3).

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

## Gmail as a mail source (workplan 0044)

The same project, the same consent screen, the same OAuth client — steps 1–3 above are done
once and serve both. What differs is the **consent** the refresh token carries and the name
it is stored under.

**The scope is `https://mail.google.com/`, and there is no narrower choice.** Open-Migrate
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
mail token is requested. That is why the appliance stores the mail token under its own name:

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
per view it appears in, so Open-Migrate drops the three views (recognised by Google's own
`\All`/`\Flagged`/`\Important` attributes, which survive localisation) and migrates
everything real: INBOX, your labels, Sent, Drafts. Trash and Spam are excluded from the copy
by default like every other IMAP source, while the bin is still read for deletion evidence.
A message carrying several labels appears in several folders, but the ledger keys mail by
Message-ID, so it is **copied once** — into the folder where a pass first sees it. A later
sighting under another label is never re-copied; it can surface in the **Moves** queue as a
source-side placement report, which is information, not action. If your labelling is heavy,
expect that queue to describe Gmail's labels rather than anything you did.

## Calendar and Contacts as sources (workplan 0045)

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
  for once; workplan 0042 T1.)
- **Deletions are never taken from Drive's `removed` signal.** Google sets it for losing
  access and for sharing changes, which are not deletions, and this product treats a reported
  removal as *known* rather than suspected — so a Drive source still reports none of those.
  What it DOES read is the owner's **bin**: a file found trashed is a deletion the owner
  performed, reported at once with positive evidence, and the Deletions queue may offer
  removing the target's copy on it. An emptied bin falls back to absence-counting.
- **A moved or renamed file leaves the old copy on the target.** It is detected and reported;
  making the target follow it is [ADR-0030](./adr/0030-relocation-is-positive-evidence.md),
  which is proposed and not yet decided.
- **Two files with the same name in the same folder cannot both be migrated.** The natural key
  is the path, and the ledger's unique index on it makes that a hard stop, not a setting.
