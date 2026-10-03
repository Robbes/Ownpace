<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!-- English translation of the tester guide (workplan 0144 T1); the Dutch,
     alfa-handleiding.md, is written first and is the one the owner reads
     (0144 T0). Keep the six section headings and their ids ({#...}) in step
     with it, and translate the Dutch, never the other way round. Its notes
     for the owner, what was left out and why, are in the Dutch file's
     comment and apply here too. -->

# Guide to the alpha

This page is for the people invited to the Ownpace alpha. Read it before you start.

This guide is not a contract. What applies is in the [Alpha conditions](./alpha.html). Where this
page says something different, the conditions apply.

## What the alpha is {#what-the-alpha-is}

The alpha is a trial of the Ownpace managed service. A small group takes part, and everyone was
invited personally. The alpha lasts a few weeks.

- **Free.** Nothing is charged. You get no invoice.
- **Households only.** You take part as a private individual, with your own accounts or your
  family's.
- **No obligations, on either side.** You may stop at any time. We may stop the alpha or start it
  over, and tell you at least 7 days in advance by email. The service may falter, and an update
  can pause your migrations for a short while.
- **No backups.** Only right before each update do we make one copy, which we keep for at most 7
  days. If the service's records are lost, you connect your accounts again and set up your
  migrations again. What is already at your new provider stays there.
- **After the alpha** the service carries on, under new conditions. You get them by email at
  least 7 days in advance, and you accept them in the app. If you have not accepted them when they
  take effect, we close your account.

## Before you start {#before-you-start}

- **Keep your old account until you have checked what arrived.** Ownpace only reads from your old
  account. It changes and deletes nothing there.
- **Start with an empty destination:** a new, empty mailbox, calendar, address book and folder.
  What is already there and matches your old account, Ownpace leaves as it is, even when it later
  changes in your old account. With mail, a message that is in another folder there may arrive
  twice.
- **Or choose a target folder** for mail and files. You do that under *Migrations*, with *Add one
  migration by hand*, in the field *Target folder (optional)*. Everything then goes under that
  folder.
- **Google addresses first.** Send us every Google address you want to connect, a family
  member's too, and wait for our answer. We add it to the list of test users at Google. Without
  that step, Google does not allow the connection.
- **Open links in a browser** such as Safari or Chrome, not in a chat or mail app. If a link opens
  in such an app anyway, choose *Open in browser* there.
- **Deletions are off.** Ownpace deletes nothing at your new provider until you choose *Turn on
  applying deletions* on a migration's *Deletions* page. After that you choose per deletion:
  *Delete it here too* or *Keep our copy*. Ownpace only deletes a copy it wrote itself. A file,
  calendar entry or contact that was changed at your new provider, it does not delete. With mail
  it does not check that. A second switch clears up moved files, with no choice per item.

## How to start {#how-to-start}

1. Ask for access on the [Request access]([[REQUEST_ACCESS]]) page, with the email address you want to sign in
   with.
2. We get your access ready, and you receive the email *Ownpace — your access is ready*.
3. Sign in through the link in that email, with the same address. No account yet? Create one,
   and confirm the confirmation email.
4. Accept the Alpha conditions, the [privacy policy](./privacy.html) and the
   [terms of service](./terms.html), with *Accept all three*.
5. Under *Migrations*, choose *Start a migration*. The app asks step by step what goes and where,
   and connects your accounts.
6. Read the last screen, *Check, then start*. Nothing is copied before you press *Start*.
7. After the first pass: choose *Check* on the migration, then *Run the check*. It compares old
   with new, and changes nothing on either side.

**Google asks again.** While Ownpace's app at Google is in Google's test phase, a Google
connection stops after about seven days. Then go to *Accounts*. On that account, choose
*Reconnect*, then *Connect with Google*, and then *Check and replace*. The migration carries on
where it stopped. Nothing is lost.

## What is experimental {#what-is-experimental}

Some sources and data types carry the label *Experimental* in the app. It means: built, but not
yet run against a real account of that kind. With such a source, be sure to keep your old account,
and check what arrives. Unsure? Ask us before you connect.

## Help {#help}

We help you personally.

- **In the app.** Is *Report a problem* in the menu? Then use it. The app itself sends which page
  you were on and which version you use. We answer by email.
- **By email.** Write to [support@ownpace.eu](mailto:support@ownpace.eu), also when you have not
  signed in yet.
- **What to tell us.** Name the page, what you did, and the version number at the bottom of the
  menu or the page, such as *v0.2.0-alpha.1 · abc1234*.
- **Never send** a password, a token or the contents of your mail or files.
- **Not through GitHub.** Do not open an issue there. GitHub is for developers, and anyone can
  read it.
- **Setup guides** for each provider are in the app under *Help*.

## Stopping {#stopping}

You may stop at any time.

- **Ask us to close your account,** by email or with *Report a problem*. There is no button for it
  yet. Choose when your data is erased: at once, or after 7, 30 or 90 days. We close your account
  within 7 days, and tell you the date on which your data will be erased.
- **What stays.** The copies at your new provider, and your old account.
- **What you withdraw yourself.** Access you created yourself at a provider, such as an app
  password or the permission at Microsoft or Dropbox. We tell you which.
- **What we erase.** Your Ownpace sign-in account and your request for access. We take your Google
  address, and any family member's, off the list of test users.
