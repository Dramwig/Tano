# Feature gating

The registry starts empty. Owners classify features; existing functionality is not implicitly unfinished.
Register a literal key in `packages/workbench/src/features.ts` using `defineFeatures`, with `status` (`dev` or `stable`) and a one-sentence `note`. Import from `@tano/workbench/features`.

`DEV === true` or `VITE_TANO_CHANNEL === 'dev'` selects the dev channel. Everything else selects stable, including production builds with no environment variables. Stable features always run; dev features run only in dev. `createFeatureGate(definitions, channel).isEnabled(id)` supports injected registries. Unknown IDs throw. No remote service, user targeting, rollout percentages or settings switch is provided. Code may remain in bundles.

## Entry checklist

Every flag must cover **all** entry points:

- Sidebar switcher and view registration (`sidebarNavigationItems` and `store.registerViews` in `use-workbench.ts`).
- Command palette registrations and keyboard shortcuts.
- Settings sections and `NewTabPicker.vue` choices.
- Context menus, search results, help lists and help content.
- Assistant tools and MCP tools.
- Built-in plugin catalog entries.
- Routes and deep links, including direct navigation.

When disabled, do not render, register commands or tools, or include the feature in search or help. Reject direct entry before any side effect; hiding a button alone is insufficient.

## Data and lifecycle

Disabled features must ignore their existing data without crashing or overwriting it. A dev feature must not introduce a new persistent format under `.tano/`. If that is necessary, change it to stable before publishing.

1. Register unfinished work as dev before adding entries. Use literal `isFeatureEnabled('id')` calls so checks can find usage.
2. Review the full entry checklist and stable-mode data compatibility.
3. Run `npm run features:check` (also part of `check`). It rejects unknown IDs, unused registrations and dev channel assignments in release configurations, and lists unfinished IDs with notes. Release prepare includes that list in its notes draft. The checker cannot prove that every entry is guarded; reviewers must verify the checklist.
4. On launch, change status to stable. After one stable release, remove the guards and registry entry together.

Vite evaluates `import.meta.env` in consumer source, including workbench source excluded from dependency optimization. Never set `VITE_TANO_CHANNEL=dev` in production. Server consumers explicitly select their channel and must not infer development from Node environment defaults.
