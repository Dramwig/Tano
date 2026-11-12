# Source-preservation boundaries

[简体中文](../zh-CN/07-原文保留边界.md) · [Guide](00-getting-started.md)

Unsupported examples are isolated so they do not affect this guide.

- [Unknown directives and embeds](08-unknown-directives-and-embeds.md): Unknown `:::` directives, `![[...]]`, and code-fence metadata should retain source and show the relevant warning.
- [TOML frontmatter](09-toml-frontmatter.md): The top `+++` block is preserved as source.

Unclosed YAML and unsafe HTML or MDX also require conservative source handling. Edit unsupported examples in source mode. A source-preservation warning does not mean that syntax can render.
