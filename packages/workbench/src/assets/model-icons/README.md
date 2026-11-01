# Bundled model icons

The 29 unmodified monochrome SVGs and 22 unmodified color SVGs in `lobehub/` come from
[`@lobehub/icons-static-svg` 1.95.1](https://www.npmjs.com/package/@lobehub/icons-static-svg/v/1.95.1),
part of [Lobe Icons](https://github.com/lobehub/lobe-icons), copyright (c) 2023 LobeHub.
They retain their [MIT license](lobehub/LICENSE). Brand names and marks belong to
their respective owners; use here identifies models and does not imply endorsement.

Package: `https://registry.npmjs.org/@lobehub/icons-static-svg/-/icons-static-svg-1.95.1.tgz`

Package integrity: `sha512-Hw7EPPgVnC4NZLXBfTNJG6hyQgqECfUPC11VVXodPSr1aebKcFxDZlSpxhWwYNdCc6bhxps/x5TtXoPmfKH2ag==`

Upstream paths: `package/icons/{openai,codex,claudecode,claude,gemini,gemma,deepseek,qwen,grok,mistral,meta,kimi,zhipu,minimax,doubao,yi,baichuan,cohere,hunyuan,wenxin,siliconcloud,openrouter,aihubmix,ai302,burncloud,newapi,together,groq,fireworks}.svg`.

Color paths: `package/icons/{codex,claudecode,claude,gemini,deepseek,qwen,mistral,kimi,zhipu,minimax,doubao,cohere,hunyuan,wenxin,siliconcloud,openrouter,aihubmix,ai302,burncloud,newapi,together,fireworks}-color.svg`.

The package omits its license file; the retained license is from upstream revision
[`c385b2b8d1f9e19aa86e628d4e23c91ee1111a47`](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/LICENSE).

Tano imports only these local assets. Model menus inherit the surrounding text color for
light and dark themes. Connection avatars use the color variants, with dark backgrounds
for Kimi and OpenRouter for contrast. OpenAI uses Lobe Icons' GPT-3 green (`#19C37D`),
Groq uses its primary orange (`#F55036`), and Grok uses a Tano-selected navy-on-blue
avatar treatment. These three treatments are applied at render time to monochrome assets.
Upstream palette definitions are `src/OpenAI/style.ts`, `src/Groq/style.ts`, and
`src/Grok/style.ts` at the same revision linked above.
No icon CDN or runtime package is required. Model family
aliases live in [model-icons.ts](../../assistant/model-icons.ts); unfamiliar IDs keep
an empty icon slot so model labels align, and `cli-default` keeps the terminal icon.

Codex and Claude Code use their dedicated bundled marks for CLI connection avatars
and explicitly named model families. GPT/OpenAI and Claude retain their provider marks.
