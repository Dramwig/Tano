# Cloud Extension API

Tano's public MIT Core owns the workspace adapter, editor, and workbench. The optional Cloud Overlay lives in a separate private repository. The public product runs without it.

`@tano/workbench/runtime` exports `CLOUD_EXTENSION_API_VERSION`, `CloudExtension`, and `configureWorkbenchWithCloudExtension`. API version 1 lets an overlay provide a `WorkbenchExtensions` implementation for a Pinia workbench instance. That implementation may supply editing sessions, named UI regions, settings pages, history, refresh, and disconnect actions. Core only calls these hooks; account, sync, collaboration, network configuration, and hosted service code stay in the overlay.

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

The public repository owns Core versions and `core-vX.Y.Z` tags. Its `core:export` manifest records the Core version and source commit. The private overlay owns the independent Product version and pins a clean export of the chosen Core tag. Product releases use `vX.Y.Z` tags in this public repository; multiple Product tags may point to the same Core commit. See [builds and releases](releases.md).
