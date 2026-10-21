// Dependency-free markup: the first frame must not wait for Vue or the editor.
const bar = '<span class="tano-skeleton-bar"></span>';
export const startupSkeleton = `<div class="tano-skeleton-shell" aria-hidden="true">
  <aside class="tano-skeleton-sidebar"><div class="tano-skeleton-brand"><img src="/favicon-green.svg?v=3" alt="" />同页</div>${bar.repeat(3)}<div class="tano-skeleton-sidebar-bottom">${bar.repeat(2)}</div></aside>
  <div class="tano-skeleton-content"><span class="tano-skeleton-bar tano-skeleton-title"></span><span class="tano-skeleton-bar tano-skeleton-subtitle"></span><span class="tano-skeleton-bar tano-skeleton-toolbar"></span>${`<div class="tano-skeleton-row">${bar.repeat(4)}</div>`.repeat(4)}</div>
</div>`;
