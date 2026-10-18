import { describe, expect, test } from "bun:test";
import {
  InspirationPort,
  LibraryPort,
  ProductMap,
  getPortConfig,
  resetPortConfig,
} from "../../src/lib/ports/index.ts";

describe("PortConfig + ProductMap contract", () => {
  test("defaults keep all quality sensors soft", () => {
    resetPortConfig();
    const c = getPortConfig();
    expect(c.defaultStrictLint).toBe(false);
    expect(c.defaultRequirePayoff).toBe(false);
    expect(c.defaultStrictHuman).toBe(false);
    expect(c.defaultStrictNovel).toBe(false);
    expect(c.saveBypassWordThreshold).toBe(200);
    expect(c.multiDraftEnabled).toBe(false);
  });

  test("ProductMap: three pillars live; version matches package", async () => {
    const pkg = await import("../../package.json");
    expect(ProductMap.version).toBe(pkg.version);
    expect(LibraryPort.status).toBe("live");
    expect(InspirationPort.status).toBe("live");
    const pillars = ProductMap.pillars();
    expect(pillars.every((p) => p.status === "live")).toBe(true);
    expect(pillars.filter((p) => p.status === "reserved").length).toBe(0);
    expect(LibraryPort.capabilities().every((c) => c.ready)).toBe(true);
    expect(InspirationPort.capabilities().every((c) => c.ready)).toBe(true);
    const text = ProductMap.formatForAgent();
    expect(text).toContain("拆书库");
    expect(text).toContain("写作工程");
    expect(text).toContain("已上线");
    expect(text).toContain("一条创作闭环");
  });
});
