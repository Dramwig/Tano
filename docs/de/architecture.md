# Architektur

[English](../architecture.md) | [中文](../zh/architecture.md) | [日本語](../ja/architecture.md) | Deutsch | [Dokumentationsübersicht](README.md)

Die Vue-Arbeitsoberfläche verwendet über einen Dokumenten-Store einen `WorkspaceAdapter`. Der Desktop-Adapter ruft Tauri-IPC-Befehle auf, die `tano-native` implementiert. Die Browserdemo nutzt einen eigenen Adapter für den Browserspeicher. `configureWorkbench(pinia, runtime)` bindet eine Laufzeit an jede Instanz der Arbeitsoberfläche.

```text
Vue-Arbeitsoberfläche -> Dokumenten-Store -> WorkspaceAdapter -> Tauri IPC -> tano-native
```

Markdown-Dateien sind die maßgebliche Inhaltsquelle. Editor und Codec ohne Benutzeroberfläche nutzen dasselbe Markdown-Schema. Über `EditorExtension` übernimmt der Editor Funktionen des Hosts, sodass Bearbeitung, Speicherung und Übertragung getrennt bleiben.

Bei jedem Speichern wird die Datei mit einem Ausgangs-Hash verglichen. Unabhängige externe Änderungen können zusammengeführt werden; bei überlappenden Änderungen bleiben beide Fassungen zur Prüfung erhalten. Zwischen der letzten Hash-Prüfung und dem atomaren Ersetzen besteht ein kurzes Zeitfenster für Änderungen durch nicht koordinierte externe Prozesse.

Die Identität des Arbeitsbereichs ist unabhängig vom Dateipfad. UUID, kurze Datei-IDs und reservierte IDs werden mit `.tano/identities.json` übertragen. Objekte, Beziehungen und Regeln liegen ebenfalls unter `.tano/`. SQLite-Indizes, Entwürfe und Wiederherstellungszustand liegen in den Anwendungsdaten außerhalb des Arbeitsbereichs. Tano folgt keinen symbolischen Links, die aus dem ausgewählten Arbeitsbereich herausführen.
