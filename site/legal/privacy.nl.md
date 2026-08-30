<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!-- Dutch translation of privacy.md. Keep the SECTION NUMBERING identical, so
     the two can be diffed against each other when either changes. The English
     version is the authoritative text (see terms §13); the site says so. The
     briefing for the reviewing lawyer (open questions, what changed in v1.1)
     is the comment at the top of privacy.md — it applies to both files. -->

# Privacyverklaring

**Geldt voor:** de **beheerde Ownpace-dienst** op `ownpace.eu`.
**Versie:** 1.1 (concept voor juridische toetsing — nog niet gepubliceerd; zie `site/legal/README.md`)
**Laatst bijgewerkt:** 2026-08-30

> **Draait u Ownpace zelf**, dan geldt deze verklaring niet voor u en valt er voor ons niets
> te verklaren: de software draait op uw eigen infrastructuur, uw gegevens bereiken ons nooit,
> en wij ontvangen niets — geen telemetrie, geen gebruikscijfers, geen foutrapporten. De
> broncode is openbaar, dus dat is controleerbaar in plaats van beloofd.

---

## 1. Wie wij zijn

Archico B.V., «REGISTERED_ADDRESS», KvK 73922706, btw «VAT_NUMBER».

**Contact over alles in deze verklaring, inclusief uw rechten onder de AVG:
support@ownpace.eu.** Daar leest een mens mee. We streven naar antwoord binnen vijf werkdagen
en zijn gebonden aan de termijn van één maand die de AVG stelt voor verzoeken over uw rechten.

## 2. Wat Ownpace doet, want dat bepaalt al het onderstaande

Ownpace verhuist uw e-mail, contacten, agenda's en bestanden van de ene aanbieder naar de
andere, en houdt de kopie bij tot u besluit over te stappen. Het leest uw bronaccount, schrijft
naar uw doelaccount, en houdt bij wat het heeft verhuisd zodat een tweede ronde niets
dupliceert.

**Wij zijn geen opslagdienst.** Uw berichten en bestanden gaan door de verhuizing heen om bij
het doel te worden weggeschreven dat u hebt gekozen. We slaan ze niet op, en we bewaren geen
kopie nadat een verhuizing eindigt.

## 3. Onze rol, die afhangt van wie u bent

Voor **uw account bij ons** — inloggen, facturatie, contact met support — zijn wij de
**verwerkingsverantwoordelijke**, wie u ook bent.

Voor de **inhoud van uw verhuizing** — uw e-mail, bestanden, contacten en agenda-items — hangt
het ervan af wie er verhuist:

- **Bent u een organisatie**, dan bent u de **verwerkingsverantwoordelijke** en zijn wij uw
  **verwerker**. Wij handelen op uw gedocumenteerde instructies, en die instructies zijn de
  verhuizingen die u instelt. Onze verwerkersovereenkomst maakt deel uit van uw overeenkomst —
  **op aanvraag beschikbaar** via support@ownpace.eu tot die hier gepubliceerd is.
- **Bent u een particulier** die de eigen accounts of die van het gezin verhuist, dan betekent
  de huishoudelijke uitzondering van de AVG (art. 2 lid 2 sub c) dat *u* geen
  verantwoordelijkheidsplichten draagt voor wat u verhuist — en die uitzondering strekt zich
  niet uit tot ons (overweging 18). Voor de inhoud van uw verhuizing treden wij daarom op als
  **verwerkingsverantwoordelijke**, op grond van de overeenkomst tussen ons (art. 6 lid 1
  sub b), en draagt deze verklaring de toezeggingen die een zakelijke klant uit een
  verwerkersovereenkomst zou halen: we verwerken de inhoud uitsluitend om de verhuizing uit te
  voeren die u instelde (§5), de subverwerkerslijst in §7 en de bewaartermijnen in §9 gelden
  onverkort voor u, en de beloften van §2 blijven staan.

Een mailbox bevat ook **andere mensen** — de correspondenten die u schreven. Zij hebben nooit
met ons gecontracteerd. Wat wij bewaren dat hen raakt is wat §4 beschrijft en niets meer, het
wordt beschermd door dezelfde §7–§9, en de rechten in §10 zijn ook de hunne, zonder dat daar
een account voor nodig is.

