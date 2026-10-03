# Grant links — letting somebody connect their own account

A grant link lets the person whose account is being migrated give access to it **themselves**,
without an Ownpace account and without ever sending anybody their password.

It exists because the alternative is worse in a specific way. Migrating a colleague's mailbox
needs a credential for that mailbox, and the two obvious ways to get one are both bad: asking
for their password, or sitting beside them while they sign in and copying a token out of a
browser. Both put one person's private credential through another person's hands. A link
removes the middle: they sign in on Google's own page, and what comes back is stored against
their migrations that read that account, encrypted, never shown to anyone.

**You send the link. We never do.** Ownpace does not email it, does not store the recipient's
address, and does not know who you sent it to. That is deliberate: an address we never learn is
an address we cannot leak, and you already know who the person is.

**One link per person.** A link is made for a person, not for a migration: one grant link for all
of their migrations, which asks each Google account of theirs once, and one progress link where
they follow all of them (ADR-0035, amended 2026-09-29). A migration's page makes no link of its
own any more (the owner, 2026-10-03). A migration's link sent before then keeps working until it
expires: see [Links sent before](#links-sent-before).

## Issuing one

On the person's page (open them from **Migrations**), in the section with their name (**For
Anna**, say), under **One grant link for everything**:

1. Choose how long the link should work — **1 day**, **7 days** or **30 days**. Seven is
   pre-filled. Pick the shortest one that gives the person a fair chance to get to it.
2. Press **Create grant link**.
3. Copy the link and send it, however you normally reach that person.

