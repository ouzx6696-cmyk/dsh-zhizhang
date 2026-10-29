/**
 * dsh-zhizhang browser half.
 *
 * Registers, through `ctx.slots.inject` so each contribution waits for its
 * declaration and leaves with this plugin's fiber:
 *   - `sidebar.panellist` row + `main` page   → the 织章 workbench
 *   - `plugins.detail.section`                → token / storage card on the plugin page
 * Data comes from the plugin's protected panel API; components never see ctx.
 */
import React from "react";
import { t } from "./copy.js";
import { Manuscript } from "./components/Manuscript.jsx";
import { App } from "./root.jsx";
import { PluginDetailSection } from "./components/Settings.jsx";
import { Icon } from "./ui.jsx";
import css from "./styles.css";

export const PLUGIN_ID = __ZZ_CLIENT_ID__;
const PANEL_ID = "dsh-zhizhang";
const SETTINGS_KEY = "dsh-zhizhang-config";
const PANEL_ORDER = 28;

/**
 * Inject the stylesheet tagged with this package id, the convention the DSH
 * module system uses to reclaim a plugin's styles when it is disabled.
 */
export function ensureStyles() {
  if (typeof document === "undefined") return;
  const tagId = PLUGIN_ID + "/client.css";
  if (document.querySelector('style[data-plugin-css="' + tagId + '"]')) return;
  const tag = document.createElement("style");
  tag.dataset.plugin = PLUGIN_ID;
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}

function SidebarIcon(props) {
  const size = typeof props.size === "number" && props.size > 0 ? props.size : 16;
  return <Icon name="book" size={size} />;
}

export const inject = ["slots"];

/** DSH owns contribution lifetime through the declared slots service and plugin fiber. */
export function apply(ctx) {
  ensureStyles();
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL_ID, inject: () => ({}) }, App));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: PANEL_ORDER, label: () => t("panelLabel") }, SidebarIcon));
  ctx.slots.inject("plugins.detail.section", () => ctx.slots.register({ name: "plugins.detail.section", id: SETTINGS_KEY, inject: () => ({}) }, PluginDetailSection));
}

export const __testing = { Manuscript };
