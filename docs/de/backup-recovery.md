# Sicherung und Wiederherstellung

[English](../backup-recovery.md) | [中文](../zh/backup-recovery.md) | [日本語](../ja/backup-recovery.md) | Deutsch | [Dokumentationsübersicht](README.md)

Markdown-Dateien, Anhänge und das gesamte Verzeichnis `.tano/` gemeinsam sichern. Die UUID des Arbeitsbereichs, Datei-Identitäten, Objekte, Beziehungen und Regeln sind übertragbare Quelldaten und kein entbehrlicher Cache.

Der native Kern speichert Metadaten-Snapshots in den Anwendungsdaten. Geht die Identität eines bekannten Arbeitsbereichs verloren, werden normales Öffnen und Schreiben gestoppt. Statt eine neue UUID zu vergeben, die Wiederherstellung zunächst prüfen und dann bestätigen. Ein vollständiger Export enthält Dokumentinhalte und Anwendungsdaten; beim Import werden Byte-Digests geprüft und ein vorhandenes Ziel nicht überschrieben.

Auch Entwurfsjournale liegen in den Anwendungsdaten. Externe Dateiänderungen werden weiterhin durch Vergleich mit dem Ausgangs-Hash, Drei-Wege-Merge und Erhalt beider Fassungen bei Konflikten behandelt. Eine fehlgeschlagene Wiederherstellung lässt Daten und Protokolle bestehen. Zusätzlich zu lokalen Snapshots sollte eine unabhängige Sicherung auf einem anderen Gerät oder Medium aufbewahrt werden.
