import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureIdeaThroughBroker,
  isIdeaCaptureConfigured,
} from "./idea-capture-command.js";

describe("idea-capture-command", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports configuration presence only when all broker env vars exist", () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    expect(isIdeaCaptureConfigured()).toBe(true);

    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "");
    expect(isIdeaCaptureConfigured()).toBe(false);
  });

  it("returns a usage error when no idea text is supplied", async () => {
    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 1,
      rawArgs: "",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Usage: /idea <text>");
  });

  it("captures an idea through the broker and returns the canonical record ref", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        idea_id: "idea-38",
        record_ref: "openproject://work_packages/38",
        status: "captured",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 11,
      rawArgs: "We need a place for deferred architecture ideas",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("http://broker.internal/v1/ideas/capture");
    expect((request as RequestInit).headers).toMatchObject({
      "x-oos-caller-id": "openclaw-stage-gateway",
      "x-oos-caller-secret": "secret",
    });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("idea-38");
    expect(result.text).toContain("openproject://work_packages/38");
  });
});
