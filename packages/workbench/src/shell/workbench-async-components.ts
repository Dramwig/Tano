import { defineAsyncComponent } from 'vue';
import MarkdownEditorSkeleton from '../documents/components/MarkdownEditorSkeleton.vue';
import { loadingComponent } from './loading-component';

// Keep the document layout mounted while only the editor implementation loads.
export const MarkdownEditor = defineAsyncComponent({
  loader: () => import('@tano/editor'),
  delay: 0,
  loadingComponent: MarkdownEditorSkeleton,
});
export const CalloutIconPicker = defineAsyncComponent(
  () => import('../documents/components/CalloutIconPicker.vue'),
);
export const SourceEditor = loadingComponent(() => import('@tano/editor/source-editor'), 'editor');
export const ImportPanel = defineAsyncComponent(() => import('../workspace/components/ImportPanel.vue'));
export const TemplateLibrary = loadingComponent(
  () => import('../workspace/components/TemplateLibrary.vue'),
  'document',
);
// Discussion and annotation surfaces decide their own visibility and loading state.
export const DocumentComments = defineAsyncComponent(
  () => import('../documents/components/DocumentComments.vue'),
);
export const SelectionTodoDialog = defineAsyncComponent(
  () => import('../plans/components/SelectionTodoDialog.vue'),
);
export const RelationGraph = loadingComponent(
  () => import('../objects/components/RelationGraph.vue'),
  'document',
);
export const EditorTools = defineAsyncComponent(() => import('./components/EditorTools.vue'));
export const DocumentHistoryPanel = loadingComponent(
  () => import('../documents/components/DocumentHistoryPanel.vue'),
  'document',
);
export const AgentPanel = loadingComponent(() => import('../assistant/components/AgentPanel.vue'));
// The panel owns its placement (Teleport for floating/fullscreen). A generic
// loading skeleton here would enter the pane's flex row and shrink the editor
// on the first open, then disappear when the panel teleports out.
export const AssistantPanel = defineAsyncComponent(
  () => import('../assistant/components/AssistantPanel.vue'),
);
export const DiffDialog = defineAsyncComponent(() => import('../documents/components/DiffDialog.vue'));
export const MobileRecycle = defineAsyncComponent(() => import('./components/MobileRecycle.vue'));
export const SettingsPanel = defineAsyncComponent(() => import('../settings/components/SettingsPanel.vue'));
export const ObjectDetailModal = defineAsyncComponent(
  () => import('../objects/components/ObjectDetailModal.vue'),
);
export const PlanArchiveDialog = defineAsyncComponent(
  () => import('../plans/components/PlanArchiveDialog.vue'),
);
export const PlanDetailPanel = defineAsyncComponent(
  () => import('../plans/components/PlanDetailPanel.vue'),
);
export const SidebarPlan = loadingComponent(() => import('../plans/components/SidebarPlan.vue'), 'tree');
export const SidebarAssistant = loadingComponent(
  () => import('../assistant/components/SidebarAssistant.vue'),
);
export const InlineAssistantInput = defineAsyncComponent(
  () => import('../assistant/components/InlineAssistantInput.vue'),
);
export const CalendarView = loadingComponent(
  () => import('../plans/components/CalendarView.vue'),
  'document',
);
export const MailWorkspaceView = loadingComponent(
  () => import('../mail/components/MailWorkspaceView.vue'),
  'document',
);
export const SidebarMail = loadingComponent(
  () => import('../mail/components/SidebarMail.vue'),
  'tree',
);
export const DataTablePage = loadingComponent(
  () => import('../data-tables/components/DataTablePage.vue'),
  'spreadsheet',
);
export const PluginInstaller = defineAsyncComponent(
  () => import('../plugins/components/PluginInstaller.vue'),
);
