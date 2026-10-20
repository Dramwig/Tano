<div align="center">

<img src="apps/client/brand/green/1024x1024.png" alt="Tano-Logo" width="88">

# Tano / 同页

### Menschen und Agenten arbeiten auf derselben Seite.

**Ein File-Native Workspace, in dem Menschen und KI-Agenten mit denselben echten Dateien arbeiten.**

[![MIT-Lizenz](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Mit Tauri 2](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![Node.js 24.12+](https://img.shields.io/badge/Node.js-24.12%2B-339933.svg)](https://nodejs.org/)

### 🌐 The Official Website: [tano.page](https://tano.page)

[English](README.md) | [中文](README_ZH.md) | [日本語](README_JA.md) | Deutsch

[Schnellstart](#schnellstart) · [Funktionen](#funktionen) · [Dokumentation](docs/de/README.md) · [Entwicklung](#entwicklung)

</div>

## Funktionen

- **Eigene Dateien behalten:** Markdown, PDF, Bilder, CSV, JSON, Code und Anhänge bleiben gewöhnliche Dateien im Arbeitsbereich. Übertragbare Daten wie Identitäten, Objekte, Beziehungen, Ansichten und Regeln liegen unter `.tano/`.
- **Eine Arbeitsoberfläche:** Notizen bearbeiten und durchsuchen, Objekte und Beziehungen ordnen und den Kalender nutzen.
- **Externe Änderungen schützen:** Beim Speichern wird der Ausgangs-Hash geprüft. Unabhängige Änderungen werden zusammengeführt; bei Konflikten bleiben beide Fassungen erhalten.
- **Lokaler Zugriff für Agenten:** Der stdio-MCP-Server kann Dokumente auflisten, lesen, erstellen und bedingt aktualisieren. Veraltete Schreibvorgänge werden abgewiesen.
- **Sicherung und Wiederherstellung:** Den Arbeitsbereich zusammen mit `.tano/` sichern und bei Bedarf Identitäten und Daten wiederherstellen.

Dieser Open-Source-Core funktioniert lokal ohne Benutzerkonto. Die Browserdemo nutzt den Browserspeicher und **liest oder schreibt keine Ordner auf dem Computer**. Zusammenarbeit in Echtzeit über das Netzwerk ist in diesem Quellcode-Build nicht enthalten.

## Offizielle Downloads

[GitHub Releases](https://github.com/Dramwig/Tano/releases) bietet die vollständigen offiziellen Installer, gebaut aus diesem MIT Core und einem privaten Cloud Overlay. Der Quellcode dieses Repositories und die automatisch erzeugten GitHub-Quellarchive enthalten nur den Core. Core-Tags heißen `core-vX.Y.Z`, Product-Releases `vA.B.C`; mehrere Product-Versionen können denselben Core-Commit verwenden.

## Schnellstart

Installiere [Node.js 24.12+](https://nodejs.org/) und npm. Für die Desktop-App sind außerdem [Rust stable](https://rustup.rs/) und die [Systemvoraussetzungen für Tauri 2](https://v2.tauri.app/start/prerequisites/) nötig.

```sh
npm ci
npm run desktop
```

Für eine reine Browservorschau `npm run dev` ausführen und `http://127.0.0.1:43841` öffnen. Die Desktop-Entwicklung nutzt `43842` und wählt bei Belegung automatisch einen freien Port.

## Dokumentation

| Leitfaden | Thema |
| --- | --- |
| [Dokumentationsübersicht](docs/de/README.md) | Einstieg in die Anleitungen |
| [Lokale Entwicklung](docs/de/local-development.md) | Voraussetzungen, Befehle und Anwendungsdaten |
| [Architektur](docs/de/architecture.md) | Editor, Speicherformat und Konfliktbehandlung |
| [Arbeiten mit Agenten](docs/de/agent-workflow.md) | Lokales MCP und bedingte Schreibvorgänge |
| [Sicherung und Wiederherstellung](docs/de/backup-recovery.md) | Übertragbare Daten, Snapshots und Wiederherstellung |
| [Builds und Releases](docs/de/releases.md) | Desktop-Builds und signierte Updates |
| [Lizenz und Umfang](docs/de/license.md) | MIT und Lizenzen von Drittanbietern |

## Entwicklung

```sh
npm run check
npm run test:native
npm run mcp:smoke
```

`npm run check` führt TypeScript-Prüfungen, Tests, Produktions-Builds, Linkprüfungen der Dokumentation und Prüfungen der Abhängigkeitsgrenzen aus. Plattformspezifische Einrichtung und Rust-Formatierung stehen unter [Lokale Entwicklung](docs/de/local-development.md).

Tano steht unter der [MIT-Lizenz](LICENSE). Für Komponenten von Drittanbietern gelten deren eigene Lizenzen; siehe die [Hinweise zu Drittanbietern](THIRD_PARTY_NOTICES.md).
