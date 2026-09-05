# Bringing an export archive

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
| **Which export** | Google Takeout, or Apple Data & Privacy. This tells us how to read it — the two are laid out completely differently inside, and there is no way to tell from the files themselves. |
| **Where it is** | The folder you extracted the download into. Not the `.zip` file itself. |

That is the whole connection. We never sign in anywhere on your behalf for this, so there is
no account to link and nothing to revoke afterwards.

---

## Google Takeout

### Asking for it

1. Go to **takeout.google.com** and sign in.
2. Press **Deselect all**, then tick only **Google Photos**. Ticking everything produces a far
   larger download that takes much longer to prepare, and we do not read the rest.
3. Press **Next step**.
4. Choose how it reaches you. **Send it straight to Google Drive, Dropbox, OneDrive or Box if
   you use one** — the file is large, and a cloud delivery avoids downloading and re-uploading
   tens of gigabytes. Otherwise Google emails you a link.
5. Choose **Export once**, unless you are still adding photos and want a series — Google can
   repeat the export **every two months for a year**, which suits somebody moving gradually.
6. Choose a file size. Larger parts mean fewer files to keep track of; smaller parts are
   easier if your connection drops.
7. Press **Create export**.

Google then takes anywhere from a few minutes to a few days depending on how much you have.
It emails you when it is ready.

### The link does not last forever

Google's email link is time-limited, and the page tells you how long when you request the
export. If it expires, you have to ask again from the start — so download it when the mail
arrives rather than when you next have time.

### Getting it ready for us

If it arrived as several `.zip` files, **extract them all into the same folder**. You should
end up with a folder containing a `Takeout` folder, and inside that a `Google Photos` folder.
That outer folder is the one to point us at.

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

---

## Apple Data & Privacy

### Asking for it

1. Go to **privacy.apple.com** and sign in with your Apple Account.
2. Choose **Request a copy of your data**.
3. Tick what you want. For moving files and photos that is **iCloud Drive files and documents**
   and **iCloud Photos**. You can tick more; we read files and photos from it.
4. Choose a maximum file size — Apple offers **1, 2, 5, 10 or 25 GB** parts. Pick larger parts
   unless your connection is unreliable.
5. Confirm. Apple shows a page thanking you and saying your data is being prepared.

Apple says this takes **up to seven days**. In practice it depends on how much you have.

### You get fourteen days to download it

Once Apple tells you the copy is ready, **the download stays available for fourteen days** and
then it is deleted. That is a firm deadline, and if you miss it you request the whole thing
again and wait another week.

Set a reminder when you make the request. It is the single most common way this goes wrong.

### Apple's other button, and why it is not this

Apple also offers **"Transfer a copy of your data"**, which sends your photos directly to
Google Photos. That is a different thing: it moves your data from one large company to
another, and it does not help you leave. The download is the route that puts the files in
your hands.

### Getting it ready for us

Extract every part into the same folder, and point us at that folder.

### One thing Apple removes

In the contact and calendar information Apple exports, **email addresses are partly hidden**.
This does not affect your files or photos, which is what we read from an Apple export.

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
one part never finished, or the folder given is the `.zip` rather than what was extracted from
it. **We will never tell you an archive is empty when what really happened is that we could
not read it.** Those are different answers and you deserve the true one.

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
Yes, for now. Point us at the extracted folder rather than the `.zip`.

**My export came in twelve parts. Is that a problem?**
No, as long as you extract them all into the same folder before pointing us at it. A missing
part is the usual reason an archive will not open, and we name that as the likely cause.

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
