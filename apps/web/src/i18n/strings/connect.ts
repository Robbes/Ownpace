// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Connecting an account: the account form and the provider consent (`account.*`, `wizard.*` until
 * 2026-10-11), the Accounts page, provider setup, a test of a connection, and the guides.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  'account.proto.imap.hint': 'Standard email protocol',
  // The consent you can click (0089 T1): the button that replaces the OAuth
  // Playground walk. The full evidence stays in the API's refusals; these
  // are the button's own words.
  'account.google.connect': 'Connect with Google',
  'connections.googleFaces': 'What this account will serve',
  // What the button does, in a tester's words (the owner, 2026-10-14): the
  // token it fills in is a box only the appliance shows in plain view, so
  // that half is said there, by `account.consent.pasteToken`.
  'account.google.connect.hint': 'Opens Google’s sign-in page, where you give Ownpace access to this account.',
  'account.google.connect.needsDomains':
    'Tick what to migrate first; the consent asks only for that.',
  'account.google.connect.needsClient': 'Enter the Client ID and client secret first.',
  // One sentence for every provider's consent: what lands is the same
  // token in the same box, and the same save-and-test follows.
  'account.consent.received': 'Consent received — saving and testing this connection.',
  // The arm that must never be silent (workplan 0114): a credential field
  // naming a provider no door has a consent for. Nothing sends a person to
  // the wrong company's consent screen; the form says so and the manual
  // token field is still there.
  'account.consent.noProvider':
    'Ownpace has no Connect button for this type; paste a refresh token instead.',
  // The account first (owner's walk, 2026-09-02): the consent saves and
  // tests in one go, and the save needs the address.
  'account.consent.needsAccount': 'Enter the account address first.',
  // A consent window the browser did not open (workplan 0145 T5): the window
  // opens in the press now, and when it still does not, this sentence and a
  // link to the provider's page take its place. Tapping the link is a new
  // press. Written to read on from the in-app browser line above it.
  'account.consent.windowBlocked': 'Your browser did not open {provider}’s page. Open it with this link:',
  // That link past the consent's ten minutes (CONSENT_STATE_TTL_MS): the
  // server has forgotten it, and a tap would end on its English "expired"
  // refusal. So the link goes, and this asks for the press that starts anew.
  'account.consent.windowExpired': 'The link to {provider}’s page has expired. Press {button} again.',
  // Beside every Connect button, on the managed service (0139 T4;
  // docs/google-oauth-verification.md §5: "Links to the privacy policy and
  // terms sit beside the button, not in a footer."). The two links follow,
  // named as the texts name themselves (`acceptance.doc.*`).
  'account.consent.legal': 'What we do with your data, and on what terms:',
  // Under a Connect button where the refresh-token box is in plain view: the
  // appliance, and a provider the deployment carries no app for. Where the
  // deployment's own app folds the box away (ADR-0041), the token is never
  // typed, and the sentence would name a box the tester cannot see
  // (`ConsentLines`; the owner, 2026-10-14).
  'account.consent.pasteToken':
    'The button fills in the refresh token below; pasting one you already have keeps working.',
  // The deployment's own client (ADR-0041, owner decision 2026-09-01): the
  // pair becomes optional as a whole, and a half-typed pair is named rather
  // than silently completed with the deployment's other half.
  'account.google.deploymentClient':
    'Ownpace has its own Google app; fill in both only to use your own instead.',
  'account.google.connect.halfClient': 'Enter both the Client ID and the client secret, or neither.',
  'account.google.ownClient': 'Use your own Google client',
  // The string Google matches against the client's registered list. It was
  // always in the route's answer and the wizard threw it away, so
  // `redirect_uri_mismatch` arrived naming no address (2026-09-01).
  'account.google.redirectUri':
    'Register this exact address in your Google client under Authorised redirect URIs:',
  // Beside Connect with Google when the consent asks for mail, calendars or
  // contacts (workplan 0144 T3 (a)): Google's screen describes those scopes
  // as allowing changes and deletion, and a tester should hear it here first,
  // with what Ownpace does. Drive and Tasks are read-only at Google and get no
  // line; `googleConsentAllowsChanges` in shared decides. §3's two sentences,
  // whole: a consent sentence, which 0118 §2 keeps verbatim, not a `.hint`.
  'account.google.readsOnly':
    'For mail, calendars and contacts, Google describes a broader permission than Ownpace uses. Ownpace only reads: it changes and deletes nothing in this account.',
  // Beside Connect with Google, always (workplan 0140 T3 (a)): Google is
  // reported to refuse its consent inside another app's built-in browser, and
  // nothing said what to do. The grant page's twin ends "The link still
  // works"; this one ends by signing in again, because the wizard and the
  // Connections page have no grant link to reopen. A consent sentence, kept
  // whole (0118 §2), not a `.hint`.
  'account.google.inAppBrowser':
    'If this page opened inside another app, such as a chat or mail app, use that app\'s \'Open in browser\' option or copy the link into your favorite browser, such as Safari or Chrome, then sign in to Ownpace there.',
  // Connect with Dropbox (2026-09-02): the same button, Dropbox's words.
  'account.dropbox.connect': 'Connect with Dropbox',
  'account.dropbox.connect.hint': 'Opens Dropbox’s sign-in page, where you give Ownpace access to this account.',
  'account.dropbox.connect.needsClient': 'Enter the App key and App secret first.',
  'account.dropbox.connect.halfClient': 'Enter both the App key and the App secret, or neither.',
  'account.dropbox.deploymentClient':
    'Ownpace has its own Dropbox app; fill in both only to use your own instead.',
  'account.dropbox.ownClient': 'Use your own Dropbox app',
  'account.dropbox.redirectUri':
    'Register this exact address in your Dropbox app under OAuth 2 → Redirect URIs:',
  // Connect with Microsoft (workplan 0114): the same button a third time.
  // Two things say Microsoft rather than Google or Dropbox — the words
  // "app registration" and "Microsoft Entra ID", which are the provider's
  // own, and the TENANT, which neither of the other two has.
  'account.microsoft.connect': 'Connect with Microsoft',
  'account.microsoft.connect.hint':
    'Opens Microsoft’s sign-in page, where you give Ownpace access to this account.',
  'account.microsoft.connect.why':
    'It asks you which account, so a migration cannot quietly read the wrong mailbox.',
  'account.microsoft.connect.needsClient':
    'Enter the Application (client) ID and client secret first.',
  'account.microsoft.connect.halfClient':
    'Enter both the Application (client) ID and the client secret, or neither.',
  'account.microsoft.deploymentClient':
    'Ownpace has its own Microsoft app; fill in both only to use your own app registration instead.',
  'account.microsoft.ownClient': 'Use your own app registration',
  'account.microsoft.redirectUri':
    'Register this exact address in your app registration under Authentication → Redirect URIs:',
  // Beside Connect with Microsoft, before anything is pressed (workplan 0140
  // T6 (b)): an organisation decides who in it may consent, and a tester met
  // that only after the button, as microsoftConsentRefusal's sentence. True
  // whether or not publisher verification (T5) is done. The second sentence is
  // Microsoft's documented default as understood in 0140 §4.3; T6's personal
  // account confirms or corrects it.
  'account.microsoft.orgApproval':
    'A work or school account may need its organisation’s administrator to approve Ownpace first. A personal Microsoft account does not.',
  // The tenant, which is the field Google and Dropbox have no equivalent of.
  // Empty is the RIGHT answer for almost everybody, and a hint that only said
  // "optional" would leave the one person it matters to guessing.
  'account.microsoft.tenantId.hint': 'Leave empty unless your app registration is single-tenant.',
  'account.microsoft.tenantId.why':
    'Empty means Ownpace’s own setting, which accepts any work, school or personal Microsoft account. A single-tenant registration sent to the wrong directory fails with a message about the application not being found, which reads like a typo and is not one.',
  // Apple's ONE credential field, and the hint carries the whole setup
  // (workplan 0115). Somebody who types their Apple Account password gets a
  // rejection saying the password is wrong — which it is not; it is the right
  // password of a kind Apple refuses on these protocols by design, because the
  // account has two-factor authentication and every Apple Account does. So the
  // hint names the page rather than describing the rule.
  'account.proto.apple.hint':
    'One Apple Account: mail, calendars, contacts and reminders, whichever you tick.',
  'account.appleAppPassword': 'App-specific password',
  'account.appleAppPassword.hint':
    'Not your Apple Account password: an app-specific password you generate at account.apple.com.',
  'account.appleAppPassword.why':
    'Apple refuses the account password here by design. Make one at account.apple.com → Sign-In and Security → App-Specific Passwords and paste it. It reaches your mail, calendars, contacts and reminders, and you can revoke it there whenever you like.',
  // THE EXPORT ARCHIVE (workplan 0116 T1; a migration source since T5/T6).
  // One card for two exports, and the hint has to carry the two things the
  // card name cannot: this is a SNAPSHOT with a date on it, not a live
  // account — and because it is, a later export only ever ADDS: nothing is
  // removed from the target because an export no longer mentions it (§5).
  //
  // APPLE IS TAGGED WHILE NO READER OPENS IT (0148 T3, owner decision D7), in
  // the hint as in the form's option. The hint is a sentence, so it is the one
  // place a landed reader is answered by hand; `an-export-we-cannot-read-yet`
  // fails until it is. "download" rather than "export you downloaded" keeps
  // it inside the twelve words a hint may spend.
  'account.proto.archive.hint':
    'A Google Takeout or Apple (to be tested) download: photos and files.',
  'account.archiveProvider': 'Which export',
  'account.archiveProvider.hint': 'Which company made the archive; the wrong choice finds nothing.',
  'account.archiveProvider.why':
    'It decides how we read the export; the files themselves do not say. Google exports are requested at takeout.google.com, Apple exports at privacy.apple.com.',
  // An export no reader opens yet (0148 T3, D7): the tag inside the option's
  // name, and the line under the field while it is chosen, keyed per export
  // because it names the company. Both leave the form when a reader lands.
  'account.archiveProvider.untested': 'To be tested',
  'account.archiveProvider.noReader.apple-privacy':
    'We cannot read an Apple export yet. Request one only for your own records.',
  'account.archivePath': 'Where the archive is',
  'account.archivePath.hint': 'The folder you extracted the download into, or the .zip itself.',
  'account.archivePath.why':
    'If the export arrived in several parts, keep them in one folder and name any one of them: we read them all, and we say so if one is missing. Or extract them all into the same folder first. Nothing is written there: we only read.',
  // WHERE THE EXPORT IS KEPT (workplan 0148 T9, D11): in a folder of the
  // destination's own files, or on the appliance's disk. On managed the disk
  // is shown, disabled, with the line under it (the owner: "'Only on a
  // self-hosted appliance': ok").
  'account.archiveWhere': 'Where the export is',
  'account.archiveWhere.target': "In a folder on your destination (Nextcloud or WebDAV)",
  'account.archiveWhere.disk': "On this appliance's disk",
  'account.archiveWhere.disk.onlyAppliance': 'Only on a self-hosted appliance',
  'account.archivePath.target': "Folder in your destination for files",
  'account.archivePath.target.hint': 'The folder as your files show it, from the top.',
  'account.archivePath.target.why':
    'For example Exports/takeout-20260904, or one .zip in that folder: we read the other parts beside it too. Upload the .zip parts of the export into one folder of the files this migration writes to, and name that folder here. The parts stay there after the migration and take up space; delete them once you have checked the result.',
  // The ACCOUNT card. Four faces, and the sentence says why that is more than
  // Google offers rather than leaving it looking like an oversight there.
  'account.proto.microsoft.hint':
    'One Microsoft 365 account, one sign-in: mail, calendars, tasks, contacts and files.',
  // The two Microsoft 365 connection methods (0107 T1): the family heading
  // says WHO, the card says HOW — "OAuth2" as a card name said neither.
  'account.group.provider': 'Your provider',
  'account.group.protocol': 'Any server, by protocol',
  'account.m365.viaImap': 'Via IMAP',
  'account.m365.viaGraph': 'Via the Graph API',
  'account.proto.oauth2.hint': 'IMAP with XOAUTH2, Graph fallback behind it (app registration)',
  'account.proto.graph.hint': 'Graph API only (app registration)',
  // The ACCOUNT card (workplan 0106 T3b). It names the faces it serves (three
  // since Tasks joined, 0126 T2), because "why is Gmail a separate card" is
  // the first question this card raises.
  'account.proto.google.hint': 'One Google account, one sign-in: calendars, contacts and tasks.',
  'account.proto.googleDrive.hint': 'Files from a Google Drive (read-only OAuth)',
  'account.proto.dropbox.hint': 'Files from a Dropbox (read-only OAuth app)',
  'account.proto.box.hint': 'Files from a Box account (read-only platform app)',
  'account.boxUserId': 'Box user ID (numeric)',
  'account.boxUserId.placeholder': 'e.g. 1234567890',
  'account.boxRootFolderId': 'Root folder ID',
  'account.boxRootFolderId.placeholder': 'Empty = All Files',
  'account.dropboxAppKey': 'App key',
  'account.dropboxRootPath': 'Root folder path',
  'account.dropboxRootPath.placeholder': 'e.g. /Team Docs',
  'account.proto.gmail.hint': 'Email from a Gmail mailbox (OAuth over IMAP)',
  'account.proto.googleCalendar.hint': 'Calendars from a Google account (OAuth over CalDAV)',
  'account.proto.googleContacts.hint': 'Contacts from a Google account (OAuth over CardDAV)',
  'account.gmailAppPassword': 'App password',
  'account.gmailAppPassword.hint': 'Personal Google accounts only; leave empty to use OAuth.',
  'account.gmailAppPassword.why':
    'Google recommends against it, and so do we: an app password opens the whole mailbox read and write, while a consented token opens only parts. It needs 2-step verification on the account, does not exist on a Workspace account, and is withdrawn in the account’s own app-password list without touching Ownpace, which is the one real advantage it has.',
  'account.refreshToken': 'Refresh token',
  'account.refreshToken.hint': 'What lets Ownpace into the account; treat it as a password.',
  'account.rootFolderId': 'Root folder ID',
  'account.rootFolderId.placeholder': 'Empty = all of My Drive',
  'account.serviceAccountKey': 'Service account key',
  'account.serviceAccountKey.placeholder': 'Paste the whole JSON key file',
  'account.serviceAccountKey.width':
    'This key can read every user in the domain; revoke it at cutover.',
  'account.serviceAccountKey.why':
    "Domain-wide delegation can read much of any Workspace user's data, though each migration still names one account. Authorise only the scopes you need in the Admin console, and revoke the delegation at cutover.",
  'account.nativePolicy': 'Google Docs, Sheets, Slides and Drawings',
  'account.nativePolicy.hint': 'They have no file format to copy, only a rendering Google makes.',
  'account.nativePolicy.hint.why':
    'A Google Doc lives in Google, not in a file: there is nothing to migrate. Drive can (automatically) render one as a document or a PDF, and we can migrate that rendering for you. The alternative (and default) is leaving them behind.',
  // ONE SELECT PER KIND (0042 T9; the owner, 2026-09-23: "a per kind choice
  // makes more sense for the fileformats. Split that up."). Each select offers
  // the formats that carry that kind, so nothing on the list leaves its kind
  // behind while looking as though it would copy it. Every format carries every
  // kind since the refusals of measured-unstable exports went (ADR-0046,
  // amended 2026-09-23).
  'account.nativePolicy.leave': 'Leave behind, and report each one',
  'account.nativePolicy.as.odf': 'OpenDocument ({ext})',
  'account.nativePolicy.as.office': 'Microsoft Office ({ext})',
  'account.nativePolicy.as.pdf': 'PDF ({ext}), not editable',
  'account.nativePolicy.as.image': 'Image ({ext})',
  // The format in force for a kind it does not carry, shown as what it does.
  'account.nativePolicy.as.leftBehind': '{format}: left behind',
  'account.nativePolicy.editable': 'Use an editable format for every kind',
  // WHAT THE CHOICE LEAVES BEHIND, AND WHAT CANNOT BE EDITED, on the screen
  // where it is made. Read off the same tables the selects are built from.
  'account.nativePolicy.leftBehind': '{kinds} stay behind in Google, each reported by name.',
  'account.nativePolicy.leftBehind.why':
    'Not copied, not lost: each one appears on the Failures screen, and you accept or retry them one at a time or all at once. Forms, My Maps, Sites and Apps Scripts always stay behind: Google cannot export those in a file format...',
  'account.nativePolicy.notEditable': '{kinds} arrive as PDF.',
  'account.nativePolicy.notEditable.why':
    'A PDF is a copy of how the document can look; formatting can shift. Choose it for a kind you want copied but do not need to edit anymore.',
  'account.nativePolicy.allEditable': 'All four kinds arrive as files you can edit.',
  'account.nativePolicy.allEditable.why':
    'Each arrives as a rendering Google makes, not the original: fine formatting can shift, and drawings arrive as .svg images because Drive offers no editable drawing export file format. You can change a format later; files already copied keep the format they arrived in.',
  // THE SAME QUESTION FOR DROPBOX PAPER DOCS (workplan 0150 T3 (d)). One
  // select, since Paper is the one kind a Dropbox migration chooses a format
  // for (D7). The wizard suggests Markdown (D1): Nextcloud's Text app opens it.
  'account.paperFormat': 'Dropbox Paper docs',
  'account.paperFormat.hint': 'They have no file to copy, only an export Dropbox makes.',
  'account.paperFormat.hint.why':
    'A Paper doc lives in Dropbox without a file format: there is nothing to download. Dropbox can export one as Markdown or HTML, and that export is what we can migrate for you, like under the doc’s own name with the format’s suffix added: Notes.paper arrives as Notes.paper.md. Paper templates follow the same choice. The alternative is leaving them behind.',
  'account.paperFormat.leave': 'Leave behind, and report each one',
  'account.paperFormat.as.markdown': 'Markdown (.md), for example opens in Nextcloud Text',
  'account.paperFormat.as.html': 'HTML (.html), opens in a web browser',
  'account.paperFormat.leftBehind': 'Paper docs stay behind in Dropbox, each reported by name.',
  'account.paperFormat.leftBehind.why':
    'Not copied, not lost: each one appears on the Failures screen, and you can choose a format for them later, or leave them behind.',
  'account.paperFormat.arrives': 'Each Paper doc arrives as a file you can edit.',
  'account.paperFormat.arrives.why':
    'An export is a rendering Dropbox makes, not the Paper doc itself: fine formatting can shift, and nothing you change on the new system goes back to Dropbox. You can change the format later; docs already copied keep the format they arrived in.',
  'account.proto.jmap.hint': 'Modern email protocol',
  'account.proto.caldav.hint': 'Calendar protocol',
  'account.proto.carddav.hint': 'Contact protocol',
  'account.proto.webdav.hint': 'File storage',
  'account.proto.soverin.hint': 'One account — email, calendars and contacts',
  // Says what it carries AND what it does not: a person whose mail is
  // elsewhere should not have to discover that by ticking Email and
  // finding no writer behind it.
  'account.proto.nextcloud.hint': 'One account — calendars, contacts, files and tasks (no email)',
  'account.host': 'Host',
  'account.port': 'Port',
  // The DAV escape hatch (0105 T1) — see credential-fields.ts. It is the
  // ADDRESS rather than an escape hatch on the Nextcloud door, which is why
  // the label no longer calls itself optional: the descriptor says whether
  // it is demanded, and the asterisk repeats that answer.
  'account.targetDavUrl': 'DAV base URL',
  'account.targetDavUrl.hint': 'Only when the server’s DAV root is not at the host root.',
  // The SAME field on the Nextcloud door, where it is not an escape hatch:
  // the hint above talks about a host root, and that door has no host at all.
  'account.nextcloudDavUrl.hint':
    'The address you open Nextcloud at, with /remote.php/dav on the end.',
  'account.nextcloudDavUrl.why':
    'Nextcloud serves calendars, contacts, tasks and files under /remote.php/dav rather than at the root of the site, so a host and a port cannot say where it is. Paste the address from your browser’s bar — https://cloud.example.com — and add /remote.php/dav.',
  'account.soverinMailHost': 'Mail server',
  'account.soverinMailHost.hint': 'Only needed if this account will also receive mail.',
  'account.soverinMailHost.why':
    'Calendars, tasks and contacts need no mail server. Test measures what the host you enter actually supports.',
  'account.soverinMailPort': 'Mail port',
  // The provider directory (0106 T5): whose published settings sit in the
  // boxes, read when. They are measured by Test, never assumed.
  'account.providerDefaults.note':
    'Pre-filled from {provider}’s published settings, read {seen}. Test checks them.',
  // NO SIDE IN THE LABEL (2026-09-07). These read "Source Username" and
  // "Target Password" because the wizard was once one screen with both sides
  // on it. It has had a step per side for some time, each under its own
  // heading — and the Connections add-form has no sides at all, so a Google
  // account added there was asking for a "Source Username" that is simply
  // the address. The two keys stay separate because each side's gate and
  // form map are keyed by them; only the words lost the prefix.
  'account.sourceUsername': 'Username',
  'account.sourcePassword': 'Password',
  'account.targetUsername': 'Username',
  'account.targetPassword': 'Password',
  // The automatic cadence (workplan 0157 T7; the owner, 2026-10-05: "sync
  // slow down once a migration is in step: yes"): no schedule of its own,
  // what Start a migration makes, first in the chooser.
  'account.schedule.automatic': 'Automatic',
  'account.schedule.automatic.hint': 'Hourly for 14 days, then every 6 hours, daily from day 30.',
  'account.schedule.hourly': 'Hourly',
  'account.schedule.hourly.hint': 'Every hour',
  'account.schedule.daily': 'Daily',
  'account.schedule.daily.hint': 'Every day',
  'account.schedule.sixHourly': 'Every 6 hours',
  'account.schedule.sixHourly.hint': 'Four times a day',
  'account.schedule.quarterHourly': 'Every 15 minutes',
  'account.schedule.quarterHourly.hint': 'Frequent sync',
  'account.back': 'Back',
  'account.next': 'Next',
  // Field-level honesty (0037 T3): the line beside a disabled Next names what
  // is missing instead of leaving a silently dead button.
  'account.missing.lead': 'To continue, fill in:',
  // 0037 T6, answered 2026-08-10: oauth2/graph collect the per-customer
  // Entra app registration (ADR-0006's row-14 model).
  'account.tenantId': 'Tenant ID',
  'account.clientId': 'Client ID (application ID)',
  'account.sourceClientSecret': 'Client secret',
  'docs.title': 'Setup guides',
  'docs.all': '← All setup guides',
  // The UX sweep (2026-10-17): the list of a guide's sections under its title,
  // in the guide's own language, as the own-app fold is.
  'docs.onThisPage': 'On this page',
  'docs.notFound': 'There is no guide at this address. These are all the guides:',
  // Workplan 0148 T4: a guide not yet written in the reader's language is
  // shown in the other one, under this line, in the reader's own.
  'docs.otherLanguage': 'This guide is not yet available in English; the Dutch version follows.',
  // Workplan 0148 D9: the appliance's index only. Its owner runs it, and the
  // operator material the guides stopped carrying is in the repository. The
  // plan's wording, one word shorter to fit 0118's fifteen-word line.
  'docs.operatorDocs':
    'Running your own appliance? Settings and commands are in the operator documents in the Ownpace repository.',
  // Workplan 0148 T2 (c): the fold over a guide's own-app section, closed
  // where this service carries the provider's app.
  'docs.ownAppFold': 'Only if you want to use your own app',
  'connections.delete': 'Delete',
  'connections.rotate': 'Replace credentials',
  // The same panel, named for what it does on a row whose kind has a consent
  // button (Google, Dropbox, Microsoft): mint a new token (workplan 0140 T2 (b)).
  // failure.authExpired names this word.
  'connections.reconnect': 'Reconnect',
  'connections.rotate.hint':
    'Paste the new values; they are checked before replacing the old.',
  'connections.rotate.why':
    'If the check fails, nothing changes and your migrations keep whatever was working.',
  'connections.rotate.save': 'Check and replace',
  'connections.add': 'Add an account',
  'connections.addAndTest': 'Add and test',
  'connections.added': 'Added',
  'connections.role': 'Source or target?',
  'connections.type': 'Provider',
  'connections.name': 'Name for this account',
  'connections.title': 'Accounts',
  'connections.intro': 'The accounts your migrations sign in with. Test checks them read-only.',
  'connections.none': 'No accounts yet. Starting your first migration adds them.',
  'connections.sources': 'Sources',
  'connections.targets': 'Targets',
  'connections.test': 'Test',
  'connections.testing': 'Testing…',
  // A connection serves migrations, not mailboxes (owner remark 2026-09-02:
  // Dropbox is files, a Google account is four faces) — and none yet is a
  // sentence, not a zero.
  'connections.usedBy.one': 'Used by 1 migration',
  'connections.usedBy.other': 'Used by {count} migrations',
  'connections.usedBy.none': 'Not used by any migration yet',
  'connections.addedWhen': 'Added {when}',
  'connections.setupSteps': 'Setup steps',
  // What is STANDING against a connection (workplan 0094 T5): a pass that
  // failed since the last Test. "Migration <name> stopped 2 hours ago
  // (Email, Calendar):" and then the category's own remedy sentence.
  'connections.standing.migration': 'Migration',
  'connections.standing.stopped': 'stopped {when} ({domains}):',
  // Only where the connection is the thing to act on; the category does not
  // say which of a migration's two connections failed.
  'connections.standing.whichSide':
    'Signs in with this and one other connection; Test this one to find out which.',
  // And when the pass could tell (second slice): no guessing left to do.
  'connections.standing.thisSide': 'Failed on this account.',
  // What a probe FOUND, rendered from its outcome code (workplan 0080).
  // Ours, so translated; the provider's own refusal is never in here — it
  // renders verbatim, because that string is what you paste into their
  // console.
  // JUST THE FACT THAT IT CONNECTED (2026-09-07). This carried one face's
  // count — whichever the probe reached first — while the Found line below
  // already listed every face properly. The owner: *"why next to 'connected'
  // only part of what we know? leave that, since we mention what is
  // measured."* The count moved to where the other counts are; a listing
  // that stopped at its cap says so THERE, as `probe.measured.atLeast`.
  'probe.connected': 'Connected.',
  'probe.connectedSession': 'Connected.',
  'probe.targetStatus': 'The server at {url} answered {status}.',
  'probe.targetStatus.refused': 'It is reachable and refused the credentials.',
  'probe.targetStatus.check': 'Check the target host and port.',
  'probe.noProbe': 'A {kind} connection cannot be tested yet.',
  // The deadline (2026-09-02): unknown, not refused, and the connection is
  // kept so it can be tested again.
  'probe.timedOut': 'No answer within {seconds} seconds; kept anyway, so test later.',
  // The export is in the migration's own file target (0116 T4, the relay), and
  // a connection is tested before any migration names one. Unknown, never a
  // measured no — the owner's answer of 2026-09-20.
  'probe.countedAtPreflight':
    'This export is in your new files, so there is nothing to test here yet. It is counted when you review the migration.',
  // WHAT HAPPENED AT AN ADDRESS THE TESTER TYPED (0136 T3), said from its
  // parts: a status, and a server's own words only when it sent an error
  // document we know. `{words}` is the server's and stays as it came, in both
  // languages (rule 9, docs/i18n-prose-boundary.md); the rest is ours. Every
  // sentence ends with the reference the full text is logged under.
  'probe.said.server': 'The server',
  'probe.said.mailServer': 'The mail server',
  'probe.said.answeredWords': '{who} answered {status}: {words}',
  'probe.said.answeredWordsNoStatus': '{who} answered: {words}',
  'probe.said.answeredOther':
    '{who} answered {status} with something that is not a DAV, JMAP or IMAP error.',
  'probe.said.answeredOtherNoStatus':
    '{who} answered with something that is not a DAV, JMAP or IMAP error.',
  'probe.said.unreachable':
    'Nothing answered at that address: name did not resolve, connection was refused, or a timeout. Check the host name and the port.',
  'probe.said.certificate':
    'The server\'s certificate did not verify for that name, or has expired, so the test stopped before signing in.',
  'probe.said.insideOurNetwork':
    'That address is inside this service\'s own network, or the server sent the test on to one that is, so we did not connect to it. Give the address the server has on the internet.',
  'probe.said.unknown':
    'The test failed, and what came back is not shown here. Check the address and the port.',
  'probe.said.reference': 'Reference {reference}.',
  // A face the test could not measure, said the same way (0136 T3).
  'probe.said.unmeasured': 'Unmeasured — {sentence}',
  // The limit on tests (0136 T3): sixty an hour per member, across the doors
  // that connect to an address somebody typed.
  'probe.tooManyTests':
    'You have tested too many connections in the last hour. Wait a little, then test again.',
  'probe.measuring': 'Still measuring what this account can carry — refresh in a minute.',
  // A listing that stopped at its cap saw AT LEAST this many. It used to say
  // so in the headline; the headline no longer carries a count, so it says so
  // here — beside the number it qualifies, which is the better place anyway.
  'probe.measured.atLeast': 'at least {count} {unit}',
  'probe.unit.folder.one': 'folder',
  'probe.unit.folder.many': 'folders',
  'probe.unit.calendar.one': 'calendar',
  'probe.unit.calendar.many': 'calendars',
  'probe.unit.addressBook.one': 'address book',
  'probe.unit.addressBook.many': 'address books',
  'probe.unit.taskList.one': 'task list',
  'probe.unit.taskList.many': 'task lists',
  'probe.unit.collection.one': 'collection',
  'probe.unit.collection.many': 'collections',
  // The account's per-domain qualification line (0106 T0). Three marks,
  // deliberately three: '?' is unmeasured, never a quiet yes or no.
  'probe.qualify.lead': 'Carries:',
  // The measured-volume line (2026-09-02): how much each reached face holds.
  'probe.measured.lead': 'Found:',
  // A face that answered with nothing. "Tasks ✓ 0 task lists" read as a
  // contradiction and was not one — zero collections is a real answer and the
  // protocol works. This keeps the fact and drops the argument.
  'probe.found.none': 'none',
  'probe.measured.message.one': '{count} message',
  'probe.measured.message.many': '{count} messages',
  'probe.measured.card.one': '{count} card',
  'probe.measured.card.many': '{count} cards',
  'probe.measured.item.one': '{count} item',
  'probe.measured.item.many': '{count} items',
  'probe.measured.driveNote': 'Docs, Sheets and Slides not counted',
  'probe.measured.failed': 'not measured',
  // Items the listing found and could NOT read (2026-09-07). Shown beside the
  // count rather than instead of it: "0 cards" and "0 cards, 25 could not be
  // read" are different facts, and the second is the one worth acting on.
  'probe.measured.unreadable.one': '{count} could not be read',
  'probe.measured.unreadable.many': '{count} could not be read',
  'connections.ok': 'Reached it. The credentials still work.',
  'connections.failed': 'Could not reach it.',
  // The delete refusal's FRAME (workplan 0071). The migrations it names are
  // the server's finding and render verbatim; these words are ours, so they
  // are translated — the owner met the old five-clause English paragraph in a
  // Dutch UI and asked for both halves of that to change. It still answers
  // why, what to do first, and where, in two lines instead of five.
  'connections.inUse.lead': 'Still used by',
  // `mailbox_mapping.name` is nullable, so a migration can genuinely have no
  // name to quote. Saying so beats dropping back to the server's English.
  'connections.inUse.unnamed': 'a migration with no name',
  'connections.inUse.reason':
    'Deleting it would delete what those migrations recorded; remove them under Migrations first.',
  // A delete that went through (2026-09-20). The frame is ours; the provider's
  // reason, when there is one, follows it verbatim. `failed` must not be
  // softened: the reader has to go and withdraw the access themselves.
  'connections.removed.done': 'deleted.',
  'connections.removed.revoked': 'Its access at the provider has been revoked.',
  'connections.removed.failed':
    'Our copy is deleted, but the provider still has its access: withdraw it yourself.',
  'connections.removed.unsupported': 'We deleted our copy; this provider has no revocation we can trigger.',
  'connections.removed.none': 'No credential was stored for it.',
  // Filled in, but not usable — distinct from "still needed" (0072).
  'connections.invalidValues.lead': 'These values cannot be used as they are:',
  // ---- Provider setup checklist (workplan 0061) ----
  'setup.title': 'Provider setup',
  'setup.intro':
    'Steps to take in the provider’s console; ticks are saved for your whole organisation.',
  // A destination's checklist (the UX sweep, 2026-10-17): the Dutch above is
  // the owner's and says *uw oude aanbieder*, which a Nextcloud or a Soverin
  // being moved to is not.
  'setup.target.intro': 'Steps to take at your new provider; ticks are saved for your whole organisation.',
  'setup.backToConnections': '← Back to accounts',
  'setup.fullGuide': 'Read the full setup guide',
  // Beside a refusal that carries a guide handle (0148 T7): the frame is ours,
  // in the reader's language; the title is the guide's own, in that language.
  'setup.refusalGuide': 'Guide: {title}',
  'setup.settled': 'settled',
  'setup.stillOpen': 'still to do',
  'setup.waitingOnOthers': 'waiting on an administrator',
  'setup.allDone': 'Everything is settled, you can connect the account now.',
  'setup.nothingToDo': 'Nothing to set up in advance, you can connect the account straight away.',
  // Every step was about one's own app, and this service has its own (0148 T2 (b)).
  'setup.deploymentApp':
    'Nothing to create: this service has its own {provider} app. Press Connect with {provider}.',
  // ---- Choosing a provider, and narrowing by who you are (workplan 0068) ----
  'setup.choose.title': 'What are you setting up?',
  'setup.choose.intro':
    'Each system has its own short list to arrange before a migration can start.',
  'setup.choose.sources': 'Migrating from',
  'setup.choose.targets': 'Migrating to',
  'setup.admin.question': 'Do you manage this system for your organisation?',
  'setup.admin.yes': 'Yes, I am an administrator',
  'setup.admin.no': 'No, someone else is',
  'setup.admin.unsure': 'Show me everything',
  'setup.admin.hint': 'Only changes how the list is arranged; remembered on this device.',
  'setup.yours': 'What you can do yourself',
  'setup.forYourAdmin': 'What your administrator has to do',
  'setup.forYourAdmin.hint':
    'Send these to your admin, tick them once confirmed.',
  'setup.yields': 'You get:',
  'setup.tick': 'Mark this step done',
  'setup.untick': 'Mark this step to do',
  'setup.skip': 'Skip',
  'setup.unskip': 'Un-skip',
  'setup.state.done': 'Done',
  'setup.state.skipped': 'Skipped — deliberately not needed',
  'setup.needsAnotherPerson': 'needs an administrator',
  'setup.needsAnotherPerson.hint':
    'Needs admin rights.',
  'setup.box.create_app.title': 'Create a Box platform app',
  'setup.box.create_app.detail':
    'Box Developer Console → Create Platform App → Custom App, and choose Client Credentials Grant (Server Authentication).',
  'setup.box.create_app.yields': 'a Client ID and a Client Secret.',
  'setup.box.configure_access.title': 'Give it read-only access',
  'setup.box.configure_access.detail':
    'On the app\u2019s Configuration tab set App Access Level to "App + Enterprise Access", tick only the read scope for files and folders, and enable "Generate user access tokens".',
  'setup.box.admin_authorize.title': 'Have a Box admin authorise the app',
  'setup.box.admin_authorize.detail':
    'Admin Console → Apps → Custom Apps Manager → Add app by Client ID, then authorise it. Until this is done Box refuses every token with "unauthorized_client".',
  'setup.box.subject_user_id.title': 'Find the numeric user id being migrated',
  'setup.box.subject_user_id.detail':
    'Admin Console → Users & Groups → the account you are migrating. Box wants the number, not the email address.',
  'setup.box.subject_user_id.yields': 'the Box user id (a number).',
  'setup.dropbox.create_app.title': 'Create a Dropbox app',
  'setup.dropbox.create_app.detail':
    'Dropbox App Console → Create app → Scoped access → Full Dropbox (or App folder if the migration should only ever see one folder).',
  'setup.dropbox.create_app.yields': 'an App key and an App secret.',
  'setup.dropbox.scopes.title': 'Give it read-only permissions',
  'setup.dropbox.scopes.detail':
    'On the Permissions tab enable files.metadata.read and files.content.read, and nothing that writes. Add sharing.read as well if you want to browse shared folders here.',
  // Connect with Dropbox consents and exchanges the code (2026-09-02) where the
  // deployment serves it; the appliance does not, so both manual steps stay and
  // each line is true with or without the button (0148 T2 (b)).
  'setup.dropbox.redirect_uri.title': 'Using the button? Register its redirect address',
  'setup.dropbox.redirect_uri.detail':
    'Only for Connect with Dropbox with your own app: under the button the form shows a redirect address. Add that exact address in the Dropbox App Console under OAuth 2 → Redirect URIs, then press the button again. Without the button, skip this step.',
  'setup.dropbox.consent.title': 'Have the account owner consent once',
  'setup.dropbox.consent.detail':
    'Connect with Dropbox does this step and the next when the account owner presses it. Without the button, send the person whose Dropbox is being migrated through the authorisation URL for this app, with token_access_type=offline so Dropbox returns a refresh token.',
  'setup.dropbox.exchange_code.title': 'Exchange the code for a refresh token',
  'setup.dropbox.exchange_code.detail':
    'Swap the code from the previous step at Dropbox\u2019s token endpoint, once. Access tokens are minted from the result per run; nothing else long-lived is stored.',
  'setup.dropbox.exchange_code.yields': 'a refresh token.',
  'setup.google.create_oauth_client.title': 'Create a Google OAuth client',
  'setup.google.create_oauth_client.detail':
    'Google Cloud console → APIs & Services → Credentials → Create credentials → OAuth client ID, as a Web application.',
  'setup.google.create_oauth_client.yields': 'a Client ID and a Client Secret.',
  'setup.google.enable_api.title': 'Enable the product’s API',
  'setup.google.enable_api.detail':
    'In the same project, enable the API that matches the source you picked — Google Drive API, Gmail API, CalDAV API, Google Contacts CardDAV API or Google Tasks API. A client without it fails on the first call.',
  'setup.google.consent_scope.title': 'Consent a refresh token for that product',
  'setup.google.consent_scope.detail':
    'Have the account owner consent with the scope for that product; a token consented for one Google product does not work for another. Or use a service account with domain-wide delegation, which an admin authorises once for the whole domain.',
  'setup.google.consent_scope.yields': 'a refresh token (or a service-account key file).',
  'setup.graph.app_registration.title': 'Register an app in Microsoft Entra',
  // Shared by Via the Graph API and Via IMAP: the Microsoft guide's {#application}.
  'setup.graph.app_registration.detail':
    'Entra admin centre → Identity → Applications → App registrations → New registration, in the tenant whose mailboxes you are migrating. Choose Accounts in this organizational directory only and leave the redirect address empty. The Overview page then shows the Application (client) ID and the Directory (tenant) ID.',
  'setup.graph.app_registration.yields': 'a Tenant ID and a Client ID.',
  // Via the Graph API only (0148 T5 (a)): both cards read one mailbox's mail,
  // and this one reads it with one Microsoft Graph permission.
  'setup.graph.api_permissions.title': 'Add Mail.Read and get admin consent',
  'setup.graph.api_permissions.detail':
    'API permissions → Add a permission → Microsoft Graph → Application permissions → Mail.Read. Nothing else: this card reads one mailbox’s mail. Then an administrator presses Grant admin consent for your organisation. As an application permission, Mail.Read can read every mailbox in the organisation; this service reads only the one the connection names.',
  'setup.graph.client_secret.title': 'Create a client secret',
  'setup.graph.client_secret.detail':
    'Certificates & secrets → New client secret. Copy it immediately — Entra shows the value once.',
  'setup.graph.client_secret.yields': 'a Client Secret.',
  // Via IMAP (0148 T5 (a)): its token carries only what Office 365 Exchange
  // Online gives, so its recipe is the Microsoft guide's {#application-imap}.
  'setup.exchange.permission.title': 'Add IMAP.AccessAsApp and get admin consent',
  'setup.exchange.permission.detail':
    'API permissions → Add a permission → APIs my organization uses → Office 365 Exchange Online → Application permissions → IMAP.AccessAsApp. Not a Microsoft Graph permission: this card signs in to Exchange Online’s IMAP server, and such a token carries only what Exchange Online gives. Then an administrator presses Grant admin consent for your organisation.',
  'setup.exchange.service_principal.title': 'Register the application in Exchange Online',
  'setup.exchange.service_principal.detail':
    'An Exchange administrator runs New-ServicePrincipal in Exchange Online PowerShell, with the Application (client) ID and the Object ID shown under Enterprise applications. Not the Object ID under App registrations: with that one, the card’s sign-in fails. The guide has the commands.',
  'setup.exchange.mailbox_permission.title': 'Give the application the mailbox',
  'setup.exchange.mailbox_permission.detail':
    'The Exchange administrator runs Add-MailboxPermission with -AccessRights FullAccess, once for each mailbox the card reads. FullAccess would let an application change the mailbox as well as read it. This service only reads it, and for this card Microsoft does not enforce that.',
  'setup.imap.server_address.title': 'Find the IMAP server address',
  'setup.imap.server_address.detail':
    'The host and port your mail provider documents for IMAP, and whether it uses SSL. Usually port 993 with SSL.',
  'setup.imap.server_address.yields': 'a host, a port and the SSL setting.',
  'setup.imap.app_password.title': 'Create an app password',
  'setup.imap.app_password.detail':
    'Most providers refuse a normal account password for IMAP when two-factor authentication is on, and want an app-specific password instead. Create one for the account being migrated.',
  'setup.imap.app_password.yields': 'a username and an app password.',
  'setup.webdav.account_exists.title': 'Make sure the destination account exists',
  'setup.webdav.account_exists.detail':
    'Create the account on the target server first, with enough quota for what is coming. Nothing here creates accounts.',
  'setup.webdav.app_password.title': 'Create an app password for it',
  'setup.webdav.app_password.detail':
    'In Nextcloud: Settings → Security → Devices & sessions → Create new app password. Use that rather than the account\u2019s own password.',
  'setup.webdav.app_password.yields': 'a username and an app password.',
  'setup.webdav.base_url.title': 'Note the WebDAV address',
  'setup.webdav.base_url.detail':
    'The server\u2019s WebDAV base URL for that account — Nextcloud shows it at the bottom of the Files settings page.',
  'setup.webdav.base_url.yields': 'the host, port and path to put in the form.',
  'setup.jmap.account_exists.title': 'Make sure the destination account exists',
  'setup.jmap.account_exists.detail':
    'Create the mailbox on the JMAP server first, with enough quota. Nothing here creates accounts.',
  'setup.jmap.api_token.title': 'Create an app password for it',
  'setup.jmap.api_token.detail':
    'Create an app password for that account in the server\u2019s own settings, where it offers one; this product signs in with the username and that password.',
  'setup.jmap.api_token.yields': 'a username and an app password.',
  'setup.davbasic.account_exists.title': 'Make sure the destination account exists',
  'setup.davbasic.account_exists.detail':
    'Create the account on the target server first, with enough quota for what is coming. Nothing here creates accounts.',
  'setup.davbasic.app_password.title': 'Create an app password for it',
  'setup.davbasic.app_password.detail':
    'Use an app-specific password rather than the account\u2019s own login where the server offers one — it can be revoked without changing the person\u2019s password.',
  'setup.davbasic.app_password.yields': 'a username and an app password.',
  // ---- What comes first for Apple, Nextcloud and Soverin (0148 T5 (a)) ----
  // Each in its card guide's words: apple.md {#app-password}, nextcloud.md
  // {#app-password} and {#nextcloud}, soverin.md {#soverin}.
  'setup.apple.app_password.title': 'Make an app-specific password',
  'setup.apple.app_password.detail':
    'Sign in at account.apple.com → Sign-In and Security → App-Specific Passwords, and generate one. Apple shows it once, so copy it at once. Do not use your Apple Account password.',
  'setup.apple.app_password.yields': 'an app-specific password, such as abcd-efgh-ijkl-mnop.',
  'setup.nextcloud.account_exists.title': 'Make sure the Nextcloud account exists',
  'setup.nextcloud.account_exists.detail':
    'The account must exist on the Nextcloud already, with enough storage for what is coming. This service creates no accounts.',
  'setup.nextcloud.app_password.title': 'Create an app password',
  'setup.nextcloud.app_password.detail':
    'In Nextcloud: Settings → Security → Devices & sessions. Type a name under App name, such as Migration, press Create new app password and copy the password. Use it rather than the account’s own password: it can be revoked without changing yours.',
  'setup.nextcloud.app_password.yields': 'an app password, for the form’s Password box.',
  // Both doors (the UX sweep, 2026-10-17): Start a migration asks for the
  // address and adds /remote.php/dav itself; the Accounts page's form asks
  // for the DAV base URL. The step key stays `dav_url`, so saved ticks hold.
  'setup.nextcloud.dav_url.title': "Note your Nextcloud's address",
  'setup.nextcloud.dav_url.detail':
    "The address you open Nextcloud at in your browser, such as https://cloud.example.com. On Start a migration it goes in Your Nextcloud's address, and /remote.php/dav is added for you. On the Accounts page, DAV base URL takes the address with /remote.php/dav on the end, such as https://cloud.example.com/remote.php/dav. Nextcloud shows its WebDAV address at the bottom of the Files settings page: the name after /remote.php/dav/files/ is the user name to type.",
  'setup.nextcloud.dav_url.yields': "your Nextcloud's address, and your user name.",
  'setup.soverin.account_exists.title': 'Make sure the Soverin account exists',
  'setup.soverin.account_exists.detail':
    'The Soverin account must exist already, with room for what is coming. This service creates no accounts.',
  'setup.soverin.password.title': 'Have the account’s password at hand',
  'setup.soverin.password.detail':
    'This service signs in with the Soverin email address and that account’s password. If Soverin offers you an app password, it can go in the same Password box instead. Whether one app password covers mail as well as calendars and contacts is not certain; the test says so per part.',
  'setup.soverin.password.yields': 'the email address, and the password or an app password.',
  'setup.soverin.mail_server.title': 'Mail moving too? Keep the mail server',
  'setup.soverin.mail_server.detail':
    'The form fills in Mail server, imap.soverin.net, and Mail port, 993, from Soverin’s published settings. If mail moves, leave Mail server filled in: an account saved without it carries no mail. Calendars and contacts need no mail server.',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'account.proto.imap.hint': 'Standaard e-mailprotocol',
  'account.google.connect': 'Verbinden met Google',
  'connections.googleFaces': 'Wat dit account gaat leveren',
  'account.google.connect.hint': 'Opent de aanmeldpagina van Google, waar u Ownpace toegang geeft.',
  'account.google.connect.needsDomains':
    'Vink eerst aan wat u wilt migreren; de toestemming vraagt alleen daarom.',
  'account.google.connect.needsClient': 'Vul eerst de Client-ID en het clientsecret in.',
  'account.consent.received': 'Toestemming ontvangen — de verbinding wordt opgeslagen en getest.',
  'account.consent.noProvider':
    'Ownpace heeft geen verbindknop voor dit type; plak in plaats daarvan een refreshtoken.',
  'account.consent.needsAccount': 'Vul eerst het accountadres in.',
  'account.consent.windowBlocked':
    'Uw browser heeft de pagina van {provider} niet geopend. Open die met deze link:',
  'account.consent.windowExpired': 'De link naar de pagina van {provider} is verlopen. Druk opnieuw op {button}.',
  'account.consent.legal': 'Wat we met uw gegevens doen, en onder welke voorwaarden:',
  'account.consent.pasteToken':
    'De knop vult hieronder het refreshtoken in; een token plakken dat u al heeft, blijft gewoon werken.',
  'account.google.deploymentClient':
    'Ownpace heeft een eigen Google-app; vul beide alleen in om uw eigen oauth-app te gebruiken.',
  'account.google.connect.halfClient':
    'Vul zowel de Client-ID als het clientsecret in, of geen van beide.',
  'account.google.ownClient': 'Uw eigen Google-client gebruiken',
  // Zie het Engelse blok.
  'account.google.redirectUri':
    'Registreer dit exacte adres in uw Google-client onder Geautoriseerde redirect/callbacks-URI’s:',
  'account.google.readsOnly':
    'Voor e-mail, agenda’s en contacten beschrijft Google een ruimere toestemming dan Ownpace gebruikt. Ownpace leest alleen; het wijzigt en verwijdert niets in dit account.',
  'account.google.inAppBrowser':
    'Is deze pagina geopend in een andere app, zoals een chat- of mailapp? Kies daar \'Openen in browser\' of kopieer de link naar uw favoriete browser, zoals Safari of Chrome, en meld u in die browser aan bij Ownpace.',
  'account.dropbox.connect': 'Verbinden met Dropbox',
  'account.dropbox.connect.hint': 'Opent de aanmeldpagina van Dropbox, waar u Ownpace toegang geeft.',
  'account.dropbox.connect.needsClient': 'Vul eerst de App key en het App secret in.',
  'account.dropbox.connect.halfClient':
    'Vul zowel de App key als het App secret in, of geen van beide.',
  'account.dropbox.deploymentClient':
    'Ownpace heeft een eigen Dropbox-app; vul beide alleen in om uw eigen oauth-app te gebruiken.',
  'account.dropbox.ownClient': 'Uw eigen Dropbox-app gebruiken',
  'account.dropbox.redirectUri':
    'Registreer dit exacte adres in uw Dropbox-app onder OAuth 2 → Redirect URIs:',
  'account.microsoft.connect': 'Verbinden met Microsoft',
  'account.microsoft.connect.hint':
    'Opent de aanmeldpagina van Microsoft, waar u Ownpace toegang geeft.',
  'account.microsoft.connect.why':
    'Het vraagt u welk account, zodat een migratie niet stilletjes de verkeerde postbus leest.',
  'account.microsoft.connect.needsClient':
    'Vul eerst de toepassings-id (client) en het clientsecret in.',
  'account.microsoft.connect.halfClient':
    'Vul zowel de toepassings-id (client) als het clientsecret in, of geen van beide.',
  'account.microsoft.deploymentClient':
    'Ownpace heeft een eigen Microsoft-app; vul beide alleen in om uw eigen appregistratie te gebruiken.',
  'account.microsoft.ownClient': 'Uw eigen appregistratie gebruiken',
  'account.microsoft.redirectUri':
    'Registreer dit exacte adres in uw appregistratie onder Verificatie → redirect/callback-URI’s:',
  'account.microsoft.orgApproval':
    'Voor een werk- of schoolaccount kan eerst goedkeuring nodig zijn van uw beheerder. Voor een persoonlijk Microsoft-account is dat niet nodig.',
  'account.microsoft.tenantId.hint': 'Laat leeg tenzij uw appregistratie voor één specifieke tenant is.',
  'account.microsoft.tenantId.why':
    'Leeg betekent de eigen instelling van Ownpace, die elk werk-, school- of persoonlijk Microsoft-account accepteert. Een registratie voor één specifieke tenant die naar de verkeerde wordt gestuurd, mislukt met een melding dat de toepassing niet is gevonden, wat op een typefout lijkt, maar het niet is.',
  'account.proto.apple.hint':
    'Eén Apple-account: e-mail, agenda’s, contacten en herinneringen, wat u aanvinkt.',
  'account.appleAppPassword': 'App-specifiek wachtwoord',
  'account.appleAppPassword.hint':
    'Niet uw Apple-accountwachtwoord: een app-specifiek wachtwoord van account.apple.com.',
  'account.appleAppPassword.why':
    'Apple weigert het accountwachtwoord hier met opzet. Maak een App-specifieke aan op account.apple.com → Aanmelden en beveiliging → App-specifieke wachtwoorden en plak het hier. Het bereikt uw e-mail, agenda’s, contacten en herinneringen, en u kunt het daar altijd weer intrekken.',
  'account.proto.archive.hint':
    'Een gedownloade Google Takeout- of Apple-export (nog te testen): foto’s en bestanden.',
  'account.archiveProvider': 'Welke export',
  'account.archiveProvider.hint':
    'Welk bedrijf het archief maakte; bij de verkeerde keuze vinden we niets.',
  'account.archiveProvider.why':
    'Dat bepaalt hoe wij de export lezen; aan de bestanden zelf is dit niet te zien. Google-exports vraagt u aan op takeout.google.com, Apple-exports op privacy.apple.com.',
  'account.archiveProvider.untested': 'Te testen',
  'account.archiveProvider.noReader.apple-privacy':
    'Een Apple-export kunnen we nog niet lezen. Vraag die alleen aan voor uw eigen archief.',
  'account.archivePath': 'Waar het archief staat',
  'account.archivePath.hint':
    'De map waarin u de download hebt uitgepakt, of het .zip-bestand zelf.',
  'account.archivePath.why':
    'Bestaat de export uit meerdere delen, zet die dan in één map en wijs er een willekeurig deel van aan: wij lezen ze allemaal, en zeggen het als er een ontbreekt. Of pak ze eerst allemaal uit in dezelfde map. Er wordt niets naar geschreven: wij lezen alleen.',
  'account.archiveWhere': 'Waar de export staat',
  'account.archiveWhere.target': 'In een map in uw bestemming (Nextcloud of WebDAV)',
  'account.archiveWhere.disk': 'Op de schijf van deze appliance',
  'account.archiveWhere.disk.onlyAppliance': 'Alleen op een eigen appliance',
  'account.archivePath.target': 'Map in de bestanden van uw bestemming',
  'account.archivePath.target.hint': 'De map zoals u die in uw bestanden ziet, vanaf de hoofdmap.',
  'account.archivePath.target.why':
    'Bijvoorbeeld Exports/takeout-20260904, of één .zip in die map: de andere delen ernaast lezen wij ook. Zet de .zip-bestanden in één map in waar deze migratie naartoe schrijft, en vul die map hier in. De delen blijven daar na de migratie staan en nemen ruimte in; verwijder ze zodra u het resultaat hebt gecontroleerd.',
  'account.proto.microsoft.hint':
    'Eén Microsoft 365-account, één aanmelding: e-mail, agenda’s, taken, contacten en bestanden.',
  'account.group.provider': 'Uw aanbieder',
  'account.group.protocol': 'Elke server, via protocol',
  'account.m365.viaImap': 'Via IMAP',
  'account.m365.viaGraph': 'Via de Graph-API',
  'account.proto.oauth2.hint': 'IMAP met XOAUTH2, met Graph-terugval erachter (appregistratie)',
  'account.proto.graph.hint': 'Alleen de Graph-API (appregistratie)',
  'account.proto.google.hint': 'Eén Google-account, één aanmelding: agenda’s, contacten en taken.',
  'account.proto.googleDrive.hint': 'Bestanden uit een Google Drive (alleen-lezen OAuth)',
  'account.proto.dropbox.hint': 'Bestanden uit een Dropbox (alleen-lezen OAuth-app)',
  'account.proto.box.hint': 'Bestanden uit een Box-account (alleen-lezen platform-app)',
  'account.boxUserId': 'Box-gebruikers-ID (numeriek)',
  'account.boxUserId.placeholder': 'bijv. 1234567890',
  'account.boxRootFolderId': 'ID van de hoofdmap',
  'account.boxRootFolderId.placeholder': 'Leeg = All Files',
  'account.dropboxAppKey': 'App-sleutel',
  'account.dropboxRootPath': 'Pad van de hoofdmap',
  'account.dropboxRootPath.placeholder': 'bijv. /Team Docs',
  'account.proto.gmail.hint': 'E-mail uit een Gmail-postvak (OAuth via IMAP)',
  'account.proto.googleCalendar.hint': "Agenda's uit een Google-account (OAuth via CalDAV)",
  'account.proto.googleContacts.hint': 'Contacten uit een Google-account (OAuth via CardDAV)',
  'account.gmailAppPassword': 'App-wachtwoord',
  'account.gmailAppPassword.hint':
    'Alleen voor persoonlijke Google-accounts; laat leeg om OAuth te gebruiken.',
  'account.gmailAppPassword.why':
    'Google raadt het af (wij ook): een app-wachtwoord opent de hele mailbox, terwijl een token met gerichte toestemming één ding opent. Het vereist tweestapsverificatie op het account, bestaat niet op een Workspace-account en wordt ingetrokken in de app-wachtwoordenlijst van het account zelf, zonder dat u iets hoeft met Ownpace.',
  'account.refreshToken': 'Refresh-token',
  'account.refreshToken.hint': 'Hiermee komt Ownpace in het account; behandel het als een wachtwoord.',
  'account.rootFolderId': 'Hoofdmap-ID',
  'account.rootFolderId.placeholder': 'Leeg = heel Mijn Drive',
  'account.serviceAccountKey': 'Serviceaccount-sleutel',
  'account.serviceAccountKey.placeholder': 'Plak het volledige JSON-sleutelbestand',
  'account.serviceAccountKey.width':
    'Deze sleutel kan elke gebruiker in het domein lezen; trek hem bij de overstap in.',
  'account.serviceAccountKey.why':
    'Domeinbrede delegatie kan veel van elke Workspace-gebruiker lezen, al benoemt elke migratie nog steeds één account. Autoriseer alleen de benodigde scopes in de Admin-console en trek de delegatie bij de overstap weer in.',
  'account.nativePolicy': 'Google Documenten, Spreadsheets, Presentaties en Tekeningen',
  'account.nativePolicy.hint':
    'Hiervan is geen bestand te migreren, alleen een weergave van Google.',
  'account.nativePolicy.hint.why':
    'Een Google-document is geen bestand: er is niets om over te zetten. Drive kan er een document of een PDF-export van maken, en dat bestand kan worden gemigreerd. Het alternatief is deze achterlaten in de bron (de standaard).',
  'account.nativePolicy.leave': 'Laten staan, en elk bestand melden',
  'account.nativePolicy.as.odf': 'OpenDocument ({ext})',
  'account.nativePolicy.as.office': 'Microsoft Office ({ext})',
  'account.nativePolicy.as.pdf': 'PDF ({ext}), niet bewerkbaar',
  'account.nativePolicy.as.image': 'Afbeelding ({ext})',
  'account.nativePolicy.as.leftBehind': '{format}: blijft staan',
  'account.nativePolicy.editable': 'Kies voor elke soort een bewerkbaar formaat',
  'account.nativePolicy.leftBehind': '{kinds} blijven staan in Google, elk met naam gemeld.',
  'account.nativePolicy.leftBehind.why':
    'Hier wordt niets van gemigreerd of verwijderd: elk bestand verschijnt met naam op het scherm Mislukkingen, waar u ze per stuk of allemaal tegelijk accepteert of opnieuw probeert. Formulieren, My Maps, Sites en Apps Scripts blijven altijd achter, omdat Google daar geen exportformaat voor heeft.',
  'account.nativePolicy.notEditable': '{kinds} komen aan als PDF.',
  'account.nativePolicy.notEditable.why':
    'Een PDF legt vast hoe het document eruitziet, maar bij export kan fijnere opmaak verloren gaan. Kies deze weergave als u dit bestand nooit meer hoeft te bewerken.',
  'account.nativePolicy.allEditable': 'Alle vier de soorten komen aan als bestanden die u kunt bewerken.',
  'account.nativePolicy.allEditable.why':
    'Elk bestand komt aan in door Google gegenereerd export-bestandsformaat, niet als origineel: fijnere opmaak kan verschuiven, en tekeningen komen als .svg-afbeelding omdat Drive geen bewerkbaar formaat voor tekeningen aanbiedt. U kunt een formaat later wijzigen, maar de al gemigreerde bestanden houden het formaat waarin ze aankwamen.',
  'account.paperFormat': 'Dropbox Paper-documenten',
  'account.paperFormat.hint': 'Geen te migreren bestandsformaat, kan alleen via Dropbox-export-bestandsformaat.',
  'account.paperFormat.hint.why':
    'Een Paper-document is geen bestand: er is niets om over te zetten. Dropbox kan er een Markdown- of HTML-export van maken, en dat bestand kan worden gemigreerd. Het krijgt dan aanvullend aan de naam een andere bestandsextensie: Notities.paper komt over als Notities.paper.md. Paper-sjablonen volgen dezelfde keuze. Het alternatief is deze bestanden achterlaten in de bron.',
  'account.paperFormat.leave': 'Laten staan, en elk document melden',
  'account.paperFormat.as.markdown': 'Markdown (.md), opent in Nextcloud Text',
  'account.paperFormat.as.html': 'HTML (.html), opent in een webbrowser',
  'account.paperFormat.leftBehind': 'Paper-documenten blijven staan in Dropbox, elk met naam gemeld.',
  'account.paperFormat.leftBehind.why':
    'Wordt niet gemigreerd, maar is ook niet verloren: elk document staat in de lijst bij Mislukkingen, en u kunt voor alle items nog een export-bestandsformaat kiezen, of deze bestanden achterlaten.',
  'account.paperFormat.arrives': 'Elk Paper-document komt aan als bestand dat u kunt bewerken.',
  'account.paperFormat.arrives.why':
    'Een export is een weergave die Dropbox maakt in een ander bestandsformaat, niet het Paper-document zelf: fijne opmaak kan verschuiven, en wat u op het nieuwe systeem wijzigt, gaat niet terug naar Dropbox. U kunt het bestandsformaat later nog wijzigen, maar de al gemigreerde documenten houden het formaat waarin deze al waren gemigreerd.',
  'account.proto.jmap.hint': 'Modern e-mailprotocol',
  'account.proto.caldav.hint': 'Agendaprotocol',
  'account.proto.carddav.hint': 'Contactenprotocol',
  'account.proto.webdav.hint': 'Bestandsopslag',
  'account.proto.soverin.hint': 'Eén account — e-mail, agenda’s en contacten',
  'account.proto.nextcloud.hint':
    'Eén account — agenda’s, contacten, bestanden en taken (geen e-mail)',
  'account.host': 'Host',
  'account.port': 'Poort',
  'account.targetDavUrl': 'DAV-basis-URL',
  'account.targetDavUrl.hint': 'Alleen wanneer de DAV-root van de server niet op de hostroot staat.',
  'account.nextcloudDavUrl.hint':
    'Het adres waarop u Nextcloud opent, met /remote.php/dav erachter.',
  'account.nextcloudDavUrl.why':
    'Nextcloud biedt agenda’s, contacten, taken en bestanden aan onder /remote.php/dav en niet op de root van de site, dus een host en poort kunnen niet zeggen waar het staat. Plak het adres uit de adresbalk — https://cloud.example.com — en zet er /remote.php/dav achter.',
  'account.soverinMailHost': 'Mailserver',
  'account.soverinMailHost.hint': 'Alleen nodig als dit account ook e-mail gaat ontvangen.',
  'account.soverinMailHost.why':
    'Agenda’s, taken en contacten hebben geen mailserver nodig. Test meet wat de host die u invult daadwerkelijk kan ondersteunen.',
  'account.soverinMailPort': 'Mailpoort',
  'account.providerDefaults.note':
    'Vooraf ingevuld met de gepubliceerde instellingen van {provider}, gelezen op {seen}. Test controleert deze.',
  'account.sourceUsername': 'Gebruikersnaam',
  'account.sourcePassword': 'Wachtwoord',
  'account.targetUsername': 'Gebruikersnaam',
  'account.targetPassword': 'Wachtwoord',
  'account.schedule.automatic': 'Automatisch',
  'account.schedule.automatic.hint': '14 dagen elk uur, daarna elke 6 uur, vanaf dag 30 dagelijks.',
  'account.schedule.hourly': 'Elk uur',
  'account.schedule.hourly.hint': 'Ieder uur',
  'account.schedule.daily': 'Dagelijks',
  'account.schedule.daily.hint': 'Elke dag',
  'account.schedule.sixHourly': 'Elke 6 uur',
  'account.schedule.sixHourly.hint': 'Vier keer per dag',
  'account.schedule.quarterHourly': 'Elk kwartier',
  'account.schedule.quarterHourly.hint': 'Frequente synchronisatie',
  'account.back': 'Terug',
  'account.next': 'Volgende',
  'account.missing.lead': 'Nog invullen om verder te gaan:',
  'account.tenantId': 'Tenant-ID',
  'account.clientId': 'Client-ID (applicatie-ID)',
  'account.sourceClientSecret': 'Clientsecret',
  'docs.title': 'Handleidingen',
  'docs.all': '← Alle handleidingen',
  'docs.onThisPage': 'Op deze pagina',
  'docs.notFound': 'Er is geen handleiding op dit adres. Dit zijn alle handleidingen:',
  'docs.otherLanguage': 'Deze handleiding is nog niet beschikbaar in het Nederlands; hieronder staat de Engelse versie.',
  'docs.operatorDocs':
    "Draait u een eigen appliance? Instellingen en commando's staan in de beheerdersdocumenten in de repository.",
  'docs.ownAppFold': 'Alleen als u een eigen oauth-app wilt gebruiken',
  'connections.delete': 'Verwijderen',
  'connections.rotate': 'Inloggegevens vervangen',
  'connections.reconnect': 'Opnieuw verbinden',
  'connections.rotate.hint':
    'Plak de nieuwe waarden; ze worden getest voordat ze de oude vervangen.',
  'connections.rotate.why':
    'Mislukt de controle, dan verandert er niets en blijft behouden wat werkte.',
  'connections.rotate.save': 'Controleren en vervangen',
  'connections.add': 'Account toevoegen',
  'connections.addAndTest': 'Toevoegen en testen',
  'connections.added': 'Toegevoegd',
  'connections.role': 'Bron of doel?',
  'connections.type': 'Aanbieder',
  'connections.name': 'Naam voor dit account',
  'connections.title': 'Accounts',
  'connections.intro':
    'De accounts waarmee uw migraties inloggen. Test controleert met alleen-lezen.',
  'connections.none': 'Nog geen accounts. Bij het starten van uw eerste migratie worden ze toegevoegd.',
  'connections.sources': 'Bronnen',
  'connections.targets': 'Doelen',
  'connections.test': 'Testen',
  'connections.testing': 'Bezig met testen…',
  'connections.usedBy.one': 'Gebruikt door 1 migratie',
  'connections.usedBy.other': 'Gebruikt door {count} migraties',
  'connections.usedBy.none': 'Nog door geen enkele migratie gebruikt',
  'connections.addedWhen': 'Toegevoegd {when}',
  'connections.setupSteps': 'Instellen',
  'connections.standing.migration': 'Migratie',
  'connections.standing.stopped': 'is {when} gestopt ({domains}):',
  'connections.standing.whichSide':
    'Logt in met deze en één andere verbinding; test deze om te weten welke.',
  'connections.standing.thisSide': 'Het ging mis bij dit account.',
  'probe.connected': 'Verbonden.',
  'probe.connectedSession': 'Verbonden.',
  'probe.targetStatus': 'De server op {url} antwoordde {status}.',
  'probe.targetStatus.refused': 'Is bereikbaar en weigerde de inloggegevens.',
  'probe.targetStatus.check': 'Controleer de host en poort van het doel.',
  'probe.noProbe': 'Een {kind}-verbinding kan nog niet worden getest.',
  'probe.timedOut':
    'Geen antwoord binnen {seconds} seconden; toch bewaard, dus test later opnieuw.',
  'probe.countedAtPreflight':
    'Deze export staat in uw nieuwe bestanden, dus hier valt nog niets te testen. Hij wordt geteld wanneer u de migratie controleert.',
  'probe.said.server': 'De server',
  'probe.said.mailServer': 'De mailserver',
  'probe.said.answeredWords': '{who} antwoordde {status}: {words}',
  'probe.said.answeredWordsNoStatus': '{who} antwoordde: {words}',
  'probe.said.answeredOther':
    '{who} antwoordde {status} met iets dat geen DAV-, JMAP- of IMAP-foutmelding is.',
  'probe.said.answeredOtherNoStatus':
    '{who} antwoordde met iets dat geen DAV-, JMAP- of IMAP-foutmelding is.',
  'probe.said.unreachable':
    'Op dat adres antwoordde niets: de naam werd niet gevonden, de verbinding werd geweigerd, of er kwam een timeout. Controleer de hostnaam en de poort.',
  'probe.said.certificate':
    'Het certificaat van de server kwam niet overeen of is verlopen, waardoor de test stopte voordat er werd ingelogd.',
  'probe.said.insideOurNetwork':
    'Dat adres ligt binnen het eigen netwerk van deze dienst, of de server stuurde de test door naar een adres dat daar ligt: geen verbinding gemaakt. Gebruik het adres dat de server op internet heeft.',
  'probe.said.unknown':
    'De test mislukte door onbekende reden. Controleer het adres en de poort.',
  'probe.said.reference': 'Referentie {reference}.',
  'probe.said.unmeasured': 'Niet gemeten — {sentence}',
  'probe.tooManyTests':
    'U hebt het afgelopen uur (te) veel verbindingen getest. Wacht even en test dan opnieuw.',
  'probe.measuring': 'Er wordt nog gemeten wat dit account kan omvatten — ververs over een minuut.',
  'probe.measured.atLeast': 'ten minste {count} {unit}',
  'probe.unit.folder.one': 'map',
  'probe.unit.folder.many': 'mappen',
  'probe.unit.calendar.one': 'agenda',
  'probe.unit.calendar.many': 'agenda\'s',
  'probe.unit.addressBook.one': 'adresboek',
  'probe.unit.addressBook.many': 'adresboeken',
  'probe.unit.taskList.one': 'takenlijst',
  'probe.unit.taskList.many': 'takenlijsten',
  'probe.unit.collection.one': 'verzameling',
  'probe.unit.collection.many': 'verzamelingen',
  'probe.qualify.lead': 'Omvat:',
  'probe.measured.lead': 'Gevonden:',
  'probe.found.none': 'geen',
  'probe.measured.message.one': '{count} bericht',
  'probe.measured.message.many': '{count} berichten',
  'probe.measured.card.one': '{count} kaart',
  'probe.measured.card.many': '{count} kaarten',
  'probe.measured.item.one': '{count} item',
  'probe.measured.item.many': '{count} items',
  'probe.measured.driveNote': 'Documenten, Spreadsheets en Presentaties niet meegeteld',
  'probe.measured.failed': 'niet gemeten',
  'probe.measured.unreadable.one': '{count} niet te lezen',
  'probe.measured.unreadable.many': '{count} niet te lezen',
  'connections.ok': 'Bereikt. De inloggegevens werken nog.',
  'connections.failed': 'Kon deze niet bereiken.',
  'connections.inUse.lead': 'Nog in gebruik door',
  'connections.inUse.unnamed': 'een migratie zonder naam',
  'connections.inUse.reason':
    'Verwijderen verwijdert wat we over die migraties hadden vastgelegd; verwijder ze eerst onder Migraties.',
  'connections.removed.done': 'verwijderd.',
  'connections.removed.revoked': 'De toegang bij de aanbieder is ingetrokken.',
  'connections.removed.failed':
    'Onze kopie is verwijderd, maar de aanbieder verleent de toegang nog: trek die zelf in.',
  'connections.removed.unsupported':
    'Wij hebben onze kopie verwijderd; deze aanbieder biedt geen manier om intrekking door ons te forceren.',
  'connections.removed.none': 'Er waren geen inloggegevens opgeslagen.',
  'connections.invalidValues.lead': 'Deze waarden kunnen zo niet worden gebruikt:',
  // ---- Provider setup checklist (workplan 0061) ----
  'setup.title': 'Aanbieder instellen',
  'setup.intro':
    'Stappen om door te lopen bij uw oude aanbieder; vinkjes worden voor uw hele organisatie bewaard.',
  'setup.target.intro':
    'Stappen om door te lopen bij uw nieuwe aanbieder; vinkjes worden voor uw hele organisatie bewaard.',
  'setup.backToConnections': '← Terug naar accounts',
  'setup.fullGuide': 'Lees de volledige handleiding',
  'setup.refusalGuide': 'Handleiding: {title}',
  'setup.settled': 'afgehandeld',
  'setup.stillOpen': 'nog te doen',
  'setup.waitingOnOthers': 'wacht op een beheerder',
  'setup.allDone': 'Alles is afgehandeld; u kunt het account nu verbinden.',
  'setup.nothingToDo': 'Vooraf niets in te stellen; u kunt het account meteen verbinden.',
  'setup.deploymentApp':
    'Niets om aan te maken: deze dienst heeft een eigen {provider}-app. Druk op Verbinden met {provider}.',
  // ---- Aanbieder kiezen en de lijst afstemmen op wie u bent (workplan 0068) ----
  'setup.choose.title': 'Wat wilt u instellen?',
  'setup.choose.intro':
    'Elk systeem heeft een eigen korte lijst die u doorloopt voordat een migratie kan starten.',
  'setup.choose.sources': 'Migreren vanaf',
  'setup.choose.targets': 'Migreren naar',
  'setup.admin.question': 'Beheert u dit systeem voor uw organisatie?',
  'setup.admin.yes': 'Ja, ik ben beheerder',
  'setup.admin.no': 'Nee, iemand anders',
  'setup.admin.unsure': 'Laat alles zien',
  'setup.admin.hint': 'Verandert alleen de indeling van de lijst; onthouden op dit apparaat.',
  'setup.yours': 'Wat u zelf kunt doen',
  'setup.forYourAdmin': 'Wat uw beheerder moet doen',
  'setup.forYourAdmin.hint': 'Stuur deze naar de beheerder; vink ze af zodra die bevestigt.',
  'setup.yields': 'Dit levert op:',
  'setup.tick': 'Deze stap afvinken',
  'setup.untick': 'Vinkje weghalen',
  'setup.skip': 'Overslaan',
  'setup.unskip': 'Niet overslaan',
  'setup.state.done': 'Gedaan',
  'setup.state.skipped': 'Overgeslagen — bewust niet nodig',
  'setup.needsAnotherPerson': 'beheerder nodig',
  'setup.needsAnotherPerson.hint': 'Vereist beheerdersrechten.',
  'setup.box.create_app.title': 'Maak een Box-platform-OAuth-app',
  'setup.box.create_app.detail':
    'Box Developer Console → Create Platform App → Custom App, en kies Client Credentials Grant (Server Authentication).',
  'setup.box.create_app.yields': 'een Client-ID en een Client-secret.',
  'setup.box.configure_access.title': 'Geef de app alleen-leestoegang',
  'setup.box.configure_access.detail':
    'Op het tabblad Configuration: zet App Access Level op "App + Enterprise Access", vink alleen de leesrechten voor bestanden en mappen aan en zet "Generate user access tokens" aan.',
  'setup.box.admin_authorize.title': 'Laat een Box-beheerder de app autoriseren',
  'setup.box.admin_authorize.detail':
    'Admin Console → Apps → Custom Apps Manager → voeg de app toe op Client-ID en autoriseer deze. Tot dat gebeurd is weigert Box elk token met "unauthorized_client".',
  'setup.box.subject_user_id.title': 'Zoek het numerieke gebruikers-id op',
  'setup.box.subject_user_id.detail':
    'Admin Console → Users & Groups → het account dat u migreert. Box wil het nummer, niet het e-mailadres.',
  'setup.box.subject_user_id.yields': 'het Box-gebruikers-id (nummer).',
  'setup.dropbox.create_app.title': 'Maak een Dropbox-app',
  'setup.dropbox.create_app.detail':
    'Dropbox App Console → Create app → Scoped access → Full Dropbox (of App folder als de migratie maar één map mag zien).',
  'setup.dropbox.create_app.yields': 'een App-sleutel en een App-secret.',
  'setup.dropbox.scopes.title': 'Geef de app alleen-leesrechten',
  'setup.dropbox.scopes.detail':
    'Zet op het tabblad Permissions files.metadata.read en files.content.read aan; niets dat schrijft. Voeg sharing.read toe als u hier gedeelde mappen wilt inventariseren.',
  'setup.dropbox.redirect_uri.title': 'Gebruikt u de knop? Registreer dan het redirect-adres',
  'setup.dropbox.redirect_uri.detail':
    'Alleen voor Verbinden met Dropbox met uw eigen oauth-app: onder de knop toont het formulier een adres. Voeg precies dat adres toe in de Dropbox App Console onder OAuth 2 → Redirect URIs en druk daarna opnieuw op de knop. Zonder de knop slaat u deze stap over.',
  'setup.dropbox.consent.title': 'Laat de accounthouder eenmalig toestemming geven',
  'setup.dropbox.consent.detail':
    'Verbinden met Dropbox voert deze stap en de volgende uit als de accounthouder erop drukt. Zonder de knop stuurt u de persoon van wie de Dropbox gemigreerd wordt de autorisatie-URL van deze app, met token_access_type=offline, zodat Dropbox een refresh-token teruggeeft.',
  'setup.dropbox.exchange_code.title': 'Wissel de code in voor een refresh-token',
  'setup.dropbox.exchange_code.detail':
    'Wissel de code uit de vorige stap eenmalig in bij het token-eindpunt van Dropbox. Toegangstokens worden per run aangemaakt; verder wordt niets langlevends bewaard.',
  'setup.dropbox.exchange_code.yields': 'een refresh-token.',
  'setup.google.create_oauth_client.title': 'Maak een Google OAuth-client',
  'setup.google.create_oauth_client.detail':
    'Google Cloud console → APIs & Services → Credentials → Create credentials → OAuth client ID, als Web-toepassing.',
  'setup.google.create_oauth_client.yields': 'een Client-ID en een Client-secret.',
  'setup.google.enable_api.title': 'Zet de API van het product aan',
  'setup.google.enable_api.detail':
    'Zet in hetzelfde project de API aan die past bij de gekozen bron — Google Drive API, Gmail API, CalDAV API, Google Contacts CardDAV API of Google Tasks API. Zonder dat mislukt de eerste aanroep.',
  'setup.google.consent_scope.title': 'Laat een refresh-token voor dat product toestemmen',
  'setup.google.consent_scope.detail':
    'Laat de accounthouder instemmen met de scope-grants van dat product; een token voor het ene Google-product werkt niet voor het andere. Of gebruik een service-account met domain-wide delegation, dat een beheerder eenmalig voor het hele domein autoriseert.',
  'setup.google.consent_scope.yields': 'een refresh-token (of een service-account-sleutelbestand).',
  'setup.graph.app_registration.title': 'Registreer een app in Microsoft Entra',
  'setup.graph.app_registration.detail':
    'Entra-beheercentrum → Identity → Applications → App registrations → New registration, in de tenant waarvan u de postvakken migreert. Kies Accounts in this organizational directory only en laat het redirectadres leeg. De pagina Overview toont daarna de Application (client) ID en de Directory (tenant) ID.',
  'setup.graph.app_registration.yields': 'een Tenant-ID en een Client-ID.',
  'setup.graph.api_permissions.title': 'Voeg Mail.Read toe en laat een beheerder toestemmen',
  'setup.graph.api_permissions.detail':
    'API permissions → Add a permission → Microsoft Graph → Application permissions → Mail.Read. Verder niets: deze kaart leest de mail van één postvak. Daarna drukt een beheerder op Grant admin consent for uw organisatie. Als toepassingsrecht kan Mail.Read elk postvak in de organisatie lezen; deze dienst leest alleen het postvak dat de verbinding noemt.',
  'setup.graph.client_secret.title': 'Maak een client-secret',
  'setup.graph.client_secret.detail':
    'Certificates & secrets → New client secret. Kopieer de waarde meteen — Entra toont deze één keer.',
  'setup.graph.client_secret.yields': 'een Client-secret.',
  'setup.exchange.permission.title': 'Voeg IMAP.AccessAsApp toe en laat een beheerder toestemmen',
  'setup.exchange.permission.detail':
    'API permissions → Add a permission → APIs my organization uses → Office 365 Exchange Online → Application permissions → IMAP.AccessAsApp. Geen Microsoft Graph-recht: deze kaart meldt zich aan bij de IMAP-server van Exchange Online, en zo’n token omvat alleen rechten die Exchange Online geeft. Daarna drukt een beheerder op Grant admin consent for uw organisatie.',
  'setup.exchange.service_principal.title': 'Registreer de toepassing in Exchange Online',
  'setup.exchange.service_principal.detail':
    'Een Exchange-beheerder voert New-ServicePrincipal uit in Exchange Online PowerShell, met de Application (client) ID en de Object ID die onder Enterprise applications staat. Niet de Object ID onder App registrations: daarmee mislukt de aanmelding van de kaart. De handleiding geeft de opdrachten.',
  'setup.exchange.mailbox_permission.title': 'Geef rechten tot de data',
  'setup.exchange.mailbox_permission.detail':
    'De Exchange-beheerder voert Add-MailboxPermission uit met -AccessRights FullAccess, één keer voor elk postvak dat de kaart leest. Met FullAccess zou een toepassing het postvak ook kunnen wijzigen. Deze dienst leest het alleen, en Microsoft dwingt dat voor deze kaart niet af.',
  'setup.imap.server_address.title': 'Zoek het IMAP-serveradres op',
  'setup.imap.server_address.detail':
    'De host en poort die uw mailaanbieder voor IMAP documenteert, en of er SSL gebruikt wordt. Meestal poort 993 met SSL.',
  'setup.imap.server_address.yields': 'een host, een poort en de SSL-instelling.',
  'setup.imap.app_password.title': 'Maak een app-wachtwoord',
  'setup.imap.app_password.detail':
    'De meeste aanbieders weigeren een gewoon accountwachtwoord voor IMAP zodra tweestapsverificatie aanstaat en willen een app-specifiek wachtwoord. Maak er één voor het account dat gemigreerd wordt.',
  'setup.imap.app_password.yields': 'een gebruikersnaam en een app-wachtwoord.',
  'setup.webdav.account_exists.title': 'Zorg dat het doelaccount bestaat',
  'setup.webdav.account_exists.detail':
    'Maak het account eerst aan op de doelserver, met genoeg quota voor wat eraan komt. Dit product maakt zelf geen accounts aan.',
  'setup.webdav.app_password.title': 'Maak er een app-wachtwoord voor',
  'setup.webdav.app_password.detail':
    'In Nextcloud: Instellingen → Beveiliging → Apparaten & sessies → Nieuw app-wachtwoord. Gebruik dat in plaats van het accountwachtwoord zelf.',
  'setup.webdav.app_password.yields': 'een gebruikersnaam en een app-wachtwoord.',
  'setup.webdav.base_url.title': 'Noteer het WebDAV-adres',
  'setup.webdav.base_url.detail':
    'De WebDAV-basis-URL van de server voor dat account — Nextcloud toont deze onderaan de pagina met bestandsinstellingen.',
  'setup.webdav.base_url.yields': 'de host, poort en het pad voor in het formulier.',
  'setup.jmap.account_exists.title': 'Zorg dat het doelaccount bestaat',
  'setup.jmap.account_exists.detail':
    'Maak de postbus eerst aan op de JMAP-server, met genoeg quota. Dit product maakt zelf geen accounts aan.',
  'setup.jmap.api_token.title': 'Maak er een app-wachtwoord voor',
  'setup.jmap.api_token.detail':
    'Maak in de instellingen van de server zelf een app-wachtwoord voor dat account, als die dat aanbiedt; dit product meldt zich aan met de gebruikersnaam en dat wachtwoord.',
  'setup.jmap.api_token.yields': 'een gebruikersnaam en een app-wachtwoord.',
  'setup.davbasic.account_exists.title': 'Zorg dat het doelaccount bestaat',
  'setup.davbasic.account_exists.detail':
    'Maak het account eerst aan op de doelserver, met genoeg quota voor wat eraan komt. Dit product maakt zelf geen accounts aan.',
  'setup.davbasic.app_password.title': 'Maak er een app-wachtwoord voor',
  'setup.davbasic.app_password.detail':
    'Gebruik waar de server dat aanbiedt een app-specifiek wachtwoord in plaats van de gewone login — dat kan ingetrokken worden zonder het wachtwoord van de persoon te wijzigen.',
  'setup.davbasic.app_password.yields': 'een gebruikersnaam en een app-wachtwoord.',
  'setup.apple.app_password.title': 'Maak een app-specifiek wachtwoord',
  'setup.apple.app_password.detail':
    'Meld u aan op account.apple.com → Aanmelden en beveiliging → App-specifieke wachtwoorden en maak er een. Apple toont het één keer, dus kopieer het meteen. Gebruik niet het wachtwoord van uw Apple-account.',
  'setup.apple.app_password.yields': 'een app-specifiek wachtwoord, zoals abcd-efgh-ijkl-mnop.',
  'setup.nextcloud.account_exists.title': 'Zorg dat het Nextcloud-account bestaat',
  'setup.nextcloud.account_exists.detail':
    'Het account moet al bestaan op uw Nextcloud, met genoeg ruimte voor wat eraan komt. Deze dienst maakt zelf geen accounts aan.',
  'setup.nextcloud.app_password.title': 'Maak een app-wachtwoord',
  'setup.nextcloud.app_password.detail':
    'In Nextcloud: Instellingen → Beveiliging → Apparaten & sessies. Typ bij App naam een naam, zoals Migratie, druk op Creëer een nieuw app wachtwoord en kopieer het wachtwoord. Gebruik dat in plaats van het accountwachtwoord zelf: het kan ingetrokken worden zonder uw eigen wachtwoord te wijzigen.',
  'setup.nextcloud.app_password.yields': 'een app-wachtwoord, voor het vak Wachtwoord van het formulier.',
  'setup.nextcloud.dav_url.title': 'Noteer het adres van uw Nextcloud',
  'setup.nextcloud.dav_url.detail':
    'Het adres waarop u Nextcloud in uw browser opent, zoals https://cloud.example.com. Bij Migratie starten vult u dat in bij Het adres van uw Nextcloud; /remote.php/dav wordt er dan achter gezet. Op de pagina Accounts vult u bij DAV-basis-URL het adres met /remote.php/dav erachter in, zoals https://cloud.example.com/remote.php/dav. Nextcloud toont het WebDAV-adres onderaan de pagina met bestandsinstellingen: de naam na /remote.php/dav/files/ is de gebruikersnaam die u invult.',
  'setup.nextcloud.dav_url.yields': 'het adres van uw Nextcloud en uw gebruikersnaam.',
  'setup.soverin.account_exists.title': 'Zorg dat het Soverin-account bestaat',
  'setup.soverin.account_exists.detail':
    'Het Soverin-account moet al bestaan, met ruimte voor wat eraan komt. Deze dienst maakt zelf geen accounts aan.',
  'setup.soverin.password.title': 'Houd het accountwachtwoord bij de hand',
  'setup.soverin.password.detail':
    'Deze dienst meldt zich aan met het Soverin-e-mailadres en het wachtwoord van dat account. Biedt Soverin u een app-wachtwoord, dan kan dat in hetzelfde vak Wachtwoord. Of één app-wachtwoord voor mail én voor agenda’s en contacten werkt, staat niet vast; de test gaat aangeven wat werkt.',
  'setup.soverin.password.yields': 'het e-mailadres, en het wachtwoord of een app-wachtwoord.',
  'setup.soverin.mail_server.title': 'Gaat er mail mee? Laat de mailserver staan',
  'setup.soverin.mail_server.detail':
    'Het formulier vult Mailserver, imap.soverin.net, en Mailpoort, 993, in met de gepubliceerde instellingen van Soverin. Gaat er mail mee, laat Mailserver dan ingevuld: een account dat zonder Mailserver is bewaard, omvat geen mail. Agenda’s en contacten hebben geen mailserver nodig.',
};
