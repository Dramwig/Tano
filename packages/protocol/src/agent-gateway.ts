import type { ObjectViewQuery } from './view-engine';
import type { WorkspaceObject } from './objects';
import type { DataField, DataRow, DataView } from './data-tables';
import type { CellResult } from './data-table-query';
import type { WorkspaceRelation } from './relations';
import type { FileDatabaseQuery } from './file-database';
import type { FileMetadata } from './file-metadata';

export const AGENT_GATEWAY_VERSION = 1;
/** Set by the host process, never by workspace content or tool arguments. */
export interface AgentGatewayPolicy {
  access: 'read' | 'review' | 'write';
  /** Public-file directory prefixes. An empty prefix authorizes the whole workspace. */
  directories: string[];
  /** Independently authorized semantic record types. */
  objectTypes: string[];
}
export interface GatewayRevision {
  workspaceId: string;
  fileId: string;
  path: string;
  sha256: string;
}
export interface GatewayPage<T> { items: T[]; total: number; nextOffset: number | null }
export interface GatewayFileSnapshot extends GatewayRevision { encoding: 'utf8' | 'base64'; content: string }
export interface GatewayFileInfo extends GatewayRevision { size: number; modified: number; handler: string; metadata: FileMetadata; metadataHash: string | null }
export interface GatewayObjectSnapshot extends GatewayRevision { object: WorkspaceObject }
export interface GatewayTablePage extends GatewayRevision, GatewayPage<DataRow & { computed: Record<string, CellResult> }> {
  tableId: string; name: string; fields: DataField[]; view: DataView;
}
export interface GatewayEdit {
  /** Existing resources must use the ID and hash returned by a read. */
  fileId?: string;
  path: string;
  expectedHash: string | null;
  content: string;
  reason: string;
}
export interface GatewayBatch {
  operationId: string;
  edits: GatewayEdit[];
}
export interface GatewayOperation {
  operationId: string;
  atomic: false;
  written: boolean;
  items: { proposalId: string; status: string; written: boolean }[];
}
/** Transport-neutral SDK. The transport returns decoded tool JSON or rejects on isError. */
export class AgentGatewayClient {
  constructor(private readonly call: (name: string, args: Record<string, unknown>) => Promise<unknown>) {}
  static fromMcp(client: { callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<unknown> }) {
    return new AgentGatewayClient(async (name, args) => {
      const response = await client.callTool({ name, arguments: args }) as { isError?: boolean; content?: { type: string; text?: string }[] };
      const body = response.content?.find(item => item.type === 'text')?.text;
      if (!body || response.isError) throw new Error(body ?? 'Gateway returned no result');
      return JSON.parse(body);
    });
  }
  capabilities() { return this.call('tano_gateway_capabilities', {}) as Promise<{ version: number; workspaceId: string; policy: AgentGatewayPolicy; batchAtomic: false }> ; }
  files(query = '', offset = 0, limit = 100, database?: FileDatabaseQuery) { return this.call('tano_query_files', { query, offset, limit, database }) as Promise<GatewayPage<GatewayFileInfo> & { complete: boolean; errors: { path: string; error: string }[] }>; }
  read(fileId: string) { return this.call('tano_read_file', { fileId }) as Promise<GatewayFileSnapshot>; }
  objects(query?: ObjectViewQuery, offset = 0, limit = 100) { return this.call('tano_query_objects', { query, offset, limit }) as Promise<GatewayPage<GatewayObjectSnapshot>>; }
  table(fileId: string, viewId?: string, offset = 0, limit = 100) { return this.call('tano_query_table', { fileId, viewId, offset, limit }) as Promise<GatewayTablePage>; }
  relations() { return this.call('tano_query_relations', {}) as Promise<{ workspaceId: string; sha256: string | null; relations: WorkspaceRelation[] }>; }
  propose(batch: GatewayBatch) { return this.call('tano_propose_changes', { ...batch }) as Promise<GatewayOperation>; }
  operation(operationId: string) { return this.call('tano_get_operation', { operationId }) as Promise<GatewayOperation>; }
  activity(offset = 0, limit = 100) { return this.call('tano_list_activity', { offset, limit }); }
  activityEntry(id: string) { return this.call('tano_read_activity', { id }); }
}
