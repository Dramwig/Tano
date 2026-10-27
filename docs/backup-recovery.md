# Backup and recovery

English | [中文](zh/backup-recovery.md) | [日本語](ja/backup-recovery.md) | [Deutsch](de/backup-recovery.md) | [Documentation](README.md)

Back up Markdown files, attachments, and the entire `.tano/` directory together. The workspace UUID, file identities, objects, relations, and rules are portable source data, not disposable cache.

Tano does not create automatic workspace backups or provide workspace archive import, export, or restoration. If a workspace folder is deleted outside Tano, opening it fails; Tano does not recreate the folder or recover its contents. Use your own backup tool, version control, or the operating system's recycle bin for recovery.

If the workspace folder still exists but the entire `.tano/` directory was deleted, reopening initializes the folder as a new workspace with a new UUID and newly allocated file IDs. A notice explains that the original metadata was deleted, old object data was lost, and the project was reinitialized. Existing Markdown and attachments remain unchanged. Objects, relations, and rules deleted with `.tano/` are not restored, and the old workspace's index, drafts, and session are not reused. Partial identity metadata loss, corruption, or mismatched identities still block opening. An already open session stops writing until the workspace is reopened and initialized.

Draft journals live in application data and preserve unsaved edits across application restarts; they are not a backup of the workspace. External file changes still go through base-hash comparison, three-way merge, and conflict preservation.
