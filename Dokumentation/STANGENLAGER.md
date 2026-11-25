# Stangenlager
Neue Berechtigung stangenlager: none / view / edit. Bestehende Konten bleiben bis zur expliziten Zuweisung gesperrt, Hauptadministrator ausgenommen. Titelvorlagen: Bearbeiten für Administrator, Baustellenverantwortlicher, Mitarbeiter und Techniker, Nur ansehen für Leseberechtigte.
## Deployment
Vor Merge Firestore-Regeln und Callable lagerCreateUser vom Branch veröffentlichen.
```sh
git fetch origin
git switch feature/stangenlager-berechtigungen
firebase deploy --only firestore:rules,functions:lager-user-admin:lagerCreateUser --project netzbau-tafers
```
Keine zusätzlichen Scheduler oder Storage-Dienste. Fotos werden clientseitig als JPEG auf maximal 240000 Zeichen komprimiert und im Firestore-Dokument gespeichert. Keine Beispieldaten. Nach Merge Berechtigungen zuweisen und auf Testkonto prüfen. Reservation und Änderungen erfolgen in Transaktionen mit Protokolleintrag. Für Techniker ohne Baustellenzugriff freie Baustelleneingabe. Protokoll enthält keine Materialbezeichnung, kein Foto und keine Baustellenangabe.