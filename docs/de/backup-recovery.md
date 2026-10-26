# Sicherung und Wiederherstellung

[English](../backup-recovery.md) | [中文](../zh/backup-recovery.md) | [日本語](../ja/backup-recovery.md) | Deutsch | [Dokumentationsübersicht](README.md)

Markdown-Dateien, Anhänge und das gesamte Verzeichnis `.tano/` gemeinsam sichern. Die UUID des Arbeitsbereichs, Datei-Identitäten, Objekte, Beziehungen und Regeln sind übertragbare Quelldaten und kein entbehrlicher Cache.

Tano erstellt keine automatischen Sicherungen von Arbeitsbereichen und bietet keinen Archivimport, Archivexport oder Wiederherstellungsablauf. Wird ein Arbeitsbereich außerhalb von Tano gelöscht, schlägt das Öffnen fehl. Tano erstellt weder den Ordner noch seinen Inhalt erneut. Zur Wiederherstellung dienen eigene Sicherungswerkzeuge, Versionsverwaltung oder der Papierkorb des Betriebssystems.

Bleibt der Arbeitsbereichsordner erhalten, während das gesamte Verzeichnis `.tano/` gelöscht wurde, wird der Ordner beim erneuten Öffnen als neuer Arbeitsbereich mit neuer UUID und neuen Datei-IDs initialisiert. Ein Hinweis erklärt, dass die ursprünglichen Metadaten gelöscht wurden, die alten Objektdaten verloren sind und das Projekt neu initialisiert wurde. Vorhandene Markdown-Dateien und Anhänge bleiben unverändert. Mit `.tano/` gelöschte Objekte, Beziehungen und Regeln werden nicht wiederhergestellt; der alte Index, Entwürfe und die alte Sitzung werden nicht übernommen. Teilweise fehlende oder beschädigte Identitätsmetadaten sowie abweichende Identitäten verhindern weiterhin das Öffnen. Eine bereits geöffnete Sitzung stoppt Schreibvorgänge, bis der Arbeitsbereich erneut geöffnet und initialisiert wurde.

Entwurfsjournale in den Anwendungsdaten erhalten ungespeicherte Änderungen nach einem Neustart der Anwendung; sie sind keine Sicherung des Arbeitsbereichs. Externe Dateiänderungen werden weiterhin durch Vergleich mit dem Ausgangs-Hash, Drei-Wege-Merge und Erhalt beider Fassungen bei Konflikten behandelt.
