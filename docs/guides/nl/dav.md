# CalDAV, CardDAV en WebDAV — agenda's, contacten en bestanden op een server

Drie kaarten voor drie soorten gegevens, met dezelfde velden: **CalDAV** voor agenda's en takenlijsten, **CardDAV** voor contacten en **WebDAV** voor bestanden. Veel servers bieden alle drie aan onder één account. Elke kaart draagt alleen haar eigen soort, dus elke soort gaat naar haar eigen kaart, en **Migratie starten** maakt voor elk een migratie. Is uw server een Nextcloud, dan combineert de kaart **Nextcloud** de drie in één account: zie [de Nextcloud-handleiding](nextcloud.md). Deze dienst meldt zich aan met een gebruikersnaam en een wachtwoord; er is geen knop om toestemming te geven.

## Wat u nodig hebt {#before}

- Een account op de doelserver dat al bestaat, met genoeg ruimte voor wat eraan komt. Deze dienst maakt zelf geen accounts aan.
- De naam van de server en de poort, of het volledige adres als de DAV-root van de server niet op de hostroot staat.
- De gebruikersnaam van het account en een wachtwoord. Gebruik waar de server dat aanbiedt een app-specifiek wachtwoord in plaats van de gewone login: dat kan ingetrokken worden zonder het wachtwoord van de persoon te wijzigen.

## Koppelen {#connect}

Bij **Waar gaat het naartoe?** heeft elke soort gegevens een eigen rij. Kies in de lijst van de rij, onder **Een nieuw account**, **CalDAV toevoegen** voor agenda's en taken, **CardDAV toevoegen** voor contacten of **WebDAV toevoegen** voor bestanden; het formulier van de kaart opent onder de rijen. De drie kaarten vragen dezelfde velden; [De velden](#fields) hieronder zegt wat in elk vak hoort. Druk daarna op **Aanmelding controleren**; daarmee wordt het account getest. De test schrijft niets: hij meldt zich aan en toont wat het account draagt (**Draagt:**) en wat hij vond (**Gevonden:**).

### CalDAV {#caldav}

Voor agenda's en takenlijsten. Vul **Host**, **Poort**, **Gebruikersnaam** en **Wachtwoord** in zoals onder [De velden](#fields) staat. De test zoekt de agenda's van het account op vanaf de server. De migratie schrijft nieuwe agenda's onder het adres van de server, of onder **DAV-basis-URL** als die is ingevuld, in `calendars/` met de gebruikersnaam erachter: de indeling die Nextcloud gebruikt. Op een server die zijn agenda's elders bewaart, kan de test slagen en het schrijven van de migratie toch mislukken.

### CardDAV {#carddav}

