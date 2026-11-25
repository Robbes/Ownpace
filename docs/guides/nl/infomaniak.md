# Infomaniak — mail, agenda's, contacten en taken in één account

De kaart **Infomaniak** is één account bij Infomaniak: mail, agenda's, contacten en takenlijsten. Bestanden horen er niet bij: kDrive is via WebDAV bereikbaar op een eigen adres voor elke drive, dat Infomaniak niet bij elk abonnement aanbiedt, en deze dienst schrijft er nog niet naartoe. Deze dienst meldt zich aan met twee aanmeldingen, omdat mail bij Infomaniak een eigen aanmelding heeft; er is geen knop om toestemming te geven.

De servers en aanmeldingen hieronder zijn de servers en aanmeldingen die Infomaniak beschrijft op zijn helppagina's, gelezen op 19 november 2026: [de mailinstellingen](https://www.infomaniak.com/fr/support/faq/2427/synchroniser-les-e-mails-sur-tous-vos-equipements), [een wachtwoord voor een mailadres](https://www.infomaniak.com/fr/support/faq/1321/ajouter-un-appareil-creer-un-mot-de-passe-mail-depuis-le-service-mail), [app-wachtwoorden](https://www.infomaniak.com/fr/support/faq/2855/gerer-les-mots-de-passe-dapplication) en [agenda's en contacten](https://www.infomaniak.com/fr/support/faq/1544/synchroniser-contacts-calendar-apps-ios-manuellement-en-carddavcaldav). Die links gaan naar de Franse pagina's. Infomaniak biedt dezelfde pagina's in het Engels aan, en de Nederlandse versie toont de Engelse tekst; de namen van schermen en knoppen van Infomaniak staan hieronder zoals de Engelse pagina's ze schrijven.

## Wat u nodig hebt {#before}

- Een Infomaniak-account, met het mailadres waar de mail naartoe gaat, en ruimte voor wat eraan komt. Deze dienst maakt zelf geen accounts aan.
- De synchronisatie-aanmelding van het account, voor agenda's, contacten en taken. De agenda's en contacten van Infomaniak horen bij uw Infomaniak-account, niet bij een mailadres. De gebruikersnaam is kort, zoals AB12345: open [config.infomaniak.com](https://config.infomaniak.com), kies een ander apparaat dan iOS, zoals Linux, daarna **Contacts** of **Calendars**, en open het tabblad voor handmatige synchronisatie; daar staat hij. Het wachtwoord is een app-wachtwoord als verificatie in twee stappen aanstaat: druk in de Manager onder **Application passwords** op **Generate an application password** en kopieer het, want het wordt één keer getoond. Zonder verificatie in twee stappen is het uw Infomaniak-wachtwoord.
- De eigen aanmelding van de mailbox, als er mail meegaat. Mail meldt zich bij Infomaniak apart aan, met het volledige e-mailadres en een wachtwoord dat voor dat adres is gemaakt; een app-wachtwoord werkt niet voor mail. In de Manager: **Mail Service**, het domein, het adres, het tabblad **Devices**, daarna **Add a device**, en kies **No user**. Infomaniak toont het wachtwoord één keer, minstens 16 tekens lang, dus kopieer het meteen; u kunt het daar later wijzigen. Voor een my kSuite-adres verwijst de pagina van Infomaniak hiervoor naar [een andere handleiding](https://faq.infomaniak.com/2904).
- De keuze of er ook mail meegaat. Alleen dan zijn de mailserver en de aanmelding van de mailbox nodig; agenda's, contacten en taken hebben ze geen van beide nodig.

## Koppelen {#connect}

### Infomaniak {#infomaniak}

Kies bij **Waar gaat het naartoe?** **Infomaniak toevoegen** onder **Een nieuw account**, in elke rij waarvan de gegevens daarheen gaan: e-mail, agenda's, contacten of taken. Eén formulier voegt het account voor allemaal toe. De servers zijn al ingevuld, ingeklapt onder **Serverinstellingen (ingevuld voor Infomaniak)**, met de regel **Vooraf ingevuld met de gepubliceerde instellingen van Infomaniak, gelezen op …. Test controleert deze.** Het zijn de waarden die Infomaniak publiceert, niet gemeten waarden: de test meet ze.

- **Host**: `sync.infomaniak.com`, de ene server die Infomaniak noemt voor agenda's en contacten.
- **Poort**: `443`. Infomaniak noemt de server zonder poort, en dat betekent de gewone poort voor een beveiligde verbinding.
- **Mailserver**: `mail.infomaniak.com`. Alleen nodig als dit account ook e-mail gaat ontvangen.
- **Mailpoort**: `993`.

Laat ze staan, tenzij Infomaniak u andere waarden opgeeft. Gaat er mail mee, laat de **Mailserver** dan ingevuld: de test bewaart het account met wat er in de vakken staat. Vul daarna zelf in:

1. **Gebruikersnaam**: de synchronisatiegebruikersnaam, zoals AB12345, in hoofdletters zoals Infomaniak hem toont. Niet uw e-mailadres.
2. **Wachtwoord**: het app-wachtwoord, of uw Infomaniak-wachtwoord als verificatie in twee stappen uitstaat.
3. **Adres van de mailbox**: het volledige e-mailadres van de mailbox. Alleen als er mail meegaat.
4. **Wachtwoord van de mailbox**: het wachtwoord dat voor dat adres is gemaakt op het tabblad **Devices**. Alleen als er mail meegaat; een app-wachtwoord wordt hier geweigerd.
5. Druk op **Aanmelding controleren**.

Vul beide mailboxvakken in, of geen van beide: het ene zonder het andere wordt geweigerd, omdat het nergens mee kan aanmelden. Er is geen vakje voor SSL/TLS: deze dienst gebruikt het altijd, voor agenda's, contacten en taken en voor mail. Laat **DAV-basis-URL** leeg: Infomaniak noemt de server en geen pad, en stuurt een agenda-app die vraagt waar de agenda's staan naar zijn eigen adres, en daar zoekt deze dienst ook. Mislukt de test op een server, dan opent **Serverinstellingen** vanzelf.

De test schrijft niets. Hij meldt zich met de synchronisatie-aanmelding aan bij de agenda's en meet daarnaast elk deel van het account apart, de mail met de aanmelding van de mailbox: wat het account omvat staat achter **Omvat:**, en wat hij vond achter **Gevonden:**. Bestanden staan er als niet omvat, met de reden.

U kunt het account ook vooraf toevoegen, onder **Accounts** → **Account toevoegen**: kies bij **Bron of bestemming?** **Bestemmingen**, dan de kaart **Infomaniak**, en druk op **Toevoegen en testen**. De vakken zijn daar op dezelfde manier vooraf ingevuld, open in beeld.

## Als het account van iemand anders is {#somebody-else}

Is het account van een collega, een familielid of een klant, dan hebt u diens wachtwoord niet nodig. Kies in **Migratie starten**, bij **Wie meldt zich aan bij de accounts?**, voor **Anderen, met een link**. Vul de server en het account in, laat het wachtwoord leeg, en druk op **Bewaren voor** *die persoon*. De stap voor de bestemming vraagt **Van wie is het account bij …?**: kies *van die persoon zelf*, en die verbindt het met de link. Die persoon typt het wachtwoord zelf, op de pagina die uw toegangslink opent: die noemt de server waarbij het wachtwoord wordt gecontroleerd, test het voordat er iets wordt bewaard, en niemand ziet het daarna nog, u ook niet. Na vijf verkeerde wachtwoorden is dat account voor die link geblokkeerd; een nieuwe link begint opnieuw. De pagina vraagt om het wachtwoord van de synchronisatie-aanmelding en het eigen wachtwoord van de mailbox; een app-wachtwoord wordt voor mail geweigerd.

## Wat er meegaat {#what-moves}

- **E-mail**, wanneer het account is bewaard met de **Mailserver**, het **Adres van de mailbox** en het **Wachtwoord van de mailbox** ingevuld: de mappen en de berichten daarin, geschreven in de mailbox.
- **Agenda**, **Contacten** en **Taken**. Een taak in de agenda van Infomaniak hoort bij een agenda, dus takenlijsten zijn agenda's die taken bevatten, op dezelfde server als uw agenda's.
- Elke afspraak en taak wordt geschreven met een markering, `SCHEDULE-AGENT=CLIENT`, die de server vraagt er geen uitnodigingen voor te versturen. Deelnemers en organisator blijven in uw kopie van elke afspraak staan. Een server die de markering negeert, kan toch uitnodigingen versturen. Infomaniak zegt niet wat zijn agendaserver met de markering doet, en een verstuurde uitnodiging is niet terug te halen.
- **Bestanden** gaan niet naar Infomaniak: bij **Waar gaat het naartoe?** biedt de rij voor bestanden het niet aan. Deze dienst schrijft bestanden via WebDAV, en het WebDAV-adres van kDrive is voor elke drive een eigen adres, dat Infomaniak niet aanbiedt bij kSuite Free, kSuite Standard, my kSuite of my kSuite+ ([kDrive via WebDAV](https://www.infomaniak.com/fr/support/faq/2409/se-connecter-a-kdrive-par-webdav)). Uw bestanden kunnen in dezelfde migratie naar een andere bestemming.
- Een migratie mag vaker lopen: wat al in het doel staat, wordt herkend en niet nog eens gemigreerd.

## Als de test iets meldt {#when-test-says}

Wat Infomaniak zelf antwoordt, toont deze dienst woordelijk, in de taal van de server.

- **`PROPFIND failed with status 401`** bij agenda's of contacten: Infomaniak weigert de synchronisatiegebruikersnaam of het wachtwoord daarvan. Controleer dat de gebruikersnaam de korte is van config.infomaniak.com, zoals AB12345, en niet uw e-mailadres, en dat het wachtwoord een app-wachtwoord is als verificatie in twee stappen aanstaat.
- Een weigering van de mailserver, bijvoorbeeld met `AUTHENTICATIONFAILED`: het adres of het wachtwoord van de mailbox werkt niet voor mail. Het wachtwoord moet het wachtwoord zijn dat op het tabblad **Devices** van het adres is gemaakt: een app-wachtwoord wordt voor mail geweigerd, en uw Infomaniak-wachtwoord ook.
- Geen agenda's of adresboeken gevonden, terwijl het account ze wel heeft: de configuratie-assistent van Infomaniak toont er een uitgebreider adres voor, en de [Thunderbird-pagina](https://www.infomaniak.com/fr/support/faq/2046/synchroniser-contacts-calendriers-thunderbird-app-desktop-en-carddavcaldav) van Infomaniak legt uit waar. Vul het in bij **DAV-basis-URL**.
- **E-mail** met daarachter **This account stores no mail login, so mail was not measured**: het account is bewaard zonder **Adres van de mailbox** en **Wachtwoord van de mailbox**. Druk op de pagina **Accounts** bij het account op **Inloggegevens vervangen** en vul beide in, naast de synchronisatie-aanmelding.
- **E-mail** met daarachter **This account stores no mail server address**: het account is bewaard zonder **Mailserver**. Een account dat zonder **Mailserver** is bewaard, omvat geen mail, en een migratie met **E-mail** aangevinkt mislukt erop zodra die loopt, met **This infomaniak connection stores no mail server, so its mail face cannot be built**. Verwijder die migratie onder **Migraties**, daarna het account onder **Accounts**, en begin opnieuw met de **Mailserver** ingevuld. Agenda's, contacten en taken hebben geen mailserver nodig, dus een migratie zonder **E-mail** kan op dat account blijven.
- **Geen antwoord binnen 20 seconden.** De test zegt dat.
- **Een mislukte test begint opnieuw.** **Opnieuw proberen** haalt het account weg dat de mislukte test bewaarde en opent het formulier weer met wat u typte, zodat verbeterde servers en poorten getest worden zoals getypt. Verwijder op de pagina **Accounts** het account dat mislukte, en voeg het opnieuw toe.

## Stoppen {#leaving}

- Een migratie verwijdert u onder **Migraties**. De bevestiging zegt wat dat doet: **Verwijdert enkel instellingen en registratie van uw migratie in Ownpace, niets bij uw bron of bestemming.** Wat al gemigreerd is, blijft bij Infomaniak staan.
- Een account verwijdert u onder **Accounts** met **Verwijderen**. Daarmee verdwijnt de kopie van beide aanmeldingen bij deze dienst. De wachtwoorden zelf blijven bij Infomaniak geldig, en het scherm zegt dat ook: **Wij hebben onze kopie verwijderd; deze aanbieder biedt geen manier om intrekking door ons te forceren.**
- Trek ze daarom bij Infomaniak in, elk apart: het app-wachtwoord in de Manager onder **Application passwords**, en het wachtwoord van de mailbox op het tabblad **Devices** van het adres. De andere apparaten van het adres blijven werken. Staat verificatie in twee stappen uit, dan was de synchronisatie-aanmelding uw Infomaniak-wachtwoord zelf: wijzig het om die te beëindigen.
