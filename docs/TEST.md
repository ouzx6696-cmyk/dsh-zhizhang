# 测试说明 · dsh-zhizhang 0.10.0

> 加测纪律也写在 [CHANGE.md](./CHANGE.md)。认知入口：[COGNITION.md](./COGNITION.md)。

## 结构

| 层 | 目录 | 测什么 |
|----|------|--------|
| **产品闭环** | `test/contracts/product-loop.test.ts` | 同一句闭环、分喂纪律、ProductMap 交接、SYSTEM_BRIEF 硬点 |
| **调度** | `test/contracts/state-reshape · contracts/scheduler.test.ts` | 默认路径不含例行 audit；旁路表；工具 description 标签 |
| 契约 | `test/contracts/` | PortConfig、AcceptPolicy、MethodRegistry、QualityPolicy、brief-lean |
| 门禁 | `test/gates/` | HumanFeel / NovelSense / Brief·Lint·Payoff·Save / linter / payoff-audit |
| 支柱工序 | `test/pillars/` | Library / Inspiration / Writing 工序（仍属同一闭环） |
| 工具 | `test/tools/` | 注册烟测 + SYSTEM_BRIEF 硬点（不断言逐句文案） |

## 加测规则

1. **新能力 → 一条契约套件**，不是 N 条句子测试。  
2. 策略改动只落 `src/lib/ports/`；测试用 **hit code** / 硬拒 code，少绑中文长句。  
3. 金样正文放 `test/fixtures/`。  
4. 禁止为 SYSTEM_BRIEF / dissect 新加的一句单独开 `test()`。  
5. 端到端只保留一条全家桶路径；细节回 gates/contracts。  
6. **产品叙事变更**（闭环句、分喂、互指）优先落 `product-loop`，勿在 pillars 里重复粘贴长文断言。  
7. **调度变更**优先落 `scheduler`；工具 description 的【默认链】/【旁路】标签一并核对。

## 双轴 / combo（仍有效）

- `pillars/library` · `inspiration` · `contracts/brief-lean`：axis / mind 准入 / forge 分喂 / lean 不灌 mind  
- combo：按书/按轴过滤与 `suggestCombo`（1 mind + N craft）

## 命令

```bash
bun test
```
