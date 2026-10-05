import { build } from 'esbuild';
await build({ entryPoints: ['server/index.mjs'], outfile: 'server-bundle.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['sharp'] });
