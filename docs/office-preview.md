# Office attachment reading

Office attachments open in the built-in **read-only preview** from the file tree
or asset panel. The shared workbench provides the same viewer to local and cloud
hosts. A host supplies attachment bytes through `AttachmentService.readAttachment`;
the viewer does not convert attachments into workspace Markdown or send them to an
external document service. Excel editing is available when the host implements
`AttachmentService.writeSpreadsheet` (currently the native desktop host).

Click a row number or column letter to select the entire row or column. Right-click
the header or selected cells for Copy, Clear contents, and Delete row/column.
Copy exports tab-separated displayed values. Clear removes values while keeping
cell styles and dimensions; Delete shifts following cells and row/column sizes.
Ctrl/Cmd+C copies, Delete/Backspace clears, and Shift+F10 opens the header menu.
Read-only hosts allow selection and copying, but disable destructive menu actions.
Deletion is refused for workbooks with formulas, named ranges, or a filter on the
target sheet because the current writer cannot safely rewrite those references.
Array formula cells cannot be cleared individually. These cases display an error
before applying the change. Structural deletions also refuse externally changed
workbooks; independent non-structural edits retain the normal merge protection.

Worksheet tabs expose the same compact context menu via right-click or Shift+F10:
Rename, Duplicate, and Delete. Actions target the clicked tab, including inactive
tabs. Names must be valid Excel sheet names and unique ignoring case; duplicates
are inserted after their source with an automatically generated name. At least one
visible worksheet must remain. Read-only hosts disable these actions. Workbooks
with formulas, defined names, or VBA require Office for these structural actions
to avoid breaking references. The original workbook and local draft protection also
apply to tab actions.

| Format | Reading support |
| --- | --- |
| `.xls`, `.xlsx` | Worksheet selection, formatted cell values, saved formula results and continuous scrolling |
| `.docx` | Source page dimensions, margins, sections, headers/footers, styled paragraphs, tables and images through the default Word system plugin |
| `.doc` | Binary-format character/paragraph/table/image rendering and first-section paper geometry through the Word plugin; incomplete pagination and header/footer support |
| `.pptx`, `.ppt` | Offline original-coordinate SVG rendering through the default system Presentation Preview plugin |

Excel uses a structured grid. Word and presentations open in isolated system
plugins, without content extraction into the host's fixed A4 reading pages.
The original attachment is unchanged.

Both system viewers show a bundled loading skeleton throughout attachment reading,
chunk transfer and first-page rendering: a 16:9 slide for presentations and stacked
portrait pages with text/table placeholders for Word. Completion or failure removes
the skeleton. Narrow windows scale these placeholders, and reduced-motion settings
disable their shimmer. Loading status remains available to assistive technology.

## Word Preview plugin

**Word 文档预览** is installed and enabled by default, including read-only
workspaces. Opening DOC/DOCX routes to its tab. Its disable preference is device-local;
disabled viewers show an enable prompt rather than silently using text extraction.
It follows the same system package ownership and integrity rules as Presentation Preview.

The browser-native renderer bundles Apache-2.0 `@file-viewer/docx@0.3.39` and MIT
`@file-viewer/doc@3.3.3`. DOCX uses source page geometry, margins, sections,
headers/footers, typography, lists, tables, embedded images and supported drawings.
Pages form a continuous stack; narrow windows scale the paper without reflowing
its text. Filename, page navigation and the grouped preview menu share the breadcrumb
row. Rendering occurs offline in the plugin sandbox; no Word, COM, LibreOffice,
remote converter or upload is used by the product.

Legacy DOC uses its binary formatting and first-section PlcfSed/SEPX dimensions
and margins. The current engine does **not** reproduce complete original pagination,
multi-section layout or headers/footers. This limitation is shown under the preview
information action. Missing fonts and complex OOXML layouts may also differ from Word;
neither path promises pixel-identical Microsoft Word output.

