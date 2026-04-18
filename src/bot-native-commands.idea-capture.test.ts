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

  it("loads /idea help guidance from the broker", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        operator_guidance: {
          after_capture: [
            "each reply includes the canonical idea id, record reference, and current status",
          ],
          examples: [
            "We need a governed place to capture deferred architecture ideas before they become Git artifacts",
          ],
          what_to_send: [
            "use `/idea <text>` to capture a new idea",
            "use `/idea list` to review recent idea records",
          ],
        },
        purpose:
          "Create, inspect, and list canonical idea records in Workspace Proposals through the broker-owned operator workflow path.",
        source_hints: {
          telegram: {
            invocation_examples: ["/idea <idea text>", "/idea list", "/idea show <idea-id>", "/idea help"],
          },
        },
        title: "Idea workflow",
      }),
    }));
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("http://broker.internal/v1/workflows/idea-command");
    expect((request as RequestInit).method).toBe("GET");
    const replyPayload = deliverReplies.mock.calls.at(-1)?.[0];
    expect(replyPayload?.replies?.[0]?.text).toContain("Idea workflow");
    expect(replyPayload?.replies?.[0]?.text).toContain("/idea <idea text>");
    expect(replyPayload?.replies?.[0]?.text).toContain("/idea list");
  });
});
