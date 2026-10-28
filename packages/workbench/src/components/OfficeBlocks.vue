<script setup lang="ts">
import type { OfficeBlock } from '../office-preview/model';
defineProps<{ blocks: OfficeBlock[]; imageLoading?: 'eager' | 'lazy' }>();
</script>

<template>
  <template v-for="(block, index) in blocks" :key="index">
    <component :is="block.heading ? `h${block.heading}` : 'p'" v-if="block.kind === 'paragraph'" class="office-paragraph">
      <span v-for="(run, runIndex) in block.runs" :key="runIndex" :class="{ bold: run.bold, italic: run.italic, underline: run.underline }">{{ run.text }}</span>
    </component>
    <div v-else-if="block.kind === 'table'" class="office-table-scroll">
      <table class="office-document-table"><tbody>
        <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
          <td v-for="(cell, column) in row" :key="column" :colspan="cell.colspan"><OfficeBlocks :blocks="cell.blocks" :image-loading="imageLoading" /></td>
        </tr>
      </tbody></table>
    </div>
    <img v-else-if="block.kind === 'image'" class="office-image" :src="block.src" :alt="block.alt" :loading="imageLoading ?? 'lazy'" />
  </template>
</template>

<style scoped>
.office-paragraph { margin: 0 0 0.8em; white-space: pre-wrap; overflow-wrap: anywhere; color: inherit; }
.bold { font-weight: 700; } .italic { font-style: italic; } .underline { text-decoration: underline; }
.office-table-scroll { max-width: 100%; overflow: auto; margin: 16px 0; }
.office-document-table { width: 100%; border-collapse: collapse; font-size: 14px; }
td { min-width: 80px; border: 1px solid var(--line); padding: 8px 12px; vertical-align: top; }
td :last-child { margin-bottom: 0; }
.office-image { display: block; max-width: 100%; max-height: 70vh; object-fit: contain; margin: 16px auto; }
</style>
