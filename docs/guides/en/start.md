# How a migration copies

Every migration copies in the same order, whatever it reads from: the last 90 days first, then everything older. You can also make a migration of only the last 90 days, to try destinations with your current data, and copy everything later.

## The last 90 days first {#last-90-days-first}

The first copy of mail, files and calendars comes in two parts:

1. **The last 90 days.** Mail received in the last 90 days, starting with the inbox, then sent mail, then the other folders. Files changed in the last 90 days. Calendar events that end in the last 90 days or later, which includes every upcoming one; a repeating event comes whole, with all its changes, when any of its dates falls in that time.
2. **Everything older.** Then the rest, in the same folders. What the first part copied is recognised and not copied a second time.

**Contacts** and **tasks** are copied whole, at once: they are small, and you need them whole.

This is how every migration copies. It is not a setting, and nothing has to be chosen for it.

On the migration's page, the line under its name says how far it is:

- **Copying your last 90 days first.** The first part is still running.
- **Your last 90 days are in. Older items are still coming.** The first part is done, for mail, files and calendars, and the older items are on their way. A folder that looks half full at the destination is one whose older items have not arrived yet.

Mail arrives in the new mailbox newest first. Each message keeps its own date, so your mail program sorts it as it was.

## Only the last 90 days {#last-90-days-only}

On **What moves?**, under **How much?**, choose **Only the last 90 days**. The migration then copies:

- mail, files and calendars of the last 90 days, as in the first part above;
- every contact and every task.

It is meant for trying destinations with your current data before you decide. Make one such migration for each destination you want to try: each copies the same 90 days to its own destination.

- **Nothing older is deleted or changed**, at the source or at the destination. An item older than 90 days is left where it is, and never counted as deleted.
- **The 90 days are counted from the day you made the migration.** The window grows from there as new mail and changes arrive; it never moves on. What was copied stays copied.
- **The migration page shows a chip, Last 90 days**, beside its stage. Once the 90 days are in, its stage reads **Kept in step**, and the line under it **Kept in step for the last 90 days.**
- **A deletion in a calendar.** While a migration copies only the last 90 days, an event deleted at a calendar server reaches **Deletions** only when it is in the source's bin. After **Copy everything**, deletions are reported as for any migration.
- **No switch-over.** A migration of only the last 90 days is not switched over: on its page, **Finish** reads **After Copy everything**. Switching over is for a migration that has copied everything.

## Copy everything {#copy-everything}

When you have chosen a destination, open that migration's page and press **Copy everything**. It asks once: **Copy everything older too? What is there stays.** Press **Copy everything** again to go ahead.

- The migration does not start over. Its next pass copies the older items; what is already at the destination stays as it is, and nothing is copied twice.
- Then it goes on as any migration of everything: kept in step, checked, and switched over under **Finish** when you are ready.
- There is no way back. A migration of everything does not become one of only the last 90 days; for that, start a new migration.

## On a self-hosted appliance {#self-hosted}

On a self-hosted appliance, a migration of only the last 90 days is set in its mapping file:

```json
{ "recentOnly": { "days": 90 } }
```

The 90 days are counted from when the migration is first recorded, and stay put across restarts. To copy everything, remove `recentOnly` from the mapping file and restart: the next pass copies the older items. Adding `recentOnly` to a migration that already runs is refused at the next start: start a new migration instead.
