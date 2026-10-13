# Mobile development

Tano Local uses the shared Vue workbench and Tauri 2 native storage on Android
phones/tablets and iPhone/iPad. Markdown remains in ordinary files inside the app
sandbox; portable identity and objects remain under `.tano/`. Application caches,
drafts and recycle-bin records stay in application data.

## Layout and input

- Phones and tablets use single-page navigation, like the web app. Document tabs,
  new-tab actions and multiple document panes are exclusive to the desktop app,
  regardless of the mobile window width or a connected keyboard/trackpad.
- Touch windows below 1024 CSS pixels use an overlay workspace drawer, including
  landscape phones and iPad split view. Wider tablets can keep the sidebar open
  alongside the current page. Existing session documents and drafts are retained.
- Long-press a file or folder to open its actions; scrolling cancels the gesture.
  Mouse right-click and keyboard context-menu shortcuts remain available. The tree
  has no persistent per-row more buttons. Controls retain the shared compact
  dimensions instead of applying blanket touch-specific height overrides.
- The outline opens on demand on touch devices. The editor, settings and assistant
  adapt to the visual viewport and safe areas when the keyboard is visible.
  Pinch zoom is preserved. Android applies system bar, cutout and IME insets to the
  native WebView container; iOS uses CSS safe-area insets.
- Android system back dismisses open surfaces, then navigates document history.
  At the root it backgrounds the task. Going into the background flushes pending
  local edits; returning refreshes storage. OS force-stop is not a graceful save.

## Android

Install the [Tauri Android prerequisites](https://v2.tauri.app/start/prerequisites/#android):
JDK 17+, Android SDK platform 36, build tools 35/36 and NDK 28.2.13676358.
The checked-in application targets API 36 and supports API 26+; use a current
Android System WebView. No orientation or aspect-ratio lock is imposed, and
the activity allows tablet multi-window resizing.

```sh
rustup target add aarch64-linux-android x86_64-linux-android
npm ci
npm run android:dev
npm run android:build -- --debug --apk --target aarch64 --ci
```

Set `JAVA_HOME`, `ANDROID_HOME` and `NDK_HOME`. On Windows, the existing helper
locates Android Studio's JDK and the SDK under `%LOCALAPPDATA%`:

```powershell
powershell -File scripts/android.ps1 check
powershell -File scripts/android.ps1 dev
powershell -File scripts/android.ps1 build -DebugBuild -Target x86_64
```

The generated Android project is already checked in. Run `android:init` only when
setting up/regenerating it, and review the result to preserve `MainActivity.kt`
(insets and back navigation), the manifest and Gradle configuration. After a package
identifier change, stale generated Kotlin directories from the old identifier must
be moved out of the generated source tree before compiling.

## iOS / iPadOS

A Mac with Xcode and the [Tauri iOS prerequisites](https://v2.tauri.app/start/prerequisites/#ios)
is required. Windows can exercise responsive web behavior but cannot compile or
sign the iOS application.

The deployment floor is iOS/iPadOS 16.4, matching the shared workbench's modern
WebKit requirements (including `inert`, container queries and `color-mix`). The
former 15.0 setting did not cover those APIs; see the [WebKit release notes](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/).

```sh
npm ci
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
export APPLE_DEVELOPMENT_TEAM=YOUR_TEAM_ID
npm run ios:init
npm run ios:dev
npm run ios:build
```

Intel Macs use `x86_64-apple-ios` for the simulator. Keep signing credentials out
of the repository. Tauri merges `apps/client/src-tauri/Info.ios.plist` when generating
the Apple project. It enables phone portrait/landscape, all iPad orientations,
indirect input and iPad multitasking. Check that the generated Xcode target includes
both iPhone and iPad device families; do not hand-write `UIDeviceFamily` in the plist.

## Local validation

Run checks on the developer machine, as described in [local validation](local-validation.md):

```sh
npm run check
npm run test:mobile:browser
npm run test:native
npm run test:android -- x86_64
```

`test:mobile:browser` uses Playwright to cover 320/390px phones, phone landscape,
768px split view, 1180px tablets and desktop layout. It checks touch menus, outline,
drawer focus, single-page navigation, local editing, Android back dispatch and simulated
keyboard/safe-area geometry. This does not replace Safari/WKWebView or native IME
testing. Android native tests require an attached emulator/device plus SDK/NDK
environment variables. The lifecycle smoke accepts an explicit APK:

```powershell
npm run test:android:lifecycle -- -Serial emulator-5554 -ApkPath "path/to/app-universal-debug.apk"
```

Before release, exercise native Chinese composition, keyboard show/hide, rotations,
split view, external keyboard/trackpad, background/foreground, file import/export,
recycle recovery and app relaunch on Android and iPhone/iPad. Verify no keyboard or
system bar covers dialogs and that edits survive a normal background/foreground.

## Product boundaries

The local build has no network synchronization. Desktop-only MCP processes, native
CLI assistants and desktop provider integrations are not made available by changing
the layout. Mobile workspaces live in the application sandbox; arbitrary external
folder mounts through Android SAF or iOS security-scoped bookmarks are not supported.
Export/back up important documents before uninstalling the application. The browser
demo remains explicitly labeled and only saves its own browser copy.
