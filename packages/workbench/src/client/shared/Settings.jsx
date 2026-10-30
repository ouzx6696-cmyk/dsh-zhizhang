/** Plugin settings card: per-session panel token and where data lives. */
import React from "react";
import { readToken, writeToken } from "./api.js";
import { t } from "./copy.js";
import { Button } from "./ui.jsx";
import { HOST_PACKAGE } from "./host.js";

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
    <section className="wb-root wb-settings" aria-label={t("settingsTitle")}>
      <h3 className="wb-settings-title">{t("settingsTitle")}</h3>
      <p className="wb-muted">{t("settingsLead")}</p>
      <label className="wb-form-row">
        <span className="wb-form-label">{t("settingsToken")}</span>
        <span className="wb-input-row">
          <input
            className="wb-input"
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
        <span className="wb-form-hint" aria-live="polite">
          {saved ? t("settingsTokenSaved") : t("settingsTokenHint")}
        </span>
      </label>
      <p className="wb-muted">{t("settingsStorage")}</p>
    </section>
  );
}

/** Same card on the DSH plugin detail page, only for this package's subject. */
export function PluginDetailSection({ subject }) {
  if (!subject || (typeof subject.pkg === "string" ? subject.pkg : subject.pkg?.name) !== HOST_PACKAGE || (subject.kind !== "bundle" && subject.kind !== "row")) return null;
  return <SettingsCard />;
}
