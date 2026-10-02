# Backup and recovery

English | [中文](zh/backup-recovery.md) | [日本語](ja/backup-recovery.md) | [Deutsch](de/backup-recovery.md) | [Documentation](README.md)

Back up Markdown files, attachments, and the entire `.tano/` directory together. The workspace UUID, file identities, objects, relations, and rules are portable source data, not disposable cache.

Tano does not create automatic workspace backups or provide workspace archive import, export, or restoration. If a workspace folder is deleted outside Tano, opening it fails; Tano does not recreate the folder or recover its contents. Use your own backup tool, version control, or the operating system's recycle bin for recovery.

If an existing workspace loses its identity metadata, opening or writing stops to avoid changing file identities. Draft journals live in application data and preserve unsaved edits across application restarts; they are not a backup of the workspace. External file changes still go through base-hash comparison, three-way merge, and conflict preservation.
