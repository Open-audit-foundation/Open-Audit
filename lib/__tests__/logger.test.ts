import { describe, expect, it } from "vitest";
import logger from "../logger";

describe("logger", () => {
  it("uses LOG_LEVEL when configured, otherwise info", () => {
    expect(logger.level).toBe(process.env.LOG_LEVEL ?? "info");
  });

  it("binds the indexer module on a child logger", () => {
    const child = logger.child({ module: "indexer" });
    expect(child.bindings()).toMatchObject({ module: "indexer" });
  });
});
