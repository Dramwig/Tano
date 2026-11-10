# File icon themes

File and folder defaults are owned by `packages/workbench/src/file-icons/`,
independently of the Lucide icons used for interface controls. The built-in Tano
vectors are original MIT-licensed assets. The default theme uses monochrome,
rounded outlines with the same visual weight as workbench controls, inherits the
surrounding text color in light/dark and selected states, and uses full-size
format symbols instead of colored badges or tiny text labels. Code languages
share a code symbol while retaining separate theme IDs for later customization.
`ResourceIcon.vue` renders these vectors
in the explorer, folder view, breadcrumbs, tabs (including drag previews), and
workspace file sources. `DocumentFileIcon.vue` preserves explicit document icons
from metadata before falling back to the file theme. Existing user-selected
`icon:*`, emoji and uploaded icons retain their meaning.

## Resolution

- File names are matched case-insensitively before extensions.
- Compound extensions are matched longest first (`table.json` before `json`).
- Named folders can specify separate collapsed and expanded icons.
- Folder-home documents use the folder identity and expansion state unless the
  document has an explicit custom icon.
- Unmatched resources fall back to the built-in theme. A theme can instead supply
  generic `file`, `folder`, and `folderExpanded` defaults.

## Host extension point

`FileIconRegistry.register(theme)` accepts a declarative `FileIconTheme` and
returns an idempotent disposer. `select(id)` activates a registered theme. Mounted
icons update immediately; disposing the active theme restores Tano defaults.
Duplicate IDs and invalid references are rejected. Contributions are copied and
frozen; vectors accept path data, hex or semantic colors and short text labels, never HTML,
remote URLs or executable components.

Color artwork can additionally use `image` and optional `lightImage`: embedded,
bounded PNG data URIs, rendered in place of the vector. The light variant follows
the host's resolved appearance mode. Remote images and SVG data URIs are rejected.
An optional theme `notice` preserves third-party attribution and license text in
the installable package. See [Material file icons](../examples/plugins/material-icon-theme/README.md)
for an offline, data-only adaptation of Material Icon Theme, including reproducible
build instructions and the exact supported associations.
The separate [vscode-icons plugin](../examples/plugins/vscode-icons/README.md)
uses this same format, with CC BY-SA 4.0 artwork attribution and its upstream
known language suffixes adapted to filename matching. Both plugins can coexist.

The default registry is application-local. A host can provide an isolated registry
using Vue's `fileIconRegistryKey`, for example when different workspace roots need
different themes:

```ts
import { FileIconRegistry, fileIconRegistryKey } from '@tano/workbench/file-icons/registry';

const registry = new FileIconRegistry();
app.provide(fileIconRegistryKey, registry);
const dispose = registry.register({
  id: 'example.notes',
  label: 'Notes',
  icons: { note: { color: 'syntax-blue', paths: ['M6 10h8 M6 13h8 M6 16h5'] } },
  fileExtensions: { md: 'note', markdown: 'note' },
});
registry.select('example.notes');
// Call on host/plugin teardown:
dispose();
```

## Plugin contributions

Installable packages now declare `appearance: { version: 2, icons: [...] }` using
this same data shape. See [Theme plugins](theme-plugins.md) for validation limits,
packing, separate color/icon selection, device-local persistence and lifecycle
fallback. Only enabled contributions (and authorized executable versions) are
registered. Disable, uninstall and workspace changes dispose the old icons;
explicit document icons remain higher priority than the selected icon theme.

Icon color accepts a whitelisted color-token name such as `accent` or `syntax-blue`, a hex color, or `currentColor`. Semantic colors render as CSS variables and follow the selected light/dark palette without re-registering icons. Arbitrary CSS variables and URLs are rejected.
