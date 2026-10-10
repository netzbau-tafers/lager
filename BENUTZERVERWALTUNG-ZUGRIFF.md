# Zugriff auf die Benutzerverwaltung

Pro Benutzer unter Berechtigungen → Benutzerverwaltung: Gesperrt, Nur ansehen oder Ansehen und bearbeiten.

Bearbeitungsrechte erlauben das Erstellen und Löschen anderer Konten sowie die Verwaltung ihrer Namen, Titel und Berechtigungen. Eigene Zugriffsrechte und das Hauptadministrator-Konto sind geschützt. Passwort-Links für bestehende fremde Konten bleiben dem Hauptadministrator vorbehalten. Ohne ausdrücklich vergebenes Recht bleibt der Zugriff gesperrt.

Nach dem Zusammenführen Firestore-Regeln veröffentlichen und die Funktionen aktualisieren:

```sh
firebase deploy --only firestore:rules,functions:lager-user-admin:lagerListUsers,functions:lager-user-admin:lagerCreateUser,functions:lager-user-admin:lagerDeleteUser
```

GitHub Pages veröffentlicht die Oberfläche. Die Firebase-Bereitstellung muss separat erfolgen.