## 4. Wat we werkelijk bewaren

Beschreven op het niveau waarop de software echt werkt, omdat een vager antwoord minder
bruikbaar zou zijn en niet eerlijker.

### 4.1 Toegangsgegevens voor uw accounts

Wat nodig is om de bron te lezen en het doel te beschrijven: een OAuth-vernieuwingstoken, of
een gebruikersnaam met een app-wachtwoord, of een serviceaccountsleutel. **Versleuteld
opgeslagen met AES-256-GCM**, onder een sleutel die apart van de database wordt bewaard.

We vragen de smalste toegang die elke aanbieder biedt. Waar een aanbieder niets smals biedt —
het IMAP-eindpunt van Google accepteert alleen een scope die leest als volledige
mailtoegang — zeggen we dat, in plaats van iets anders te suggereren. De connectors die uw
e-mail, contacten en agenda's lezen hebben **geen enkele schrijfweg naar de bron**.

U kunt onze toegang op elk moment bij uw aanbieder intrekken, zonder het ons te vragen, en dan
stopt de verhuizing.

### 4.2 Het verhuisregister — metagegevens, geen inhoud

Voor elk item dat we verhuizen bewaren we een regel met: een kenmerk dat de bron er zelf aan
gaf (voor e-mail de `Message-Id`-header), een hash van dat kenmerk, een hash van de inhoud, de
omvang in bytes, de map of verzameling waarin het staat, tijdstempels, en of de kopie lukte.
Dit is wat ervoor zorgt dat een tweede ronde samenkomt in plaats van uw mailbox te verdubbelen.

**Het register bevat geen berichtinhoud, geen bijlagen, geen bestandsinhoud.** Het bevat wel
metagegevens die op zichzelf veelzeggend kunnen zijn — mapnamen, en hashes die van inhoud zijn
afgeleid — en dat zeggen we liever ronduit dan het te omschrijven als "technische gegevens".

### 4.3 Wat een preflight bewaart

Een gratis preflight leest uw bron om te tellen wat er staat. Daarvan worden **aantallen,
omvang en totalen per map** bewaard — geen inventaris van afzonderlijke items. Kenmerken van
items komen pas in het register terecht wanneer een echte verhuizing begint.

### 4.4 Uw account en facturatie

Uw e-mailadres, de organisatie waartoe u behoort, uw rol, tijdstippen van inloggen. Facturen
en de gebruikscijfers eronder — hoeveel verhuizingen tegelijk liepen, en hoeveel gegevens er
zijn verhuisd. Betalingen lopen via onze betaaldienstverlener (§7); **wij zien of bewaren uw
kaartgegevens nooit**.

### 4.5 Support en operationele logs

Alles wat u ons stuurt op support@ownpace.eu, en serverlogs die vastleggen dát er verzoeken
waren — tijdstippen, IP-adressen, foutcodes. Logs zijn zo geschreven dat **inloggegevens,
mapnamen en onderwerpregels er niet in voorkomen**.

Om de dienst te kunnen leveren en ondersteunen kan een klein aantal met naam bekende
beheerders aan onze kant **dienstmetadata** over uw account inzien: de naam en status van uw
omgeving, de toestand en foutcategorie van elke migratie, factuuroverzichten, en hoeveel
items op een beslissing van u wachten. **Zij kunnen niet in uw inhoud bladeren.**
Berichtteksten en onderwerpregels, map- en bestandsnamen, agenda-items, inloggegevens en
opgeslagen foutteksten verschijnen op geen enkel supportscherm — de schermen zijn zonder
toegang daartoe gebouwd, en dat is in de broncode na te lezen in plaats van aan te nemen.
**Elke inzage wordt zelf vastgelegd** — wie keek, bij welk account, naar welk scherm en
wanneer — in een log dat niet kan worden aangepast of gewist, zodat "wij kijken niet in uw
gegevens" controleerbaar is in plaats van een belofte. Onze verwerkersovereenkomst (§5
daar) doet organisaties dezelfde toezegging.

## 5. Waarom we het bewaren, in AVG-termen

