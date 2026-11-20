# Zugriff auf die Benutzerverwaltung

Pro Benutzer unter Berechtigungen → Benutzerverwaltung: Gesperrt, Nur ansehen oder Ansehen und bearbeiten.

Bearbeitungsrechte erlauben das Erstellen, Verwalten und Löschen von Konten mit anderen Titeln als «Administrator» und «Hauptadministrator», einschliesslich Berechtigungen und Passwort-Zurücksetzungslinks. Für Konten mit Titel «Administrator» oder «Hauptadministrator» kann ausschliesslich der Hauptadministrator Änderungen, Löschungen oder Passwort-Resets vornehmen. Die Prüfung erfolgt zusätzlich serverseitig (Cloud Functions / Firestore-Regeln), auch bei bisher automatisch aus Rechten abgeleiteten Administrator-Titeln. Delegierte Bearbeiter können keine neuen Administratorkonten mit vollständig administratorgleichen Rechten anlegen. Eigene Zugriffsrechte bleiben geschützt. Personen mit `Nur ansehen` können keine Passwort-Links erstellen. Ohne ausdrücklich vergebenes Recht bleibt der Zugriff gesperrt. Die Links werden angezeigt und müssen sicher an die betroffene Person weitergegeben werden; es erfolgt kein automatischer E-Mail-Versand.

Nach dem Zusammenführen Firestore-Regeln veröffentlichen und die Funktionen aktualisieren:

```sh
firebase deploy --only firestore:rules,functions:lager-user-admin:lagerCreateUser,functions:lager-user-admin:lagerDeleteUser,functions:lager-user-admin:lagerPasswordResetLink --project netzbau-tafers
```

GitHub Pages veröffentlicht die Oberfläche. Die Firebase-Bereitstellung muss separat erfolgen.


Nach dem Zusammenführen zuerst die neuesten Änderungen mit `git pull origin main` abrufen. Der gezielte Deploy-Befehl oben ist für die neue Administratorsperre notwendig; ein Website-Update allein reicht nicht aus.
