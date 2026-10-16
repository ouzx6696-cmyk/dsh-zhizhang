# DSH CLI 安装备忘（本机验证）

日期：2026-10-15（Asia/Hong_Kong）

## 目标

把 `dsh-zhizhang` 以 `link:` 挂进 DeepSeek Harness profile，确认 bundle patch 出现在 `--dump-config`。

## 包信息

- npm：`@deepseek-ai/dsh@0.2.0-rc.2`
- bin：`dsh` → `lib/bin.js`
- 引擎警告：大量依赖声明 `node >= 22` / `>= 22.19`；本机当时为 **Node v20.19.2**。
- 入口用 `if (import.meta.main) await runCli()`——**Node 20 下 `import.meta.main` 为假**，直接执行 `dsh` / `node …/bin.js` 会**静默退出、无输出**。用 **Bun** 跑同一 bin 正常。

## 推荐命令

```bash
npm i -g @deepseek-ai/dsh@0.2.0-rc.2
export PATH="$HOME/.local/bin:$PATH"   # npm 全局 bin 若不在 PATH

# Node ≥22 时可直接：
dsh --version

# Node 20 权宜：
bun "$(npm root -g)/@deepseek-ai/dsh/lib/bin.js" --version

cd /path/to/dsh-zhizhang && npm run build
bun "$(npm root -g)/@deepseek-ai/dsh/lib/bin.js" plugin --profile web add link:$(pwd)
bun "$(npm root -g)/@deepseek-ai/dsh/lib/bin.js" --profile web --dump-config | grep -n zhizhang
```

## 本环境实测记录

| 步骤 | 结果 |
|------|------|
| `npm i -g @deepseek-ai/dsh@0.2.0-rc.2` | 成功（542 packages）；大量 `EBADENGINE`（要 Node≥22） |
| `dsh` 不在默认 PATH | bin 在 `~/.local/bin/dsh` |
| `node …/bin.js --version` | **空输出 exit 0**（`import.meta.main` 未触发） |
| `bun …/bin.js --version` | `0.2.0-rc.2` |
| `plugin --profile web add link:/workspace/dsh-zhizhang`（经 bun） | 成功；初始化 `~/.dsh/profiles/web`；pnpm link 写入依赖 |
| `--profile web --dump-config` | 出现 `# == dsh-zhizhang` / `id: zhizhang` / `rootDir: .zhizhang` |

### 阻断结论（给父代理）

1. **硬阻断（纯 Node 20）**：官方 CLI 入口依赖 `import.meta.main`，Node 20 无法自启动；需 **Node ≥22** 或用 **Bun 调 bin.js**。
2. **非阻断**：插件 `link:` + dump-config **已验证通过**（经 Bun 跑 CLI）。
3. 无 CLI 时：`bun test` + `npm run build` 仍可完整验证工具层。

## 无 dsh 冒烟

```bash
bun test
npm run build
```
