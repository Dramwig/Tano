import { parsePluginJson, pluginKey, pluginRecord, pluginText, type PluginJson } from './extensions';

export interface PluginAutomationJobInput {
  pluginId: string;
  automationId: string;
  integrity: string;
  label: string;
  enabled: boolean;
  /** null means manual/Webhook only. The server skips missed intervals after downtime. */
  intervalMinutes: number | null;
  payload: PluginJson;
  version?: string;
  /** Optional compare-and-authorize precondition over canonical portable plugin rule JSON. */
  expectedRuleHash?: string;
}
export interface PluginAutomationJob extends Omit<PluginAutomationJobInput, 'version' | 'expectedRuleHash'> {
  id: string;
  version: string;
  authorizedBy: string;
  needsAuthorization: boolean;
  nextAt: string | null;
  webhookConfigured: boolean;
}
export type PluginAutomationRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'uncertain' | 'expired';
export interface PluginAutomationRun {
  id: string;
  jobId: string;
  trigger: 'manual' | 'schedule' | 'webhook';
  status: PluginAutomationRunStatus;
  createdAt: string;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  result: PluginJson;
}
/** Host administration only; a running plugin cannot authorize or schedule itself. */
export interface PluginAutomationProvider {
  webhook?: {
    url(workspaceId: string, jobId: string): string;
    rotate(workspaceId: string, jobId: string, version: string, signal: AbortSignal): Promise<{ job: PluginAutomationJob; token: string }>;
    revoke(workspaceId: string, jobId: string, version: string, signal: AbortSignal): Promise<PluginAutomationJob>;
  };
  list(workspaceId: string, signal: AbortSignal): Promise<PluginAutomationJob[]>;
  save(workspaceId: string, jobId: string, input: PluginAutomationJobInput, signal: AbortSignal): Promise<PluginAutomationJob>;
  remove(workspaceId: string, jobId: string, version: string, signal: AbortSignal): Promise<void>;
  run(workspaceId: string, jobId: string, version: string, key: string, signal: AbortSignal): Promise<{ id: string }>;
  runs(workspaceId: string, jobId: string, signal: AbortSignal): Promise<PluginAutomationRun[]>;
  cancel(workspaceId: string, jobId: string, runId: string, signal: AbortSignal): Promise<void>;
}
export function parsePluginAutomationJob(value: unknown): PluginAutomationJobInput {
  if (!pluginRecord(value) || Object.keys(value).some(key => !['pluginId', 'automationId', 'integrity', 'label', 'enabled', 'intervalMinutes', 'payload', 'version', 'expectedRuleHash'].includes(key)) ||
    typeof value.pluginId !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(value.pluginId) || !pluginKey(value.automationId) ||
    typeof value.integrity !== 'string' || !/^[a-f0-9]{64}$/.test(value.integrity) || !pluginText(value.label, 80) || typeof value.enabled !== 'boolean' ||
    value.intervalMinutes !== null && (!Number.isInteger(value.intervalMinutes) || Number(value.intervalMinutes) < 15 || Number(value.intervalMinutes) > 43200) ||
    value.version !== undefined && (typeof value.version !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.version)) ||
    value.expectedRuleHash !== undefined && (typeof value.expectedRuleHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedRuleHash))) throw new Error('自动化任务设置无效');
  return { pluginId: value.pluginId, automationId: value.automationId, integrity: value.integrity, label: value.label, enabled: value.enabled,
    intervalMinutes: value.intervalMinutes as number | null, payload: parsePluginJson(value.payload ?? null, 16 * 1024),
    ...(value.version ? { version: value.version as string } : {}), ...(value.expectedRuleHash ? { expectedRuleHash: value.expectedRuleHash as string } : {}) };
}
