import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../../src/config/config.js";

const { defaultRouteConfig } = vi.hoisted(() => ({
  defaultRouteConfig: {
    agents: {
      list: [{ id: "main", default: true }, { id: "host-control" }],
    },
    channels: { telegram: {} },
    messages: { groupChat: { mentionPatterns: [] } },
  },
}));

vi.mock("../../../src/config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn(() => defaultRouteConfig),
  };
});

const { buildTelegramMessageContextForTest } =
  await import("./bot-message-context.test-harness.js");

describe("buildTelegramMessageContext host-control topic prompt", () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue(defaultRouteConfig as never);
  });

  it("appends the host-control system prompt for host-control forum topics", async () => {
    const ctx = await buildTelegramMessageContextForTest({
      message: {
        message_id: 1,
        chat: {
          id: -1001234567890,
          type: "supergroup",
          title: "Forum",
          is_forum: true,
        },
        date: 1700000000,
        text: "@bot hello",
        message_thread_id: 3,
        from: { id: 42, first_name: "Alice" },
      },
      options: { forceWasMentioned: true },
      resolveGroupActivation: () => true,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: false },
        topicConfig: {
          agentId: "host-control",
          systemPrompt: "Topic prompt",
        },
      }),
    });

    expect(ctx).not.toBeNull();
    expect(ctx?.ctxPayload?.SessionKey).toContain("agent:host-control:");
    expect(ctx?.ctxPayload?.GroupSystemPrompt).toContain("Topic prompt");
    expect(ctx?.ctxPayload?.GroupSystemPrompt).toContain(
      "You are operating inside a dedicated host-control Telegram topic.",
    );
  });
});
