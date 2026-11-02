import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await build({
  entryPoints: [new URL('../test/engine/components.jsx', import.meta.url).pathname],
  outfile: new URL('../build/test-components.cjs', import.meta.url).pathname,
  bundle: true, platform: 'browser', format: 'cjs', external: ['react', 'react-dom'],
  define: { __WB_VERSION__: JSON.stringify(pkg.version), __WB_PACKAGE__: JSON.stringify(pkg.name) },
  logLevel: 'warning',
});
