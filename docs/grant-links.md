# Grant links — letting somebody connect their own account

A grant link lets the person whose account is being migrated give access to it **themselves**,
without an Ownpace account and without ever sending anybody their password.

It exists because the alternative is worse in a specific way. Migrating a colleague's mailbox
needs a credential for that mailbox, and the two obvious ways to get one are both bad: asking
for their password, or signing in to their account yourself and copying the token out of the
browser. Both put one person's private credential through another person's hands; being with
them while they sign in themselves does not. A link
removes the middle: they sign in on their provider's own page (Google, Microsoft, Dropbox, Cirrux
Drive), or, for an account that signs in with a password, type that password themselves on a page
Ownpace shows only them (since alpha.21, workplan 0174). What comes back is stored encrypted,
against the migrations it serves, and never shown to anyone, you included.

**You send the link. We never do.** Ownpace does not email it, does not store the recipient's
address, and does not know who you sent it to. That is deliberate: an address we never learn is
an address we cannot leak, and you already know who the person is.

**One link per person.** A link is made for a person, not for a migration: one grant link for all
of their migrations, which asks each account of theirs once, the ones their data is copied from
and, since alpha.21, the ones it is copied to, and one progress link where they follow all of
them (ADR-0035). A migration's page makes no link of its own. A migration's
link sent before that changed keeps working until it expires: see
[Links sent before](#links-sent-before).

## Issuing one

On the person's page (open them from **Migrations**), in the section with their name (**For
Anna**, say), under **One grant link for everything**:

1. Tell them first, by phone or in person: that a link is coming from you, and what it is for.
   The section says so above its button (*Tell Anna first, by phone or in person. The page asks
   whether you did.*), because the page they open asks exactly that, and waits if the answer is
   no (workplan 0176, D13).
2. While you have given no name of your own, the form asks for it once, as they know you, and
   saves it for you first (workplan 0176 T3). It does not ask who you are to them (the owner,
   2026-11-26).
3. Choose how the page speaks to them: **Dutch, with u**, **Dutch, with je**, or **English**
   (workplan 0176 T7). It is kept with the person, so each of their links and their progress page
   say it, and offered again next time. With *je*, one line says that a parent completes a link
   for a child under 16 together with the child, as the privacy policy says.
4. Choose how long the link should work — **1 day**, **7 days** or **30 days**. Thirty is
   pre-filled, so the person has time: the page they open tells them there is no hurry, and until
   when.
5. Tick **I have told Anna that a link is coming**, and press **Create grant link**. The button
   waits for the tick: it cannot be checked, and it is there as a prompt.
6. The link comes with **a message to send**, in the person's language and with *je* or *u* as
   chosen: *This is the link I told you about…*, what is copied, where to, and until when. Change
   it as you like, then copy it and send it, however you normally reach that person. **Print a
   sheet for Anna** opens everything the link says on one page, which prints, for doing it
   together at the table.

