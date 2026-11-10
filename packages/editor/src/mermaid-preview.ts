import DOMPurify from 'dompurify';

export type MermaidRenderer = (source: string, width: number, theme?: 'default' | 'dark') => string | Promise<string>;

let diagramId = 0;
// Mermaid configuration is global. Serialize initialization with rendering so
// an editing preview cannot change the theme of another diagram in flight.
let rendering: Promise<unknown> = Promise.resolve();

export function createMermaidRenderer(): MermaidRenderer {
  const previews = new Map<string, { id: string; svg: string }>();
  return (source, width, theme = 'default') => {
    const key = `${theme}:${source}`;
    const cached = previews.get(key);
    if (cached) {
      previews.delete(key);
      previews.set(key, cached);
      return cached.svg.replaceAll(cached.id, `tano-diagram-${++diagramId}`);
    }
    const result = rendering.then(async () => {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
        htmlLabels: false, theme,
      });
      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
      host.style.width = `${width || document.documentElement.clientWidth}px`;
      document.body.append(host);
      try {
        const id = `tano-diagram-${++diagramId}`;
        const rendered = await mermaid.render(id, source, host);
        const svg = DOMPurify.sanitize(rendered.svg, { USE_PROFILES: { svg: true, svgFilters: true } });
        previews.delete(key);
        previews.set(key, { id, svg });
        if (previews.size > 32) previews.delete(previews.keys().next().value!);
        return svg;
      } finally {
        host.remove();
      }
    });
    rendering = result.catch(() => {});
    return result;
  };
}