*Start a migration* offers the same link on its last screen when the person connects their own
accounts (**They do, with a link**). It is one link either way, however many migrations it
serves. You can press **Start** there once one count is in: the migrations still waiting for the
link start by themselves when the person connects (see [When the grant lands](#when-the-grant-lands)).

**When every account of theirs is connected already**, the new link asks each of them to connect
again, and the screen says so. Make one when a connection has stopped working: the person took
the access back at Google, or it lapsed, or it expired, as Google's access does after seven days
while a Google application is still in testing. Their page then offers each account **Connect
again with Google as** *that account*, and the link is spent once each has been connected through
it.

**A migration that belongs to nobody**, made before people were or by hand, is given a person
first. On the migration's page, under **Links**, answer **Who is this for?**: choose somebody,
or **Someone new** with their name, and press **Save**. The section then points to their page,
where the link is made.

**If they open it inside another app.** A link tapped in a chat or mail app opens in that app's
own browser, and Google is reported to refuse its sign-in there. The page says what to do,
above its button: *If this page opened inside another app, such as a chat or mail app, use
that app's 'Open in browser' option or copy the link into Safari or Chrome. The link still
works.* It does: opening a link spends nothing, so opening it again in Safari or Chrome is
safe.

**Worth doing once:** give your organisation a phone number, under **Team & organization →
Organization → Phone number**. It is optional. When it is set, the page the other person opens
shows it beside your address, and a number they can call is the quickest way for them to check
the link really came from you.

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
| The source is not a Google account | Grant links cover a Google account, Gmail, Google Calendar, Google Contacts and Google Drive today. For other sources, the credential still comes to you by hand. |
| The migration names no account | A grant is only accepted from the Google account the migration reads (see below), so a migration that names none cannot be granted. The account is set when a migration is created: create it again with the account's address. |
| The migration has no destination yet | Set the destination first. The person you ask is shown where their data will go before they agree, so a link needs one to name. |
| The migration copies no data types | Include at least one. A link for a Google account asks for exactly the data types the migration copies, so with none there is nothing to ask. |
| No client id or client secret is stored, and the deployment has no Google client | Add them on the source connection — see [Google Workspace setup](./google-workspace-setup.md), step 3 — or ask whoever runs your Ownpace to set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. Your own client, when you store one, is always the one used. Half a pair is refused rather than finished with the deployment's other half. |
| Mail and files need scopes Google classes as restricted | Through the deployment's own Google client, a link asks for Gmail or Drive only where whoever runs your Ownpace has declared `GOOGLE_ACCOUNT_SCOPE_CLASS=restricted`, once their application carries those scopes. Or add your own Google client on the source connection. Calendars, contacts and tasks need neither. |
| `WEB_URL` is not set | A deployment setting. Whoever runs your Ownpace needs to set it and restart; a link built without it would point at the wrong machine. |
| Your organisation already holds as many grant links as it may | Revoke one that is no longer needed, or wait until one is used or expires (see below). |

### How many at once

On the managed service, an organisation may hold as many grant links that can still be used as
its tier runs migrations at the same time: Tiny 1, Small 4, Medium 20, Large 50, Extra large
200. The tier is the one your usage screen shows, so an organisation running more migrations
gets more links as it grows. Only live links count: a link that was used, revoked or has expired
does not, and a progress link never does, since it grants nothing. A person's link counts once,
whatever it covers, and a migration's link sent before counts while it is live. When you need more at once,
for an onboarding week say, ask us: we can set another number for your organisation, until a
date or for good.

## What the other person sees

The page says who is asking once, then shows a card for each Google account their migrations
read. Before any button, it tells them:

- **who is asking** — your organisation, by name, and the address **you** sign in to Ownpace
  with, so they know which person is asking and not only which organisation. If your
  organisation has a phone number set, they see that too, so they can call and check it is
  really you. And if your invoice details carry a business VAT number that the EU VAT register
  (VIES) confirmed, they see your company's name as the register gives it: the one name on the
  page nobody typed for it;
- **from which account, and to where** — the account each card is for, and where each of its
  migrations goes: which kind of server, where it is, and the account on it. Then one question:
  *do you know who asked, and is the destination yours or your organisation's? Only then
  continue.* This
  is what lets somebody tell your migration from a stranger's, because everything else they
  see is genuine either way — this page, and Google's own;
- **what will be read** — their mail, calendars, contacts, tasks or files, in plain words: exactly
  the data types each migration copies;
- **that Ownpace only reads** — nothing is ever deleted or changed in their account, and nobody
  sees their password, because they sign in on Google's own page. For mail, calendars and
  contacts it also says that Google may describe the permission more broadly, because the
  permission Ownpace asks for there also allows changes, and Google's own screen says so;
  Ownpace makes none;
- **"read-only" only where Google enforces it**: for a link that asks only for Google Drive,
  Google Tasks or both, whose permissions Google holds to reading, the box says *Read-only*
  instead. That is said of what the link asks for. Google also adds to the grant any permission
  the same Google account already gave the same app, which may allow changes, so the page after
  Google says which it was (below);
- **the exact permission** Google will record, so they can find it again in their own account;
- **how long the link works**;
- **which account to sign in with**: the one the card names, and that any other is refused;
- the privacy policy and terms, before they go anywhere.

Then a button on each card, **Continue with Google as** *that account*. When they press it they
go to Google, sign in, and land back on a page that says it is done. **That page contains no
token and asks nothing else of them.** They can close it and get on with their day. A card whose
account is connected already says **Connected** instead, and the link is spent once every account
on it is. On a link made to ask again, a connected account's card says it was connected before
and offers **Connect again with Google as** *that account*. A card that cannot be asked, such as
one whose migrations run through two different Google applications, says why instead of offering
the button, in words they can pass on to you.

A migration a link cannot serve, such as one reading a Microsoft account, is left off the page:
its credential still comes to you by hand.

That page judges the permission Google actually recorded, not the one the link asked for. It
calls the access read-only only when every permission Google recorded is the read-only one for
Google Drive or Google Tasks. Otherwise it says that Ownpace only reads and that the permission
also allows changes. When the link asked only for Drive or Tasks and Google's answer carries
more, because the same account had already given the same app a broader permission, the page
says that too.

**In English or Dutch, as they choose** (workplan 0145 T6). The page opens in their browser's
language and has two buttons, EN and NL, in its top corner; the progress page has the same two.
What will be read, the refusals of the link and of the migration, and the page after Google are
in that language. Taking the access back and reporting the link still answer in English for now
(workplan 0145 T6). The page after Google follows the language the grant page was in when they
pressed the button. It asks them to keep their progress link, by a bookmark or a copy, because a
page opened inside another app may not keep a bookmark.

### Only the account the page names

The account a card names is a condition, not a label. Google tells Ownpace which account signed
in, and access is accepted only from that one. So a link forwarded to
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
domain the address must match exactly, apart from capitals. If the migration names an **alias**
of the account, sign-in is refused, and the page shows the account's own address. A
migration's account cannot be changed afterwards, so create it again with that address.

### If they doubt it

Under that question, the page offers **Report this link** (workplan 0108 T8 (d)). A report goes to
whoever runs your Ownpace, **not to you**: what the person wrote, an address to reply to if they
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
- **Started**: one of their migrations is running. Each migration of theirs that was waiting for
  this grant starts by itself, ones you added later included. The record of it names the grant,
  not you.
- **Paused**: a move you paused stays paused, and so does a migration you paused after it ran.

The person's page says which applies beside each migration of theirs that waits for the grant:
*Waits for Anna to connect, then starts by itself*; *Waits for Anna to connect. Once they have,
open Details to review and start it*; or, for one that ran before and lost its connection, *Waits
for Anna to connect again*. Pressing **Start** on such a migration says it too.

## Managing them afterwards

The list under **One grant link for everything**, on the person's page, shows every link made for
them and what became of it:

- **Live** — it works, and nobody has used it yet.
- **Granted** — every account it asked for was connected with it. It is spent and cannot be used
  again.
- **Revoked** — you switched it off.
- **Expired unused** — it ran out before anybody got to it. This is the one to act on: somebody
  was asked and never managed to answer. Issue another and send it again.

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
| access already granted | the person who granted it | their progress page (**Withdraw access**, per Google account), or their Google account's security settings, under the apps that have access |
| everything, permanently | you | delete the migration |

### When the person takes their access back

The progress page the person gets once they have granted offers **Withdraw access** for each
Google account, with one question before it acts (workplan 0108 T8 (c)). Pressing it:

1. asks Google to revoke the grant. Google takes back everything that person allowed the
   application, at once, so any other migration of the same account through the same application
   stops too; the page says so before the button;
2. deletes the grant here from every migration of theirs that holds it, **whatever Google
   answered**, and records it for each;
3. tells them which of the two happened. When Google did not confirm, they are sent to remove the
   app from their Google account themselves.

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
link does not help with that; the same link, opened in a real browser, does. The page says so,
above its button: *If this page opened inside another app, such as a chat or mail app, use
that app's 'Open in browser' option or copy the link into Safari or Chrome. The link still
works.*

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