| Wat | Doel | Grondslag |
|---|---|---|
| Toegangsgegevens, register, preflight-tellingen | De verhuizing uitvoeren die u hebt gevraagd | Overeenkomst, inclusief stappen die u vooraf vraagt (art. 6 lid 1 sub b) — op uw instructie als verwerker voor een organisatie; als verwerkingsverantwoordelijke bij een gezinsverhuizing (§3) |
| Account, facturen, gebruikscijfers | De dienst leveren en factureren | Overeenkomst; wettelijke plicht voor het bewaren van facturen (art. 6 lid 1 sub c) |
| Operationele logs | De dienst veilig en werkend houden | Gerechtvaardigd belang (art. 6 lid 1 sub f) |
| Supportcorrespondentie | U antwoorden | Overeenkomst / gerechtvaardigd belang |
| Support-inzagelog (welke beheerder welke accountmetadata bekeek, en wanneer) | Verantwoording van onze eigen toegang tot uw account | Gerechtvaardigd belang (art. 6 lid 1 sub f) — dat van u evenzeer als dat van ons |

**We gebruiken uw gegevens niet voor advertenties, we stellen geen profielen op, en we
verkopen of verhuren niets aan wie dan ook.** Er zit geen analysetracker in de applicatie.

## 6. Google-gebruikersgegevens — de concrete toezeggingen

Het gebruik door Ownpace van informatie die via Google-API's is ontvangen, voldoet aan het
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
inclusief de **Limited Use**-eisen. Concreet, in onze eigen woorden:

- We gebruiken Google-gebruikersgegevens **uitsluitend** om de verhuizing uit te voeren die u
  hebt ingesteld — uw bronaccount lezen en wegschrijven naar het doel dat u koos — en om u de
  voortgang te tonen.
- We **dragen** Google-gebruikersgegevens **niet over** aan wie dan ook, behalve aan het
  verhuisdoel dat u zelf hebt gekozen, en behalve waar de wet dat verplicht.
- We gebruiken Google-gebruikersgegevens **niet** voor advertenties, in welke vorm dan ook.
- We laten Google-gebruikersgegevens **niet door mensen lezen**. De uitzonderingen zijn die
  welke het beleid toestaat en geen andere: uw eigen uitdrukkelijke verzoek om bepaalde items,
  wat noodzakelijk is voor beveiliging of om aan de wet te voldoen, en geaggregeerde cijfers
  waarin niemand herkenbaar is.
- We gebruiken Google-gebruikersgegevens niet om enig machine-learning- of AI-model te
  trainen, algemeen of anderszins.

**Google is nooit een verhuisdoel.** Gegevens stromen Google uit en nooit terug naar binnen.

