// Disposable HTTPS endpoint for exercising the real native updater and NSIS.
// Its private CA is embedded only in the isolated QA build, never OS trust.
import { createServer } from 'node:https';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
const pointer = resolve('artifacts/updater-e2e-current.json');
const resume = process.argv.includes('--resume');
const suffix = randomUUID().slice(0, 8);
const fixture = resume
  ? JSON.parse(await readFile(pointer, 'utf8'))
  : {
      root: resolve(`artifacts/updater-e2e-${suffix}`),
      identifier: `app.tano.updateqa.q${suffix}`,
      productName: `Tano Update QA ${suffix}`,
      workspaceId: randomUUID(),
      serverUrl: '',
    };
if (!resume) {
  await mkdir(join(fixture.root, 'certs'), { recursive: true });
  await mkdir(join(fixture.root, 'releases'), { recursive: true });
  await mkdir(join(fixture.root, 'Workspace/.tano'), { recursive: true });
  const openssl = process.env.OPENSSL_PATH || 'C:/Program Files/Git/usr/bin/openssl.exe';
  function command(executable, args, cwd) {
    const result = spawnSync(executable, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0)
      throw new Error(`Fixture setup failed (${result.status}): ${result.stderr}`);
  }
  const certs = join(fixture.root, 'certs');
  command(
    openssl,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      'ca.key',
      '-out',
      'ca.pem',
      '-days',
      '7',
      '-subj',
      '/CN=Tano isolated update QA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    ],
    certs,
  );
  command(
    openssl,
    [
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      'server.key',
      '-out',
      'server.csr',
      '-subj',
      '/CN=localhost',
    ],
    certs,
  );
  await writeFile(
    join(certs, 'server.ext'),
    'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',
  );
  command(
    openssl,
    [
      'x509',
      '-req',
      '-in',
      'server.csr',
      '-CA',
      'ca.pem',
      '-CAkey',
      'ca.key',
      '-CAcreateserial',
      '-out',
      'server.pem',
      '-days',
      '7',
      '-sha256',
      '-extfile',
      'server.ext',
    ],
    certs,
  );
  command(
    openssl,
    [
      'x509',
      '-req',
      '-in',
      'server.csr',
      '-signkey',
      'server.key',
      '-out',
      'untrusted.pem',
      '-days',
      '7',
      '-sha256',
      '-extfile',
      'server.ext',
    ],
    certs,
  );
  command(
    process.execPath,
    [
      resolve('node_modules/@tauri-apps/cli/tauri.js'),
      'signer',
      'generate',
      '--ci',
      '--password',
      'fixture-only',
      '--write-keys',
      join(fixture.root, 'signing.key'),
    ],
    process.cwd(),
  );
  await writeFile(
    join(fixture.root, 'Workspace/.tano/config.json'),
    JSON.stringify({ id: fixture.workspaceId, format: 1 }),
  );
  await writeFile(
    join(fixture.root, 'Workspace/README.md'),
    '# Update acceptance\n\nThis document must survive update, restart, rollback, and uninstall.\n',
  );
  await writeFile(
    join(fixture.root, 'Workspace/Notes.md'),
    '# Second tab\n\nKeep this tab in the restored session.\n',
  );
  await writeFile(
    join(fixture.root, 'Workspace/attachment.bin'),
    new Uint8Array([0, 255, 128, 13, 10, 1]),
  );
}
const server = createServer(
  {
    key: await readFile(join(fixture.root, 'certs/server.key')),
    cert: await readFile(
      join(
        fixture.root,
        process.argv.includes('--untrusted-certificate')
          ? 'certs/untrusted.pem'
          : 'certs/server.pem',
      ),
    ),
  },
  async (request, response) => {
    let status = 200;
    try {
      const path = new URL(request.url, 'https://localhost').pathname;
      response.setHeader('Cache-Control', 'no-store');
      let body;
      if (path === '/latest.json') {
        body = await readFile(join(fixture.root, 'latest.json')).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          status = 204;
          return Buffer.alloc(0);
        });
        response.setHeader('Content-Type', 'application/json');
      } else if (path.startsWith('/releases/')) {
        const name = decodeURIComponent(path.slice('/releases/'.length));
        if (basename(name) !== name || !name.endsWith('.exe')) throw new Error('Unknown artifact');
        body = await readFile(join(fixture.root, 'releases', name));
        response.setHeader('Content-Type', 'application/octet-stream');
      } else {
        status = 404;
        body = Buffer.from('Not found');
      }
      response.writeHead(status, { 'Content-Length': body.length });
      response.end(body);
    } catch {
      status = 404;
      response.writeHead(status).end();
    }
    await appendFile(
      join(fixture.root, 'requests.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), path: request.url, status }) + '\n',
    );
  },
);
server.on('tlsClientError', (error) => {
  void appendFile(
    join(fixture.root, 'requests.jsonl'),
    JSON.stringify({ at: new Date().toISOString(), tlsError: error.code || error.message }) + '\n',
  );
});
await new Promise((resolve) =>
  server.listen(
    fixture.serverUrl ? Number(new URL(fixture.serverUrl).port) : 0,
    '127.0.0.1',
    resolve,
  ),
);
fixture.serverUrl = `https://127.0.0.1:${server.address().port}`;
fixture.installed = join(fixture.root, 'Installed');
await writeFile(pointer, JSON.stringify(fixture, null, 2));
console.log(`Isolated updater fixture: ${fixture.serverUrl}\n${fixture.root}`);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => server.close(() => process.exit(0)));
