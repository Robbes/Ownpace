# Nextcloud — agenda's, contacten, bestanden en taken in één account

De kaart **Nextcloud** is één account voor wat een Nextcloud bewaart: agenda's, contacten, bestanden en takenlijsten. Mail hoort daar niet bij. Een Nextcloud is geen mailserver, dus uw mail staat ergens anders; mail gaat naar een IMAP- of JMAP-doel, in een eigen migratie ([de IMAP-handleiding](imap.md), [de JMAP-handleiding](jmap.md)). Deze dienst meldt zich aan met uw gebruikersnaam en een app-wachtwoord; er is geen knop om toestemming te geven.

## Wat u nodig hebt {#before}

- Een account op de Nextcloud dat al bestaat, met genoeg ruimte voor wat eraan komt. Deze dienst maakt zelf geen accounts aan.
- Het adres waarop u Nextcloud opent in de browser, zoals `https://cloud.example.com`.
- Een [app-wachtwoord](#app-password) voor dat account.

## Koppelen {#connect}

### Een app-wachtwoord maken {#app-password}

Gebruik een app-wachtwoord in plaats van het accountwachtwoord zelf: dat kan ingetrokken worden zonder uw eigen wachtwoord te wijzigen.

1. Open uw Nextcloud in de browser.
2. Ga naar **Instellingen** → **Beveiliging** → **Apparaten & sessies**.
3. Typ bij **App naam** een naam die u later herkent, zoals `Migratie`: de knop blijft grijs tot het vak een naam heeft.
4. Druk op **Creëer een nieuw app wachtwoord** en kopieer het wachtwoord dat Nextcloud toont.

### Nextcloud {#nextcloud}

1. Kies bij **Waar gaat het naartoe?** **Nextcloud toevoegen** onder **Een nieuw account**, in elke rij waarvan de gegevens daarheen gaan: agenda's, contacten, bestanden of taken. Eén formulier voegt het account voor allemaal toe.
2. Vul bij **Het adres van uw Nextcloud** het adres in waarop u Nextcloud opent, zoals `cloud.example.com`. De **DAV-basis-URL** wordt daaruit gemaakt, met `/remote.php/dav` erachter, en staat onder **Serverinstellingen**, waar u hem kunt wijzigen.
3. Vul bij **Gebruikersnaam** uw Nextcloud-gebruikersnaam in (zie hieronder).
4. Vul bij **Wachtwoord** het app-wachtwoord in.
5. Druk op **Aanmelding controleren**.

Er is geen vak voor een host of een poort. Nextcloud biedt agenda's, contacten en bestanden aan onder `/remote.php/dav` en niet op de root van de site, dus een host en poort kunnen niet zeggen waar het staat.

De bestanden komen in uw eigen bestanden, onder de gebruikersnaam die u invult: deze dienst schrijft ze naar `/remote.php/dav/files/` met die naam erachter. Gebruik dus de gebruikersnaam die Nextcloud in dat adres zet. Nextcloud toont het WebDAV-adres onderaan de pagina met bestandsinstellingen.

De test schrijft niets. Hij meldt zich aan en toont wat het account draagt (**Draagt:**) en wat hij vond (**Gevonden:**).

U kunt het account ook vooraf toevoegen, onder **Accounts** → **Account toevoegen**: kies bij **Bron of doel?** **Doelen**, dan de kaart **Nextcloud**, vul zelf de **DAV-basis-URL** in, zoals `https://cloud.example.com/remote.php/dav`, en druk op **Toevoegen en testen**.

## Wat er meegaat {#what-moves}

- **Agenda**, **Contacten**, **Bestanden** en **Taken**, voor zover u ze bij **Wat wilt u migreren?** aanvinkt.
- Een takenlijst is in een Nextcloud een agenda die taken bevat. Takenlijsten gaan mee wanneer **Taken** aangevinkt is.
- **Bestanden** komen in uw eigen bestanden, met de mappen waarin ze staan.
- Elke afspraak wordt geschreven met een markering, `SCHEDULE-AGENT=CLIENT`, die de server vraagt er geen uitnodigingen voor te versturen. Deelnemers en organisator blijven in uw kopie van elke afspraak staan. Een server die de markering negeert, kan toch uitnodigingen versturen.
- **E-mail** gaat niet naar een Nextcloud: bij **Waar gaat het naartoe?** biedt de rij voor e-mail haar niet aan.
- Een migratie mag vaker lopen: wat al in het doel staat, wordt herkend en niet nog eens gekopieerd.

## Als de test iets meldt {#when-test-says}

Wat Nextcloud zelf antwoordt, toont deze dienst woordelijk, in de taal van de server; meestal is dat Engels.

- **`PROPFIND failed with status 401`**: Nextcloud weigert de gebruikersnaam of het wachtwoord. Controleer beide. Is het app-wachtwoord ingetrokken, maak dan een nieuw.
- **`PROPFIND failed with status`** met een ander getal: het adres leidt niet naar de DAV-root van uw Nextcloud. Controleer of **DAV-basis-URL** eindigt op `/remote.php/dav`.
- **Geen antwoord binnen 20 seconden.** De test zegt dat.
- **Een mislukte test begint opnieuw.** **Opnieuw proberen** haalt het account weg dat de mislukte test bewaarde en opent het formulier weer met wat u typte, zodat een verbeterd adres getest wordt zoals getypt. Verwijder op de pagina **Accounts** het account dat mislukte, en voeg het opnieuw toe.

## Stoppen {#leaving}

- Een migratie verwijdert u onder **Migraties**. De bevestiging zegt wat dat doet: **Verwijdert instellingen en registratie van de migratie; bij uw bron of bestemming wordt niets aangeraakt.** Wat al gekopieerd is, blijft in uw Nextcloud staan.
- Een account verwijdert u onder **Accounts** met **Verwijderen**. Daarmee verdwijnt de kopie van het app-wachtwoord bij deze dienst. Het app-wachtwoord zelf blijft bij Nextcloud geldig, en het scherm zegt dat ook: **Wij hebben onze kopie verwijderd; deze aanbieder biedt geen intrekking die wij kunnen aanroepen.**
- Trek daarom het app-wachtwoord in bij Nextcloud, onder **Instellingen** → **Beveiliging** → **Apparaten & sessies**, waar u het maakte.
