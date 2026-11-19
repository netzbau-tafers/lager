# Fahrzeug- und Kranservice

## Verwendung
Im 3-Punkte-Menü eines Fahrzeugs „Service erfassen“ öffnen. Fahrzeugservice und optional Kranservice als nächste Fälligkeit eintragen. Leere Felder entfernen Termine. Nach einem durchgeführten Service den nächsten Termin eintragen.

Unter dem Kennzeichen erscheinen beide hinterlegten Termine mit verbleibenden Tagen. Bis 30 Tage vor der Fälligkeit ist die Anzeige neutral, ab 30 Tagen orange, ab dem Folgetag der Fälligkeit rot. Der Status enthält immer Text. Die Anzeige gilt auch für Meine Übersicht und aktualisiert sich bei offenem Fenster nach dem Tageswechsel.

Das bestehende Recht zum Erstellen/Bearbeiten/Löschen von Fahrzeugen erlaubt das Erfassen der Serviceinformationen. Der Server prüft die Berechtigung, gültige Datumswerte und die Fahrzeugrevision.

## Einrichtung
Der vorhandene Baustellen-Brevo-Versand ist nicht Bestandteil dieses Repositorys. Die neue Funktion verwendet Brevo separat und kann denselben vorhandenen API-Schlüssel sowie dieselbe bereits freigegebene Absenderadresse verwenden.

1. Pull Request zusammenführen und Repository lokal herunterladen/aktualisieren.
2. Im Repository-Hauptordner, der firebase.json enthält, arbeiten.
3. Falls BREVO_API_KEY bereits im Firebase Secret Manager besteht, dieses Secret wiederverwenden. Sonst mit folgendem Befehl hinterlegen (Schlüssel nur in der geschützten Eingabe einfügen):
   `firebase functions:secrets:set BREVO_API_KEY --project netzbau-tafers`
4. Die beiden Parameter in `functions-user-admin/.env.netzbau-tafers` lokal hinterlegen:
   ```dotenv
   VEHICLE_SERVICE_RECIPIENT=HIER_DIE_GEWÜNSCHTE_EMPFÄNGERADRESSE
   VEHICLE_SERVICE_SENDER=HIER_DIE_BEREITS_IN_BREVO_FREIGEGEBENE_ABSENDERADRESSE
   ```
   Diese lokale Datei nicht ins öffentliche Repository hochladen. Alternativ die Parameter beim ersten Deployment über die Firebase-Eingabe festlegen. Keine API-Schlüssel in .env oder Frontend-Dateien schreiben.
5. Die beiden Funktionen gezielt veröffentlichen:
   `firebase deploy --only functions:lager-user-admin:lagerVehicleService,functions:lager-user-admin:lagerVehicleServiceReminder --project netzbau-tafers`

GitHub Pages veröffentlicht nur das Frontend. Ohne Firebase-Deployment können die neuen Termine nicht gespeichert und keine Erinnerungen versendet werden. Der Firebase-Scheduler benötigt aktivierte Abrechnung wie die vorhandenen geplanten Funktionen. Keine neuen Firestore-Indizes oder Regeländerungen nötig.

## Erinnerungen und Versandstatus
Die Funktion prüft täglich um 07:00 Uhr Europe/Zurich die vorhandenen Fahrzeuge. Sie liest keine Nutzungs- oder Tankverläufe. Eine Erinnerung wird am ersten Prüflauf ab 30 Tagen vor dem Termin gesendet, separat für Fahrzeug- und Kranservice. Kurzfristige oder bereits überfällige Nachträge werden ebenfalls gemeldet; der Text nennt die tatsächlich verbleibenden Tage.

Je Fahrzeug, Serviceart und Datum wird der Status in `fahrzeug_service_mails` gespeichert. Erneute Prüfläufe versenden erfolgreich gemeldete Termine nicht nochmals. Neue Termine erhalten einen eigenen Status. Der gleiche bereits gemeldete Termin wird auch nach Entfernen und Wiedereintragen nicht erneut gemeldet.

- `sent`: Brevo hat die E-Mail angenommen; dies garantiert noch keine Zustellung ins Postfach.
- `retry`: Brevo hat die Anfrage ausdrücklich abgelehnt; ein weiterer Versuch erfolgt am nächsten Tag.
- `uncertain`: Netzwerkfehler oder unklarer Serverfehler; kein automatischer Neuversand, da die E-Mail bereits angenommen worden sein könnte.
- `sending`: Versand läuft; ein abgebrochener Lauf kann diesen Status hinterlassen.

Bei uncertain oder einem alten sending-Status zuerst die Brevo-Versandhistorie prüfen. Nur wenn dort kein Versand vorliegt, den Status in Firestore auf retry setzen. Es ist kein Clientzugriff auf diese serverseitigen Statusdokumente vorgesehen. Diese Sammlung ist kein Teil des bisherigen Sheets-Backups; die Servicetermine selbst sind normale Felder im bestehenden Fahrzeugdokument und werden bei dessen vollständiger Sicherung mitgesichert.

## Prüfung
`node --test functions-user-admin/vehicle-service.test.cjs functions-user-admin/vehicles.test.cjs`
Tests prüfen Datumsvalidierung, Schweizer Tagesgrenzen, Berechtigungen, konkurrierende Änderungen, 30-Tage-Grenze, getrennte Servicearten, wiederholte Prüfläufe und Fehlerfälle. Echter Brevo-Versand muss nach Konfiguration und Deployment geprüft werden.
