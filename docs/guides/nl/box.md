# Box — de app, de autorisatie, de drie waarden

Een Box-migratie meldt zich aan met **uw eigen Box-platformapp** via de **Client Credentials Grant**: een client-ID en clientgeheim, plus het numerieke **gebruikers-ID** van het account dat u migreert (één account per migratie).

**Waarom geen refresh-token, anders dan bij Google en Dropbox:** Box vernieuwt refresh-tokens bij elk gebruik. Elke vernieuwing geeft een nieuw token en maakt het net gebruikte ongeldig. Dit product bewaart inloggegevens één keer, versleuteld, en schrijft ze nooit terug, dus een bewaard Box-refresh-token zou precies één ronde werken en de tweede breken. De Client Credentials Grant heeft geen wisselende toestand, en daarom is dit de vorm waar deze koppeling niet van afwijkt.

## Wat u nodig hebt {#before}

- Toegang tot de [Box Developer Console](https://app.box.com/developers/console), om de app te maken.
- Een **Box-beheerder** van de organisatie, die de app één keer toestaat.
- Het numerieke gebruikers-ID van het account dat u migreert, dat een beheerder kan opzoeken.

## Koppelen {#connect}

De schermen van Box staan hieronder met hun Engelse namen.

### 1. Maak de app {#create-app}

[Box Developer Console](https://app.box.com/developers/console) → Create Platform App → **Custom App** → authenticatiemethode **Client Credentials Grant (Server Authentication)**.

Op het tabblad **Configuration**:

- App Access Level: **App + Enterprise Access**
- Application Scopes: alleen **Read all files and folders stored in Box**, niets wat schrijft. Het leest alleen, en dat zit in de opbouw zelf: met alleen de leesscope kan dit product niet in een Box schrijven, ook niet als het dat zou willen.
- Advanced Features: zet **Generate user access tokens** aan (daarmee kan het token noemen wiens bestanden het leest).

De **Client ID** en het **Client Secret** op dit tabblad zijn twee van de drie waarden.

### 2. Laat hem één keer toestaan door een Box-beheerder {#authorize}

CCG-apps moeten door een beheerder van de organisatie zijn goedgekeurd voordat er een token wordt gemaakt: **Admin Console → Apps → Custom Apps Manager → Add app** (op Client ID), en autoriseer hem dan. Na een wijziging van de scopes moet dat opnieuw.

### 3. Zoek het gebruikers-ID op {#user-id}

De derde waarde is het **numerieke** gebruikers-ID van het account dat u migreert: Admin Console → Users & Groups → de gebruiker → het ID in de URL of in de gegevens van de gebruiker. Geen e-mailadres: het veld neemt het getal, en het token leest dan precies de bestanden van dat account.

### 4. Vul het in {#box}

Kies Box in de wizard. Alles komt in de stap Bron: het adres van het account onder **Gebruikersnaam**, het getal uit stap 3 onder **Box-gebruikers-ID (numeriek)**, en de twee waarden uit stap 1 onder **Client-ID (applicatie-ID)** en **Clientgeheim**; het geheim wordt versleuteld bewaard. De knop **Verbindingen testen en bewaren** haalt één keer een lijst op, alleen lezend, via precies wat een ronde zou opbouwen.

Laat u het veld **ID van de hoofdmap** leeg, dan betekent dat `0`: de hoofdmap van het account ("All Files"); een map-ID beperkt de migratie tot die map.

Een map waarvoor het account is uitgenodigd (een **gedeelde samenwerkingsmap**) staat in de eigen boom van het account en verhuist als gewone inhoud; laat een aparte migratie bij de map-ID beginnen om alleen die map te migreren.

## Wat er meegaat {#what-moves}

De inhoud van de bestanden, precies en met een sha1-controle, en de mappenboom verhuizen. De deelinstellingen (met wie iets gedeeld is), samenwerkingen, opmerkingen, taken, de weergave van Box Notes, de versiegeschiedenis en **weblinks** (bladwijzers: verwijzingen, geen bestanden) blijven achter.

### De prullenbak, en waarom die ertoe doet {#trash}

Elke ronde leest de prullenbak van het account, alleen lezend. Een item dat de eigenaar verwijderde, wordt gevonden waar hij het liet, en dat is **echt** bewijs van een verwijdering: de enige soort die het weghalen van de kopie op het doel mag toestaan. Alleen iets missen is nooit genoeg, en dat is zo bedoeld; zonder prullenbak kan de wachtrij **Verwijderingen** de eigenaar alleen vertellen wat hij met de hand moet verwijderen.

Twee instellingen van de organisatie veranderen daarom wat de eigenaar kan doen, en niet alleen wat hij ziet:

- **Trash retention** (Admin Console → Enterprise Settings → Content & Sharing). Standaard houdt Box verwijderde items ongeveer 30 dagen. Verwijderingen van langer geleden zijn uit de prullenbak, en die vallen terug op tellen wat ontbreekt.
- **Trash disabled** (definitief verwijderen staat aan). Er ligt nooit iets in de prullenbak, dus elke verwijdering in Box blijft `inferred`, en de handeling om toe te passen wordt met opzet niet aangeboden.

Geen van beide is een fout om te herstellen: het is het bewaarbeleid van de klant, en de migratie meldt bij allebei eerlijk wat ze weet.

## Als de test iets meldt {#when-test-says}

- **`unauthorized_client`**: de app is niet toegestaan in de organisatie, of de scopes zijn sindsdien veranderd. De weigering noemt de **Custom Apps Manager**, omdat de foutmelding van Box dat niet doet: zie [stap 2](#authorize).

## Stoppen {#leaving}

Een Box-beheerder haalt de app weg waar hij werd toegestaan, in **Admin Console → Apps → Custom Apps Manager**. Wie de app in de Developer Console verwijdert, beëindigt zijn toegang voorgoed.
