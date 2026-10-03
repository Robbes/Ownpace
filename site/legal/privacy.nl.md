<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!-- Dutch translation of privacy.md. Keep the SECTION NUMBERING identical, so
     the two can be diffed against each other when either changes. The site
     prints a note above this page, and above the Dutch terms, that the English
     governs where the two differ (translationNote in site/copy.mjs). Terms 1.3
     §13 says the same of the terms, except where mandatory consumer law
     provides otherwise; this policy has no language clause of its own. Whether
     that may stand for a Dutch-first Alpha is the briefing's question 17 and
     the terms briefing's question 15. The briefing for the reviewing lawyer
     (what changed in each version, the owner's answers of 2026-09-28 by
     question id, and the open questions) is the comment at the top of
     privacy.md — it applies to both files. The comments beside §1, §4.4,
     §4.5, §7, §8, §9 and §11 below are the same as there. -->

# Privacyverklaring

**Geldt voor:** de **beheerde Ownpace-dienst** op `ownpace.eu`, en deze website.
**Versie:** 1.2 (concept — nog niet gepubliceerd)
**Laatst bijgewerkt:** 2026-09-29

> **Draait u Ownpace zelf**, dan geldt deze verklaring niet voor u en valt er voor ons niets
> te verklaren: de software draait op uw eigen infrastructuur, uw gegevens bereiken ons nooit,
> en wij ontvangen niets — geen telemetrie, geen gebruikscijfers, geen foutrapporten. De
> broncode is openbaar, dus dat is controleerbaar in plaats van beloofd.

> **Tijdens de Alpha** gelden ook de Voorwaarden voor de Alpha. Zeggen die iets anders dan deze
> verklaring, dan gaan die voor.

---

## 1. Wie wij zijn

Archico B.V., handelend onder de naam Ownpace, KvK 73922706, btw NL8597.110.06.B01.

<!-- The owner, 2026-09-28: the address is left out during the Alpha, and we correspond by email
     (rec-address (c)). BW 3:15d asks a provider of an online service to show its geographic
     address; the owner accepts that risk for an invite-only Alpha, and the KvK register shows
     the address anyway. The address returns here, and in terms §1 and §15, before the first
     paid tier, after the lawyer's pass. The trade name is added now (fact-trademark (b)); that
     option says the KvK extract already lists Ownpace, which was not checked here. The VAT
     number is written as the owner gave it (fact-vat (a)). -->

**Contact over alles in deze verklaring, inclusief uw rechten onder de AVG:
support@ownpace.eu.** Wij corresponderen per e-mail. Een mens leest wat daar binnenkomt. We
streven naar antwoord binnen vijf werkdagen en zijn gebonden aan de termijn van één maand die de
AVG stelt voor verzoeken over uw rechten.

## 2. Wat Ownpace doet, want dat bepaalt al het onderstaande

Ownpace migreert uw e-mail, contacten, agenda's en bestanden van de ene aanbieder naar de
andere, en houdt de kopie bij tot u besluit over te stappen. Het leest uw bronaccount, schrijft
naar uw doelaccount, en houdt bij wat het heeft gemigreerd zodat een tweede ronde niets
dupliceert.

**Wij zijn geen opslagdienst.** Uw berichten en bestanden gaan via Ownpace naar het doel dat u
hebt gekozen. We slaan ze niet op: elk bericht of bestand gaat alleen door de dienst heen
terwijl het wordt gekopieerd, en we houden er geen kopie van. Wat we per item wel bewaren,
staat in §4.2.

## 3. Onze rol, die afhangt van wie u bent

Voor **uw account bij ons** — inloggen, facturatie, contact met support — zijn wij de
**verwerkingsverantwoordelijke**, wie u ook bent.

Voor de **inhoud van uw migratie** — uw e-mail, bestanden, contacten en agenda-items — hangt
het ervan af wie er migreert:

- **Bent u een organisatie**, dan bent u de **verwerkingsverantwoordelijke** en zijn wij uw
  **verwerker**. Wij handelen op uw gedocumenteerde instructies, en die instructies zijn de
  migraties die u instelt. Onze verwerkersovereenkomst maakt deel uit van uw overeenkomst —
  **op aanvraag beschikbaar** via support@ownpace.eu tot die hier gepubliceerd is.
- **Bent u een particulier** die de eigen accounts of die van het gezin migreert, dan betekent
  de huishoudelijke uitzondering van de AVG (art. 2 lid 2 sub c) dat *u* geen plichten als
  verwerkingsverantwoordelijke hebt voor wat u migreert — en die uitzondering strekt zich
  niet uit tot ons (overweging 18). Voor de inhoud van uw migratie treden wij daarom op als
  **verwerkingsverantwoordelijke**, op grond van de overeenkomst tussen ons (art. 6 lid 1
  sub b), en draagt deze verklaring de toezeggingen die een zakelijke klant uit een
  verwerkersovereenkomst zou halen: we verwerken de inhoud uitsluitend om de migratie uit te
  voeren die u instelde (§5), de subverwerkerslijst in §7 en de bewaartermijnen in §9 gelden
  onverkort voor u, en de beloften van §2 blijven staan.

**Tijdens de Alpha** doen alleen huishoudens mee (§1 van de Voorwaarden voor de Alpha). Voor de
inhoud van uw migratie geldt dus het tweede geval, en er speelt geen verwerkersovereenkomst.

Een mailbox bevat ook **andere mensen** — de correspondenten die u schreven, en de mensen in uw
contacten en agenda's — en bij een migratie kan een gezinslid betrokken zijn, of mensen met
wie u bestanden deelde. Zij hebben nooit een overeenkomst met ons gesloten. Wat wij bewaren dat
hen raakt is wat §4 beschrijft (§4.6 somt het op) en niets meer, het wordt beschermd door
dezelfde §7–§9, en de rechten in §10 zijn ook de hunne, zonder dat daar een account voor nodig
is.

## 4. Wat we werkelijk bewaren

Beschreven op het niveau waarop de software echt werkt, omdat een vager antwoord minder
bruikbaar zou zijn en niet eerlijker.

### 4.1 Toegangsgegevens voor uw accounts

Wat nodig is om de bron te lezen en naar het doel te schrijven: een OAuth-vernieuwingstoken, of
een gebruikersnaam met een app-wachtwoord, of een serviceaccountsleutel. **Versleuteld
opgeslagen met AES-256-GCM**, onder een sleutel die apart van de database wordt bewaard: in de
eigen configuratie van de dienst, en in de instellingen van de achtergrondtaken die de
migraties uitvoeren, allebei op dezelfde machine.

We vragen de smalste toegang die elke aanbieder biedt. Waar een aanbieder niets smals biedt —
het IMAP-eindpunt van Google accepteert alleen een toestemming die neerkomt op volledige toegang
tot uw mail — zeggen we dat, in plaats van iets anders te suggereren. De connectors die uw
e-mail, contacten, agenda's en bestanden lezen, **kunnen helemaal niet naar de bron schrijven**.

U kunt onze toegang op elk moment bij uw aanbieder intrekken, zonder het ons te vragen, en dan
stopt de migratie.

### 4.2 Het migratieregister — metagegevens, geen inhoud

