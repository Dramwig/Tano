# Third-party notices

Tano-owned code is licensed under MIT. Third-party components retain their own licenses; exact dependency versions are recorded in the npm and Cargo lockfiles. These components include Vue, Pinia, Milkdown, ProseMirror, CodeMirror, Tauri, YAML, KaTeX, Mermaid, and the MCP SDK.

The Inter font uses the SIL Open Font License in `apps/client/public/INTER-LICENSE.txt`. Lucide and other assets follow the licenses distributed with their packages.

The code block language picker bundles SVGs from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) and [Devicon](https://github.com/devicons/devicon). Both sets are distributed under MIT; their license texts and source versions are recorded in `packages/editor/src/language-icons/`.

`npm run notices:generate` collects LICENSE, COPYING, and NOTICE files from the current npm and Cargo dependencies. It writes `apps/client/public/THIRD_PARTY_NOTICES.txt` and the MCP distribution notice file. Desktop and MCP distributions include the generated notices. Regenerate them after updating dependencies; Tano's MIT license does not replace third-party obligations.
