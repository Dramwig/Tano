# Bundled model icons

The 18 unmodified monochrome SVGs in `lobehub/` come from
[`@lobehub/icons-static-svg` 1.95.1](https://www.npmjs.com/package/@lobehub/icons-static-svg/v/1.95.1),
part of [Lobe Icons](https://github.com/lobehub/lobe-icons), copyright (c) 2023 LobeHub.
They retain their [MIT license](lobehub/LICENSE). Brand names and marks belong to
their respective owners; use here identifies models and does not imply endorsement.

Package: `https://registry.npmjs.org/@lobehub/icons-static-svg/-/icons-static-svg-1.95.1.tgz`

Package integrity: `sha512-Hw7EPPgVnC4NZLXBfTNJG6hyQgqECfUPC11VVXodPSr1aebKcFxDZlSpxhWwYNdCc6bhxps/x5TtXoPmfKH2ag==`

Upstream paths: `package/icons/{openai,claude,gemini,gemma,deepseek,qwen,grok,mistral,meta,kimi,zhipu,minimax,doubao,yi,baichuan,cohere,hunyuan,wenxin}.svg`.

The package omits its license file; the retained license is from upstream revision
[`c385b2b8d1f9e19aa86e628d4e23c91ee1111a47`](https://github.com/lobehub/lobe-icons/blob/c385b2b8d1f9e19aa86e628d4e23c91ee1111a47/LICENSE).

Tano imports only these local assets and inherits the surrounding text color for
light and dark themes. No icon CDN or runtime package is required. Model family
aliases live in [model-icons.ts](../../assistant/model-icons.ts); unfamiliar IDs use
the generic model icon, and `cli-default` keeps the terminal icon.
