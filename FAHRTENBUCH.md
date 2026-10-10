# Fahrtenbuch und sparsame Sicherung

Fahrtenbuch im Menü neben Fahrzeuge: Fahrzeug (auch gelöscht), Schweizer Datum,
optional Uhrzeit und Nutzungen/Tankungen auswählen. Es werden nur passende
Zeitintervalle abgefragt. Pro Anfrage höchstens 20 abgeschlossene Einträge plus
höchstens 20 offene Einträge, beim Nachladen keine erneuten offenen Einträge.
Die Uhrzeitsuche prüft Nutzungen zum Beginn der ausgewählten Minute;
Tankungen werden innerhalb dieser Minute gesucht. Tagesauswahl zeigt alle Tankungen.
Abgeschlossene Nutzungen sind am Ende exklusiv, damit Übergaben eindeutig bleiben.
Offene Nutzungen gelten ab Beginn als zugeordnet, sind aber ausdrücklich als
„Rückgabe nicht erfasst“ gekennzeichnet. Ausstehende Nachträge sind keine bestätigten
Fahrten. Abgelehnte Nachträge werden nicht angezeigt, bleiben zur Sicherung ihrer
Ablehnung erhalten. Keine Hintergrundabfrage des historischen Verlaufs.

Neue Einträge enthalten damalige Fahrzeugbezeichnung/Kennzeichen sowie Benutzername
und ID. Bei älteren Einträgen werden fehlende Fahrzeugdaten aus dem aktuellen oder
archivierten Fahrzeug ergänzt. Bereits gelöschte historische Namen lassen sich
nicht nachträglich rekonstruieren. Bisherige Einträge müssen nicht migriert werden.
Das Fahrtenbuch nutzt dieselben Lese-/Bearbeitungsberechtigungen wie Fahrzeuge;
der Server prüft Konto, Löschmarker und Fahrzeugzugriff bei jeder Suche.

## Bereitstellen nach Zusammenführen

Im Repository-Verzeichnis mit firebase.json:

```
firebase deploy --only firestore:indexes,functions:lager-user-admin:lagerVehicleLogbook,functions:lager-user-admin:lagerVehicleLogbookVehicles,functions:lager-user-admin:lagerVehicleAction,functions:lager-user-admin:lagerVehicleBackfill,functions:lager-user-admin:lagerVehicleBackfillReview --project netzbau-tafers
```

Die neuen Indizes müssen fertig aufgebaut sein. Die HTML/JS-Dateien werden über
GitHub Pages veröffentlicht. Beim Bereitstellen der Indexdatei keine bestehenden
nur in Firebase vorhandenen Indizes löschen; die Datei ergänzt die beiden hier
benötigten Indizes. Indexlesevorgänge, Berechtigungsprüfungen, Funktionsaufrufe
und leere Abfragen können zusätzlich Kosten verursachen; „20“ bezeichnet die
begrenzten Ergebnisdokumente, nicht sämtliche abrechenbaren Operationen.

## Google-Sheets-Sicherung

Die Ergänzung wurde direkt in die bestehenden Projekte „Lager Backup“ und
„Backup-Verwaltung – Lesen“ eingebaut. `apps-script/FahrtenbuchBackup.gs` enthält
den gemeinsam verwendeten Cache-Helfer; nicht zusätzlich als zweiten Trigger installieren.
Der vorhandene tägliche Trigger bleibt bestehen.

Die Hauptdatei enthält `fahrtenbuch_cache` und `fahrtenbuch_cache_status`.
Jedes Tagesbackup erhält weiterhin vollständige, wiederherstellbare Fahrzeugdaten
in den bisherigen sechs Spalten. Im Modus INKREMENTELL werden alte Unterdokumente
hierzu aus Sheets übernommen, neue/geänderte Verläufe über updatedAt und neue
Aktionen über createdAt gelesen. Fahrzeug-Stammdaten werden weiterhin aktuell gelesen.
Archiv und Nachtragsanfragen sind zusätzliche normale Backup-Bereiche.
Eine Firestore-Sperre schützt den gemeinsamen Cache zwischen beiden Script-Projekten.
Der Fortschrittsmarker wird erst nach erfolgreichem Schreiben aktualisiert.

Zuerst Firebase-Funktionen und Indizes bereitstellen, dann in der Backup-Verwaltung
„Änderungsbackup für Fahrzeuge aktivieren“ klicken. Vor Aktivierung wird einmal
vollständig gesichert. Bis dahin bleibt der sichere Modus VOLL aktiv.
Die Verwaltung zeigt den Fahrtenbuch-Verlauf als eigenen Suchbereich mit 40 Zeilen
pro Seite. Browsen liest nur Sheets; ein Live-Vergleich liest Firestore ausdrücklich
auf Knopfdruck. Sicherheitsbackups vor Wiederherstellungen lesen weiterhin den
vollständigen aktuellen Stand. Kein zusätzlicher täglicher Trigger ist nötig.

Der Cache bleibt in der Hauptdatei und wird von der 14-Tage-Bereinigung der
Tagesbackups nicht gelöscht. Direkte manuelle Löschungen oder Änderungen ohne
updatedAt werden nicht inkrementell erkannt. Nach solchen Eingriffen oder einer
Wiederherstellung einen vollständigen Cache-Lauf durchführen, bevor inkrementell
weitergesichert wird. Die Aufbewahrungsdauer personenbezogener Originaldaten
bewusst festlegen; dieser PR löscht keine historischen Fahrten automatisch.
