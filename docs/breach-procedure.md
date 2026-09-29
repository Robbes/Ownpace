# When personal data may have leaked

What the operator does when a tester's personal data may have been read, changed, lost or
destroyed by someone who should not have: a personal data breach (GDPR Art. 4(12)). It is
written for `ownpace-live` during the alpha, and holds for any managed deployment. It holds no
secrets: the facts it needs that are not in this repository, such as the hosting details and the
list of testers, the owner keeps elsewhere (workplan 0139 T8, 0134 T4).

Examples: somebody other than a tester or the operator reached the database, a backup or dump of
it, or live's `.env`; a machine or disk was lost or stolen; a tester saw another organisation's
data; a key or password was pasted where others can read it.

**The clock starts when you become aware**: when you are reasonably sure a breach happened, not
when you have finished looking into it. Write that moment down. Notifying the Autoriteit
Persoonsgegevens (step 4) is due within 72 hours of it where feasible.

## 1. Contain

- **Start the hold** (Support, **Hold new passes**), with a sentence testers can read. It stops
  the sync tick starting passes, and it refuses every button that would start work (workplan
  0132 T6 (b)). How it works is in
  [Draining first](./managed-bring-up.md#draining-first-and-telling-customers-why).
- **Stop the passes already running.** The hold lets them finish on their own clock. Pausing
  the affected migrations stops their running passes within about fifteen seconds, after what
  each is copying at that moment. The hard stop is still the Trigger.dev dashboard of live's
  plane: open each run that is still executing and cancel it.
- **A leaked key or password**: see [Keys](#keys) below before you change anything, because
  replacing a key can make stored data unreadable.
- **A tester's own credential**: deleting the connection revokes what the provider lets us
  revoke (`revokeCredentialRow`). The tester withdraws the rest at their provider: an app
  password, or a consent in their provider's console.
- **Do not rebuild, reset or restart live** before step 2: what the machine holds now is the
  evidence. The nightly gate rebuilds only the OTA stack and never touches live (0132 D-new,
  T1g). If the breach reaches the OTA stack too, disable the **E2E (managed)** workflow in the
  repository's Actions tab first: its next run rebuilds that stack and destroys what is there.

## 2. Keep the evidence

Copy these off the machine, somewhere only you can read, before they age out. Keep the copies as
private as the database: they hold what it holds. Run them from live's checkout, `~/ownpace-live`.

**Containers' output first, before any deploy, restart or recreate.** Docker keeps each
container's output with the container and nowhere else (`json-file`, privacy §9), so a deploy,
which recreates the app's and the site's containers, removes their output with them, and a task
run's output went when its run ended. There is no copy in the host's journal to go back to.

```bash
# Every service's output, while its container still stands (the stack's, then the website's):
docker compose -f deploy/compose/managed.yml logs --no-color --timestamps > containers-$(date +%F).txt
docker compose -p ownpace-live-www -f deploy/compose/www.yml --env-file deploy/compose/.env logs --no-color --timestamps > site-$(date +%F).txt
# The application's own errors and warnings, pruned after a month (0129 T3):
docker compose -f deploy/compose/managed.yml exec -T postgres psql -U openmigrate -d openmigrate \
  -c "\copy (SELECT * FROM app_event) TO STDOUT WITH CSV HEADER" > app_event-$(date +%F).csv
# Every operator read of a customer's data, and every hold with what it said:
docker compose -f deploy/compose/managed.yml exec -T postgres psql -U openmigrate -d openmigrate \
  -c "\copy (SELECT * FROM support_read) TO STDOUT WITH CSV HEADER" > support_read-$(date +%F).csv
docker compose -f deploy/compose/managed.yml exec -T postgres psql -U openmigrate -d openmigrate \
  -c "\copy (SELECT * FROM platform_pause) TO STDOUT WITH CSV HEADER" > platform_pause-$(date +%F).csv
```

- **The audit log.** Under Support, **The log** ends with **Audit export**. Press **Download**
  with the field empty: every event from the first, oldest first, as the lines the API prints
  (0129 T4). Addresses and file names in it are pseudonyms made with a key in the database, and
  the same address always gives the same pseudonym, so the assessment can tell whether a given
  tester's address appears.
- **Trigger.dev's own record of each run**: its dashboard shows every run's input, output, error
  and logs. Note the runs around the moment, and copy what matters from there too.

## 3. Assess

Write down, with the time:

- **What data.** What Ownpace holds is listed in the data-processing agreement's Annex A
  (`site/legal/dpa.md`): the credentials for source and target, encrypted; the ledger's
  identifiers, hashes, sizes, folder and collection names, timestamps and outcomes; preflight
  counts. Mail, calendars, contacts and files pass through and are not warehoused, so a breach of
  content is a breach of a pass that was running. The sign-in accounts are in the identity
  provider's database on the same server, the access requests in the application's database, and
  the problem reports in the support desk they were sent to.
- **Whose.** Which testers and which organisations. Also the people in their mail, calendars and
  contacts, who never signed up for anything.
- **How it happened, and whether it is still happening.**
- **Both stacks.** They share one Docker daemon, and their separation is not a security boundary
  (0132 D-new), so start from both.
- **The risk to the people.** How likely harm is, and how bad. Unlikely to result in a risk: you
  register it (step 6) and need not notify. A risk: you notify the Autoriteit Persoonsgegevens
  (step 4). A high risk: you also tell the testers (step 5).

## 4. Notify the Autoriteit Persoonsgegevens

Without undue delay and, where feasible, within 72 hours of becoming aware (Art. 33), through the
Autoriteit Persoonsgegevens' own reporting form on its website. If you are later than 72 hours,
the notification says why. It may come in phases: send what you know, and complete it as you
learn more.

It says (Art. 33(3)): what happened; which categories of data and people, and roughly how many of
each; who to contact; the likely consequences; and what you have done or will do, including to
limit the harm.

## 5. Tell the testers

When the breach is likely to result in a high risk to them (Art. 34), tell each tester without
undue delay, in plain words, Dutch first. It is not needed when the data was unreadable to
whoever got it (encrypted, and the key not compromised), when what you did since makes the high
risk unlikely, or when telling each person would take disproportionate effort; in that last case
a public notice takes its place (Art. 34(3)).

A business tester under the data-processing agreement is the controller of its own people's
data: tell it, and it decides about its people (the agreement's §7).

**In Dutch:**

> **Onderwerp:** Beveiligingsincident bij Ownpace waarbij uw gegevens betrokken zijn
>
> Beste [naam],
>
> Op [datum] hebben wij een beveiligingsincident bij Ownpace ontdekt. [Wat er gebeurde, in één
> of twee zinnen.]
>
> Het gaat om deze gegevens van u: [welke gegevens]. Dit kan voor u betekenen: [de
> waarschijnlijke gevolgen].
>
> Wat wij hebben gedaan: [de maatregelen].
>
> Wat u kunt doen: [bijvoorbeeld: trek de toegang in die u Ownpace hebt gegeven, in de
> instellingen van uw Google-, Microsoft- of e-mailaccount, en wijzig het app-wachtwoord dat u
> bij ons hebt ingevuld].
>
> [Wij hebben dit gemeld bij de Autoriteit Persoonsgegevens.] Hebt u vragen? Beantwoord deze
> e-mail, dan nemen wij contact met u op.
>
> Met vriendelijke groet,
> [naam]
> Ownpace

**In English:**

> **Subject:** A security incident at Ownpace involving your data
>
> Dear [name],
>
> On [date] we discovered a security incident at Ownpace. [What happened, in one or two
> sentences.]
>
> It concerns this data of yours: [which data]. For you, this may mean: [the likely
> consequences].
>
> What we have done: [the measures].
>
> What you can do: [for example: withdraw the access you gave Ownpace, in the settings of your
> Google, Microsoft or email account, and change the app password you entered with us].
>
> [We have reported this to the Dutch Data Protection Authority, the Autoriteit
> Persoonsgegevens.] If you have questions, reply to this email and we will get back to you.
>
> Kind regards,
> [name]
> Ownpace

## 6. Register every breach

Every breach goes in the owner's register, notified or not (Art. 33(5)): what happened, its
effects, what was done, and for one that was not notified, why not. The register is kept beside
the record of processing (0139 T8), outside this repository.

## Keys

`SECURITY.md` says the stored credentials have **no rotation**. So a leaked
`SECRET_ENCRYPTION_KEY` means every stored credential must be treated as read. Every tester
withdraws what they granted, at their provider, and reconnects once live has a new key; a new key
makes the old stored credentials unreadable anyway. The OAuth client secrets are replaced in each
provider's console, and `ZITADEL_MASTERKEY` guards the identity provider's own data. What losing
live's `.env` costs testers is in
[workplan 0134](./workplans/0134-no-backups-during-the-alpha-said-truthfully.md) T3.