The plugin requests only attachment read and UI permissions. The existing immutable
attachment bridge and opaque no-network iframe are reused. DOCX external resources,
external hyperlinks and HTML altChunks are disabled; archive expansion, paths and
XML declarations are checked before rendering. The original file is never modified.
Each new load uses its own render container, detaches superseded work and releases
layout observers. Limits are 50 MiB input, 2,000 ZIP entries, 20 MiB per entry,
100 MiB expanded and 1,000 DOCX pages.

Rebuild with `npm run plugin:word`. Sources and notices are in
[the Word plugin](../examples/plugins/word-preview/README.md). Browser acceptance uses
`npx playwright test word-browser.spec.mjs` and source-controlled fixtures.

## Presentation Preview plugin

**演示文稿预览** is a system plugin, included and enabled by default in new and
existing workspaces, including read-only workspaces. No installation or separate
authorization is needed. Opening PPT/PPTX attachments opens its tab. Users may
disable it on their device; that preference survives restarts. Disabled plugins
show an enable prompt; there is no text-reflow or native Office fallback.

The system registration comes from the application, never from workspace rules.
It uses the exact bundled package and ignores same-ID portable package pins.
System plugins cannot be uninstalled, replaced by an import, or independently
updated; their version follows the app. Automatic availability does not write any
workspace file or publish packages to a repository. Third-party plugin trust and
authorization remain unchanged.

The plugin bundles MIT-licensed `@web-ppt/core` 0.5.0. Both OOXML PPTX and binary
PPT are parsed locally and rendered to SVG at their original coordinates and
dimensions. The engine handles themes, master/layout inheritance, formatted text,
images, shapes and supported tables/charts. Static preview does not imply complete
PowerPoint parity: unavailable fonts, unsupported objects and effects may differ.
Animations and media playback are not enabled. No Office installation, conversion
server or upload is required. The package runs in browser and desktop hosts.

Only `attachments.read` and `ui` permissions are requested. Host reads resolve
visible file IDs, exclude Markdown/internal paths and enforce 50 MiB. An immutable
snapshot is delivered in 18,000-byte chunks bound to the workspace, plugin instance
and file revision. It is released on the final chunk, runtime/workspace changes or
workbench disposal. A file picker also opens local files inside the UI sandbox.

The opaque UI keeps the no-network CSP, strips active SVG elements/event handlers
and external resource links, releases parsed media URLs on file changes, and
renders one slide at a time. PPTX expansion is bounded to 2,000 entries, 20 MiB per
entry and 100 MiB total; previews allow up to 1,000 slides. Embedded font URLs are
subject to the sandbox font policy, with system fonts as fallback. Controls include
zoom, fit width, page buttons and keyboard arrows.

Rebuild with `npm run plugin:presentation`; sources live in
`examples/plugins/presentation-preview/`. Bundled third-party notices are available
from the preview toolbar.

## Reader layout

PDF and spreadsheet attachments share an IDE pane reader with an independently scrolling
canvas. PDF pages and the Word plugin each form a continuous vertical stack with gaps. Scrolling updates the current page; navigation controls scroll to a page
instead of replacing the content. PDF canvases are mounted near the viewport, while page placeholders preserve the complete scroll range. PDF page
dimensions are read before rendering, including mixed portrait/landscape documents.
Read-only status uses the same status icon and hover/click panel as Markdown,
immediately after the breadcrumb filename; no bottom status bar is shown. Page/row
position and zoom details live in the preview actions popover. Controls are folded into the
breadcrumb row's preview actions button, matching Markdown's header action pattern.
Each split pane owns its action host. The popover supports Escape, outside dismissal,
focus restoration and viewport-aware positioning. Standalone readers without a header
host keep an inline toolbar. Page navigation, zoom presets, zoom buttons and width/page
fitting do not move the workbench chrome.
PDF has lazy page thumbnails. Word plugin page buttons, arrow keys and Home/End
navigate its continuous page stack. DOCX paper follows each source section rather
than a fixed A4 size. The presentation plugin uses original slide dimensions in SVG.
Excel uses a continuously scrolling grid with sticky row/column headings and bottom
worksheet tabs with keyboard navigation.
Saved column widths are used for XLS and XLSX, with a 72px fallback and compact rows.
The grid keeps its own width rather than stretching columns to fill the pane; unused
space remains blank. Cells stay on one line and clip at the column boundary;
hovering exposes the full text. Source workbook wrap-text formatting is not reproduced.
Drag a column heading's right edge to resize, or double-click it to fit its text;
the focused separator also supports Left/Right and Enter. Writable workbooks show
one extra blank column with an add button and a plus button after the worksheet tabs.
Double-click a cell or press Enter to edit literal text (including text beginning
with `=`); this is not a formula editor. Truncated previews cannot be edited.

