# Hoe een migratie kopieert

Elke migratie kopieert in dezelfde volgorde, waar ze ook uit leest: eerst de laatste 90 dagen, daarna alles wat ouder is. U kunt ook een migratie maken van alleen de laatste 90 dagen, om doelplatformen met uw actuele gegevens uit te proberen, en later alles kopiëren.

## Eerst de afgelopen 90 dagen {#last-90-days-first}

De eerste kopie van mail, bestanden en agenda's komt in twee delen:

1. **De laatste 90 dagen.** Mail die in de laatste 90 dagen is ontvangen, eerst de inbox, dan de verzonden mail, dan de andere mappen. Bestanden die in de laatste 90 dagen zijn gewijzigd. Afspraken die in de laatste 90 dagen of later eindigen, dus ook alle komende; een terugkerende afspraak komt helemaal mee, met al haar wijzigingen, als een van haar datums in die tijd valt.
2. **Alles wat ouder is.** Daarna de rest, in dezelfde mappen. Wat het eerste deel kopieerde, wordt herkend en niet nog eens gekopieerd.

**Contacten** en **taken** worden in één keer helemaal gekopieerd: ze zijn klein, en u hebt ze helemaal nodig.

Zo kopieert elke migratie. Het is geen instelling, en u hoeft er niets voor te kiezen.

Op de pagina van de migratie zegt de regel onder de naam hoe ver ze is:

- **Eerst de afgelopen 90 dagen.** Het eerste deel loopt nog.
- **De laatste 90 dagen staan erin. Oudere items komen nog.** Het eerste deel is klaar, voor mail, bestanden en agenda's, en de oudere items komen eraan. Een map die er bij de bestemming half leeg uitziet, is een map waarvan de oudere items er nog niet zijn.

Mail komt in de nieuwe mailbox met de nieuwste eerst binnen. Elk bericht houdt zijn eigen datum, dus uw mailprogramma sorteert het zoals het was.

## Alleen de afgelopen 90 dagen {#last-90-days-only}

Kies bij **Wat wilt u migreren?**, onder **Hoeveel?**, voor **Alleen de laatste 90 dagen**. De migratie kopieert dan:

- mail, bestanden en agenda's van de laatste 90 dagen, zoals in het eerste deel hierboven;
- alle contacten en alle taken.

Dit is bedoeld om doelplatformen met uw actuele gegevens uit te proberen voordat u besluit. Maak zo'n migratie voor elke bestemming die u wilt proberen: elke migratie kopieert dezelfde 90 dagen naar haar eigen bestemming.

- **Niets wat ouder is, wordt verwijderd of gewijzigd**, bij de bron noch bij de bestemming. Een item dat ouder is dan 90 dagen blijft waar het is, en telt nooit als verwijderd.
- **De 90 dagen tellen vanaf de dag waarop u de migratie maakte.** Vanaf daar groeit de periode mee met nieuwe mail en wijzigingen; ze schuift nooit op. Wat gekopieerd is, blijft gekopieerd.
- **De pagina van de migratie toont een label, Laatste 90 dagen**, naast de fase. Zodra de 90 dagen erin staan, is de fase **Wordt bijgehouden**, en de regel eronder **Wordt bijgehouden voor de laatste 90 dagen.**
- **Een verwijdering in een agenda.** Zolang een migratie alleen de laatste 90 dagen kopieert, komt een afspraak die op een agendaserver is verwijderd alleen bij **Verwijderingen** als ze in de prullenbak van de bron staat. Na **Alles kopiëren** worden verwijderingen gemeld zoals bij elke migratie.
- **Geen overstap.** Een migratie van alleen de laatste 90 dagen stapt niet over: op haar pagina staat bij **Afronden** **Na Alles kopiëren**. Overstappen is voor een migratie die alles heeft gekopieerd.

## Alles kopiëren {#copy-everything}

Hebt u een bestemming gekozen, open dan de pagina van die migratie en druk op **Alles kopiëren**. Er wordt één keer gevraagd: **Ook alles wat ouder is kopiëren? Wat er staat, blijft.** Druk nog eens op **Alles kopiëren** om door te gaan.

- De migratie begint niet opnieuw. Haar volgende ronde kopieert de oudere items; wat al bij de bestemming staat, blijft zoals het is, en niets wordt twee keer gekopieerd.
- Daarna gaat ze verder zoals elke migratie van alles: ze wordt bijgehouden, geverifieerd, en stapt over bij **Afronden** zodra u zover bent.
- Terug kan niet. Een migratie van alles wordt geen migratie van alleen de laatste 90 dagen; begin daarvoor een nieuwe migratie.

## Op een zelf gehoste appliance {#self-hosted}

Op een zelf gehoste appliance stelt u een migratie van alleen de laatste 90 dagen in in haar mappingbestand:

```json
{ "recentOnly": { "days": 90 } }
```

De 90 dagen tellen vanaf het moment waarop de migratie voor het eerst wordt vastgelegd, en blijven staan na een herstart. Om alles te kopiëren, haalt u `recentOnly` uit het mappingbestand en herstart u: de volgende ronde kopieert de oudere items. `recentOnly` toevoegen aan een migratie die al loopt, wordt bij de volgende start geweigerd: begin dan een nieuwe migratie.
