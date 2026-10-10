# Fahrzeuge bereitstellen

1. Pull Request zusammenführen und die aktuelle Version von `main` herunterladen. Den entpackten Ordner auf dem Desktop verwenden.
2. In CMD im Ordner `lager-main` die Abhängigkeiten installieren und die beiden neuen Funktionen plus die Benutzererstellung und Regeln veröffentlichen:

```cmd
cd functions-user-admin
npm install
cd ..
firebase deploy --only "firestore:rules,functions:lager-user-admin:lagerCreateVehicle,functions:lager-user-admin:lagerVehicleAction,functions:lager-user-admin:lagerCreateUser" --project netzbau-tafers
```

3. GitHub Pages veröffentlicht die Webseite automatisch. Seite danach neu laden; bei einer installierten Chrome-App diese schliessen und erneut öffnen.
4. In der Benutzerverwaltung für jede Person **Fahrzeuge** einstellen: gesperrt / nur ansehen / ansehen und bearbeiten. **Belegte Fahrzeuge übernehmen** und **Neue Fahrzeuge hinzufügen** separat erlauben oder sperren. Für Übernahmen ist zusätzlich Bearbeitungsrecht für Fahrzeuge erforderlich. Für das Hinzufügen ist zusätzlich mindestens Leserecht für Fahrzeuge erforderlich. Bestehende Benutzer erhalten diesen neuen Bereich erst nach Zuweisung; der Hauptadministrator hat Zugriff.

Pro Person kann nur ein Fahrzeug gleichzeitig in Gebrauch sein. Ein weiteres Starten, Übernehmen oder eine Ganztagsnutzung ist erst nach der Freigabe möglich. Die Sperre wird atomar auf dem Server geprüft.

## Bedienung

- **In Gebrauch** trägt die angemeldete Person ein. **Fahrzeug frei** schliesst ihre Nutzung mit Start- und Endzeit ab.
- **Für mich übernehmen** beendet die Nutzung einer anderen Person und startet die eigene. Beide Nutzungszeiträume und die Übergabe bleiben im Verlauf sichtbar.
- **Tanken** verlangt den aktuellen Kilometerstand. Er darf nicht kleiner als der bisherige Stand sein und erscheint gross auf der Fahrzeugkarte.
- **Fahrzeug den ganzen Tag gebraucht** trägt eine abgeschlossene Nutzung nach. Der erste Eintrag eines Tages beginnt um 07:00 in der Zeitzone Europe/Zurich. Weitere beginnen beim Ende der letzten protokollierten Nutzung. Vor 07:00 und bei einer laufenden Nutzung ist kein Eintrag möglich.
- Der Stern speichert einen persönlichen Favoriten. Favoriten erscheinen mit aktueller Belegung und Kilometerstand in **Meine Übersicht**. Die gleichen Bedienbuttons stehen direkt bei den Favoriten in Meine Übersicht zur Verfügung; der Fahrzeugbereich muss dafür nicht geöffnet werden.
- Der Verlauf wird beim Öffnen automatisch aktualisiert. Zunächst erscheinen die neuesten 30 Einträge; ältere lassen sich nachladen.

## Prüfung

`node --test functions-user-admin/vehicles.test.cjs` prüft Zeitgrenzen, Rechte, Übernahmen, Protokolle, Wiederholungen und konkurrierende Aktionen mit einem Transaktionsmodell. Im Ordner `tests` nach `npm install` prüfen `npm run test:rules`, `npm run test:vehicle-transactions` und `node vehicles-ui.cjs` die Regeln, echte Transaktionen und Bedienabläufe mit Testdaten. Für den Produktionstest zwei Benutzer mit Fahrzeugrechten verwenden: Fahrzeug gleichzeitig übernehmen/starten, Freigabe, Tanken und Favoriten prüfen. Keine Produktionsdaten für automatisierte Tests verwenden.

Die bestehende Push- und Passwort-Link-Funktion bleibt erhalten. Fahrzeuge sind nicht Bestandteil der bisherigen Kabel-/Baustellen-Backup-Funktion.

## Verlauf sparsam laden

Die Fahrzeugübersicht lädt keine Verlaufsdokumente. Erst beim Öffnen des Nutzungs- und Tankverlaufs werden die neuesten 20 Einträge des ausgewählten Fahrzeugs abgerufen. „Weitere 20 Einträge laden“ verwendet den letzten Dokument-Snapshot als Cursor (`startAfter`) und liest nur die nächste Seite. Es gibt keinen separaten Live-Listener auf dem Verlauf.

Geladene Seiten bleiben pro Fahrzeug und Monatsauswahl während der Sitzung erhalten, auch nach dem Zuklappen. Der Monatsfilter fragt `createdAt` direkt in Firestore ab; Monatsgrenzen gelten in Europe/Zurich. „Aktualisieren“ setzt die gewählte Abfrage auf die neuesten 20 Einträge zurück. Ändert sich die Fahrzeugrevision, wird der zwischengespeicherte Verlauf verworfen: Ein geöffneter Verlauf lädt die erste Seite neu, ein geschlossener erst beim nächsten Öffnen. Bei Benutzerwechsel wird der gesamte Verlaufsspeicher geleert.

