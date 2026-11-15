export function cx(...parts) {
    return parts.filter(Boolean).join(" ");
}
export function toneClass(tone) {
    return `zz-tone-${tone}`;
}
export function buttonClasses(options = {}) {
    const { variant = "secondary", size = "md", className } = options;
    return cx("zz-btn", `zz-btn--${variant}`, `zz-btn--${size}`, className);
}
export function iconButtonClasses(options = {}) {
    const { variant = "ghost", size = "md", className } = options;
    return cx("zz-icon-btn", `zz-btn--${variant}`, `zz-icon-btn--${size}`, className);
}
export function dialogClasses(options = {}) {
    const { size = "md", className } = options;
    return cx("zz-dialog", `zz-dialog--${size}`, className);
}
export function tabId(base, tab) {
    return `${base}-tab-${tab}`;
}
export function tabPanelId(base, tab) {
    return `${base}-panel-${tab}`;
}
export function tabPanelProps(base, tab, value) {
    return {
        id: tabPanelId(base, tab),
        role: "tabpanel",
        "aria-labelledby": tabId(base, tab),
        hidden: tab !== value,
    };
}
export function tabsClasses(options = {}) {
    const { orientation = "horizontal", className } = options;
    return cx("zz-tabs", `zz-tabs--${orientation}`, className);
}
export function segmentedClasses(options = {}) {
    const { size = "md", className } = options;
    return cx("zz-segmented", `zz-segmented--${size}`, className);
}
export function checkboxClasses(options = {}) {
    return cx("zz-checkbox", options.disabled && "zz-is-disabled", options.className);
}
export function toggleClasses(options = {}) {
    return cx("zz-toggle", options.disabled && "zz-is-disabled", options.className);
}
export function fieldClasses(options = {}) {
    return cx("zz-field", Boolean(options.error) && "zz-field--error", options.className);
}
export function selectClasses(options = {}) {
    return cx("zz-select", options.disabled && "zz-is-disabled", options.className);
}
export function tagClasses(options = {}) {
    const { tone = "neutral", className } = options;
    return cx("zz-tag", toneClass(tone), className);
}
export function statusChipClasses(options) {
    return cx("zz-status-chip", toneClass(options.tone), options.className);
}
export function noticeClasses(options) {
    const { tone, variant = "inline", className } = options;
    return cx("zz-notice", `zz-notice--${variant}`, toneClass(tone), className);
}
export function emptyClasses(options = {}) {
    return cx("zz-empty", options.className);
}
export function skeletonClasses(options = {}) {
    const { variant = "text", className } = options;
    return cx("zz-skeleton", `zz-skeleton--${variant}`, className);
}
export function spinnerClasses(options = {}) {
    const { size = "md", className } = options;
    return cx("zz-spinner", `zz-spinner--${size}`, className);
}
export function progressStepState(index, current) {
    if (index < current)
        return "done";
    if (index === current)
        return "current";
    return "todo";
}
export function progressRailClasses(options = {}) {
    return cx("zz-progress-rail", options.className);
}
export function kbdClasses(options = {}) {
    return cx("zz-kbd", options.className);
}
export function menuClasses(options = {}) {
    return cx("zz-menu", options.open && "zz-menu--open", options.className);
}
