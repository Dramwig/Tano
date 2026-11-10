import type { ColorThemeDefinition, ColorTokens } from '@tano/protocol';

/** The few values a designer chooses; the remaining contract tokens are derived consistently. */
interface Base {
  desk: string; paper: string; surface: string; raised: string; hover: string;
  text: string; secondary: string; muted: string; line: string; strong: string;
  selected: string; selectedText: string; brand: string; brandHover: string; fill: string; fillHover: string;
  onAccent?: string; highlight: string; backdrop: string; purple: string; blue: string; teal: string; green: string; orange: string; red: string;
  danger: string; dangerBg: string; warning: string; warningBg: string; addBg: string; removeBg: string; thumb: string; thumbHover: string;
}

const palette = (b: Base): ColorTokens => ({
  paper: b.paper, sidebar: b.desk, surface: b.surface, 'surface-raised': b.raised, hover: b.hover,
  text: b.text, 'text-secondary': b.secondary, muted: b.muted,
  line: b.line, 'line-strong': b.strong, 'control-border': b.strong,
  selected: b.selected, 'selected-text': b.selectedText, selection: b.selected, 'block-selection': b.selected, accent: b.surface,
  green: b.brand, 'green-hover': b.brandHover, 'green-fill': b.fill, 'green-fill-hover': b.fillHover, 'on-accent': b.onAccent ?? '#ffffff',
  danger: b.danger, 'danger-bg': b.dangerBg, warning: b.warning, 'warning-bg': b.warningBg, 'warning-border': b.strong, 'switch-off': b.strong,
  'syntax-purple': b.purple, 'syntax-red': b.red, 'syntax-blue': b.blue, 'syntax-orange': b.orange, 'syntax-teal': b.teal, 'syntax-green': b.green,
  'highlight-bg': b.highlight, 'suggestion-color': b.brand, 'diff-add-bg': b.addBg, 'diff-remove-bg': b.removeBg, 'quote-border': b.strong,
  'scrollbar-thumb': b.thumb, 'scrollbar-thumb-hover': b.thumbHover, backdrop: b.backdrop,
});

/**
 * Host-owned palettes that ship with the built-in presets. Each one is designed together with its layout:
 * a recessed "desk" (sidebar token), a brighter "page" (paper token) and one confident brand colour.
 */
