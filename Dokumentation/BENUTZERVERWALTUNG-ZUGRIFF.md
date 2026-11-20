# Zugriff auf die Benutzerverwaltung

Pro Benutzer unter Berechtigungen → Benutzerverwaltung: Gesperrt, Nur ansehen oder Ansehen und bearbeiten.

Bearbeitungsrechte erlauben das Erstellen und Löschen anderer Konten, die Verwaltung ihrer Namen, Titel und Berechtigungen sowie das Erzeugen von Passwort-Zurücksetzungslinks für bestehende Konten. Eigene Zugriffsrechte und das Hauptadministrator-Konto sind geschützt: Nur der Hauptadministrator darf einen Passwort-Link für das Hauptadministrator-Konto erzeugen. Personen mit `Nur ansehen` können keine Passwort-Links erstellen. Ohne ausdrücklich vergebenes Recht bleibt der Zugriff gesperrt. Die Links werden angezeigt und müssen sicher an die betroffene Person weitergegeben werden; es erfolgt kein automatischer E-Mail-Versand.

Nach dem Zusammenführen Firestore-Regeln veröffentlichen und die Funktionen aktualisieren:

```sh
firebase deploy --only firestore:rules,functions:lager-user-admin:lagerListUsers,functions:lager-user-admin:lagerCreateUser,functions:lager-user-admin:lagerDeleteUser
```

GitHub Pages veröffentlicht die Oberfläche. Die Firebase-Bereitstellung muss separat erfolgen.

Für die neu erteilte Passwort-Reset-Berechtigung muss nach dem Merge die aktualisierte Cloud Function bereitgestellt werden:

```sh
firebase deploy --only functions:lager-user-admin:lagerPasswordResetLink --project netzbau-tafers
```
