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
