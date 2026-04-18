import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNativeCommandsHarness,
  createTelegramGroupCommandContext,
  deliverReplies,
} from "./bot-native-commands.test-helpers.js";

describe("registerTelegramNativeCommands idea capture integration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    deliverReplies.mockClear();
  });

  it("registers and handles /idea when broker capture is configured", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        idea_id: "idea-39",
        record_ref: "openproject://work_packages/39",
        status: "captured",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const harness = createNativeCommandsHarness({
      groupAllowFrom: ["12345"],
    });

    expect(harness.handlers.idea).toBeTypeOf("function");

    const ctx = createTelegramGroupCommandContext({
      senderId: 12345,
      username: "testuser",
    });
    ctx.match = "We need a place for deferred architecture ideas";

    await harness.handlers.idea(
      ctx,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deliverReplies).toHaveBeenCalled();
    const replyPayload = deliverReplies.mock.calls.at(-1)?.[0];
    expect(replyPayload?.replies?.[0]?.text).toContain("idea-39");
  });

  it("returns usage guidance for /idea help without calling the broker", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const harness = createNativeCommandsHarness({
      groupAllowFrom: ["12345"],
    });

    const ctx = createTelegramGroupCommandContext({
      senderId: 12345,
      username: "testuser",
    });
    ctx.match = "help";

    await harness.handlers.idea(
      ctx,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    const replyPayload = deliverReplies.mock.calls.at(-1)?.[0];
    expect(replyPayload?.replies?.[0]?.text).toContain("Use /idea to capture a concrete idea");
    expect(replyPayload?.replies?.[0]?.text).toContain("/idea <idea text>");
  });
});
