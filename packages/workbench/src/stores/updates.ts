import { computed, ref, markRaw } from 'vue';
import { defineStore } from 'pinia';
import { Channel, invoke } from '@tauri-apps/api/core';
import { UpdateController } from '../updates/controller';
import type { UpdateCandidate, UpdateProgress, UpdateStatus } from '../updates/controller';
import { useWorkspaceStore } from './workspace';
import { useWorkbenchRuntime } from '../runtime';
import { openExternalUrl } from '../attachments';

export const useUpdatesStore = defineStore('updates', () => {
  const workspace = useWorkspaceStore();
  const runtime = useWorkbenchRuntime();
  const revision = ref(0);
  const controller = markRaw(
    new UpdateController(
      {
        status: () => invoke<UpdateStatus>('update_status'),
        check: () => invoke<UpdateCandidate | null>('update_check'),
        openRelease: openExternalUrl,
        async download(id, onProgress) {
          const progress = new Channel<UpdateProgress>();
          progress.onmessage = onProgress;
          await invoke('update_download', { id, progress });
        },
        install: (id) => invoke('update_install', { id }),
        async flush() {
          const saved = await workspace.flush();
          return saved && !workspace.documents.some((document) => document.conflict);
        },
        disconnect: async () => { await runtime.extensions?.().disconnect(); },
      },
      () => {
        revision.value++;
      },
    ),
  );
  const state = computed(() => {
    void revision.value;
    return {
      phase: controller.phase,
      status: controller.status,
      candidate: controller.candidate,
      progress: controller.progress,
      error: controller.error,
      busy: controller.busy,
    };
  });
  return {
    state,
    initialize: () => controller.initialize(),
    check: () => controller.check(),
    download: () => controller.download(),
    install: () => controller.install(),
  };
});
