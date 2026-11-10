<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { Save, ChevronDown } from 'lucide-vue-next';
import type { AssistantConnection, AssistantQuotaConfig } from '@tano/protocol';
import { useAssistantStore } from '../assistant/store';
const props = defineProps<{ connection: AssistantConnection }>();
const emit = defineEmits<{ close: []; saved: []; busy: [boolean] }>();
const assistant = useAssistantStore();
const cli = computed(() => props.connection.kind === 'codex-cli' || props.connection.kind === 'claude-cli');
const enabled = ref(props.connection.quota?.mode !== 'disabled' && (cli.value || !!props.connection.quota));
const config = ref<AssistantQuotaConfig>({ timeoutSeconds: 20, intervalMinutes: 0, ...props.connection.quota, mode: props.connection.quota?.mode === 'disabled' ? (cli.value ? 'official' : 'generic') : props.connection.quota?.mode ?? (cli.value ? 'official' : 'generic') });
const key = ref('');
const clearKey = ref(false);
const saving = ref(false);
watch(saving, value => emit('busy', value), { flush: 'sync' });
const error = ref('');
const notice = ref('');
const toggle = ref<HTMLButtonElement>();
const templates = computed(() => cli.value ? [{ id: 'official', label: t('官方订阅') }] : [
  { id: 'generic', label: t('通用模板') }, { id: 'newapi', label: 'NewAPI' }, { id: 'sub2api', label: 'Sub2API' },
  { id: 'deepseek', label: 'DeepSeek' }, { id: 'siliconflow', label: t('硅基流动') }, { id: 'openrouter', label: 'OpenRouter' }, { id: 'custom', label: t('自定义') },
]);
const recipes: Record<string, object> = {
  generic: { path: '/v1/usage', method: 'GET', remainingPath: '/remaining', unit: 'USD' },
  newapi: { path: '/api/user/self', method: 'GET', remainingPath: '/data/quota', usedPath: '/data/used_quota', unit: 'USD' },
  sub2api: { path: '/v1/usage', method: 'GET', remainingPath: '/remaining', unit: 'USD' },
  deepseek: { path: '/user/balance', method: 'GET', remainingPath: '/balance_infos/0/total_balance', unit: 'CNY' },
  siliconflow: { path: '/v1/user/info', method: 'GET', remainingPath: '/data/totalBalance', unit: 'CNY' },
  openrouter: { path: '/api/v1/key', method: 'GET', remainingPath: '/data/limit_remaining', usedPath: '/data/usage', totalPath: '/data/limit', unit: 'USD' },
};
function recipe() { const c = { ...recipes[config.value.mode], ...config.value }; return JSON.stringify({ path: c.path ?? '/v1/usage', method: c.method ?? 'GET', auth: c.auth ?? 'bearer', ...(c.body ? { body: c.body } : {}), remainingPath: c.remainingPath ?? '/remaining', ...(c.usedPath ? { usedPath: c.usedPath } : {}), ...(c.totalPath ? { totalPath: c.totalPath } : {}), unit: c.unit ?? 'USD' }, null, 2); }
const code = ref(recipe());
function selectTemplate(id: string) {
  if (id === 'custom') { code.value = recipe(); config.value.mode = 'custom'; return; }
  const { baseUrl, timeoutSeconds, intervalMinutes, userId } = config.value;
  config.value = { baseUrl, timeoutSeconds, intervalMinutes, userId, mode: id as AssistantQuotaConfig['mode'], ...recipes[id] };
  code.value = recipe(); error.value = ''; notice.value = '';
}
async function save() {
  if (saving.value) return;
  error.value = ''; notice.value = '';
  let value = { ...config.value };
  if (enabled.value && value.mode === 'custom') {
    try {
      const parsed = JSON.parse(code.value);
      const fields = ['path', 'method', 'auth', 'body', 'remainingPath', 'usedPath', 'totalPath', 'unit'];
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).some(k => !fields.includes(k)) || Object.values(parsed).some(v => typeof v !== 'string')) throw new Error();
      value = { ...value, ...parsed };
    } catch { error.value = t('提取设置需要有效的 JSON，请检查字段名称和引号。'); return; }
  }
  if (!enabled.value) value = { ...value, mode: 'disabled' };
  saving.value = true;
  try {
    await assistant.saveQuota(props.connection.id, value, clearKey.value ? '' : key.value || undefined);
    key.value = ''; clearKey.value = false; notice.value = t('额度查询配置已保存'); emit('saved');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { saving.value = false; }
}
onMounted(async () => { await nextTick(); toggle.value?.focus({ preventScroll: true }); });
</script>
<template>
  <form class="quota-panel" :aria-label="t('额度查询配置')" @submit.prevent="save()" @keydown.esc.stop.prevent="!saving && emit('close')">
    <header><h2>{{ t('额度查询') }}</h2></header>
    <div class="quota-scroll">
    <fieldset :disabled="saving">
      <section class="quota-card quota-enable"><div><strong>{{ t('启用额度查询') }}</strong><p class="quota-help">{{ t('查看服务商余额与可用额度') }}</p></div><button ref="toggle" type="button" role="switch" :aria-checked="enabled" :aria-label="t('启用额度查询')" class="quota-switch" @click="enabled = !enabled"><span /></button></section>
      <template v-if="enabled">
        <section class="quota-card">
          <h5>{{ t('预设模板') }}</h5>
          <div class="quota-templates" :aria-label="t('预设模板')"><button v-for="template in templates" :key="template.id" type="button" :aria-pressed="config.mode === template.id" @click="selectTemplate(template.id)">{{ template.label }}</button></div>
          <p v-if="cli" class="quota-help">{{ t('使用本机 {0} 登录账号，无需填写密钥。', [connection.kind === 'codex-cli' ? 'Codex' : 'Claude Code']) }}</p>
          <template v-else>
            <div class="quota-subheading"><h5>{{ t('凭证配置') }}</h5><span>{{ t('留空使用连接配置') }}</span></div>
            <div class="quota-grid">
              <label>{{ t('请求地址') }} <small>{{ t('可选') }}</small><input v-model="config.baseUrl" type="url" maxlength="2000" :placeholder="connection.endpoint || 'https://api.example.com'" /></label>
              <label>{{ config.mode === 'newapi' ? t('访问令牌') : 'API Key' }} <small>{{ t('可选') }}</small><input v-model="key" type="password" autocomplete="new-password" maxlength="2000" :disabled="clearKey" :placeholder="config.mode === 'newapi' ? t('在个人安全设置中生成') : t('留空使用已保存的密钥')" /></label>
              <label v-if="config.mode === 'newapi'">{{ t('用户 ID') }}<input v-model="config.userId" inputmode="numeric" pattern="[0-9]+" required :placeholder="t('例如：114514')" /></label>
            </div>
            <label class="quota-clear"><input v-model="clearKey" type="checkbox" />{{ t('清除独立查询密钥，改用连接密钥') }}</label>
            <p v-if="config.mode === 'newapi'" class="quota-help">{{ t('填写站点的访问令牌与用户 ID；额度按 NewAPI 默认比例 500000 单位 / USD 换算。') }}</p>
          </template>
          <div class="quota-grid quota-timing">
            <label>{{ t('超时时间') }} <small>{{ t('秒') }}</small><input v-model.number="config.timeoutSeconds" type="number" min="1" max="120" required /></label>
            <label>{{ t('自动查询间隔') }} <small>{{ t('分钟') }}</small><input v-model.number="config.intervalMinutes" type="number" min="0" max="1440" required /></label>
          </div>
          <p class="quota-help">{{ t('0 表示不自动查询；仅在助手设置打开时定时刷新。') }}</p>
        </section>
        <details v-if="!cli" class="quota-card quota-advanced config-disclosure" :open="config.mode === 'custom'">
          <summary><strong>{{ t('高级提取设置') }}</strong><span>{{ config.mode === 'custom' ? t('JSON 配置') : t('字段映射') }}<ChevronDown :size="14" /></span></summary>
          <p class="quota-help">{{ config.mode === 'custom' ? t('编辑请求路径、方法与结果字段。字段路径如 /data/balance；支持 GET / POST。') : t('以下为模板的字段映射预览。需要修改时请选择自定义模板。') }}</p>
          <textarea v-model="code" :aria-label="t('提取设置 JSON')" :readonly="config.mode !== 'custom'" spellcheck="false" rows="12" />
        </details>
      </template>
    </fieldset>
    </div>
    <p v-if="error" class="quota-error" role="alert">{{ error }}</p><p v-if="notice" class="quota-help" role="status">{{ notice }}</p>
    <footer>
      <button type="button" class="secondary-button" :disabled="saving" @click="emit('close')">{{ t('取消') }}</button>
      <button type="submit" class="secondary-button" :disabled="saving"><Save :size="14" />{{ saving ? t('正在保存…') : t('保存') }}</button>
    </footer>
  </form>
