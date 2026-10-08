# Benutzerverwaltung einrichten

Für die vollständige Kontoliste und das Löschen von Anmeldekonten siehe `KONTEN-VERWALTUNG.md`. Dazu sind die neue Functions-Codebase und die aktualisierten Regeln zu veröffentlichen.

1. Den Pull Request prüfen. Die Datei `firestore.rules` enthält den vollständigen Ersatz für die derzeit veröffentlichten Regeln.
2. Diese Regeln unter Firebase → Firestore Database → Regeln einfügen und veröffentlichen. Diese Änderung geschieht nicht automatisch durch GitHub Pages.
3. Den Pull Request zusammenführen und nach der GitHub-Pages-Veröffentlichung die Seite neu laden.
4. Als Master-Admin `pmyu29TlC3QM7JIysmy2EmiHSWW2` im Menü „Benutzerverwaltung“ öffnen.
5. Pro Benutzer Namen und Rechte einstellen und „Änderungen speichern“ drücken.
6. Die neue Collection `user_access` in bestehende Backups und Wiederherstellungen aufnehmen. Ohne diese Collection gelten nach einer Wiederherstellung wieder die bisherigen Standardrechte.

## Verhalten

- Startseite, Hilfe, Datenschutz, Profil und Meine Übersicht bleiben für angemeldete Benutzer zugänglich. Die Übersicht lädt nur freigegebene Bereiche.
- Ohne Dokument in `user_access` gelten die bisherigen Rollen: eingeschränkte Konten sehen kein Baustellenmaterial; Archiv/Protokoll bleiben den bisherigen Administratoren vorbehalten. Kabellager und Spiel bleiben bearbeitbar. Die bestehenden Administratoren können Kabel-Report-Snapshots schreiben; bisher war der manuelle Button nur für den Master sichtbar.
- Sobald Rechte gespeichert werden, gelten exakt die ausgewählten Werte. Bearbeitungsrechte umfassen Erstellen, Bearbeiten und Löschen im jeweiligen Bereich. Explizite Bearbeitungsrechte erlauben auch Verwaltungsaktionen, die vorher Administratoren vorbehalten waren. Protokolle bleiben unveränderbar.
- Der Master behält alle Rechte; eigene Zugriffsrechte können nicht gespeichert oder gelöscht werden. Andere Administratoren können keine Benutzerprofile oder Zugriffsrechte verwalten.
- Namen und Rechte werden gemeinsam in einem Batch gespeichert. Benutzer dürfen ihre eigenen Rechte nicht schreiben. Der eigene Benutzername kann wie bisher unter „Profil“ geändert werden.
- Offene Seiten beobachten das eigene Berechtigungsdokument. Bei einer Änderung werden sie neu geladen bzw. zur Startseite umgeleitet. Firestore verweigert unerlaubte Datenzugriffe unabhängig vom Menü.
- Namen werden aus dem eigenen Profil beobachtet und für neue Aktionen übernommen. Historische Logs, Bobinen-Namensfelder und Rankings werden nicht umgeschrieben.
- Mit der veröffentlichten Funktion `lagerListUsers` zeigt die Liste alle Firebase-Authentication-Konten. Ohne diese Funktion zeigt sie ausdrücklich nur Firestore-Benutzerprofile. Bestehende Konten ohne Profil erhalten beim nächsten Aufruf der neuen Version ein Profil. Mit der Listenfunktion werden bereits gelöschte Authentication-Konten nicht angezeigt.
- „Letzte Aktivität“ ist der letzte Seitenaufruf der neuen Version. Es gibt keine Live-Anwesenheitserkennung und keinen laufenden Heartbeat.

## Gemeinsame Daten

Baustellen und Archiv verwenden getrennte Collections. Baustellenrechte erlauben das Lesen von `baustellen` und `baustellen_material`, Archivrechte von `baustellen_archiv` und `baustellen_material_archiv`. Materialvorlagen bleiben gemeinsame Quelldaten. Die Einführung und Migration bestehender Archive ist in `ARCHIV-TRENNUNG.md` beschrieben.

Der Kabel Report berechnet Werte aus `logs`. Wer den Report lesen darf, kann deshalb auch die zugrunde liegenden Protokolldaten lesen, selbst wenn die Protokollseite gesperrt ist. Eine strengere Trennung braucht separate Report-Daten bzw. gefilterte Abfragen und weitere Änderungen an der Datenstruktur.

„Gespart“ steuert beide vorhandenen Firestore-Collections. Im aktuellen Repository gibt es keine `gespart.html`; eine andere/ältere Kopie müsste ebenfalls auf `LagerAccess` umgestellt werden, bevor sie passende Menü- und Lesemodus-Anzeigen erhält.

## Validierung

- Syntaxprüfung aller JavaScript-Dateien und Inline-Scripts.
- DOM-Integrationstests mit simuliertem Firebase: Master-Verwaltung, Sperre anderer Benutzer, Lesemodus inklusive dynamischer Bobinen-Aktionen, Namensspeicherung und erlaubte Abfragen.
- Firestore-Emulator-Tests: Master-Rechte, Schutz vor Rechteerhöhung, Profilschutz, Lesemodus, Sperren, Bearbeitungsrechte und unveränderbare Logs.
- Eine visuelle Browserprüfung wurde nicht ausgeführt, weil der Chromium-Download in dieser Umgebung fehlschlug. Die mobile Oberfläche verwendet ein einspaltiges Formular unter 680 px.

Tests reproduzieren: im Verzeichnis `tests` `npm install` ausführen, dann `npm run test:ui` und `npm run test:rules`. Für den Emulator ist Java erforderlich (firebase-tools 14 unterstützt Java 17).

Nach Veröffentlichung mit einem Testkonto die drei Stufen prüfen. Alte bereits geöffnete Versionen kennen die neuen Rechte noch nicht und können nach einer Sperre Berechtigungsfehler zeigen. Ein erneutes Laden übernimmt die neue Oberfläche.

