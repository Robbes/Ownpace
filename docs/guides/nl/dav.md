# CalDAV, CardDAV en WebDAV — agenda's, contacten en bestanden op een server

Drie kaarten voor drie soorten gegevens, met dezelfde velden: **CalDAV** voor agenda's en takenlijsten, **CardDAV** voor contacten en **WebDAV** voor bestanden. Veel servers bieden alle drie aan onder één account. Elke kaart draagt alleen haar eigen soort, dus per soort maakt u een eigen migratie. Is uw server een Nextcloud, dan combineert de kaart **Nextcloud** de drie in één verbinding: zie [de Nextcloud-handleiding](nextcloud.md). Deze dienst meldt zich aan met een gebruikersnaam en een wachtwoord; er is geen knop om toestemming te geven.

## Wat u nodig hebt {#before}

- Een account op de doelserver dat al bestaat, met genoeg ruimte voor wat eraan komt. Deze dienst maakt zelf geen accounts aan.
- De naam van de server en de poort, of het volledige adres als de DAV-root van de server niet op de hostroot staat.
- De gebruikersnaam van het account en een wachtwoord. Gebruik waar de server dat aanbiedt een app-specifiek wachtwoord in plaats van de gewone login: dat kan ingetrokken worden zonder het wachtwoord van de persoon te wijzigen.

## Koppelen {#connect}

Kies bij de stap Doel de kaart voor wat deze migratie meeneemt. De drie kaarten vragen dezelfde velden; [De velden](#fields) hieronder zegt wat in elk vak hoort. Druk daarna op **Verbindingen testen en bewaren**. De test schrijft niets: hij meldt zich aan en toont wat het account draagt (**Draagt:**) en wat hij vond (**Gevonden:**).

### CalDAV {#caldav}

Voor agenda's en takenlijsten. Vul **Host**, **Poort**, **Gebruikersnaam** en **Wachtwoord** in zoals onder [De velden](#fields) staat. Deze dienst zoekt de agenda's van het account zelf op, vanaf de server; **DAV-basis-URL** is alleen nodig als de DAV-root van de server niet op de hostroot staat.

### CardDAV {#carddav}

Voor contacten. Vul **Host**, **Poort**, **Gebruikersnaam** en **Wachtwoord** in zoals onder [De velden](#fields) staat. Deze dienst zoekt de adresboeken van het account zelf op, vanaf de server; ook hier is **DAV-basis-URL** alleen nodig als de DAV-root niet op de hostroot staat.

### WebDAV {#webdav}

Voor bestanden. Vul **Host**, **Poort**, **Gebruikersnaam** en **Wachtwoord** in zoals onder [De velden](#fields) staat. Anders dan bij CalDAV en CardDAV zoekt WebDAV niets op: de bestanden komen in de map waar het adres naartoe leidt. Met alleen een host en een poort is dat de hoofdmap van de server. Horen ze in de bestanden van uw eigen account, vul dan het volledige WebDAV-adres van die map in bij **DAV-basis-URL**. Een Nextcloud toont dat adres onderaan de pagina met bestandsinstellingen; voor een Nextcloud is [de kaart Nextcloud](nextcloud.md) eenvoudiger.

### De velden {#fields}

- **Host**: de naam van de server, zoals `dav.example.com`: alleen de naam, zonder `https://` ervoor.
- **Poort**: het voorbeeld in het vak is `443`.
- **SSL/TLS gebruiken**: laat het aangevinkt; dan spreekt deze dienst de server aan via `https://`.
- **DAV-basis-URL**: alleen wanneer de DAV-root van de server niet op de hostroot staat. Indien ingevuld wordt deze volledige URL gebruikt en worden host en poort genegeerd.
- **Gebruikersnaam** en **Wachtwoord**: die van het account op de server, met een app-wachtwoord waar de server dat aanbiedt.

U kunt een verbinding ook vooraf toevoegen, onder **Verbindingen** → **Verbinding toevoegen**: kies bij **Bron of doel?** het doel, dan de kaart, en druk op **Toevoegen en testen**. In de **Instelchecklist** staat de voorbereiding voor elk van de drie als lijst die onthoudt wat u al gedaan hebt.

## Wat er meegaat {#what-moves}

- **CalDAV**: agenda's met hun afspraken, en takenlijsten wanneer u op de stap Migratie **Taken** aanvinkt. Of de server takenlijsten draagt, meet de test. Heeft hij gemeten dat dit account ze niet draagt, dan staat **Taken** vast met de regel **Dit account kan dit niet dragen; test het opnieuw als dat veranderd is.**
- **CardDAV**: adresboeken en de contacten daarin.
- **WebDAV**: bestanden en de mappen waarin ze staan.
- Een agenda schrijven stuurt niemand een uitnodiging. Deelnemers en organisator blijven in uw kopie van elke afspraak staan, en elke afspraak wordt zo geschreven dat de server er geen uitnodigingen voor verstuurt.
- Wat een kaart niet draagt, staat op de stap Migratie uit, met de regel **Niet beschikbaar via het gekozen doelprotocol.** E-mail gaat nooit naar een DAV-doel: daarvoor is er het IMAP- of JMAP-doel ([de IMAP-handleiding](imap.md), [de JMAP-handleiding](jmap.md)).
- Een migratie mag vaker lopen: wat al in het doel staat, wordt herkend en niet nog eens gekopieerd.

## Als de test iets meldt {#when-test-says}

Wat de server zelf antwoordt, toont deze dienst woordelijk, in de taal van de server; meestal is dat Engels.

- **`PROPFIND failed with status 401`**: de server weigert de gebruikersnaam of het wachtwoord. Controleer beide, en gebruik een app-wachtwoord als de server dat vraagt.
- **`PROPFIND failed with status`** met een ander getal, of **`Failed to discover calendar home set`** of **`Failed to discover address book home set`**: het adres leidt niet naar de agenda's, contacten of bestanden van dit account. Controleer **Host** en **Poort**, of vul bij **DAV-basis-URL** het volledige adres in.
- **Geen antwoord binnen 20 seconden.** De test zegt dat en bewaart de verbinding toch, zodat u later opnieuw kunt testen.

## Stoppen {#leaving}

- Een migratie verwijdert u onder **Migraties**. De bevestiging zegt wat dat doet: **Verwijdert instellingen en registratie van de migratie; bij uw bron of bestemming wordt niets aangeraakt.** Wat al gekopieerd is, blijft in het doel staan.
- Een verbinding verwijdert u onder **Verbindingen** met **Verwijderen**. Daarmee verdwijnt de kopie van het wachtwoord bij deze dienst. Het wachtwoord zelf blijft bij de server geldig, en het scherm zegt dat ook: **Wij hebben onze kopie verwijderd; deze aanbieder biedt geen intrekking die wij kunnen aanroepen.**
- Trek daarom het app-wachtwoord in bij de server, of wijzig het wachtwoord. Dat kan alleen de houder van het account.
