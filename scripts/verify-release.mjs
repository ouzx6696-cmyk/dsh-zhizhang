/** One candidate, one preparation per target. Standalone commands remain usable. */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const npm = (args, cwd = root) => execFileSync('npm', args, {
  cwd, stdio: 'inherit', shell: process.platform === 'win32',
});
if (process.platform !== 'win32') throw new Error('发行验证请在 Windows 执行，不能以 Linux 构建代替原生交付。');
npm(['run', 'verify']);
npm(['run', 'verify:desktop']);
const out = path.join(root, 'dist-pack');
mkdirSync(out, { recursive: true });
// verify has just prepared this bundle; pack it without rebuilding it again.
npm(['pack', '--pack-destination', out], path.join(root, 'bundle'));
for (const command of ['pack', 'pack:portable']) npm(['run', command, '-w', '@writer/desktop']);
