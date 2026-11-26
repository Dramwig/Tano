import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  interfaceFontChanged,
  interfaceFontPreferenceKey,
  readInterfaceFont,
  saveInterfaceFont,
  type InterfaceFontPreference,
} from './interface-font';

/** Settings-page binding; other windows follow through the storage event. */
export function useInterfaceFont() {
  const preference = ref(readInterfaceFont());
  function update(patch: Partial<InterfaceFontPreference>) {
    preference.value = { ...preference.value, ...patch };
    saveInterfaceFont(preference.value);
  }
  function sync(event: Event) {
    if (event instanceof StorageEvent && event.key !== interfaceFontPreferenceKey && event.key !== null) return;
    preference.value = event instanceof CustomEvent ? event.detail as InterfaceFontPreference : readInterfaceFont();
  }
  onMounted(() => {
    window.addEventListener('storage', sync);
    window.addEventListener(interfaceFontChanged, sync);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('storage', sync);
    window.removeEventListener(interfaceFontChanged, sync);
  });
  return { preference, update };
}
