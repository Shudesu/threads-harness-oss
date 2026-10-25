import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from './config.mjs';
import { hashWorkerAsset, normalizeAssetPath } from './asset-hash.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const config = parseConfig(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'));
const output = join(root, 'dist-worker');
const bundle = join(output, 'wfp-bundle');
// Local dry run only. Production commands must use the Cloud account wrapper.
execFileSync(join(root, 'node_modules/.bin/wrangler'), ['deploy', '--dry-run', '--outdir', join(output, 'worker')], { cwd: root, stdio: 'inherit' });
rmSync(bundle, { recursive: true, force: true });
mkdirSync(join(bundle, 'worker'), { recursive: true });
const modules = readdirSync(join(output, 'worker')).filter(f => f.endsWith('.js')).sort();
if (!modules.includes('index.js')) throw new Error('Worker entry was not built');
for (const f of modules) cpSync(join(output, 'worker', f), join(bundle, 'worker', f));
writeFileSync(join(bundle, 'worker-manifest.json'), JSON.stringify({
  observability: config.observability ?? { enabled: false },
  entry: 'index.js', compatibilityDate: config.compatibility_date,
  compatibilityFlags: config.compatibility_flags ?? [], modules,
  durableObjects: config.durable_objects.bindings, migrations: config.migrations, adminBasePath: '',
}, null, 2) + '\n');
cpSync(join(root, 'dist'), join(bundle, 'assets'), { recursive: true });
const assets = [];
function walk(dir) {
  for (const file of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, file.name);
    if (file.isDirectory()) walk(path);
    else {
      const name = relative(join(bundle, 'assets'), path);
      const data = readFileSync(path);
      assets.push({ path: normalizeAssetPath(name), hash: hashWorkerAsset(name, data), size: data.length });
    }
  }
}
walk(join(bundle, 'assets'));
assets.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(join(bundle, 'manifest.json'), JSON.stringify(assets, null, 2) + '\n');
const schema = readdirSync(join(root, 'migrations')).filter(f => f.endsWith('.sql')).sort()
  .map(f => readFileSync(join(root, 'migrations', f), 'utf8')).join('\n');
writeFileSync(join(bundle, 'schema.sql'), schema);
console.log(`WFP bundle: ${modules.length} modules, ${assets.length} assets. No remote upload performed.`);
