import { colorfulIcons } from './color-agent-icons';

// Bundled, provider-independent avatars. IDs are persisted in connection settings.
const designs = [
  ['robot', '机器人', '<rect x="4" y="7" width="16" height="14" rx="4"/><path d="M12 3v4M8 12v2m8-2v2m-7 4h6M1 12v5m22-5v5"/>'],
  ['cat', '猫咪', '<path d="M4 11V3l6 4h4l6-4v8a8 8 0 0 1-16 0Z M8 11v1m8-1v1m-6 4 2 2 2-2"/>'],
  ['owl', '猫头鹰', '<path d="m4 3 8 4 8-4v12a8 8 0 0 1-16 0Z"/><circle cx="8" cy="11" r="3"/><circle cx="16" cy="11" r="3"/><path d="m10 16 2 2 2-2"/>'],
  ['ghost', '小幽灵', '<path d="M5 21V10a7 7 0 0 1 14 0v11l-4-3-3 3-3-3Z M9 10v2m6-2v2"/>'],
  ['alien', '外星人', '<path d="M12 22S2 15 2 9a10 8 0 0 1 20 0c0 6-10 13-10 13Z M6 9l3 3H6Zm12 0-3 3h3Z M10 17h4"/>'],
  ['rocket', '火箭', '<path d="M9 15 5 11C8 5 14 2 21 3c1 7-2 13-8 16l-4-4Z M5 11l-3 1v6l5-1m6 2-1 3H6l1-5M3 21l3-3"/><circle cx="15" cy="9" r="2"/>'],
  ['planet', '星球', '<circle cx="12" cy="12" r="7"/><ellipse cx="12" cy="12" rx="12" ry="4" transform="rotate(-30 12 12)"/>'],
  ['star', '星星', '<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>'],
  ['sun', '太阳', '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>'],
  ['moon', '月亮', '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>'],
  ['cloud', '云朵', '<path d="M6 19a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11Z"/>'],
  ['bolt', '闪电', '<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>'],
  ['flame', '火苗', '<path d="M13 2c1 7 7 8 7 13a8 8 0 0 1-16 0c0-3 2-5 4-7 0 3 1 4 2 4 3-3 3-6 3-10Z"/>'],
  ['leaf', '绿叶', '<path d="M20 3C8 1 1 8 5 16s17 5 15-13Z M3 22 16 8"/>'],
  ['flower', '花朵', '<path d="M9 7C4 0 0 9 6 12c-6 3-2 12 3 5 0 8 6 8 6 0 5 7 9-2 3-5 6-3 2-12-3-5 0-8-6-8-6 0Z"/><circle cx="12" cy="12" r="3"/>'],
  ['gem', '宝石', '<path d="m3 8 4-5h10l4 5-9 13Z M3 8h18M7 3l5 18 5-18"/>'],
  ['cube', '方块', '<path d="m12 2 9 5v10l-9 5-9-5V7Z M3 7l9 5 9-5m-9 5v10"/>'],
  ['compass', '指南针', '<circle cx="12" cy="12" r="10"/><path d="m16 8-2 6-6 2 2-6Z"/>'],
  ['book', '书本', '<path d="M12 5C8 2 5 2 2 3v16c3-1 6-1 10 2 4-3 7-3 10-2V3c-3-1-6-1-10 2Zm0 0v16"/>'],
  ['pencil', '铅笔', '<path d="m15 3 6 6-12 12H3v-6Z M12 6l6 6M3 15l6 6"/>'],
  ['code', '代码', '<path d="m7 6-6 6 6 6m10-12 6 6-6 6M14 3l-4 18"/>'],
  ['puzzle', '拼图', '<path d="M4 4h5a3 3 0 1 1 6 0h5v5a3 3 0 1 0 0 6v5h-5a3 3 0 1 0-6 0H4v-5a3 3 0 1 1 0-6Z"/>'],
  ['music', '音符', '<path d="M9 18V5l12-3v13M9 9l12-3"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="15" rx="3" ry="3"/>'],
  ['heart', '爱心', '<path d="M12 21 3 12C-3 5 7-2 12 6c5-8 15-1 9 6Z"/>'],
] as const;

const outlineIcons = designs.map(([name, label, drawing]) => ({
  id: `agent-${name}`,
  label,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${drawing}</svg>`,
}));

const palettes = [
  ['#e0e7ff', '#4338ca'], ['#fce7f3', '#be185d'], ['#d1fae5', '#047857'],
  ['#ffedd5', '#c2410c'], ['#e0f2fe', '#0369a1'], ['#f3e8ff', '#7e22ce'],
] as const;

// Symmetric pixel faces use fixed patterns so saved avatars never change on reload.
const pixelFaces = [
  ['0010100', '0111110', '1101011', '1111111', '0100010', '0111110', '0100010'],
  ['1000001', '1100011', '1111111', '1011101', '1111111', '0110110', '0011100'],
  ['0011100', '0111110', '1101011', '1101011', '1111111', '0101010', '1000001'],
  ['0001000', '0011100', '0111110', '1101011', '1111111', '0110110', '0100010'],
  ['0100010', '1111111', '1011101', '1011101', '1111111', '0011100', '0110110'],
  ['0011100', '0111110', '1111111', '1001001', '1111111', '0101010', '1100011'],
  ['1000001', '1011101', '1111111', '1101011', '0111110', '0011100', '0100010'],
  ['0101010', '0111110', '1111111', '1010101', '1111111', '0111110', '0101010'],
  ['0011100', '1111111', '0101010', '1111111', '1100011', '0111110', '0010100'],
  ['0001000', '1101011', '1111111', '1011101', '1111111', '0110110', '1100011'],
  ['0111110', '1101011', '1101011', '1111111', '1011101', '1000001', '0100010'],
  ['0100010', '0011100', '1111111', '1011101', '1111111', '0101010', '0011100'],
];
const pixelIcons = pixelFaces.map((rows, index) => {
  const [background, foreground] = palettes[index % palettes.length]!;
  const pixels = rows.flatMap((row, y) => Array.from(row, (pixel, x) =>
    pixel === '1' ? `<rect x="${x + 1}" y="${y + 1}" width="1" height="1"/>` : '',
  )).join('');
  return {
    id: `agent-pixel-${index + 1}`,
    label: `Pixel ${index + 1}`,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9" shape-rendering="crispEdges"><rect width="9" height="9" fill="${background}"/><g fill="${foreground}">${pixels}</g></svg>`,
  };
});

export const agentIconOptions = [...outlineIcons, ...colorfulIcons, ...pixelIcons];
