# Third-party notices

Tano-owned code is licensed under MIT. Third-party components retain their own licenses; exact dependency versions are recorded in the npm and Cargo lockfiles. These components include Vue, Pinia, Milkdown, ProseMirror, CodeMirror, Tauri, YAML, KaTeX, Mermaid, and the MCP SDK.

The Inter font uses the SIL Open Font License in `apps/client/public/INTER-LICENSE.txt`. Lucide and other assets follow the licenses distributed with their packages.

The Literata font uses the SIL Open Font License in `apps/client/public/LITERATA-LICENSE.txt`.

The unmodified [ICAL.js](https://github.com/kewisch/ical.js/tree/v2.2.1) parser is distributed under MPL-2.0. Its source is available from that repository and the corresponding npm package; its license text is included in the generated distribution notices. Tano's connector code remains MIT. The native keyring dependency retains its MIT OR Apache-2.0 license.

The Maple Mono NF font uses the SIL Open Font License in `apps/client/public/MAPLE-MONO-LICENSE.txt`.

The code block language picker bundles SVGs from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) and [Devicon](https://github.com/devicons/devicon). Both sets are distributed under MIT; their license texts and source versions are recorded in `packages/editor/src/language-icons/`.

Callout titles bundle five duotone SVGs from [Phosphor Icons](https://github.com/phosphor-icons/core), distributed under MIT. The license text, pinned source revision, and asset paths are recorded in [packages/editor/src/callout-icons/](packages/editor/src/callout-icons/README.md).

`npm run notices:generate` collects LICENSE, COPYING, and NOTICE files from the current npm and Cargo dependencies. It writes `apps/client/public/THIRD_PARTY_NOTICES.txt` and the MCP distribution notice file. Desktop and MCP distributions include the generated notices. Regenerate them after updating dependencies; Tano's MIT license does not replace third-party obligations.