Voor elk item dat we migreren bewaren we een regel met: een kenmerk dat de bron er zelf aan gaf
(voor e-mail de `Message-ID`-header; voor een bestand het pad; voor een afspraak of een contact
de UID), een hash van dat kenmerk, een hash van de inhoud, de omvang in bytes, de map, agenda of
het adresboek waarin het staat, de kenmerken die de bron en het doel ervoor gebruiken,
tijdstempels, en of de kopie lukte. Zodat de app u kan laten zien om welk item het gaat, bewaart
de regel ook **de naam waaronder u het kent**: de onderwerpregel van een bericht (zodra het
bericht is opgehaald), de titel van een afspraak of taak, de naam van een contact, de naam van
een bestand. Mislukt een item, dan bewaart de regel de reden zoals de aanbieder die formuleerde;
die tekst kan een map, een bestand of een adres noemen. Met dit register slaat een tweede ronde
over wat er al staat, in plaats van uw mailbox te verdubbelen.

**Het register bevat geen berichtinhoud, geen bijlagen, geen bestandsinhoud.** Het bevat wel
metagegevens die op zichzelf veelzeggend kunnen zijn — onderwerpregels, namen, map- en
bestandsnamen, de fouttekst van de aanbieder, en hashes die van inhoud zijn afgeleid — en dat
zeggen we liever ronduit dan het te omschrijven als "technische gegevens".

Bij elke migratie bewaren we daarnaast welke mappen ze koppelt, hoe ver elke ronde kwam, de
beslissingen die u over items nam, de uitkomsten van haar controles, en de lijst van wat er
gedeeld was (§4.6). Bij uw organisatie bewaren we de distributielijsten die een migratie vond,
met de adressen van hun leden.

### 4.3 Wat een preflight bewaart

Een gratis preflight leest uw bron om te tellen wat er staat. Daarvan worden **aantallen,
omvang en totalen per map** bewaard — geen inventaris van afzonderlijke items — en de reden van
de aanbieder als iets niet te tellen was. Kenmerken van items komen pas in het register terecht
wanneer een echte migratie begint. De tellingen horen bij de migratie waarvoor ze zijn
geteld: ze blijven daarbij bewaard en verdwijnen wanneer u die verwijdert of uw gegevens worden
gewist (§9).

### 4.4 Uw aanvraag voor toegang, en uw account

**Uw aanvraag voor toegang.** Tijdens de Alpha wordt niemand tot de dienst toegelaten zonder het
ons eerst te vragen, tenzij iemand die er al in zit die persoon uitnodigt (§4.6). Het
aanvraagformulier bewaart wat u invult: uw e-mailadres, en als u die geeft, uw naam, een
organisatie, een toelichting en het pakket dat u voor ogen had; en uw taal. Daarna bewaart het
ons besluit, wie het nam en wanneer. We gebruiken dit om over uw aanvraag te beslissen en u te
antwoorden. Over elke nieuwe aanvraag krijgen we een e-mail met uw adres en de organisatie en het
pakket die u noemde, maar zonder uw toelichting. Een aanvraag maakt nog geen account aan.

**Uw inlogaccount.** Inloggen loopt via een inlogdienst die we zelf draaien, op dezelfde machine
als de dienst. Uw inlogaccount staat daar, niet bij een ander bedrijf; §7 zegt waar uw verbinding
ermee doorheen gaat. Het bevat uw voor- en achternaam, uw e-mailadres, een gebruikersnaam, een
hash van uw wachtwoord (nooit het wachtwoord zelf) en uw sessies: wanneer u inlogde, en de
browser en het IP-adres waarmee u inlogde. Die dienst houdt ook een geschiedenis bij van elke
wijziging aan uw inlogaccount (§9). Iedereen kan op onze inlogpagina een inlogaccount aanmaken,
maar dat opent niets zolang we die persoon niet hebben toegelaten. Mail van de inlogdienst aan u,
zoals een inlogcode of een link om uw wachtwoord opnieuw in te stellen, gaat via onze
e-mailaanbieder (§7).

<!-- BUILT 2026-09-28 (0139 T3; the owner, terms-acceptance-route (b): "accepting fits in there
     and should record what time/version the accepted of what document"): after sign-in the app
     shows the Alpha conditions, this policy and the terms with their versions, and records, per
     organisation, which version of each a person accepted, the language and the time
     (legal_acceptance, managed migration 0032). Asked while live's OWNPACE_STAGE=alpha and no text
     is still a draft (LEGAL_DRAFTS: a draft's number is the one its final text carries, so nobody
     accepts a draft); nothing is connected before it. Kept with the account and erased with it
     (0139 open question 4, answered 2026-09-29, the owner: "Ok"); a member who leaves keeps their
     rows until the organisation's data is erased (§9's row). "In welke taal" below was added on
     2026-09-29 (review of 0139 T3), because the record keeps it; for the owner's review with the
     rest of this draft. -->

**Uw account bij ons.** Uw e-mailadres, het kenmerk dat onze inlogdienst u geeft, de organisatie
waartoe u behoort (in de app heet de omgeving van uw huishouden een organisatie), uw rol daarin
(tijdens de Alpha eigenaar of beheerder), wanneer u werd uitgenodigd en wanneer u lid werd, en
welke versies van de Voorwaarden voor de Alpha, de servicevoorwaarden en deze verklaring u hebt
aanvaard, in welke taal, en wanneer.

**Tijdens de Alpha, uw Google-adres.** Wilt u een Google-account koppelen, dan geeft u ons het
adres daarvan, en zetten wij het op de lijst van testgebruikers die Google voor onze app
bijhoudt (§6).

**Facturen** en de gebruikscijfers eronder — hoeveel migraties tegelijk liepen, en hoeveel
gegevens er zijn gemigreerd. **Tijdens de Alpha wordt niets in rekening gebracht**: er zijn geen
facturen, en u legt geen betaalwijze vast. Zodra er betalingen zijn, lopen die via onze
betaaldienstverlener (§7); **wij vragen of bewaren uw kaartnummer niet**. Vult u op de pagina
*Facturering* toch factuurgegevens in — een naam, een adres, een btw-nummer — dan bewaren we die
tot uw gegevens worden gewist, en laat u de app een btw-nummer controleren, dan gebeurt dat bij
de VIES-dienst van de Europese Commissie.

### 4.5 Support en operationele logs

**Supportmail.** Alles wat u naar support@ownpace.eu stuurt. Het komt aan in een mailbox die
onze e-mailaanbieder voor ons bewaart (§7). Dezelfde mailbox bewaart een kopie van de mail die de
dienst verstuurt, zoals inlogcodes, voortgangsoverzichten en de berichten die u ons laat sturen.

