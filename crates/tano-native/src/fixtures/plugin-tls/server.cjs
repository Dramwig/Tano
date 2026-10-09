// Test-only HTTPS peer. The adjacent key is public test material, never a product credential.
const { createServer } = require('node:https');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
let count = 0;
const server = createServer({ key: readFileSync(join(__dirname, 'key.pem')), cert: readFileSync(join(__dirname, 'cert.pem')) }, (request, response) => {
  count++;
  if (request.url === '/v1/redirect') { response.writeHead(302, { Location: '/v1/ok' }); response.end(); return; }
  if (request.url === '/v1/echo') { response.end(request.headers.authorization); return; }
  if (request.url === '/v1/huge') { response.end('x'.repeat(270000)); return; }
  if (request.url === '/v1/compressed') { response.writeHead(200, { 'Content-Encoding': 'gzip' }); response.end('fake'); return; }
  if (request.url === '/v1/slow') { response.writeHead(200); response.write('partial'); return; }
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    if (request.url === '/oauth/token') {
      const form = new URLSearchParams(body);
      const refreshing = form.get('grant_type') === 'refresh_token';
      const valid = request.method === 'POST' && request.headers['content-type'] === 'application/x-www-form-urlencoded'
        && !request.headers.authorization && !request.headers.cookie && form.get('client_id') === 'test-native-client'
        && (refreshing ? form.get('refresh_token') === 'public-test-refresh-token' : form.get('code') === 'public-test-code' && form.get('code_verifier') === 'v'.repeat(43));
      response.writeHead(valid ? 200 : 400, { 'Content-Type': 'application/json', 'Set-Cookie': 'no_plugin_cookie=1' });
      response.end(JSON.stringify(valid ? { access_token: refreshing ? 'public-refreshed-access-token' : 'public-test-access-token', refresh_token: refreshing ? 'public-rotated-refresh-token' : 'public-test-refresh-token', token_type: 'Bearer', expires_in: 3600 }
        : { error: 'invalid_grant', error_description: 'must-not-return-sensitive-detail' })); return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'no_plugin_cookie=1' });
    response.end(JSON.stringify({ count, authorized: request.headers.authorization === 'Bearer public-test-secret', cookie: request.headers.cookie ?? null, method: request.method, body }));
  });
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
