// 渲染层单测入口：只转出生产模块已有的导出，不为测试新增导出。
export * as workflowModel from "../../apps/desktop/src/renderer/features/workflow/workflow-model";
export { createStore, sameFields } from "../../apps/desktop/src/renderer/state/createStore";
export { footerStatus } from "../../apps/desktop/src/renderer/features/agent/composer";
export { quickActions } from "../../apps/desktop/src/renderer/features/agent/quickActions";
export {
  deliverAction,
  startNewWork,
} from "../../apps/desktop/src/renderer/features/agent/taskActions";
export {
  RootErrorBoundary,
  reportUnhandledRejection,
} from "../../apps/desktop/src/renderer/app/crash";
export { NoticeStack } from "@writer/ui/notify";
