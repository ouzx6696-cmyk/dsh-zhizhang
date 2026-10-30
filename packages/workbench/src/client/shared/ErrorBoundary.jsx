/** Keeps a panel failure inside the panel instead of blanking the host page. */
import React from "react";
import { t } from "./copy.js";
import { Button } from "./ui.jsx";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, attempt: 0 };
    this.reset = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    if (typeof console !== "undefined") console.error("[dsh-writer] panel crashed:", error, info && info.componentStack);
  }
  render() {
    if (!this.state.error) return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    const message = (this.state.error && this.state.error.message) || String(this.state.error);
    return (
      <div className="wb-root">
        <div className="wb-onboarding" role="alert">
          <p className="wb-empty-title">{t("crashTitle")}</p>
          <p className="wb-empty-hint">{t("crashHint")}</p>
          <pre className="wb-crash">{message}</pre>
          <Button variant="outline" onClick={this.reset}>
            {t("crashReload")}
          </Button>
        </div>
      </div>
    );
  }
}
