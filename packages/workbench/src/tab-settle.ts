import { ref } from 'vue';

// Shared across every DesktopTabs instance: a tab docked into another pane
// reveals its final appearance as the source pane's preview lands on it.
export const settlingTab = ref<{ id: string; opacity: number }>();
