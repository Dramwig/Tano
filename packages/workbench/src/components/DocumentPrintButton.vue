<script setup lang="ts">
import { Printer } from 'lucide-vue-next';
import ShortcutHint from '@tano/editor/shortcut-hint';
import { t } from '../i18n';
import { shortcutAriaLabel, shortcutKeys, shortcutLabel, type ShortcutBinding } from '../shortcuts';

defineProps<{ busy?: boolean; disabled?: boolean; shortcut: ShortcutBinding; standalone?: boolean }>();
defineEmits<{ select: [] }>();
</script>

<template>
  <button type="button" :disabled="disabled || busy" :aria-busy="busy"
    :aria-keyshortcuts="shortcutAriaLabel(shortcut) || undefined"
    :title="standalone && shortcutKeys(shortcut).length ? shortcutLabel(shortcut) : undefined"
    @click="$emit('select')">
    <Printer :size="15" />{{ busy ? t('正在准备打印…') : t('打印…') }}<span v-if="!standalone" class="menu-shortcut"><ShortcutHint :label="shortcutKeys(shortcut)[0] ? shortcutLabel(shortcutKeys(shortcut)[0]) : ''" /></span>
  </button>
</template>
