import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const manifest of ['crates/tano-native/Cargo.toml','apps/client/src-tauri/Cargo.toml']) {
  const result=spawnSync('cargo',['test','--release','--locked','--features','tauri/custom-protocol','--manifest-path',manifest],{cwd:root,stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:process.env.CARGO_TARGET_DIR??resolve(root,'apps/client/src-tauri/target')}});
  if(result.status!==0)process.exit(result.status??1);
}
