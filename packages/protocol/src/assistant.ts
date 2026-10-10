export const ASSISTANT_PROTOCOL_VERSION = 12;


export type AssistantReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type AssistantReasoningSelection = AssistantReasoningEffort | 'cli-default';

export function isAssistantReasoningSelection(value: unknown): value is AssistantReasoningSelection {
  return typeof value === 'string' && ['cli-default', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value);
}

export interface AssistantConnection {
  id: string;
  name: string;
  kind?: 'api' | 'codex-cli' | 'claude-cli';
  cliPath?: string;
  /** Legacy connection default, used when restoring a conversation without its own selection. */
  reasoningEffort?: AssistantReasoningEffort;
  endpoint: string;
  protocol?: 'chat-completions' | 'responses';
  autoAdapt?: boolean;
  tools: boolean;
  maxOutputTokens: number;
  hasKey: boolean;
  /** Configured by the hosting application. */
  managed?: boolean;
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
  destination?: string;
}
export interface AssistantProposal {
  id: string;
  runId: string;
  workspaceId: string;
  kind: 'edit' | 'create' | 'delete' | 'rename' | 'move' | 'object' | 'relation';
  fileId?: string;
  path: string;
  destination?: string;
  base: string;
  content: string;
  reason: string;
  status: AssistantProposalStatus;
  /** Omitted on legacy and manually reviewed proposals. */
  execution?: 'direct';
  preview?: AssistantPreview;
  applied?: { before: string; after: string; hash: string; fileId: string };
  error?: string;
  /** Once published, per-edit review belongs to the portable document records. */
  suggestionGroupId?: string;
}

/** Application-recorded receipts; never inferred from the model's answer. */
export interface AssistantToolResult {
  name: string;
  status: 'succeeded' | 'failed';
  proposalId?: string;
  error?: string;
}

export interface AssistantQuestion {
  id: string;
  question: string;
  options?: string[];
}
export interface AssistantQuestionAnswer {
  questionId: string;
  /** Null means the user explicitly skipped this question. */
  answer: string | null;
}
export interface AssistantUserInput {
  id: string;
  questions: AssistantQuestion[];
  answers?: AssistantQuestionAnswer[];
  status: 'pending' | 'answered' | 'cancelled';
  /** Position in the assistant's text where this interaction occurred. */
  contentOffset: number;
}

