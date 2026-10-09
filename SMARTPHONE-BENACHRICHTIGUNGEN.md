# Bobinen-Erinnerungen auf dem Smartphone

## Einrichten

1. Diesen Pull Request auf GitHub zusammenführen und warten, bis GitHub Pages die Änderungen veröffentlicht hat.
2. Das Repository erneut herunterladen (Code → Download ZIP) und entpacken oder im bestehenden Checkout `git pull` ausführen.
3. Im Terminal in den entpackten Ordner `lager-main` wechseln. Dort muss `firebase.json` liegen. Nicht nur den Unterordner `functions-user-admin` herunterladen.
4. Falls die Firebase CLI fehlt: `npm install -g firebase-tools`. Danach `firebase login` mit dem Konto ausführen, das das Projekt netzbau-tafers verwalten darf.
5. Abhängigkeiten installieren:

   ```sh
   cd functions-user-admin
   npm install
   cd ..
   ```

6. Nur die neuen Funktionen und die Regeln veröffentlichen:

   ```sh
   firebase deploy --only "firestore:rules,functions:lager-user-admin:lagerRegisterPush,functions:lager-user-admin:lagerUnregisterPush,functions:lager-user-admin:lagerTestPush,functions:lager-user-admin:lagerBobinenPushReminder" --project netzbau-tafers
   ```

   Eventuelle erforderliche Google-APIs aktiviert die CLI beim Deployment. Die bestehende Benutzerverwaltung wird mit diesem gezielten Befehl nicht neu bereitgestellt. Blaze und die FCM API V1 sind bereits aktiviert. Der öffentliche VAPID-Schlüssel ist eingebaut.

## Pro Smartphone aktivieren

- Android: Lagerseite im unterstützten Browser öffnen, anmelden und Profil → Benachrichtigungen aktivieren → Erlauben.
- iPhone/iPad ab 16.4: Seite in Safari öffnen → Teilen → Zum Home-Bildschirm hinzufügen. Über das neue Symbol öffnen, anmelden und im Profil aktivieren.
- Testnachricht senden. Zum Prüfen des Hintergrundempfangs danach auch die Seite verlassen/Sperrbildschirm prüfen.
- Jedes Gerät wird einzeln aktiviert. Ausschalten gilt für dieses Gerät. Die Registrierung bleibt beim Abmelden bestehen, damit Erinnerungen auch bei geschlossener Seite ankommen. Auf gemeinsam genutzten Geräten vor dem Kontowechsel im Profil ausschalten.
- Falls die Erlaubnis zuvor abgelehnt wurde: In Browser-/Systemeinstellungen erlauben, dann erneut aktivieren.

## Verhalten

Ohne aktive Smartphone-Registrierung erscheint weiterhin die Erinnerung auf der Seite. Mit aktiver Registrierung entfällt sie für diesen Benutzer auf allen Geräten. Werden alle Geräte im Profil ausgeschaltet oder laufen ihre Registrierungen ab, erscheint die Erinnerung auf der Seite wieder.

Alle 15 Minuten werden Bobinen im Status „In Gebrauch“ geprüft. Frühestens 48 Stunden nach dem Zeitstempel wird der zugeordnete Benutzer erinnert; die tatsächliche Zustellung hängt von Verbindung und Betriebssystem ab. Solange die Bobine in Gebrauch bleibt, frühestens alle weiteren 48 Stunden. „Gelesen und schliessen“ auf der Website verschiebt die nächste Erinnerung ebenfalls um 48 Stunden. Beim Zurückbuchen entfällt die Erinnerung. Bestehende Bobinen mit gültigem Zeitstempel und UID können sofort beim nächsten Lauf fällig sein; ohne diese Angaben wird keine Erinnerung gesendet.

Beim Antippen öffnet sich die verlinkte Bobine mit aufgeklappten Details. Suche zurücksetzen zeigt wieder alle Bobinen. Wenn sie bereits gelöscht wurde, erscheint ein entsprechender Hinweis. Die Anmeldung und vorhandene Zugriffsrechte bleiben erforderlich.

Push-Token und Versandzustände werden nur serverseitig gelesen/geschrieben. Kontosperren, gelöschte Konten und entzogene Kabel-Bearbeitungsrechte verhindern den Versand. Pro Browser-Token wird nur ein aktueller Benutzer gespeichert. Geräte ohne Registrierungserneuerung seit 90 Tagen werden nicht angeschrieben; beim Öffnen des Profils wird die Registrierung erneuert. Ungültige Token werden beim Versand gelöscht. Lease und Versandzeitpunkt verhindern parallele und zu häufige Erinnerungen; bei einem Prozessabbruch unmittelbar nach einem erfolgreichen Versand sind seltene Wiederholungen möglich. Bereits zugestellte oder in Übermittlung befindliche Nachrichten können nach einer Rückbuchung noch sichtbar sein.

## Prüfung und Kosten

Die Tests prüfen die 48-Stunden-Grenze, Bestätigungen, Rückbuchung, Kontosperren, Gerätezuordnung und Versandwiederholung. Ein echter Smartphone-Empfang muss nach Deployment über den Testbutton geprüft werden. Die Bereitstellung wurde nicht aus dieser Umgebung ausgeführt.

Firebase Cloud Messaging ist kostenlos; Firestore-Lesevorgänge, Cloud Functions und Cloud Scheduler werden nach den jeweiligen Tarifen/Freigrenzen abgerechnet. Es entsteht ein Scheduler-Job mit 96 Läufen pro Tag. Jeder Lauf liest die Bobinen „In Gebrauch“, bei fälligen Erinnerungen zusätzlich Konto-, Geräte- und Versanddaten. Firebase-Budgetwarnungen sind keine feste Kostensperre.
