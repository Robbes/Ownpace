# Bringing an export archive

**Operator and self-host document.** The customer guide is [the export archive guide](guides/en/archive.md), served in the app at `/docs/archive`.

Some of your data cannot be moved by connecting an account, because the company holding it
does not offer any way for another program to read it. **Google Photos** and **iCloud Drive**
are the two that matter most: there is no key you can give us that opens them.

What both companies *do* offer is a copy for **you**. You ask, they prepare a download, and a
few days later you have your photos and files as ordinary files. This page is about getting
that download, pointing us at it, and what happens when you move it.

An export is a **snapshot**. It contains everything up to the day it was prepared and nothing
after, which is worth knowing before you start: take the export when you are ready to move,
not months in advance.

---

## What you will need

Two things, and neither of them is a password:

| | |
|---|---|
| **Which export** | Google Takeout, or Apple Data & Privacy (to be tested: we cannot read it yet). This tells us how to read it — the two are laid out completely differently inside, and there is no way to tell from the files themselves. |
| **Where it is** | The `.zip` you downloaded, or the folder you extracted it into. A download in several parts: any one of the parts, and we read them all. The folder can also be in the Nextcloud you are moving to: see [Your export in your own Nextcloud](#your-export-in-your-own-nextcloud). |

That is the whole connection. We never sign in anywhere on your behalf for this, so there is
no account to link and nothing to revoke afterwards.

---

## Google Takeout

### Asking for it

1. Go to **takeout.google.com** and sign in.
2. Press **Deselect all**, then tick only **Google Photos**. Ticking everything produces a far
   larger download that takes much longer to prepare, and we do not read the rest.
3. Still inside Google Photos, press **All photo albums included** and **untick `Trash`**.
   Photos you deleted are in there, and Google puts them in the export like any other album —
   leave it ticked and they come across to your new home along with everything else. (This
   list is shown in English even when the rest of Takeout is in your language.)
4. Press **Next step**.
5. Choose how it reaches you. **Send it straight to Google Drive, Dropbox, OneDrive or Box if you use one**
   — the file is large, and a cloud delivery avoids downloading and re-uploading tens of
   gigabytes. Otherwise Google emails you a link.
6. Choose **Export once**, unless you are still adding photos and want a series — Google can
   repeat the export **every two months for a year**, which suits somebody moving gradually.
7. Choose a file size. **Pick the largest your connection will manage.** Google makes you
   press a download button once per part, so a 45 GB export at 1 GB a part is forty-six
   presses. Size makes no difference to us — we never hold a part in memory, and we read
   parts above 4 GB the same way as smaller ones. Smaller parts only help if your connection
   drops mid-download.
8. Press **Create export**.

Google then takes anywhere from a few minutes to a few days depending on how much you have.
It emails you when it is ready.

### The link does not last forever

Google's email link is time-limited, and the page tells you how long when you request the
export. If it expires, you have to ask again from the start — so download it when the mail
arrives rather than when you next have time.

### Getting it ready for us

Nothing, usually: point us at the `.zip` as it was downloaded, and we read it where it lies.
If it arrived as several `.zip` files, **keep them together in one folder and point us at any
one of them** — we read them all, and if a part in the middle of the sequence is missing we
say which. A part missing from the *end* of the sequence leaves no gap we can see, so compare
the number of files you have with the number Google's download page lists before you start.

If you would rather extract it, extract every part into the same folder. You should end up
with a folder containing a `Takeout` folder, and inside that one folder per Google service you
exported. **That inner folder is named in your own language** — a Dutch account's is
`Google Foto_s`, not `Google Photos` — so do not worry if it does not match what you expected.
We find the photos by what is in the folders, not by what they are called. Point us at the
outer folder; both ways give exactly the same result.

### What is inside, and what we do with it

Takeout writes each photo once for **every album it is in**, plus once more in a folder for
its year — so a photo in three albums appears four times. We recognise that and carry it
**once**, remembering every album it belonged to.

Beside each photo sits a small file holding what Google knew and the photo itself does not: a
date you corrected by hand, a place you added, a description you typed. We read those and
carry them with the photo.

**Edited photos and motion photos are carried as separate files, on purpose.** When you edit a
photo, Google keeps your original and writes the edited version beside it — and Google Photos
shows you the edited one. If we carried only one of the two, we would keep the version you
never look at and lose the one you think of as your photo. So both travel, linked to each
other. The same goes for the short video in a motion photo: it is a video, and folding it into
the still would throw it away.

**This is why the count we show you is larger than the number Google Photos shows.** Three
thousand photos can arrive as four thousand files. Nothing has been duplicated — the screen
breaks the number down so you can see exactly what the extra ones are.

**Your albums come across; who you shared them with does not.** We carry each album as a folder,
under the name you gave it — even where Google had to change it to write it to disk, because the
album's own details still hold your spelling. What Google does **not** put in the export is the
list of people an album was shared with: it is not in the album's details and not in the report.
So **if you shared albums in Google Photos, note which ones before you delete anything, and
share them again on your new home.** We cannot do it for you, and we would rather say so than
let you find out later. Where the export shows that somebody had been in an album — a comment,
for instance — we flag it, but treat that as a reminder rather than a complete list.

**Photos you deleted do not travel.** Google exports the bin like any other album if you leave
it ticked. We recognise it and leave it behind, and the summary tells you how many were in it,
so a count that looks short has a reason you can read.

---

## Apple Data & Privacy

**To be tested.** We cannot read an Apple export yet. Request one only for your own records.

### Asking for it

1. Go to **privacy.apple.com** and sign in with your Apple Account.
2. Choose **Request a copy of your data**.
3. Tick what you want. For moving files and photos that is **iCloud Drive files and documents**
   and **iCloud Photos**. You can tick more; files and photos are what we will read from it.
4. Choose a maximum file size — Apple offers **1, 2, 5, 10 or 25 GB** parts. Pick larger parts
   unless your connection is unreliable.
5. Confirm. Apple shows a page thanking you and saying your data is being prepared.

Apple says this takes **up to seven days**. In practice it depends on how much you have: one
real request, for a small iCloud Drive, took **five days and six hours** from asking to the
"your data is ready" mail.

### Use the date Apple shows you, not a number of days

Your request page carries an **"Available until"** date. That date is the deadline, it is the
only figure that is definitely right for your own request, and when it passes the copy is
deleted — you then ask again from the start and wait another week.

We used to say "fourteen days" here. It is a figure that circulates widely and **it did not
match the one request we have actually watched**, whose window ran eighteen days from the ask.
So we stopped repeating it: read your own page, write the date down, and set a reminder for a
few days before it.

### Apple's other button, and why it is not this

Apple also offers **"Transfer a copy of your data"**, which sends your photos directly to
Google Photos. That is a different thing: it moves your data from one large company to
another, and it does not help you leave. The download is the route that puts the files in
your hands.

### Getting it ready for us

Extract every part into the same folder. Once we can read an Apple export, that folder is what
you point us at.

### One thing Apple removes

In the contact and calendar information Apple exports, **email addresses are partly hidden**.
This does not affect your files or photos, which are what we will read from an Apple export
once we can.

---

## Pointing us at it

On the **Connections** page, add a connection and choose **Export archive**. Pick which export
it is and type where the folder is. Then press **Test**.

Testing does not move anything. It opens the archive and tells you what is in it:

- how many items,
- how many bytes,
- how many folders or albums,
- and **the range of dates the export covers**, so you can see at a glance whether it is the
  export you think it is.

If we cannot open it, we say so and why — most often because the download is incomplete, or
one part never finished, or a part is missing from the sequence, or the file is a `.tgz`
rather than a `.zip` (we read `.zip`; ask Google for that format, or extract the `.tgz` and
point us at the folder). **We will never tell you an archive is empty when what really
happened is that we could not read it.** Those are different answers and you deserve the true
one.

An export you put in a folder of the files you are moving to is not opened by **Test**: it is
counted at the preflight, once the migration knows where those files are. See
[Your export in your own Nextcloud](#your-export-in-your-own-nextcloud).

---

## Your export in your own Nextcloud

The export does not have to be on a disk. If the files you are moving to are in a Nextcloud, or
on another server that offers your files over WebDAV, you can put the export there and we read
it from that folder.

**There is no need to unpack it.** Upload the `.zip` files exactly as Google or Apple delivered
them, every part into the same folder. We read them where they lie, a few megabytes at a time,
and never change them. If you already unpacked the export into that folder, that works too.

1. Upload the `.zip` parts of the export into **one folder** of the files the migration will
   write to: the same Nextcloud or WebDAV account you will choose as the destination. Use the
   way you always add files, such as the Nextcloud website or its desktop app. Keep every part
   in that one folder.
2. On the source step, choose **Export archive**. Under **Where the export is**, choose
   **In a folder of your destination's files (Nextcloud or WebDAV)**.
3. Type the folder as it appears in your files, from the top, for example
   `Exports/takeout-20260904`. You can also name one `.zip` in it: we read the parts beside it.
4. Press **Test and save connections**. It says the export is counted at the preflight. That
   is expected: the destination is chosen on the target step, and until then there is nowhere
   to look.
5. Continue, and on the target step choose that same Nextcloud or WebDAV account. The
   preflight then counts what is in the export, before anything moves.

**Your photos arrive as ordinary files and folders.** What we write into your files is never a
`.zip`: every album becomes a folder, a photo in no album goes into a folder for its year, such
as `Photos from 2019`, and one file at the top lists everything the export knew about each
photo.

This works with a Nextcloud or a WebDAV destination only. An account that holds no files, or a
JMAP account, cannot hand us the export: JMAP does not let us read a file in pieces, and we
say so on the target step.

**The `.zip` files stay where you put them.** We only read them, so after the migration they
are still in that folder, and they take up as much space in your account as the export itself.
Once you have checked that everything arrived, delete them yourself.

---

## Moving it

Once the test shows what the archive holds, create a migration from it the way you would from
any account: choose **Export archive** as the source, pick the connection you added, choose
where the files should go, and start it. Files and photos are the only kind of data an archive
carries, so that is the only box to tick.

### Where things land

- **Every album becomes a folder**, named as you named it, holding the photos that were in
  it. A photo you put in three albums is written into all three — that is what you expect to
  find when you open them, and it costs only the space.
- **A photo in no album lands in a folder for its year**, such as `Photos from 2019`, because
  that is the only place the export filed it.
- **A photo that is in an album is not also written under its year.** The year folders are
  Google's index of your library, not something you organised, and writing everything twice
  would double your storage for nothing.
- **Edited versions and motion clips sit beside their originals**, as separate files.
- **One file at the top lists everything the export knew** about every photo — the date you
  corrected, the place you added, the description you typed, the albums it was in — because a
  photo file has no place for most of that, and the export's download link expires. Its name
  starts with `export-archive-manifest-`; it is plain text and you can open it.

Nothing is written into the photos themselves yet: a date or place that only Google knew stays
in that file for now.

### Doing it twice

Running the migration again with the same archive **changes nothing**: every file it would
write is already there, and it says so. Pointing a later export at the same place **adds what
is new and touches nothing else** — which is exactly what the every-two-months option is for.

**Nothing is ever removed because an export no longer mentions it.** A photo you deleted in
Google Photos between two exports stays where we put it; so does one that a missing download
part left out of the newer export. An export cannot tell us which of those happened, and we
will not guess with your photos. If you want something gone, delete it where it landed.

---

## What happens to the archive afterwards

Nothing. We only ever read it — the files are never changed, moved or deleted, and we keep no
copy of the archive itself.

Which means it stays on your own disk after the move, and it is worth remembering what it is:
a complete, unencrypted copy of everything the company handed over. Keep it somewhere you
would be happy keeping your photos, or delete it once you are satisfied the move is done.

---

## Questions people ask

**Can you just connect to Google Photos instead?**
No, and neither can anyone else. Google closed the way programs used to read a person's photo
library, so an export is the only complete route. iCloud Drive has never had one at all.

**Do I have to unzip it?**
No. Point us at the `.zip` itself and we read it where it lies; nothing is extracted and
nothing is written beside it. If you already unzipped it, point us at the folder instead —
both give exactly the same result.

**My export came in twelve parts. Is that a problem?**
No. Keep the twelve files together in one folder and point us at any one of them; we read them
all. If one never finished downloading and the sequence has a gap, we say which part is
missing rather than importing eleven twelfths of your photos. A part missing from the end
leaves no gap we can see, so count the files against Google's download page before you start.

**Will this duplicate my photos?**
No. A photo that Takeout wrote four times is carried once. The larger number you see on screen
is edited versions and motion clips, each of which is a genuinely different file, and the
screen says so.

**Can I do it again later with a newer export?**
That is exactly what the every-two-months option is for. A later export overlaps the earlier
one heavily; we add what is new and remove nothing — see *Doing it twice* above.

**Where do the photos end up, exactly?**
In a folder per album, with the photos that were in it; photos in no album in a folder for
their year; and one file at the top listing everything the export knew about each photo. See
*Where things land* above.
