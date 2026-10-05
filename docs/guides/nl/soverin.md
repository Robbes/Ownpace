# Soverin — mail, agenda's en contacten in één account

De kaart **Soverin** is één account voor een Soverin-account: mail, agenda's, contacten en takenlijsten. Bestanden horen er niet bij. Deze dienst meldt zich aan met het adres en het wachtwoord van het account; er is geen knop om toestemming te geven.

## Wat u nodig hebt {#before}

- Uw Soverin-account: het e-mailadres en het wachtwoord. Biedt Soverin u een app-wachtwoord, dan kan dat in hetzelfde vak.
- De keuze of er ook mail meegaat. Alleen dan is de mailserver nodig; agenda's en contacten hebben er geen nodig.

## Koppelen {#connect}

### Soverin {#soverin}

Kies bij **Waar gaat het naartoe?** **Soverin toevoegen** onder **Een nieuw account**, in elke rij waarvan de gegevens daarheen gaan: e-mail, agenda's, contacten of taken. Eén formulier voegt het account voor allemaal toe. De servers zijn al ingevuld, ingeklapt onder **Serverinstellingen (ingevuld voor Soverin)**, met de regel **Vooraf ingevuld met de gepubliceerde instellingen van Soverin, gelezen op …. Test controleert ze.** Het zijn de waarden die Soverin publiceert, niet gemeten waarden: de test meet ze.

- **Host**: `caldav.soverin.net`, de server voor agenda's en contacten.
- **Poort**: `443`.
- **Mailserver**: `imap.soverin.net`. Alleen nodig als dit account ook e-mail gaat ontvangen.
- **Mailpoort**: `993`.

Laat ze staan, tenzij Soverin u andere waarden opgeeft. Gaat er mail mee, laat de **Mailserver** dan ingevuld: de test bewaart het account met wat er in de vakken staat. Vul daarna zelf in:

1. **Gebruikersnaam**: uw Soverin-e-mailadres.
2. **Wachtwoord**: het wachtwoord van dat account, of een app-wachtwoord als Soverin u dat biedt.
3. Druk op **Aanmelding controleren**.

Er is geen vakje voor SSL/TLS: deze dienst gebruikt het altijd, voor agenda's en contacten en voor mail. Laat **DAV-basis-URL** leeg: Soverin biedt agenda's en contacten aan op de hoofdmap van die host. Mislukt de test op een server, dan opent **Serverinstellingen** vanzelf.

De test schrijft niets. Hij meldt zich aan bij de agenda's en meet daarnaast elk deel van het account apart: wat het account omvat staat achter **Omvat:**, en wat hij vond achter **Gevonden:**. Of één app-wachtwoord voor mail én voor agenda's en contacten werkt, staat niet vast: de test zegt het per deel. Wordt het ene deel geweigerd en het andere niet, dan dekt dat wachtwoord niet het hele account.

U kunt het account ook vooraf toevoegen, onder **Accounts** → **Account toevoegen**: kies bij **Bron of doel?** **Doelen**, dan de kaart **Soverin**, en druk op **Toevoegen en testen**. De vakken zijn daar op dezelfde manier vooraf ingevuld, open in beeld.

## Wat er meegaat {#what-moves}

- **E-mail**, wanneer het account is bewaard met de **Mailserver** ingevuld: de mappen en de berichten daarin.
- **Agenda**, **Contacten** en **Taken**. Takenlijsten zijn agenda's die taken bevatten, op dezelfde server als uw agenda's.
- Elke afspraak wordt geschreven met een markering, `SCHEDULE-AGENT=CLIENT`, die de server vraagt er geen uitnodigingen voor te versturen. Deelnemers en organisator blijven in uw kopie van elke afspraak staan. Een server die de markering negeert, kan toch uitnodigingen versturen.
- **Bestanden** gaan niet naar Soverin: bij **Waar gaat het naartoe?** biedt de rij voor bestanden het niet aan.
- Een migratie mag vaker lopen: wat al in het doel staat, wordt herkend en niet nog eens gekopieerd.

## Als de test iets meldt {#when-test-says}

Wat Soverin zelf antwoordt, toont deze dienst woordelijk, in de taal van de server; meestal is dat Engels.

- **`PROPFIND failed with status 401`** bij agenda's of contacten: Soverin weigert het e-mailadres of het wachtwoord voor dat deel. Controleer beide.
- Een weigering van de mailserver, bijvoorbeeld met `AUTHENTICATIONFAILED`: het wachtwoord werkt niet voor mail. Werkt het wel voor agenda's en contacten, dan dekt dat wachtwoord de mail niet.
- **E-mail** met daarachter **This account stores no mail server address, so mail was not measured**: het account is bewaard zonder **Mailserver**. Gaat er mail mee, zie dan het volgende punt.
- Een account dat zonder **Mailserver** is bewaard, omvat geen mail. Een migratie met **E-mail** aangevinkt wordt er toch op gemaakt; zodra die loopt, mislukt de mail met **This soverin connection stores no mail server, so its mail face cannot be built**. Verwijder die migratie onder **Migraties**, daarna het account onder **Accounts**, en begin opnieuw met de **Mailserver** ingevuld. Agenda's en contacten hebben geen mailserver nodig, dus een migratie zonder **E-mail** kan op dat account blijven.
- **Geen antwoord binnen 20 seconden.** De test zegt dat.
- **Een mislukte test begint opnieuw.** **Opnieuw proberen** haalt het account weg dat de mislukte test bewaarde en opent het formulier weer met wat u typte, zodat verbeterde servers en poorten getest worden zoals getypt. Verwijder op de pagina **Accounts** het account dat mislukte, en voeg het opnieuw toe.

## Stoppen {#leaving}

- Een migratie verwijdert u onder **Migraties**. De bevestiging zegt wat dat doet: **Verwijdert instellingen en registratie van de migratie; bij uw bron of bestemming wordt niets aangeraakt.** Wat al gekopieerd is, blijft bij Soverin staan.
- Een account verwijdert u onder **Accounts** met **Verwijderen**. Daarmee verdwijnt de kopie van het wachtwoord bij deze dienst. Het wachtwoord zelf blijft bij Soverin geldig, en het scherm zegt dat ook: **Wij hebben onze kopie verwijderd; deze aanbieder biedt geen intrekking die wij kunnen aanroepen.**
- Trek daarom het app-wachtwoord in bij Soverin, of wijzig het wachtwoord van het account. Dat kan alleen de houder van het account.
