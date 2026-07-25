import * as esbuild from 'esbuild';
import copy from 'esbuild-plugin-copy';
import fs from "fs/promises";
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const outdir = resolve(__dirname, 'out');
await fs.rm(outdir, { recursive: true, force: true });

await esbuild.build({
    outdir,
    entryPoints: [resolve(__dirname, 'src/extension.ts')],
    bundle: true,
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    alias: {
        '@mapbox/node-pre-gyp': resolve(__dirname, 'node-pre-gyp.js')
    },
    plugins: [
        copy({
            assets: [
                {
                    from: ['./node_modules/cricodecs/hca-wasm/pkg/hca_wasm_bg.wasm'],
                    to: ['.'],
                },
                {
                    from: ['./src/py/py_bridge.py'],
                    to: ['./py/py_bridge.py'],
                }
            ]
        })
    ]
});