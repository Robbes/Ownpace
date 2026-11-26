# Toegankelijkheidsverklaring

Ownpace moet werken voor iedereen die het gebruikt, ook met een schermlezer, alleen met een
toetsenbord, met sterke vergroting of op een telefoon. Op deze pagina leest u hoe ver we zijn,
wat nog niet goed werkt, en hoe u ons laat weten dat iets u in de weg zit.

**Laatst nagekeken:** 2026-11-26

## Waar deze verklaring over gaat {#reikwijdte}

- Deze website, www.ownpace.eu, in het Nederlands en het Engels.
- De Ownpace-app op app.ownpace.eu. Daar horen ook de twee pagina's bij die u met een link opent,
  zonder in te loggen. Op de eerste geeft u toestemming. Op de tweede ziet u hoe ver het kopiëren
  is.
- De zelf gehoste Ownpace-appliance toont dezelfde schermen van de app op uw eigen computer. Wat
  deze pagina over de app zegt, geldt ook voor die schermen.

Een paar pagina's waar u langs komt, zijn niet van ons: de inlogpagina van onze inlogdienst, en
de toestemmingsschermen van Google, Microsoft en Dropbox. Die kunnen wij niet aanpassen. Houdt
een daarvan u tegen, laat het ons dan toch weten; dan zoeken we samen met u een andere weg.

## De norm waar we naar streven {#norm}

We streven naar de Web Content Accessibility Guidelines, **WCAG 2.2, niveau AA**. We zeggen met
opzet *streven naar*: de site en de app voldoen er nog niet volledig aan (zie *Bekende
tekortkomingen*), en er is geen onafhankelijke toetsing gedaan. Alles hieronder hebben we zelf
nagekeken.

## Wat we hebben gedaan {#gedaan}

Tussen september en november 2026 hebben we de app nagelopen met telefoons en schermlezers in
gedachten. Zo werkt het nu:

- Het menu op een telefoon neemt de focus van het toetsenbord over, en geeft hem terug.
- Elke stap van *Migratie starten* opent bovenaan, met de focus op de kop. Dat doet ook elke stap
  van de pagina waarop u toestemming geeft.
- Foutmeldingen en wachtmeldingen worden voorgelezen.
- Een grijze knop zegt in woorden waarom u er niet op kunt drukken.
- Een link *Naar de inhoud* staat op elke pagina vooraan.

De twee pagina's van een link zijn groter en duidelijker dan de rest van de app:

- Zinnen zijn 18 pixels groot. Geen tekst is kleiner dan 16 pixels.
- Een hoofdknop is minstens 60 pixels hoog, en zo breed als de kolom. Elke andere knop of link die
  los staat, is minstens 44 bij 44 pixels.
- Zinnen hebben een contrast van minstens 7 op 1.
- De focus van het toetsenbord is te zien, ook op een gekleurde knop.

Dat is meer dan WCAG 2.2 op niveau AA vraagt.

Onze automatische tests openen de app op de breedte van een telefoon. Ze openen de inlogpagina's,
de lijst met migraties, elke stap van *Migratie starten* en de links die u ontvangt. Ze slaan
alarm als een daarvan zijwaarts schuift. De twee pagina's van een link openen ze ook op 320 pixels
breed. Zo smal is een scherm van 1280 pixels bij 400% zoom.

In oktober 2026 hebben we elk scherm van de app en elke pagina van deze site bekeken, in het
Nederlands en het Engels, op een telefoon en op een computer, en een automatische
toegankelijkheidscontrole (axe) laten lopen over de app in het Engels en over elke pagina van de
site. Die vond tekst met te weinig contrast, links die alleen aan hun kleur te herkennen waren,
en namen van links die niet overeenkwamen met hun tekst. Dat hebben we verholpen, en bij de
controle daarna vond hij geen ernstige of kritieke problemen meer op de pagina's die hij las.

## Bekende tekortkomingen {#tekortkomingen}

Dit zijn de problemen die we kennen en nog niet hebben verholpen:

- **Een nieuw scherm wordt niet aangekondigd.** Volgt u in de app een link naar een ander
  scherm? Dan verandert de titel van het scherm, maar de focus van het toetsenbord gaat niet mee.
  Een schermlezer zegt niet dat er een nieuw scherm is geopend. U moet de inhoud dan zelf zoeken.
  Bij de stappen van *Migratie starten* gaat de focus wel mee. Dat geldt ook voor elke stap op de
  pagina's van een link.
- **Sommige uitleg verschijnt alleen als u er met een muis boven hangt.** Op het scherm
  *Verificatie* is de korte uitleg bij elke uitkomst (wat *Geslaagd*, *Niet geverifieerd* of *Kon
  niet worden geverifieerd* betekent, en hoeveel van de inhoud is vergeleken) een tekst die alleen bij aanwijzen
  met de muis verschijnt. Op een telefoon, alleen met een toetsenbord of met een schermlezer kunt
  u die misschien niet lezen. Elders in de app staat nog wat uitleg op die manier; die hebben we
  nog niet allemaal nagelopen.

## Wat we nog niet hebben nagekeken {#niet-nagekeken}

- We hebben de app nog niet van begin tot eind gebruikt met VoiceOver op een iPhone. Ook niet met
  TalkBack op een Android-telefoon, of met 200% zoom.
- We hebben nog niet elke app geprobeerd die links in een eigen browser opent, zoals een mail- of
  chatapp. Sommige daarvan blokkeren misschien het venster waarin u bij Google inlogt.
- Onze automatische tests laten nog niet bij elke wijziging een toegankelijkheidscontrole lopen,
  en ze draaien in één browser (Chromium), niet in die van Safari. Een probleem dat we hebben
  verholpen, kan dus terugkomen zonder dat een test het merkt.

## Meld een drempel {#melden}

Houdt iets op deze site of in de app u tegen, of hebt u het in een andere vorm nodig, schrijf dan
naar **support@ownpace.eu**. Vermeld op welke pagina u was en wat u probeerde te doen; stuur
nooit een wachtwoord mee. Wat daar binnenkomt, leest een mens, en we streven naar antwoord
binnen vijf werkdagen.
