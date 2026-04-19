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
          "The canonical backlog supports the full status model now. Telegram currently exposes capture, operator-authored triage, bounded decision for `parked`, `accepted`, and `rejected`, plus list, list all, and show. The reserved placeholder `/idea triage discuss <idea-id>` is not implemented yet, and `owner-assigned` remains broker-managed until an explicit owner vocabulary is enabled.",
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
            "use `/idea triage <idea-id> <summary>` to record operator-authored framing and move a captured item into `triaged`",
            "use `/idea decide <idea-id> <parked|accepted|rejected> <notes>` to record the first bounded durable decision",
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
                invocation: "/idea triage <idea-id> <summary>",
                purpose: "Record operator-authored triage framing and move the idea into triaged.",
              },
              {
                invocation: "/idea decide <idea-id> <parked|accepted|rejected> <notes>",
                purpose: "Record the first bounded durable outcome without exposing owner-assignment yet.",
              },
              {
                invocation: "/idea list all",
                purpose: "Show the full stored idea backlog through broker pagination.",
              },
            ],
            invocation_examples: ["/idea <idea text>", "/idea triage <idea-id> <summary>", "/idea decide <idea-id> <parked|accepted|rejected> <notes>", "/idea list", "/idea list all", "/idea show <idea-id>", "/idea help"],
            note: "Use `/idea <text>` to capture a new idea. Use `/idea triage <idea-id> <summary>` to record operator-authored framing, then `/idea decide <idea-id> <parked|accepted|rejected> <notes>` for the first durable outcome. The reserved placeholder `/idea triage discuss <idea-id>` is not implemented yet.",
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
    expect(result.text).toContain("/idea triage <idea-id> <summary>");
    expect(result.text).toContain("/idea decide <idea-id> <parked|accepted|rejected> <notes>");
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
            invocation_examples: ["/idea <idea text>", "/idea triage <idea-id> <summary>", "/idea decide <idea-id> <parked|accepted|rejected> <notes>", "/idea list", "/idea list all", "/idea show <idea-id>", "/idea help"],
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
    expect(result.text).toContain("/idea triage <idea-id> <summary>");
    expect(result.text).toContain("/idea decide <idea-id> <parked|accepted|rejected> <notes>");
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

  it("records operator-authored triage through the broker", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        idea_id: "idea-41",
        record_ref: "openproject://work_packages/41",
        record_system: "openproject",
        status: "triaged",
        triage_summary: "Needs a bounded broker workflow before later decision handling.",
        updated_at: "2026-04-19T12:00:00Z",
        workflow_id: "idea-triage",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 12,
      rawArgs:
        "triage idea-41 Needs a bounded broker workflow before later decision handling.",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("http://broker.internal/v1/ideas/idea-41/triage");
    expect(JSON.parse((request as RequestInit).body as string)).toEqual({
      input: {
        summary: "Needs a bounded broker workflow before later decision handling.",
      },
      operator: {
        handle: "bob",
        id: "200",
      },
    });
    expect(result.text).toContain("Triaged idea-41 [triaged]");
    expect(result.text).toContain("Summary: Needs a bounded broker workflow before later decision handling.");
  });

  it("records a bounded durable decision through the broker", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        idea_id: "idea-41",
        operator_decision_notes: "Revisit this after the owner-assigned vocabulary lands.",
        record_ref: "openproject://work_packages/41",
        record_system: "openproject",
        status: "parked",
        updated_at: "2026-04-19T12:30:00Z",
        workflow_id: "idea-decision",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 12,
      rawArgs:
        "decide idea-41 parked Revisit this after the owner-assigned vocabulary lands.",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("http://broker.internal/v1/ideas/idea-41/decision");
    expect(JSON.parse((request as RequestInit).body as string)).toEqual({
      input: {
        notes: "Revisit this after the owner-assigned vocabulary lands.",
        status: "parked",
      },
      operator: {
        handle: "bob",
        id: "200",
      },
    });
    expect(result.text).toContain("Decided idea-41 [parked]");
    expect(result.text).toContain(
      "Decision notes: Revisit this after the owner-assigned vocabulary lands.",
    );
  });

  it("reserves triage discuss as an unimplemented AI-assisted placeholder", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 13,
      rawArgs: "triage discuss idea-41",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("not implemented yet");
  });

  it("treats free-form idea text starting with decide as a capture unless it targets a canonical idea id", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        idea_id: "idea-40",
        record_ref: "openproject://work_packages/40",
        status: "captured",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 12,
      rawArgs: "decide whether this should become a governed runbook later",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("http://broker.internal/v1/ideas/capture");
    expect(JSON.parse((request as RequestInit).body as string)).toMatchObject({
      body: "decide whether this should become a governed runbook later",
      title: "decide whether this should become a governed runbook later",
    });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("idea-40");
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

  it("renders stored triage summary when reading a triaged idea", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        body: "Add bounded triage action so operators can move captured ideas into triaged without editing OpenProject directly",
        created_at: "2026-04-18T10:00:00Z",
        idea_id: "idea-37",
        record_ref: "openproject://work_packages/37",
        source: {
          integration_id: "devint-idea-workflow",
          surface: "telegram",
        },
        status: "triaged",
        title: "Add bounded triage action so operators can move captured ideas into triaged without editing OpenProject directly",
        triage_summary: "Phone-friendly operator triage should move captured backlog items into triaged without requiring live Codex access.",
        updated_at: "2026-04-18T10:05:00Z",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 14,
      rawArgs: "show idea-37",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("Status  | triaged");
    expect(result.text).toContain("Triage summary:");
    expect(result.text).toContain(
      "Phone-friendly operator triage should move captured backlog items into triaged without requiring live Codex access.",
    );
  });

  it("renders stored operator decision notes when reading a decided idea", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        body: "Add bounded triage action so operators can move captured ideas into triaged without editing OpenProject directly",
        created_at: "2026-04-18T10:00:00Z",
        idea_id: "idea-37",
        operator_decision_notes: "Revisit this after the owner-assigned vocabulary lands.",
        record_ref: "openproject://work_packages/37",
        source: {
          integration_id: "devint-idea-workflow",
          surface: "telegram",
        },
        status: "parked",
        title: "Add bounded triage action so operators can move captured ideas into triaged without editing OpenProject directly",
        triage_summary: "Phone-friendly operator triage should move captured backlog items into triaged without requiring live Codex access.",
        updated_at: "2026-04-18T10:05:00Z",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 15,
      rawArgs: "show idea-37",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("Status  | parked");
    expect(result.text).toContain("Operator decision notes:");
    expect(result.text).toContain(
      "Revisit this after the owner-assigned vocabulary lands.",
    );
  });

  it("renders internal evaluation metadata when reading an evaluated idea", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        body: "Add bounded triage action so operators can move captured ideas into triaged without editing OpenProject directly",
        created_at: "2026-04-18T10:00:00Z",
        evaluation: {
          affected_scope: [
            "repo:operator-orchestration-service",
            "repo:openclaw-telegram-enhanced",
          ],
          ai_assist_lane: "local",
          confidence: "medium",
          notes: "Broker owns the workflow contract and Telegram remains a thin adapter.",
          suspected_owner: "repo:operator-orchestration-service",
          trust_boundary_areas: ["runtime", "ai"],
        },
        idea_id: "idea-37",
        record_ref: "openproject://work_packages/37",
        source: {
          integration_id: "devint-idea-workflow",
          surface: "telegram",
        },
        status: "triaged",
        title: "Add bounded triage action so operators can move captured ideas into triaged without editing OpenProject directly",
        triage_summary: "Phone-friendly operator triage should move captured backlog items into triaged without requiring live Codex access.",
        updated_at: "2026-04-18T10:05:00Z",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureIdeaThroughBroker({
      accountId: "default",
      chatType: "private",
      messageId: 16,
      rawArgs: "show idea-37",
      senderId: "200",
      senderUsername: "bob",
      telegramChatId: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("Evaluation metadata:");
    expect(result.text).toContain(
      "Suspected owner: repo:operator-orchestration-service",
    );
    expect(result.text).toContain(
      "Affected scope: repo:operator-orchestration-service, repo:openclaw-telegram-enhanced",
    );
    expect(result.text).toContain("Trust boundary areas: runtime, ai");
    expect(result.text).toContain("Confidence: medium");
    expect(result.text).toContain("AI assist lane: local");
    expect(result.text).toContain(
      "Broker owns the workflow contract and Telegram remains a thin adapter.",
    );
  });
});
