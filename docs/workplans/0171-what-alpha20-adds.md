# Workplan 0171 — What alpha.20 adds

> **In one line:** alpha.20's six features: Apple's export read (Experimental), grant links for Microsoft, Dropbox and Apple, shared calendars left to their owner and re-shared, flag changes kept in step, free space checked before Start, aliases and MX checked on Finish.

## Status — 2026-11-24 (update this block at the end of every session)

**2026-11-24: planned, for alpha.20. Nothing built.** This plan fixes the shared interfaces so
that separate build sessions can take its tasks as parallel pull requests (§9). The owner waived
every waiting period. alpha.19 is still being finished (workplan 0170, a Microsoft calendar
rebuild, a Gmail fix), so **nothing in this plan merges before alpha.19 is tagged**; branches may
open earlier. No database change is expected (§8). Every claim about the code below was read on
`main` at `ca46857`, with file and line.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T1 Apple's export: the reader | builder | 📋 Planned | §2.2–2.4. `apple-privacy` gets a reader; iCloud Drive and photos; refuses what it does not know. L. |
| T2 Apple's export: the screens, guides and site | builder | 📋 Planned | §2.5–2.6. *To be tested* becomes *Experimental*; the part count; the Advanced Data Protection warning; the time-zone sentence corrected. M. After T1's interface. |
| T3 Grant links: the provider seam, and Microsoft | builder | 📋 Planned | §3.2–3.4. `grant.ts`, `Grant.tsx`, the readiness check, made per provider; Microsoft personal and work, bound to the named account. L. Merges before T4 and T5. |
| T4 Grant links: Dropbox | builder | 📋 Planned | §3.5. S. On T3's seam. |
| T5 Grant links: Apple's app-specific password | builder | 📋 Planned | §3.6. M. On T3's seam. |
| T6 Shared calendars: whose calendar it is | builder | 📋 Planned | §4.2–4.4. Ownership read from CalDAV, Google and Graph; a calendar the account does not own is left out by default, listed on *Review and start*. L. |
| T7 Shared calendars: their sharing carried over | builder | 📋 Planned | §4.5–4.6. Google's ACL and CalDAV's invite list become share rows; Nextcloud calendar shares applied over CalDAV; the files-share defect fixed. L. After T6's interface. |
| T8 Flags and read state kept in step | builder | 📋 Planned | §5. A keyword pass on every later pass; CONDSTORE where the server has it; the IMAP target's `\Seen` default fixed; the architecture's line corrected to what is built. L. |
| T9 Free space before Start | builder | 📋 Planned | §6. `capacity()` on each destination; one read-only route; the check on *Review and start*. M. |
| T10 Finish: aliases and the MX check | builder | 🔄 In review | §7. Built on its own branch, a draft pull request; not merged before alpha.19 is tagged. Unit-proved; a real MX change is not (§10). |
| T11 Proofs | builder | 📋 Planned | §10. The integration cases on Stalwart, Nextcloud and `local-pg.sh`, and the managed E2E smoke's cases. M. Last. |
| T12 The managed E2E run | owner | ⏳ **Owner** | Started by the owner on the self-hosted runner, after T11 merges. |
| T13 The owner's decisions | owner | ⏳ **Owner** | §11: D1 to D9. |

