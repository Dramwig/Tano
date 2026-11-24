import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js';
import 'mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js';
import 'mathjax-full/js/input/tex/textmacros/TextMacrosConfiguration.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

/** Standalone SVG paths work without editor CSS, fonts or an image service. */
export function clipboardMathSVG(source: string, display: boolean): string {
  // A fresh input context prevents macros and equation tags leaking between copies.
  const input = new TeX({
    packages: ['base', 'ams', 'newcommand', 'configmacros', 'color', 'boldsymbol', 'cancel', 'mathtools', 'textmacros'],
    maxBuffer: 10000,
    maxMacros: 1000,
    formatError: (_jax: unknown, error: Error) => { throw new Error(`无法转换公众号公式：${error.message}`); },
  });
  const renderer = mathjax.document('', { InputJax: input, OutputJax: new SVG({ fontCache: 'none' }) });
  const result = renderer.convert(source, { display, em: 16, ex: 8, containerWidth: 640 });
  return adaptor.outerHTML(result);
}
