<script setup lang="ts">
import { computed } from 'vue';
import { Settings2 } from 'lucide-vue-next';
import gmail from '../../assets/mail-provider-icons/gmail.svg';
import icloud from '../../assets/mail-provider-icons/icloud.svg';
import netease126 from '../../assets/mail-provider-icons/netease-126.svg';
import netease163 from '../../assets/mail-provider-icons/netease-163.svg';
import outlook from '../../assets/mail-provider-icons/outlook.svg';
import qq from '../../assets/mail-provider-icons/qq.svg';
import yahoo from '../../assets/mail-provider-icons/yahoo.svg';

const props = defineProps<{ provider: string }>();
const icons = new Map([
  ['gmail', gmail],
  ['icloud', icloud],
  ['netease-126', netease126],
  ['netease-163', netease163],
  ['outlook', outlook],
  ['qq', qq],
  ['yahoo', yahoo],
]);
const icon = computed(() => icons.get(props.provider));
</script>

<template>
  <span class="mail-provider-icon" :class="{ generic: !icon }" aria-hidden="true">
    <img v-if="icon" :src="icon" alt="" />
    <Settings2 v-else :size="15" />
  </span>
</template>
