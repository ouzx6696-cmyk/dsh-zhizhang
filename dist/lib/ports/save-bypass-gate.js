/**
 * SaveBypassGate — large chapter_save body needs confirm_bypass.
 */
import { getPortConfig } from "./config.js";
import { allow, deny, info } from "./types.js";
export const SaveBypassGate = {
    evaluate(opts) {
        if (!opts.contentProvided) {
            return allow([info("save_meta_only", "仅元数据/status")]);
        }
        const threshold = opts.threshold ?? getPortConfig().saveBypassWordThreshold;
        if (opts.wordCount > threshold && !opts.confirmBypass) {
            return deny("bypass_confirm_required", `正文约 ${opts.wordCount} 字，超过旁路阈值 ${threshold}。请走 candidate_stage → style_lint → candidate_accept；作者确需直写请传 confirm_bypass=true。`);
        }
        if (opts.wordCount > threshold && opts.confirmBypass) {
            return allow([info("save_bypass_confirmed", "confirm_bypass=true")]);
        }
        return allow();
    },
};
