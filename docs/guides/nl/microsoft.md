# Microsoft 365 — het account, de toestemming, de registratie

De kaart **Microsoft 365 account** meldt zich aan met een **appregistratie in Microsoft Entra ID** en een refresh-token waarvoor het account dat u migreert toestemming geeft. Die kaart leest alleen, en dat zit in de opbouw zelf: de toestemming vraagt alleen de gedelegeerde `.Read`-rechten die onder [Met een eigen app](#own-app) staan, dus dit product kan niet in het postvak, de agenda's, de contacten of OneDrive schrijven, ook niet als het dat zou willen. Dat is een afgedwongen garantie, geen belofte op papier. De kaarten **Via de Graph-API** en **Via IMAP** werken anders, met de registratie van een beheerder: zie [de registratie die deze twee kaarten nodig hebben](#application).

**De meeste mensen hebben alleen de eerste kaart nodig.** Heeft deze dienst een eigen registratie, dan tonen de wizard en de pagina Verbindingen een knop **Verbinden met Microsoft**, en hoeft u niets onder [Met een eigen app](#own-app) te doen. Lees dat deel alleen als u liever uw eigen registratie gebruikt.

## Wat u nodig hebt {#before}

- Het Microsoft-account waarvan de gegevens verhuizen, en de aanmelding ervan: een werk- of schoolaccount, of een persoonlijk Microsoft-account.
- Als uw organisatie wil dat een beheerder apps goedkeurt: die beheerder. De toestemming zegt het als dat nodig is; zie [Als de test iets meldt](#when-test-says).
- Voor de kaarten **Via IMAP** en **Via de Graph-API**: een appregistratie in uw eigen tenant, met toestemming van een beheerder. Zie [de registratie die ze nodig hebben](#application).

## Koppelen {#connect}

### Microsoft 365 account {#microsoft}

Eén Microsoft 365-account, één aanmelding: e-mail, agenda's, contacten en OneDrive, wat u aanvinkt.

**De korte weg: druk op Verbinden met Microsoft.** De knop opent het toestemmingsscherm van Microsoft voor het account dat u migreert. Keurt dat account het goed, dan komt het refresh-token vanzelf in het veld **Refresh-token**, en wordt de verbinding in één keer bewaard en getest. U typt niets, en het clientgeheim verlaat de server niet.

Het scherm vraagt eerst **welk account**, en dat is met opzet. Zonder die vraag geeft iemand die al met het verkeerde Microsoft-account is aangemeld stilzwijgend toestemming voor dát account, en leest de migratie het verkeerde postvak. Dat ziet eruit als succes, tot iemand merkt wiens mail er is aangekomen.

U kunt ook uw eigen registratie gebruiken: open **Uw eigen appregistratie gebruiken** en vul de **Client-ID (applicatie-ID)** en het **Clientgeheim** in, **als paar**. Een half paar wordt geweigerd en niet aangevuld met de andere helft van deze dienst: een client-ID die niet van deze dienst is, samen met een geheim dat dat wel is, zou Entra uren later weigeren, midden in een ronde. [Met een eigen app](#own-app) heeft de stappen.

#### Wat de test laat zien {#what-test-shows}

**Testen** leest eerst bij Microsoft terug waarvoor toestemming is gegeven, en de labels op de verbinding zeggen dus welke onderdelen het account echt heeft toegestaan. Een onderdeel dat u aanvinkte, toont zijn agenda's, mappen, adresboeken of lijsten met een aantal. Een onderdeel dat u niet aanvinkte, toont de scope die het nodig heeft en het vinkje dat die toevoegt: verbind het account dan opnieuw, met dat onderdeel aangevinkt. Achter **Gevonden:** staat wat snel te weten is: de ruimte die OneDrive gebruikt, het aantal berichten in de mappen van het postvak, en het aantal contacten per adresboek.

### Via de Graph-API {#graph}

**Via IMAP** en **Via de Graph-API** melden zich aan met uw eigen registratie, met **toepassingsrechten** die een beheerder in uw eigen tenant verleent. Dat is wat een beheerder nodig heeft die de postvakken van anderen migreert; de gedelegeerde toestemming van de kaart **Microsoft 365 account** kan dat nooit. De wizard vraagt het adres van het postvak, onder **Gebruikersnaam**, en de **Tenant-ID**, de **Client-ID (applicatie-ID)** en het **Clientgeheim** van die registratie.

Beide kaarten lezen de mail van één postvak. Agenda's, contacten, OneDrive en To Do lopen via de kaart **Microsoft 365 account**.

Deze kaart leest het postvak via Microsoft Graph, met één Microsoft Graph-recht: [Via de Graph-API: het recht in Microsoft Graph](#application-graph).

### Via IMAP {#oauth2}

Dezelfde vier velden als bij **Via de Graph-API**; deze kaart leest het postvak via IMAP. Het recht dat ze nodig heeft, is geen Microsoft Graph-recht. IMAP hoort bij Exchange Online, dus het recht en het postvak worden daar gegeven: [Via IMAP: het recht in Exchange Online](#application-imap).

### De registratie die deze twee kaarten nodig hebben {#application}

Deze twee kaarten vragen altijd een eigen registratie, wat deze dienst ook heeft. Daarom staan de stappen hier en niet onder [Met een eigen app](#own-app). Een beheerder van uw Microsoft 365-organisatie doet ze één keer. Microsoft toont zijn beheercentra in de taal van uw browser; hieronder staan de schermen met hun Engelse namen, zoals Microsoft ze in zijn documentatie noemt.

1. [Entra-beheercentrum](https://entra.microsoft.com) → Identity → Applications → **App registrations** → New registration. Kies **Accounts in this organizational directory only**, laat het omleidingsadres leeg en registreer.
2. Kopieer op de pagina Overview de **Application (client) ID** en de **Directory (tenant) ID**. Die horen in de velden **Client-ID (applicatie-ID)** en **Tenant-ID** van de wizard.
3. **Certificates & secrets** → New client secret. Kopieer de **Value** meteen, want Entra toont die maar één keer. Die hoort in het veld **Clientgeheim**.
4. Voeg het recht toe van de kaart die u gebruikt, en geef er als beheerder toestemming voor: de twee delen hieronder hebben de stappen. Een toepassingsrecht heeft geen aangemelde persoon om het aan te vragen, dus het werkt pas als een beheerder toestemming heeft gegeven.

Er komt geen refresh-token aan te pas: deze kaarten melden zich aan als de toepassing zelf, en de wizard vraagt er ook geen.

#### Via de Graph-API: het recht in Microsoft Graph {#application-graph}

**API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**. Voeg toe:

- `Mail.Read` — "Read mail in all mailboxes": de mappen van het postvak en de berichten erin, elk bericht zoals Microsoft het bewaart.

Verder niets: de kaart leest mail, en dit ene recht dekt dat. Druk daarna op **Grant admin consent for** uw organisatie, en bevestig.

**Weet hoe ver dit recht reikt voordat u het verleent.** Als toepassingsrecht kan `Mail.Read` elk postvak in de organisatie lezen, niet alleen het postvak dat u in de wizard invult. Deze dienst leest alleen het postvak dat de verbinding noemt, en schrijft er nooit in. Exchange Online kan een toepassing in plaats daarvan `Mail.Read` geven voor alleen de postvakken die u noemt; Microsoft beschrijft dat als Role Based Access Control for Applications in Exchange Online. Dat vervangt deze stap, het beperkt hem niet: een `Mail.Read` waarvoor hier toestemming is gegeven, reikt tot elk postvak, wat Exchange ook zegt. Een beheerder die de smallere weg wil, verleent `Mail.Read` hier dus niet, en kent in Exchange de toepassingsrol toe met een bereik.

#### Via IMAP: het recht in Exchange Online {#application-imap}

Deze kaart meldt zich als de toepassing aan bij de IMAP-server van Exchange Online. Zo'n token draagt alleen rechten die bij **Office 365 Exchange Online** zijn gegeven; een Microsoft Graph-recht helpt hier dus niet, hoe het ook heet.

1. **API permissions** → **Add a permission** → **APIs my organization uses** → zoek **Office 365 Exchange Online** → **Application permissions**. Voeg toe:

- `IMAP.AccessAsApp` — IMAP-toegang tot postvakken, als de toepassing.

2. Druk op **Grant admin consent for** uw organisatie, en bevestig.
3. Registreer de toepassing in Exchange Online. Een Exchange-beheerder doet dat in Exchange Online PowerShell, na één keer `Install-Module -Name ExchangeOnlineManagement`:

```
Connect-ExchangeOnline -UserPrincipalName <uw beheerdersadres>
New-ServicePrincipal -AppId <Application (client) ID> -ObjectId <Object ID onder Enterprise applications>
```

De Object ID is die op de pagina Overview van de toepassing onder **Enterprise applications**, niet die onder **App registrations**. Met de verkeerde mislukt de aanmelding van de kaart.

4. Geef de toepassing het postvak dat de kaart leest. `Get-ServicePrincipal | fl` toont de service-principal die u net registreerde, met zijn identiteit:

```
Add-MailboxPermission -Identity <adres van het postvak> -User <identiteit van de service-principal> -AccessRights FullAccess
```

Herhaal stap 4 voor elk postvak dat de kaart moet lezen. FullAccess is het recht dat Microsoft hiervoor beschrijft, en daarmee zou een toepassing het postvak ook kunnen wijzigen, niet alleen lezen. Dat deze kaart alleen leest, is dus een eigenschap van deze dienst, niet iets wat Microsoft afdwingt. Bij **Via de Graph-API** dwingt Microsoft het wel af: `Mail.Read` kan alleen lezen.

## Wat er meegaat {#what-moves}

De kaart **Microsoft 365 account** is één verbinding met één gedelegeerde toestemming, voor **vier onderdelen**: e-mail, agenda's, contacten en OneDrive, wat u aanvinkt.

**Taken** zijn Microsoft To Do. Vinkt u ze aan, dan vraagt de toestemming ook `Tasks.Read`. Elke To Do-lijst wordt een takenlijst op het doel, en elke taak houdt haar titel, notities, status, belang, vervaldatum, checklist en herhaling.

## Als de test iets meldt {#when-test-says}

Twee weigeringen zijn **beleid van de tenant**, en opnieuw proberen helpt niet:

- **`AADSTS65001`** — de gebruiker of beheerder heeft geen toestemming gegeven. Moet in de tenant een beheerder apps goedkeuren, dan moet een beheerder deze app goedkeuren voordat de persoon toestemming kan geven.
- **`AADSTS90094`** — de tenant laat gebruikers helemaal geen toestemming geven aan apps. Alleen een beheerder kan dat, en pas nadat de registratie in die tenant is toegelaten.

Beide verschijnen als zinnen en niet als codes, zodat wie ze leest weet dat hij iemand moet vragen, en niet nog eens op de knop moet drukken.

Met een eigen registratie betekent **`AADSTS700016`** — "Application with identifier '…' was not found in the directory '…'" — dat de instelling [supported account types](#own-app-account-types) niet klopt, niet dat er een tikfout in de client-ID zit.

## Stoppen {#leaving}

Microsoft publiceert geen adres om OAuth-toestemming in te trekken. Als wij ons exemplaar van uw refresh-token verwijderen, staat de toestemming bij Microsoft dus nog. U trekt die zelf in: [My Account](https://myaccount.microsoft.com) → Privacy → **Apps and services you have given access to**.

Een verwijderingsbewijs zegt dat met zoveel woorden, want inloggegevens die wij verwijderden en een toestemming die bij de aanbieder blijft staan, zijn twee verschillende dingen.

De toestemming van een **beheerder** — die van **Via IMAP** en **Via de Graph-API** — staat ergens anders, en alleen een beheerder kan haar weghalen: Entra → Enterprise applications → Permissions.

Voor **Via IMAP** neemt een Exchange-beheerder daarnaast het postvak terug met `Remove-MailboxPermission`, en haalt hij de toepassing uit Exchange Online met `Remove-ServicePrincipal`. Wie de appregistratie verwijdert, zorgt dat de toepassing zich helemaal niet meer kan aanmelden.

## Met een eigen app {#own-app}

### De kaart Microsoft 365 account, met uw eigen registratie {#own-app-account}

[Entra-beheercentrum](https://entra.microsoft.com) → Identity → Applications → **App registrations** → New registration. De schermen staan hier met hun Engelse namen, zoals hierboven.

#### Het keuzerondje dat hier het meest uitmaakt {#own-app-account-types}

**Supported account types.** Kies **Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant) and personal Microsoft accounts**, tenzij u bewust iets bouwt voor precies één organisatie.

**Dit is de instelling die stil misgaat.** Een registratie voor één tenant werkt voor u, werkt in uw tests en werkt voor iedereen in uw eigen organisatie, en faalt bij het eerste account in een andere organisatie, met:

```
AADSTS700016: Application with identifier '…' was not found in the directory '…'
```

Dat lijkt op een tikfout in de client-ID, maar dat is het niet.

Is uw registratie met opzet voor één tenant, typ dan de Directory (tenant) ID in het veld **Tenant-ID** van de wizard, zodat de toestemming in uw directory plaatsvindt. Laat het anders leeg.

#### Omleidingsadres {#own-app-redirect}

Platform **Web**, met het exacte adres waarop deze dienst antwoordt. Het eindigt op:

```
/api/migrations/microsoft/callback
```

Het scherm toont het hele adres bij elke poging, dus u hoeft niet te raden: druk één keer op de knop en registreer wat hij toont. Het moet geregistreerd zijn **voordat** de eerste toestemming kan werken.

#### Rechten {#own-app-permissions}

API permissions → Add a permission → **Microsoft Graph** → **Delegated permissions**. Voeg precies deze toe:

- `Mail.Read` — de mail van de aangemelde gebruiker
- `Calendars.Read` — diens agenda's
- `Contacts.Read` — diens contacten
- `Files.Read` — diens eigen OneDrive
- `Tasks.Read` — diens Microsoft To Do-lijsten, alleen gevraagd als Taken is aangevinkt
- `offline_access` — het refresh-token, waarzonder de toestemming na een uur vervalt

**Verder niets, en zeker niet de `.All`-varianten.** `Files.Read.All` zou de OneDrive van de hele tenant lezen; `Files.Read` leest de eigen OneDrive van de aangemelde gebruiker. Dit product migreert het account dat u koppelt, en een token dat niet verder reikt, is daar de goedkoopste garantie voor.

**Geef hier geen beheerderstoestemming.** Dit zijn gedelegeerde rechten: de persoon die u migreert keurt ze zelf goed op het toestemmingsscherm, en daar is de knop voor.

#### Het clientgeheim {#own-app-secret}

Certificates & secrets → New client secret. Kopieer de **Value** meteen; Entra toont hem maar één keer. De **Application (client) ID** op de pagina Overview is de andere helft. Vul beide in onder **Uw eigen appregistratie gebruiken**, en druk op **Verbinden met Microsoft**.
