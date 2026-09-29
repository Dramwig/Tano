# Source-preservation boundaries

This file explains the boundary. The actual samples are in two separate files so unsupported syntax does not affect this entire document.

- [08-unknown-directives-and-embeds.md](08-unknown-directives-and-embeds.md): An unknown `:::` directive and `![[...]]` should show a warning and preserve their source.
- [09-toml-frontmatter.md](09-toml-frontmatter.md): TOML frontmatter is currently preserved as raw source.

Fenced code with extra metadata (for example, `` ```js title=demo.js ``), unclosed YAML, and arbitrary unsafe HTML or MDX also receive conservative source handling. Edit these examples in source mode, and do not interpret the warning as support for rendering them.
