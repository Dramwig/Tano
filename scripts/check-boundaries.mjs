import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbidden=new Set(['@tano/server','@tano/sync','@tano/cloud-contracts','@tano/collaboration','@hocuspocus/provider','@hocuspocus/server','@milkdown/plugin-collab','yjs','y-prosemirror','y-protocols']);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(['node_modules','target','dist','gen','.git'].includes(e.name)?[]:walk(path.join(dir,e.name))):[path.join(dir,e.name)]);
const failures=[];
for(const folder of ['apps','packages','crates'])for(const f of walk(path.join(root,folder))){
 const relative=path.relative(root,f);
 if(path.basename(f)==='package.json'){
  const p=JSON.parse(fs.readFileSync(f,'utf8'));
  for(const dep of Object.keys({...p.dependencies,...p.devDependencies,...p.peerDependencies}))if(forbidden.has(dep))failures.push(`${relative}: private dependency ${dep}`);
 }
 if(/\.(ts|vue|mjs)$/.test(f)){
  const source=ts.createSourceFile(f,fs.readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true);
  const inspect=n=>{if(ts.isStringLiteralLike(n))for(const dep of forbidden)if(n.text===dep||n.text.startsWith(dep+'/'))failures.push(`${relative}: private module ${n.text}`);ts.forEachChild(n,inspect);};inspect(source);
  const text=fs.readFileSync(f,'utf8');
  // Vue templates are not TS; this also catches private static/dynamic imports in SFC scripts.
  for(const match of text.matchAll(/(?:from\s*|import\s*\(|require\s*\()(['"])([^'"]+)\1/g))for(const dep of forbidden)if(match[2]===dep||match[2].startsWith(dep+'/'))failures.push(`${relative}: private import ${match[2]}`);
 }
 if(path.basename(f)==='Cargo.toml'&&/tano-cloud|sync_storage/.test(fs.readFileSync(f,'utf8')))failures.push(`${relative}: private native dependency`);
}
for(const p of ['apps/server','packages/sync','deploy','compose.yaml','compose.https.yaml',
 'packages/workbench/src/chat.ts','packages/workbench/src/stores/chat.ts',
 'packages/workbench/src/components/ChatView.vue','packages/workbench/src/components/SidebarChat.vue',
 'packages/workbench/src/components/ChatCreateDialog.vue',
])if(fs.existsSync(path.join(root,p)))failures.push(`Private product path: ${p}`);
if(failures.length)throw new Error([...new Set(failures)].join('\n'));
console.log('Public source and dependency boundary verified.');
