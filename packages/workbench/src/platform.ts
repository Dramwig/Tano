import { invoke, isTauri } from '@tauri-apps/api/core';

// Resolved from Rust before mounting; user-agent strings are not a platform boundary.
export let mobile = false;
export async function initializePlatform() {
  if (!isTauri()) return;
  const platform = await invoke<{ mobile: boolean; os: string }>('runtime_platform');
  mobile = platform.mobile;
  document.documentElement.classList.toggle('native-mobile', mobile);
}
