/** Page component registered into the `main` slot. */
import React from "react";
import { PanelApp } from "./components/App.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";

export function App() {
  return (
    <ErrorBoundary>
      <PanelApp />
    </ErrorBoundary>
  );
}
