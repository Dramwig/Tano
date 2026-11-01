import codex from '../assets/model-icons/lobehub/codex-color.svg?raw';
import claudecode from '../assets/model-icons/lobehub/claudecode-color.svg?raw';
import claude from '../assets/model-icons/lobehub/claude-color.svg?raw';
import gemini from '../assets/model-icons/lobehub/gemini-color.svg?raw';
import deepseek from '../assets/model-icons/lobehub/deepseek-color.svg?raw';
import qwen from '../assets/model-icons/lobehub/qwen-color.svg?raw';
import mistral from '../assets/model-icons/lobehub/mistral-color.svg?raw';
import kimi from '../assets/model-icons/lobehub/kimi-color.svg?raw';
import zhipu from '../assets/model-icons/lobehub/zhipu-color.svg?raw';
import minimax from '../assets/model-icons/lobehub/minimax-color.svg?raw';
import doubao from '../assets/model-icons/lobehub/doubao-color.svg?raw';
import cohere from '../assets/model-icons/lobehub/cohere-color.svg?raw';
import hunyuan from '../assets/model-icons/lobehub/hunyuan-color.svg?raw';
import wenxin from '../assets/model-icons/lobehub/wenxin-color.svg?raw';
import siliconcloud from '../assets/model-icons/lobehub/siliconcloud-color.svg?raw';
import openrouter from '../assets/model-icons/lobehub/openrouter-color.svg?raw';
import aihubmix from '../assets/model-icons/lobehub/aihubmix-color.svg?raw';
import ai302 from '../assets/model-icons/lobehub/ai302-color.svg?raw';
import burncloud from '../assets/model-icons/lobehub/burncloud-color.svg?raw';
import newapi from '../assets/model-icons/lobehub/newapi-color.svg?raw';
import together from '../assets/model-icons/lobehub/together-color.svg?raw';
import fireworks from '../assets/model-icons/lobehub/fireworks-color.svg?raw';
import openai from '../assets/model-icons/lobehub/openai.svg?raw';
import grok from '../assets/model-icons/lobehub/grok.svg?raw';
import groq from '../assets/model-icons/lobehub/groq.svg?raw';

// Brand avatars use bundled color artwork independently of monochrome model menus.
export const connectionBrandIcons: Readonly<Record<string, string>> = {
  claude,
  codex,
  claudecode,
  gemini,
  deepseek,
  qwen,
  mistral,
  kimi,
  zhipu,
  minimax,
  doubao,
  cohere,
  hunyuan,
  wenxin,
  siliconcloud,
  openrouter,
  aihubmix,
  ai302,
  burncloud,
  newapi,
  together,
  fireworks,
  openai: openai.replaceAll('currentColor', '#19C37D'),
  grok,
  groq: groq.replaceAll('currentColor', '#F55036'),
};
