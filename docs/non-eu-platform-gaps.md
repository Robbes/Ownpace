# Which large non-EU platforms we cannot yet migrate people off

## Status — 2026-09-04

Written at the owner's request (2026-09-04): *"analyse if we are lacking any large non-eu
platform people would like to migrate out of towards eu. list them, like a top 5."*

This is an assessment, not a commitment. Nothing here is scheduled, and no value in it has
been measured against a live provider — 0105's never-guess rule means every host, port and
capability named below is a **claim to check**, not a fact to build on.

## What we already reach

| Family | Kinds |
|---|---|
| Google | `google` account (mail, calendar, contacts, Drive), and `gmail`, `google_calendar`, `google_contacts`, `google_drive` singly |
| Microsoft 365 | `microsoft` account (mail, calendar, contacts, OneDrive), plus `oauth2` (IMAP) and `graph` for an administrator migrating other people's mailboxes |
| File stores | `dropbox`, `box` |
| Soverin | `soverin` account (mail, calendar, contacts, tasks) |
| Protocols | IMAP, JMAP, CalDAV, CardDAV, WebDAV |

The protocol kinds matter to this analysis more than they look: **any provider that speaks
IMAP or DAV is already reachable by hand today.** What a named kind adds is a card, pre-filled
servers, a measured qualification and a guide — the difference between "possible" and "a
person can do it". So the ranking below is not "can we?" but "how many people would find it
without help, and what would it cost us to make it findable".

## The ranking, and how it was made

Three things decide a place: **how many people in our five domains** (mail, calendar,
contacts, files, tasks), **whether a documented read path exists at all**, and **how much new
machinery it needs**. A platform with a hundred million users and no API is not a better
target than one with ten million and an IMAP server.

### 1. Apple / iCloud — mail, calendar, contacts, reminders

The biggest gap by user count, and now planned in
[0115](workplans/0115-the-account-apple-will-not-hand-over.md). Four of our five domains are
reachable over IMAP and DAV with an app-specific password; iCloud Drive has **no third-party
API at all** and never has. Apple is also the only platform on this list whose *task* face
works with machinery we already have, because Reminders are `VTODO` in the CalDAV account.

**Cost: low.** It is Soverin's shape with a different provider, plus one real defect to fix
first (the partition-host home set, 0115 T1).

### 2. Yahoo Mail and AOL — mail, and probably calendar and contacts

Two brands, one company (Yahoo Inc., US), and the largest remaining pool of *legacy consumer
mail* outside Google and Microsoft — decades-old addresses people keep because moving them
has always been somebody else's job. Exactly our customer.

Yahoo issues **third-party app passwords** for accounts with two-step verification, and IMAP
must be switched on in the account's own settings first — which is a support sentence we would
need to write, because a person who has not done it sees a login failure that says nothing
about the setting. Whether Yahoo's CalDAV and CardDAV endpoints are still offered to third
parties **has not been checked** and must be measured before any card claims those faces.

**Cost: very low for mail** — close to a provider-directory row and a guide. Unknown for the
other two until somebody measures them.

### 3. Slack — a domain we do not have

The largest gap *outside* our five domains, and the one people ask about when they say
"leave American software": team messaging, with Element/Matrix, Mattermost and Zulip all
credible EU-hosted destinations. Slack publishes an export and a read API.

This is on the list to be named honestly rather than to be scheduled. **A message is not a
mail, an event, a card, a file or a task** — it is a sixth object kind, with threads,
reactions, channel membership and a retention policy, and 0113 is a recent and fresh reminder
of what one new object kind costs across a codebase that fans out. Worth its own plan, not a
connector.

**Cost: high.** A new domain, end to end.

### 4. Atlassian — Trello, Jira, Confluence

Trello and Jira issues map onto the **task domain we finished in 0113**, which makes this the
first non-EU platform where the expensive part is already paid for. Confluence maps roughly
onto files. Atlassian publishes OAuth 2.0 (3LO) and documented REST APIs, so a real consent
button — the thing Apple cannot have — is possible here.

**Cost: medium**, and it is the best test of whether the task domain generalises beyond
CalDAV `VTODO`.

### 5. Zoho — a whole SME suite over open protocols

Indian, so non-EU, and popular with exactly the small businesses that buy this product. Mail,
Calendar and Contacts are offered over IMAP, CalDAV and CardDAV with app-specific passwords,
which means it lands as another provider-directory row rather than a connector.

**Cost: very low**, and it is the cheapest way to widen the front door by a whole suite.

## Named, and deliberately not in the five

- **Amazon WorkMail / WorkDocs** — reachable over IMAP; the user base is too small in our
  market to earn a card ahead of the five above.
- **Notion** — good API, real demand, but its pages are neither files nor tasks. Same
  sixth-object-kind problem as Slack, with fewer users.
- **Todoist, Asana, Monday** — all task platforms with APIs, all smaller than Atlassian, all
  reachable through the same work item 4 would build.
- **Yandex Mail** — non-EU and IMAP-reachable, but the population wanting an EU destination
  is not the population using it.
- **Fastmail** — Australian, so non-EU, but it speaks **JMAP**, which this product already
  supports. Reachable today; needs a card, not a connector.
- **Evernote** — worth a check rather than a listing: it was acquired by Bending Spoons, an
  **Italian** company, which if still true makes it an EU platform and not a target at all.
- **Proton and Tuta** — European. Destinations, not sources.

## The one-line summary

Two of the five (Apple, Zoho) and most of a third (Yahoo mail) are **provider-directory rows
and guides**, not new engineering — the machinery Soverin and the account kinds already built
is what makes them cheap. The two expensive ones (Slack, Atlassian) are expensive for the same
reason: they carry an object kind this product does not model yet, and 0113 is the honest
estimate of what that costs.
