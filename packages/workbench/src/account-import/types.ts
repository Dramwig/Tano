import type { PreparedImport } from '../document-import';

export type ImportProviderId = 'notion' | 'obsidian' | 'confluence' | 'evernote' | 'trello' | 'roam' | 'asana' | 'workflowy' | 'jira' | 'monday' | 'quip' | 'google-docs';
export interface ImportAccount { id: string; provider: ImportProviderId; label: string; context: string }
export interface ImportCapability { provider: ImportProviderId; oauth: boolean; token: boolean }
export interface ImportResource { id: string; name: string }
export interface ImportConnectionInput { provider: ImportProviderId; label: string; context: string; token: string; apiKey: string; flowId: string; oauth: boolean }
export interface ImportResponse { status: number; body: string; binary?: string }
export interface ImportRequest { path: string; method?: 'GET' | 'POST'; body?: unknown; rpc?: 'listNotebooks' | 'findNotesMetadata' | 'getNote' }
/** Credentials and HTTP belong to the host, never to Markdown or workspace state. */
export interface ImportAccountHost {
  capabilities(): Promise<ImportCapability[]>;
  accounts(): Promise<ImportAccount[]>;
  connect(input: ImportConnectionInput): Promise<ImportAccount>;
  cancel(flowId: string): Promise<void>;
  disconnect(accountId: string): Promise<void>;
  request(account: ImportAccount, request: ImportRequest, signal: AbortSignal): Promise<ImportResponse>;
}
export interface AccountImportService {
  host: ImportAccountHost;
  resources(account: ImportAccount, signal: AbortSignal): Promise<ImportResource[]>;
  prepare(account: ImportAccount, resources: ImportResource[], signal: AbortSignal, progress: (name: string) => void): Promise<PreparedImport>;
}
