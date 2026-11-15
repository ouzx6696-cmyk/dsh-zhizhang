/** 助手工具调用的界面显示名：渲染层按工具名查（主进程只发工具名），文案在 @zhizhang/ui/copy。 */
import { DESKTOP_COPY } from "@zhizhang/ui/copy";

export function toolLabel(name: string): string {
  return DESKTOP_COPY.agent.tools[name] ?? DESKTOP_COPY.agent.toolFallback;
}
