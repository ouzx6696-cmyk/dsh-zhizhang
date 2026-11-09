import React from "react";
import { CRASH_COPY } from "../../../../../packages/ui/src/copy.js";
import { notify } from "../../../../../packages/ui/src/notify";

const messageOf = (value: unknown) => (value instanceof Error ? value.message : String(value));

interface BoundaryState {
  failed: boolean;
  error: unknown;
}

/**
 * 根部兜底：任一组件渲染抛错时换成说明与“重新加载窗口”，不让整窗白屏。
 * 兜底画面只用文案与原生元素，不读任何 store，免得出错的状态把它也带倒。
 */
export class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  BoundaryState
> {
  state: BoundaryState = { failed: false, error: undefined };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="writer-desktop wb-scope">
        <div className="studio-empty" role="alert">
          <h1>{CRASH_COPY.title}</h1>
          <p>{messageOf(this.state.error)}</p>
          <p>{CRASH_COPY.hint}</p>
          <button className="primary" onClick={() => window.location.reload()}>
            {CRASH_COPY.reload}
          </button>
        </div>
      </div>
    );
  }
}

/**
 * 没人接住的 Promise 失败（如 `void refresh()`）：给作者一条 danger 提示，原始错误照样进控制台。
 * 不调用 preventDefault，浏览器自己的未处理报错保留。
 */
export function reportUnhandledRejection(event: PromiseRejectionEvent) {
  console.error(event.reason);
  notify({ tone: "danger", text: CRASH_COPY.rejected + messageOf(event.reason) });
}