<!-- The report by mail, 0130 T5, is merged (#1318; apps/api/src/services/report-channel.ts).
     True on live once live runs without ZAMMAD_URL (README, "Before the draft markers come
     off"). -->

**Een probleem melden.** Tijdens de Alpha stuurt *Een probleem melden* in het menu van de app uw
melding als e-mail naar support@ownpace.eu, via onze e-mailaanbieder (§7). De mail bevat wat u
schreef en uw inlogadres, zodat we u kunnen antwoorden, en deze feiten, die het formulier opsomt
voordat u verstuurt: de pagina waarop u was (zonder het geheime deel van een link), de referentie
en soort van een fout als die er was, het kenmerk en de status van uw organisatie, uw rol, de
versie van de dienst, de stand van de migratie op die pagina en van elk gegevenstype daarin, of er
via een link toegang is gegeven, bij welke aanbieders de twee accounts ervan zijn en of hun laatste
test slaagde, of de dienst is gepauzeerd of de planner stilstaat, de naam die uw browser zichzelf
geeft, en wat uw browser het formulier vertelt: de taal van het scherm, uw tijdzone, de breedte van
het venster, de versie van de app in uw browser als die niet die van de dienst is, het
gegevenstype, de kant en de migratie van de foutregel waar u vandaan kwam, en de referentie van een
fout die de app tegenkwam in de vijf minuten voordat u het formulier opende. Voegt u een
schermafbeelding toe, dan gaat die mee. Een schermafbeelding toont wat er op uw scherm stond, zoals
onderwerpregels, namen en adressen: bekijk haar dus voordat u verstuurt. *Deze link melden*, op een
pagina die iemand via een toegangslink of een voortgangslink bereikte, stuurt op dezelfde manier
wat die persoon schreef en de gegevens van die link: de organisatie en de migratie, wie hem maakte,
de twee accounts, en of er toegang is gegeven; en alleen een adres als die persoon er een opgeeft.
**Een melding bevat de inhoud van uw mail, bestanden of agenda's, een onderwerpregel, een mapnaam
of een foutmelding van een aanbieder alleen als u die zelf in uw tekst of op de schermafbeelding
zet.**

<!-- NOT YET TRUE ON live (the owner, 2026-09-28, ops-trust-proxy (b): keep visitors' addresses
     in all our logs). NetBird ends TLS in front of the machine, so the app and the website see
     NetBird as the caller, and NetBird passes the visitor's address on in X-Forwarded-For.
     Built on branch claude/ownpace-public-readiness-y7orc6-the-visitors-address-from-netbird
     (0132 T3 (d), 2026-09-28 and 2026-09-29): the app's nginx (apps/web/nginx.conf.template,
     format ownpace_combined) and the website's (deploy/compose/www-nginx.conf, format
     ownpace_site, where the image's default applied before) record that header as a field of
     their own, last, after NetBird's address; recorded, not believed. Live sets TRUST_PROXY=2
     (the proxies in front of the API: NetBird and the web container's nginx; 3 if NetBird's
     cluster adds one), which stand-up-live.sh requires, so the API reads the address NetBird
     passes on. True on live once live stands with it, and checked with a log line of each there
     (0132 T3 (d)). -->

**Serverlogs** leggen vast dát er verzoeken waren, voor de app en voor deze website: het
tijdstip, uw IP-adres, dat NetBird aan ons doorgeeft (§7), de gevraagde pagina (zonder het
geheime deel van een link), de pagina waar u vandaan kwam, wat uw browser over zichzelf zegt, en
foutcodes. NetBird houdt daarnaast een eigen log bij van elk verzoek; §7 zegt wat daarin staat.
Logs zijn zo geschreven dat **toegangsgegevens en berichtinhoud er niet in voorkomen**. Vrij van
namen zijn ze niet. Mislukt een stap van een migratie, dan komt de fouttekst van de aanbieder
zelf in het log van het proces dat de fout tegenkwam, naast een referentie, zodat we u ermee
kunnen helpen; die tekst kan een map, een bestand of een adres noemen. En een aanvraag voor
toegang wordt gelogd met het e-mailadres dat erin staat, net als ons besluit erover.

**Wat de mensen die de dienst draaien kunnen zien.** Om de dienst te kunnen leveren en
ondersteunen, kunnen de mensen aan onze kant die de dienst draaien — tijdens de Alpha één
persoon — op onze supportschermen **dienstmetadata** over uw account inzien: de naam en status
van uw organisatie; de adressen en rollen van haar leden, en het kenmerk dat onze inlogdienst
ieder van hen geeft; de namen van uw koppelingen en migraties (een koppeling heet naar de
gebruikersnaam of het adres van het account, tenzij u haar anders noemt); de toestand en
foutcategorie van elke migratie; factuuroverzichten; hoeveel items op een beslissing van u
wachten; en het logboek van uw organisatie, met wie wat deed en wanneer, zonder de details. Ze
kunnen ook opzoeken bij welke organisatie een adres hoort, en het logboek van wie wat deed
downloaden, met de details, waarin elk adres en elke bestandsnaam door een pseudoniem is
vervangen. **De supportschermen kunnen uw inhoud niet tonen.** Berichtteksten en
onderwerpregels, map- en bestandsnamen, agenda-items, toegangsgegevens en opgeslagen foutteksten
verschijnen op geen enkel supportscherm — de schermen zijn zonder toegang daartoe gebouwd, en dat
is in de broncode na te lezen in plaats van aan te nemen. **Elke inzage wordt zelf vastgelegd** —
wie keek, bij welk account, naar welk scherm en wanneer, en bij een zoekopdracht waarop werd
gezocht — in een log dat de app niet kan veranderen. Wat het over uw account vastlegt, verdwijnt
wanneer uw gegevens worden gewist. Een zoekopdracht op adres en een download van het logboek
worden zonder organisatie vastgelegd; die blijven daarna staan, en worden 12 maanden na het
vastleggen verwijderd (§9). Vraag het ons, en we sturen u wat dat log over uw account vastlegt.
Onze verwerkersovereenkomst (§5 daar) doet organisaties dezelfde toezegging.

**Buiten die schermen.** Wie de machine beheert, kan technisch bij de database, en bij de sleutel
die uw toegangsgegevens beschermt. Die toegang is er om de dienst draaiend te houden en te
herstellen. Zoeken we een probleem uit, dan kan die ons tonen wat §4.2 bewaart, zoals een
onderwerpregel of een bestandsnaam, en we kijken niet verder dan het probleem vraagt. Toegang op
die manier wordt niet vastgelegd in het log hierboven.

**Niemand bij Ownpace leest uw e-mail, bestanden, contacten of agenda's.** De uitzonderingen
zijn die welke §6 voor Google-gegevens noemt, en ze gelden voor elke aanbieder: uw eigen
uitdrukkelijke verzoek over bepaalde items (een schermafbeelding bij een melding is er zo een),
wat beveiliging of de wet noodzakelijk maakt, en geaggregeerde cijfers waarin niemand
herkenbaar is.

### 4.6 Mensen die geen klant van ons zijn

Een migratie raakt mensen die zich nooit bij ons hebben aangemeld. Dit bewaren we over hen.

- **De mensen voor wie u migreert.** Om iemands migraties bij elkaar te houden, geeft u die persoon
  een naam, en als u wilt een e-mailadres voor de toegangslinks. We bewaren beide tot u die persoon
  verwijdert of uw gegevens worden gewist.
- **Een gezinslid van wie u het account migreert.** Stuurt u die persoon een toegangslink, dan
  logt die zelf in bij de eigen aanbieder en geeft die Ownpace zelf toegang, vanaf een pagina
  die zegt wie het vroeg, van welk account en naar waar. Wij bewaren die toegang (versleuteld,
  §4.1), het adres van dat account, en wanneer de link werd gemaakt, gebruikt en beëindigd. Die
  persoon kan de toegang op elk moment intrekken. Op de eigen voortgangspagina verwijdert dat haar
  hier, en trekt het haar ook in bij de aanbieder, waar die dat toestaat. Bij de aanbieder maakt
  het wat wij bewaren onbruikbaar, en verwijderen we haar wanneer u de migratie verwijdert of uw
  gegevens worden gewist. Om een Google-account te koppelen, moet het adres ook op de lijst van
  testgebruikers bij Google staan (§6).
- **Mensen met wie u bestanden, mappen of agenda's deelde.** Laat u de app uw delingen
  nakijken, dan houdt die een lijst bij van wie bij uw oude aanbieder toegang had tot wat: hun
  adres, de naam van het bestand, de map of de agenda, en hun rol. Laat u de app hen vertellen
  waar hun gedeelde items naartoe zijn gegaan, dan krijgt ieder van hen een e-mail van
  support@ownpace.eu per soort item dat met hen gedeeld was, zoals agenda's of bestanden, zodra u
  voor die soort bent overgestapt, met uw toelichting en de namen van de items; en nog eens
  alleen als u die opnieuw laat versturen. Van elk van die e-mails blijft een kopie in onze
  supportmailbox staan, zo lang als §9 zegt (§4.5). De lijst verdwijnt wanneer u de migratie
  verwijdert waar die bij hoort, of wanneer uw gegevens worden gewist.
- **Mensen die u uitnodigt** in uw organisatie: hun adres, hun rol, en of ze lid werden.
- **Mensen die een link melden** die ze kregen: zie §4.5.
- **Correspondenten, en iedereen verder in uw e-mail, contacten en agenda's**: alleen wat §4.2
  per item bewaart. Hun naam of adres kan daar staan in een onderwerpregel, als naam van een
  contact of in een fouttekst, en een distributielijst bewaart de adressen van haar leden.

## 5. Waarom we het bewaren, in AVG-termen

| Wat | Doel | Grondslag |
|---|---|---|
| Toegangsgegevens, register, preflight-tellingen | De migratie uitvoeren die u hebt gevraagd | Overeenkomst, inclusief stappen die u vooraf vraagt (art. 6 lid 1 sub b) — op uw instructie als verwerker voor een organisatie; als verwerkingsverantwoordelijke bij een migratie voor uw gezin (§3) |
| Uw aanvraag voor toegang | Besluiten of we u toelaten, en u dat laten weten | Stappen die u vóór een overeenkomst vraagt (art. 6 lid 1 sub b) |
| Uw account en inlogaccount, facturen, gebruikscijfers | De dienst leveren, u veilig laten inloggen, en factureren | Overeenkomst (art. 6 lid 1 sub b); wettelijke plicht voor het bewaren van facturen (art. 6 lid 1 sub c). Tijdens de Alpha geen facturen |
| Uw Google-adres op de lijst van testgebruikers bij Google (Alpha) | Google de koppeling laten toestaan waar u om vraagt | Overeenkomst (art. 6 lid 1 sub b) |
| Gegevens van andere mensen (§4.6): in wat u migreert, de toegang en het adres van een gezinslid, de mensen die u uitnodigt, en de mail aan mensen met wie u items deelde | De migratie uitvoeren die u vroeg, de mensen binnenlaten die u uitnodigt, en mensen op uw verzoek laten weten waar hun gedeelde items zijn | Gerechtvaardigd belang (art. 6 lid 1 sub f): het uwe, bij het migreren van de e-mail en bestanden van uw huishouden, en het onze, bij het uitvoeren daarvan; de grenzen in §4 en §9 beschermen het hunne |
| Het auditlog van wie wat deed in uw organisatie, en wanneer | U, en ons, laten zien wat er in uw organisatie is gedaan en door wie | Gerechtvaardigd belang (art. 6 lid 1 sub f) |
| De kopie vlak voor een update | Een mislukte update terugdraaien, zodat uw gegevens heel blijven | Gerechtvaardigd belang (art. 6 lid 1 sub f) |
| Serverlogs, van de app en van deze website | De dienst veilig en werkend houden | Gerechtvaardigd belang (art. 6 lid 1 sub f) |
| Supportmail en probleemmeldingen | U antwoorden, en herstellen wat misging | Overeenkomst / gerechtvaardigd belang (art. 6 lid 1 sub f) |
| Support-inzagelog (wie van ons welke accountmetadata bekeek, en wanneer) | Verantwoording van onze eigen toegang tot uw account | Gerechtvaardigd belang (art. 6 lid 1 sub f) — dat van u evenzeer als dat van ons |

**We gebruiken uw gegevens niet voor advertenties, we stellen geen profielen op, en we
verkopen of verhuren uw gegevens aan niemand.** Er zit geen analysetracker in de applicatie of
op deze website. De app bewaart uw aanmelding in de eigen opslag van uw browser tot u uitlogt,
en onthoudt daar uw taal en een paar keuzes; zelf plaatst ze geen cookie, en deze website ook
niet. Onze inlogpagina plaatst de cookies die nodig zijn om in te loggen. Deze website laadt
niets van andere servers.

We nemen geen besluit over u dat alleen op geautomatiseerde verwerking berust: over elke
aanvraag voor toegang beslist een mens. Om mee te doen, geeft u ons uw e-mailadres; om tijdens
de Alpha een Google-account te koppelen, geeft u ons ook het adres daarvan. Zonder die gegevens
kunnen we u niet toelaten, of dat account niet koppelen.

## 6. Google-gebruikersgegevens — de concrete toezeggingen

Het gebruik door Ownpace van informatie die via Google-API's is ontvangen, voldoet aan de
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
inclusief de **Limited Use**-eisen. Concreet, in onze eigen woorden:

- We gebruiken Google-gebruikersgegevens **uitsluitend** om de migratie uit te voeren die u
  hebt ingesteld — uw bronaccount lezen en wegschrijven naar het doel dat u koos — en om u de
  voortgang te tonen.
- We **dragen** Google-gebruikersgegevens **niet over** aan wie dan ook, behalve aan het
  migratiedoel dat u zelf hebt gekozen; aan mensen aan wie u ons zelf vraagt te laten weten waar
  een gedeeld item is gebleven (§4.6); aan NetBird GmbH, die uw verbindingen naar ons
  doorgeeft, en aan de aanbieder die de mail van de dienst vervoert (§7), elk alleen daarvoor; en
  waar de wet dat verplicht.
- We gebruiken Google-gebruikersgegevens **niet** voor advertenties, in welke vorm dan ook.
- We laten Google-gebruikersgegevens **niet door mensen lezen**. De uitzonderingen zijn die
  welke het beleid toestaat en geen andere: uw eigen uitdrukkelijke verzoek om bepaalde items,
  wat noodzakelijk is voor beveiliging of om aan de wet te voldoen, en geaggregeerde cijfers
  waarin niemand herkenbaar is.
- We gebruiken Google-gebruikersgegevens niet om enig machine-learning- of AI-model te
  trainen, algemeen of anderszins.

**Ownpace biedt Google alleen als bron aan**: er is geen Google-doel om te kiezen.

**Tijdens de Alpha: de lijst van testgebruikers bij Google.** Zolang de app van Ownpace bij
Google in de testfase van Google staat, laat Google een account alleen koppelen als het adres op
de lijst van testgebruikers van die app staat. Voordat u een Google-account koppelt, geeft u ons
daarom het adres, en zetten wij het op die lijst bij Google. Dat geldt ook voor het
Google-account van een gezinslid aan wie u een toegangslink stuurt. Wij halen uw adres van de
lijst wanneer uw gegevens worden gewist. Het adres van een gezinslid gaat er tegelijk af, of
eerder als u of die persoon erom vraagt (§10 van de Voorwaarden voor de Alpha). In de testfase
beëindigt Google een koppeling ook na ongeveer zeven dagen; u koppelt dan opnieuw (§9 daar).

U kunt de toegang van Ownpace tot uw Google-account op elk moment intrekken op
[myaccount.google.com/permissions](https://myaccount.google.com/permissions), of door het
app-wachtwoord te verwijderen dat u hebt aangemaakt.

## 7. Wie er verder bij komt

Tijdens de Alpha draaien de dienst, de databases, onze inlogdienst en deze website op een
machine die we zelf beheren, in Nederland.

<!-- The machine (subprocessors-machine-housed (a), the owner, 2026-09-28): no company houses it
     or can reach it; the owner keeps and runs it for Archico B.V., in the Netherlands. So there
     is no hosting row.
     NetBird (dpa-netbird-agreement (a), the owner, 2026-09-28): its terms and data-processing
     agreement were accepted on 2026-08-01. The owner's note: "NetBird GmbH ("NetBird")
     terminates the TLS, and uses WireGuard tunnel with the backend towards the hosting
     provider." Read as: to our machine, which no hosting company holds (above). The owner
     pointed to https://trust.netbird.io and to https://netbird.io/terms §3.1. Read 2026-09-28:
     the terms, https://netbird.io/privacy and https://netbird.io/imprint; the trust center's
     data, from the API its page loads,
     https://api.eu.scytale.ai/views/trust-center/public/page-data (the egress proxy here still
     refuses trust.netbird.io itself); and NetBird's documentation, https://docs.netbird.io, from
     its source, github.com/netbirdio/docs at 33d1b212. What they say:
     - Who: NetBird GmbH, Rosenthaler Str. 36, 10178 Berlin, "Registered with the local court
       of Amtsgericht Berlin (Charlottenburg) under HRB 237529 B" (imprint; privacy policy). The
       terms give no address.
     - TLS: terms §3.1, "Reverse Proxy may include traffic relaying, NAT traversal, TLS
       termination, traffic forwarding, or similar functionality." For HTTP services, "The proxy
       terminates TLS at the edge", and traffic is "forwarded through an encrypted NetBird tunnel
       to the target peer" (docs, manage/reverse-proxy). "NetBird Cloud issues certificates
       through ZeroSSL on all shared proxy clusters, and ZeroSSL certificates are signed by
       Sectigo" (docs, manage/reverse-proxy/custom-domains).
     - Content: terms §3.1, "NetBird does not monitor or control the content of traffic
       transmitted via Reverse Proxy and disclaims responsibility for such content, except as
       required by law."
     - The agreement: terms §13, "For personal data processing by NetBird on behalf of the
       Customer the NetBird data processing agreement applies." The terms do not link it. The
       trust center lists a PDF, "Data Processing Agreement (DPA)", not restricted, uploaded
       2026-06-23. It could not be downloaded here, so it was not read. The owner confirms that
       it covers the Reverse Proxy, the traffic it decrypts and its access log ("It's covered",
       2026-09-28). What it says of sub-processors, of announcing a new one and the right to
       object, and whether it states the 7 days, is for the lawyer's pass.
     - The log (the row's last sentence; ops-trust-proxy: the row gains it in every option):
       "NetBird logs every request and connection that passes through your reverse proxy
       services", with the time, the method, the host and path, the status, the duration, the
       bytes each way, "The client's IP address", "Country, city, and subdivision based on
       source IP geolocation", and, only where NetBird's own sign-in (SSO) is used, "The
       authenticated user's ID". "For the cloud version of NetBird, access logs are retained for
       7 days." (docs, manage/reverse-proxy/access-logs). The path holds a grant link's secret
       (/grant/:link). The owner: "No pin, but SSO on" (2026-09-28), so while SSO is on the
       log also holds the signed-in user's ID, which the row does not name. The owner then chose
       "Off everywhere at launch": SSO off on every ownpace.eu host (app., id., status. and www.)
       before the first invitation, so the log keeps no user ID for testers and the row names none.
     - Where: NOT STATED for the proxy or its log, in any source read. The docs: "`eu` is the
       proxy cluster region", and "NetBird operates multiple proxy clusters in different regions"
       (manage/reverse-proxy/custom-domains); NetBird's own clusters run "Wherever the platform
       runs proxies" (manage/reverse-proxy/bring-your-own-proxy). Terms §3.1: NetBird may
       "Modify, suspend, or discontinue certain proxy endpoints or regions", and "does not
       guarantee uninterrupted availability, latency performance, or specific geographic
       routing." Its privacy policy says "We process your personal data in the EU/EEA", but it
       applies to "this website (netbird.io), netbird.ai, and all subdomains of the domain
       netbird.io" and does not mention the proxy. The owner keeps Germany (EU) ("Take Germany,
       I'll ask later on", 2026-09-28) and asks NetBird.
     - Its sub-processors: the privacy policy, "A current list of our subprocessors is
       maintained on our Trust Center". The trust center lists 18 entries: Apollo, Auth0, AWS,
       Azure, Datadog, GCP, GitHub, Grafana Cloud, HubSpot, Matomo, Microsoft Clarity (twice),
       New Relic, OpenAI, OVHcloud, Plain, Stripe and UpCloud. Each has an empty location, and
       none is said to run or receive anything of the proxy. The privacy policy also names
       Cloudflare, Inc. (USA), for "Bot management, CDN, Website security", which the trust
       center does not list.
     The "Where" column keeps Germany (EU), where NetBird GmbH is: the owner's choice, pending
     the owner's question to NetBird (the privacy briefing's to-do on NetBird, (c)). If NetBird's
     answer puts the proxy, its log, or a sub-processor of NetBird's that receives either, outside
     the EU, "Where" and §8 name it. Before the first invitation, NetBird's sign-in is off on
     every ownpace.eu host, the owner's choice ((d) there). -->

| Subverwerker | Waarvoor | Waar |
|---|---|---|
| NetBird GmbH | Uw verbindingen met app.ownpace.eu, id.ownpace.eu, status.ownpace.eu en www.ownpace.eu doorgeven naar onze machine. Het beëindigt de versleuteling (TLS) van die verbindingen, dus wat erdoorheen gaat, zoals wat u typt als u inlogt en wat de app u toont, gaat er leesbaar doorheen. Het stuurt ze door naar onze machine via een versleutelde tunnel (WireGuard). Het houdt 7 dagen een eigen log bij van elk verzoek: het tijdstip, het IP-adres en een locatie die daaruit is afgeleid, de gevraagde pagina, ook het geheime deel van een link, hoeveel er elke kant op ging, en de status van het antwoord en hoe lang het duurde | Duitsland (EU) |
| Proton AG | De mail van de dienst versturen, zoals inlogcodes, ons antwoord op uw aanvraag voor toegang, voortgangsoverzichten, en de berichten die u ons laat sturen. Onze supportmailbox bewaren, support@ownpace.eu, waar uw mail aan ons en tijdens de Alpha ook probleemmeldingen binnenkomen, en waar een kopie van elke mail van de dienst wordt bewaard (§4.5) | Zwitserland, buiten de EU (§8) |

Deze tabel is de volledige lijst van onze subverwerkers. Gaat de dienst na de Alpha over naar een
hostingaanbieder, dan noemen we die hier, en laten we het u weten, voordat er gegevens van u
naartoe gaan (§11 van de Voorwaarden voor de Alpha). Zakelijke klanten worden geïnformeerd
voordat een subverwerker wordt toegevoegd, met het recht van bezwaar zoals vastgelegd in de
verwerkersovereenkomst; alle anderen krijgen dezelfde wijzigingsmelding via §13.

**Mollie B.V.** (Nederland, EU) verzorgt kaart- en incassobetalingen. Als vergunninghoudende
betaalinstelling verwerkt Mollie uw betaalgegevens onder eigen verantwoordelijkheid en eigen
privacyverklaring — een zelfstandige verwerkingsverantwoordelijke, geen subverwerker van ons.
**Wij vragen of bewaren uw kaartnummer niet.** Tijdens de Alpha wordt niets in rekening
gebracht, dus Mollie ontvangt niets over u.

**Binnen uw organisatie** is wat de dienst bewaart zichtbaar voor de eigenaar en de beheerders;
de Voorwaarden voor de Alpha vragen u niemand uit te nodigen (§8 daar). Een voortgangslink toont
wie hem heeft de aantallen en statussen van één migratie, nooit de inhoud.

**De bron en het doel van uw migratie zijn geen subverwerkers van ons** — dat zijn uw eigen
accounts, en uw relatie met die aanbieders is de uwe.

Buiten wat deze verklaring noemt, geven we uw gegevens alleen aan anderen door waar de wet ons
daartoe verplicht.

## 8. Waar het staat, en waar niet

<!-- NOT YET TRUE ON live (the owner, 2026-09-28, ops-telemetry (a): switch it off everywhere).
     The negative below holds once the task runner's usage reports are off
     (TRIGGER_TELEMETRY_DISABLED on live and the test stack) and Zitadel, ClickHouse and MinIO
     are checked and switched off too. -->

De dienst draait in de **Europese Unie**. Eén partij in de tabel hierboven zit daarbuiten: onze
e-mailaanbieder, Proton AG, zit in **Zwitserland**. De Europese Commissie heeft besloten dat
Zwitserland persoonsgegevens passend beschermt (art. 45 AVG; Beschikking 2000/518/EG van de
Commissie), dus de AVG vraagt voor die doorgifte geen extra waarborg. Tijdens de Alpha is er nog
één stap, waar u zelf om vraagt: om u een Google-account te laten koppelen, zetten wij het adres
daarvan op de lijst van testgebruikers die Google voor onze app bijhoudt (§6). **Verder, en
afgezien van een doel buiten de EU dat u kiest (hieronder), vindt er door ons geen doorgifte van
uw gegevens plaats naar de Verenigde Staten of enig ander derde land.**

Twee dingen die u zelf kiest, kunnen in de Verenigde Staten terechtkomen. Meldt u een
kwetsbaarheid via ons formulier op GitHub (§11), dan bewaart GitHub uw melding, in de VS. En
staat uw mailbox, of die van iemand aan wie u ons laat schrijven, bij een Amerikaanse aanbieder,
dan wordt onze mail daar afgeleverd.

Dat is geen formaliteit maar de kern van het product: wie weggaat bij een Amerikaanse aanbieder,
heeft weinig aan een migratietool die zelf in de VS draait. Daarom draait de onze daar niet.

Ligt het **doel** van uw migratie buiten de EU, dan gaan uw gegevens daarheen omdat u dat doel
koos. We laten u het doel zien voordat er iets wordt weggeschreven.

## 9. Hoe lang we het bewaren

<!-- NOT YET TRUE, so the draft marker stays until each holds (README, "Before the draft
     markers come off"). The owner's choices of 2026-09-28 are named by their question id.
     - Toegangsgegevens, "gebruikt niets die toegang meer" (terms.md briefing, precondition B):
       since #1320 (d7868276, 0085 T2), merged into this branch in c1413b53, nothing new starts
       for a closed organisation. The sync tick starts no pass for it
       (AN_OPEN_ORGANISATION_WHERE in managed-sync-tick.ts), a pass already queued halts before
       its credentials are built (organisation_closed, stopping-a-pass.ts), the credential
       builders refuse (refuseAClosedOrganisation), and every door that would start work or use
       the access answers 409 account_closed (apps/api/src/closed-organisation.ts). Work already
       running is not all stopped: the close cancels only the runs whose row names the
       orchestrator's run (a sync pass), best effort (apps/api/src/close-account.ts); a sync
       pass the cancel did not stop stops starting new items within about fifteen seconds and
       finishes the ones it has begun (whyThisDataTypeStops, 2026-09-29); a discovery reads to
       the end of the data type it is on; a verification or a confirmation already running reads
       to its end with the stored access.
       True once the close stops those too, or once the row says what the code does.
     - De kopie vlak voor een update (rec-copies (a)): one copy per update, deleted once
       the update is proven (deploy-live.sh logged it as "took", one pass completed, the hold is
       lifted), and never past day 7; not proven by day 6 means rolling back from the copy.
       Built (0139 T6, 2026-09-28, review fixes 2026-09-29): deploy/compose/
       copy-before-update.sh and one directory, ~/.persistent/ownpace-live/copy-before-update,
       taken by deploy-live.sh right before its checkout, a delete step that refuses an
       unproven update, a daily backstop in box-duties.sh that deletes it once older than 6
       days less an hour, and dump-idp.sh and trigger-version.sh writing only there on live.
       The rollback first writes down what was erased, closed or deleted after the copy
       (copy-before-update.sh since) and does it again in the restored database, so "Gegevens
       die uit de dienst zijn gewist, kunnen nog hoogstens 7 dagen in die kopie staan" holds
       through a rollback too. True on live once live runs a tag that carries it and the daily duties' timer runs
       (take refuses without it); the rollback has not been run on a stack.
     - Vastleggingen van de achtergrondtaken: the drill sentence is gone (rec-drill (a)), and
       the drill is off live's duties (0139 T6): box-duties.sh's second duty is the copy's
       backstop, and trigger-version.sh refuses drill on live. True on live once live runs a
       tag that carries it; until then the tag it runs keeps 7 daily dumps.
       "Uiterlijk tot het einde van de Alpha" (privacy-task-records (a)) is one step in the
       end-of-Alpha routine, not written yet.
     - De lijst van wat er gedeeld was, "verdwijnt wanneer u de migratie verwijdert" (§4.2,
       §4.6; the owner's privacy-sharing-list (b)): deleting a migration does not yet delete its
       share_grant rows. A small code change; until it lands, the list stays until erasure.
     - Een zoekopdracht op adres en een download van het logboek, "12 maanden na het
       vastleggen verwijderd" (privacy-search-records (a)): built, not yet run:
       deploy/compose/support-read-prune.sh (0139 T6), the duty `searches` in box-duties.sh,
       over the owner's connection, since app_user cannot change the log, and after 0138 T3
       step 2 the tasks' system role can delete from it, for the purge of an erased
       organisation, but its grant lets it pick rows by organisation, never by age. True on
       live once live's daily duties run. It deletes every read recorded with no organisation
       12 months after it: besides these two, the organisation list, the invoices kept after an
       erasure and a log page not filtered to one organisation.
     - De geschiedenis van de inlogdienst, "zolang we deze inlogdienst draaien"
       (privacy-signin-history (a), the owner: "still needs to be checked"): NOT CHECKED. Remove
       a test account on the test stack (Zitadel v4.19.2) and look at what stays. If the earlier
       entries go, the row says instead: "Removed with your sign-in account." / "Verwijderd met
       uw inlogaccount."
     - Een inlogaccount dat we nooit hebben toegelaten, "30 dagen nadat het is aangemaakt", en
       dat van een verwijderd lid, "7 dagen nadat die persoon is verwijderd"
       (ops-unadmitted-signin-cleanup (a), "A daily script, built before the first tester"; 0135
       open question 13, answered 2026-09-29: "Samen number of days", and then "7 days", the
       erasure window's): built, not yet run: deploy/compose/idp-strays.sh (0135 T8 (a), #1344,
       review fixes #1367, the 7 days added 2026-09-29), the duty `strays` in box-duties.sh (0135
       T8 (b), #1345), --remove --at-most 20 once a day. It counts the 7 days from the newest
       audit_log member.removed row for the subject, and keeps the account while the person is a
       member anywhere, an operator, or has an open request or invitation. True on live once
       live's daily duties run; a day with more than 20 waits for a person. An organisation
       erased less than 7 days after a removal takes that row with it: the runbook's Tenant
       offboarding has the operator note the subject before the purge and remove the account
       with --subject after it, sooner than 7 days, never later.
     - Supportmail, and the copies of the service's own mail (privacy-sent-mail-copies (b):
       "until resolved, then 6 months", as it stands): nothing prunes the mailbox or its Sent
       folder at Proton; it is done by hand. A mail that answers no question has no clear end
       date under this rule (a question for the lawyer, briefing question 20).
     - Serverlogs: the row holds with Docker's default log driver (ops-log-driver (a), the
       owner: "needs checking"). Check the machine (docker info --format
       '{{.LoggingDriver}}'), undo a journald setting if it is there, and take the journald step
       out of docs/managed-bring-up.md. -->

| Wat | Bewaard |
|---|---|
| Toegangsgegevens | Tot u ze verwijdert. De toegang van een koppeling verdwijnt wanneer u die koppeling verwijdert; de app staat dat toe zodra geen migratie haar meer gebruikt. Toegang die een gezinslid via een toegangslink gaf, verdwijnt wanneer u die migratie verwijdert, of wanneer die persoon haar op de eigen voortgangspagina intrekt. Een afgeronde migratie houdt de toegang die u ons gaf, zodat u hem kunt hervatten. Sluit u uw account, dan gebruikt niets die toegang meer, en wordt alles vernietigd wanneer uw gegevens worden gewist. Telkens trekken we de toegang ook in bij de aanbieder, waar die dat toestaat. |
| Het migratieregister (§4.2), en wat elke migratie daarnaast bewaart, zoals de lijst van wat er gedeeld was (§4.6) | Tot u de migratie verwijdert; dan mee verwijderd. Anders tot uw gegevens worden gewist. |
| Preflight-tellingen | Bij de migratie waarvoor ze zijn geteld: tot u die verwijdert, of tot uw gegevens worden gewist. |
| Wat bij uw organisatie hoort en niet bij één migratie: de leden en uitnodigingen, de distributielijsten die een migratie vond, en het auditlog van wie wat deed en wanneer | Tot uw gegevens worden gewist, ook nadat u de migratie verwijdert die ze vond. |
| Welke versies van de Voorwaarden voor de Alpha, de servicevoorwaarden en deze verklaring elk lid heeft aanvaard, in welke taal, en wanneer (§4.4) | Tot uw gegevens worden gewist, ook nadat dat lid uw organisatie heeft verlaten, zodat vastgelegd blijft wie waarmee heeft ingestemd. |
| De mensen voor wie u migreert: ieders naam, en een e-mailadres als u dat gaf (§4.6) | Tot u die persoon verwijdert, of tot uw gegevens worden gewist. Het verwijderen van een migratie verwijdert de persoon niet. |
| Het overzicht van elke ronde: wanneer die liep, en wat die telde | Tijdens de Alpha: tot uw gegevens worden gewist. |
| De logregels van een ronde | 60 dagen. |
| De eigen fouten en waarschuwingen van de app (een categorie en een referentie, geen tekst) | 30 dagen. |
| Uw account, uw organisatie en uw inlogaccount | Zolang uw account bestaat. Sluit u het, dan kiest u wanneer uw gegevens worden gewist: meteen, of na 7, 30 of 90 dagen. Op die dag halen we ook uw inlogaccount uit onze inlogdienst, en uw Google-adres en dat van een gezinslid van de lijst van testgebruikers bij Google (§6); dat zijn stappen die we met de hand doen. |
| De geschiedenis die onze inlogdienst van uw inlogaccount bijhoudt: elke wijziging eraan, zoals uw naam en e-mailadres zoals ze waren, en uw inlogmomenten | Zolang we deze inlogdienst draaien, omdat die ze niet kan verwijderen. Het verwijderen van uw inlogaccount voegt een regel aan die geschiedenis toe; het verwijdert de eerdere niet. |
| Uw aanvraag voor toegang (§4.4) | Zolang die openstaat. Afgewezen: verwijderd 30 dagen na ons besluit. Toegekend: bewaard bij uw account, en daarmee gewist. |
| Een inlogaccount dat iemand op onze inlogpagina aanmaakte maar dat we nooit hebben toegelaten, en dat dus niets opent (§4.4) | 30 dagen nadat het is aangemaakt, tenzij een aanvraag voor toegang met dat adres nog openstaat. |
| Het inlogaccount van iemand die uit een organisatie is verwijderd en van geen enkele organisatie meer lid is (§4.4) | 7 dagen nadat die persoon is verwijderd, tenzij een aanvraag voor toegang of een uitnodiging met dat adres nog openstaat. |
| Supportmail en probleemmeldingen, en de kopieën van de eigen mail van de dienst in dezelfde mailbox (§4.5) | Tot de vraag of het probleem is afgehandeld, en daarna nog 6 maanden. Hetzelfde geldt voor de kopieën van de eigen mail van de dienst. Dan verwijderd uit de mailbox. |
| De vastlegging van wat wij bij uw account inzagen (§4.5) | Tot uw gegevens worden gewist. Wat zonder organisatie wordt vastgelegd, blijft daarna staan: een zoekopdracht op adres, en een download van het logboek van wie wat deed. Die worden 12 maanden na het vastleggen verwijderd. |
| De kopie vlak voor een update | Tot vaststaat dat de update waarvoor ze is gemaakt werkt, en nooit langer dan 7 dagen. Ze bevat de database van de dienst en die van onze inlogdienst; vóór een upgrade van het systeem dat de achtergrondtaken uitvoert, ook de database daarvan. Zo'n kopie is er alleen om een mislukte update terug te draaien, en verlaat de hostingomgeving niet. Gegevens die uit de dienst zijn gewist, kunnen nog hoogstens 7 dagen in die kopie staan. |
| Vastleggingen van de achtergrondtaken die uw migraties uitvoeren (kenmerken, aantallen, en bij een fout een categorie en een referentie; geen namen, adressen of inhoud, op de reden na die een van ons typt wanneer een overstap wordt teruggedraaid) | Uiterlijk tot het einde van de Alpha: dan beginnen de achtergrondtaken met een lege geschiedenis. Ze worden niet verwijderd wanneer uw gegevens worden gewist. |
| Serverlogs (§4.5) | Tot het onderdeel van de dienst dat ze schreef wordt vervangen: voor de app en deze website bij elke update van de dienst; voor onze inlogdienst wanneer de versie of de instellingen ervan veranderen; voor een achtergrondtaak wanneer die klaar is. Er is geen vaste termijn. |
| Facturen en de gebruikscijfers eronder | **7 jaar**, omdat de Nederlandse belastingwet dat vereist. Tijdens de Alpha wordt niets in rekening gebracht: er zijn dan geen facturen, en de gebruikscijfers verdwijnen wanneer uw gegevens worden gewist. |

**Tijdens de Alpha maken we geen back-ups**, op de kopie vlak voor een update na, in de tabel
hierboven (§6 van de Voorwaarden voor de Alpha). Tijdens de Alpha sluiten we uw account binnen 7
dagen na uw verzoek, en laten we u weten op welke datum uw gegevens worden gewist (§10 daar).
Het wissen verwijdert uit de database van de dienst alles wat deze tabel bewaart tot uw gegevens
worden gewist; uw inlogaccount en de Google-adressen op de lijst bij Google volgen dezelfde dag,
met de hand. Wat volgens de tabel na het wissen blijft, blijft zoals die zegt. Verder blijft er
alleen een vastlegging dat er gewist is, met datums en aantallen en zonder naam of adres.
Stoppen we ooit met de dienst, dan staat in §11 van de servicevoorwaarden wat u krijgt.

## 10. Uw rechten

Inzage, rectificatie, verwijdering, beperking, overdraagbaarheid, bezwaar, en het intrekken
van toestemming waar toestemming de grondslag is. Schrijf naar **support@ownpace.eu**; we
brengen er niets voor in rekening en vragen niet waarom. We kunnen u vragen te bevestigen dat
een verzoek van u komt, bijvoorbeeld door te schrijven vanaf het adres van uw account. Deze
rechten gelden jegens ons overal waar §3 ons verwerkingsverantwoordelijke maakt — en de mensen
in een gemigreerde mailbox, en iedereen die §4.6 noemt, die nooit een account hadden, kunnen naar
hetzelfde adres schrijven.

**Uw recht van bezwaar.** Waar we op een gerechtvaardigd belang steunen (§5) — onze logs, het
auditlog, de vastlegging van wat wij bij uw account inzagen, de kopie vlak voor een update, en
de gegevens van andere mensen in een migratie — kunt u op elk moment bezwaar maken, om redenen
die met uw situatie te maken hebben. We stoppen dan, tenzij we dwingende gerechtvaardigde
gronden hebben die zwaarder wegen dan uw belangen, rechten en vrijheden, of de gegevens nodig
hebben voor een rechtsvordering.

**Overdraagbaarheid verdient een opmerking.** Dit product bestaat juist omdat uw eigen gegevens
tussen aanbieders verplaatsen moeilijker is dan het zou moeten zijn. Wilt u uw gegevens uit
Ownpace, dan hebt u ze al — ze staan in het doelaccount waar we ze naartoe hebben geschreven. Wat
wij zelf over u bewaren (§4), sturen we u op verzoek in een gangbaar bestandsformaat.

U kunt een klacht indienen bij een toezichthouder, in het bijzonder in het land waar u woont of
werkt. In Nederland is dat de **Autoriteit Persoonsgegevens** (autoriteitpersoonsgegevens.nl).

## 11. Beveiliging

Toegangsgegevens versleuteld met AES-256-GCM, onder een sleutel die apart van de database met
die gegevens wordt bewaard: in de eigen configuratie van de dienst, en in de instellingen van de
achtergrondtaken, allebei op dezelfde machine. Verbindingen met uw aanbieders zijn versleuteld
met TLS, en het certificaat van de aanbieder wordt gecontroleerd, tenzij u zelf SSL/TLS uitzet
voor een account dat u koppelt met een servernaam; die verbinding is dan misschien niet
versleuteld. Organisaties worden in de database zelf van elkaar gescheiden via row-level
security (beveiliging per rij), voor de verzoeken van de app en voor de achtergrondtaken die de
migraties uitvoeren. Onze supportschermen lezen via views die daar bewust buiten vallen, en
elk van die views controleert dat de lezer een van de mensen is die de dienst draaien (§4.5).
De geplande taken die over organisaties heen lopen, werken er nog niet onder; daar houdt het
eigen filter van elke query op uw organisatie ze gescheiden. Logs zijn zo geschreven dat
toegangsgegevens en berichtinhoud er niet in staan (§4.5 zegt wat ze nog wel kunnen noemen).

<!-- De achtergrondtaken onder row-level security: true since #1323 (d0138607, 0138 T1 step 2),
     merged into this branch in c1413b53. The eight per-tenant tasks and the standalone worker
     connect as app_user on APP_DATABASE_URL (openTaskPools, apps/worker/src/jobs/task-pools.ts).
     The six scheduled jobs that span organisations (the sync tick, retention, the purge of closed
     organisations, the digest, the drift detector, group discovery) still connect as the
     database owner on DATABASE_URL (SECURITY.md; docs/rls-guide.md, "Where row security holds
     today"); 0138 T2 and T3 step 2 move them, on a branch of their own, not merged. -->

**Als er een datalek is.** Raakt een beveiligingsincident uw persoonsgegevens, dan melden we
dat aan de Autoriteit Persoonsgegevens waar de wet dat vereist, en melden we het u.

Geen enkel systeem is perfect. Vindt u een kwetsbaarheid, meld die dan vertrouwelijk via
[ons formulier op GitHub](https://github.com/Robbes/Ownpace/security/advisories/new) of, als u
geen GitHub-account hebt, via **support@ownpace.eu**. We bevestigen de ontvangst binnen vijf
werkdagen. Vraag ons toestemming voordat u de dienst zelf test: die bewaart de toegang van
anderen tot hun accounts. We zullen u niet bedreigen omdat u het meldt.

## 12. Kinderen

De dienst richt zich niet op kinderen onder de 16 en we maken niet bewust accounts voor hen
aan. Een ouder die een migratie voor het gezin instelt, kan daarin uiteraard het account van een kind
meenemen — dat is het huishoudelijke geval dat §3 beschrijft, en de ouder blijft degene die
de migratie instelt. Een toegangslink voor een kind onder de 16 rondt de ouder samen met het
kind af. Het Google-adres van het kind komt op verzoek van de ouder op de lijst van
testgebruikers bij Google (§6).

## 13. Wijzigingen

Wezenlijke wijzigingen melden we per e-mail aan accounthouders, minstens **30 dagen** voordat
ze ingaan, en elke versie van deze verklaring blijft beschikbaar in
[haar geschiedenis op GitHub](https://github.com/Robbes/Ownpace/commits/main/site/legal/privacy.nl.md),
zodat u kunt zien wat er is veranderd. Die geschiedenis toont ook concepten die nooit zijn
gepubliceerd; hun versieregel zegt dat. Het versienummer en de datum bovenaan deze pagina laten
zien welke versie geldt.

Tijdens de Alpha bepalen de Voorwaarden voor de Alpha (§11 daar) hoe u hoort wat erna komt, ook
een overgang naar een andere hostingaanbieder: minstens 7 dagen van tevoren, per e-mail. Er
gaan geen gegevens van u naartoe als u de nieuwe voorwaarden niet aanvaardt.
