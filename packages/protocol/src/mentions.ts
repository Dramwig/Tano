import type { CommentAnchor, CommentFile, CommentKind } from './comments';
import { isAssistantModelId, isAssistantReasoningSelection, type AssistantReasoningSelection } from './assistant';
import type { WorkspaceObject } from './objects';

/** Portable membership is independent of the host's credentials and connection IDs. */
export function isAgentPerson(object: Pick<WorkspaceObject, 'type'> & { properties?: Record<string, unknown> }): boolean {
  return object.type === 'person' && object.properties?.memberKind === 'agent';
}

export function mentionIdFromTitle(title: unknown): string | undefined {
  if (typeof title !== 'string') return;
  return /^tano:mention:([a-z0-9-]{8,80})$/i.exec(title)?.[1];
}

export interface AgentBinding {
  personId: string;
  connectionId: string;
  model: string;
  reasoningEffort?: AssistantReasoningSelection;
  enabled: boolean;
  /** A completed identity creation must not recreate a subsequently deleted user file. */
  provisioned?: boolean;
}

export interface MentionSource {
  fileId: string;
  kind: 'document' | CommentKind;
  threadId?: string;
  messageId?: string;
  mentionId?: string;
  anchor?: CommentAnchor;
}

/** IDs identify an occurrence, so retries and ordinary edits keep the same delivery. */
export interface MentionEvent {
  id: string;
  workspaceId: string;
  personId: string;
  actorId: string;
  source: MentionSource;
  body: string;
  revision: string;
  createdAt: number;
}

export function commentMentionEvents(workspaceId: string, file: CommentFile, revision: string): MentionEvent[] {
  const events = file.threads.flatMap(thread => thread.messages.flatMap(message => {
    // Generated replies are attributable but never implicitly delegate another task.
    if (message.agentTaskId) return [];
    return (message.mentions ?? []).map(mention => ({
      id: JSON.stringify([file.kind, file.fileId, thread.id, message.id, mention.id ?? mention.personId]),
      workspaceId, personId: mention.personId, actorId: message.authorId,
      source: { fileId: file.fileId, kind: file.kind, threadId: thread.id, messageId: message.id,
        ...(thread.anchor ? { anchor: thread.anchor } : {}) },
      body: message.body, revision, createdAt: message.createdAt,
    }));
  }));
  const seen = new Set<string>();
  return events.filter(event => { if (seen.has(event.id)) return false; seen.add(event.id); return true; });
}

export type AgentTaskStatus = 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled' | 'uncertain';

export interface AgentTask {
  id: string;
  event: MentionEvent;
  binding: AgentBinding;
  status: AgentTaskStatus;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  readyAt?: number;
  claim?: { owner: string; token: string; until: number };
  error?: string;
  /** Persist before writing the reply, then replay with this stable comment ID. */
  result?: { messageId: string; body: string; outcome?: 'succeeded' | 'waiting' | 'uncertain' };
  continuation?: { messageId: string; body: string; threadId: string };
}

/** Host application data. Content itself remains in the referenced workspace files. */
export interface AgentInbox {
  version: 1;
  workspaceId: string;
  revision: number;
  bindings: AgentBinding[];
  tasks: AgentTask[];
  /** Last committed server file sequence consumed from the durable source outbox. */
  eventCursor?: number;
}

/** Implementations must atomically compare and replace, across all runners sharing authority. */
export interface AgentInboxStorage {
  load(workspaceId: string): Promise<AgentInbox>;
  compareExchange(inbox: AgentInbox, expectedRevision: number): Promise<boolean>;
}

/** Hosted runners expose controls, never their internal execution-state CAS. */
export interface HostedAgentInbox {
  list(workspaceId: string): Promise<AgentInbox>;
  connect(workspaceId: string): Promise<void>;
  configure(workspaceId: string, personId: string, model: string, enabled: boolean): Promise<void>;
  cancel(workspaceId: string, taskId: string): Promise<void>;
  retry(workspaceId: string, taskId: string, updatedAt: number): Promise<void>;
  session(workspaceId: string, taskId: string): Promise<import('./assistant').AssistantSession | undefined>;
}