export function parseAssistantQuestions(value: unknown): AssistantQuestion[] {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw new Error('一次可询问 1 至 8 个问题');
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some(key => !['id', 'question', 'options'].includes(key)) ||
        typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id) ||
        typeof item.question !== 'string' || !item.question.trim() || item.question.length > 1000 ||
        (item.options !== undefined && (!Array.isArray(item.options) || item.options.length > 8 ||
          item.options.some((option: unknown) => typeof option !== 'string' || !option.trim() || option.length > 200) ||
          new Set(item.options).size !== item.options.length))) throw new Error('询问用户的问题格式无效');
    ids.add(item.id);
    return { id: item.id, question: item.question, ...(item.options?.length ? { options: [...item.options] } : {}) };
  });
}
export function parseAssistantAnswers(value: unknown, questions: readonly AssistantQuestion[]): AssistantQuestionAnswer[] {
  if (!Array.isArray(value) || value.length !== questions.length) throw new Error('请回答或跳过每个问题');
  return questions.map((question, index) => {
    const item = value[index];
    if (!item || item.questionId !== question.id || Object.keys(item).some(key => !['questionId', 'answer'].includes(key)) ||
        (item.answer !== null && (typeof item.answer !== 'string' || !item.answer.trim() || item.answer.length > 4000)))
      throw new Error('用户回答格式无效');
    return { questionId: question.id, answer: item.answer };
  });
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  sources?: AssistantSource[];
  /** Initial source IDs attached to the preceding user message; later tool reads are excluded. */
  attachedSourceIds?: string[];
  proposals?: AssistantProposal[];
  toolResults?: AssistantToolResult[];
  userInputs?: AssistantUserInput[];
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
  reasoningEffort?: AssistantReasoningSelection;
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
  reasoningEffort?: AssistantReasoningSelection;
  messages: AssistantWireMessage[];
  tools?: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
}
export interface AssistantTransport {
  canConfigure?: boolean;
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
      (session.reasoningEffort !== undefined && !isAssistantReasoningSelection(session.reasoningEffort)) ||
      !Array.isArray(session.messages) || session.messages.length > 300 || (session.external !== undefined && typeof session.external !== 'boolean'))
    throw new Error('助手会话格式无效，原记录已保留');
  const ids = new Set<string>();
  for (const message of session.messages) {
    if (!message || !text(message.id, 80) || ids.has(message.id) ||
        !['user', 'assistant'].includes(message.role) || !text(message.content, 1_000_000) ||
        !Number.isFinite(message.createdAt) ||
        (message.state && !['running', 'completed', 'cancelled', 'failed', 'interrupted'].includes(message.state)) ||
        (message.sources && (!Array.isArray(message.sources) || message.sources.length > 30)) ||
        (message.attachedSourceIds !== undefined && (message.role !== 'assistant' || !Array.isArray(message.attachedSourceIds) ||
          message.attachedSourceIds.length > 20 || new Set(message.attachedSourceIds).size !== message.attachedSourceIds.length ||
          message.attachedSourceIds.some(id => !text(id, 80) || !message.sources?.some(source => source?.id === id)))) ||
        (message.proposals && (!Array.isArray(message.proposals) || message.proposals.length > 30)) ||
        (message.timing !== undefined && (!message.timing || Array.isArray(message.timing) || !Number.isFinite(message.timing.totalMs) || message.timing.totalMs < 0 ||
          (message.timing.firstContentMs !== undefined && (!Number.isFinite(message.timing.firstContentMs) ||
            message.timing.firstContentMs < 0 || message.timing.firstContentMs > message.timing.totalMs)))) ||
        (message.rules && (!Array.isArray(message.rules) || message.rules.length > 2 || message.rules.some(path => !text(path, 220)))))
      throw new Error('助手消息格式无效，原记录已保留');
    ids.add(message.id);
    if (message.userInputs !== undefined) {
      if (message.role !== 'assistant' || !Array.isArray(message.userInputs) || message.userInputs.length > 8)
        throw new Error('助手提问记录格式无效');
      const inputIds = new Set<string>();
      let offset = 0;
      for (const input of message.userInputs) {
        if (!input || !text(input.id, 80) || !input.id || inputIds.has(input.id) ||
            !['pending', 'answered', 'cancelled'].includes(input.status) ||
            !Number.isSafeInteger(input.contentOffset) || input.contentOffset < offset || input.contentOffset > message.content.length)
          throw new Error('助手提问记录格式无效');
        inputIds.add(input.id); offset = input.contentOffset;
        const questions = parseAssistantQuestions(input.questions);
        if (input.status === 'answered') parseAssistantAnswers(input.answers, questions);
        else if (input.answers !== undefined) throw new Error('未完成的提问不能记录为用户回答');
      }
    }
    if (message.toolResults !== undefined) {
      if (message.role !== 'assistant' || !Array.isArray(message.toolResults) || message.toolResults.length > 160 ||
          message.toolResults.some(result => !result || !text(result.name, 80) || !result.name ||
            !['succeeded', 'failed'].includes(result.status) ||
            (result.status === 'failed' ? !text(result.error, 2000) || !result.error : result.error !== undefined) ||
            (result.proposalId !== undefined && (!text(result.proposalId, 80) || !message.proposals?.some(proposal => proposal?.id === result.proposalId)))))
        throw new Error('助手工具回执格式无效，原记录已保留');
    }
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
          !text(proposal.runId, 80) || !['edit', 'create', 'delete', 'rename', 'move', 'object', 'relation'].includes(proposal.kind) ||
          !['ready', 'applying', 'applied', 'rejected', 'conflicted', 'unknown'].includes(proposal.status) ||
          (proposal.execution !== undefined && proposal.execution !== 'direct') ||
          !text(proposal.path, 220) || !text(proposal.base, 512_000) || !text(proposal.content, 512_000) ||
          !text(proposal.reason, 4000) || (proposal.suggestionGroupId !== undefined && (proposal.kind !== 'edit' || !text(proposal.suggestionGroupId, 80))) || ((['edit', 'delete', 'rename', 'move'].includes(proposal.kind) || (proposal.kind === 'object' && proposal.base !== '')) && !text(proposal.fileId, 80)) ||
          (['rename', 'move'].includes(proposal.kind) ? !text(proposal.destination, 220) || !proposal.destination : proposal.destination !== undefined) ||
          (proposal.preview && (!text(proposal.preview.before, 512_000) ||
            !text(proposal.preview.after, 512_000) || !text(proposal.preview.path, 220) ||
            (proposal.preview.destination !== undefined && (!['rename', 'move'].includes(proposal.kind) || !text(proposal.preview.destination, 220))) ||
            (proposal.preview.diskHash !== null && !text(proposal.preview.diskHash, 128)))) ||
          (proposal.applied && (!text(proposal.applied.before, 512_000) ||
            !text(proposal.applied.after, 512_000) || !text(proposal.applied.hash, 128) ||
            !text(proposal.applied.fileId, 80))))
        throw new Error('助手修改记录格式无效，原记录已保留');
    }
  }
  const parsed = structuredClone(session) as AssistantSession & { executionMode?: unknown };
  // Old conversation mode choices must not override the user's current request.
  delete parsed.executionMode;
  return parsed;
}
