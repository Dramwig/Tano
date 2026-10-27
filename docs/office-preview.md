# Office attachment reading

Office attachments open in the built-in **read-only preview** from the file tree
or asset panel. The shared workbench provides the same viewer to local and cloud
hosts. A host supplies attachment bytes through `AttachmentService.readAttachment`;
the viewer does not write the attachment, convert it into workspace Markdown, or
send it to an external document service.

| Format | Reading support |
| --- | --- |
| `.xls`, `.xlsx` | Worksheet selection, formatted cell values, saved formula results and row pagination |
| `.docx` | Body text, headings, basic bold/italic/underline, tables and supported embedded raster images |
| `.doc` | Word 97–2003 body text, including mixed compressed text and UTF-16 pieces; text reading view |
| `.pptx` | Slides in presentation order, text, tables and supported embedded raster images |
| `.ppt` | Slides in presentation order and text from the current saved edit; text reading view |

This is a content reading view. It does not reproduce Office pagination, themes,
merged-cell layout, master slides, charts, animations or every embedded object.
Legacy Word and PowerPoint previews do not retain original formatting or images.
Headers, footers, speaker notes and unsupported drawing objects are not included.
Word reading sections group up to 200 extracted blocks and are not printed pages.
The original attachment remains available through the existing export action.

## Limits and isolation

- Maximum attachment size: 50 MiB. Encrypted/password-protected files require
  decryption outside Tano before previewing.
- Excel previews include up to 200 worksheets, the first 10,000 rows and 200
  columns per sheet, subject to a combined 500,000-cell processing budget. Only
  100 rows are rendered at a time. Truncation is explicitly labeled.
- ZIP-based documents are limited to 2,000 entries, 20 MiB per entry and 100 MiB
  expanded data. Presentations support up to 1,000 slides. The structured output
  has block and character limits; over-limit files display an export suggestion.
- PNG, JPEG, GIF, WebP and BMP images are accepted by signature, up to 5 MiB per
  image within the overall output budget. External images, SVG and OLE objects
  are not rendered.
- Parsing runs in an on-demand, dedicated Web Worker with a 30-second timeout.
  Changing files or closing the viewer terminates the worker. Output is inert
  text/table/image data rendered by Vue; document HTML is never inserted.
- Formulas, macros, field instructions, external relationships and document
  hyperlinks are never executed or fetched. XML DTDs/entities and archive paths
  escaping the document package are rejected.
- Binary PowerPoint follows `Current User` and the persist-directory edit chain
  rather than scanning every stored record, so obsolete slide text is excluded.

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
