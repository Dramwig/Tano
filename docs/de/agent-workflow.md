# Arbeiten mit Agenten

[English](../agent-workflow.md) | [中文](../zh/agent-workflow.md) | [日本語](../ja/agent-workflow.md) | Deutsch | [Dokumentationsübersicht](README.md)

Zuerst einen Arbeitsbereichsordner in der Desktop-App öffnen. Agenten können dessen Markdown-Dateien direkt bearbeiten oder den lokalen stdio-MCP-Server von Tano nutzen, um Dokumente aufzulisten, zu lesen, zu erstellen und bedingt zu aktualisieren.

```sh
npm run mcp:build
node apps/mcp/dist/tano-mcp.cjs --workspace /path/to/notes --data-dir /path/to/tano-app-data
```

Der MCP-Server benötigt Node.js 24.12+. Die Pfade für Arbeitsbereich und Anwendungsdaten stehen im MCP-Bereich der Desktop-App. Die Anwendungsdaten müssen außerhalb des Arbeitsbereichs liegen; Desktop-App und MCP-Server sollten dasselbe Datenverzeichnis nutzen.

Ein Update übergibt den SHA-256-Hash aus einem vorherigen Lesevorgang. Hat sich die Datei geändert, wird der veraltete Schreibvorgang abgewiesen. Aktivitätsprotokolle liegen in den Anwendungsdaten, der Inhalt bleibt in Markdown-Dateien. Ein vom Client angegebener Name ist nur eine Bezeichnung und kein Nachweis für die Identität eines Menschen oder Modells. Der stdio-Server führt keine entfernten Befehle aus und bietet keine Zusammenarbeit in Echtzeit über das Netzwerk.
