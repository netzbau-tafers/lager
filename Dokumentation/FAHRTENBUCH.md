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

## Export, geprüfte Löschung und Wiederherstellung

Im Fahrtenbuch steht „Export und Aufräumen“ bereit. Ein Fahrzeug (auch gelöscht) oder alle Fahrzeuge und ein Zeitraum von höchstens einem Jahr auswählen. Die Exportfunktionen prüfen dieselbe Fahrtenbuch-Berechtigung wie die Suche; nur der Master-Admin darf löschen und wiederherstellen. Empfohlen: die letzten zwölf Monate online behalten. Es gibt keine automatische Löschung historischer Fahrten.

„Export erstellen“ liest den gewählten Zeitraum in Seiten zu 100 Dokumenten, mit höchstens 20 000 Dokumenten je Export. Zunächst wird eine separate, verlustfreie Sicherung unter `fahrtenbuch_exporte/{id}/teile/{nr}` erstellt: gzip-komprimierte Dokumentfelder und genaue Versionszeitstempel, je Teil höchstens 100 Einträge und 500 KB unkomprimierter Inhalt. SHA-256-Prüfsummen werden beim Lesen, Löschen und Wiederherstellen geprüft. Erst wenn sämtliche Teile gespeichert wurden, ist eine Löschung möglich. Sicherungen sind direkt über Firestore-Regeln nicht lesbar oder schreibbar, sondern nur über die berechtigungsgeprüften Funktionen. Die gesicherten Originaldaten bleiben für Wiederherstellungen erhalten und werden nicht automatisch gelöscht; es wird keine endgültige Datenschutzlöschung behauptet. In aktuellen Verlaufssammlungen und Tagesbackups reduzieren sich Einträge; die komprimierten Sicherheitsexporte bleiben separat erhalten.

Exportformate:

- CSV mit Fahrzeug, Kennzeichen, Person, UID, Beginn/Ende in Schweizer Zeit, Kilometerstand und Bestätigungsstatus; Schutz vor Tabellenformeln in Textfeldern.
- Druckansicht mit wiederholten Tabellenköpfen und A4 quer. Im Browser „Drucken / Als PDF speichern“ wählen. Kein zusätzlicher PDF-Dienst erforderlich.
- JSON-Wiederherstellungsdatei mit vollständigen Firestore-Feldwerten und Dokumentpfaden als unabhängige lokale Sicherung. Die Oberfläche stellt aus der separaten serverseitigen Sicherung wieder her; ein JSON-Dateiimport ist nicht enthalten.

Vor dem Löschen muss der Benutzer die Dateien speichern, öffnen, prüfen und dies bestätigen. Der Browser kann nicht beweisen, dass ein Download oder Druckauftrag gespeichert wurde. Ein gestarteter Download löst keine Löschung aus. Die Vorschau zeigt Zeitraum, Fahrzeuge, Nutzungen/Tankungen und die maximale Anzahl löschbarer Einträge einschliesslich Übernahmevermerken.

„Gesicherte Einträge löschen“ arbeitet ausschliesslich mit unveränderten Versionen der gespeicherten Dokumente. Neue und geänderte Einträge, offene Nutzungen, ausstehende Bestätigungen, abgelehnte Nachträge und Nutzungen über die Zeitraumgrenze bleiben erhalten. Die aktuelle Fahrzeugbelegung wird auch unmittelbar vor jeder Löschtransaktion geprüft. Es werden keine pauschalen Zeitraumabfragen zum Löschen verwendet. Die Fahrzeugrevision wird für betroffene vorhandene Fahrzeuge aktualisiert. Tatsächlich gelöschte Pfade und Fortschritt werden atomar gespeichert; ein abgebrochener Vorgang lässt sich durch Laden derselben Sicherung fortsetzen. Jeder Löschteil hat höchstens 100 Quelldokumente.

„Sicherung wiederherstellen“ stellt ausschliesslich tatsächlich gelöschte, derzeit fehlende Dokumente wieder her, ohne vorhandene Einträge zu überschreiben. Neue `updatedAt`-Zeitstempel lassen das inkrementelle Backup die Einträge wieder übernehmen. Die letzten 30 fertigen oder begonnenen Exporte werden angeboten; Nicht-Master sehen nur ihre eigenen Exporte.

