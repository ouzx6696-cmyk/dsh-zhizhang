/** 桌面层测试入口：把被测模块打进同一个包，保证 AppError 等类在各模块间是同一个。 */
export {
  dispatchWorkbenchCommand,
  isWorkbenchCommand,
} from "../../apps/desktop/src/main/commands.js";
export { createWorkflowService } from "../../apps/desktop/src/main/workflow.js";
export { createRunStore } from "../../apps/desktop/src/main/services/runs.js";
export { createConfigService } from "../../apps/desktop/src/main/services/config.js";
export { createSessionManager, toChatMessages } from "../../apps/desktop/src/session/manager.js";
export { createConversationStore } from "../../apps/desktop/src/session/history.js";
export { DEFAULT_SETTINGS } from "../../apps/desktop/src/shared/settings.js";
export { AppError, isAppError } from "@zhizhang/core/errors";
export { createLockService } from "@zhizhang/core/lock";
export { createModelGateway } from "@zhizhang/core/model";
export { executeTool } from "@zhizhang/core/tool";
export { COMMAND_POLICY } from "@zhizhang/workbench/contract";
export { fanqieModule } from "@zhizhang/fanqie";
export { toutiaoModule } from "@zhizhang/toutiao";
