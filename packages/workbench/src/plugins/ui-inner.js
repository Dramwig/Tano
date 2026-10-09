// Creates the executable blob within this frame's own opaque origin.
// This guard belongs to the fixed bootstrap, including if it is reused in a nested srcdoc.
for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
  Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
}
addEventListener('message', function initialize(event) {
  if (event.source !== parent || event.data?.type !== 'tano-view-code' || typeof event.data.source !== 'string') return;
  removeEventListener('message', initialize);
  const url = URL.createObjectURL(new Blob([event.data.source], { type: 'text/javascript' }));
  const script = document.createElement('script');
  script.type = 'module'; script.src = url;
  document.head.append(script);
  addEventListener('pagehide', () => URL.revokeObjectURL(url));
});
