# Backup and recovery

English | [中文](zh/backup-recovery.md) | [日本語](ja/backup-recovery.md) | [Deutsch](de/backup-recovery.md) | [Documentation](README.md)

Back up Markdown files, attachments, and the entire `.tano/` directory together. The workspace UUID, file identities, objects, relations, and rules are portable source data, not disposable cache.

The native core keeps metadata snapshots in application data. If a known workspace loses its identity, ordinary opening and writing stop. Use the recovery flow to preview and confirm restoration instead of assigning a new UUID. A full export includes document content and application data; import verifies byte digests and will not overwrite an existing destination.

Draft journals also live in application data. External file changes still go through base-hash comparison, three-way merge, and conflict preservation. A failed recovery retains its data and records. Local snapshots are useful for recovery, but keep a separate backup on another device or medium.
