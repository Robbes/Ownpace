# Cirrux — mail, agenda's, contacten, taken en Drive in één account

De kaart **Cirrux** is één account voor een Cirrux-mailbox: mail, agenda's, contacten en takenlijsten. Deze dienst meldt zich daarvoor aan met het e-mailadres van de mailbox en een app-wachtwoord. Bestanden kunnen ook naar de Cirrux Drive van het account, zodra u die verbindt op de pagina **Accounts**: Cirrux Drive heeft geen WebDAV-adres en is alleen bereikbaar via de eigen koppeling van Cirrux voor apps, met uw eigen aanmelding bij Cirrux en niet met het app-wachtwoord ([Bestanden: Cirrux Drive](#drive)).

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

De test schrijft niets. Hij meldt zich aan bij de agenda's en meet daarnaast elk deel van het account apart: wat het account omvat staat achter **Omvat:**, en wat hij vond achter **Gevonden:**. Bestanden staan er als niet omvat, met de reden, tot Cirrux Drive op het account is verbonden ([Bestanden: Cirrux Drive](#drive)).

U kunt het account ook vooraf toevoegen, onder **Accounts** → **Account toevoegen**: kies bij **Bron of bestemming?** **Bestemmingen**, dan de kaart **Cirrux**, en druk op **Toevoegen en testen**. De vakken zijn daar op dezelfde manier vooraf ingevuld, open in beeld.

## Wat er meegaat {#what-moves}

