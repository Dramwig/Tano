import { invoke } from '@tauri-apps/api/core';
import type { ImportAccountHost, ImportAccount, ImportCapability, ImportResponse } from './types';

export function nativeImportHost(): ImportAccountHost {
  return {
    capabilities: () => invoke<ImportCapability[]>('import_capabilities'),
    accounts: () => invoke<ImportAccount[]>('import_accounts'),
    connect: input => invoke<ImportAccount>('import_connect', { input }),
    cancel: flowId => invoke('import_cancel', { flowId }),
    disconnect: accountId => invoke('import_disconnect', { accountId }),
    async request(account, request, signal) {
      signal.throwIfAborted();
      const result = await invoke<ImportResponse>('import_request', { accountId: account.id, request });
      signal.throwIfAborted();
      return result;
    },
  };
}