Edits are staged in IndexedDB application data and restored when reopening the file.
Committed edits automatically save after a short debounce. Serialization and native
writes run in the background while further edits remain usable and durable. A save
acknowledges only its own batch; edits made during that save are queued for the next.
Normal saving adds no banner or status row. Saving, pending changes and errors appear
in the filename's existing status icon. Errors retain the draft; click or hover the
icon for details and a retry action. Pane/file-scoped status clears when its editor closes.
Rewriting may change complex formatting. Existing formulas are
checked after serialization; saving stops if a formula would be lost. Independent
external cell changes are merged, overlapping edits stop with the local draft retained.
Native writes check the latest SHA-256 before and after staging, preserve permissions,
and retain the original bytes under application data `spreadsheet-backups/` before
replacing the file. Backup paths stay in application data rather than the normal editor UI. Hosts without
the writer keep the preview read-only, with display-only column resizing.
It has no page controls; canvas arrow keys and Home/End retain native scrolling behavior.
The actions popover shows the row count.
Format limitations are available through the information button, with truncation warnings
remaining visible above the grid. Document paper stays white in dark mode while viewer
controls and spreadsheets follow the workbench theme.

## Limits and isolation

- Maximum attachment size: 50 MiB. Encrypted/password-protected files require
  decryption outside Tano before previewing.
- Excel previews include up to 200 worksheets, the first 10,000 rows and 200
  columns per sheet, subject to a combined 500,000-cell processing budget.
  All parsed rows in the selected sheet are available without paging. Truncation is explicitly labeled.
- ZIP-based documents are limited to 2,000 entries, 20 MiB per entry and 100 MiB
  expanded data. Presentations support up to 1,000 slides. The structured output
  has block and character limits; over-limit files display an export suggestion.
- PNG, JPEG, GIF, WebP and BMP images are accepted by signature, up to 5 MiB per
  image within the overall output budget. External images, SVG and OLE objects
  are not rendered.
- Legacy extraction utilities and Excel parsing run in an on-demand, dedicated Web Worker with a 30-second timeout.
  Changing files or closing the viewer terminates the worker. Excel output is inert data rendered by Vue. Word formatted HTML is rendered only
  inside the isolated plugin, never in the host document.
- In the content extraction parser, formulas, macros, field instructions, external relationships and document
  hyperlinks are never executed or fetched. XML DTDs/entities and archive paths
  escaping the document package are rejected.
- The legacy PowerPoint extraction utility follows `Current User` and the
  persist-directory edit chain, but is no longer used for attachment previews.
  Presentation attachments are rendered only through the isolated plugin.

## Development checks

```sh
npx vitest run packages/workbench/src/office-preview packages/workbench/src/components/OfficePreview.test.ts packages/workbench/src/components/AttachmentPreview.test.ts packages/protocol/src/file-core.test.ts packages/workbench/src/file-preview.test.ts --maxWorkers=2
npm run typecheck -w @tano/client
npm run build
npm run docs:check
```

Spreadsheet parsing uses [SheetJS CE](https://docs.sheetjs.com/), pinned to the
official 0.20.3 tarball with lockfile integrity. Compound binary files use
[js-cfb](https://github.com/SheetJS/js-cfb); XML parts use
[xmldom](https://github.com/xmldom/xmldom). Their Apache-2.0/MIT licenses and
notices are included in the product notices and do not change Tano's MIT license.
