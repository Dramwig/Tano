# Button tooltips

Mount `AppTooltip` once in each window root. The workbench and separate settings
window already do this. Its delegated listeners also cover dynamically inserted
controls, teleported menus and native modal dialogs.

Use `data-tooltip` instead of `title` on buttons. Keep the accessible name on
icon-only buttons:

```vue
<button :aria-label="t('斜体')" :data-tooltip="t('斜体')"
  data-tooltip-shortcut="Mod+I">
  <Italic :size="17" aria-hidden="true" />
</button>
```

`data-tooltip-shortcut` accepts the application's shortcut binding format and
renders on a second line, using Ctrl or ⌘ for the current platform. Bind it to
the user's current shortcut preference for configurable actions; omit it when
the action has no shortcut. Empty `data-tooltip` values suppress the hint.

The component handles pointer hover, keyboard focus, disabled-button explanations,
Escape, scrolling, viewport boundaries, long descriptions, dynamic text and
removed controls. Existing `aria-describedby` relationships are preserved.
Avoid adding a native `title` alongside it, which would produce duplicate hints.
For tall resize handles, set `data-tooltip-anchor="pointer"` to place the hint
beside the pointer; keyboard focus falls back to the handle's midpoint.
Use `data-tooltip-delay="700"` on easily crossed controls to require a longer
hover (in milliseconds). Leaving or pressing cancels the pending hint; keyboard
focus still shows it immediately. Other controls default to 250 milliseconds.
Specialized interactive help panels can keep their own interaction model.