export const builtinColors: ColorThemeDefinition[] = [
  {
    // Card islands: cool blue-grey desk, crisp white cards, calm indigo.
    id: 'builtin:mist', label: '雾岛',
    light: palette({
      desk: '#e9edf3', paper: '#ffffff', surface: '#f4f6fa', raised: '#ffffff', hover: '#e6ebf3',
      text: '#1f2733', secondary: '#4a5568', muted: '#66738a', line: '#e0e6ee', strong: '#b7c2d3',
      selected: '#e4eafb', selectedText: '#243b8f', brand: '#3f5bd8', brandHover: '#2f49bd', fill: '#3f5bd8', fillHover: '#3249c0',
      highlight: '#ffe58a', backdrop: '#1b263a55', purple: '#6d3fc0', blue: '#2f5fd0', teal: '#0b7a75', green: '#2f7d3a', orange: '#b25b00', red: '#c0392b',
      danger: '#b3261e', dangerBg: '#fdeceb', warning: '#7a4b00', warningBg: '#fff4d6', addBg: '#e3f5e8', removeBg: '#fde8e6', thumb: '#b4bfd0', thumbHover: '#8f9db3',
    }),
    dark: palette({
      desk: '#12151a', paper: '#1b1f27', surface: '#232833', raised: '#2a303c', hover: '#2e3542',
      text: '#e5e9f0', secondary: '#b6bfcd', muted: '#8f9aad', line: '#2a303b', strong: '#475165',
      selected: '#27325a', selectedText: '#d3dcff', brand: '#9fb2ff', brandHover: '#bcc9ff', fill: '#4b62dc', fillHover: '#6277ea',
      highlight: '#6b5a14', backdrop: '#000000aa', purple: '#d2b6ff', blue: '#9db8ff', teal: '#8fe0d8', green: '#a8e09a', orange: '#ffbe85', red: '#ff9d94',
      danger: '#ffb4ac', dangerBg: '#40181a', warning: '#ffe0a3', warningBg: '#372d16', addBg: '#1f3a2a', removeBg: '#412426', thumb: '#475165', thumbHover: '#66728a',
    }),
  },
  {
    // Paper: a warm sand desk, an off-white sheet that is easy on the eyes, and fountain-pen ink.
    id: 'builtin:ink', label: '纸墨',
    light: palette({
      desk: '#ebe6dc', paper: '#fbf8f2', surface: '#f4efe5', raised: '#fffdf8', hover: '#e9e3d7',
      text: '#2b2722', secondary: '#514a40', muted: '#6c6458', line: '#e4ded2', strong: '#bfb6a5',
      selected: '#e6e0d2', selectedText: '#2b2722', brand: '#24508a', brandHover: '#1a3f70', fill: '#24508a', fillHover: '#1c4377',
      highlight: '#fbe39c', backdrop: '#2a241b55', purple: '#6a3d9a', blue: '#24508a', teal: '#0b6b66', green: '#3b6e1f', orange: '#a5540a', red: '#a8321f',
      danger: '#a8281e', dangerBg: '#fbece6', warning: '#6e4300', warningBg: '#fbf0d4', addBg: '#e6f0e0', removeBg: '#f8e6df', thumb: '#c4bba9', thumbHover: '#9e9582',
    }),
    dark: palette({
      desk: '#151310', paper: '#1e1b17', surface: '#26231e', raised: '#2d2924', hover: '#332f28',
      text: '#e8e2d6', secondary: '#c0b8a9', muted: '#9a9284', line: '#2f2b25', strong: '#524b40',
      selected: '#37312a', selectedText: '#f2ecdf', brand: '#9dbbe4', brandHover: '#b8cfee', fill: '#3d68a8', fillHover: '#4e7abb',
      highlight: '#625216', backdrop: '#000000aa', purple: '#d3b8f5', blue: '#9dbbe4', teal: '#93e0d6', green: '#b3dc92', orange: '#ffc189', red: '#ffa99c',
      danger: '#ffb4ac', dangerBg: '#40201a', warning: '#ffe0a3', warningBg: '#37301a', addBg: '#24362a', removeBg: '#412622', thumb: '#524b40', thumbHover: '#70685a',
    }),
  },
  {
    // Eye care: a muted bean-green page instead of bright white, softened (not pure black) text,
    // and a deep leaf-green accent so there is little saturated blue on screen for long reading sessions.
    id: 'builtin:sage', label: '护眼绿',
    light: palette({
      desk: '#d3e2ca', paper: '#e3eedb', surface: '#d9e7d1', raised: '#eaf3e4', hover: '#cfdec6',
      text: '#26302a', secondary: '#44504a', muted: '#58645b', line: '#cbdac2', strong: '#a3b598',
      selected: '#c8ddbd', selectedText: '#1f3a24', brand: '#2f6b3d', brandHover: '#24572f', fill: '#2f6b3d', fillHover: '#285e34',
      highlight: '#f1df8a', backdrop: '#1c2a1f55', purple: '#6b4596', blue: '#2d5f8a', teal: '#0d6b60', green: '#3a6d1e', orange: '#955006', red: '#a3352a',
      danger: '#a32a20', dangerBg: '#f3e2da', warning: '#664300', warningBg: '#f0e9c6', addBg: '#cfe6c4', removeBg: '#f0dcd3', thumb: '#a9bba0', thumbHover: '#8a9d80',
    }),
    dark: palette({
      desk: '#141813', paper: '#1c211b', surface: '#232a22', raised: '#2a3128', hover: '#2f372d',
      text: '#dbe3d2', secondary: '#b6c0ab', muted: '#8f9a85', line: '#2b3329', strong: '#4a5545',
      selected: '#2f3f2d', selectedText: '#e3eed8', brand: '#a5d29b', brandHover: '#bfe2b6', fill: '#4a7a43', fillHover: '#5a8b52',
      highlight: '#5e5418', backdrop: '#000000aa', purple: '#cdb6ec', blue: '#a3c3de', teal: '#93d8cc', green: '#b6dc94', orange: '#f2c08a', red: '#f2a89c',
      danger: '#ffb4ac', dangerBg: '#3d1f1a', warning: '#f0dca0', warningBg: '#33301a', addBg: '#25392a', removeBg: '#3f2622', thumb: '#4a5545', thumbHover: '#66725f',
    }),
  },
];