### Laufendes Sheets-Backup bereinigen

Die Löschtransaktion legt pro Teil eine Meldung unter `fahrtenbuch_loeschungen/{exportId}_{teil}` mit genau den gelöschten Pfaden an. Beide Apps-Script-Projekte verwenden die ergänzte gemeinsame Cache-Funktion. Beim nächsten Backup werden unbestätigte Meldungen gelesen und die Pfade gemeinsam mit `batchGet` gegen Firestore geprüft. Fehlende Einträge werden aus `fahrtenbuch_cache` entfernt; inzwischen wiederhergestellte oder neu vorhandene Dokumente werden erhalten bzw. aktualisiert. Erst nach erfolgreichem Schreiben und `SpreadsheetApp.flush` wird die Meldung mit einer Versionsvorbedingung bestätigt. Fehler bleiben sichtbar und Meldungen werden beim nächsten Lauf erneut geprüft. Ein Zeitbudget erlaubt, grosse Rückstände über mehrere Backups zu bearbeiten. Alte historische Daten werden dafür nicht vollständig aus Firestore geladen.

Bereits erzeugte Tagesbackups werden nicht nachträglich verändert. Sie bleiben als Sicherheit für die bestehende Aufbewahrungszeit von 14 Tagen bestehen und werden anschliessend durch die vorhandene Bereinigung in den Papierkorb verschoben. Neue Tagesbackups enthalten die aus dem aktuellen Cache bereinigten Fahrzeugdaten. Das separate komprimierte Exportarchiv ist absichtlich unabhängig von diesen rotierenden Backups. Eine Wiederherstellung eines alten Tagesbackups kann bewusst gelöschte Verläufe erneut einfügen; dafür die separate Export-Wiederherstellung verwenden.

### Bereitstellen

Die gemeinsame Helferdatei `apps-script/FahrtenbuchBackup.gs` in beiden bestehenden Apps-Script-Projekten aktualisieren; keinen weiteren täglichen Trigger anlegen. Die Änderung der bereitgestellten Backup-Verwaltungs-Web-App als neue Version derselben Bereitstellung veröffentlichen, damit auch manuelle Sicherungen denselben Helfer verwenden.

Nach dem Zusammenführen im Repository-Ordner mit `firebase.json`:

```bash
firebase deploy --only firestore:indexes,functions:lager-user-admin:lagerVehicleExportPrepare,functions:lager-user-admin:lagerVehicleExportList,functions:lager-user-admin:lagerVehicleExportRead,functions:lager-user-admin:lagerVehicleExportDelete,functions:lager-user-admin:lagerVehicleExportRestore --project netzbau-tafers
```

Die Indexdatei ergänzt den Index für eigene Exporte (`preparedBy`, `createdAt`) und nimmt die komprimierten `teile.payload`-Werte von der Indexierung aus. Bestehende, nur in Firebase vorhandene Indizes nicht löschen. Bestehende Intervallsuchindizes müssen fertig aufgebaut sein. Keine Änderungen an Firestore-Regeln nötig. Frontend-Dateien werden über GitHub Pages veröffentlicht. Das Öffnen lädt keine historischen Einträge; vollständige Verlaufsabfragen erfolgen nur ausdrücklich beim Export.

Validierung: `node --test functions-user-admin/vehicle-export.test.cjs`; im Ordner `tests`: `node --test logbook-backup-delete.cjs`, `node logbook-export-ui.cjs` und `node logbook-ui.cjs`. Die Tests arbeiten mit isolierten Transaktions-/API-Modellen und DOM-Testdaten, nicht mit Produktionsfahrten.

Die Cache-Ergänzung wurde am 10.10.2026 in beiden bestehenden Apps-Script-Projekten gespeichert und nach erneutem Öffnen mit der vorbereiteten Quelle verglichen. Die bestehende Backup-Verwaltungs-Web-App wurde als Version 13 veröffentlicht, mit unveränderter URL und weiterhin „Ausführen als zugreifender Nutzer“ / „Nur ich selbst“. Es wurden keine Produktionsfahrten gelöscht oder wiederhergestellt.
