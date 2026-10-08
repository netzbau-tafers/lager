# Archiv in getrennten Firestore-Sammlungen

Neue Sammlungen: `baustellen_archiv` und `baustellen_material_archiv`. IDs und alle Felder bleiben erhalten. Aktive/beendete Baustellen bleiben in `baustellen` und `baustellen_material`. Archivmaterial wird weiterhin erst beim Ausklappen oder Drucken live geladen.

## Einführung

1. Vollständiges Backup erstellen. In Google-Sheets-Backup und Restore beide neuen Sammlungen ergänzen, bevor Daten verschoben werden. Das Apps Script befindet sich nicht in diesem Repository und wurde deshalb nicht angepasst.
2. Wartungsfenster: Nutzer bitten, die Website während des Umzugs zu schliessen. Alte Seiten können nach Einführung nicht mehr direkt archivieren; danach neu laden.
3. Cloud Function bereitstellen: `firebase deploy --only functions:lager-user-admin:lagerArchiveBaustelle --project netzbau-tafers`.
4. Neue `firestore.rules` vollständig veröffentlichen. Dies geschieht nicht durch den GitHub-Merge.
5. Bestehende Archive verschieben: im Ordner `functions-user-admin` zunächst `npm ci`, danach mit berechtigten Application Default Credentials `node migrate-archive.cjs` (Vorschau), dann `node migrate-archive.cjs --execute`. Niemals Dienstkontoschlüssel in GitHub speichern. Der Umzug bricht bei einem Fehler ab; bereits verschobene Baustellen bleiben korrekt und werden bei einem erneuten Lauf übersprungen.
6. Website-Version zusammenführen und neu laden. Archiv prüfen und ein neues Backup erstellen.

## Sicherheit und Grenzen

Archivieren verschiebt Baustelle und Material serverseitig in einer Transaktion. Status, Kontosperre und das Recht „Beendete Baustellen verwalten“ werden geprüft. Bei Konflikten oder Fehlern bleibt die betreffende Baustelle unverändert. Archivierte Quelldaten dürfen nur beim administrativen Umzug durch das Master-Konto verschoben werden. Das Archiv-Schreibrecht erlaubt wie bisher Löschen; neue Archivdaten können nur serverseitig angelegt werden.

Maximal 248 Materialpositionen je Baustelle (maximal 499 Schreiboperationen einschliesslich Protokoll). Grössere Baustellen bleiben vollständig erhalten und erzeugen eine Fehlermeldung; sie benötigen vor dem Umzug eine gesonderte Lösung. Keine Wiederherstellung aus dem Archiv ergänzt: Diese Funktion gab es bisher nur für beendete Baustellen.

Keine Änderungen an der produktiven Firebase-Datenbank durch diesen PR. Bereitstellung und Datenumzug sind separate Schritte. Kein vollständiges Zurückrollen auf die alte Website nach dem Umzug, da diese die neuen Archiv-Sammlungen nicht liest.
