# DSH 安装与启用（本机实测）

日期：2026-10-20（Asia/Hong_Kong）· 插件 **0.17.0**

## 目标

把 `dsh-zhizhang` 以 `link:` 挂进 DeepSeek Harness profile，并**真正启用**（bundle + patch），
确认工具层与 Web 面板都出现。

## 本机环境

| 项 | 事实 |
|----|------|
| DSH 桌面端 | `E:\dsh\DeepSeek Harness.exe`；更新通道 nightly |
| DSH 版本 | **0.2.1-rc.2**（`dsh --version`；2026-10-20 实测） |
| CLI | `E:\dsh\resources\runtime\cli\bin\dsh.cmd`（Electron `ELECTRON_RUN_AS_NODE` 跑 `app.asar\dsh\...\cli.js`） |
| profile | `C:\Users\Administrator\.dsh\profiles\desktop` |
| 插件目录 | `E:\dsh cj\dsh-zhizhang-0.15.3`（link 名以目录为准，包内 version 为 0.17.0） |
| Node | 用宿主自带运行时即可；插件声明 `node >= 22` |

## 安装

```bash
# 1) 挂依赖（pnpm link；只装依赖，不改 loader）
dsh plugin --profile desktop add link:"E:/dsh cj/dsh-zhizhang-0.15.3"

# 2) 启用（关键！CLI 不会自动加 bundle）
#    编辑 C:\Users\Administrator\.dsh\profiles\desktop\package.json：
#    "dsh": { "profile": { "bundles": [ ... , "dsh-zhizhang" ] } }
#
#    或者不写 bundle，改在 profile 的 cordis.patch.yml 里加一行 insert
#    （见插件根目录 cordis.patch.yml）

# 3) 重启 DeepSeek Harness（或重启 profile）

# 4) 会话内按需启用（关键）
#    普通会话只多一个 zhizhang_enable；
#    让 Agent 调 zhizhang_enable（或说「启用织章」）后，52 个工具 + 硬规则才挂到本会话。

# 5) 验证
#    桌面 profile 由 Electron 独占，CLI `--dump-config` 会拒绝：
#    error: profile "desktop" is managed exclusively by the Electron application
#    改用 GUI 侧栏「织章」/ 会话里的 zhizhang_enable 回执确认。
```

只出现在 `node_modules` / `dependencies` 里**不算**启用；还要在 `dsh.profile.bundles`（或 patch）里，
重启后由 `zhizhang_enable` 触发工具层。

## 配置

插件配置在 bundle 的 `config` 层（`cordis.patch.yml` 或 profile patch）。
挂载本身只注册 `zhizhang_enable` + 只读面板 HTTP；工具层在会话内触发。

```yaml
- insert:
    - id: zhizhang
      name: 'dsh-zhizhang'
      config:
        rootDir: '.zhizhang'          # 默认：<会话 cwd>/.zhizhang
        # storageRoot: 'D:/writes'     # 可选：固定存储根（HTTP 面板同用）
        # libraryRoot: 'D:/writes/shared-library'  # 可选：拆书库复用（见 docs/DATA.md）
        # sourceRoot: 'D:/books'       # 可选：本地书源目录（按文件名导入）
        # worksRoot: 'D:/writes/novels'  # 可选：作品目录（一本书一个同名文件夹）
        # allowLanPanel: false         # 默认仅 loopback
        # multiDraft:
        #   enabled: false               # 可选多草稿（默认关）
```

## 本机历史（0.2.0 时代，仅存档）

- 旧 npm 全局 CLI 入口依赖 `import.meta.main`，Node 20 下会静默退出；当时用 Bun 跑 bin.js。
- 0.2.1 桌面端自带 runtime CLI，上面的绕行已不需要。
- 当时 `link:` + `--dump-config` 已验证能出现 zhizhang 层；**但只有 bundles/patch 生效后才算加载**。

## 冒烟（不依赖 DSH）

```bash
cd "E:/dsh cj/dsh-zhizhang-0.15.3"
npm run smoke
```
