/** 发布包名：由构建注入（scripts/build-client.mjs），DSH 按它装载客户端、回收样式、匹配插件页。 */
/* global __WB_PACKAGE__ */
export const HOST_PACKAGE = typeof __WB_PACKAGE__ === "string" ? __WB_PACKAGE__ : "dsh-writer";
