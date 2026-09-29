# Level 1 enhanced blocks

## Five callout types

> [!NOTE]
> A regular note with **emphasis**.

> [!TIP]
> A suggested action.

> [!IMPORTANT]
> Important information.

> [!WARNING] Warning information.

> [!CAUTION]
> Proceed with caution.

Another importable callout form is normalized to the quote form after a rich-text edit is saved:

> [!WARNING]
>
> Another warning callout.

## Toggle block

<details>
<summary>Click to expand the test content</summary>

The toggle body can contain **inline styles**.

* Toggle list item A
* Toggle list item B

</details>

## Tabs with explicit panel syntax

::::tabs

:::panel "Overview"

This is the first tab.

## A second-level heading inside a panel

This H2 should stay inside the current tab.

:::

:::panel "Code"

```text
tabs panel content
```

:::

::::

## Columns with the H2 shorthand format

::::columns

:::panel "Left column"

Text in the left column.

:::

:::panel "Right column"

Text in the right column with **bold** styling. Editing may normalize this to a `panel` fence.

:::

::::

## File cards and embeds

:::file

[Sample attachment](assets/sample%20attachment.txt)

:::

:::embed

[Local image embed](assets/test-image.png)

:::

When enhanced blocks are disabled, the preserved Markdown source should appear. Re-enable the feature to restore interaction.
