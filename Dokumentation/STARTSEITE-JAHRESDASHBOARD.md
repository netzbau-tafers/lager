# Startseite – Jahresdashboard

Die Startseite (`home.html`) enthält vier Jahreskennzahlen, ein interaktives Monatsdiagramm und die zusätzlichen Jahreswerte. **Die zwei bisherigen Buttons oberhalb des Originalbilds bleiben die einzigen Schnellzugriffe.** Weihnachtsbild, Schnee, aktuelle Infos aus `home-infos.json` und bestehende Navigation bleiben unverändert.

## Datenquelle und Lesevorgänge

Die Startseite lädt keine Kabel-Logs und keine Baustellenlisten. Stattdessen ruft sie die Firebase Callable Function `lagerDashboardGet` auf und hält ihr Ergebnis im Browser 6 Stunden vor.

Die Function prüft zunächst **ein** Jahresdokument `dashboard_stats/{jahr}`. Dieses wird höchstens alle 12 Stunden neu berechnet und von allen Benutzern geteilt. Bei der Neuberechnung liest sie:
- Snapshots `kabel_report_snapshots` des laufenden Jahres (maximal zwölf Monatsdokumente; keine alten Logs).
- Zwei Firestore-Count-Aggregationen für aktive Baustellen (`status == aktiv`) und Baustellen mit Archivierungsdatum im laufenden Schweizer Kalenderjahr.

Danach speichert sie Meter, Buchungen, zwölf Monatswerte, Rekordmonat, Top-Kabeltyp und Baustellenzahlen in einem Dokument. Es gibt **keinen** neuen Cloud Scheduler, keine dauerhaften Listener und keine Änderungen der Archiv- oder Buchungslogik. Frühere Jahreswerte werden nicht automatisch geladen.

**Hinweis zur Genauigkeit:** Die Kabelzahlen entsprechen den vorhandenen Monats-Snapshots; der noch laufende Monat kann fehlen. Archivierte Baustellen werden nach `archiviertAm` gezählt (nicht nach Erstellungsjahr). Die Kennzahl «Baustellen insgesamt» zählt aktuelle aktive Baustellen und im laufenden Jahr archivierte Baustellen.

## Bereitstellung (nach Merge)

Die HTML-Datei wird via GitHub Pages verteilt. Für Live-Zahlen muss die neue Firebase Function einmal bereitgestellt werden. Im Cloud Shell im Projektverzeichnis:

```bash
cd ~/lager
git pull origin main
cd functions-user-admin
npm install
node --test dashboard-stats.test.cjs
cd ..
firebase deploy --only functions:lager-user-admin:lagerDashboardGet --project netzbau-tafers
```

Wichtig: `npm install` muss im Verzeichnis `functions-user-admin` ausgeführt werden. Sonst kann beim Deploy der Fehler «Couldn't find firebase-functions package» auftreten.

Beim ersten Aufruf nach dem Deploy wird das aktuelle Jahresdokument automatisch erzeugt. Wenn die Funktion nicht bereitgestellt wurde, zeigt die Startseite **keine erfundenen Beispielzahlen** an, sondern einen Hinweis. Bereits gespeicherte Browserwerte bleiben bei einem vorübergehenden Fehler sichtbar.

## Cache

- Browser: 6 Stunden pro Jahr und Gerät, inklusive beim erneuten Öffnen.
- Firestore: Get auf ein gemeinsames Jahresdokument pro serverseitigem Function-Aufruf.
- Neuberechnung aller Kennzahlen: ungefähr alle 12 Stunden, wenn ein Benutzer die Startseite lädt.
- Jahreswechsel: im Frontend automatisch auf das neue Jahr wechseln, ohne die Werte des Vorjahres laden zu müssen.
