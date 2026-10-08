export const ASSISTANT_PROTOCOL_VERSION = 7;

export interface AssistantConnection {
  id: string;
  name: string;
  kind?: 'api' | 'codex-cli' | 'claude-cli';
  cliPath?: string;
  endpoint: string;
  protocol?: 'chat-completions' | 'responses';
  autoAdapt?: boolean;
  tools: boolean;
  maxOutputTokens: number;
  hasKey: boolean;
}

export interface AssistantSource {
  id: string;
  workspaceId: string;
  fileId: string;
  path: string;
  content: string;
  hash: string;
  origin: 'draft' | 'disk';
  selection?: { text: string; from?: number; to?: number };
}

export type AssistantProposalStatus = 'ready' | 'applying' | 'applied' | 'rejected' | 'conflicted' | 'unknown';
export interface AssistantPreview {
  before: string;
  after: string;
  diskHash: string | null;
  path: string;
}
export interface AssistantProposal {
  id: string;
  runId: string;
  workspaceId: string;
  kind: 'edit' | 'create' | 'object' | 'relation';
  fileId?: string;
  path: string;
  base: string;
  content: string;
  reason: string;
  status: AssistantProposalStatus;
  preview?: AssistantPreview;
  applied?: { before: string; after: string; hash: string; fileId: string };
  error?: string;
  /** Once published, per-edit review belongs to the portable document records. */
  suggestionGroupId?: string;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  sources?: AssistantSource[];
  proposals?: AssistantProposal[];
  usage?: { input: number; output: number };
  state?: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
  error?: string;
  model?: string;
  rules?: string[];
  timing?: { firstContentMs?: number; totalMs: number };
}

export interface AssistantSession {
  version: 1;
  id: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  messages: AssistantMessage[];
  connectionId?: string;
  model?: string;
  external?: boolean;
}

export interface AssistantToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface AssistantWireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: AssistantToolCall[];
  tool_call_id?: string;
  /** Transient Responses output, including reasoning needed by the next tool round. */
  responseItems?: Record<string, unknown>[];
}
export interface AssistantRequest {
  model: string;
  messages: AssistantWireMessage[];
  tools?: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
}
export interface AssistantTransport {
  connections(): Promise<AssistantConnection[]>;
  models(connectionId: string, signal: AbortSignal): Promise<string[]>;
  saveConnection(connection: Omit<AssistantConnection, 'hasKey'>, key?: string): Promise<void>;
  removeConnection(id: string): Promise<void>;
  request(connectionId: string, request: AssistantRequest, signal: AbortSignal, chunk: (bytes: Uint8Array) => void): Promise<void>;
  loadSessions(workspaceId: string): Promise<AssistantSession[]>;
  saveSession(session: AssistantSession): Promise<number>;
  deleteSession(workspaceId: string, id: string, expectedRevision: number): Promise<void>;
  loadExternalSessions?(workspaceId: string): Promise<AssistantSession[]>;
  recordExternalResult?(session: AssistantSession): Promise<void>;
  readonly demo?: boolean;
}

export function isAssistantModelId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

/** Validate persisted data before allowing it back into execution or review. */
export function parseAssistantSession(value: unknown): AssistantSession {
  const session = value as AssistantSession;
  const text = (value: unknown, limit: number) => typeof value === 'string' && value.length <= limit;
  if (!session || session.version !== 1 || !text(session.id, 80) || !/^[a-z0-9-]{8,80}$/i.test(session.id) ||
      !text(session.workspaceId, 120) || !text(session.title, 200) ||
      !Number.isFinite(session.createdAt) || !Number.isFinite(session.updatedAt) ||
      !Number.isSafeInteger(session.revision) || session.revision < 0 ||
      (session.connectionId !== undefined && (!text(session.connectionId, 80) || !session.connectionId.trim())) ||
      (session.model !== undefined && !isAssistantModelId(session.model)) ||
      !Array.isArray(session.messages) || session.messages.length > 300 || (session.external !== undefined && typeof session.external !== 'boolean'))
    throw new Error('助手会话格式无效，原记录已保留');
  const ids = new Set<string>();
  for (const message of session.messages) {
    if (!message || !text(message.id, 80) || ids.has(message.id) ||
        !['user', 'assistant'].includes(message.role) || !text(message.content, 1_000_000) ||
        !Number.isFinite(message.createdAt) ||
        (message.state && !['running', 'completed', 'cancelled', 'failed', 'interrupted'].includes(message.state)) ||
        (message.sources && (!Array.isArray(message.sources) || message.sources.length > 30)) ||
        (message.proposals && (!Array.isArray(message.proposals) || message.proposals.length > 30)) ||
        (message.timing !== undefined && (!message.timing || Array.isArray(message.timing) || !Number.isFinite(message.timing.totalMs) || message.timing.totalMs < 0 ||
          (message.timing.firstContentMs !== undefined && (!Number.isFinite(message.timing.firstContentMs) ||
            message.timing.firstContentMs < 0 || message.timing.firstContentMs > message.timing.totalMs)))) ||
        (message.rules && (!Array.isArray(message.rules) || message.rules.length > 2 || message.rules.some(path => !text(path, 220)))))
      throw new Error('助手消息格式无效，原记录已保留');
    ids.add(message.id);
    for (const source of message.sources ?? []) {
      if (!source || source.workspaceId !== session.workspaceId || !text(source.id, 80) ||
          !text(source.fileId, 80) || !text(source.path, 220) || !text(source.content, 512_000) ||
          !text(source.hash, 128) || !['draft', 'disk'].includes(source.origin) ||
          (source.selection && (!text(source.selection.text, 100_000) ||
            (source.selection.from !== undefined && (!Number.isSafeInteger(source.selection.from) ||
              !Number.isSafeInteger(source.selection.to) || source.selection.from < 0 ||
              source.selection.to! <= source.selection.from || source.selection.to! > source.content.length)))))
        throw new Error('助手上下文格式无效，原记录已保留');
    }
    for (const proposal of message.proposals ?? []) {
      if (!proposal || proposal.workspaceId !== session.workspaceId || !text(proposal.id, 80) ||
          !text(proposal.runId, 80) || !['edit', 'create', 'object', 'relation'].includes(proposal.kind) ||
          !['ready', 'applying', 'applied', 'rejected', 'conflicted', 'unknown'].includes(proposal.status) ||
          !text(proposal.path, 220) || !text(proposal.base, 512_000) || !text(proposal.content, 512_000) ||
          !text(proposal.reason, 4000) || (proposal.suggestionGroupId !== undefined && !text(proposal.suggestionGroupId, 80)) || ((proposal.kind === 'edit' || (proposal.kind === 'object' && proposal.base !== '')) && !text(proposal.fileId, 80)) ||
          (proposal.preview && (!text(proposal.preview.before, 512_000) ||
            !text(proposal.preview.after, 512_000) || !text(proposal.preview.path, 220) ||
            (proposal.preview.diskHash !== null && !text(proposal.preview.diskHash, 128)))) ||
          (proposal.applied && (!text(proposal.applied.before, 512_000) ||
            !text(proposal.applied.after, 512_000) || !text(proposal.applied.hash, 128) ||
            !text(proposal.applied.fileId, 80))))
        throw new Error('助手修改记录格式无效，原记录已保留');
    }
  }
  return structuredClone(session);
}
