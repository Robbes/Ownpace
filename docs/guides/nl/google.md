# Google — Drive, Gmail, Agenda, Contacten en Taken

De Microsoft-tegenhanger van deze handleiding is [de Microsoft-handleiding](microsoft.md).

Deze handleiding gaat over de Google-kaarten in de wizard: de kaart **Google account**, en de vier kaarten die elk één Google-product lezen. Heeft deze dienst een eigen Google-app, dan drukt u op **Verbinden met Google** en geeft u bij Google toestemming, en vraagt niets op deze pagina u iets aan te maken. De stappen om een eigen app te maken staan aan het eind, onder [Met een eigen app](#own-app), voor als u liever uw eigen app gebruikt.

## Wat u nodig hebt {#before}

- Het Google-account waarvan de gegevens verhuizen, en de aanmelding ervan. De knop **Verbinden met Google** in de wizard opent het eigen toestemmingsscherm van Google voor dat account.
- Is het account van iemand anders, dan hebt u diens wachtwoord niet nodig: [stuur een toegangslink](#grant-link).
- Migreert u een hele Workspace met veel accounts? Lees dan eerst [domain-wide delegation](#domain-wide-delegation). Die vervangt een toestemming per persoon per product door één handeling van een beheerder, en er is een Workspace-beheerder voor nodig.

## Koppelen {#connect}

Elke kaart vraagt het adres van het account, onder **Gebruikersnaam**, en een **Refresh-token**, dat **Verbinden met Google** invult: druk op de knop, kies het account bij Google en geef toestemming. Het token komt vanzelf in het veld. Daarna leest **Verbindingen testen en bewaren** het account één keer, via precies wat een ronde zou opbouwen, voordat er iets verhuist.

### Google account {#google}

Eén Google-account, één aanmelding. De regel onder de naam van de kaart zegt wat ze bij deze dienst meeneemt: agenda's, contacten en taken, of ook mail en bestanden. Staan er alleen de eerste drie, dan lopen mail en bestanden via de kaarten **Gmail** en **Google Drive** hieronder.

### Google Drive {#google-drive}

Het token vraagt `https://www.googleapis.com/auth/drive.readonly`, en verder niets. Een migratie leest. Het token dat dit product aanmaakt, kan in de Drive van de bron niets maken, wijzigen of verwijderen. Dat is sterker dan een belofte op papier: Google dwingt het af.

Het is een **gedelegeerd** inloggegeven: het leest de Drive van de persoon die toestemming geeft, met de gedeelde Drives die die persoon kan zien. Voor een hele Workspace is er een tweede weg, die u zelf kiest: **[domain-wide delegation](#domain-wide-delegation)**, aan het eind van deze handleiding. Tokens per gebruiker blijven de standaard: de kleinste toegang, per persoon in te trekken, en zonder beheerder.

Het veld **Hoofdmap-ID** laat de migratie ergens anders beginnen dan in Mijn Drive. Een **gedeelde Drive** heeft een eigen ID, en een **map die iemand met dit account deelde** ook. "Gedeeld met mij" is een weergave en geen map, dus wat erin staat verschijnt nooit onder de boom van Mijn Drive; een aparte migratie die bij de ID van de gedeelde map begint, is hoe zo'n map verhuist. De ID's die dit inloggegeven kan bereiken, ziet u met de knop **Gedeelde Drives en mappen bekijken…** in de stap Bron: een lijst, alleen lezend, via dezelfde koppeling die een migratie gebruikt. Losse gedeelde bestanden, die met u gedeeld zijn maar niet in een map staan waar u kunt beginnen, vallen erbuiten.

**Google Documenten, Spreadsheets, Presentaties en Tekeningen** hebben geen bestand om te kopiëren, alleen een weergave die Google maakt, en de wizard vraagt als wat elke soort moet aankomen. Bij elke keuze laat Drive het document omzetten; hier wordt niets geconverteerd.

- Documenten komen aan als `.odt` (OpenDocument), `.docx` (Microsoft Office) of `.pdf`.
- Spreadsheets komen aan als `.ods`, `.xlsx` of `.pdf`.
- Presentaties komen aan als `.odp`, `.pptx` of `.pdf`.
- Tekeningen komen bij beide documentformaten aan als `.svg`, of als `.pdf`.

**Een Tekening is de uitzondering.** Drive biedt een Tekening alleen aan als PNG, JPEG, SVG en PDF; er is geen ODG en geen Office-variant, dus beide documentkeuzes gebruiken SVG. Dat is de enige vectorvorm die er is, hij opent in LibreOffice Draw en in Word, en een PNG zou een diagram zijn dat niemand meer kan bewerken.

**Formulieren, My Maps, Sites, Jamboards en Apps Scripts zijn in geen enkel formaat te exporteren.** Geen keuze verandert dat. Ze worden één voor één gemeld, met een reden die dat zegt, en niet met een verwijzing naar een instelling die niet zou helpen.

Het geëxporteerde bestand krijgt de naam van het document **plus de extensie van wat er is gemaakt**: een Document "Voorbeeldtekst" komt aan als `Voorbeeldtekst.odt`. **Ze laten staan is de standaard**, en nog steeds de eerlijke: er wordt niets gekopieerd en niets gegokt, elk bestand wordt bij naam gemeld, en u beslist. De afweging tussen de formaten gaat over bewerken: OpenDocument en Office houden een bestand bewerkbaar, en een PDF is een afbeelding van het document, geen document dat nog iemand kan bewerken.

### Gmail {#gmail}

**De scope is `https://mail.google.com/`, en een smallere is er niet.** Ownpace leest Gmail via IMAP (XOAUTH2 op `imap.gmail.com:993`), en dat is de enige scope die de IMAP-server van Google accepteert. De fijnere `gmail.readonly`-scopes horen bij de REST-API en worden aan de IMAP-deur geweigerd. De scope leest als volledige toegang tot de mail. Dit product schrijft er nooit mee (de bronkoppeling kan niet schrijven, en Gmail is nooit een doel van een migratie), maar anders dan bij `drive.readonly` van Drive is dat een eigenschap van het product en niet iets wat Google afdwingt. Het staat hier omdat doen alsof het anders is een onwaarheid is die een audit binnen een minuut vindt.

**Een token met toestemming voor Drive werkt niet.** Een refresh-token draagt de scopes waarvoor toestemming is gegeven, en een token voor `drive.readonly` antwoordt `invalid_scope` zodra er een token voor mail wordt gevraagd. **Verbinden met Google** op de kaart Gmail vraagt de mailscope.

Alleen voor een **persoonlijk** account kan het veld **App-wachtwoord** de toestemming vervangen. Lees [het deel daarover](#app-password) voordat u het kiest: Google raadt het af, het vraagt tweestapsverificatie, het bestaat niet op een Workspace-account, en het is het ruimere inloggegeven, niet het smallere. **Beide invullen verandert niets**: de toestemming wint zodra die compleet is, dus een app-wachtwoord dat van een eerdere poging is blijven staan, kan niet ongemerkt de plaats innemen.

#### Een persoonlijk Gmail-account kan een app-wachtwoord gebruiken, en Google ziet dat liever niet {#app-password}

Voor **alleen mail**, en alleen op een **persoonlijk** Google-account, is er een kortere weg: een **app-wachtwoord**. Plak het in het veld **App-wachtwoord** van de wizard en laat de OAuth-velden leeg. De rest van de migratie is precies hetzelfde: dezelfde mappen, dezelfde berichten, dezelfde herkenning van dubbelen.

**Google raadt app-wachtwoorden af, en wij ook.** Dat is geen formaliteit:

- een app-wachtwoord **opent het hele postvak**, waar een token met toestemming alleen opent waarvoor toestemming is gegeven. Het is het ruimere inloggegeven, niet het smallere;
- het vraagt **tweestapsverificatie** op het account voordat Google er een wil maken. Zonder tweestapsverificatie is er geen scherm voor app-wachtwoorden;
- **het bestaat niet op een Workspace-account**: beheerders kunnen het uitzetten, en Google haalt het weg. Hoort het account bij een Workspace, gebruik dan **Verbinden met Google**.

Het ene echte voordeel, en de reden dat deze weg er is: **intrekken kan de eigenaar alleen.** Eén regel in de eigen lijst met app-wachtwoorden van het account verwijderen, en de toegang is weg, zonder Ownpace aan te raken, zonder beheerder, en zonder een OAuth-client te verwijderen die andere migraties misschien gebruiken. Voor iemand die zijn persoonlijke postvak twee weken aan een migratie uitleent, is dat echt iets waard.

Het dagelijkse downloadplafond is **precies hetzelfde**: Google legt het op aan de IMAP-server, niet aan het inloggegeven, dus aan de doorvoer verandert niets.

### Google Calendar {#google-calendar}

Google spreekt nog steeds de protocollen die dit product al kent, dus deze bron is de gewone CalDAV-koppeling, gericht op de agendaserver van Google, met één verschil: **de DAV-servers van Google accepteren alleen OAuth**, dus de verzoeken dragen een token dat uit uw refresh-token wordt gemaakt, geen wachtwoord.

Het token moet toestemming hebben voor de agendascope, `https://www.googleapis.com/auth/calendar`. Een token met toestemming voor Drive, mail of contacten antwoordt hier `invalid_scope`. Google Taken staan niet op de CalDAV van Google: de kaart **Google account** leest ze, met `https://www.googleapis.com/auth/tasks.readonly`.

### Google Contacts {#google-contacts}

Hetzelfde, voor contacten: de gewone CardDAV-koppeling, gericht op de contactenserver van Google, die ook alleen OAuth accepteert.

Het token moet toestemming hebben voor de contactenscope, `https://www.googleapis.com/auth/carddav`. Een token met toestemming voor Drive, mail of agenda's antwoordt hier `invalid_scope`. Eén toestemming kan meerdere scopes dragen, en dat vraagt de kaart **Google account**.

### Het account van iemand anders: stuur een link {#grant-link}

Is het account van een collega, een familielid of een klant, dan is de eerlijke manier om dit token te krijgen **niet** om naar het wachtwoord te vragen, en ook niet om ernaast te zitten terwijl die persoon zich aanmeldt. Open de migratie, druk op **Toegangslink maken**, en stuur de link zelf.

De ander opent de link, ziet wie het vraagt en wat er precies gelezen wordt, meldt zich bij Google aan op de eigen pagina van Google, en drukt op één knop. Het token gaat rechtstreeks naar de migratie. **U ziet het niet, en niemand anders ook niet**: het wordt versleuteld bewaard bij die ene migratie, en niet bij de verbinding, dus het zegt niets over enig ander account.

U kiest hoe lang de link werkt, een dag, een week of een maand, en u kunt hem op elk moment intrekken. Een link werkt één keer: als iemand er toegang mee heeft gegeven, is hij gebruikt. Raakt hij kwijt, trek hem dan in en maak een nieuwe; dat is zo gedaan.

**Wij sturen de link nooit.** Dat doet u, zoals u die persoon gewoonlijk bereikt. Ownpace leert het adres van die persoon nooit kennen, en kan het dus ook niet lekken.

### Domain-wide delegation: één handeling van een beheerder in plaats van N toestemmingen {#domain-wide-delegation}

Een Workspace-beheerder kan een **service-account** één keer toestemming geven om zich als gebruikers voor te doen, voor een opgesomde lijst scopes. Gebruik dit als toestemming per gebruiker niet meer te doen is; sla het over voor een handvol accounts. **Weet hoe ver het reikt voordat u het kiest: de sleutel kan voor de toegestane scopes elke gebruiker in het domein lezen.** Elke migratie noemt nog steeds precies één account (het onderwerp); wat ruimer wordt is het inloggegeven, niet een migratie.

De schermen van Google staan hieronder met hun Engelse namen; Google toont ze in de taal van uw account.

1. **Maak een apart service-account** (IAM → service accounts) in een willekeurig Google Cloud-project, zonder rollen en zonder iets anders. Het heeft maar één taak: deze migratie.
2. **Maak een JSON-sleutel** (keys → add key → JSON). Dit bestand is nu het gevoeligste geheim van de migratie; behandel het zo.
3. **Geef toestemming in de Admin console**: Admin → Security → Access and data control → API controls → **Domain-wide delegation** → voeg de client-ID van het service-account toe, met ALLEEN de scopes die de gekozen producten nodig hebben, nooit een ruimere set "voor de zekerheid":

- Drive: `https://www.googleapis.com/auth/drive.readonly`
- Gmail: `https://mail.google.com/`
- Agenda: `https://www.googleapis.com/auth/calendar`
- Contacten: `https://www.googleapis.com/auth/carddav`
- Taken: `https://www.googleapis.com/auth/tasks.readonly`

4. **Vul het in**: plak het hele sleutelbestand in het veld **Serviceaccount-sleutel** van de wizard, en geef bij elke migratie het account op. De refresh-tokenvelden zijn dan niet meer verplicht; de weigeringen zeggen het als er iets ontbreekt.
5. **Trek het in bij de overstap.** Verwijder de delegatie in de Admin console (en de sleutel) als de migratie klaar is. Het inloggegeven leeft zo lang als de migratie, en deze stap hoort evengoed bij de verhuizing als stap 3.

## Wat er meegaat {#what-moves}

**Wat er met labels gebeurt.** Via IMAP toont Gmail elk label als een map, en die verhuizen als mappen. Gmail toont ook drie weergaven die berichten uit andere mappen nog eens bevatten: All Mail, Starred en Important. Die kopiëren zou elk bericht dubbel opleveren, één keer per weergave waarin het staat. Daarom slaat Ownpace die drie weergaven over (herkend aan de eigen kenmerken `\All`/`\Flagged`/`\Important` van Google, die in elke taal gelijk blijven) en migreert het alles wat echt is: INBOX, uw labels, Sent, Drafts. Prullenbak en Spam worden standaard niet gekopieerd, zoals bij elke IMAP-bron, terwijl de prullenbak wel wordt gelezen als bewijs van verwijderingen. Een bericht met meerdere labels staat in meerdere mappen, maar mail wordt herkend aan de Message-ID, dus het wordt **één keer gekopieerd**, naar de map waar een ronde het eerst ziet. Wordt het later onder een ander label gezien, dan wordt het niet opnieuw gekopieerd; het kan wel in de wachtrij **Verplaatsingen** verschijnen als melding van een plaatsing aan de bronkant. Dat is informatie, geen opdracht. Labelt u veel, dan beschrijft die wachtrij vooral de labels van Gmail, en niet iets wat u deed.

### Wat een Drive-migratie nog niet doet {#drive-not-yet}

Hier gezegd, zodat u het niet zelf hoeft te ontdekken:

- **Geen stapsgewijze delta.** Elke ronde loopt elke map langs. De tweede ronde kopieert niets wat er al staat: het kost een lijst, geen nieuwe kopie.
- **Verwijderingen worden nooit uit het verwijdersignaal van Drive gehaald.** Google zet dat ook bij verloren toegang en bij gewijzigd delen, en dat zijn geen verwijderingen. Wat een ronde WEL leest, is de **prullenbak** van de eigenaar: een bestand in de prullenbak is een verwijdering door de eigenaar, meteen gemeld met echt bewijs, en de wachtrij **Verwijderingen** kan dan aanbieden om de kopie op het doel weg te halen. Is de prullenbak geleegd, dan valt het terug op tellen wat ontbreekt.
- **Een verplaatst of hernoemd bestand laat de oude kopie op het doel staan.** Het wordt herkend en gemeld; het doel laten volgen is iets wat u per bestand goedkeurt, in de wachtrij **Verplaatsingen**. Een Google Document, Spreadsheet, Presentatie of Tekening wordt herkend aan de Drive-ID, dus hernoemen wordt als verplaatsing gemeld en nooit als verwijdering, in welk formaat het ook wordt geëxporteerd.
- **Twee bestanden met dezelfde naam in dezelfde map kunnen niet allebei mee.** Een bestand wordt herkend aan zijn pad, dus twee met hetzelfde pad zijn een harde stop, geen instelling.

### Google Foto's, en de back-ups van apparaten {#photos}

**Foto's worden niet gemigreerd, en de reden ligt bij Google, niet bij ons.** Sinds 31 maart 2025 laat de Photos Library API een app van derden de bibliotheek van iemand niet meer lezen: een app ziet alleen wat hij zelf uploadde, of wat de persoon met de hand kiest in de eigen kiezer van Google, één selectie per keer. Een volledige, onbewaakte kopie van een fotobibliotheek via de API is dus voor geen enkel product mogelijk, en een verbinding die dat aanbood, zou iets beloven wat Google weigert. De volledige weg die Google openlaat is **Google Takeout**: de persoon exporteert zijn bibliotheek als archief. Dat is een momentopname om te downloaden en geen account om te lezen, en dus een ander soort migratie dan de accountkaarten op deze pagina. De kaart **Export archive** leest een Takeout van Google Foto's: [de handleiding voor het exportarchief](archive.md) zegt hoe u er een bij Google aanvraagt, en waar het moet staan zodat de kaart het kan lezen.

**En de voor de hand liggende hoop redt het niet.** Google publiceert een Data Portability API voor mensen in de Europese Economische Ruimte, gemaakt om aan de Digital Markets Act te voldoen, en dat klinkt als precies het antwoord. De volledige lijst scopes is gelezen op 4 september 2026, en **Google Foto's staat er niet bij**, en Drive, Gmail, Contacten en Agenda ook niet. Wat hij draagt, is zoek- en activiteitengeschiedenis, Chrome, bijdragen aan Maps, Play en YouTube. De twee scopes die op foto's lijken, zijn het niet: de ene is wat u op Maps plaatste, de andere zijn uploads voor Street View. Een fotobibliotheek heeft nu dus twee aparte redenen om buiten bereik te zijn, en Takeout is geen noodoplossing tot er iets beters komt: het is de enige volledige weg die er is.

**Back-ups van apparaten** (de regel "Back-up van apparaat" in het opslagoverzicht van Google) zijn de eigen back-ups van apps en instellingen van Android, alleen leesbaar voor een Android-apparaat dat zich aanmeldt. Dat zijn geen gegevens die dit product kan of zou moeten lezen, en ze blijven waar ze zijn.

Daarom komt het gemeten Drive-getal van een verbinding overeen met de regel Google Drive van Google zelf, en niet met het totaal van de opslag: foto's, back-ups en Gmail telt Google onder hun eigen kopjes, en Ownpace meet elk onderdeel dat het kan bereiken onder het zijne.

## Als de test iets meldt {#when-test-says}

- **`accessNotConfigured`**, met de naam van een API: in het Google Cloud-project achter de app staat die API uit. De zin van Google noemt de API en linkt naar de juiste pagina, en de test toont die zin, niet de XML waarin hij binnenkomt. Wordt de app van deze dienst gebruikt, dan is dat een instelling van deze dienst: meld het aan wie deze dienst beheert. Met [uw eigen app](#own-app) zet u hem aan in uw project.
- **`invalid_scope`**: het refresh-token kreeg toestemming voor een ander Google-product. Verbind opnieuw vanaf de kaart waarop u bent.
- **`unauthorized_client`** met een sleutel van een service-account betekent dat stap 3 van [domain-wide delegation](#domain-wide-delegation) ontbreekt of de verkeerde scope noemt; de foutmelding noemt de client-ID en de scope die erbij moeten. Een `invalid_grant` daar betekent meestal dat het onderwerp geen gebruiker in het domein is.
- **`invalid_grant`**: het refresh-token is dood. **Behandel het refresh-token als een wachtwoord.** Het geeft leestoegang tot het wordt ingetrokken, en het verloopt niet vanzelf. Het sterft wel als:

1. het wachtwoord van het account verandert;
2. de beheerder van het account de toegang van de app weghaalt;
3. het zes maanden niet wordt gebruikt.

Elk van deze geeft dezelfde `invalid_grant` van Google, en de melding van de test noemt ze, samen met de twee oorzaken die bij de app horen, hieronder. Verbind opnieuw om een nieuw token te maken. Wordt de app van deze dienst gebruikt en sterft een nieuw token steeds binnen een paar dagen, dan ligt het aan de app, niet aan het account: meld het aan wie deze dienst beheert. Met [uw eigen app](#own-app) moet u nog twee oorzaken nakijken, en de eerste keert elke week terug: de app is External en staat nog in Testing (zie [van wie is het Google-account?](#own-app-whose-account)), of de OAuth-client ervan is verwijderd.

## Stoppen {#leaving}

- Een toestemming die met **Verbinden met Google** is gegeven, trekt u in bij Google, in de beveiligingsinstellingen van het Google-account, in de lijst met apps van derden die toegang hebben.
- Een **app-wachtwoord** trekt u in door de regel ervan te verwijderen uit de eigen lijst met app-wachtwoorden van het account. De toegang is meteen weg, en verder wordt niets aangeraakt.
- Een **service-account** trekt u in door de delegatie in de Admin console te verwijderen, en de sleutel.
- Met [uw eigen app](#own-app) trekt het verwijderen van de OAuth-client elk token in dat ermee is gemaakt.

## Met een eigen app {#own-app}

Dit doet u één keer, in **uw eigen** Google Cloud-project, zodat Ownpace een Google-account kan lezen met een client van uzelf. Het levert twee waarden op, client-ID en clientgeheim, die in het deel **Uw eigen Google-client gebruiken** van de wizard horen, naast **Verbinden met Google**.

**Hetzelfde model als bij Microsoft, om dezelfde redenen.** De appregistratie staat in **uw** project en is door u geregistreerd; het inloggegeven blijft bij u; en intrekken doet u zelf: verwijder de OAuth-client en elk token is dood. De knop **Verbinden met Google** in de wizard regelt de toestemming voor u met uw eigen client: hij opent het toestemmingsscherm van Google met uw client-ID en geheim, en vult het refresh-token voor u in.

De schermen van Google Cloud staan hieronder met hun Engelse namen; Google toont ze in de taal van uw account.

### Begin hier: van wie is het Google-account? {#own-app-whose-account}

Dit ene antwoord bepaalt of u überhaupt beveiligingswaarschuwingen ziet. **Kiest u verkeerd, dan werkt alles nog, maar met banners, een lijst testgebruikers en een token dat elke zeven dagen stil verloopt.**

**Een Workspace-account, dat u binnen de eigen organisatie migreert.** Kies **Internal** bij de stap van het toestemmingsscherm hieronder. Google slaat de verificatie dan helemaal over: geen waarschuwing "Google hasn't verified this app", geen lijst testgebruikers, geen verlopen token. Dat geldt voor de meeste lezers, en het kost niets.

**Een persoonlijk Google-account** (`@gmail.com`), of een Workspace-account dat vanuit een andere organisatie wordt gelezen. Kies **External**, want een andere keuze hebt u niet, en **zet de publicatiestatus op Production**. U ziet één keer een waarschuwing over een niet-geverifieerde app, en klikt die weg. Laat de app **niet** in Testing staan: Google laat refresh-tokens in die toestand na **zeven dagen** verlopen, en een migratie die maanden loopt, faalt dan elke week met `invalid_grant`, lang nadat iemand zich nog herinnert hoe het is ingesteld.

### 1. Het project en de API {#own-app-project}

1. [Google Cloud Console](https://console.cloud.google.com/) → maak een project (of kies er een).
2. **APIs & Services → Library →** zet de API aan achter elk onderdeel dat deze client bedient. Elk is een aparte schakelaar, en een schakelaar die uit staat, weigert het eerste verzoek met `accessNotConfigured`.

- Bestanden: **Google Drive API**, voor elk Drive-verzoek.
- Agenda: **CalDAV API**. De CalDAV-server van Google is een Cloud-API zoals elke andere.
- Contacten: **Google Contacts CardDAV API**, hetzelfde, voor CardDAV.
- Mail: **Gmail API**. IMAP zelf heeft geen API nodig; staat deze aan, dan staat de scope `https://mail.google.com/` in de scopekiezer van het toestemmingsscherm en hoeft u hem niet met de hand te plakken.
- Taken: **Google Tasks API**. De taken van Google staan niet op de CalDAV; het onderdeel Taken leest deze API.

Een Google-accountverbinding waarvan de toestemming goed was verlopen, is bij de test geweigerd met "CalDAV API has not been used in project … before or it is disabled": niets had tot dan toe gezegd dat die API bestond.

### 2. Het toestemmingsscherm {#own-app-consent-screen}

**APIs & Services → OAuth consent screen.**

Deze keuze maakte u [hierboven](#own-app-whose-account). In de woorden van de console zelf:

- **Internal** als het account in dezelfde Workspace-organisatie zit: het juiste antwoord voor een migratie, en het slaat de verificatie van Google helemaal over.
- **External** alleen als de bron een persoonlijk Google-account is. **Zet de publicatiestatus dan op Production** en accepteer de waarschuwing over een niet-geverifieerde app. In Testing blijven beperkt u tot 100 testgebruikers, vraagt dat u het account als testgebruiker toevoegt, en, wat echt pijn doet, **laat elk refresh-token na zeven dagen verlopen**.
- Voeg de scopes toe van de producten die u leest, uit de lijsten hierboven. Voeg niets anders toe: een scope die niet nodig is, is een recht dat iemand later moet verantwoorden.

### 3. De OAuth-client {#own-app-client}

**APIs & Services → Credentials → Create credentials → OAuth client ID.**

Kies **Web application** en voeg een geautoriseerd omleidingsadres toe (Authorised redirect URIs): de wizard toont de precieze waarde als u met uw eigen client op **Verbinden met Google** drukt, zodat een verschil zichtbaar is voordat Google weigert. Het eindigt op `/api/migrations/google/callback`. De omleiding is er alleen om het refresh-token één keer te krijgen; daarna gebruiken migraties het refresh-token rechtstreeks.

Kopieer de **client ID** en het **client secret**, open **Uw eigen Google-client gebruiken** in de wizard, vul beide in en druk op **Verbinden met Google**.

### 4. Het refresh-token, met de hand {#own-app-token}

**Verbinden met Google doet deze stap voor u**, voor een account waarop u zelf kunt aanmelden. Met de hand gaat het met de eigen [OAuth Playground](https://developers.google.com/oauthplayground/) van Google, nadat u `https://developers.google.com/oauthplayground` als tweede omleidingsadres aan de client hebt toegevoegd:

1. Tandwiel → **Use your own OAuth credentials** → plak de client-ID en het geheim.
2. Vul links in het scopevak de scope in van het product dat u leest → **Authorize APIs**, en meld u aan als het account dat u migreert.
3. **Exchange authorization code for tokens.** Kopieer het **refresh token** naar het veld **Refresh-token** van de wizard.

De playground is een gemak, geen vereiste. Elke OAuth2-authorization-code-flow met uw eigen client werkt, zolang die om `access_type=offline` vraagt: zonder dat geeft Google alleen een toegangstoken, dat na een uur verloopt en niet te vernieuwen is.
