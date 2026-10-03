<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!-- The tester guide (workplan 0144 T1), in its SHORT form, before the first
     invitation; the full text is written later against the first tester's
     screens (0144 T0). Dutch first; alpha-guide.md is the English
     translation. Keep the six section headings and their ids ({#...}) the
     same in both: a link to a section (0144 T6 (c)'s issue chooser links
     #hulp) leans on the id, not on the heading's words.

     Rendered only when the site is built for the alpha (OWNPACE_STAGE=alpha;
     site/build.mjs, ALPHA_ONLY), outside the nav. [[REQUEST_ACCESS]] is
     filled in by the build with that environment's request page, so this
     file never names an app's address.

     Not a contract: the Alpha conditions (site/legal/alpha.nl.md) bind, and
     this page promises nothing they or the code do not.

     FOR THE OWNER (0144 T0), before publishing:
     - Read the Dutch against the real screens of ownpace-live.
     - Spelling: the conditions and the acceptance screen write "Alpha", the
       app's note and the access-granted mail "alfa". This page writes "alfa",
       and names the conditions by their title.
     - Left out until proven: Google's own Dutch words on its "app not
       verified" screen (0140 T2 (a)); the sign-in service's screens
       (registration, the confirmation mail); the number of testers (D1 says
       10 to 20, the conditions "een kleine groep"); the paragraph on phones
       and screen readers (0145 T9 (a), written after 0145 T10's walk on two
       phones); a list of what is experimental (0144 T2's page). -->

# Handleiding voor de alfa

Deze pagina is voor wie is uitgenodigd voor de alfa van Ownpace. Lees haar voordat u begint.

Deze handleiding is geen contract. Wat geldt, staat in de
[Voorwaarden voor de Alpha](./alpha.html). Zegt deze pagina iets anders, dan gelden de
voorwaarden.

## Wat de alfa is {#wat-de-alfa-is}

De alfa is een proef met de beheerde Ownpace-dienst. Een kleine groep doet mee, en iedereen is
persoonlijk uitgenodigd. De alfa duurt enkele weken.

- **Gratis.** Er wordt niets in rekening gebracht. U krijgt geen factuur.
- **Alleen voor huishoudens.** U doet mee als particulier, met uw eigen accounts of die van uw
  gezin.
- **Geen verplichtingen, aan beide kanten.** U mag op elk moment stoppen. Wij mogen de alfa
  stoppen of opnieuw laten beginnen, en melden dat minstens 7 dagen van tevoren per e-mail. De
  dienst kan haperen, en een update kan uw migraties even stilzetten.
- **Geen back-ups.** Alleen vlak voor elke update maken wij één kopie, die wij hoogstens 7 dagen
  bewaren. Gaan de gegevens van de dienst verloren, dan koppelt u uw accounts opnieuw en zet u
  uw migraties opnieuw op. Wat al bij uw nieuwe aanbieder staat, blijft daar.
- **Na de alfa** gaat de dienst door, onder nieuwe voorwaarden. U krijgt ze minstens 7 dagen van
  tevoren per e-mail, en u aanvaardt ze in de app. Hebt u ze niet aanvaard als ze ingaan, dan
  sluiten wij uw account.

## Voordat u begint {#voordat-u-begint}

- **Houd uw oude account tot u hebt gecontroleerd wat er is aangekomen.** Ownpace leest alleen
  uit uw oude account. Het wijzigt en verwijdert daar niets.
- **Begin met een lege bestemming:** een nieuwe, lege mailbox, agenda, adresboek en map. Wat
  daar al staat en overeenkomt met uw oude account, laat Ownpace zoals het is, ook als het later
  in uw oude account verandert. Bij e-mail kan een bericht dat daar in een andere map staat,
  dubbel binnenkomen.
- **Of kies een doelmap** voor e-mail en bestanden. Dat doet u bij *Migraties*, met *Eén migratie
  handmatig toevoegen*, in het veld *Doelmap (optioneel)*. Alles komt dan onder die map.
- **Google-adressen eerst.** Stuur ons elk Google-adres dat u wilt koppelen, ook dat van een
  gezinslid, en wacht op ons antwoord. Wij zetten het bij Google op de lijst van testgebruikers.
  Zonder die stap laat Google de koppeling niet toe.
- **Open links in een browser** zoals Safari of Chrome, niet in een chat- of mailapp. Opent een
  link toch in zo'n app? Kies daar dan *Openen in browser*.
- **Verwijderingen staan uit.** Ownpace verwijdert niets bij uw nieuwe aanbieder, tot u op de
  pagina *Verwijderingen* van een migratie *Toepassen van verwijderingen inschakelen* kiest.
  Daarna kiest u per verwijdering: *Verwijder het hier ook* of *Behoud onze kopie*. Ownpace
  verwijdert alleen een kopie die het zelf schreef. Een bestand, agenda-item of contact dat bij
  uw nieuwe aanbieder is gewijzigd, verwijdert het niet. Bij e-mail controleert het dat niet. Een
  tweede knop ruimt verplaatste bestanden op, zonder keuze per item.

## Zo begint u {#zo-begint-u}

1. Vraag toegang aan op de pagina [Toegang aanvragen]([[REQUEST_ACCESS]]), met het e-mailadres
   waarmee u zich wilt aanmelden.
2. Wij zetten uw toegang klaar, en u krijgt de e-mail *Ownpace — uw toegang staat klaar*.
3. Meld u aan via de link in die e-mail, met hetzelfde adres. Hebt u nog geen account? Maak er
   dan een aan, en bevestig de bevestigingsmail.
4. Aanvaard de Voorwaarden voor de Alpha, de [privacyverklaring](./privacy.html) en de
   [servicevoorwaarden](./voorwaarden.html), met *Alle drie aanvaarden*.
5. Kies bij *Migraties* voor *Migratie starten*. De app vraagt stap voor stap wat er mee moet en
   waarheen, en verbindt uw accounts.
6. Lees het laatste scherm, *Controleren, dan starten*. Er wordt niets gekopieerd voordat u op
   *Starten* drukt.
7. Na de eerste ronde: kies bij de migratie *Verificatie*, en dan *Voer de verificatie uit*. Die
   vergelijkt oud met nieuw, en verandert aan geen van beide iets.

**Google vraagt opnieuw.** Zolang de app van Ownpace bij Google in de testfase staat, stopt een
koppeling met Google na ongeveer zeven dagen. Ga dan naar *Accounts*. Kies bij dat account
*Opnieuw verbinden*, dan *Verbinden met Google*, en dan *Controleren en vervangen*. De migratie
gaat verder waar ze stopte. Er gaat niets verloren.

## Wat experimenteel is {#wat-experimenteel-is}

Sommige bronnen en gegevenssoorten hebben in de app het label *Experimenteel*. Dat betekent:
gebouwd, maar nog niet gebruikt met een echt account van die soort. Houd bij zo'n bron uw oude
account zeker aan, en controleer wat er aankomt. Twijfelt u? Vraag het ons dan voordat u
koppelt.

## Hulp {#hulp}

Wij helpen u persoonlijk.

- **In de app.** Staat *Een probleem melden* in het menu? Gebruik dat dan. De app stuurt zelf mee
  op welke pagina u was en welke versie u gebruikt. Wij antwoorden per e-mail.
- **Per e-mail.** Mail naar [support@ownpace.eu](mailto:support@ownpace.eu), ook als u nog niet
  bent aangemeld.
- **Wat u ons vertelt.** Noem de pagina, wat u deed, en het versienummer onderaan het menu of de
  pagina, zoals *v0.2.0-alpha.1 · abc1234*.
- **Stuur nooit** een wachtwoord, een token of de inhoud van uw e-mail of bestanden.
- **Niet via GitHub.** Open daar geen issue. GitHub is voor ontwikkelaars, en iedereen kan het
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