- **E-mail**, wanneer het account is bewaard met de **Mailserver** ingevuld: de mappen en de berichten daarin. Mappen zijn in Cirrux labels. Een map die deze dienst aanmaakt, wordt een label met dezelfde naam, genest onder een ander label waar de naam een schuine streep heeft, en via IMAP is elk label weer een map ([submappen](https://cirrux.co/help/questions/subfolders-in-my-mailbox)).
- **Agenda**, **Contacten** en **Taken**. Elke Cirrux-mailbox heeft een agenda, een adresboek dat Contacts heet en een takenlijst die Reminders heet. Takenlijsten zijn agenda's die taken bevatten, op dezelfde server als uw agenda's.
- Cirrux maakt geen tweede adresboek aan, dus de contacten uit alle adresboeken bij uw bron komen in Contacts terecht.
- Elke agenda bij uw bron wordt bij Cirrux een agenda met dezelfde naam, naast de eigen agenda Calendar van de mailbox.
- Cirrux mailt een uitnodiging naar elke deelnemer van een afspraak die het krijgt, wat de afspraak ook zegt over wie uitnodigingen verstuurt. Daarom worden de deelnemers en de organisator van uw afspraken en taken niet naar Cirrux geschreven, en wordt niemand gemaild. Wie er was uitgenodigd, staat in elke afspraak als opmerking (de iCalendar-eigenschap `COMMENT`), die de app van Cirrux zelf misschien niet toont.
- **Bestanden**, zodra Cirrux Drive op het account is verbonden: zie [Bestanden: Cirrux Drive](#drive). Tot dan biedt de rij voor bestanden bij **Waar gaat het naartoe?** het account niet aan, en kunnen uw bestanden in dezelfde migratie naar een andere bestemming.
- Een migratie mag vaker lopen: wat al in het doel staat, wordt herkend en niet nog eens gemigreerd.

## Bestanden: Cirrux Drive {#drive}

Cirrux Drive is bereikbaar via de eigen koppeling van Cirrux voor apps, met de aanmelding van een persoon bij Cirrux ([Drive](https://cirrux.co/help/drive), [de koppeling](https://cirrux.co/help/api)). Bestanden zijn dus een tweede aanmelding op hetzelfde account, die u toevoegt nadat het account is bewaard. Of de knop er staat, hangt af van de dienst die u gebruikt: Cirrux registreert elke dienst die mensen mag aanmelden met de hand, en een dienst zonder zo'n registratie toont bestanden als niet omvat, met **This service has no Cirrux client on this deployment yet**, en zonder knop.

1. Op de pagina **Accounts** staat bij het Cirrux-account **Cirrux Drive verbinden**. Druk erop.
2. De aanmeldpagina van Cirrux opent in een nieuw venster. Meld u bij Cirrux aan als de persoon van wie de Drive is, en sta toe wat Cirrux vraagt: wie u bent en welke workspace, en het lezen, toevoegen, wijzigen en naar de prullenbak verplaatsen van de bestanden in uw Drive.
3. Het venster zegt **Cirrux Drive is verbonden**. Sluit het. Bij het account staat **Cirrux Drive is verbonden: bestanden kunnen naar dit account.**, en het account is opnieuw gemeten: **Omvat:** noemt nu bestanden, en **Gevonden:** wat er bovenin uw Drive staat.

Daarna biedt de rij voor bestanden bij **Waar gaat het naartoe?** het account aan onder **Uw accounts**. Onder **Een nieuw account** biedt hij Cirrux niet aan: een nieuw account heeft geen Drive tot het is bewaard en verbonden.

Wat er met uw bestanden gebeurt:

- **Elk bestand tot 2 GiB wordt gekopieerd.** Tot 100 MB in één verzoek; een groter bestand in delen, die deze dienst vóór het versturen versleutelt in het eigen formaat van Cirrux, zoals Cirrux voor bestanden van die grootte vraagt. Een bestand boven 2 GiB gaat helemaal niet mee, en dat wordt gezegd met die reden: Cirrux neemt geen bestand van die grootte aan.
- **Mappen worden op naam gevonden**, en aangemaakt waar ze ontbreken. Cirrux houdt één naam per map aan, hoe die ook met hoofdletters is geschreven, dus `Photos` en `photos` zijn daar één map. Een bestand waarvan de naam alleen in hoofdletters verschilt van een bestand dat al in die map staat, wordt niet overschreven: het wordt gemeld.
- **Een bestand dat al onder dezelfde naam in de map staat, geldt als de kopie**, en wordt niet beschreven. Verandert een bestand later bij de bron, dan wordt de kopie vervangen, tenzij de kopie in Cirrux is gewijzigd nadat deze dienst haar voor het laatst schreef: dan blijft de kopie in Cirrux zoals ze is, en wordt het bestand gemeld als conflict.
- **Het tijdstip waarop een bestand voor het laatst is gewijzigd, blijft behouden**, zoals Cirrux het toont.
- **Er wordt niets definitief verwijderd.** Een bestand dat bij de bron is verwijderd, wordt alleen uit Cirrux gehaald als u dat verwijderen goedkeurt, en dan gaat het naar de prullenbak van Cirrux, waar het 30 dagen terug te zetten is.
- **De opslag wordt gecontroleerd voordat er iets wordt geüpload**: passen de bestanden niet in de opslag van de workspace, dan worden ze niet verstuurd, en de reden zegt dat.
- **Cirrux bepaalt het tempo**: 600 verzoeken per minuut voor één aanmelding. Vraagt Cirrux deze dienst langzamer te gaan, dan wacht hij zo lang als Cirrux zegt, en gaat daarna verder.

De aanmelding wordt versleuteld bij het account bewaard, naast het app-wachtwoord. Cirrux vervangt haar telkens wanneer deze dienst haar vernieuwt, dus deze dienst bewaart elke nieuwe en gebruikt die één keer. Een aanmelding die 30 dagen niet wordt gebruikt, verloopt bij Cirrux. Werkt de aanmelding niet meer, dan mislukken de bestanden met een zin die **Cirrux Drive verbinden** noemt: druk er opnieuw op, en de bestanden gaan bij de volgende keer verder. Een nieuw app-wachtwoord van dezelfde mailbox houdt de Drive verbonden; een app-wachtwoord van een andere mailbox begint zonder.

### Cirrux Drive loskoppelen {#disconnect}

Wilt u dat er geen bestanden meer naar de Drive gaan, en het account voor de rest houden, druk dan op de pagina **Accounts** bij het Cirrux-account op **Cirrux Drive loskoppelen**, naast **Cirrux Drive opnieuw verbinden**. Er wordt eerst gevraagd of u het zeker weet; druk op **Ja, loskoppelen**, of op **Verbonden laten** om alles te laten zoals het is.

- **Alleen de aanmelding bij Cirrux Drive verdwijnt.** Deze dienst verwijdert zijn kopie ervan. Het app-wachtwoord blijft, dus mail, agenda's, contacten en taken gaan door zoals ze gingen, en wat al in uw Drive staat, blijft daar: er wordt niets in verplaatst of verwijderd.
- **Er gaan geen bestanden meer heen.** Het account toont bestanden als niet omvat, en **Waar gaat het naartoe?** biedt het niet meer aan voor bestanden. Een migratie die bestanden daarheen stuurt, stopt bij de bestanden met een zin die **Cirrux Drive verbinden** noemt, en stuurt ze nergens anders heen; de andere soorten gegevens gaan door. Een ronde die al bestanden kopieert, stopt binnen ongeveer een minuut, bij het volgende verzoek aan Cirrux.
- **Bij Cirrux eindigt de aanmelding vanzelf.** Cirrux biedt een dienst geen manier om een aanmelding te beëindigen, dus bij Cirrux blijft ze geldig tot ze 30 dagen niet is gebruikt. Wilt u haar eerder beëindigen, open dan in Cirrux Mail **Settings → Security**, waar de apps staan die u toegang hebt gegeven, en trek daar de toegang van deze dienst in ([security](https://cirrux.co/help/security)).
- **Later weer verbinden** gaat met **Cirrux Drive verbinden** en opnieuw aanmelden, zoals de eerste keer; de bestanden gaan verder waar ze stopten.

Drukt u erop bij een account zonder verbonden Drive, dan zegt het scherm dat er niets los te koppelen was.

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

- Wilt u alleen de bestanden stoppen en het account houden voor mail, agenda's, contacten en taken, koppel dan Cirrux Drive los ([Cirrux Drive loskoppelen](#disconnect)).
- Een migratie verwijdert u onder **Migraties**. De bevestiging zegt wat dat doet: **Verwijdert enkel instellingen en registratie van uw migratie in Ownpace, niets bij uw bron of bestemming.** Wat al gemigreerd is, blijft bij Cirrux staan.
- Een account verwijdert u onder **Accounts** met **Verwijderen**. Daarmee verdwijnt de kopie van het app-wachtwoord bij deze dienst, en van de aanmelding bij Cirrux Drive als die verbonden was. Het app-wachtwoord zelf blijft bij Cirrux geldig, en het scherm zegt dat ook: **Wij hebben onze kopie verwijderd; deze aanbieder biedt geen manier om intrekking door ons te forceren.** Ook voor een aanmelding bij Cirrux Drive noemt Cirrux geen manier waarop een dienst haar kan intrekken; niets hier kan haar nog gebruiken, en bij Cirrux verloopt ze zodra ze 30 dagen niet is gebruikt, of wanneer u haar intrekt onder **Settings → Security** in Cirrux Mail.
- Verwijder daarom het app-wachtwoord bij Cirrux: in Cirrux Mail, **Settings → Mailboxes**, de mailbox, het tabblad **Passwords**. Uw Cirrux-wachtwoord blijft zoals het is.
