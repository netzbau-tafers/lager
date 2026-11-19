# Vollständige Kontoliste und Konto löschen

Die Ergänzung liefert die Callables `lagerListUsers` und `lagerDeleteUser` in `europe-west1`. Beide prüfen die feste Master-Admin-UID. Die Liste enthält alle Firebase-Authentication-Konten, inklusive Konten ohne Firestore-Profil. Benutzernamen und Rechte werden mit den bestehenden Firestore-Profilen zusammengeführt. Ohne veröffentlichte Listenfunktion zeigt die Seite ausdrücklich nur eine unvollständige Profilübersicht.

## Veröffentlichung

Die Funktionen sind noch nicht in Firebase veröffentlicht. Der GitHub-Pull-Request alleine aktiviert sie nicht. Blaze-Tarif, Node.js 22 und die Firebase CLI werden benötigt. Die vorhandene Baustellen-Mailfunktion muss nicht ersetzt werden: diese Ergänzung verwendet eine eigene Functions-Codebase `lager-user-admin`.

1. Repository mit diesen Änderungen auf dem PC herunterladen oder auschecken.
2. Terminal im Repository-Ordner öffnen.
3. Abhängigkeiten installieren: `npm install --prefix functions-user-admin`.
4. Falls nötig die CLI installieren: `npm install -g firebase-tools`, dann `firebase login`.
5. Zuerst die **neuen** Regeln veröffentlichen: `firebase deploy --only firestore:rules --project netzbau-tafers`.
6. Nur die beiden neuen Funktionen veröffentlichen: `firebase deploy --only functions:lager-user-admin:lagerListUsers,functions:lager-user-admin:lagerDeleteUser --project netzbau-tafers`.
7. Die Website-Änderung zusammenführen und nach Veröffentlichung neu laden.

Kein allgemeines `firebase deploy --only functions` aus einem unvollständigen alten Functions-Projekt verwenden. Die gezielte Veröffentlichung oben enthält nur die neue Codebase und diese beiden Namen.

## Löschen

Ein roter Button „Konto löschen“ fragt nach dem Konto und verlangt die Eingabe `LÖSCHEN`. Die Serverfunktion benötigt zusätzlich die passende UID-Bestätigung. Der Master wird in der Oberfläche und im Backend ausgeschlossen.

Die Funktion legt zuerst einen serverseitigen Sperrmarker in `account_deletions/{uid}` an. Danach löscht sie das Authentication-Konto und anschliessend das Profil und die Zugriffsrechte in einem Firestore-Batch. Baustellen, Bobinen, Protokolle und Rankings werden nicht gelöscht oder umbenannt. Es werden keine echten Konten während der Tests gelöscht.

Authentication und Firestore können nicht gemeinsam atomar geändert werden. Bei einem Fehler bleibt der Sperrmarker erhalten; das Konto kann schon gelöscht bzw. für Firestore gesperrt sein. Ein erneuter Löschversuch vervollständigt die Bereinigung, auch wenn das Authentication-Konto bereits fehlt. Die Oberfläche meldet erst nach vollständigem Erfolg „Konto gelöscht“.

Die Marker bleiben erhalten, weil bereits ausgestellte ID-Tokens bis zu ihrem Ablauf gültig sein können. Die neuen Firestore-Regeln verweigern solchen UIDs auch danach das Lesen, Schreiben und Neuanlegen eines Profils. Marker dürfen durch Clients nicht geändert oder gelöscht werden. Sie enthalten UID, Löschzeit und Master-UID. Sie gehören in Backups und dürfen bei einer Wiederherstellung nicht entfernt werden; neu erstellte Konten sollten eine neue UID erhalten.

Dieser Schutz betrifft Firestore. Andere existierende Backend-Funktionen und Storage-Regeln müssen bei Bedarf ebenfalls die Sperrmarker bzw. widerrufene Tokens prüfen. Deren Quellcode ist in diesem Repository nicht enthalten.

## Tests

`node --test tests/user-admin.cjs` prüft Master-Schutz, fehlende Bestätigung, Fehlerfälle, Wiederholung, Reihenfolge und minimale Datenrückgabe. Die aktualisierten DOM- und Firestore-Emulator-Tests prüfen den Button und den Schutz bereits ausgestellter Tokens. Die Veröffentlichung und ein Test gegen das echte Firebase-Projekt sind nicht durchgeführt.
