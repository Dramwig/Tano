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
frozen; vectors accept path data, fixed colors and short text labels, never HTML,
remote URLs or executable components.

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
  icons: { note: { color: '#648bc8', paths: ['M6 10h8 M6 13h8 M6 16h5'] } },
  fileExtensions: { md: 'note', markdown: 'note' },
});
registry.select('example.notes');
// Call on host/plugin teardown:
dispose();
```

This is a host extension point, **not yet a sandbox plugin SDK capability or a
theme settings screen**. A future plugin contribution bridge must validate the
manifest, register only enabled/authorized contributions, dispose them on plugin
disable/uninstall/workspace changes, and activate only the user's selected theme.
Device-local theme selection belongs in application settings, not workspace root
files or `.tano/config.json`. No new persistence is introduced here.
