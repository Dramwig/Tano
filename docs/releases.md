# Builds and releases

English | [中文](zh/releases.md) | [日本語](ja/releases.md) | [Deutsch](de/releases.md) | [Documentation](README.md)

For local release validation, manually created immutable tags and registry publication, see [Core release automation](release-automation.md) and [Core distribution](core-distribution.md).

Run `npm run desktop:build` to build a desktop package. The source build does not require an account or signing key and has no update endpoint configured by default. On Windows, the NSIS installer is written under `apps/client/src-tauri/target/release/bundle/nsis/`.

The public repository builds the complete local MIT product. The [Cloud Extension API](cloud-extension.md) lets the private `Tano-cloud` repository add the official online features. Official installers are built from that private overlay and published as assets on `Dramwig/Tano` Releases. GitHub's automatically generated source archives for those releases contain only this public MIT repository; they are not the source of the cloud-enabled binary.

Use `npm run version:set -- 0.2.0` to update this Core repository's npm workspaces, internal dependency ranges, npm/Cargo lockfiles, Tauri config and Rust crate versions together. `npm run version:check` verifies they agree and is part of `npm run check`. The separately released Python and Rust protocol helper packages keep their own versions. The official Product version is managed separately in the private `Tano-cloud` repository.

When shipped Core contents change, validate the new Core version locally, create its immutable `core-vX.Y.Z` tag manually, then publish all five npm packages and the Rust crate with the same version and clean source SHA. Publish `core-registry.json` on its Core GitHub Release without marking it latest, then pin that manifest in `Tano-cloud`. Pushing a tag starts no workflow. Product-only releases reuse the existing Core; adopting an already published Core requires no republishing. The private repository sets its own Product version, checks the pinned Core tag and commit, and builds the signed official installer. Its release workflow creates a Product `vA.B.C` tag here at the selected Core commit and publishes the installer, signature, checksums, and `latest.json` to that Product Release. Consecutive Product tags may point to the same Core commit when only the private overlay changes. The official app checks `https://github.com/Dramwig/Tano/releases/latest/download/latest.json`; the Product Release must be public for anonymous updates. The private workflow requires a cross-repository release token scoped to `Dramwig/Tano`. The private workflow supports Windows x64 and Linux x64, with optional signed macOS builds. First production use requires the platform credentials and native acceptance checks.

Distributions must include the [third-party notices](../THIRD_PARTY_NOTICES.md). Regenerate bundled notices after changing dependencies with `npm run notices:generate`.
