# Tano Workspace Protocol Helpers

Tano - Humans and agents, on the same page.

This preview Python library provides working helpers for Tano's local File-Native
workspace protocol. It is not the desktop application or a sync client.
PyPI normalizes the distribution name `tano.page` to `tano-page`; import it as
`tano_page`.

```python
from tano_page import content_hash, is_short_id, is_workspace_data_path

revision = content_hash(b"# Notes\n")
assert len(revision) == 64
assert is_short_id("a1b2c3")
assert is_workspace_data_path(".tano/objects/a1b2c3.tano.json")
assert not is_workspace_data_path(".tano/config.json")
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
filesystem or network operations, has no runtime dependencies, and performs
no actions at installation time.

Copyright (c) 2026 Zixi Wang. Licensed under MIT; see LICENSE. Third-party
dependencies retain their own licenses.
