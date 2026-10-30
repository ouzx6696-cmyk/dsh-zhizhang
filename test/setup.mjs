/** 所有测试共用：DSH_HOME 与长篇数据位置指向临时目录，绝不碰真实的 DSH 主目录。 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const home = mkdtempSync(path.join(tmpdir(), 'writer-test-home-'))
process.env.DSH_HOME = home
for (const key of ['WRITER_NOVEL_ROOT', 'WRITER_NOVEL_WORKS', 'WRITER_NOVEL_LIBRARY', 'WRITER_NOVEL_SOURCE_ROOT', 'WRITER_NOVEL_MULTI_DRAFT', 'WRITER_TOUTIAO_ROOT'])
  delete process.env[key]
process.once('exit', () => rmSync(home, { recursive: true, force: true }))
