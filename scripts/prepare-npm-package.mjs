import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] ?? '@tano.page/mcp';
if (!['tano.page', '@tano.page/mcp'].includes(name))
  throw new Error('Unsupported publication name');
const source = JSON.parse(await readFile(join(root, 'apps/mcp/package.json'), 'utf8'));
const version = `${source.version}-alpha.2`;
const output = join(root, 'artifacts/npm', name.replace('@', '').replace('/', '-'), version);
await mkdir(output, { recursive: true });
await mkdir(join(output, 'bin'), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['apps/mcp/src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['@modelcontextprotocol/sdk/*', 'zod'],
  outfile: join(output, 'dist/tano-mcp.cjs'),
});
const manifest = {
  name,
  version,
  description:
    'Tano local Markdown workspace MCP server with conditional writes and activity records.',
  author: 'Zixi Wang',
  license: 'MIT',
  type: 'commonjs',
  bin: { tano: 'bin/tano.cjs', 'tano-mcp': 'bin/tano.cjs' },
  files: ['bin/', 'dist/', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'],
  engines: source.engines,
  dependencies: {
    '@modelcontextprotocol/sdk': source.dependencies['@modelcontextprotocol/sdk'],
    zod: source.dependencies.zod,
  },
  publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/', tag: 'next' },
  keywords: ['tano', 'markdown', 'mcp', 'workspace'],
};
await writeFile(join(output, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  join(output, 'bin/tano.cjs'),
  `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'mcp') process.argv.splice(2, 1);
const options = process.argv.slice(2);
if (options.includes('--help') || options.includes('-h')) {
  console.log('Tano local workspace MCP server\\n\\nUsage: tano [mcp] --workspace <folder> --data-dir <Tano app data>\\n\\nThe workspace must have been opened in Tano. The data directory must be outside the workspace.');
} else if (options.includes('--version') || options.includes('-v')) {
  console.log(require('../package.json').version);
} else {
  require('../dist/tano-mcp.cjs');
}
`,
  { mode: 0o755 },
);
await writeFile(
  join(output, 'README.md'),
  `# Tano / 同页

Tano - Humans and agents, on the same page.
同页 - 人与 Agent，在同一页工作。

This preview package provides Tano's working local MCP server. It is not the desktop application.
Requires Node.js 24.12 or later and a local workspace already opened in Tano.

## Run

\`\`\`sh
npx --package=${name}@${version} tano mcp --workspace /path/to/notes --data-dir /path/to/tano-app-data
\`\`\`

Use the workspace and application data paths shown by Tano's MCP connection panel.
The data directory must be outside the workspace. Keep the application data path
consistent with the desktop application to share activity records.

## MCP Client Configuration

\`\`\`json
${JSON.stringify({ mcpServers: { tano: { command: 'npx', args: ['--yes', `--package=${name}@${version}`, 'tano', 'mcp', '--workspace', '/path/to/notes', '--data-dir', '/path/to/tano-app-data'] } } }, null, 2)}
\`\`\`

Tools: \`tano_list_documents\`, \`tano_read_document\`, \`tano_write_document\`,
and \`tano_create_document\`. Writes require the SHA-256 returned by the previous
read; stale writes are rejected. Activity is stored in application data, while
Markdown remains ordinary workspace files. Commands, file deletion, and network
collaboration are not provided by this package.

Copyright (c) 2026 Zixi Wang. Released under the MIT License.
Third-party dependencies retain their own licenses.
`,
);
await writeFile(join(output, 'LICENSE'), await readFile(join(root, 'apps/mcp/LICENSE')));
console.log(`Prepared ${name}@${version}: ${output}`);

await writeFile(join(output, 'THIRD_PARTY_NOTICES.txt'), await readFile(join(root, 'apps/mcp/THIRD_PARTY_NOTICES.txt')));