export function emptyAgentInbox(workspaceId: string): AgentInbox {
  return { version: 1, workspaceId, revision: 0, bindings: [], tasks: [] };
}

export function parseAgentInbox(value: unknown, workspaceId: string): AgentInbox {
  const inbox = value as AgentInbox;
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
  const id = (value: unknown) => typeof value === 'string' && /^[a-z0-9-]{8,80}$/i.test(value);
  const shortId = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{6}$/.test(value);
  const bindingValid = (binding: AgentBinding) => binding && shortId(binding.personId) && text(binding.connectionId, 120) &&
    (binding.model === '' || isAssistantModelId(binding.model)) && typeof binding.enabled === 'boolean' &&
    (binding.provisioned === undefined || typeof binding.provisioned === 'boolean') &&
    (binding.reasoningEffort === undefined || isAssistantReasoningSelection(binding.reasoningEffort));
  if (!inbox || inbox.version !== 1 || inbox.workspaceId !== workspaceId || !text(workspaceId, 120) ||
      !Number.isSafeInteger(inbox.revision) || inbox.revision < 0 ||
      (inbox.eventCursor !== undefined && (!Number.isSafeInteger(inbox.eventCursor) || inbox.eventCursor < 0)) ||
      !Array.isArray(inbox.bindings) || inbox.bindings.length > 1000 || !inbox.bindings.every(bindingValid) ||
      new Set(inbox.bindings.map(binding => binding.personId)).size !== inbox.bindings.length ||
      !Array.isArray(inbox.tasks) || inbox.tasks.length > 10000) throw new Error('机器人收件箱格式无效');
  const taskIds = new Set<string>();
  const events = new Set<string>();
  for (const task of inbox.tasks) {
    const event = task?.event;
    const source = event?.source;
    if (!task || !id(task.id) || taskIds.has(task.id) || !id(task.sessionId) || !bindingValid(task.binding) ||
        !['queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled', 'uncertain'].includes(task.status) ||
        !Number.isFinite(task.createdAt) || !Number.isFinite(task.updatedAt) ||
        !Number.isSafeInteger(task.attempts) || task.attempts < 0 ||
        (task.readyAt !== undefined && !Number.isFinite(task.readyAt)) ||
        !event || !text(event.id, 1000) || event.workspaceId !== workspaceId || event.personId !== task.binding.personId ||
        !text(event.actorId, 120) || !text(event.body, 20000) || !text(event.revision, 256) || !Number.isFinite(event.createdAt) ||
        !source || !shortId(source.fileId) || !['document', 'annotation', 'discussion'].includes(source.kind) ||
        (source.kind !== 'document' && (!id(source.threadId) || !id(source.messageId))) ||
        (task.error !== undefined && (typeof task.error !== 'string' || task.error.length > 20000)) ||
        (task.result !== undefined && (!id(task.result?.messageId) || !text(task.result?.body, 20000))) ||
        (task.result?.outcome !== undefined && !['succeeded', 'waiting', 'uncertain'].includes(task.result.outcome)) ||
        (task.continuation !== undefined && (!id(task.continuation?.messageId) || !id(task.continuation?.threadId) || !text(task.continuation?.body, 20000))) ||
        (task.status === 'running' && !task.claim) ||
        (task.claim !== undefined && (!text(task.claim.owner, 120) || !id(task.claim.token) || !Number.isFinite(task.claim.until))))
      throw new Error('机器人任务格式无效');
    const eventKey = JSON.stringify([event.id, event.personId]);
    if (events.has(eventKey)) throw new Error('机器人任务重复');
    taskIds.add(task.id); events.add(eventKey);
  }
  return inbox;
}
