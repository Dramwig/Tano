import { ref } from 'vue';

// Shared across every DesktopTabs instance: a tab docked into another pane
// keeps its content hidden there until the source pane's preview lands on it.
export const settlingTabId = ref('');
