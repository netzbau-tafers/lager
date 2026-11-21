# Firebase-Updates automatisch testen

## Automatisierung

GitHub Dependabot erstellt montags Pull Requests fuer neue npm-Versionen
in `functions-user-admin` und `tests`. Updates werden nicht automatisch
zusammengefuehrt oder zu Firebase deployed.

Bei jedem Pull Request startet `.github/workflows/firebase-regression.yml`
Tests mit Node.js 22 und Java 21:

- `npm ci` der Cloud Functions mit der vorhandenen `package-lock.json`
- Syntaxpruefung aller Cloud Functions
- `functions-user-admin/*.test.cjs`-Tests
- Benutzererstellung, Benutzerverwaltung, Passwort- und Push-Tests
- Fahrzeuge und Fahrtenbuch
- UI-Smoke-Tests
- Firestore Security Rules im Emulator
- Fahrzeugtransaktionen und Fahrtenbuch-Integration im Emulator

### Daten, Kosten und Sicherheit

Die automatischen Firestore-Tests verwenden das simulierte Projekt
`demo-lager-access`, **keine produktiven Firebase-Zugangsdaten**.
Im oeffentlichen Repository sind die Standard-GitHub-Actions-Runner
kostenlos. Der Emulator erzeugt keine Firestore-Produktionskosten.

Echte Cloud Functions, Cloud Scheduler, Push-Nachrichten, E-Mails,
Google-Cloud-IAM und produktive Benutzer werden nicht automatisch getestet.
Tests gegen einen echten Firebase-Projektstandort oder ein Deployment koennen
Kosten verursachen und benoetigen eine separate Freigabe.

### Update kontrollieren

1. Dependabot-PR auf GitHub oeffnen.
2. Unter **Checks** `Firebase regression tests` kontrollieren.
3. Fehler anhand der Job-Protokolle beheben.
4. Optional das Update in einem separaten Firebase-Testprojekt pruefen.
5. Nur nach erfolgreicher Pruefung den Pull Request zusammenfuehren.
6. Cloud Functions werden ausschliesslich durch einen separaten Deploy
   aktualisiert. Ein GitHub-Merge deployt sie nicht.

### Weitere Hinweise

Die Firebase-SDKs im Frontend werden aktuell ueber CDN-Skripte geladen.
Dependabot erfasst diese Skripte nicht. Ein Upgrade des Frontend-SDKs
benoetigt einen gesonderten Pull Request mit Browser-Tests.

Die Testpipeline erhoeht die Sicherheit von Abhaengigkeitsupdates, ersetzt
aber keinen realen Funktionstest gegen eine kontrollierte Firebase-Umgebung.

## Firebase SDK-Upgrade November 2026

Das Update in diesem Pull Request stellt folgende Versionen ein:

- Web-Compat-SDK/CDN: `9.23.0` -> `13.4.0`
- Cloud Functions SDK: `6.6.0` -> `7.4.0`
- Firebase Admin SDK: `13.10.0` -> `14.5.1`
- Test-Firebase-SDK / Rules Testing / CLI entsprechend aktualisiert
- Laufzeit unverändert: Node.js 22

### Risiko und Pruefgrenzen

- Browser: Anmeldung, Sitzungsfortsetzung, Passwortlinks, Firebase Storage,
  Firestore-Liveabfragen und HTTPS-Callable-Funktionen.
- Push: Messaging-Compat-Bibliothek **und Service Worker** muessen dieselbe
  SDK-Version laden. Nach dem Merge Service-Worker-Update und reale
  Push-Testnachrichten auf Android/Chrome durchspielen.
- Server: Admin 14 hat die veralteten Admin-Namespaces entfernt und nutzt
  neuere Firestore-Abhaengigkeiten. Die Anwendung importiert bereits
  `firebase-admin/app`, `firebase-admin/auth` usw. modular.
- Functions 7 entfernt `functions.config()`. Die Exportdatei verwendet
  die v2-APIs, ein Import-/Export-Smoke-Test laeuft automatisch.
- Verbleibendes Risiko: Emulator- und Browser-Smoke-Tests ersetzen
  keine Produktionstests fuer E-Mail, echte Push-Zustellung, Datenschutz,
  Benutzerrechte, Scheduler und Firebase-IAM.

### Rollout

1. Auf dem PR alle automatischen Tests **gruen** pruefen.
2. Aenderungen lokal oder auf Testdomain mit Testkonto pruefen.
3. Erst dann PR mit `main` zusammenfuehren. Die GitHub-Pages-Version
   wird damit aktualisiert; das kann echte Benutzer unmittelbar betreffen.
4. Backend-Cloud-Functions **nicht automatisch** bereitstellen. Erst mit
   `firebase deploy --only functions:lager-user-admin --project netzbau-tafers`
   nach separater Freigabe, und dabei die angebotenen Loeschungen und
   Cloud Scheduler Jobs genau kontrollieren.
5. Im Fehlerfall Web-SDK-Versionen ueber einen Git-Revert zuruecksetzen,
   Cloud-Functions-Versionen durch ein Deployment des vorherigen Commits.

Ein Deploy ist kein notwendiger Bestandteil des Pull Requests und kann
Google-Cloud-Kosten verursachen.
