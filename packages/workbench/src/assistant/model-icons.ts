import openai from '../assets/model-icons/lobehub/openai.svg?raw';
import claude from '../assets/model-icons/lobehub/claude.svg?raw';
import gemini from '../assets/model-icons/lobehub/gemini.svg?raw';
import gemma from '../assets/model-icons/lobehub/gemma.svg?raw';
import deepseek from '../assets/model-icons/lobehub/deepseek.svg?raw';
import qwen from '../assets/model-icons/lobehub/qwen.svg?raw';
import grok from '../assets/model-icons/lobehub/grok.svg?raw';
import mistral from '../assets/model-icons/lobehub/mistral.svg?raw';
import meta from '../assets/model-icons/lobehub/meta.svg?raw';
import kimi from '../assets/model-icons/lobehub/kimi.svg?raw';
import zhipu from '../assets/model-icons/lobehub/zhipu.svg?raw';
import minimax from '../assets/model-icons/lobehub/minimax.svg?raw';
import doubao from '../assets/model-icons/lobehub/doubao.svg?raw';
import yi from '../assets/model-icons/lobehub/yi.svg?raw';
import baichuan from '../assets/model-icons/lobehub/baichuan.svg?raw';
import cohere from '../assets/model-icons/lobehub/cohere.svg?raw';
import hunyuan from '../assets/model-icons/lobehub/hunyuan.svg?raw';
import wenxin from '../assets/model-icons/lobehub/wenxin.svg?raw';

const icons = { openai, claude, gemini, gemma, deepseek, qwen, grok, mistral, meta, kimi, zhipu, minimax, doubao, yi, baichuan, cohere, hunyuan, wenxin };
export type ModelIconBrand = keyof typeof icons;

// Match family names rather than pinning individual model versions. A boundary
// avoids matching unrelated names such as "grokking" or "yiwen".
const families: readonly [ModelIconBrand, RegExp][] = [
  ['openai', /^(?:openai|gpt|chatgpt|codex|o1|o3|o4)(?=$|[\d\s._-])/],
  ['claude', /^(?:anthropic|claude|sonnet|opus|haiku)(?=$|[\d\s._-])/],
  ['gemini', /^(?:gemini)(?=$|[\d\s._-])/],
  ['gemma', /^(?:gemma|codegemma|paligemma)(?=$|[\d\s._-])/],
  ['deepseek', /^(?:deepseek|深度求索)(?=$|[\d\s._-])/],
  ['qwen', /^(?:qwen|qwq|qvq|通义千问|千问)(?=$|[\d\s._-])/],
  ['grok', /^(?:grok|xai|x\.ai)(?=$|[\d\s._-])/],
  ['mistral', /^(?:mistral|mixtral|ministral|magistral|devstral|codestral|pixtral)(?=$|[\d\s._-])/],
  ['meta', /^(?:meta|llama|codellama)(?=$|[\d\s._-])/],
  ['kimi', /^(?:kimi|moonshot)(?=$|[\d\s._-])/],
  ['zhipu', /^(?:zhipu|zai|z\.ai|glm|chatglm|智谱)(?=$|[\d\s._-])/],
  ['minimax', /^(?:minimax|abab)(?=$|[\d\s._-])/],
  ['doubao', /^(?:doubao|豆包)(?=$|[\d\s._-])/],
  ['yi', /^(?:yi|零一万物)(?=$|[\d\s._-])/],
  ['baichuan', /^(?:baichuan|百川)(?=$|[\d\s._-])/],
  ['cohere', /^(?:cohere|command-r|command-a|c4ai)(?=$|[\d\s._-])/],
  ['hunyuan', /^(?:hunyuan|混元)(?=$|[\d\s._-])/],
  ['wenxin', /^(?:ernie|wenxin|文心)(?=$|[\d\s._-])/],
];

export function modelIconBrand(model: string): ModelIconBrand | undefined {
  const name = model.normalize('NFKC').trim().toLowerCase();
  if (!name || name === 'cli-default') return undefined;
  // Prefer the model over a provider namespace, including routed/fine-tuned IDs.
  // E.g. openrouter/anthropic/claude-... and ft:gpt-...:organization:suffix.
  const segments = name.split(/[/:]/).reverse();
  for (const segment of segments) {
    // Also accept Bedrock IDs such as us.anthropic.claude-... .
    for (const candidate of [segment, ...segment.split('.').slice(1)]) {
      const brand = families.find(([, pattern]) => pattern.test(candidate.trim()))?.[0];
      if (brand) return brand;
    }
  }
  return undefined;
}

export function modelIcon(model: string) {
  const brand = modelIconBrand(model);
  return brand ? { brand, svg: icons[brand] } : undefined;
}