U kunt de toegang van Ownpace tot uw Google-account op elk moment intrekken op
[myaccount.google.com/permissions](https://myaccount.google.com/permissions), of door het
app-wachtwoord te verwijderen dat u hebt aangemaakt.

## 7. Wie er verder bij komt

| Subverwerker | Waarvoor | Waar |
|---|---|---|
| «HOSTING_PROVIDER» | De dienst en de database draaien | «HOSTING_REGION» (EU) |
| «EMAIL_PROVIDER» | Uw voortgangsoverzichten en accountmail versturen | «EMAIL_REGION» (EU) |

De actuele lijst staat op `«SUBPROCESSORS_URL»`. Zakelijke klanten worden geïnformeerd voordat
een subverwerker wordt toegevoegd, met het recht van bezwaar zoals vastgelegd in de
verwerkersovereenkomst; alle anderen krijgen dezelfde wijzigingsmelding via §13.

**Mollie B.V.** (Nederland, EU) verzorgt kaart- en incassobetalingen. Als vergunninghoudende
betaalinstelling verwerkt Mollie uw betaalgegevens onder eigen verantwoordelijkheid en eigen
privacyverklaring — een zelfstandige verwerkingsverantwoordelijke, geen subverwerker van ons.
**Wij zien of bewaren uw kaartgegevens nooit.**

**De bron en het doel van uw verhuizing zijn geen subverwerkers van ons** — dat zijn uw eigen
accounts, en uw relatie met die aanbieders is de uwe.

## 8. Waar het staat, en waar niet

De dienst draait in de **Europese Unie**, en alles in de tabel hierboven ook. **Er vindt door
ons geen doorgifte van uw gegevens plaats naar de Verenigde Staten of enig ander derde land.**

Dat is het punt van het product en geen nalevingszin: de reden om weg te gaan bij een
Amerikaanse aanbieder wordt ondermijnd door een verhuistool die zelf Amerikaans gehost is, dus
dat zijn we niet.

Ligt het **doel** van uw verhuizing buiten de EU, dan gaan uw gegevens daarheen omdat u dat
hebt opgedragen. We laten u het doel zien voordat er iets wordt weggeschreven.

## 9. Hoe lang we het bewaren

| Wat | Bewaard |
|---|---|
| Toegangsgegevens | Tot de verhuizing eindigt of u hem verwijdert — dan vernietigd, en de toegang ingetrokken waar de aanbieder dat ondersteunt |
| Het verhuisregister | Tot u de verhuizing verwijdert; dan volledig mee verwijderd |
| Preflight-tellingen, als u geen klant wordt | **30 dagen**, daarna automatisch verwijderd |
| Account- en inloggegevens | Zolang uw account bestaat, daarna 30 dagen |
| Facturen en de gebruikscijfers eronder | **7 jaar**, omdat de Nederlandse belastingwet dat vereist |
| Operationele logs | «LOG_RETENTION» |

Ownpace bevat een **vergeet-mij**-pad dat de gegevens van een organisatie verwijdert, en een
procedure voor het einde van de dienst die beschrijft wat er met alles gebeurt als de dienst
ooit stopt. We hebben de uitgang geschreven voordat we hem nodig hadden.

## 10. Uw rechten

Inzage, rectificatie, verwijdering, beperking, overdraagbaarheid, bezwaar, en het intrekken
van toestemming waar toestemming de grondslag is. Schrijf naar **support@ownpace.eu**; we
brengen er niets voor in rekening en vragen niet waarom. Deze rechten gelden jegens ons overal
waar §3 ons verwerkingsverantwoordelijke maakt — en voor de mensen in een verhuisde mailbox
die nooit een account hadden, antwoordt hetzelfde adres.

**Overdraagbaarheid verdient een opmerking.** Dit product bestaat juist omdat uw eigen gegevens
tussen aanbieders verplaatsen moeilijker is dan het zou moeten zijn. Wilt u uw gegevens uit
Ownpace, dan hebt u ze al — ze staan in het doelaccount waar we ze naartoe hebben geschreven.

U kunt een klacht indienen bij een toezichthouder. In Nederland is dat de **Autoriteit
Persoonsgegevens** (autoriteitpersoonsgegevens.nl).

## 11. Beveiliging

Toegangsgegevens versleuteld met AES-256-GCM onder een apart bewaarde sleutel. TLS 1.3 naar de
grote aanbieders, TLS 1.2 met moderne cijfers als ondergrens voor de rest, waarbij de
onderhandelde versie wordt gerapporteerd in plaats van aangenomen. Scheiding tussen
organisaties afgedwongen in de database zelf via row-level security, niet alleen in de
applicatie. Logs zo geschreven dat toegangsgegevens en berichtinhoud er niet in staan.

Geen enkel systeem is perfect. Vindt u een kwetsbaarheid, schrijf dan naar
**support@ownpace.eu**; we zullen u niet bedreigen omdat u het meldt.

## 12. Kinderen

De dienst richt zich niet op kinderen onder de 16 en we maken niet bewust accounts voor hen
aan. Een gezinsverhuizing die een ouder instelt kan uiteraard het account van een kind
verhuizen — dat is het huishoudelijke geval dat §3 beschrijft, en de ouder blijft degene die
hem bedient.

## 13. Wijzigingen

Wezenlijke wijzigingen melden we per e-mail aan accounthouders, minstens **30 dagen** voordat
ze ingaan, en elke versie van deze verklaring blijft beschikbaar op «PRIVACY_HISTORY_URL» zodat
u kunt zien wat er is veranderd. Het versienummer en de datum bovenaan deze pagina zijn de
vastlegging.
