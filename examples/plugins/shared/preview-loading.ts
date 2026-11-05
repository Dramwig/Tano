import './preview-loading.css';

/** Bundled inside each viewer, so loading never requires access to the host DOM. */
export function createPreviewLoading(root: HTMLElement, kind: 'word' | 'presentation') {
  const skeleton = document.createElement('div');
  skeleton.className = `preview-loading preview-loading-${kind}`;
  skeleton.dataset.previewKind = kind;
  skeleton.setAttribute('aria-hidden', 'true');
  skeleton.hidden = true;
  const lines = '<div class="loading-lines"><i></i><i></i><i></i><i></i></div>';
  const paper = kind === 'presentation'
    ? `<div class="loading-paper"><i class="loading-title"></i><div class="loading-slide-body">${lines}<div class="loading-figure"><i></i><i></i><i></i></div></div></div>`
    : `<div class="loading-paper"><i class="loading-running-head"></i><i class="loading-title"></i>${lines}<div class="loading-table">${'<span><i></i></span>'.repeat(9)}</div>${lines}<i class="loading-page-number"></i></div>`;
  skeleton.innerHTML = paper + (kind === 'word' ? paper : '');
  root.append(skeleton);
  return {
    show() { skeleton.hidden = false; root.classList.add('preview-is-loading'); root.setAttribute('aria-busy', 'true'); },
    hide() { skeleton.hidden = true; root.classList.remove('preview-is-loading'); root.setAttribute('aria-busy', 'false'); },
  };
}

// Give the browser a paint opportunity before a parser performs synchronous work.
export const paintPreviewLoading = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