Voor contacten. Vul **Host**, **Poort**, **Gebruikersnaam** en **Wachtwoord** in zoals onder [De velden](#fields) staat. De test zoekt de adresboeken van het account op vanaf de server. De migratie schrijft nieuwe adresboeken onder het adres van de server, of onder **DAV-basis-URL** als die is ingevuld, in `addressbooks/users/` met de gebruikersnaam erachter: de indeling die Nextcloud gebruikt. Op een server die zijn adresboeken elders bewaart, kan de test slagen en het schrijven van de migratie toch mislukken.

### WebDAV {#webdav}

Voor bestanden. Vul **Host**, **Poort**, **Gebruikersnaam** en **Wachtwoord** in zoals onder [De velden](#fields) staat. WebDAV kent geen vaste indeling: de bestanden komen in de map waar het adres naartoe leidt. Met alleen een host en een poort is dat de hoofdmap van de server. Horen ze in de bestanden van uw eigen account, vul dan het volledige WebDAV-adres van die map in bij **DAV-basis-URL**. Een Nextcloud toont dat adres onderaan de pagina met bestandsinstellingen; voor een Nextcloud is [de kaart Nextcloud](nextcloud.md) eenvoudiger.

### De velden {#fields}

- **Host**: de naam van de server, zoals `dav.example.com`: alleen de naam, zonder `https://` ervoor.
- **Poort**: `443` voor de meeste servers; het vak toont dat als voorbeeld. Typ het in, of de poort die uw server gebruikt. Er is geen vakje voor SSL/TLS: deze dienst spreekt de server altijd aan via `https://`.
- **DAV-basis-URL**, onder **Serverinstellingen** bij **Waar gaat het naartoe?**: alleen wanneer de DAV-root van de server niet op de hostroot staat. Indien ingevuld wordt deze volledige URL gebruikt en worden host en poort genegeerd.
- **Gebruikersnaam** en **Wachtwoord**: die van het account op de server, met een app-wachtwoord waar de server dat aanbiedt.

U kunt het account ook vooraf toevoegen, onder **Accounts** → **Account toevoegen**: kies bij **Bron of doel?** **Doelen**, dan de kaart, en druk op **Toevoegen en testen**. **Waar gaat het naartoe?** biedt het dan aan onder **Uw accounts**. In de **Instelchecklist** staat de voorbereiding voor elk van de drie als lijst die onthoudt wat u al gedaan hebt.

## Wat er meegaat {#what-moves}

- **CalDAV**: agenda's met hun afspraken, en takenlijsten wanneer u bij **Wat wilt u migreren?** **Taken** aanvinkt. De test telt de takenlijsten die het account al heeft, achter **Gevonden:**.
- **CardDAV**: adresboeken en de contacten daarin.
- **WebDAV**: bestanden en de mappen waarin ze staan.
- Elke afspraak wordt geschreven met een markering, `SCHEDULE-AGENT=CLIENT`, die de server vraagt er geen uitnodigingen voor te versturen. Deelnemers en organisator blijven in uw kopie van elke afspraak staan. Een server die de markering negeert, kan toch uitnodigingen versturen.
- Elke rij bij **Waar gaat het naartoe?** biedt alleen de kaarten aan die haar gegevens aannemen, en waar een kaart die in de ene rij gekozen is de gegevens van een andere rij niet aanneemt, zegt die rij dat: *CalDAV neemt geen contacten aan.* E-mail gaat nooit naar een DAV-doel: daarvoor is er het IMAP- of JMAP-doel ([de IMAP-handleiding](imap.md), [de JMAP-handleiding](jmap.md)).
- Een migratie mag vaker lopen: wat al in het doel staat, wordt herkend en niet nog eens gekopieerd.

## Als de test iets meldt {#when-test-says}

Wat de server zelf antwoordt, toont deze dienst woordelijk, in de taal van de server; meestal is dat Engels.

- **`PROPFIND failed with status 401`**: de server weigert de gebruikersnaam of het wachtwoord. Controleer beide, en gebruik een app-wachtwoord als de server dat vraagt.
- **`PROPFIND failed with status`** met een ander getal, of **`Failed to discover calendar home set`** of **`Failed to discover address book home set`**: het adres leidt niet naar de agenda's, contacten of bestanden van dit account. Controleer **Host** en **Poort**, of vul bij **DAV-basis-URL** het volledige adres in.
- **Geen antwoord binnen 20 seconden.** De test zegt dat.
- **Een mislukte test begint opnieuw.** **Opnieuw proberen** haalt het account weg dat de mislukte test bewaarde en opent het formulier weer met wat u typte, zodat een verbeterde **Host**, **Poort** of **DAV-basis-URL** getest wordt zoals getypt. Verwijder op de pagina **Accounts** het account dat mislukte, en voeg het opnieuw toe.

## Stoppen {#leaving}

- Een migratie verwijdert u onder **Migraties**. De bevestiging zegt wat dat doet: **Verwijdert instellingen en registratie van de migratie; bij uw bron of bestemming wordt niets aangeraakt.** Wat al gekopieerd is, blijft in het doel staan.
- Een account verwijdert u onder **Accounts** met **Verwijderen**. Daarmee verdwijnt de kopie van het wachtwoord bij deze dienst. Het wachtwoord zelf blijft bij de server geldig, en het scherm zegt dat ook: **Wij hebben onze kopie verwijderd; deze aanbieder biedt geen intrekking die wij kunnen aanroepen.**
- Trek daarom het app-wachtwoord in bij de server, of wijzig het wachtwoord. Dat kan alleen de houder van het account.
