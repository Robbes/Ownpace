# IMAP — mail met een gebruikersnaam en een wachtwoord

IMAP is de standaardmanier waarop een mailprogramma een postvak leest. Deze dienst gebruikt het aan twee kanten: als bron, om mail te lezen uit een postvak bij een aanbieder die IMAP aanbiedt, en als doel, om mail te schrijven in een postvak bij de aanbieder van uw keuze. Aan beide kanten meldt deze dienst zich aan met een gebruikersnaam en een wachtwoord. Er is geen knop om toestemming te geven: het wachtwoord is de toegang.

## Wat u nodig hebt {#before}

- De naam van de IMAP-server en de poort voor IMAP met SSL, die uw mailaanbieder publiceert; meestal is dat poort 993.
- De gebruikersnaam van het postvak, zoals uw aanbieder die opgeeft.
- Een wachtwoord. De meeste aanbieders weigeren een gewoon accountwachtwoord voor IMAP zodra tweestapsverificatie aanstaat, en willen een app-specifiek wachtwoord. Maak er één aan bij de aanbieder, voor dit ene postvak.
- Voor een doel: het postvak bestaat al, met genoeg ruimte voor wat eraan komt. Deze dienst maakt zelf geen accounts aan.

## Koppelen {#connect}

Aan beide kanten vraagt de kaart **IMAP** dezelfde velden. U vindt de kaart bij de stap Bron en bij de stap Doel van de wizard.

### IMAP als bron {#imap-source}

1. Kies bij de stap Bron de kaart **IMAP**.
2. Vul bij **Host** de naam van de IMAP-server in, zoals `imap.example.com`: alleen de naam, zonder `https://` of een pad erachter.
3. Bij **Poort** staat al `993`, de gebruikelijke poort voor IMAP met SSL. Wijzig dat alleen als uw aanbieder een andere opgeeft.
4. Laat **SSL/TLS gebruiken** aangevinkt. **Verbindingen testen en bewaren** test en bewaart de verbinding met SSL/TLS, wat het vakje ook zegt.
5. Vul bij **Gebruikersnaam** de gebruikersnaam van het postvak in.
6. Vul bij **Wachtwoord** het app-wachtwoord in, of het wachtwoord van het postvak als de aanbieder dat voor IMAP toelaat.
7. Druk op **Verbindingen testen en bewaren**.

De test meldt zich alleen-lezen aan en schrijft niets. Werkt het, dan staat er **Verbonden.**, met daaronder wat hij vond, en is de verbinding bewaard. Bij een volgende migratie kiest u hem onder **Bewaarde bronverbinding hergebruiken** in plaats van alles opnieuw in te vullen. De link **Open de instelchecklist** onder de kaarten zet de voorbereiding op een lijst die onthoudt wat u al gedaan hebt.

### IMAP als doel {#imap-target}

1. Kies bij de stap Doel de kaart **IMAP**.
2. Vul bij **Host** de naam van de IMAP-server in waar de mail naartoe gaat, zoals `imap.example.com`.
3. Bij **Poort** staat al `443`, en dat is geen IMAP-poort. Vervang dat door de IMAP-poort die uw aanbieder opgeeft, meestal `993`.
4. Laat **SSL/TLS gebruiken** aangevinkt; ook hier gebruiken de test en de bewaarde verbinding SSL/TLS.
5. Vul bij **Gebruikersnaam** en **Wachtwoord** de gegevens van het doelpostvak in.
6. Druk op **Verbindingen testen en bewaren**.

Ook hier schrijft de test niets: hij meldt zich aan en telt de mappen van het doelpostvak.

Het vak **Doelmap (optioneel)** zegt waar de mail landt. Leeg voegt samen in het account: de mappen van de bron komen naast de mappen die er al zijn. Met een mapnaam, zoals `Gmail`, komt alles onder die map terecht; handig wanneer meerdere bronnen één doel delen.

U kunt een IMAP-verbinding ook vooraf toevoegen, onder **Verbindingen** → **Verbinding toevoegen**. Kies daar bij **Bron of doel?** de kant, dan de kaart **IMAP**, en druk op **Toevoegen en testen**.

## Wat er meegaat {#what-moves}

- **Als bron** leest deze kaart mail: de mappen van het postvak en de berichten daarin. Vink op de stap Migratie alleen **E-mail** aan. Agenda's en contacten gaan niet via IMAP: deze dienst meet ze op een IMAP-verbinding ook niet.
- **Als doel** ontvangt deze kaart alleen mail. Op de stap Migratie staan **Agenda**, **Contacten**, **Bestanden** en **Taken** dan uit, met de regel **Niet beschikbaar via het gekozen doelprotocol.** Voor die gegevens maakt u een tweede migratie, naar een CalDAV-, CardDAV- of WebDAV-doel ([de DAV-handleiding](dav.md)) of naar een Nextcloud ([de Nextcloud-handleiding](nextcloud.md)).
- Mappen die in het doel nog niet bestaan, worden aangemaakt. Verzonden en Concepten worden de Verzonden en Concepten van het doelaccount zelf. Onder een **Doelmap** komen ze als gewone mappen daarbinnen terecht, want een mailprogramma kan er maar één van elk hebben.
- Een migratie mag vaker lopen: een bericht dat al in het doel staat, wordt herkend en niet nog eens gekopieerd.

## Als de test iets meldt {#when-test-says}

Wat een mailserver zelf antwoordt, toont deze dienst woordelijk, in de taal van de server; meestal is dat Engels.

- **Het wachtwoord wordt geweigerd**, bijvoorbeeld met `AUTHENTICATIONFAILED` of een regel met `LOGIN failed`. Controleer de gebruikersnaam. Staat tweestapsverificatie aan, dan willen de meeste aanbieders een app-specifiek wachtwoord in plaats van het accountwachtwoord.
- **De server is niet bereikbaar** of weigert de verbinding. Controleer **Host** en **Poort** tegen wat uw aanbieder voor IMAP met SSL opgeeft.
- **Geen antwoord binnen 20 seconden.** De test zegt dat en bewaart de verbinding toch, zodat u later opnieuw kunt testen.
- **Een tweede test probeert dezelfde server.** Na een mislukte test bewaart de wizard de verbinding met de **Host**, **Poort** en **Gebruikersnaam** die hij eerst kreeg; drukt u nog eens op de knop, dan wordt alleen het wachtwoord opnieuw geprobeerd. Wilt u verbeterde gegevens testen, verwijder die verbinding dan onder **Verbindingen**, open de wizard weer, vul het wachtwoord opnieuw in en druk op **Verbindingen testen en bewaren**.

## Stoppen {#leaving}

- Een migratie verwijdert u onder **Migraties**. De bevestiging zegt wat dat doet: **Verwijdert instellingen en registratie van de migratie; bij uw bron of bestemming wordt niets aangeraakt.** Wat al gekopieerd is, blijft in het doel staan.
- Een verbinding verwijdert u onder **Verbindingen** met **Verwijderen**. Daarmee verdwijnt de kopie van het wachtwoord bij deze dienst. Het wachtwoord zelf blijft bij de aanbieder geldig, en het scherm zegt dat ook: **Wij hebben onze kopie verwijderd; deze aanbieder biedt geen intrekking die wij kunnen aanroepen.**
- Trek daarom het app-wachtwoord in bij uw aanbieder, of wijzig het wachtwoord van het postvak. Dat kan alleen de houder van het account. Een app-wachtwoord kan ingetrokken worden zonder het wachtwoord van de persoon te wijzigen.
