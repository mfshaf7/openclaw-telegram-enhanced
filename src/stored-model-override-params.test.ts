import { describe, expect, it } from "vitest";
import { buildStoredModelOverrideParams } from "./stored-model-override-params.js";

describe("buildStoredModelOverrideParams", () => {
  it("falls back to the resolved agent default provider when the session has no stored provider", () => {
    const result = buildStoredModelOverrideParams({
      defaultProvider: "openai",
      sessionEntry: undefined,
      sessionStore: {},
      sessionKey: "agent:main:telegram:group:-1002519919856:topic:1",
    });

    expect(result.defaultProvider).toBe("openai");
    expect(result.entryProvider).toBe("");
    expect(result.entryModel).toBe("");
  });

  it("prefers a trimmed session provider and ignores malformed session model fields", () => {
    const result = buildStoredModelOverrideParams({
      defaultProvider: "openai",
      sessionEntry: {
        modelProvider: "  ollama  ",
        model: 42,
      },
      sessionStore: {},
      sessionKey: "agent:main:telegram:group:-1002519919856:topic:1",
    });

    expect(result.defaultProvider).toBe("ollama");
    expect(result.entryProvider).toBe("ollama");
    expect(result.entryModel).toBe("");
  });
});