</template>
<style scoped>
.quota-panel { flex-basis: 100%; min-width: 0; display: grid; gap: 16px; padding: 16px 0 20px; }
.quota-panel header, .quota-enable, .quota-subheading, .quota-advanced summary, .quota-panel footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.quota-panel h2, .quota-panel h5, .quota-panel p { margin: 0; }
.quota-panel h2 { font-size: 15px; }.quota-panel h5 { font-size: 13px; font-weight: 600; }
.quota-panel fieldset { display: grid; gap: 16px; min-width: 0; border: 0; margin: 0; padding: 0; }
.quota-card { border: 1px solid var(--line); border-radius: 12px; padding: 20px; background: var(--paper); }
.quota-enable { font-size: 13px; padding-block: 16px; }
.quota-switch { width: 32px; height: 18px; padding: 2px; border-radius: 20px; background: var(--muted); flex: none; }
.quota-switch span { display: block; height: 14px; width: 14px; border-radius: 50%; background: white; transition: transform .15s; }
.quota-switch[aria-checked='true'] { background: var(--green); }.quota-switch[aria-checked='true'] span { transform: translateX(14px); }
.quota-templates { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 20px; }
.quota-templates button { border: 1px solid var(--line); border-radius: 20px; padding: 5px 12px; color: var(--muted); font-size: 12px; }
.quota-templates button[aria-pressed='true'] { background: var(--green); border-color: var(--green); color: var(--on-accent, white); }
.quota-subheading { margin-bottom: 14px; }.quota-subheading span, .quota-panel small, .quota-help { color: var(--muted); font-size: 12px; line-height: 1.6; }
.quota-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.quota-grid label { display: block; font-size: 12px; min-width: 0; }.quota-grid input { display: block; width: 100%; margin-top: 7px; height: 34px; border: 1px solid var(--line); border-radius: 6px; background: var(--hover); color: var(--text); padding: 6px 10px; font: inherit; }
.quota-timing { border-top: 1px solid var(--line); margin-top: 18px; padding-top: 18px; margin-bottom: 8px; }
.quota-clear { display: flex; align-items: center; gap: 6px; margin: 12px 0 6px; font-size: 12px; color: var(--muted); }
.quota-advanced summary { cursor: pointer; font-size: 13px; list-style: none; }.quota-advanced summary span { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }.quota-advanced[open] summary { margin-bottom: 14px; }
.quota-advanced textarea { box-sizing: border-box; width: 100%; resize: vertical; margin-top: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--hover); color: var(--text); font: 12px/1.7 Consolas, monospace; tab-size: 2; }
.quota-panel footer { justify-content: flex-end; }.quota-error { color: var(--danger); font-size: 12px; }
.quota-panel footer button {
  background: var(--paper);
  color: var(--text-secondary);
  border: 1px solid var(--control-border);
}
.quota-panel footer button:hover:not(:disabled) {
  background: var(--hover);
}
@media (max-width: 600px) { .quota-grid { grid-template-columns: 1fr; }.quota-card { padding: 14px; }.quota-subheading { align-items: flex-start; flex-direction: column; gap: 4px; } }
</style>
