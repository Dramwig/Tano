<script setup lang="ts">
import { provide } from 'vue';
import { provideEditorWindow } from '@tano/editor/dom-context';
import { windowContextKey, type WindowContext } from './context';

const props = defineProps<{ context: WindowContext }>();
provide(windowContextKey, props.context);
provideEditorWindow(props.context.window);
</script>

<template><slot /></template>
