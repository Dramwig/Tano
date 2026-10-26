<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import Workbench from '@tano/workbench';
import { useWorkspaceStore } from '@tano/workbench/stores/workspace';


interface Request { path?: string; error?: string }
const store = useWorkspaceStore();


let ready = false;
let disposed = false;
let draining = false;
let unlisten: (() => void) | undefined;
let initialError: string | undefined;
let stopWaiting: (() => void) | undefined;

async function waitUntilIdle() {
  if (!store.busy || disposed) return;
  await new Promise<void>(resolve => {
    const stop = watch(() => store.busy, busy => { if (!busy) stopWaiting?.(); });
    stopWaiting = () => { stop(); stopWaiting = undefined; resolve(); };
  });
}

async function drain() {
  if (!ready || draining || disposed) return;
  draining = true;
  try {
    while (!disposed) {
      await waitUntilIdle();
      if (disposed) break;
      const request = await invoke<Request | null>('shell_take_workspace');
      if (!request) break;
      // A user action may have started while the IPC request was in flight.
      await waitUntilIdle();
      if (disposed) break;
      if (request.error) store.report(request.error);
      else if (request.path && request.path !== store.workspace?.path) await store.openWorkspace(request.path);
    }
  } catch (error) { store.report(error); }
  finally { draining = false; }
}
function onReady() {
  ready = true;
  if (initialError) store.report(initialError);
  void drain();
}
async function resolveInitialWorkspace() {
  try {
    unlisten = await listen('shell-workspace-pending', () => void drain());
    if (disposed) { unlisten(); return; }
    const request = await invoke<Request | null>('shell_take_workspace');
    initialError = request?.error;
    return request?.path;
  } catch (error) { initialError = String(error); }
}
onBeforeUnmount(() => { disposed = true; unlisten?.(); stopWaiting?.(); });
</script>

<template>
  <Workbench :resolve-initial-workspace="resolveInitialWorkspace" @ready="onReady" />

</template>
