/** Keeps a panel failure inside the panel instead of blanking the host page. */
import React from "react";
import { t } from "../copy.js";
import { Button } from "../ui.jsx";

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
    if (typeof console !== "undefined") console.error("[dsh-zhizhang] panel crashed:", error, info && info.componentStack);
  }
  render() {
    if (!this.state.error) return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    const message = (this.state.error && this.state.error.message) || String(this.state.error);
    return (
      <div className="zz-root">
        <div className="zz-onboarding" role="alert">
          <p className="zz-empty-title">{t("crashTitle")}</p>
          <p className="zz-empty-hint">{t("crashHint")}</p>
          <pre className="zz-crash">{message}</pre>
          <Button variant="outline" onClick={this.reset}>
            {t("crashReload")}
          </Button>
        </div>
      </div>
    );
  }
}
