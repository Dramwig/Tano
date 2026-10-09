import { createApp, h, ref, computed } from 'vue/dist/vue.runtime.esm-bundler.js';
import type { PluginJson, TanoPluginViewApi } from '@tano/workbench/plugin-sdk';
import './style.css';

type Card = { id: string; title: string; lane: string };
export default function mount(api: TanoPluginViewApi) {
  const cards = ref<Card[]>([]), title = ref(''), error = ref(''), busy = ref(false), total = ref(0);
  const lanes = [{ id: 'todo', label: '待办' }, { id: 'doing', label: '进行中' }, { id: 'done', label: '已完成' }];
  api.onState(state => {
    const data = state as { cards: Card[]; total: number };
    cards.value = data.cards; total.value = data.total;
  });
  const completed = computed(() => cards.value.filter(card => card.lane === 'done').length);
  async function send(message: PluginJson) {
    if (busy.value) return;
    busy.value = true; error.value = '';
    try { await api.postMessage(message); if (message && typeof message === 'object' && !Array.isArray(message) && message.type === 'create') title.value = ''; }
    catch (cause) { error.value = String(cause); }
    finally { busy.value = false; }
  }
  createApp({ setup: () => () => h('main', [
    h('header', [h('div', [h('span', { class: 'eyebrow' }, '同页 · 工作区任务'), h('h1', '把工作向前推进'), h('p', '拖动卡片，或使用卡片上的状态菜单。')]),
      h('div', { class: 'progress', role: 'status' }, [`${completed.value} / ${cards.value.length} 已完成`, h('progress', { max: Math.max(cards.value.length, 1), value: completed.value })])]),
    h('form', { onSubmit: (event: Event) => { event.preventDefault(); void send({ type: 'create', title: title.value }); } }, [
      h('input', { 'aria-label': '新任务名称', placeholder: '下一件要做的事…', maxlength: 200, value: title.value, disabled: busy.value, onInput: (event: Event) => { title.value = (event.target as HTMLInputElement).value; } }),
      h('button', { type: 'submit', disabled: busy.value || !title.value.trim() }, '添加任务'),
      h('button', { type: 'button', class: 'secondary', disabled: busy.value, onClick: () => send({ type: 'refresh' }) }, '刷新'),
    ]),
    error.value ? h('p', { role: 'alert' }, error.value) : null,
    total.value > cards.value.length ? h('p', `显示前 ${cards.value.length} 项，共 ${total.value} 项。`) : null,
    h('div', { class: 'lanes' }, lanes.map(lane => h('section', { class: `lane ${lane.id}`, 'aria-label': lane.label,
      onDragover: (event: DragEvent) => event.preventDefault(), onDrop: (event: DragEvent) => { event.preventDefault(); const id = event.dataTransfer?.getData('text/plain'); if (id) void send({ type: 'move', id, lane: lane.id }); } }, [
      h('h2', [lane.label, h('span', cards.value.filter(card => card.lane === lane.id).length)]),
      ...cards.value.filter(card => card.lane === lane.id).map(card => h('article', { key: card.id, draggable: !busy.value, 'aria-label': card.title,
        onDragstart: (event: DragEvent) => { event.dataTransfer?.setData('text/plain', card.id); } }, [h('strong', card.title), h('select', { 'aria-label': `移动${card.title}`, value: card.lane, disabled: busy.value,
          onChange: (event: Event) => send({ type: 'move', id: card.id, lane: (event.target as HTMLSelectElement).value }) }, lanes.map(option => h('option', { value: option.id }, option.label)))])),
      !cards.value.some(card => card.lane === lane.id) ? h('p', { class: 'empty' }, '将任务拖到这里') : null,
    ]))),
  ]) }).mount('#app');
}
