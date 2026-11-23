// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A new address for one you cannot take along (workplan 0168 §6.2, §6.3):
 * the step in *Start a migration*, and the lines on the person's page, the
 * team screen, the migration page, the confirmed list, the Sharing checklist
 * and the grant and progress pages.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 *
 * The English of the step is 0168 §6.2's. The Dutch follows §6.2's draft in
 * the dictionary's register (*u*, `GLOSSARY.md`) and its words (*Deel-checklist*,
 * *deelrecht*; no form of the retired word for a move).
 */

export const en = {
  // The step (0168 §6.2).
  'start.address.heading': 'Your new address',
  'start.address.leaving': 'You are leaving {old}. {provider} keeps that address, so it cannot come with you.',
  'start.address.leavingDeclared': 'You are leaving {old}.',
  'start.address.newIs': "Your new account's address is {new}.",
  'start.address.newNotAnAddress':
    'Your new account signs in as {login}, which is not an address. Type the address your new mail comes from.',
  'start.address.use': 'Use {new} in place of {old}?',
  // Where the new account's login is not an address, nothing is proposed (N11).
  'start.address.which': 'Which address takes the place of {old}?',
  'start.address.yes': 'Yes',
  'start.address.no': 'No, keep it as it is',
  'start.address.another': 'Another address…',
  'start.address.this': 'This address',
  'start.address.newLabel': 'New address',
  'start.address.oldLabel': 'Old address',
  'start.address.goes': 'Where your new address goes',
  'start.address.goes.contacts.label': 'Contacts:',
  'start.address.goes.contacts':
    'cards that list {old} get {new} as their first address. The old one stays on the card, so old mail still finds the person.',
  'start.address.goes.calendars.label': 'Calendars:',
  'start.address.goes.calendars':
    'events you organised list you as {new}, so you can still change them. Nobody gets an invitation or an update.',
  // A pass changes a task's organiser as it changes an event's (0168 T4).
  'start.address.goes.tasks.label': 'Tasks:',
  'start.address.goes.tasks': 'tasks you organised list you as {new}, as your events do.',
  'start.address.goes.shares.label': 'Shared folders:',
  'start.address.goes.shares': 'the Sharing checklist suggests {new} for you. You still press each share yourself.',
  'start.address.not': 'Where it does not go, and why',
  'start.address.not.mail.label': 'Mail:',
  'start.address.not.mail':
    'every message stays exactly as it was sent. Changing an old message would break its signature and its history. Your new mail comes from {new}.',
  'start.address.not.invitations.label': 'Invitations from other people:',
  'start.address.not.invitations':
    'they keep the address they were sent to, so a reply still matches what the sender has.',
  'start.address.not.text.label': 'Text:',
  'start.address.not.text': 'descriptions, notes and documents are never changed.',
  'start.address.others': 'Others moving with you?',
  'start.address.others.line': 'Add the addresses that change for your family or team.',
  'start.address.others.add': 'Add an address change',
  'start.address.others.remove': 'Remove',
  'start.address.already': 'Already in your organisation’s address changes',
  // A row of the table that waits, confirmed with Start by whoever signs in (N12, D6).
  'start.address.confirmAtStart': 'Confirm {old} → {new} when I press Start',
  'start.address.nothingYet':
    'Nothing is copied yet. You can change this until you press Start, and afterwards on your page.',
  'start.address.needAnswer': 'Answer the question first.',
  'start.address.needOldAddress': 'Type each old address as an address, like name@example.org.',
  'start.address.needAddress': 'Type each new address as an address, like name@example.org.',
  'start.address.saveFailed': 'Not saved: {old}.',
  // On *Where does it go?*: the own domain being given up, which no list knows.
  'start.to.alsoChanging': 'I am also changing my address',
  // On *Check, then start*: one line per changed address. Only a confirmed
  // row changes anything (ADR-0055), so a row that waits says so (S1).
  'start.check.address': '{old} becomes {new} in contacts, calendars, tasks and shares',
  'start.check.address.forPerson':
    '{old} becomes {new} in contacts, calendars, tasks and shares, confirmed by you for {person}',
  'start.check.address.waitsFor': '{old} → {new} waits for {person} to confirm it, and changes nothing until then',
  'start.check.address.waits': '{old} → {new} waits for a confirmation, and changes nothing until then',
  // Start writes the step's rows first; one it could not write stops it.
  'start.check.address.notStarted': 'Nothing was started. Press Back to change it on Your new address.',
  'start.check.notNow.addresses': 'The address changes are saved only when you press Start.',

  // Afterwards (0168 §6.3).
  'addresses.heading': 'Addresses',
  'addresses.none': 'No address changes.',
  'addresses.failed': 'The address changes could not be read.',
  'addresses.change': '{old} → {new}',
  'addresses.confirmed': 'Confirmed',
  'addresses.confirmedBy': 'Confirmed by {who}',
  'addresses.confirmedByFor': 'Confirmed by {who} for {person}',
  // The reader confirmed it for somebody else (D6), said as the step says it.
  'addresses.confirmedByYouFor': 'Confirmed by you for {person}',
  'addresses.waitingFor': 'Waiting for {person}',
  'addresses.waiting': 'Waiting for a confirmation',
  'addresses.confirm': 'Confirm',
  'addresses.edit': 'Change',
  'addresses.delete': 'Delete',
  'addresses.notRight': 'Not right?',
  'addresses.save': 'Save',
  'addresses.cancel': 'Cancel',
  'addresses.add': 'Add',
  // Why Save and Add cannot be pressed yet (N10).
  'addresses.save.reason': 'Type the new address, like name@example.org.',
  'addresses.add.reason': 'Type the old and the new address, each like name@example.org.',
  'addresses.notSaved': 'Not saved:',
  // A pass changes tasks as it changes events (0168 T4).
  'addresses.where': 'Used in contacts, calendars, tasks and shares. Mail is never changed.',
  'addresses.fromFile': 'These come from {file}, and are changed in that file.',
  'addresses.table.heading': 'Address changes',
  'addresses.table.old': 'Old address',
  'addresses.table.new': 'New address',
  'addresses.table.person': 'Person',
  'addresses.table.setBy': 'Set by',
  'addresses.table.nobody': 'Nobody',
  'addresses.peopleFailed': 'The people could not be read, so an address change cannot be linked to a person yet.',
  'addresses.theOld': 'the old address',
  'addresses.whereMore': 'Where a new address goes, and where it does not',
  'addresses.theNew': 'the new address',
  'addresses.mapping.used': 'Your new address is used in contacts, calendars and tasks',
  'addresses.mapping.lastPass': 'Changed in the last pass: {count}',
  'addresses.mapping.apply': 'Apply the new addresses here too',
  'addresses.mapping.apply.line':
    'This data type is past its switch, so a change to the address table waits for this press. Copies somebody edited on the new system are left as they are.',
  'addresses.mapping.applying': 'Applying…',
  'addresses.mapping.applied': 'The next pass applies the new addresses here.',
  // On a verified row only (B2); the account's counts beside the headline.
  'addresses.confirmedList.changed': 'Matches, with your new address',
  'addresses.confirmedList.changedCount': 'Copies with a new address: {count}',
  'addresses.confirmedList.olderCount': 'Copies from before the latest address change: {count}',
  'addresses.sharing.fromTable': 'From your address changes',
  'addresses.grant.yours': 'Your new address: {new}. Is that right?',
  'addresses.grant.yes': 'Yes, that is right',
  'addresses.grant.confirmed': 'Confirmed: {new}.',
  'addresses.grant.returned': 'Sent back. Whoever set it up will change it.',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'start.address.heading': 'Uw nieuwe adres',
  'start.address.leaving': 'U verlaat {old}. Dat adres blijft bij {provider} en kan dus niet mee.',
  'start.address.leavingDeclared': 'U verlaat {old}.',
  'start.address.newIs': 'Het adres van uw nieuwe account is {new}.',
  'start.address.newNotAnAddress':
    'Uw nieuwe account meldt zich aan als {login}, en dat is geen adres. Typ het adres waar uw nieuwe mail van komt.',
  'start.address.use': '{new} gebruiken in plaats van {old}?',
  'start.address.which': 'Welk adres komt in de plaats van {old}?',
  'start.address.yes': 'Ja',
  'start.address.no': 'Nee, laat het zoals het is',
  'start.address.another': 'Een ander adres…',
  'start.address.this': 'Dit adres',
  'start.address.newLabel': 'Nieuw adres',
  'start.address.oldLabel': 'Oud adres',
  'start.address.goes': 'Waar uw nieuwe adres komt',
  'start.address.goes.contacts.label': 'Contacten:',
  'start.address.goes.contacts':
    'kaarten met {old} krijgen {new} als eerste adres. Het oude adres blijft op de kaart staan, zodat oude mail de persoon nog vindt.',
  'start.address.goes.calendars.label': "Agenda's:",
  'start.address.goes.calendars':
    'afspraken die u hebt gemaakt, noemen u {new}, zodat u ze kunt blijven wijzigen. Niemand krijgt een uitnodiging of een wijziging.',
  'start.address.goes.tasks.label': 'Taken:',
  'start.address.goes.tasks': 'taken die u hebt gemaakt, noemen u {new}, net als uw afspraken.',
  'start.address.goes.shares.label': 'Gedeelde mappen:',
  'start.address.goes.shares': 'de Deel-checklist stelt {new} voor u voor. Elk deelrecht zet u nog steeds zelf.',
  'start.address.not': 'Waar het niet komt, en waarom',
  'start.address.not.mail.label': 'Mail:',
  'start.address.not.mail':
    'elk bericht blijft precies zoals het is verstuurd. Een oud bericht wijzigen breekt de handtekening en de geschiedenis ervan. Uw nieuwe mail komt van {new}.',
  'start.address.not.invitations.label': 'Uitnodigingen van anderen:',
  'start.address.not.invitations':
    'die houden het adres waarnaar ze zijn gestuurd, zodat een antwoord nog klopt met wat de afzender heeft.',
  'start.address.not.text.label': 'Tekst:',
  'start.address.not.text': 'beschrijvingen, notities en documenten worden nooit gewijzigd.',
  'start.address.others': 'Gaan er anderen mee?',
  'start.address.others.line': 'Voeg de adressen toe die voor uw gezin of team veranderen.',
  'start.address.others.add': 'Adreswijziging toevoegen',
  'start.address.others.remove': 'Weghalen',
  'start.address.already': 'Staat al in de adreswijzigingen van uw organisatie',
  'start.address.confirmAtStart': '{old} → {new} bevestigen als ik op Starten druk',
  // *Gemigreerd* for the migration's copying (GLOSSARY.md), and *Starten* as the button says it.
  'start.address.nothingYet':
    'Er is nog niets gemigreerd. U kunt dit wijzigen tot u op Starten drukt, en daarna op uw pagina.',
  'start.address.needAnswer': 'Beantwoord eerst de vraag.',
  'start.address.needOldAddress': 'Typ elk oud adres als adres, zoals naam@example.org.',
  'start.address.needAddress': 'Typ elk nieuw adres als adres, zoals naam@example.org.',
  'start.address.saveFailed': 'Niet opgeslagen: {old}.',
  'start.to.alsoChanging': 'Ik krijg ook een ander adres',
  'start.check.address': "{old} wordt {new} in contacten, agenda's, taken en deelrechten",
  'start.check.address.forPerson':
    "{old} wordt {new} in contacten, agenda's, taken en deelrechten, bevestigd door u voor {person}",
  'start.check.address.waitsFor': '{old} → {new} wacht tot {person} het bevestigt, en verandert tot dan niets',
  'start.check.address.waits': '{old} → {new} wacht op een bevestiging, en verandert tot dan niets',
  'start.check.address.notStarted': 'Er is niets gestart. Druk op Terug en wijzig het bij Uw nieuwe adres.',
  'start.check.notNow.addresses': 'De adreswijzigingen worden pas opgeslagen als u op Starten drukt.',

  'addresses.heading': 'Adressen',
  'addresses.none': 'Geen adreswijzigingen.',
  'addresses.failed': 'De adreswijzigingen konden niet worden gelezen.',
  'addresses.change': '{old} → {new}',
  'addresses.confirmed': 'Bevestigd',
  'addresses.confirmedBy': 'Bevestigd door {who}',
  'addresses.confirmedByFor': 'Bevestigd door {who} voor {person}',
  'addresses.confirmedByYouFor': 'Bevestigd door u voor {person}',
  'addresses.waitingFor': 'Wacht op {person}',
  'addresses.waiting': 'Wacht op een bevestiging',
  'addresses.confirm': 'Bevestigen',
  'addresses.edit': 'Wijzigen',
  'addresses.delete': 'Verwijderen',
  'addresses.notRight': 'Klopt het niet?',
  'addresses.save': 'Opslaan',
  'addresses.cancel': 'Annuleren',
  'addresses.add': 'Toevoegen',
  'addresses.save.reason': 'Typ het nieuwe adres, zoals naam@example.org.',
  'addresses.add.reason': 'Typ het oude en het nieuwe adres, elk zoals naam@example.org.',
  'addresses.notSaved': 'Niet opgeslagen:',
  'addresses.where': "Gebruikt in contacten, agenda's, taken en deelrechten. Mail wordt nooit gewijzigd.",
  'addresses.fromFile': 'Deze komen uit {file} en worden in dat bestand gewijzigd.',
  'addresses.table.heading': 'Adreswijzigingen',
  'addresses.table.old': 'Oud adres',
  'addresses.table.new': 'Nieuw adres',
  'addresses.table.person': 'Persoon',
  'addresses.table.setBy': 'Ingesteld door',
  'addresses.table.nobody': 'Niemand',
  'addresses.peopleFailed': 'De personen konden niet worden gelezen, dus een adreswijziging kan nog niet aan een persoon worden gekoppeld.',
  'addresses.theOld': 'het oude adres',
  'addresses.whereMore': 'Waar een nieuw adres komt, en waar niet',
  'addresses.theNew': 'het nieuwe adres',
  'addresses.mapping.used': "Uw nieuwe adres wordt gebruikt in contacten, agenda's en taken",
  'addresses.mapping.lastPass': 'Gewijzigd in de laatste ronde: {count}',
  'addresses.mapping.apply': 'De nieuwe adressen hier ook toepassen',
  'addresses.mapping.apply.line':
    'Dit gegevenstype is al overgestapt, dus een wijziging in de adreswijzigingen wacht op deze knop. Kopieën die iemand in het nieuwe systeem heeft bewerkt, blijven zoals ze zijn.',
  'addresses.mapping.applying': 'Bezig met toepassen…',
  'addresses.mapping.applied': 'De volgende ronde past de nieuwe adressen hier toe.',
  'addresses.confirmedList.changed': 'Klopt, met uw nieuwe adres',
  'addresses.confirmedList.changedCount': 'Kopieën met een nieuw adres: {count}',
  'addresses.confirmedList.olderCount': 'Kopieën van vóór de laatste adreswijziging: {count}',
  'addresses.sharing.fromTable': 'Uit uw adreswijzigingen',
  'addresses.grant.yours': 'Uw nieuwe adres: {new}. Klopt dat?',
  'addresses.grant.yes': 'Ja, dat klopt',
  'addresses.grant.confirmed': 'Bevestigd: {new}.',
  'addresses.grant.returned': 'Teruggestuurd. Wie het heeft ingesteld, past het aan.',
};
