# Neue Benutzer erstellen

In der Benutzerverwaltung öffnet der Master „Neuen Benutzer erstellen“, trägt E-Mail und Benutzername ein und wählt die Zugriffsrechte. Alle Rechte sind anfangs gesperrt. Nach dem Erstellen erscheint ein Passwort-Link zum Kopieren und Weitergeben. Der Benutzer legt sein Passwort selbst fest; es wird keine E-Mail automatisch versendet. Der Master bleibt angemeldet.

Die neue Callable `lagerCreateUser` läuft in `europe-west1`, Codebase `lager-user-admin`. Sie prüft den Master serverseitig, validiert die Rechte, erzeugt ein vorerst deaktiviertes Konto mit einem zufälligen, nicht ausgegebenen Passwort und speichert Profil und Rechte gemeinsam. Erst danach wird das Konto freigegeben. Fehler bei der Einrichtung führen zu einem Bereinigungsversuch; bei unvollständiger Bereinigung enthält die Meldung die UID zur Prüfung in Firebase. Bestehende Konten bei doppelter E-Mail werden nicht verändert. Fehler beim Erzeugen des Passwort-Links lassen das erfolgreich erstellte Konto bestehen; dann kann die Passwort-zurücksetzen-Funktion der Anmeldeseite verwendet werden.

Nach Zusammenführen des Pull Requests in Cloud Shell:

```bash
cd ~/lager-benutzerverwaltung
git switch main
git pull --ff-only origin main
npm ci --prefix functions-user-admin
firebase deploy --only functions:lager-user-admin:lagerCreateUser --project netzbau-tafers
```

Die Website nach erfolgreicher Veröffentlichung neu laden. Für diese Ergänzung sind keine zusätzlichen Änderungen der Firestore-Regeln notwendig; die zuvor eingeführten Regeln für Benutzerverwaltung und die aktuellen Rechte müssen bereits veröffentlicht sein. Die vorhandene Mailfunktion wird nicht geändert.

Prüfung: 14 Backend-Szenarien für Erstellen, Listen und Löschen sowie 21 DOM-Integrationsszenarien. Kein echtes Konto wurde im Test angelegt. Der live bereitgestellte Passwort-Link muss nach Deployment mit einem Testkonto geprüft werden.
