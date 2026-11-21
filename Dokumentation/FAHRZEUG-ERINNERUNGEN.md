# Tägliche Fahrzeug-Erinnerungen (ausser Betrieb seit November 2026)

Die beiden geplanten Cloud Functions `lagerVehiclePushReminderWeekdays` und `lagerVehiclePushReminderFriday` wurden aus den Firebase-Exports entfernt. Sie sollen **nicht erneut bereitgestellt** werden, um Cloud-Scheduler-Kosten zu vermeiden.

Die bisherige Umsetzung in `functions-user-admin/vehicle-reminder.cjs` bleibt zur späteren Wiederverwendung erhalten. Zuvor liefen die Erinnerungen Montag–Donnerstag um 17:10 Uhr sowie Freitag um 11:55 Uhr (Europe/Zurich) für Fahrzeuge in Gebrauch. Die Benachrichtigung für Bobinen sowie manuelle Fahrzeugaktionen und Benachrichtigungen für Fahrzeug-Nachträge bleiben unverändert.

Zur Wiederinbetriebnahme müsste ein geplanter Export ausdrücklich erneut in `functions-user-admin/index.js` eingefügt und deployed werden. Das bisherige Scheduler-Deployment-Kommando ist nicht mehr anzuwenden.
