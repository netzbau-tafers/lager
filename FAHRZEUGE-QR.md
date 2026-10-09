# QR-Codes für Fahrzeuge

Nach dem Zusammenführen und dem GitHub-Pages-Deployment steht auf jeder Fahrzeugkarte das aufklappbare Fahrzeugmenü mit „QR-Code herunterladen“ bereit. Die SVG-Bilddatei lässt sich ohne Qualitätsverlust ausdrucken. QR-Codes werden lokal erzeugt, ohne externen QR-Dienst und ohne zusätzliche Firestore-Dokumente.

Die Fahrzeug-ID bleibt gleich; der Code muss bei Statuswechsel oder Umbenennung nicht ersetzt werden. Er enthält einen Link zu `fahrzeuge.html?fahrzeug=…&scan=1`. Derselbe Link kann auf einen NFC-Tag geschrieben werden.

Für diese Ergänzung ist kein Firebase-Deployment nötig. Die vorhandene Fahrzeugfunktion wird weiterverwendet. Der Kilometerstand wird ausschliesslich beim Tanken erfasst.

## Scan-Verhalten

- Frei: automatische Buchung auf die angemeldete Person.
- Eigene Belegung: Rückgabe-Dialog mit Bestätigung ohne Kilometerabfrage.
- Fremde Belegung: Hinweis ohne automatische Übernahme.
- Bereits anderes Fahrzeug belegt: Hinweis ohne weitere Buchung.
- Nur Leserechte: keine Buchung.
- Abgemeldet: Anmeldung auf der Startseite, danach Rückkehr zum gescannten Fahrzeug.

Der Scan-Parameter wird vor der Aktion aus der Adresse entfernt. Live-Snapshots und Neuladen derselben geöffneten Seite lösen daher keine weitere Aktion aus. Für einen neuen Vorgang muss der QR-Code erneut gescannt werden. Server-Revisionen und Anfrage-IDs schützen weiterhin gegen konkurrierende und wiederholte Schreibvorgänge.

## Prüfung

```sh
node --test functions-user-admin/vehicles.test.cjs
cd tests
node vehicles-ui.cjs
```

14 Server-Szenarien und 16 DOM-Szenarien: Rechte, konkurrierende Buchungen, Scan einmalig, Rückgabe ohne Kilometerabfrage, fremde Belegung, Ein-Fahrzeug-Grenze und QR-Download.
