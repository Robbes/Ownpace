<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!--
  VERSION 1.0, 2026-09-28: the owner's text for the Alpha. It stays 1.0 while
  it is edited, until the first tester accepts it; every change after that
  gets a new number (alpha-version-number (a), 2026-09-28). The lawyer's pass
  (0139 T1) is deferred. This comment never renders (the site generator
  strips HTML comments); it is the briefing for the reviewing lawyer, beside
  the ones at the top of privacy.md and terms.md. alpha.nl.md mirrors this
  file section for section, and the Dutch is the text testers read first
  (workplan 0139 D2). Drafted on 2026-09-28 at the owner's request, from the
  sentences workplans 0131, 0134, 0137 and 0139 drafted and the owner's
  answers of that day; the owner reads it before you do. Not rendered by the
  site build and not linked from anywhere yet (0139 T10).

  These conditions sit beside the terms 1.3 and the privacy policy 1.2, both
  drafts in the same pull request. On 2026-09-28 the owner answered all 71
  questions on the answer page. This revision applies every answer that
  names the Alpha conditions, in both languages. Each is named by its id and
  the option chosen, for example rec-alpha-10 (a). ANSWERED marks the owner's
  answer; what follows "Left for the lawyer" is still open.

  What the answers changed in the text, in both languages:

  - §2: when the account is created, the app shows these conditions, the
    terms and the privacy policy, each with its version number, asks for
    acceptance, and records the version of each and the time
    (terms-acceptance-route (b)). The list of what does not apply gains
    terms §12's 30 days, for the new conditions after the Alpha; the 7 days
    in §11 apply instead (alpha-s11-notice (a)).
  - §4: the heading stays. A sentence says terms §10 (If we get it wrong)
    still applies (alpha-s4-liability (a)). The breach sentence drops "where
    that is required": we tell the tester about a breach that affects their
    data, as privacy §11 says (alpha-version-number (a)).
  - §5: we update the service often; an update can pause migrations for a
    short while, and we do not announce each one (alpha-s5-updates (a)).
  - §6: the copy before an update is kept until that update is shown to
    work, and never longer than 7 days (rec-copies (a)). It said "until the
    next update succeeds".
  - §9: a family member sent a grant link also needs their Google address on
    Google's list first (alpha-s9-family-google (a)).
  - §10: the stored access follows the code (rec-alpha-10 (a)). At erasure a
    family member's Google address comes off too, or sooner if the tester or
    the family member asks (alpha-s9-family-google (a)).
  - §11: the new conditions are accepted in the app, as in §2. A tester who
    has not accepted them by the day they take effect is closed that day and
    erased 7 days later; in that week they can still accept and carry on
    (alpha-s11-erasure-window (b)).

  The questions we want answered (workplan 0139 T1, questions 1 and 2):

  1. An addendum, or stand-alone conditions? ANSWERED: alpha-addendum-form
     (a), left for your pass. The text stays an addendum to the terms and
     the privacy policy. §2 says it prevails where they differ, and lists
     what does not apply during the Alpha: terms §6 (prices), §7 (right of
     withdrawal), §8 (billing), §15 (the model withdrawal form); the notice
     periods in §11's second paragraph (30 days before we end the terms, 90
     days if the service is discontinued), which §5 and §11 here replace
     with 7 days; and §12's 30 days for the new conditions after the Alpha,
     which §11 here replaces with 7 days. §11's export on discontinuation
     still applies: terms 1.3 makes it an export of the migration records,
     made on request (terms-s11-export (a); the owner: "draft the export
     function in a workplan"). §2 also names two points of privacy §9: the
     copy before an update (§6 here), and the Credentials row (§10 here).
     After rec-copies (a) and rec-alpha-10 (a), both texts say the same on
     those two rows, so nothing is set aside there today.
     Left for the lawyer:
     - Is an addendum the right instrument? May it set aside a row of the
       privacy policy this way, should the two ever differ? If not, §2's
       sentence on privacy §9 can go.
     - May §7 and §15 be switched off for a service that costs nothing?
       ANSWERED: alpha-withdrawal-right (a), left for your pass; §2 keeps
       them in its list. The withdrawal button terms §7 describes is not
       built.
     - Is 7 days' notice valid for the step to the new conditions, beside
       terms §12's 30 days? §2 now says so in words (alpha-s11-notice (a)).
       The step needs acceptance in the app, and not accepting ends in
       closing and erasure, not in a paid continuation. Terms question 16
       asks the same.
     - §4, "No obligations, on either side": the owner kept the heading, and
       §4 now says terms §10 still applies (alpha-s4-liability (a)). Terms
       1.3 §10 makes us liable towards a consumer as the law provides, with
       no cap (terms question 13). Do the heading and that sentence together
       hold against Dutch consumer law?
     - §5: terms §9 promises advance notice of planned maintenance that
       interrupts migrations. §5 here says updates are not announced one by
       one (alpha-s5-updates (a)). It relies on §2's general rule; §2's list
       does not name terms §9. Is that enough, or should §2 name it?
  2. Which language governs. The Alpha is Dutch, and testers read
     alpha.nl.md first. This draft says nothing about language, so as an
     addendum it falls under terms §13, which keeps v1.2's rule: the English
     governs, except where mandatory consumer law provides otherwise. Not on
     the answer page; open. QUESTION: is that tenable here (terms question
     15, privacy question 17), or should the Dutch text govern the Alpha
     conditions, or all three documents during the Alpha?

  What else this draft rests on, for the same pass:

  - Households only (0139 open question 6, answered 2026-09-28). No
    organisation or business is admitted during the Alpha, so the
    data-processing agreement is part of no Alpha contract, and privacy §3's
    household case is the only one that applies. Terms §3 now asks for 18 or
    older (terms-s3-minimum-age (b)); a younger family member takes part
    through a grant link.
  - How a tester accepts (§2, §11). ANSWERED: terms-acceptance-route (b),
    2026-09-28. The owner: "People that are accepted in the Alpha do need to
    create a login for the app, accepting fits in there and should record
    what time/version the accepted of what document." NOT YET BUILT: the
    screen is 0139 T3, proposed. It must show these conditions with the
    terms and the privacy policy, record the version of each and the time,
    and ask again when new conditions follow the Alpha (§11). The first
    invitation waits for it. The texts must also be on the site, and the
    site build does not render these conditions yet (0139 T10). Left for the
    lawyer: terms question 12.
  - Credentials after a finished migration (§10). ANSWERED: 0139 open
    question 3 (a), "keep until deleted or closes", and rec-alpha-10 (a),
    2026-09-28, which makes §10 say what the code does. A connection's
    access goes when the connection is deleted, which the app allows only
    once no migration uses it. Deleting a migration removes only access a
    family member gave through a grant link, which they can also withdraw on
    their progress page. Privacy §9's Credentials row says the same. Nothing
    uses the access after closing: NOT YET FULLY TRUE. Since #1320
    (d7868276, 0085 T2), merged into this branch in c1413b53, nothing new
    starts once the account is closed. Work already running is not all
    stopped: a sync pass or a discovery stops before its next data type, and
    a verification or a confirmation already running reads to its end with
    the stored access (terms briefing, precondition B, not fully done). The
    access is destroyed at erasure, at the end of the window the tester
    chose, as terms §11 now says.
  - The end of the Alpha (§11). ANSWERED: alpha-s11-erasure-window (b),
    2026-09-28. A tester who has not accepted the new conditions by the day
    they take effect is closed that day, and their data does not move along.
    It is erased 7 days later; until then they can still accept and carry
    on. If the service moves, the old hosting environment keeps those
    accounts for that week. Deemed acceptance under terms §12 is not used:
    §12 says carrying on is not acceptance where we ask for it explicitly.
  - One copy of the databases before each update (§6). ANSWERED: rec-copies
    (a), 2026-09-28: one copy per update, deleted once the update is proven
    (deploy-live.sh logged it as "took", one pass completed, and the hold
    was lifted). If the update is not proven by day 6, it is rolled back
    from the copy; the copy is never kept past day 7. rec-drill (a),
    2026-09-28: the daily restore drill of the task runner's database runs
    on the test stack only, and on live a copy is taken before each upgrade
    of the task runner, under the same rule. So §6 keeps one exception. NOT
    YET BUILT: the script and directory for the copy, its delete step, the
    daily backstop, dump-idp.sh writing there, and the drill off live's
    daily duties. Until then live keeps 7 daily dumps of the task runner's
    database, and §6 is not yet true. Privacy §9 names the same rule.
  - Reaching testers if the environment is lost (§6). ANSWERED:
    privacy-tester-list (a), 2026-09-28: the request notices and our answers
    in the support mailbox are the list of testers. No separate list.
  - Google's list of test users (§9, §10). ANSWERED: alpha-s9-family-google
    (a), 2026-09-28. A family member's address comes off with the tester's
    at erasure, or sooner if either asks. The owner takes both steps by
    hand; privacy §6 and §9 say the same. Whether an address on that list is
    a transfer to the US is privacy question 12 (left for the lawyer,
    privacy-google-testlist-basis (a)).
  - Decided by the owner on 2026-09-28, where the draft had placeholders:
    at least 7 days' notice before a reset or the end of the Alpha, and
    before the new conditions after it (§5 and §11 here; 0139 open
    question 7), and an account closed within 7 days of the request (§10
    here; 0139 T7).
  - Not in these conditions: the company's name, KvK number, VAT number and
    the address (fact-trademark (b), fact-vat (a), rec-address (c)). Terms
    §1 and privacy §1 carry the name, KvK and VAT numbers; the address is
    left out of both during the Alpha (rec-address (c)); §12 here gives only
    support@ownpace.eu.
-->

# Alpha conditions

**Apply to:** the Alpha of the Ownpace **managed service** at `ownpace.eu`.
**Version:** 1.0
**Last updated:** 2026-09-28

---

## 1. What the Alpha is

The Alpha is a trial of the Ownpace managed service. A small group takes part, and everyone in it
was invited personally. The Alpha lasts a few weeks.

**Households only.** You take part as a private individual, with your own accounts or your
family's. A business or another organisation cannot take part during the Alpha. That the app
calls your workspace an "organisation" does not change this.

## 2. How these conditions fit with the others

These conditions belong with the [terms of service](./terms.html) and the
[privacy policy](./privacy.html). They apply for as long as the Alpha lasts. Where they say
something different from the terms or the privacy policy, these conditions prevail. In the privacy
policy, that concerns two points of §9 (*How long we keep it*): the copy made right before an
update (§6 below), and the access you gave us, the row *Credentials* (§10 below).

During the Alpha, these parts of the terms do not apply:

- **§6 (prices), §7 (right of withdrawal), §8 (billing) and §15 (model withdrawal form).**
  Nothing is charged (§3 below).
- **The notice periods in §11, second paragraph:** 30 days before we end the terms, and 90 days
  if we discontinue the service. The period in §5 and §11 below applies instead. The export that
  paragraph promises if we discontinue the service still applies.
- **The 30 days' notice in §12, for the new conditions after the Alpha.** For those, the 7 days
  in §11 below apply instead.

The rest of the terms applies as usual, and so does the rest of the privacy policy.

When you create your account, the app shows you these conditions, the terms and the privacy
policy, each with its version number, and asks you to accept them. The app records which version
of each text you accepted, and when.

## 3. Free

Nothing is charged during the Alpha. You register no payment method, and you get no invoice.

## 4. No obligations, on either side

There is no service level. We promise no speed, no completion date and no time to recover. You
may stop at any time (§10), and we may stop the Alpha (§5).

Our duties for your data remain. We keep it secure, and keep it no longer than the privacy
policy and §6 and §10 here say. We tell you about a data breach that affects your data, and
answer your requests about your rights.

§10 of the terms (*If we get it wrong*) still applies.

## 5. No promise of availability

The service may falter or be down for a while during the Alpha. As §9 of the terms already
says, there is no uptime guarantee.

We may pause the service, for example during an outage or a security problem. No new pass
starts then, and the app shows it. This can happen without warning.

We update the service often during the Alpha. An update can pause your migrations for a short
while; we do not announce each one.

We may also start the Alpha over (a reset) or end it. A reset erases the service's records, and
you start again as §6 describes for a lost hosting environment. We tell you about a reset or the
end by email, at least 7 days in advance.

## 6. No backups

During the Alpha we make no backups of the service's own records: your organisation, the
accounts you connected, your migrations and their history, and your Ownpace sign-in.

One exception. Right before each update of the service, we make one copy of the databases. That
copy exists only to undo a failed update. We keep it until that update is shown to work, and
never longer than 7 days. That copy does not leave the hosting environment. If your account is
erased, your data can stay in that copy for at most 7 days.

If the Alpha environment is lost, those records, and that copy, are lost with it. Your data is
not: Ownpace removes nothing from your old account, and what was copied to your new provider
stays there. We would then let you in again, as the first time. You sign in again, connect your
accounts again and set up your migrations again. The first pass recognises what is already at
your new provider and does not copy it a second time. From then on, what it recognised is no
longer updated when it changes in your old account, and anything you deleted or moved at your
new provider is copied back. We will tell you by email if this happens. The access you gave us
at Google, Microsoft or another provider stays there until you withdraw it. If the hosting
environment is lost, withdraw it, and grant it again when you reconnect.

## 7. Experimental sources

Some sources and data types carry the label *Experimental*. It means: built, but not yet run
against a real account of that kind. Keep your old account until you have checked what arrived.
§10 of the terms says so for every migration; for an experimental source it matters all the
more.

## 8. Your account is yours

Your account is for you alone. Share your sign-in details with nobody.

During the Alpha, do not invite anyone else into your organisation. If somebody wants to follow
a migration, send them that migration's progress link: it shows counts and states, never
content. If you do invite someone, invite them as an admin, and know that an admin can do
everything you can except close or reopen the organisation, turn applying deletions or
auto-applying relocations on or off, and make somebody an owner. During the Alpha, a person can
only be an owner or an admin. You are responsible for whom you invite.

## 9. Google asks again

If you want to connect a Google account, give us its Google address first. We add it to the
list of test users at Google. Without that step, Google does not allow the connection. The same
goes for a family member you send a grant link to: give us their Google address first.

While Ownpace's app at Google is still in Google's test phase, a Google connection stops working
after about seven days. You then connect again, with *Reconnect* on the account.

## 10. Stopping, and closing your account

You may stop at any time. Ask us to close your account (§12), and choose when your data is
erased: at once, or after 7, 30 or 90 days. We close it within 7 days of your request, and tell
you the date on which your data will be erased.

What stays: the copies at your new provider, and your old account, from which Ownpace removes
nothing. Access you created yourself at a provider, such as an app password or the permission at
Microsoft or Dropbox, you withdraw there yourself. We tell you which.

A finished migration keeps the access you gave us, so that you can resume it. We keep that
access until you delete the connection, which the app allows once no migration uses it. Access a
family member gave through a grant link goes when you delete the migration, or when they
withdraw it on their progress page. If you close your account, nothing uses any of it from then
on, and all of it is destroyed when your data is erased, at the end of the period you chose.

When your data is erased, we also delete your Ownpace sign-in account, take your Google address
and any family member's off the list of test users (§9), and erase your request for access. We
take a family member's address off sooner if you or they ask.

## 11. The end of the Alpha

After the Alpha, the service carries on, under new conditions. It may then move from its current
hosting environment to another hosting provider.

We tell you by email at least 7 days in advance. You get the new conditions, and we say where your
data would then go. Your migrations carry on under the new conditions only once you have
accepted them in the app, as in §2. If you would rather stop, close your account as in §10. If
you have not accepted them by the day they take effect, we close your account, and your data
does not move along to the new service. Your data is erased 7 days later; until then you can
still accept them and carry on.

What you have already copied to your new provider with your migrations stays there in any case.

## 12. Reaching us

Write to **support@ownpace.eu**. You can also use *Report a problem* in the app's menu. Never
send a password, a token or other sensitive data.

Mail from the service, such as your sign-in codes and our answer to your request, comes from
support@ownpace.eu. If you reply to such a mail, your reply reaches us.
