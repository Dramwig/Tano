# Sicherung und Wiederherstellung

[English](../backup-recovery.md) | [中文](../zh/backup-recovery.md) | [日本語](../ja/backup-recovery.md) | Deutsch | [Dokumentationsübersicht](README.md)

Markdown-Dateien, Anhänge und das gesamte Verzeichnis `.tano/` gemeinsam sichern. Die UUID des Arbeitsbereichs, Datei-Identitäten, Objekte, Beziehungen und Regeln sind übertragbare Quelldaten und kein entbehrlicher Cache.

Tano erstellt keine automatischen Sicherungen von Arbeitsbereichen und bietet keinen Archivimport, Archivexport oder Wiederherstellungsablauf. Wird ein Arbeitsbereich außerhalb von Tano gelöscht, schlägt das Öffnen fehl. Tano erstellt weder den Ordner noch seinen Inhalt erneut. Zur Wiederherstellung dienen eigene Sicherungswerkzeuge, Versionsverwaltung oder der Papierkorb des Betriebssystems.

Gehen die Identitätsmetadaten eines bestehenden Arbeitsbereichs verloren, werden Öffnen oder Schreiben gestoppt, um Datei-Identitäten nicht zu verändern. Entwurfsjournale in den Anwendungsdaten erhalten ungespeicherte Änderungen nach einem Neustart der Anwendung; sie sind keine Sicherung des Arbeitsbereichs. Externe Dateiänderungen werden weiterhin durch Vergleich mit dem Ausgangs-Hash, Drei-Wege-Merge und Erhalt beider Fassungen bei Konflikten behandelt.
