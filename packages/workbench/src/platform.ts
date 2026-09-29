import { invoke, isTauri } from '@tauri-apps/api/core';

// Resolved from Rust before mounting; user-agent strings are not a platform boundary.
export let mobile = false;
export let nativeOs = '';
export async function initializePlatform() {
  if (!isTauri()) return;
  const platform = await invoke<{ mobile: boolean; os: string }>('runtime_platform');
  mobile = platform.mobile;
  nativeOs = platform.os;
  document.documentElement.classList.toggle('native-mobile', mobile);
}
