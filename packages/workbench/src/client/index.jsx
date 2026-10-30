/**
 * 写作台浏览器端。经 ctx.slots.inject 注册（每项等声明就绪、随插件 fiber 回收）：
 *   - sidebar.panellist 一行 + main 页面 → 写作台（番茄长篇 / 今日头条两种模式）
 *   - plugins.detail.section             → 插件详情页上的访问令牌与数据位置卡片
 * 数据都来自插件受保护的写作台接口，组件拿不到 ctx。
 */
import React from "react";
import { t } from "./shared/copy.js";
import { Manuscript } from "./shared/Manuscript.jsx";
import { WriterAgent } from "./fanqie/Inspector.jsx";
import { ToutiaoSide } from "./toutiao/ToutiaoApp.jsx";
import { App } from "./root.jsx";
import { PluginDetailSection } from "./shared/Settings.jsx";
import { Icon } from "./shared/ui.jsx";
import css from "./styles.css";
import { HOST_PACKAGE } from "./shared/host.js";

export const PLUGIN_ID = HOST_PACKAGE;
const PANEL_ID = "dsh-writer";
const SETTINGS_KEY = "dsh-writer-config";
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

export const __testing = { Manuscript, WriterAgent, ToutiaoSide };
