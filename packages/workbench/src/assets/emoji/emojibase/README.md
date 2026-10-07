# Workspace emoji metadata

The localized names, search tags, and Unicode ordering in [catalog.json](catalog.json)
are derived from Emojibase Data 17.0.0 (Simplified Chinese and English).
Copyright (c) 2017-2019 Miles Johnson. Licensed under [MIT](LICENSE).
Source: [Emojibase](https://github.com/milesj/emojibase).

Tano selects base emoji, omits standalone components and skin-tone duplicates,
maps them to nine categories, and combines their Chinese and English search tags.
Existing curated workspace names and Unicode values take precedence.
Artwork comes from the separately licensed [Twemoji sprite](../twemoji/README.md).

Run `node scripts/build-workspace-emoji-catalog.mjs` to regenerate offline from
the pinned npm package. Run it with `--check` to verify the generated subset.
Input SHA-256 hashes are retained in [manifest.json](manifest.json).
