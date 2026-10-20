import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AgentWorkspace } from './workspace';
import { createAgentServer } from './server';

async function main() {
  const { values } = parseArgs({
    options: { workspace: { type: 'string' }, 'data-dir': { type: 'string' }, access: { type: 'string', default: 'review' }, directory: { type: 'string', multiple: true }, 'object-type': { type: 'string', multiple: true } },
    strict: true,
  });
  if (!values.workspace || !values['data-dir'])
    throw new Error('Usage: node tano-mcp.cjs --workspace <folder> --data-dir <Tano app data>');
  if (!['read', 'review', 'write'].includes(values.access)) throw new Error('--access must be read, review or write');
  const workspace = new AgentWorkspace(values.workspace, values['data-dir'], { access: values.access as 'read' | 'review' | 'write', directories: values.directory ?? [''], objectTypes: values['object-type'] ?? ['task', 'project', 'experiment', 'person', 'event'] });
  const server = createAgentServer(workspace);
  const transport = new StdioServerTransport();
  server.server.onclose = () => workspace.close();
  await server.connect(transport);
}
void main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
