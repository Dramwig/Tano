import type { FileIconDefinition, FileIconTheme } from './types';

// Original Tano vectors, MIT. Match the workbench's quiet, rounded line icons
// while keeping file themes independent of the UI control icon library.
const glyph = (...paths: string[]): FileIconDefinition => ({
  color: 'currentColor', silhouette: 'none', paths,
});
const page = 'M11.5 2.5H5A1.5 1.5 0 0 0 3.5 4v12A1.5 1.5 0 0 0 5 17.5h10a1.5 1.5 0 0 0 1.5-1.5V7.5z M11.5 2.5V6a1.5 1.5 0 0 0 1.5 1.5h3.5';
const document = (...paths: string[]) => glyph(page, ...paths);
const code = () => glyph('M6 5.5 1.5 10 6 14.5 M14 5.5l4.5 4.5-4.5 4.5 M11.5 3.5l-3 13');
const table = () => glyph('M3.5 3.5h13a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z M2.5 8h15 M7.5 8v8.5 M12.5 8v8.5 M2.5 12.5h15');
const folder = (expanded = false, home = false): FileIconDefinition => glyph(
  expanded
    ? 'M2.5 8V5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h5.5A1.5 1.5 0 0 1 17 7 M2.5 8h14.8a1 1 0 0 1 .96 1.28l-1.8 6.2a1.5 1.5 0 0 1-1.44 1.02H4a1.5 1.5 0 0 1-1.5-1.5z'
    : 'M2.5 6V5A1.5 1.5 0 0 1 4 3.5h4l2 2h6A1.5 1.5 0 0 1 17.5 7v8A1.5 1.5 0 0 1 16 16.5H4A1.5 1.5 0 0 1 2.5 15z',
  ...(home ? ['M8 11h5 M8 13.5h3.5'] : []),
);

