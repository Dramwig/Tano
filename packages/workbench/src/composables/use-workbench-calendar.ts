import { computed, ref, type Ref } from 'vue';
import {
  CALENDAR_TAB_ID,
  calendarPeriodTitle,
  shiftCalendarDate,
  type CalendarViewMode,
} from '../plans/calendar';
import { t } from '../i18n/i18n';
import type { usePlanStore } from '../stores/plans';
import type { useWorkspaceStore } from '../stores/workspace';

export interface WorkbenchCalendarDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  plans: ReturnType<typeof usePlanStore>;
  navigationContext: Ref<'home' | 'workspace'>;
  navigationModule: Ref<string>;
  sidebarView: Ref<string>;
  homeContent: Ref<string | undefined>;
  compactPanes: Ref<boolean>;
  sidebar: Ref<boolean>;
  selectModule: (id: string) => void;
}

export function useWorkbenchCalendar(deps: WorkbenchCalendarDeps) {
  const {
    store,
    plans,
    navigationContext,
    navigationModule,
    sidebarView,
    homeContent,
    compactPanes,
    sidebar,
    selectModule,
  } = deps;

  const calendarDate = ref(new Date());
  const sidebarCalendarDate = ref(new Date());
  const calendarScope = ref<typeof plans.view>(plans.view);
  const calendarMode = ref<CalendarViewMode>('week');
  const calendarModeOpen = ref(false);
  const calendarLocations = new Map<string, { date: Date; mode: CalendarViewMode }>();

  function calendarLocationKey() {
    return navigationContext.value === 'home' ? 'home-plan' : (store.workspace?.id ?? '');
  }

  function rememberCalendar(key?: string) {
    if (key === undefined && !['workspace', 'plan'].includes(navigationModule.value)) return;
    calendarLocations.set(key ?? calendarLocationKey(), {
      date: new Date(sidebarCalendarDate.value),
      mode: calendarMode.value,
    });
  }

  function restoreCalendar(key?: string) {
    if (key === undefined && !['workspace', 'plan'].includes(navigationModule.value)) return;
    key ??= calendarLocationKey();
    const saved = calendarLocations.get(key);
    sidebarCalendarDate.value = saved ? new Date(saved.date) : new Date();
  }

  const calendarModeOptions: { mode: CalendarViewMode; label: string }[] = [
    {
      mode: 'day',
      get label() {
        return t('日');
      },
    },
    {
      mode: 'four-days',
      get label() {
        return t('4 天');
      },
    },
    {
      mode: 'week',
      get label() {
        return t('周');
      },
    },
    {
      mode: 'month',
      get label() {
        return t('月');
      },
    },
    {
      mode: 'year',
      get label() {
        return t('年');
      },
    },
    {
      mode: 'agenda',
      get label() {
        return t('日程');
      },
    },
  ];

  const calendarModeLabel = computed(
    () => calendarModeOptions.find((option) => option.mode === calendarMode.value)?.label ?? t('周'),
  );
  const calendarPeriod = computed(() =>
    calendarPeriodTitle(calendarDate.value, calendarMode.value),
  );

  function moveCalendarPeriod(offset: number) {
    calendarDate.value = shiftCalendarDate(calendarDate.value, calendarMode.value, offset);
  }

  function selectCalendarMode(mode: CalendarViewMode) {
    calendarMode.value = mode;
    calendarModeOpen.value = false;
  }

  function showCalendarDay(date: Date) {
    calendarDate.value = date;
    calendarMode.value = 'day';
  }

  function showCalendarMonth(date: Date) {
    calendarDate.value = date;
    calendarMode.value = 'month';
  }

  function openCalendar(date?: Date) {
    if (sidebarView.value !== 'events' && navigationModule.value !== 'plan') selectModule('plan');
    calendarScope.value = plans.view;
    sidebarCalendarDate.value = date ? new Date(date) : sidebarCalendarDate.value;
    calendarDate.value = new Date(sidebarCalendarDate.value);
    if (!store.workspace) homeContent.value = CALENDAR_TAB_ID;
    else store.openCalendarTab();
    if (compactPanes.value) sidebar.value = false;
  }

  return {
    calendarDate,
    sidebarCalendarDate,
    calendarScope,
    calendarMode,
    calendarModeOpen,
    calendarModeOptions,
    calendarModeLabel,
    calendarPeriod,
    rememberCalendar,
    restoreCalendar,
    moveCalendarPeriod,
    selectCalendarMode,
    showCalendarDay,
    showCalendarMonth,
    openCalendar,
  };
}
