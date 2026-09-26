# Dropbox — de toestemming, en de app

Een Dropbox-migratie meldt zich aan met een Dropbox-app, die van deze dienst als die er een heeft, of uw eigen, en een refresh-token waarvoor het account dat u migreert toestemming geeft. Het leest alleen, en dat zit in de opbouw zelf: de app vraagt alleen de leesscopes, dus dit product kan niet in de Dropbox schrijven, ook niet als het dat zou willen. Dat is een afgedwongen garantie, geen belofte op papier.

## Wat u nodig hebt {#before}

- Het Dropbox-account waarvan de bestanden verhuizen, en de aanmelding ervan.
- Moet er maar één map mee: het pad ervan, zoals `/Team Docs`.

## Koppelen {#connect}

### Dropbox {#dropbox}

De wizard vraagt het adres van het account, onder **Gebruikersnaam**, en een **Refresh-token**, dat de knop invult.

**De korte weg: druk op Verbinden met Dropbox.** Heeft deze dienst een eigen Dropbox-app, dan tonen de wizard en de pagina Verbindingen een knop **Verbinden met Dropbox** naast het tokenveld. De knop opent het toestemmingsscherm van Dropbox voor het account dat u migreert. Keurt dat account het goed, dan komt het refresh-token vanzelf in het veld, en wordt de verbinding in één keer bewaard en getest. U typt niets, en het geheim van de app verlaat de server niet. U kunt ook uw eigen app gebruiken: open **Uw eigen Dropbox-app gebruiken** en vul de **App-sleutel** en het **Clientgeheim** in, als paar. [Met een eigen app](#own-app) heeft de stappen.

Laat u het veld **Pad van de hoofdmap** leeg, dan verhuist de hele Dropbox; een pad beperkt de migratie tot die map, en de boom komt in beide gevallen op dezelfde manier aan.

Een **gekoppelde gedeelde map** staat in de boom van het account en verhuist zoals elke andere map; het pad ervan is een geldig pad voor de hoofdmap. De knop **Gedeelde mappen bekijken…** in de wizard toont wat het account kan zien, met de paden erbij; een gedeelde map die niet is gekoppeld, heeft geen pad tot het account haar aan zijn Dropbox toevoegt.

De test vraagt Dropbox alleen naar het bovenste niveau van de hoofdmap, en antwoordt dus binnen seconden, hoe groot de Dropbox ook is; de migratie zelf loopt elke map langs. Naast het aantal mappen staat hoeveel de Dropbox bevat, uit het eigen ruimtegebruik dat Dropbox opgeeft.

## Wat er meegaat {#what-moves}

De inhoud van de bestanden en de mappenboom. De deelinstellingen (met wie iets gedeeld is), bestandsverzoeken, Paper-documenten en de versiegeschiedenis blijven achter. Verwijderingen worden herkend door te tellen wat ontbreekt (twee schone rondes); het "terugzetten" van Dropbox en het lezen van verwijderde items worden nog niet ondersteund.

## Als de test iets meldt {#when-test-says}

- Een test die niet binnen 20 seconden antwoordt, zegt dat en houdt de verbinding, zodat u haar opnieuw kunt testen.
- Het bekijken van gedeelde mappen wordt geweigerd met de eigen woorden van Dropbox, die de scope `sharing.read` noemen, als de app zonder die scope is gemaakt. Migraties werken gewoon; alleen het bekijken heeft hem nodig.

## Stoppen {#leaving}

Een toestemming trekt u in bij Dropbox, in de instellingen van het account onder **Connected apps**. Met [uw eigen app](#own-app) trekt het verwijderen van de app in de App Console elke toestemming in die eraan is gegeven.

## Met een eigen app {#own-app}

De schermen van Dropbox staan hieronder met hun Engelse namen.

### 1. Maak de app {#own-app-create}

[Dropbox App Console](https://www.dropbox.com/developers/apps) → Create app → **Scoped access** → **Full Dropbox** (of **App folder** als de migratie altijd maar één map mag zien). Zet op het tabblad **Permissions** precies deze aan:

- `files.metadata.read`
- `files.content.read`
- `sharing.read` — niet verplicht, en ook alleen-lezen: daarmee werkt de knop **Gedeelde mappen bekijken…** in de wizard. Zonder deze scope werken migraties gewoon; het bekijken krijgt dan de eigen weigering van Dropbox, die de scope noemt.

Verder niets. De App key en het App secret op het tabblad Settings horen in het deel **Uw eigen Dropbox-app gebruiken** van de wizard, als paar: de App key onder **App-sleutel**, het App secret onder **Clientgeheim**.

### 2. Het omleidingsadres {#own-app-redirect}

Wil de knop werken met uw eigen app, dan moet de app weten waarheen de browser terug moet: **Settings → OAuth 2 → Redirect URIs**. Druk één keer op **Verbinden met Dropbox** met uw App key en App secret ingevuld, en de wizard toont onder de knop het precieze adres om te registreren. Het eindigt op `/api/migrations/dropbox/callback`.

### 3. Toestemming, één keer, als het account dat u migreert {#own-app-consent}

Druk op **Verbinden met Dropbox**. Het account dat u migreert, keurt het goed op het eigen scherm van Dropbox, en het refresh-token komt vanzelf in het veld. Toegangstokens worden daar per ronde uit gemaakt; verder wordt niets langdurigs bewaard dan de App key, het App secret en dat token.
