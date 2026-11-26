import { shallowRef } from 'vue';
import type {
  PluginUiConfirmOptions,
  PluginUiPickOptions,
  PluginUiPromptOptions,
  PluginUiTone,
} from '@tano/protocol';

export type PluginUiDialogRequest =
  | {
      id: string;
      kind: 'pick';
      pluginId: string;
      pluginName: string;
      options: PluginUiPickOptions;
    }
  | {
      id: string;
      kind: 'prompt';
      pluginId: string;
      pluginName: string;
      options: PluginUiPromptOptions;
    }
  | {
      id: string;
      kind: 'confirm';
      pluginId: string;
      pluginName: string;
      options: PluginUiConfirmOptions;
    };

export interface PluginUiToastItem {
  id: string;
  pluginId: string;
  pluginName: string;
  message: string;
  tone: PluginUiTone;
}

export function createPluginUiDialogs() {
  const activePluginDialog = shallowRef<PluginUiDialogRequest | null>(null);
  const pluginToasts = shallowRef<PluginUiToastItem[]>([]);
  const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

  let activeDialogControl: {
    id: string;
    resolve: (value: string | boolean | null) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
  } | null = null;

  function cancelActivePluginDialog(reason = '插件交互已取消') {
    const current = activeDialogControl;
    if (!current) return;
    activeDialogControl = null;
    activePluginDialog.value = null;
    current.cleanup();
    current.reject(new Error(reason));
  }

  function resolvePluginDialog(id: string, value: string | boolean | null) {
    const current = activeDialogControl;
    if (!current || current.id !== id) return;
    activeDialogControl = null;
    activePluginDialog.value = null;
    current.cleanup();
    current.resolve(value);
  }

  function dismissPluginToast(id: string) {
    const timer = toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }
    pluginToasts.value = pluginToasts.value.filter((item) => item.id !== id);
  }

  function clearPluginToasts() {
    for (const timer of toastTimers.values()) clearTimeout(timer);
    toastTimers.clear();
    pluginToasts.value = [];
  }

  function showPluginToast(params: Record<string, unknown>) {
    const id = crypto.randomUUID();
    const item: PluginUiToastItem = {
      id,
      pluginId: String(params.pluginId ?? ''),
      pluginName: String(params.pluginName ?? ''),
      message: String(params.message ?? ''),
      tone: (params.tone as PluginUiTone | undefined) ?? 'info',
    };
    const next = [...pluginToasts.value, item];
    while (next.length > 3) {
      const removed = next.shift();
      if (removed) {
        const timer = toastTimers.get(removed.id);
        if (timer) {
          clearTimeout(timer);
          toastTimers.delete(removed.id);
        }
      }
    }
    pluginToasts.value = next;
    toastTimers.set(
      id,
      setTimeout(() => dismissPluginToast(id), 4500),
    );
  }

  function openPluginDialog(
    method: 'ui.pick' | 'ui.prompt' | 'ui.confirm',
    params: Record<string, unknown>,
  ): Promise<string | boolean | null> {
    if (activeDialogControl) {
      return Promise.reject(new Error('当前已有插件交互弹窗正在等待响应，请稍后重试'));
    }
    const id = crypto.randomUUID();
    const signal = params.signal instanceof AbortSignal ? params.signal : undefined;
    if (signal?.aborted) return Promise.reject(new Error('插件已停止'));
    return new Promise<string | boolean | null>((resolve, reject) => {
      const onAbort = () => cancelActivePluginDialog('插件已停止');
      signal?.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      activeDialogControl = { id, resolve, reject, cleanup };
      const pluginId = String(params.pluginId ?? '');
      const pluginName = String(params.pluginName ?? '');
      if (method === 'ui.pick') {
        activePluginDialog.value = {
          id,
          kind: 'pick',
          pluginId,
          pluginName,
          options: params.options as PluginUiPickOptions,
        };
      } else if (method === 'ui.prompt') {
        activePluginDialog.value = {
          id,
          kind: 'prompt',
          pluginId,
          pluginName,
          options: params.options as PluginUiPromptOptions,
        };
      } else {
        activePluginDialog.value = {
          id,
          kind: 'confirm',
          pluginId,
          pluginName,
          options: params.options as PluginUiConfirmOptions,
        };
      }
    });
  }

  return {
    activePluginDialog,
    pluginToasts,
    cancelActivePluginDialog,
    resolvePluginDialog,
    dismissPluginToast,
    clearPluginToasts,
    showPluginToast,
    openPluginDialog,
  };
}
