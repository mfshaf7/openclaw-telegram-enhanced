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

  it("returns a configuration error when broker guidance cannot be queried", async () => {
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
    expect(result.text).toContain("Idea capture is not configured");
  });

  it("loads canonical workflow guidance from the broker when no idea text is supplied", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        operator_guidance: {
          examples: [
            "We need a governed place to capture deferred architecture ideas before they become Git artifacts",
          ],
          what_to_send: [
            "the idea itself or the problem worth tracking",
          ],
        },
        purpose:
          "Capture a concrete idea or problem statement into Workspace Proposals before triage and ownership decisions.",
        source_hints: {
          telegram: {
            invocation_examples: ["/idea <idea text>", "/idea help"],
            note: "Use a single message in the same chat or topic where the idea came up.",
          },
        },
        title: "Idea capture",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 1,
      rawArgs: "",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("http://broker.internal/v1/workflows/idea-capture");
    expect((request as RequestInit).method).toBe("GET");
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("Idea capture");
    expect(result.text).toContain("/idea <idea text>");
    expect(result.text).toContain("What to send:");
  });

  it("loads workflow guidance from the broker when help is requested explicitly", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        operator_guidance: {
          after_capture: [
            "review the returned idea id and canonical record reference",
          ],
          examples: ["Add a prod-safe traffic-stop lane for future shared products"],
        },
        source_hints: {
          telegram: {
            invocation_examples: ["/idea <idea text>", "/idea help"],
          },
        },
        title: "Idea capture",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 2,
      rawArgs: "help",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("After capture:");
    expect(result.text).toContain("/idea help");
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
      telegramThreadId: 7,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("http://broker.internal/v1/ideas/capture");
    expect((request as RequestInit).headers).toMatchObject({
      "x-oos-caller-id": "openclaw-stage-gateway",
      "x-oos-caller-secret": "secret",
    });
    expect(JSON.parse((request as RequestInit).body as string)).toEqual({
      body: "We need a place for deferred architecture ideas",
      operator: {
        handle: "bob",
        id: "200",
      },
      source: {
        context_ref: {
          conversation_id: "100",
          conversation_type: "private",
          thread_id: "7",
        },
        integration_id: "default",
        native_ref: {
          command: "idea",
          message_id: "11",
        },
        surface: "telegram",
      },
      title: "We need a place for deferred architecture ideas",
    });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("idea-38");
    expect(result.text).toContain("openproject://work_packages/38");
  });
});
