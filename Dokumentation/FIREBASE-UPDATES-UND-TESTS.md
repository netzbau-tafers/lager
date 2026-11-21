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
