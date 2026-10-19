# Tano Workspace Protocol Helpers

Tano - Humans and agents, on the same page.

This preview Rust library provides working helpers used by Tano's local File-Native
workspace protocol. It is not the desktop application or a sync client.

```rust
use tano_page::{content_hash, is_short_id, is_workspace_data_path};

let revision = content_hash(b"# Notes\n");
assert_eq!(revision.len(), 64);
assert!(is_short_id("a1b2c3"));
assert!(is_workspace_data_path(".tano/objects/a1b2c3.tano.json"));
assert!(!is_workspace_data_path(".tano/config.json"));
```

- `content_hash` returns a lowercase SHA-256 of the exact bytes, without newline
  or Unicode normalization.
- `is_short_id` recognizes six lowercase hexadecimal characters. These IDs are
  separate from workspace UUIDs.
- `is_workspace_internal_path` identifies `.tano` paths.
- `is_workspace_data_path` classifies portable object, capability, relation,
  and conflict paths. Workspace identity configuration is excluded.

Path classification is not path validation or filesystem authorization. Callers
must validate relative paths, enforce workspace boundaries, reject unsafe
symlinks, and compare the base hash before writing. The library performs no
filesystem or network operations.

Copyright (c) 2026 Zixi Wang. Licensed under MIT; see LICENSE. Third-party
dependencies retain their own licenses.
