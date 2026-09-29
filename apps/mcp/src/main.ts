import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AgentWorkspace } from './workspace';
import { createAgentServer } from './server';

async function main() {
  const { values } = parseArgs({
    options: { workspace: { type: 'string' }, 'data-dir': { type: 'string' } },
    strict: true,
  });
  if (!values.workspace || !values['data-dir'])
    throw new Error('Usage: node tano-mcp.cjs --workspace <folder> --data-dir <Tano app data>');
  const workspace = new AgentWorkspace(values.workspace, values['data-dir']);
  const server = createAgentServer(workspace);
  const transport = new StdioServerTransport();
  server.server.onclose = () => workspace.close();
  await server.connect(transport);
}
void main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
