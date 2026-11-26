// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE INFORMAL LAYER: A PERSON'S OWN PAGES, WITH *JE* (workplan 0176 T7, §11;
 * the owner, 2026-11-26: *"Yes"* to *je* or *u* as the member chooses, and
 * D8 (a), per person).
 *
 * A member chooses, per person, how a person's own pages speak to them:
 * Dutch with *u*, Dutch with *je*, or English. A mother may be *je* and a
 * grandfather *u* in one family. This is the *je*: the twin of every Dutch
 * sentence a person's link page and progress page say to the reader with *u*
 * or *uw*, and of nothing else. A sentence that needs no *u* has no twin
 * (*Leg dit klaar*, *Er is geen haast*, §6): the Dutch says it in both.
 * English has one *you*, and no layer.
 *
 * **Not an area.** It defines no key of its own: each key is a Dutch area's,
 * and the page reads this first when the register is informal, then the
 * Dutch. So it is not composed into `../strings.ts`
 * (`../one-area-per-key.unit.test.ts` leaves it out), and it is the
 * dictionary, not a speaker of it (`../a-word-nobody-says.unit.test.ts`).
 *
 * **How a twin is made (§15's pattern).** *U* becomes *je*, and *uw* becomes
 * *je*; *jouw* only where it carries stress, as in a contrast (*van jouw oude
 * aanbieder, niet van ons*). Where *je* needs more, only that changes: a verb
 * before *je* loses its *-t* (*kunt u* → *kun je*, *gaat u* → *ga je*); the
 * reflexive *zich* after *u* is *je* (*u zich aanmeldt* → *je je aanmeldt*);
 * a *u* that means two people is *jullie* (*als u elkaar ziet* → *als jullie
 * elkaar zien*). Nothing else in a sentence changes, so the owner reads the
 * same sentence twice, and a twin stays the twin of its sentence:
 * `../every-u-has-its-je.unit.test.ts` holds both to that.
 *
 * **A draft until T7's main line.** Nothing reads this yet. The main line
 * stores the register per person, sends it with the link's answer, and has
 * `../index.tsx` read this first for a person whose register is *je*, and
 * `../active-locale.ts` too, which words the answers a report can meet. The
 * server's own sentences on these pages, and its endings after a sign-in,
 * are the main line's as well. The Dutch below is step A's, which the owner
 * read on 2026-11-26 (*"Step A (#2180): ok"*), turned to *je*; the owner
 * reads the twins in their pull request.
 */

import type { StringKey } from '../strings.ts';

export const nl: Readonly<Partial<Record<StringKey, string>>> = {
  // A link that could not be read (app.ts).
  'link.unreachable': 'Deze pagina kon de server niet bereiken. Controleer je verbinding en probeer het opnieuw.',
  'link.unreadable':
    'Er ging iets mis op deze pagina. Probeer het later opnieuw; blijft het misgaan, vraag dan de persoon die je de link stuurde om contact op te nemen met support.',

  // What a report can meet, and the progress page (migrations.ts).
  'answer.fault':
    'Er ging bij ons iets mis, niet door iets wat je invoerde. Probeer het zo opnieuw. Referentie {reference}: noem die als je contact met ons opneemt.',
  'answer.unreachable': 'De dienst was niet bereikbaar. Controleer je verbinding en probeer het opnieuw.',
  'view.state.cutover': 'Je gebruikt nu je nieuwe account.',
  'view.state.continuous': 'Wat nieuw binnenkomt op je oude account, wordt ook nog gekopieerd.',
  'view.failure.authExpired': 'De koppeling met je account moet worden vernieuwd. Wie dit heeft ingesteld kan dat.',
  'view.failure.rateLimited': 'Je aanbieder vroeg ons (automatisch) rustiger aan te doen. Dit gaat vanzelf verder.',
  'view.failure.policyRefused':
    'Sommige items zijn niet gekopieerd door de instellingen van deze kopie, niet door je accounts.',
  'view.failure.internalAddress':
    'Deze dienst maakt geen verbinding met het adres dat voor een van je accounts is opgegeven. Wie dit heeft ingesteld kan het aanpassen.',
  'view.failure.sourceRefused': 'Je oude omgeving gaf sommige items niet vrij. Deze gingen niet naar je nieuwe omgeving.',
  'view.failure.targetRefused': 'Je nieuwe account kon sommige items niet in ontvangst nemen.',
  'view.failure.formatRefused':
    'Je nieuwe omgeving accepteert bepaalde bestandstypen niet. Wie dit uitvoert kan de indeling mogelijk aanpassen.',
  'view.failure.side.source': 'Het ging om je oude account.',
  'view.failure.side.target': 'Het ging om je nieuwe account.',
  'view.readOnly': 'Deze pagina toont alleen aantallen; er staat niets uit je account op.',
  'view.state.destinationRemoved':
    'Het wachtwoord voor {destination} is op {date} verwijderd, dus het kopiëren wacht. Aan je {source}-account is niets veranderd, en er is niets gewist. Wie dit voor je heeft ingesteld, kan je een nieuwe link sturen.',
  'view.grant.title': 'De toegang die je gaf',
  'view.grant.wholeApp': 'Google beëindigt alles wat je Ownpace toestond. Al het kopiëren uit dit account stopt dan.',
  'view.stopped.nothingToDo': 'Je hoeft niets te doen.',
  'view.person.who':
    '{who} kopieert je e-mail, agenda en bestanden naar een nieuwe aanbieder. Op deze pagina zie je hoe ver dat is.',
  'view.person.first.nothingToDo': 'Je hoeft nu niets te doen. Je mag deze pagina sluiten.',
  'view.person.first.renew': 'De verbinding met je {provider}-account is gestopt. {who} kan je een nieuwe link sturen.',
  'view.person.account.only': 'Je {provider}-account',
  'view.person.account.only.inSentence': 'je {provider}-account',
  'view.person.others': 'Je andere accounts',
  'view.person.grant.body': '{organisation} leest dit {provider}-account voor het kopiëren hierboven, omdat je dat toestond.',
  'view.person.pause.ceiling.why':
    'Deze limiet is van jouw oude aanbieder, niet van ons. Als wij daar overheen gaan, kan dat je ongeveer een dag buitensluiten uit je eigen mailbox. Daarom stopt het kopiëren al eerder. Er is niets misgegaan en er gaat niets verloren: de volgende keer kopiëren gaat verder waar deze stopte.',
  'view.destination.title': 'Je account bij {provider}',
  'view.destination.body':
    'Je hebt dit account met je eigen wachtwoord verbonden, zodat je gegevens erin gekopieerd kunnen worden.',
  'view.destination.whatHappens':
    'Verwijderen wist je wachtwoord hier, en er wordt niets meer naar dit account gekopieerd tot je het opnieuw verbindt. Wat al gekopieerd is, blijft daar staan.',
  'view.destination.drive': 'De verbinding met Cirrux Drive die je gaf, wordt mee verwijderd.',
  'view.destination.driveRemoved':
    'Je verbinding met Cirrux Drive is hier ook verwijderd. Cirrux Mail toont de apps die je toestond onder Settings → Security; daar kun je die ook beëindigen.',

  // The link page, its provider's words, the password card and Report this link (grant.ts).
  'grant.title': 'Verbind je account',
  'grant.reads.email': 'je e-mail: berichten, mappen en labels',
  'grant.reads.calendar': 'je agenda’s en de afspraken daarin',
  'grant.reads.contact': 'je contactpersonen',
  'grant.reads.file': 'je bestanden in Google Drive',
  'grant.reads.task': 'je taken',
  'grant.reads.file.other': 'je bestanden',
  'grant.readOnly':
    'Alleen lezen. Er wordt nooit iets verwijderd of gewijzigd in je account, en niemand — niet de organisatie, niet Ownpace — ziet je wachtwoord. Je logt zelf in bij Google, op de pagina van Google zelf.',
  'grant.scopeIntro': 'De toestemming die Google je vraagt:',
  'grant.scope.mail': 'Gmail: al je e-mail lezen, verzenden en definitief verwijderen.',
  'grant.scope.calendar': 'Google Agenda: al je agenda’s bekijken, wijzigen, delen en verwijderen.',
  'grant.scope.calendarReadOnly': 'Google Agenda: al je agenda’s bekijken en downloaden.',
  'grant.scope.contacts': 'Google Contacten: je contactpersonen bekijken, wijzigen en verwijderen.',
  'grant.scope.drive': 'Google Drive: al je bestanden bekijken, wijzigen, maken en verwijderen.',
  'grant.scope.driveReadOnly': 'Google Drive: al je bestanden bekijken en downloaden.',
  'grant.scope.tasks': 'Google Tasks: je taken bekijken, wijzigen en verwijderen.',
  'grant.scope.tasksReadOnly': 'Google Tasks: je taken bekijken.',
  'grant.scope.account': 'Je Google-account: met welk account je je aanmeldt, en het e-mailadres ervan.',
  'grant.signInAs': 'Log in als {account}. Google deelt je adres ter controle; andere accounts worden geweigerd.',
  'grant.inAppBrowser':
    'Is deze pagina geopend in een andere app, zoals een chat- of mailapp? Kies daar \'Openen in browser\' of kopieer de link naar je favoriete browser, zoals Firefox, Safari of Chrome. De link blijft werken.',
  'grant.person.connected': 'Verbonden. Voor dit account hoef je niets meer te doen.',
  'grant.person.again': 'Dit account was al verbonden. {who} vraagt je het opnieuw te verbinden.',
  'grant.reads.file.microsoft': 'je bestanden in OneDrive',
  'grant.readOnly.microsoft':
    'Alleen lezen. Er wordt nooit iets verwijderd of gewijzigd in je account, en niemand — niet de organisatie, niet Ownpace — ziet je wachtwoord. Je logt zelf in bij Microsoft, op de pagina van Microsoft zelf.',
  'grant.scopeIntro.microsoft': 'De toestemming die Microsoft je vraagt:',
  'grant.scope.microsoft.mail': 'Outlook: je e-mail lezen.',
  'grant.scope.microsoft.calendar': 'Outlook-agenda: je agenda’s lezen.',
  'grant.scope.microsoft.contacts': 'Outlook-contactpersonen: je contactpersonen lezen.',
  'grant.scope.microsoft.files': 'OneDrive: je bestanden lezen.',
  'grant.scope.microsoft.tasks': 'Microsoft To Do: je taken lezen.',
  'grant.scope.microsoft.account': 'Je Microsoft-account: je aanmelden, en je profiel en adressen lezen.',
  'grant.scope.microsoft.offline': 'Deze toegang houden terwijl je weg bent, tot je die intrekt.',
  'grant.signInAs.microsoft':
    'Log in als {account}. Microsoft bevestigt met welk account je je aanmeldt; andere accounts worden geweigerd.',
  'grant.person.yourPage':
    'Hier is je eigen pagina. Bewaar deze. Die laat zien hoe ver het kopiëren is, en niets uit je account:',
  'grant.person.keepIt':
    'Bewaar deze link: zet hem bij je favorieten of kopieer hem naar een veilige plek. Hij werkt de komende 90 dagen, en wie je de link stuurde, kan hem op elk moment uitzetten.',
  'grant.cirrux.drive':
    'Je bestanden gaan naar Cirrux Drive, en daarvoor is je eigen aanmelding bij Cirrux nodig, niet het app-wachtwoord. Je meldt je zelf aan bij Cirrux, op de pagina van Cirrux zelf.',
  'grant.cirrux.signInAs': 'Meld je bij Cirrux aan met het account waar {account} bij hoort.',
  'grant.reads.file.dropbox': 'je bestanden in Dropbox',
  'grant.readOnly.dropbox':
    'Alleen lezen. Er wordt nooit iets verwijderd of gewijzigd in je Dropbox, en niemand — niet de organisatie, niet Ownpace — ziet je wachtwoord. Je logt zelf in bij Dropbox, op de pagina van Dropbox zelf.',
  'grant.scopeIntro.dropbox': 'De toestemming die Dropbox je vraagt:',
  'grant.scope.dropbox.files': 'Dropbox: je bestanden lezen.',
  'grant.scope.dropbox.account': 'Je Dropbox-account: je naam, je e-mailadres en je gebruikte ruimte lezen.',
  'grant.signInAs.dropbox':
    'Log in als {account}. Dropbox bevestigt met welk account je je aanmeldt; andere accounts worden geweigerd. Biedt Dropbox een ander account aan, meld je daar dan eerst af.',
  'grant.disclosure': 'Door door te gaan ga je akkoord met hoe je gegevens worden verwerkt:',
  'grant.group.from': 'De accounts waaruit je gegevens worden gekopieerd',
  'grant.group.to': 'De accounts waarnaar je gegevens worden gekopieerd',
  'grant.person.allConnected': 'Alle accounts zijn verbonden. Je kunt deze pagina sluiten.',
  'grant.person.title': '{who} vraagt je toestemming',
  'grant.person.whatOne': '{who} wil je {what} kopiëren van {source} naar {destination}.',
  'grant.person.whatMany': '{who} wil je {what} kopiëren. Op het volgende scherm staat waarvandaan en waarnaartoe.',
  'grant.person.told': 'Heeft {who} je zelf over deze link verteld?',
  'grant.person.wait.ask':
    'Vraag het eerst aan {who}, op een manier die je vertrouwt. Bel het nummer dat je al hebt. Of vraag het als jullie elkaar zien.',
  'grant.person.wait.unknown': 'Ken je {who} niet? Sluit dan deze pagina. Je kunt deze link ook melden.',
  'grant.person.accounts.title': 'Je accounts',
  'grant.person.ready.password': 'Het wachtwoord van je {provider}-account.',
  'grant.person.ready.typeIt': 'Je typt het alleen op de pagina van {provider} zelf. Ownpace ziet het nooit. {who} ook niet.',
  'grant.person.ready.phone': 'Je telefoon. {provider} kan daar een code naartoe sturen.',
  'grant.person.ready.unknownPassword': 'Weet je het wachtwoord niet? Stop dan hier, en doe dit samen met {who}.',
  'grant.person.see.title': 'Dit zie je straks bij {provider}',
  'grant.person.see.signIn': '{provider} vraagt je in te loggen.',
  'grant.person.see.onlyHere':
    'Doe dit alleen hier, omdat {who} het je zelf heeft verteld. Bij elke andere waarschuwing stop je.',
  'grant.person.see.blocked':
    'Laat Google de verbinding niet toe? Dan staat dit adres nog niet op de lijst van Google. Sluit de pagina en vertel het {who}. Je hebt niets fout gedaan.',
  'grant.person.see.stop': 'Je kunt dit altijd weer stoppen, op de pagina die je hierna krijgt.',
  'grant.person.see.next': 'De volgende stap doe je op de pagina van {provider} zelf.',
  'grant.person.ratherNot.body':
    'Er is niets gebeurd. Je kunt deze pagina sluiten, of later terugkomen: de link werkt tot {date}.',
  'grant.password.title': 'Verbind {account} met je wachtwoord',
  'grant.password.server':
    'Je wachtwoord wordt gecontroleerd bij {server}. Typ het alleen als dit de server van je eigen aanbieder is.',
  'grant.password.published': 'Je wachtwoord wordt gecontroleerd bij de eigen server van {provider}, {server}.',
  'grant.password.withdrawn':
    'Hier verwijderd. Verwijder of wijzig dit wachtwoord ook bij {provider} als je het zeker wilt weten.',
  'grant.password.notAddressMail':
    'Deze server hoort niet bij de mail van je adres, voor zover wij kunnen zien. Typ je wachtwoord alleen als je zeker weet dat het de server van je aanbieder is.',
  'grant.password.never': 'Ownpace mailt je nooit een link en vraagt nooit per e-mail of telefoon om je wachtwoord.',
  'grant.password.noPhone':
    '{organisation} heeft geen telefoonnummer opgegeven. Weet je niet zeker of deze link van {askedBy} komt? Vraag het dan op een andere manier voordat je iets typt.',
  'grant.password.appPassword': 'Gebruik een app-wachtwoord als je aanbieder dat biedt.',
  'grant.password.connected': 'Verbonden. Je wachtwoord werkt en is versleuteld bewaard.',
  'grant.password.refused.app': 'Controleer of het een app-wachtwoord is, niet het wachtwoord waarmee je inlogt.',
  'grant.password.unreachable':
    '{server} was niet bereikbaar. Dat ligt niet aan je wachtwoord. Probeer het over een paar minuten opnieuw. Blijft het gebeuren, laat het dan {askedBy} weten.',
  'grant.password.faceMissing': 'Je wachtwoord werkt, maar {server} geeft geen toegang tot: {faces}.',
  'grant.apple.how.more':
    'Meld je aan op account.apple.com. Kies Inloggen en beveiliging, dan App-specifieke wachtwoorden. Maak er een, noem het Ownpace en typ het hier. Apple toont het maar één keer.',
  'grant.nextcloud.how.more':
    'Open je Nextcloud in de browser. Ga naar Instellingen, Beveiliging, Apparaten & sessies. Typ een naam zoals Ownpace, druk op Creëer een nieuw app wachtwoord en typ hier het wachtwoord dat Nextcloud toont.',
  'linkReport.intro': 'Je melding gaat naar het Ownpace-supportteam, niet naar {organisation}.',
  'linkReport.description': 'Waarom twijfel je aan deze link?',
  'linkReport.replyTo': 'Je e-mailadres (niet verplicht)',
  'linkReport.replyTo.hint': 'Alleen zodat wij op je melding kunnen antwoorden.',
  'linkReport.sentWith':
    'Meegestuurd, uit onze gegevens: welke link dit is; de organisatie en het kopiëren waar hij bij hoort, en hoe ver dat is; het adres van wie de link heeft gemaakt; het account waaruit wordt gekopieerd en het account waarnaar; en of je toegang hebt gegeven.',
  'linkReport.sent': 'Verstuurd. Je melding heeft nummer {ticket}, en we antwoorden naar {email}.',
  'linkReport.sent.anonymous': 'Verstuurd. Je melding heeft nummer {ticket}. Zonder mailadres kunnen we je niet antwoorden.',
  'linkReport.sent.mail.anonymous':
    'Verstuurd naar ons supportteam, met meldingskenmerk {reference}. Zonder mailadres kunnen we je niet antwoorden.',
  'linkReport.next.grant': 'Er wordt niets gelezen zonder je toestemming.',
  'linkReport.next.withdraw': 'Wil je het kopiëren nu stoppen? Druk dan hierboven op Kopiëren stoppen.',

  // The person's new address, on both pages (addresses.ts).
  'addresses.grant.yours': 'Je nieuwe adres: {new}. Klopt dat?',
  'addresses.view.readOnly':
    'Deze pagina toont aantallen, en het nieuwe adres dat voor je is ingesteld; er staat niets uit je account op.',
};
