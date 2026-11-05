export const settingsPagePreferenceKey = 'tano.preference.settingsPage';

export function readSettingsPage(fallback = 'appearance'): string {
  try {
    return window.localStorage.getItem(settingsPagePreferenceKey) || fallback;
  } catch {
    return fallback;
  }
}

export function rememberSettingsPage(page: string): void {
  try {
    window.localStorage.setItem(settingsPagePreferenceKey, page);
  } catch {
    // Settings remain usable when device storage is unavailable.
  }
}
