/**
 * dsh-zhizhang browser half.
 *
 * Registers, through `ctx.slots.inject` so each contribution waits for its
 * declaration and leaves with this plugin's fiber:
 *   - `sidebar.panellist` row + `main` page   → the 织章 workbench
 *   - `plugins.detail.section`                → token / storage card on the plugin page
 *   - `settings.plugin.item` (older hosts)    → the same card
 * Data comes from the plugin's protected panel API; components never see ctx.
 */
import React from "react";
import { t } from "./copy.js";
import { bodyKey, initialState, reducer } from "./state.js";
import { request } from "./api.js";
import { lightMdToHtml } from "./markdown.js";
import { App } from "./root.jsx";
import { PluginDetailSection, SettingsCard } from "./components/Settings.jsx";
import { Icon } from "./ui.jsx";
import css from "./styles.css";

export const PLUGIN_ID = "dsh-zhizhang";
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

function register(ctx, name, factory, disposers) {
  try {
    const dispose = ctx.slots.inject(name, factory);
    if (typeof dispose === "function") disposers.push(dispose);
    return true;
  } catch (error) {
    if (typeof console !== "undefined") console.info("[dsh-zhizhang] slot " + name + " skipped:", error);
    return false;
  }
}

export const inject = ["slots"];

export function apply(ctx) {
  if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") {
    if (typeof console !== "undefined") console.info("[dsh-zhizhang] slots service unavailable; panel UI skipped");
    return;
  }
  ensureStyles();
  const disposers = [];
  register(ctx, "main", () => ctx.slots.register({ name: "main", key: PANEL_ID, inject: () => ({}) }, App), disposers);
  register(
    ctx,
    "sidebar.panellist",
    () => ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: PANEL_ORDER, label: () => t("panelLabel") }, SidebarIcon),
    disposers,
  );
  register(
    ctx,
    "plugins.detail.section",
    () => ctx.slots.register({ name: "plugins.detail.section", id: SETTINGS_KEY, inject: () => ({}) }, PluginDetailSection),
    disposers,
  );
  register(
    ctx,
    "settings.plugin.item",
    () => ctx.slots.register({ name: "settings.plugin.item", key: SETTINGS_KEY, id: SETTINGS_KEY, order: 108, inject: () => ({}) }, SettingsCard),
    disposers,
  );
  // Contributions already leave with the fiber; this effect also covers hosts whose
  // inject() returns a disposer without tying it to the caller.
  if (typeof ctx.effect === "function") {
    ctx.effect(
      () => () => {
        while (disposers.length) {
          const dispose = disposers.pop();
          try {
            dispose();
          } catch {
            /* already disposed by the fiber */
          }
        }
      },
      "dsh-zhizhang: panel slots",
    );
  }
}

export const __testing = { PANEL_ID, lightMdToHtml, bodyKey, initialState, reducer, request };
