/** 写作台外壳：顶部切换写作模式（番茄长篇 / 今日头条），两种模式各自取数，互不打扰。 */
import React from "react";
import { t } from "./shared/copy.js";
import { PREF, oneOf, readPref, writePref } from "./shared/prefs.js";
import { SegmentedControl } from "./shared/ui.jsx";
import { FanqieApp } from "./fanqie/FanqieApp.jsx";
import { ToutiaoApp } from "./toutiao/ToutiaoApp.jsx";
import { ProfilesButton } from "./shared/Profiles.jsx";

const { useCallback, useState } = React;
const MODES = ["fanqie", "toutiao"];

/* global __WB_VERSION__ */
const VERSION = typeof __WB_VERSION__ === "string" ? __WB_VERSION__ : "";

export function Shell() {
  const [mode, setMode] = useState(() => oneOf(readPref(PREF.mode, "fanqie"), MODES, "fanqie"));
  const change = useCallback((m) => { setMode(m); writePref(PREF.mode, m); }, []);
  const modeSwitch = (
    <>
    <ProfilesButton key={mode} mode={mode} />
    <SegmentedControl
      id="wb-mode"
      label={t("modeLabel")}
      value={mode}
      options={[
        { value: "fanqie", label: t("modeFanqie") },
        { value: "toutiao", label: t("modeToutiao") },
      ]}
      onChange={change}
      className="wb-mode-switch"
    />
    </>
  );
  return mode === "toutiao" ? <ToutiaoApp modeSwitch={modeSwitch} version={VERSION} /> : <FanqieApp modeSwitch={modeSwitch} version={VERSION} />;
}