**2026-11-24, T10 built (draft pull request, not merged).** Step 4 of Finish lists the addresses
that receive mail and checks MX on a button, on both editions, as §7.2 and §7.3 say, with D7 (a)
and D8 (a). Proved by unit tests only: own domain or not; aliases from recorded Graph and Gmail
answers, `onmicrosoft.com` and `gmail.com` left out; `verifyMX`'s per-resolver answers mapped to
the four lines. **Not proved: a real MX change**, nor a real tenant's or Workspace account's alias
read. Where the build differs from the plan:
- **The known MX hosts start with Cirrux only** (its help page, read 2026-11-24), plus the rule for
  a destination the person runs (an MX host on its own mail host's domain). Soverin's, Infomaniak's
  and mailbox.org's pages could not be read that day, so their hosts are shown for the person to
  judge (D8's *otherwise*) until somebody reads and cites them in `packages/shared/src/finish-mx.ts`.
  The old provider's list has Microsoft (`mail.protection.outlook.com`, from Microsoft Learn); Google's
  page could not be read, so MX still at Google reads *is that your new provider?*, never *ok*.
- **Two outcomes beside the four lines**, said as they are rather than folded into one: the
  resolvers agree there is no MX record (`finish.mx.none`), and none could be asked
  (`finish.mx.unreadable`). And words for a source that cannot be asked, the Gmail API off, a
  failed read, none found, and the ten-second pace.
- **Workspace aliases through the Directory API are not read**: `users.aliases.list` needs
  `admin.directory.user.alias.readonly` in the delegation, which no deployment grants today.
  `sendAs` lists the aliases a person can send as, which a Workspace alias normally is.
- `User.Read` is requested where the scope guard requires it, `graph-domain-source-factory.ts`'s
  `profile` row; T3 adds it to the consent too, and whichever merges second resolves by merging `main`.

**Also in alpha.20, not in this plan** (maintenance, built separately by builders): pg-boss
12.39.0, which moves the job schema one way (workplan 0167's runner; the owner said yes); nginx
1.31.10 and the base-image digests (the pin watch); and the four screen findings of 0160 T2b.

**Not in alpha.20** (the owner: later): the outside monitor (0142 T5), drilled backups, and the
payment journey walked end to end.

## 1. The owner's words

Asked on 2026-11-24 which of the listed items go into alpha.20, the owner answered, verbatim:
*"alpha.20 (advice): yes on all exept the outside monitoring (will come later). Also the payment
roundtrip will come later"*. Waiting periods are waived.

## 2. Apple's data export: iCloud Drive and photos, Experimental

### 2.1 What is there today

- The guide says so: `docs/guides/en/archive.md:47`, *"**To be tested.** We cannot read an Apple
  export yet. Request one only for your own records."* (Dutch at `docs/guides/nl/archive.md:49`;
  the same sentence at `docs/guides/en/apple.md:68`).
- The site says no for both: `site/sources.mjs:135-136`, `{ type: 'file', verdict: 'no', limit:
  'icloudDrive' }` and `{ type: 'photos', verdict: 'no', limit: 'appleExport' }`, with the words
  in `site/copy.mjs:217,219` (Dutch :597, :599).
- The vocabulary knows the provider and has no reader for it:
  `packages/shared/src/archive-providers.ts:35` lists `['google-takeout', 'apple-privacy']`, and
  :56 `ARCHIVE_PROVIDERS_WITH_READERS = ['google-takeout']`. The factory leaves Apple out on
  purpose (`packages/orchestration/src/archive-source-factory.ts:58-62`: *"`apple-privacy` is
  deliberately ABSENT rather than stubbed"*); the form shows *To be tested* with no tick box
  (`packages/shared/src/credential-fields.ts:423-440`, `StartMigration.tsx:1622-1650`).
- The reader waits for a second export: 0116 T3b, `docs/workplans/0116-…md:304`, *"the reader
  waits on export #2"*. That export has not come. The one opened export answered the layout
  (0116 :467): *"Two wrapper levels, then the person's own tree unchanged"*:

  ```
  iCloud Drive.zip
  └── iCloud Drive/          wrapper 1, named for the service
      └── Drive/             wrapper 2
          ├── Drive Details.csv   one flat manifest, inside the data, no path column
          └── testmap/        the person's own tree starts here
  ```

  The CSV's header (0116 :509) is `Title, Base Hash, Type, Size, Created On, Modified On, Last
  Opened On, Favourite, Executable, Package Signature`, dates `MM-DD-YYYY HH:MM:SS` with no time
  zone (:518). The stamps of that export read as US Pacific, not the person's zone (:575-582).
- **No iCloud Photos export has ever been opened.** The repository holds no file name or CSV of
  one. What the reader does with photos is therefore designed to refuse loudly, not to guess (§2.3).
- **A contradiction to correct:** `docs/guides/en/apple.md:88` (and `nl/apple.md:88`,
  `docs/apple-setup.md:133`) says *"Timestamps throughout are **UTC**"*, against 0116's
  measurement.
- Nothing in the repository mentions Advanced Data Protection.

The owner's go-ahead overrides 0116's wait for export #2: the reader is built on the one export,
labelled Experimental, with the two unanswered questions stated as limits (§2.4).

### 2.2 The reader (T1)

`packages/connectors/src/apple-privacy-archive-reader.ts`, an `ArchiveReader`
(`packages/core/src/archive-reader.ts:273-310`), registered in the factory's `READERS`
(`archive-source-factory.ts:78-80`) and added to `ARCHIVE_PROVIDERS_WITH_READERS`, which
`the-form-and-the-readers-agree.unit.test.ts` requires. Multi-part zips are opened as one tree by
the existing `openZipTree` (`packages/connectors/src/archive-tree.ts:243`).

**iCloud Drive.**
1. **Find the data root by its manifest, not by path** (0116 :617-619): the folder that holds a
   file named `Drive Details.csv` whose first line is the header above. Both wrapper names are
   ignored; the walk looks at most four levels down, as Takeout's `findPhotosRoot` does.
2. **Exclude the manifest structurally**, at that one path, never by its name elsewhere (0116
   :496-502): a person's own file called `Drive Details.csv` deeper in the tree is copied.
3. **The tree is the truth** (0116 :526). Each file's path is its path below the data root,
   unchanged; `placeIn` is that folder.
4. **The CSV is joined, not trusted.** It has no path column, so a row is joined to a file only
   when its `Title` and `Size` match exactly one file in the tree. A joined row adds
   `Favourite` to `metadata`, verbatim, and nothing else; an unjoined row is ignored. Dates are
   §2.4.
5. **iWork packages** (`.pages`, `.numbers`, `.key` folders) are copied as the folder they are,
   files and all. Whether Apple zips them as folders was not exercised (0116 :592), so a package
   that arrives as one file is copied as one file: either way nothing is lost.

**iCloud Photos.** A photos part is recognised by its manifest too: a CSV at the data root whose
header names an image file column and a checksum column. The reader is written against Apple's
own description of the export and the parser takes the header's column names from one table in
the file, so the first real export corrects one table, not the reader. Media files are the files
beside it with an image or video extension; albums, if the export carries album CSVs, become
`folders` as Takeout's albums do. **When a zip holds neither manifest, `open()` throws
`ArchiveUnreadable`** with *"This does not look like an Apple export we know"*, never an empty
import (the factory's rule, :58-62).

**Deduplication** is the reader's (`archive-reader.ts:17-38`): the same bytes in two parts or two
albums are one item.

### 2.3 Several parts

Apple splits a large export into parts at the size the person picked (1 to 25 GB,
`archive.md:56`). How it names them, and whether one service's files can straddle two parts, has
not been seen (0116 :470). So:
- Every `.zip` in the chosen folder is read as one export, through `openZipTree`; two zips whose
  manifests disagree (two different exports) are refused, as `downloadInFolder` refuses for
  Takeout (`takeout-archive-reader.ts:620`).
- **A missing part cannot be detected from the files.** The form asks *How many parts did Apple
  give you?*, and the reader refuses when it finds fewer zips, naming the number it found.
- A name that appears in two parts is answered by the first part it was met in, as today
  (`archive-tree.ts:154`).

### 2.4 The limits, stated

- **Time zone.** The CSV's dates carry none, and the one export read as US Pacific. The reader
  takes a file's dates from the zip entry itself: the extended-timestamp field (UTC) when present,
  the DOS time otherwise, which is local to whatever made the zip. A file may be dated hours off,
  never days. The CSV's dates are kept verbatim in `metadata` and not parsed (D6).
- **Parts.** As §2.3: counted against the person's answer, not proven complete.
- **Photos.** Written against Apple's description, not a real export: Experimental until one is
  read and recorded.
- **Advanced Data Protection.** With it on, Apple's export does not include data that is
  end-to-end encrypted, which covers iCloud Photos and iCloud Drive. The guide says so before the
  person requests an export (§2.6). T2 confirms the sentence against Apple's own support page and
  quotes it.

### 2.5 The screens (T2)

The *To be tested* tag goes once `hasArchiveReader('apple-privacy')` is true; the archive card is
already `EXPERIMENTAL` (`packages/shared/src/front-door.ts:224`), so the provider shows the
Experimental tag like the rest of the card. New lines (0118: a hint 12 words and one sentence, an
intro 15, a placeholder 8, a title 8; the rest behind *Why?*):

| Key | English | Dutch |
|---|---|---|
| `account.archiveProvider.apple.parts` | How many parts did Apple give you? | Hoeveel delen gaf Apple u? |
| `account.archiveProvider.apple.parts.hint` | Apple's download page shows the number of parts. | Apples downloadpagina toont het aantal delen. |
| `account.archiveProvider.apple.parts.why` | We cannot tell from the files whether one is missing, so we count them against your answer. Put every part in the same folder, unopened. | Aan de bestanden zelf zien we niet of er een ontbreekt, dus tellen we ze tegen uw antwoord. Zet alle delen ongeopend in dezelfde map. |
| `account.archiveProvider.apple.adp` | Advanced Data Protection on? Apple leaves photos and Drive out. | Geavanceerde gegevensbescherming aan? Dan laat Apple foto's en Drive weg. |
| `account.archiveProvider.apple.adp.why` | Apple cannot export what it cannot read. Turn Advanced Data Protection off before you request the export, and on again when it is downloaded. | Apple kan niet exporteren wat het zelf niet kan lezen. Zet geavanceerde gegevensbescherming uit vóór u de export aanvraagt, en weer aan zodra die is gedownload. |
| `account.archiveProvider.apple.fewerParts` | Found {found} of {expected} parts; add the rest to the folder. | {found} van {expected} delen gevonden; zet de rest in de map. |

The `account.archiveProvider.noReader.apple-privacy` hint is removed with its tag.

### 2.6 The guides and the site (T2)

- `docs/guides/{en,nl}/archive.md` `#apple-privacy`: *To be tested* becomes *Experimental*; the
  Advanced Data Protection paragraph goes before *request*; the part count; the dates sentence of
  §2.4. `apple.md` `#files` points to it instead of saying it cannot be read.
- `apple.md:88`, `nl/apple.md:88` and `docs/apple-setup.md:133`: *"Timestamps throughout are
  UTC"* replaced by what 0116 measured.
- `site/sources.mjs:135-136`: both rows `verdict: 'yes', experimental: true, by: 'archive'`, with
  `site/copy.mjs`'s two limits rewritten to say *through Apple's own export*.
  `scripts/leaving-pages-say-what-the-app-says.unit.test.ts` holds the row equal to
  `sourceFaceIsExperimental`; photos still go to `EXPORT_TARGETS` only (`sources.mjs:42`).

## 3. Grant links beyond Google

### 3.1 What is there today

A grant link works for Google only, and on three layers:
- the web decides which cards may have one: `apps/web/src/services/start-plan.ts:232-246`,
  `grantableByLink`, which returns `false` unless `served.googleClient === 'deployment'` and then
  only for the five Google cards;
- the API refuses any other source: `apps/api/src/routes/migrations/grant-link-readiness.ts:250-260`,
  `'source_not_google'`;
- the page follows Google only: `apps/web/src/pages/Grant.tsx:198` and :385,
  `consentToFollow('google', url)`, else `NOT_GOOGLE`.

`docs/grant-links.md:80` and :143-144 say the rest out loud: *"For other sources, the credential
still comes to you by hand."* The account binding is Google's alone
(`apps/api/src/routes/migrations/signed-in-account.ts:72-152`: `openid` and `userinfo.email`
asked, the ID token's `email` compared, refusals `no_named_account | unconfirmed |
another_account`). The Microsoft and Dropbox connect flows exist for the owner's own screens
(`microsoft-oauth-routes.ts`, `dropbox-oauth-routes.ts`) and check no account at all: Microsoft
relies on `prompt=select_account` (`microsoft-consent.ts:20-28,75`), Dropbox on nothing. Apple's
app-specific password is typed in the owner's `AccountForm` (`credential-fields.ts:348-385`).

The tables are provider-neutral already: `mapping_link` (ledger 0031) and `person_link` (managed
0034, 0036) hold a hash, an expiry and the spend, and nothing about Google. **No database change.**

### 3.2 The seam (T3)

`apps/api/src/routes/grant-providers.ts`, one entry per provider:

```ts
export type GrantProviderId = 'google' | 'microsoft' | 'dropbox' | 'apple';

export interface GrantProvider {
  readonly id: GrantProviderId;
  /** The source kinds a link of this provider can connect. */
  readonly sourceKinds: ReadonlySet<string>;
  /** Whether this deployment can serve it (its own client registered, or always, for Apple). */
  readonly served: (env: DeploymentFacts) => boolean;
  /** OAuth providers: the consent URL, bound to the named account. */
  readonly consentUrl?: (a: { account: string; state: string; redirectUri: string; locale: string }) => string;
  /** OAuth providers: the code exchanged, and the account that actually signed in. */
  readonly finish?: (code: string, redirectUri: string) => Promise<{ secret: StoredSourceSecret; signedInAs: SignedInAccount }>;
  /** Apple: a password tried against the provider before it is stored. */
  readonly tryPassword?: (account: string, password: string) => Promise<{ secret: StoredSourceSecret } | { refused: string }>;
}

export interface SignedInAccount {
  readonly address: string;          // as the provider confirmed it
  readonly confirmed: boolean;       // verified by the provider, not typed by the person
  readonly alsoKnownAs?: readonly string[]; // Microsoft: UPN, mail, proxy addresses
}
```

- `grant-link-readiness.ts`: `isGrantableSourceKind` becomes a lookup over the served providers'
  `sourceKinds`; the refusal `source_not_google` becomes `source_not_grantable`, naming the
  providers this deployment serves.
- `signed-in-account.ts`: `signedInAccountRefusal` takes a `SignedInAccount`, so every provider
  meets the same three refusals; `sameGoogleAccount`'s folding stays Google's.
- `grant.ts`: `POST /:link/google/authorize` becomes `POST /:link/:provider/authorize`, with
  `google` kept as it is; `PUT /:link/apple/password` is new (§3.6). The callbacks of Microsoft
  and Dropbox gain the link branches Google's has (`google-oauth-routes.ts:280-420`), through the
  same `storePersonGrant` and `storeGrantedToken` (`grant-ending.ts:172`): spend, check the
  account, write, one transaction; a wrong account's token is dropped and the link stays live.
- `GET /:link` reports, per account on the link, its `provider`.
- `start-plan.ts`: `grantableByLink(card, served)` reads `served.grantProviders`, a list the API
  already returns with the deployment's facts.
- `Grant.tsx`: one `PersonGrant` per account, its button by provider: *Continue with Google /
  Microsoft / Dropbox as {account}*, and for Apple the password form (§3.6).
  `consentToFollow(provider, url)` checks the host per provider (`accounts.google.com`,
  `login.microsoftonline.com`, `www.dropbox.com`).
- `docs/grant-links.md`: the refusal row and the *"by hand"* sentences rewritten per provider.

### 3.3 Microsoft, personal and work (T3)

- **The consent.** `microsoft-consent.ts`'s URL with the link's account as `login_hint`, and the
  scopes `openid email profile User.Read` added to the read scopes of
  `packages/shared/src/microsoft-scopes.ts:52-58`. The tenant is `common` unless the link's
  connection names one (`microsoft-deployment-client.ts:48,170-212`); `domain_hint=consumers`
  for an address on a Microsoft consumer domain (`address-forms.ts` `NOT_TAKEN_ALONG`), else
  `organizations`.
- **The binding.** At the callback: the ID token's `iss` must be
  `https://login.microsoftonline.com/{tid}/v2.0` for the `tid` it carries, `aud` the client id;
  then `GET /me?$select=mail,userPrincipalName,proxyAddresses` with the new token. The named
  account must equal one of `mail`, `userPrincipalName` or an `smtp:` proxy address, compared
  without case; an `email` claim alone is not enough, since a work account may set it freely.
  For a personal account (`tid` 9188040d-6c67-4c5b-b112-36a304b66dad) the sign-in name is the
  `preferred_username`, compared the same way.
- **The secret** stored is today's Microsoft refresh token with its tenant.
- **Served** when the deployment has a Microsoft client (`MICROSOFT_OAUTH_CLIENT_ID`) whose
  registration admits personal accounts (`docs/microsoft-setup.md:22-27`); a work tenant whose
  administrator requires admin consent refuses at Microsoft, and the page says so in the
  refusal's words.

### 3.4 What the person sees (T3)

| Key | English | Dutch |
|---|---|---|
| `grant.continue.microsoft` | Continue with Microsoft as {account} | Doorgaan met Microsoft als {account} |
| `grant.continue.dropbox` | Continue with Dropbox as {account} | Doorgaan met Dropbox als {account} |
| `grant.wrongAccount` | You signed in as {signedIn}; this link is for {account}. | U meldde zich aan als {signedIn}; deze link is voor {account}. |
| `grant.wrongAccount.why` | Nothing was stored. Sign out of {provider} in this browser, then use the link again. | Er is niets opgeslagen. Meld u in deze browser af bij {provider} en gebruik de link opnieuw. |

### 3.5 Dropbox (T4)

`dropbox-consent.ts`'s URL as today (`token_access_type=offline`, scopes at :87), no login hint
(Dropbox takes none). The binding is read after the exchange: `POST
/2/users/get_current_account` (`account_info.read` is already asked), whose `email` must equal
the named account and whose `email_verified` must be true. Served when the deployment has a
Dropbox client.

### 3.6 Apple: a page where the person pastes their own password (T5)

Apple has no OAuth for mail, calendars or contacts (`credential-fields.ts:350-369`), so the grant
is the app-specific password, typed by the person and never seen by the owner.
- The page names the account and shows the steps of `docs/guides/en/apple.md:22-39` folded under
  *How?*; the username is the link's account and cannot be edited.
- `PUT /api/grant/:link/apple/password` with `{ account, password }`: the password is tried with
  the existing probe (IMAP login to the endpoint of `provider-endpoints.ts:65-83`, then CalDAV
  and CardDAV for the faces the migration copies); only when it works is it stored encrypted in
  the source secret and the link spent, in the same transaction order as §3.2.
- Five wrong tries on one link lock the link for that account; the owner issues a new one. The
  password is never logged, never in an audit row, and the response never echoes it.

| Key | English | Dutch |
|---|---|---|
| `grant.apple.title` | Connect your Apple Account | Koppel uw Apple-account |
| `grant.apple.password` | App-specific password | Appspecifiek wachtwoord |
| `grant.apple.password.hint` | Not your Apple Account password: one you make at account.apple.com. | Niet uw Apple-wachtwoord: een dat u maakt op account.apple.com. |
| `grant.apple.submit` | Check and connect | Controleren en koppelen |
| `grant.apple.refused` | Apple did not accept this password; check it and try again. | Apple accepteerde dit wachtwoord niet; controleer het en probeer opnieuw. |
| `grant.apple.locked` | Too many tries; ask {owner} for a new link. | Te vaak geprobeerd; vraag {owner} om een nieuwe link. |

## 4. Shared family calendars

### 4.1 What is there today

Every calendar an account lists is copied, including one someone else shared with it. Two
people's migrations then each make an unshared copy of the same family calendar.
- **CalDAV reads no owner or sharing.** `packages/connectors/src/caldav-source.ts:409-446`,
  `listCollections`, asks `displayname`, `resourcetype`, `calendar-description`,
  `calendar-timezone`, `supported-calendar-component-set` and a colour (:410-420), and
  `parseCollectionsResponse` (:1128-1210) reads nothing else. No `DAV:owner`, `CS:invite`,
  `oc:invite` or `current-user-privilege-set` anywhere. Google Calendar and Apple run through the
  same source (`google-dav-source-factory.ts:8-15`; `dav-factories.ts`).
- **Google's sharing is not read**: `apps/api/src/routes/permissions.ts:917-926`, *"Google
  Calendar sharing is not read by Ownpace yet; only sharing on Google Drive is."* The granted scope
  is the full `https://www.googleapis.com/auth/calendar`
  (`google-dav-source-factory.ts:44`; `account-qualification.ts:1026`), which reads
  `calendarList` and a calendar's ACL. No Calendar API call exists today.
- **Graph** declares `isShared` and `canShare` and never reads them
  (`graph-calendar-source.types.ts:35-38`; `graph-calendar-source.ts:74-106` keeps only name and
  colour).
- **Nothing selects calendars.** The only collection exclusion is mail's `excludeSpecialUse`
  (`packages/shared/src/config.ts:755-760`, applied in `packages/core/src/reconcile.ts:87-102`).
- **A defect on the way.** `packages/core/src/permission-map.ts:59-69` marks every calendar grant
  `clean`, *"a Nextcloud calendar share"*, and `applyShareGrant`
  (`packages/core/src/share-queue.ts:459-555`) does not look at `row.subject` before calling
  `createShare`, which on Nextcloud is the **files** share API
  (`packages/connectors/src/nextcloud-ocs.ts:187`;
  `operating-routes.ts:561-655`). A Graph calendar row would be sent to it with its label as a
  file path. Read, not run.

### 4.2 Whose calendar it is (T6)

`CalendarFolder` (in `packages/shared/src/ports.ts`) gains:

```ts
/** Whose calendar this is, as the source says (workplan 0171). */
readonly ownership?: {
  /** true: this account owns it. false: shared with it by someone else. Absent: not said. */
  readonly owned?: boolean;
  /** The owner's address, when the source names it. */
  readonly ownerAddress?: string;
};
```

| Source | How `owned` is read |
|---|---|
| CalDAV, any server (Nextcloud, Apple, the generic source of 0169) | `DAV:owner` added to the PROPFIND of :410-420; owned when it equals `current-user-principal` (already read at :1076-1081). A server that sends no `DAV:owner` leaves it absent. Nextcloud also marks a shared calendar with `oc:owner-principal`; read as the same. |
| Google Calendar | `GET https://www.googleapis.com/calendar/v3/users/me/calendarList?fields=items(id,accessRole,primary)`, once per listing, with the granted scope. Owned when `accessRole` is `owner`. The CalDAV href carries the calendar id (`/caldav/v2/{id}/events`), which joins the two. |
| Microsoft Graph | `$select=id,name,hexColor,owner,canShare,isShared` on `/calendars`; owned when `owner.address` equals the account. |

### 4.3 The default: left to its owner (T6, D1)

A calendar with `owned === false` is **not copied by default**. It is left out in
`reconcile.ts`'s `listFolders` wrapper, as an excluded special-use folder is, and reported in
`excludedCollections`, so it is said and never counted absent or deleted. Its owner's own
migration copies it, and §4.5 shares it again.

A calendar whose owner is not migrating (a school's or a club's) would then be lost. So *Review
and start* lists the calendars left out, each with a tick, *Copy anyway, as my own copy*.
A ticked calendar is stored in `mailbox_mapping.source_config_override`:

```json
{ "calendars": { "copyNotOwned": ["<collection path>", "…"] } }
```

merged, never replaced, as 0125 §5 and 0170 §5.1 do. Discovery reads ownership too, so the
counts on *Review and start* are of what will be copied. `owned` absent means copied, as today.

| Key | English | Dutch |
|---|---|---|
| `start.check.notOwned.title` | Calendars shared with you | Agenda's die met u gedeeld zijn |
| `start.check.notOwned.hint` | Left to their owner's migration, so they stay shared. | Overgelaten aan de migratie van de eigenaar, zodat ze gedeeld blijven. |
| `start.check.notOwned.why` | Copying a calendar someone shared with you makes a separate copy that nobody else sees. When its owner moves too, their migration copies it and shares it with you again. Tick one whose owner is not moving. | Een agenda kopiëren die iemand met u deelde, maakt een losse kopie die niemand anders ziet. Verhuist de eigenaar ook, dan kopieert diens migratie de agenda en deelt die opnieuw met u. Vink er een aan waarvan de eigenaar niet verhuist. |
| `start.check.notOwned.copy` | Copy anyway, as my own copy | Toch kopiëren, als eigen kopie |
| `start.check.notOwned.owner` | Owner: {owner} | Eigenaar: {owner} |

### 4.4 Revising it later (T6)

`copyNotOwned` is a revisable field in `packages/shared/src/config-revision.ts`. Adding a
calendar is allowed at any time (the next pass copies it). Removing one stops copying it and
deletes nothing at the destination (hard rule 2).

### 4.5 Sharing carried over (T7)

The permission inventory gains calendar grants from the two sources the owner named, and from
Graph where it is read today:

- **Google:** `GET /calendar/v3/calendars/{id}/acl` for each owned calendar, with the granted
  scope. Each rule with `scope.type === 'user'` becomes a grant (`reader`/`freeBusyReader` →
  read, `writer`/`owner` → read-write); `group`, `domain` and `default` become manual rows, said,
  since a destination has no such grantee. `permissions.ts:917-926`'s *not read* sentence goes.
- **CalDAV (Nextcloud, the generic source of 0169, Apple):** the PROPFIND of §4.2 also asks
  `CS:invite` (`http://calendarserver.org/ns/`) and `oc:invite` (`http://owncloud.org/ns`). Each
  `user` or `sharee` with its access becomes a grant. A server that answers neither leaves the
  report's *not read* sentence, as today.
- Grantee addresses pass through 0168's address-change table before they are written, as share
  grantees already do.

### 4.6 Sharing applied at Nextcloud (T7)

A calendar row is applied with a calendar share, never the files API:
- `packages/connectors/src/nextcloud-calendar-share.ts`: `POST {calendar url}` with
  `Content-Type: application/xml` and
  `<o:share xmlns:d="DAV:" xmlns:o="http://owncloud.org/ns"><o:set><d:href>principal:principals/users/{uid}</d:href><o:read-write/>?</o:set></o:share>`,
  the grantee resolved to a Nextcloud user the way a files row's `shareWith` is.
- `ApplyShareDeps` gains `createCalendarShare?`; `applyShareGrant` branches on `row.subject`, and
  a calendar row with no `createCalendarShare` is refused `no_share_api`, which closes the
  defect of §4.1 for every target.
- `permission-map.ts:59-69`'s verdict stays `clean` for a Nextcloud or WebDAV-family target and
  becomes `manual` for any other, so the checklist promises only what it can do.
- The same gates as files: never before that calendar's cutover (`share-queue.ts:491`), never a
  link share, ADR-0032's *the invite is the notification*.

## 5. Flag and read changes after the first copy

### 5.1 What is there today

- Keywords are written once: `packages/core/src/reconcile.ts:195-196`, the mail `upsert` passes
  `(item as MailItem).keywords` to `upsertEmail`, which is create-if-absent
  (`packages/shared/src/ports.ts:703-727`).
- Mail reports no `sourceVersion`, so a known message is skipped whatever its flags
  (`packages/core/src/domain-sync.ts:763-773`; :573 `if (sourceVersion === undefined) return
  'skip';`).
- The IMAP source fetches `1:*` with flags on every pass and then drops every uid below the
  cursor (`packages/connectors/src/imapflow-source.ts:403,452-460`); Graph's delta returns
  changed messages with `isRead` and `flag` (`graph-mail-source.ts:61,374-380`), which the
  ledger then skips.
- No target can change a keyword: JMAP sets them only on `Email/import`
  (`jmap-target.ts:1018-1023`); IMAP only in the `APPEND` (`imapflow-dav-target.ts:358-377`).
- No CONDSTORE, QRESYNC or MODSEQ anywhere in the code.
- The architecture says otherwise: `docs/architecture/solution-architecture.md:223` sorts *flag
  changes* under **automatic**, and :186 lists *IMAP `CONDSTORE`/`QRESYNC`* among the cheap
  deltas.
- **A defect on the way:** `imapflow-dav-target.ts:376`, `flags.length > 0 ? flags :
  ['\\Seen']`. An unread message with no other flag lands **read** at an IMAP destination; an
  unread flagged one lands unread. JMAP has no such default.

### 5.2 The advice: keep them in step (D2)

The architecture is right about what a person expects during a shadow run: they read mail at the
old provider and the new mailbox should show it read. And it is cheap, because the listing that
would see it is already made. So T8 builds it, and the architecture's two lines are corrected to
say exactly what is built (§5.5). The other way, correcting the document only, leaves every
shadow run showing old mail unread at the destination.

### 5.3 The design (T8)

**Only the source's changes, applied as a difference.** The ledger keeps the keywords last
written (below). On a later pass, the change at the source since then (added, removed) is applied
to the destination with a patch, never by setting the whole set. A keyword the person changed at
the destination is therefore left alone unless the source changed the same keyword: the source
wins only on what changed at the source.

- **The record.** `item_ledger.source_version`, already a column (ledger `0001_baseline.sql:294`)
  and unused by mail, holds the keywords last written: `kw:` and the sorted keywords joined by a
  space. No database change. A mail row whose `source_version` is null (every row copied before
  alpha.20) is written once with the source's state as a whole set, then recorded: before a
  cutover the destination is not where the person reads.
- **The deps.** `DomainSyncDeps` gains, for mail only:

  ```ts
  /** The source's keywords for a known item changed: patch them at the destination (0171). */
  readonly updateKeywords?: (targetId: string, item: Item, change: { add: readonly string[]; remove: readonly string[] }) => Promise<void>;
  ```

  and mail's `sourceVersion` returns the `kw:` string, so `classifyKnownItem` answers `update`
  for a changed one, and the update path calls `updateKeywords` instead of fetching the body.
- **The targets.** `TargetWriter.updateKeywords?(mailboxId, targetId, change)`: JMAP
  `Email/set` with `update: { id: { 'keywords/$seen': true | null, … } }`; IMAP `STORE` `+FLAGS`
  and `-FLAGS` by UID (`messageFlagsAdd`/`messageFlagsRemove` in imapflow). A target without it
  leaves the item as it is and says so once per pass.
- **The listing.** The IMAP source returns, beside the new messages, the known ones whose flags
  it saw: today's `1:*` fetch already carries them; they go to the loop as
  `keywordChanges`, never copied, only compared. Where the server announces `CONDSTORE`, the fetch
  is `1:* (UID FLAGS) (CHANGEDSINCE {modseq})`, and the highest modseq is kept under a reserved
  cursor key, `keywordCursorKey(collectionPath)` (`\u0001keywords\u0001…`, as 0170 §3.3 builds
  its keys), so the content cursor `uidValidity:uidNext` is untouched. A changed `UIDVALIDITY`
  drops it. QRESYNC is not used: Ownpace reports deletions through the bin and the ledger, not
  `VANISHED`. Graph mail: the delta's changed messages go the same way. Gmail over IMAP: as IMAP.
- **The mapping.** `imap-conventions.ts:118-129` knows `\Seen`, `\Flagged`, `\Draft` and
  `\Answered`; `$Forwarded` and `$Junk`/`$NotJunk` are passed through as keywords, nothing else.
- **What it never does:** move, delete or re-copy a message; change a keyword the source did not
  change; run after the data type's cutover (the destination is where the person works then).
- **The defect:** `imapflow-dav-target.ts:376` appends with the source's flags, empty or not.

### 5.4 0170's window

A window pass (0170 §3.2) compares keywords for known items in the window only; phase B for the
rest. Nothing set aside by a window is compared.

### 5.5 The architecture (T8)

`solution-architecture.md:186` becomes *IMAP `CONDSTORE` for flag changes where the server has
it*; :223's *flag changes* stays under **automatic**, now true, with *(the source's own changes,
until the cutover)*; :197's *Flags/categories/importance* is corrected to the four flags and two
keywords above, categories and importance not carried. `packages/ledger/README.md:40`'s
`HIGHESTMODSEQ` points to the keyword cursor.

## 6. Free space at the destination, before Start

### 6.1 What is there today

- **Cirrux** reads its pool before the first upload of a pass and refuses a file that would not
  fit (`packages/connectors/src/cirrux-drive-target.ts:37-39,680-698`).
- **Nextcloud** is not read: the chunked upload sends `OC-Total-Length` so that Nextcloud can
  refuse with 507 (`packages/engines/src/webdav-target-writer.ts:1336-1338`), for files over
  64 MiB only (`nextcloud-chunked-upload.ts:83`).
- No IMAP `GETQUOTAROOT`, no JMAP `urn:ietf:params:jmap:quota`, no WebDAV
  `quota-available-bytes` on any destination (the WebDAV *source* reads it,
  `webdav-source.ts:444-445`). `mailbox_mapping`'s `quota_bytes` column is read and written by
  nothing (`schema-pg.ts:189`).
- *Review and start* already has the size: discovery sums `bytes` per data type
  (`packages/core/src/discovery.ts:136-214`; `migration_discovery.bytes`), and the web adds them up
  (`apps/web/src/components/CeilingAtStartNote.tsx:21-30`, `measuredBytes`). Start
  (`apps/api/src/routes/migrations/index.ts:4482`) checks no space.

### 6.2 The interface (T9)

`packages/shared/src/ports.ts`:

```ts
/** What a destination says about its room (workplan 0171). */
export type DestinationCapacity =
  | { readonly known: true; readonly freeBytes: number; readonly totalBytes?: number; readonly pool: string }
  | { readonly known: false; readonly why: 'not_offered' | 'unlimited' | 'not_answered' };

/** On a destination writer: its free space, read once, without writing. */
capacity?(): Promise<DestinationCapacity>;
```

`pool` names what the number covers, so two data types that land in the same account are added
together against one number, not counted twice: the JMAP account id, the IMAP quota root, the
WebDAV collection URL, Cirrux's workspace.

| Destination | Read | Unknown when |
|---|---|---|
| Nextcloud, any WebDAV | `PROPFIND` `Depth: 0` on the destination folder for `quota-available-bytes` and `quota-used-bytes` (RFC 4331) | absent, or Nextcloud's negative values (−3 unlimited, −1/−2 not computed) |
| IMAP (Soverin, Cirrux mail, any) | `GETQUOTAROOT INBOX` (RFC 9208) when `QUOTA` is announced; `STORAGE` is in KiB | no `QUOTA` capability, or no `STORAGE` resource |
| JMAP (Stalwart, any) | `Quota/get` (RFC 9425) when the session lists `urn:ietf:params:jmap:quota`; `resourceType: 'octets'`, scope `account` | capability absent |
| Cirrux Drive | the existing `GET /workspace/storage` (`cirrux-drive-api.ts:167-170`) | the read fails |
| CalDAV, CardDAV | not read: calendars and contacts are small beside mail and files | always `not_offered` |

### 6.3 The route and the screen (T9)

`GET /api/migrations/:mappingId/destination-space`, read-only, on managed and the appliance: it
opens each destination writer of the migration, calls `capacity()` with a ten-second limit each,
and answers per pool `{ pool, dataTypes, needBytes, capacity }`, where `needBytes` is the sum of
`migration_discovery.bytes` for the data types in that pool. Read live on *Review and start*, not
stored: **no database change**. Mail's need is the source's message sizes, which a destination
stores at roughly the same size; files' is exact.

On *Review and start*, one line per pool, under the counts:

| Key | English | Dutch |
|---|---|---|
| `start.check.space.fits` | {need} to copy; {free} free at {destination}. | {need} te kopiëren; {free} vrij bij {destination}. |
| `start.check.space.short` | {need} to copy, but only {free} free at {destination}. | {need} te kopiëren, maar slechts {free} vrij bij {destination}. |
| `start.check.space.short.why` | What does not fit is refused by the destination, item by item, and listed for you. Make room or raise the quota first, then start. | Wat niet past, weigert de bestemming item voor item, en u ziet welke. Maak eerst ruimte of verhoog het quotum, en start dan. |
| `start.check.space.unknown` | {destination} does not tell us its free space. | {destination} vertelt ons niet hoeveel ruimte vrij is. |
| `start.check.space.unknown.why` | Check it at {destination} before you start: there is {need} to copy. | Kijk het na bij {destination} voordat u start: er is {need} te kopiëren. |
| `start.check.space.startAnyway` | Start anyway | Toch starten |

What Start does in each case is D3 and D4. The advice: known and enough, nothing in the way;
unknown, said, Start allowed; known and short, Start held behind *Start anyway*.

## 7. Switching over on your own domain: aliases and the MX check

### 7.1 What is there today

- **Finish says the MX step cannot be checked.** `apps/web/src/pages/Finish.tsx:18-21`, *"it is
  the one precondition nothing can check"*; `apps/web/src/i18n/strings/finish.ts:83-84`, *"This
  happens outside Ownpace's reach, so it is the one step here nobody can check for you."* (Dutch
  :188-189). Step 4 is a tick (`Finish.tsx:629-647`), shown when mail is in its active phase
  (:296).
- **The worker CLI already checks it.** `apps/worker/src/cli/cutover-commands.ts:669-676` calls
  `checkPropagation(dnsDomain, [{ type: 'MX', value: targetMailServer }], 10, 30000)`, from
  `packages/core/src/dns-verify-only.ts:201`; `verifyMX(domain)` is at :118, reading three public
  DNS-over-HTTPS resolvers and requiring two to agree (:20-24, :123). No API route exposes it.
- **No aliases are read.** No `proxyAddresses`, `otherMails` or Gmail `sendAs` in the code;
  Graph reads select `userPrincipalName,mail` only (`graph-directory.ts:76`);
  `packages/shared/src/permissions.ts:167-184` says send-as is not read.
- **The own domain is known in one place only:** `cannotTakeAlong(address)`
  (`packages/shared/src/address-forms.ts:310`), used by the address step. Finish shows the
  own-domain and the `@gmail.com` wording to everybody (`finish.step4.body`, `finish.ts:81-82`).

### 7.2 The addresses that receive mail (T10)

`GET /api/migrations/:mappingId/finish/addresses`, read-only, answers the addresses at the old
provider that deliver into this mailbox, each with where it was read:

| Source | Read | With |
|---|---|---|
| Microsoft, delegated | `GET /me?$select=mail,userPrincipalName,proxyAddresses`; every `smtp:`/`SMTP:` entry | `User.Read`, added to the delegated scopes (§3.3, D7). A connection consented before alpha.20 lacks it: the list says *not read; reconnect to list them*. |
| Microsoft, application permissions | `GET /users/{id}?$select=mail,proxyAddresses` | `User.Read.All`, which `graph-access-check.ts:82` already probes |
| Google | Gmail API `GET users/me/settings/sendAs`; each `sendAsEmail`. With whole-domain delegation (ADR-0033) also the Directory API's `users.aliases.list` | the granted `https://mail.google.com/` scope, which the Gmail API accepts for `sendAs.list`; the directory read needs `admin.directory.user.alias.readonly` in the delegation |
| IMAP, Apple, any other | not readable | the list says so and asks the person to add them by hand |

Shown on Finish, step 4, only when the mailbox's own address is on a domain the person controls
(`cannotTakeAlong` is null). Addresses on the old provider's own domains (`onmicrosoft.com`,
`gmail.com`) are left out: they do not move with MX. Each address on the person's domain has a
tick, *Made at the new provider*. The list is advice, not a gate: Ownpace cannot see a
destination's receiving aliases in general. A group's or a distribution list's address is not
read (it needs `Group.Read.All`); the fold says so.

| Key | English | Dutch |
|---|---|---|
| `finish.aliases.title` | Addresses that receive mail | Adressen die mail ontvangen |
| `finish.aliases.hint` | Make each one at the new provider before you move MX. | Maak elk ervan aan bij de nieuwe aanbieder voordat u MX omzet. |
| `finish.aliases.why` | Once MX points at the new provider, mail to an address that does not exist there bounces. Group and list addresses are not shown here; check those at the old provider. | Zodra MX naar de nieuwe aanbieder wijst, komt mail aan een adres dat daar niet bestaat terug. Adressen van groepen en lijsten staan hier niet; kijk die na bij de oude aanbieder. |
| `finish.aliases.made` | Made at the new provider | Aangemaakt bij de nieuwe aanbieder |
| `finish.aliases.notRead` | Not read from {provider}; reconnect to list them. | Niet gelezen bij {provider}; koppel opnieuw om ze te zien. |

### 7.3 The MX check (T10)

`POST /api/migrations/:mappingId/finish/mx-check`, on managed and the appliance, calls `verifyMX`
for the domain of the mailbox's address and answers the hosts found, whether the resolvers agree,
and whether the hosts belong to the destination: a destination with known MX hosts (a new
`mx` suffix list beside `provider-endpoints.ts`'s hosts, for Stalwart's configured domain,
Soverin, Cirrux, Infomaniak, mailbox.org) is matched; any other is shown as found, for the
person to judge (D8). It is read-only and rate-limited to one call per ten seconds per mapping.

On Finish, step 4 gets a button, *Check MX now*, and one line of result. The tick stays, now
under the result; `finish.step4.more` loses *nobody can check*, and `Finish.tsx:18-21`'s comment
is corrected. Step 4's body is split by domain: the MX sentence for an own domain, the forwarding
sentence for an address that cannot be taken along.

| Key | English | Dutch |
|---|---|---|
| `finish.mx.check` | Check MX now | Controleer MX nu |
| `finish.mx.ok` | MX for {domain} points at {destination}. | MX van {domain} wijst naar {destination}. |
| `finish.mx.other` | MX for {domain} points at {hosts}; is that your new provider? | MX van {domain} wijst naar {hosts}; is dat uw nieuwe aanbieder? |
| `finish.mx.old` | MX for {domain} still points at {hosts}. | MX van {domain} wijst nog naar {hosts}. |
| `finish.mx.disagree` | DNS servers disagree yet; try again in a few minutes. | DNS-servers zijn het nog niet eens; probeer het over een paar minuten. |
| `finish.step4.more` | Changes can take up to a day to reach everyone. Check again before you tick. | Een wijziging kan tot een dag duren voor iedereen haar ziet. Controleer opnieuw voordat u aanvinkt. |

Egress: the API and the appliance reach `cloudflare-dns.com`, `dns.google` and `dns.quad9.net`
over HTTPS. T10 checks the managed compose and the appliance allow it, and says so in the pull
request.

## 8. No database change

Every new fact lives where a column or a key already is:
- the calendars copied anyway, in `mailbox_mapping.source_config_override` (§4.3);
- the keywords last written, in `item_ledger.source_version` (§5.3);
- the keyword modseq, in `cursor` under a reserved key (§5.3);
- free space and aliases are read live, never stored (§6.3, §7.2);
- grant links use `mapping_link` and `person_link` as they are (§3.1).

If a build finds it needs a column after all, it stops and says why in this plan before writing
a migration. alpha.20's deploy is one-way anyway (pg-boss 12.39.0 moves the job schema), so a
migration would not change how the release is rolled back, but it is still not expected.

## 9. The tasks, as pull requests

Sizes: S a day or less, M two to three, L more. Each pull request brings `main` in by merging
(never a rebase), and none merges before alpha.19 is tagged.

| Task | Pull request | Size | Depends on | Proves it with |
|---|---|---|---|---|
| T1 | `apple-privacy-archive-reader.ts`, `archive-source-factory.ts`, `archive-providers.ts` | L | none | Unit: zips built in the test after 0116's layout (two wrappers, the CSV inside, a same-named file deeper, a package folder, two parts, a duplicate across parts, a photos part with its CSV, a zip with neither); `ArchiveUnreadable` for the last; the part count refused. Integration: the archive into Nextcloud on the appliance's fixture. |
| T2 | `credential-fields.ts`, `StartMigration.tsx`, `i18n/strings/*`, the guides, `site/sources.mjs`, `site/copy.mjs` | M | T1's provider in `ARCHIVE_PROVIDERS_WITH_READERS` | `words-that-fit-on-one-line`, `leaving-pages-say-what-the-app-says`, `the-form-and-the-readers-agree`, `site/build.mjs --check`; UI smoke of the form. |
| T3 | `grant-providers.ts`, `grant.ts`, `grant-link-readiness.ts`, `signed-in-account.ts`, `microsoft-*`, `grant-ending.ts`, `person-grant-ending.ts`, `start-plan.ts`, `Grant.tsx`, `grant-service.ts`, `docs/grant-links.md` | L | none | Unit: each refusal per provider; Microsoft's binding over UPN, mail, a proxy address, a personal account, a wrong account (nothing stored, link live), a wrong `iss`; Google unchanged. Integration (`local-pg.sh`): spend, refuse, roll back, in one transaction. |
| T4 | `dropbox-*`, `grant-providers.ts`'s entry | S | T3 | Unit: the binding from `get_current_account`, unverified email refused. |
| T5 | `grant.ts`'s password route, `Grant.tsx`'s form, the probe | M | T3 | Unit: tried before stored; five tries lock; the password in no log, audit row or response (a guard test over the route's output). Integration: against Stalwart's IMAP with a real and a wrong password. |
| T6 | `ports.ts`, `caldav-source.ts`, `graph-calendar-source.ts`, a Google calendar-list reader, `reconcile.ts`, `discovery.ts`, `config.ts`, `config-revision.ts`, the check step | L | none | Unit: each source's ownership; left out and said, never absent; the override merged. Integration: Nextcloud with two users, one sharing a calendar with the other; the sharee's migration leaves it out, and copies it when ticked. |
| T7 | `permissions.ts`, a Google ACL reader, `caldav-source.ts`'s invite read, `nextcloud-calendar-share.ts`, `share-queue.ts`, `permission-map.ts`, `operating-routes.ts`, `apps/selfhost/src/index.ts` | L | T6's `ownership` | Unit: ACL rules to grants; a calendar row never reaches the files API (the defect, as a failing test first). Integration: the owner's migration into Nextcloud shares the calendar with the second user after cutover. |
| T8 | `domain-sync.ts`, `reconcile.ts`, `imapflow-source.ts`, `graph-mail-source.ts`, `jmap-target.ts`, `imapflow-dav-target.ts`, `ports.ts`, `recent-window.ts`'s key, `solution-architecture.md`, `ledger/README.md` | L | none (0170 merged) | Unit: the difference, not the set; a destination-side change kept; a null record written whole once; nothing after cutover; the `\Seen` default gone. Integration on Stalwart (which announces `CONDSTORE`): read and flag at the source, both reach the JMAP and the IMAP destination on the next pass; a third pass writes nothing; the idempotency property tests run with a keyword change (hard rule 1). |
| T9 | `ports.ts`, each destination writer's `capacity()`, the route, `openapi.yaml`, the check step | M | none | Unit: each reader over recorded answers, unknown for each `why`; two data types in one pool added once. Integration: Stalwart (IMAP `QUOTA`, JMAP quota) with a quota set; Nextcloud with a user quota. |
| T10 | the two Finish routes, `Finish.tsx`, `finish.ts`, `microsoft-scopes.ts`, a Gmail `sendAs` reader, the MX host list | M | T3's `User.Read` (or adds it itself if T3 has not merged) | Unit: own domain or not; aliases from recorded Graph and Gmail answers, `onmicrosoft.com` left out; `verifyMX` answers mapped to the four lines. |
| T11 | the integration cases above that span tasks, and `deploy/compose/smoke-managed.sh` | M | T1 to T10 | E2E (managed): `destination-space` answers for the demo destination; the keyword case (flag at the demo source, seen at the destination); a grant link for Apple's page refusing a wrong password. Run by the owner (T12), never dispatched by a build session. |

**What can run at once.** T1, T3, T6, T8 and T9 touch different files and start together. T2
starts on T1's branch; T4 and T5 on T3's; T7 on T6's. T10 takes `User.Read` from T3 or adds the
same line itself; whichever merges second resolves it by merging `main`. The shared interfaces
are fixed in §3.2, §4.2, §5.3 and §6.2; a build that needs to change one says so in this plan
first.

## 10. Proofs, together

- **Unit**, in each task (§9).
- **Integration**, through Testcontainers in CI and on `./scripts/local-pg.sh` where no container
  runtime is; on the Stalwart fixture (`docs/stalwart-integration-fix.md` followed as written, no
  accounts in `config.json`) and the Nextcloud fixture of `deploy/compose/dev.yml`.
- **E2E (managed)**, in `smoke-managed.sh`, run by the owner (T12).
- **What no test here proves**, said in each pull request: a real Apple export of more than one
  part, or of photos; a real Microsoft work tenant's grant link; a real Google calendar ACL; a
  real MX change.

## 11. The owner's decisions

- **D1. A calendar the account does not own.**
  (a) Left to its owner's migration by default, listed on *Review and start* with *Copy anyway*
  per calendar; (b) asked per calendar, nothing chosen until the person answers; (c) copied as
  today. **Advice: (a).** It is what a family wants in the common case, and (b) puts a question
  on every migration of someone in a family with a shared calendar; the list keeps the school's
  calendar from being lost.
- **D2. Flag and read changes.** (a) Kept in step: the source's changes, as a difference, until
  the cutover, with `CONDSTORE` where the server has it, and the architecture corrected to match;
  (b) the architecture corrected only. **Advice: (a)** (§5.2): the listing already carries the
  flags, and a shadow run that shows read mail unread is what people notice first.
- **D3. Free space unknown.** (a) Said, Start allowed; (b) Start held until the person ticks *I
  checked*; (c) Start refused. **Advice: (a).** Many IMAP servers do not announce `QUOTA`, and a
  tick nobody can verify adds a step without a check.
- **D4. Free space known and short.** (a) Start held behind *Start anyway*; (b) Start refused
  until there is room; (c) said only. **Advice: (a).** Mail size at the source and the
  destination differ a little, and a person may be about to raise the quota; the destination
  refuses what does not fit anyway, item by item, and lists it.
- **D5. Which grant providers come first.** All three are in alpha.20; the order decides which
  merges if time runs short. (a) Microsoft, then Apple, then Dropbox; (b) Apple first (no app
  registration needed); (c) Dropbox first (smallest). **Advice: (a).** Microsoft is the source
  most people leave and carries the seam; Apple's page needs nothing from the deployment;
  Dropbox is the smallest and least used.
- **D6. The dates in Apple's export.** (a) The zip's own times; the CSV's dates kept, not parsed;
  (b) the CSV read as US Pacific, as the one export suggests; (c) the CSV read as UTC, as the
  guide says today. **Advice: (a).** One export is not proof of Apple's zone, and a file dated a
  few hours off is better than one dated nine hours off for everyone outside the US.
- **D7. Microsoft's `User.Read`.** Reading aliases and binding a grant link both need it. (a)
  Added to the delegated scopes for every new Microsoft consent; old connections list aliases as
  *not read* until reconnected; (b) asked only on the grant link and at Finish, as a second
  consent. **Advice: (a).** It is the least scope Microsoft has (the person's own profile), and
  one consent is simpler than two.
- **D8. What the MX check calls right.** (a) Matched against the destination's known MX hosts
  where known, otherwise shown for the person to judge; the tick stays; (b) the check replaces
  the tick when it matches. **Advice: (a)** for alpha.20: the list of known hosts starts short,
  and DNS can differ between resolvers for a day.
- **D9. iCloud in alpha.20 without a second export.** (a) Built on the one export, Experimental,
  refusing what it does not know (§2); (b) wait for export #2 as 0116 T3b planned. **Advice:
  (a)**, as the owner's *yes on all* reads; the limits are on the screen and in the guide, and
  the first photos export corrects one table.

## 12. Open questions

1. How Apple names and splits a multi-part export, and whether one service straddles parts
   (§2.3). Answered by the first real export of more than one part.
2. Which time zone Apple's CSV dates use (§2.4, D6).
3. Whether the Gmail API is enabled on the deployment's Google project, which `sendAs.list` needs
   (§7.2). T10 checks; if not, the list says *not read* for Google until it is.
   **T10, 2026-11-24:** not checkable from a build session, which holds no deployment's project.
   The setup guide already asks for it (`docs/google-workspace-setup.md`, step 2, the *Mail* row:
   **Gmail API**). The read answers it on first use: Google's `SERVICE_DISABLED` becomes *Not read
   from Google: the Gmail API is off for this service.*, never an empty list.
4. Whether a delegated `Calendars.Read` reads Graph's `calendarPermissions` for a personal
   account; if so, Microsoft calendar sharing joins §4.5 without application permissions.
5. Whether Stalwart takes calendar shares over JMAP (`shareWith`); if so, a JMAP destination
   joins §4.6. Until then, calendar rows to it are manual.
6. Whether the API's and the appliance's egress allows the three DNS-over-HTTPS resolvers
   (§7.3).
   **T10, 2026-11-24, from the configuration:** nothing stops them. On managed the `api` service is
   on `ownpace-network`, a plain bridge, not `internal`, with no proxy variable
   (`deploy/compose/managed.yml`); the appliance is on its own plain bridge
   (`deploy/selfhost/compose.yml`). Not measured live: the build session's own network refused
   all three. A deployment behind a firewall answers *The DNS servers could not be asked:* with
   their words.
