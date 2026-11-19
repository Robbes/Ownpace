# Cirrux — mail, agenda's, contacten en taken in één account

De kaart **Cirrux** is één account voor een Cirrux-mailbox: mail, agenda's, contacten en takenlijsten. Bestanden horen er niet bij: Cirrux Drive heeft geen WebDAV-adres, en de eigen koppeling van Cirrux voor apps kan deze dienst nog niet gebruiken. Deze dienst meldt zich aan met het e-mailadres van de mailbox en een app-wachtwoord; er is geen knop om toestemming te geven.

De servers hieronder zijn de servers die Cirrux publiceert op zijn [instellingenpagina](https://cirrux.co/help/setup), onder Manual Configuration, en op zijn [agendapagina](https://cirrux.co/help/calendar), gelezen op 19 november 2026. Die pagina's zijn in het Engels, en de namen van knoppen en tabbladen in Cirrux staan hieronder zoals Cirrux ze schrijft.

## Wat u nodig hebt {#before}

- Een Cirrux-mailbox, in een workspace met ruimte voor wat eraan komt. Cirrux deelt de opslag over de hele workspace: mail, Drive en documenten tellen mee voor één voorraad. Een workspace die zeven dagen boven zijn opslagniveau blijft, zet Cirrux over naar een groter niveau, en uploads die niet passen worden geweigerd tot er weer ruimte is ([billing](https://cirrux.co/help/billing)). Deze dienst maakt zelf geen accounts aan.
- Een app-wachtwoord voor die mailbox. In Cirrux Mail: **Settings → Mailboxes**, kies de mailbox, open het tabblad **Passwords** en klik op **New app password**. Cirrux toont het één keer, dus kopieer het meteen. Het wachtwoord waarmee u zich bij Cirrux aanmeldt, werkt hier niet: Cirrux weigert het voor mail, agenda's en contacten. Ziet u geen tabblad **Passwords**, dan heeft de beheerder van de workspace apps buiten Cirrux uitgezet; vraag hem of haar dat weer aan te zetten.
- De keuze of er ook mail meegaat. Alleen dan is de mailserver nodig; agenda's, contacten en taken hebben er geen nodig.

## Koppelen {#connect}

### Cirrux {#cirrux}

Kies bij **Waar gaat het naartoe?** **Cirrux toevoegen** onder **Een nieuw account**, in elke rij waarvan de gegevens daarheen gaan: e-mail, agenda's, contacten of taken. Eén formulier voegt het account voor allemaal toe. De servers zijn al ingevuld, ingeklapt onder **Serverinstellingen (ingevuld voor Cirrux)**, met de regel **Vooraf ingevuld met de gepubliceerde instellingen van Cirrux, gelezen op …. Test controleert deze.** Het zijn de waarden die Cirrux publiceert, niet gemeten waarden: de test meet ze.

- **Host**: `api.cirrux.co`, de server die Cirrux noemt voor agenda's, contacten en herinneringen samen.
- **Poort**: `443`. Cirrux noemt de server zonder poort, en dat betekent de gewone poort voor een beveiligde verbinding.
- **Mailserver**: `imap.cirrux.co`. Alleen nodig als dit account ook e-mail gaat ontvangen.
- **Mailpoort**: `993`.

Laat ze staan, tenzij Cirrux u andere waarden opgeeft. Gaat er mail mee, laat de **Mailserver** dan ingevuld: de test bewaart het account met wat er in de vakken staat. Vul daarna zelf in:

1. **Gebruikersnaam**: het e-mailadres van de mailbox.
2. **Wachtwoord**: het app-wachtwoord dat u voor die mailbox hebt gemaakt, op het tabblad **Passwords**.
3. Druk op **Aanmelding controleren**.

Er is geen vakje voor SSL/TLS: deze dienst gebruikt het altijd, voor agenda's, contacten en taken en voor mail. Laat **DAV-basis-URL** leeg: Cirrux noemt de server en geen pad, en deze dienst zoekt de agenda's en adresboeken vanaf daar, zoals een agenda-app dat doet met dezelfde servernaam. Mislukt de test op een server, dan opent **Serverinstellingen** vanzelf.

De test schrijft niets. Hij meldt zich aan bij de agenda's en meet daarnaast elk deel van het account apart: wat het account omvat staat achter **Omvat:**, en wat hij vond achter **Gevonden:**. Bestanden staan er als niet omvat, met de reden.

U kunt het account ook vooraf toevoegen, onder **Accounts** → **Account toevoegen**: kies bij **Bron of bestemming?** **Bestemmingen**, dan de kaart **Cirrux**, en druk op **Toevoegen en testen**. De vakken zijn daar op dezelfde manier vooraf ingevuld, open in beeld.

## Wat er meegaat {#what-moves}

- **E-mail**, wanneer het account is bewaard met de **Mailserver** ingevuld: de mappen en de berichten daarin. Mappen zijn in Cirrux labels. Een map die deze dienst aanmaakt, wordt een label met dezelfde naam, genest onder een ander label waar de naam een schuine streep heeft, en via IMAP is elk label weer een map ([submappen](https://cirrux.co/help/questions/subfolders-in-my-mailbox)).
- **Agenda**, **Contacten** en **Taken**. Elke Cirrux-mailbox heeft een agenda, een adresboek dat Contacts heet en een takenlijst die Reminders heet. Takenlijsten zijn agenda's die taken bevatten, op dezelfde server als uw agenda's.
- Cirrux maakt geen tweede adresboek aan, dus de contacten uit alle adresboeken bij uw bron komen in Contacts terecht.
- Elke agenda bij uw bron wordt bij Cirrux een agenda met dezelfde naam, naast de eigen agenda Calendar van de mailbox.
- Elke afspraak wordt geschreven met een markering, `SCHEDULE-AGENT=CLIENT`, die de server vraagt er geen uitnodigingen voor te versturen. Deelnemers en organisator blijven in uw kopie van elke afspraak staan. Een server die de markering negeert, kan toch uitnodigingen versturen, en Cirrux zegt niet of zijn agendaserver de markering leest. De agenda van Cirrux zelf mailt deelnemers wel wanneer een afspraak in de app wordt gemaakt.
- **Bestanden** gaan niet naar Cirrux: bij **Waar gaat het naartoe?** biedt de rij voor bestanden het niet aan. Deze dienst schrijft bestanden via WebDAV, en Cirrux Drive heeft geen WebDAV-adres: het is bereikbaar via de eigen apps van Cirrux en de koppeling voor apps ([Drive](https://cirrux.co/help/drive)). Uw bestanden kunnen in dezelfde migratie naar een andere bestemming.
- Een migratie mag vaker lopen: wat al in het doel staat, wordt herkend en niet nog eens gemigreerd.

## De eigen import van Cirrux {#cirrux-sync}

Cirrux kan zelf kopiëren uit Google en Microsoft. Google Sync en Microsoft Sync van Cirrux lezen mail, agenda's en contacten, in één richting, en kijken elk uur naar wijzigingen ([Google Sync](https://cirrux.co/help/google-sync), [Microsoft Sync](https://cirrux.co/help/microsoft-sync)). Bestanden uit Google Drive en OneDrive laten ze achter, en taken noemen ze niet. Voor andere aanbieders kopieert de IMAP-import van Cirrux mail telkens wanneer u die start, en agenda's en contacten komen over als bestanden die u uploadt.

Kies per soort gegevens een van de twee. Beide schrijven in dezelfde mailbox, agenda's en adresboek, en geen van beide weet wat de ander schreef.

## Als de test iets meldt {#when-test-says}

Wat Cirrux zelf antwoordt, toont deze dienst woordelijk, in de taal van de server; meestal is dat Engels.

- **`PROPFIND failed with status 401`** bij agenda's of contacten: Cirrux weigert het e-mailadres of het wachtwoord voor dat deel. Controleer beide, en controleer dat het wachtwoord een app-wachtwoord is: het wachtwoord waarmee u zich bij Cirrux aanmeldt, wordt geweigerd.
- Een weigering van de mailserver, bijvoorbeeld met `AUTHENTICATIONFAILED`: het wachtwoord werkt niet voor mail. Een app-wachtwoord hoort bij één mailbox, dus controleer dat dit wachtwoord op het tabblad **Passwords** van deze mailbox is gemaakt.
- Geen agenda's of adresboeken gevonden, terwijl de mailbox ze wel heeft: Cirrux publiceert de server en niet het pad daaronder. Vraag de ondersteuning van Cirrux, via help@cirrux.co, om het adres van de agenda's en adresboeken van uw mailbox, en vul dat in bij **DAV-basis-URL**.
- **E-mail** met daarachter **This account stores no mail server address, so mail was not measured**: het account is bewaard zonder **Mailserver**. Gaat er mail mee, zie dan het volgende punt.
- Een account dat zonder **Mailserver** is bewaard, omvat geen mail. Een migratie met **E-mail** aangevinkt wordt er toch op gemaakt; zodra die loopt, mislukt de mail met **This cirrux connection stores no mail server, so its mail face cannot be built**. Verwijder die migratie onder **Migraties**, daarna het account onder **Accounts**, en begin opnieuw met de **Mailserver** ingevuld. Agenda's, contacten en taken hebben geen mailserver nodig, dus een migratie zonder **E-mail** kan op dat account blijven.
- **Geen antwoord binnen 20 seconden.** De test zegt dat.
- **Een mislukte test begint opnieuw.** **Opnieuw proberen** haalt het account weg dat de mislukte test bewaarde en opent het formulier weer met wat u typte, zodat verbeterde servers en poorten getest worden zoals getypt. Verwijder op de pagina **Accounts** het account dat mislukte, en voeg het opnieuw toe.

## Stoppen {#leaving}

- Een migratie verwijdert u onder **Migraties**. De bevestiging zegt wat dat doet: **Verwijdert enkel instellingen en registratie van uw migratie in Ownpace, niets bij uw bron of bestemming.** Wat al gemigreerd is, blijft bij Cirrux staan.
- Een account verwijdert u onder **Accounts** met **Verwijderen**. Daarmee verdwijnt de kopie van het app-wachtwoord bij deze dienst. Het app-wachtwoord zelf blijft bij Cirrux geldig, en het scherm zegt dat ook: **Wij hebben onze kopie verwijderd; deze aanbieder biedt geen manier om intrekking door ons te forceren.**
- Verwijder daarom het app-wachtwoord bij Cirrux: in Cirrux Mail, **Settings → Mailboxes**, de mailbox, het tabblad **Passwords**. Uw Cirrux-wachtwoord blijft zoals het is.
