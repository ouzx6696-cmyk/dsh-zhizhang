#!/usr/bin/env node
/** Offline, non-overwriting backup of explicit asset roots; no automatic restore or migration. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MANIFEST = 'writer-novel-backup-manifest.json';
const INCOMPLETE = '.writer-backup-incomplete';
function fail(msg) { throw new Error(msg); }
async function sha(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
async function scan(root) {
  const entries = [];
  async function visit(dir, rel) {
    const names = (await readdir(dir)).sort();
    for (const name of names) {
      const file = path.join(dir, name), item = rel ? path.join(rel, name) : name;
      const st = await lstat(file);
      if (name === '.writer-write-lock') fail(`发现写锁 ${file}；请停止所有写入进程并核对后再备份。`);
      if (st.isSymbolicLink()) entries.push({ path: item, type: 'symlink', target: await readlink(file) });
      else if (st.isDirectory()) { entries.push({ path: item, type: 'directory' }); await visit(file, item); }
      else if (st.isFile()) entries.push({ path: item, type: 'file', size: st.size, sha256: await sha(file) });
      else fail(`不支持的文件类型：${file}`);
    }
  }
  await visit(root, '');
  return entries;
}
async function makeBackup(sources, output) {
  if (!sources.length || !output) fail('用法：node scripts/backup.mjs --source 目录 [--source 目录 ...] --output 新目录');
  const roots = [];
  for (const source of sources) {
    const root = await realpath(source);
    if (!(await lstat(root)).isDirectory()) fail(`来源不是目录：${source}`);
    if (roots.some(other => inside(other, root) || inside(root, other))) fail('来源目录重复或互相包含，请只选择不重叠的根目录。');
    roots.push(root);
  }
  const dest = path.join(await realpath(path.dirname(path.resolve(output))), path.basename(path.resolve(output)));
  if (roots.some(root => inside(root, dest))) fail('备份目标不能在来源目录中。');
  await mkdir(dest, { mode: 0o700 }); // requires a new directory
  await writeFile(path.join(dest, INCOMPLETE), '备份尚未完成，不能用于恢复。\n', { flag: 'wx', mode: 0o600 });
  const manifest = { version: 1, createdAt: new Date().toISOString(), roots: [] };
  for (let i=0; i<roots.length; i++) {
    const root = roots[i], name = `root-${i+1}`, target = path.join(dest, name);
    const before = await scan(root);
    await mkdir(target, { mode: 0o700 });
    for (const entry of before) {
      const from = path.join(root, entry.path), to = path.join(target, entry.path);
      if (entry.type === 'directory') await mkdir(to, { mode: 0o700 });
      else if (entry.type === 'symlink') await symlink(entry.target, to);
      else await copyFile(from, to, constants.COPYFILE_EXCL);
    }
    const after = await scan(root), copied = await scan(target);
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(before) !== JSON.stringify(copied)) fail(`来源 ${root} 在备份期间变化或校验失败；保留未完成标记，请检查后重新备份。`);
    manifest.roots.push({ name, source: root, entries: before });
  }
  await writeFile(path.join(dest, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rm(path.join(dest, INCOMPLETE));
  const links = manifest.roots.flatMap(r => r.entries.filter(e => e.type === 'symlink'));
  console.log(`备份完成：${dest}；${roots.length} 个根目录。符号链接 ${links.length} 个仅保存链接本身，不包含链接目标。`);
}
async function verifyBackup(output) {
  if (!output) fail('用法：node scripts/backup.mjs --verify 备份目录');
  const dest = await realpath(output);
  try { await lstat(path.join(dest, INCOMPLETE)); fail('备份标记为未完成，不能使用。'); }
  catch (err) { if (err?.code !== 'ENOENT') throw err; }
  const manifest = JSON.parse(await readFile(path.join(dest, MANIFEST), 'utf8'));
  if (manifest?.version !== 1 || !Array.isArray(manifest.roots) || !manifest.roots.length) fail('备份清单格式无效。');
  for (let i=0; i<manifest.roots.length; i++) {
    const root = manifest.roots[i];
    if (root.name !== `root-${i+1}` || !Array.isArray(root.entries)) fail('备份清单内容无效。');
    const dir = path.join(dest, root.name);
    if (!(await lstat(dir)).isDirectory()) fail(`备份目录缺失：${root.name}`);
    if (JSON.stringify(await scan(dir)) !== JSON.stringify(root.entries)) fail(`校验失败：${root.name} 的文件、链接或内容发生变化。`);
  }
  console.log(`备份校验通过：${dest}；符号链接只校验链接本身。`);
}
try {
  const args = process.argv.slice(2), sources = [];
  let output = '', verify = '';
  for (let i=0; i<args.length; i++) {
    const flag = args[i], value = args[++i];
    if (!value || value.startsWith('--')) fail(`缺少参数值：${flag}`);
    if (flag === '--source') sources.push(value);
    else if (flag === '--output') output = value;
    else if (flag === '--verify') verify = value;
    else fail(`未知参数：${flag}`);
  }
  if (verify) { if (sources.length || output) fail('--verify 不能与备份参数同时使用。'); await verifyBackup(verify); }
  else await makeBackup(sources, output);
} catch (err) { console.error(`备份失败：${err instanceof Error ? err.message : String(err)}`); process.exitCode = 1; }
