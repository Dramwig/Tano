<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from 'vue';
import { ArrowUpRight, BookOpen, Check, Copy, Globe, MessageCircle, Monitor, ScrollText } from 'lucide-vue-next';
import { openExternalUrl } from '../../files/attachments';
import { helpDocumentationUrl } from '../../help/help-content';
import { t, uiLocale } from '../../i18n/i18n';
import { useWindowContext } from '../../windows/context';
import UpdatePanel from '../../shell/components/UpdatePanel.vue';
import { settingsPanelContextKey } from './settings-context';

const { window } = useWindowContext();
const ctx = inject(settingsPanelContextKey);
if (!ctx) throw new Error('Settings panel context is required');
const { props, showDeveloperMode, developerModeDescription } = ctx;

const aboutUrls = computed(() => ({
  website: 'https://tano.page/',
  docs: helpDocumentationUrl(props.documentationBaseUrl).replace(/\/?$/, '/'),
  releases: 'https://github.com/Dramwig/Tano/releases',
  issues: 'https://github.com/Dramwig/Tano/issues',
  source: 'https://github.com/Dramwig/Tano',
}));
const aboutLinks = computed(() => [
  { id: 'website', icon: Globe, label: t('官网'), description: 'tano.page', url: aboutUrls.value.website },
  { id: 'docs', icon: BookOpen, label: t('使用文档'), description: t('上手指南与功能说明'), url: aboutUrls.value.docs },
  { id: 'releases', icon: ScrollText, label: t('发行说明'), description: t('查看每个版本的变化'), url: aboutUrls.value.releases },
  { id: 'issues', icon: MessageCircle, label: t('反馈问题'), description: t('报告问题或提出建议'), url: aboutUrls.value.issues },
]);

const aboutLinkError = ref('');
function openAboutLink(event: MouseEvent, url: string) {
  aboutLinkError.value = '';
  // Desktop webviews cannot open target="_blank" links; hand them to the system browser.
  if (!props.native) return;
  event.preventDefault();
  openExternalUrl(url).catch((error) => {
    aboutLinkError.value = String(error);
  });
}

const versionCopied = ref(false);
let versionCopiedTimer: ReturnType<typeof setTimeout> | undefined;
async function copyVersionInfo() {
  const platform = window.navigator.platform || 'unknown';
  const text = `Tano ${props.version} · ${props.mode}${props.native ? ' · desktop' : ''} · ${platform} · ${uiLocale.value}`;
  try {
    await window.navigator.clipboard.writeText(text);
    versionCopied.value = true;
    clearTimeout(versionCopiedTimer);
    versionCopiedTimer = setTimeout(() => {
      versionCopied.value = false;
    }, 1600);
  } catch (error) {
    aboutLinkError.value = String(error);
  }
}
onBeforeUnmount(() => clearTimeout(versionCopiedTimer));
</script>

<template>
  <div class="settings-content settings-about">
    <h2 id="settings-title">{{ t('关于同页') }}</h2>
    <p class="settings-lead">{{ t('了解同页与版本信息。') }}</p>
    <div class="settings-card settings-brand-card" data-surface-role="section" data-settings-key="about-updates">
      <div class="settings-about-brand">
        <img src="../../assets/tano-logo.svg" alt="" />
        <div class="settings-about-identity">
          <!-- i18n-ignore: The Chinese brand suffix is shown only in the Chinese UI. -->
          <h3>Tano <span v-if="uiLocale === 'zh-CN'">/ 同页</span></h3>
          <p class="settings-about-slogan">{{ t('人与 Agent，在同一页工作。') }}</p>
        </div>
        <div class="settings-brand-actions">
          <span class="settings-version-pill">{{ props.version }}</span>
          <button
            type="button"
            class="settings-about-copy"
            :class="{ copied: versionCopied }"
            :aria-label="t('复制版本信息')"
            :data-tooltip="versionCopied ? t('已复制版本信息') : t('复制版本信息，反馈问题时附上')"
            @click="copyVersionInfo"
          >
            <Check v-if="versionCopied" :size="13" />
            <Copy v-else :size="13" />
          </button>
        </div>
      </div>
      <span class="settings-visually-hidden" role="status" aria-live="polite">{{ versionCopied ? t('已复制版本信息') : '' }}</span>
      <div v-if="props.native && !props.mobile" class="settings-about-update">
        <slot name="update-panel"><UpdatePanel /></slot>
      </div>
      <div v-if="showDeveloperMode" class="settings-row" data-settings-key="about-developer-mode">
        <div>
          <strong>{{ t('开发者模式') }}</strong>
          <p>{{ t(developerModeDescription) }}</p>
        </div>
        <button
          type="button"
          class="settings-switch"
          :class="{ on: props.developerMode }"
          role="switch"
          :aria-label="t('开发者模式')"
          :aria-checked="props.developerMode === true"
          @click="ctx.emitUpdateDeveloperMode(!props.developerMode)"
        >
          <span />
        </button>
      </div>
    </div>

    <section class="settings-section" aria-labelledby="settings-about-resources" data-settings-key="about-links">
      <h3 id="settings-about-resources">{{ t('资源与支持') }}</h3>
      <div class="settings-about-links">
        <a
          v-for="link in aboutLinks"
          :key="link.id"
          class="settings-about-link"
          :href="link.url"
          target="_blank"
          rel="noopener noreferrer"
          :data-about-link="link.id"
          @click="openAboutLink($event, link.url)"
        >
          <span class="settings-about-link-icon" aria-hidden="true"><component :is="link.icon" :size="16" /></span>
          <span class="settings-about-link-copy">
            <strong>{{ link.label }}</strong>
            <span>{{ link.description }}</span>
          </span>
          <ArrowUpRight class="settings-about-link-arrow" :size="14" aria-hidden="true" />
        </a>
      </div>
      <p v-if="aboutLinkError" class="settings-about-error" role="alert">{{ aboutLinkError }}</p>
    </section>

    <section class="settings-section" aria-labelledby="settings-work-mode">
      <h3 id="settings-work-mode">{{ t('工作方式') }}</h3>
      <div class="settings-about-feature settings-card" data-surface-role="section">
        <Monitor :size="21" />
        <div>
          <strong>{{
            props.mode === 'demo'
              ? t('你正在体验浏览器演示版')
              : props.mode === 'web'
                ? t('这是你的在线 Markdown 工作台')
                : t('这是你的本地 Markdown 工作台')
          }}</strong>
          <p>{{
            props.mode === 'demo'
              ? t('演示修改保存在当前浏览器，不会写入电脑上的工作文件夹。启动桌面版，即可打开真实文件夹并监听外部修改。')
              : props.mode === 'web'
                ? t('文档由当前存储适配器保存。可用能力由产品入口提供。')
                : t('文档保存为工作文件夹中的普通 .md 文件。Agent 和其他编辑器的修改会自动载入；冲突时保留双方内容。')
          }}</p>
        </div>
      </div>
    </section>

    <footer class="settings-about-footer">
      <span>© 2026 Tano · {{ t('MIT 许可证') }}</span>
      <a
        :href="aboutUrls.source"
        target="_blank"
        rel="noopener noreferrer"
        @click="openAboutLink($event, aboutUrls.source)"
      >
        {{ t('查看源代码') }}<ArrowUpRight :size="11" aria-hidden="true" />
      </a>
    </footer>
  </div>
</template>