Die vollständige Historie bleibt gespeichert. Bei exakt 20 Ergebnissen kann „Weitere laden“ noch eine leere letzte Seite abrufen. Die Änderung benötigt keine neue Cloud Function und keine Änderung der Firestore-Regeln.

# Nutzung für eine Person nachtragen

Mit dem Fahrzeugrecht „Ansehen und bearbeiten“ kann über „Nutzung für eine Person nachtragen“ eine aktive Person mit Fahrzeugzugriff ausgewählt werden. Die Auswahl enthält nur Benutzer-ID und Anzeigename; die Profil- und Benutzerverwaltung bleiben geschützt.

Datum/Uhrzeit von–bis gelten in `Europe/Zurich`. „Ganzer Tag“ verwendet am ausgewählten Datum 07:00–17:15 Uhr, auch im Winter. Nur abgeschlossene Zeiträume sind zulässig. Ungültige und bei der Zeitumstellung mehrdeutige Uhrzeiten werden abgelehnt. Ein Nachtrag ändert keine laufende Belegung und keine Nutzungs-Sperre.

Eigene Nachträge werden direkt als „Bestätigt“ gespeichert und lösen keine Benachrichtigung oder Bestätigungsanfrage aus. Bei Nachträgen für andere Personen erscheint der Eintrag im Verlauf als „Bestätigung ausstehend“. Nur die ausgewählte Person kann im Bereich Fahrzeuge „Bestätigen“ oder „Ablehnen“ drücken, auch mit Leserecht für Fahrzeuge. Bei Bestätigung steht im Verlauf „Bestätigt“. Bei Ablehnung wird der Verlaufseintrag entfernt; die Entscheidung bleibt als serverseitiger Nachweis in `fahrzeug_nachtraege` erhalten. Ohne Antwort bleibt die Anfrage ausstehend; es gibt keine automatische Bestätigung oder Ablaufzeit.

Ein Firestore-Trigger sendet die Fahrzeugbezeichnung, das Kennzeichen, den Zeitraum und den Namen der eintragenden Person an die bereits aktivierten Push-Geräte der ausgewählten Person. Antippen öffnet die Bestätigungsanfragen; eine erforderliche Anmeldung führt anschliessend dorthin zurück. Ohne erreichbares/aktiviertes Push-Gerät bleibt die Anfrage im Bereich Fahrzeuge sichtbar. Push-Zustellung ist kein Nachweis einer Bestätigung.

Nach dem Zusammenführen im Repository mit `firebase.json` ausführen:

```bash
firebase deploy --only "firestore:rules,functions:lager-user-admin:lagerVehicleBackfillUsers,functions:lager-user-admin:lagerVehicleBackfill,functions:lager-user-admin:lagerVehicleBackfillReview,functions:lager-user-admin:lagerVehicleBackfillNotify" --project netzbau-tafers
```

Neue Collection: `fahrzeug_nachtraege`. Lesbar nur für die jeweilige empfangende Person mit Fahrzeugzugriff; alle Schreibzugriffe laufen über Cloud Functions. Die Collection sollte im bestehenden Backup ergänzt werden. Ablehnung und Bestätigung wirken durch eine Fahrzeugrevision auch auf geöffnete Verlaufansichten, ohne den vollständigen Verlauf live zu lesen. Anfragen lassen sich nach einer Fahrzeuglöschung weiterhin entscheiden, ohne das Fahrzeug wiederherzustellen.

Prüfung:

```bash
node --test functions-user-admin/vehicle-backfill.test.cjs
```

## Benachrichtigung direkt öffnen

Nachtragsbenachrichtigungen öffnen `fahrzeug-bestaetigung.html?nachtrag=…`. Die Seite lädt nur die im Link bezeichnete Anfrage und zeigt Fahrzeug, Kennzeichen, Person, Zeitraum sowie Bestätigen/Ablehnen. Bereits entschiedene Anfragen zeigen ihren Status. Nach einer nötigen Anmeldung führt der Link zu derselben Anfrage zurück. Die bisherigen Fahrzeugrechte und die Auswahl aktiver Benutzer mit Fahrzeugzugriff bleiben unverändert.

Der Service Worker verarbeitet Vordergrundnachrichten sowie Firebase-Hintergrundnachrichten mit `data.url`, `fcmOptions.link` oder `fcm_options.link`. Vorhandene Benachrichtigungen mit `fahrzeuge.html?nachtrag=…` werden ebenfalls zur Einzelbestätigung weitergeleitet. Die Bobinenlinks bleiben unverändert.

Nach dem Zusammenführen muss nur der Benachrichtigungstrigger aktualisiert werden:

```bash
firebase deploy --only functions:lager-user-admin:lagerVehicleBackfillNotify --project netzbau-tafers
```

Danach die App neu öffnen und einmal das Profil öffnen, damit sich der Benachrichtigungsdienst aktualisiert. Anschliessend mit einer neuen Nachtragsbenachrichtigung testen.

```bash
node --test tests/vehicle-notification-link.test.cjs functions-user-admin/vehicle-backfill.test.cjs
```


