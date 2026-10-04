# JMAP — een postvak op een JMAP-server

JMAP is een nieuwer protocol voor mail en contacten, dat een mailserver via het web aanbiedt. Deze dienst schrijft naar een JMAP-doel mail, contacten en bestanden, en meldt zich aan met een gebruikersnaam en een wachtwoord; er is geen knop om toestemming te geven.

## Wat u nodig hebt {#before}

- Een postvak op de JMAP-server dat al bestaat, met genoeg ruimte voor wat eraan komt. Deze dienst maakt zelf geen accounts aan.
- De naam van de server en de poort.
- De gebruikersnaam van dat postvak en een wachtwoord. Maak in de instellingen van de server zelf een app-wachtwoord voor dat account, als die dat aanbiedt; deze dienst meldt zich aan met de gebruikersnaam en dat wachtwoord.

## Koppelen {#connect}

### JMAP {#jmap}

1. Kies bij **Waar gaat het naartoe?** **JMAP toevoegen** onder **Een nieuw account**, in elke rij waarvan de gegevens daarheen gaan: e-mail, contacten of bestanden. Eén formulier voegt het account voor allemaal toe.
2. Vul bij **Host** de naam van de server in, zoals `jmap.example.com`: alleen de naam, zonder `https://` ervoor.
3. **Poort** is ingevuld met `443`, dat de meeste servers gebruiken. Verander die alleen als de server een andere poort gebruikt. Er is geen vakje voor SSL/TLS: deze dienst spreekt de server altijd aan via `https://`.
4. Vul bij **Gebruikersnaam** en **Wachtwoord** de gegevens van het postvak in.
5. Druk op **Aanmelding controleren**.

De test vraagt het sessiedocument op dat elke JMAP-server aanbiedt, op `/.well-known/jmap` achter het adres uit Host en Poort. Hij schrijft niets. Antwoordt de server, dan staat er **Verbonden. Het JMAP-sessiedocument antwoordde.**, met daaronder wat het account draagt (**Draagt:**): e-mail en contacten wanneer de server die aankondigt.

**Waar de kopieën komen**, onder de rijen, zegt waar de mail in dat account terechtkomt. Laat u het zoals het is, dan voegt het samen in het account. Open **In een eigen map zetten** en typ een naam bij **Map**, en alles komt onder die map terecht.

U kunt een JMAP-account ook vooraf toevoegen, onder **Accounts** → **Account toevoegen**: kies bij **Bron of doel?** **Doelen**, dan de kaart **JMAP**, en druk op **Toevoegen en testen**. In de **Instelchecklist** staat de voorbereiding voor een JMAP-doel als lijst die onthoudt wat u al gedaan hebt.

## Wat er meegaat {#what-moves}

- **E-mail**: de mappen en de berichten daarin. Mappen die in het doel nog niet bestaan, worden aangemaakt.
- **Contacten**.
- **Bestanden**, met één grens: het grootste bestand dat de JMAP-server in één upload aanneemt. De server geeft die grens zelf op. Een groter bestand meldt de migratie als mislukt, onder **Mislukkingen**, met de grens van de server, en de migratie gaat verder met de rest. Wilt u zo'n bestand meenemen, verhoog dan de uploadgrens van de server, of kies voor de bestanden een WebDAV-doel ([de DAV-handleiding](dav.md)) of een Nextcloud ([de Nextcloud-handleiding](nextcloud.md)).
- **Agenda** en **Taken** gaan niet naar een JMAP-doel. Terugkerende afspraken komen via JMAP nog niet heel over: een reeks zou als losse afspraken aankomen. Deze dienst schrijft agenda's en takenlijsten daarom via CalDAV: bij **Waar gaat het naartoe?** bieden hun rijen geen JMAP aan, en gaan ze in hun eigen rijen naar een CalDAV-doel, waarvoor **Migratie starten** een eigen migratie maakt.
- Een migratie mag vaker lopen: wat al in het doel staat, wordt herkend en niet nog eens gekopieerd.

## Als de test iets meldt {#when-test-says}

- **De server op … antwoordde 401. Hij is bereikbaar en weigerde de inloggegevens.** De gebruikersnaam of het wachtwoord klopt niet. Controleer beide, of maak een nieuw app-wachtwoord.
- **De server op … antwoordde** met een ander getal, gevolgd door **Controleer de host en poort van het doel.** Op dat adres antwoordt geen JMAP-server. Controleer **Host** en **Poort**.
- **Geen antwoord binnen 20 seconden.** De test zegt dat.
- **Een mislukte test begint opnieuw.** **Opnieuw proberen** haalt het account weg dat de mislukte test bewaarde en opent het formulier weer met wat u typte, zodat een verbeterde **Host** of **Poort** getest wordt zoals getypt. Verwijder op de pagina **Accounts** het account dat mislukte, en voeg het opnieuw toe.

Wat de server zelf antwoordt, toont deze dienst woordelijk, in de taal van de server; meestal is dat Engels.

## Stoppen {#leaving}

- Een migratie verwijdert u onder **Migraties**. De bevestiging zegt wat dat doet: **Verwijdert instellingen en registratie van de migratie; bij uw bron of bestemming wordt niets aangeraakt.** Wat al gekopieerd is, blijft in het doel staan.
- Een account verwijdert u onder **Accounts** met **Verwijderen**. Daarmee verdwijnt de kopie van het wachtwoord bij deze dienst. Het wachtwoord zelf blijft bij de server geldig, en het scherm zegt dat ook: **Wij hebben onze kopie verwijderd; deze aanbieder biedt geen intrekking die wij kunnen aanroepen.**
- Trek daarom het app-wachtwoord in bij de server, of wijzig het wachtwoord. Dat kan alleen de houder van het account.
