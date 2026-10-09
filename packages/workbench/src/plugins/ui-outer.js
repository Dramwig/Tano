// Fixed trusted bootstrap in an opaque frame. Its CSP also restricts child self-navigation.
addEventListener('message', function initialize(event) {
  if (event.source !== parent || event.data?.type !== 'tano-view-init' || !event.ports[0]) return;
  removeEventListener('message', initialize);
  const port = event.ports[0];
  const channel = new MessageChannel();
  const child = document.createElement('iframe');
  child.setAttribute('sandbox', 'allow-scripts allow-forms');
  child.setAttribute('referrerpolicy', 'no-referrer');
  child.title = '插件自定义界面';
  child.style.cssText = 'width:100%;height:100%;border:0;display:block';
  document.body.style.cssText = 'margin:0;height:100vh;overflow:hidden';
  let loaded = false, connected = false;
  const csp = "default-src 'none'; script-src '" + event.data.innerHash + "' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  child.onload = () => {
    if (loaded) { child.remove(); port.postMessage({ type: 'failed', error: '插件界面发生了未授权导航' }); return; }
    loaded = true;
    child.contentWindow.postMessage({ type: 'tano-view-code', source: event.data.clientSource + '\ntry {\nawait (async (tanoView) => {\n' + event.data.bundle.source + '\n})(tanoView);\nport.postMessage({type:"ready"});\n} catch(error) { report(error); }' }, '*');
  };
  addEventListener('message', function connect(message) {
    if (connected || message.source !== child.contentWindow || message.data?.type !== 'tano-view-connect') return;
    connected = true;
    removeEventListener('message', connect);
    child.contentWindow.postMessage({ type: 'tano-view-channel', state: event.data.state, html: event.data.bundle.html, css: event.data.bundle.css }, '*', [channel.port2]);
  });
  port.onmessage = event => channel.port1.postMessage(event.data);
  channel.port1.onmessage = event => port.postMessage(event.data);
  child.srcdoc = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp + '"><div id="app"></div><script>' + event.data.innerSource + '<\/script>';
  document.body.append(child);
  addEventListener('pagehide', () => { channel.port1.close(); port.close(); });
});
