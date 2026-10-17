# Tano Core 0.6.0

- Add account connections and read-only imports with application-local OAuth registrations and in-memory native access tokens.
- Refresh workspace menus, import history, duplicate document/table tabs and stable navigation.
- Apply saved themes before workbench loading and improve startup recovery and editor selection handling.
- Load independent workspace settings, objects and capabilities concurrently.

Markdown remains the canonical content format. No workspace data migration is required.

- chore(repo): integrate validated workspace improvements (a889aca)
- perf(workbench): load workspace metadata concurrently (9bcb281)
- feat(workbench): add account imports and refresh workspace workflows (13e8dab)
- chore(repo): synchronize Core 0.5.1 into development (c5544ae)
