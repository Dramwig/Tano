# 同页助手入口验证

Date: 2026-10-10. Tested base: `3079a1a` plus the current working tree.

## Final design

The butterfly is a reusable `packages/workbench/src/components/AssistantButterfly.vue` component. It owns the inline SVG, independently addressable wing groups, theme color, accessibility, and posture animations. `AssistantLauncher.vue`, `AssistantPanel.vue` and the page flight layer reuse it; the old SVG image has been removed to avoid duplicate sources. Its props are `size` (default 36), `motion` (`breathe`, `fly`, `perch` or `none`), and optional accessible `label`. The original two wing paths, 32 × 32 viewBox, 1.5px strokes, and optical origin (0.2, -2) are preserved.

The launcher uses a 54px circular surface on desktop and 50px in narrow windows, with a fine neutral border and light shadow. The butterfly is 36px on desktop and 32px in narrow windows. Hover scales the button to 1.06 around its center over 200ms. The docked butterfly breathes on an unchanged 8-second cycle: wing scale is 0.98–1 with only ±0.6 degrees of rotation; overall scale is 0.99–1.01. Its -6 degree tilt stays fixed and vertical drift is removed.

The launcher now has a right-click / Shift+F10 perch menu. A single pointer-transparent layer takes the butterfly outside its button and scroll containers. The controller supports an arc flight, hover, landing, tracking and return. Breadcrumb, document-actions button and selected rich-editor text targets are wired up. A native-element directive lets other components register targets with lifecycle cleanup, while ephemeral ProseMirror anchors map text positions through edits without changing Markdown or undo history. Scope follows workspace, pane and document; hidden, removed, clipped or occluded targets trigger a return. Clicking the empty home button or pressing Escape returns it; ordinary clicks when docked still open the assistant. Full API details are in [the component guide](packages/workbench/src/assets/assistant/README.md).

## Browser verification

Codex in-app browser, local browser demo at `http://127.0.0.1:43841/p/demo-zh-cn/138523`. The verification used a separate tab so the user's open assistant draft remained intact.

Verified the shared component in the launcher, sidebar and floating welcome screen at 1280 × 720, plus dark mode with reduced motion at 390 × 844. The decorative launcher SVG is hidden from assistive technology, while the welcome SVG exposes the image name “同页助手”. Clicking the launcher still focuses the task input. All three animation names resolve to `none` with reduced motion enabled in both usages.

| Check | Result |
| --- | --- |
| Page identity and content | Correct title and document; no framework overlay. |
| Desktop layout | 1280 × 720 CSS px, device pixel ratio 1. Button at x1202/y646, 54 × 54, 24px from right and 20px from bottom. |
| Hover | Actual pointer movement produces transform scale(1.06) and a 57.24 × 57.24px button, with its center unchanged. Tooltip appears and clicking still opens the assistant. |
| Narrow layout | 390 × 844 CSS px, device pixel ratio 1. Button at x322/y780, 50 × 50; mark is 32px with no horizontal overflow. |
| Interaction | Clicking the butterfly opens the existing assistant, retains current-document context and focuses “给助手的任务”. Collapsing restores the launcher. |
| Dark theme | Shared component uses `currentColor` from `--text`, which resolves to rgb(232, 234, 237) in dark mode. No inversion filter is needed; page filter remains `none`. |
| Breathing animation and centering | Browser computed style still confirms the 8-second animation. Before the proportional size reduction, 20 frames at 400ms intervals placed the dark-stroke centroid within 0.21px horizontally and 0.58px vertically of the button center. The centering and breathing parameters are unchanged. |
| Reduced motion | Button transitions and all three component animations resolve to `none`; the static optical placement remains intact. |
| Console | No application errors. Existing Mermaid syntax-highlighter warning in the demo only. |

### Flight and perching verification

| Check | Result |
| --- | --- |
| Component destinations | Right-click lists the current breadcrumb and document-actions button. Both fly and settle successfully; the button's `aria-expanded` remains false, so flying does not activate the destination. |
| Text destination | Selecting “Markdown ” in the rich editor enables the text command. The butterfly settles above that word and the empty home circle stays in place. |
| Scroll tracking | Scrolling 30px moved both the text rectangle and butterfly by 30px. Scrolling the selected text out of view returned the butterfly and removed the flight layer. |
| Return | Clicking the home circle restores the docked butterfly. The layer disappears after the return; normal click then opens the existing assistant input. |
| Narrow / reduced motion | At 390 × 844, in dark mode, Shift+F10 opens the menu. Choosing a target moves directly to the perched phase; the actor is 32px and every wing animation resolves to `none`. No horizontal overflow. |
| Automatic lifecycle checks | Unit tests cover retarget cancellation, scope isolation, target removal, stale registrations, temporary-anchor cleanup, geometry clipping/occlusion and text-position mapping through edits. |

## Visual evidence

- `%TEMP%/tano-assistant-centering/butterfly-flight.gif`: 28 actual browser frames at 120ms intervals, showing text flight, perching and return.
- `%TEMP%/tano-assistant-centering/flight-text-final.png`: selected-text perch in the current implementation.
- `%TEMP%/tano-assistant-centering/flight-button.png`: document-actions button perch without opening its menu.
- `%TEMP%/tano-assistant-centering/flight-mobile-reduced.png`: narrow dark-mode perch with reduced motion.
- `%TEMP%/tano-assistant-centering/component-launcher.png`: latest desktop rendering of the reusable component.
- `%TEMP%/tano-assistant-centering/component-welcome.png`: same component in the floating welcome screen.
- `%TEMP%/tano-assistant-centering/component-dark-reduced.png`: latest dark narrow viewport with all animation disabled.
- `%TEMP%/tano-assistant-centering/compact-hover.png` and `compact-hover-detail.png`: earlier hover check; button interaction is unchanged.
- `%TEMP%/tano-assistant-centering/butterfly-calm.gif`: earlier 8-second breathing loop before the size reduction, assembled from 20 actual screenshots at 400ms intervals.
- `%TEMP%/tano-assistant-centering/mobile-reduced-motion.png`: earlier reduced-motion check; motion parameters remain unchanged.

The old reference supplied the placement and minimal visual weight; the user's final butterfly instruction determines the shape. Typography and Chinese tooltip copy remain consistent with the product. The SVG stays crisp at the 36px desktop and 32px narrow display sizes, has no background rectangle, and uses existing paper/border tokens for its containing button.

## Fixes during verification

The component now owns both the SVG paths and CSS animations directly, so callers no longer manage external image imports, inversion filters or duplicate motion rules. Reduced-motion selectors were checked against the animated wing selectors to ensure the cascade stops every animation.

## Local validation

- `npm run check` passed on `3079a1a` plus the current working tree: 217 test files, 1851 tests passed and 1 skipped; TypeScript, production and MCP builds, documentation links and public dependency boundaries passed. Existing bundle-size warning remains.
- The new controller, geometry and editor-anchor tests passed alongside the existing assistant-panel regression tests.
- `git diff --check`: passed.
- `npm run docs:check`: 46 Markdown files checked, no missing link targets (also included in the full check).
- Native packaging and real model requests were not exercised. Existing unrelated working-tree edits remain intact.

final result: passed
