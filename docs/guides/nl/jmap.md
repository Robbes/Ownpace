# JMAP — een postvak op een JMAP-server

JMAP is een nieuwer protocol voor mail en contacten, dat een mailserver via het web aanbiedt. Deze dienst schrijft naar een JMAP-doel mail, contacten en bestanden. Het meldt zich aan met een gebruikersnaam en een wachtwoord; er is geen knop om toestemming te geven.

## Wat u nodig hebt {#before}

- Een postvak op de JMAP-server dat al bestaat, met genoeg ruimte voor wat eraan komt. Deze dienst maakt zelf geen accounts aan.
- De naam van de server en de poort.
- De gebruikersnaam van dat postvak en een wachtwoord. Maak in de instellingen van de server zelf een app-wachtwoord voor dat account, als die dat aanbiedt; deze dienst meldt zich aan met de gebruikersnaam en dat wachtwoord.

## Koppelen {#connect}

### JMAP {#jmap}

1. Kies bij de stap Doel de kaart **JMAP**.
2. Vul bij **Host** de naam van de server in, zoals `jmap.example.com`: alleen de naam, zonder `https://` ervoor.
3. Vul bij **Poort** de poort in; het voorbeeld in het vak is `443`.
4. Laat **SSL/TLS gebruiken** aangevinkt: dan spreekt deze dienst de server aan via `https://`.
5. Vul bij **Gebruikersnaam** en **Wachtwoord** de gegevens van het postvak in.
6. Druk op **Verbindingen testen en bewaren**.

De test vraagt het sessiedocument op dat elke JMAP-server aanbiedt, op `/.well-known/jmap` achter het adres uit Host en Poort. Hij schrijft niets. Antwoordt de server, dan staat er **Verbonden. Het JMAP-sessiedocument antwoordde.**, met daaronder wat het account draagt (**Draagt:**): e-mail en contacten wanneer de server die aankondigt.

Het vak **Doelmap (optioneel)** zegt waar de mail landt. Leeg voegt samen in het account; met een mapnaam komt alles onder die map terecht.

U kunt een JMAP-verbinding ook vooraf toevoegen, onder **Verbindingen** → **Verbinding toevoegen**: kies bij **Bron of doel?** het doel, dan de kaart **JMAP**, en druk op **Toevoegen en testen**. In de **Instelchecklist** staat de voorbereiding voor een JMAP-doel als lijst die onthoudt wat u al gedaan hebt.

## Wat er meegaat {#what-moves}

- **E-mail**: de mappen en de berichten daarin. Mappen die in het doel nog niet bestaan, worden aangemaakt.
- **Contacten**.
- **Bestanden**, met één grens: een bestand groter dan 8 MB komt nog niet aan op een JMAP-doel. De migratie meldt zo'n bestand als mislukt, onder **Mislukkingen**, en gaat verder met de rest. Wilt u grotere bestanden meenemen, kies dan voor de bestanden een WebDAV-doel ([de DAV-handleiding](dav.md)) of een Nextcloud ([de Nextcloud-handleiding](nextcloud.md)).
- **Agenda** en **Taken** gaan niet naar een JMAP-doel. Terugkerende afspraken komen via JMAP nog niet heel over: een reeks zou als losse afspraken aankomen. Deze dienst schrijft agenda's en takenlijsten daarom via CalDAV. Op de stap Migratie staan ze uit, met de regel **Niet beschikbaar via het gekozen doelprotocol.** Maak voor agenda's en taken een tweede migratie naar een CalDAV-doel.
- Een migratie mag vaker lopen: wat al in het doel staat, wordt herkend en niet nog eens gekopieerd.

## Als de test iets meldt {#when-test-says}

- **De server op … antwoordde 401. Hij is bereikbaar en weigerde de inloggegevens.** De gebruikersnaam of het wachtwoord klopt niet. Controleer beide, of maak een nieuw app-wachtwoord.
- **De server op … antwoordde** met een ander getal, gevolgd door **Controleer de host en poort van het doel.** Op dat adres antwoordt geen JMAP-server. Controleer **Host**, **Poort** en **SSL/TLS gebruiken**.
- **Geen antwoord binnen 20 seconden.** De test zegt dat en bewaart de verbinding toch, zodat u later opnieuw kunt testen.

Wat de server zelf antwoordt, toont deze dienst woordelijk, in de taal van de server; meestal is dat Engels.

## Stoppen {#leaving}

- Een migratie verwijdert u onder **Migraties**. De bevestiging zegt wat dat doet: **Verwijdert instellingen en registratie van de migratie; bij uw bron of bestemming wordt niets aangeraakt.** Wat al gekopieerd is, blijft in het doel staan.
- Een verbinding verwijdert u onder **Verbindingen** met **Verwijderen**. Daarmee verdwijnt de kopie van het wachtwoord bij deze dienst. Het wachtwoord zelf blijft bij de server geldig, en het scherm zegt dat ook: **Wij hebben onze kopie verwijderd; deze aanbieder biedt geen intrekking die wij kunnen aanroepen.**
- Trek daarom het app-wachtwoord in bij de server, of wijzig het wachtwoord. Dat kan alleen de houder van het account.
