# Apple (iCloud) — één wachtwoord, vier onderdelen, en geen knop

Een Apple-migratie meldt zich aan met **één app-specifiek wachtwoord**. Er is geen toestemmingsscherm om op te klikken, en dat ligt aan Apple, niet aan een gat in dit product. [De reden](#no-button) staat hieronder, want het is de eerste vraag die iedereen stelt.

Wat één Apple-verbinding meeneemt:

- **E-mail**: ja, via IMAP op `imap.mail.me.com:993`.
- **Agenda's**: ja, via CalDAV op `caldav.icloud.com`.
- **Contacten**: ja, via CardDAV op `contacts.icloud.com`, een **andere server**.
- **Herinneringen**: ja, via CalDAV, als `VTODO`'s; zie [Wat herinneringen meebrengen](#reminders).
- **iCloud Drive**: **nee**. Er is geen API. Zie [Bestanden](#files).

U typt geen van die servers. Het zijn de gepubliceerde waarden van Apple, in dit product vastgelegd met het adres en de dag waarop ze zijn gelezen, en de kaart vult ze in.

## Wat u nodig hebt {#before}

- Uw Apple-account, en het adres waarmee u zich bij iCloud aanmeldt.
- Een [app-specifiek wachtwoord](#app-password) daarvoor, gemaakt op `account.apple.com`. Niet het wachtwoord van uw Apple-account.

## Koppelen {#connect}

### 1. Maak een app-specifiek wachtwoord {#app-password}

**Gebruik niet het wachtwoord van uw Apple-account.** Elk Apple-account heeft tweestapsverificatie, en het eigen wachtwoord van zo'n account wordt **met opzet geweigerd door IMAP, CalDAV en CardDAV**. Het is niet het verkeerde wachtwoord: het is het goede wachtwoord van een soort die hier niet kan, en het zorgvuldiger typen zal nooit werken.

1. Meld u aan op [`account.apple.com`](https://account.apple.com).
2. **Aanmelden en beveiliging** → **App-specifieke wachtwoorden**.
3. Maak er een en geef het een naam die u later herkent, bijvoorbeeld `Ownpace`.
4. Apple toont het **één keer**, in de vorm `abcd-efgh-ijkl-mnop`. Kopieer het nu; u kunt het niet nog eens zien, en wie het kwijt is, trekt het in en maakt een nieuw.

### 2. Voeg de verbinding toe {#apple}

Verbindingen → **Verbinding toevoegen** → **Apple account (iCloud)**. Twee vakken:

- **Gebruikersnaam**: uw iCloud-adres, `you@icloud.com`.
- **App-specifiek wachtwoord**: plak wat Apple u toonde.

**Toevoegen en testen.** De test vraagt elk onderdeel op zijn eigen server: agenda's op `caldav.icloud.com`, contacten op `contacts.icloud.com`, mail op `imap.mail.me.com`. Hij meldt per onderdeel wat hij vond, met aantallen. Een onderdeel dat hij niet kon meten, zegt op de kaart **waarom**, in plaats van een kaal `?` te tonen.

### Waarom er geen knop Verbinden met Apple is {#no-button}

Verbindingen met Google, Microsoft en Dropbox bieden een toestemmingsknop met één klik. De Apple-kaart niet, en dat komt niet door gebrek aan moeite.

**Apple publiceert voor Mail, Agenda, Contacten, Herinneringen en iCloud Drive geen OAuth-scope voor wie dan ook buiten Apple.** Er is geen toestemmingsscherm om u naartoe te sturen, geen token om te ontvangen, en niets wat een knop zou kunnen doen. Het is geen recht dat wij nog moeten aanvragen of een verificatie die we nog moeten kopen: de scope bestaat voor derden gewoon niet.

**Inloggen met Apple is iets anders, en dat bestaat hier wel.** Biedt deze dienst het aan, dan kunt u zich met uw Apple-account bij dit product aanmelden. Dat geeft een naam en een e-mailadres: een identiteit, geen postvak. Het bereikt geen van uw gegevens, en het vervangt de verbinding hierboven niet. Beide kunnen tegelijk waar zijn en brengen mensen vaak in de war: de knop op het aanmeldscherm gaat over **wie u bent**; het wachtwoord op deze pagina gaat over **wat er gelezen mag worden**.

## Wat er meegaat {#what-moves}

E-mail, agenda's, contacten en herinneringen, wat u aanvinkt. Niet iCloud Drive.

### Wat herinneringen meebrengen {#reminders}

De herinneringen van Apple zijn `VTODO`-objecten op dezelfde CalDAV-server als uw agenda's, dus één inloggegeven bereikt beide. Maar het zijn **geen** afspraken, en dit product doet ook niet alsof. Taken zijn een eigen soort gegevens, apart van afspraken. Een herinnering als afspraak in de agenda zetten, zou iets opleveren wat gemigreerd lijkt en fout is.

Het doel moet dus ook taken kunnen dragen. Een CalDAV-doel dat in zijn `supported-calendar-component-set` alleen `VEVENT` noemt, kan ze niet aannemen, en de wizard zegt dat wanneer u kiest wat u migreert, in plaats van halverwege een ronde te falen.

### Bestanden: iCloud Drive, en waarom het een nee is en geen ? {#files}

De Apple-kaart toont **Bestanden: nee**, met een zin erbij, nooit een `?` en nooit een leeg vinkje. Het verschil doet ertoe: een `?` betekent dat we het niet konden nagaan, een **nee** betekent dat we het nagingen en dat het antwoord nee is.

**Apple publiceert geen API voor iCloud Drive, voor niemand, niet alleen niet voor ons.** Er is geen adres, geen scope en geen beschreven protocol dat een derde zou kunnen gebruiken. Anders dan Google Drive, OneDrive, Dropbox en Box, die dit product allemaal leest, is de inhoud van iCloud Drive niet vanuit het account te bereiken.

De enige weg naar die bestanden is **uw eigen export via Data & Privacy** op [`privacy.apple.com`](https://privacy.apple.com), die Apple u als downloadlink geeft. Dat is iets heel anders: een archief met een datum erop, geen account dat leeft.

**Nog te testen.** Een Apple-export kunnen we nog niet lezen. Vraag die alleen aan voor uw eigen archief. De [handleiding voor het exportarchief](archive.md#apple-privacy) heeft de stappen.

### Wat de export van Apple u echt geeft {#export}

Uit de eigen aanvraagstappen van Apple en de ondersteuningspagina [HT102208](https://support.apple.com/102208) (gepubliceerd op 24 april 2026), gelezen op 4 september 2026: dit is dus gemeten, niet nagezegd. Er zijn **twee verschillende wegen**, en mensen halen ze door elkaar. Apple toont de knoppen in de taal van uw account; hier staan ze met hun Engelse namen.

**Request a copy of your data**: de download. U vinkt categorieën aan, Apple controleert dat het verzoek van u komt, en zet de bestanden dan op uw pagina Data & Privacy. Twee klokken:

- **tot zeven dagen** om het klaar te maken, de controleperiode;
- een downloadperiode die eindigt op de datum achter **"Available until"** op uw eigen aanvraagpagina. Gebruik die datum en geen aantal dagen: de veertien dagen die vaak worden genoemd, klopten niet bij de ene aanvraag die we hebben gevolgd ([de handleiding voor het exportarchief](archive.md#apple-deadline) heeft de details). Na die datum haalt Apple de download van die pagina weg, en vraagt u hem opnieuw aan, van voren af aan.

De grootste bestandsgrootte kiest u zelf, **1, 2, 5, 10 of 25 GB**, en Apple deelt de gegevens op in delen die niet groter zijn.

Wat er terugkomt, in de eigen beschrijving van Apple:

- **foto's, video's en documenten in hun oorspronkelijke formaat**: het deel dat ertoe doet, en de reden dat de export het antwoord is voor iCloud Drive;
- **contacten, agenda's, bladwijzers en mail als `.vcf`, `.ics`, `.html` en `.eml`**: gewone uitwisselformaten, geen container die alleen Apple kan openen;
- notities en herinneringen, die ernaast in iCloud staan;
- gebruik van apps en activiteit als spreadsheets of als `.json`, `.csv`, `.pdf`.

Tijden staan overal in **UTC**, dus er hoeft niets uit een lokaal tijdsverschil te worden geraden.

Apple is ongewoon duidelijk over waar dit voor is: op de vraag of u de gegevens naar een andere aanbieder kunt verhuizen, antwoordt Apple in het Engels "Yes. We provide your data in industry-standard formats designed to be easy to import into other services.": ja, in standaardformaten die gemaakt zijn om makkelijk in andere diensten te importeren.

### Wat de export niet bevat, en één ding om na te kijken {#export-not}

- **Berichten.** iMessage en sms zijn op uw apparaat versleuteld en voor niemand leesbaar zonder uw toegangscode. Ze zitten niet in de export, en geen migratie kan ze meenemen.
- **Gekochte apps, boeken, films, tv of muziek.** U krijgt de lijst van wat u kocht; de inhoud zelf downloadt u opnieuw uit de winkel.
- **Sommige velden zijn gemaskeerd.** Apple maskeert bepaalde gegevens in de bestanden die het geeft, als bescherming tegen fraude: kaart- en bankgegevens, apparaat-ID's en **e-mailadressen**. Of dat maskeren ook de contactkaarten zelf raakt, is **niet iets om aan te nemen, de ene of de andere kant op**: het zou de `.vcf`-bestanden nutteloos maken voor de verhuizing die Apple hierboven beschrijft, dus waarschijnlijk geldt het voor de gegevens over activiteit en aankopen. Kijk uw eigen export na voordat u een verhuizing van contacten eromheen plant.

### Twee grenzen om te kennen voordat u begint {#export-limits}

- **Het is niet overal beschikbaar.** Apple zegt dat de toegang tot deze functie per land en regio verschilt. Staat de optie niet op uw pagina Data & Privacy, dan wordt ze waar u bent niet aangeboden.
- **U kunt een categorie niet opnieuw aanvragen terwijl er een loopt.** Wilt u iets opnieuw vragen dat u al had aangevraagd, wacht dan tot de lopende aanvraag klaar is en van de pagina is gehaald. Dat doet ertoe als u een tweede, latere export wilt die vangt wat er veranderde.
- Wordt uw Apple-account **beheerd door een school**, dan moet de beheerder u toestaan zich bij de pagina Data & Privacy aan te melden voordat iets hiervan werkt.

Een **terugkerende** planning bestaat wel, en ze is smal: in de Europese Unie, het Verenigd Koninkrijk en Japan kunt u een herhaalde download plannen, dagelijks gedurende 30 dagen of wekelijks gedurende 180 dagen, voor **gegevens uit de App Store en activiteit rond het installeren van apps en pushmeldingen**. Niets in iCloud is te plannen, dus een export van uw Drive of Foto's vraagt u telkens met de hand opnieuw aan.

**Transfer a copy of your data**: de tweede weg, rechtstreeks naar een andere dienst zonder download ertussen. Apple biedt die nu aan voor **iCloud-foto's → Google Foto's** en **afspeellijsten van Apple Music → YouTube Music**, en verder nergens voor. Gaan uw foto's naar Google, dan is die weg eenvoudiger dan wat dit product kan bieden; gaan ze ergens anders heen, dan is hij niet van toepassing. Overdrachten lopen beide kanten op, en hun status staat op dezelfde pagina Data & Privacy.

### Welke weg u echt wilt {#which-route}

Verhuist u **e-mail, agenda's, contacten of herinneringen**, gebruik dan de verbinding hierboven: die leeft, gaat stap voor stap mee, en niets wacht een week. De export is alleen van waarde voor de twee onderdelen die de verbinding niet bereikt: **iCloud Drive en Foto's**.

Zegt iemand u dat iCloud Drive automatisch te migreren is, vraag dan welke API diegene gebruikte.

**Eén ding dat makkelijk verkeerd wordt gelezen.** Apple publiceert wel een API voor het meenemen van gegevens, voor mensen in de Europese Unie, gemaakt voor de Digital Markets Act en open voor diensten die u toestemming geeft. Het ligt voor de hand om aan te nemen dat dat hier het antwoord is. Dat is het niet: op 4 september 2026 draagt die API **gegevens uit de App Store**, uw aankoopgeschiedenis en app-downloads, en helemaal geen inhoud uit iCloud. Apple bouwde het mechanisme en richtte het ergens anders op. Of het ooit naar iCloud wordt uitgebreid, is een vraag voor regelgevers en niet voor techniek, en niets hier wacht erop.

### Wat gemeten is, en wat beredeneerd {#measured}

Dit product gokt geen serveradres of gedrag van een aanbieder: het meet ze, of zegt dat het dat niet deed. Daarom is het goed om duidelijk te zijn over welke zinnen hierboven wat zijn.

- De **servers en poorten** zijn de gepubliceerde waarden van Apple, vastgelegd met de dag waarop ze zijn gelezen.
- Het **ontbreken van een API voor iCloud Drive** en het **ontbreken van een OAuth-scope voor gegevens** komen uit de ontwikkelaarsdocumentatie van Apple: het zijn afwezigheden, en juist zo'n bewering moet opnieuw worden nagekeken in plaats van te worden aangenomen dat ze blijft kloppen.
- Het **gedrag van een echt iCloud-account** is **nog niet gemeten**: of het app-specifieke wachtwoord met de streepjes die Apple toont wordt geaccepteerd, of Apple als gebruikersnaam het deel voor de @ of het hele adres wil, en welke aantallen per onderdeel terugkomen. Een begeleide ronde tegen een echt account maakt die van beredeneerd tot gemeten. Tot die is gedaan, is deze pagina juist over het ontwerp van Apple en onbewezen over de servers van Apple.

## Als de test iets meldt {#when-test-says}

Typt u per ongeluk het wachtwoord van uw account, dan zegt de verbindingstest dat in zijn eigen woorden, in plaats van de weigering van Apple door te geven: hij legt uit dat het wachtwoord van de verkeerde soort is, niet fout, en zegt waar u het goede maakt. Die zin bestaat omdat de eigen foutmelding van Apple (`AUTHENTICATIONFAILED`) iets zegt wat waar is en niet helpt. Maak een [app-specifiek wachtwoord](#app-password) en plak dat.

## Stoppen {#leaving}

Een app-specifiek wachtwoord wordt **ingetrokken op `account.apple.com` → Aanmelden en beveiliging → App-specifieke wachtwoorden**, en nergens anders. Apple publiceert geen adres om het in te trekken, dus dit product kan het niet voor u intrekken en beweert dat ook niet: de verbinding hier verwijderen haalt ons bewaarde exemplaar weg, en laat het wachtwoord bij Apple geldig tot u het daar intrekt.

Het goede nieuws is dat intrekken **precies** is. Het raakt alleen dat wachtwoord: het wachtwoord van uw Apple-account blijft zoals het is, elke andere app blijft werken, en niets hoeft opnieuw te worden aangemeld. Dat is het tegenovergestelde van het gebruikelijke advies om het wachtwoord van uw account te wijzigen, wat het meest verstorende is wat u kunt doen, en de ene handeling die dit wachtwoord niet intrekt.

Trek het in zodra de migratie klaar is. Niets hier hangt ervan af dat het langer leeft dan de verhuizing.
