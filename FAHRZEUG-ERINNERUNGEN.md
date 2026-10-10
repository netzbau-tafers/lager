# Tägliche Fahrzeug-Erinnerungen

Montag bis Donnerstag um 17:10 Uhr, Freitag um 11:55 Uhr (Europe/Zurich, inklusive Sommer-/Winterzeit). Keine Mindestnutzungsdauer. Nur aktuell in Gebrauch befindliche Fahrzeuge; Benachrichtigung an die eingetragene Person auf ihren bereits aktivierten Push-Geräten. Kein Versand am Wochenende. Antippen öffnet Fahrzeuge. Die Bobinen-Erinnerung bleibt unverändert.

Nach dem Zusammenführen im lokalen Repository mit firebase.json ausführen:

```sh
firebase deploy --only functions:lager-user-admin:lagerVehiclePushReminderWeekdays,functions:lager-user-admin:lagerVehiclePushReminderFriday --project netzbau-tafers
```

Die Firebase-Bereitstellung erstellt zwei Cloud-Scheduler-Zeitpläne. Die vorhandene Push-Aktivierung im Profil wird weiterverwendet. Zustellung hängt von Gerätekonnektivität und Android-Benachrichtigungseinstellungen ab.

Zur Vermeidung doppelter Ausführung werden pro Fahrzeug Tagesmarkierung und kurze Transaktionssperre in push_reminders gespeichert. Vor dem Versand werden Fahrzeugstatus, Nutzungssitzung und Gerätebesitzer erneut geprüft. Abgelaufene Geräte und gesperrte/gelöschte Konten werden übersprungen. Ungültige FCM-Tokens werden entfernt.
