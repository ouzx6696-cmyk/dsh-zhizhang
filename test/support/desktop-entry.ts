/** 桌面层测试入口：把被测模块打进同一个包，保证 AppError 等类在各模块间是同一个。 */
export {
  dispatchWorkbenchCommand,
  isWorkbenchCommand,
} from "../../apps/desktop/src/main/commands.js";
export { createDraftService, DRAFT_MAX_BYTES } from "../../apps/desktop/src/main/ipc/drafts.js";
export {
  refreshUsage,
  select as selectTarget,
} from "../../apps/desktop/src/renderer/state/controller.js";
export { desktop } from "../../apps/desktop/src/renderer/state/desktop.js";
export { desktopStore, scopeKey } from "../../apps/desktop/src/renderer/state/store.js";
export { chatStore } from "../../apps/desktop/src/renderer/state/chatStore.js";
export { createWorkflowService } from "../../apps/desktop/src/main/workflow.js";
export { createRunStore } from "../../apps/desktop/src/main/services/runs.js";
export { createConfigService } from "../../apps/desktop/src/main/services/config.js";
export { createSessionManager, toChatMessages } from "../../apps/desktop/src/session/manager.js";
export { createConversationStore } from "../../apps/desktop/src/session/history.js";
export {
  DEFAULT_SETTINGS,
  mergeSettingsPatch,
  parseSettingsPatch,
} from "../../apps/desktop/src/shared/settings.js";
export { AppError, isAppError } from "@zhizhang/core/errors";
export { createLockService } from "@zhizhang/core/lock";
export { createModelGateway } from "@zhizhang/core/model";
export { executeTool } from "@zhizhang/core/tool";
export { COMMAND_POLICY } from "@zhizhang/workbench/contract";
export { fanqieModule } from "@zhizhang/fanqie";
export { toutiaoModule } from "@zhizhang/toutiao";
