import {copyFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {build} from 'esbuild';
await build({entryPoints:[new URL('./index.ts',import.meta.url).pathname],bundle:true,format:'iife',globalName:'HarnessReplay',platform:'browser',target:'es2020',minify:true,legalComments:'eof',outfile:new URL('./dist/harness-replay-v1.js',import.meta.url).pathname});

if(process.argv[2]){const target=resolve(process.argv[2]);await mkdir(dirname(target),{recursive:true});await copyFile(new URL('./dist/harness-replay-v1.js',import.meta.url),target);}
