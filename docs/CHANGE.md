# 改动指南 · 只动 Ports · 测试怎么长

> 策略与可演进行为落在 `src/lib/ports/`。工具保持薄。  
> 端口细则：[PORTS.md](./PORTS.md) · 测试规则：[TEST.md](./TEST.md)

---

## 总则

| 可以 | 不可以 |
|------|--------|
| 改 Port 实现或 `PortConfig` | 在工具 `execute` 里新写 if-硬闸 |
| 给 Gate 加可选 flag（默认软） | 把禁词命中默认升级为硬拒质量法 |
| 扩展 MethodRegistry 资产 id | 把整包方法灌进 `SYSTEM_BRIEF` |
| 经 Audit 端口换传感器实现 | 让 AI / bash 直写 `chapters/` / `library/cards/` |
| 扩展 Library / Inspiration 契约 | 用 foundation notes 假装技法卡已入库；静默 foundation_set |
| 改 Scheduler 默认线/旁路表 | 在工具里另写一套「推荐链」绕过 Scheduler |

契约类型：`GateDecision`（`ok` + `messages[]`；`ok===false` 须硬拒）。

---

## 改哪里（按意图）

| 你想改的 | 打开 |
|----------|------|
| 默认路径 / 旁路表 / 回执下一步 | `ports/scheduler.ts`（再确认 ProductMap / SYSTEM_BRIEF 引用它） |
| 产品地图叙事 / 三阶段交接文案 | `ports/product.ts`（闭环句 ≡ Scheduler.defaultLine） |
| 质量面文案 / 毒点政策 / 书债线索 | `ports/quality-policy.ts` |
| 拆书双轴 / 准入 / combo / lean 卡块 | `ports/library.ts` |
| 灵感分喂 / forge / apply | `ports/inspiration.ts` |
| Accept 组合顺序与旗标默认 | `ports/accept-policy.ts` + `ports/config.ts` |
| 各闸软硬行为 | `*-gate.ts` |
| lean/full 方法包列表 | `ports/methods.ts` + `method-assets.ts` |
| 常驻硬规则短文 | `tools/brief.ts`（`SYSTEM_BRIEF`；保持短，细节指 product_map） |
| 当前小说状态 / happened 对齐 | `ports/foundation.ts` + `tools/candidates.ts`；读者合同 `method-assets.ts` |
| 库准入（声纹假阳） | `ports/library.ts` `admitCardContent` / `neutralizeVoiceNegations` |
| 工具名与参数壳 | `src/tools/*`（只接线，不藏策略） |
| 落盘路径与原子写 | `lib/store.ts`（谨慎；DATA.md 同步） |

Compose 入口：`src/index.ts` 只注册工具 + apply，不塞业务 if。

---

## 新能力怎么挂

1. **先定端口**：新策略 → 新 Port 或扩展现有 Port；导出挂到 `ports/index.ts`。  
2. **工具薄接**：`defineTool` → 调 Port → 回执引用 `Scheduler.nextHint(...)`。  
3. **地图/硬规则**：若改变「怎么跑」，更新 Scheduler（及必要时 SYSTEM_BRIEF 一句指针）。  
4. **测试**：一条**契约套件**，不是 N 条句子测试。  
   - 产品叙事（闭环句、分喂、互指）→ `test/contracts/product-loop.test.ts`  
   - 调度默认/旁路 → `test/contracts/scheduler.test.ts`  
   - 闸/传感 → `test/gates/`  
   - 支柱工序 → `test/pillars/`  
5. **断言偏好**：hit code / 硬拒 code；少绑中文长句；金样放 `test/fixtures/`。  
6. **禁止**：为 SYSTEM_BRIEF / dissect 新加的一句单独开 `test()`。  
7. **版本**：只改 docs → 可不升版；动契约/默认行为 → 升小版并改 `package.json` + STATUS + ProductMap/Scheduler `version` 对齐。  
8. **打包**：用户不主动要 zip **就不打包**。

---

## 改完自检

```bash
bun test
npm run typecheck
# 需要 dist 时再 npm run build
```

确认：默认链仍最短合格；旁路仍显式；mind/craft 分喂未破；雷达默认仍软。

---

## 0.10.3 注意

- 全量梳理小步：style_contract 加「句长有起伏」；lean 开篇正向句；lean 读者合同不再重复本章 ending（处境区保留一处）。
- HumanFeel 过齐回显正向化；README 对齐版本与「审校留痕」。
- 版本号 → 0.10.3。续章前章正文全文（0.10.2）不变。

## 0.10.2 注意

- 续章（n≥2）lean `chapter_brief` **注入前章正文全文**（软顶 16000）；ending / happened 只作索引。
- 不再用短文末/章末摘录省 token；旧 `bodyTail` / `include_prev_tail` 仍兼容。
- 版本号 → 0.10.2。

## 0.10.1 注意

- **Agent 可见提示正向调教**：brief / SYSTEM_BRIEF / 方法包 / 毒点提醒 / forge·dissect 文案写「要写成什么样」；少叠「不要xx」。
- 改版本时**不要**把「旧版不要那样」写进 Agent 视野（会提醒旧坏法）。工程硬闸与拒收回显改法可保留。
- 版本号文案大修 → 0.10.1（结构仍接 0.10.0 小说状态）。

## 0.10.0 注意

- Agent 可见勿再写「账本/书账/book_ledger」作连续性正面词；用 **当前小说状态**。
- `ledger.json` / `review_ledger` 工具 id 可留；展示名用「审校留痕」。
- 毒点 `ledger_dump` 检测保留（罚记账体，不是把状态叫账本）。
