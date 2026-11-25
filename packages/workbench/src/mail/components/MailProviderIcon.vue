<script setup lang="ts">
import { computed } from 'vue';
import { Settings2 } from 'lucide-vue-next';
import aliyunMail from '../../assets/mail-provider-icons/aliyun-mail.svg';
import gmail from '../../assets/mail-provider-icons/gmail.svg';
import icloud from '../../assets/mail-provider-icons/icloud.svg';
import netease126 from '../../assets/mail-provider-icons/netease-126.svg';
import netease163 from '../../assets/mail-provider-icons/netease-163.svg';
import qq from '../../assets/mail-provider-icons/qq.svg';
import tencentExmail from '../../assets/mail-provider-icons/tencent-exmail.svg';

const props = defineProps<{ provider: string }>();
const icons = new Map([
  ['aliyun-mail', aliyunMail],
  ['gmail', gmail],
  ['icloud', icloud],
  ['netease-126', netease126],
  ['netease-163', netease163],
  ['qq', qq],
  ['tencent-exmail', tencentExmail],
]);
const icon = computed(() => icons.get(props.provider));
</script>

<template>
  <span class="mail-provider-icon" :class="{ generic: !icon }" aria-hidden="true">
    <img v-if="icon" :src="icon" alt="" />
    <Settings2 v-else :size="15" />
  </span>
</template>
