# Grant links — letting somebody connect their own account

A grant link lets the person whose account is being migrated give access to it **themselves**,
without an Ownpace account and without ever sending anybody their password.

It exists because the alternative is worse in a specific way. Migrating a colleague's mailbox
needs a credential for that mailbox, and the two obvious ways to get one are both bad: asking
for their password, or sitting beside them while they sign in and copying a token out of a
browser. Both put one person's private credential through another person's hands. A link
removes the middle: they sign in on Google's own page, and what comes back is stored against
that one migration, encrypted, never shown to anyone.

**You send the link. We never do.** Ownpace does not email it, does not store the recipient's
address, and does not know who you sent it to. That is deliberate: an address we never learn is
an address we cannot leak, and you already know who the person is.

## Issuing one

On the migration's page, under **Grant links**:

1. Choose how long the link should work — **1 day**, **7 days** or **30 days**. Seven is
   pre-filled. Pick the shortest one that gives the person a fair chance to get to it.
2. Press **Create grant link**.
3. Copy the link and send it, however you normally reach that person.

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
Each refusal names what to fix:

| It says | What to do |
|---|---|
| The migration has no source connection yet | Finish setting up the source first. |
| The source is not a Google account | Grant links cover a Google account, Gmail, Google Calendar, Google Contacts and Google Drive today. For other sources, the credential still comes to you by hand. |
| The migration names no account | A grant is only accepted from the Google account the migration reads (see below), so a migration that names none cannot be granted. The account is set when a migration is created: create it again with the account's address. |
| The migration has no destination yet | Set the destination first. The person you ask is shown where their data will go before they agree, so a link needs one to name. |
| The migration copies no data types | Include at least one. A link for a Google account asks for exactly the data types the migration copies, so with none there is nothing to ask. |
| No client id or client secret is stored, and the deployment has no Google client | Add them on the source connection — see [Google Workspace setup](./google-workspace-setup.md), step 3 — or ask whoever runs your Ownpace to set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. Your own client, when you store one, is always the one used. Half a pair is refused rather than finished with the deployment's other half. |
| Mail and files need scopes Google classes as restricted | Through the deployment's own Google client, a link asks for Gmail or Drive only where whoever runs your Ownpace has declared `GOOGLE_ACCOUNT_SCOPE_CLASS=restricted`, once their application carries those scopes. Or add your own Google client on the source connection. Calendars, contacts and tasks need neither. |
| `WEB_URL` is not set | A deployment setting. Whoever runs your Ownpace needs to set it and restart; a link built without it would point at the wrong machine. |

## What the other person sees

Before any button, the page tells them:

- **who is asking** — your organisation, by name, and the address **you** sign in to Ownpace
  with, so they know which person is asking and not only which organisation. If your
  organisation has a phone number set, they see that too, so they can call and check it is
  really you. And if your invoice details carry a business VAT number that the EU VAT register
  (VIES) confirmed, they see your company's name as the register gives it: the one name on the
  page nobody typed for it;
- **from which account, and to where** — the account the migration reads, and its destination:
  which kind of server, where it is, and the account on it. Then one question: *do you know
  who asked, and is the destination yours or your organisation's? Only then continue.* This
  is what lets somebody tell your migration from a stranger's, because everything else they
  see is genuine either way — this page, and Google's own;
- **what will be read** — their mail, calendars, contacts, tasks or files, in plain words; for a
  Google account, exactly the data types the migration copies;
- **that it is read-only** — nothing is ever deleted or changed in their account, and nobody
  sees their password, because they sign in on Google's own page;
- **the exact permission** Google will record, so they can find it again in their own account;
- **how long the link works**;
- **which account to sign in with**: the one the migration reads, and that any other is refused;
- the privacy policy and terms, before they go anywhere.

Then one button. When they press it they go to Google, sign in, and land back on a page that
says it is done. **That page contains no token and asks nothing else of them.** They can close
it and get on with their day.

### Only the account the page names

The account the page shows under **From** is a condition, not a label. Google tells Ownpace
which account signed in, and access is accepted only from that one. So a link forwarded to
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

## Managing them afterwards

The list under **Grant links** shows every link for the migration and what became of it:

- **Live** — it works, and nobody has used it yet.
- **Granted** — somebody connected the account with it. It is spent and cannot be used again.
- **Revoked** — you switched it off.
- **Expired unused** — it ran out before anybody got to it. This is the one to act on: somebody
  was asked and never managed to answer. Issue another and send it again.

Every grant is recorded: which link, which account, which destination, and when. So is every
sign-in the page refused, but without the address that tried. Whoever runs your Ownpace can read
that record.

**Revoke** switches a link off immediately. It stops a sign-in that is already in progress too,
not only future ones — so if you think a link went to the wrong place, revoke it first and ask
questions afterwards. Deleting the migration removes its links with it.

Revoking a link does **not** withdraw access somebody already granted. Those are two different
things, held by two different people, and that is the point:

| To stop | Who does it | Where |
|---|---|---|
| a link being used | you | the migration's Grant links list |
| access already granted | the person who granted it | their progress page (**Withdraw access**), or their Google account's security settings, under the apps that have access |
| everything, permanently | you | delete the migration |

### When the person takes their access back

The progress page the person gets once they have granted offers **Withdraw access**, with one
question before it acts (workplan 0108 T8 (c)). Pressing it:

1. asks Google to revoke the grant. Google takes back everything that person allowed the
   application, at once, so any other migration of the same account through the same application
   stops too; the page says so before the button;
2. deletes the grant here, **whatever Google answered**, and records it;
3. tells them which of the two happened. When Google did not confirm, they are sent to remove the
   app from their Google account themselves.

From then on **nothing reads that account**: no pass starts, a pass already running stops before
its next data type, and your **Start** and **Sync now** say who stopped it and when. That holds
even where the source connection has a credential of its own: the person said no to being read,
and falling back to another way in would read them anyway. Your migration's page says it at the
top.

To continue, if they agree, create a new grant link and send it to them. Their new grant ends the
withdrawal. What was already copied stays where it was copied to.

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

## Two things this is not

**It is not an invitation.** An invitation asks somebody to *join your organisation* — they end
up with an account, a sign-in and a role. A grant link is the opposite: the person never gets
an account, never signs in to Ownpace, and never appears in your member list. They are being
migrated, not hired.

**It is not a progress page.** A grant link is for one thing — connecting an account — and it is
spent the moment that happens. Somebody wanting to watch how their migration is going is a
different question, answered by a separate **view link**, issued from the same links panel on the
migration's page. It lives longer and can be revoked, and it shows counts and states — never
content, and never the provider's error text. It is how the person being migrated follows their
own migration without an account or a place in your member list.
