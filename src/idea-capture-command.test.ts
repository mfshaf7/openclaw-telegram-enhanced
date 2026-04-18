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
    expect(result.text).toContain("Idea workflow is not configured");
  });

  it("loads canonical workflow guidance from the broker when no idea text is supplied", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        lifecycle_note:
          "The canonical backlog supports the full status model now. Telegram currently exposes capture, list, list all, and show; later status moves remain broker and backlog managed until triage and decision actions are enabled.",
        lifecycle_statuses: [
          {
            meaning: "Raw record exists, but no approved triage or ownership decision exists yet.",
            next_step:
              "Review the captured record, then move it into triage or park it in the canonical backlog.",
            status: "captured",
          },
        ],
        operator_guidance: {
          after_capture: [
            "each reply includes the canonical idea id, record reference, and current status",
          ],
          examples: [
            "We need a governed place to capture deferred architecture ideas before they become Git artifacts",
          ],
          what_to_send: [
            "use `/idea <text>` to capture a new idea",
            "use `/idea list` to review the recent idea slice",
            "use `/idea list all` to review every stored idea through broker pagination",
          ],
        },
        purpose:
          "Create, inspect, and list canonical idea records in Workspace Proposals through the broker-owned operator workflow path.",
        source_hints: {
          telegram: {
            command_descriptors: [
              {
                invocation: "/idea <idea text>",
                purpose: "Capture a new idea into the canonical backlog.",
              },
              {
                invocation: "/idea list all",
                purpose: "Show the full stored idea backlog through broker pagination.",
              },
            ],
            invocation_examples: ["/idea <idea text>", "/idea list", "/idea list all", "/idea show <idea-id>", "/idea help"],
            note: "Use `/idea <text>` to capture a new idea. Use `/idea list`, `/idea list all`, and `/idea show <idea-id>` to read what is already stored.",
          },
        },
        title: "Idea workflow",
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
    expect(url).toBe("http://broker.internal/v1/workflows/idea-command");
    expect((request as RequestInit).method).toBe("GET");
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("Idea workflow");
    expect(result.text).toContain("/idea <idea text>");
    expect(result.text).toContain("/idea list all");
    expect(result.text).toContain("Status lifecycle:");
    expect(result.text).toContain("captured");
  });

  it("loads workflow guidance from the broker when help is requested explicitly", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        lifecycle_statuses: [
          {
            meaning: "Raw record exists, but no approved triage or ownership decision exists yet.",
            next_step:
              "Review the captured record, then move it into triage or park it in the canonical backlog.",
            status: "captured",
          },
        ],
        operator_guidance: {
          after_capture: [
            "each reply includes the canonical idea id, record reference, and current status",
          ],
          examples: ["Add a prod-safe traffic-stop lane for future shared products"],
        },
        source_hints: {
          telegram: {
            command_descriptors: [
              {
                invocation: "/idea help",
                purpose: "Show the canonical workflow guidance and lifecycle status model.",
              },
            ],
            invocation_examples: ["/idea <idea text>", "/idea list", "/idea list all", "/idea show <idea-id>", "/idea help"],
          },
        },
        title: "Idea workflow",
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
    expect(result.text).toContain("Current command surface:");
    expect(result.text).toContain("Status lifecycle:");
    expect(result.text).toContain("/idea help");
    expect(result.text).toContain("/idea show <idea-id>");
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
    expect(result.text).toContain("[captured]");
    expect(result.text).toContain("/idea show idea-38");
  });

  it("treats free-form idea text starting with status as a capture", async () => {
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

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 12,
      rawArgs: "Status filter proof one",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("http://broker.internal/v1/ideas/capture");
    expect(JSON.parse((request as RequestInit).body as string)).toMatchObject({
      body: "Status filter proof one",
      title: "Status filter proof one",
    });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("idea-39");
  });

  it("lists captured ideas through the broker with visible statuses", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ideas: [
          {
            body_preview: "Need a bounded read path.",
            idea_id: "idea-41",
            record_ref: "openproject://work_packages/41",
            status: "captured",
            title: "Bounded read path",
          },
        ],
        page: {
          count: 1,
          has_more: false,
          limit: 10,
          next_offset: null,
          offset: 1,
          total: 1,
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 12,
      rawArgs: "list",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("http://broker.internal/v1/ideas?limit=10&offset=1");
    expect((request as RequestInit).method).toBe("GET");
    expect(result.text).toContain("Stored ideas: showing 1-1 of 1");
    expect(result.text).toContain("Idea ID");
    expect(result.text).toContain("idea-41");
    expect(result.text).toContain("captured");
    expect(result.text).toContain("/idea show <idea-id>");
  });

  it("lists all stored ideas through broker pagination", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ideas: [
            {
              idea_id: "idea-41",
              status: "captured",
              title: "Bounded read path",
              updated_at: "2026-04-18T10:05:00Z",
            },
          ],
          page: {
            count: 1,
            has_more: true,
            limit: 25,
            next_offset: 2,
            offset: 1,
            total: 2,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ideas: [
            {
              idea_id: "idea-42",
              status: "parked",
              title: "Governed backlog view",
              updated_at: "2026-04-18T10:06:00Z",
            },
          ],
          page: {
            count: 1,
            has_more: false,
            limit: 25,
            next_offset: null,
            offset: 2,
            total: 2,
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 12,
      rawArgs: "list all",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://broker.internal/v1/ideas?limit=25&offset=1");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://broker.internal/v1/ideas?limit=25&offset=2");
    expect(result.text).toContain("Stored ideas: showing all 2");
    expect(result.text).toContain("idea-41");
    expect(result.text).toContain("idea-42");
    expect(result.text).toContain("parked");
  });

  it("lists captured ideas through the broker with a status filter", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ideas: [
          {
            body_preview: "Need a bounded read path.",
            idea_id: "idea-41",
            record_ref: "openproject://work_packages/41",
            status: "captured",
            title: "Bounded read path",
          },
        ],
        page: {
          count: 1,
          has_more: false,
          limit: 10,
          next_offset: null,
          offset: 1,
          total: 1,
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 12,
      rawArgs: "list status captured",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://broker.internal/v1/ideas?limit=10&offset=1&status=captured",
    );
    expect(result.text).toContain("Stored ideas with status captured");
    expect(result.text).toContain("idea-41");
  });

  it("lists all stored ideas through broker pagination with a status filter", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ideas: [
            {
              idea_id: "idea-41",
              status: "captured",
              title: "Bounded read path",
              updated_at: "2026-04-18T10:05:00Z",
            },
          ],
          page: {
            count: 1,
            has_more: true,
            limit: 25,
            next_offset: 2,
            offset: 1,
            total: 2,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ideas: [
            {
              idea_id: "idea-42",
              status: "captured",
              title: "Governed backlog view",
              updated_at: "2026-04-18T10:06:00Z",
            },
          ],
          page: {
            count: 1,
            has_more: false,
            limit: 25,
            next_offset: null,
            offset: 2,
            total: 2,
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 12,
      rawArgs: "list all status captured",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://broker.internal/v1/ideas?limit=25&offset=1&status=captured",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://broker.internal/v1/ideas?limit=25&offset=2&status=captured",
    );
    expect(result.text).toContain("Stored ideas with status captured: showing all 2");
    expect(result.text).toContain("idea-41");
    expect(result.text).toContain("idea-42");
  });

  it("reads one captured idea through the broker with explicit status", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        body: "Need a bounded read path.",
        created_at: "2026-04-18T10:00:00Z",
        idea_id: "idea-41",
        record_ref: "openproject://work_packages/41",
        source: {
          integration_id: "default",
          surface: "telegram",
        },
        status: "captured",
        title: "Bounded read path",
        updated_at: "2026-04-18T10:05:00Z",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 13,
      rawArgs: "show idea-41",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("http://broker.internal/v1/ideas/idea-41");
    expect((request as RequestInit).method).toBe("GET");
    expect(result.text).toContain("Idea record:");
    expect(result.text).toContain("Record");
    expect(result.text).toContain("openproject://work_packages/41");
    expect(result.text).toContain("telegram/default");
  });
});