*Start a migration* offers the same link, with the same line and the same choices, on its last
screen when the person connects their own accounts (**They do, with a link**). Since alpha.21
that covers every account a link can connect: for one that signs in with a password, you fill in its server and account and press **Save for**
*the person*, and no password box is shown. The destination step asks **Whose account is** *the
provider*? when the destination signs in with a password, or is Cirrux: **Mine, or the
organisation's: I connect it**, or *the person*'s own, **they connect it with the link**. The last
screen counts what the link asks for: *The link asks Anna for 2 accounts: …*. It is one link
either way, however many migrations it serves. You can press **Start** there once one count is in: the migrations still waiting for the
link start by themselves when the person connects (see [When the grant lands](#when-the-grant-lands)).

**When every account of theirs is connected already**, the new link asks each of them to connect
again, and the screen says so. Make one when a connection has stopped working: the person took
the access back at Google, or it lapsed, or it expired, as Google's access does after seven days
while a Google application is still in testing. Their page says why it asks again, and asks each
account again, and the link is spent once each has been connected through it.

**A migration that belongs to nobody**, made before people were or by hand, is given a person
first. On the migration's page, under **Links**, answer **Who is this for?**: choose somebody,
or **Someone new** with their name, and press **Save**. The section then points to their page,
where the link is made.

**If they open it inside another app.** A link tapped in a chat or mail app opens in that app's
own browser, and Google is reported to refuse its sign-in there. The page says what to do on
the step before the provider's own page, *Have this ready*, where it can still be acted on: *If
this page opened inside another app, such as a chat or mail app, use
that app's 'Open in browser' option or copy the link into your favorite browser, such as
Firefox, Safari or Chrome. The link still works.* It does: opening a link spends nothing, so opening it again in
Firefox, Safari or Chrome is safe.

**Worth doing once:** give your name and your own number, under **Team & organization → When you
send someone a link**. Both are optional. The page the other person opens names you by that name,
and shows your number as something to check, beside *Or use the number
you already have for* you: a number they already have is the safer one. Without a number of
yours, it shows your organisation's, under **Team & organization → Organization → Phone number**,
and says that it is the organisation's.

**The link is shown once.** Nothing can show it to you again, because only a fingerprint of it
is stored — the same reason a password is never stored readable. If you lose it, revoke it and
issue another.

The link is a **key in a URL**. Anyone holding it can connect that account, so treat it the way
you would treat a password: send it the way you would send a password, and not somewhere it
will sit in a shared channel afterwards.

### If issuing refuses

The button refuses rather than handing out a link that would fail in somebody else's browser.
A person's link is refused only when none of their migrations can be granted through it. It then
gives each migration's reason, once each, and each names what to fix:

| It says | What to do |
|---|---|
| The person has no migrations yet | Add one first. |
| The migration has no source connection yet | Finish setting up the source first. |
| The source is not an account a link can connect | A person's link connects a Google account, Gmail, Google Calendar, Google Contacts and Google Drive, a Microsoft 365 account, personal or work (alpha.20), Dropbox, and since alpha.21 every source that signs in with a password: an IMAP mailbox, an Apple Account (iCloud), CalDAV, CardDAV and WebDAV (see [A password, typed by the person](#a-password-typed-by-the-person)). What it does not connect is what an organisation holds rather than a person: Box, a company's own Microsoft app (*Microsoft 365 (Graph API)* or *(IMAP)*), which reads with application permissions nobody grants by signing in, and Google's domain-wide delegation. An export archive has no credential at all. Those still come to you by hand, on the Accounts page. |
| The destination is not one a link can connect | *This destination is not one a link can connect. Connect it yourself on the Accounts page.* A link connects a destination that signs in with a password (Soverin, Nextcloud, Cirrux, Infomaniak, JMAP, IMAP, CalDAV, CardDAV, WebDAV) when you saved it for the person, and Cirrux Drive once its app password is stored. Any other destination is yours to connect. A destination you connected with your own password is not on the link at all: it is not the person's to grant. |
| The migration names no account | A grant is only accepted from the Google or Microsoft account the migration reads (see below), so a migration that names none cannot be granted. The account is set when a migration is created: create it again with the account's address. |
| The migration has no destination yet | Set the destination first. The person you ask is shown where their data will go before they agree, so a link needs one to name. |
| The migration copies no data types | Include at least one. A link for a Google account asks for exactly the data types the migration copies, so with none there is nothing to ask. |
| No client id or client secret is stored, and the deployment has no Google client | Add them on the source connection — see [Google Workspace setup](./google-workspace-setup.md), step 3 — or ask whoever runs your Ownpace to set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. Your own client, when you store one, is always the one used. Half a pair is refused rather than finished with the deployment's other half. |
| The same, for a Microsoft account | Add your own Entra app's Client ID and client secret (and its Tenant ID, for a single-tenant app) on the source connection, or ask whoever runs your Ownpace to set `MICROSOFT_OAUTH_CLIENT_ID` and `MICROSOFT_OAUTH_CLIENT_SECRET` ([Microsoft setup](./microsoft-setup.md)). Half a pair is refused the same way. |
| The same, for Dropbox (*its Dropbox app is not set up yet*) | Add your own Dropbox app's App key and App secret on the source connection, or ask whoever runs your Ownpace to set `DROPBOX_OAUTH_CLIENT_ID` and `DROPBOX_OAUTH_CLIENT_SECRET`. Half a pair is refused the same way. |
| Mail and files need scopes Google classes as restricted | Through the deployment's own Google client, a link asks for Gmail or Drive only where whoever runs your Ownpace has declared `GOOGLE_ACCOUNT_SCOPE_CLASS=restricted`, once their application carries those scopes. Or add your own Google client on the source connection. Calendars, contacts and tasks need neither. |
| `WEB_URL` is not set | A deployment setting. Whoever runs your Ownpace needs to set it and restart; a link built without it would point at the wrong machine. |
| Your organisation already holds as many grant links as it may | Revoke one that is no longer needed, or wait until one is used or expires (see below). |

### How many at once

On the managed service, an organisation may hold as many grant links that can still be used as
its tier runs migrations at the same time: Free 1, Small 4, Medium 20, Large 50, Extra large
200. The tier is the one your usage screen shows, so an organisation running more migrations
gets more links as it grows. Only live links count: a link that was used, revoked or has expired
does not, and a progress link never does, since it grants nothing. A person's link counts once,
whatever it covers, and a migration's link sent before counts while it is live. When you need more at once,
for an onboarding week say, ask us: we can set another number for your organisation, until a
date or for good.

## What the other person sees

The page asks one thing at a time (workplan 0176). Each step is a screen of its own, with one
heading and the step in words (*Step 2 of 4*), and the browser's **Back** goes one step back. It
speaks to them as you chose, with *je* or *u*, and opens in their language until they pick
another. At the foot of every screen, **Read everything on one page** shows all of it at once,
and prints. An account that signs in with a password is described in [A password, typed by the
person](#a-password-typed-by-the-person); the sign-in accounts go as below.

1. **Who asks, and for what.** One line says what Ownpace is: the service that makes the copy,
   and where it runs, when the service names its country. Then who is asking: the heading and,
   under **Sender**, the name **you** gave, with the address you sign in to Ownpace with under
   it; without a name, that address, and your
   organisation's name where the link names no one (workplan 0176 T3). Then a number to check:
   yours, else your organisation's, saying whose it is, and *Or use the number you already have*.
   And if your invoice details carry a business VAT number that the EU VAT register
   (VIES) confirmed, they see your company's name as the register gives it: the one name on the
   page nobody typed for it. Then what is asked, in one sentence: what is copied, from where and
   to where (with more than one account, the next screen shows where). Then a few facts:
   everything also stays where it is, Ownpace only reads there, your organisation can open the
   copy too where it connected the destination, and there is no hurry: the link works until its
   date. Then one question: did you tell them about this link yourself? Two answers of one
   size: **Yes, that is right** and **No, not yet**. The answer only opens the next screen. It is
   kept in that browser tab and never sent, so a return from Google does not ask again.
2. **Not yet** opens a calm screen: ask you first, in a way they trust; the page can wait until
   its date; and if they do not know you, close the page, or report the link (see [If they doubt
   it](#if-they-doubt-it)). Nothing is sent. **Back** returns to the question.
3. **The accounts**, when the link holds more than one, or one that is connected already, or a
   new address for them to confirm. A line for each account, sources first, then destinations:
   the account, its provider, what is copied from or to it, and its state, **Connected**,
   **Waiting** or **Locked on this link**. A destination is named by its account and its
   provider, or by its server where the provider has no name of its own. With the account the
   copy is read from, that is what lets somebody tell your migration from a stranger's, because
   everything else they see is genuine either way — this page, and Google's own. With one
   waiting account and nothing else to show, the page goes straight on.
4. **Have this ready**, for one account: its address; its password, which they type only on the
   provider's own page, so Ownpace never sees it and neither do you; their phone, for a code the
   provider may send, which they give to nobody, you included; and, when they do not know the
   password, to stop there and do it together with you. During the Alpha, for Google, it suggests
   doing this together with you: on the phone, or at the table. The note for a page opened inside
   a chat or mail app stands here too.
5. **What they will see at the provider**, as a numbered list: that the provider asks them to
   sign in, and as which account — the one the step names, since any other is refused; during the
   Alpha, Google's warning, why Google warns, and that they go on to Ownpace there only because
   you told them about it; what the provider asks for, in plain words, with **the exact
   permission** it will record behind a fold, so they can find it again in their own account;
   and, during the Alpha, what to do when Google does not allow the connection: the address is
   not on Google's list of test users yet, so they close the page and tell you. Then how long the
   link works, the privacy policy and the terms, before they go anywhere, and two buttons: the
   provider's own, and **No, rather not**, which ends calmly: nothing has happened, and the link
   still works.

What the page says Ownpace does is held to what the permission allows:

- **that Ownpace only reads** — nothing is ever deleted or changed in their account. For mail,
  calendars and contacts the provider step also says that Google's words are broader than what
  Ownpace does, because the permission Ownpace asks for there also allows changes, and Google's
  own screen says so; Ownpace makes none. It ends with the tester guide's own sentence: *Make sure
  everything Ownpace asks for is ticked.* A grant with less than was asked is not stored;
- **"read-only" only where Google enforces it**: for a link that asks only for Google Drive,
  Google Tasks or both, whose permissions Google holds to reading, the page says *Read-only*
  instead. That is said of what the link asks for. Google also adds to the grant any permission
  the same Google account already gave the same app, which may allow changes, so the page after
  Google says which it was (below).

When they press the provider's button they go to Google, sign in, and land back on a page that
says it is done. **That page contains no token and asks nothing else of them.** It says how many
accounts are left, and leads back to the link while any are; they can close it and get on with
their day. A connected account says **Connected**, and the link is spent once every account on it
is. On a link made to ask again, the first screen says why it asks again. An account that cannot
be asked, such as one whose migrations run through two different applications of its provider
(two Google applications, or two Microsoft ones), says why instead of offering the button, in
words they can pass on to you.

A migration a link cannot serve, such as one reading Box or a company's own Microsoft app, is
left off the page: its credential still comes to you by hand.

### A Dropbox account (workplan 0174, alpha.21)

A Dropbox account is asked the same way: **Continue with Dropbox as** *that account*, and the
permission in words (*Dropbox: read your files*, and reading the account's name, email address
and the space it uses). Dropbox takes no hint of which account to offer, so the account is checked
after sign-in: Dropbox is asked who signed in, and the grant is kept only when that is the named
address, apart from capitals, and Dropbox says the address is verified. Otherwise nothing is
stored and the link still works. The person can also withdraw the access in their Dropbox
settings, under *Connected apps*.

### Cirrux Drive, on a destination (workplan 0174, alpha.21)

When the person's own Cirrux account is the destination and files go there, the card offers
**Connect Cirrux Drive** once the account's app password is stored, by you or by the person on the
same page. Cirrux's sign-in names a workspace, never an address, so the first Drive grant on an
account records the workspace it reached, and every later grant, through a link or your own
*Connect Cirrux Drive*, must reach the same one; another workspace is refused and nothing is
stored.

### A Microsoft account (workplan 0171, alpha.20)

A Microsoft 365 account, personal (Outlook.com, Hotmail) or work, is asked the same way. Its
steps say Microsoft where a Google account's say Google: *What you will see at Microsoft*, then
**Sign in with Microsoft** on its last step, the permission Microsoft will ask for in words (*Outlook: read your email*, *OneDrive: read your
files*, and so on), and the exact string under *Technical details*. Every Microsoft permission a
link asks for is one of the read permissions *Connect with Microsoft* asks for, so the box says
*Read-only*. The button goes to Microsoft's
own sign-in, offering the named account first, at the consumer sign-in for an address on one of
Microsoft's own domains and at the work sign-in for any other.

Beside the data it asks for **who signed in** (`openid`, `email`, `profile` and `User.Read`, the
person's own profile). Every new Microsoft consent asks for these since alpha.20, the owner's
own *Connect with Microsoft* too (decision D7 of workplan 0171): it is also what lets Finish list
the addresses that receive mail. A connection made before alpha.20 lacks it until it is connected
again.

A work organisation whose administrator requires approval for new apps stops the person at
Microsoft's page. The page after it says so in Microsoft's words (the Entra error code with it),
nothing is stored, and the link is not used up: once an administrator has approved Ownpace's app
for the organisation, the same link works.

That page judges the permission Google actually recorded, not the one the link asked for. It
calls the access read-only only when every permission Google recorded is the read-only one for
Google Drive or Google Tasks. Otherwise it says that Ownpace only reads and that the permission
also allows changes. When the link asked only for Drive or Tasks and Google's answer carries
more, because the same account had already given the same app a broader permission, the page
says that too.

**In English or Dutch, as they choose** (workplan 0145 T6). The page opens in their browser's
language and has two buttons in its top corner, **English** and **Nederlands**; the progress page
has the same two.
What will be read, the refusals of the link and of the migration, and the page after Google are
in that language, and so is taking the access back, its refusals included. A refusal when they
report the link is still in English for now (workplan 0145 T6). The page after Google follows the language the grant page was in when they
pressed the button. It asks them to keep their progress link, by a bookmark or a copy, because a
page opened inside another app may not keep a bookmark. A **Copy link** button beside the link
copies it and says *Copied.*; where the browser does not allow copying, as a private window on a
phone may not, it selects the link instead and says so, so the phone's own Copy is one press away.

## A password, typed by the person

Since alpha.21 (workplan 0174) a link also connects an account that signs in with a password,
source or destination: an IMAP mailbox, an Apple Account (iCloud, with an app-specific password),
CalDAV, CardDAV and WebDAV; and as a destination Soverin, Nextcloud, Cirrux, Infomaniak, JMAP and
IMAP. The point is the one above: **nobody's password has to pass through you.**

**You fix where; they type the secret.** You save the account for the person with its server
and its account name, and no password (*Start a migration*, **Save for** *the person*). The
Accounts page shows it as *Waiting for* *the person*, with no **Test** until it is connected. On
their page the server and the account are shown, not boxes; the person types the password, and
only the fields their provider says only they know (Infomaniak's sync user name, when you left it
empty).

**Before any box, the card says where the password goes.** The server it will be checked with,
its domain in bold, and *Type it only if this is your own provider's server.* For Apple, Cirrux
and Infomaniak it is the server the provider publishes, whatever the account's row says, and the
password is tried there only. Soverin's own pages could not be read when this was built, so its
card shows the server you saved, as for any IMAP or DAV account. For an account that is an email address,
the server's domain is compared with the address's own domain and with its mail servers' (MX);
when it matches neither the card adds a warning, never a refusal: *This server is not one your
address's mail uses, as far as we can tell.* A server you named by a number rather than a name is
never tried, and nor is a name that leads into a private network: the card asks the person to
tell you. The card also says that nobody can see the password again, not you, not your
organisation, not Ownpace's staff, and that Ownpace never emails a link or asks for a password
by email or phone. With no phone number set for your organisation, it tells them to check with
you some other way first.

**Tested before it is stored.** The password is checked with the same test the Accounts page
runs, the login and each data type the migrations need, and stored, encrypted, only if it works.
A refused login, a server that cannot be reached, and a data type the server refuses each say so
in the person's language, by category, never in the server's own words. Nothing that failed is
stored.

**Five wrong passwords lock that account on that link.** Only the server refusing the login
counts; a server that cannot be reached does not. The other accounts on the link go on. A new
link starts again at five.

**The password is never shown, logged or audited.** It goes from their browser in the body of one
request, is tested, and is stored encrypted. It is in no address, log line, audit record, answer
or job. The audit record says that an account was connected, by password, or that a try was
refused and why, by category.

**Where it is kept, and who may change it.** A source's password is stored on each migration that
reads that account, as a sign-in's token is. A destination's password is stored on the
destination account itself, which then records the person who connected it: it takes only that
person's migrations, and its password can be changed only by them, through a new link from you
(*… connected this account themselves. Make them a new grant link to change it.*). The person
withdraws a password on their progress page, a source's or a destination's, as they withdraw a
sign-in: **Remove my password**, behind a second press. Nothing more is then read from that
account, or written to it, until they connect it again through a new link from you. Either way,
changing the password at their provider makes the stored one useless.

### Only the account the page names

The account a step names is a condition, not a label. Google or Microsoft tells Ownpace which
account signed in, and access is accepted only from that one. So a link forwarded to
somebody else, or opened in a browser signed in to the wrong account, connects nothing. Google
offers the named account first, so the wrong one is rarely picked by accident.

For this, Google's consent screen also asks to share the person's email address. That is its
basic permission, it needs no verification, and it appears in the exact permission the page
shows.

If somebody signs in with another account, the page names both addresses and says nothing was
stored. **Their link still works**: they open it again and choose the right account. The access
Google gave to the wrong account is not withdrawn by Ownpace, deliberately. Withdrawing it
would also withdraw access that account may have given for another migration through the same
Google application. Ownpace keeps nothing from it. If that account is not being migrated as
well, the person can remove the access in their Google account's security settings.

A Gmail address matches however its dots are placed, with or without a `+suffix`. On a company
domain the address must match exactly, apart from capitals.

**At Microsoft** the account is read in two steps. The answer must come from Microsoft's sign-in
for the organisation it names, and be meant for this Ownpace's app; then Ownpace asks Microsoft
for the account's own profile. The named address must be the account's sign-in name, its primary
address, or one of its other addresses (its *proxy addresses*), apart from capitals. So for a
Microsoft work account an alias **is** accepted. The address the sign-in claims to have is not
enough on its own, because an organisation's administrator can set it to anything. A personal
account has no such profile to read, and its sign-in name is compared. If somebody signs in with
another account, the page says *You signed in as … ; this link is for …*, that nothing was
stored, and to sign out of Microsoft in that browser before using the link again: Microsoft
offers the account last signed in first. If the migration names an **alias**
of the account, sign-in is refused, and the page shows the account's own address. A
migration's account cannot be changed afterwards, so create it again with that address.

### If they doubt it

**Report this link** (workplan 0108 T8 (d)) is a button on the *not yet* screen, where it answers
the question, and a quiet link at the foot of every other screen, so somebody who answered yes
and doubts it a step later can still report it. A report goes to whoever runs your Ownpace, **not
to you**: what the person wrote, an address to reply to if they
want an answer, and which link it was, so they can find the person, each of their migrations and
who issued the link. The progress page offers the same, for somebody who granted and then had
doubts. It appears only where the service has a
helpdesk set up.

A report changes nothing by itself. The link keeps working until you revoke it, and nothing is
read unless the person grants. Whoever runs your Ownpace may ask you about it.

## When the grant lands

The token is stored on each migration the person's page asked for it. What happens next depends
on whether you have started their move:

- **Not yet**: nothing of theirs has been started. The counts appear, on *Start a migration*'s
  last screen and on each migration's page, and you press **Start** once you have seen them.
- **Started**: you have started one of their migrations, though you may have paused it since or
  it may have finished. Each migration of theirs that was waiting for this grant starts by itself,
  ones you added later included. The record of it names the grant, not you.
- **Paused**: a migration you paused after it ran stays paused. Pausing their other migrations
  does not keep a waiting one from starting when the grant lands.

The person's page says which applies beside each migration of theirs that waits for the grant:
*Waits for Anna to connect, then starts by itself*; *Waits for Anna to connect. Once they have,
open Details to review and start it*; or, for one that ran before and lost its connection, *Waits
for Anna to connect again*. Pressing **Start** on such a migration says it too. Since alpha.21 a
migration starts only when both its source and its destination have a way in, and the page also
says *Waits for Anna to connect the destination …*, and, for a password, how many wrong ones were
typed on the live link and how many tries are left, or *… is locked on this link after five tries.
Make Anna a new link.* It shows counts only, never what the server said.

## Managing them afterwards

The list under **One grant link for everything**, on the person's page, shows every link made for
them and what became of it:

- **Live** — it works, and nobody has used it yet.
- **Granted** — every account it asked for was connected with it. It is spent and cannot be used
  again.
- **Revoked** — you switched it off.
- **Expired unused** — it ran out before anybody got to it. This is the one to act on: somebody
  was asked and never managed to answer. Issue another and send it again.

One account on a link can also be **Locked on this link**: five wrong passwords were typed for it
(see [A password, typed by the person](#a-password-typed-by-the-person)). The link's other
accounts still work. Make the person a new link: it starts again at five tries.

Every grant is recorded: which link, which account, which destination, and when. So is every
sign-in the page refused, but without the address that tried. Whoever runs your Ownpace can read
that record.

**Revoke** switches a link off immediately. It stops a sign-in that is already in progress too,
not only future ones — so if you think a link went to the wrong place, revoke it first and ask
questions afterwards. Deleting the person removes their links with them.

Revoking a link does **not** withdraw access somebody already granted. Those are two different
things, held by two different people, and that is the point:

| To stop | Who does it | Where |
|---|---|---|
| a link being used | you | the person's page (a link sent before: the migration's page) |
| access already granted | the person who granted it | their progress page (**Stop copying**, per account), or their provider's settings, under the apps that have access; for a password, changing it at their provider |
| everything, permanently | you | delete the migration |

### When the person takes their access back

The progress page the person gets once they have granted offers **Stop copying** for each
account they connected by signing in, named by its own provider (workplan 0108 T8 (c), workplan
0176). The question has a screen of its own. It says that Ownpace then stops reading that
account, that what is already copied stays where it was copied to, and that nothing is deleted at
the provider. For a Google account it says that Google ends everything they allowed Ownpace, so
all copying from that account stops. And it says that continuing later needs a new link from you.
Two answers of one size, **No, do not stop** first, then **Yes, stop**. Pressing **Yes, stop**:

1. asks Google to revoke the grant, for a Google account. Google takes back everything that
   person allowed the application, at once, so any other migration of the same account through
   the same application stops too; the question says so first. For a Microsoft or a Dropbox
   account Ownpace asks nothing of the provider, so it skips this step;
2. deletes the grant here from every migration of theirs that holds it, **whatever the provider
   answered**, and records it for each;
3. tells them that copying stopped, and the page then says since when; that nothing was deleted
   at the provider, and that what was copied is still at the destination; and which of the two
   happened. When the
   provider did not confirm, they are sent to remove Ownpace from the provider's list of apps
   themselves, with a link to it. Only when it did confirm does the page say they have nothing
   left to do.

A destination's **Remove my password** asks too, in place, with two answers of one size: **Keep
it** first, then **Yes, remove it**.

From then on **nothing reads that account**: no pass starts, a pass already running stops starting
new items within about fifteen seconds and finishes the ones it has begun, and your **Start** and
**Sync now** say who stopped it and when. That holds
even where the source connection has a credential of its own: the person said no to being read,
and falling back to another way in would read them anyway. Your migration's page says it at the
top.

To continue, if they agree, make a new grant link on their page and send it to them. Their new
grant ends the withdrawal. What was already copied stays where it was copied to.

## When Google's side does not finish

The person can press Cancel at Google, untick a permission, or come back after the consent
has gone stale. Google can also refuse this migration's application. None of these reaches
the link, so the page they land on says **their link was not used up** and they can open it
again. It is worded for them, not for you:

| what happened | what they read |
|---|---|
| they pressed Cancel | Permission was not given at Google. |
| they left a permission unticked | Open the link again and leave every permission ticked. |
| the sign-in took too long, or was sent twice | Google did not accept the sign-in when it came back. |
| Google turned down the application | Nothing they can do fixes it; tell the person who sent the link. |
| the account's administrator blocks lasting access | Tell the person who sent the link. |

Only a link that can no longer be used (spent, expired or withdrawn) tells them to ask you for a
fresh one. When Google turned down the application, its exact answer is in the server log,
beside the migration's id. That is where to look before you check the source connection.

At Microsoft the same cases read the same way, with Microsoft's name: *Permission was not given
at Microsoft*, *Microsoft did not accept the sign-in when it came back*, and an organisation's
approval rule in Microsoft's own words. When Microsoft could not be reached while the sign-in was
being checked, nothing is stored and the link is not used up; the page says it is ours to fix.

## "My link says it does not work"

The message a refused link shows is the same for every reason — used already, expired,
withdrawn, or never real. That is on purpose: telling somebody *which* one would also tell
anybody trying links at random which part they got right.

So there is nothing to diagnose from the message, and the answer is always the same: **look at
the list, and issue a fresh one.** The list will show you which of the four it was, and
re-issuing costs a moment. Ask them to open the new link on the device they normally use, and
to press the button rather than only opening the page — opening it does nothing and does not
use it up, which is why a link that was merely previewed is still live.

If the new link fails the same way, the problem is not the link. Check the source connection's
Google application still exists and its client secret has not been rotated — or, where the
connection stores none, the deployment's.

**If Google's page said no, not this one,** and the link was opened inside another app, that
app's own browser is the likely cause: Google is reported to refuse its sign-in there. A fresh
link does not help with that; the same link, opened in the phone's or computer's own browser,
such as Firefox, Safari or Chrome, rather than the one built into the chat or mail app, does.
The page says so on its *Have this ready* step: *If this page opened inside another app, such as a
chat or mail app, use that app's 'Open in browser' option or copy the link into your favorite
browser, such as Firefox, Safari or Chrome. The link still works.*

## Two things this is not

**It is not an invitation.** An invitation asks somebody to *join your organisation* — they end
up with an account, a sign-in and a role. A grant link is the opposite: the person never gets
an account, never signs in to Ownpace, and never appears in your member list. They are being
migrated, not hired.

**It is not a progress page.** A grant link is for one thing — connecting accounts — and it is
spent the moment that is done. Somebody wanting to watch how their migrations are going is a
different question, answered by a separate **progress link**: the page after Google hands them
one, and you can make another on their page, under **One progress link for everything**. It lives
longer and can be revoked, and it shows counts and states — never content, and never the
provider's error text. It is how the person being migrated follows their own migrations without
an account or a place in your member list.

## Links sent before

Before links were made per person, each migration's page made its own. One sent then keeps
working until it expires, so whoever holds it is not left with a link that fails. The
migration's page lists them under **Grant links sent before** and **Progress links sent before**,
with their states, and **Revoke** there stops one sooner. None is made there any more.

A grant made through one is stored as it always was. The page it ends on is the person's
progress page when the migration belongs to somebody, since that is the one page for all of
their migrations; a migration that belongs to nobody hands over its own, as before.

A request to make one at the old address, `POST /api/migrations/{mappingId}/links`, is answered
`409 links_are_per_person`, with the person's id when the migration has one. Nothing is written.
