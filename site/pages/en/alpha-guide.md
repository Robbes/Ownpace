<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!-- English translation of the tester guide (workplan 0144 T1); the Dutch,
     alfa-handleiding.md, is written first and is the one the owner reads
     (0144 T0). Keep the six section headings and their ids ({#...}) in step
     with it, and the two ### headings' ids too, and translate the Dutch,
     never the other way round. Its notes for the owner, what was left out
     and why, and why the target folder is promised for files only on WebDAV
     or Nextcloud, are in the Dutch file's comment and apply here too. -->

# Guide to the alpha

This page is for the people invited to the Ownpace alpha. Read it before you start.

This guide is not a contract. What applies is in the [Alpha conditions](./alpha.html). Where this
page says something different, the conditions apply.

## What the alpha is {#what-the-alpha-is}

Ownpace copies your mail, calendar, contacts and files from your old provider to your new one.
In the app this is called a migration. We run the service for you.

The alpha is a trial of that service. A small group takes part, and everyone was invited
personally. The alpha lasts a few weeks.

- **Free.** Nothing is charged.
- **Households only.** You take part with your own accounts or your family's.
- **No obligations, on either side.** You may stop at any time. We may stop the alpha or start it
  over. We tell you at least 7 days in advance by email. The service may falter.
- **No backups.** Only right before an update do we make one copy. If the service's records are
  lost, you connect your accounts again and set up your migrations again. What is already at
  your new provider stays there.
- **After the alpha** the service carries on, under new conditions.

## Before you start {#before-you-start}

- **Google addresses first.** Do you want to connect a Google account? Then first mail every
  Google address to [support@ownpace.eu](mailto:support@ownpace.eu), a family member's too. Wait
  for our answer. We add the address to the list of test users at Google. Without that step,
  Google does not allow the connection.
- **Keep your old account until you have checked what arrived.** Ownpace only reads from your old
  account. It changes and deletes nothing there.
- **Start with an empty destination.** That is the easiest: a new, empty mailbox, calendar,
  address book and folder at your new provider. Why? Is something already at your new provider
  that is also in your old account? Then Ownpace leaves it alone. If it later changes in your old
  account, Ownpace does not carry that change over. If a message is already in another folder at
  your new provider, it may arrive twice.
- **Is your destination not empty?** Then choose a target folder. Your mail then goes under that
  folder. You do not do this through step 5 below, but under *Migrations* with *Add one
  migration by hand*. Fill in *Target folder (optional)* there. For files, a target folder only
  works with the destination *WebDAV* or *Nextcloud*. Unsure? Ask us first.
- **Open links in a browser** such as Safari or Chrome, not in a chat or mail app. If a link opens
  in such an app anyway, choose *Open in browser* there.
- **Deletions are off.** Do you delete something in your old account? Then the copy at your new
  provider stays. Do you want that copy to go too? Then open the migration's *Deletions* page.
  Choose *Turn on deleting by hand*, and confirm. After that you choose per deletion: *Delete it
  here too* or *Keep our copy*. Ownpace only deletes a copy it wrote itself. Was a file, calendar
  entry or contact changed at your new provider? Then it does not delete it. With mail it does
  not check that. Once deleting by hand is on, you see a second button, also off by default:
  *Turn on automatic removal*. It clears up the old copy of a file you moved in your old account.
  You then do not choose per file.

## How to start {#how-to-start}

1. Ask for access on the [Request access]([[REQUEST_ACCESS]]) page, with the email address you
   want to sign in with.
2. We get your access ready, and you receive the email *Ownpace — your access is ready*.
3. Go to the address after *Sign in here* in that email. Sign in there with the same email
   address. No account yet? Create one, and confirm the confirmation email.
4. Accept the Alpha conditions, the [privacy policy](./privacy.html) and the
   [terms of service](./terms.html), with *Accept all three*.
5. Under *Migrations*, choose *Start a migration*. The app asks step by step what goes and where,
   and connects your accounts. Connecting a Google account? Only do that once we have told you
   your address is on the list.
6. Read the last screen, *Check, then start*. Nothing is copied before you press *Start*.
7. Has everything been copied once? Then choose *Check* on the migration, then *Run the check*.
   It compares old with new, and changes nothing on either side.

### When you connect Google {#google-connect}

Google first shows a warning that Google has not checked the app. That is expected during the
alpha. Go on to Ownpace there. Make sure everything Ownpace asks for is ticked.

### When Google asks again {#google-again}

While Ownpace's app at Google is in Google's test phase, a Google connection stops after about
seven days. Then go to *Accounts*. On that account, choose *Reconnect*, then *Connect with
Google*, and then *Check and replace*. The migration carries on where it stopped. Nothing is
lost.

## What is experimental {#what-is-experimental}

Some sources and data types carry the label *Experimental* in the app. It means: built, but not
yet run against a real account of that kind. With such a source, be sure to keep your old account,
and check what arrives. Unsure? Ask us before you connect.

## Help {#help}

We help you personally.

- **In the app.** Is *Report a problem* in the menu? Then use it. We answer by email.
- **By email.** Write to [support@ownpace.eu](mailto:support@ownpace.eu), also when you have not
  signed in yet.
- **What to tell us.** Name the page, what you did, and the version number at the bottom of the
  menu or the page.
- **Never send** a password or any other sign-in code, or the contents of your mail or files.
- **Not through GitHub.** Do not report a problem there. GitHub is for developers, and anyone can
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
