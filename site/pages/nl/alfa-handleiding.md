<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!-- The tester guide (workplan 0144 T1), in its SHORT form, before the first
     invitation; the full text is written later against the first tester's
     screens (0144 T0). Dutch first; alpha-guide.md is the English
     translation. Keep the six section headings and their ids ({#...}) the
     same in both: a link to a section (0144 T6 (c)'s issue chooser links
     #hulp) leans on the id, not on the heading's words. The two ### headings
     under "Zo begint u" carry ids too, so an invitation can link the Google
     steps.

     Rendered only when the site is built for the alpha (OWNPACE_STAGE=alpha;
     site/build.mjs, ALPHA_ONLY), outside the nav. [[REQUEST_ACCESS]] is
     filled in by the build with that environment's request page, so this
     file never names an app's address.

     Not a contract: the Alpha conditions (site/legal/alpha.nl.md) bind, and
     this page promises nothing they or the code do not.

     The target folder is promised for mail, and for files only on a WebDAV
     or Nextcloud destination: only the WebDAV writer applies the folder to
     the files themselves (`ownsTargetFolderPrefix`). The JMAP files writer
     makes the folders under it and writes every file at the account root
     (core/dav-sync.ts, "a named gap"). Widen the sentence when that is fixed.

     FOR THE OWNER (0144 T0), before publishing:
     - Read the Dutch against the real screens of ownpace-live.
     - Spelling: the conditions and the acceptance screen write "Alpha", the
       app's note and the access-granted mail "alfa". This page writes "alfa",
       and names the conditions by their title.
     - Left out until proven: Google's own Dutch words on its "app not
       verified" screen (0140 T2 (a)). The page only says that a warning comes
       and to go on to Ownpace; add the screen's own words and buttons when
       they are seen. Also the sign-in service's screens (registration, the
       confirmation mail); the number of testers (D1 says 10 to 20, the
       conditions "een kleine groep"); the paragraph on phones and screen
       readers (0145 T9 (a), written after 0145 T10's walk on two phones); a
       list of what is experimental (0144 T2's page). -->

# Handleiding voor de alfa

Deze pagina is voor wie is uitgenodigd voor de alfa van Ownpace. Lees haar voordat u begint.

Deze handleiding is geen contract. Wat geldt, staat in de
[Voorwaarden voor de Alpha](./alpha.html). Zegt deze pagina iets anders, dan gelden de
voorwaarden.

## Wat de alfa is {#wat-de-alfa-is}

Ownpace kopieert uw e-mail, agenda, contacten en bestanden van uw oude naar uw nieuwe
aanbieder. In de app heet dat een migratie. Wij draaien de dienst voor u.

De alfa is een proef met die dienst. Een kleine groep doet mee, en iedereen is persoonlijk
uitgenodigd. De alfa duurt enkele weken.

- **Gratis.** Er wordt niets in rekening gebracht.
- **Alleen voor huishoudens.** U doet mee met uw eigen accounts of die van uw gezin.
- **Geen verplichtingen, aan beide kanten.** U mag op elk moment stoppen. Wij mogen de alfa
  stoppen of opnieuw laten beginnen. Dat melden wij minstens 7 dagen van tevoren per e-mail. De
  dienst kan haperen.
- **Geen back-ups.** Alleen vlak voor een update maken wij één kopie. Gaan de gegevens van de
  dienst verloren? Dan koppelt u uw accounts opnieuw en zet u uw migraties opnieuw op. Wat al bij
  uw nieuwe aanbieder staat, blijft daar.
- **Na de alfa** gaat de dienst door, onder nieuwe voorwaarden.

## Voordat u begint {#voordat-u-begint}

- **Google-adressen eerst.** Wilt u een Google-account koppelen? Mail dan eerst elk Google-adres
  naar [support@ownpace.eu](mailto:support@ownpace.eu), ook dat van een gezinslid. Wacht op ons
  antwoord. Wij zetten het adres bij Google op de lijst van testgebruikers. Zonder die stap laat
  Google de koppeling niet toe.
- **Houd uw oude account tot u hebt gecontroleerd wat er is aangekomen.** Ownpace leest alleen
  uit uw oude account. Het wijzigt en verwijdert daar niets.
- **Begin met een lege bestemming.** Dat is het makkelijkst: een nieuwe, lege mailbox, agenda,
  adresboek en map bij uw nieuwe aanbieder. Waarom? Staat er bij uw nieuwe aanbieder al iets dat
  ook in uw oude account staat? Dan laat Ownpace dat met rust. Verandert het later in uw oude
  account, dan neemt Ownpace dat niet mee. Staat een e-mail bij uw nieuwe aanbieder al in een
  andere map, dan kan hij dubbel binnenkomen.
- **Is uw bestemming niet leeg?** Kies dan een doelmap. Uw e-mail komt dan onder die map. Dat
  doet u niet via stap 5 hieronder, maar bij *Migraties* met *Eén migratie handmatig toevoegen*.
  Vul daar *Doelmap (optioneel)* in. Voor bestanden werkt een doelmap alleen bij de bestemming
  *WebDAV* of *Nextcloud*. Twijfelt u? Vraag het ons eerst.
- **Open links in een browser** zoals Safari of Chrome, niet in een chat- of mailapp. Opent een
  link toch in zo'n app? Kies daar dan *Openen in browser*.
- **Verwijderingen staan uit.** Verwijdert u iets in uw oude account? Dan blijft de kopie bij uw
  nieuwe aanbieder staan. Wilt u dat die kopie ook verdwijnt? Open dan bij de migratie de pagina
  *Verwijderingen*. Kies *Handmatig verwijderen inschakelen*, en bevestig. Daarna kiest u per
  verwijdering: *Verwijder het hier ook* of *Behoud onze kopie*. Ownpace verwijdert alleen een
  kopie die het zelf schreef. Is een bestand, agenda-item of contact bij uw nieuwe aanbieder
  gewijzigd? Dan verwijdert het dat niet. Bij e-mail controleert het dat niet. Staat handmatig
  verwijderen aan, dan ziet u een tweede knop, ook standaard uit: *Automatisch verwijderen
  inschakelen*. Die ruimt de oude kopie op van een bestand dat u in uw oude account verplaatste.
  U kiest dan niet per bestand.

## Zo begint u {#zo-begint-u}

1. Vraag toegang aan op de pagina [Toegang aanvragen]([[REQUEST_ACCESS]]), met het e-mailadres
   waarmee u zich wilt aanmelden.
2. Wij zetten uw toegang klaar, en u krijgt de e-mail *Ownpace — uw toegang staat klaar*.
3. Ga naar het adres achter *Meld u hier aan* in die e-mail. Meld u daar aan met hetzelfde
   e-mailadres. Hebt u nog geen account? Maak er dan een aan, en bevestig de bevestigingsmail.
4. Aanvaard de Voorwaarden voor de Alpha, de [privacyverklaring](./privacy.html) en de
   [servicevoorwaarden](./voorwaarden.html), met *Alle drie aanvaarden*.
5. Kies bij *Migraties* voor *Migratie starten*. De app vraagt stap voor stap wat er mee moet en
   waarheen, en verbindt uw accounts. Koppelt u een Google-account? Doe dat pas als wij hebben
   gemeld dat uw adres op de lijst staat.
6. Lees het laatste scherm, *Controleren, dan starten*. Er wordt niets gekopieerd voordat u op
   *Starten* drukt.
7. Is alles een eerste keer gekopieerd? Kies dan bij de migratie *Verificatie*, en dan *Voer de
   verificatie uit*. Die vergelijkt oud met nieuw, en verandert aan geen van beide iets.

### Als u Google koppelt {#google-koppelen}

Google toont eerst een waarschuwing dat Google de app niet heeft gecontroleerd. Dat hoort zo
tijdens de alfa. Ga daar verder naar Ownpace. Zorg dat alles wat Ownpace vraagt een vinkje
heeft.

### Als Google opnieuw vraagt {#google-opnieuw}

Zolang de app van Ownpace bij Google in de testfase staat, stopt een koppeling met Google na
ongeveer zeven dagen. Ga dan naar *Accounts*. Kies bij dat account *Opnieuw verbinden*, dan
*Verbinden met Google*, en dan *Controleren en vervangen*. De migratie gaat verder waar ze
stopte. Er gaat niets verloren.

## Wat experimenteel is {#wat-experimenteel-is}

Sommige bronnen en gegevenssoorten hebben in de app het label *Experimenteel*. Dat betekent:
gebouwd, maar nog niet gebruikt met een echt account van die soort. Houd bij zo'n bron uw oude
account zeker aan, en controleer wat er aankomt. Twijfelt u? Vraag het ons dan voordat u
koppelt.

## Hulp {#hulp}

Wij helpen u persoonlijk.

- **In de app.** Staat *Een probleem melden* in het menu? Gebruik dat dan. Wij antwoorden per
  e-mail.
- **Per e-mail.** Mail naar [support@ownpace.eu](mailto:support@ownpace.eu), ook als u nog niet
  bent aangemeld.
- **Wat u ons vertelt.** Noem de pagina, wat u deed, en het versienummer onderaan het menu of de
  pagina.
- **Stuur nooit** een wachtwoord of een andere inlogcode, of de inhoud van uw e-mail of
  bestanden.
- **Niet via GitHub.** Meld daar geen probleem. GitHub is voor ontwikkelaars, en iedereen kan het
  lezen.
- **Handleidingen** per aanbieder staan in de app onder *Hulp*.

## Stoppen {#stoppen}

U mag op elk moment stoppen.

- **Vraag ons uw account te sluiten,** per e-mail of met *Een probleem melden*. Een knop daarvoor
  is er nog niet. Kies wanneer uw gegevens worden gewist: meteen, of na 7, 30 of 90 dagen. Wij
  sluiten uw account binnen 7 dagen, en noemen u de datum waarop uw gegevens worden gewist.
- **Wat blijft.** De kopieën bij uw nieuwe aanbieder, en uw oude account.
- **Wat u zelf intrekt.** Toegang die u zelf bij een aanbieder maakte, zoals een app-wachtwoord
  of de toestemming bij Microsoft of Dropbox. Wij zeggen u welke.
- **Wat wij wissen.** Uw Ownpace-inlogaccount en uw aanvraag voor toegang. Uw Google-adres, en
  dat van een gezinslid, halen wij van de lijst van testgebruikers.
