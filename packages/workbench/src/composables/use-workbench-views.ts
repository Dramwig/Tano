import { computed, ref, watch, type Ref } from 'vue';
import { Bot, Mail, Settings2 } from 'lucide-vue-next';
import { ASSISTANT_TAB_ID } from '../assistant/navigation';
import { GRAPH_TAB_ID } from '../documents/document-graph';
import { isFeatureEnabled } from '../features';
import type { AttachmentService } from '../files/attachments';
import { t } from '../i18n/i18n';
import { MAIL_TAB_ID } from '../mail/types';
import { CALENDAR_TAB_ID } from '../plans/calendar';
import { mobile } from '../platform/platform';
import type { WorkbenchExtensions, WorkbenchViewTab } from '../runtime';
import { SETTINGS_TAB_ID } from '../settings/settings-tab';
import type { SettingsPageId } from '../settings/settings-window';
import {
  resolvePluginSidebar,
  useWorkbenchNavigation,
  type WorkspaceSidebarView,
} from '../shell/workbench-navigation';
import type { usePlanStore } from '../stores/plans';
import type { useWorkspaceStore } from '../stores/workspace';
import { native } from '../workspace/adapter';
import { useWorkbenchCalendar } from './use-workbench-calendar';

export interface WorkbenchViewsDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  plans: ReturnType<typeof usePlanStore>;
  extensions: WorkbenchExtensions;
  attachments?: AttachmentService;
  isAuxiliaryWindow: boolean;
  compactPanes: Ref<boolean>;
  sidebar: Ref<boolean>;
  workspaceMenu: Ref<boolean>;
  openSettings: (page?: SettingsPageId) => void;
}

