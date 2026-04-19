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
            "use `/idea decide <idea-id> <parked|accepted|rejected> <notes>` to record the first bounded durable decision",
            "use `/idea list` to review the recent idea slice",
            "use `/idea list all` to review every stored idea through broker pagination",
            "use `/idea list status <status>` to review one status slice such as `captured` or `parked`",
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
    expect(replyPayload?.replies?.[0]?.text).toContain("/idea triage <idea-id> <summary>");
    expect(replyPayload?.replies?.[0]?.text).toContain("/idea decide <idea-id> <parked|accepted|rejected> <notes>");
    expect(replyPayload?.replies?.[0]?.text).toContain("/idea list all");
    expect(replyPayload?.replies?.[0]?.text).toContain("Status lifecycle:");
  });

  it("routes /idea triage through the broker", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        idea_id: "idea-39",
        record_ref: "openproject://work_packages/39",
        status: "triaged",
        triage_summary: "Needs a bounded broker workflow before later decision handling.",
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
    ctx.match = "triage idea-39 Needs a bounded broker workflow before later decision handling.";

    await harness.handlers.idea(
      ctx,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("http://broker.internal/v1/ideas/idea-39/triage");
    expect((request as RequestInit).method).toBe("POST");
    expect(JSON.parse((request as RequestInit).body as string)).toEqual({
      input: {
        summary: "Needs a bounded broker workflow before later decision handling.",
      },
      operator: {
        handle: "testuser",
        id: "12345",
      },
    });
    const replyPayload = deliverReplies.mock.calls.at(-1)?.[0];
    expect(replyPayload?.replies?.[0]?.text).toContain("Triaged idea-39 [triaged]");
  });

  it("returns a specific incomplete-command error when /idea triage is missing the summary", async () => {
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
    ctx.match = "triage idea-39";

    await harness.handlers.idea(
      ctx,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    const replyPayload = deliverReplies.mock.calls.at(-1)?.[0];
    expect(replyPayload?.replies?.[0]?.text).toContain(
      "Incomplete command. Add a triage summary after the idea id.",
    );
  });

  it("routes /idea decide through the broker", async () => {
    vi.stubEnv("OPERATOR_ORCHESTRATION_BASE_URL", "http://broker.internal");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_ID", "openclaw-stage-gateway");
    vi.stubEnv("OPERATOR_ORCHESTRATION_CALLER_SECRET", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        idea_id: "idea-39",
        operator_decision_notes: "Revisit this after the owner-assigned vocabulary lands.",
        record_ref: "openproject://work_packages/39",
        status: "parked",
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
    ctx.match = "decide idea-39 parked Revisit this after the owner-assigned vocabulary lands.";

    await harness.handlers.idea(
      ctx,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("http://broker.internal/v1/ideas/idea-39/decision");
    expect((request as RequestInit).method).toBe("POST");
    expect(JSON.parse((request as RequestInit).body as string)).toEqual({
      input: {
        notes: "Revisit this after the owner-assigned vocabulary lands.",
        status: "parked",
      },
      operator: {
        handle: "testuser",
        id: "12345",
      },
    });
    const replyPayload = deliverReplies.mock.calls.at(-1)?.[0];
    expect(replyPayload?.replies?.[0]?.text).toContain("Decided idea-39 [parked]");
  });

  it("returns a specific incomplete-command error when /idea decide is missing notes", async () => {
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
    ctx.match = "decide idea-39 parked";

    await harness.handlers.idea(
      ctx,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    const replyPayload = deliverReplies.mock.calls.at(-1)?.[0];
    expect(replyPayload?.replies?.[0]?.text).toContain(
      "Incomplete command. Add decision notes after `parked`.",
    );
  });

  it("does not capture malformed decide commands as new ideas", async () => {
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
    ctx.match = "decide whether the ART handoff should become a runbook";

    await harness.handlers.idea(
      ctx,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    const replyPayload = deliverReplies.mock.calls.at(-1)?.[0];
    expect(replyPayload?.replies?.[0]?.text).toContain(
      "Usage: /idea decide <idea-id> <parked|accepted|rejected> <notes>",
    );
  });
});
