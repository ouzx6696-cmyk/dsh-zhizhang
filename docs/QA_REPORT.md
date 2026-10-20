# QA

> **历史记录**：本文是 0.15.3 的自检快照；当前版本与自检结果见 [STATUS.md](./STATUS.md) 与 [CHANGE.md](./CHANGE.md)。

当前事实与门禁命令见 [STATUS.md](./STATUS.md)；测试说明见 [TEST.md](./TEST.md)。

## 0.15.3 自检记录（2026-10-18）

| 项 | 结果 |
|----|------|
| `npm run smoke` | **通过**（52 tools · 写作链 · 硬闸 · 沙箱 · 面板 HTTP） |
| 未 lint 直接 accept | 硬拒 `lint_required` |
| 双采纳 | 硬拒 `candidate_already_accepted` |
| 章节/候选 id 穿越 | 工具与 HTTP 均 `bad_id` |
| 面板 POST 缺 confirm | 400 `confirm_required` |
| snapshot 默认 HTML | 不返回；`?html=1` 才返回 |
| `health.version` | 与 `package.json` 一致（0.15.3） |
| 面板根对齐 | 工具根写入标记；新进程 `resolveHttpPaths` 返回 `last-agent-tool` |
| 真实宿主全链（DSH 0.2.1-rc.2） | **通过**：project_create → outline_set → chapter_brief → candidate_stage → style_lint → candidate_accept（172 字，happened 已追加） |
| 按需挂载（profile） | 只注册 `zhizhang_enable`；不注入硬规则 section |
| 触发后 | 52 tools + 1 section 挂到 Agent 作用域；重复调用幂等 |
| 无 Agent 作用域 | 返回 `no_agent_ctx`，不挂载 |

复现：

```bash
cd "E:/dsh cj/dsh-zhizhang-0.15.0"
npm run smoke
```
