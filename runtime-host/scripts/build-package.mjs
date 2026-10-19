import { build } from 'esbuild';
import { access, chmod, copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeBinary = process.argv[2] || process.env.NANTHAI_NODE_BINARY;
if (!nodeBinary) throw new Error('Supply an existing Node 22 binary: npm run build:package -- /absolute/path/to/node');
const identity = JSON.parse(execFileSync(nodeBinary, ['-p', 'JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})'], {encoding:'utf8'}));
if (!identity.version.startsWith('22.') || identity.platform !== 'darwin') throw new Error('The preview package requires macOS Node 22');
const pkg = JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const destination = process.argv[3] ? resolve(process.argv[3])
  : join(root, 'dist', `nanthai-${pkg.version}-darwin-${identity.arch}`);
await mkdir(dirname(destination), {recursive:true});
await mkdir(destination, {recursive:false});
await mkdir(join(destination,'runtime'));
await copyFile(nodeBinary, join(destination,'runtime/node'));
let nodeLicense = join(dirname(nodeBinary),'../LICENSE');
try { await access(nodeLicense); }
catch { nodeLicense = join(dirname(nodeBinary),'NODE-LICENSE'); }
await copyFile(nodeLicense, join(destination,'runtime/NODE-LICENSE'));
const result = await build({
  absWorkingDir:root, entryPoints:['src/cli_entry.ts','src/worker_entry.ts','src/pi_worker_entry.ts'],
  outdir:join(destination,'app'), outExtension:{'.js':'.mjs'},
  bundle:true, platform:'node', target:'node22', format:'esm', metafile:true,
});
if (Object.keys(result.metafile.inputs).some((path) => /codex.sdk|spike_|live_probe/.test(path))) throw new Error('Experimental code entered the shipping bundle');
await cp(join(root,'packaging'), destination, {recursive:true});
const sourceDocs = 'https://github.com/thevarsek/nanthai-edge-oss/blob/main/';
await writeFile(join(destination,'README.md'), (await readFile(join(root,'README.md'),'utf8')).replaceAll('](../', `](${sourceDocs}`));
await copyFile(join(root,'node_modules/zod/LICENSE'),join(destination,'ZOD-LICENSE'));
await copyFile(join(root,'node_modules/convex/LICENSE'),join(destination,'CONVEX-LICENSE'));
for (const file of ['nanthai','install.command','uninstall.command','runtime/node']) await chmod(join(destination,file),0o755);
await writeFile(join(destination,'manifest.json'),JSON.stringify({version:pkg.version,node:identity,sourceRevision:execFileSync('git',['describe','--always','--dirty'],{cwd:root,encoding:'utf8'}).trim(),nodeSha256:createHash('sha256').update(await readFile(nodeBinary)).digest('hex')},null,2)+'\n');
execFileSync('tar',['-czf',`${destination}.tar.gz`,'-C',dirname(destination),destination.split('/').at(-1)]);
console.log(destination);
