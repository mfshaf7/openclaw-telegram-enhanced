import { describe, expect, it } from "vitest";
import { parseTelegramTopicConversation } from "./telegram-topic-conversation.ts";

describe("parseTelegramTopicConversation", () => {
  it("parses a canonical topic conversation id", () => {
    expect(parseTelegramTopicConversation({ conversationId: "-1001234567890:topic:35" })).toEqual({
      chatId: "-1001234567890",
      topicId: "35",
      canonicalConversationId: "-1001234567890:topic:35",
    });
  });

  it("returns null when callback conversationId is missing", () => {
    expect(
      parseTelegramTopicConversation({
        conversationId: undefined as unknown as string,
        parentConversationId: "-1001234567890",
      }),
    ).toBeNull();
  });

  it("returns null when callback topic id is missing", () => {
    expect(
      parseTelegramTopicConversation({
        conversationId: "35",
        parentConversationId: undefined,
      }),
    ).toBeNull();
  });
});
