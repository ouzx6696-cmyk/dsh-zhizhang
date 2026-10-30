/** 注册进 main 插槽的页面组件。 */
import React from "react";
import { Shell } from "./Shell.jsx";
import { ErrorBoundary } from "./shared/ErrorBoundary.jsx";

export function App() {
  return (
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  );
}
