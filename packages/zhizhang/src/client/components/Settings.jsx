/** Plugin settings card: per-session panel token and where data lives. */
import React from "react";
import { readToken, writeToken } from "../api.js";
import { t } from "../copy.js";
import { Button } from "../ui.jsx";

const { useState } = React;

export function SettingsCard() {
  const [token, setToken] = useState(readToken);
  const [saved, setSaved] = useState(false);
  const update = (value) => {
    setToken(value);
    writeToken(value);
    setSaved(!!value);
  };
  return (
    <section className="zz-root zz-settings" aria-label={t("settingsTitle")}>
      <h3 className="zz-settings-title">{t("settingsTitle")}</h3>
      <p className="zz-muted">{t("settingsLead")}</p>
      <label className="zz-form-row">
        <span className="zz-form-label">{t("settingsToken")}</span>
        <span className="zz-input-row">
          <input
            className="zz-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => update(e.target.value)}
          />
          <Button variant="ghost" size="sm" disabled={!token} onClick={() => update("")}>
            {t("settingsTokenClear")}
          </Button>
        </span>
        <span className="zz-form-hint" aria-live="polite">
          {saved ? t("settingsTokenSaved") : t("settingsTokenHint")}
        </span>
      </label>
      <p className="zz-muted">{t("settingsStorage")}</p>
    </section>
  );
}

/** Same card on the DSH plugin detail page, only for this package's subject. */
export function PluginDetailSection({ subject }) {
  if (!subject || (typeof subject.pkg === "string" ? subject.pkg : subject.pkg?.name) !== "dsh-zhizhang" && (typeof subject.pkg === "string" ? subject.pkg : subject.pkg?.name) !== "dsh-writer" || (subject.kind !== "bundle" && subject.kind !== "row")) return null;
  return <SettingsCard />;
}