export const defaultFileIconTheme: FileIconTheme = {
  id: 'builtin:tano', label: '同页',
  file: 'file', folder: 'folder', folderExpanded: 'folder-open',
  folderHome: 'folder-home', folderHomeExpanded: 'folder-home-open',
  icons: {
    file: document(),
    folder: folder(), 'folder-open': folder(true),
    'folder-home': folder(false, true), 'folder-home-open': folder(true, true),
    markdown: document('M6.5 10.5h7 M6.5 13.5h5'),
    text: document('M6.5 8h2 M6.5 11h7 M6.5 14h7'),
    table: table(),
    image: glyph('M4 2.5h12A1.5 1.5 0 0 1 17.5 4v12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 16V4A1.5 1.5 0 0 1 4 2.5z',
      'M2.5 13.5 7 9l5 5 M10 12l3-3 4.5 4.5 M13.5 6a1 1 0 1 1-2 0 1 1 0 0 1 2 0'),
    audio: glyph('M8 14V4.5l8-2V12 M8 6.5l8-2', 'M8 14a2.5 2 0 1 1-5 0 2.5 2 0 0 1 5 0 M16 12a2.5 2 0 1 1-5 0 2.5 2 0 0 1 5 0'),
    video: glyph('M4 3.5h12A1.5 1.5 0 0 1 17.5 5v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15V5A1.5 1.5 0 0 1 4 3.5z', 'M8 7l5 3-5 3z'),
    archive: glyph('M3 3.5h14v4H3z M4 7.5v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8 M8 11h4'),
    pdf: document('M6.5 14.5c3-2 4.5-5.5 3-5.5-1.5 0 .5 6 3.5 4.5 M6.5 13.5h7'),
    word: document('M6.5 10l1.5 4 2-3 2 3 1.5-4'),
    spreadsheet: table(),
    slides: glyph('M2 3.5h16 M3.5 3.5V13h13V3.5 M10 13v3 M6.5 18l3.5-2 3.5 2 M7 7l5 2-5 2z'),
    javascript: code(), typescript: code(), vue: code(), react: code(),
    python: code(), rust: code(), go: code(), java: code(), code: code(),
    json: glyph('M7 3H5.5A1.5 1.5 0 0 0 4 4.5v3A2.5 2.5 0 0 1 2 10a2.5 2.5 0 0 1 2 2.5v3A1.5 1.5 0 0 0 5.5 17H7 M13 3h1.5A1.5 1.5 0 0 1 16 4.5v3a2.5 2.5 0 0 0 2 2.5 2.5 2.5 0 0 0-2 2.5v3a1.5 1.5 0 0 1-1.5 1.5H13'),
    config: glyph('M3 5h8 M15 5h2 M3 10h2 M9 10h8 M3 15h8 M15 15h2 M11 3v4 M5 8v4 M15 13v4'),
    html: glyph('M6.5 5.5 2 10l4.5 4.5 M13.5 5.5 18 10l-4.5 4.5'),
    css: glyph('M8 3 5 17 M15 3l-3 14 M3 7h14 M2 13h14'),
    shell: glyph('M3.5 5 8 9.5 3.5 14 M10 14h6.5'),
    database: glyph('M17 5c0 1.7-3.1 3-7 3S3 6.7 3 5s3.1-3 7-3 7 1.3 7 3z M3 5v10c0 1.7 3.1 3 7 3s7-1.3 7-3V5 M3 10c0 1.7 3.1 3 7 3s7-1.3 7-3'),
    font: glyph('M3 15 7.5 4 12 15 M5 11h5 M14 8h2a1.5 1.5 0 0 1 1.5 1.5V15 M17.5 11.5H15a1.75 1.75 0 0 0 0 3.5h2.5'),
    drawing: glyph('M4 13 13.5 3.5a2.1 2.1 0 0 1 3 3L7 16l-4 1z M11.5 5.5l3 3'),
    agents: glyph('M5 6.5h10A1.5 1.5 0 0 1 16.5 8v7a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5z M10 3.5v3 M1.5 10v3 M18.5 10v3 M7 10v1 M13 10v1 M7.5 14h5'),
    readme: glyph('M10 5C7.5 3 4.5 3 2.5 3.5v12c2-.5 5-.5 7.5 1.5 2.5-2 5.5-2 7.5-1.5v-12C15.5 3 12.5 3 10 5z M10 5v12'),
  },
  fileNames: { 'agents.md': 'agents', 'readme.md': 'readme', 'readme.markdown': 'readme',
    'dockerfile': 'config', 'makefile': 'shell', '.gitignore': 'config', '.env': 'config' },
  fileExtensions: {
    md: 'markdown', markdown: 'markdown', mdx: 'markdown', txt: 'text', log: 'text',
    'table.json': 'table', csv: 'table', tsv: 'table',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image', ico: 'image', bmp: 'image', heic: 'image',
    mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', m4a: 'audio',
    mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video',
    zip: 'archive', gz: 'archive', 'tar.gz': 'archive', tar: 'archive', rar: 'archive', '7z': 'archive', bz2: 'archive', xz: 'archive',
    pdf: 'pdf', doc: 'word', docx: 'word', odt: 'word', rtf: 'word',
    xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet', ppt: 'slides', pptx: 'slides', odp: 'slides',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', 'd.ts': 'typescript',
    jsx: 'react', tsx: 'react', vue: 'vue', py: 'python', rs: 'rust', go: 'go', java: 'java',
    c: 'code', h: 'code', cpp: 'code', cs: 'code', swift: 'code', kt: 'code', rb: 'code', php: 'code',
    json: 'json', jsonc: 'json', yaml: 'config', yml: 'config', toml: 'config', ini: 'config', env: 'config',
    html: 'html', htm: 'html', xml: 'html', css: 'css', scss: 'css', less: 'css',
    sh: 'shell', bash: 'shell', ps1: 'shell', bat: 'shell', cmd: 'shell',
    sql: 'database', db: 'database', sqlite: 'database', sqlite3: 'database',
    woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', excalidraw: 'drawing',
  },
};
