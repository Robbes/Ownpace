# How a migration works

Five steps, and you decide when each one happens. Nothing is on a clock but you.

## 1. See what you have, before you connect anything {#step-1}

[Tell us roughly what you are moving](./estimate.html) and we show you what it would cost. No account, no
email address, no sales call. If the number is wrong for you, that is the end of it and
you have lost nothing.

## 2. Connect your old account and your new home {#step-2}

Your new home is an account you open with a European provider you choose, and pay them for.
*Where to*, on the home page, names the ones Ownpace moves into. You give Ownpace access to
it, to put your data there, and to the account you are leaving, to read it.

From the account you are leaving, Ownpace only reads: the software has no code that changes, moves or deletes anything at a source, and a test in the
public code checks that for every source. The permission you give can allow more than
Ownpace uses. For Google Drive, Google Tasks and *Connect with Microsoft*, the permission
itself is read-only as well. For Gmail, the calendars and contacts of a Google account,
Microsoft 365 over IMAP, and any account you connect with a password, the permission also
allows changes; there the guarantee is the software's. For Google, the app says so beside
the button, before you connect.

You can withdraw that access at your provider at any time, without asking us, and the
migration stops.

## 3. We copy, and then we keep copying {#step-3}

The first pass moves everything. After that, every change on the old account — new mail,
a moved file, an edited contact — arrives on the new one, until you switch over. Keep copying
after that, and only new items keep arriving.

This is the part most tools do not do. A one-shot copy means the copy starts going stale
the moment it finishes, which is why one-shot migrations happen over a weekend and feel
like a deadline. Ownpace has no deadline, because the copy never goes stale.

Run it again and nothing duplicates. Every item is recorded by an identifier its own
provider gave it, so a second pass recognises what it already moved. Interrupt it, restart
it, leave it for a month — it picks up where it left off.

## 4. Check everything at your own pace {#step-4}

Both accounts work. Use the new one for real mail while the old one keeps receiving. Look
in the folders you care about. Find the one message you were worried about.

Anything that could not be moved is listed for you, item by item, with the reason. Formats
differ between providers and some things genuinely do not survive the crossing — the
difference is whether it is clearly reported to you.

## 5. Switch when you are ready {#step-5}

You say when. At that point the migration finishes, and your old account is still sitting
there, untouched, for as long as you keep it.

Switching means pointing your apps at the new provider instead of the old one: your mail
app, the calendars and contacts on your phone, and the app that syncs your files. If your
address is on a domain of your own, you also change where that domain's mail is delivered,
in its DNS settings, so new mail goes straight to your new home.

**Does my email address change?** Not if it is on a domain of your own. It comes with you,
the way your number does when you switch phone provider: you point the domain at your new
home, as above. An address that belongs to your old provider, such as one ending in
@gmail.com or @outlook.com, stays with them, so at your new home you use a new one. Tell
people the new address. Until you switch, what still arrives at the old one is copied across,
and most providers can forward it after that.

**What you use afterwards.** Your new provider says which apps work with it, and the apps you
have may well do. An iPhone, iPad or Mac takes the new account into its own Mail, Calendar and
Contacts. Apps built on the open standards European providers use work with almost all of
them: Thunderbird for mail, calendars and contacts on a computer, DAVx⁵ for calendars and
contacts on Android, and the Nextcloud apps for files in a Nextcloud.
