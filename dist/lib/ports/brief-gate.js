import { getPortConfig } from "./config.js";
import { allow, deny, warn, info } from "./types.js";
export const BriefGate = {
    evaluateAccept(opts) {
        const recentMs = opts.recentMs ?? getPortConfig().briefRecentMs;
        const hours = Math.round(recentMs / 3600000);
        if (!opts.brief && !opts.skipBrief) {
            return deny("brief_required", `采纳前须对本章调用 zhizhang_chapter_brief（依据版本留痕；旧格式最多 ${hours}h）。作者/测试可传 skip_brief=true。brief 注入方法资产；lintPassToken 只证明已扫过，不能代替 brief。`);
        }
        if (!opts.brief && opts.skipBrief) {
            return allow([
                warn("brief_skipped", `已用 skip_brief=true 跳过开写 brief（方法资产可能未注入）。`),
            ]);
        }
        const b = opts.brief;
        return allow([
            info("brief_ok", `上下文留痕（应用时核版本）：${b.at} · assets=${b.assetIds.join(",") || "(none)"}`),
        ]);
    },
};
