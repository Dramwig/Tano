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
    // Classic notebook: tan desk, cream leaves, saddle-leather accent.
    id: 'builtin:leather', label: '皮革',
    light: palette({
      desk: '#dfd2bb', paper: '#fcf6e8', surface: '#f4ebd6', raised: '#fffaf0', hover: '#ebdfc6',
      text: '#3a2b1f', secondary: '#5c4735', muted: '#7a634e', line: '#dccdae', strong: '#b09873',
      selected: '#ecdcb9', selectedText: '#3a2b1f', brand: '#8b4a26', brandHover: '#6f3a1c', fill: '#7d4121', fillHover: '#663318',
      highlight: '#ffe08a', backdrop: '#2a1a0e55', purple: '#6f3f8f', blue: '#2f5a85', teal: '#17695f', green: '#4c6b1f', orange: '#a1520b', red: '#a83224',
      danger: '#a3281c', dangerBg: '#fdeee8', warning: '#6e4300', warningBg: '#fff2d2', addBg: '#e6f1dd', removeBg: '#fbe6df', thumb: '#b09873', thumbHover: '#8d7653',
    }),
    dark: palette({
      desk: '#17120e', paper: '#241d16', surface: '#2e251c', raised: '#382d22', hover: '#3b3025',
      text: '#f0e4cd', secondary: '#cdbc9e', muted: '#a8967a', line: '#41342a', strong: '#6e5a42',
      selected: '#45362a', selectedText: '#f6e8cf', brand: '#e4a977', brandHover: '#f0bf94', fill: '#a95f33', fillHover: '#bf7142',
      highlight: '#6b5413', backdrop: '#000000aa', purple: '#d9b4f0', blue: '#a6c6e8', teal: '#9fe0d3', green: '#bfe08f', orange: '#ffc48a', red: '#ffab9c',
      danger: '#ffb4a6', dangerBg: '#431a14', warning: '#ffe0a3', warningBg: '#38301a', addBg: '#25392a', removeBg: '#432620', thumb: '#6e5a42', thumbHover: '#8c7556',
    }),
  },
  {
    // Paper document: neutral warm-grey desk, bright page, ink-blue accent.
    id: 'builtin:ink', label: '墨纸',
    light: palette({
      desk: '#e6e4df', paper: '#fffffc', surface: '#f6f4ef', raised: '#ffffff', hover: '#ebe8e1',
      text: '#23211d', secondary: '#4b4741', muted: '#69645b', line: '#dedad1', strong: '#b9b3a6',
      selected: '#e3e8f1', selectedText: '#17407a', brand: '#1d4f91', brandHover: '#143c71', fill: '#1d4f91', fillHover: '#163f75',
      highlight: '#ffe58a', backdrop: '#1d1f2455', purple: '#6a3d9a', blue: '#1d4f91', teal: '#0b6b66', green: '#3b6e1f', orange: '#a5540a', red: '#a8321f',
      danger: '#a8281e', dangerBg: '#fdeeeb', warning: '#6e4300', warningBg: '#fff3d6', addBg: '#e4f2e6', removeBg: '#fbe7e3', thumb: '#b9b3a6', thumbHover: '#968f80',
    }),
    dark: palette({
      desk: '#131312', paper: '#1d1d1b', surface: '#252523', raised: '#2c2c29', hover: '#31312e',
      text: '#e8e6e0', secondary: '#bdb9b0', muted: '#96928a', line: '#2d2d2a', strong: '#4d4c47',
      selected: '#27324a', selectedText: '#d6e3fa', brand: '#8fb4ea', brandHover: '#aecbf4', fill: '#3c6cb4', fillHover: '#4f80ca',
      highlight: '#665514', backdrop: '#000000aa', purple: '#d3b8f5', blue: '#9dbdf0', teal: '#93e0d6', green: '#b3dc92', orange: '#ffc189', red: '#ffa99c',
      danger: '#ffb4ac', dangerBg: '#401a18', warning: '#ffe0a3', warningBg: '#37301a', addBg: '#22392a', removeBg: '#412522', thumb: '#4d4c47', thumbHover: '#6b6a63',
    }),
  },
];
