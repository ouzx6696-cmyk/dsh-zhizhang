/**
 * ProductMap — one creative loop + scheduler surface (default vs bypass).
 */
import { InspirationPort } from "./inspiration.js";
import { LibraryPort } from "./library.js";
import { MethodRegistry } from "./methods.js";
import { QualityPolicy } from "./quality-policy.js";
import {
  SCHEDULER_DEFAULT_LINE,
  Scheduler,
} from "./scheduler.js";

export type PillarLiveStatus = "live" | "reserved";

export interface ProductPillarView {
  id: string;
  title: string;
  status: PillarLiveStatus;
  summary: string;
  capabilities: Array<{ id: string; title: string; ready: boolean }>;
  /** Stage in the single creative loop (1=库 2=灵感 3=写作). */
  loopStage: 1 | 2 | 3;
  /** What this stage hands to the next. */
  handsOffTo: string;
}

/** Canonical one-liner — identical to Scheduler.defaultLine(). */
export const CREATIVE_LOOP_LINE = SCHEDULER_DEFAULT_LINE;

export const ProductMap = {
  id: "port.product" as const,
  version: "0.11.1",

  loopLine(): string {
    return Scheduler.defaultLine();
  },

  pillars(): ProductPillarView[] {
    return [
      {
        id: LibraryPort.id,
        title: LibraryPort.title,
        status: LibraryPort.status,
        summary: LibraryPort.summary,
        capabilities: LibraryPort.capabilities(),
        loopStage: 1,
        handsOffTo: Scheduler.nextHint("library_card_accept"),
      },
      {
        id: InspirationPort.id,
        title: InspirationPort.title,
        status: InspirationPort.status,
        summary: InspirationPort.summary,
        capabilities: InspirationPort.capabilities(),
        loopStage: 2,
        handsOffTo: "inspire_accept(apply=true) → " + Scheduler.writeLine(),
      },
      {
        id: "port.writing",
        title: "写作工程",
        status: "live",
        summary:
          "默认兑付段：" +
          Scheduler.writeLine() +
          "；audit/assemble/直写均为旁路（见调度图）。",
        capabilities: [
          { id: "works", title: "作品与根基 / 当前小说状态（happened）", ready: true },
          { id: "outline", title: "章纲处境", ready: true },
          { id: "candidates", title: "候选 stage/accept", ready: true },
          { id: "edit", title: "可选编辑过稿（A 确认验收 / B 仅候选 / C 拒）", ready: true },
          { id: "gates", title: "Brief/Lint + Accept 内嵌软传感", ready: true },
          { id: "assemble", title: "汇编成稿（旁路 finalize）", ready: true },
        ],
        loopStage: 3,
        handsOffTo: Scheduler.nextHint("candidate_accept"),
      },
    ];
  },

  methods() {
    return {
      registry: "port.methods",
      count: MethodRegistry.list().length,
      briefDefaultIds: [...MethodRegistry.briefDefaultIds],
      note: "共享方法包（≠拆书卡）。lean brief 默认仅 style_contract；full 为旁路 brief.full。",
    };
  },

  formatForAgent(): string {
    const lines = [
      `# 织章产品地图 · ${ProductMap.version}`,
      "",
      "## 一条创作闭环",
      ProductMap.loopLine(),
      "",
      "三阶段是同一条链上的工序，不是三个独立产品。拆书只出两样：craft（技法→正文）| mind（思维→设定/纲）。",
      "",
      Scheduler.formatDiagram(),
      "",
      "## 闭环三阶段",
    ];
    for (const p of ProductMap.pillars()) {
      const tag = p.status === "live" ? "已上线" : "预留";
      lines.push(`### ${p.loopStage}. ${p.title}（${tag}）`);
      lines.push(p.summary);
      lines.push(`- 交接：${p.handsOffTo}`);
      for (const c of p.capabilities) {
        lines.push(`- [${c.ready ? "✓" : "·"}] ${c.title}（${c.id}）`);
      }
      lines.push("");
    }
    const m = ProductMap.methods();
    lines.push("## 共享方法资产（MethodRegistry）");
    lines.push(m.note);
    lines.push(`- 数量：${m.count} · brief 默认：${m.briefDefaultIds.join("、")}`);
    lines.push("");
    lines.push("## 分喂纪律");
    lines.push("- **mind** → inspire_forge / 根基·章纲");
    lines.push("- **craft** → chapter_brief(lean) 写法+场面状态");
    lines.push("- combo 的 card_ids 可整包给 inspire；lean brief 自动只吃 craft");
    lines.push("- 写后可选 edit（去空转留毛边，不磨齐刷）：用户选 A/B/C；A 须 confirm；禁止静默验收；技能见 docs/skills/web-novel-master-optimizer.md");
    lines.push("");
    lines.push("## 质量面（QualityPolicy）");
    lines.push(QualityPolicy.surfaceLine());
    lines.push("入库写可迁移的写法或创作思维。雷达 0 ≠ 质量过关。");
    return lines.join("\n");
  },
};
