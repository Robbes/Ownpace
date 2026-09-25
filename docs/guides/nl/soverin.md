# Soverin — mail, agenda's en contacten in één verbinding

De kaart **Soverin** is één verbinding voor een Soverin-account: mail, agenda's, contacten en takenlijsten. Bestanden horen er niet bij. Deze dienst meldt zich aan met het adres en het wachtwoord van het account; er is geen knop om toestemming te geven.

## Wat u nodig hebt {#before}

- Uw Soverin-account: het e-mailadres en het wachtwoord. Biedt Soverin u een app-wachtwoord, dan kan dat in hetzelfde vak.
- De keuze of er ook mail meegaat. Alleen dan is de mailserver nodig; agenda's en contacten hebben er geen nodig.

## Koppelen {#connect}

### Soverin {#soverin}

Kies bij de stap Doel de kaart **Soverin**. Vier vakken zijn dan al ingevuld, met de regel **Vooraf ingevuld met de gepubliceerde instellingen van Soverin, gelezen op …. Test controleert ze.** Het zijn de waarden die Soverin publiceert, niet gemeten waarden: de test meet ze.

- **Host**: `caldav.soverin.net`, de server voor agenda's en contacten.
- **Poort**: `443`.
- **Mailserver**: `imap.soverin.net`. Alleen nodig als dit account ook e-mail gaat ontvangen.
- **Mailpoort**: `993`.

Laat ze staan, tenzij Soverin u andere waarden opgeeft. Vul daarna zelf in:

1. **Gebruikersnaam**: uw Soverin-e-mailadres.
2. **Wachtwoord**: het wachtwoord van dat account, of een app-wachtwoord als Soverin u dat biedt.
3. Druk op **Verbindingen testen en bewaren**.

Laat **SSL/TLS gebruiken** aangevinkt; het geldt voor agenda's en contacten en voor mail. Laat **DAV-basis-URL** leeg: Soverin biedt agenda's en contacten aan op de hoofdmap van die host.

De test schrijft niets. Hij meldt zich aan bij de agenda's en meet daarnaast elk deel van het account apart: wat het account draagt staat achter **Draagt:**, en wat hij vond achter **Gevonden:**. Of één app-wachtwoord voor mail én voor agenda's en contacten werkt, staat niet vast: de test zegt het per deel. Wordt het ene deel geweigerd en het andere niet, dan dekt dat wachtwoord niet het hele account.

U kunt de verbinding ook vooraf toevoegen, onder **Verbindingen** → **Verbinding toevoegen**: kies bij **Bron of doel?** het doel, dan de kaart **Soverin**, en druk op **Toevoegen en testen**. De vakken zijn daar op dezelfde manier vooraf ingevuld.

## Wat er meegaat {#what-moves}

- **E-mail**, wanneer de **Mailserver** is ingevuld: de mappen en de berichten daarin.
- **Agenda**, **Contacten** en **Taken**. Takenlijsten zijn agenda's die taken bevatten, op dezelfde server als uw agenda's.
- Een agenda schrijven stuurt niemand een uitnodiging. Deelnemers en organisator blijven in uw kopie van elke afspraak staan, en elke afspraak wordt zo geschreven dat de server er geen uitnodigingen voor verstuurt.
- **Bestanden** gaan niet naar Soverin. Op de stap Migratie staat dat vinkje uit, met de regel **Niet beschikbaar via het gekozen doelprotocol.**
- Een migratie mag vaker lopen: wat al in het doel staat, wordt herkend en niet nog eens gekopieerd.

## Als de test iets meldt {#when-test-says}

Wat Soverin zelf antwoordt, toont deze dienst woordelijk, in de taal van de server; meestal is dat Engels.

- **`PROPFIND failed with status 401`** bij agenda's of contacten: Soverin weigert het e-mailadres of het wachtwoord voor dat deel. Controleer beide.
- Een weigering van de mailserver, bijvoorbeeld met `AUTHENTICATIONFAILED`: het wachtwoord werkt niet voor mail. Werkt het wel voor agenda's en contacten, dan dekt dat wachtwoord de mail niet.
- **E-mail** met daarachter **This account stores no mail server address, so mail was not measured**: de **Mailserver** is leeg. Vul hem in als er mail meegaat.
- Bij het aanmaken van de migratie, met **E-mail** aangevinkt en een lege **Mailserver**: **A soverin target carries email only when the account's mail server is stored: targetConfig.mailHost is missing.** Vul de **Mailserver** in, of vink **E-mail** uit; agenda's en contacten hebben geen mailserver nodig.
- **Geen antwoord binnen 20 seconden.** De test zegt dat en bewaart de verbinding toch, zodat u later opnieuw kunt testen.

## Stoppen {#leaving}

- Een migratie verwijdert u onder **Migraties**. De bevestiging zegt wat dat doet: **Verwijdert instellingen en registratie van de migratie; bij uw bron of bestemming wordt niets aangeraakt.** Wat al gekopieerd is, blijft bij Soverin staan.
- Een verbinding verwijdert u onder **Verbindingen** met **Verwijderen**. Daarmee verdwijnt de kopie van het wachtwoord bij deze dienst. Het wachtwoord zelf blijft bij Soverin geldig, en het scherm zegt dat ook: **Wij hebben onze kopie verwijderd; deze aanbieder biedt geen intrekking die wij kunnen aanroepen.**
- Trek daarom het app-wachtwoord in bij Soverin, of wijzig het wachtwoord van het account. Dat kan alleen de houder van het account.
