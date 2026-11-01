import type { AssistantConnection } from '@tano/protocol';
import { modelIcon } from './model-icons';
import siliconcloud from '../assets/model-icons/lobehub/siliconcloud.svg?raw';
import openrouter from '../assets/model-icons/lobehub/openrouter.svg?raw';
import aihubmix from '../assets/model-icons/lobehub/aihubmix.svg?raw';
import ai302 from '../assets/model-icons/lobehub/ai302.svg?raw';
import burncloud from '../assets/model-icons/lobehub/burncloud.svg?raw';
import newapi from '../assets/model-icons/lobehub/newapi.svg?raw';
import together from '../assets/model-icons/lobehub/together.svg?raw';
import groq from '../assets/model-icons/lobehub/groq.svg?raw';
import fireworks from '../assets/model-icons/lobehub/fireworks.svg?raw';

const extra = { siliconcloud, openrouter, aihubmix, ai302, burncloud, newapi, together, groq, fireworks };
const providers: [string, string, string[]][] = [
  ['openai', 'OpenAI / Codex', ['openai.com']],
  ['claude', 'Anthropic / Claude', ['anthropic.com']],
  ['gemini', 'Google Gemini', ['googleapis.com']],
  ['deepseek', 'DeepSeek', ['deepseek.com']],
  ['qwen', '通义千问', ['aliyuncs.com']],
  ['grok', 'xAI', ['x.ai']],
  ['mistral', 'Mistral', ['mistral.ai']],
  ['kimi', 'Kimi / Moonshot', ['moonshot.cn', 'moonshot.ai']],
  ['zhipu', '智谱', ['bigmodel.cn', 'z.ai']],
  ['minimax', 'MiniMax', ['minimax.io', 'minimaxi.com']],
  ['doubao', '豆包', ['volces.com']],
  ['cohere', 'Cohere', ['cohere.com', 'cohere.ai']],
  ['hunyuan', '腾讯混元', ['hunyuan.tencentcloudapi.com']],
  ['wenxin', '文心', ['baidubce.com']],
  ['siliconcloud', '硅基流动', ['siliconflow.cn', 'siliconflow.com']],
  ['openrouter', 'OpenRouter', ['openrouter.ai']],
  ['aihubmix', 'AiHubMix', ['aihubmix.com']],
  ['ai302', '302.AI', ['302.ai']],
  ['burncloud', 'BurnCloud', ['burncloud.com']],
  ['newapi', 'New API', []],
  ['together', 'Together AI', ['together.xyz', 'together.ai']],
  ['groq', 'Groq', ['groq.com']],
  ['fireworks', 'Fireworks AI', ['fireworks.ai']],
];
export const connectionIconOptions = providers.map(([id, label]) => ({ id, label }));
export type ConnectionIdentity = Pick<AssistantConnection, 'name' | 'endpoint' | 'kind' | 'icon'>;
function serviceUrl(endpoint: string): URL | undefined {
  try {
    const url = new URL(endpoint);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    return url;
  } catch { return; }
}
export function connectionIcon(connection: ConnectionIdentity) {
  const url = serviceUrl(connection.endpoint);
  const detected = connection.kind === 'codex-cli' ? 'openai' : connection.kind === 'claude-cli' ? 'claude'
    : providers.find(([, , domains]) => domains.some(domain => url?.hostname === domain || url?.hostname.endsWith(`.${domain}`)))?.[0];
  const selected = connection.icon && connection.icon !== 'auto' ? connection.icon : detected;
  const svg = selected && selected !== 'initials' && providers.some(([id]) => id === selected)
    ? (extra[selected as keyof typeof extra] ?? modelIcon(selected)?.svg) : undefined;
  return {
    brand: svg ? selected : undefined,
    svg,
    // Use only the origin: API paths, query parameters and credentials never reach image requests.
    favicon: !svg && selected !== 'initials' && url && (!connection.kind || connection.kind === 'api')
      ? `${url.origin}/favicon.ico` : undefined,
    initials: Array.from(connection.name.trim()).slice(0, 2).join('').toLocaleUpperCase() || 'AI',
  };
}
