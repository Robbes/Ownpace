# IMAP — mail met een gebruikersnaam en een wachtwoord

IMAP is de standaardmanier waarop een mailprogramma een postvak leest. Deze dienst gebruikt het aan twee kanten: als bron, om mail te lezen uit een postvak bij een aanbieder die IMAP aanbiedt, en als doel, om mail te schrijven in een postvak bij de aanbieder van uw keuze. Aan beide kanten meldt deze dienst zich aan met een gebruikersnaam en een wachtwoord. Er is geen knop om toestemming te geven: het wachtwoord is de toegang.

## Wat u nodig hebt {#before}

- De naam van de IMAP-server en de poort voor IMAP met SSL, die uw mailaanbieder publiceert; meestal is dat poort 993.
- De gebruikersnaam van het postvak, zoals uw aanbieder die opgeeft.
- Een wachtwoord. De meeste aanbieders weigeren een gewoon accountwachtwoord voor IMAP zodra tweestapsverificatie aanstaat, en willen een app-specifiek wachtwoord. Maak er één aan bij de aanbieder, voor dit ene postvak.
- Voor een doel: het postvak bestaat al, met genoeg ruimte voor wat eraan komt. Deze dienst maakt zelf geen accounts aan.

## Koppelen {#connect}

Aan beide kanten vraagt de kaart **IMAP** dezelfde velden. In **Migratie starten** is ze **Een andere mailaanbieder** waar een postvak verlaten wordt, en **IMAP toevoegen** waar de mail naartoe gaat.

### IMAP als bron {#imap-source}

1. Vink bij **Welk account verlaat u?** **Een andere mailaanbieder** aan. Ook **Andere manieren om te verbinden (IMAP)** leidt ernaartoe.
2. Vul bij **Uw accounts verbinden** de naam van de IMAP-server in bij **Host**, zoals `imap.example.com`: alleen de naam, zonder `https://` of een pad erachter.
3. Typ bij **Poort** de poort die uw aanbieder opgeeft voor IMAP met SSL: meestal `993`, dat het vak als voorbeeld toont. Er is geen vakje voor SSL/TLS: deze dienst verbindt altijd daarmee.
4. Vul bij **Gebruikersnaam** de gebruikersnaam van het postvak in.
5. Vul bij **Wachtwoord** het app-wachtwoord in, of het wachtwoord van het postvak als de aanbieder dat voor IMAP toelaat.
6. Druk op **Aanmelding controleren**.

De test meldt zich alleen-lezen aan en schrijft niets. Werkt het, dan staat er **Verbonden.**, met daaronder wat hij vond, en is het account bewaard. Bij een volgende migratie biedt **Uw accounts verbinden** het aan, zodat u niets opnieuw hoeft in te vullen. De link **Instelstappen** onder het formulier zet de voorbereiding op een lijst die onthoudt wat u al gedaan hebt.

### IMAP als doel {#imap-target}

1. Kies bij **Waar gaat het naartoe?**, in de rij voor e-mail, **IMAP toevoegen** onder **Een nieuw account**.
2. Vul bij **Host** de naam van de IMAP-server in waar de mail naartoe gaat, zoals `imap.example.com`.
3. Typ bij **Poort** de IMAP-poort die uw aanbieder opgeeft, meestal `993`.
4. Vul bij **Gebruikersnaam** en **Wachtwoord** de gegevens van het doelpostvak in.
5. Druk op **Aanmelding controleren**.

Ook hier schrijft de test niets: hij meldt zich aan en telt de mappen van het doelpostvak.

**Waar de kopieën komen**, onder de rijen, zegt waar de mail in dat account terechtkomt. Laat u het zoals het is, dan voegt de mail samen in het account: de mappen van de bron komen naast de mappen die er al zijn. Open **In een eigen map zetten** en typ een naam bij **Map**, zoals `Gmail`, en alles komt onder die map terecht. Sturen twee migraties mail naar hetzelfde account, dan opent het vanzelf, ingevuld met het account waar elk vandaan komt.

U kunt een IMAP-account ook vooraf toevoegen, onder **Accounts** → **Account toevoegen**. Kies daar bij **Bron of doel?** **Bronnen** of **Doelen**, dan de kaart **IMAP**, en druk op **Toevoegen en testen**.

## Wat er meegaat {#what-moves}

- **Als bron** leest deze kaart mail: de mappen van het postvak en de berichten daarin. Bij **Wat wilt u migreren?** biedt een mailaanbieder alleen **E-mail** aan, en zegt waarom: via IMAP wordt alleen mail gelezen. Agenda's en contacten meet deze dienst op een IMAP-account ook niet.
- **Als doel** ontvangt deze kaart alleen mail: bij **Waar gaat het naartoe?** biedt alleen de rij voor e-mail haar aan. Agenda's, contacten, bestanden en taken gaan naar een CalDAV-, CardDAV- of WebDAV-doel ([de DAV-handleiding](dav.md)) of naar een Nextcloud ([de Nextcloud-handleiding](nextcloud.md)), gekozen in hun eigen rijen, en **Migratie starten** maakt voor elk een migratie.
- Mappen die in het doel nog niet bestaan, worden aangemaakt. Verzonden en Concepten worden de Verzonden en Concepten van het doelaccount zelf. In een eigen map komen ze als gewone mappen daarbinnen terecht, want een mailprogramma kan er maar één van elk hebben.
- Een migratie mag vaker lopen: een bericht dat al in het doel staat, wordt herkend en niet nog eens gekopieerd.

## Als de test iets meldt {#when-test-says}

Wat een mailserver zelf antwoordt, toont deze dienst woordelijk, in de taal van de server; meestal is dat Engels.

- **Het wachtwoord wordt geweigerd**, bijvoorbeeld met `AUTHENTICATIONFAILED` of een regel met `LOGIN failed`. Controleer de gebruikersnaam. Staat tweestapsverificatie aan, dan willen de meeste aanbieders een app-specifiek wachtwoord in plaats van het accountwachtwoord.
- **De server is niet bereikbaar** of weigert de verbinding. Controleer **Host** en **Poort** tegen wat uw aanbieder voor IMAP met SSL opgeeft.
- **Geen antwoord binnen 20 seconden.** De test zegt dat.
- **Een mislukte test begint opnieuw.** **Opnieuw proberen** haalt het account weg dat de mislukte test bewaarde en opent het formulier weer met wat u typte, zodat een verbeterde **Host**, **Poort** of **Gebruikersnaam** getest wordt zoals getypt. Verwijder op de pagina **Accounts** het account dat mislukte, en voeg het opnieuw toe.

## Stoppen {#leaving}

- Een migratie verwijdert u onder **Migraties**. De bevestiging zegt wat dat doet: **Verwijdert instellingen en registratie van de migratie; bij uw bron of bestemming wordt niets aangeraakt.** Wat al gekopieerd is, blijft in het doel staan.
- Een account verwijdert u onder **Accounts** met **Verwijderen**. Daarmee verdwijnt de kopie van het wachtwoord bij deze dienst. Het wachtwoord zelf blijft bij de aanbieder geldig, en het scherm zegt dat ook: **Wij hebben onze kopie verwijderd; deze aanbieder biedt geen intrekking die wij kunnen aanroepen.**
- Trek daarom het app-wachtwoord in bij uw aanbieder, of wijzig het wachtwoord van het postvak. Dat kan alleen de houder van het account. Een app-wachtwoord kan ingetrokken worden zonder het wachtwoord van de persoon te wijzigen.
