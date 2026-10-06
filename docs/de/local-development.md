# Lokale Entwicklung

[English](../local-development.md) | [中文](../zh/local-development.md) | [日本語](../ja/local-development.md) | Deutsch | [Dokumentationsübersicht](README.md)

Node.js 24.12+, npm und Rust stable installieren. Für die Desktop-Entwicklung gelten außerdem die [Systemvoraussetzungen für Tauri 2](https://v2.tauri.app/start/prerequisites/) der jeweiligen Plattform. Unter Windows gehören C++ Build Tools, Windows SDK und WebView2 dazu; `powershell -File scripts/check-desktop.ps1` prüft die lokale Umgebung.

Im Stammverzeichnis des Repositories ausführen:

```sh
npm ci
npm run desktop
```

Für die Browserdemo `npm run dev` ausführen und `http://127.0.0.1:43841` öffnen. Sie speichert Daten im Browser und greift nicht auf einen echten Arbeitsbereichsordner zu. `npm run desktop` und `local-desktop.bat` bevorzugen Port 43842. Ist dieser belegt, wählen sie automatisch einen freien Port und zeigen die tatsächliche Adresse an. Beide Befehle können gleichzeitig laufen; Port 43841 muss beim Start der Browserdemo frei sein.

Die Desktop-App hat die Kennung `app.tano.local`. Unter Windows liegen die Anwendungsdaten normalerweise unter `%APPDATA%/app.tano.local`; für Agenten ist der im MCP-Bereich von Tano angezeigte Pfad maßgeblich. Markdown und `.tano/` sind übertragbar, während Indizes, Entwürfe und Sitzungszustand in den Anwendungsdaten liegen.

Nach Installation der Abhängigkeiten funktionieren lokales Bearbeiten, Suchen und Speichern von Entwürfen offline. Externe Bilder und eine ausdrücklich konfigurierte Update-Prüfung benötigen weiterhin eine Netzwerkverbindung. Ein Build aus dem Quellcode hat standardmäßig keinen Update-Endpunkt.

Vor dem Einreichen von Änderungen `npm run check`, `npm run test:native` und `npm run mcp:smoke` ausführen. Nach Änderungen am Rust-Code außerdem:

```sh
cargo fmt --manifest-path crates/tano-native/Cargo.toml
cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml
```
