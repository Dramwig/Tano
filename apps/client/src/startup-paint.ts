/** Give the startup DOM a frame before parsing the workbench's large modules. */
export function startupPaint(): Promise<void> {
  // Only browser startup needs this yield. Hidden pages have nothing to paint
  // and may suspend animation frames indefinitely.
  if (document.visibilityState !== 'visible') return Promise.resolve();
  return new Promise(resolve => {
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(finish);
    });
    document.addEventListener('visibilitychange', visibilityChanged);
    function visibilityChanged() {
      if (document.visibilityState !== 'visible') finish();
    }
    function finish() {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibilityChanged);
      resolve();
    }
  });
}
