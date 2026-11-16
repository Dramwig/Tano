# Block editing and layout

[简体中文](../zh-CN/10-多块编辑与布局.md) · [Guide](00-getting-started.md)

## Select blocks and edit their source

First paragraph: change “pending” to “reviewed”. Keep **bold text** and this [target link](nested-folder/target-document.markdown).

Middle paragraph: leave this control paragraph untouched when selecting nonadjacent blocks.

Third paragraph: change “pending” to “reviewed”, keeping the formula $a+b=c$.

- [ ] Use block handles or marquee selection to select the first and third paragraphs, then enter Markdown source editing from the block menu.
- [ ] Edit the selected content, leave source editing, and check that the middle paragraph is unchanged.
- [ ] Select consecutive blocks and try editing their source together.
- [ ] Undo and redo, checking text, block order, and unselected content.

## Dragging and columns

Drag this paragraph to either side of the callout below. Drop when a vertical guide appears to create columns.

> [!CUSTOM:💡]
> Click the icon to choose an emoji or built-in icon. Dropping above or below another block changes its vertical order.

- [ ] Drag a column boundary; press Esc to cancel a drag, or double-click to restore equal neighboring widths.
- [ ] Narrow the window to check stacked columns, then restore it to check the saved proportions.

## Automatic table width

| Check | Action | Expected result |
| --- | --- | --- |
| Fixed width | Drag a column boundary | Custom widths persist |
| Automatic width | Restore automatic width in the table menu | Columns follow container width |
| Cell colors | Set text or background colors | Restoring automatic width keeps colors |

Table text stays in Markdown. Column widths and cell colors live in document layout data under `.tano/`; copying only Markdown does not carry them. Suggestion editing supports table text but does not save widths or colors.

## Reading settings

- [ ] Try page width, fonts, and source visibility in page display options, then open find and the outline.
- [ ] Move the formatting toolbar between supported docking positions and inspect configurable shortcuts in settings.
- [ ] Lock the page for reading, then unlock it to continue editing. Page locking does not change filesystem permissions.
