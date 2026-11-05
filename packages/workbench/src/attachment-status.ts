import type { DocumentStatusItem } from './document-status';

export interface AttachmentStatusUpdate {
  source: string;
  documentKey: string;
  state: { items: DocumentStatusItem[]; retry?: () => Promise<void>; retryDisabled: boolean } | null;
}
