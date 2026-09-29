import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const cargoPackages = [
  ['apps/client/src-tauri/Cargo.toml', 'tano'],
  ['crates/tano-native/Cargo.toml', 'tano-native'],
];
const cargoLocks = [
  ['apps/client/src-tauri/Cargo.lock', ['tano', 'tano-native']],
  ['crates/tano-native/Cargo.lock', ['tano-native']],
];

function read(root, path) {
  return readFileSync(join(root, path), 'utf8');
}

function json(root, path) {
  return JSON.parse(read(root, path));
}

function formatJson(value, original) {
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  return `${JSON.stringify(value, null, 2).replaceAll('\n', newline)}${newline}`;
}

function workspacePaths(root, workspaces) {
  return workspaces.flatMap((pattern) => {
    if (!pattern.endsWith('/*')) throw new Error(`Unsupported workspace pattern: ${pattern}`);
    const parent = pattern.slice(0, -2);
    return readdirSync(join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(root, parent, entry.name, 'package.json')))
      .map((entry) => `${parent}/${entry.name}`);
  });
}

function section(text, marker, name, path) {
  const headers = [...text.matchAll(new RegExp(`^\\[${marker}\\]\\r?$`, 'gm'))];
  for (let index = 0; index < headers.length; index++) {
    const start = headers[index].index;
    const end = headers[index + 1]?.index ?? text.length;
    const body = text.slice(start, end);
    if (name && !new RegExp(`^name = "${name}"\\r?$`, 'm').test(body)) continue;
    const version = /^version = "([^"]+)"\r?$/m.exec(body);
    if (!version) throw new Error(`${path}: missing version for ${name ?? marker}`);
    return {
      value: version[1], start: start + version.index, length: version[0].length,
      carriageReturn: version[0].endsWith('\r'),
    };
  }
  throw new Error(`${path}: missing ${marker} section for ${name ?? marker}`);
}

function tomlVersion(text, marker, name, path) {
  return section(text, marker, name, path).value;
}

function updateToml(text, marker, name, path, version) {
  const found = section(text, marker, name, path);
  return `${text.slice(0, found.start)}version = "${version}"${found.carriageReturn ? '\r' : ''}${text.slice(found.start + found.length)}`;
}

function localSpec(spec, version) {
  if (spec === '*' || spec === 'workspace:*') return spec;
  const prefix = /^(\^|~)?/.exec(spec)[0];
  if (!semver.test(spec.slice(prefix.length))) throw new Error(`Unsupported local dependency version: ${spec}`);
  return `${prefix}${version}`;
}

function dependencyFields(pkg, localNames, version, update, label, errors) {
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!localNames.has(name)) continue;
      const expected = localSpec(spec, version);
      if (update) pkg[field][name] = expected;
      else if (spec !== expected) errors.push(`${label} ${field}.${name}: ${spec} (expected ${expected})`);
    }
  }
}

function inventory(root) {
  const main = json(root, 'package.json');
  if (!semver.test(main.version)) throw new Error(`Invalid app version: ${main.version}`);
  const paths = workspacePaths(root, main.workspaces);
  const packages = new Map([['', main]]);
  for (const path of paths) packages.set(path, json(root, `${path}/package.json`));
  const names = new Set([...packages.values()].map((pkg) => pkg.name));
  if (names.size !== packages.size) throw new Error('Duplicate npm workspace package name');
  return { version: main.version, packages, names };
}

export function checkVersions(root = repository, tag) {
  const { version, packages, names } = inventory(root);
  const errors = [];
  if (tag && (tag !== `core-v${version}` || !/^core-v\d+\.\d+\.\d+$/.test(tag)))
    errors.push(`Tag ${tag} must equal stable Core version core-v${version}`);
  for (const [path, pkg] of packages) {
    if (pkg.version !== version) errors.push(`${path || 'package.json'}: ${pkg.version} (expected ${version})`);
    dependencyFields(pkg, names, version, false, path || 'package.json', errors);
  }
  const lock = json(root, 'package-lock.json');
  if (lock.version !== version) errors.push(`package-lock.json: ${lock.version} (expected ${version})`);
  for (const [path, pkg] of packages) {
    const locked = lock.packages?.[path];
    if (!locked) {
      errors.push(`package-lock.json: missing ${path || 'root'} package`);
      continue;
    }
    if (locked.name !== pkg.name || locked.version !== version)
      errors.push(`package-lock.json ${path || 'root'}: name/version differs from package.json`);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const name of names) {
        if (pkg[field]?.[name] !== locked[field]?.[name])
          errors.push(`package-lock.json ${path || 'root'} ${field}.${name}: differs from package.json`);
      }
    }
  }
  const tauri = json(root, 'apps/client/src-tauri/tauri.conf.json');
  if (tauri.version !== version) errors.push(`tauri.conf.json: ${tauri.version} (expected ${version})`);
  for (const [path, name] of cargoPackages) {
    const actual = tomlVersion(read(root, path), 'package', name, path);
    if (actual !== version) errors.push(`${path}: ${actual} (expected ${version})`);
  }
  for (const [path, packageNames] of cargoLocks) {
    const content = read(root, path);
    for (const name of packageNames) {
      const actual = tomlVersion(content, '\\[package\\]', name, path);
      if (actual !== version) errors.push(`${path} ${name}: ${actual} (expected ${version})`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return version;
}

export function setVersions(root, version) {
  if (!semver.test(version)) throw new Error(`Expected SemVer without a v prefix: ${version}`);
  const { packages, names } = inventory(root);
  const changes = new Map();
  const updated = new Map();
  for (const [path, pkg] of packages) {
    const file = path ? `${path}/package.json` : 'package.json';
    pkg.version = version;
    dependencyFields(pkg, names, version, true, file, []);
    updated.set(path, pkg);
    changes.set(file, formatJson(pkg, read(root, file)));
  }
  const lockPath = 'package-lock.json';
  const lock = json(root, lockPath);
  lock.version = version;
  for (const [path, pkg] of updated) {
    const locked = lock.packages?.[path];
    if (!locked || locked.name !== pkg.name) throw new Error(`${lockPath}: missing ${path || 'root'} package`);
    locked.version = version;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const name of names) {
        if (pkg[field]?.[name] !== undefined) {
          if (!locked[field]) locked[field] = {};
          locked[field][name] = pkg[field][name];
        } else if (locked[field]) delete locked[field][name];
      }
    }
  }
  changes.set(lockPath, formatJson(lock, read(root, lockPath)));
  const tauriPath = 'apps/client/src-tauri/tauri.conf.json';
  const tauri = json(root, tauriPath);
  tauri.version = version;
  changes.set(tauriPath, formatJson(tauri, read(root, tauriPath)));
  for (const [path, name] of cargoPackages)
    changes.set(path, updateToml(read(root, path), 'package', name, path, version));
  for (const [path, packageNames] of cargoLocks) {
    let content = read(root, path);
    for (const name of packageNames)
      content = updateToml(content, '\\[package\\]', name, path, version);
    changes.set(path, content);
  }
  for (const [path, content] of changes) {
    if (read(root, path) !== content) writeFileSync(join(root, path), content);
  }
  return checkVersions(root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [, , command, value, ...rest] = process.argv;
    if (command === 'set' && value && rest.length === 0)
      console.log(`Set Core version to ${setVersions(repository, value)}`);
    else if (command === 'check' && (!value || (value === '--tag' && rest.length === 1)))
      console.log(`Core version ${checkVersions(repository, value ? rest[0] : undefined)} is consistent`);
    else throw new Error('Usage: node scripts/version.mjs set <semver> | check [--tag core-vX.Y.Z]');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
