# Builds und Releases

[English](../releases.md) | [中文](../zh/releases.md) | [日本語](../ja/releases.md) | Deutsch | [Dokumentationsübersicht](README.md)

Mit `npm run desktop:build` ein Desktop-Paket erstellen. Ein Build aus dem Quellcode benötigt weder Benutzerkonto noch Signaturschlüssel und hat standardmäßig keinen Update-Endpunkt. Unter Windows liegt der NSIS-Installer unter `apps/client/src-tauri/target/release/bundle/nsis/`.

Aus dem öffentlichen Repository lässt sich das lokale MIT-Produkt bauen. Der offizielle Installer mit Online-Funktionen wird im privaten Repository `Tano-cloud` über die [Cloud Extension API](../cloud-extension.md) gebaut und als Release-Asset unter `Dramwig/Tano` veröffentlicht. Die von GitHub automatisch erzeugten Quellarchive enthalten nur den öffentlichen Core, nicht das private Cloud Overlay im offiziellen Binärpaket.

`npm run version:set -- 0.2.0` aktualisiert gemeinsam die npm-Workspaces des öffentlichen Core, interne Abhängigkeiten, npm/Cargo-Lockdateien, die Tauri-Konfiguration und Rust-Crate-Versionen. `npm run version:check` prüft ihre Übereinstimmung und ist Teil von `npm run check`. Die offizielle Product-Version wird unabhängig im privaten `Tano-cloud` verwaltet. Separat veröffentlichte Python/Rust-Protokollpakete behalten ebenfalls eigene Versionen.

Der Tag `core-vX.Y.Z` startet die Prüfung des öffentlichen Core. Danach wird dieser saubere Commit exportiert und in `Tano-cloud` fixiert. Der private Release-Workflow liest seine unabhängige Product-Version, erstellt den Product-Tag `vA.B.C` auf dem verwendeten Core-Commit und veröffentlicht signierte Installer für Windows x64 und Linux x64 im öffentlichen Release. macOS-Builds für beide Architekturen lassen sich nach Einrichtung der Signierung aktivieren. Vor der ersten Veröffentlichung sind Plattform-Zugangsdaten und native Abnahmetests erforderlich. Bei reinen Cloud-Änderungen können mehrere Product-Tags auf denselben Core-Commit zeigen. Core-Tags erzeugen selbst keine GitHub Releases. Die offizielle App prüft `https://github.com/Dramwig/Tano/releases/latest/download/latest.json`.

Distributionen müssen die [Hinweise zu Drittanbietern](../../THIRD_PARTY_NOTICES.md) enthalten. Nach Änderungen an Abhängigkeiten die gebündelten Hinweise mit `npm run notices:generate` neu erzeugen.