export function useWorkbenchViews(deps: WorkbenchViewsDeps) {
  const {
    store,
    plans,
    extensions,
    attachments,
    isAuxiliaryWindow,
    compactPanes,
    sidebar,
    workspaceMenu,
    openSettings,
  } = deps;

  const extensionViews = extensions.views ?? [];
  const settingsTabView: WorkbenchViewTab = {
    id: SETTINGS_TAB_ID,
    get label() {
      return t('设置');
    },
    icon: Settings2,
    scope: 'account',
    detachable: true,
  };
  const mailEnabled = isFeatureEnabled('desktopMailClient') && native && !mobile;
  const mailTabView: WorkbenchViewTab = {
    id: MAIL_TAB_ID,
    get label() {
      return t('邮箱');
    },
    icon: Mail,
    scope: 'account',
    detachable: false,
  };

  store.registerViews([
    ...extensionViews,
    settingsTabView,
    ...(mailEnabled ? [mailTabView] : []),
    { id: ASSISTANT_TAB_ID, label: t('助手'), icon: Bot },
  ]);

  const activeExtensionView = computed(() =>
    extensionViews.find((view) => view.id === store.activeId),
  );
  watch(
    activeExtensionView,
    (view) => {
      if (view?.collapseSidebarOnOpen) sidebar.value = false;
    },
    { immediate: true },
  );

  const navigation = useWorkbenchNavigation(
    () => store.workspace?.id,
    isAuxiliaryWindow
      ? undefined
      : {
          getItem: (key) => localStorage.getItem(key),
          setItem: (key, value) => localStorage.setItem(key, value),
        },
  );
  const { context: navigationContext, module: navigationModule, workspaceView, sidebarView } =
    navigation;
  let personalPlanScope: typeof plans.view = 'all';

  watch(
    [navigationContext, navigationModule],
    ([context, module]) => {
      if (context === 'workspace' && module === 'plan') navigation.selectWorkspaceView('events');
    },
    { immediate: true },
  );

  const homeContent = ref<string>();
  const homeExtension = computed(() =>
    extensionViews.find((view) => view.id === homeContent.value),
  );

  const calendar = useWorkbenchCalendar({
    store,
    plans,
    navigationContext,
    navigationModule,
    sidebarView,
    homeContent,
    compactPanes,
    sidebar,
    selectModule: (id) => selectModule(id),
  });

  function selectContext(context: 'home' | 'workspace') {
    calendar.rememberCalendar();
    if (navigationContext.value === 'home') personalPlanScope = plans.view;
    navigation.selectContext(context);
    plans.view = navigationContext.value === 'home' ? personalPlanScope : 'workspace';
    calendar.restoreCalendar();
    workspaceMenu.value = false;
  }
  watch(navigationContext, (context) => {
    plans.view = context === 'home' ? personalPlanScope : 'workspace';
  });

  function selectWorkspaceView(id: string) {
    calendar.rememberCalendar();
    if (navigationContext.value === 'home') personalPlanScope = plans.view;
    navigation.selectWorkspaceView(id as WorkspaceSidebarView);
    calendar.restoreCalendar();
    if (id === 'events') plans.view = 'workspace';
  }

  function selectModule(id: string) {
    calendar.rememberCalendar();
    if (navigationContext.value === 'home') personalPlanScope = plans.view;
    if (id === 'plan' && navigationContext.value === 'workspace')
      navigation.selectWorkspaceView('events');
    else navigation.selectModule(id);
    calendar.restoreCalendar();
    plans.view = navigationContext.value === 'home' ? personalPlanScope : 'workspace';
    sidebar.value = true;
  }

  watch(
    () => store.activePluginSidebar,
    (key) => {
      if (key) {
        sidebarView.value = `plugin-sidebar:${key}`;
        sidebar.value = true;
      }
    },
  );
  watch(
    [
      () => store.workspaceLoading.plugins || store.installedPluginWorkspace !== store.workspace?.id,
      () => store.pluginViews,
      sidebarView,
    ],
    ([loading, views, current]) => {
      const resolved = resolvePluginSidebar(current, loading, views);
      if (resolved !== current) sidebarView.value = resolved;
    },
  );
  watch(sidebarView, (current) => {
    if (store.activePluginSidebar && current !== `plugin-sidebar:${store.activePluginSidebar}`)
      store.activePluginSidebar = '';
  });
  watch(
    () => store.pluginSettingsRequest,
    (request) => {
      if (request) openSettings(request.key);
    },
  );

  function openExtensionView(id: string) {
    if (navigationContext.value === 'home') personalPlanScope = plans.view;
    calendar.rememberCalendar();
    if (extensionViews.find((view) => view.id === id)?.sidebar) navigation.openInHome(id);
    else navigation.selectContext('home');
    calendar.restoreCalendar();
    if (!store.workspace) homeContent.value = id;
    else store.openViewTab(id);
    if (compactPanes.value) sidebar.value = false;
  }

  const viewActions = Object.fromEntries(
    extensionViews.map((view) => [
      view.id,
      {
        open: () => {
          openExtensionView(view.id);
          if (compactPanes.value) sidebar.value = false;
        },
        showSidebar: () => {
          selectModule(view.id);
          sidebar.value = true;
        },
      },
    ]),
  );

  function openMail() {
    if (!mailEnabled) return;
    if (navigationContext.value === 'home') personalPlanScope = plans.view;
    calendar.rememberCalendar();
    navigation.openInHome(MAIL_TAB_ID);
    calendar.restoreCalendar();
    if (!store.workspace) homeContent.value = MAIL_TAB_ID;
    else store.openViewTab(MAIL_TAB_ID);
    if (compactPanes.value) sidebar.value = false;
  }
  watch(
    () => navigation.homeModule.value,
    (mod) => {
      if (!mailEnabled && mod === MAIL_TAB_ID) navigation.homeModule.value = 'plan';
    },
    { immediate: true },
  );

  const sidebarNavigationItems = computed(() => [
    { id: 'plan', get label() { return t('计划'); } },
    ...(mailEnabled ? [{ id: MAIL_TAB_ID, get label() { return t('邮箱'); } }] : []),
    ...extensionViews
      .filter((view) => view.sidebar)
      .map((view) => ({ id: view.id, label: view.label })),
  ]);

  const sidebarHeaderItems = computed(() => [
    ...(navigationModule.value === 'workspace'
      ? [
          { id: 'search', get label() { return t('查找文档'); } },
          ...(store.workspaceSettings.showGraph
            ? [{ id: 'graph', get label() { return t('关系图谱'); } }]
            : []),
        ]
      : []),
    ...extensionViews
      .filter((view) => view.header)
      .map((view) => ({ id: view.id, label: view.label })),
  ]);

  const repositoryActionItems = computed(() => [
    { id: 'create', get label() { return t('新建文档'); } },
    { id: 'folder', get label() { return t('新建文件夹'); } },
  ]);

  const documentToolItems = [
    { id: 'markdown-reveal', get label() { return t('光标展开源码'); } },
    { id: 'source-mode', get label() { return t('源码模式'); } },
  ];

  const topbarItems = [{ id: 'breadcrumb', get label() { return t('面包屑'); } }];

  const calendarToolItems = [
    { id: 'calendar-period', get label() { return t('日历日期'); } },
    { id: 'calendar-today', get label() { return t('今天'); } },
    { id: 'calendar-previous', get label() { return t('上一时段'); } },
    { id: 'calendar-next', get label() { return t('下一时段'); } },
    { id: 'calendar-mode', get label() { return t('日历视图'); } },
    { id: 'calendar-events', get label() { return t('已归档事项'); } },
  ];

  function topbarVisibilityItems(tabId: string, hasDocument: boolean, activePane: boolean) {
    return [
      ...topbarItems.filter(
        (item) => item.id !== 'breadcrumb' || (tabId !== CALENDAR_TAB_ID && tabId !== GRAPH_TAB_ID),
      ),
      ...(hasDocument || tabId.startsWith('attachment:')
        ? [{ id: 'document-status', get label() { return t('文章状态'); } }]
        : []),
      ...(activePane && extensions.regions['editing-status']
        ? [{ id: 'editing-status', get label() { return t('同步状态'); } }]
        : []),
      ...(tabId === CALENDAR_TAB_ID ? calendarToolItems : []),
      ...(tabId.startsWith('attachment:') && attachments
        ? [{ id: 'attachment-export', get label() { return t('导出附件'); } }]
        : []),
      ...(hasDocument ? documentToolItems : []),
    ].map((item, index, items) => ({
      ...item,
      separatorBefore: items[index - 1]?.id === 'document-status',
    }));
  }

  return {
    extensionViews,
    settingsTabView,
    mailEnabled,
    mailTabView,
    activeExtensionView,
    navigation,
    navigationContext,
    navigationModule,
    workspaceView,
    sidebarView,
    getPersonalPlanScope: () => personalPlanScope,
    homeContent,
    homeExtension,
    calendar,
    selectContext,
    selectWorkspaceView,
    selectModule,
    viewActions,
    openMail,
    sidebarNavigationItems,
    sidebarHeaderItems,
    repositoryActionItems,
    documentToolItems,
    calendarToolItems,
    topbarVisibilityItems,
  };
}
