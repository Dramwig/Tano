# Cloud Extension API

Tano's public MIT Core owns the workspace adapter, editor, and workbench. The optional Cloud Overlay lives in a separate private repository. The public product runs without it.

`@tano/workbench/runtime` exports `CLOUD_EXTENSION_API_VERSION`, `CloudExtension`, and `configureWorkbenchWithCloudExtension`. API version 1 lets an overlay provide a `WorkbenchExtensions` implementation for a Pinia workbench instance. That implementation may supply editing sessions, named UI regions, optional views, settings pages, history, refresh, and disconnect actions. Core only calls these hooks; account, chat UI and state, sync, collaboration, network configuration, and hosted service code stay in the overlay.

```ts
import {
  CLOUD_EXTENSION_API_VERSION,
  configureWorkbenchWithCloudExtension,
  type CloudExtension,
} from '@tano/workbench/runtime';

const cloud: CloudExtension = {
  apiVersion: CLOUD_EXTENSION_API_VERSION,
  createWorkbenchExtensions: (pinia) => createPrivateExtensions(pinia),
};
configureWorkbenchWithCloudExtension(pinia, { adapter, native, mobile }, cloud);
```

The workbench rejects an unsupported API version and a second registration on the same Pinia instance. Each new workbench instance gets its own overlay state. The adapter still owns local file access; the extension does not change the Markdown source of truth or the workspace format.

The optional `welcome-recent` region replaces the welcome page's built-in recent workspace list. The host renders it below the welcome actions and passes `WorkbenchActions`. An overlay can combine local and hosted workspace history and handle opening each workspace through its own storage adapter; the public product retains its local list when the region is absent.

## Settings context

Settings page components receive `SettingsPageContext` props: `mode`, `workspace` (stable ID, name, path, and read-only state), and `activeFile` (ID and path, or `null`). The host supplies these values in both inline settings and separate desktop settings windows, updating them when the active workspace or file changes. Extensions must use this context instead of assuming that the settings window's workspace store has opened the host's files. Document content is not included in the settings snapshot.

## Optional views

`WorkbenchExtensions.views` is an optional array of `WorkbenchView` definitions. This additive API version 1 capability supplies a stable `view:<name>` ID, label, icon, main component, optional sidebar, and optional overlay component. IDs must match `view:[a-z][a-z0-9-]*`, be unique, and must not reuse built-in IDs (`view:graph`, `view:plugins`, `view:calendar`). Definitions are fixed for the lifetime of a workbench instance.

The shell registers view metadata before restoring the workspace session, adds navigation and tab UI, and passes `WorkbenchViewActions` as the `actions` prop to each view component. `open()` activates the singleton tab and closes the sidebar on small screens; `showSidebar()` reveals that view's sidebar. The overlay hosts dialogs across tab switches. Business state stays in the providing product, scoped to its Pinia instance.

Only registered view IDs can be opened or restored. Missing extensions are skipped during session restoration without affecting document drafts. Sessions contain only tab IDs, never view components or business data. Opening a file from an extension view keeps the view's tab. Closing the tab does not dispose the product's state; the main component unmounts when inactive, while sidebar and overlay components remain mounted while a workspace is open.

Views cannot move between windows by default. Set `detachable: true` only when their state can safely be reconstructed in another window; otherwise an optional `detachBlockedMessage` explains the restriction. Headless store consumers must call `registerViews()` before `initialize()` when restoring extension tabs. The public local product supplies no product views and therefore has no chat entry or chat preview bundle.

The public repository owns Core versions and `core-vX.Y.Z` tags. Its `core:export` manifest records the Core version and source commit. The private overlay owns the independent Product version and pins a clean export of the chosen Core tag. Product releases use `vX.Y.Z` tags in this public repository; multiple Product tags may point to the same Core commit. See [builds and releases](releases.md).
