import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildPlugin, verifyPlugin } from './plugin-build.mjs';
import { startPluginWatch } from './plugin-watch.mjs';
import { preparePluginRelease, buildPluginCatalog } from './plugin-catalog.mjs';
import { createPlugin } from './plugin-create.mjs';

const [command, input, ...args] = process.argv.slice(2);
const help = 'Usage: npm run plugin -- create <directory> [--template vanilla|vue|react] | pack <directory> [output.json] | verify <package.json> | watch <directory> --origin <app-origin> [--port <port>] | release <package.json> <new-directory> --publisher <id> --source <https-url> --license <license> [--notes <file>] | catalog <reviewed-index.json> <new-directory> --packages <directory> (--previous <published-index.json> | --initial)';
if (!input || !['create', 'pack', 'verify', 'watch', 'release', 'catalog'].includes(command)) throw new Error(help);
const target = resolve(input);
if (command === 'create') {
  if (args.length && (args.length !== 2 || args[0] !== '--template')) throw new Error(help);
  await createPlugin(target, args[1] ?? 'vanilla');
  console.log(`Created ${target}. Edit manifest.json and main.ts, then run npm run plugin -- pack "${target}".`);
} else if (command === 'release' || command === 'catalog') {
  if (!args[0]) throw new Error(help);
  const options = {};
  const allowed = command === 'release' ? ['publisher', 'source', 'license', 'notes'] : ['packages', 'previous', 'initial'];
  for (let i = 1; i < args.length; i++) {
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || !allowed.includes(key) || Object.hasOwn(options, key)) throw new Error(help);
    options[key] = key === 'initial' ? true : args[++i];
    if (!options[key]) throw new Error(help);
  }
  if (command === 'release') {
    const release = await preparePluginRelease(target, resolve(args[0]), options);
    console.log(`Prepared submission ${release.manifest.id}@${release.manifest.version}\nSHA-256 ${release.integrity}\nThis is not published. Submit release.json and packages/ for catalog maintainer review.`);
  } else {
    if (!options.packages) throw new Error(help);
    const catalog = await buildPluginCatalog(target, resolve(args[0]), options);
    console.log(`Built ${catalog.name}: ${catalog.releases.length} releases. Review and deploy the output to your configured HTTPS catalog host.`);
  }
} else if (command === 'watch') {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--origin', '--port'].includes(args[i]) || !args[i + 1]) throw new Error(help);
    options[args[i].slice(2)] = args[i + 1];
  }
  const watcher = await startPluginWatch(target, { origin: options.origin, port: Number(options.port ?? 0), log: console.log });
  console.log(`Development package URL: ${watcher.url}`);
  console.log('Paste this URL into the installed plugin development mode. Press Ctrl+C to stop.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void watcher.close(); });
} else {
  const { pkg, canonical, integrity } = command === 'pack' ? await buildPlugin(target) : await verifyPlugin(await readFile(target, 'utf8'));
  if (command === 'pack') {
    const destination = resolve(args[0] ?? join(target, `${pkg.manifest.id}-${pkg.manifest.version}.tano-plugin.json`));
    await writeFile(destination, canonical + '\n'); console.log(`Packed ${destination}`);
  }
  console.log(`${pkg.manifest.id}@${pkg.manifest.version}\nSHA-256 ${integrity}`);
}
