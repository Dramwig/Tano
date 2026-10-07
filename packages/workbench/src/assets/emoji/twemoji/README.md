# Bundled workspace emoji

These 1914 unmodified SVGs come from [Twemoji 17.0.3](https://github.com/jdecked/twemoji/tree/v17.0.3).
Copyright Twitter, Inc. and other Twemoji contributors. Graphics are licensed
under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
The full license is retained in [LICENSE-GRAPHICS](LICENSE-GRAPHICS).

Tano rasterizes these sources to 64-pixel RGBA artwork and packs them into one
lossless [WebP sprite](sprite.webp), with 4-pixel transparent gutters per cell.
This rasterization and arrangement are the only modifications; artwork colors
are preserved. [sprite.json](sprite.json) records the grid, coordinates, and
output hash. The browser loads this single local image for the picker, category
directory, and workspace icons; the SVGs are generation sources only.
Resources work offline. Workspace settings continue to store Unicode emoji
strings. Unbundled custom symbols fall back to the system emoji font.
Localized names and search tags are described in the separately licensed
[metadata catalog](../emojibase/README.md).

Regenerate the catalog subset from the pinned release with
`node scripts/sync-workspace-emoji.mjs`, which also rebuilds the sprite.
To rebuild offline from retained SVGs, run `npm run emoji:generate`.
`npm run emoji:check` verifies source hashes, catalog coordinates, and the
generated image. Source archive and per-file SHA-256 hashes are recorded in
[manifest.json](manifest.json). No SVG source artwork is changed.
