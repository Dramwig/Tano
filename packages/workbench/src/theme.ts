export type ThemePreference = 'light' | 'dark' | 'system';

const preferenceKey = 'tano.preference.theme';

export function parseThemePreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(preferenceKey));
  } catch {
    return 'system';
  }
}

export function applyTheme(preference: ThemePreference): void {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
  const resolved = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(preferenceKey, preference);
  } catch {
    // The selected theme remains active for this session when storage is unavailable.
  }
  applyTheme(preference);
}
